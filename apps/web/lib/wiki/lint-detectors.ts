// EP-WIKI-001 Phase 4a: pure lint detectors.
// Spec: docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md §6
// Plan: docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md (Phase 4a)
//
// These detectors are pure functions: they take typed snapshots of the
// wiki state and return findings. Side-effecting concerns (DB read,
// finding persistence, scheduled invocation, admin UI) live in Phase 4b
// (`runWikiLint` orchestrator, Inngest job, /admin/wiki/lint route).
//
// Five of the seven §6 detectors land here. The remaining two need
// either an LLM call (`detectContradictions`) or entity recognition
// (`detectMissingXrefs`); they belong in Phase 4b alongside the
// orchestrator that can supply those services.

// ─── Finding shape ──────────────────────────────────────────────────────────

/** Mirrors the `WikiLintFinding.findingKind` enum on the Prisma model. */
export type LintFindingKind =
  | "contradiction"
  | "stale"
  | "orphan"
  | "missing-xref"
  | "dangling-xref"
  | "kernel-drift"
  | "stance-extraction-needed"
  // ─── Principle-only finding kinds (Phase 1 of principles-as-wiki-kind) ───
  | "principle-missing-tier"
  | "principle-missing-applies-to"
  | "principle-missing-direction"
  | "principle-missing-vector"
  | "principle-sparse-vector"
  | "principle-vector-dimension-mismatch"
  | "principle-unknown-dimension"
  | "principle-tier-weight-mismatch"
  | "principle-public-missing-rationale"
  | "principle-public-unsafe-marker"
  | "principle-duplicate"
  | "principle-contradiction-review"
  // ─── Ring-scope axis (spec 2026-05-24-founder-kernel-evolution-discipline) ───
  | "principle-ring-scope-unknown"
  | "principle-ring-scope-overuse"
  // ─── Profession corpus (WSID Phase 2, BI-871126F9) ────────────────────────
  | "profession-unsourced-page";

/** Mirrors the `WikiLintFinding.severity` enum. */
export type LintSeverity = "info" | "warn" | "error";

/**
 * What a detector emits. Persisted as `WikiLintFinding` rows; the DB
 * adds `id`, `createdAt`, `status`, `resolvedAt`. Detectors emit
 * findings; they do not write rows.
 */
export type LintFinding = {
  organizationId: string | null;
  pageId: string;
  findingKind: LintFindingKind;
  severity: LintSeverity;
  detail: Record<string, unknown>;
};

// ─── Input snapshots (narrow read-only views of the wiki) ───────────────────

export type LintWikiPage = {
  id: string;
  slug: string;
  title: string;
  body: string;
  pageKind: string;
  status: string;
  isKernel: boolean;
  kernelVersion: string | null;
  organizationId: string | null;
  kernelPageId: string | null;
  derivedFromKernelVersion: string | null;
};

export type LintWikiPageLink = {
  fromPageId: string;
  toPageId: string;
};

export type LintWikiPageSource = {
  pageId: string;
  sourceId: string;
};

export type LintRawSource = {
  id: string;
  retrievedAt: Date | null;
};

// ─── 1. Orphans ─────────────────────────────────────────────────────────────

/**
 * Published page with **no inbound `WikiPageLink`** OR with an empty
 * `WikiPageSource[]` list.
 *
 * Severity: warn. Per spec §13, citation-empty pages cannot be
 * `published` — but a published row that lost its sources via a
 * delete-cascade would slip past the publish gate; the lint catches it.
 *
 * Index pages are exempt: their job is to *be* link aggregators, not
 * to be linked-to. Same for `runbook` pages, which are entry points.
 */
export function detectOrphans(input: {
  pages: LintWikiPage[];
  links: LintWikiPageLink[];
  sources: LintWikiPageSource[];
}): LintFinding[] {
  const inboundCount = new Map<string, number>();
  for (const link of input.links) {
    inboundCount.set(link.toPageId, (inboundCount.get(link.toPageId) ?? 0) + 1);
  }

  const sourceCount = new Map<string, number>();
  for (const src of input.sources) {
    sourceCount.set(src.pageId, (sourceCount.get(src.pageId) ?? 0) + 1);
  }

  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.status !== "published") continue;
    if (page.pageKind === "index" || page.pageKind === "runbook") continue;

    const inbound = inboundCount.get(page.id) ?? 0;
    const cites = sourceCount.get(page.id) ?? 0;

    if (inbound === 0 || cites === 0) {
      findings.push({
        organizationId: page.organizationId,
        pageId: page.id,
        findingKind: "orphan",
        severity: "warn",
        detail: {
          slug: page.slug,
          inboundLinkCount: inbound,
          sourceCitationCount: cites,
          reason:
            inbound === 0 && cites === 0
              ? "no_inbound_links_and_no_sources"
              : inbound === 0
                ? "no_inbound_links"
                : "no_sources",
        },
      });
    }
  }
  return findings;
}

// ─── 2. Dangling cross-references ───────────────────────────────────────────

/**
 * `[[slug]]` token in a page body whose target page does not exist
 * for the same scope (kernel for kernel pages; org overlay for org
 * pages, falling back to kernel).
 *
 * Severity: error. Spec §13: "blocks publish if any [[...]] is dangling."
 */
export function detectDanglingXrefs(input: {
  pages: LintWikiPage[];
}): LintFinding[] {
  // Build per-organization slug sets. Kernel slugs are visible to every
  // org overlay (kernel fallback), so each org's resolution set is
  // (org slugs) ∪ (kernel slugs).
  const kernelSlugs = new Set<string>();
  const orgSlugs = new Map<string, Set<string>>();

  for (const page of input.pages) {
    if (page.organizationId === null) {
      kernelSlugs.add(page.slug);
    } else {
      let set = orgSlugs.get(page.organizationId);
      if (!set) {
        set = new Set<string>();
        orgSlugs.set(page.organizationId, set);
      }
      set.add(page.slug);
    }
  }

  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    const tokens = extractWikilinks(page.body);
    if (tokens.length === 0) continue;

    const visible =
      page.organizationId === null
        ? kernelSlugs
        : new Set<string>([...(orgSlugs.get(page.organizationId) ?? []), ...kernelSlugs]);

    const dangling = tokens.filter((slug) => !visible.has(slug));
    if (dangling.length === 0) continue;

    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "dangling-xref",
      severity: "error",
      detail: {
        slug: page.slug,
        danglingTargets: dangling,
      },
    });
  }
  return findings;
}

/** Internal helper — same regex as `seed-wiki-kernel.ts:extractWikilinks`. */
function extractWikilinks(body: string): string[] {
  const matches = body.matchAll(/\[\[([a-zA-Z0-9/_-]+)\]\]/g);
  const slugs = new Set<string>();
  for (const m of matches) {
    if (m[1]) slugs.add(m[1]);
  }
  return Array.from(slugs);
}

// ─── 3. Stance extraction needed ────────────────────────────────────────────

/**
 * `summary` page whose body has no `[[stances/...]]` or
 * `[[heuristics/...]]` link extracted.
 *
 * Severity: info. Per spec §6: "the kernel's purpose is judgment, not
 * summarization. Summary-only pages defeat the 'what would Mark do?'
 * goal."
 */
export function detectStanceExtractionNeeded(input: {
  pages: LintWikiPage[];
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.pageKind !== "summary") continue;
    if (page.status !== "published") continue;

    const tokens = extractWikilinks(page.body);
    const hasStanceOrHeuristic = tokens.some(
      (t) => t.startsWith("stances/") || t.startsWith("heuristics/"),
    );
    if (hasStanceOrHeuristic) continue;

    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "stance-extraction-needed",
      severity: "info",
      detail: {
        slug: page.slug,
        message:
          "Summary page does not link to any stance or heuristic. " +
          "Consider extracting the underlying judgment as a stance or heuristic page.",
      },
    });
  }
  return findings;
}

// ─── 4. Stale claims ────────────────────────────────────────────────────────

/**
 * Page whose oldest `RawSource.retrievedAt` exceeds `staleThresholdDays`.
 *
 * Severity: info. Source data ages — this is a *signal* that the
 * underlying material may have been superseded, not a publish blocker.
 */
export function detectStaleClaims(input: {
  pages: LintWikiPage[];
  sources: LintWikiPageSource[];
  rawSources: LintRawSource[];
  staleThresholdDays?: number;
  now?: Date;
}): LintFinding[] {
  const threshold = input.staleThresholdDays ?? 180;
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - threshold * 24 * 60 * 60 * 1000);

  const rawById = new Map<string, LintRawSource>();
  for (const r of input.rawSources) {
    rawById.set(r.id, r);
  }

  const sourcesByPage = new Map<string, string[]>();
  for (const ws of input.sources) {
    let list = sourcesByPage.get(ws.pageId);
    if (!list) {
      list = [];
      sourcesByPage.set(ws.pageId, list);
    }
    list.push(ws.sourceId);
  }

  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.status !== "published") continue;
    const sourceIds = sourcesByPage.get(page.id) ?? [];
    if (sourceIds.length === 0) continue; // orphan-detector handles empty source lists

    let oldest: Date | null = null;
    for (const sid of sourceIds) {
      const r = rawById.get(sid);
      if (!r?.retrievedAt) continue;
      if (oldest === null || r.retrievedAt < oldest) oldest = r.retrievedAt;
    }
    if (oldest === null) continue; // no retrievedAt timestamps yet
    if (oldest > cutoff) continue; // fresh enough

    const ageDays = Math.floor((now.getTime() - oldest.getTime()) / (24 * 60 * 60 * 1000));
    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "stale",
      severity: "info",
      detail: {
        slug: page.slug,
        oldestSourceRetrievedAt: oldest.toISOString(),
        ageDays,
        thresholdDays: threshold,
      },
    });
  }
  return findings;
}

// ─── 5. Kernel drift ────────────────────────────────────────────────────────

/**
 * Org overlay whose `derivedFromKernelVersion` is older than the
 * current `kernelVersion`.
 *
 * Severity: warn. Phase 4a ships the simple "version mismatch" check.
 * Phase 4b will add the paragraph-hash diff per spec §3.3 ("kernel
 * diff touched a paragraph the override also modifies"); until then
 * the simple version surfaces drift candidates conservatively.
 */
export function detectKernelDrift(input: {
  pages: LintWikiPage[];
  currentKernelVersion: string;
}): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.kernelPageId === null) continue; // org-original, not an override
    if (page.derivedFromKernelVersion === null) continue;
    if (page.derivedFromKernelVersion === input.currentKernelVersion) continue;

    findings.push({
      organizationId: page.organizationId,
      pageId: page.id,
      findingKind: "kernel-drift",
      severity: "warn",
      detail: {
        slug: page.slug,
        derivedFromKernelVersion: page.derivedFromKernelVersion,
        currentKernelVersion: input.currentKernelVersion,
      },
    });
  }
  return findings;
}

// ─── 6. Profession corpus — unsourced pages ─────────────────────────────────

/**
 * Profession corpus page (slug prefix `professions/`) that has no
 * `WikiPageSource` entry. Every profession corpus page must cite at
 * least one fetched `RawSource` — this is the provenance invariant
 * from WSID Phase 2 (BI-871126F9).
 *
 * Severity: error. Citation-empty corpus pages cannot serve as
 * evidence-grounded professional doctrine. The lint gate is
 * mechanical — not a review judgment call.
 */
export function detectUnsourcedProfessionPages(input: {
  pages: LintWikiPage[];
  sources: LintWikiPageSource[];
}): LintFinding[] {
  const sourceCount = new Map<string, number>();
  for (const src of input.sources) {
    sourceCount.set(src.pageId, (sourceCount.get(src.pageId) ?? 0) + 1);
  }

  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (!page.slug.startsWith("professions/")) continue;
    if (page.status !== "published") continue;

    const cites = sourceCount.get(page.id) ?? 0;
    if (cites === 0) {
      findings.push({
        organizationId: page.organizationId,
        pageId: page.id,
        findingKind: "profession-unsourced-page",
        severity: "error",
        detail: {
          slug: page.slug,
          message:
            "Profession corpus page has no source citations. " +
            "All published profession corpus pages must cite at least one fetched RawSource.",
        },
      });
    }
  }
  return findings;
}

// ─── Aggregator ─────────────────────────────────────────────────────────────

/**
 * Run every Phase 4a detector against a snapshot of the wiki and
 * return the union of findings. Phase 4b's `runWikiLint()` orchestrator
 * will call this after fetching the snapshot from Prisma.
 */
export function runDetectors(input: {
  pages: LintWikiPage[];
  links: LintWikiPageLink[];
  sources: LintWikiPageSource[];
  rawSources: LintRawSource[];
  currentKernelVersion: string;
  staleThresholdDays?: number;
  now?: Date;
}): LintFinding[] {
  return [
    ...detectOrphans({
      pages: input.pages,
      links: input.links,
      sources: input.sources,
    }),
    ...detectDanglingXrefs({ pages: input.pages }),
    ...detectStanceExtractionNeeded({ pages: input.pages }),
    ...detectStaleClaims({
      pages: input.pages,
      sources: input.sources,
      rawSources: input.rawSources,
      staleThresholdDays: input.staleThresholdDays,
      now: input.now,
    }),
    ...detectKernelDrift({
      pages: input.pages,
      currentKernelVersion: input.currentKernelVersion,
    }),
    ...detectUnsourcedProfessionPages({
      pages: input.pages,
      sources: input.sources,
    }),
  ];
}
