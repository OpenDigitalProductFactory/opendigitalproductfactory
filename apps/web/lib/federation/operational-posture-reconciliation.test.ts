import { describe, expect, it, vi } from "vitest";

import {
  runOperationalPostureReconciliation,
  type OperationalPostureReconciliationDb,
} from "./operational-posture-reconciliation";

const identity = { installationId: `inst_${"a".repeat(32)}`, projectionSecret: "b".repeat(64) };
const now = new Date("2026-09-06T10:00:00.000Z");
const source = {
  servedVersion: "5.12.0",
  servedSha: "abc123",
  patchPosture: { critical: 0, high: 0, medium: 0, low: 0 },
  health: { status: "healthy" as const, estateItemCount: 3 },
  runtime: { targetCount: 1, healthyCount: 1 },
  capturedAt: now,
  updatedAt: now,
};
const sameOrg = { linkId: "link_same_org", role: "same-org-peer", peerAuthorityUrl: "http://10.0.0.5:3000", peerTokenEnc: "enc" };
const provider = { linkId: "link_provider", role: "managed-by", peerAuthorityUrl: "https://msp.example", peerTokenEnc: "enc" };
const delivery = { attempted: 0, delivered: 0, deferred: 0, deadLettered: 0 };

function deps(overrides: Record<string, unknown> = {}) {
  return {
    resolveIdentity: vi.fn().mockResolvedValue(identity),
    capture: vi.fn().mockResolvedValue(source),
    queueProjection: vi.fn().mockResolvedValue({ action: "queued", mirrorId: "fopo_1", originVersion: 1 }),
    dispatch: vi.fn().mockResolvedValue(delivery),
    now,
    ...overrides,
  };
}

function db(links: unknown[]) {
  return { federationLink: { findMany: vi.fn().mockResolvedValue(links) } } as unknown as OperationalPostureReconciliationDb;
}

describe("runOperationalPostureReconciliation", () => {
  it("projects this install's posture to every trusted same-organization link only", async () => {
    const d = deps();
    const result = await runOperationalPostureReconciliation(db([sameOrg, provider]), d);

    expect(result).toMatchObject({ links: 1, projected: 1, unchanged: 0, failed: 0 });
    expect(d.capture).toHaveBeenCalledOnce();
    expect(d.queueProjection).toHaveBeenCalledOnce();
    expect(d.queueProjection.mock.calls[0][1]).toMatchObject({ link: sameOrg, source, identity, now });
    // The outbox is drained in the same cycle.
    expect(d.dispatch).toHaveBeenCalledOnce();
  });

  it("selects only trusted, unrevoked, unquarantined links", async () => {
    const store = db([]);
    await runOperationalPostureReconciliation(store, deps());
    expect(store.federationLink.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { linkState: "trusted", revokedAt: null, quarantinedAt: null },
    }));
  });

  it("does nothing — no capture, no identity, no drain — without a same-organization link", async () => {
    const d = deps();
    const result = await runOperationalPostureReconciliation(db([provider]), d);
    expect(result).toMatchObject({ links: 0, projected: 0, delivery });
    expect(d.capture).not.toHaveBeenCalled();
    expect(d.resolveIdentity).not.toHaveBeenCalled();
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("counts an unchanged report and fault-isolates a refused link", async () => {
    const other = { ...sameOrg, linkId: "link_same_org_2" };
    const third = { ...sameOrg, linkId: "link_same_org_3" };
    const d = deps({
      queueProjection: vi.fn()
        .mockResolvedValueOnce({ action: "noop", mirrorId: "fopo_1", originVersion: 1 })
        .mockRejectedValueOnce(new Error("Operational posture projection refused: runtime.healthyCount:exceeds-target"))
        .mockResolvedValueOnce({ action: "queued", mirrorId: "fopo_3", originVersion: 1 }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await runOperationalPostureReconciliation(db([sameOrg, other, third]), d);

    expect(result).toMatchObject({ links: 3, projected: 1, unchanged: 1, failed: 1 });
    expect(d.queueProjection).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("link_same_org_2"));
    warn.mockRestore();
  });
});
