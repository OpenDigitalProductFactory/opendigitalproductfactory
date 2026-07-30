#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/spec-plan-doc-precheck.mjs
//
// PreToolUse nudge (process-spine defense-in-depth). When a Claude session is
// about to CREATE a substantial new source module or route, remind it — before
// the PR gate catches it — that DPF treats specs, plans, and documentation as
// intrinsic platform resources: a new capability should land with a spec/plan
// (dpf-writing-plans) and a doc/AGENTS.md/SKILL.md touch. The HARD enforcement
// is the Spec/Plan/Doc Gate CI check (scripts/check-spec-plan-doc.mjs); this
// hook just moves the prompt left so the agent writes the doc up front instead
// of getting caught at the PR gate.
//
// Non-blocking by design: emits additionalContext and ALWAYS allows. Hooks are
// guidance; CI is the gate. Fails OPEN on any error — a guard must never wedge a
// session. Shipped INSIDE the dpf-platform plugin (hooks/hooks.json, matcher
// "Write|Edit|MultiEdit") so the nudge travels with the plugin to every surface.
// Codex and Grok adopted the same PreToolUse hook protocol, so the additionalContext
// nudge fires there too; the surface-agnostic CI gate (check-spec-plan-doc.mjs)
// remains the hard enforcement.
// (BI-CA0ED781 moved this from repo .claude/settings.json into the plugin.)

import { readFileSync } from "node:fs";

// A NEW file under these roots is a new capability/contract worth documenting.
// Mirrors NEW_SOURCE_FILE_RE in scripts/lib/gate-sensitivity.mjs (the pack is
// distributed outside the repo, so this stays a dependency-free copy) —
// scripts/gate-context.test.mjs drift-guards pin this mirror's behavior to
// the canonical export; change them together.
const NEW_SOURCE_FILE_RE =
  /^(apps\/web\/lib\/.*\.(ts|tsx)|apps\/web\/app\/.*\/(page|route)\.(ts|tsx)|packages\/[^/]+\/src\/.*\.(ts|tsx)|packages\/db\/prisma\/migrations\/.*\/migration\.sql)$/;
const EXCLUDE_RE = /(\.(test|spec|stories)\.(ts|tsx)$|__tests__\/|\.d\.ts$|\/generated\/)/;

const GUIDANCE =
  "[spec-plan-doc] This edit creates a new source module/route — a new capability or contract. " +
  "DPF treats specs, plans, and documentation as intrinsic platform resources (AGENTS.md §6/§10): " +
  "before committing, make sure the work has a plan (dpf-writing-plans → docs/superpowers/plans/) " +
  "and that you update the affected doc / AGENTS.md / SKILL.md in the SAME PR. The Spec/Plan/Doc " +
  "Gate CI check requires either a doc touch or a 'Process-Spine-Decision:' attestation trailer — " +
  "writing the doc now is the intended path; the attestation is only for genuinely trivial changes.";

/**
 * Pure decision: does this tool call CREATE a substantial new source module?
 * Exported for unit tests. We only nudge on Write (file creation); Edit of an
 * existing file is left to the PR gate's line-threshold path.
 * @param {string} toolName
 * @param {Record<string, any>} toolInput
 * @returns {{ remind: boolean, file?: string }}
 */
export function decide(toolName, toolInput = {}) {
  if (toolName !== "Write") return { remind: false };
  const file = String(toolInput.file_path ?? "").replace(/\\/g, "/");
  // Normalize an absolute path down to a repo-relative one for the regex.
  const rel = file.replace(/^.*?(?=apps\/web\/|packages\/)/, "");
  if (!NEW_SOURCE_FILE_RE.test(rel) || EXCLUDE_RE.test(rel)) return { remind: false };
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
if (invokedPath.endsWith("spec-plan-doc-precheck.mjs")) {
  main();
}
