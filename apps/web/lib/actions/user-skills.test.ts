import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    userSkill: {
      create: vi.fn().mockResolvedValue({ skillId: "SK-00000001", name: "Test Skill" }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ skillId: "SK-00000001", createdById: "user-1" }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([{ teamId: "team-1" }]),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
  }),
}));

describe("user skill CRUD", () => {
  it("generateSkillId returns SK-XXXXXXXX format (8 chars for collision safety)", async () => {
    const { generateSkillId } = await import("./user-skills");
    const id = await generateSkillId();
    expect(id).toMatch(/^SK-[A-Z0-9]{8}$/);
  });

  it("generates unique IDs on successive calls", async () => {
    const { generateSkillId } = await import("./user-skills");
    const ids = new Set(await Promise.all(Array.from({ length: 100 }, () => generateSkillId())));
    expect(ids.size).toBe(100);
  });

  it("createUserSkill saves intent-based skill", async () => {
    const { createUserSkill } = await import("./user-skills");
    const result = await createUserSkill({
      name: "Import employees",
      intent: "Parse spreadsheet and create employee records",
      visibility: "personal",
    });
    expect(result).toHaveProperty("skillId");
  });

  it("getUserSkillsForDropdown returns array", async () => {
    const { getUserSkillsForDropdown } = await import("./user-skills");
    const skills = await getUserSkillsForDropdown({ routeHint: "/employee" });
    expect(Array.isArray(skills)).toBe(true);
  });
});
