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
};

export default nextConfig;
