/**
 * Speed-counter admission run (BI-BDB43823).
 *
 * Runs the UX route sweep twice against ONE served build, then decides each
 * candidate counter with admitCounters():
 *   1. repeatable: identical on every route in both passes;
 *   2. tracks wall-clock time: Spearman rho >= 0.5 against the sweep's own
 *      navigationAndSettleMs (median of the two passes).
 * Writes apps/web/lib/ux-budget/speed-counter-admission.json. Only counters
 * marked "admitted" there are ever gated (speed-counter-ratchet.ts).
 *
 * Usage (against a running portal, same flags as ux:sweep):
 *   pnpm --filter web exec tsx scripts/ux-speed-counter-admission.ts --base-url http://localhost:3000 [--routes a,b] [--workers 1]
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

import { admitCounters, MIN_RHO, type PassSample } from "../lib/ux-budget/speed-counter-admission";
import type { SpeedCounters } from "../lib/ux-budget/speed-counters";

const WEB = resolve(process.cwd()); // pnpm --filter web runs scripts from apps/web
const EXECUTION = join(WEB, "test-results/ux-route-sweep/route-sweep-execution.json");
const ADMISSION = join(WEB, "lib/ux-budget/speed-counter-admission.json");

type ExecutionRoute = {
  routePath: string;
  status: string;
  phases?: { navigationAndSettleMs: number };
  speedCounters?: SpeedCounters;
};

const TSX_CLI = createRequire(join(WEB, "package.json")).resolve("tsx/cli");

function runPass(label: string, args: string[]): PassSample[] {
  // A pass that writes no fresh execution record must fail loudly. Reusing the
  // previous pass's file would compare a pass with itself and call every
  // counter "repeatable" (observed on the first full run: pass B exited 1
  // without measuring, and A was scored against A).
  rmSync(EXECUTION, { force: true });
  const startedAt = Date.now();
  // The sweep exits non-zero on a ratchet regression; admission only needs its
  // per-route execution record, so the exit code is reported, not fatal.
  const run = spawnSync(process.execPath, [TSX_CLI, "scripts/ux-route-sweep.ts", ...args], {
    cwd: WEB,
    stdio: "inherit",
  });
  console.error(`[speed-admission] pass ${label} finished with exit ${run.status}`);
  if (!existsSync(EXECUTION) || statSync(EXECUTION).mtimeMs < startedAt) {
    throw new Error(`pass ${label} wrote no fresh execution record (exit ${run.status}); admission refuses to score stale data`);
  }
  copyFileSync(EXECUTION, EXECUTION.replace(/\.json$/, `.pass-${label}.json`));
  const execution = JSON.parse(readFileSync(EXECUTION, "utf8")) as { routes: ExecutionRoute[] };
  return execution.routes
    .filter((r) => r.status === "measured" && r.speedCounters && r.phases)
    .map((r) => ({
      routePath: r.routePath,
      counters: r.speedCounters as SpeedCounters,
      navigationAndSettleMs: (r.phases as { navigationAndSettleMs: number }).navigationAndSettleMs,
    }));
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const a = runPass("a", args);
  const b = runPass("b", args);
  const counters = admitCounters(a, b);
  const file = {
    generator: "apps/web/scripts/ux-speed-counter-admission.ts",
    note: "Two passes of the UX route sweep against one served build. Only 'admitted' counters gate PRs.",
    minRho: MIN_RHO,
    measuredAt: new Date().toISOString(),
    routesPassA: a.length,
    routesPassB: b.length,
    counters,
  };
  writeFileSync(ADMISSION, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  for (const c of counters) console.error(`[speed-admission] ${c.counter}: ${c.status} — ${c.reason}`);
}

main();
