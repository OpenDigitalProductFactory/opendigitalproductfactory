// The rework permit-revocation hook (GPP Phase 3c PR-3c-3, BI-8875C9DF).
// Design: docs/superpowers/specs/2026-10-02-gpp-phase-3c-drive-graph-execution-design.md
// §6.2 ("Permit revocation"); plan: docs/superpowers/plans/
// 2026-10-02-gpp-phase-3c-drive-graph-execution.md (PR-3c-3,
// stage-permit-revocation.test.ts).
//
// With an injected permit store holding a permit for that workroom and stage,
// the permit is revoked and stops being valid; with none, nothing is written.
// No permit carries a stageKey on main (permit-mint.ts writes null), so in
// production the hook revokes nothing until binding attach.

import { describe, expect, it, vi } from "vitest";

import type { PermitClaims } from "./permit-claims";
import { shadowPermitClaims } from "./permit-mint";
import type { GppPermitStore, PermitRow } from "./permit-store";
import { evaluatePermitVerdict } from "./permit-verdict";
import { revokeStagePermits } from "./stage-permit-revocation";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const permitStateVerdict = (permit: PermitRow, now: Date) => evaluatePermitVerdict(permit, { toolName: "record_workroom_evidence", now });

function row(claims: Partial<PermitClaims>): PermitRow {
  const base = shadowPermitClaims({
    binding: { bindingId: "b-1", version: 1, gateKey: "g", authority: "wwmd" } as Parameters<typeof shadowPermitClaims>[0]["binding"],
    toolName: "record_workroom_evidence",
    actorUserId: "user-1",
    workroomId: "WC-RW",
    now: new Date(NOW.getTime() - 60_000),
  });
  return { ...base, ...claims, id: `row-${claims.stageKey ?? "none"}-${claims.workroomId ?? base.workroomId}`, useCount: 0, revokedAt: null, keyId: null, mac: null };
}

/** An in-memory store over rows, with the real store's revoke rule (workroom, stage in the set, not yet revoked). */
function memoryStore(rows: PermitRow[]) {
  const writes: string[] = [];
  const revokeStagePermitsImpl: NonNullable<GppPermitStore["revokeStagePermits"]> = async ({ workroomId, stageKeys, now }) => {
    let count = 0;
    for (const permit of rows) {
      if (permit.workroomId !== workroomId || permit.stageKey === null || !stageKeys.includes(permit.stageKey) || permit.revokedAt) continue;
      permit.revokedAt = now;
      writes.push(permit.id);
      count += 1;
    }
    return count;
  };
  return { rows, writes, store: { revokeStagePermits: vi.fn(revokeStagePermitsImpl) } };
}

describe("revokeStagePermits", () => {
  it("revokes a valid permit for a stage the rework leaves, which then reads as revoked", async () => {
    const left = row({ stageKey: "b" });
    const kept = row({ stageKey: "c" });
    const otherRoom = row({ stageKey: "b", workroomId: "WC-OTHER" });
    const { store, writes } = memoryStore([left, kept, otherRoom]);
    expect(permitStateVerdict(left, NOW)).toBe("valid");

    await expect(revokeStagePermits({ workroomId: "WC-RW", stageKeys: ["a", "b"], now: NOW }, store)).resolves.toBe(1);
    expect(writes).toEqual([left.id]);
    expect(left.revokedAt).toEqual(NOW);
    expect(permitStateVerdict(left, NOW)).toBe("revoked");
    // A stage the rework does not leave, and another room's permit, stay valid.
    expect(permitStateVerdict(kept, NOW)).toBe("valid");
    expect(permitStateVerdict(otherRoom, NOW)).toBe("valid");
  });

  it("writes nothing when no permit names the stages (every permit minted on main has stageKey null)", async () => {
    const unscoped = row({});
    expect(unscoped.stageKey).toBeNull();
    const { store, writes } = memoryStore([unscoped]);
    await expect(revokeStagePermits({ workroomId: "WC-RW", stageKeys: ["a", "b"], now: NOW }, store)).resolves.toBe(0);
    expect(writes).toEqual([]);
    expect(unscoped.revokedAt).toBeNull();
  });

  it("does not call the store for an empty stage list or a blank workroom, nor for a store without the method", async () => {
    const { store } = memoryStore([]);
    await expect(revokeStagePermits({ workroomId: "WC-RW", stageKeys: [], now: NOW }, store)).resolves.toBe(0);
    await expect(revokeStagePermits({ workroomId: " ", stageKeys: ["a"], now: NOW }, store)).resolves.toBe(0);
    expect(store.revokeStagePermits).not.toHaveBeenCalled();
    await expect(revokeStagePermits({ workroomId: "WC-RW", stageKeys: ["a"], now: NOW }, {})).resolves.toBe(0);
  });

  it("is fail-open: a store error is logged and revokes nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = { revokeStagePermits: vi.fn(async () => { throw new Error("db blip"); }) };
    await expect(revokeStagePermits({ workroomId: "WC-RW", stageKeys: ["a"], now: NOW }, failing)).resolves.toBe(0);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });
});
