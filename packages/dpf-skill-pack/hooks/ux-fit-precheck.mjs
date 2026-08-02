#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/ux-fit-precheck.mjs
//
// PreToolUse nudge (BI-65DEE968 defense-in-depth). When a Claude session is about
// to WRITE a user-facing control into a UI surface (apps/web/**/*.tsx), remind it
// — before the code exists — to design for cognitive load: run the UX-fit review,
// keep the default view to plain choices, auto-derive what the platform can
// compute, and never ask a layman for a raw token count. The HARD enforcement is
// the UX-Fit Gate CI check (scripts/check-ux-fit-decision.mjs); this hook just
// moves the prompt left so the agent designs it right up front instead of getting
// caught at the PR gate.
//
// Non-blocking by design: emits additionalContext and ALWAYS allows. Hooks are
// guidance; CI is the gate. Fails OPEN on any error — a guard must never wedge a
// session. Shipped INSIDE the dpf-platform plugin (hooks/hooks.json, matcher
// "Write|Edit|MultiEdit") so the nudge travels with the plugin to every surface.
// Codex and Grok adopted the same PreToolUse hook protocol, so the additionalContext
// nudge fires there too; the surface-agnostic CI gate (check-ux-fit-decision.mjs)
// remains the hard enforcement.
// (BI-CA0ED781 moved this from repo .claude/settings.json into the plugin.)

import { readFileSync } from "node:fs";

const UI_FILE_RE = /apps[\\/]web[\\/].*\.tsx$/;
const EXCLUDE_RE = /\.(test|spec|stories)\.tsx$/;
// Mirrors UI_CONTROL_RE in scripts/lib/gate-sensitivity.mjs. The pack is
// distributed outside the repo, so this stays dependency-free and is
// behavior-pinned by scripts/gate-context.test.mjs.
const UI_CONTROL_DESCRIPTION =
  "<input>, <select>, <textarea>, type=number|range|button|submit, <form>, <button>, " +
  "<a>/<Link>, <details>/<summary>, custom *Button/*Link/*Trigger/*Disclosure/*Toggle controls, " +
  "role=button/link/tab/switch/menuitem, aria-expanded, data-dpf-disclosure, or onClick";
const UI_CONTROL_RE = new RegExp(
  [
    String.raw`<(?:input|select|textarea|form|button|a|details|summary)\b`,
    String.raw`<(?:Button|Link|Trigger|Disclosure|Toggle|Menu|Tab|Tabs|Accordion|Popover|Dialog|Drawer|Combobox|Command|Action)\b`,
    String.raw`<[A-Z][A-Za-z0-9]*(?:Button|Link|Trigger|Disclosure|Toggle|Menu|Tab|Tabs|Accordion|Popover|Dialog|Drawer|Combobox|Command|Action)\b`,
    String.raw`\btype=["'](?:number|range|button|submit)["']`,
    String.raw`\brole=["'](?:button|link|tab|switch|menuitem|checkbox|radio)["']`,
    String.raw`\baria-expanded=`,
    String.raw`\bdata-dpf-disclosure\b`,
    String.raw`\bonClick=`,
  ].join("|"),
  "i",
);

const GUIDANCE =
  `[ux-fit] This edit adds a user-facing control (${UI_CONTROL_DESCRIPTION}) to a UI surface (apps/web/*.tsx). ` +
  "Before committing, design for cognitive load: run the dpf-ux-fit-review skill and score the options with " +
  "principle_decide on the human_cognitive_load axis. Prefer progressive disclosure — auto-derive what the " +
  "platform can compute (model context, hardware limits), keep the default view to 3-5 plain choices, and " +
  "never ask a layman to type a token count or raw endpoint (AGENTS.md §12/§17). Then commit MEASURED " +
  "evidence at docs/ux-fit/<date>-<slug>.ux-fit.json: evidence.kind 'sweep-measurement' (the route's real " +
  "budget axes, which the gate adjudicates against the committed route-budget baseline) or 'propose-n-pick' " +
  "(decisionInteractionId + >=2 consideredOptions). An acknowledgement does not qualify and the " +
  "'UX-Fit-Decision:' trailer is retired (BI-D967DEE0) — the UX-Fit Gate CI check requires the manifest.";

/**
 * Pure decision: does this tool call add a user-facing control to a UI file?
 * Exported for unit tests.
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {{ remind: boolean, file?: string }}
 */
export function decide(toolName, toolInput = {}) {
  if (!["Write", "Edit", "MultiEdit"].includes(toolName)) return { remind: false };
  const file = String(toolInput.file_path ?? "").replace(/\\/g, "/");
  if (!UI_FILE_RE.test(file) || EXCLUDE_RE.test(file)) return { remind: false };

  const candidates = [];
  if (typeof toolInput.content === "string") candidates.push(toolInput.content); // Write
  if (typeof toolInput.new_string === "string") candidates.push(toolInput.new_string); // Edit
  if (Array.isArray(toolInput.edits)) {
    for (const e of toolInput.edits) {
      if (typeof e?.new_string === "string") candidates.push(e.new_string); // MultiEdit
    }
  }
  const addsControl = candidates.some((t) => UI_CONTROL_RE.test(t));
  return addsControl ? { remind: true, file } : { remind: false };
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
if (invokedPath.endsWith("ux-fit-precheck.mjs")) {
  main();
}
