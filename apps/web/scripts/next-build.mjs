import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");
const maxOldSpaceSizeMb = process.env.DPF_NEXT_BUILD_MAX_OLD_SPACE_SIZE_MB || "24576";
const result = spawnSync(
  process.execPath,
  [`--max-old-space-size=${maxOldSpaceSizeMb}`, nextBin, "build", ...process.argv.slice(2)],
  {
    env: process.env,
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? (result.signal ? 1 : 0));
