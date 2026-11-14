import { describe, expect, it, vi } from "vitest";
import { renewNonprodEnvironmentLease } from "./environment-lease";
import { PREVIEW_MAX_CONTENDED_HOLD_MS } from "./environment-lease-hold-bound";
import { CLASS_HOLD_BOUND_MS } from "./environment-lease-overseer";

// BI-995E9530: a Contributor preview on the shared local-integration-ci slot
// renewed forever and starved every pre-PR gate. BI-218A4555 generalised the
// rule to every class: past its class bound a hold yields while another
// session waits, records the yield on the lease, and only then.
const NOW = new Date("2026-10-21T07:00:00.000Z");
const GATE_BOUND_MS = CLASS_HOLD_BOUND_MS.gate as number;

function liveWaiter(overrides: Record<string, unknown> = {}) {
  return {
    id: "waiter-1",
    status: "queued",
    environmentKey: "local-integration-ci",
    claimKey: `gate:${"b".repeat(64)}`,
    ownerSessionId: "gate-session",
    ownerProvider: "claude",
    queuedAt: new Date(NOW.getTime() - 60_000),
    heartbeatAt: new Date(NOW.getTime() - 10_000),
    expiresAt: new Date(NOW.getTime() + 60 * 60_000),
    ...overrides,
  };
}

function holdDb(input: { claimKey: string; heldMs: number; waiters: unknown[] }) {
  const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ leaseId: "NPEL-P", ...data }));
  const findMany = vi.fn().mockResolvedValue(input.waiters);
  const findUnique = vi.fn().mockResolvedValue({
    id: "holder",
    leaseId: "NPEL-P",
    status: "active",
    ownerSessionId: "holder-session",
    ownerProvider: "codex",
    claimKey: input.claimKey,
    environmentKey: "local-integration-ci",
    expiresAt: new Date(NOW.getTime() + 60_000),
    admittedAt: new Date(NOW.getTime() - input.heldMs),
    slotManifestVersion: null,
    phase: "running",
  });
  return {
    update,
    findMany,
    db: {
      nonProductionEnvironmentLease: { findUnique, update, findMany },
      platformConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  };
}

const renew = (db: unknown, ttlMs?: number) => renewNonprodEnvironmentLease({
  db: db as never,
  leaseId: "NPEL-P",
  ownerSessionId: "holder-session",
  ttlMs,
  now: NOW,
});

describe("bounded holds on renewal (BI-995E9530, BI-218A4555)", () => {
  it("yields a preview past its bound while another session waits, and records the yield", async () => {
    const { db, update, findMany } = holdDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS + 1,
      waiters: [liveWaiter()],
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "lost", reason: "yielded", holdClass: "preview" });
    expect(update).toHaveBeenCalledWith({ where: { leaseId: "NPEL-P" }, data: { phase: "yielded:preview:hold-bound" } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        environmentKey: "local-integration-ci",
        status: "queued",
        expiresAt: { gt: NOW },
        ownerSessionId: { not: "holder-session" },
      },
    }));
  });

  it("yields a gate only past its own, longer bound", async () => {
    const inside = holdDb({ claimKey: `gate:${"a".repeat(64)}`, heldMs: GATE_BOUND_MS - 1, waiters: [liveWaiter()] });
    await expect(renew(inside.db)).resolves.toMatchObject({ status: "renewed" });
    const past = holdDb({ claimKey: `gate:${"a".repeat(64)}`, heldMs: GATE_BOUND_MS, waiters: [liveWaiter()] });
    await expect(renew(past.db)).resolves.toMatchObject({ status: "lost", reason: "yielded", holdClass: "gate" });
  });

  it("keeps renewing past its bound when nobody else is waiting", async () => {
    const { db, update } = holdDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS * 3,
      waiters: [],
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("caps a contended renewal at the bound instead of extending past it", async () => {
    const { db, update } = holdDb({
      claimKey: "owner-acceptance-x",
      heldMs: (CLASS_HOLD_BOUND_MS.verification as number) - 60_000,
      waiters: [liveWaiter()],
    });
    await expect(renew(db, 15 * 60_000)).resolves.toMatchObject({ status: "renewed" });
    expect(update.mock.calls[0]![0].data.expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
  });

  it("does not read the queue while a hold is far from its bound", async () => {
    const { db, findMany } = holdDb({ claimKey: `gate:${"a".repeat(64)}`, heldMs: 60_000, waiters: [liveWaiter()] });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
    expect(findMany).not.toHaveBeenCalled();
  });

  it("is not contended by a dead waiter", async () => {
    const { db } = holdDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS * 2,
      waiters: [liveWaiter({ heartbeatAt: new Date(NOW.getTime() - 30 * 60_000) })],
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
  });
});
