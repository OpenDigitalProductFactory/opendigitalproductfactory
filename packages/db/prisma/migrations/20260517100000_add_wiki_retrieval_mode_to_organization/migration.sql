-- EP-WIKI-004: per-org retrieval mode for wiki search.
-- "vector" = EP-WIKI-001 default (Qdrant cosine similarity only).
-- "ppr"    = vector seeds → Personalized PageRank over the per-org
--            WikiPageLink subgraph → combined ranking.
ALTER TABLE "Organization"
  ADD COLUMN "wikiRetrievalMode" TEXT NOT NULL DEFAULT 'vector';
