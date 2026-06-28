import { describe, expect, it } from "vitest";
import type { WorkPatternMetadata } from "@/lib/tak/work-pattern-types";
import {
  buildGlmActivityPilotPackage,
  buildWorkCaseActivityPilotPackage,
} from "./activity-package";

describe("activity-package pilots", () => {
  it("keeps GLM eligible as a credential-gated provisional center-distribution challenger", () => {
    const pilot = buildGlmActivityPilotPackage({
      pilotId: "glm-doc-summary",
      parentRef: { taskRunId: "TR-GLM", patternKey: "glm-center-doc-summary" },
      credentialReady: false,
    });

    expect(pilot.activity.activityClass).toBe("summarize");
    expect(pilot.activity.distributionShape).toBe("center");
    expect(pilot.activity.riskClass).toBe("low");
    expect(pilot.activity.requestContractHints.budgetClass).toBe("minimize_cost");
    expect(pilot.harness?.providerFamily).toBe("zai");
    expect(pilot.harness?.modelFamily).toBe("glm");
    expect(pilot.harness?.activityConfidence).toBe("provisional");
    expect(pilot.readiness).toEqual({
      state: "blocked",
      reason:
        "Z.ai / GLM credentials or entitlement are not ready; keep GLM as a provisional challenger.",
    });
    expect(pilot.routeContext.providerReadiness).toBe("credential-gated");
  });

  it("projects governed Work Case metadata into a receipt-backed activity package", () => {
    const metadata: WorkPatternMetadata = {
      patternKey: "case-resolution:approve",
      status: "active",
      scope: "case-transition",
      version: 1,
      source: "human-review",
      decisionScope: "company-wwwd",
      evidence: [
        {
          taskRunId: "TR-CASE",
          workCaseRef: "WC-CASE-1",
          receiptId: "receipt-1",
          decisionInteractionId: "decision-1",
        },
      ],
      workCaseBinding: {
        caseType: "governed-playbook",
        transitionKey: "approve",
        governedActionKey: "approve-playbook-proposal",
        authorityMode: "on-behalf-of",
        receiptPolicy: "governed-action",
      },
    };

    const pilot = buildWorkCaseActivityPilotPackage({
      metadata,
      title: "Approve governed playbook proposal",
    });

    expect(pilot.activity.parentRef).toMatchObject({
      taskRunId: "TR-CASE",
      workCaseId: "WC-CASE-1",
      patternKey: "case-resolution:approve",
    });
    expect(pilot.activity.activityClass).toBe("tool-act");
    expect(pilot.activity.contextPolicy).toBe("work-case-packet");
    expect(pilot.activity.evaluationPolicy.evaluator).toBe("human-acceptance");
    expect(pilot.harness?.memoryPolicy).toBe("work-case-packet");
    expect(pilot.readiness).toEqual({
      state: "ready",
      reason: "Work Case pattern has governed action, receipt policy, and case evidence.",
    });
    expect(pilot.routeContext.receiptPolicy).toBe("governed-action");
    expect(pilot.routeContext.workCaseTransition).toBe("approve");
  });
});
