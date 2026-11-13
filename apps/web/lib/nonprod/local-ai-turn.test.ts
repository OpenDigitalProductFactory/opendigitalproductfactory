import { describe, expect, it, vi } from "vitest";
import { recordLocalAiDemand, settleLocalAiTurn } from "./local-ai-turn";
import { AI_TURN_TTL_MS } from "./environment-lease-overseer";

const NOW = new Date("2026-11-12T15:00:00.000Z");

function turnDb(existing: { id: string; leaseId: string } | null) {
  const lease = {
    findFirst: vi.fn(async () => existing),
    update: vi.fn(async () => ({})),
    create: vi.fn(async (_args: { data: Record<string, unknown> }) => ({})),
    updateMany: vi.fn(async () => ({ count: existing ? 1 : 0 })),
  };
  const tx = { $executeRaw: vi.fn(async () => 1), nonProductionEnvironmentLease: lease };
  return { lease, tx, db: { $transaction: vi.fn(async (body: (t: unknown) => unknown) => body(tx)) } };
}

describe("local AI turn rows (BI-218A4555)", () => {
  it("creates one queued AI turn under the environment lock", async () => {
    const { db, lease, tx } = turnDb(null);
    const result = await recordLocalAiDemand({ db: db as never, now: NOW });
    expect(result.created).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    const data = lease.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({
      environmentKey: "local-integration-ci",
      status: "queued",
      ownerProvider: "coworker",
      ownerSessionId: "local-inference",
      queuedAt: NOW,
      heartbeatAt: NOW,
      expiresAt: new Date(NOW.getTime() + AI_TURN_TTL_MS),
    });
    expect(String(data.claimKey)).toMatch(/^inference-turn:local:NPEL-/);
  });

  it("refreshes the existing turn instead of adding another", async () => {
    const { db, lease } = turnDb({ id: "row-1", leaseId: "NPEL-T" });
    const result = await recordLocalAiDemand({ db: db as never, now: NOW });
    expect(result).toEqual({ leaseId: "NPEL-T", created: false });
    expect(lease.create).not.toHaveBeenCalled();
    expect(lease.update).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { heartbeatAt: NOW, expiresAt: new Date(NOW.getTime() + AI_TURN_TTL_MS), phase: "waiting" },
    });
  });

  it("settles a waiting turn as served, recording when it was served", async () => {
    const { db, lease } = turnDb({ id: "row-1", leaseId: "NPEL-T" });
    await expect(settleLocalAiTurn({ db: db as never, now: NOW })).resolves.toEqual({ settled: 1 });
    expect(lease.updateMany).toHaveBeenCalledWith({
      where: { environmentKey: "local-integration-ci", status: "queued", claimKey: { startsWith: "inference-turn:" } },
      data: { status: "released", admittedAt: NOW, releasedAt: NOW, phase: "served" },
    });
  });
});
