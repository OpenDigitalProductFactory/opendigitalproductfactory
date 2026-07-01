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

const GUARD_SCRIPTS = [
  "lease-guard.mjs",
  "root-clone-guard.mjs",
  "compose-guard.mjs",
  "ux-fit-precheck.mjs",
  "spec-plan-doc-precheck.mjs",
  "tool-economy-precheck.mjs",
];
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

test("hooks.json wires the WorktreeCreate hook and worktree-create.mjs exists (BI-6B02FEE5)", () => {
  const cfg = loadHooksJson();
  const wt = cfg?.hooks?.WorktreeCreate ?? [];
  assert.ok(Array.isArray(wt) && wt.length > 0, "expected a WorktreeCreate event in plugin hooks.json");
  const cmds = [];
  for (const entry of wt) for (const h of entry?.hooks ?? []) if (typeof h?.command === "string") cmds.push(h.command);
  assert.ok(cmds.some((c) => c.includes("worktree-create.mjs")), "WorktreeCreate must run worktree-create.mjs");
  assert.ok(
    cmds.every((c) => !c.includes("CLAUDE_PROJECT_DIR")),
    "WorktreeCreate command must reference the script via ${CLAUDE_PLUGIN_ROOT}, not a repo path",
  );
  assert.ok(
    existsSync(join(here, "worktree-create.mjs")),
    "worktree-create.mjs referenced by hooks.json is missing from packages/dpf-skill-pack/hooks/",
  );
});

test("repo .claude/settings.json does NOT also define WorktreeCreate (anti double-create)", () => {
  const settingsPath = join(here, "..", "..", "..", ".claude", "settings.json");
  if (!existsSync(settingsPath)) return; // standalone plugin install
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.ok(
    !Array.isArray(settings?.hooks?.WorktreeCreate),
    "WorktreeCreate is defined in BOTH the plugin and .claude/settings.json — both fire, creating two worktrees. Keep it only in the plugin.",
  );
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

test("lease-guard + root-clone-guard ride a Bash matcher; the prechecks ride a write-tool matcher", () => {
  const pre = loadHooksJson().hooks.PreToolUse;

  const bashEntry = pre.find((e) => String(e.matcher ?? "").split("|").map((s) => s.trim()).includes("Bash"));
  assert.ok(bashEntry, "expected a Bash PreToolUse matcher for the Bash guards");
  for (const guard of ["lease-guard.mjs", "root-clone-guard.mjs", "compose-guard.mjs"]) {
    assert.ok(
      (bashEntry.hooks ?? []).some((h) => JSON.stringify(h).includes(guard)),
      `${guard} must ride the Bash matcher`,
    );
  }

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

test("surface manifests wire the hooks file so guards ship on every surface", () => {
  // Codex and Grok resolve the hooks manifest from an explicit plugin.json key
  // (Grok from the .grok-plugin dir, hence ../). Claude Code 2.1.197+ AUTO-LOADS
  // hooks/hooks.json by convention, and an explicit "hooks" key now raises
  // "Duplicate hooks file detected" — failing the WHOLE plugin load — so the
  // .claude-plugin manifest must NOT declare it (#2544). The guards still ship on
  // Claude via the auto-loaded file, asserted present below. BI-CA0ED781.
  const declaring = [
    [".codex-plugin", "./hooks/hooks.json"],
    [".grok-plugin", "../hooks/hooks.json"],
  ];
  for (const [dir, expected] of declaring) {
    const manifest = JSON.parse(readFileSync(join(here, "..", dir, "plugin.json"), "utf8"));
    assert.equal(
      manifest.hooks,
      expected,
      `${dir}/plugin.json must declare "hooks": "${expected}" so the guards ship on this surface`,
    );
  }

  // Claude: no explicit key (avoids the duplicate-hooks load failure), but the
  // auto-loaded manifest must exist next to the plugin so the guards still ship.
  const claudeManifest = JSON.parse(
    readFileSync(join(here, "..", ".claude-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(
    claudeManifest.hooks,
    undefined,
    '.claude-plugin/plugin.json must NOT declare "hooks" — Claude Code auto-loads hooks/hooks.json and an explicit key triggers a duplicate-hooks load failure (#2544)',
  );
  assert.ok(
    existsSync(join(here, "hooks.json")),
    "hooks/hooks.json must exist so Claude auto-loads the guards",
  );
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
