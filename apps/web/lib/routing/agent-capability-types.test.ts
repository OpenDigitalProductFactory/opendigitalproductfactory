import { describe, it, expect } from "vitest";
import {
  satisfiesMinimumCapabilities,
  DEFAULT_MINIMUM_CAPABILITIES,
  PASSIVE_AGENT_CAPABILITIES,
  resolveTurnMinimumCapabilities,
  resolveTurnGroundedGuidanceRoute,
} from "./agent-capability-types";
import type { EndpointManifest } from "./types";

function ep(overrides: Partial<Pick<EndpointManifest, "supportsToolUse" | "capabilities">> = {}) {
  return {
    supportsToolUse: false,
    capabilities: {},
    ...overrides,
  } as unknown as EndpointManifest;
}

describe("satisfiesMinimumCapabilities", () => {
  it("passes empty floor (passive agent) for any endpoint", () => {
    expect(satisfiesMinimumCapabilities(ep(), PASSIVE_AGENT_CAPABILITIES)).toEqual({ satisfied: true });
  });

  it("fails toolUse floor when endpoint has supportsToolUse: false", () => {
    const result = satisfiesMinimumCapabilities(ep({ supportsToolUse: false }), DEFAULT_MINIMUM_CAPABILITIES);
    expect(result).toEqual({ satisfied: false, missingCapability: "toolUse" });
  });

  it("passes toolUse floor when endpoint has supportsToolUse: true", () => {
    const result = satisfiesMinimumCapabilities(ep({ supportsToolUse: true }), DEFAULT_MINIMUM_CAPABILITIES);
    expect(result).toEqual({ satisfied: true });
  });

  it("fails imageInput floor when capabilities.imageInput is falsy", () => {
    const result = satisfiesMinimumCapabilities(ep({ capabilities: {} as never }), { imageInput: true });
    expect(result).toEqual({ satisfied: false, missingCapability: "imageInput" });
  });

  it("passes imageInput floor when capabilities.imageInput is true", () => {
    const result = satisfiesMinimumCapabilities(
      ep({ capabilities: { imageInput: true } as never }),
      { imageInput: true },
    );
    expect(result).toEqual({ satisfied: true });
  });

  it("fails audioInput floor when capabilities.audioInput is falsy", () => {
    const result = satisfiesMinimumCapabilities(ep({ capabilities: {} as never }), { audioInput: true });
    expect(result).toEqual({ satisfied: false, missingCapability: "audioInput" });
  });

  it("passes audioInput floor when capabilities.audioInput is true", () => {
    const result = satisfiesMinimumCapabilities(
      ep({ capabilities: { audioInput: true } as never }),
      { audioInput: true },
    );
    expect(result).toEqual({ satisfied: true });
  });

  it("fails on first missing capability in multi-cap floor", () => {
    const result = satisfiesMinimumCapabilities(
      ep({ supportsToolUse: true, capabilities: {} as never }),
      { toolUse: true, imageInput: true },
    );
    expect(result).toEqual({ satisfied: false, missingCapability: "imageInput" });
  });

  it("passes full multi-cap floor when all satisfied", () => {
    const result = satisfiesMinimumCapabilities(
      ep({ supportsToolUse: true, capabilities: { imageInput: true } as never }),
      { toolUse: true, imageInput: true },
    );
    expect(result).toEqual({ satisfied: true });
  });
});

describe("resolveTurnMinimumCapabilities", () => {
  it("drops only tool use for prehydrated read-only guidance", () => {
    expect(resolveTurnMinimumCapabilities(
      { toolUse: true, imageInput: true },
      { allowToolFreeInference: true, hasProviderTools: false, requireTools: false },
    )).toEqual({ imageInput: true });
  });

  it("retains tool use when tools are attached or required", () => {
    expect(resolveTurnMinimumCapabilities(
      { toolUse: true },
      { allowToolFreeInference: true, hasProviderTools: true, requireTools: false },
    )).toEqual({ toolUse: true });
  });
});

describe("resolveTurnGroundedGuidanceRoute", () => {
  it("uses an adequate factual route for prehydrated read-only guidance", () => {
    expect(resolveTurnGroundedGuidanceRoute(
      "reasoning",
      { codegen: 85, toolFidelity: 85, reasoning: 85 },
      { allowToolFreeInference: true, hasProviderTools: false, requireTools: false },
    )).toEqual({
      taskType: "status-query",
      minimumDimensions: { codegen: 50, toolFidelity: 50, reasoning: 50 },
    });
  });

  it("retains the configured route for action-capable turns", () => {
    expect(resolveTurnGroundedGuidanceRoute(
      "reasoning",
      { codegen: 85, toolFidelity: 85, reasoning: 85 },
      { allowToolFreeInference: true, hasProviderTools: true, requireTools: false },
    )).toEqual({
      taskType: "reasoning",
      minimumDimensions: { codegen: 85, toolFidelity: 85, reasoning: 85 },
    });
  });
});
