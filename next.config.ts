import path from "node:path";

import type { NextConfig } from "next";

const SITE_ONLY = process.env.NEXT_PUBLIC_SITE_ONLY === "1";
const APP_PATHS = [
  "/signin",
  "/signin/:path*",
  "/onboarding",
  "/overview",
  "/data",
  "/monitoring",
  "/decisions",
  "/lifecycle",
  "/models",
  "/models/:path*",
  "/experiments",
  "/audit",
  "/settings",
  "/settings/:path*",
  "/profile",
  "/dev/:path*",
];

const nextConfig: NextConfig = {
  // Native SQLite driver and child-process bridge stay on the Node.js server.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  reactStrictMode: true,
  // The dev badge would cover the engine status indicator in the sidebar.
  devIndicators: false,
  // The Python engine folder is not part of the web bundle.
  outputFileTracingExcludes: { "*": ["engine/**/*"] },
  // Pin the project root. Otherwise Next infers it from the highest lockfile,
  // which (for a git worktree or a folder inside another project) can be a
  // parent directory. Watching that whole tree caused endless dev rebuilds and
  // page reloads.
  turbopack: { root: path.resolve(".") },
  outputFileTracingRoot: path.resolve("."),
  // Public-site-only deployments (NEXT_PUBLIC_SITE_ONLY=1, e.g. Vercel) serve the
  // marketing pages; the app itself needs the Python engine, so it is not exposed.
  ...(SITE_ONLY
    ? {
        async redirects() {
          return APP_PATHS.map((source) => ({ source, destination: "/docs#self-host", permanent: false }));
        },
        async rewrites() {
          return { beforeFiles: [{ source: "/api/:path*", destination: "/__site_only_no_api" }], afterFiles: [], fallback: [] };
        },
      }
    : {}),
};

export default nextConfig;
