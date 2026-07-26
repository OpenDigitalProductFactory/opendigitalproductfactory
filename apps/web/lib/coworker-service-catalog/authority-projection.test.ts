import { describe, expect, it } from "vitest";

import {
  projectCoworkerAuthority,
  type CoworkerAuthorityProjectionInput,
} from "./authority-projection";

function input(
  overrides: Partial<CoworkerAuthorityProjectionInput> = {},
): CoworkerAuthorityProjectionInput {
  return {
    scope: { kind: "default-posture" },
    agent: {
      agentId: "agent-1",
      hitlTierDefault: 3,
    },
    governance: { state: "not-configured" },
    service: {
      serviceId: "service-1",
      authorityBoundary: "autonomous-allowed",
      hitlTier: 3,
    },
    offer: {
      offerId: "offer-1",
      authorityBoundary: "autonomous-allowed",
      requiredApprovals: [],
    },
    ...overrides,
  };
}

function effectiveScope(): Extract<
  CoworkerAuthorityProjectionInput["scope"],
  { kind: "effective-action" }
> {
  const actionKey = "customer.update";
  const resourceRef = "customer:123";
  return {
    kind: "effective-action",
    actionKey,
    resourceRef,
    authorityEvaluation: {
      state: "evaluated",
      actionKey,
      resourceRef,
      explanation: {
        decision: "allow",
        reasonCode: "no_binding",
        binding: null,
      },
    },
    proposalEvaluation: {
      state: "evaluated",
      actionKey,
      resourceRef,
      proposals: [],
    },
  };
}

describe("projectCoworkerAuthority", () => {
  it.each([
    [0, "cannot-act", "Cannot act"],
    [1, "approval-required", "Acts with approval"],
    [2, "review-required", "Acts with review"],
    [3, "autonomous", "Can act within limits"],
  ] as const)(
    "maps agent HITL tier %s to %s",
    (hitlTierDefault, level, label) => {
      const result = projectCoworkerAuthority(
        input({
          agent: { agentId: "agent-1", hitlTierDefault },
          service: undefined,
          offer: undefined,
        }),
      );

      expect(result).toMatchObject({
        state: "resolved",
        scope: { kind: "default-posture" },
        level,
        label,
        winner: {
          source: "agent",
          ref: "agent-1",
          field: "hitlTierDefault",
        },
      });
      expect(result).not.toHaveProperty("reason");
      expect(result).toHaveProperty("ownerReason");
    },
  );

  it.each([
    ["never-allowed", "cannot-act", "Cannot act"],
    ["advice-only", "advice-only", "Advises only"],
    ["proposal-only", "proposal-only", "Prepares work for approval"],
    ["approval-required", "approval-required", "Acts with approval"],
    ["autonomous-allowed", "autonomous", "Can act within limits"],
  ] as const)(
    "maps the canonical catalog boundary %s to %s",
    (authorityBoundary, level, label) => {
      const result = projectCoworkerAuthority(
        input({
          offer: {
            offerId: "offer-1",
            authorityBoundary,
            requiredApprovals: [],
          },
        }),
      );

      expect(result).toMatchObject({ state: "resolved", level, label });
    },
  );

  it.each(["cannot-act", "review-required", "autonomous"])(
    "rejects projection-only value %s as a raw catalog boundary",
    (authorityBoundary) => {
      const result = projectCoworkerAuthority(
        input({
          offer: {
            offerId: "offer-1",
            authorityBoundary,
            requiredApprovals: [],
          },
        }),
      );

      expect(result).toMatchObject({
        state: "review-needed",
        label: "Approval rules need review",
      });
    },
  );

  it("uses an explicit offer before a stricter service or agent default", () => {
    const result = projectCoworkerAuthority(
      input({
        agent: { agentId: "agent-1", hitlTierDefault: 0 },
        service: {
          serviceId: "service-1",
          authorityBoundary: "never-allowed",
          hitlTier: 0,
        },
        offer: {
          offerId: "offer-1",
          authorityBoundary: "proposal-only",
          requiredApprovals: [],
        },
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      level: "proposal-only",
      winner: {
        source: "offer",
        ref: "offer-1",
        field: "authorityBoundary",
      },
    });
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "service",
          role: "overridden-default",
        }),
        expect.objectContaining({
          source: "agent",
          role: "overridden-default",
        }),
      ]),
    );
  });

  it("lets a service HITL tier make its canonical boundary stricter", () => {
    const result = projectCoworkerAuthority(
      input({
        service: {
          serviceId: "service-1",
          authorityBoundary: "autonomous-allowed",
          hitlTier: 2,
        },
        offer: undefined,
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      level: "review-required",
      winner: {
        source: "service",
        ref: "service-1",
        field: "hitlTier",
      },
    });
  });

  it("aggregates required approvals and prefers their owner reason on a tie", () => {
    const result = projectCoworkerAuthority(
      input({
        offer: {
          offerId: "offer-1",
          authorityBoundary: "approval-required",
          requiredApprovals: [
            { type: "finance-approval", required: true },
            { type: "attorney-review", required: true },
          ],
        },
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      level: "approval-required",
      ownerReason: "Finance approval and attorney review are required.",
      ownerAction:
        "Get finance approval and attorney review before this coworker acts.",
      winner: {
        source: "offer",
        field: "requiredApprovals",
      },
    });
  });

  it.each([
    ["none", "autonomous"],
    ["never", "autonomous"],
    ["always", "approval-required"],
    ["proposal_for_external_writes", "proposal-only"],
  ] as const)(
    "maps native governance policy %s without inventing a stored value",
    (hitlPolicy, level) => {
      const result = projectCoworkerAuthority(
        input({
          governance: {
            state: "evaluated",
            profileId: "governance-1",
            hitlPolicy,
          },
        }),
      );

      expect(result).toMatchObject({ state: "resolved", level });
    },
  );

  it("returns review-needed when governance evaluation was unavailable", () => {
    const result = projectCoworkerAuthority(
      input({
        governance: {
          state: "unavailable",
          reason: "Governance profile could not be loaded",
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      reasons: ["Governance profile could not be loaded"],
    });
  });

  it("does not treat omitted governance evaluation as no restrictions", () => {
    const unsafe = {
      ...input(),
      governance: undefined,
    } as unknown as CoworkerAuthorityProjectionInput;

    expect(projectCoworkerAuthority(unsafe)).toMatchObject({
      state: "review-needed",
      reasons: ["Governance evaluation was not provided"],
    });
  });

  it("consumes the canonical effective-authority denial", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          authorityEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            explanation: {
              decision: "deny",
              reasonCode: "agent_grant_denied",
              binding: null,
            },
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      scope: {
        kind: "effective-action",
        actionKey: "customer.update",
        resourceRef: "customer:123",
      },
      level: "cannot-act",
      ownerReason: "This coworker does not have the required access.",
      winner: {
        source: "grant",
        ref: "customer.update@customer:123",
      },
    });
  });

  it("lets an equal-rank action restriction provide the specific reason", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        offer: {
          offerId: "offer-1",
          authorityBoundary: "approval-required",
          requiredApprovals: [],
        },
        scope: {
          ...scope,
          authorityEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            explanation: {
              decision: "require-approval",
              reasonCode: "binding_approval_mode",
              binding: {
                bindingId: "binding-1",
                resourceRef: "customer:123",
                appliedAgentId: "agent-1",
                approvalMode: "human-required",
                subjects: [],
                grants: [],
              },
            },
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      level: "approval-required",
      ownerReason: "The active authority binding requires approval.",
      winner: { source: "authority-binding", ref: "binding-1" },
    });
  });

  it("projects a native proposed action as proposal-only", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          proposalEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            proposals: [
              {
                proposalId: "proposal-1",
                actionType: "customer.update",
                status: "proposed",
              },
            ],
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "resolved",
      level: "proposal-only",
      ownerAction: "Review this proposed action before it can run.",
      winner: {
        source: "action-proposal",
        ref: "proposal-1",
      },
    });
  });

  it("requires explicit authority and proposal evaluations for effective authority", () => {
    const unsafe = input({
      scope: {
        kind: "effective-action",
        actionKey: "customer.update",
        resourceRef: "customer:123",
      } as CoworkerAuthorityProjectionInput["scope"],
    });

    expect(projectCoworkerAuthority(unsafe)).toMatchObject({
      state: "review-needed",
      reasons: [
        "Effective authority evaluation was not provided for this action",
        "Action proposal evaluation was not provided for this action",
      ],
    });
  });

  it("rejects an action proposal evaluated for a different action", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          proposalEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            proposals: [
              {
                proposalId: "proposal-1",
                actionType: "invoice.send",
                status: "proposed",
              },
            ],
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      reasons: [
        "Action proposal proposal-1 does not match action customer.update",
      ],
    });
  });

  it("rejects contextual evidence evaluated for a different resource", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          authorityEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: "customer:other",
            explanation: {
              decision: "allow",
              reasonCode: "no_binding",
              binding: null,
            },
          },
          proposalEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: "customer:other",
            proposals: [],
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      reasons: [
        "Effective authority evaluation does not match resource customer:123",
        "Action proposal evaluation does not match resource customer:123",
      ],
    });
  });

  it.each([
    ["approve", "autonomous"],
    ["approved", "autonomous"],
    ["reject", "cannot-act"],
    ["rejected", "cannot-act"],
  ] as const)("accepts native proposal status %s", (status, level) => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          proposalEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            proposals: [
              {
                proposalId: "proposal-1",
                actionType: scope.actionKey,
                status,
              },
            ],
          },
        },
      }),
    );

    expect(result).toMatchObject({ state: "resolved", level });
  });

  it("uses scope-aware compact summaries", () => {
    const posture = projectCoworkerAuthority(
      input({
        agent: { agentId: "agent-1", hitlTierDefault: 1 },
        service: undefined,
        offer: undefined,
      }),
    );
    const action = projectCoworkerAuthority(
      input({
        agent: { agentId: "agent-1", hitlTierDefault: 1 },
        service: undefined,
        offer: undefined,
        scope: effectiveScope(),
      }),
    );

    expect(posture).toMatchObject({
      summary: "This coworker acts after a person approves.",
    });
    expect(action).toMatchObject({
      summary: "This coworker can act after a person approves this action.",
    });
  });

  it("returns review-needed for the live requirements-gate declaration", () => {
    const result = projectCoworkerAuthority(
      input({
        offer: {
          offerId: "offer-build-sensitive-domain-requirements",
          authorityBoundary: "requirements-gate",
          requiredApprovals: [],
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      label: "Approval rules need review",
      reasons: [
        "Offer offer-build-sensitive-domain-requirements has an unsupported authorityBoundary value",
      ],
    });
  });

  it.each([
    [{ required: true }, "must include a nonblank type"],
    [{ type: " ", required: true }, "must include a nonblank type"],
    [{ type: { private: "secret" }, required: true }, "must include a nonblank type"],
  ])("fails closed for malformed approval declaration %#", (approval, message) => {
    const result = projectCoworkerAuthority(
      input({
        offer: {
          offerId: "offer-1",
          authorityBoundary: "proposal-only",
          requiredApprovals: [approval],
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      reasons: [`Offer offer-1 requiredApprovals[0].type ${message}`],
    });
  });

  it("redacts an unrecognized primitive value from advanced evidence", () => {
    const secret = `not-a-policy-${"sensitive".repeat(30)}`;
    const result = projectCoworkerAuthority(
      input({
        governance: {
          state: "evaluated",
          profileId: "governance-1",
          hitlPolicy: secret,
        },
      }),
    );

    expect(result.state).toBe("review-needed");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        source: "governance",
        observedValue: `[unrecognized-string:length=${secret.length}]`,
      }),
    );
  });

  it("returns review-needed for contradictory statuses on one proposal", () => {
    const scope = effectiveScope();
    const result = projectCoworkerAuthority(
      input({
        scope: {
          ...scope,
          proposalEvaluation: {
            state: "evaluated",
            actionKey: scope.actionKey,
            resourceRef: scope.resourceRef,
            proposals: [
              {
                proposalId: "proposal-1",
                actionType: "customer.update",
                status: "proposed",
              },
              {
                proposalId: "proposal-1",
                actionType: "customer.update",
                status: "executed",
              },
            ],
          },
        },
      }),
    );

    expect(result).toMatchObject({
      state: "review-needed",
      reasons: [
        "Action proposal proposal-1 reports contradictory statuses",
      ],
    });
  });
});
