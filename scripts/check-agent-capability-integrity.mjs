#!/usr/bin/env node
// scripts/check-agent-capability-integrity.mjs
//
// Referential-integrity gate over the agent capability graph (BI-B6157AAB).
//
// Two defect classes, both statically decidable, both silently re-introducible
// because nothing in the runtime validates either reference:
//
//   1. A skill's `assignTo` is written VERBATIM into SkillAssignment.agentId,
//      and that column has no relation to any registry, so the write always
//      succeeds. A skill assigned to an identity no coworker answers to reaches
//      nobody — and looks identical, in the database, to one that works.
//
//   2. A service's `backingSkillIds` may cite a skill that does not exist. This
//      one is worse than inert: evaluateCoworkerServiceReadiness reports the
//      service as not-ready with "Missing skill: X" and a "Review capabilities"
//      recovery, pointing the operator at a skill they cannot assign because it
//      was never written.
//
// This reads the committed capability-completeness artifact rather than
// re-deriving, so there is ONE parser and the derived-artifacts gate already
// guarantees the artifact matches source.
//
// RATCHET, not a cliff. Stranded skills are enforced at zero — they were driven
// to zero in the same change that added this gate, so any regression is new.
// Unbacked backingSkillIds carry a baseline of the known-outstanding set: the
// gate fails on a NET-NEW one and the baseline may only shrink. Precedent:
// scripts/docs-reference-baseline.txt.
//
// Deliberately NOT auto-fixable by deleting the citation: removing an unbacked
// id would flip its service from honestly-not-ready to falsely-ready. The fix is
// to write the skill (or retire the service), which is a human decision.
//
// Usage:
//   node scripts/check-agent-capability-integrity.mjs           # check
//   node scripts/check-agent-capability-integrity.mjs --update  # rewrite baseline (must shrink)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACT = path.join(
  REPO_ROOT, "apps", "web", "lib", "coworker-lifecycle", "capability-completeness.generated.json",
);
const BASELINE = path.join(REPO_ROOT, "scripts", "agent-capability-baseline.json");

function readBaseline() {
  if (!fs.existsSync(BASELINE)) return null;
  return JSON.parse(fs.readFileSync(BASELINE, "utf8"));
}

function main() {
  const update = process.argv.includes("--update");

  if (!fs.existsSync(ARTIFACT)) {
    console.error("[agent-capability-integrity] missing artifact — run: node scripts/measure-capability-completeness.mjs");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(ARTIFACT, "utf8"));
  const stranded = report.orphans?.strandedSkills ?? [];
  const unbacked = [...(report.orphans?.unbackedSkillIds ?? [])].sort();
  const baseline = readBaseline();
  const bootstrapping = baseline === null;
  const known = new Set(baseline?.unbackedSkillIds ?? []);

  if (update) {
    // First adoption seeds the baseline from the current state. Afterwards it
    // may only shrink — the ratchet is what stops "just re-baseline it" from
    // becoming the fix for a new defect.
    const grew = bootstrapping ? [] : unbacked.filter((id) => !known.has(id));
    if (grew.length > 0) {
      console.error("[agent-capability-integrity] refusing --update: the baseline may only SHRINK.");
      for (const id of grew) console.error(`  net-new: ${id}`);
      console.error("\nWrite the missing skill, or retire the service that cites it.");
      process.exit(1);
    }
    // Preserve the budget shape (owner + expiry). A baseline with neither turns
    // "debt we intend to burn down" into "debt we have accepted forever", which
    // is what scripts/check-no-expired-baseline-budgets.mjs exists to refuse.
    fs.writeFileSync(
      BASELINE,
      JSON.stringify({
        owner: baseline?.owner ?? "platform-governance",
        expiry: baseline?.expiry ?? "2026-11-20",
        note:
          baseline?.note ??
          "Known-outstanding unbacked backingSkillIds. SHRINK-ONLY. See BI-5C1978C7.",
        unbackedSkillIds: unbacked,
      }, null, 2) + "\n",
    );
    console.log(`[agent-capability-integrity] baseline updated — ${unbacked.length} outstanding.`);
    return;
  }

  const failures = [];

  if (stranded.length > 0) {
    failures.push(
      `${stranded.length} skill(s) assigned to an identity that reaches no coworker:`,
      ...stranded.map((s) => `    ${s.file} -> ${s.assignTo.join(", ")}`),
      "  A skill's assignTo must name a roster coworker slug, a bootstrap agent, or \"*\".",
      "  It is NOT resolved through COWORKER_SLUG_TO_CANONICAL_AGENT_ID, so a canonical",
      "  AGT-* agent_name (e.g. \"coo-orchestrator\") does not reach its roster coworker.",
    );
  }

  if (bootstrapping) {
    console.error("[agent-capability-integrity] no baseline — seed it with --update after reviewing the list.");
    process.exit(1);
  }

  const netNew = unbacked.filter((id) => !known.has(id));
  if (netNew.length > 0) {
    failures.push(
      `${netNew.length} NET-NEW unbacked backingSkillId(s):`,
      ...netNew.map((id) => `    ${id}`),
      "  A service citing a skill that does not exist renders as not-ready with a",
      "  \"Review capabilities\" recovery the operator cannot act on. Write the skill,",
      "  or retire the service that cites it. Do NOT delete the citation to silence",
      "  this — that flips the service from honestly-not-ready to falsely-ready.",
    );
  }

  if (failures.length > 0) {
    console.error("[agent-capability-integrity] FAILED\n");
    for (const line of failures) console.error(`  ${line}`);
    console.error("");
    process.exit(1);
  }

  const cleared = [...known].filter((id) => !unbacked.includes(id));
  console.log(
    `[agent-capability-integrity] ok — 0 stranded skills, ${unbacked.length} unbacked backing id(s) within baseline.`,
  );
  if (cleared.length > 0) {
    console.log(`  ${cleared.length} baseline entr(y/ies) now resolved — run --update to ratchet down:`);
    for (const id of cleared) console.log(`    ${id}`);
  }
}

main();
