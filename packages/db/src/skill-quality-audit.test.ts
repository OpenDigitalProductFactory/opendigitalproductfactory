import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { auditSkillMarkdown, summarizeSkillAudit } from "./skill-quality-audit";

describe("skill quality audit", () => {
  it("flags thin skills that are hard to route or execute consistently", () => {
    const result = auditSkillMarkdown({
      path: "skills/build/build-page.skill.md",
      content: `---
name: build-page
description: Scaffold a new page
triggerPattern: "build page|scaffold"
---

# Build a New Page

Ask what data it displays, then create it.
`,
    });

    expect(result.score).toBeLessThan(70);
    expect(result.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        "description-too-short",
        "trigger-pattern-too-narrow",
        "missing-routing-boundary",
        "missing-read-first-table",
        "missing-output-template",
        "missing-worked-example",
      ]),
    );
  });

  it("rewards skills with routing phrases, boundaries, read-first sources, templates, and examples", () => {
    const result = auditSkillMarkdown({
      path: "skills/docs/review-structure.skill.md",
      content: `---
name: review-structure
description: "Reviews project documents for structure, missing evidence, and cross-link quality when the user asks to review a doc, tighten a spec, or check whether a plan is ready; do not use for implementation work, use /code-review instead."
triggerPattern: "review doc|tighten spec|check plan|document structure"
---

# Review Structure

Critical rule: ground every finding in the target document.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Target doc | user-provided path | Headings, decisions, evidence, and open questions |

## Steps

1. Read the target document.
2. Check for missing source references.
3. Return blockers first.

## Output Template

- Blockers:
- Improvements:
- Ready status:

## Example

Input: Review docs/superpowers/specs/example.md
Output: Blockers first, each with a document reference and a concrete fix.
`,
    });

    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.findings).toEqual([]);
  });

  it("summarizes a repo-wide audit by worst score first", () => {
    const weak = auditSkillMarkdown({
      path: "skills/workspace/create-task.skill.md",
      content: `---
name: create-task
description: Create task
---

# Create Task

Create a task.
`,
    });
    const strong = auditSkillMarkdown({
      path: "skills/docs/review-structure.skill.md",
      content: `---
name: review-structure
description: "Reviews project documents for structure, missing evidence, and cross-link quality when the user asks to review a doc, tighten a spec, or check whether a plan is ready; do not use for implementation work, use /code-review instead."
triggerPattern: "review doc|tighten spec|check plan|document structure"
---

# Review Structure

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Target doc | docs/**/*.md | Structure and evidence |

## Output Template

- Blockers:

## Example

Input: Review a spec.
Output: Blockers first.
`,
    });

    const summary = summarizeSkillAudit([strong, weak]);

    expect(summary.totalSkills).toBe(2);
    expect(summary.failingSkills).toBe(1);
    expect(summary.results[0].path).toBe("skills/workspace/create-task.skill.md");
  });

  it("keeps high-impact Build Studio and universal skills above the quality bar", () => {
    const skillPaths = [
      "skills/build/start-feature.skill.md",
      "skills/build/build-page.skill.md",
      "skills/build/design-component.skill.md",
      "skills/build/manage-sandbox.skill.md",
      "skills/build/check-status.skill.md",
      "skills/build/ship-feature.skill.md",
      "skills/universal/analyze-page.skill.md",
      "skills/universal/do-primary-action.skill.md",
      "skills/universal/evaluate-page.skill.md",
      "skills/universal/report-issue.skill.md",
      "skills/universal/add-skill.skill.md",
    ];

    const rootDir = join(__dirname, "..", "..", "..");
    const results = skillPaths.map((path) => auditSkillMarkdown({
      path,
      content: readFileSync(join(rootDir, path), "utf-8"),
    }));

    expect(results.map((result) => ({
      path: result.path,
      score: result.score,
      findings: result.findings.map((finding) => finding.code),
    }))).toEqual(
      results.map((result) => ({
        path: result.path,
        score: expect.any(Number),
        findings: [],
      })),
    );
    expect(results.every((result) => result.score >= 80)).toBe(true);
  });
});
