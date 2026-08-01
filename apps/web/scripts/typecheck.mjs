import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const tscBin = require.resolve("typescript/bin/tsc");
const maxOldSpaceSizeMb =
  process.env.DPF_WEB_TYPECHECK_MAX_OLD_SPACE_SIZE_MB ||
  process.env.DPF_NEXT_BUILD_MAX_OLD_SPACE_SIZE_MB ||
  "16384";

function run(args) {
  const result = spawnSync(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? (result.signal ? 1 : 0));
  }
}

run([nextBin, "typegen"]);
run([`--max-old-space-size=${maxOldSpaceSizeMb}`, tscBin, "--noEmit"]);
