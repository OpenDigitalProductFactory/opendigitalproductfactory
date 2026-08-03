import { describe, expect, it } from "vitest";
import {
  MEDIA_CAPABILITIES,
  invokeMediaOperation,
  resolveMediaOperation,
  type MarketingMediaProviderDescriptor,
} from "./media-capabilities";

function provider(
  overrides: Partial<MarketingMediaProviderDescriptor> = {},
): MarketingMediaProviderDescriptor {
  return {
    providerId: "local-renderer",
    displayName: "Local renderer",
    evaluationId: "tool-eval-local-renderer",
    evaluationStatus: "conditional",
    environments: ["sandbox", "production"],
    capabilities: {
      "image-generation": "unsupported",
      "video-generation": "supported",
      "text-to-speech": "unsupported",
      captions: "supported",
      editing: "supported",
      reframing: "supported",
      provenance: "unsupported",
    },
    deterministic: true,
    offline: true,
    conditions: ["sandboxed browser execution"],
    ...overrides,
  };
}

describe("marketing media capability contract", () => {
  it("keeps the required media operations closed and explicit", () => {
    expect(MEDIA_CAPABILITIES).toEqual([
      "image-generation",
      "video-generation",
      "text-to-speech",
      "captions",
      "editing",
      "reframing",
      "provenance",
    ]);
  });

  it("allows an evaluated provider that supports every hard requirement", () => {
    expect(
      resolveMediaOperation(provider(), {
        capability: "video-generation",
        environment: "sandbox",
        requireDeterministic: true,
        requireOffline: true,
      }),
    ).toEqual({
      ok: true,
      providerId: "local-renderer",
      capability: "video-generation",
      evaluationId: "tool-eval-local-renderer",
      conditions: ["sandboxed browser execution"],
    });
  });

  it.each(["proposed", "in_review", "rejected", "deprecated"] as const)(
    "refuses providers whose ToolEvaluation status is %s",
    (evaluationStatus) => {
      const result = resolveMediaOperation(provider({ evaluationStatus }), {
        capability: "video-generation",
        environment: "sandbox",
      });

      expect(result).toMatchObject({
        ok: false,
        code: "UNSUPPORTED_OPERATION",
        providerId: "local-renderer",
        capability: "video-generation",
        reason: "evaluation-not-active",
      });
    },
  );

  it("refuses an environment outside the evaluated boundary", () => {
    expect(
      resolveMediaOperation(provider({ environments: ["sandbox"] }), {
        capability: "video-generation",
        environment: "production",
      }),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OPERATION",
      reason: "environment-not-approved",
    });
  });

  it("refuses a capability that the provider does not advertise", () => {
    expect(
      resolveMediaOperation(provider(), {
        capability: "text-to-speech",
        environment: "sandbox",
      }),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OPERATION",
      reason: "capability-not-supported",
    });
  });

  it("requires explicit provenance support when publication policy asks for it", () => {
    expect(
      resolveMediaOperation(provider(), {
        capability: "video-generation",
        environment: "production",
        requireProvenance: true,
      }),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OPERATION",
      reason: "provenance-not-supported",
    });
  });

  it("does not treat provider variability as deterministic replay", () => {
    expect(
      resolveMediaOperation(provider({ deterministic: false, offline: false }), {
        capability: "video-generation",
        environment: "sandbox",
        requireDeterministic: true,
      }),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OPERATION",
      reason: "determinism-not-supported",
    });
  });

  it("fails closed when an advertised capability has no adapter operation", async () => {
    const result = await invokeMediaOperation(
      { descriptor: provider(), operations: {} },
      { capability: "video-generation", environment: "sandbox" },
      { organizationId: "org-1", instructions: "Create a launch video", sourceAssetIds: [] },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_OPERATION",
      reason: "adapter-not-implemented",
    });
  });

  it("executes only the handler behind the accepted capability boundary", async () => {
    const result = await invokeMediaOperation(
      {
        descriptor: provider(),
        operations: {
          "video-generation": async () => ({
            assetId: "asset-1",
            mimeType: "video/mp4",
            sha256: "abc123",
          }),
        },
      },
      { capability: "video-generation", environment: "sandbox" },
      { organizationId: "org-1", instructions: "Create a launch video", sourceAssetIds: [] },
    );

    expect(result).toMatchObject({
      ok: true,
      providerId: "local-renderer",
      output: { assetId: "asset-1", mimeType: "video/mp4", sha256: "abc123" },
    });
  });
});
