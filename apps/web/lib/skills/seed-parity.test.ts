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

import {
  getSkillSeedDrift,
  resolveSeedPath,
  resolveSeedPathCandidates,
} from "./seed-parity";

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

describe("resolveSeedPathCandidates — both skill corpora (BI-5798BBA3)", () => {
  it("offers the coworker corpus path and the dev-pack path", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    const paths = resolveSeedPathCandidates("governance", "dpf-verify-substrate-first").map((p) =>
      p.replace(/\\/g, "/"),
    );
    expect(paths).toContain("/repo/skills/governance/dpf-verify-substrate-first.skill.md");
    expect(paths).toContain(
      "/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md",
    );
  });
});

describe("resolveSeedPath — resolves a dev-pack skill (BI-5798BBA3)", () => {
  it("returns the pack SKILL.md when only the pack file exists", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    existsSyncMock.mockImplementation((p: string) =>
      String(p).replace(/\\/g, "/") ===
      "/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md",
    );
    const p = resolveSeedPath("governance", "dpf-verify-substrate-first").replace(/\\/g, "/");
    expect(p).toBe("/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md");
    existsSyncMock.mockReset();
  });
});

describe("getSkillSeedDrift — dev-pack skills and honest absence (BI-5798BBA3)", () => {
  it("detects drift for a dev-pack skill whose body lives in packages/dpf-skill-pack", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    findUnique.mockResolvedValueOnce({
      skillId: "dpf-verify-substrate-first",
      category: "governance",
      skillMdContent: "# verify\n\nunfiltered hit count guardrail\n",
    });
    existsSyncMock.mockImplementation((p: string) => {
      const n = String(p).replace(/\\/g, "/");
      return (
        n === "/repo" ||
        n === "/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md"
      );
    });
    readFileSyncMock.mockReturnValueOnce("# verify\n\nthe old body\n");

    const result = await getSkillSeedDrift("dpf-verify-substrate-first");
    expect(result.seedPath.replace(/\\/g, "/")).toBe(
      "/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md",
    );
    expect(result.seedBody).toContain("the old body");
    expect(result.inSync).toBe(false);
    expect(result.seedStatus).toBe("drifted");
    existsSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  it("reports missing-in-repo (a real warning) when the repo IS present but no candidate exists", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    findUnique.mockResolvedValueOnce({
      skillId: "orphan-skill",
      category: "governance",
      skillMdContent: "any",
    });
    // Repo root exists; no seed file in either corpus.
    existsSyncMock.mockImplementation((p: string) => String(p).replace(/\\/g, "/") === "/repo");

    const result = await getSkillSeedDrift("orphan-skill");
    expect(result.seedBody).toBeNull();
    expect(result.seedStatus).toBe("missing-in-repo");
    expect(result.repoAvailable).toBe(true);
    existsSyncMock.mockReset();
  });

  it("reports repo-unavailable (the benign production case) when the repo is not checked out", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    findUnique.mockResolvedValueOnce({
      skillId: "dpf-pr-with-dco",
      category: "governance",
      skillMdContent: "any",
    });
    existsSyncMock.mockImplementation(() => false);

    const result = await getSkillSeedDrift("dpf-pr-with-dco");
    expect(result.seedBody).toBeNull();
    expect(result.seedStatus).toBe("repo-unavailable");
    expect(result.repoAvailable).toBe(false);
    existsSyncMock.mockReset();
  });
});
