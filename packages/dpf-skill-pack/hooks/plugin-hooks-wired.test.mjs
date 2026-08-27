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
  "lease-punt-guard.mjs",
  "pregate-evidence-guard.mjs",
  "pregate-invocation-guard.mjs",
  "decision-routing-guard.mjs",
  "plan-backlog-coverage-guard.mjs",
  "ux-fit-precheck.mjs",
  "spec-plan-doc-precheck.mjs",
  "design-grounding-precheck.mjs",
  "tool-economy-precheck.mjs",
  // BI-0B292D84: AGENTS.md 12 requires a Workroom claim before work on every
  // surface. This list is HAND-ENUMERATED, so a guard absent from it passes the
  // both-planes parity check vacuously - the same enumeration trap as the CI
  // test inventory. A new guard must be added here or it is only half-wired.
  "workroom-claim-guard.mjs",
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

test("hooks.json wires uncommitted-work guard on SessionEnd and Stop (BI-38578194)", () => {
  const cfg = loadHooksJson();
  for (const event of ["SessionEnd", "Stop"]) {
    const groups = cfg?.hooks?.[event] ?? [];
    assert.ok(Array.isArray(groups) && groups.length > 0, `expected ${event} in plugin hooks.json`);
    const cmds = [];
    for (const entry of groups) {
      for (const h of entry?.hooks ?? []) {
        if (typeof h?.command === "string") cmds.push(h.command);
      }
    }
    assert.ok(
      cmds.some((c) => c.includes("uncommitted-work-guard.mjs")),
      `${event} must run uncommitted-work-guard.mjs`,
    );
    assert.ok(
      cmds.filter((c) => c.includes("uncommitted-work-guard.mjs")).every((c) => c.includes("CLAUDE_PLUGIN_ROOT")),
      `${event} uncommitted-work guard must load from \${CLAUDE_PLUGIN_ROOT}`,
    );
  }
  assert.ok(
    existsSync(join(here, "uncommitted-work-guard.mjs")),
    "uncommitted-work-guard.mjs referenced by hooks.json is missing",
  );
});

test("hooks.json wires the SessionStart governance-freshness self-check via CLAUDE_PLUGIN_ROOT (BI-3260D977)", () => {
  const cfg = loadHooksJson();
  const ss = cfg?.hooks?.SessionStart ?? [];
  assert.ok(Array.isArray(ss) && ss.length > 0, "expected a SessionStart event in plugin hooks.json");
  const cmds = [];
  for (const entry of ss) for (const h of entry?.hooks ?? []) if (typeof h?.command === "string") cmds.push(h.command);
  assert.ok(
    cmds.some((c) => c.includes("governance-freshness-check.mjs")),
    "SessionStart must run governance-freshness-check.mjs so the guard is present branch-independently",
  );
  assert.ok(
    cmds.filter((c) => c.includes("governance-freshness-check.mjs")).every((c) => c.includes("CLAUDE_PLUGIN_ROOT")),
    "the SessionStart check must load from ${CLAUDE_PLUGIN_ROOT} (the branch-independent plugin cache), not a repo path",
  );
  assert.ok(
    existsSync(join(here, "governance-freshness-check.mjs")),
    "governance-freshness-check.mjs referenced by hooks.json is missing from packages/dpf-skill-pack/hooks/",
  );
});

test("hooks.json wires the SessionStart process-spine health check via CLAUDE_PLUGIN_ROOT", () => {
  const cfg = loadHooksJson();
  const ss = cfg?.hooks?.SessionStart ?? [];
  assert.ok(Array.isArray(ss) && ss.length > 0, "expected a SessionStart event in plugin hooks.json");
  const cmds = [];
  for (const entry of ss) for (const h of entry?.hooks ?? []) if (typeof h?.command === "string") cmds.push(h.command);
  assert.ok(
    cmds.some((c) => c.includes("process-spine-health-check.mjs")),
    "SessionStart must run process-spine-health-check.mjs so DPF replacement skill exposure drift is visible",
  );
  assert.ok(
    cmds.filter((c) => c.includes("process-spine-health-check.mjs")).every((c) => c.includes("CLAUDE_PLUGIN_ROOT")),
    "the process-spine SessionStart check must load from ${CLAUDE_PLUGIN_ROOT}, not a repo path",
  );
  assert.ok(
    existsSync(join(here, "process-spine-health-check.mjs")),
    "process-spine-health-check.mjs referenced by hooks.json is missing from packages/dpf-skill-pack/hooks/",
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
  for (const guard of ["lease-guard.mjs", "root-clone-guard.mjs", "compose-guard.mjs", "lease-punt-guard.mjs"]) {
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
  assert.ok(
    (writeEntry.hooks ?? []).some((h) => JSON.stringify(h).includes("root-clone-guard.mjs")),
    "root-clone-guard.mjs must ride the write-tool matcher so an aliased cwd cannot redirect edits into main",
  );
  for (const s of ["plan-backlog-coverage-guard.mjs", "ux-fit-precheck.mjs", "spec-plan-doc-precheck.mjs", "design-grounding-precheck.mjs"]) {
    assert.ok(
      (writeEntry.hooks ?? []).some((h) => JSON.stringify(h).includes(s)),
      `${s} must ride the write-tool matcher`,
    );
  }
});

test("decision-routing-guard rides an AskUserQuestion matcher (Gate A, BI-383668B9)", () => {
  const pre = loadHooksJson().hooks.PreToolUse;
  const askEntry = pre.find((e) =>
    String(e.matcher ?? "").split("|").map((s) => s.trim()).includes("AskUserQuestion"),
  );
  assert.ok(askEntry, "expected an AskUserQuestion PreToolUse matcher for the decision-routing guard");
  assert.ok(
    (askEntry.hooks ?? []).some((h) => JSON.stringify(h).includes("decision-routing-guard.mjs")),
    "decision-routing-guard.mjs must ride the AskUserQuestion matcher",
  );
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
  // Grok resolves the hooks manifest from an explicit plugin.json key.
  // It resolves component paths from the PLUGIN ROOT (the dir CONTAINING the
  // .<surface>-plugin/ folder), so the key must be "./hooks/hooks.json". The
  // .grok-plugin manifest previously used "../hooks/hooks.json" on the wrong
  // assumption that it resolves from the .grok-plugin dir; live probing (BI-883FC2FC)
  // showed Grok then loaded ZERO components and every guard was silently absent.
  // Claude Code 2.1.197+ AUTO-LOADS hooks/hooks.json by convention, and an explicit
  // "hooks" key now raises "Duplicate hooks file detected" — failing the WHOLE
  // plugin load — so the .claude-plugin manifest must NOT declare it (#2544). The
  // guards still ship on Claude via the auto-loaded file, asserted present below.
  // BI-CA0ED781 / BI-883FC2FC. See also surface-manifest-paths.test.mjs.
  const declaring = [
    [".grok-plugin", "./hooks/hooks.json"],
    [".antigravity-plugin", "./hooks/hooks.json"],
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

  // Codex's current plugin manifest schema rejects an explicit hooks field.
  // The dependency-free updater installs the same guards through
  // ~/.codex/hooks.json, which is covered by update_agent_toolchain_test.py.
  const codexManifest = JSON.parse(
    readFileSync(join(here, "..", ".codex-plugin", "plugin.json"), "utf8"),
  );
  assert.equal(
    codexManifest.hooks,
    undefined,
    '.codex-plugin/plugin.json must not declare unsupported "hooks"; the updater owns Codex hook wiring',
  );
});

test("repo .claude/settings.json ALSO wires every PreToolUse guard (belt-and-braces vs the plugin-install/hook-registration race)", () => {
  // Deliberate INVERSION of the former anti-duplication assertion. Evidence
  // (2026-07-06, session e07d5d79 / worktree stoic-fermat-b18696): plugin hooks
  // register at session init, but in the FIRST session of a freshly created
  // auto-worktree the dpf-platform plugin install for the new projectPath
  // completes during session bootstrap AFTER hook registration — skills resolve
  // dynamically so the plugin looks present, while every plane-1 guard silently
  // fails OPEN (a lease-punt-deniable Bash command and a decision-routing-
  // deniable AskUserQuestion both passed unimpeded). Project-plane settings.json
  // hooks load from the checkout at session start and are immune to that race
  // (the transcript-snapshot hook fired in the same failing session).
  //
  // So the PreToolUse guards are wired on BOTH planes. Double-fire when both
  // planes are live is benign for these guards: a deny is idempotent (two denies
  // block the same call once) and a warn only repeats additionalContext. The
  // WorktreeCreate hook is NOT idempotent and must stay plugin-only (asserted
  // separately above). Kernel-ratified: principle_decide 2026-07-06,
  // settings_json_redundant_wiring composite 8.52, margin 1.59, high confidence.
  //
  // hooks -> dpf-skill-pack -> packages -> repo root
  const settingsPath = join(here, "..", "..", "..", ".claude", "settings.json");
  if (!existsSync(settingsPath)) return; // standalone plugin install: no repo settings.json
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
      commands.some((c) => c.includes(script)),
      `${script} is missing from .claude/settings.json PreToolUse — the settings plane is the race-immune fallback for fresh-worktree first sessions (see test comment); wire it alongside the plugin plane.`,
    );
  }
  for (const c of commands) {
    assert.ok(
      !c.includes("CLAUDE_PLUGIN_ROOT"),
      `settings.json hook command must reference the checked-in script via \${CLAUDE_PROJECT_DIR}, not \${CLAUDE_PLUGIN_ROOT} (which only resolves for plugin-plane hooks): ${c}`,
    );
  }

  // Same matcher shape as the plugin plane: decision-routing on AskUserQuestion,
  // Bash guards on Bash — a guard wired under the wrong matcher never fires.
  const matcherOf = (script) =>
    pre.find((e) => (e?.hooks ?? []).some((h) => String(h?.command ?? "").includes(script)))?.matcher ?? "";
  assert.ok(
    String(matcherOf("decision-routing-guard.mjs")).split("|").map((s) => s.trim()).includes("AskUserQuestion"),
    "settings.json must wire decision-routing-guard.mjs on an AskUserQuestion matcher",
  );
  for (const guard of ["lease-guard.mjs", "root-clone-guard.mjs", "compose-guard.mjs", "lease-punt-guard.mjs"]) {
    assert.ok(
      String(matcherOf(guard)).split("|").map((s) => s.trim()).includes("Bash"),
      `settings.json must wire ${guard} on a Bash matcher`,
    );
  }
});
