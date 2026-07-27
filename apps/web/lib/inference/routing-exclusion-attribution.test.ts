import { describe, expect, it } from "vitest";

import { soleCapabilityFloorFailure } from "./routing-exclusion-attribution";
import type { CandidateTrace } from "@/lib/routing/types";

function excluded(reason: string): CandidateTrace {
  return {
    endpointId: reason,
    providerId: "provider",
    modelId: "model",
    endpointName: "Model",
    fitnessScore: 0,
    dimensionScores: {},
    costPerOutputMToken: null,
    excluded: true,
    excludedReason: reason,
  };
}

describe("soleCapabilityFloorFailure", () => {
  it("attributes the failure when every candidate misses the same capability floor", () => {
    expect(soleCapabilityFloorFailure([
      excluded("Agent requires capability 'toolUse' (EP-AGENT-CAP-002)"),
      excluded("Agent requires capability 'toolUse' (EP-AGENT-CAP-002)"),
    ])).toEqual({ missingCapability: "toolUse" });
  });

  it("does not let one capability exclusion mask a mixed residency failure", () => {
    expect(soleCapabilityFloorFailure([
      excluded("Agent requires capability 'toolUse' (EP-AGENT-CAP-002)"),
      excluded("Residency policy 'local_only' requires a local provider"),
      excluded("Residency policy 'local_only' requires a local provider"),
    ])).toBeNull();
  });

  it("does not collapse different missing capabilities into one diagnosis", () => {
    expect(soleCapabilityFloorFailure([
      excluded("Agent requires capability 'toolUse' (EP-AGENT-CAP-002)"),
      excluded("Agent requires capability 'imageInput' (EP-AGENT-CAP-002)"),
    ])).toBeNull();
  });
});
