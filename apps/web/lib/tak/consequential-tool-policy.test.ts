import { describe, expect, it } from "vitest";

import { classifyConsequentialTool } from "./consequential-tool-policy";

describe("consequential tool policy", () => {
  it("classifies a read without invoking model judgement", () => {
    expect(classifyConsequentialTool({ toolName: "query_backlog", tool: { sideEffect: false } })).toEqual({
      class: "routine-read",
      consequential: false,
      alignmentRequired: false,
      preconditionRequired: false,
      collaborationShape: null,
      reason: "read-only",
    });
  });

  it("classifies an explicit business-direction mutation as consequential", () => {
    expect(classifyConsequentialTool({
      toolName: "create_digital_product",
      tool: { sideEffect: true },
    }).consequential).toBe(true);
    expect(classifyConsequentialTool({
      toolName: "create_digital_product", tool: { sideEffect: true },
    }).collaborationShape).toBe("specialist-alignment");
  });

  // These cases used to assert shapes for `send_quote` and `execute_change` —
  // neither of which exists as a tool. The test passed because the classifier
  // is keyed on a bare string, so it happily classifies a name nothing can
  // call. The Work Room binding is now driven by the tool's DECLARED reach,
  // and consequential-tool-coverage.test.ts checks these names resolve.
  it.each([
    ["send_marketing_email", "outward" as const, "outward-review"],
    ["execute_promotion", "irreversible" as const, "change-consequential"],
  ])("binds a %s tool to the %s Work Room shape", (toolName, consequence, collaborationShape) => {
    expect(classifyConsequentialTool({ toolName, tool: { sideEffect: true, consequence } }).collaborationShape)
      .toBe(collaborationShape);
  });

  // BI-63B14D4B: an outward effect that is platform development (a PR, a hive
  // contribution) is governed by the founder kernel, not the customer's
  // business stance. It stays consequential and outward-reviewed, but the
  // WWWD alignment consult -- which produced empty "create portal pr:" cards
  // for the business owner -- is not charged.
  it("does not WWWD-align a platform-scoped outward tool, but keeps it consequential", () => {
    expect(classifyConsequentialTool({
      toolName: "create_portal_pr",
      tool: { sideEffect: true, consequence: "outward", consequenceScope: "platform" },
    })).toMatchObject({
      class: "consequential-mutation",
      consequential: true,
      alignmentRequired: false,
      collaborationShape: "outward-review",
      reason: "declared-outward",
    });
  });

  it("still WWWD-aligns a business-scoped outward tool (explicit or default scope)", () => {
    expect(classifyConsequentialTool({
      toolName: "send_marketing_email",
      tool: { sideEffect: true, consequence: "outward", consequenceScope: "business" },
    }).alignmentRequired).toBe(true);
    expect(classifyConsequentialTool({
      toolName: "send_marketing_email",
      tool: { sideEffect: true, consequence: "outward" },
    }).alignmentRequired).toBe(true);
  });

  it("keeps the explicit legacy alignment list gated regardless of scope", () => {
    expect(classifyConsequentialTool({
      toolName: "create_digital_product",
      tool: { sideEffect: true, consequenceScope: "platform" },
    }).alignmentRequired).toBe(true);
  });

  it("keeps the precondition-gated HR transition on its change shape", () => {
    expect(classifyConsequentialTool({
      toolName: "transition_employee_status", tool: { sideEffect: true },
    })).toMatchObject({ consequential: true, preconditionRequired: true, collaborationShape: "change-consequential" });
  });

  it("does not charge ordinary bookkeeping mutations for an alignment check", () => {
    expect(classifyConsequentialTool({
      toolName: "update_backlog_item_status",
      tool: { sideEffect: true },
    }).class).toBe("ordinary-mutation");
  });
});
