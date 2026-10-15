import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { prisma } from "./prisma";

/** Hosted providers of open-source models (OpenAI-compatible). Must match engine/agent.py OPENAI_PRESETS. */
export const PROVIDERS = [
  { id: "groq", name: "Groq", baseUrl: "https://api.groq.com/openai/v1", keyUrl: "https://console.groq.com/keys", prefix: "gsk_" },
  { id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys", prefix: "sk-or-" },
  { id: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", keyUrl: "https://api.together.ai/settings/api-keys", prefix: "" },
  { id: "huggingface", name: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", keyUrl: "https://huggingface.co/settings/tokens", prefix: "hf_" },
  { id: "custom", name: "Other endpoint", baseUrl: "", keyUrl: null, prefix: "" },
] as const;
export type ProviderId = (typeof PROVIDERS)[number]["id"];

/* Keys are encrypted with AES-256-GCM. The encryption key is derived from
 * AUTH_SECRET, so a database copy alone does not reveal provider keys. */
function encryptionKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to store API keys.");
  return createHash("sha256").update(`retrainwise:provider-keys:${secret}`).digest();
}

export function encryptKey(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}

export function decryptKey(stored: string): string {
  const raw = Buffer.from(stored, "base64");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

const norm = (url: string) => url.trim().replace(/\/+$/, "").toLowerCase();

/** The workspace's saved key for an endpoint URL, decrypted (server-side only), or null. */
export async function keyForEndpoint(workspaceId: string, baseUrl: string): Promise<{ id: string; key: string } | null> {
  const rows = await prisma.providerKey.findMany({ where: { workspaceId } });
  const match = rows.find((r) => norm(r.baseUrl) === norm(baseUrl));
  if (!match) return null;
  try {
    return { id: match.id, key: decryptKey(match.ciphertext) };
  } catch {
    return null; // AUTH_SECRET changed: the key must be added again
  }
}

/** Safe listing for the browser: never the key itself. */
export async function listKeys(workspaceId: string) {
  const rows = await prisma.providerKey.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    label: r.label,
    baseUrl: r.baseUrl,
    last4: r.last4,
    createdByEmail: r.createdByEmail,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}
export type SafeKey = Awaited<ReturnType<typeof listKeys>>[number];
