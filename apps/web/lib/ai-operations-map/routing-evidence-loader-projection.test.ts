import { describe, expect, it } from "vitest";
import { projectLoadedRoutingEvidence, projectSafeInferenceScreenReceipt } from "./routing-evidence-loader-projection";

const receipt = {
  schemaVersion: "inference-data-screen/v1",
  screenId: "screen_a466388a03117c8d",
  routeEffect: "allow",
  transformation: "none",
  classifiedDataClasses: ["source-code"],
  rawPayloadStored: false,
};

describe("persisted screening evidence privacy boundary", () => {
  it("retains only the safe receipt fields, never arbitrary persisted content", () => {
    expect(projectSafeInferenceScreenReceipt({
      ...receipt, inputHash: "private-hash", rawPrompt: "private-prompt",
      matchProvenance: [{ value: "private-value" }],
    })).toEqual({
      screenId: receipt.screenId, routeEffect: "allow", transformation: "none",
      classifiedDataClasses: ["source-code"], rawPayloadStored: false,
    });
  });

  it.each([
    null, undefined, [], "receipt", {},
    { ...receipt, schemaVersion: "inference-data-screen/v2" },
    { ...receipt, screenId: "" },
    { ...receipt, routeEffect: "unknown" },
    { ...receipt, transformation: "unknown" },
    { ...receipt, classifiedDataClasses: [42] },
    { ...receipt, classifiedDataClasses: ["arbitrary private content"] },
    { ...receipt, rawPayloadStored: true },
  ])("keeps missing or malformed evidence uncovered: %j", (value) => {
    expect(projectSafeInferenceScreenReceipt(value)).toBeNull();
  });

  it("counts real receipts in a mixed window and detects forbidden external dispatch", () => {
    const createdAt = new Date("2026-09-13T00:24:06Z");
    const decision = {
      id: "decision", traceId: "e4e68cfef2eb86de5ecf28c144d954c1", designRevision: null, agentId: "reviewer",
      actorKind: "agent", actorId: "reviewer", selectedEndpointId: "gemini:model",
      selectedModelId: "model", taskType: "review", sensitivity: "confidential",
      candidateTrace: [], excludedTrace: [], fallbackChain: [], fallbacksUsed: null, createdAt,
    };
    const result = projectLoadedRoutingEvidence({
      window: { start: createdAt, end: createdAt },
      decisions: [
        { ...decision, inferenceDataScreenReceipt: { ...receipt, routeEffect: "local-only" } },
        { ...decision, id: "legacy", traceId: null },
      ],
      adapterRuns: [], tokenUsage: [], capacity: [],
      providers: [{ providerId: "gemini", category: "external" }],
      outcomes: [{ id: "outcome", traceId: "e4e68cfef2eb86de5ecf28c144d954c1", providerId: "gemini", modelId: "model", createdAt,
        fallbackOccurred: false, providerErrorCode: null, latencyMs: 1, inputTokens: 1, outputTokens: 1, costUsd: null }],
    });
    expect(result).toMatchObject({
      coverage: { screenCoveredDecisions: 1, screenCoverageRate: 0.5 },
    });
    expect(result.findings).toContainEqual(expect.objectContaining({
      issueType: "ai-routing-blocked-path-dispatched", count: 1,
    }));
  });
});
