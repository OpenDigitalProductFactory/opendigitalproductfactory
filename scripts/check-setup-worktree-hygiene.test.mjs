// scripts/check-setup-worktree-hygiene.test.mjs
//
// BI-5F4F0146 — worktree hygiene (reap schedule + OS-indexer exclusion) must be
// part of the platform install routine on EVERY surface, via one shared helper
// (not four copies). The janitor + scheduler existed but were never invoked, so
// sprawl accumulated and thrashed the OS file indexer (Spotlight on macOS, Search +
// Defender on Windows). This locks: the helper carries the logic, and every install
// surface — customer and full-source, macOS and Windows — calls it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(repoRoot, p), "utf8");

const helperSh = read("scripts/setup-worktree-hygiene.sh");
const helperPs1 = read("scripts/setup-worktree-hygiene.ps1");

test("the shared bash helper carries the janitor schedule + Spotlight exclusion", () => {
  assert.match(
    helperSh,
    /install-worktree-janitor-schedule\.sh"?\s+--live\s+--tier-a-only/,
    "helper must register the janitor schedule (live, tier-a-only)",
  );
  assert.match(helperSh, /Darwin/, "helper must guard the Spotlight step to macOS");
  assert.match(
    helperSh,
    /Exclusions|metadata_never_index/,
    "helper must exclude the worktree base from Spotlight (Exclusions list / no-index hint)",
  );
});

test("the shared powershell helper carries the janitor task + Defender exclusion", () => {
  assert.match(helperPs1, /Register-ScheduledTask/, "helper must register the janitor task");
  assert.match(helperPs1, /worktree-janitor\.mjs/, "the task must invoke worktree-janitor.mjs");
  assert.match(helperPs1, /--live[\s\S]*--tier-a-only/, "the task must run live tier-a-only");
  assert.match(
    helperPs1,
    /Add-MpPreference\s+-ExclusionPath/,
    "helper must exclude the worktree base from Defender",
  );
});

// Every install surface — customer AND full-source, both OSes — must call the helper.
const bashSurfaces = ["scripts/setup.sh", "install-dpf.sh"];
for (const surface of bashSurfaces) {
  test(`${surface} calls the shared hygiene helper`, () => {
    assert.match(
      read(surface),
      /setup-worktree-hygiene\.sh/,
      `${surface} must call scripts/setup-worktree-hygiene.sh`,
    );
  });
}

const ps1Surfaces = ["scripts/setup.ps1", "scripts/fresh-install.ps1"];
for (const surface of ps1Surfaces) {
  test(`${surface} calls the shared hygiene helper`, () => {
    assert.match(
      read(surface),
      /setup-worktree-hygiene\.ps1/,
      `${surface} must call scripts/setup-worktree-hygiene.ps1`,
    );
  });
}

test("helper steps are best-effort (never fail an install)", () => {
  // bash helper: guarded janitor call + `exit 0` at the end.
  assert.match(helperSh, /exit 0\s*$/, "helper.sh must end in exit 0 so it never fails the caller");
  // powershell helper: each step wrapped in try/catch that only warns.
  assert.match(helperPs1, /catch\s*\{[\s\S]*non-fatal/, "helper.ps1 steps must be try/catch best-effort");
});
