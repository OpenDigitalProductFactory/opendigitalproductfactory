import { describe, expect, it } from "vitest";
import {
  detectDanglingXrefs,
  detectKernelDrift,
  detectOrphans,
  detectStaleClaims,
  detectStanceExtractionNeeded,
  runDetectors,
  type LintWikiPage,
} from "./lint-detectors";

// ─── Fixture factory ─────────────────────────────────────────────────────────

function makePage(overrides: Partial<LintWikiPage> = {}): LintWikiPage {
  return {
    id: "wp_test",
    slug: "entities/test",
    title: "Test",
    body: "Body content.",
    pageKind: "entity",
    status: "published",
    isKernel: true,
    kernelVersion: "0.1.0",
    organizationId: null,
    kernelPageId: null,
    derivedFromKernelVersion: null,
    ...overrides,
  };
}

// ─── 1. Orphans ──────────────────────────────────────────────────────────────

describe("detectOrphans", () => {
  it("flags published page with no inbound links and no sources", () => {
    const pages = [makePage({ id: "wp1", slug: "entities/lonely" })];
    const findings = detectOrphans({ pages, links: [], sources: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      pageId: "wp1",
      findingKind: "orphan",
      severity: "warn",
      detail: {
        slug: "entities/lonely",
        inboundLinkCount: 0,
        sourceCitationCount: 0,
        reason: "no_inbound_links_and_no_sources",
      },
    });
  });

  it("flags page with sources but no inbound links", () => {
    const pages = [makePage({ id: "wp1" })];
    const findings = detectOrphans({
      pages,
      links: [],
      sources: [{ pageId: "wp1", sourceId: "src_a" }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatchObject({
      reason: "no_inbound_links",
      inboundLinkCount: 0,
      sourceCitationCount: 1,
    });
  });

  it("does not flag well-connected published pages", () => {
    const pages = [makePage({ id: "wp1" })];
    const findings = detectOrphans({
      pages,
      links: [{ fromPageId: "wp_other", toPageId: "wp1" }],
      sources: [{ pageId: "wp1", sourceId: "src_a" }],
    });
    expect(findings).toHaveLength(0);
  });

  it("ignores draft and archived pages", () => {
    const pages = [
      makePage({ id: "wp_draft", status: "draft" }),
      makePage({ id: "wp_archived", status: "archived" }),
    ];
    const findings = detectOrphans({ pages, links: [], sources: [] });
    expect(findings).toHaveLength(0);
  });

  it("exempts index and runbook pages from inbound-link requirement", () => {
    const pages = [
      makePage({ id: "wp_index", pageKind: "index", slug: "index" }),
      makePage({ id: "wp_runbook", pageKind: "runbook", slug: "runbooks/deploy" }),
    ];
    const findings = detectOrphans({
      pages,
      links: [],
      sources: [
        { pageId: "wp_index", sourceId: "src_a" },
        { pageId: "wp_runbook", sourceId: "src_b" },
      ],
    });
    expect(findings).toHaveLength(0);
  });
});

// ─── 2. Dangling cross-references ────────────────────────────────────────────

describe("detectDanglingXrefs", () => {
  it("flags [[slug]] tokens whose target does not exist", () => {
    const pages = [
      makePage({
        id: "wp1",
        slug: "entities/a",
        body: "See [[entities/b]] and [[entities/missing]].",
      }),
      makePage({ id: "wp2", slug: "entities/b" }),
    ];
    const findings = detectDanglingXrefs({ pages });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      pageId: "wp1",
      findingKind: "dangling-xref",
      severity: "error",
      detail: { danglingTargets: ["entities/missing"] },
    });
  });

  it("resolves org overlay against kernel + own org slugs (kernel fallback)", () => {
    const pages = [
      makePage({ id: "wp_kernel", slug: "entities/digital-product", organizationId: null }),
      makePage({
        id: "wp_org",
        slug: "entities/customer-portal",
        organizationId: "org_acme",
        body: "Connects to [[entities/digital-product]] and [[entities/internal]].",
      }),
      makePage({ id: "wp_org_internal", slug: "entities/internal", organizationId: "org_acme" }),
    ];
    const findings = detectDanglingXrefs({ pages });
    expect(findings).toHaveLength(0);
  });

  it("does not let one org's slugs satisfy another org's references", () => {
    const pages = [
      makePage({ id: "wp_a", slug: "entities/private-a", organizationId: "org_a" }),
      makePage({
        id: "wp_b",
        slug: "entities/x",
        organizationId: "org_b",
        body: "Refers to [[entities/private-a]].",
      }),
    ];
    const findings = detectDanglingXrefs({ pages });
    expect(findings).toHaveLength(1);
    expect(findings[0].detail.danglingTargets).toEqual(["entities/private-a"]);
  });

  it("returns no findings when bodies have no wikilinks", () => {
    const pages = [makePage({ body: "Plain prose with no brackets at all." })];
    expect(detectDanglingXrefs({ pages })).toHaveLength(0);
  });
});

// ─── 3. Stance extraction needed ─────────────────────────────────────────────

describe("detectStanceExtractionNeeded", () => {
  it("flags published summary pages with no stance/heuristic links", () => {
    const pages = [
      makePage({
        id: "wp1",
        pageKind: "summary",
        slug: "summaries/it4it-overview",
        body: "Refers to [[entities/digital-product]] but no judgment extracted.",
      }),
    ];
    const findings = detectStanceExtractionNeeded({ pages });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      pageId: "wp1",
      findingKind: "stance-extraction-needed",
      severity: "info",
    });
  });

  it("does not flag summary pages that link to a stance", () => {
    const pages = [
      makePage({
        pageKind: "summary",
        body: "See [[stances/portfolio-as-anchor]] for the stance.",
      }),
    ];
    expect(detectStanceExtractionNeeded({ pages })).toHaveLength(0);
  });

  it("does not flag summary pages that link to a heuristic", () => {
    const pages = [
      makePage({
        pageKind: "summary",
        body: "Apply [[heuristics/split-portfolio-when]] when in doubt.",
      }),
    ];
    expect(detectStanceExtractionNeeded({ pages })).toHaveLength(0);
  });

  it("ignores non-summary page kinds", () => {
    const pages = [
      makePage({ pageKind: "entity", body: "no stance link here" }),
      makePage({ pageKind: "decision", body: "no stance link here" }),
      makePage({ pageKind: "runbook", body: "no stance link here" }),
    ];
    expect(detectStanceExtractionNeeded({ pages })).toHaveLength(0);
  });

  it("ignores draft summary pages", () => {
    const pages = [
      makePage({ pageKind: "summary", status: "draft", body: "no stance" }),
    ];
    expect(detectStanceExtractionNeeded({ pages })).toHaveLength(0);
  });
});

// ─── 4. Stale claims ─────────────────────────────────────────────────────────

describe("detectStaleClaims", () => {
  const now = new Date("2026-05-10T00:00:00Z");

  it("flags pages whose oldest source is older than threshold", () => {
    const pages = [makePage({ id: "wp1", slug: "summaries/old" })];
    const sources = [
      { pageId: "wp1", sourceId: "src_old" },
      { pageId: "wp1", sourceId: "src_recent" },
    ];
    const rawSources = [
      { id: "src_old", retrievedAt: new Date("2025-01-01T00:00:00Z") },
      { id: "src_recent", retrievedAt: new Date("2026-04-01T00:00:00Z") },
    ];
    const findings = detectStaleClaims({
      pages,
      sources,
      rawSources,
      staleThresholdDays: 180,
      now,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      findingKind: "stale",
      severity: "info",
      detail: { thresholdDays: 180 },
    });
    expect(findings[0].detail.ageDays).toBeGreaterThan(180);
  });

  it("does not flag pages with all-fresh sources", () => {
    const pages = [makePage({ id: "wp1" })];
    const sources = [{ pageId: "wp1", sourceId: "src" }];
    const rawSources = [
      { id: "src", retrievedAt: new Date("2026-04-01T00:00:00Z") },
    ];
    expect(
      detectStaleClaims({ pages, sources, rawSources, now }),
    ).toHaveLength(0);
  });

  it("skips pages with no sources (handled by orphan detector)", () => {
    const pages = [makePage({ id: "wp1" })];
    expect(
      detectStaleClaims({ pages, sources: [], rawSources: [], now }),
    ).toHaveLength(0);
  });

  it("skips pages whose sources have no retrievedAt timestamp", () => {
    const pages = [makePage({ id: "wp1" })];
    const sources = [{ pageId: "wp1", sourceId: "src" }];
    const rawSources = [{ id: "src", retrievedAt: null }];
    expect(
      detectStaleClaims({ pages, sources, rawSources, now }),
    ).toHaveLength(0);
  });

  it("uses default threshold of 180 days when unspecified", () => {
    const pages = [makePage({ id: "wp1" })];
    const sources = [{ pageId: "wp1", sourceId: "src" }];
    const rawSources = [
      { id: "src", retrievedAt: new Date("2025-10-01T00:00:00Z") },
    ];
    const findings = detectStaleClaims({ pages, sources, rawSources, now });
    expect(findings[0].detail.thresholdDays).toBe(180);
  });
});

// ─── 5. Kernel drift ─────────────────────────────────────────────────────────

describe("detectKernelDrift", () => {
  it("flags overlays whose derivedFromKernelVersion is older than current", () => {
    const pages = [
      makePage({
        id: "wp_overlay",
        slug: "entities/digital-product",
        organizationId: "org_acme",
        kernelPageId: "wp_kernel",
        derivedFromKernelVersion: "0.1.0",
      }),
    ];
    const findings = detectKernelDrift({ pages, currentKernelVersion: "0.2.0" });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      pageId: "wp_overlay",
      organizationId: "org_acme",
      findingKind: "kernel-drift",
      severity: "warn",
      detail: {
        derivedFromKernelVersion: "0.1.0",
        currentKernelVersion: "0.2.0",
      },
    });
  });

  it("does not flag overlays already on the current kernel version", () => {
    const pages = [
      makePage({
        kernelPageId: "wp_kernel",
        derivedFromKernelVersion: "0.2.0",
        organizationId: "org_acme",
      }),
    ];
    expect(
      detectKernelDrift({ pages, currentKernelVersion: "0.2.0" }),
    ).toHaveLength(0);
  });

  it("does not flag org-original pages (no kernelPageId)", () => {
    const pages = [
      makePage({
        kernelPageId: null,
        derivedFromKernelVersion: null,
        organizationId: "org_acme",
      }),
    ];
    expect(
      detectKernelDrift({ pages, currentKernelVersion: "0.2.0" }),
    ).toHaveLength(0);
  });

  it("does not flag kernel pages themselves", () => {
    const pages = [
      makePage({
        kernelPageId: null,
        derivedFromKernelVersion: null,
        organizationId: null,
        isKernel: true,
      }),
    ];
    expect(
      detectKernelDrift({ pages, currentKernelVersion: "0.2.0" }),
    ).toHaveLength(0);
  });
});

// ─── Aggregator ──────────────────────────────────────────────────────────────

describe("runDetectors", () => {
  it("returns the union of all detector findings", () => {
    const pages = [
      // Orphan: published, no inbound, no sources
      makePage({ id: "wp_orphan", slug: "entities/orphan" }),
      // Dangling: cites a missing slug
      makePage({
        id: "wp_dangling",
        slug: "entities/dangling-source",
        body: "[[entities/missing]]",
      }),
      // Stance-extraction-needed: summary with no stance link
      makePage({
        id: "wp_summary",
        pageKind: "summary",
        slug: "summaries/no-stance",
        body: "no stance link",
      }),
      // Drift: overlay one version behind
      makePage({
        id: "wp_overlay",
        slug: "entities/dp",
        organizationId: "org_acme",
        kernelPageId: "wp_kernel",
        derivedFromKernelVersion: "0.1.0",
      }),
      // Kernel referent for the overlay (so the overlay isn't also flagged dangling)
      makePage({ id: "wp_kernel", slug: "entities/dp" }),
    ];

    const findings = runDetectors({
      pages,
      links: [],
      sources: [],
      rawSources: [],
      currentKernelVersion: "0.2.0",
    });

    const kinds = findings.map((f) => f.findingKind).sort();
    expect(kinds).toContain("orphan");
    expect(kinds).toContain("dangling-xref");
    expect(kinds).toContain("stance-extraction-needed");
    expect(kinds).toContain("kernel-drift");
  });
});
