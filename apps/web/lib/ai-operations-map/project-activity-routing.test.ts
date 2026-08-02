import { describe, expect, it } from "vitest";
import {
  projectActivityPackagesRouting,
  projectBuildStudioActivityRouting,
} from "./project-activity-routing";
import {
  buildGlmActivityPilotPackage,
  buildWorkCaseActivityPilotPackage,
} from "@/lib/routing/activity-package";
import type { WorkPatternMetadata } from "@/lib/tak/work-pattern-types";

describe("projectBuildStudioActivityRouting", () => {
  it("projects Build Studio phase resolutions as inspectable activity-routing steps", () => {
    const projection = projectBuildStudioActivityRouting({
      parentRef: { buildId: "BUILD-1" },
      generatedAt: new Date("2026-06-28T20:00:00.000Z"),
      phases: [
        {
          phase: "plan",
          label: "Plan",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          rationale: "Selected Claude for high-risk planning.",
          flags: [],
        },
        {
          phase: "build",
          label: "Build (code generation)",
          providerId: "zai-coding",
          modelId: "glm-5.2",
          rationale: "Local OpenCode runner selected coding endpoint.",
          flags: [{ severity: "info", code: "challenger", message: "GLM challenger", remediation: "Monitor outcome" }],
        },
      ],
    });

    expect(projection).toMatchObject({
      taskRef: { buildId: "BUILD-1" },
      generatedAt: "2026-06-28T20:00:00.000Z",
    });
    expect(projection.activities).toEqual([
      expect.objectContaining({
        activityId: "build:BUILD-1:plan",
        label: "Plan",
        activityClass: "plan",
        distributionShape: "edge",
        riskClass: "high",
        selectedProviderId: "anthropic",
        selectedModelId: "claude-sonnet",
        harnessRecipeKey: "edge.plan.balanced",
        confidence: "calibrating",
        successSignal: "unknown",
        routeDecisionId: null,
        adapterTelemetryId: null,
        decisionSummary: "Selected Claude for high-risk planning.",
        exclusions: [],
      }),
      expect.objectContaining({
        activityId: "build:BUILD-1:build",
        label: "Build (code generation)",
        activityClass: "code-edit",
        distributionShape: "mixed",
        riskClass: "high",
        selectedProviderId: "zai-coding",
        selectedModelId: "glm-5.2",
        harnessRecipeKey: "glm.mixed.code-edit.provisional",
        confidence: "provisional",
        successSignal: "attention",
        decisionSummary: "Local OpenCode runner selected coding endpoint.",
        exclusions: [
          {
            code: "challenger",
            providerId: "routing-warning",
            modelId: null,
            reason: "GLM challenger",
            remediation: "Monitor outcome",
          },
        ],
      }),
    ]);
  });

  it("preserves governed remediation evidence for an operator-facing blocked route", () => {
    const projection = projectBuildStudioActivityRouting({
      parentRef: { buildId: "BUILD-BLOCKED" },
      generatedAt: new Date("2026-08-02T12:00:00.000Z"),
      phases: [
        {
          phase: "ideate",
          label: "Ideate",
          providerId: null,
          modelId: null,
          rationale: "No model was selected for internal code-generation work.",
          flags: [
            {
              severity: "error",
              code: "no-eligible-endpoint",
              message: "No allowed healthy engine can run Ideate.",
              remediation: "Activate a provider that satisfies tools, context, and sensitivity.",
            },
          ],
          enableCandidates: [
            {
              providerId: "anthropic",
              displayName: "Anthropic",
              action: "connect_credentials",
              actionLabel: "Connect & enable",
              oneClick: false,
              satisfies: ["tool use", "internal sensitivity"],
              note: "Needs credentials you must supply.",
            },
          ],
        },
      ],
    });

    expect(projection.activities[0]).toMatchObject({
      selectedProviderId: null,
      selectedModelId: null,
      exclusions: [
        expect.objectContaining({
          code: "no-eligible-endpoint",
          reason: "No allowed healthy engine can run Ideate.",
          remediation: "Activate a provider that satisfies tools, context, and sensitivity.",
        }),
      ],
      enableCandidates: [
        expect.objectContaining({
          providerId: "anthropic",
          action: "connect_credentials",
          satisfies: ["tool use", "internal sensitivity"],
        }),
      ],
    });
  });

  it("merges observed activity outcomes into matching activity steps", () => {
    const projection = projectBuildStudioActivityRouting({
      parentRef: { buildId: "BUILD-1" },
      generatedAt: new Date("2026-06-28T20:00:00.000Z"),
      phases: [
        {
          phase: "build",
          label: "Build (code generation)",
          providerId: "zai-coding",
          modelId: "glm-5.2",
          rationale: "Local OpenCode runner selected coding endpoint.",
          flags: [],
        },
      ],
      observedOutcomes: [
        ...Array.from({ length: 10 }, (_, index) => ({
          id: `activity-outcome:decision-${index + 1}`,
          routeDecisionId: `decision-${index + 1}`,
          activityClass: "code-edit" as const,
          harnessRecipeKey: "glm.mixed.code-edit.provisional",
          confidence: "provisional" as const,
          providerId: "zai-coding",
          modelId: "glm-5.2",
          taskType: "codegen",
          tokenTotal: 2600,
          costUsd: 0.031,
          successSignal: "valid" as const,
          qualitySignal: 0.95,
          evaluatorSource: "build-review",
          evidenceStrength: "linked" as const,
          occurredAt: "2026-06-28T19:59:00.000Z",
        })),
      ],
    });

    expect(projection.activities[0]).toEqual(
      expect.objectContaining({
        routeDecisionId: "decision-1",
        tokenTotal: 2600,
        costUsd: 0.031,
        successSignal: "valid",
        tuningRecommendation: "promote",
        tuningRationale: expect.stringContaining("trust graduation"),
        actionProposalId: "harness-action:code-edit:glm.mixed.code-edit.provisional:zai-coding:glm-5.2:promote",
        actionProposalSummary: expect.stringContaining("after approval"),
        actionProposalAction: "promote",
        actionProposalRecommendedConfidence: "trusted",
      }),
    );
  });

  it("applies approved confidence overrides to matching activity steps", () => {
    const projection = projectBuildStudioActivityRouting({
      parentRef: { buildId: "BUILD-1" },
      generatedAt: new Date("2026-06-28T20:00:00.000Z"),
      phases: [
        {
          phase: "build",
          label: "Build (code generation)",
          providerId: "zai-coding",
          modelId: "glm-5.2",
          rationale: "Local OpenCode runner selected coding endpoint.",
          flags: [],
        },
      ],
      approvedConfidenceOverrides: [
        {
          calibrationKey: "code-edit|glm.mixed.code-edit.provisional|zai-coding|glm-5.2",
          proposalId: "harness-action:code-edit:glm.mixed.code-edit.provisional:zai-coding:glm-5.2:promote",
          activityClass: "code-edit",
          harnessRecipeKey: "glm.mixed.code-edit.provisional",
          providerId: "zai-coding",
          modelId: "glm-5.2",
          confidence: "trusted",
          approvedBy: "operator-1",
          approvedAt: "2026-06-28T20:30:00.000Z",
        },
      ],
    });

    expect(projection.activities[0]).toEqual(
      expect.objectContaining({
        confidence: "trusted",
        approvedConfidenceOverrideId: "harness-action:code-edit:glm.mixed.code-edit.provisional:zai-coding:glm-5.2:promote",
      }),
    );
  });
});

describe("projectActivityPackagesRouting", () => {
  it("surfaces GLM credential-gated pilots and Work Case receipt-backed pilots in the Workbench DTO", () => {
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

    const projection = projectActivityPackagesRouting({
      taskRef: { taskRunId: "TR-PILOT" },
      generatedAt: new Date("2026-06-28T21:00:00.000Z"),
      packages: [
        buildGlmActivityPilotPackage({
          pilotId: "glm-doc-summary",
          parentRef: { taskRunId: "TR-GLM", patternKey: "glm-center-doc-summary" },
          credentialReady: false,
        }),
        buildWorkCaseActivityPilotPackage({
          metadata,
          title: "Approve governed playbook proposal",
        }),
      ],
    });

    expect(projection.activities).toEqual([
      expect.objectContaining({
        activityId: "pilot:glm:glm-doc-summary",
        label: "Evaluate GLM center-distribution summary",
        activityClass: "summarize",
        distributionShape: "center",
        riskClass: "low",
        selectedProviderId: "zai",
        selectedModelId: "glm-5.2",
        harnessRecipeKey: "glm.center.summarize.provisional",
        confidence: "provisional",
        successSignal: "attention",
        decisionSummary: expect.stringContaining("credential"),
        exclusions: [
          {
            providerId: "zai",
            modelId: "glm-5.2",
            reason:
              "Z.ai / GLM credentials or entitlement are not ready; keep GLM as a provisional challenger.",
          },
        ],
      }),
      expect.objectContaining({
        activityId: "pilot:work-case:case-resolution:approve",
        label: "Approve governed playbook proposal",
        activityClass: "tool-act",
        selectedProviderId: null,
        selectedModelId: null,
        harnessRecipeKey: "mixed.tool-act.balanced",
        confidence: "calibrating",
        successSignal: "unknown",
        decisionSummary: "Work Case pattern has governed action, receipt policy, and case evidence.",
        exclusions: [],
      }),
    ]);
  });
});
