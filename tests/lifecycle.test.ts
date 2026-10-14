import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { explain, recommendationConsistency, textualToolCalls, validateArguments, ToolError,
  type ChatMessage } from "@/lib/agent";
import { DEFAULT_SETTINGS, replaceSettings } from "@/lib/config";
import { Store } from "@/lib/db";
import { cancel, listJobs, recover, runJob, submit, validatePayload } from "@/lib/jobs";
import { ApprovalError, clearCaches, Lifecycle, LifecycleError, type Decision, type Run } from "@/lib/lifecycle";
import type { Evidence } from "@/lib/ml/models";
import { FAST, useTempStore } from "./helpers";

function setup(tmp: ReturnType<typeof useTempStore>) {
  const ctx = {} as { life: Lifecycle; run: Run; advance: (n: number) => void; promote: () => [Decision, "full" | "partial"] };
  beforeEach(() => {
    ctx.life = new Lifecycle(tmp.db(), path.join(tmp.dir(), "models"));
    ctx.life.saveSettings(replaceSettings(DEFAULT_SETTINGS, { ...FAST, cooldown_batches: 1, min_confidence: 0.6 }));
    ctx.run = ctx.life.startRun("synthetic", "small", 3);
    ctx.advance = (n) => {
      for (let i = 0; i < n; i++) {
        const r = ctx.life.run(ctx.run.id)!;
        ctx.life.processBatch(r.id, r.position);
      }
    };
    ctx.promote = () => {
      ctx.advance(8);
      const d = ctx.life.evaluate(ctx.run.id);
      const action = d.ranked.find((r) => r.action !== "defer" && (r.evidence as Evidence).compatible)!.action;
      return [d, action as "full" | "partial"];
    };
  });
  return ctx;
}

describe("lifecycle", () => {
  const tmp = useTempStore();
  const t = setup(tmp);
  const count = (sql: string) => (tmp.db().one<{ n: number }>(sql)!.n);

  it("a duplicate batch request is a no-op", () => {
    const pos = t.life.run(t.run.id)!.position;
    t.life.processBatch(t.run.id, pos);
    expect(t.life.processBatch(t.run.id, pos).noop).toBe(true);
    expect(t.life.telemetry(t.run.id)).toHaveLength(1);
  });

  it("predicts first and reveals labels only when due", () => {
    t.life.saveSettings(replaceSettings(t.life.settings(), { label_delay_batches: 1 }));
    t.advance(1);
    let last = t.life.telemetry(t.run.id).at(-1)!;
    expect(last.labels_revealed).toBe(0);
    expect(last.labels_pending).toBe(250);
    t.advance(1);
    last = t.life.telemetry(t.run.id).at(-1)!;
    expect(last.labels_revealed).toBe(250);
  });

  it("requires approval and prevents duplicate execution", () => {
    const [d, action] = t.promote();
    expect(t.life.evaluate(t.run.id).id).toBe(d.id); // idempotent, charged once
    expect(count("SELECT COUNT(*) AS n FROM events WHERE kind='decision_created'")).toBe(1);
    expect(() => t.life.execute(d.id, action, "tester", false)).toThrow(ApprovalError);
    expect(() => t.life.execute(d.id, action, "agent", false, "autonomous")).toThrow(ApprovalError); // autonomy off
    const result = t.life.execute(d.id, action, "tester", true);
    expect(["promoted", "rejected"]).toContain(result.status);
    expect(() => t.life.execute(d.id, action, "tester", true)).toThrow(LifecycleError);
    expect(count("SELECT COUNT(*) AS n FROM approvals")).toBe(1);
  });

  it("a stale decision cannot execute", () => {
    const [d, action] = t.promote();
    t.advance(1);
    expect(() => t.life.execute(d.id, action, "tester", true)).toThrow(LifecycleError);
    expect(t.life.decision(d.id)!.status).toBe("stale");
  });

  it("promotes into the registry and rolls back", () => {
    const [d, action] = t.promote();
    t.life.gate = () => ({ passed: true, checks: [] });
    const result = t.life.execute(d.id, action, "tester", true);
    expect(result.status).toBe("promoted");
    const run = t.life.run(t.run.id)!;
    expect(run.active_version).toBe(result.version);
    const files = fs.readdirSync(path.join(tmp.dir(), "models"));
    expect(files).toContain(`model_v${String(result.version).padStart(3, "0")}.json`);
    expect(files.filter((f) => f.startsWith("candidate_"))).toEqual([]);
    const status = (v: number) => t.life.registry(t.run.id).find((r) => r.version === v)!.status;
    expect(status(result.version as number)).toBe("active");
    expect(status(1)).toBe("archived");
    expect(() => t.life.rollback(1, "tester", false)).toThrow(ApprovalError);
    t.life.rollback(1, "tester", true, "test");
    expect(t.life.run(t.run.id)!.active_version).toBe(1);
    expect(status(result.version as number)).toBe("rolled_back");
  });

  it("rejects a candidate that fails validation", () => {
    const [d, action] = t.promote();
    t.life.gate = () => ({ passed: false, checks: [{ check: "forced", passed: false, detail: "" }] });
    expect(t.life.execute(d.id, action, "tester", true).status).toBe("rejected");
    expect(t.life.run(t.run.id)!.active_version).toBe(1);
    expect(t.life.registry(t.run.id).map((r) => r.status)).toContain("rejected");
  });

  it("re-checks guardrails at execution", () => {
    const [d, action] = t.promote();
    t.life.gate = () => ({ passed: true, checks: [] });
    t.life.execute(d.id, action, "tester", true);
    t.advance(1);
    t.life.saveSettings(replaceSettings(t.life.settings(), { cooldown_batches: 5 }));
    const d2 = t.life.evaluate(t.run.id);
    const blocked = d2.ranked.filter((r) => r.action !== "defer");
    expect(blocked.every((r) => !r.feasible)).toBe(true);
    const result = t.life.execute(d2.id, blocked[0].action, "tester", true);
    expect(result.status).toBe("rejected");
    expect(result.outcome).toMatch(/guardrails/);
  });

  it("bounded autonomy respects its limits", () => {
    t.life.saveSettings(replaceSettings(t.life.settings(), { autonomy: true, autonomy_max_actions: 1,
      autonomy_max_cost: 10_000 }));
    t.advance(14);
    expect(t.life.run(t.run.id)!.autonomous_actions).toBeLessThanOrEqual(1);
    const modes = new Set(tmp.db().all<{ mode: string }>("SELECT mode FROM approvals").map((r) => r.mode));
    expect([...modes].every((m) => m === "autonomous")).toBe(true);
  });

  it("state survives a restart and interrupted work is marked", () => {
    t.advance(3);
    const d = t.life.evaluate(t.run.id);
    tmp.db().run("UPDATE decisions SET status='executing' WHERE id=?", d.id);
    clearCaches();
    const fresh = new Lifecycle(new Store(path.join(tmp.dir(), "t.db")), path.join(tmp.dir(), "models"));
    const run = fresh.activeRun()!;
    expect(run.position).toBe(FAST.initial_size + 3 * FAST.batch_size);
    expect(fresh.telemetry(run.id)).toHaveLength(3);
    expect(fresh.recover().interrupted_executions).toBe(1);
    expect(fresh.decision(d.id)!.status).toBe("interrupted");
  });
});

describe("agent", () => {
  const tmp = useTempStore();
  const t = setup(tmp);

  it("validates tool arguments strictly", () => {
    expect(validateArguments("get_monitoring_telemetry", '{"last_n_batches": 3}')).toEqual({ last_n_batches: 3 });
    for (const [name, args] of [["delete_everything", {}], ["get_monitoring_telemetry", { last_n_batches: 99 }],
      ["get_monitoring_telemetry", { extra: 1 }], ["get_action_evaluations", { decision_id: "x;drop" }],
      ["prepare_execution_request", { decision_id: "a", action: "full" }],
      ["prepare_execution_request", { decision_id: "a", action: "nuke", rationale: "r" }]] as const) {
      expect(() => validateArguments(name, args)).toThrow(ToolError);
    }
  });

  it("deterministic mode explains without an LLM and records tool calls", async () => {
    t.advance(6);
    const d = t.life.evaluate(t.run.id);
    const result = await explain(t.life, d, "deterministic");
    expect(result.status).toBe("completed");
    expect(result.report).toMatch(/Deterministic explanation mode/);
    expect(tmp.db().one<{ n: number }>("SELECT COUNT(*) AS n FROM agent_tool_calls")!.n).toBe(4);
  });

  it("runs a bounded tool loop with a mock provider and only prepares requests", async () => {
    t.advance(6);
    const d = t.life.evaluate(t.run.id);
    const script: ChatMessage[] = [
      { role: "assistant", tool_calls: [{ function: { name: "get_action_evaluations", arguments: {} } },
        { function: { name: "prepare_execution_request",
          arguments: { decision_id: d.id, action: d.recommended, rationale: "test" } } }] },
      { role: "assistant", content: `## Recommendation\n${d.recommended === "defer" ? "Defer" : d.recommended === "full"
        ? "Full retraining" : "Partial update"} is recommended.\n## Uncertainty\nSome.` },
    ];
    let i = 0;
    const result = await explain(t.life, d, "ollama", "mock", async () => script[i++]);
    expect(result.status).toBe("completed");
    expect(result.requests_prepared).toHaveLength(1);
    expect(t.life.decision(d.id)!.status).toBe("pending"); // nothing executed
    expect(tmp.db().one<{ status: string }>("SELECT status FROM execution_requests")!.status).toBe("awaiting_approval");
  });

  it("executes textual tool calls instead of reporting them", () => {
    const calls = textualToolCalls('Let me check. {"name": "get_cost_assumptions", "arguments": {}}');
    expect(calls.map((c) => c.function.name)).toEqual(["get_cost_assumptions"]);
    expect(textualToolCalls("A plain answer without JSON.")).toEqual([]);
  });

  it("the LLM recommendation must match the engine", () => {
    expect(recommendationConsistency("## Recommendation\nDo a full retrain.", "full").consistent).toBe(true);
    expect(recommendationConsistency("## Recommendation\nDefer for now.", "full").consistent).toBe(false);
    expect(recommendationConsistency("No headings here", "defer").consistent).toBe(false);
  });

  it("falls back to the deterministic report on failure or iteration limit", async () => {
    t.advance(6);
    const d = t.life.evaluate(t.run.id);
    const failing = await explain(t.life, d, "ollama", "mock", async () => {
      throw new Error("connection refused");
    });
    expect(failing.status).toBe("fallback");
    expect(failing.report).toMatch(/Deterministic explanation mode/);
    const looping = await explain(t.life, d, "ollama", "mock", async () => ({ role: "assistant",
      tool_calls: [{ function: { name: "get_cost_assumptions", arguments: {} } }] }), 60, 3);
    expect(looping.status).toBe("fallback");
    expect(looping.iterations).toBe(3);
  });
});

describe("jobs", () => {
  const tmp = useTempStore();
  const payload = { datasets: ["synthetic"], policies: ["never" as const, "calendar" as const], regimes: ["balanced"],
    seeds: [1], size: "small", settings: { ...FAST } };

  it("deduplicates submissions and completes", async () => {
    const [id, created] = submit(tmp.db(), payload, "tester", false);
    expect(created).toBe(true);
    expect(submit(tmp.db(), payload, "tester", false)).toEqual([id, false]);
    expect(() => submit(tmp.db(), { ...payload, seeds: [2] }, "tester", false)).toThrow(/Another job/);
    expect(await runJob(tmp.db(), id)).toBe("completed");
    const job = listJobs(tmp.db())[0];
    expect(job.result!.runs).toBe(2);
    expect(job.progress).toBe(1);
  });

  it("cancels and marks stale jobs as interrupted", async () => {
    const [id] = submit(tmp.db(), payload, "tester", false);
    cancel(tmp.db(), id);
    expect(await runJob(tmp.db(), id)).toBe("cancelled");
    const [id2] = submit(tmp.db(), { ...payload, seeds: [3] }, "tester", false);
    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    tmp.db().run("UPDATE jobs SET status='running', heartbeat=?, created=? WHERE id=?", old, old, id2);
    expect(recover(tmp.db())).toBe(1);
    expect(listJobs(tmp.db()).find((j) => j.id === id2)!.status).toBe("interrupted");
  });

  it("validates payloads", () => {
    for (const bad of [{ datasets: ["nope"] }, { policies: [] }, { seeds: Array.from({ length: 20 }, (_, i) => i) },
      { size: "huge" }, { datasets: ["electricity"] }]) {
      expect(() => validatePayload({ ...payload, ...bad } as never)).toThrow();
    }
  });
});
