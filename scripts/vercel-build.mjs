// Vercel build (`npm run vercel-build`, run automatically by Vercel instead of `build`).
//
// Local installs use SQLite (prisma/schema.prisma). Vercel cannot keep a SQLite
// file, so this build generates the same schema for PostgreSQL (for example the
// Neon database from Vercel Storage), brings the database up to date, protects
// the audit log, then builds Next.js. Required: DATABASE_URL (postgres://…).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const url = process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL || "";
if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("[retrainwise] DATABASE_URL must be a PostgreSQL connection string on Vercel (connect a Neon database under Storage).");
  process.exit(1);
}
process.env.DATABASE_URL = url;
// Schema changes go through the direct (unpooled) connection when Vercel provides one.
const direct = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;

const sqlite = fs.readFileSync(path.join(ROOT, "prisma", "schema.prisma"), "utf8");
const postgres = sqlite.replace(
  /provider\s*=\s*"sqlite"\s*\n\s*url\s*=\s*env\("DATABASE_URL"\)/,
  `provider  = "postgresql"\n  url       = env("DATABASE_URL")${direct ? '\n  directUrl = env("RW_DIRECT_URL")' : ""}`,
);
if (postgres === sqlite) {
  console.error("[retrainwise] could not switch the Prisma datasource to PostgreSQL");
  process.exit(1);
}
const schema = path.join(ROOT, "prisma", "postgres.prisma");
fs.writeFileSync(schema, postgres);
if (direct) process.env.RW_DIRECT_URL = direct;

function run(cmd, args) {
  console.log(`[retrainwise] ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["prisma", "generate", "--schema", schema]);
run("npx", ["prisma", "db", "push", "--schema", schema, "--skip-generate"]);
run("npx", ["prisma", "db", "execute", "--schema", schema, "--file", path.join(ROOT, "prisma", "postgres-audit.sql")]);
run("npx", ["next", "build"]);
