import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

describe("no coworker's agent-invocable set exceeds the cap (BI-8AD9D018)", () => {
  // rankSkillsByRelevance silently drops past DEFAULT_SKILL_SUMMARY_CAP. That
  // is correct behaviour for a runaway set, but a coworker that sits over the
  // cap in the SEEDED corpus is shedding skills on every turn with nothing
  // saying so — portfolio-advisor was eligible for 17 before this guard.
  //
  // Reads the shipped .skill.md corpus rather than the database so the check
  // runs in CI without a seeded install: the files are what the seed loads.
  const skillsDir = join(__dirname, "..", "..", "..", "..", "skills");

  function eligibleByCoworker() {
    const files = globSync("**/*.skill.md", { cwd: skillsDir }).map((rel) => join(skillsDir, rel));
    expect(files.length).toBeGreaterThan(0);

    const parsed = files.map((filePath) => {
      const frontmatter = readFileSync(filePath, "utf8").split("---")[1] ?? "";
      const assignTo = /^assignTo: \[(.*)\]/m.exec(frontmatter)?.[1] ?? "";
      return {
        file: filePath,
        roles: assignTo.replace(/"/g, "").split(",").map((role) => role.trim()).filter(Boolean),
        // Absent means true: the loader's default is agent-invocable.
        agentInvocable: !/^agentInvocable: false$/m.test(frontmatter),
      };
    });

    const wildcard = parsed.filter((s) => s.roles.includes("*") && s.agentInvocable).length;
    const roles = new Set(parsed.flatMap((s) => s.roles).filter((role) => role !== "*"));

    return [...roles].map((role) => ({
      role,
      eligible: parsed.filter((s) => s.roles.includes(role) && s.agentInvocable).length + wildcard,
    }));
  }

  it("keeps every coworker at or under DEFAULT_SKILL_SUMMARY_CAP", () => {
    const over = eligibleByCoworker()
      .filter((entry) => entry.eligible > DEFAULT_SKILL_SUMMARY_CAP)
      .map((entry) => `${entry.role}: ${entry.eligible}`);

    expect(over).toEqual([]);
  });
});
