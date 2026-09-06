import { describe, expect, it, vi } from "vitest";

import {
  EDGE_LIVE_ENROLLMENT_WITHIN_MS,
  EDGE_STALE_ENROLLMENT_AFTER_MS,
  selectSupersededInstallerNodes,
  supersedeStaleInstallerNodes,
  type StaleSupersessionDb,
} from "./stale-supersession";

const now = new Date("2026-09-06T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60_000);

const live = { id: "row_native", nodeId: "edge_native", trustState: "trusted", lastSeenAt: minutesAgo(1), enrolledAt: daysAgo(40) };
const stale = { id: "row_container", nodeId: "edge_container", trustState: "trusted", lastSeenAt: daysAgo(48), enrolledAt: daysAgo(90) };

describe("selectSupersededInstallerNodes", () => {
  it("retires an installer enrollment silent for a week beside a live one", () => {
    const decision = selectSupersededInstallerNodes({ candidates: [live, stale], now });
    expect(decision.liveNodeIds).toEqual(["edge_native"]);
    expect(decision.retire.map((n) => n.nodeId)).toEqual(["edge_container"]);
    expect(decision.retire[0].reason).toContain("superseded-stale-installer-enrollment");
    expect(decision.retire[0].reason).toContain("edge_native");
    expect(decision.retire[0].silentSinceIso).toBe(stale.lastSeenAt.toISOString());
    expect(decision.skipped).toBeNull();
  });

  it("never guesses between two live enrollments", () => {
    const other = { ...stale, id: "row_other", nodeId: "edge_other", lastSeenAt: minutesAgo(5) };
    const decision = selectSupersededInstallerNodes({ candidates: [live, other], now });
    expect(decision.retire).toEqual([]);
    expect(decision.skipped).toBe("nothing-stale");
  });

  it("retires nothing when no candidate is provably live", () => {
    const quiet = { ...live, lastSeenAt: new Date(now.getTime() - EDGE_LIVE_ENROLLMENT_WITHIN_MS - 1) };
    const decision = selectSupersededInstallerNodes({ candidates: [quiet, stale], now });
    expect(decision.retire).toEqual([]);
    expect(decision.skipped).toBe("no-live-candidate");
  });

  it("leaves a recently silent enrollment alone until the week has passed", () => {
    const recent = { ...stale, lastSeenAt: new Date(now.getTime() - EDGE_STALE_ENROLLMENT_AFTER_MS + 60_000) };
    expect(selectSupersededInstallerNodes({ candidates: [live, recent], now }).retire).toEqual([]);
    const overdue = { ...stale, lastSeenAt: new Date(now.getTime() - EDGE_STALE_ENROLLMENT_AFTER_MS) };
    expect(selectSupersededInstallerNodes({ candidates: [live, overdue], now }).retire).toHaveLength(1);
  });

  it("does nothing with a single candidate or when the only other row is already revoked", () => {
    expect(selectSupersededInstallerNodes({ candidates: [live], now }).skipped).toBe("single-candidate");
    expect(selectSupersededInstallerNodes({ candidates: [live, { ...stale, trustState: "revoked" }], now }).skipped).toBe("single-candidate");
  });

  it("uses enrolledAt for a node that never heartbeated", () => {
    const neverSeen = { ...stale, lastSeenAt: null, enrolledAt: daysAgo(30) };
    const decision = selectSupersededInstallerNodes({ candidates: [live, neverSeen], now });
    expect(decision.retire.map((n) => n.nodeId)).toEqual(["edge_container"]);
    expect(decision.retire[0].silentSinceIso).toBe(neverSeen.enrolledAt.toISOString());
  });
});

describe("supersedeStaleInstallerNodes", () => {
  it("loads installer-managed, unrevoked, install-scoped nodes and revokes the superseded one through the shared helper", async () => {
    const update = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = {
      edgeNode: {
        findMany: vi.fn().mockResolvedValue([live, stale]),
        findUnique: vi.fn().mockImplementation(async ({ where }: { where: { id: string } }) =>
          [live, stale].find((n) => n.id === where.id) ?? null),
        update,
      },
      edgeNodeCertificate: { updateMany },
      $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    } as unknown as StaleSupersessionDb;

    const result = await supersedeStaleInstallerNodes(db, { now });

    expect(result.revoked).toEqual(["edge_container"]);
    expect(db.edgeNode.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        trustState: { not: "revoked" },
        customerAccountId: null,
        customerSiteId: null,
        consumedTokens: { some: { autoApprove: true } },
      }),
    }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "row_container" },
      data: expect.objectContaining({ trustState: "revoked", tokenHash: null, revokedAt: now }),
    }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ edgeNodeId: "row_container" }) }));
  });
});
