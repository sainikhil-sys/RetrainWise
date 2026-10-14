/** Load KEY=VALUE lines from .env.local and .env without overriding real environment variables. */
import fs from "node:fs";
import path from "node:path";

export function loadEnvFiles(dir = process.cwd()): void {
  for (const name of [".env.local", ".env"]) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(dir, name), "utf-8");
    } catch {
      continue;
    }
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
      let value = line.slice(eq + 1).trim();
      if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === "'" || value[0] === '"')) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
