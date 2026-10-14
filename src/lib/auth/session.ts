/** Session cookie helpers for server components and server actions. */
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { store } from "../db";
import { Auth, type User } from "./auth";

export const SESSION_COOKIE = "rw_session";
export const DEV_CODE_COOKIE = "rw_dev_code";

const globalAuth = globalThis as unknown as { __rwAuth?: Auth };

/** Process-wide Auth (mail settings are read once at startup; restart after editing .env). */
export function auth(): Auth {
  if (!globalAuth.__rwAuth) globalAuth.__rwAuth = new Auth(store());
  return globalAuth.__rwAuth;
}

export async function currentUser(): Promise<User | undefined> {
  const jar = await cookies();
  return auth().sessionUser(jar.get(SESSION_COOKIE)?.value);
}

/** The signed-in user, or a redirect to the sign-in page. Call at the top of every protected page and action. */
export async function requireUser(): Promise<User> {
  const user = await currentUser();
  if (!user) redirect("/signin");
  return user;
}

export async function startSession(user: User): Promise<void> {
  const { token, expires } = auth().createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" &&
    process.env.INSECURE_COOKIES !== "1", path: "/", expires });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  auth().destroySession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
}
