#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/governance-freshness-check.mjs
//
// SessionStart self-check (BI-3260D977 lineage, EP-5560770F — plane-1 guard
// hardening). Companion to the spec §9/§10 addendum,
// docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md
//
// THE HOLE THIS CLOSES. §9's fix wired the plane-1 PreToolUse guards redundantly
// into the checked-in `.claude/settings.json` so they survive the fresh-worktree
// plugin-hook-registration race. But that redundancy is itself BRANCH-VERSIONED:
// any branch cut BEFORE that wiring landed (e.g. one 88 commits behind main) has
// a `.claude/settings.json` with no PreToolUse block at all — so on such a branch
// the decision-routing-guard is silently absent, with no warning the operator or
// agent can see. Governance enforcement carried in checked-in files degrades
// invisibly with branch age.
//
// This check lives in the dpf-platform PLUGIN plane, which loads from the
// per-machine plugin cache (~/.claude/plugins/cache/.../<version>) — NOT from the
// working tree — so it is present regardless of how stale the checked-out branch
// is. On SessionStart it compares the working tree's governance-critical hook
// wiring against origin/main and, when the branch is behind:
//
//   (1) WARN — emits a loud SessionStart advisory into session context naming the
//       absent guard(s) + the remediation (rebase onto origin/main).
//   (2) ACTIVATE FALLBACK — writes the missing PreToolUse guard wiring into the
//       gitignored, worktree-local `.claude/settings.local.json` (merged,
//       idempotent), so enforcement is restored on the settings plane for every
//       subsequent session in this worktree even though the branch itself predates
//       the checked-in wiring. This re-asserts decision-routing enforcement for
//       AskUserQuestion specifically without blocking any non-decision tool.
//
// The warn-plus-activate-fallback shape (vs warn-only or a blanket hard-gate) is
// the founder kernel's own high-confidence recommendation for this choice
// (principle_decide 2026-07-06, DI-C805C5C50A47: warn_plus_activate_fallback
// composite 7.92, margin 0.38, high confidence, no commandment conflict; vs
// hard_gate_all 7.54, warn_only 6.28).
//
// Contract mirrors reconcile-claude-plugin.sh: exit 0 ALWAYS, never block session
// start; print/emit only on real drift; fail OPEN (silent) on any parse/IO/git
// error — a self-check must never wedge a session or raise a false alarm on a
// detached/offline/no-upstream checkout it cannot evaluate.
//
// Surface note: shipped in the shared hooks/hooks.json, so it travels to every
// surface manifest (.claude-plugin / .codex-plugin / .grok-plugin). Surfaces that
// do not honor SessionStart simply ignore it (the hook no-ops). In-portal
// coworkers / Build Studio run server-side against origin/main and are
// structurally always-fresh, so they need no client-session freshness check.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";

/** Read a file's text, or null if it does not exist. Reads directly (no
 * exists-then-read) so there is no time-of-check/time-of-use race. Any error
 * other than "not found" propagates to the caller's guard. */
function readFileOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return null;
    throw e;
  }
}

// Governance-critical guards whose absence degrades decision/runtime discipline,
// paired with the PreToolUse matcher each must ride. These are the two gates the
// harness-enforced spec names (AGENTS.md §264); keep this list to the guards
// whose silent absence actually loses governance, not every precheck.
const GOVERNANCE_GUARDS = [
  { script: "decision-routing-guard.mjs", matcher: "AskUserQuestion" },
  { script: "lease-punt-guard.mjs", matcher: "Bash" },
];

/**
 * Collect the set of guard-script basenames wired under any PreToolUse matcher of
 * a parsed settings/hooks object. Tolerant of a missing hooks block.
 * @param {any} settingsObj
 * @returns {Set<string>}
 */
export function preToolUseGuardScripts(settingsObj) {
  const found = new Set();
  const pre = settingsObj?.hooks?.PreToolUse;
  if (!Array.isArray(pre)) return found;
  for (const entry of pre) {
    for (const h of entry?.hooks ?? []) {
      const parts = [];
      if (typeof h?.command === "string") parts.push(h.command);
      if (Array.isArray(h?.args)) parts.push(h.args.join(" "));
      const cmd = parts.join(" ");
      for (const g of GOVERNANCE_GUARDS) {
        if (cmd.includes(g.script)) found.add(g.script);
      }
    }
  }
  return found;
}

/**
 * Pure staleness verdict. STALE = origin/main wires a governance guard that the
 * working tree's checked-in settings.json does NOT. Only guards present on main
 * but absent locally are flagged — so a fresh branch (local wires them) is quiet,
 * and an environment we cannot compare (no main copy) never false-alarms.
 * @param {{ localSettings: any, mainSettings: any|null }} args
 * @returns {{ stale: boolean, missing: Array<{script:string,matcher:string}> }}
 */
export function assess({ localSettings, mainSettings }) {
  if (!mainSettings) return { stale: false, missing: [] }; // cannot compare → fail open
  const localGuards = preToolUseGuardScripts(localSettings);
  const mainGuards = preToolUseGuardScripts(mainSettings);
  const missing = GOVERNANCE_GUARDS.filter(
    (g) => mainGuards.has(g.script) && !localGuards.has(g.script),
  );
  return { stale: missing.length > 0, missing };
}

/**
 * Merge the missing guard wiring into `<baseDir>/.claude/settings.local.json`
 * (gitignored, worktree-local). Idempotent: a guard already referenced anywhere
 * in settings.local.json's PreToolUse is left alone. Returns the list actually
 * added. Never throws — a failed self-heal must not break the warning path.
 * @param {string} baseDir  repo root
 * @param {Array<{script:string,matcher:string}>} missing
 * @returns {{ added: string[], path: string }}
 */
export function ensureFallbackWiring(baseDir, missing) {
  const path = join(baseDir, ".claude", "settings.local.json");
  const added = [];
  try {
    let settings = {};
    const raw = readFileOrNull(path);
    if (raw && raw.trim()) settings = JSON.parse(raw);
    if (!settings.hooks || typeof settings.hooks !== "object") settings.hooks = {};
    if (!Array.isArray(settings.hooks.PreToolUse)) settings.hooks.PreToolUse = [];
    const already = preToolUseGuardScripts(settings);
    for (const g of missing) {
      if (already.has(g.script)) continue;
      settings.hooks.PreToolUse.push({
        matcher: g.matcher,
        hooks: [
          {
            type: "command",
            // ${CLAUDE_PROJECT_DIR} — the guard scripts live in the checkout
            // (shipped long before the settings-plane wiring did), so a stale
            // branch still resolves them; CLAUDE_PLUGIN_ROOT is not expanded
            // inside settings.local.json commands.
            command: `node "\${CLAUDE_PROJECT_DIR}/packages/dpf-skill-pack/hooks/${g.script}"`,
          },
        ],
      });
      added.push(g.script);
    }
    if (added.length > 0) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
    }
  } catch {
    // fall through — warning still emitted
  }
  return { added, path };
}

/** origin/main's copy of a repo-relative file, via local refs (no network). */
function gitShowMain(baseDir, relPath) {
  try {
    const r = spawnSync("git", ["-C", baseDir, "show", `origin/main:${relPath}`], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout;
  } catch {
    return null;
  }
}

export function buildWarning(missing, added) {
  const names = missing.map((g) => g.script).join(", ");
  const restored = added.length
    ? `A local fallback was written to .claude/settings.local.json wiring ${added.join(", ")} — enforcement is restored on this worktree from your NEXT session. `
    : "";
  return (
    `[governance-freshness] This branch is BEHIND origin/main on harness-enforced governance wiring: ` +
    `${names} ${missing.length === 1 ? "is" : "are"} wired on origin/main's .claude/settings.json but ABSENT from this checkout. ` +
    `On this branch the decision-routing gate (AGENTS.md §264) is not enforced by the checked-in settings plane, and the plugin plane can race install in a fresh worktree — so a work-scope/altitude decision could reach the operator with no principle_decide ledger. ` +
    `${restored}` +
    `Remediation: rebase this branch onto origin/main to pick up the committed guard wiring. ` +
    `Until then, treat every work-scope/altitude/approach decision as guard-off: route it through dpf-decision-via-kernel -> principle_decide FIRST and act on the ledger; do not put a decision menu to the operator without one.`
  );
}

function main() {
  // SessionStart payloads carry no tool_input we need; run unconditionally.
  const baseDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let localSettings = {};
  try {
    const raw = readFileOrNull(join(baseDir, ".claude", "settings.json"));
    if (raw && raw.trim()) localSettings = JSON.parse(raw);
  } catch {
    process.exit(0); // fail open
  }

  const mainRaw = gitShowMain(baseDir, ".claude/settings.json");
  let mainSettings = null;
  if (mainRaw) {
    try {
      mainSettings = JSON.parse(mainRaw);
    } catch {
      mainSettings = null;
    }
  }

  const { stale, missing } = assess({ localSettings, mainSettings });
  if (!stale) process.exit(0); // fresh (or uncomparable) → silent, no output

  const { added } = ensureFallbackWiring(baseDir, missing);
  const warning = buildWarning(missing, added);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: warning,
      },
    }),
  );
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("governance-freshness-check.mjs")) {
  main();
}
