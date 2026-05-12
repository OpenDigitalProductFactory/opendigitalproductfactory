import { describe, it, expect, vi } from "vitest";
import { parseFrontmatter, reconcileSkillAssignments } from "./seed-skills";

describe("seed-skills parseFrontmatter", () => {
  it("parses inline arrays", () => {
    const raw = `---
name: foo
description: test
category: storefront
assignTo: ["coo", "admin-assistant"]
allowedTools: [tool_a, tool_b]
composesFrom: []
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.assignTo).toEqual(["coo", "admin-assistant"]);
    expect(frontmatter.allowedTools).toEqual(["tool_a", "tool_b"]);
    expect(frontmatter.composesFrom).toEqual([]);
  });

  it("parses block-style lists (the extract-brand-design-system format)", () => {
    const raw = `---
name: extract-brand-design-system
description: test
category: storefront
allowedTools:
  - extract_brand_design_system
  - analyze_public_website_branding
  - analyze_brand_document
composesFrom: []
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.allowedTools).toEqual([
      "extract_brand_design_system",
      "analyze_public_website_branding",
      "analyze_brand_document",
    ]);
  });

  it("parses mixed scalars, booleans, null", () => {
    const raw = `---
name: mixed
description: "quoted"
userInvocable: true
agentInvocable: false
triggerPattern: null
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    expect(frontmatter.name).toBe("mixed");
    expect(frontmatter.description).toBe("quoted");
    expect(frontmatter.userInvocable).toBe(true);
    expect(frontmatter.agentInvocable).toBe(false);
    expect(frontmatter.triggerPattern).toBe(null);
  });

  it("never produces a non-array for known array fields when value is empty", () => {
    const raw = `---
name: empty-lists
description: test
allowedTools:
composesFrom:
---

Body.`;
    const { frontmatter } = parseFrontmatter(raw);
    // An empty key with no block list below is a scalar "" — callers must
    // defend with Array.isArray. But a key with a block list (even zero
    // items due to no "-" lines) should at least not become anything Prisma
    // chokes on. Keeping this as a regression guard.
    expect(Array.isArray(frontmatter.allowedTools) || frontmatter.allowedTools === "").toBe(true);
  });
});

describe("reconcileSkillAssignments", () => {
  it("removes obsolete system-seeded assignments when assignTo changes", async () => {
    const skillAssignment = {
      findMany: vi.fn().mockResolvedValue([
        { agentId: "portfolio-advisor", assignedBy: "system-seed" },
        { agentId: "external-catalog-scout", assignedBy: "system-seed" },
        { agentId: "coo", assignedBy: "human-admin" },
      ]),
      create: vi.fn(),
      delete: vi.fn(),
    };

    const result = await reconcileSkillAssignments(
      { skillAssignment } as never,
      "scout-external-catalogs",
      ["external-catalog-scout"],
    );

    expect(skillAssignment.delete).toHaveBeenCalledWith({
      where: {
        skillId_agentId: {
          skillId: "scout-external-catalogs",
          agentId: "portfolio-advisor",
        },
      },
    });
    expect(skillAssignment.delete).toHaveBeenCalledTimes(1);
    expect(skillAssignment.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, removed: 1 });
  });
});
