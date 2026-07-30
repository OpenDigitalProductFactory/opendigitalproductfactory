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
