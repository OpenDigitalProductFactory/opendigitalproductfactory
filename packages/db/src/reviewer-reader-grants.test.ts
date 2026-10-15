import { describe, expect, it } from "vitest";

import registry from "../data/agent_registry.json";
import { HARDCODED_COWORKER_GRANTS } from "./workforce-seed";

// A reviewer that records an initiative review must read the immutable design it
// reviews, so reviewer eligibility needs the review grant AND file_read on the
// same agent (apps/web/lib/tak/initiative-readiness-tool-grants.ts,
// IMMUTABLE_READER_GRANT). Without file_read the gate is owed with no reachable
// reviewer (BI-0B878DFC defect 3).
const BOUND_REVIEW_GRANTS = [
  "initiative_design_review",
  "initiative_architecture_review",
  "initiative_domain_review",
  "initiative_ux_review",
  "initiative_security_review",
  "initiative_compliance_review",
  "initiative_data_review",
];

type RegistryAgent = { agent_id?: string; agent_name?: string; config_profile?: { tool_grants?: string[] } };
const AGENTS = ((registry as { agents?: unknown[] }).agents ?? []) as RegistryAgent[];

function effectiveGrants(agent: RegistryAgent): Set<string> {
  return new Set([
    ...(agent.config_profile?.tool_grants ?? []),
    ...(agent.agent_id ? HARDCODED_COWORKER_GRANTS[agent.agent_id] ?? [] : []),
    ...(agent.agent_name ? HARDCODED_COWORKER_GRANTS[agent.agent_name] ?? [] : []),
  ]);
}

describe("reviewer agents can read what they review", () => {
  it("every agent holding a bound initiative review grant also holds file_read", () => {
    const missing = AGENTS.flatMap((agent) => {
      const grants = effectiveGrants(agent);
      return BOUND_REVIEW_GRANTS.some((grant) => grants.has(grant)) && !grants.has("file_read")
        ? [agent.agent_id ?? agent.agent_name ?? "?"]
        : [];
    });
    expect(missing).toEqual([]);
  });

  it("covers the security, compliance and data reviewers", () => {
    const holders = (grant: string) =>
      AGENTS.filter((agent) => effectiveGrants(agent).has(grant)).map((agent) => agent.agent_id);
    expect(holders("initiative_security_review")).toContain("AGT-190");
    expect(holders("initiative_compliance_review")).toContain("AGT-905");
    expect(holders("initiative_data_review")).toContain("AGT-902");
  });
});
