import "server-only";

/**
 * Sliding-window rate limiter kept in process memory. Suitable for a single
 * server instance (the local-first deployment this project targets); use a
 * shared store such as Redis when running several instances.
 */
const globalForLimits = globalThis as unknown as { __rwLimits?: Map<string, number[]> };
const buckets = (globalForLimits.__rwLimits ??= new Map<string, number[]>());

export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (!v.some((t) => now - t < windowMs)) buckets.delete(k);
  }
  return { ok: true, retryAfter: 0 };
}
