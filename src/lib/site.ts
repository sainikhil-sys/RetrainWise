/**
 * Public-site-only deployments (for example Vercel) set NEXT_PUBLIC_SITE_ONLY=1.
 * They serve the marketing pages only: the app needs a long-running Python engine
 * and a writable database, so sign-in and app routes redirect to the self-hosting
 * guide and the API is disabled (see next.config.ts).
 */
export const SITE_ONLY = process.env.NEXT_PUBLIC_SITE_ONLY === "1";

export const REPO_URL = "https://github.com/sainikhil-sys/RetrainWise";
export const SELF_HOST_URL = "/docs#self-host";
