-- @migration-safety: data-safe: fresh additive table + IF NOT EXISTS DDL; no tightening on existing rows.
-- BET-5 (BI-A1E864A5): pgvector foundation — vector storage on Postgres to retire Qdrant.
-- Idempotent + fleet-safe (IF NOT EXISTS) so self-upgrade re-applies cleanly on existing installs.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE IF NOT EXISTS "vector_embedding" (
  "collection" text        NOT NULL,
  "point_id"   bigint      NOT NULL,
  "embedding"  vector(768) NOT NULL,
  "payload"    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "vector_embedding_pkey" PRIMARY KEY ("collection", "point_id")
);

-- Per-collection HNSW (cosine): mirrors Qdrant's per-collection navigable graph so filtering
-- by collection does not degrade ANN recall. Validated by benchmarks/bet5-datastore.
CREATE INDEX IF NOT EXISTS "vector_embedding_hnsw_agent_memory"
  ON "vector_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "collection" = 'agent-memory';
CREATE INDEX IF NOT EXISTS "vector_embedding_hnsw_platform_knowledge"
  ON "vector_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "collection" = 'platform-knowledge';
CREATE INDEX IF NOT EXISTS "vector_embedding_hnsw_wiki_pages"
  ON "vector_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "collection" = 'wiki-pages';
CREATE INDEX IF NOT EXISTS "vector_embedding_hnsw_documents"
  ON "vector_embedding" USING hnsw ("embedding" vector_cosine_ops) WHERE "collection" = 'documents';

-- Payload-filter support (Qdrant payload-index parity).
CREATE INDEX IF NOT EXISTS "vector_embedding_payload_gin" ON "vector_embedding" USING gin ("payload");
