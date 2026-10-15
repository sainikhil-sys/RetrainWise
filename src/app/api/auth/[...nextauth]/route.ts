import { NextResponse, type NextRequest } from "next/server";

import { handlers } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Auth.js routes. The email callback accepts a 6-digit code, so it is rate
 * limited here too (per email and per IP); the sign-in form adds a stricter
 * wrong-guess limit on top (src/lib/otp.ts).
 */
export async function GET(req: NextRequest) {
  if (req.nextUrl.pathname.endsWith("/callback/resend")) {
    const email = (req.nextUrl.searchParams.get("email") ?? "").toLowerCase();
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
    if (!rateLimit(`otp-callback:${email}`, 8, 10 * 60_000).ok || !rateLimit(`otp-callback-ip:${ip}`, 30, 10 * 60_000).ok) {
      return NextResponse.redirect(new URL("/signin/error?error=Verification", req.url));
    }
  }
  return handlers.GET(req);
}

export const POST = handlers.POST;
