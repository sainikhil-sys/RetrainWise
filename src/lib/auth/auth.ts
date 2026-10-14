/**
 * Accounts, email verification, password reset and sessions.
 *
 * Flow: sign up -> 6-digit code emailed -> verify -> signed in. Forgotten
 * passwords use the same emailed-code mechanism. Passwords are stored as scrypt
 * hashes, codes and session tokens as SHA-256 digests; nothing secret is kept
 * in plain text.
 */
import crypto from "node:crypto";
import { now, type Store } from "../db";
import { isConfigured, mailSettingsFromEnv, sendEmail, type MailSettings, type Sender } from "./mail";

export const PURPOSES = ["verify", "reset"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_MS = 60_000;
export const MAX_CODES_PER_HOUR = 5;
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60_000;
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const MIN_PASSWORD = 8;
const EMAIL_RE = /^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const SCRYPT = { N: 2 ** 14, r: 8, p: 1 };

/** A user-facing authentication failure (safe to show in the UI). */
export class AuthError extends Error {}
export class UnverifiedEmail extends AuthError {}

export interface User {
  id: number;
  email: string;
  name: string;
  verified: number;
  created: string;
  last_login: string | null;
  failed_logins: number;
  locked_until: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "+00:00");
const sha256 = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

export function normalizeEmail(email: string): string {
  const e = String(email || "").trim().toLowerCase();
  if (e.length > 254 || !EMAIL_RE.test(e)) throw new AuthError("Enter a valid email address.");
  return e;
}

export function checkPasswordStrength(password: string): void {
  if (typeof password !== "string" || password.length < MIN_PASSWORD) {
    throw new AuthError(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  if (password.length > 256) throw new AuthError("Password is too long (max 256 characters).");
  if (/^\d+$/.test(password) || /^[A-Za-z]+$/.test(password)) {
    throw new AuthError("Password must mix letters with numbers or symbols.");
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, r, p, salt, digest] = stored.split("$");
    if (scheme !== "scrypt" || !digest) return false;
    const expected = Buffer.from(digest, "hex");
    const test = crypto.scryptSync(password, Buffer.from(salt, "hex"), expected.length, { N: Number(n), r: Number(r),
      p: Number(p) });
    return crypto.timingSafeEqual(test, expected);
  } catch {
    return false;
  }
}

const DUMMY_HASH = hashPassword("dummy-password-0"); // equalises timing for unknown emails

function codeHash(email: string, purpose: Purpose, code: string): string {
  return sha256(`${purpose}:${email}:${code}`);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function codeEmail(purpose: Purpose, name: string, code: string) {
  const minutes = Math.round(CODE_TTL_MS / 60_000);
  const [subject, intro] = purpose === "verify"
    ? ["Your RetrainWise verification code", "Use this code to verify your email address:"]
    : ["Your RetrainWise password reset code", "Use this code to reset your password:"];
  const who = escapeHtml(name || "there");
  return {
    subject,
    text: `Hi ${name || "there"},\n\n${intro}\n\n    ${code}\n\nIt expires in ${minutes} minutes. If you did not request ` +
      "this, you can ignore this email.\n\n- RetrainWise",
    html: `<p>Hi ${who},</p><p>${intro}</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;` +
      `font-family:monospace">${code}</p><p>It expires in ${minutes} minutes. If you did not request this, you can ignore ` +
      "this email.</p><p>- RetrainWise</p>",
  };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface CodeDelivery {
  /** True when the email was accepted by the SMTP server. */
  sent: boolean;
  /** Only set when AUTH_DEV_CODES is on and SMTP is not configured. */
  devCode: string | null;
}

export class Auth {
  readonly mail: MailSettings;

  constructor(readonly db: Store, mail?: MailSettings, private sender: Sender = sendEmail) {
    this.mail = mail ?? mailSettingsFromEnv();
  }

  // ------------------------------------------------------------- lookups
  user(email: string): User | undefined {
    return this.db.one<User>("SELECT id, email, name, verified, created, last_login, failed_logins, locked_until " +
      "FROM users WHERE email=?", email);
  }

  userById(id: number): User | undefined {
    return this.db.one<User>("SELECT id, email, name, verified, created, last_login, failed_logins, locked_until " +
      "FROM users WHERE id=?", id);
  }

  private passwordHash(email: string): string | undefined {
    return this.db.one<{ password_hash: string }>("SELECT password_hash FROM users WHERE email=?", email)?.password_hash;
  }

  // ------------------------------------------------------------- codes
  /** Create a fresh code (invalidating older ones) and email it. */
  async sendCode(emailIn: string, purpose: Purpose): Promise<CodeDelivery> {
    if (!PURPOSES.includes(purpose)) throw new Error(`Unknown purpose ${purpose}`);
    const email = normalizeEmail(emailIn);
    const user = this.user(email);
    if (!user) throw new AuthError("No account exists for that email.");
    const t = Date.now();
    const recent = this.db.all<{ created: string }>("SELECT created FROM auth_codes WHERE email=? AND purpose=? AND " +
      "created>=? ORDER BY id DESC", email, purpose, iso(t - 3_600_000));
    if (recent.length) {
      const wait = Date.parse(recent[0].created) + RESEND_COOLDOWN_MS - t;
      if (wait > 0) throw new AuthError(`Please wait ${Math.ceil(wait / 1000)} seconds before requesting another code.`);
    }
    if (recent.length >= MAX_CODES_PER_HOUR) throw new AuthError("Too many codes requested for this email. Try again in an hour.");
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
    const dev = !isConfigured(this.mail) && this.mail.devCodes;
    if (!dev) await this.sender({ to: email, ...codeEmail(purpose, user.name, code) }, this.mail); // throws MailError
    this.db.tx(() => {
      this.db.run("UPDATE auth_codes SET used=1 WHERE email=? AND purpose=? AND used=0", email, purpose);
      this.db.run("INSERT INTO auth_codes(email,purpose,code_hash,created,expires) VALUES(?,?,?,?,?)", email, purpose,
        codeHash(email, purpose, code), iso(t), iso(t + CODE_TTL_MS));
      this.db.event("auth_code_sent", { email, purpose, dev }, null, email);
    });
    return { sent: !dev, devCode: dev ? code : null };
  }

  private consumeCode(email: string, purpose: Purpose, codeIn: string): void {
    const code = String(codeIn || "").replace(/\s+/g, "");
    // Record the attempt and commit before throwing: a throw inside the
    // transaction would roll back the attempt counter and void the limit.
    const error = this.db.tx((): string | null => {
      const row = this.db.one<{ id: number; code_hash: string; expires: string; attempts: number }>(
        "SELECT id, code_hash, expires, attempts FROM auth_codes WHERE email=? AND purpose=? AND used=0 " +
        "ORDER BY id DESC LIMIT 1", email, purpose);
      if (!row) return "No active code. Request a new one.";
      if (Date.parse(row.expires) < Date.now()) {
        this.db.run("UPDATE auth_codes SET used=1 WHERE id=?", row.id);
        return "That code has expired. Request a new one.";
      }
      if (row.attempts >= CODE_MAX_ATTEMPTS) {
        this.db.run("UPDATE auth_codes SET used=1 WHERE id=?", row.id);
        return "Too many wrong attempts. Request a new code.";
      }
      if (!safeEqual(row.code_hash, codeHash(email, purpose, code))) {
        const left = CODE_MAX_ATTEMPTS - row.attempts - 1;
        this.db.run("UPDATE auth_codes SET attempts=attempts+1, used=? WHERE id=?", left <= 0 ? 1 : 0, row.id);
        return left > 0 ? `Incorrect code. ${left} attempt${left !== 1 ? "s" : ""} left.` : "Incorrect code. Request a new one.";
      }
      this.db.run("UPDATE auth_codes SET used=1 WHERE id=?", row.id);
      return null;
    });
    if (error) throw new AuthError(error);
  }

  // ------------------------------------------------------------- flows
  async register(nameIn: string, emailIn: string, password: string, confirm: string): Promise<CodeDelivery> {
    const name = String(nameIn || "").trim().slice(0, 80);
    if (!name) throw new AuthError("Enter your name.");
    const email = normalizeEmail(emailIn);
    if (password !== confirm) throw new AuthError("Passwords do not match.");
    checkPasswordStrength(password);
    const existing = this.user(email);
    if (existing?.verified) throw new AuthError("An account with this email already exists. Sign in instead.");
    this.db.tx(() => {
      if (existing) { // unverified sign-up retried: take the latest details
        this.db.run("UPDATE users SET name=?, password_hash=? WHERE email=?", name, hashPassword(password), email);
      } else {
        this.db.run("INSERT INTO users(email,name,password_hash,created) VALUES(?,?,?,?)", email, name,
          hashPassword(password), now());
      }
      this.db.event("auth_registered", { email }, null, email);
    });
    return this.sendCode(email, "verify");
  }

  verifyEmail(emailIn: string, code: string): User {
    const email = normalizeEmail(emailIn);
    this.consumeCode(email, "verify", code);
    this.db.tx(() => {
      this.db.run("UPDATE users SET verified=1, failed_logins=0, locked_until=NULL, last_login=? WHERE email=?", now(), email);
      this.db.event("auth_verified", { email }, null, email);
    });
    return this.user(email)!;
  }

  /** Return the user on success. Throws AuthError; UnverifiedEmail means the verify step is needed. */
  login(emailIn: string, password: string): User {
    const email = normalizeEmail(emailIn);
    const user = this.user(email);
    if (user?.locked_until && Date.parse(user.locked_until) > Date.now()) {
      const minutes = Math.floor((Date.parse(user.locked_until) - Date.now()) / 60_000) + 1;
      throw new AuthError(`Too many failed sign-in attempts. Try again in ${minutes} minute(s) or reset your password.`);
    }
    if (!verifyPassword(password || "", this.passwordHash(email) || DUMMY_HASH)) {
      if (user) {
        this.db.tx(() => {
          const failures = user.failed_logins + 1;
          const locked = failures >= MAX_FAILED_LOGINS ? iso(Date.now() + LOCKOUT_MS) : null;
          this.db.run("UPDATE users SET failed_logins=?, locked_until=? WHERE email=?", locked ? 0 : failures, locked, email);
          this.db.event("auth_login_failed", { email, locked: Boolean(locked) }, null, email);
        });
      }
      throw new AuthError("Incorrect email or password.");
    }
    if (!user!.verified) throw new UnverifiedEmail("Your email is not verified yet. Enter the code we emailed you.");
    this.db.tx(() => {
      this.db.run("UPDATE users SET failed_logins=0, locked_until=NULL, last_login=? WHERE email=?", now(), email);
      this.db.event("auth_login", { email }, null, email);
    });
    return this.user(email)!;
  }

  /** Email a reset code. Unknown emails return null without revealing that to the UI. */
  async requestReset(emailIn: string): Promise<CodeDelivery | null> {
    const email = normalizeEmail(emailIn);
    if (!this.user(email)) return null;
    return this.sendCode(email, "reset");
  }

  resetPassword(emailIn: string, code: string, password: string, confirm: string): void {
    const email = normalizeEmail(emailIn);
    if (password !== confirm) throw new AuthError("Passwords do not match.");
    checkPasswordStrength(password);
    if (!this.user(email)) throw new AuthError("No active code. Request a new one.");
    this.consumeCode(email, "reset", code);
    const user = this.user(email)!;
    this.db.tx(() => {
      // A reset code proves control of the mailbox, so it also verifies the email.
      this.db.run("UPDATE users SET password_hash=?, verified=1, failed_logins=0, locked_until=NULL WHERE email=?",
        hashPassword(password), email);
      this.db.run("DELETE FROM sessions WHERE user_id=?", user.id); // sign out everywhere
      this.db.event("auth_password_reset", { email }, null, email);
    });
  }

  changePassword(email: string, current: string, password: string, confirm: string): void {
    if (!verifyPassword(current || "", this.passwordHash(email) || DUMMY_HASH)) throw new AuthError("Current password is incorrect.");
    if (password !== confirm) throw new AuthError("Passwords do not match.");
    checkPasswordStrength(password);
    this.db.tx(() => {
      this.db.run("UPDATE users SET password_hash=? WHERE email=?", hashPassword(password), email);
      this.db.event("auth_password_changed", { email }, null, email);
    });
  }

  // ------------------------------------------------------------- sessions
  createSession(userId: number): { token: string; expires: Date } {
    const token = crypto.randomBytes(32).toString("base64url");
    const expires = Date.now() + SESSION_TTL_MS;
    this.db.run("INSERT INTO sessions(token_hash,user_id,created,expires,last_seen) VALUES(?,?,?,?,?)", sha256(token),
      userId, now(), iso(expires), now());
    this.db.run("DELETE FROM sessions WHERE expires<?", iso(Date.now()));
    return { token, expires: new Date(expires) };
  }

  /** The verified user owning a live session token, or undefined. */
  sessionUser(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const row = this.db.one<{ user_id: number; expires: string }>("SELECT user_id, expires FROM sessions WHERE " +
      "token_hash=?", sha256(token));
    if (!row || Date.parse(row.expires) < Date.now()) return undefined;
    const user = this.userById(row.user_id);
    return user?.verified ? user : undefined;
  }

  destroySession(token: string | undefined): void {
    if (token) this.db.run("DELETE FROM sessions WHERE token_hash=?", sha256(token));
  }
}
