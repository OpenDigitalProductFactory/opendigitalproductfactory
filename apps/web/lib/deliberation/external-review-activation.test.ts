// apps/web/lib/deliberation/external-review-activation.test.ts
import { describe, it, expect } from "vitest";
import {
  decideExternalReviewActivation,
  pickIndependentSurface,
} from "./external-review-activation";

describe("decideExternalReviewActivation (BI-A245FE00)", () => {
  it("always reviews doctrine-shaping artifacts (architecture-decision / policy)", () => {
    const d = decideExternalReviewActivation({
      artifactType: "architecture-decision",
      authorSurface: "claude-desktop",
      risk: "low",
    });
    expect(d.activate).toBe(true);
    expect(d.pattern).toBe("review");
  });

  it("debates the highest-stakes doctrine work", () => {
    const d = decideExternalReviewActivation({
      artifactType: "policy",
      authorSurface: "claude-desktop",
      risk: "critical",
    });
    expect(d.activate).toBe(true);
    expect(d.pattern).toBe("debate");
    expect(d.strategyProfile).toBe("document-authority");
  });

  it("reviews specs only at medium+ risk", () => {
    expect(
      decideExternalReviewActivation({ artifactType: "spec", authorSurface: "codex-desktop", risk: "low" }).activate,
    ).toBe(false);
    expect(
      decideExternalReviewActivation({ artifactType: "spec", authorSurface: "codex-desktop", risk: "medium" }).activate,
    ).toBe(true);
  });

  it("reviews code-change only at high+ risk (CI + author review covers the rest)", () => {
    expect(
      decideExternalReviewActivation({ artifactType: "code-change", authorSurface: "claude-desktop", risk: "medium" })
        .activate,
    ).toBe(false);
    expect(
      decideExternalReviewActivation({ artifactType: "code-change", authorSurface: "claude-desktop", risk: "high" })
        .activate,
    ).toBe(true);
  });

  it("golden triangle: higher risk -> more assurance via the strategyProfile dial", () => {
    expect(decideExternalReviewActivation({ artifactType: "spec", authorSurface: "x", risk: "medium" }).strategyProfile).toBe("balanced");
    expect(decideExternalReviewActivation({ artifactType: "spec", authorSurface: "x", risk: "high" }).strategyProfile).toBe("high-assurance");
    expect(decideExternalReviewActivation({ artifactType: "spec", authorSurface: "x", risk: "critical" }).strategyProfile).toBe("document-authority");
  });

  it("sensitivity floor raises the profile but never lowers it", () => {
    expect(
      decideExternalReviewActivation({ artifactType: "plan", authorSurface: "x", risk: "low", sensitivityFloor: "high-assurance" })
        .strategyProfile,
    ).toBe("high-assurance");
    expect(
      decideExternalReviewActivation({ artifactType: "architecture-decision", authorSurface: "x", risk: "critical", sensitivityFloor: "economy" })
        .strategyProfile,
    ).toBe("document-authority");
  });
});

describe("pickIndependentSurface (BI-A245FE00)", () => {
  it("picks a surface other than the author (evidence-not-provenance)", () => {
    expect(pickIndependentSurface("claude-desktop", ["claude-desktop", "codex-desktop", "grok-desktop"])).toBe("codex-desktop");
  });
  it("returns null when no independent surface is available", () => {
    expect(pickIndependentSurface("claude-desktop", ["claude-desktop"])).toBeNull();
  });
});
