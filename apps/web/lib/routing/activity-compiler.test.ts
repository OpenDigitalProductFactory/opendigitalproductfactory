import { describe, expect, it } from "vitest";
import {
  compileCompoundRequestActivities,
  compileBuildStudioPhaseActivity,
  routeContextFromActivity,
} from "./activity-compiler";

describe("compileBuildStudioPhaseActivity", () => {
  it("compiles the plan phase as an edge planning activity with quality-first posture", () => {
    const activity = compileBuildStudioPhaseActivity({
      phase: "plan",
      parentRef: { buildId: "BUILD-1", taskRunId: "TASK-1" },
    });

    expect(activity).toMatchObject({
      parentRef: { buildId: "BUILD-1", taskRunId: "TASK-1" },
      activityClass: "plan",
      distributionShape: "edge",
      riskClass: "high",
      successShape: "decision",
      contextPolicy: "work-case-packet",
      requestContractHints: {
        taskType: "reasoning",
        budgetClass: "quality_first",
        reasoningDepth: "high",
        minimumTier: "frontier",
      },
    });
    expect(activity.activityId).toBe("build:BUILD-1:plan");
  });

  it("compiles the build phase as a tool-backed code-edit activity", () => {
    const activity = compileBuildStudioPhaseActivity({
      phase: "build",
      parentRef: { buildId: "BUILD-2" },
    });

    expect(activity).toMatchObject({
      activityClass: "code-edit",
      distributionShape: "mixed",
      riskClass: "high",
      successShape: "patch",
      contextPolicy: "work-case-packet",
      requestContractHints: {
        taskType: "code-gen",
        budgetClass: "quality_first",
        reasoningDepth: "high",
        minimumTier: "frontier",
        requiresCodeExecution: true,
      },
      workloadClassHints: ["source-code"],
      governedData: {
        assetIds: ["data:source-code"],
        processingPurpose: "platform-operations",
      },
    });
  });

  it("compiles design review as a critique activity with strict review posture", () => {
    const activity = compileBuildStudioPhaseActivity({
      phase: "design-review",
      parentRef: { buildId: "BUILD-3" },
    });

    expect(activity.activityClass).toBe("critique");
    expect(activity.successShape).toBe("decision");
    expect(activity.requestContractHints).toMatchObject({
      taskType: "analysis",
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
    });
  });
});

describe("compileCompoundRequestActivities", () => {
  it("decomposes a transcript-driven routing refinement request into review, plan, build, and verify activities", () => {
    const activities = compileCompoundRequestActivities({
      requestId: "REQ-1",
      parentRef: { taskRunId: "TASK-1" },
      prompt:
        "Review this video transcript, distill the salient message, compare it to our architecture, and refine the current routing process at a task/activity level.",
      requiresCodeChange: true,
      requiresUiChange: true,
    });

    expect(activities.map((activity) => activity.activityClass)).toEqual([
      "summarize",
      "critique",
      "plan",
      "code-edit",
      "verify",
      "handoff",
    ]);
    expect(activities.map((activity) => activity.activityId)).toEqual([
      "request:REQ-1:01:summarize",
      "request:REQ-1:02:critique",
      "request:REQ-1:03:plan",
      "request:REQ-1:04:code-edit",
      "request:REQ-1:05:verify",
      "request:REQ-1:06:handoff",
    ]);
    expect(activities[0]).toMatchObject({
      title: "Distill source material",
      distributionShape: "center",
      riskClass: "low",
      successShape: "text",
      requestContractHints: {
        taskType: "summarization",
        budgetClass: "minimize_cost",
      },
    });
    expect(activities[3]).toMatchObject({
      title: "Apply implementation changes",
      distributionShape: "mixed",
      riskClass: "high",
      successShape: "patch",
      requestContractHints: {
        taskType: "code-gen",
        requiresCodeExecution: true,
      },
      workloadClassHints: ["source-code"],
    });
    expect(activities[5].evaluationPolicy).toMatchObject({
      evaluator: "human-acceptance",
      minimumSignal: "accepted",
    });
  });
});

describe("routeContextFromActivity", () => {
  it("keeps center-distribution summarization cheap unless the activity asks for stricter hints", () => {
    const routeContext = routeContextFromActivity({
      activityId: "activity-1",
      parentRef: {},
      activityClass: "summarize",
      title: "Summarize transcript",
      distributionShape: "center",
      riskClass: "low",
      successShape: "text",
      contextPolicy: "minimal",
      tokenEnvelope: {
        maxInputTokens: 20_000,
        maxOutputTokens: 1_000,
        compression: "summarize",
      },
      evaluationPolicy: {
        evaluator: "human-acceptance",
        minimumSignal: "accepted",
      },
      requestContractHints: {},
    });

    expect(routeContext).toMatchObject({
      taskType: "summarization",
      budgetClass: "minimize_cost",
      reasoningDepth: "low",
      minimumTier: "adequate",
    });
  });

  it("lets explicit activity hints override default posture", () => {
    const routeContext = routeContextFromActivity({
      activityId: "activity-2",
      parentRef: {},
      activityClass: "extract",
      title: "Extract regulated facts",
      distributionShape: "center",
      riskClass: "medium",
      successShape: "json",
      contextPolicy: "retrieval",
      tokenEnvelope: {
        maxInputTokens: 8_000,
        maxOutputTokens: 800,
        compression: "cite-sources",
      },
      evaluationPolicy: {
        evaluator: "schema",
        minimumSignal: "valid-output",
      },
      requestContractHints: {
        budgetClass: "quality_first",
        minimumTier: "strong",
      },
    });

    expect(routeContext).toMatchObject({
      taskType: "data-extraction",
      budgetClass: "quality_first",
      reasoningDepth: "medium",
      minimumTier: "strong",
    });
  });

  it("carries governed data references and workload hints into the route context", () => {
    const routeContext = routeContextFromActivity({
      ...compileBuildStudioPhaseActivity({ phase: "build", parentRef: { buildId: "BUILD-4" } }),
      workloadClassHints: ["source-code", "secrets-credentials"],
      governedData: {
        assetIds: ["data:source-code"],
        fieldIds: ["data:source-code#contents"],
        processingPurpose: "platform-operations",
      },
    });

    expect(routeContext).toMatchObject({
      workloadClassHints: ["source-code", "secrets-credentials"],
      governedData: {
        assetIds: ["data:source-code"],
        fieldIds: ["data:source-code#contents"],
        processingPurpose: "platform-operations",
      },
    });
  });
});
