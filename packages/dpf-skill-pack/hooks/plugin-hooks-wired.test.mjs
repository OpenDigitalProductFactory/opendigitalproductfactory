// packages/dpf-skill-pack/hooks/plugin-hooks-wired.test.mjs
//
// Conformance test (BI-CA0ED781, EP-CLIENT-HOOK-PLANE). The DPF governance
// guards now ship INSIDE the dpf-platform plugin (hooks/hooks.json) rather than
// in repo .claude/settings.json, so the plugin is the one install unit for
// MCP + skills + hooks across Claude/Codex/Grok. Two invariants must hold or the
// guards silently vanish or double-fire:
//
//   1. hooks.json wires all three guards on a PreToolUse matcher, and each
//      referenced script exists on disk next to it.
//   2. (monorepo only) repo .claude/settings.json must NOT also wire these
//      three — plugin and settings hooks BOTH fire, so a duplicate double-fires
//      (lease-guard would deny twice). Skipped when settings.json is absent
//      (a standalone plugin install has no repo settings.json to collide with).
//
// Replaces the older scripts/hooks/settings-hooks-wired.test.mjs, whose premise
// (the prechecks live in settings.json) inverted when BI-CA0ED781 moved them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const GUARD_SCRIPTS = ["lease-guard.mjs", "ux-fit-precheck.mjs", "spec-plan-doc-precheck.mjs"];
const WRITE_TOOLS = ["Write", "Edit", "MultiEdit"];

function loadHooksJson() {
  return JSON.parse(readFileSync(join(here, "hooks.json"), "utf8"));
}

/** Every command string under every PreToolUse matcher (string + exec-form args). */
function preToolUseCommands(cfg) {
  const pre = cfg?.hooks?.PreToolUse ?? [];
  const commands = [];
  for (const entry of pre) {
    for (const h of entry?.hooks ?? []) {
      if (typeof h?.command === "string") commands.push(h.command);
      if (Array.isArray(h?.args)) commands.push(h.args.join(" "));
    }
  }
  return commands;
}

test("hooks.json is valid JSON with a PreToolUse block", () => {
  const cfg = loadHooksJson();
  assert.ok(Array.isArray(cfg?.hooks?.PreToolUse), "expected hooks.PreToolUse array in plugin hooks.json");
});

for (const script of GUARD_SCRIPTS) {
  test(`plugin hooks.json wires ${script} and the script exists on disk`, () => {
    const commands = preToolUseCommands(loadHooksJson());
    assert.ok(
      commands.some((c) => c.includes(script)),
      `${script} is not wired in any PreToolUse matcher of hooks/hooks.json`,
    );
    assert.ok(
      existsSync(join(here, script)),
      `${script} referenced by hooks.json is missing from packages/dpf-skill-pack/hooks/`,
    );
  });
}

test("lease-guard rides a Bash matcher; the prechecks ride a write-tool matcher", () => {
  const pre = loadHooksJson().hooks.PreToolUse;

  const bashEntry = pre.find((e) => String(e.matcher ?? "").split("|").map((s) => s.trim()).includes("Bash"));
  assert.ok(bashEntry, "expected a Bash PreToolUse matcher for lease-guard");
  assert.ok(
    (bashEntry.hooks ?? []).some((h) => JSON.stringify(h).includes("lease-guard.mjs")),
    "lease-guard.mjs must ride the Bash matcher",
  );

  const writeEntry = pre.find((e) => {
    const tools = String(e.matcher ?? "").split("|").map((s) => s.trim());
    return WRITE_TOOLS.some((t) => tools.includes(t));
  });
  assert.ok(writeEntry, "expected a Write|Edit|MultiEdit matcher for the prechecks");
  for (const s of ["ux-fit-precheck.mjs", "spec-plan-doc-precheck.mjs"]) {
    assert.ok(
      (writeEntry.hooks ?? []).some((h) => JSON.stringify(h).includes(s)),
      `${s} must ride the write-tool matcher`,
    );
  }
});

test("plugin hook commands reference the script via ${CLAUDE_PLUGIN_ROOT}, not a repo path", () => {
  const commands = preToolUseCommands(loadHooksJson());
  for (const c of commands) {
    assert.ok(
      !c.includes("CLAUDE_PROJECT_DIR"),
      `plugin hook command still references CLAUDE_PROJECT_DIR — bundled scripts must use CLAUDE_PLUGIN_ROOT: ${c}`,
    );
  }
});

test("all three surface manifests declare the hooks file (all-3-surfaces wiring stays put)", () => {
  // Each client resolves plugin-relative paths differently: Claude/Codex from the
  // plugin root (./), Grok from the .grok-plugin dir (../). BI-CA0ED781.
  const manifests = [
    [".claude-plugin", "./hooks/hooks.json"],
    [".codex-plugin", "./hooks/hooks.json"],
    [".grok-plugin", "../hooks/hooks.json"],
  ];
  for (const [dir, expected] of manifests) {
    const manifest = JSON.parse(readFileSync(join(here, "..", dir, "plugin.json"), "utf8"));
    assert.equal(
      manifest.hooks,
      expected,
      `${dir}/plugin.json must declare "hooks": "${expected}" so the guards ship on this surface`,
    );
  }
});

test("repo .claude/settings.json does NOT also wire the plugin-owned guards (anti double-fire)", () => {
  // hooks -> dpf-skill-pack -> packages -> repo root
  const settingsPath = join(here, "..", "..", "..", ".claude", "settings.json");
  if (!existsSync(settingsPath)) return; // standalone plugin install: nothing to collide with
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  const pre = settings?.hooks?.PreToolUse ?? [];
  const commands = [];
  for (const entry of pre) {
    for (const h of entry?.hooks ?? []) {
      if (typeof h?.command === "string") commands.push(h.command);
    }
  }
  for (const script of GUARD_SCRIPTS) {
    assert.ok(
      !commands.some((c) => c.includes(script)),
      `${script} is wired in BOTH the plugin and .claude/settings.json — both fire, so this double-fires. Remove it from settings.json.`,
    );
  }
});
