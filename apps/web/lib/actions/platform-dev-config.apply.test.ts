import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-5B6C1C35 — Engine B retirement (unified-delivery-surfaces spec §2 GAP 1;
// governed-platform-upgrade spec §5.0).
//
// `applyPlatformUpdate` was the in-portal half of the SECOND, now-retired
// source-advance engine: it merged upstream source into the install's
// `my-changes` branch inside the `/workspace` git repo, silently mutating the
// running container's source and racing the canonical host-clone self-upgrade
// promoter (Engine A). Two engines on one install is the root cause of the
// stale-mislabeled-portal bug.
//
// These tests pin the new contract: the action HARD-REFUSES with kind
// `engine-retired` and performs NO git/exec work and NO DB writes, so Engine B
// can no longer advance source or write update sentinels regardless of any
// stale `updatePending=true` row. Engine A (Ops → Self-Upgrade) is the sole
// sanctioned advance path. Auth is still enforced before the refusal so it
// cannot be used to probe install state without permission.

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

const {
  mockExec,
  mockExistsSync,
  mockReadFileSync,
  mockStatSync,
  mockUnlinkSync,
  mockWriteFileSync,
} = vi.hoisted(() => ({
  mockExec: vi.fn((_cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
    if (cb) cb(null, { stdout: "", stderr: "" });
  }),
  mockExistsSync: vi.fn().mockReturnValue(false),
  mockReadFileSync: vi.fn().mockReturnValue(""),
  mockStatSync: vi.fn().mockReturnValue({ mtimeMs: Date.now() - 60_000 }),
  mockUnlinkSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/permissions", () => ({ can: mockCan }));
vi.mock("@/lib/platform-dev-policy", () => ({ getPlatformDevPolicyState: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/security/safe-fetch", () => ({ assertSafeOutboundUrl: vi.fn() }));

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
    statSync: mockStatSync,
    unlinkSync: mockUnlinkSync,
    writeFileSync: mockWriteFileSync,
  }),
  lazyFsPromises: () => ({}),
  lazyPath: () => ({
    resolve: (...parts: string[]) => parts.join("/"),
  }),
}));

import { applyPlatformUpdate } from "./platform-dev-config";

describe("applyPlatformUpdate (Engine B retired — BI-5B6C1C35)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({ user: { id: "u-1", platformRole: "admin", isSuperuser: false } });
    mockCan.mockReturnValue(true);
    mockExistsSync.mockReturnValue(false);
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 60_000 });
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
      if (cb) cb(null, { stdout: "", stderr: "" });
    });
  });

  it("rejects unauthorized callers (auth is enforced before the refusal)", async () => {
    mockCan.mockReturnValue(false);
    await expect(applyPlatformUpdate()).rejects.toThrow(/Unauthorized/);
    // No source-advance work of any kind for an unauthorized caller.
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockPrisma.platformDevConfig.update).not.toHaveBeenCalled();
  });

  it("hard-refuses with kind 'engine-retired' and points to Self-Upgrade", async () => {
    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("engine-retired");
    expect(result.message).toMatch(/self-upgrade/i);
    expect(result.message).toMatch(/retired/i);
  });

  it("does NOT advance source: no git/exec runs and no DB writes, even with a pending update", async () => {
    // The exact state the live install was stuck in: a pending update flagged by
    // the old entrypoint detection. Engine B must still refuse and touch nothing.
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: true,
      pendingVersion: "v9c92036a",
    });
    // Simulate an in-progress merge AND a matching sentinel — neither must lure
    // the action into running the merge/finish path.
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue("v9c92036a\n");

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("engine-retired");
    // The defining guarantee: zero git/exec invocations, zero update-sentinel writes.
    expect(mockExec).not.toHaveBeenCalled();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
    expect(mockPrisma.platformDevConfig.update).not.toHaveBeenCalled();
    // It must not even read the merge state — refusal is unconditional.
    expect(mockPrisma.platformDevConfig.findUnique).not.toHaveBeenCalled();
  });

  it("never runs the retired /workspace merge regardless of mocked git output", async () => {
    mockPrisma.platformDevConfig.findUnique.mockResolvedValue({
      updatePending: true,
      pendingVersion: "v1.2.3",
    });
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb?: (err: Error | null, value: { stdout: string; stderr: string }) => void) => {
      if (cb) cb(null, { stdout: cmd.includes("--diff-filter=U") ? "apps/web/page.tsx\n" : "", stderr: "" });
    });

    const result = await applyPlatformUpdate();

    expect(result.kind).toBe("engine-retired");
    const commands = mockExec.mock.calls.map(([cmd]) => String(cmd));
    expect(commands.some((cmd) => cmd.includes("merge"))).toBe(false);
    expect(commands).not.toContain("rm -rf apps/web packages");
  });
});
