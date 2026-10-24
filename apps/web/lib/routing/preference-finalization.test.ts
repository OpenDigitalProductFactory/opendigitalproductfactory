import { describe, expect, it } from "vitest";

import { selectEndpointPreference } from "./preference-finalization";

const strong = {
  endpointId: "ep-strong",
  providerId: "openai",
  modelId: "strong",
};
const basic = {
  endpointId: "ep-basic",
  providerId: "local",
  modelId: "basic",
};

describe("selectEndpointPreference", () => {
  it("keeps the canonical winner when a preference is outside the eligible set", () => {
    expect(
      selectEndpointPreference([strong], {
        preferredProviderId: "local",
        preferredModelId: "basic",
      }),
    ).toMatchObject({
      winner: strong,
      resolution: {
        fallbackUsed: true,
        unavailable: [
          { kind: "provider", value: "local" },
          { kind: "model", value: "basic" },
        ],
      },
    });
  });

  it("selects an eligible provider preference", () => {
    expect(
      selectEndpointPreference([strong, basic], {
        preferredProviderId: "local",
      }),
    ).toMatchObject({
      winner: basic,
      resolution: {
        fallbackUsed: false,
        applied: [
          { kind: "provider", value: "local", endpointId: "ep-basic" },
        ],
      },
    });
  });

  it("keeps a model preference inside the selected provider", () => {
    expect(
      selectEndpointPreference([strong, basic], {
        preferredProviderId: "local",
        preferredModelId: "strong",
      }),
    ).toMatchObject({
      winner: basic,
      resolution: {
        fallbackUsed: true,
        applied: [
          { kind: "provider", value: "local", endpointId: "ep-basic" },
        ],
        unavailable: [{ kind: "model", value: "strong" }],
      },
    });
  });

  it("selects a duplicate model id from the preferred provider", () => {
    const openAiShared = { ...strong, modelId: "shared" };
    const localShared = { ...basic, modelId: "shared" };

    expect(
      selectEndpointPreference([openAiShared, localShared], {
        preferredProviderId: "local",
        preferredModelId: "shared",
      }),
    ).toMatchObject({
      winner: localShared,
      resolution: {
        fallbackUsed: false,
        applied: [
          { kind: "provider", value: "local", endpointId: "ep-basic" },
          { kind: "model", value: "shared", endpointId: "ep-basic" },
        ],
        unavailable: [],
      },
    });
  });

  it("gives an eligible persisted endpoint pin precedence", () => {
    expect(
      selectEndpointPreference([strong, basic], {
        pinnedEndpointId: "ep-strong",
        preferredProviderId: "local",
        preferredModelId: "basic",
      }),
    ).toMatchObject({
      winner: strong,
      resolution: {
        applied: [
          { kind: "endpoint", value: "ep-strong", endpointId: "ep-strong" },
        ],
        unavailable: [],
        fallbackUsed: false,
      },
    });
  });
});

describe("selectEndpointPreference — family successor (BI-7F2FBDA3)", () => {
  const retiredPin = "gpt-5.3-codex";
  const successor = { endpointId: "ep-55", providerId: "codex", modelId: "gpt-5.5", modelFamily: "gpt-5", qualityTier: "frontier" };
  const older = { endpointId: "ep-54", providerId: "codex", modelId: "gpt-5.4", modelFamily: "gpt-5", qualityTier: "frontier" };
  const other = { endpointId: "ep-op", providerId: "anthropic", modelId: "claude-opus-4-6", modelFamily: "claude-4", qualityTier: "frontier" };

  it("moves an unavailable pinned model to the newest eligible model in its family and says so", () => {
    expect(
      selectEndpointPreference([other, older, successor], {
        preferredProviderId: "codex",
        preferredModelId: retiredPin,
        preferredModelFamily: "gpt-5",
      }),
    ).toMatchObject({
      winner: successor,
      resolution: {
        fallbackUsed: true,
        unavailable: [{ kind: "model", value: retiredPin }],
        applied: [
          { kind: "provider", value: "codex" },
          { kind: "model", value: "gpt-5.5", endpointId: "ep-55", successorOf: retiredPin, successorBasis: "same-family" },
        ],
      },
    });
  });

  it("does not invent a successor when the family is unknown", () => {
    const result = selectEndpointPreference([other, older, successor], {
      preferredProviderId: "codex",
      preferredModelId: retiredPin,
    });
    expect(result.resolution?.applied.some((entry) => entry.successorOf)).toBe(false);
  });
});
