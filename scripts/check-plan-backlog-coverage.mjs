#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { requireChangedFiles } from "./lib/git-changed-files.mjs";

const PLAN_PATH_RE = /^docs\/superpowers\/plans\/.*\.md$/;

export function validatePlanText(path, text) {
  const errors = [];
  const itemId = text.match(/\*\*Backlog item:\*\*\s*`?(BI-[A-Z0-9-]+)`?/i)?.[1] ?? null;
  if (!itemId) return { ok: true, errors: [] }; // plans not tied to delivery work are outside this gate

  const afterHeading = text.split(/^## Backlog coverage\s*$/im)[1];
  if (afterHeading === undefined) {
    return { ok: false, errors: [`${path}: missing canonical "## Backlog coverage" section.`] };
  }
  const section = afterHeading.split(/^##\s/m)[0] ?? "";
  const decision = section.match(/^\s*-\s*Decision:\s*(atomic|decomposed)\s*$/im)?.[1]?.toLowerCase();
  const parent = section.match(/^\s*-\s*Parent:\s*`?(BI-[A-Z0-9-]+)`?\s*$/im)?.[1];
  const receipt = section.match(/^\s*-\s*Receipt:\s*`?([^`\n]+?)`?\s*$/im)?.[1]?.trim();
  const rationale = section.match(/^\s*-\s*Rationale:\s*(.+)$/im)?.[1]?.trim() ?? "";
  const dependencies = section.match(/^\s*-\s*Dependencies:\s*(.+)$/im)?.[1]?.trim() ?? "";

  if (!decision) errors.push(`${path}: coverage Decision must be atomic or decomposed.`);
  if (parent !== itemId) errors.push(`${path}: coverage Parent must match umbrella ${itemId}.`);
  // A plan is durable knowledge; its merge must not depend on reviewer capacity.
  // The coverage receipt is enforced where it governs work — at the implementation
  // claim (initiative-readiness PLAN_COVERAGE_REQUIRED) — so this gate accepts a
  // plan that states, in the open, WHY the receipt could not be minted yet. A
  // bare "pending" still fails: the condition must be named so the next reader
  // can act on it rather than rediscover it (founder ruling 2026-09-05).
  const blockedBy = receipt?.match(/^blocked-by:\s*(.+)$/i)?.[1]?.trim() ?? "";
  if (!receipt || /^(?:pending|none|n\/a)\b/i.test(receipt)) {
    errors.push(
      `${path}: a live MCP coverage Receipt is required, or "Receipt: blocked-by: <the concrete condition>" naming why it cannot be minted yet; bare "pending" is not a condition.`,
    );
  } else if (/^blocked-by:/i.test(receipt) && blockedBy.length < 30) {
    errors.push(`${path}: "Receipt: blocked-by:" must name the concrete blocking condition (at least 30 characters).`);
  }
  if (!dependencies) errors.push(`${path}: dependencies must be recorded explicitly (use "none" when empty).`);

  if (decision === "atomic" && rationale.length < 20) {
    errors.push(`${path}: atomic coverage requires an auditable rationale explaining why phases are not independent.`);
  }
  if (decision === "decomposed") {
    const mappedIds = [...section.matchAll(/->\s*`?(BI-[A-Z0-9-]+)`?/gi)].map((match) => match[1]);
    if (mappedIds.length === 0) {
      errors.push(`${path}: decomposed coverage must record deliverable-to-BI mappings, including existing BI mappings.`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function main() {
  const base = process.env.BASE_SHA || "origin/main";
  const paths = requireChangedFiles(base, "plan-backlog-coverage-gate")
    .filter((path) => PLAN_PATH_RE.test(path));
  const failures = paths.flatMap((path) => validatePlanText(path, readFileSync(path, "utf8")).errors);
  if (failures.length === 0) {
    console.log(`[plan-backlog-coverage-gate] ${paths.length} changed plan(s) carry complete coverage evidence. OK.`);
    return;
  }
  console.error("[plan-backlog-coverage-gate] FAILED — plan deliverables are not fully represented in the live backlog.");
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error("Use record_plan_backlog_coverage and copy its receipt, BI mappings, and dependencies into the plan. Do not use Markdown checkboxes as deferred-work storage.");
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
