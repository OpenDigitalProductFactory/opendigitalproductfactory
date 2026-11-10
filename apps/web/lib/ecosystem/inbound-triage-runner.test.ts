import { describe, expect, it, vi } from "vitest";

import { readIntakePeerDemand, runEcosystemInboundTriage, type IntakePeerDemandDb } from "./inbound-triage-runner";

// Envelope validation has its own suite; these cases exercise transport isolation.
vi.mock("@/lib/federation/demand-exchange", () => ({
  decodeDemandMirrorPayload: (payload: unknown) => payload,
}));
vi.mock("./dependabot-reader", () => ({ readDependabotAlerts: async () => ({ ok: true, alerts: [] }) }));

const commissioned = async () => ({
  commissioned: true as const,
  workroomCapsuleId: "WC-CONTROLLER",
  repo: { owner: "OpenDigitalProductFactory", name: "opendigitalproductfactory" },
});

const issue = {
  number: 412,
  title: "Dispatch board loses the second appointment",
  body: "Install: `dpf-agent-9f2c` — stable pseudonym.",
  labels: ["bug"],
  htmlUrl: "https://example.test/i/412",
};

describe("runEcosystemInboundTriage", () => {
  it("keeps issue intake but reports unavailable security coverage", async () => {
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned, readIssues: async () => ({ ok: true, issues: [issue] }),
      readPeerDemand: async () => [], readAlerts: async () => ({ ok: false, error: "Dependabot HTTP 403" }),
      ingest: vi.fn().mockResolvedValue({ itemId: "BI-ISSUE", created: false, outcome: "unchanged" }),
    });
    expect(result).toMatchObject({ ran: true, complete: false, unchanged: 1,
      sourceErrors: [{ source: "dependabot", error: "Dependabot HTTP 403" }] });
  });

  it("marks a successful empty scan as complete", async () => {
    expect(await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => ({ ok: true, issues: [] }),
      readPeerDemand: async () => [], ingest: vi.fn(),
    })).toMatchObject({ ran: true, complete: true, sourceErrors: [] });
  });

  it("preserves upstream ingestion when the peer source throws and exposes the missing coverage", async () => {
    const ingest = vi.fn().mockResolvedValue({ itemId: "BI-INBOUND", created: true });
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => ({ ok: true, issues: [issue] }),
      readPeerDemand: async () => { throw new Error("peer unavailable"); }, ingest,
    });
    expect(result).toMatchObject({ ran: true, complete: false, ingested: 1,
      sourceErrors: [{ source: "peer-demand", error: "peer unavailable" }] });
    expect(ingest).toHaveBeenCalledOnce();
  });

  it("still reads the peer source after a thrown GitHub read", async () => {
    const readPeerDemand = vi.fn().mockResolvedValue([]);
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => { throw new Error("GitHub unavailable"); },
      readPeerDemand, ingest: vi.fn(),
    });
    expect(readPeerDemand).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ran: true, complete: false,
      sourceErrors: [{ source: "upstream-issue", error: "GitHub unavailable" }] });
  });

  it("does not treat a malformed successful read as an empty source", async () => {
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned, readIssues: async () => ({ ok: true }),
      readPeerDemand: async () => [], ingest: vi.fn(),
    });
    expect(result).toMatchObject({ ran: true, complete: false,
      sourceErrors: [{ source: "upstream-issue", error: expect.any(String) }] });
  });

  it("marks item ingestion failures incomplete too", async () => {
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned, readIssues: async () => ({ ok: true, issues: [issue] }),
      readPeerDemand: async () => [], ingest: vi.fn().mockRejectedValue(new Error("write failed")), onFailure: vi.fn(),
    });
    expect(result).toMatchObject({ ran: true, complete: false, failed: 1 });
  });

  it("does not run, read or ingest when the controller is not commissioned", async () => {
    // An evolve-dpf purpose alone does not prove repository-controller ownership
    // (spec §6.1): the refusal names the missing binding and nothing is touched.
    const ingest = vi.fn();
    const readIssues = vi.fn();
    const readPeerDemand = vi.fn();
    const result = await runEcosystemInboundTriage({
      loadCommission: async () => ({ commissioned: false as const, reason: "not commissioned: installation is not a production install" }),
      ingest, readIssues, readPeerDemand,
    });

    expect(result).toEqual({ ran: false, reason: "not commissioned: installation is not a production install" });
    expect(readIssues).not.toHaveBeenCalled();
    expect(readPeerDemand).not.toHaveBeenCalled();
    expect(ingest).not.toHaveBeenCalled();
  });

  it("reports a thrown commission check as not commissioned rather than running", async () => {
    const ingest = vi.fn();
    const result = await runEcosystemInboundTriage({
      loadCommission: async () => { throw new Error("database unavailable"); }, ingest,
    });
    expect(result).toMatchObject({ ran: false, reason: expect.stringMatching(/^not commissioned: .*database unavailable/) });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("reads issues from the commissioned repository explicitly", async () => {
    const readIssues = vi.fn().mockResolvedValue({ ok: true, issues: [] });
    await runEcosystemInboundTriage({
      loadCommission: commissioned, readIssues, readPeerDemand: async () => [], ingest: vi.fn(),
    });
    expect(readIssues).toHaveBeenCalledWith({ owner: "OpenDigitalProductFactory", name: "opendigitalproductfactory" });
  });

  it("files upstream issues on a platform-development install", async () => {
    const ingest = vi.fn().mockResolvedValue({ itemId: "BI-INBOUND", created: true });
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => ({ ok: true, issues: [issue] }),
      readPeerDemand: async () => [],
      ingest,
    });

    expect(result).toMatchObject({ ran: true, ingested: 1, deduped: 0, failed: 0 });
    expect(ingest).toHaveBeenCalledOnce();
    const filed = ingest.mock.calls[0][0];
    expect(filed).toMatchObject({
      source: "user-request",
      workType: "bug",
      origin: { kind: "ecosystem-upstream-issue", id: "opendigitalproductfactory/opendigitalproductfactory#412" },
      reconcile: expect.objectContaining({ repository: "opendigitalproductfactory/opendigitalproductfactory", legacyId: "412" }),
    });
    expect(filed.body).toContain("dpf-agent-9f2c");
  });

  it("surfaces a needs-review origin in the run summary without filing work", async () => {
    const ingest = vi.fn().mockResolvedValue({ itemId: "", created: false, outcome: "needs-review", reviewCandidates: ["BI-A", "BI-B"] });
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => ({ ok: true, issues: [issue] }),
      readPeerDemand: async () => [],
      ingest,
    });
    expect(result).toMatchObject({ ran: true, complete: false, ingested: 0, needsReview: 1,
      reviews: [{ origin: "ecosystem-upstream-issue:opendigitalproductfactory/opendigitalproductfactory#412", candidates: ["BI-A", "BI-B"] }] });
  });

  it("still files peer demand when the upstream issue read fails", async () => {
    // "Nothing inbound" and "could not look" are different verdicts; a failed
    // read must not silently become an empty sweep that drops the other transport.
    const ingest = vi.fn().mockResolvedValue({ itemId: "BI-PEER", created: true });
    const result = await runEcosystemInboundTriage({
      loadCommission: commissioned,
      readIssues: async () => ({ ok: false, error: "GitHub auth failed (401)" }),
      readPeerDemand: async () => [{ mirrorId: "peer-demand-example", payload: {
        envelope: { title: "Customer request", summary: "Peer transport is still available" },
      } }],
      ingest,
    });

    expect(result).toMatchObject({ ran: true, complete: false,
      sourceErrors: [{ source: "upstream-issue", error: "GitHub auth failed (401)" }] });
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      origin: { kind: "ecosystem-peer-demand", id: "peer-demand-example" },
    }));
  });
});

// BI-F4866228: the first commissioned production run filed ~4,000 copies of the
// paired installation's backlog, because same-organization links send their
// whole backlog as demand envelopes and work sync already mirrors it here. The
// fake applies the same where clause the reader sends, so these cases pin which
// links the reader asks for, not Prisma's filtering.
describe("readIntakePeerDemand", () => {
  type Link = { linkId: string; role: string; linkState: string; revokedAt: Date | null; quarantinedAt: Date | null };
  type Mirror = { mirrorId: string; federationLinkId: string; recordType: string; canonicalSide: string; payload: unknown };

  function fakeDb(links: Link[], mirrors: Mirror[]): IntakePeerDemandDb {
    return {
      federationLink: {
        findMany: async (args: unknown) => {
          const where = (args as { where: { linkState: string; role: { not: string } } }).where;
          return links
            .filter((link) => link.linkState === where.linkState && link.role !== where.role.not
              && link.revokedAt === null && link.quarantinedAt === null)
            .map(({ linkId }) => ({ linkId }));
        },
      },
      federatedRecordMirror: {
        findMany: async (args: unknown) => {
          const where = (args as { where: { recordType: string; canonicalSide: string; federationLinkId: { in: string[] } } }).where;
          return mirrors
            .filter((mirror) => mirror.recordType === where.recordType && mirror.canonicalSide === where.canonicalSide
              && where.federationLinkId.in.includes(mirror.federationLinkId))
            .map(({ mirrorId, payload }) => ({ mirrorId, payload }));
        },
      },
    };
  }

  const live = { linkState: "trusted", revokedAt: null, quarantinedAt: null };
  const envelope = (mirrorId: string, federationLinkId: string): Mirror => ({
    mirrorId, federationLinkId, recordType: "demand-envelope", canonicalSide: "peer", payload: { mirrorId },
  });

  it("files only demand from live links to other organizations", async () => {
    const db = fakeDb(
      [
        { linkId: "link_paired", role: "same-org-peer", ...live },
        { linkId: "link_old_pairing", role: "same-org-peer", linkState: "revoked", revokedAt: new Date(), quarantinedAt: null },
        { linkId: "link_community", role: "community-peer", ...live },
        { linkId: "link_revoked_community", role: "community-peer", linkState: "revoked", revokedAt: new Date(), quarantinedAt: null },
      ],
      [
        envelope("fdm_paired", "link_paired"),
        envelope("fdm_old_pairing", "link_old_pairing"),
        envelope("fdm_community", "link_community"),
        envelope("fdm_revoked_community", "link_revoked_community"),
        { ...envelope("fdm_local", "link_community"), canonicalSide: "local" },
      ],
    );
    expect((await readIntakePeerDemand(db)).map((row) => row.mirrorId)).toEqual(["fdm_community"]);
  });

  it("reads no envelopes at all when the only peers are the organization's own installations", async () => {
    const db = fakeDb(
      [{ linkId: "link_paired", role: "same-org-peer", ...live }],
      Array.from({ length: 4000 }, (_, i) => envelope(`fdm_${i}`, "link_paired")),
    );
    expect(await readIntakePeerDemand(db)).toEqual([]);
  });
});
