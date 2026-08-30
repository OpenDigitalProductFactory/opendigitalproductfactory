// check-agent-principal-convergence-wired.mjs — BI-53C26E60.
//
// The seed applied AGENTS.md §11 Principal convergence to Users only. Agents
// arrive from two seeders — the AGT-* roster in seedAgents and the slug-id rows
// in seedCoworkerAgents — and neither wrote a Principal, so on a seeded install
// 71 of 76 AGT-* agents had no identity.
//
// That is not cosmetic. resolveReviewerIdentity attributes a governed receipt to
// the acting agent's principal and falls back to the delegating human when the
// agent alias misses. With no alias it always missed, so every
// `independent: true` readiness lane recorded the human as reviewer — and the
// human is the artifact author, the one identity independence forbids. Those
// gates could never pass.
//
// Nothing at the source level can prove the DATA converged; that is the seed's
// job at run time. What this guards is that the seed still runs the
// convergence, and still runs it after BOTH agent seeders — either of which can
// introduce an agent with no identity. Dropping the step, or hoisting it above
// a seeder, silently restores the original failure.

import { readFileSync } from "node:fs";

const SEED = "packages/db/src/seed.ts";
const CONVERGENCE = "packages/db/src/agent-principal-convergence.ts";

/** Ordered seed steps this guard reasons about. */
const AGENT_SEEDERS = ["agents", "coworkerAgents"];
const CONVERGENCE_STEP = "agentPrincipals";

export function findStepOrder(source, stepNames) {
  const found = new Map();
  for (const name of stepNames) {
    const index = source.indexOf(`step("${name}"`);
    if (index >= 0) found.set(name, index);
  }
  return found;
}

export function checkSeedWiring(source) {
  const problems = [];
  const order = findStepOrder(source, [...AGENT_SEEDERS, CONVERGENCE_STEP]);

  const convergence = order.get(CONVERGENCE_STEP);
  if (convergence === undefined) {
    problems.push(
      `${SEED} does not run a step("${CONVERGENCE_STEP}"…). Agents seeded without a Principal make every independent readiness lane attribute to the delegating human (BI-53C26E60).`,
    );
    return problems;
  }

  for (const seeder of AGENT_SEEDERS) {
    const at = order.get(seeder);
    if (at === undefined) continue;
    if (at > convergence) {
      problems.push(
        `${SEED} runs step("${seeder}"…) AFTER step("${CONVERGENCE_STEP}"…). Agents introduced by that seeder are never converged, so they act with no identity.`,
      );
    }
  }

  if (!source.includes("convergeAgentPrincipals")) {
    problems.push(`${SEED} does not call convergeAgentPrincipals — the step exists but does no convergence.`);
  }
  return problems;
}

export function checkConvergenceModule(source) {
  const problems = [];
  // The reviewer lookup reads aliasType "agent"; a module that stopped writing
  // it would leave every agent unresolvable while still reporting success.
  if (!source.includes('aliasType: "agent"')) {
    problems.push(
      `${CONVERGENCE} no longer writes an aliasType:"agent" alias. That alias is exactly what resolveReviewerIdentity reads.`,
    );
  }
  return problems;
}

function main() {
  const problems = [
    ...checkSeedWiring(readFileSync(SEED, "utf8")),
    ...checkConvergenceModule(readFileSync(CONVERGENCE, "utf8")),
  ];
  if (problems.length > 0) {
    console.error("Agent Principal convergence is not wired:\n");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("agent-principal-convergence: seed converges agent principals after every agent seeder.");
}

if (process.argv[1] && process.argv[1].endsWith("check-agent-principal-convergence-wired.mjs")) {
  main();
}
