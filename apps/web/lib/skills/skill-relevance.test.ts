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
import { MANDATED_DECISION_SKILL_IDS } from "@dpf/db/mandated-skills";

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

describe("skill-eligibility ratchet (BI-8AD9D018, corrected by BI-4B0C27D4)", () => {
  // rankSkillsByRelevance silently drops past DEFAULT_SKILL_SUMMARY_CAP, so a
  // coworker over the cap in the SEEDED corpus sheds skills every turn with
  // nothing saying so.
  //
  // TWO PLANES, NOT ONE. The first version of this guard read only skills/**
  // and certified a bound it could not see: packages/db/src/seed-skills.ts
  // loads BOTH that corpus AND packages/dpf-skill-pack/skills/*/SKILL.md into
  // SkillAssignment, so a pack skill with assignTo ["*"] reached every coworker
  // too. Real sets were 16-32 while this guard reported them under 12.
  //
  // WHY THIS RATCHETS INSTEAD OF ASSERTING THE CAP. Two live contracts pull
  // against each other:
  //   - BI-5E8E231E requires the four decision skills to stay assignTo ["*"],
  //     so every persona inherits the WWMD/WWWD stack.
  //   - DEFAULT_SKILL_SUMMARY_CAP is 12.
  // With those four plus the two universal UI skills, SIX of every coworker's
  // twelve slots are spoken for before it owns a single skill of its own. Any
  // role with more than six role-scoped skills is therefore over cap BY
  // CONSTRUCTION, and no assignment edit can fix that — only changing one of
  // the two contracts can. Asserting the cap here would fail forever or force a
  // dishonest demotion of skills a role genuinely needs.
  //
  // So this guards the part that is actually ours to control: the WILDCARD set,
  // which is the tax every coworker pays, plus a per-role baseline that may
  // shrink and never grow.
  const repoRoot = join(__dirname, "..", "..", "..", "..");

  /** The shared tax. Every entry here costs a slot on EVERY coworker, so this
   *  number is the one that must not drift upward. It was 16. */
  const WILDCARD_BASELINE = 6;

  /** Frozen per-role eligible counts. Lower one when you genuinely reduce a
   *  role's set; never raise one without saying why in the PR. */
  const ELIGIBLE_BASELINE: Record<string, number> = {
    "admin-assistant": 6,
    "build-specialist": 29,
    // 9 -> 10: compliance-requirements-review was added to back
    // svc-compliance-pci-requirements, whose backingSkillId resolved to nothing
    // (BI-5C1978C7) — an advertised service with no skill behind it. The raise is
    // additive capability, not drift, and 10 still sits under
    // DEFAULT_SKILL_SUMMARY_CAP (12), so the whole set is presentable in one turn
    // and no skill becomes unreachable. Peers run 14-32.
    "compliance-officer": 10,
    coo: 8,
    "customer-advisor": 9,
    "data-architect": 8,
    "doc-specialist": 10,
    "documentation-specialist": 10,
    "ea-architect": 12,
    "external-catalog-scout": 7,
    "external-coding-agent": 18,
    "farm-ranch-steward": 6,
    "hr-specialist": 8,
    "inventory-specialist": 13,
    "market-research-analyst": 7,
    "marketing-specialist": 12,
    "onboarding-coo": 6,
    "ops-coordinator": 12,
    "platform-engineer": 32,
    "portfolio-advisor": 14,
    "software-engineer": 14,
  };

  function parseCorpus() {
    const files = [
      ...globSync("skills/**/*.skill.md", { cwd: repoRoot }),
      ...globSync("packages/dpf-skill-pack/skills/*/SKILL.md", { cwd: repoRoot }),
    ].map((rel) => join(repoRoot, rel));
    expect(files.length).toBeGreaterThan(0);

    return files.map((filePath) => {
      const frontmatter = readFileSync(filePath, "utf8").split("---")[1] ?? "";
      const assignTo = /^assignTo: \[(.*)\]/m.exec(frontmatter)?.[1] ?? "";
      return {
        roles: assignTo.replace(/"/g, "").split(",").map((role) => role.trim()).filter(Boolean),
        // Mirrors normalizeSkillFrontmatterForSeed: an explicit agentInvocable
        // wins; absent, the loader derives it from disable-model-invocation.
        agentInvocable: /^agentInvocable:\s*(true|false)$/m.test(frontmatter)
          ? /^agentInvocable:\s*true$/m.test(frontmatter)
          : !/^disable-model-invocation:\s*true$/m.test(frontmatter),
      };
    });
  }

  function eligibleByCoworker(): Map<string, number> {
    const parsed = parseCorpus();
    const wildcard = parsed.filter((s) => s.roles.includes("*") && s.agentInvocable).length;
    const roles = new Set(parsed.flatMap((s) => s.roles).filter((role) => role !== "*"));

    return new Map([...roles].map((role) => [
      role,
      parsed.filter((s) => s.roles.includes(role) && s.agentInvocable).length + wildcard,
    ]));
  }

  it("counts BOTH planes — a pack skill assigned to a coworker reaches that coworker", () => {
    // The blind spot this replaces. dpf-tdd is a pack skill; a guard reading
    // only skills/** would score zero for a role that actually holds it.
    expect(eligibleByCoworker().get("build-specialist")).toBeGreaterThan(10);
  });

  it("the wildcard set — the tax every coworker pays — has not grown", () => {
    const parsed = parseCorpus();
    const wildcard = parsed.filter((s) => s.roles.includes("*") && s.agentInvocable);

    expect(wildcard.length).toBeLessThanOrEqual(WILDCARD_BASELINE);
  });

  it("leaves at least half the per-turn cap for a coworker's own skills", () => {
    // The wildcard set is a floor under every coworker. If it ever eats most of
    // the cap, role skills stop being reachable no matter how they are scoped —
    // which is the failure mode BI-4B0C27D4 found at 16 wildcards against a
    // cap of 12.
    const parsed = parseCorpus();
    const wildcard = parsed.filter((s) => s.roles.includes("*") && s.agentInvocable).length;

    expect(wildcard).toBeLessThanOrEqual(Math.floor(DEFAULT_SKILL_SUMMARY_CAP / 2));
  });

  it("no role's eligible set grew past its baseline", () => {
    const grew = [...eligibleByCoworker().entries()]
      .filter(([role, count]) => count > (ELIGIBLE_BASELINE[role] ?? 0))
      .map(([role, count]) => `${role}: ${count} > ${ELIGIBLE_BASELINE[role] ?? 0}`);

    expect(grew).toEqual([]);
  });
});

describe("mandated skills are pinned, not ranked (BI-43920DD1)", () => {
  // The measured failure: an inventory-specialist turn about stock has no
  // vocabulary overlap with the decision stack, so before the pin the four
  // mandated skills lost every slot to the role's own skills. 61.4% of 1,175
  // real turns on the live install dropped at least one this way.
  const irrelevantTurn = "how many blue widgets are left in the warehouse";

  function corpus(roleSkillCount: number): RankableSkill[] {
    return [
      ...MANDATED_DECISION_SKILL_IDS.map((id) => skill(id, { category: "decision" })),
      ...Array.from({ length: roleSkillCount }, (_, i) =>
        skill(`stock-skill-${i}`, {
          label: `Warehouse widgets ${i}`,
          description: "blue widgets left in the warehouse stock count",
          tags: ["inventory"],
        }),
      ),
    ];
  }

  it("keeps every mandated skill on a turn that matches none of them", () => {
    const kept = rankSkillsByRelevance(corpus(20), irrelevantTurn).map((s) => s.skillId);

    for (const id of MANDATED_DECISION_SKILL_IDS) expect(kept).toContain(id);
  });

  it("pinning spends slots rather than adding them — the cap still holds", () => {
    // Raising the cap was the option the kernel rejected (DI-E68BCB1767BD): it
    // taxes every coworker's turn, worst on the local models this platform targets.
    // If pinning ever grows the output, that rejected cost arrives by the back door.
    expect(rankSkillsByRelevance(corpus(20), irrelevantTurn)).toHaveLength(
      DEFAULT_SKILL_SUMMARY_CAP,
    );
  });

  it("still fills the remaining slots by relevance", () => {
    const kept = rankSkillsByRelevance(corpus(20), irrelevantTurn).map((s) => s.skillId);
    const contested = kept.filter((id) => !MANDATED_DECISION_SKILL_IDS.includes(id));

    expect(contested).toHaveLength(DEFAULT_SKILL_SUMMARY_CAP - MANDATED_DECISION_SKILL_IDS.length);
    // Every one of them scored on this turn — the pin did not displace relevance.
    for (const id of contested) expect(id).toMatch(/^stock-skill-/);
  });

  it("returns the mandated stack ahead of the ranked remainder", () => {
    const kept = rankSkillsByRelevance(corpus(20), irrelevantTurn).map((s) => s.skillId);

    expect(kept.slice(0, MANDATED_DECISION_SKILL_IDS.length)).toEqual([
      ...MANDATED_DECISION_SKILL_IDS,
    ]);
  });

  it("changes nothing for a set already within the cap", () => {
    // The regression guard the original ranker documented: a small-set coworker
    // must come back byte-for-byte unchanged. Agents at or under the cap were the
    // ones that never dropped a mandated skill in the measurement, and they must
    // stay that way.
    const small = corpus(4);
    expect(rankSkillsByRelevance(small, irrelevantTurn)).toBe(small);
  });

  it("keeps the mandate whole when it alone would exceed the cap", () => {
    const kept = rankSkillsByRelevance(corpus(20), irrelevantTurn, 3).map((s) => s.skillId);

    expect(kept).toEqual([...MANDATED_DECISION_SKILL_IDS].slice(0, 3));
  });

  it("does not duplicate a mandated skill that is also the most relevant", () => {
    const onTopic = "which option should we choose — compare the options";
    const kept = rankSkillsByRelevance(corpus(20), onTopic).map((s) => s.skillId);

    expect(new Set(kept).size).toBe(kept.length);
  });
});
