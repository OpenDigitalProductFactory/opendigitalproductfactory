import { describe, expect, it } from "vitest";

import { evaluateWorkCasePolicy } from "./policy-envelope";

const CASE_REF = {
  caseId: "backlog-item:BI-1",
  sourceType: "backlog-item",
  sourceId: "BI-1",
} as const;

const ACTIVE_STATE = {
  state: "active",
  terminal: false,
} as const;

const GOVERNED_ENVELOPE = {
  autonomyMode: "autonomous",
  receiptPolicy: {
    required: true,
    kind: "governed-action",
  },
} as const;

describe("evaluateWorkCasePolicy", () => {
  it("allows a supported non-terminal action with receipt policy present", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "respond",
        currentState: ACTIVE_STATE,
        envelope: GOVERNED_ENVELOPE,
      }),
    ).toEqual({
      ok: true,
      enforcementMode: "governed-action",
      requiredReceiptKind: "governed-action",
    });
  });

  it("denies unsupported source and action combinations", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: { ...CASE_REF, sourceType: "scheduled" },
        sourceKey: "scheduled",
        action: "handoff",
        currentState: ACTIVE_STATE,
        envelope: GOVERNED_ENVELOPE,
      }),
    ).toMatchObject({
      ok: false,
      reason: "unsupported_transition",
    });
  });

  it("denies consequential actions on terminal cases", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "complete",
        currentState: { state: "closed", terminal: true },
        envelope: GOVERNED_ENVELOPE,
      }),
    ).toMatchObject({
      ok: false,
      reason: "terminal_case_sealed",
    });
  });

  it("denies supervised consequential actions without an approved coworker envelope", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "delegate",
        currentState: ACTIVE_STATE,
        envelope: {
          ...GOVERNED_ENVELOPE,
          autonomyMode: "supervised",
        },
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_coworker_envelope",
    });
  });

  it("denies actions when a stop condition is tripped", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "claim",
        currentState: ACTIVE_STATE,
        envelope: GOVERNED_ENVELOPE,
        stopConditions: [
          {
            stopId: "STOP-auth-expired",
            tripped: true,
            reason: "Authorization expired.",
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      reason: "stop_condition_tripped",
    });
  });

  it("denies consequential agent actions without accountable sponsor context", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "claim",
        currentState: ACTIVE_STATE,
        envelope: {
          ...GOVERNED_ENVELOPE,
          accountability: {
            actor: { actorKind: "agent", actorId: "agt-1" },
            authorityMode: "autonomous",
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_agent_sponsor",
    });
  });

  it("allows consequential agent actions with valid authenticated-inbound accountability", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "claim",
        currentState: ACTIVE_STATE,
        envelope: {
          ...GOVERNED_ENVELOPE,
          accountability: {
            actor: { actorKind: "agent", actorId: "external-agent-1" },
            authorityMode: "authenticated-inbound",
            authenticatedInboundPrincipalId: "prn-customer-agent-1",
          },
        },
      }),
    ).toEqual({
      ok: true,
      enforcementMode: "governed-action",
      requiredReceiptKind: "governed-action",
    });
  });

  it("denies on-behalf-of agent actions without a delegating principal", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "claim",
        currentState: ACTIVE_STATE,
        envelope: {
          ...GOVERNED_ENVELOPE,
          accountability: {
            actor: { actorKind: "agent", actorId: "agt-1" },
            authorityMode: "on-behalf-of",
            sponsorPrincipalId: "prn-sponsor-1",
          },
        },
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_delegating_principal",
    });
  });

  it("denies consequential decision actions when decisionInteractionId is missing", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "escalate",
        currentState: ACTIVE_STATE,
        envelope: GOVERNED_ENVELOPE,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing_decision_interaction",
    });
  });

  it("allows observed external events and marks the enforcement mode", () => {
    expect(
      evaluateWorkCasePolicy({
        caseRef: {
          caseId: "engagement:ENG-1",
          sourceType: "engagement",
          sourceId: "ENG-1",
        },
        sourceKey: "engagement",
        action: "respond",
        currentState: ACTIVE_STATE,
        envelope: {
          autonomyMode: "observed",
          receiptPolicy: {
            required: false,
            kind: "observed-event",
          },
        },
        observedEvent: true,
      }),
    ).toEqual({
      ok: true,
      enforcementMode: "observed-event",
      requiredReceiptKind: "observed-event",
    });
  });
});

// EP-WORK-POSTURE (BI-13ED1BE1) — verificationDepth stops being decorative.
//
// Before this, the Golden Triangle compiled a verification depth, the room
// rendered a "Deep verification" chip, receipts recorded it — and nothing
// stopped a consequential action closing unverified. An operator could set
// Assured on a payroll run, see the chip, and have it complete with no
// verification at all. These tests are the difference between showing a
// promise and keeping one.
describe("verification enforcement", () => {
  const VERIFYING_ENVELOPE = {
    ...GOVERNED_ENVELOPE,
    requiresVerification: true,
  } as const;

  it("DENIES a consequential action that requires verification and has none", () => {
    const decision = evaluateWorkCasePolicy({
      caseRef: CASE_REF,
      sourceKey: "backlog-item",
      action: "claim",
      currentState: ACTIVE_STATE,
      envelope: VERIFYING_ENVELOPE,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      // A NAMED policy denial, not a generic refusal — so the operator is told
      // what is missing rather than that something went wrong.
      expect(decision.reason).toBe("missing_verification_evidence");
      expect(decision.message).toMatch(/verification evidence/i);
    }
  });

  it("DENIES when evidence exists but nothing was actually verified", () => {
    const decision = evaluateWorkCasePolicy({
      caseRef: CASE_REF,
      sourceKey: "backlog-item",
      action: "claim",
      currentState: ACTIVE_STATE,
      envelope: VERIFYING_ENVELOPE,
      verificationEvidence: [{ verifiedAt: null }],
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("missing_verification_evidence");
  });

  it("ALLOWS once verification evidence is present", () => {
    const decision = evaluateWorkCasePolicy({
      caseRef: CASE_REF,
      sourceKey: "backlog-item",
      action: "claim",
      currentState: ACTIVE_STATE,
      envelope: VERIFYING_ENVELOPE,
      verificationEvidence: [{ verifiedAt: "2026-08-23T00:00:00.000Z" }],
    });
    expect(decision.ok).toBe(true);
  });

  it("is inert for work that does not require verification", () => {
    // No regression: every existing caller omits requiresVerification.
    expect(
      evaluateWorkCasePolicy({
        caseRef: CASE_REF,
        sourceKey: "backlog-item",
        action: "claim",
        currentState: ACTIVE_STATE,
        envelope: GOVERNED_ENVELOPE,
      }).ok,
    ).toBe(true);
  });
});
