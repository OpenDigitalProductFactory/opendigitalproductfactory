// packages/dpf-skill-pack/hooks/governance-freshness-check.test.mjs
//
// Unit tests for the SessionStart governance-freshness self-check
// (BI-3260D977 lineage). Covers the pure staleness verdict, the idempotent
// settings.local.json fallback writer, and the warning text — plus the
// end-to-end shape the SessionStart hook emits.

import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  preToolUseGuardScripts,
  assess,
  ensureFallbackWiring,
  buildWarning,
} from "./governance-freshness-check.mjs";

const MAIN_WITH_GUARDS = {
  hooks: {
    PreToolUse: [
      {
        matcher: "Bash",
        hooks: [
          { type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/packages/dpf-skill-pack/hooks/lease-punt-guard.mjs"' },
        ],
      },
      {
        matcher: "AskUserQuestion",
        hooks: [
          { type: "command", command: 'node "${CLAUDE_PROJECT_DIR}/packages/dpf-skill-pack/hooks/decision-routing-guard.mjs"' },
        ],
      },
    ],
  },
};

// A stale branch: no PreToolUse block at all (the observed feat/* branch state).
const STALE_LOCAL = { permissions: { allow: [] }, hooks: { PostToolUse: [] } };

test("preToolUseGuardScripts finds both governance guards on main wiring", () => {
  const found = preToolUseGuardScripts(MAIN_WITH_GUARDS);
  assert.ok(found.has("decision-routing-guard.mjs"));
  assert.ok(found.has("lease-punt-guard.mjs"));
});

test("preToolUseGuardScripts returns empty set when there is no PreToolUse block", () => {
  assert.equal(preToolUseGuardScripts(STALE_LOCAL).size, 0);
  assert.equal(preToolUseGuardScripts({}).size, 0);
  assert.equal(preToolUseGuardScripts(null).size, 0);
});

test("assess: STALE when main wires a guard the local checkout lacks", () => {
  const v = assess({ localSettings: STALE_LOCAL, mainSettings: MAIN_WITH_GUARDS });
  assert.equal(v.stale, true);
  const scripts = v.missing.map((m) => m.script).sort();
  assert.deepEqual(scripts, ["decision-routing-guard.mjs", "lease-punt-guard.mjs"]);
  // decision-routing-guard must be flagged on the AskUserQuestion matcher
  const dr = v.missing.find((m) => m.script === "decision-routing-guard.mjs");
  assert.equal(dr.matcher, "AskUserQuestion");
});

test("assess: FRESH (quiet) when the local checkout already wires the guards", () => {
  const v = assess({ localSettings: MAIN_WITH_GUARDS, mainSettings: MAIN_WITH_GUARDS });
  assert.equal(v.stale, false);
  assert.equal(v.missing.length, 0);
});

test("assess: never false-alarms when main copy is unavailable (offline/detached)", () => {
  const v = assess({ localSettings: STALE_LOCAL, mainSettings: null });
  assert.equal(v.stale, false);
});

test("assess: not stale when local is only missing a guard main ALSO lacks", () => {
  const bareMain = { hooks: { PreToolUse: [] } };
  const v = assess({ localSettings: STALE_LOCAL, mainSettings: bareMain });
  assert.equal(v.stale, false);
});

test("ensureFallbackWiring writes settings.local.json with the AskUserQuestion matcher and is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "gov-fresh-"));
  try {
    const missing = [
      { script: "decision-routing-guard.mjs", matcher: "AskUserQuestion" },
      { script: "lease-punt-guard.mjs", matcher: "Bash" },
    ];
    const first = ensureFallbackWiring(dir, missing);
    assert.deepEqual(first.added.sort(), ["decision-routing-guard.mjs", "lease-punt-guard.mjs"]);

    const written = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    const scripts = preToolUseGuardScripts(written);
    assert.ok(scripts.has("decision-routing-guard.mjs"));
    assert.ok(scripts.has("lease-punt-guard.mjs"));
    const askEntry = written.hooks.PreToolUse.find((e) => e.matcher === "AskUserQuestion");
    assert.ok(askEntry, "decision-routing-guard must ride an AskUserQuestion matcher in the fallback");
    assert.ok(askEntry.hooks[0].command.includes("CLAUDE_PROJECT_DIR"));

    // Second run adds nothing (idempotent).
    const second = ensureFallbackWiring(dir, missing);
    assert.deepEqual(second.added, []);
    const written2 = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    assert.equal(written2.hooks.PreToolUse.length, written.hooks.PreToolUse.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureFallbackWiring MERGES into an existing settings.local.json without clobbering", () => {
  const dir = mkdtempSync(join(tmpdir(), "gov-fresh-"));
  try {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(
      join(dir, ".claude", "settings.local.json"),
      JSON.stringify({ permissions: { allow: ["Bash(ls:*)"] } }, null, 2),
    );
    ensureFallbackWiring(dir, [{ script: "decision-routing-guard.mjs", matcher: "AskUserQuestion" }]);
    const written = JSON.parse(readFileSync(join(dir, ".claude", "settings.local.json"), "utf8"));
    assert.deepEqual(written.permissions.allow, ["Bash(ls:*)"], "pre-existing keys preserved");
    assert.ok(preToolUseGuardScripts(written).has("decision-routing-guard.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("buildWarning names the missing guards, the fallback, and the kernel-first remediation", () => {
  const missing = [{ script: "decision-routing-guard.mjs", matcher: "AskUserQuestion" }];
  const w = buildWarning(missing, ["decision-routing-guard.mjs"]);
  assert.match(w, /governance-freshness/);
  assert.match(w, /decision-routing-guard\.mjs/);
  assert.match(w, /settings\.local\.json/);
  assert.match(w, /rebase/i);
  assert.match(w, /principle_decide/);
});

test("buildWarning omits the fallback sentence when nothing was written", () => {
  const w = buildWarning([{ script: "lease-punt-guard.mjs", matcher: "Bash" }], []);
  assert.doesNotMatch(w, /settings\.local\.json wiring/);
});
