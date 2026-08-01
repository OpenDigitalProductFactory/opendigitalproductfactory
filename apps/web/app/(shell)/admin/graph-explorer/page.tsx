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
import { GraphExplorer } from "@/components/admin/GraphExplorer";
import { getGraphCensus } from "@/lib/graph/explorer-queries";
import { parseGraphPurposeContext } from "@/lib/graph/explorer-purpose-context";

export const dynamic = "force-dynamic";

type GraphExplorerPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GraphExplorerPage({
  searchParams,
}: GraphExplorerPageProps) {
  const census = await getGraphCensus();
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (entry !== undefined) query.append(key, entry);
    }
  }

  return (
    <GraphExplorer
      census={census}
      initialPurposeContext={parseGraphPurposeContext(query)}
    />
  );
}
