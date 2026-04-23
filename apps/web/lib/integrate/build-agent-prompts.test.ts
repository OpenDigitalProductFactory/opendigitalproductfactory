import { describe, expect, it } from "vitest";
import { bumpVersion } from "@/lib/feature-build-types";
import { getBuildPhasePrompt, getBuildContextSection } from "./build-agent-prompts";
import { SPECIALIST_TOOLS } from "./specialist-prompts";
import type { FeatureBrief } from "@/lib/feature-build-types";

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
  it("returns ideate prompt for ideate phase", async () => {
    const prompt = await getBuildPhasePrompt("ideate");
    expect(prompt).toContain("start_ideate_research");
    expect(prompt).toContain("suggest_taxonomy_placement");
    expect(prompt).toContain("start_scout_research");
  });
  it("returns plan prompt for plan phase", async () => {
    const prompt = await getBuildPhasePrompt("plan");
    expect(prompt).toContain("implementation plan");
    expect(prompt).toContain("testFirst");
    expect(prompt).toContain("reviewBuildPlan");
    expect(prompt).toContain("The plan is approved when it passes review");
  });
  it("returns build prompt for build phase", async () => {
    const prompt = await getBuildPhasePrompt("build");
    expect(prompt).toContain("implementation plan");
    expect(prompt).toContain("run_sandbox_tests");
    expect(prompt).toContain("Do not pause for routine go-ahead requests during planned build work");
    expect(prompt).toContain("Never reward-hack");
  });
  it("returns review prompt for review phase", async () => {
    const prompt = await getBuildPhasePrompt("review");
    expect(prompt).toContain("acceptanceMet");
    expect(prompt).toContain("Ready to ship");
  });
  it("returns ship prompt for ship phase", async () => {
    const prompt = await getBuildPhasePrompt("ship");
    expect(prompt).toContain("register_digital_product_from_build");
    expect(prompt).toContain("create_build_epic");
  });
  it("returns empty string for terminal phases", async () => {
    expect(await getBuildPhasePrompt("complete")).toBe("");
    expect(await getBuildPhasePrompt("failed")).toBe("");
  });
});

describe("SPECIALIST_TOOLS", () => {
  it("software-engineer has describe_model for schema lookups", () => {
    expect(SPECIALIST_TOOLS["software-engineer"]).toContain("describe_model");
  });
  it("data-architect has both describe_model and validate_schema", () => {
    expect(SPECIALIST_TOOLS["data-architect"]).toContain("describe_model");
    expect(SPECIALIST_TOOLS["data-architect"]).toContain("validate_schema");
  });
  it("all specialists have read_sandbox_file", () => {
    for (const [role, tools] of Object.entries(SPECIALIST_TOOLS)) {
      expect(tools, `${role} missing read_sandbox_file`).toContain("read_sandbox_file");
    }
  });
});

describe("getBuildContextSection", () => {
  it("includes buildId and phase", async () => {
    const section = await getBuildContextSection({
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
  it("includes brief summary when present", async () => {
    const brief: FeatureBrief = {
      title: "Feedback Form",
      description: "A customer feedback form",
      portfolioContext: "products_and_services_sold",
      targetRoles: ["HR-200"],
      inputs: ["text field"],
      dataNeeds: "feedback table",
      acceptanceCriteria: ["form submits"],
    };
    const section = await getBuildContextSection({
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
  it("omits brief section when null", async () => {
    const section = await getBuildContextSection({
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
