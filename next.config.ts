import path from "node:path";

import type { NextConfig } from "next";


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
  // Build output folder (lets a production build run next to the dev server).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Server actions (sign-in) accept the public domain when a proxy serves the app.
  experimental: {
    serverActions: {
      allowedOrigins: [
        ...(process.env.RETRAINWISE_ALLOWED_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean),
        ...(process.env.AUTH_URL ? [new URL(process.env.AUTH_URL).host] : []),
      ],
    },
  },
  outputFileTracingRoot: path.resolve("."),
};

export default nextConfig;
