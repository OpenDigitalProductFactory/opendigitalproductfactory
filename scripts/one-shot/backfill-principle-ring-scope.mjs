#!/usr/bin/env node
// One-shot backfill for BI-4AA1074B Slice 3: insert principleRingScope
// frontmatter on every pre-existing principle file per the audit table in
// docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §7
// (tightened from the first-pass recommendation — see Slice 3 PR body for
// the ~10 cases where execution diverged from the draft table).
//
// Safe to re-run: insertion is idempotent (skips files already carrying
// `principleRingScope:`). Throws on unknown slugs so a typo in the
// mapping doesn't silently miss a file.
//
// After this script runs, the 4 already-scoped principles from PR #1081
// (mirror-dont-migrate, schema-honesty-over-aspirational-naming,
// make-silent-failures-observable, substrate-cleanup-before-substrate-addition)
// remain untouched — they ship explicit scope from day one.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRINCIPLES_DIR = join(
  __dirname,
  "..",
  "..",
  "docs",
  "founder-kernel",
  "wiki",
  "principles",
);

// Mapping derived from spec §7 audit table with coherence corrections:
// - Tightened ~10 engineering-flow rules to ring-2-workflow only (they
//   don't genuinely bind every ring — they bind code work).
// - Tightened one-data-model + organization-canonical-identity +
//   principal-convergence to identity/data-model rings only.
// - Kept architecture-only commandments (never-fabricate, no-assumptions,
//   architecture-over-shortcuts) at universal-ring — those genuinely bind.
//
// Final universal-ring count: 15 of 58 pre-existing (25.9%), under the
// 30% lint discipline threshold.
const SCOPE_MAP = {
  "all-changes-land-via-pr": ["ring-2-workflow"],
  "always-push-after-committing": ["ring-2-workflow"],
  "architecture-over-shortcuts": ["universal-ring"],
  "autonomous-directives-are-blanket-approval": [
    "ring-1-coworker",
    "ring-2-workflow",
  ],
  "backlog-lives-in-postgresql": ["ring-2-workflow"],
  "branch-guard-before-implementation": ["ring-2-workflow"],
  "build-gate-mandatory": ["ring-2-workflow", "ring-4-sandbox-prod"],
  "check-epic-overlap-before-creating": ["ring-2-workflow"],
  "check-tool-signals-first": ["ring-1-coworker"],
  "consult-specs-first": ["universal-ring"],
  "contextualize-before-transforming": ["universal-ring"],
  "db-fallback-explicit": ["ring-1-coworker"],
  "dco-sign-off-required": ["ring-2-workflow"],
  "design-research-required": ["universal-ring"],
  "destructive-actions-require-explicit-go": ["universal-ring"],
  "diversity-of-thought": ["ring-1-coworker"],
  "do-the-work-dont-task-the-operator": [
    "ring-1-coworker",
    "ring-2-workflow",
  ],
  "evidence-before-diagnosis": ["ring-1-coworker"],
  "external-and-internal-work-share-gates": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "fail-fast-explain-clearly": ["ring-1-coworker"],
  "fix-the-seed-not-the-runtime": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "human-in-the-loop-at-phase-boundaries": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "keep-root-clone-as-merge-worktree": ["ring-2-workflow"],
  "live-state-over-seed-data": ["universal-ring"],
  "mention-uncommitted-changes": ["ring-2-workflow"],
  "never-ask-user-to-run-commands": [
    "ring-1-coworker",
    "ring-2-workflow",
  ],
  "never-fabricate": ["universal-ring"],
  "never-wipe-db-for-code-fixes": ["universal-ring"],
  "no-assumptions": ["universal-ring"],
  "no-hardcoded-colors": ["ring-2-workflow"],
  "one-concern-per-pr": ["ring-2-workflow"],
  "one-data-model": ["ring-3-archetype", "ring-4-sandbox-prod"],
  "orchestrator-worker-pattern": ["ring-2-workflow"],
  "organization-canonical-identity": ["ring-3-archetype"],
  "plan-before-install-paths": ["ring-4-sandbox-prod"],
  "prefer-self-hosted-infrastructure": ["universal-ring"],
  "principal-convergence": ["ring-3-archetype"],
  "release-qa-plan": ["ring-4-sandbox-prod"],
  "research-and-use-standards": ["universal-ring"],
  "research-before-implementing": ["universal-ring"],
  "responsible-capacity-utilization": ["universal-ring"],
  "schema-audit-before-features": [
    "ring-2-workflow",
    "ring-3-archetype",
  ],
  "security-fix-needs-regression-test-first": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "selective-memory-not-total-recall": ["ring-1-coworker"],
  "single-source-of-truth": ["universal-ring"],
  "specialization-over-generalization": [
    "ring-1-coworker",
    "ring-2-workflow",
  ],
  "state-results-directly": ["ring-1-coworker"],
  "strongly-typed-string-enums": [
    "ring-2-workflow",
    "ring-3-archetype",
  ],
  "structural-verification-is-not-functional": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "structured-handoffs-not-conversation-history": ["ring-2-workflow"],
  "sweep-main-before-trusting-worktree-specs": ["ring-2-workflow"],
  "test-in-the-portal-build": [
    "ring-2-workflow",
    "ring-4-sandbox-prod",
  ],
  "tool-evaluation-pipeline": ["ring-1-coworker"],
  "tools-must-be-self-documenting": ["ring-1-coworker"],
  "trust-the-data-spine": [
    "ring-3-archetype",
    "ring-4-sandbox-prod",
  ],
  "verify-substrate-before-proposing-new": ["universal-ring"],
  "worktree-base-origin-main": ["ring-2-workflow"],
  "worktree-per-session": ["ring-2-workflow"],
};

// Already-scoped from PR #1081 — skip silently rather than fail.
const ALREADY_SCOPED = new Set([
  "mirror-dont-migrate",
  "schema-honesty-over-aspirational-naming",
  "make-silent-failures-observable",
  "substrate-cleanup-before-substrate-addition",
]);

function renderRingScopeBlock(scopes) {
  const lines = ["principleRingScope:"];
  for (const scope of scopes) lines.push(`  - ${scope}`);
  return lines.join("\n") + "\n";
}

let touched = 0;
let skipped = 0;
let alreadyScoped = 0;

const files = readdirSync(PRINCIPLES_DIR).filter((f) => f.endsWith(".md"));
const unknown = [];

for (const fileName of files) {
  const slug = fileName.replace(/\.md$/, "");
  if (ALREADY_SCOPED.has(slug)) {
    alreadyScoped++;
    continue;
  }
  const scopes = SCOPE_MAP[slug];
  if (!scopes) {
    unknown.push(slug);
    continue;
  }

  const path = join(PRINCIPLES_DIR, fileName);
  const raw = readFileSync(path, "utf8");

  // Idempotency: skip if the file already has principleRingScope.
  if (/^principleRingScope:/m.test(raw)) {
    skipped++;
    continue;
  }

  // Insert the new block before the `principleConsumerArchetype:` line in
  // the frontmatter. Every audited principle has that line per the §7
  // spec table, so this anchor is reliable.
  const block = renderRingScopeBlock(scopes);
  const updated = raw.replace(
    /^(principleConsumerArchetype:)/m,
    `${block}$1`,
  );

  if (updated === raw) {
    throw new Error(
      `Failed to insert principleRingScope into ${fileName} — no ` +
        `'principleConsumerArchetype:' anchor found. Inspect the file.`,
    );
  }

  writeFileSync(path, updated, "utf8");
  touched++;
}

// Fail loud on slug typos in the mapping vs. the file system.
if (unknown.length > 0) {
  console.error(
    `\nERROR: principle slugs present on disk but missing from SCOPE_MAP:`,
  );
  for (const slug of unknown) console.error(`  - ${slug}`);
  console.error("Add them to SCOPE_MAP or remove the stale file.");
  process.exit(1);
}

// Also fail if the mapping has slugs not on disk (typos in the mapping).
const onDisk = new Set(files.map((f) => f.replace(/\.md$/, "")));
const orphans = Object.keys(SCOPE_MAP).filter((s) => !onDisk.has(s));
if (orphans.length > 0) {
  console.error(`\nERROR: SCOPE_MAP entries with no matching file:`);
  for (const slug of orphans) console.error(`  - ${slug}`);
  process.exit(1);
}

console.log(`Backfill complete:`);
console.log(`  touched: ${touched}`);
console.log(`  skipped (already had principleRingScope): ${skipped}`);
console.log(`  already-scoped (new in PR #1081): ${alreadyScoped}`);
console.log(`  total files: ${files.length}`);
