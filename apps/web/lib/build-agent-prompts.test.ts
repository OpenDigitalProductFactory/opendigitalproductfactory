import { describe, expect, it } from "vitest";
import { bumpVersion } from "./feature-build-types";
import { getBuildPhasePrompt, getBuildContextSection } from "./build-agent-prompts";
import type { FeatureBrief } from "./feature-build-types";

describe("bumpVersion", () => {
  it("bumps patch version", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });
  it("bumps minor version and resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });
  it("bumps major version and resets minor and patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });
  it("handles single-digit versions", () => {
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2");
  });
  it("defaults to minor for invalid bump type", () => {
    expect(bumpVersion("1.0.0", "unknown" as "patch")).toBe("1.1.0");
  });
  it("handles malformed version by returning 1.0.0", () => {
    expect(bumpVersion("not-a-version", "patch")).toBe("1.0.0");
  });
});

describe("getBuildPhasePrompt", () => {
  it("returns ideate prompt for ideate phase", () => {
    const prompt = getBuildPhasePrompt("ideate");
    expect(prompt).toContain("Ideate");
    expect(prompt).toContain("Feature Brief");
  });
  it("returns plan prompt for plan phase", () => {
    const prompt = getBuildPhasePrompt("plan");
    expect(prompt).toContain("Plan");
    expect(prompt).toContain("Here's what I'll build");
  });
  it("returns build prompt for build phase", () => {
    const prompt = getBuildPhasePrompt("build");
    expect(prompt).toContain("Build");
    expect(prompt).toContain("automated build pipeline");
  });
  it("returns review prompt for review phase", () => {
    const prompt = getBuildPhasePrompt("review");
    expect(prompt).toContain("Review");
    expect(prompt).toContain("acceptance criteria");
  });
  it("returns ship prompt for ship phase", () => {
    const prompt = getBuildPhasePrompt("ship");
    expect(prompt).toContain("Ship");
    expect(prompt).toContain("digital product");
  });
  it("returns empty string for terminal phases", () => {
    expect(getBuildPhasePrompt("complete")).toBe("");
    expect(getBuildPhasePrompt("failed")).toBe("");
  });
});

describe("getBuildContextSection", () => {
  it("includes buildId and phase", () => {
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "ideate",
      title: "My Feature",
      brief: null,
      plan: null,
      portfolioId: null,
    });
    expect(section).toContain("FB-12345678");
    expect(section).toContain("ideate");
    expect(section).toContain("My Feature");
  });
  it("includes brief summary when present", () => {
    const brief: FeatureBrief = {
      title: "Feedback Form",
      description: "A customer feedback form",
      portfolioContext: "products_and_services_sold",
      targetRoles: ["HR-200"],
      inputs: ["text field"],
      dataNeeds: "feedback table",
      acceptanceCriteria: ["form submits"],
    };
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "plan",
      title: "Feedback Form",
      brief,
      plan: null,
      portfolioId: "products_and_services_sold",
    });
    expect(section).toContain("Feedback Form");
    expect(section).toContain("A customer feedback form");
    expect(section).toContain("products_and_services_sold");
  });
  it("omits brief section when null", () => {
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "ideate",
      title: "Test",
      brief: null,
      plan: null,
      portfolioId: null,
    });
    expect(section).not.toContain("Feature Brief:");
  });
});
