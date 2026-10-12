import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  heartbeatWorkCapsule,
  reassignWorkCapsuleExecutor,
  WorkroomLeaseHeldError,
  WorkroomLeaseHolderChangedError,
} from "./workroom-lease";
import type { CapsuleDb } from "./work-capsule-store-types";

// BI-A7601AED: a lease renews only for its holder (or once it lapsed), and a
// handover replaces the holder it read.

const NOW = new Date("2026-10-07T12:00:00.000Z");
const LIVE = new Date("2026-10-07T12:20:00.000Z");
const LAPSED = new Date("2026-10-07T11:00:00.000Z");

const db = {
  workroom: {
    create: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  workroomActivity: { create: vi.fn() },
  $queryRaw: vi.fn(),
  $transaction: vi.fn(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db)),
};
const capsuleDb = () => db as unknown as CapsuleDb;
const owner = { userId: "user-owner", agentId: null, principalId: "principal-owner" };
const other = { userId: "user-other", agentId: "AGT-COORD", principalId: "principal-coordinator" };

function room(holder: string | null, expiresAt: Date | null) {
  return {
    id: "row-1",
    capsuleId: "WC-LEASE",
    executorKind: "claude-desktop",
    executorRef: null,
    leaseHolderPrincipalId: holder,
    leaseExpiresAt: expiresAt,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
  db.workroom.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({
    id: "row-1",
    capsuleId: "WC-LEASE",
    ...args.data,
  }));
});

describe("heartbeatWorkCapsule", () => {
  it("locks the room row before reading its lease", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    await heartbeatWorkCapsule({ db: capsuleDb(), capsuleId: "WC-LEASE", actor: owner, now: NOW });
    const sql = (db.$queryRaw.mock.calls[0]?.[0] as TemplateStringsArray).join("?");
    expect(sql).toContain("FOR UPDATE");
    expect(db.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.workroom.findUnique.mock.invocationCallOrder[0]);
  });

  it("renews the holder's own live lease", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    await heartbeatWorkCapsule({ db: capsuleDb(), capsuleId: "WC-LEASE", actor: owner, now: NOW });
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseHolderPrincipalId: "principal-owner" }),
    }));
  });

  it.each([
    ["nobody holds it", room(null, null)],
    ["the lease lapsed", room("principal-owner", LAPSED)],
  ])("lets another principal take the lease when %s", async (_label, row) => {
    db.workroom.findUnique.mockResolvedValueOnce(row);
    await heartbeatWorkCapsule({ db: capsuleDb(), capsuleId: "WC-LEASE", actor: other, now: NOW });
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseHolderPrincipalId: "principal-coordinator" }),
    }));
  });

  it("refuses another principal while the lease is live and writes nothing", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    const attempt = heartbeatWorkCapsule({ db: capsuleDb(), capsuleId: "WC-LEASE", actor: other, now: NOW });
    await expect(attempt).rejects.toBeInstanceOf(WorkroomLeaseHeldError);
    await expect(attempt).rejects.toMatchObject({
      code: "lease_held_by_other",
      holderPrincipalId: "principal-owner",
      leaseExpiresAt: LIVE,
    });
    expect(db.workroom.update).not.toHaveBeenCalled();
    expect(db.workroomActivity.create).not.toHaveBeenCalled();
  });

  it("keeps the holder's lease when an ordinary write renews for someone else", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    const result = await heartbeatWorkCapsule({
      db: capsuleDb(),
      capsuleId: "WC-LEASE",
      actor: other,
      now: NOW,
      onHeldByOther: "keep",
    });
    expect(result).toMatchObject({ leaseHolderPrincipalId: "principal-owner", leaseExpiresAt: LIVE });
    expect(db.workroom.update).not.toHaveBeenCalled();
  });
});

describe("reassignWorkCapsuleExecutor lease compare-and-set", () => {
  it("hands over a live room when the caller names the current holder", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    await reassignWorkCapsuleExecutor({
      db: capsuleDb(),
      capsuleId: "WC-LEASE",
      toExecutorKind: "codex-desktop",
      expectedLeaseHolderPrincipalId: "principal-owner",
      actor: other,
      now: NOW,
    });
    expect(db.workroom.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ leaseHolderPrincipalId: "principal-coordinator" }),
    }));
    expect(db.workroomActivity.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        kind: "executor-changed",
        payload: expect.objectContaining({ fromLeaseHolderPrincipalId: "principal-owner" }),
      }),
    }));
  });

  it("refuses when the holder changed since the caller read it", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-someone-else", LIVE));
    const attempt = reassignWorkCapsuleExecutor({
      db: capsuleDb(),
      capsuleId: "WC-LEASE",
      toExecutorKind: "codex-desktop",
      expectedLeaseHolderPrincipalId: "principal-owner",
      actor: other,
      now: NOW,
    });
    await expect(attempt).rejects.toBeInstanceOf(WorkroomLeaseHolderChangedError);
    await expect(attempt).rejects.toMatchObject({
      code: "lease_holder_changed",
      actualHolderPrincipalId: "principal-someone-else",
    });
    expect(db.workroom.update).not.toHaveBeenCalled();
  });

  it("treats an explicit null as expecting no holder", async () => {
    db.workroom.findUnique.mockResolvedValueOnce(room("principal-owner", LIVE));
    await expect(reassignWorkCapsuleExecutor({
      db: capsuleDb(),
      capsuleId: "WC-LEASE",
      toExecutorKind: "codex-desktop",
      expectedLeaseHolderPrincipalId: null,
      actor: other,
      now: NOW,
    })).rejects.toBeInstanceOf(WorkroomLeaseHolderChangedError);
  });
});
