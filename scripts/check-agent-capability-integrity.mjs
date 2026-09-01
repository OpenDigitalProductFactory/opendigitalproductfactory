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
//   3. The consult-before-consequential-act gate covers only what tools DECLARE
//      (TAK §8.4.2 — coverage is a governed metric). Coverage that silently
//      falls is indistinguishable from coverage that was never there: a tool
//      losing its `consequence`, or the composition root losing the resolver
//      install, both leave a gate that still passes every one of its own tests.
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
//   node scripts/check-agent-capability-integrity.mjs --update  # rewrite baseline (debt must shrink, coverage must not fall)

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

const CAPABILITY_PLANES = [
  "identity",
  "corpus",
  "governance",
  "shape",
  "cadence",
  "toolsAndSkills",
  "evidence",
];

/**
 * Enforce both halves of the completeness ratchet:
 *   1. a newly declared identity must meet every plane floor; and
 *   2. legacy debt may shrink but the open-gap count on no plane may grow.
 *
 * The grandfather list exists only for identities that predate the gate. A new
 * complete identity needs no entry, so it remains protected if it later
 * regresses. Existing identities fall out of the list as they reach all floors.
 */
export function findCompletenessRatchetFailures(report, baseline) {
  const ratchet = baseline?.capabilityCompleteness;
  if (!ratchet) {
    return [
      "capability-completeness ratchet is absent from scripts/agent-capability-baseline.json; "
      + "run this check with --update after reviewing the measured floors",
    ];
  }

  const floors = ratchet.planeFloors ?? {};
  const grandfathered = new Set(ratchet.grandfatheredAgentIds ?? []);
  const maximums = ratchet.maxOpenGapsByPlane ?? {};
  const failures = [];

  for (const agent of report.agents ?? []) {
    // Canonical identity reconciliation changes the inventory key from a slug
    // to AGT-* without creating a new actor. Preserve the existing actor's
    // grandfather status through any handle carried on the joined identity.
    if (grandfathered.has(agent.key) || (agent.handles ?? []).some((handle) => grandfathered.has(handle))) continue;
    for (const plane of CAPABILITY_PLANES) {
      const floor = Number(floors[plane]);
      const level = Number(agent.planes?.[plane]?.level ?? 0);
      if (Number.isFinite(floor) && level < floor) {
        failures.push(
          `new/non-grandfathered agent ${agent.key} is below the ${plane} plane floor: `
          + `${level} < ${floor}`,
        );
      }
    }
  }

  for (const plane of CAPABILITY_PLANES) {
    const maximum = Number(maximums[plane]);
    if (!Number.isFinite(maximum)) {
      failures.push(`capability-completeness baseline has no open-gap maximum for ${plane}`);
      continue;
    }
    const current = (report.agents ?? []).filter((agent) => {
      const state = agent.planes?.[plane];
      return state && Number(state.level) < Number(state.ceiling);
    }).length;
    if (current > maximum) {
      failures.push(
        `${plane} open gaps grew: ${current}, baseline maximum ${maximum}; `
        + "complete the regressed/new identity rather than raising the baseline",
      );
    }
  }

  return failures;
}

function nextCompletenessRatchet(report, baseline) {
  const prior = baseline?.capabilityCompleteness;
  const measuredFloors = Object.fromEntries(
    CAPABILITY_PLANES.map((plane) => [plane, Number(report.contract?.planes?.[plane]?.ceiling ?? 0)]),
  );
  const planeFloors = Object.fromEntries(
    CAPABILITY_PLANES.map((plane) => [
      plane,
      Math.max(Number(prior?.planeFloors?.[plane] ?? 0), measuredFloors[plane]),
    ]),
  );
  const priorGrandfathered = prior
    ? new Set(prior.grandfatheredAgentIds ?? [])
    : new Set((report.agents ?? []).map((agent) => agent.key));
  const grandfatheredAgentIds = (report.agents ?? [])
    .filter((agent) =>
      priorGrandfathered.has(agent.key)
      || (agent.handles ?? []).some((handle) => priorGrandfathered.has(handle)),
    )
    .filter((agent) => CAPABILITY_PLANES.some(
      (plane) => Number(agent.planes?.[plane]?.level ?? 0) < planeFloors[plane],
    ))
    .map((agent) => agent.key)
    .sort();
  const maxOpenGapsByPlane = Object.fromEntries(
    CAPABILITY_PLANES.map((plane) => [
      plane,
      (report.agents ?? []).filter((agent) => {
        const state = agent.planes?.[plane];
        return state && Number(state.level) < Number(state.ceiling);
      }).length,
    ]),
  );

  return {
    note:
      "New identities must meet every plane floor. Existing debt is grandfathered by stable identity, "
      + "and per-plane open-gap counts are SHRINK-ONLY. --update may tighten this block, never admit an incomplete new identity.",
    planeFloors,
    grandfatheredAgentIds,
    maxOpenGapsByPlane,
  };
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
  const gate = report.summary?.consequentialGate ?? {};
  const baseline = readBaseline();
  const bootstrapping = baseline === null;
  const known = new Set(baseline?.unbackedSkillIds ?? []);
  const floor = baseline?.consequentialGateFloor ?? null;

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
    // Gate coverage ratchets the OTHER way: it is not debt to burn down, it is
    // reach to hold. --update may raise the floor and must never lower it,
    // otherwise re-baselining becomes the fix for a coverage regression.
    if (floor && Number(gate.gateClassified) < Number(floor.gateClassified)) {
      console.error("[agent-capability-integrity] refusing --update: consult-gate coverage may only RISE.");
      console.error(`  floor: ${floor.gateClassified} tool(s); now: ${gate.gateClassified}`);
      console.error("\nRestore the missing `consequence` declaration(s) rather than lowering the floor.");
      process.exit(1);
    }
    if (baseline?.capabilityCompleteness) {
      const completenessFailures = findCompletenessRatchetFailures(report, baseline);
      if (completenessFailures.length > 0) {
        console.error("[agent-capability-integrity] refusing --update: capability debt may only SHRINK.");
        for (const failure of completenessFailures) console.error(`  ${failure}`);
        process.exit(1);
      }
    }
    // Preserve the budget shape (owner + expiry). A baseline with neither turns
    // "debt we intend to burn down" into "debt we have accepted forever", which
    // is what scripts/check-no-expired-baseline-budgets.mjs exists to refuse.
    fs.writeFileSync(
      BASELINE,
      JSON.stringify({
        ...(baseline ?? {}),
        owner: baseline?.owner ?? "platform-governance",
        expiry: baseline?.expiry ?? "2026-11-20",
        note:
          baseline?.note ??
          "Known-outstanding unbacked backingSkillIds. SHRINK-ONLY. See BI-5C1978C7.",
        unbackedSkillIds: unbacked,
        consequentialGateFloor: {
          note:
            "TAK §8.4.2 — consult-gate coverage is a governed metric. RISE-ONLY: this floor is reach to hold, not debt to burn down. It falls only by a tool losing its declared `consequence` or the composition root losing the resolver install, both of which leave a gate that still passes its own tests.",
          gateClassified: Number(gate.gateClassified ?? 0),
          sideEffectingTools: Number(gate.sideEffectingTools ?? 0),
          coveragePct: Number(gate.coveragePct ?? 0),
          resolverInstalled: true,
        },
        capabilityCompleteness: nextCompletenessRatchet(report, baseline),
      }, null, 2) + "\n",
    );
    console.log(
      `[agent-capability-integrity] baseline updated — ${unbacked.length} outstanding, `
      + `consult-gate floor ${gate.gateClassified}/${gate.sideEffectingTools} (${gate.coveragePct}%).`,
    );
    return;
  }

  const failures = [];

  failures.push(...findCompletenessRatchetFailures(report, baseline));

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

  if (floor) {
    if (gate.resolverInstalled !== true) {
      failures.push(
        "the decision-routing gate no longer receives its DERIVED tool set:",
        "    apps/web/lib/governance/register-tool-governance-hooks.ts must call",
        "    installConsequentialToolResolver(getConsequentialToolNames).",
        "  Without it the gate silently falls back to the two-name transitional seed —",
        "  every `consequence` declaration in the codebase stops reaching the gate, and",
        "  the gate goes on passing all of its own tests.",
      );
    }
    if (Number(gate.gateClassified) < Number(floor.gateClassified)) {
      failures.push(
        `consult-gate coverage FELL: ${gate.gateClassified} tool(s) gated, floor is ${floor.gateClassified}.`,
        "  A side-effecting tool that moves money, reaches a third party, changes identity",
        "  or authority, or destroys state must declare `consequence` on its ToolDefinition.",
        "  Restore the declaration; do NOT lower the floor.",
      );
    }
  }

  if (failures.length > 0) {
    console.error("[agent-capability-integrity] FAILED\n");
    for (const line of failures) console.error(`  ${line}`);
    console.error("");
    process.exit(1);
  }

  const cleared = [...known].filter((id) => !unbacked.includes(id));
  console.log(
    `[agent-capability-integrity] ok — 0 stranded skills, ${unbacked.length} unbacked backing id(s) within baseline, `
    + `consult-gate ${gate.gateClassified}/${gate.sideEffectingTools} (${gate.coveragePct}%) at or above floor.`,
  );
  if (floor && Number(gate.gateClassified) > Number(floor.gateClassified)) {
    console.log(
      `  coverage rose above the floor (${floor.gateClassified} -> ${gate.gateClassified}) — run --update to ratchet up.`,
    );
  }
  if (cleared.length > 0) {
    console.log(`  ${cleared.length} baseline entr(y/ies) now resolved — run --update to ratchet down:`);
    for (const id of cleared) console.log(`    ${id}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
