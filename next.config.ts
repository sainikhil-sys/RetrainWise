import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native SQLite bindings and the SMTP client must load from node_modules at runtime.
  serverExternalPackages: ["better-sqlite3", "nodemailer"],
};

export default nextConfig;
