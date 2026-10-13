// `npm run setup:python`: create engine/.venv and install the engine requirements.
// Uses `uv` when available (fast), otherwise the standard venv + pip.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { ENGINE_DIR, venvPython } from "./python.mjs";

const venv = path.join(ENGINE_DIR, ".venv");
const requirements = path.join(ENGINE_DIR, "requirements.txt");
const win = process.platform === "win32";

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", windowsHide: true });
  return r.status === 0;
}

function has(cmd, args = ["--version"]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", windowsHide: true });
  return r.status === 0;
}

const base = process.env.RETRAINWISE_BASE_PYTHON || (win ? (has("py", ["-3.12", "--version"]) ? "py" : "python") : "python3");
const baseArgs = base === "py" ? ["-3.12"] : [];
const python = venvPython(venv);

if (has("uv")) {
  if (!fs.existsSync(python) && !run("uv", ["venv", "--python", "3.12", venv])) process.exit(1);
  if (!run("uv", ["pip", "install", "--python", python, "-r", requirements])) process.exit(1);
} else {
  if (!fs.existsSync(python) && !run(base, [...baseArgs, "-m", "venv", venv])) {
    console.error("Could not create the virtual environment. Install Python 3.10–3.12 and try again.");
    process.exit(1);
  }
  if (!run(python, ["-m", "pip", "install", "--upgrade", "pip"])) process.exit(1);
  if (!run(python, ["-m", "pip", "install", "-r", requirements])) process.exit(1);
}

console.log(`\nPython engine ready: ${python}\nStart the app with: npm run dev`);
