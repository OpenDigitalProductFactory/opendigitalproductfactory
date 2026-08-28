// Boot refresh for the graph-mirror projections that have no other invoker.
//
// WHY THIS EXISTS
//
// `graph_node` / `graph_edge` is written by several projections. The code graph and
// the EA/discovery sync are driven by their own indexers, so they stay current. The
// knowledge corpus, the portfolio spine and the doc-impact bridge are projected by
// finished, tested rebuild scripts that NOTHING EVER CALLED — their only reference in
// the repository was their own package.json definition.
//
// The measured consequence, three times: "Portfolio: 1" beside 16,147 code nodes;
// zero DocPage nodes against a committed 616-edge manifest; and, on a freshly
// provisioned install, a code graph of 38,592 nodes beside an empty knowledge corpus
// and an empty portfolio. None of it fails or logs — the explorer renders a confident
// wrong answer, which is the failure mode these surfaces exist to prevent.
//
// Boot is the right trigger rather than a schedule: it runs after migrations, after
// every self-upgrade, and on first start of a new install — which are exactly the
// moments the source data moves relative to the mirror.
//
// SAFETY PROPERTIES
//
// - Idempotent. Both projections are upsert-and-prune, so re-running is a no-op when
//   nothing changed.
// - Non-fatal. A projection failure must never wedge portal boot; it logs loudly and
//   returns. A stale mirror is bad, an unbootable portal is worse.
// - Owned-scope only. Each projection clears just the labels/relationship types it
//   owns, so refreshing one cannot delete another's rows (BI-EC5FF1A0).

import type { ProjectionReconciliation } from "@dpf/db";

import docImpactManifest from "@/lib/docs/doc-impact.generated.json";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export type GraphProjectionRefreshResult = {
  docImpact: { nodes: number; edges: number } | { error: string };
  knowledgeAndPortfolio: "ok" | { error: string };
  /**
   * Post-refresh comparison of each projection against its source of truth
   * (BI-A73954F7). Absent only when the reconciliation query itself failed —
   * which is reported, never swallowed, but must not wedge boot.
   */
  reconciliation?: ProjectionReconciliation[];
};

/**
 * Refresh every graph projection that has no indexer of its own.
 *
 * Each projection is isolated: one failing must not prevent the others from
 * refreshing, because a partially-current mirror is strictly better than a mirror
 * that stopped at the first error.
 */
export async function refreshGraphProjections(): Promise<GraphProjectionRefreshResult> {
  const result: GraphProjectionRefreshResult = {
    docImpact: { error: "not-run" },
    knowledgeAndPortfolio: { error: "not-run" },
  };

  try {
    const { clearGraphByLabel, DOC_PAGE_LABEL, projectDocImpactManifest } = await import("@dpf/db");
    // Full-rebuild semantics: clear the ONE label this projection owns, then project.
    // Every IMPACTS edge ends at a DocPage, so this drops the previous edge set without
    // touching a node the code graph owns.
    await clearGraphByLabel(DOC_PAGE_LABEL);
    result.docImpact = await projectDocImpactManifest(
      docImpactManifest as Parameters<typeof projectDocImpactManifest>[0],
    );
  } catch (error) {
    result.docImpact = { error: getErrorMessage(error) };
    console.error("[graph-projections] doc-impact refresh failed:", error);
  }

  try {
    const { rebuildKnowledgeAndPortfolioGraph } = await import("@dpf/db");
    await rebuildKnowledgeAndPortfolioGraph();
    result.knowledgeAndPortfolio = "ok";
  } catch (error) {
    result.knowledgeAndPortfolio = { error: getErrorMessage(error) };
    console.error("[graph-projections] knowledge/portfolio refresh failed:", error);
  }

  // Reconcile AFTER refreshing, and report rather than repair (BI-A73954F7).
  //
  // A projection can report success and still leave the mirror wrong — doc-impact was
  // destroyed by an unrelated re-index minutes after a clean run — so "the job fired"
  // is not evidence the mirror is right. Only comparing counts against the source
  // catches that, and until now nothing did: all three production failures in this
  // class were found by a human running these comparisons by hand.
  try {
    const { reconcileGraphProjections, hasProjectionFault, countDocPagesInManifest } =
      await import("@dpf/db");
    const rows = await reconcileGraphProjections({
      docManifestPageCount: countDocPagesInManifest(
        docImpactManifest as Parameters<typeof countDocPagesInManifest>[0],
      ),
    });
    result.reconciliation = rows;

    if (hasProjectionFault(rows)) {
      // Loud, because the whole point is that this used to be silent. Listing the
      // healthy rows too makes the message diagnosable on its own: "knowledge empty"
      // means something different when portfolio is also empty (nothing ran) than
      // when portfolio is fine (one projection broke).
      const summary = rows
        .map((r) => `${r.projectionKey}=${r.mirrorCount}/${r.sourceCount} ${r.status}`)
        .join("  ");
      console.error(`[graph-projections] MIRROR DOES NOT MATCH SOURCE — ${summary}`);
    }
  } catch (error) {
    console.error("[graph-projections] reconciliation failed:", error);
  }

  return result;
}
