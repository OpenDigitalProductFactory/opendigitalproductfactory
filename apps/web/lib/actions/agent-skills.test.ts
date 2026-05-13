import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    skillAssignment: {
      findMany,
    },
  },
}));

describe("agent skill loading", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("compiles DB-backed skills from the full SKILL.md body, not just the first paragraph", async () => {
    findMany.mockResolvedValue([
      {
        skill: {
          skillId: "build-page",
          name: "build-page",
          description: "Build a new page using route context and DPF UI standards",
          capability: "view_platform",
          skillMdContent: `---
name: build-page
description: Build a new page using route context and DPF UI standards
category: build
---

# Build a New Page

Short summary that used to be the only loaded prompt.

## Read First

| Source | Path | What to extract |
| --- | --- | --- |
| Route patterns | apps/web/app/(shell) | Layout and loading-state conventions |

## Steps

1. Read the existing route structure.
2. Generate the page with theme-aware DPF tokens.
3. Verify it renders without layout overlap.
`,
          category: "build",
          tags: [],
          riskBand: "low",
          taskType: "code_generation",
          triggerPattern: "build page|scaffold page|new page",
          userInvocable: true,
          agentInvocable: true,
          allowedTools: ["read_project_file"],
        },
      },
    ]);

    const { getSkillsForAgentLegacy } = await import("./agent-skills");
    const [skill] = await getSkillsForAgentLegacy("build-specialist");

    expect(skill.prompt).toContain("Use the `build-page` skill");
    expect(skill.prompt).toContain("## Read First");
    expect(skill.prompt).toContain("## Steps");
    expect(skill.prompt).toContain("theme-aware DPF tokens");
    expect(skill.prompt).not.toContain("name: build-page");
  });
});
