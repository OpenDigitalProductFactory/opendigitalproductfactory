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
  repository: "acme/widgets",
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

  it("carries a repository-qualified origin so a re-run reconciles instead of filing a copy (BI-952F08BA)", () => {
    const input = toBacklogIngestInput(item({ repository: "acme/widgets", url: "https://github.com/Acme/Widgets/issues/412", state: "open" }));
    expect(input.origin).toEqual({ kind: "ecosystem-upstream-issue", id: "acme/widgets#412" });
    expect(input.reconcile).toMatchObject({
      repository: "acme/widgets",
      sourceUrl: "https://github.com/Acme/Widgets/issues/412",
      state: "open",
      legacyId: "412",
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("keeps the same issue number in two repositories distinct", () => {
    const a = toBacklogIngestInput(item({ repository: "acme/widgets" }));
    const b = toBacklogIngestInput(item({ repository: "acme/gadgets" }));
    expect(a.origin?.id).not.toBe(b.origin?.id);
  });

  it("fingerprints content and state, so edits, closure and reopen are observable", () => {
    const base = toBacklogIngestInput(item({ repository: "acme/widgets", state: "open" })).reconcile!.fingerprint;
    expect(toBacklogIngestInput(item({ repository: "acme/widgets", state: "open" })).reconcile!.fingerprint).toBe(base);
    expect(toBacklogIngestInput(item({ repository: "acme/widgets", state: "closed" })).reconcile!.fingerprint).not.toBe(base);
    expect(toBacklogIngestInput(item({ repository: "acme/widgets", title: "Edited title" })).reconcile!.fingerprint).not.toBe(base);
  });

  it("refuses an upstream issue whose repository is unknown rather than filing an unqualified origin", () => {
    expect(() => toBacklogIngestInput(item({ repository: null }))).toThrow(/repository/);
  });

  it("leaves peer demand on the existing recurrence semantics", () => {
    expect(toBacklogIngestInput(item({ sourceKind: "peer-demand", sourceId: "fdm_1" })).reconcile).toBeUndefined();
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

  it("counts created, unchanged, changed and needs-review outcomes separately", async () => {
    const ingest = vi.fn()
      .mockResolvedValueOnce({ itemId: "BI-NEW", created: true, outcome: "created" })
      .mockResolvedValueOnce({ itemId: "BI-SAME", created: false, outcome: "unchanged" })
      .mockResolvedValueOnce({ itemId: "BI-EDIT", created: false, outcome: "changed" })
      .mockResolvedValueOnce({ itemId: "", created: false, outcome: "needs-review", reviewCandidates: ["BI-A", "BI-B"] });

    const result = await runInboundIssueTriage({
      items: [item({ sourceId: "1" }), item({ sourceId: "2" }), item({ sourceId: "3" }), item({ sourceId: "4" })],
      ingest,
    });

    expect(result).toMatchObject({ ingested: 1, unchanged: 1, changed: 1, needsReview: 1, failed: 0 });
    expect(result.itemIds).toEqual(["BI-NEW", "BI-SAME", "BI-EDIT"]);
    expect(result.reviews).toEqual([{ origin: "ecosystem-upstream-issue:acme/widgets#4", candidates: ["BI-A", "BI-B"] }]);
  });

  it("reports an empty sweep without calling the front door", async () => {
    const ingest = vi.fn();
    expect(await runInboundIssueTriage({ items: [], ingest })).toEqual({
      ingested: 0, deduped: 0, unchanged: 0, changed: 0, needsReview: 0, failed: 0, itemIds: [], reviews: [],
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

  it("qualifies each issue with the repository its URL names, and carries its state", () => {
    const mapped = mapUpstreamIssues([issue({ htmlUrl: "https://github.com/Acme/Widgets/issues/412", state: "closed" })])[0];
    expect(mapped).toMatchObject({ repository: "acme/widgets", state: "closed" });
  });

  it("falls back to the commissioned repository when the URL names none", () => {
    const mapped = mapUpstreamIssues([issue()], { owner: "Acme", name: "Widgets" })[0];
    expect(mapped.repository).toBe("acme/widgets");
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
