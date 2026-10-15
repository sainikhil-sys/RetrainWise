import "server-only";

import { createHash, randomInt } from "node:crypto";

import { prisma } from "./prisma";

/** Sign-in codes: 6 digits, valid for OTP_MINUTES, single use, OTP_MAX_ATTEMPTS wrong guesses. */
export const OTP_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** Cookie holding the email (and return path) between "send code" and "enter code". */
export const OTP_COOKIE = "rw_otp";

/** Cryptographically random 6-digit code (leading zeros kept). */
export function newOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hash(code: string) {
  // Same construction Auth.js uses for verification tokens: sha256(token + secret).
  return createHash("sha256").update(`${code}${process.env.AUTH_SECRET ?? ""}`).digest("hex");
}

// Wrong-guess counters per email. In-memory: correct for a single server
// process (the local-first setup); use a shared store when running several.
const attempts = new Map<string, { n: number; first: number }>();

function failures(email: string) {
  const a = attempts.get(email);
  if (!a || Date.now() - a.first > OTP_MINUTES * 60_000) return 0;
  return a.n;
}

/** Forget wrong guesses (a fresh code was sent, or sign-in succeeded). */
export function resetOtpAttempts(email: string) {
  attempts.delete(email);
}

export type OtpCheck = { ok: true } | { ok: false; reason: "invalid" | "expired" | "locked"; remaining: number };

/**
 * Check a code against the stored hash without consuming it (Auth.js consumes
 * it on the callback). After OTP_MAX_ATTEMPTS wrong guesses every outstanding
 * code for the email is deleted, so guessing cannot continue.
 */
export async function checkOtp(email: string, code: string): Promise<OtpCheck> {
  if (failures(email) >= OTP_MAX_ATTEMPTS) return { ok: false, reason: "locked", remaining: 0 };
  const row = await prisma.verificationToken.findFirst({ where: { identifier: email, token: hash(code) } });
  if (row && row.expires.getTime() > Date.now()) return { ok: true };

  const a = attempts.get(email);
  const n = failures(email) + 1;
  attempts.set(email, { n, first: a && n > 1 ? a.first : Date.now() });
  if (n >= OTP_MAX_ATTEMPTS) {
    await prisma.verificationToken.deleteMany({ where: { identifier: email } });
    return { ok: false, reason: "locked", remaining: 0 };
  }
  return { ok: false, reason: row ? "expired" : "invalid", remaining: OTP_MAX_ATTEMPTS - n };
}

export function maskEmail(email: string) {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const shown = user.length <= 2 ? user[0] : `${user.slice(0, 2)}`;
  return `${shown}${"•".repeat(Math.max(1, Math.min(6, user.length - shown.length)))}@${domain}`;
}
