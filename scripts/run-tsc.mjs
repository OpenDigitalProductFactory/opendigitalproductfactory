#!/usr/bin/env node
// Invoke the workspace's TypeScript compiler with an enlarged V8 old-space heap
// so `tsc --noEmit` does not abort (Abort trap: 6 / OOM) on macOS under Node
// 26.x's default heap ceiling (BI-CD7706B5). This is the narrowest complete fix:
// baking it into the package `typecheck` script means the pre-commit hook, the
// pregate/local-ci-runner, and a manual `pnpm --filter web typecheck` all inherit
// it. Chosen over an inline `NODE_OPTIONS=` prefix (breaks Windows cmd.exe) and
// over `cross-env` (a new dependency): this resolves `tsc` via Node's own module
// resolution, so it is agnostic to how pnpm hoists `typescript`, and forwards any
// extra args (e.g. `--noEmit`, `-p tsconfig.scripts.json`) straight through.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// Resolve relative to the caller's cwd (the package dir) so the workspace's
// pinned TypeScript is found whether it is hoisted to the worktree root or
// linked locally.
const requireFromCwd = createRequire(pathToFileURL(`${process.cwd()}/`));
const tscEntry = requireFromCwd.resolve("typescript/bin/tsc");

const result = spawnSync(
  process.execPath,
  ["--max-old-space-size=8192", tscEntry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(`[run-tsc] failed to launch tsc: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
