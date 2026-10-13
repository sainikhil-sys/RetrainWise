import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { EngineError } from "./engine";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Local-only API protection.
 * - Host must be a loopback name (blocks LAN access and DNS rebinding) unless
 *   RETRAINWISE_ALLOW_REMOTE=1 is set explicitly.
 * - State-changing requests must be JSON (forces a CORS preflight from other
 *   origins) and, when an Origin header is present, come from the same host.
 */
function guard(req: NextRequest): NextResponse | null {
  if (process.env.RETRAINWISE_ALLOW_REMOTE !== "1") {
    const host = hostname(req.headers.get("host"));
    if (!host || !LOCAL_HOSTS.has(host)) {
      return NextResponse.json({ error: "RetrainWise only accepts requests from this computer (localhost)." }, { status: 403 });
    }
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    const type = req.headers.get("content-type") ?? "";
    if (!type.toLowerCase().startsWith("application/json")) {
      return NextResponse.json({ error: "Requests must use Content-Type: application/json." }, { status: 415 });
    }
    const origin = req.headers.get("origin");
    if (origin && hostname(origin) !== hostname(req.headers.get("host"))) {
      return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
    }
  }
  return null;
}

type Ctx<P> = { params: Promise<P> };

export function route<P = Record<string, string>>(handler: (req: NextRequest, params: P) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    try {
      const params = (ctx?.params ? await ctx.params : {}) as P;
      const result = await handler(req, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof EngineError) {
    return NextResponse.json({ error: err.message, kind: err.kind }, { status: err.status });
  }
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return NextResponse.json({ error: issues.join("; "), kind: "invalid", issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body is not valid JSON.", kind: "invalid" }, { status: 400 });
  }
  console.error("[retrainwise api]", err);
  return NextResponse.json({ error: (err as Error)?.message || "Unexpected server error", kind: "internal" }, { status: 500 });
}

export async function body<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const text = await req.text();
  if (text.length > 100_000) throw new z.ZodError([{ code: "custom", path: [], message: "Request body too large", input: undefined }]);
  return schema.parse(text ? JSON.parse(text) : {});
}

export const sizeEnum = z.enum(["small", "standard", "full"]);
export const prefixSchema = z.string().regex(/^[A-Za-z0-9_]{1,80}$/, "invalid result set name");
export const ident =z.string().regex(/^[A-Za-z0-9]{1,32}$/, "must be an alphanumeric identifier");
export const actorName = z.string().trim().min(1, "is required").max(80, "must be at most 80 characters");
