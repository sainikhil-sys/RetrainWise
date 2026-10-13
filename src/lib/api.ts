import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AuthError, requireApi, type Ctx } from "./authz";
import { EngineError, wsEngine, type WsEngine } from "./engine";
import type { Permission } from "./permissions";
import { rateLimit } from "./rate-limit";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes("://") ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

function allowedHost(host: string | null) {
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  const extra = (process.env.RETRAINWISE_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
  const authHost = hostname(process.env.AUTH_URL || null);
  return extra.includes(host) || host === authHost;
}

/**
 * Request protection applied before authentication:
 * - Host must be localhost or an explicitly configured host (blocks DNS rebinding).
 * - State-changing requests must be JSON and same-origin (CSRF protection).
 */
function guard(req: NextRequest): NextResponse | null {
  if (!allowedHost(hostname(req.headers.get("host")))) {
    return NextResponse.json({ error: "This host is not allowed. Add it to RETRAINWISE_ALLOWED_HOSTS." }, { status: 403 });
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

export type RouteCtx = Ctx & { engine: WsEngine };
type Ctx2<P> = { params: Promise<P> };
type Options = { permission?: Permission; limit?: { max: number; windowMs: number } | false };

/**
 * Authenticated, authorised API route. The handler receives the caller's
 * workspace context and a workspace-scoped engine client. Mutations are rate
 * limited per user and path (default 40 per minute).
 */
export function route<P = Record<string, string>>(
  handler: (req: NextRequest, params: P, ctx: RouteCtx) => Promise<unknown>,
  options: Options = {},
) {
  return async (req: NextRequest, c: Ctx2<P>) => {
    const blocked = guard(req);
    if (blocked) return blocked;
    try {
      const ctx = await requireApi(options.permission ?? "view");
      if (req.method !== "GET" && options.limit !== false) {
        const lim = options.limit || { max: 40, windowMs: 60_000 };
        const r = rateLimit(`${ctx.user.id}:${req.nextUrl.pathname}`, lim.max, lim.windowMs);
        if (!r.ok) {
          return NextResponse.json(
            { error: `Too many requests. Try again in ${r.retryAfter} s.`, kind: "rate_limited" },
            { status: 429, headers: { "Retry-After": String(r.retryAfter) } },
          );
        }
      }
      const params = (c?.params ? await c.params : {}) as P;
      const result = await handler(req, params, { ...ctx, engine: wsEngine(ctx.workspace.id) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message, kind: "auth" }, { status: err.status });
  if (err instanceof EngineError) return NextResponse.json({ error: err.message, kind: err.kind }, { status: err.status });
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`);
    return NextResponse.json({ error: issues.join("; "), kind: "invalid", issues }, { status: 400 });
  }
  if (err instanceof SyntaxError) return NextResponse.json({ error: "Request body is not valid JSON.", kind: "invalid" }, { status: 400 });
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
export const ident = z.string().regex(/^[A-Za-z0-9]{1,32}$/, "must be an alphanumeric identifier");
export const reasonText = z.string().trim().max(500).default("");
