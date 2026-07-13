#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/design-grounding-precheck.mjs
//
// PreToolUse nudge for BI-11900EE7. When an agent edits UX/workflow/queue/
// navigation/process-spine files, remind it to ground the change against the
// current specs/plans and code substrate BEFORE implementation. Non-blocking:
// CI enforces the evidence contract via scripts/check-design-grounding-decision.mjs.

import { readFileSync } from "node:fs";

const DESIGN_SENSITIVE_FILE_RE =
  /(apps\/web\/app\/.*\/page\.tsx|apps\/web\/components\/.*\.(tsx|ts)|apps\/web\/lib\/(?:attention|work-management|founder-review|navigation|wiki|mcp\/packs|tak)\/.*\.(ts|tsx)|scripts\/check-(?:spec-plan-doc|ux-fit|design-grounding).*\.mjs|packages\/dpf-skill-pack\/hooks\/.*\.(mjs|json))$/;
const EXCLUDE_RE = /(\.(test|spec|stories)\.(ts|tsx|mjs)$|__tests__\/|\.d\.ts$|\/generated\/)/;

const GUIDANCE =
  "[design-grounding] This edit touches UX, workflow, queue, navigation, attention, or process-spine substrate. " +
  "Before implementing, ground the change: search existing specs/plans (search_specs_and_plans or rg docs/superpowers), " +
  "inspect the current code substrate (search_code_graph and/or rg), name the source of truth, and decide whether you are " +
  "extending an existing spec/plan, updating one, creating a new artifact, or making a trivial no-contract-change edit. " +
  "Then record that in a '## Design grounding' PR section or a 'Design-Grounding-Decision:' trailer.";

function candidateText(toolName, toolInput = {}) {
  if (toolName === "Write") return String(toolInput.content ?? "");
  if (toolName === "Edit") return String(toolInput.new_string ?? "");
  if (toolName === "MultiEdit" && Array.isArray(toolInput.edits)) {
    return toolInput.edits.map((e) => String(e?.new_string ?? "")).join("\n");
  }
  return "";
}

/**
 * Pure decision for unit tests.
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {{ remind: boolean, file?: string }}
 */
export function decide(toolName, toolInput = {}) {
  if (!["Write", "Edit", "MultiEdit"].includes(toolName)) return { remind: false };
  const file = String(toolInput.file_path ?? "").replace(/\\/g, "/");
  const rel = file.replace(/^.*?(?=apps\/web\/|scripts\/|packages\/dpf-skill-pack\/)/, "");
  if (!DESIGN_SENSITIVE_FILE_RE.test(rel) || EXCLUDE_RE.test(rel)) return { remind: false };
  // Empty edits are usually tool noise; only nudge when the call carries text.
  if (!candidateText(toolName, toolInput).trim()) return { remind: false };
  return { remind: true, file: rel };
}

function main() {
  let payload;
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
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
if (invokedPath.endsWith("design-grounding-precheck.mjs")) {
  main();
}
