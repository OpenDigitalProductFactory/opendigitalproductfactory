// Self-test for check-agent-principal-convergence-wired.mjs (BI-53C26E60).

import assert from "node:assert/strict";
import { test } from "node:test";

import { checkConvergenceModule, checkSeedWiring } from "./check-agent-principal-convergence-wired.mjs";

const GOOD_SEED = `
  await step("agents", () => seedAgents());
  await step("coworkerAgents", () => seedCoworkerAgents());
  await step("agentPrincipals", () => seedAgentPrincipals());
  convergeAgentPrincipals(prisma, ids);
`;

test("accepts convergence running after both agent seeders", () => {
  assert.deepEqual(checkSeedWiring(GOOD_SEED), []);
});

test("rejects a seed with no convergence step at all", () => {
  const problems = checkSeedWiring(`
    await step("agents", () => seedAgents());
    await step("coworkerAgents", () => seedCoworkerAgents());
  `);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does not run a step\("agentPrincipals"/);
});

test("rejects convergence hoisted above a later agent seeder", () => {
  const problems = checkSeedWiring(`
    await step("agents", () => seedAgents());
    await step("agentPrincipals", () => seedAgentPrincipals());
    await step("coworkerAgents", () => seedCoworkerAgents());
    convergeAgentPrincipals(prisma, ids);
  `);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /coworkerAgents.*AFTER/);
});

test("rejects a convergence step that calls nothing", () => {
  const problems = checkSeedWiring(`
    await step("agents", () => seedAgents());
    await step("coworkerAgents", () => seedCoworkerAgents());
    await step("agentPrincipals", () => noop());
  `);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /does no convergence/);
});

test("rejects a convergence module that stopped writing the agent alias", () => {
  const problems = checkConvergenceModule(`aliasType: "gaid", aliasValue: gaid`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /resolveReviewerIdentity reads/);
});

test("accepts a convergence module that writes the agent alias", () => {
  assert.deepEqual(checkConvergenceModule(`{ aliasType: "agent", aliasValue: agent.agentId }`), []);
});
