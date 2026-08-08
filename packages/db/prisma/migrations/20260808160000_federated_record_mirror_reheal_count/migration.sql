-- FederatedRecordMirror.rehealCount — bounded dead-letter recovery. (BI-8A7E3E56)
--
-- Digest reconciliation resurrects a dead-lettered outbox record the peer still
-- needs (e.g. it 422'd during the peer's upgrade window, since fixed). This
-- counter bounds those resurrections (MAX_DEMAND_REHEALS) so a transient
-- stranding recovers while a genuinely-poison record eventually stays dead
-- instead of thrashing every digest cycle. Additive, non-destructive; defaults
-- to 0 so every existing row is treated as never-resurrected.
ALTER TABLE "FederatedRecordMirror" ADD COLUMN "rehealCount" INTEGER NOT NULL DEFAULT 0;
