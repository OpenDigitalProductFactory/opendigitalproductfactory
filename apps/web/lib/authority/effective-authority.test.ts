import { describe, expect, it } from "vitest";

import {
  explainEffectiveAuthority,
  type EffectiveAuthorityBinding,
} from "./effective-authority";

const SAMPLE_BINDING: EffectiveAuthorityBinding = {
  bindingId: "AB-000001",
  resourceRef: "/finance",
  appliedAgentId: "finance-controller",
  approvalMode: "proposal-required",
  subjects: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
  grants: [{ grantKey: "ledger_write", mode: "require-approval", rationale: "Needs review" }],
};

describe("explainEffectiveAuthority", () => {
  it("shows the binding term as the reason a permission was narrowed", () => {
    const result = explainEffectiveAuthority({
      roleId: "HR-400",
      agentId: "finance-controller",
      resourceRef: "/finance",
      actionKey: "ledger_write",
      userAllowed: true,
      agentAllowed: true,
      bindings: [SAMPLE_BINDING],
      toolGrantRequirements: {
        ledger_write: ["ledger_write"],
      },
    });

    expect(result.binding?.bindingId).toBe("AB-000001");
    expect(result.decision).toBe("require-approval");
  });

  it("denies access when the selected role is outside the allowed binding subjects", () => {
    const result = explainEffectiveAuthority({
      roleId: "HR-500",
      agentId: "finance-controller",
      resourceRef: "/finance",
      actionKey: "ledger_read",
      userAllowed: true,
      agentAllowed: true,
      bindings: [SAMPLE_BINDING],
      toolGrantRequirements: {
        ledger_read: [],
      },
    });

    expect(result.binding?.bindingId).toBe("AB-000001");
    expect(result.decision).toBe("deny");
    expect(result.reasonCode).toBe("binding_subject_denied");
  });
});
