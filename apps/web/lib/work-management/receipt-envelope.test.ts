import { describe, expect, it } from "vitest";

import type { GoldenTriangleReceipt } from "@/lib/golden-triangle/receipt";

import {
  fromBacklogItemActivity,
  fromDecisionInteraction,
  fromExternalEvidenceRecord,
  fromGoldenTriangleReceipt,
  fromRuntimeVerification,
  fromToolExecutionReceipt,
  fromWorkCapsuleActivity,
  fromWorkItemMessage,
} from "./receipt-envelope";

const CASE_REF = {
  caseId: "backlog-item:BI-1",
  sourceType: "backlog-item",
  sourceId: "BI-1",
} as const;

const NOW = "2026-06-27T21:00:00.000Z";

function goldenTriangleReceipt(): GoldenTriangleReceipt {
  return {
    preset: "assured",
    governedBy: "organization",
    requested: {
      minimumTier: "strong",
      effort: "high",
      budgetClass: "standard",
      verificationDepth: "deep",
    },
    actual: {
      modelId: "gpt-5.4",
      tier: "frontier",
      costUsd: 0.42,
      latencyMs: 1234,
      fallbackOccurred: false,
      verificationPassed: true,
      accepted: true,
    },
    deviations: [],
    matchedRequest: true,
    summary: "Assured policy matched the actual run.",
  };
}

describe("ReceiptEnvelope normalizers", () => {
  it("normalizes GoldenTriangleReceipt with requested and actual policy details", () => {
    const envelope = fromGoldenTriangleReceipt(goldenTriangleReceipt(), {
      interactionId: "DI-gt",
      occurredAt: NOW,
      caseRef: CASE_REF,
    });

    expect(envelope).toMatchObject({
      receiptId: "golden-triangle:DI-gt",
      receiptKind: "golden-triangle",
      enforcementMode: "governed-action",
      status: "valid",
      summary: "Assured policy matched the actual run.",
      occurredAt: NOW,
      caseRef: CASE_REF,
      sourceRef: {
        kind: "decision-interaction",
        id: "DI-gt",
      },
      rawRef: {
        table: "DecisionInteraction",
        id: "DI-gt",
      },
      policyRefs: ["golden-triangle:assured", "governed-by:organization"],
    });
    expect(envelope.outputDigest).toMatchObject({
      requested: { minimumTier: "strong", effort: "high" },
      actual: { modelId: "gpt-5.4", tier: "frontier" },
      matchedRequest: true,
    });
  });

  it("normalizes ToolExecutionReceipt without losing execution fields", () => {
    const envelope = fromToolExecutionReceipt(
      {
        id: "ter-1",
        toolExecutionId: "te-1",
        receiptKind: "work-case-governed-action",
        receiptStatus: "valid",
        executionStatus: "success",
        inputFingerprint: "sha256:input",
        outputDigest: { ok: true, result: "done" },
        createdAt: new Date(NOW),
      },
      { caseRef: CASE_REF, actionType: "complete" },
    );

    expect(envelope).toMatchObject({
      receiptId: "ter-1",
      receiptKind: "work-case-governed-action",
      enforcementMode: "governed-action",
      sourceRef: {
        kind: "source",
        id: "te-1",
        sourceType: "tool-execution",
      },
      actionType: "complete",
      status: "valid",
      occurredAt: NOW,
      inputDigest: "sha256:input",
      outputDigest: { ok: true, result: "done" },
      rawRef: {
        table: "ToolExecutionReceipt",
        id: "ter-1",
      },
    });
  });

  it("carries Work Room shape, authority ladder, and decision receipt linkage", () => {
    const envelope = fromToolExecutionReceipt({
      id: "ter-shape", toolExecutionId: "te-shape",
      receiptKind: "work-case-governed-action", receiptStatus: "valid",
      executionStatus: "denied", inputFingerprint: "sha256:shape",
      outputDigest: { verdict: "decline" }, createdAt: NOW,
    }, {
      caseRef: CASE_REF,
      policyRefs: ["tak:wwwd-alignment"],
      collaborationShape: {
        collaborationShape: "escalation", authorityLadderLevel: "action",
        requiredPrincipalRefs: ["PRN-COORD", "PRN-OWNER"],
        decisionInteractionId: "DI-VETO",
      },
    });
    expect(envelope.governance).toEqual({
      collaborationShape: "escalation", authorityLadderLevel: "action",
      requiredPrincipalRefs: ["PRN-COORD", "PRN-OWNER"],
      decisionInteractionId: "DI-VETO",
    });
    expect(envelope.status).toBe("failed");
  });

  it("normalizes existing activity and evidence rows as observed-event receipts", () => {
    const envelopes = [
      fromWorkCapsuleActivity({
        id: "wca-1",
        workCapsuleId: "wc-row-1",
        kind: "note",
        summary: "Capsule note recorded.",
        payload: { capsuleId: "WC-1" },
        recordedAt: new Date(NOW),
      }),
      fromWorkItemMessage({
        id: "msg-row-1",
        messageId: "MSG-1",
        workItemId: "wi-row-1",
        senderType: "agent",
        senderAgentId: "AGT-1",
        messageType: "reply",
        body: "A response was posted.",
        structuredPayload: { caseId: CASE_REF.caseId },
        createdAt: new Date(NOW),
      }),
      fromRuntimeVerification({
        id: "rv-row-1",
        verificationId: "RV-1",
        kind: "unit-test",
        status: "passed",
        result: { tests: 42 },
        createdAt: new Date(NOW),
      }),
      fromExternalEvidenceRecord({
        id: "eer-1",
        routeContext: "/ops",
        operationType: "manual-review",
        target: "BI-1",
        provider: "codex",
        resultSummary: "Reviewed by an external agent.",
        details: { branch: "feat/work-case-wave1-enforcement" },
        createdAt: new Date(NOW),
      }),
      fromDecisionInteraction({
        id: "di-row-1",
        interactionId: "DI-1",
        domainClass: "plan-readiness",
        question: "Proceed?",
        outcomeType: "escalate",
        outcomePayload: { reason: "human-needed" },
        createdAt: new Date(NOW),
      }),
      fromBacklogItemActivity({
        id: "bia-1",
        backlogItemId: "backlog-row-1",
        kind: "evidence",
        summary: "Backlog evidence recorded.",
        payload: { itemId: "BI-1" },
        recordedAt: new Date(NOW),
      }),
    ];

    for (const envelope of envelopes) {
      expect(envelope.enforcementMode).toBe("observed-event");
      expect(envelope.status).toBe("observed");
      expect(envelope.receiptKind).toBe("observed-event");
      expect(envelope.rawRef.id.length).toBeGreaterThan(0);
      expect(envelope.summary.length).toBeGreaterThan(0);
      expect(envelope.occurredAt).toBe(NOW);
    }
  });

  it("keeps governed-action receipts distinguishable from observed events", () => {
    const governed = fromToolExecutionReceipt({
      id: "ter-2",
      toolExecutionId: "te-2",
      receiptKind: "work-case-governed-action",
      receiptStatus: "valid",
      executionStatus: "success",
      inputFingerprint: "sha256:input",
      outputDigest: { ok: true },
      createdAt: new Date(NOW),
    });
    const observed = fromRuntimeVerification({
      id: "rv-row-2",
      verificationId: "RV-2",
      kind: "unit-test",
      status: "passed",
      result: { ok: true },
      createdAt: new Date(NOW),
    });

    expect(governed.enforcementMode).toBe("governed-action");
    expect(observed.enforcementMode).toBe("observed-event");
  });

  it("preserves a Work Room lifecycle receipt as a governed action", () => {
    const envelope = fromWorkItemMessage({
      id: "msg-row-cycle",
      messageId: "MSG-CYCLE",
      workItemId: "room-row",
      senderType: "user",
      senderUserId: "user-finance",
      messageType: "work-room-outcome-packet",
      body: "Cycle completed.",
      structuredPayload: {
        kind: "work-room-outcome-packet",
        receipt: {
          kind: "work-room-lifecycle-receipt",
          operation: "complete-cycle",
          receiptKind: "governed-action",
          enforcementMode: "governed-action",
          status: "valid",
          idempotencyKey: "complete:2026-W31",
          policyRefs: ["work-case-policy-envelope"],
        },
      },
      createdAt: NOW,
    });

    expect(envelope).toMatchObject({
      receiptKind: "governed-action",
      enforcementMode: "governed-action",
      actionType: "complete-cycle",
      status: "valid",
      inputDigest: "complete:2026-W31",
      sourceRef: { kind: "receipt", id: "MSG-CYCLE" },
      policyRefs: ["work-case-policy-envelope"],
    });
  });
});
