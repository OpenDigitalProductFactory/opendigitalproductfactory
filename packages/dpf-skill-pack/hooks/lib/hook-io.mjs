// packages/dpf-skill-pack/hooks/lib/hook-io.mjs
//
// Cross-surface PreToolUse hook I/O normalization (BI-883FC2FC / BI-3157516C).
//
// The plane-1 guards ship to Claude, Codex, and Grok. Those harnesses send the
// PreToolUse event and honor a deny — but with DIFFERENT envelopes, verified by
// live probe (BI-883FC2FC, Grok 0.2.87 / Codex 0.142.x):
//
//   Claude / Codex : snake_case   { tool_name, tool_input: { command } }
//                    deny via      { hookSpecificOutput: { permissionDecision: "deny", ... } }
//   Grok           : camelCase     { toolName: "Shell", toolInput: { command } }
//                    deny via      { decision: "deny", reason }   (stdout, honored regardless of exit code)
//
// A guard written against only Claude's envelope reads `undefined` on Grok and
// emits a verdict Grok ignores → silent fail-open. This module normalizes the
// INPUT (read either casing) and emits BOTH deny/context envelopes on OUTPUT, so
// one guard body enforces identically on every surface. Fails OPEN on any error.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";

// Shell-tool identities across surfaces. Claude: "Bash"; Codex maps its shell to
// the "Bash" matcher; Grok headless reports "Shell", TUI/docs alias
// "run_terminal_command"/"run_terminal_cmd". Match the union.
export const SHELL_TOOL_NAMES = new Set([
  "Bash",
  "Shell",
  "run_terminal_command",
  "run_terminal_cmd",
]);

// Operator-decision tool across surfaces. Claude: "AskUserQuestion"; Grok: "AskQuestion".
export const DECISION_TOOL_NAMES = new Set(["AskUserQuestion", "AskQuestion"]);

export function isShellTool(name) {
  return typeof name === "string" && SHELL_TOOL_NAMES.has(name);
}

export function isDecisionTool(name) {
  return typeof name === "string" && DECISION_TOOL_NAMES.has(name);
}

// ── DPF-workspace scoping ────────────────────────────────────────────────────
// Grok's only always-trusted hook plane is GLOBAL (`~/.grok/hooks/`), so the
// installer wires these DPF-specific guards there (BI-883FC2FC, kernel ledger
// DI-C17A5861CE0E: opt_global_context_gated). To avoid firing DPF-branded denials
// in unrelated repos, every guard first confirms the session is operating inside
// a DPF checkout. `packages/dpf-skill-pack/` up the tree is the DPF-specific
// signal (present in the monorepo and every worktree). Env `DPF_GUARDS_WORKSPACE_ANY=1`
// disables scoping (enforce everywhere) for tests/probes.

/** @param {string|undefined} startDir @returns {boolean} */
export function inDpfWorkspace(startDir) {
  if (process.env.DPF_GUARDS_WORKSPACE_ANY === "1") return true;
  let dir = startDir && typeof startDir === "string" ? startDir : process.cwd();
  const root = parse(dir).root;
  for (let i = 0; i < 64; i++) {
    if (existsSync(join(dir, "packages", "dpf-skill-pack"))) return true;
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return false;
}

/**
 * Normalize a raw PreToolUse payload to a surface-agnostic shape.
 * @param {any} raw
 * @returns {{ toolName: string|undefined, toolInput: Record<string, any>, cwd: string|undefined }}
 */
export function normalizePayload(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const toolName = p.toolName ?? p.tool_name;
  const toolInput = p.toolInput ?? p.tool_input ?? {};
  // Both surfaces send the working dir at top level (Claude: cwd; Grok: cwd + workspaceRoot).
  const cwd = p.cwd ?? p.workspaceRoot;
  return {
    toolName,
    toolInput: toolInput && typeof toolInput === "object" ? toolInput : {},
    cwd,
  };
}

/**
 * Shell command text from a normalized or raw toolInput.
 * Surfaces use `command` (Claude/Grok); some agents also send `cmd`/`script`.
 * Without this union, lease/root-clone guards fail open on non-`command` fields.
 * @param {Record<string, any>|undefined|null} toolInput
 * @returns {string}
 */
export function shellCommandFromInput(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  const raw = toolInput.command ?? toolInput.cmd ?? toolInput.script ?? "";
  return typeof raw === "string" ? raw : "";
}

/**
 * Read + parse the PreToolUse payload from stdin (fd 0), normalized. Returns null
 * on any read/parse error so callers can fail open.
 * @returns {{ toolName: string|undefined, toolInput: Record<string, any> }|null}
 */
export function readHookPayload() {
  let raw;
  try {
    const text = readFileSync(0, "utf8");
    raw = text ? JSON.parse(text) : {};
  } catch {
    return null; // fail open
  }
  return normalizePayload(raw);
}

/**
 * Serialize a deny verdict in BOTH the Claude and Grok envelopes. Claude reads
 * `hookSpecificOutput.permissionDecision`; Grok reads top-level `decision`. Each
 * ignores the other's extra keys, so one payload denies on every surface.
 * @param {string} reason
 */
export function denyEnvelope(reason) {
  return {
    // Grok-native
    decision: "deny",
    reason,
    // Claude/Codex-native
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/** Write the dual-envelope deny to stdout and exit 0 (deny honored via stdout on both surfaces). */
export function emitDeny(reason) {
  process.stdout.write(JSON.stringify(denyEnvelope(reason)));
  process.exit(0);
}

/**
 * Non-blocking advisory context (Claude `additionalContext`). Grok PreToolUse has
 * no non-blocking channel, so it simply ignores this — a warn stays a warn.
 * @param {string} context
 */
export function contextEnvelope(context) {
  return { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: context } };
}

export function emitContext(context) {
  process.stdout.write(JSON.stringify(contextEnvelope(context)));
  process.exit(0);
}
