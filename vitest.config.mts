import { defineConfig } from "vitest/config";
import os from "node:os";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
    pool: "forks",
    env: { RETRAINWISE_DATA_DIR: path.join(os.tmpdir(), "rw-vitest-data"), SMTP_HOST: "", AUTH_DEV_CODES: "" },
  },
});
