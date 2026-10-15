// Upload the values in .env.vercel to the linked Vercel project (Production),
// then redeploy. Run it yourself after replacing the fake placeholders:
//
//   node scripts/vercel-env.mjs            # upload + redeploy
//   node scripts/vercel-env.mjs --no-deploy
//
// - Values that are still placeholders (FAKE, your-verified-domain, example.com)
//   are skipped and listed, so nothing fake reaches production.
// - AUTH_SECRET is generated here if it is still a placeholder.
// - DATABASE_URL is skipped: the Neon integration manages it.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const file = path.join(ROOT, ".env.vercel");
if (!fs.existsSync(file)) {
  console.error("Missing .env.vercel");
  process.exit(1);
}
function parse(f) {
  const out = {};
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*(#.*)?$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const vars = parse(file);
// Real values from local development fill in what .env.vercel still has as placeholders
// (for example AUTH_RESEND_KEY and EMAIL_FROM). Local-only settings are never copied.
const local = parse(path.join(ROOT, ".env"));
const MANAGED = new Set(["DATABASE_URL"]);
const LOCAL_ONLY = new Set(["DATABASE_URL", "AUTH_URL", "AUTH_SECRET", "RETRAINWISE_PYTHON"]);
const placeholder = (v) => !v || /FAKE|your-verified-domain|example\.com|fake-/i.test(v);
for (const [name, value] of Object.entries(vars)) {
  if (placeholder(value) && !LOCAL_ONLY.has(name) && !placeholder(local[name])) vars[name] = local[name];
}
if (placeholder(vars.AUTH_SECRET)) vars.AUTH_SECRET = crypto.randomBytes(32).toString("base64url");

const vercel = process.platform === "win32" ? "vercel.cmd" : "vercel";
const sent = [];
const skipped = [];
for (const [name, value] of Object.entries(vars)) {
  if (MANAGED.has(name)) continue;
  if (placeholder(value)) {
    skipped.push(name);
    continue;
  }
  spawnSync(vercel, ["env", "rm", name, "production", "--yes"], { cwd: ROOT, stdio: "ignore", shell: process.platform === "win32" });
  const r = spawnSync(vercel, ["env", "add", name, "production"], { cwd: ROOT, input: value, stdio: ["pipe", "ignore", "pipe"], shell: process.platform === "win32" });
  if (r.status !== 0) {
    console.error(`Could not set ${name}: ${String(r.stderr).trim().split("\n").pop()}`);
    process.exit(1);
  }
  sent.push(name);
}
console.log(`Set on Vercel (production): ${sent.join(", ") || "nothing"}`);
if (skipped.length) console.log(`Skipped (still placeholders, fill them in .env.vercel): ${skipped.join(", ")}`);
if (!process.argv.includes("--no-deploy")) {
  console.log("Redeploying to production…");
  const d = spawnSync(vercel, ["deploy", "--prod", "--yes"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  process.exit(d.status ?? 0);
}
