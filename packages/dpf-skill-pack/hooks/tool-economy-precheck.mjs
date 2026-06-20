#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/tool-economy-precheck.mjs
//
// PreToolUse nudge (context-engineering defense-in-depth). When a session is
// about to edit the MCP tool registry, the MCP transport route, or the agentic
// loop / result-budget module, remind it — before CI catches it — to apply the
// context-economy design criteria: keep tool DESCRIPTIONS provenance-free
// (no "Phase N", "(BI-…)", or source paths — those are a per-call token tax),
// and route any new model-facing tool RESULT through the budget guard so one
// result can't blow a small local window.
//
// The HARD enforcement is the vitest guard
// (apps/web/lib/tool-description-hygiene.test.ts) plus the runtime cap
// (apps/web/lib/tak/tool-result-budget.ts). This hook just moves the prompt
// left so the criteria are applied while the edit is being written.
//
// Non-blocking by design: emits additionalContext and ALWAYS allows. Hooks are
// guidance; CI is the gate. Fails OPEN on any error — a guard must never wedge a
// session. Ships INSIDE the dpf-platform plugin (hooks/hooks.json, matcher
// "Write|Edit|MultiEdit") so the nudge travels to every surface (Claude / Codex
// / Grok all honor the PreToolUse additionalContext protocol).

import { readFileSync } from "node:fs";

// Files that govern context/token economy. Editing any of them should re-assert
// the criteria. Matched against a repo-relative, forward-slashed path.
const GOVERNED_RE =
  /(?:apps\/web\/lib\/mcp-tools\.ts|apps\/web\/app\/api\/mcp\/v1\/route\.ts|apps\/web\/lib\/tak\/agentic-loop\.ts|apps\/web\/lib\/tak\/tool-result-budget\.ts)$/;

const GUIDANCE =
  "[tool-economy] You are editing a context/token-economy surface. Apply the criteria in " +
  "docs/architecture/context-engineering-standards.md: (1) tool DESCRIPTIONS are sent on every " +
  "tools/list and to every model — keep them provenance-free (no \"Phase N\", \"(BI-…)\", or source " +
  "paths; put that in code comments). The hygiene guard apps/web/lib/tool-description-hygiene.test.ts " +
  "fails CI on violations. (2) Any new model-facing tool RESULT must go through " +
  "clampToolResultForModel / the MCP-route cap (apps/web/lib/tak/tool-result-budget.ts) so one result " +
  "can't blow the ~24,576-token local window. (3) Prefer few, consolidated, unambiguous tools and " +
  "phase/grant-scoped exposure over adding to the 242-tool surface.";

/**
 * Pure decision: does this tool call edit a governed context-economy file?
 * Exported for unit tests.
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {{ remind: boolean, file?: string }}
 */
export function decide(toolName, toolInput = {}) {
  if (toolName !== "Write" && toolName !== "Edit" && toolName !== "MultiEdit") {
    return { remind: false };
  }
  const file = String(toolInput.file_path ?? "").replace(/\\/g, "/");
  // Normalize an absolute path down to a repo-relative one for the regex.
  const rel = file.replace(/^.*?(?=apps\/web\/|packages\/)/, "");
  if (!GOVERNED_RE.test(rel)) return { remind: false };
  return { remind: true, file: rel };
}

function main() {
  let payload;
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0); // fail open — never wedge the session on a bad payload
  }

  const verdict = decide(payload?.tool_name, payload?.tool_input ?? {});
  if (!verdict.remind) process.exit(0);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: GUIDANCE,
      },
    }),
  );
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("tool-economy-precheck.mjs")) {
  main();
}
