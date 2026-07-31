// /admin/graph-explorer — visual exploration of the unified graph mirror
// (BI-89A149A9, EP-CODE-GRAPH).
//
// BET-5 retired Neo4j into the Postgres `graph_node` / `graph_edge` tables but did
// not carry across the Neo4j-Browser exploration surface. This page is that
// surface: one place to see the whole self-model — code graph, data model, EA
// ontology, infrastructure CIs — and walk between them.
//
// Read-only. The census is fetched server-side so the page has something to show
// on first paint; everything after that is operator-driven via server actions.
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { GraphExplorer } from "@/components/admin/GraphExplorer";
import { getGraphCensus } from "@/lib/graph/explorer-queries";

export const dynamic = "force-dynamic";

export default async function GraphExplorerPage() {
  const census = await getGraphCensus();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Graph Explorer</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Explore how the platform is connected — source code, data model, architecture, and
          infrastructure in one graph. Search for a starting point, then follow its relationships.
        </p>
      </div>

      <AdminTabNav />

      <GraphExplorer census={census} />
    </div>
  );
}
