import { describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
const { existsSyncMock, readFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    skillDefinition: { findUnique },
  },
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
}));

import { getSkillSeedDrift, resolveSeedPath } from "./seed-parity";

describe("resolveSeedPath", () => {
  it("derives the seed path from category and skillId", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    const p = resolveSeedPath("build", "build-page");
    expect(p.replace(/\\/g, "/")).toBe("/repo/skills/build/build-page.skill.md");
  });
});

describe("getSkillSeedDrift", () => {
  it("returns inSync: false when the skill is missing from the DB", async () => {
    findUnique.mockResolvedValueOnce(null);
    const result = await getSkillSeedDrift("nonexistent");
    expect(result.inSync).toBe(false);
    expect(result.dbBody).toBeNull();
    expect(result.seedBody).toBeNull();
  });

  it("returns inSync: true when DB and seed match (after CRLF normalisation)", async () => {
    findUnique.mockResolvedValueOnce({
      skillId: "build-page",
      category: "build",
      skillMdContent: "# Build a page\n\nDo the thing.\n",
    });
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce("# Build a page\r\n\r\nDo the thing.\r\n");
    const result = await getSkillSeedDrift("build-page");
    expect(result.inSync).toBe(true);
    expect(result.dbBody).toContain("Build a page");
    expect(result.seedBody).toContain("Build a page");
  });

  it("returns inSync: false when DB has drifted from the seed", async () => {
    findUnique.mockResolvedValueOnce({
      skillId: "build-page",
      category: "build",
      skillMdContent: "# Build a page\n\nDo the new thing.\n",
    });
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockReturnValueOnce("# Build a page\n\nDo the original thing.\n");
    const result = await getSkillSeedDrift("build-page");
    expect(result.inSync).toBe(false);
    expect(result.dbBody).toContain("new thing");
    expect(result.seedBody).toContain("original thing");
  });

  it("returns seedBody: null when the seed file is not present", async () => {
    findUnique.mockResolvedValueOnce({
      skillId: "internal-only",
      category: "build",
      skillMdContent: "any",
    });
    existsSyncMock.mockReturnValueOnce(false);
    const result = await getSkillSeedDrift("internal-only");
    expect(result.inSync).toBe(false);
    expect(result.seedBody).toBeNull();
    expect(result.dbBody).toBe("any");
  });

  it("never throws when the seed read errors — returns seedBody: null", async () => {
    findUnique.mockResolvedValueOnce({
      skillId: "build-page",
      category: "build",
      skillMdContent: "any",
    });
    existsSyncMock.mockReturnValueOnce(true);
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error("EACCES");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await getSkillSeedDrift("build-page");
    expect(result.inSync).toBe(false);
    expect(result.seedBody).toBeNull();
  });
});
