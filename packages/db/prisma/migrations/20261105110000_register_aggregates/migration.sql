-- BI-E487F6D9 (EP-5F6369AB): ArchiMate aggregation is its own relationship, no longer
-- folded into composition, so the EA projection writes AGGREGATES edges.
INSERT INTO "graph_relation_type" ("key", "relation_class", "label", "inverse_label", "status") VALUES
  ('AGGREGATES', 'semantic', 'aggregates', 'is aggregated in', 'active')
ON CONFLICT ("key") DO NOTHING;
