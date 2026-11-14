import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/portal-context/invalidation", () => ({ revalidatePortalContext: vi.fn(), revalidatePortalContextForCapsule: vi.fn() }));
import { recordExecutorCapacityNote } from "./workroom-lease";
import type { CapsuleDb } from "./work-capsule-store-types";

// Review finding: recording a plan limit through a heartbeat renewed the lease
// (hiding the wait), could take a lapsed lease, and erased the checkpoint.
describe("recordExecutorCapacityNote (BI-53BED66C)", () => {
  it("merges the note into the checkpoint and leaves the lease alone", async () => {
    const row = { capsuleId: "WC-1", leaseHolderPrincipalId: "someone", leaseExpiresAt: new Date("2026-11-13T06:10:00Z"),
      workspaceState: { other: 1, executorCheckpoint: { nextAction: "Run the gate", openRisks: ["flaky"], recordedAt: "2026-11-13T05:40:00Z" } } };
    const update = vi.fn(async (args: unknown) => args);
    const db = {
      $queryRaw: vi.fn(async () => [row]),
      workroom: { findUnique: vi.fn(async () => row), update, findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
      workroomActivity: { create: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    } as unknown as CapsuleDb;
    await recordExecutorCapacityNote({ db, capsuleId: "WC-1", capacity: { provider: "codex", resetAt: "2026-11-17T03:54:00.000Z" }, now: new Date("2026-11-13T19:30:00Z") });
    const data = (update.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).not.toHaveProperty("leaseHolderPrincipalId");
    expect(data).not.toHaveProperty("leaseExpiresAt");
    expect(data.workspaceState).toEqual({ other: 1, executorCheckpoint: { nextAction: "Run the gate", openRisks: ["flaky"], recordedAt: "2026-11-13T05:40:00Z",
      capacity: { provider: "codex", resetAt: "2026-11-17T03:54:00.000Z", recordedAt: "2026-11-13T19:30:00.000Z" } } });
  });
});
