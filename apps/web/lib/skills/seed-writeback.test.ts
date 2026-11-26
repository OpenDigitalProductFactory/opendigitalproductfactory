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

import { propagateSkillSeed, writeSkillSeed } from "./seed-writeback";

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

describe("propagateSkillSeed in the qualified portal (BI-224F56F1)", () => {
  const input = { appliedRevisionId: "SREV-ABCD1234", category: "governance", skillId: "dpf-pr-with-dco", content: "# body\n" };

  it("asks the authorized source writer for the applied revision and writes nothing itself", async () => {
    process.env.DPF_REPO_ROOT = "/host-dpf";
    writeFileSyncMock.mockClear();
    const writer = vi.fn(async () => ({ ok: true, status: "written", path: "packages/dpf-skill-pack/skills/dpf-pr-with-dco/SKILL.md" }));
    await expect(propagateSkillSeed(input, writer)).resolves.toEqual({
      status: "written", path: "/host-dpf/packages/dpf-skill-pack/skills/dpf-pr-with-dco/SKILL.md", reason: null });
    expect(writer).toHaveBeenCalledWith("SREV-ABCD1234");
    expect(writeFileSyncMock).not.toHaveBeenCalled();
  });

  it("reports a writer refusal as unpropagated, never as written", async () => {
    await expect(propagateSkillSeed(input, async () => ({ ok: false, status: "no-seed-file" })))
      .resolves.toMatchObject({ status: "no-seed-file", path: null });
    await expect(propagateSkillSeed(input, async () => ({ ok: false, status: "write-failed" })))
      .resolves.toMatchObject({ status: "write-failed", path: null });
  });

  it("keeps the local write when the actuator is not mounted", async () => {
    process.env.DPF_REPO_ROOT = "/repo";
    existsSyncMock.mockImplementation((p: string) => p === "/repo" || p === "/repo/packages/dpf-skill-pack/skills/dpf-pr-with-dco/SKILL.md");
    writeFileSyncMock.mockClear();
    await expect(propagateSkillSeed(input, async () => null)).resolves.toMatchObject({ status: "written" });
    expect(writeFileSyncMock).toHaveBeenCalledOnce();
  });
});
