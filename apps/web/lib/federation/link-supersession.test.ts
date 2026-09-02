import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { normalizeAuthorityUrl, planSupersession, supersedeStaleSameOrgLinks, type SupersessionLinkRow } from "./link-supersession";

function row(linkId: string, overrides: Partial<SupersessionLinkRow> = {}): SupersessionLinkRow {
  return {
    linkId, role: "same-org-peer", peerAuthorityUrl: "http://192.168.0.200:3000", peerInstallationId: null,
    enrolledAt: new Date("2026-08-28T00:00:00Z"), createdAt: new Date("2026-08-28T00:00:00Z"), ...overrides,
  };
}

describe("planSupersession", () => {
  it("keeps the newest link per peer installation and supersedes the rest", () => {
    const inst = `inst_${"a".repeat(32)}`;
    const plan = planSupersession([
      row("link_old", { peerInstallationId: inst, enrolledAt: new Date("2026-08-01T00:00:00Z") }),
      row("link_new", { peerInstallationId: inst, enrolledAt: new Date("2026-08-28T00:00:00Z") }),
      row("link_mid", { peerInstallationId: inst, enrolledAt: new Date("2026-08-15T00:00:00Z") }),
    ]);
    expect(plan).toEqual([
      { linkId: "link_mid", supersededBy: "link_new" },
      { linkId: "link_old", supersededBy: "link_new" },
    ]);
  });

  it("falls back to the normalised authority URL when the peer identity is unknown", () => {
    const plan = planSupersession([
      row("a", { peerAuthorityUrl: "http://192.168.0.200:3000/", enrolledAt: new Date("2026-08-01T00:00:00Z") }),
      row("b", { peerAuthorityUrl: "HTTP://192.168.0.200:3000", enrolledAt: new Date("2026-08-02T00:00:00Z") }),
      row("c", { peerAuthorityUrl: "http://192.168.0.152:3000" }),
    ]);
    expect(plan).toEqual([{ linkId: "a", supersededBy: "b" }]);
    expect(normalizeAuthorityUrl("https://peer.example/")).toBe("peer.example:443");
  });

  it("never touches cross-organization links and is stable on ties", () => {
    expect(planSupersession([row("x", { role: "managed-by" }), row("y", { role: "managed-by" })])).toEqual([]);
    const tie = planSupersession([row("b"), row("a")]);
    expect(tie).toEqual([{ linkId: "b", supersededBy: "a" }]);
  });
});

describe("supersedeStaleSameOrgLinks", () => {
  it("revokes the losers with a superseded-by reason and clears their token", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      federationLink: {
        findMany: vi.fn().mockResolvedValue([
          row("old", { enrolledAt: new Date("2026-08-01T00:00:00Z") }),
          row("new", { enrolledAt: new Date("2026-08-28T00:00:00Z") }),
        ]),
        updateMany,
      },
    };
    const now = new Date("2026-09-02T10:00:00Z");
    const result = await supersedeStaleSameOrgLinks(db, now);
    expect(result.revoked).toEqual([{ linkId: "old", supersededBy: "new" }]);
    expect(updateMany).toHaveBeenCalledWith({
      where: { linkId: "old", revokedAt: null },
      data: { revokedAt: now, revocationReason: "superseded-by:new", linkState: "revoked", tokenHash: null },
    });
  });
});
