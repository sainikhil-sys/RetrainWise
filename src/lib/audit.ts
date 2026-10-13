import "server-only";

import { prisma } from "./prisma";

/** Append an application-level audit entry (immutable; enforced by DB triggers). */
export async function audit(entry: {
  kind: string;
  actorEmail: string;
  actorId?: string | null;
  workspaceId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        kind: entry.kind,
        actorEmail: entry.actorEmail,
        actorId: entry.actorId ?? null,
        workspaceId: entry.workspaceId ?? null,
        detail: JSON.stringify(entry.detail ?? {}),
        ip: entry.ip ?? null,
      },
    });
  } catch (err) {
    console.error("[retrainwise audit] failed to write audit entry", err);
  }
}
