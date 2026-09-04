import { describe, expect, it, vi } from "vitest";

const { existsSyncMock, writeFileSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
  writeFileSync: writeFileSyncMock,
  readFileSync: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { writeSkillSeed } from "./seed-writeback";

describe("writeSkillSeed (BI-5798BBA3 phase 2)", () => {
  it("writes the approved body to the dev-pack seed when that is where the skill lives", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    const packPath = "/repo/packages/dpf-skill-pack/skills/dpf-verify-substrate-first/SKILL.md";
    existsSyncMock.mockImplementation((p: string) => {
      const n = String(p).replace(/\\/g, "/");
      return n === "/repo" || n === packPath;
    });

    const result = writeSkillSeed("governance", "dpf-verify-substrate-first", "# new body\n");

    expect(result.status).toBe("written");
    expect(result.path?.replace(/\\/g, "/")).toBe(packPath);
    expect(writeFileSyncMock).toHaveBeenCalledTimes(1);
    const [calledPath, calledBody] = writeFileSyncMock.mock.calls[0];
    expect(String(calledPath).replace(/\\/g, "/")).toBe(packPath);
    expect(calledBody).toBe("# new body\n");
    existsSyncMock.mockReset();
    writeFileSyncMock.mockReset();
  });

  it("does NOT write when no repo checkout is reachable — the benign production case", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    existsSyncMock.mockImplementation(() => false);

    const result = writeSkillSeed("governance", "dpf-pr-with-dco", "# body\n");

    expect(result.status).toBe("repo-unavailable");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    existsSyncMock.mockReset();
    writeFileSyncMock.mockReset();
  });

  it("does NOT invent a seed file when the repo is present but the skill has none", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    existsSyncMock.mockImplementation((p: string) => String(p).replace(/\\/g, "/") === "/repo");

    const result = writeSkillSeed("governance", "orphan-skill", "# body\n");

    expect(result.status).toBe("no-seed-file");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
    existsSyncMock.mockReset();
    writeFileSyncMock.mockReset();
  });

  it("reports write-failed rather than throwing when the filesystem refuses", () => {
    process.env.DPF_REPO_ROOT = "/repo";
    const packPath = "/repo/packages/dpf-skill-pack/skills/s1/SKILL.md";
    existsSyncMock.mockImplementation((p: string) => {
      const n = String(p).replace(/\\/g, "/");
      return n === "/repo" || n === packPath;
    });
    writeFileSyncMock.mockImplementation(() => {
      throw new Error("EROFS: read-only file system");
    });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = writeSkillSeed("governance", "s1", "# body\n");

    expect(result.status).toBe("write-failed");
    expect(result.reason).toContain("EROFS");
    existsSyncMock.mockReset();
    writeFileSyncMock.mockReset();
  });

  it("treats only 'written' as landed — every other status leaves the approval unpropagated", () => {
    expect(["repo-unavailable", "no-seed-file", "write-failed"]).not.toContain("written");
  });
});
