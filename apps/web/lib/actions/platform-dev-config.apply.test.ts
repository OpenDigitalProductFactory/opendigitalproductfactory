import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-23 BI-9B77E247: tests for the `applyPlatformUpdate` server action
// extracted from the apply_platform_update MCP tool case. Covers the cheap
// early-exit paths (no pending update, invalid version, unauthorized) and
// one happy-path / one conflict-path scenario with mocked child_process exec.

const { mockPrisma, mockCan, mockAuth } = vi.hoisted(() => ({
  mockPrisma: {
    platformDevConfig: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockCan: vi.fn(),
  mockAuth: vi.fn(),
}));

const { mockExec, mockExistsSync, mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  // exec returns { stdout, stderr } when promisified; child_process.exec API
  // dispatches via a callback, but lazy-node lets us shape it as a function
  // that promisify() turns into a thenable. We expose a callback-shape mock.
  mockExec: vi.fn((_cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
    if (cb) cb(null, { stdout: "", stderr: "" });
  }),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn().mockReturnValue(""),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/platform-dev-policy", () => ({ getPlatformDevPolicyState: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/security/safe-fetch", () => ({ assertSafeOutboundUrl: vi.fn() }));

// The lazy-node helpers return concrete node module subsets. We mock the
// underlying modules so promisify(exec) works against our callback-shape
// stub, and existsSync / readFileSync / writeFileSync return controlled values.
vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({ exec: mockExec }),
  lazyUtil: () => ({
    promisify: <T extends (...args: never[]) => unknown>(fn: T) => {
      return (...args: unknown[]) => {
        return new Promise((resolve, reject) => {
          (fn as unknown as (...callArgs: unknown[]) => void)(...args, (err: Error | null, value: unknown) => {
            if (err) reject(err);
            else resolve(value);
          });
        });
      };
    },
  }),
  lazyFs: () => ({
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  }),
  lazyFsPromises: () => ({}),
  lazyPath: () => ({
    resolve: (...parts: string[]) => parts.join("/"),
  }),
}));

import { applyPlatformUpdate } from "./platform-dev-config";

describe("applyPlatformUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u-1", platformRole: "admin", isSuperuser: false } });
    mockCan.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
      if (cb) cb(null, { stdout: "", stderr: "" });
    });
  });

  it("rejects unauthorized callers", async () => {
    mockCan.mockReturnValue(false);
    await expect(applyPlatformUpdate()).rejects.toThrow(/Unauthorized/);
  });

  it("returns no-update-pending when PlatformDevConfig has no queued update", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: false,
      pendingVersion: null,
    });

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("no-update-pending");
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns invalid-version when pendingVersion fails the format regex", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: true,
      pendingVersion: "v$bad version with spaces",
    });

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("invalid-version");
    if (result.kind === "invalid-version") {
      expect(result.version).toBe("v$bad version with spaces");
    }
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("returns conflicts immediately when .git/MERGE_HEAD exists (resumed merge)", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: true,
      pendingVersion: "v1.2.3",
    });
    mockExistsSync.mockReturnValue(true); // simulate in-progress merge

    // git diff --name-only --diff-filter=U returns one conflicted file
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
      if (cb) {
        if (cmd.includes("--diff-filter=U")) cb(null, { stdout: "apps/web/page.tsx\n", stderr: "" });
        else cb(null, { stdout: "", stderr: "" });
      }
    });
    mockReadFileSync.mockReturnValue(
      "// header\n<<<<<<< HEAD\nlocal version\n=======\nupstream version\n>>>>>>> dpf-upstream\n",
    );

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("conflicts");
    if (result.kind === "conflicts") {
      expect(result.resumedMerge).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.file).toBe("apps/web/page.tsx");
      // Note: regex pulls upstreamMatch from <<<<<<<…=======, localMatch from =======…>>>>>>>;
      // the names in the regex variables refer to "upstream of the conflict marker", not the
      // git remote — see the source for the historical reason.
    }
  });

  it("returns clean-merge after a successful no-conflict merge and clears the pending flag", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: true,
      pendingVersion: "v1.2.3",
    });
    mockPrisma.platformDevConfig.update.mockResolvedValue({});
    mockExistsSync.mockReturnValue(false);

    mockExec.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
      if (!cb) return;
      if (cmd.includes("--diff-filter=U")) cb(null, { stdout: "", stderr: "" }); // no conflicts
      else if (cmd === "git diff --cached --stat") cb(null, { stdout: " 42 files changed, 100 insertions(+)", stderr: "" });
      else cb(null, { stdout: "", stderr: "" });
    });

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("clean-merge");
    if (result.kind === "clean-merge") {
      expect(result.version).toBe("v1.2.3");
      expect(result.filesUpdated).toBe(42);
    }
    expect(mockPrisma.platformDevConfig.update).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: { updatePending: false, pendingVersion: null },
    });
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});
