import { describe, expect, it } from "vitest";

import {
  emptyOutcomeEvidenceSummary,
  parseHarnessRecipeKey,
  presentModelRoute,
  presentRecipeKey,
  shortenContainerImageRef,
} from "./route-labels";

describe("parseHarnessRecipeKey", () => {
  it("parses the live fixture keys", () => {
    expect(parseHarnessRecipeKey("glm.center.summarize.provisional")).toEqual({
      providerFamily: "glm",
      distribution: "center",
      activity: "summarize",
      confidence: "provisional",
    });
    expect(parseHarnessRecipeKey("frontier.edge.critique.trusted")).toEqual({
      providerFamily: "frontier",
      distribution: "edge",
      activity: "critique",
      confidence: "trusted",
    });
    expect(parseHarnessRecipeKey("glm.mixed.code-edit.provisional")).toEqual({
      providerFamily: "glm",
      distribution: "mixed",
      activity: "code-edit",
      confidence: "provisional",
    });
  });

  it("returns null for malformed keys instead of throwing", () => {
    expect(parseHarnessRecipeKey(null)).toBeNull();
    expect(parseHarnessRecipeKey(undefined)).toBeNull();
    expect(parseHarnessRecipeKey("")).toBeNull();
    expect(parseHarnessRecipeKey("just-a-slug")).toBeNull();
    expect(parseHarnessRecipeKey("too.many.parts.here.extra")).toBeNull();
    expect(parseHarnessRecipeKey("glm.NOPE.summarize.provisional")).toBeNull();
    expect(parseHarnessRecipeKey("glm.center.unknown-activity.provisional")).toBeNull();
    expect(parseHarnessRecipeKey("glm.center.summarize.certain")).toBeNull();
    expect(parseHarnessRecipeKey(".center.summarize.provisional")).toBeNull();
  });
});

describe("presentRecipeKey", () => {
  it("humanizes a parseable key grounded on the step's provider/model ids", () => {
    const presentation = presentRecipeKey("glm.center.summarize.provisional", {
      providerId: "zai",
      modelId: "glm-5.2",
    });
    expect(presentation.label).toBe(
      "Z.ai · GLM 5.2 — trial recipe for summarizing (routine work)",
    );
    expect(presentation.technicalId).toBe("glm.center.summarize.provisional");
    expect(presentation.parsed?.confidence).toBe("provisional");
  });

  it("still reads sensibly without resolved provider/model ids", () => {
    const presentation = presentRecipeKey("frontier.edge.critique.trusted");
    expect(presentation.label).toContain("trusted recipe for review & critique");
    expect(presentation.label).toContain("hard/novel work");
  });

  it("falls back to technicalId-only for unparseable keys", () => {
    const presentation = presentRecipeKey("legacy-recipe-42");
    expect(presentation.label).toBeNull();
    expect(presentation.parsed).toBeNull();
    expect(presentation.technicalId).toBe("legacy-recipe-42");
  });
});

describe("shortenContainerImageRef", () => {
  it("shortens the live container ref", () => {
    expect(shortenContainerImageRef("docker.io/ai/qwen3.6:latest")).toBe(
      "Qwen 3.6 (local container)",
    );
  });

  it("handles name-version and versionless images", () => {
    expect(shortenContainerImageRef("docker.io/ai/llama3:8b")).toBe("Llama 3 (local container)");
    expect(shortenContainerImageRef("registry.local/models/mistral:latest")).toBe(
      "Mistral (local container)",
    );
  });

  it("returns null for plain model ids", () => {
    expect(shortenContainerImageRef("glm-5.2")).toBeNull();
    expect(shortenContainerImageRef(null)).toBeNull();
    expect(shortenContainerImageRef("")).toBeNull();
  });
});

describe("presentModelRoute", () => {
  it("prefers the container shortener for image refs", () => {
    expect(presentModelRoute("dmr", "docker.io/ai/qwen3.6:latest").label).toBe(
      "Qwen 3.6 (local container)",
    );
  });

  it("labels the Z.ai / GLM pair without leaking raw ids", () => {
    const route = presentModelRoute("zai", "glm-5.2");
    expect(route.label).toBe("Z.ai · GLM 5.2");
    expect(route.technicalId).toBe("zai / glm-5.2");
  });
});

describe("emptyOutcomeEvidenceSummary", () => {
  it("collapses an all-unknown evidence grid into one sentence", () => {
    expect(
      emptyOutcomeEvidenceSummary({
        successSignal: "unknown",
        routeDecisionId: null,
        tokenTotal: null,
        costUsd: null,
      }),
    ).toBe("No outcome recorded yet — this route hasn't run.");
  });

  it("returns null as soon as any evidence exists", () => {
    expect(
      emptyOutcomeEvidenceSummary({
        successSignal: "valid",
        routeDecisionId: null,
        tokenTotal: null,
        costUsd: null,
      }),
    ).toBeNull();
    expect(
      emptyOutcomeEvidenceSummary({
        successSignal: "unknown",
        routeDecisionId: "RD-1",
        tokenTotal: null,
        costUsd: null,
      }),
    ).toBeNull();
  });
});
