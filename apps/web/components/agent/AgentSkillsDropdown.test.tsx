import { describe, expect, it } from "vitest";
import type { AgentSkill } from "@/lib/tak/agent-coworker-types";
import { applyMarketingSkillRules } from "./AgentSkillsDropdown";

describe("applyMarketingSkillRules", () => {
  const baseSkills: AgentSkill[] = [
    { skillId: "seo-content-optimizer", label: "SEO Content Optimizer", description: "test", capability: null, prompt: "seo prompt" },
    { skillId: "email-campaign-builder", label: "Email Campaign Builder", description: "test", capability: null, prompt: "email prompt" },
    { skillId: "competitive-analysis", label: "Competitive Analysis", description: "test", capability: null, prompt: "comp prompt" },
  ];

  it("returns all skills when rules is null", () => {
    const result = applyMarketingSkillRules(baseSkills, null);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.label)).toEqual(["SEO Content Optimizer", "Email Campaign Builder", "Competitive Analysis"]);
  });

  it("returns all skills when rules is empty object", () => {
    const result = applyMarketingSkillRules(baseSkills, {});
    expect(result).toHaveLength(3);
  });

  it("hides skills when visible is false", () => {
    const rules = {
      "seo-content-optimizer": { visible: false as const },
      "competitive-analysis": { visible: false as const },
    };
    const result = applyMarketingSkillRules(baseSkills, rules);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Email Campaign Builder");
  });

  it("relabels skills when label and reframe are provided", () => {
    const rules = {
      "competitive-analysis": { label: "Peer Landscape Review", reframe: "Focus on peer organizations" },
    };
    const result = applyMarketingSkillRules(baseSkills, rules);
    const comp = result.find((s) => s.skillId === "competitive-analysis")!;
    expect(comp.label).toBe("Peer Landscape Review");
    expect(comp.prompt).toContain("[ARCHETYPE CONTEXT: Focus on peer organizations]");
    expect(comp.prompt).toContain("comp prompt");
  });

  it("does not filter skills without skillId", () => {
    const skills: AgentSkill[] = [
      { label: "Report an issue", description: "test", capability: null, prompt: "issue prompt" },
    ];
    const rules = { "report-an-issue": { visible: false as const } };
    const result = applyMarketingSkillRules(skills, rules);
    expect(result).toHaveLength(1);
  });

  it("applies HOA rules correctly — hides SEO and competitive, relabels email", () => {
    const hoaRules = {
      "seo-content-optimizer": { visible: false as const },
      "competitive-analysis": { visible: false as const },
      "email-campaign-builder": {
        label: "Community Notice Builder",
        reframe: "Focus on official community communications",
      },
    };
    const result = applyMarketingSkillRules(baseSkills, hoaRules);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe("Community Notice Builder");
    expect(result[0].prompt).toContain("[ARCHETYPE CONTEXT: Focus on official community communications]");
  });

  it("applies nonprofit rules correctly — relabels all three", () => {
    const nonprofitRules = {
      "seo-content-optimizer": { label: "Cause Visibility Advisor", reframe: "mission awareness" },
      "competitive-analysis": { label: "Peer Landscape Review", reframe: "peer organizations" },
      "email-campaign-builder": { label: "Donor & Volunteer Communication Builder", reframe: "impact storytelling" },
    };
    const result = applyMarketingSkillRules(baseSkills, nonprofitRules);
    expect(result).toHaveLength(3);
    expect(result.map((s) => s.label)).toEqual([
      "Cause Visibility Advisor",
      "Donor & Volunteer Communication Builder",
      "Peer Landscape Review",
    ]);
  });
});
