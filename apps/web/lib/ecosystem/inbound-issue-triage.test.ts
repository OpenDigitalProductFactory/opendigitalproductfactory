import { describe, expect, it, vi } from "vitest";

import {
  composeInboundBody,
  mapPeerDemandMirrors,
  mapUpstreamIssues,
  runInboundIssueTriage,
  toBacklogIngestInput,
  type InboundEcosystemItem,
} from "./inbound-issue-triage";

const item = (overrides: Partial<InboundEcosystemItem> = {}): InboundEcosystemItem => ({
  sourceKind: "upstream-issue",
  sourceId: "412",
  title: "Dispatch board loses the second appointment",
  summary: "Booking two jobs in one slot silently drops the later one.",
  workType: "bug",
  submitter: "dpf-agent-9f2c",
  ...overrides,
});

describe("toBacklogIngestInput", () => {
  it("records the submitter's request as a user-request, not an automated detection", () => {
    // The origin is a person at another install; it merely ARRIVES by automation.
    // Recording it as automated-detection would erase the submitter that the
    // arbitration model later weighs.
    expect(toBacklogIngestInput(item()).source).toBe("user-request");
  });

  it("carries a provenance origin so a re-run dedupes instead of filing a copy", () => {
    expect(toBacklogIngestInput(item()).origin).toEqual({
      kind: "ecosystem-upstream-issue",
      id: "412",
    });
  });

  it("distinguishes the two transports in the origin kind", () => {
    const demand = toBacklogIngestInput(item({ sourceKind: "peer-demand", sourceId: "fdm_1" }));
    expect(demand.origin).toEqual({ kind: "ecosystem-peer-demand", id: "fdm_1" });
    expect(demand.lifecycleTags).toContain("peer-demand");
  });

  it("decodes namespaced archetype refs back into backlog scope", () => {
    const input = toBacklogIngestInput(item({
      archetypeRefs: ["scope:archetype-category", "category:trades-maintenance", "archetype:mobile-locksmith"],
    }));
    expect(input.scopeKind).toBe("archetype-category");
    expect(input.archetypeCategories).toEqual(["trades-maintenance"]);
    expect(input.archetypeIds).toEqual(["mobile-locksmith"]);
  });

  it("keeps a platform-scoped submission universally applicable", () => {
    const input = toBacklogIngestInput(item({ archetypeRefs: ["scope:platform"] }));
    expect(input.scopeKind).toBe("platform");
    expect(input.archetypeCategories).toBeUndefined();
  });

  it("falls back to a known work type rather than writing an invalid enum value", () => {
    expect(toBacklogIngestInput(item({ workType: "not-a-work-type" })).workType).toBe("feature");
    expect(toBacklogIngestInput(item({ workType: null })).workType).toBe("feature");
  });

  it("preserves the submitter and reach in the body an operator reads", () => {
    const body = composeInboundBody(item({ affectedOrganizations: 3, url: "https://example.test/i/412" }));
    expect(body).toContain("dpf-agent-9f2c");
    expect(body).toContain("3 organizations affected");
    expect(body).toContain("https://example.test/i/412");
  });

  it("omits the provenance block entirely when nothing is known", () => {
    expect(composeInboundBody(item({ submitter: null }))).toBe(
      "Booking two jobs in one slot silently drops the later one.",
    );
  });
});

describe("runInboundIssueTriage", () => {
  it("counts a matched existing item as deduped rather than newly ingested", async () => {
    const ingest = vi.fn()
      .mockResolvedValueOnce({ itemId: "BI-NEW", created: true })
      .mockResolvedValueOnce({ itemId: "BI-OLD", created: false });

    const result = await runInboundIssueTriage({
      items: [item({ sourceId: "1" }), item({ sourceId: "2" })],
      ingest,
    });

    expect(result).toMatchObject({ ingested: 1, deduped: 1, failed: 0 });
    expect(result.itemIds).toEqual(["BI-NEW", "BI-OLD"]);
  });

  it("fault-isolates a throwing item so every later item still files", async () => {
    const onFailure = vi.fn();
    const ingest = vi.fn()
      .mockResolvedValueOnce({ itemId: "BI-A", created: true })
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ itemId: "BI-C", created: true });

    const result = await runInboundIssueTriage({
      items: [item({ sourceId: "a" }), item({ sourceId: "b" }), item({ sourceId: "c" })],
      ingest,
      onFailure,
    });

    expect(ingest).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ ingested: 2, failed: 1 });
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("reports an empty sweep without calling the front door", async () => {
    const ingest = vi.fn();
    expect(await runInboundIssueTriage({ items: [], ingest })).toEqual({
      ingested: 0, deduped: 0, failed: 0, itemIds: [],
    });
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe("mapUpstreamIssues", () => {
  const issue = (overrides = {}) => ({
    number: 412,
    title: "Dispatch board loses the second appointment",
    body: [
      "## Summary",
      "Booking two jobs in one slot drops the later one.",
      "",
      "## Reported by",
      "Install: `dpf-agent-9f2c` — this pseudonym is stable across all issues and PRs from this install.",
    ].join("\n"),
    labels: ["bug"],
    htmlUrl: "https://example.test/i/412",
    ...overrides,
  });

  it("recovers the install pseudonym the issue bridge stamped into the body", () => {
    // Verified against the real bridge format in build/issue-bridge.ts, not guessed.
    expect(mapUpstreamIssues([issue()])[0].submitter).toBe("dpf-agent-9f2c");
  });

  it("adopts a label that names a known work type, and ignores one that does not", () => {
    expect(mapUpstreamIssues([issue()])[0].workType).toBe("bug");
    expect(mapUpstreamIssues([issue({ labels: ["needs-triage"] })])[0].workType).toBeNull();
  });

  it("falls back to the title when the issue has no body", () => {
    const mapped = mapUpstreamIssues([issue({ body: null })])[0];
    expect(mapped.summary).toBe("Dispatch board loses the second appointment");
    expect(mapped.submitter).toBeNull();
  });
});

describe("mapPeerDemandMirrors", () => {
  const decode = (payload: unknown) => payload as { envelope: never } | null;

  it("preserves the applicability refs and origin install the ops read model drops", () => {
    const rows = [{
      mirrorId: "fdm_1",
      payload: {
        envelope: {
          title: "Cold chain alert is late",
          summary: "Threshold breach notifies after the excursion.",
          workType: "bug",
          originInstallationId: "inst_peer",
          applicability: { archetypeRefs: ["scope:archetype-category", "category:logistics"] },
          signal: { occurrenceCount: 7, affectedOrganizations: 2 },
        },
      },
    }];

    expect(mapPeerDemandMirrors(rows, decode)).toEqual([{
      sourceKind: "peer-demand",
      sourceId: "fdm_1",
      title: "Cold chain alert is late",
      summary: "Threshold breach notifies after the excursion.",
      workType: "bug",
      occurrenceCount: 7,
      archetypeRefs: ["scope:archetype-category", "category:logistics"],
      submitter: "inst_peer",
      affectedOrganizations: 2,
    }]);
  });

  it("skips a mirror whose payload does not decode instead of filing a blank item", () => {
    expect(mapPeerDemandMirrors([{ mirrorId: "fdm_bad", payload: null }], () => null)).toEqual([]);
  });
});
