import { describe, expect, it } from "vitest";

import {
  buildWorkCaseDetail,
  buildWorkCaseSummary,
} from "./case-read-model";

describe("Work Case read model", () => {
  it("builds a stable summary from a source ref and work item", () => {
    const summary = buildWorkCaseSummary({
      source: { sourceType: "booking", sourceId: "BK-100" },
      workItem: {
        itemId: "WI-100",
        title: "Replace condenser fan",
        status: "awaiting-input",
        urgency: "urgent",
        dueAt: new Date("2026-06-29T14:00:00.000Z"),
        assignedToUserId: "user-1",
      },
    });

    expect(summary).toMatchObject({
      caseId: "booking:BK-100",
      title: "Replace condenser fan",
      sourceLabel: "Storefront booking",
      state: "waiting-on-person",
      a2aStatus: "input-required",
      nextAction: "Collect required input",
      attention: {
        required: true,
        reason: expect.stringContaining("human"),
      },
    });
    expect(summary.sourceRefs).toContainEqual({
      kind: "source",
      id: "BK-100",
      sourceType: "booking",
    });
    expect(summary.sourceRefs).toContainEqual({
      kind: "work-item",
      id: "WI-100",
      status: "awaiting-input",
    });
  });

  it("falls back safely when source metadata is not yet registered", () => {
    const summary = buildWorkCaseSummary({
      source: { sourceType: "external-ticket", sourceId: "EXT-1" },
      workItem: {
        itemId: "WI-101",
        title: "Unregistered source",
        status: "queued",
      },
    });

    expect(summary.caseId).toBe("external-ticket:EXT-1");
    expect(summary.sourceLabel).toBe("external-ticket");
    expect(summary.state).toBe("intake");
  });

  it("keeps detail payloads source-referenced and evidence-first", () => {
    const detail = buildWorkCaseDetail({
      source: { sourceType: "backlog-item", sourceId: "BI-1" },
      workItem: { itemId: "WI-102", title: "Fix payment error", status: "in-progress" },
      capsules: [{ capsuleId: "WC-1", status: "working", title: "Payment investigation" }],
      decisions: [{ decisionId: "DI-1", status: "resolved", question: "Ship fix?" }],
      evidence: [{ evidenceId: "EV-1", kind: "test_pass", summary: "Unit tests passed" }],
    });

    expect(detail.summary.state).toBe("active");
    expect(detail.capsules).toHaveLength(1);
    expect(detail.decisions).toHaveLength(1);
    expect(detail.evidence).toHaveLength(1);
    expect(detail.timeline.map((event) => event.sourceRef.kind)).toEqual([
      "work-capsule",
      "decision-interaction",
      "evidence",
    ]);
  });

  it("projects coworker engagements without requiring a WorkItem anchor", () => {
    const detail = buildWorkCaseDetail({
      source: { sourceType: "coworker-engagement", sourceId: "CE-1", status: "needs-approval" },
      coworkerEngagement: {
        engagementId: "CE-1",
        requestedOutcome: "Prepare the municipal launch readiness packet.",
        status: "needs-approval",
        priority: "high",
        providerDisplayName: "Launch Readiness Coworker",
      },
      evidence: [{
        evidenceId: "coworker-engagement:CE-1:approval-context",
        kind: "approval-context",
        summary: "Paid provider approval is required before work begins.",
      }],
    });

    expect(detail.summary).toMatchObject({
      caseId: "coworker-engagement:CE-1",
      title: "Prepare the municipal launch readiness packet.",
      sourceLabel: "Coworker engagement",
      state: "awaiting-decision",
      nextAction: "Resolve pending decision",
      attention: {
        required: true,
        reason: expect.stringContaining("approval"),
      },
    });
    expect(detail.summary.sourceRefs).toContainEqual({
      kind: "coworker-engagement",
      id: "CE-1",
      status: "needs-approval",
    });
    expect(detail.timeline.map((event) => event.sourceRef.kind)).toEqual([
      "coworker-engagement",
      "evidence",
    ]);
  });
});
