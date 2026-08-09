import { describe, expect, it } from "vitest";

import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { initiativeReadinessPack } from "./initiative-readiness-pack";

const expected = {
  record_initiative_evidence: ["manage_backlog", "initiative_evidence_write"],
  record_initiative_design_review: ["manage_backlog", "initiative_design_review"],
  record_initiative_architecture_review: ["manage_ea_model", "initiative_architecture_review"],
  record_initiative_data_review: ["manage_ea_model", "initiative_data_review"],
  record_initiative_ux_review: ["manage_backlog", "initiative_ux_review"],
  record_initiative_security_review: ["manage_compliance", "initiative_security_review"],
  record_initiative_compliance_review: ["manage_compliance", "initiative_compliance_review"],
  record_initiative_domain_review: ["manage_backlog", "initiative_domain_review"],
  record_initiative_archetype_review: ["manage_taxonomy", "initiative_archetype_review"],
} as const;

describe("initiative readiness reviewer tools", () => {
  it("assigns one exact capability and one exact grant to every thin lane", () => {
    for (const [name, [capability, grant]] of Object.entries(expected)) {
      const definition = initiativeReadinessPack.definitions.find((candidate) => candidate.name === name);
      expect(definition?.requiredCapability).toBe(capability);
      expect(initiativeReadinessPack.grants[name]).toEqual([grant]);
      expect(TOOL_TO_GRANTS[name]).toEqual([grant]);
    }
  });

  it("does not expose a parameterized cross-lane reviewer tool", () => {
    expect(initiativeReadinessPack.definitions.map((definition) => definition.name)).not.toContain("record_initiative_review");
  });

  it("keeps objective evidence as a proposal operation on the non-approval tool", () => {
    const evidence = initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_evidence")!;
    expect(evidence.inputSchema.properties).toHaveProperty("objectiveMappings");
    expect(evidence.inputSchema.properties).toHaveProperty("baselineId");
    expect(initiativeReadinessPack.definitions.find((definition) => definition.name === "record_initiative_design_review")?.inputSchema.properties)
      .not.toHaveProperty("objectiveMappings");
  });

  it("accepts finding issues but never caller-selected stable finding IDs", () => {
    for (const definition of initiativeReadinessPack.definitions) {
      expect(definition.inputSchema.properties).toHaveProperty("findings");
      expect(definition.inputSchema.properties).not.toHaveProperty("findingRefs");
    }
  });

  it("fails closed on malformed finding arrays and findings attached to a passing spec approval", async () => {
    const handler = initiativeReadinessPack.handlers.record_initiative_design_review!;
    const base = {
      itemId: "BI-TEST",
      gate: "spec-approval",
      decision: "pass",
      artifactRef: { kind: "document-version", versionId: "version-1" },
      reason: "Reviewed.",
      resolvedFindingRefs: [],
      profile: "feature",
      artifactRole: "design-spec",
    };

    await expect(handler({ ...base, findings: [{ severity: "important" }] }, "user-1", {} as never))
      .resolves.toMatchObject({ success: false, error: "malformed-receipt" });
    await expect(handler({
      ...base,
      findings: [{ issue: "Unresolved scope gap", severity: "important" }],
    }, "user-1", {} as never)).resolves.toMatchObject({ success: false, error: "malformed-receipt" });
  });
});
