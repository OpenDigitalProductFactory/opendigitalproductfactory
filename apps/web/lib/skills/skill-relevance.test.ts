import { describe, it, expect } from "vitest";
import {
  rankSkillsByRelevance,
  scoreSkillRelevance,
  tokenize,
  DEFAULT_SKILL_SUMMARY_CAP,
  type RankableSkill,
} from "./skill-relevance";

function skill(id: string, over: Partial<RankableSkill> = {}): RankableSkill {
  return {
    skillId: id,
    label: id,
    description: "",
    category: "general",
    tags: [],
    triggerPattern: null,
    ...over,
  };
}

describe("tokenize", () => {
  it("lowercases, splits, drops short tokens and stopwords", () => {
    expect(tokenize("Draft the QUARTERLY invoice for you")).toEqual([
      "draft",
      "quarterly",
      "invoice",
    ]);
  });
});

describe("scoreSkillRelevance", () => {
  it("counts distinct query tokens found in the skill's searchable text", () => {
    const s = skill("invoicing", { label: "Invoice drafting", description: "quarterly billing", tags: ["finance"] });
    const q = new Set(tokenize("draft a quarterly invoice"));
    expect(scoreSkillRelevance(s, q, "draft a quarterly invoice")).toBe(2); // invoice + quarterly
  });

  it("adds a bonus when the trigger pattern matches the raw query", () => {
    const s = skill("deploy", { triggerPattern: "\\bship\\b" });
    const q = new Set(tokenize("can we ship it"));
    expect(scoreSkillRelevance(s, q, "can we ship it")).toBeGreaterThanOrEqual(4);
  });

  it("ignores an invalid stored trigger pattern without throwing", () => {
    const s = skill("x", { triggerPattern: "(" });
    expect(() => scoreSkillRelevance(s, new Set(["a"]), "a")).not.toThrow();
  });
});

describe("rankSkillsByRelevance", () => {
  it("returns the set unchanged when at or below the cap (regression guard)", () => {
    const skills = Array.from({ length: DEFAULT_SKILL_SUMMARY_CAP }, (_, i) => skill(`s${i}`));
    const out = rankSkillsByRelevance(skills, "anything", DEFAULT_SKILL_SUMMARY_CAP);
    expect(out).toBe(skills); // identity — no copy, no reorder
  });

  it("keeps the top-N by relevance when the set exceeds the cap", () => {
    const skills: RankableSkill[] = [
      skill("greet", { description: "say hello" }),
      skill("invoice", { description: "billing invoice finance", tags: ["invoice"] }),
      skill("weather", { description: "forecast" }),
      skill("refund", { description: "process a refund invoice" }),
    ];
    const out = rankSkillsByRelevance(skills, "help me with an invoice", 2);
    expect(out).toHaveLength(2);
    const ids = out.map((s) => s.skillId);
    expect(ids).toContain("invoice");
    expect(ids).toContain("refund");
    expect(ids).not.toContain("weather");
  });

  it("breaks ties by original (priority) order for an irrelevant query", () => {
    const skills = Array.from({ length: 20 }, (_, i) => skill(`p${i}`));
    const out = rankSkillsByRelevance(skills, "zzz no matches here", 3);
    expect(out.map((s) => s.skillId)).toEqual(["p0", "p1", "p2"]);
  });
});
