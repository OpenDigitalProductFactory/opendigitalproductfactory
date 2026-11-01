import { beforeEach, describe, expect, it, vi } from "vitest";

const activity = vi.hoisted(() => ({ record: vi.fn(async () => ({ id: "scope-activity" })) }));
vi.mock("./work-capsule-activity-store", () => ({ recordWorkCapsuleActivity: activity.record }));

import * as targets from "./scope-release-targets";
import { parseScopeReleaseClaims } from "./scope-release-authorization";
import { releaseWorkCapsuleScope } from "./scope-release-store";

const now = new Date("2026-11-01T10:00:00Z");
const actor = { userId: "operator", agentId: "assistant", principalId: "owner" };
const originalEpoch = "00000000-0000-4000-8000-000000000001";
const newerEpoch = "00000000-0000-4000-8000-000000000002";
const owned = {
  kind: "path" as const,
  value: "package.json",
  intent: "edit" as const,
  recordedByPrincipalId: "owner",
  releaseEpoch: originalEpoch,
};

function fixture(claims: unknown[] = [owned]) {
  const row = {
    id: "original-room-row",
    capsuleId: "WC-TARGET",
    status: "working",
    archivedAt: null,
    updatedAt: now,
    scopeClaims: claims.map(entry => entry && typeof entry === "object" && "kind" in entry
      ? { ...entry, recordedAt: now.toISOString() } : entry),
    leaseHolderPrincipalId: "owner",
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  };
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }));
  const db = {
    workroom: { findUnique: vi.fn(async () => row), update },
    $transaction: async <T>(write: (tx: unknown) => Promise<T>): Promise<T> => write(db),
  };
  return { row, db, update };
}

function release(f: ReturnType<typeof fixture>, claims = [owned], expectedRoomId = "original-room-row") {
  return releaseWorkCapsuleScope({
    db: f.db,
    capsuleId: "WC-TARGET",
    expectedRoomId,
    claims,
    actor,
    ownScopeOnly: true,
    now,
  } as unknown as Parameters<typeof releaseWorkCapsuleScope>[0]);
}

beforeEach(() => vi.clearAllMocks());

describe("proof-sensitive original target classification", () => {
  const classify = (entries: unknown[], originals = [owned], rowId = "original-room-row") => {
    const fn = (targets as unknown as { classifyOriginalScopeReleaseTargets?:
      (room: unknown, id: string, claims: unknown[]) => string }).classifyOriginalScopeReleaseTargets;
    expect(fn).toBeTypeOf("function");
    return fn!(fixture(entries).row, rowId, originals);
  };
  it("distinguishes an exact current target from a positively ended one", () => {
    expect(classify([owned])).toBe("current");
    expect(classify([{ workShape: "delivery-medium@1.0.0" }])).toBe("obsolete");
  });
  it("recognizes replacement only with a different valid epoch", () => {
    expect(classify([{ ...owned, releaseEpoch: newerEpoch }])).toBe("obsolete");
  });
  it.each([{ recordedByPrincipalId: "different-owner" }, { intent: "read" }])(
    "treats identity changes under the same epoch as unknown: %j", change => {
      expect(classify([{ ...owned, ...change }])).toBe("unknown");
    });
  it("does not turn malformed, duplicate or legacy ownership into disappearance", () => {
    for (const entries of [[{ ...owned, releaseEpoch: "bad" }], [owned, owned],
      [{ kind: "path", value: owned.value, intent: "edit" }], [null], [{ kind: "unrecognized", value: owned.value }]]) {
      expect(classify(entries)).toBe("unknown");
    }
  });
  it("requires the original persistent room and a complete valid request", () => {
    expect(classify([], [owned], "restored-room-row")).toBe("unknown");
    expect(classify([], [])).toBe("unknown");
  });
  it("marks a mixed current and positively ended batch obsolete", () => {
    const other = { ...owned, value: "second.ts" };
    expect(classify([owned], [owned, other])).toBe("obsolete");
  });
  it("lets unknown defeat positive obsolescence in the same full batch", () => {
    const other = { ...owned, value: "second.ts" };
    expect(classify([{ ...owned, recordedByPrincipalId: "different-owner" }], [owned, other])).toBe("unknown");
  });
});

describe("original scope-release target survives a deferred request", () => {
  it("preserves the caller's exact epoch, owner and intent at ingress", () => {
    expect(parseScopeReleaseClaims([owned])).toEqual([owned]);
  });

  it("refuses legacy kind/value input instead of capturing today's target", () => {
    expect(parseScopeReleaseClaims([{ kind: "path", value: "package.json" }])).toBeNull();
  });

  it("refuses conflicting duplicates rather than choosing one epoch", () => {
    expect(parseScopeReleaseClaims([owned, { ...owned, releaseEpoch: newerEpoch }])).toBeNull();
  });

  it("deduplicates only identical complete targets", () => {
    expect(parseScopeReleaseClaims([owned, { ...owned }])).toEqual([owned]);
  });

  it("does not release a later acquisition by the same owner on the same path", async () => {
    const f = fixture([{ ...owned, releaseEpoch: newerEpoch }]);
    await expect(release(f)).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("does not apply an old intent to a restored row with the same capsule key", async () => {
    const f = fixture();
    f.row.id = "restored-room-row";
    await expect(release(f)).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("refuses changed intent even when owner and epoch appear unchanged", async () => {
    const f = fixture([{ ...owned, intent: "read" }]);
    await expect(release(f)).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("rejects the whole batch when one original target is stale", async () => {
    const other = { ...owned, value: "second.ts" };
    const f = fixture([owned, { ...other, releaseEpoch: newerEpoch }]);
    await expect(release(f, [owned, other])).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });

  it("removes claim-owned epoch metadata while preserving genuine shape records", async () => {
    const shape = { workShape: "delivery-medium@1.0.0" };
    const other = { ...owned, value: "another.ts" };
    const f = fixture([shape, owned, other]);
    await release(f);
    expect(f.update).toHaveBeenCalledExactlyOnceWith({
      where: expect.objectContaining({ scopeClaims: { equals: f.row.scopeClaims }, updatedAt: now }),
      data: { scopeClaims: [shape, f.row.scopeClaims[2]] },
    });
    expect(activity.record).toHaveBeenCalledOnce();
  });

  it("retains the existing foreign-lease refusal", async () => {
    const f = fixture();
    f.row.leaseHolderPrincipalId = "another-owner";
    await expect(release(f)).rejects.toThrow();
    expect(f.update).not.toHaveBeenCalled();
    expect(activity.record).not.toHaveBeenCalled();
  });
});


describe("release receipt preparation", () => {
  const prepare = (params: Record<string, unknown>) => {
    expect(targets).toHaveProperty("prepareScopeRelease");
    return targets.prepareScopeRelease(params);
  };
  it("rejects legacy targets before any receipt lookup", () => {
    expect(prepare({ capsuleId: "WC-TARGET", claims: [{ kind: "path", value: "package.json" }], commandId: "cmd" })).toHaveProperty("refusal");
  });
  it("keeps valid unkeyed release supported", () => {
    expect(prepare({ capsuleId: "WC-TARGET", expectedRoomId: "original-room-row", claims: [owned] })).toBeUndefined();
  });
  it("binds normalized original targets and persistent room identity", () => {
    const result = prepare({ capsuleId: " WC-TARGET ", expectedRoomId: "original-room-row", claims: [owned, owned], commandId: " cmd " });
    if (!result || "refusal" in result) throw new Error("Expected bound release preparation");
    expect(result.params).toEqual({ capsuleId: "WC-TARGET", expectedRoomId: "original-room-row", claims: [owned], commandId: "cmd" });
    expect(result.expectedRoomRowId).toBe("original-room-row");
    const changed = prepare({ ...result.params, claims: [{ ...owned, releaseEpoch: newerEpoch }] });
    if (!changed || "refusal" in changed) throw new Error("Expected changed bound preparation");
    expect(result.payloadBinding).not.toEqual(changed.payloadBinding);
    const another = prepare({ ...result.params, commandId: "different-command" });
    if (!another || "refusal" in another) throw new Error("Expected another bound preparation");
    expect(result.payloadBinding).toEqual(another.payloadBinding);
  });
});
