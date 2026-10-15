import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

const Pull = z.object({ model: z.string().regex(/^[A-Za-z0-9._:/-]{1,80}$/, "must be an Ollama tag such as llama3.1:8b") });

/** Download an open-source model into the local Ollama install (admins; can take many minutes). */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, Pull);
    const r = await ctx.engine.isolated<{ model: string; status: string }>("ollama_pull", { model: b.model }, `ollama-pull:${b.model}`, 3_600_000);
    await audit({ kind: "llm_model_downloaded", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { model: b.model } });
    reportFor(ctx, {
      kind: "llm_model_downloaded",
      title: `Open-source model ready: ${b.model}`,
      summary: "The model was downloaded into Ollama on this computer. Choose it in Agent & audit to explain decisions locally; nothing leaves the machine.",
      status: { label: "Downloaded", tone: "ok" },
      facts: [["Model", b.model], ["Runs on", "this computer (Ollama)"]],
      href: "/audit",
    });
    return r;
  },
  { permission: "settings.engine", limit: { max: 4, windowMs: 60_000 } },
);
