// scripts/check-setup-worktree-hygiene.test.mjs
//
// BI-5F4F0146 — the worktree janitor and its scheduler already existed
// (BI-AD949172, BI-E5C1ED0A) but were never invoked by the install, so worktree
// sprawl kept accumulating and thrashing the OS file indexer (Spotlight on macOS,
// Search + Defender on Windows). This locks the wiring into both setup surfaces so
// it cannot silently regress: a scheduler that exists but is never called is not a
// fix.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const setupSh = readFileSync(join(repoRoot, "scripts/setup.sh"), "utf8");
const setupPs1 = readFileSync(join(repoRoot, "scripts/setup.ps1"), "utf8");

test("setup.sh registers the worktree janitor schedule (live, tier-a-only)", () => {
  assert.match(
    setupSh,
    /install-worktree-janitor-schedule\.sh"?\s+--live\s+--tier-a-only/,
    "setup.sh must call install-worktree-janitor-schedule.sh --live --tier-a-only",
  );
});

test("setup.sh keeps the worktree base out of Spotlight on macOS", () => {
  assert.match(setupSh, /Darwin/, "setup.sh must guard the Spotlight step to macOS");
  assert.match(
    setupSh,
    /\.metadata_never_index/,
    "setup.sh must place a Spotlight no-index hint at the worktree base",
  );
});

test("setup.ps1 registers the worktree janitor as a scheduled task", () => {
  assert.match(
    setupPs1,
    /Register-ScheduledTask/,
    "setup.ps1 must register the worktree janitor scheduled task",
  );
  assert.match(
    setupPs1,
    /worktree-janitor\.mjs/,
    "the Windows scheduled task must invoke worktree-janitor.mjs",
  );
  assert.match(
    setupPs1,
    /--live[\s\S]*--tier-a-only/,
    "the Windows janitor task must run in live tier-a-only mode",
  );
});

test("setup.ps1 excludes the worktree base from Defender", () => {
  assert.match(
    setupPs1,
    /Add-MpPreference\s+-ExclusionPath/,
    "setup.ps1 must exclude the worktree base from Defender real-time scanning",
  );
});

test("both hygiene steps are best-effort (never fail setup)", () => {
  // bash: the schedule call is guarded by an if/else that only warns on failure.
  assert.match(setupSh, /Could not schedule the worktree janitor \(non-fatal\)/);
  // powershell: each step is wrapped in try/catch that only warns.
  assert.match(setupPs1, /Could not register the worktree janitor task \(non-fatal\)/);
});
