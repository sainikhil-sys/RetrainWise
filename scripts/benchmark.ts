/**
 * Run policy benchmarks from a terminal, e.g.
 *   npm run benchmark -- --datasets synthetic --size small --seeds 1 2 --regimes cheap balanced expensive
 */
import { DEFAULT_SETTINGS, replaceSettings } from "../src/lib/config";
import { benchmark, POLICIES, type Policy } from "../src/lib/experiments";

function listArg(argv: string[], name: string, fallback: string[]): string[] {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const out: string[] = [];
  for (let j = i + 1; j < argv.length && !argv[j].startsWith("--"); j++) out.push(argv[j]);
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const batch = listArg(argv, "batch-size", []);
  const settings = batch.length ? replaceSettings(DEFAULT_SETTINGS, { batch_size: Number(batch[0]) }) : DEFAULT_SETTINGS;
  const prefix = listArg(argv, "prefix", ["results"])[0];
  const result = await benchmark({
    datasets: listArg(argv, "datasets", ["synthetic"]), size: listArg(argv, "size", ["small"])[0],
    seeds: listArg(argv, "seeds", ["42"]).map(Number), regimes: listArg(argv, "regimes", ["cheap", "balanced", "expensive"]),
    policies: listArg(argv, "policies", [...POLICIES]) as Policy[], settings, prefix,
    progress: (f, m) => console.log(`[${(100 * f).toFixed(1).padStart(5)}%] ${m}`),
  });
  console.log(`Wrote ${result.files.join(", ")} to data/results (${result.summary.length} runs, ` +
    `${result.wall_seconds.toFixed(1)}s)`);
}

main().catch((exc) => {
  console.error(String(exc?.message || exc));
  process.exit(1);
});
