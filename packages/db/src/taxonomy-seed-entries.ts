export type TaxonomySeedRow = {
  portfolio: string;
  portfolio_id: string;
  level_1: string;
  level_2: string;
  level_3: string;
  definition?: string;
  notes?: string;
  enrichment?: Record<string, unknown>;
};

export type TaxonomySeedPortfolio = {
  id: string;
  name: string;
};

export type TaxonomySeedNodeEntry = {
  nodeId: string;
  name: string;
  parentNodeId: string | null;
  portfolioId: string;
  description: string | null;
  enrichment: Record<string, unknown> | null;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function buildTaxonomyNodeEntries(
  rows: TaxonomySeedRow[],
  portfolios: TaxonomySeedPortfolio[],
): TaxonomySeedNodeEntry[] {
  const portfolioNameBySlug = new Map(portfolios.map((portfolio) => [portfolio.id, portfolio.name]));
  const seen = new Set<string>();
  const entries: TaxonomySeedNodeEntry[] = [];

  for (const row of rows) {
    const pid = row.portfolio_id;
    if (!seen.has(pid)) {
      seen.add(pid);
      entries.push({
        nodeId: pid,
        name: portfolioNameBySlug.get(pid) ?? row.portfolio,
        parentNodeId: null,
        portfolioId: pid,
        description: null,
        enrichment: null,
      });
    }
    if (!row.level_1) continue;
    const l1id = `${pid}/${slugify(row.level_1)}`;
    if (!seen.has(l1id)) {
      seen.add(l1id);
      const isL1Leaf = !row.level_2;
      entries.push({
        nodeId: l1id,
        name: row.level_1,
        parentNodeId: pid,
        portfolioId: pid,
        description: isL1Leaf ? (row.definition || null) : null,
        enrichment: isL1Leaf && row.enrichment && Object.keys(row.enrichment).length > 0 ? row.enrichment : null,
      });
    }
    if (!row.level_2) continue;
    const l2id = `${l1id}/${slugify(row.level_2)}`;
    if (!seen.has(l2id)) {
      seen.add(l2id);
      const isL2Leaf = !row.level_3;
      entries.push({
        nodeId: l2id,
        name: row.level_2,
        parentNodeId: l1id,
        portfolioId: pid,
        description: isL2Leaf ? (row.definition || null) : null,
        enrichment: isL2Leaf && row.enrichment && Object.keys(row.enrichment).length > 0 ? row.enrichment : null,
      });
    }
    if (!row.level_3) continue;
    const l3id = `${l2id}/${slugify(row.level_3)}`;
    if (!seen.has(l3id)) {
      seen.add(l3id);
      entries.push({
        nodeId: l3id,
        name: row.level_3,
        parentNodeId: l2id,
        portfolioId: pid,
        description: row.definition || null,
        enrichment: row.enrichment && Object.keys(row.enrichment).length > 0 ? row.enrichment : null,
      });
    }
  }

  return entries;
}
