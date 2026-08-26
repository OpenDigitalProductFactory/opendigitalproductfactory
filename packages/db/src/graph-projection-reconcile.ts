// packages/db/src/graph-projection-reconcile.ts
//
// Reconciliation invariants for the graph mirror (BI-A73954F7).
//
// WHY THIS EXISTS
//
// Three graph-mirror failures reached a user, and every one was caught by a HUMAN
// comparing mirror contents against source-of-truth counts:
//
//   - the portfolio projection had never been invoked  -> "Portfolio: 1" beside
//     16,147 code nodes;
//   - the doc-impact projection had never been invoked -> "nothing documents this
//     route", against a committed 616-edge manifest;
//   - a routine code re-index DESTROYED doc-impact      -> 183 DocPage nodes left
//     orphaned but still counted in the explorer census.
//
// Nothing in the platform performed that comparison, so each one rendered as a
// confident wrong answer — which is precisely the failure mode these surfaces exist
// to prevent. An empty domain is indistinguishable from a true "there is nothing
// here" unless something checks the source.
//
// WHAT THIS IS NOT
//
// This is the OBSERVABILITY step, not enforcement. It reports; it does not fail a
// build and it does not repair. A drift guard belongs after this and after the
// projections reliably run (BI-FEDFABF6, BI-EC5FF1A0) — shipped before them it would
// sit permanently red, because the counts genuinely do not match today, and would be
// switched off within a week.
//
// WHY COUNTS RATHER THAN TIMESTAMPS
//
// A "last run at" timestamp answers whether a job fired. It does not answer whether
// the mirror is right: the doc-impact projection was destroyed by a DIFFERENT job
// minutes after successfully running, and a freshness timestamp would have read green
// throughout. Counts compare the mirror to the thing it mirrors, so they catch a
// destroyed domain as readily as an unrun one.

import { prisma } from "./client";
import { DOC_PAGE_LABEL } from "./doc-impact-graph";

/** Label prefix owned by the knowledge projection — `Wiki__Principle`, etc. */
export const WIKI_LABEL_PREFIX = "Wiki__";

// `_` is a single-character wildcard in LIKE, so the two underscores in `Wiki__`
// must be escaped or the predicate also matches `WikiXY...`. This mirrors the
// escaping already used by pruneKnowledge() in knowledge-portfolio-graph-sync.ts;
// the two MUST agree, or prune and reconcile would disagree about what the
// knowledge projection owns.
const WIKI_LABEL_LIKE = "Wiki\\_\\_%";

/** Labels owned by the portfolio projection. */
export const PORTFOLIO_LABELS = ["Portfolio", "TaxonomyNode", "DigitalProduct"] as const;

export type ProjectionStatus =
  /** Mirror matches the source. */
  | "ok"
  /**
   * The source has rows and the mirror has NONE. This is the never-invoked or
   * destroyed case — the one that renders as an authoritative wrong answer.
   */
  | "empty"
  /** Both non-zero but unequal: a partial or stale projection. */
  | "drifted"
  /** The source itself is empty, so an empty mirror is CORRECT, not a fault. */
  | "source-empty";

export type ProjectionReconciliation = {
  /** Stable key for the projection, e.g. "knowledge". */
  projectionKey: string;
  /** What a human should read: which mirror rows this covers. */
  describes: string;
  /** Rows currently in `graph_node` for this projection. */
  mirrorCount: number;
  /** Rows in the source of truth the projection reads from. */
  sourceCount: number;
  /** mirrorCount - sourceCount. Negative means the mirror is behind. */
  drift: number;
  status: ProjectionStatus;
};

/**
 * Classify one projection from its two counts.
 *
 * `source-empty` is deliberately distinct from `empty`: a fresh install with no wiki
 * pages SHOULD have no wiki nodes, and reporting that as a fault would make this
 * check noisy on exactly the installs that most need a trustworthy signal. Noise here
 * is not cosmetic — a check that cries wolf on a healthy install is the check people
 * turn off.
 */
export function classifyProjection(mirrorCount: number, sourceCount: number): ProjectionStatus {
  if (sourceCount === 0) return mirrorCount === 0 ? "source-empty" : "drifted";
  if (mirrorCount === 0) return "empty";
  return mirrorCount === sourceCount ? "ok" : "drifted";
}

async function countNodesMatchingLabelLike(like: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n
       FROM graph_node
      WHERE EXISTS (SELECT 1 FROM unnest(labels) l WHERE l LIKE $1)`,
    like,
  );
  return Number(rows[0]?.n ?? 0);
}

async function countNodesWithAnyLabel(labels: readonly string[]): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n
       FROM graph_node
      WHERE labels && $1::text[]`,
    [...labels],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Compare every projection that has no indexer of its own against its source.
 *
 * `docManifestPageCount` is passed in rather than read here because the doc-impact
 * manifest is generated into `apps/web`; this package must not reach into the app.
 * Omit it to skip the doc-impact invariant rather than report a false `empty` —
 * an unknown source count is not evidence of a fault.
 */
export async function reconcileGraphProjections(opts?: {
  docManifestPageCount?: number;
}): Promise<ProjectionReconciliation[]> {
  const out: ProjectionReconciliation[] = [];

  const [wikiMirror, wikiSource] = await Promise.all([
    countNodesMatchingLabelLike(WIKI_LABEL_LIKE),
    prisma.wikiPage.count(),
  ]);
  out.push({
    projectionKey: "knowledge",
    describes: `${WIKI_LABEL_PREFIX}* nodes vs WikiPage rows`,
    mirrorCount: wikiMirror,
    sourceCount: wikiSource,
    drift: wikiMirror - wikiSource,
    status: classifyProjection(wikiMirror, wikiSource),
  });

  // ONE INVARIANT PER LABEL — never a summed aggregate.
  //
  // Measured on the live mirror 2026-08-26: summing the three source tables gives 771
  // while `labels && ARRAY[...]` gives 767 DISTINCT nodes, because four nodes
  // legitimately carry two of these labels (labels are UNION-merged, per BI-EC5FF1A0).
  // Per label the projection is exactly right — 4/4, 488/488, 279/279 — so the
  // aggregate form would have reported permanent phantom drift on a HEALTHY install.
  // A check that is always red is worse than no check: it trains people to ignore it,
  // and it is the same false-red shape that makes a data-dependent frozen baseline
  // block unrelated work.
  const perLabel = await Promise.all(
    (
      [
        ["Portfolio", () => prisma.portfolio.count()],
        ["TaxonomyNode", () => prisma.taxonomyNode.count()],
        ["DigitalProduct", () => prisma.digitalProduct.count()],
      ] as const
    ).map(async ([label, countSource]) => {
      const [mirrorCount, sourceCount] = await Promise.all([
        countNodesWithAnyLabel([label]),
        countSource(),
      ]);
      return { label, mirrorCount, sourceCount };
    }),
  );
  for (const { label, mirrorCount, sourceCount } of perLabel) {
    out.push({
      projectionKey: `portfolio:${label}`,
      describes: `${label} nodes vs ${label} rows`,
      mirrorCount,
      sourceCount,
      drift: mirrorCount - sourceCount,
      status: classifyProjection(mirrorCount, sourceCount),
    });
  }

  if (typeof opts?.docManifestPageCount === "number") {
    const docMirror = await countNodesWithAnyLabel([DOC_PAGE_LABEL]);
    out.push({
      projectionKey: "doc-impact",
      describes: `${DOC_PAGE_LABEL} nodes vs doc-impact manifest pages`,
      mirrorCount: docMirror,
      sourceCount: opts.docManifestPageCount,
      drift: docMirror - opts.docManifestPageCount,
      status: classifyProjection(docMirror, opts.docManifestPageCount),
    });
  }

  return out;
}

/**
 * True when at least one projection is materially wrong.
 *
 * `source-empty` and `ok` are both healthy. This is the predicate a surface should
 * use before rendering a domain count as authoritative.
 */
export function hasProjectionFault(rows: readonly ProjectionReconciliation[]): boolean {
  return rows.some((r) => r.status === "empty" || r.status === "drifted");
}
