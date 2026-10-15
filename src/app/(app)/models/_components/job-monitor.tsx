"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CancelJobButton } from "@/components/model-actions";
import { Status } from "@/components/rw";
import { jobTone } from "./job-tone";
import { api } from "@/components/rw-client";
import type { JobLog } from "@/lib/queries";
import type { JobRow } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGES = ["queued", "preparing data", "preprocessing", "training", "validating", "registering", "completed"] as const;


function stageOf(job: JobRow, logs: JobLog[]) {
  if (job.status === "completed") return "completed";
  if (job.status === "queued") return "queued";
  const last = [...logs].reverse().find((l) => l.level === "stage");
  return last?.message ?? "preparing data";
}

/**
 * Live view of one training job: real stage, progress and worker log lines
 * polled from SQLite. Nothing here is estimated or animated ahead of the worker.
 */
export function JobMonitor({ initial, initialLogs, canCancel }: { initial: JobRow; initialLogs: JobLog[]; canCancel: boolean }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  const [logs, setLogs] = useState(initialLogs);
  const lastId = useRef(initialLogs.at(-1)?.id ?? 0);
  const box = useRef<HTMLDivElement>(null);
  const live = job.status === "queued" || job.status === "running";

  useEffect(() => {
    if (!live) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<{ job: JobRow; logs: JobLog[] }>(`/api/jobs/${job.id}?after=${lastId.current}`);
        if (stop) return;
        setJob(r.job);
        if (r.logs.length) {
          lastId.current = r.logs.at(-1)!.id;
          setLogs((prev) => [...prev, ...r.logs].slice(-400));
        }
        if (r.job.status !== "queued" && r.job.status !== "running") router.refresh();
      } catch {
        /* transient; the next tick retries */
      }
    };
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [live, job.id, router]);

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length]);

  const stage = stageOf(job, logs);
  const stageIdx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  const cfg = job.payload.config;

  return (
    <div className="rounded-md border border-border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13.5px]">
            <span className="font-mono">{job.id}</span>
            <Status tone={jobTone(job.status)}>{job.status}</Status>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {cfg ? `${cfg.model.type} · ${cfg.scope === "run" ? `active stream, last ${cfg.train_window?.toLocaleString()} rows` : `${cfg.dataset} · ${cfg.initial_window?.toLocaleString()} rows`} · seed ${cfg.seed}` : job.kind}
            {job.payload.requested_by && ` · by ${job.payload.requested_by}`}
          </p>
        </div>
        {live && canCancel && !job.cancel_requested && <CancelJobButton jobId={job.id} />}
        {job.cancel_requested === 1 && live && <span className="text-[12px] text-warn">Cancelling at the next checkpoint…</span>}
      </div>

      <div className="px-4 py-3">
        <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-label="Training stages">
          {STAGES.slice(1).map((s, i) => {
            const idx = i + 1;
            const done = stageIdx > idx || job.status === "completed";
            const current = stageIdx === idx && live;
            return (
              <li key={s} aria-current={current ? "step" : undefined} className={cn(done ? "text-foreground" : current ? "font-medium text-foreground" : "text-muted-foreground")}>
                {done ? "✓ " : current ? "● " : ""}
                {s}
              </li>
            );
          })}
        </ol>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(job.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Job progress">
          <div className={cn("h-full transition-[width] duration-500", job.status === "failed" ? "bg-bad" : "bg-foreground")} style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
        <p className="mt-1.5 flex justify-between text-[12px] text-muted-foreground">
          <span className="truncate">{job.message ?? "waiting for the worker"}</span>
          <span className="tabular">{(job.progress * 100).toFixed(0)}%</span>
        </p>
        {job.error && <p className="mt-2 rounded bg-bad-soft px-2 py-1.5 font-mono text-[12px] text-bad">{job.error}</p>}
      </div>

      <div ref={box} className="max-h-56 overflow-y-auto border-t border-border bg-subtle px-4 py-2 font-mono text-[11.5px] leading-relaxed" aria-label="Worker log" aria-live="polite">
        {logs.length ? (
          logs.map((l) => (
            <div key={l.id} className={cn(l.level === "error" && "text-bad", l.level === "stage" && "font-semibold")}>
              <span className="text-muted-foreground">{l.created.slice(11, 19)}</span> {l.level === "stage" ? `— ${l.message}` : l.message}
            </div>
          ))
        ) : (
          <div className="text-muted-foreground">No log lines yet.</div>
        )}
      </div>
    </div>
  );
}
