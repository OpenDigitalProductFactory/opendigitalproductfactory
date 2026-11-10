import { describe, expect, it, vi } from "vitest";
import { renewNonprodEnvironmentLease } from "./environment-lease";
import { PREVIEW_MAX_CONTENDED_HOLD_MS } from "./environment-lease-preview-yield";

// BI-995E9530: a Contributor preview on the shared local-integration-ci slot
// renewed forever and starved every pre-PR gate. Past its bounded hold it
// yields while a gate is queued, and only then.
const NOW = new Date("2026-10-21T07:00:00.000Z");

function previewDb(input: { claimKey: string; heldMs: number; waitingGates: number; environmentKey?: string }) {
  const update = vi.fn().mockImplementation(({ data }) => Promise.resolve({ leaseId: "NPEL-P", ...data }));
  const count = vi.fn().mockResolvedValue(input.waitingGates);
  const findUnique = vi.fn().mockResolvedValue({
    leaseId: "NPEL-P",
    status: "active",
    ownerSessionId: "preview-session",
    claimKey: input.claimKey,
    environmentKey: input.environmentKey ?? "local-integration-ci",
    expiresAt: new Date(NOW.getTime() + 60_000),
    admittedAt: new Date(NOW.getTime() - input.heldMs),
    slotManifestVersion: null,
    phase: "running",
  });
  return {
    update,
    count,
    db: {
      nonProductionEnvironmentLease: { findUnique, update, count },
      platformConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    },
  };
}

const renew = (db: unknown) => renewNonprodEnvironmentLease({
  db: db as never,
  leaseId: "NPEL-P",
  ownerSessionId: "preview-session",
  now: NOW,
});

describe("contributor preview bounded hold (BI-995E9530)", () => {
  it("yields the slot once past its hold while a gate is queued", async () => {
    const { db, update, count } = previewDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS + 1,
      waitingGates: 3,
    });
    await expect(renew(db)).resolves.toEqual({ status: "lost", reason: "yielded" });
    expect(update).not.toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith({
      where: {
        environmentKey: "local-integration-ci",
        status: "queued",
        claimKey: { startsWith: "gate:" },
        expiresAt: { gt: NOW },
      },
    });
  });

  it("keeps renewing past its hold when no gate is waiting", async () => {
    const { db, update } = previewDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS * 3,
      waitingGates: 0,
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("keeps renewing inside its hold even with gates waiting", async () => {
    const { db, count } = previewDb({
      claimKey: "dev-portal:/wt/a:feat/a",
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS - 1,
      waitingGates: 5,
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
    expect(count).not.toHaveBeenCalled();
  });

  it("never yields a gate run, however long it has held the slot", async () => {
    const { db, count } = previewDb({
      claimKey: `gate:${"a".repeat(64)}`,
      heldMs: PREVIEW_MAX_CONTENDED_HOLD_MS * 4,
      waitingGates: 9,
    });
    await expect(renew(db)).resolves.toMatchObject({ status: "renewed" });
    expect(count).not.toHaveBeenCalled();
  });
});
