// `npm run test:engine`: run the Python engine's unittest suite with the resolved interpreter.
import { spawnSync } from "node:child_process";

import { ENGINE_DIR, resolvePython } from "./python.mjs";

const py = resolvePython();
console.log(`Using ${py.path} (${py.source})`);
const r = spawnSync(py.path, ["-B", "-m", "unittest", "test_project", "-v"], { cwd: ENGINE_DIR, stdio: "inherit", windowsHide: true });
process.exit(r.status ?? 1);
