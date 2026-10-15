import { z } from "zod";

import { body, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { AuthError } from "@/lib/authz";
import { prisma } from "@/lib/prisma";
import { PROVIDERS, encryptKey, listKeys } from "@/lib/provider-keys";
import { reportFor } from "@/lib/report";

export const dynamic = "force-dynamic";

/** Saved model API keys for this workspace (masked: provider, label, last 4 characters). */
export const GET = route(async (_req, _p, ctx) => ({ keys: await listKeys(ctx.workspace.id), providers: PROVIDERS }));

const Add = z.object({
  provider: z.enum(["groq", "openrouter", "together", "huggingface", "custom"]),
  apiKey: z.string().trim().min(8, "That does not look like an API key.").max(400).regex(/^[\x21-\x7e]+$/, "API keys cannot contain spaces."),
  baseUrl: z.string().trim().url().max(200).regex(/^https?:\/\//).optional(),
  label: z.string().trim().max(60).optional(),
  test: z.boolean().optional(),
});

/** Add or replace the key for a provider (admins). Optionally checks it against the provider first. */
export const POST = route(
  async (req, _p, ctx) => {
    const b = await body(req, Add);
    const preset = PROVIDERS.find((p) => p.id === b.provider)!;
    const baseUrl = (b.provider === "custom" ? b.baseUrl : preset.baseUrl)?.replace(/\/+$/, "");
    if (!baseUrl) throw new AuthError(400, "Enter the endpoint URL for this provider.");
    let models: number | null = null;
    if (b.test !== false) {
      const s = await ctx.engine.call<{ openai: { available: boolean; models: string[]; error?: string } }>(
        "llm_status",
        { base_url: baseUrl, api_key: b.apiKey },
        { timeoutMs: 45_000 },
      );
      if (!s.openai.available) throw new AuthError(400, `The provider did not accept this key: ${s.openai.error ?? "endpoint not reachable"}.`);
      models = s.openai.models.length;
    }
    const data = {
      label: b.label || preset.name,
      baseUrl,
      ciphertext: encryptKey(b.apiKey),
      last4: b.apiKey.slice(-4),
      createdById: ctx.user.id,
      createdByEmail: ctx.user.email,
      lastUsedAt: null,
    };
    await prisma.providerKey.upsert({
      where: { workspaceId_provider: { workspaceId: ctx.workspace.id, provider: b.provider } },
      create: { workspaceId: ctx.workspace.id, provider: b.provider, ...data },
      update: data,
    });
    await audit({ kind: "model_api_key_saved", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { provider: b.provider, baseUrl, last4: data.last4 } });
    reportFor(ctx, {
      kind: "model_api_key_saved",
      title: `API key saved for ${data.label}`,
      summary: "The key is stored encrypted and is used only by the advisory agent to call this provider's open-source models. It is never shown again; only its last four characters are.",
      status: { label: "Saved", tone: "ok" },
      facts: [["Provider", data.label], ["Endpoint", baseUrl], ["Key", `•••• ${data.last4}`], ["Models available", models == null ? "not checked" : String(models)]],
      href: "/audit",
    });
    return { keys: await listKeys(ctx.workspace.id), models };
  },
  { permission: "settings.engine", limit: { max: 10, windowMs: 60_000 } },
);

/** Remove a saved key (admins). */
export const DELETE = route(
  async (req, _p, ctx) => {
    const id = z.string().max(40).parse(req.nextUrl.searchParams.get("id"));
    const row = await prisma.providerKey.findFirst({ where: { id, workspaceId: ctx.workspace.id } });
    if (!row) throw new AuthError(404, "Key not found");
    await prisma.providerKey.delete({ where: { id } });
    await audit({ kind: "model_api_key_removed", actorEmail: ctx.user.email, actorId: ctx.user.id, workspaceId: ctx.workspace.id, detail: { provider: row.provider, last4: row.last4 } });
    return { keys: await listKeys(ctx.workspace.id) };
  },
  { permission: "settings.engine" },
);
