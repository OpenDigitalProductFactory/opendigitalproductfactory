import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { parseFrontmatter } from "./seed-skills";

// BI-SKILL-AUTHORING. The rules that govern the skill corpus were, until now,
// enforced ONLY as failing guards — an author discovered them by tripping a
// ratchet, never by reading anything. dpf-writing-skills is where they are
// written down, so these assertions pin that the written rules and the
// mechanical ones stay the same rules.
const repoRoot = join(__dirname, "..", "..", "..");
const practicePath = join(
  repoRoot, "packages", "dpf-skill-pack", "skills", "dpf-writing-skills", "SKILL.md",
);

describe("dpf-writing-skills documents what the guards enforce", () => {
  const raw = readFileSync(practicePath, "utf-8");
  const { frontmatter, body } = parseFrontmatter(raw);

  it("names the per-turn cap constant that makes an assignment expensive", () => {
    expect(body).toContain("DEFAULT_SKILL_SUMMARY_CAP");
  });

  it("warns that a wildcard assignment charges every coworker", () => {
    expect(body).toMatch(/SKILL_WILDCARD_AGENT_IDS/);
    expect(body).toMatch(/\["\*"\]/);
  });

  it("tells the author the instruction plane is shrink-only", () => {
    // The single most surprising failure for a new skill: it fails CI on
    // arrival because the plane is already at its baseline.
    expect(body).toContain("check-instruction-plane-size");
    expect(body).toMatch(/shrink only|shrink-only/i);
  });

  it("states that a description is a trigger rather than documentation", () => {
    expect(body).toMatch(/trigger, not documentation/i);
  });

  it("points at the substrate check before an existing skill is changed", () => {
    // The BI-5E8E231E lesson: skills carry contracts invisible in the file.
    expect(body).toContain("dpf-verify-substrate-first");
    expect(body).toContain("BI-5E8E231E");
  });

  it("is itself assigned narrowly rather than to the wildcard it warns about", () => {
    // A skill that teaches the cost model and then charges all 31 coworkers
    // would be advice its own author did not take.
    expect(frontmatter.assignTo).not.toContain("*");
    expect(Array.isArray(frontmatter.assignTo)).toBe(true);
  });
});

describe("the coworker-plane authoring skill routes to the practice", () => {
  it("add-skill points at dpf-writing-skills and states the assignment cost", () => {
    const addSkill = readFileSync(join(repoRoot, "skills", "universal", "add-skill.skill.md"), "utf-8");

    expect(addSkill).toContain("dpf-writing-skills");
    expect(addSkill).toMatch(/twelve per-turn skill slots|per-turn skill slots/);
    expect(addSkill).toMatch(/all 31 coworkers/);
  });
});
