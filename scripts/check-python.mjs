// Runs before `npm run dev`: warns (never fails) when the engine's Python is not ready.
import { spawnSync } from "node:child_process";

import { resolvePython } from "./python.mjs";

const py = resolvePython();
const probe = spawnSync(py.path, ["-c", "import numpy, pandas, sklearn, scipy, joblib; import sys; print(sys.version.split()[0])"], {
  encoding: "utf8",
  timeout: 120_000,
  windowsHide: true,
});

if (probe.status === 0) {
  console.log(`[retrainwise] Python ${probe.stdout.trim()} with engine requirements found (${py.source}: ${py.path}).`);
} else {
  const why = probe.error ? probe.error.message : (probe.stderr || "").trim().split("\n").pop();
  console.warn("\n[retrainwise] The Python engine is not ready.");
  console.warn(`  Interpreter tried: ${py.path} (${py.source})`);
  if (why) console.warn(`  Problem: ${why}`);
  console.warn("  Fix: run `npm run setup:python` (creates engine/.venv and installs engine/requirements.txt),");
  console.warn("       or set RETRAINWISE_PYTHON to a Python 3.10–3.12 interpreter that has them installed.");
  console.warn("  The dashboard will start, but actions need the engine.\n");
}
