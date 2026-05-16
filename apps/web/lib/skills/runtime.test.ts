import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@dpf/db", () => ({
  prisma: {
    skillAssignment: {
      findMany,
    },
  },
}));

import {
  compileSkillInvocationPrompt,
  extractInvokedSkillId,
  extractSkillBody,
  getSkillsForAgent,
  renderSkillsPromptBlock,
  toSkillSummariesForPrompt,
} from "./runtime";

describe("extractSkillBody", () => {
  it("strips YAML frontmatter and returns the body", () => {
    const md = `---\nname: build-page\ndescription: Build a page\n---\n\n# Build a Page\n\nDo the thing.\n`;
    expect(extractSkillBody(md)).toBe("# Build a Page\n\nDo the thing.");
  });

  it("returns the full content untouched when no frontmatter is present", () => {
    const md = `Just a body, no frontmatter.\n`;
    expect(extractSkillBody(md)).toBe("Just a body, no frontmatter.");
  });

  it("normalises CRLF input", () => {
    const md = "---\r\nname: x\r\n---\r\n\r\nBody.\r\n";
    expect(extractSkillBody(md)).toBe("Body.");
  });
});

describe("compileSkillInvocationPrompt", () => {
  it("emits the canonical invocation marker as the first model-visible line", () => {
    const prompt = compileSkillInvocationPrompt({
      skillId: "build-page",
      description: "Build a page",
      skillMdContent: "---\nname: build-page\n---\n\nBody.",
      taskType: "code_generation",
      allowedTools: ["read_project_file"],
    });
    expect(prompt.startsWith("Use the `build-page` skill.")).toBe(true);
    expect(prompt).toContain("Body.");
    expect(prompt).not.toContain("name: build-page");
  });

  it("prepends the conversation disclaimer when no tools are allowed", () => {
    const prompt = compileSkillInvocationPrompt({
      skillId: "explain-finance",
      description: "Explain finance posture",
      skillMdContent: "Body.",
      taskType: "conversation",
      allowedTools: [],
    });
    expect(prompt.startsWith("This is a CONVERSATION request, not a tool request.")).toBe(true);
    expect(prompt).toContain("Use the `explain-finance` skill.");
  });
});

describe("extractInvokedSkillId", () => {
  it("returns the skill id from the canonical invocation line", () => {
    expect(extractInvokedSkillId("Use the `build-page` skill.\n\nSkill description: ...")).toBe(
      "build-page",
    );
  });

  it("tolerates a leading conversation-disclaimer line", () => {
    expect(
      extractInvokedSkillId(
        "This is a CONVERSATION request, not a tool request.\n\nUse the `explain-finance` skill.\n\nSkill description: ...",
      ),
    ).toBe("explain-finance");
  });

  it("returns null for ordinary user input", () => {
    expect(extractInvokedSkillId("Can you help me plan this?")).toBeNull();
  });

  it("returns null when the marker appears mid-sentence (no false positives)", () => {
    expect(extractInvokedSkillId("I will use the `foo` skill later.")).toBeNull();
  });
});

describe("renderSkillsPromptBlock", () => {
  it("renders one bullet per skill", () => {
    const block = renderSkillsPromptBlock([
      { skillId: "a", label: "Skill A", description: "Does A." },
      { skillId: "b", label: "Skill B", description: "Does B." },
    ]);
    expect(block).toBe(
      "Available coworker skills:\n- a: Skill A - Does A.\n- b: Skill B - Does B.",
    );
  });

  it("returns an empty string when no skills are eligible", () => {
    expect(renderSkillsPromptBlock([])).toBe("");
  });
});

describe("getSkillsForAgent", () => {
  beforeEach(() => {
    findMany.mockReset();
  });

  it("returns DB-backed skills with compiled prompts", async () => {
    findMany.mockResolvedValue([
      {
        skill: {
          skillId: "build-page",
          name: "Build a Page",
          description: "Scaffold a new route page",
          capability: "view_platform",
          skillMdContent: "---\nname: build-page\n---\n\nBody.",
          category: "build",
          tags: ["build", "ui"],
          riskBand: "low",
          taskType: "code_generation",
          triggerPattern: null,
          userInvocable: true,
          agentInvocable: true,
          allowedTools: ["read_project_file"],
        },
      },
    ]);

    const skills = await getSkillsForAgent("build-specialist");
    expect(skills).toHaveLength(1);
    expect(skills[0]?.skillId).toBe("build-page");
    expect(skills[0]?.prompt).toContain("Use the `build-page` skill.");
    expect(skills[0]?.tags).toEqual(["build", "ui"]);
  });

  it("returns an empty list when the DB call throws", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    await expect(getSkillsForAgent("any")).resolves.toEqual([]);
  });
});

describe("toSkillSummariesForPrompt", () => {
  it("projects to the prompt-summary shape", () => {
    expect(
      toSkillSummariesForPrompt([
        {
          skillId: "a",
          label: "A",
          description: "Does A.",
          capability: null,
          prompt: "...",
          category: "x",
          tags: [],
          riskBand: "low",
          taskType: "conversation",
          triggerPattern: null,
          userInvocable: true,
          agentInvocable: true,
          allowedTools: [],
        },
      ]),
    ).toEqual([{ skillId: "a", label: "A", description: "Does A." }]);
  });
});
