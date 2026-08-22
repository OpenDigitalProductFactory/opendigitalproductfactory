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

describe("per-coworker eligible-set ratchet (BI-8AD9D018, corrected by BI-4B0C27D4)", () => {
  // rankSkillsByRelevance silently drops past DEFAULT_SKILL_SUMMARY_CAP. A
  // coworker over the cap in the SEEDED corpus is therefore shedding skills on
  // every turn with nothing saying so.
  //
  // TWO PLANES, NOT ONE. The first version of this guard read only skills/**
  // and certified a bound it could not see: packages/db/src/seed-skills.ts
  // loads BOTH that corpus AND packages/dpf-skill-pack/skills/*/SKILL.md into
  // SkillAssignment, so a pack skill with assignTo ["*"] was eligible for every
  // coworker too. Real sets were 16-32 while this guard reported them under 12.
  //
  // A RATCHET, NOT THE CAP. After BI-4B0C27D4's rescoping every business
  // coworker sits well under 12, but three dev-facing roles legitimately hold
  // more dev skills than that — for them the ranker doing its job is the
  // correct behaviour, not a defect. Asserting the hard cap would either fail
  // forever or force a dishonest demotion, so this pins a per-role baseline
  // that may SHRINK and never grow. Same contract as the repo's other
  // baselines: pre-existing weight is not failed, new weight is.
  const repoRoot = join(__dirname, "..", "..", "..", "..");

  /** Frozen per-role eligible counts. Lower a number when you genuinely reduce
   *  a role's set; never raise one without saying why in the PR. */
  const ELIGIBLE_BASELINE: Record<string, number> = {
    "admin-assistant": 2,
    "build-specialist": 25,
    "compliance-officer": 5,
    coo: 8,
    "customer-advisor": 5,
    "data-architect": 4,
    "doc-specialist": 6,
    "documentation-specialist": 6,
    "ea-architect": 12,
    "external-catalog-scout": 3,
    "external-coding-agent": 18,
    "farm-ranch-steward": 2,
    "hr-specialist": 4,
    "inventory-specialist": 9,
    "market-research-analyst": 3,
    "marketing-specialist": 8,
    "onboarding-coo": 2,
    "ops-coordinator": 12,
    "platform-engineer": 32,
    "portfolio-advisor": 10,
    "software-engineer": 10,
  };

  function eligibleByCoworker(): Map<string, number> {
    const files = [
      ...globSync("skills/**/*.skill.md", { cwd: repoRoot }),
      ...globSync("packages/dpf-skill-pack/skills/*/SKILL.md", { cwd: repoRoot }),
    ].map((rel) => join(repoRoot, rel));
    expect(files.length).toBeGreaterThan(0);

    const parsed = files.map((filePath) => {
      const frontmatter = readFileSync(filePath, "utf8").split("---")[1] ?? "";
      const assignTo = /^assignTo: \[(.*)\]/m.exec(frontmatter)?.[1] ?? "";
      return {
        roles: assignTo.replace(/"/g, "").split(",").map((role) => role.trim()).filter(Boolean),
        // Mirrors normalizeSkillFrontmatterForSeed: an explicit agentInvocable
        // wins; absent, the loader derives it from disable-model-invocation, so
        // a file carrying only the Surface A field still resolves correctly.
        agentInvocable: /^agentInvocable:\s*(true|false)$/m.test(frontmatter)
          ? /^agentInvocable:\s*true$/m.test(frontmatter)
          : !/^disable-model-invocation:\s*true$/m.test(frontmatter),
      };
    });

    const wildcard = parsed.filter((s) => s.roles.includes("*") && s.agentInvocable).length;
    const roles = new Set(parsed.flatMap((s) => s.roles).filter((role) => role !== "*"));

    return new Map([...roles].map((role) => [
      role,
      parsed.filter((s) => s.roles.includes(role) && s.agentInvocable).length + wildcard,
    ]));
  }

  it("counts BOTH planes — a pack skill assigned to a coworker reaches that coworker", () => {
    // The blind spot this replaces. dpf-tdd is a pack skill; if the guard only
    // read skills/**, it would score zero for a role that actually holds it.
    const eligible = eligibleByCoworker();
    expect(eligible.get("build-specialist")).toBeGreaterThan(10);
  });

  it("no role's eligible set grew past its baseline", () => {
    const grew = [...eligibleByCoworker().entries()]
      .filter(([role, count]) => count > (ELIGIBLE_BASELINE[role] ?? 0))
      .map(([role, count]) => `${role}: ${count} > ${ELIGIBLE_BASELINE[role] ?? 0}`);

    expect(grew).toEqual([]);
  });

  it("keeps every non-dev coworker under the per-turn cap", () => {
    // The roles that were paying for dev skills they never invoke. Unlike the
    // dev roles, there is no honest reason for these to sit over the cap.
    const eligible = eligibleByCoworker();
    const businessRoles = [
      "marketing-specialist", "inventory-specialist", "portfolio-advisor",
      "customer-advisor", "hr-specialist", "compliance-officer",
      "admin-assistant", "onboarding-coo", "farm-ranch-steward",
    ];

    const over = businessRoles
      .filter((role) => (eligible.get(role) ?? 0) > DEFAULT_SKILL_SUMMARY_CAP)
      .map((role) => `${role}: ${eligible.get(role)}`);

    expect(over).toEqual([]);
  });
});
