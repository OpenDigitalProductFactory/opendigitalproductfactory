import { beforeEach, describe, expect, it, vi } from "vitest";

// In-memory state to exercise the auto-ship actor resolution without a live DB.
// Mirrors the skill-curator regression test (curator.test.ts): mock @dpf/db,
// capture the downstream write's principal, and assert it is the resolved owner
// and NEVER a "system" sentinel.

const state = vi.hoisted(() => ({
  build: null as { createdById: string | null } | null,
  dispatchCalls: [] as Array<{
    buildId: string;
    userId: string;
    verificationStatus: string;
  }>,
  ownerResolveCount: 0,
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: {
      findUnique: vi.fn(async () => state.build),
    },
  },
}));

vi.mock("../scheduled-owner", () => ({
  resolveScheduledOwnerUserId: vi.fn(async () => {
    state.ownerResolveCount++;
    return "usr_owner";
  }),
}));

vi.mock("@/lib/build/ship-on-review-approval", () => ({
  dispatchShipForVerifiedBuild: vi.fn(
    async (params: { buildId: string; userId: string; verificationStatus: string }) => {
      state.dispatchCalls.push(params);
      return { kind: "dispatched-success", durationMs: 1 };
    },
  ),
}));

import { autoDispatchShipForCompletedVerification } from "./build-review-verification";

beforeEach(() => {
  state.build = null;
  state.dispatchCalls.length = 0;
  state.ownerResolveCount = 0;
});

describe("autoDispatchShipForCompletedVerification — actor resolution", () => {
  it("uses the build creator as the ship actor when createdById is set", async () => {
    state.build = { createdById: "usr_creator" };

    await autoDispatchShipForCompletedVerification("build-1");

    expect(state.dispatchCalls).toHaveLength(1);
    expect(state.dispatchCalls[0]?.userId).toBe("usr_creator");
    expect(state.dispatchCalls[0]?.verificationStatus).toBe("complete");
    // When the creator is known there is no need to resolve the install owner.
    expect(state.ownerResolveCount).toBe(0);
  });

  it("forwards a 'skipped' verification status so non-UI builds ship instead of stranding", async () => {
    // The FB-FD850A2C strand: a non-UI build skips browser UX verification and
    // must auto-dispatch ship with verificationStatus="skipped" (not "complete"),
    // mirroring the complete path so it advances to ship rather than looping.
    state.build = { createdById: "usr_creator" };

    await autoDispatchShipForCompletedVerification("build-skip", "skipped");

    expect(state.dispatchCalls).toHaveLength(1);
    expect(state.dispatchCalls[0]?.verificationStatus).toBe("skipped");
    expect(state.dispatchCalls[0]?.userId).toBe("usr_creator");
  });

  it("defaults the verification status to 'complete' when omitted", async () => {
    state.build = { createdById: "usr_creator" };

    await autoDispatchShipForCompletedVerification("build-default");

    expect(state.dispatchCalls[0]?.verificationStatus).toBe("complete");
  });

  it("resolves the install owner (never a 'system' sentinel) when createdById is null", async () => {
    // Regression guard for the latent FK violation: a null createdById used to
    // fall back to userId:"system", which has no matching User row and fails
    // TaskRun_userId_fkey (Prisma P2003) downstream via
    // dispatchShipForVerifiedBuild -> executeTool(deploy_feature). Same bug
    // fixed for the skill curator in PR #1925.
    state.build = { createdById: null };

    await autoDispatchShipForCompletedVerification("build-2");

    expect(state.dispatchCalls).toHaveLength(1);
    expect(state.dispatchCalls[0]?.userId).toBe("usr_owner");
    expect(state.dispatchCalls[0]?.userId).not.toBe("system");
    expect(state.ownerResolveCount).toBe(1);
  });

  it("resolves the install owner when the build row is missing entirely", async () => {
    // findUnique returning null is the same hazard as a null createdById:
    // it must still resolve a real principal, not the sentinel.
    state.build = null;

    await autoDispatchShipForCompletedVerification("build-3");

    expect(state.dispatchCalls).toHaveLength(1);
    expect(state.dispatchCalls[0]?.userId).toBe("usr_owner");
    expect(state.dispatchCalls[0]?.userId).not.toBe("system");
  });

  it("propagates the resolver error rather than shipping under a bogus actor", async () => {
    // If no active superuser exists, resolveScheduledOwnerUserId throws. The
    // dispatch must NOT proceed with a fabricated principal — fail loudly.
    const { resolveScheduledOwnerUserId } = await import("../scheduled-owner");
    vi.mocked(resolveScheduledOwnerUserId).mockRejectedValueOnce(
      new Error("No active superuser is available to own scheduled platform work."),
    );
    state.build = { createdById: null };

    await expect(
      autoDispatchShipForCompletedVerification("build-4"),
    ).rejects.toThrow(/superuser/i);
    expect(state.dispatchCalls).toHaveLength(0);
  });
});
