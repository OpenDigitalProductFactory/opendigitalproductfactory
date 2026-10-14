import { describe, expect, it, vi } from "vitest";

import { runEcosystemInboundTriage } from "./inbound-triage-runner";

// Envelope validation has its own suite; these cases exercise transport isolation.
vi.mock("@/lib/federation/demand-exchange", () => ({
  decodeDemandMirrorPayload: (payload: unknown) => payload,
}));

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
      origin: { kind: "ecosystem-upstream-issue", id: "412" },
    });
    expect(filed.body).toContain("dpf-agent-9f2c");
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
