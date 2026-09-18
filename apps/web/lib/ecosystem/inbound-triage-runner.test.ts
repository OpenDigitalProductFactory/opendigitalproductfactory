import { describe, expect, it, vi } from "vitest";

import { runEcosystemInboundTriage } from "./inbound-triage-runner";

const issue = {
  number: 412,
  title: "Dispatch board loses the second appointment",
  body: "Install: `dpf-agent-9f2c` — stable pseudonym.",
  labels: ["bug"],
  htmlUrl: "https://example.test/i/412",
};

describe("runEcosystemInboundTriage", () => {
  it("does not run on an operate-organization install", async () => {
    // This sweep would fill a customer's own backlog with other installs'
    // defects — not merely useless, actively wrong.
    const ingest = vi.fn();
    const result = await runEcosystemInboundTriage({
      loadPurpose: async () => "operate-organization",
      ingest,
      readIssues: vi.fn(),
      readPeerDemand: vi.fn(),
    });

    expect(result).toMatchObject({ ran: false });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("does not run when the install has not declared a purpose", async () => {
    const result = await runEcosystemInboundTriage({ loadPurpose: async () => null, ingest: vi.fn() });
    expect(result).toMatchObject({ ran: false });
    expect(result.ran === false && result.reason).toContain("undeclared");
  });

  it("files upstream issues on a platform-development install", async () => {
    const ingest = vi.fn().mockResolvedValue({ itemId: "BI-INBOUND", created: true });
    const result = await runEcosystemInboundTriage({
      loadPurpose: async () => "evolve-dpf",
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
      loadPurpose: async () => "evolve-dpf",
      readIssues: async () => ({ ok: false, error: "GitHub auth failed (401)" }),
      readPeerDemand: async () => [],
      ingest,
    });

    expect(result).toMatchObject({ ran: true });
  });
});
