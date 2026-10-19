import { describe, expect, it, vi } from "vitest";

import { migrateMirrorsFromPriorLinks, NON_TERMINAL_MIRROR_STATUSES } from "./enrollment";

/**
 * BI-6C33AF7C. The digest exchange walks mirrors by federationLinkId for the
 * CURRENT link only, so anything still owed on a link that was later revoked is
 * never visited by any cycle again. Re-enrolling a peer orphaned its backlog.
 *
 * The identity rule is the load-bearing part: match on peerInstallationId, never
 * on peerAuthorityUrl. On the install that surfaced this, three revoked links
 * shared ONE address but carried TWO different installation ids plus a null,
 * because the peer had been reinstalled. Matching by address would have handed
 * records addressed to one installation to a different one.
 */
function tx(opts: { priorLinks?: Array<{ linkId: string }>; moved?: number } = {}) {
  const findMany = vi.fn().mockResolvedValue(opts.priorLinks ?? []);
  const updateMany = vi.fn().mockResolvedValue({ count: opts.moved ?? 0 });
  return {
    tx: {
      principal: { create: vi.fn() },
      principalAlias: { create: vi.fn() },
      federationLink: { create: vi.fn(), findMany },
      federatedRecordMirror: { updateMany },
    },
    findMany,
    updateMany,
  };
}

describe("migrateMirrorsFromPriorLinks", () => {
  it("adopts undelivered mirrors from a prior link for the same peer installation", async () => {
    const { tx: db, updateMany } = tx({ priorLinks: [{ linkId: "link_old" }], moved: 874 });

    const result = await migrateMirrorsFromPriorLinks(db, {
      newLinkId: "link_new",
      peerInstallationId: "inst_same",
    });

    expect(result).toEqual({ movedMirrors: 874, fromLinkIds: ["link_old"] });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        federationLinkId: { in: ["link_old"] },
        syncStatus: { in: ["pending", "dead-letter", "conflict"] },
      },
      data: { federationLinkId: "link_new" },
    });
  });

  it("matches on peerInstallationId, never on the peer address", async () => {
    const { tx: db, findMany } = tx({ priorLinks: [{ linkId: "link_old" }], moved: 1 });

    await migrateMirrorsFromPriorLinks(db, {
      newLinkId: "link_new",
      peerInstallationId: "inst_same",
    });

    const [args] = findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({ peerInstallationId: "inst_same", linkId: { not: "link_new" } });
    // An address is not an identity — a reinstalled peer reuses the URL.
    expect(JSON.stringify(args.where)).not.toContain("peerAuthorityUrl");
  });

  it("does nothing when the new link has no recorded installation identity", async () => {
    // Unprovable identity is left for an operator, not guessed at.
    const { tx: db, findMany, updateMany } = tx({ priorLinks: [{ linkId: "link_old" }] });

    const result = await migrateMirrorsFromPriorLinks(db, {
      newLinkId: "link_new",
      peerInstallationId: null,
    });

    expect(result).toEqual({ movedMirrors: 0, fromLinkIds: [] });
    expect(findMany).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("does nothing when this peer installation has no prior links", async () => {
    const { tx: db, updateMany } = tx({ priorLinks: [] });

    const result = await migrateMirrorsFromPriorLinks(db, {
      newLinkId: "link_new",
      peerInstallationId: "inst_first_time",
    });

    expect(result).toEqual({ movedMirrors: 0, fromLinkIds: [] });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("moves only work the peer has not taken — never synced or withdrawn", () => {
    expect([...NON_TERMINAL_MIRROR_STATUSES]).toEqual(["pending", "dead-letter", "conflict"]);
    expect(NON_TERMINAL_MIRROR_STATUSES).not.toContain("synced");
    expect(NON_TERMINAL_MIRROR_STATUSES).not.toContain("withdrawn");
  });
});
