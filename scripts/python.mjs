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
  if (win && process.env.LOCALAPPDATA) {
    candidates.push([venvPython(path.join(process.env.LOCALAPPDATA, "RetrainWise", "venv")), "%LOCALAPPDATA%\\RetrainWise\\venv"]);
  }
  candidates.push([venvPython(path.join(os.homedir(), ".venvs", "retrainwise")), "~/.venvs/retrainwise"]);
  for (const [file, source] of candidates) if (fs.existsSync(file)) return { path: file, source };
  return { path: win ? "python" : "python3", source: "PATH" };
}
