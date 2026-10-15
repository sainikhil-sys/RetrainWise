// Shared interpreter discovery for the npm scripts (mirrors src/lib/engine.ts).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENGINE_DIR = path.join(ROOT, "engine");
const win = process.platform === "win32";
export const venvPython = (dir) => path.join(dir, win ? "Scripts/python.exe" : "bin/python");

export function resolvePython() {
  const env = process.env.RETRAINWISE_PYTHON;
  if (env && env.trim()) return { path: env.trim(), source: "RETRAINWISE_PYTHON" };
  const candidates = [
    [venvPython(path.join(ENGINE_DIR, ".venv")), "engine/.venv"],
    [venvPython(path.join(ROOT, ".venv")), ".venv"],
  ];
  // In the user folder (not AppData): visible even to packaged desktop apps,
  // whose terminals get a private copy of AppData.
  candidates.push([venvPython(path.join(os.homedir(), ".venvs", "retrainwise")), "~/.venvs/retrainwise"]);
  if (win) {
    // %LOCALAPPDATA% is missing in some shells and services; fall back to its usual location.
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    candidates.push([venvPython(path.join(local, "RetrainWise", "venv")), "%LOCALAPPDATA%\\RetrainWise\\venv"]);
  }
  for (const [file, source] of candidates) if (fs.existsSync(file)) return { path: file, source };
  return { path: win ? "python" : "python3", source: "PATH" };
}
