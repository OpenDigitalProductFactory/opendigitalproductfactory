// scripts/hooks/settings-hooks-wired.test.mjs
//
// Conformance test (process-spine §6.1, BI-EF42607A first slice). The two
// PreToolUse "precheck" nudges only fire if they are actually WIRED in the
// repo's .claude/settings.json — the file every Claude Code session reads at
// start and that every install/worktree receives as a tracked file. Nothing
// else asserts they are present, so a hand-edit or a bad merge could silently
// drop a nudge and no one would notice until a screen/capability shipped
// undocumented again.
//
// This test reads the checked-in settings.json and fails CI if either hook is
// missing from a Write-covering PreToolUse matcher. It is the harness-level
// drift guard that makes "accommodated on install" enforced rather than
// assumed. (The HARD enforcement remains the surface-agnostic CI gates; this
// guards the SOFT interactive layer's presence.)

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(here, "..", "..", ".claude", "settings.json");

// The interactive PreToolUse nudges that must stay wired. Each is the file
// basename of its hook script; the matcher must cover file-writing tools.
const REQUIRED_PRECHECK_HOOKS = ["ux-fit-precheck.mjs", "spec-plan-doc-precheck.mjs"];
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit"];

function loadSettings() {
  const raw = readFileSync(settingsPath, "utf8");
  return JSON.parse(raw); // throws (and fails the test) if the file is malformed
}

/** All hook command strings under PreToolUse matchers that cover a write tool. */
function writeHookCommands(settings) {
  const pre = settings?.hooks?.PreToolUse ?? [];
  const commands = [];
  for (const entry of pre) {
    const matcher = String(entry?.matcher ?? "");
    const matcherTools = matcher.split("|").map((s) => s.trim());
    const coversWrite = WRITE_TOOLS.some((t) => matcherTools.includes(t));
    if (!coversWrite) continue;
    for (const h of entry?.hooks ?? []) {
      if (typeof h?.command === "string") commands.push(h.command);
    }
  }
  return commands;
}

test(".claude/settings.json is valid JSON with a PreToolUse hook block", () => {
  const settings = loadSettings();
  assert.ok(Array.isArray(settings?.hooks?.PreToolUse), "expected hooks.PreToolUse to be an array");
});

for (const hook of REQUIRED_PRECHECK_HOOKS) {
  test(`PreToolUse wires the ${hook} nudge on a write-covering matcher`, () => {
    const commands = writeHookCommands(loadSettings());
    const wired = commands.some((c) => c.includes(hook));
    assert.ok(
      wired,
      `${hook} is not wired into any PreToolUse Write|Edit|MultiEdit matcher in .claude/settings.json. ` +
        `Re-add it (see scripts/hooks/${hook}); the process-spine soft nudge depends on it.`,
    );
  });
}
