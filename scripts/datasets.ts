/** Explicitly download and cache real datasets:  npm run datasets -- electricity airlines covertype */
import { download, SOURCES } from "../src/lib/datasets";

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  if (!names.length || names.some((n) => !(n in SOURCES))) {
    console.error(`Usage: npm run datasets -- ${Object.keys(SOURCES).join(" ")}`);
    process.exit(2);
  }
  for (const name of names) {
    const info = await download(name);
    console.log(JSON.stringify(Object.fromEntries(["dataset", "rows", "target_column", "cache_file", "cache_sha256",
      "retrieved_utc"].map((k) => [k, info[k]])), null, 2));
  }
}

main().catch((exc) => {
  console.error(String(exc?.message || exc));
  process.exit(1);
});
