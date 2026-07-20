import { describe, expect, it } from "vitest";
import registry from "../data/agent_registry.json";
import {
  COWORKER_AGENT_SEEDS,
  HARDCODED_COWORKER_GRANTS,
  ONBOARDING_AGENT_GRANTS,
} from "./workforce-seed";

type RegistryAgent = {
  agent_id: string;
  delegates_to?: string[];
  config_profile?: { tool_grants?: string[] };
};

const agents = (registry as { agents: RegistryAgent[] }).agents;

function registryAgent(agentId: string): RegistryAgent {
  const agent = agents.find((candidate) => candidate.agent_id === agentId);
  if (!agent) throw new Error(`Missing registry agent ${agentId}`);
  return agent;
}

describe("provider-onboarding COO to compliance coworker authority", () => {
  it("lets the standing COO delegate provider-compliance questions to AGT-902", () => {
    expect(registryAgent("AGT-ORCH-000").delegates_to).toEqual([
      "AGT-100",
      "AGT-101",
      "AGT-102",
      "AGT-902",
    ]);

    const standingCoo = COWORKER_AGENT_SEEDS.find((agent) => agent.agentId === "coo") as
      | { delegatesTo?: readonly string[] }
      | undefined;
    expect(standingCoo?.delegatesTo).toEqual(["AGT-902"]);
    expect(HARDCODED_COWORKER_GRANTS.coo).toContain("thread_write");
  });

  it("lets the first-run COO invoke the same governed coworker interface", () => {
    const onboarding = registryAgent("AGT-WS-ONBOARD");
    expect(onboarding.delegates_to).toEqual(["AGT-902"]);
    expect(onboarding.config_profile?.tool_grants).toContain("thread_write");
    expect(ONBOARDING_AGENT_GRANTS["onboarding-coo"]).toContain("thread_write");
  });
});
