import { expect, it } from "vitest";
import registry from "../data/agent_registry.json";
import { HARDCODED_COWORKER_GRANTS } from "./coworker-grants";

it.each([
  ["AGT-EXT-CLAUDE", "external-claude-code"],
  ["AGT-EXT-CODEX", "external-codex"],
  ["AGT-EXT-GROK", "external-grok"],
])("%s can submit author evidence without independent-review or administrative authority", (id, slug) => {
  const canonical = registry.agents.find((agent) => agent.agent_id === id)!.config_profile.tool_grants;
  const legacy = HARDCODED_COWORKER_GRANTS[slug];
  expect(canonical).toContain("initiative_evidence_write");
  expect([...canonical].sort()).toEqual([...legacy].sort());
  expect(canonical.filter((grant) => grant.startsWith("initiative_"))).toEqual(["initiative_evidence_write"]);
  expect(canonical).not.toContain("admin_write");
  expect(canonical).not.toContain("iac_execute");
});
