-- BI-85389A35 (EP-5F6369AB): the governed vocabulary of graph_edge.rel_type.
-- Rows mirror packages/db/src/relation-vocabulary-entries.ts; a later type is added
-- by its own migration (relation-vocabulary.test.ts checks the two agree).
CREATE TYPE "GraphRelationClass" AS ENUM ('semantic', 'structural', 'navigational', 'provenance');
CREATE TYPE "GraphRelationStatus" AS ENUM ('active', 'deprecated', 'retired');

CREATE TABLE "graph_relation_type" (
    "key" TEXT NOT NULL,
    "relation_class" "GraphRelationClass" NOT NULL,
    "label" TEXT NOT NULL,
    "inverse_label" TEXT NOT NULL,
    "status" "GraphRelationStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "graph_relation_type_pkey" PRIMARY KEY ("key")
);

INSERT INTO "graph_relation_type" ("key", "relation_class", "label", "inverse_label", "status") VALUES
  ('BELONGS_TO', 'semantic', 'is in portfolio', 'contains', 'active'),
  ('CATEGORIZED_AS', 'semantic', 'is categorized as', 'categorizes', 'active'),
  ('CHILD_OF', 'semantic', 'has broader', 'has narrower', 'active'),
  ('DEPENDS_ON', 'semantic', 'depends on', 'is depended on by', 'active'),
  ('PART_OF', 'semantic', 'is part of', 'has part', 'active'),
  ('HOSTS', 'semantic', 'hosts', 'is hosted on', 'active'),
  ('RUNS_ON', 'semantic', 'runs on', 'runs', 'active'),
  ('LISTENS_ON', 'semantic', 'listens on', 'is listened on by', 'active'),
  ('MEMBER_OF', 'semantic', 'is member of', 'has member', 'active'),
  ('ROUTES_THROUGH', 'semantic', 'routes through', 'carries routes of', 'active'),
  ('CARRIED_BY', 'semantic', 'is carried by', 'carries', 'active'),
  ('CONNECTS_TO', 'semantic', 'connects to', 'connects to', 'active'),
  ('PEER_OF', 'semantic', 'is peer of', 'is peer of', 'active'),
  ('UPLINKS_TO', 'semantic', 'uplinks to', 'is uplink of', 'active'),
  ('MONITORS', 'semantic', 'monitors', 'is monitored by', 'active'),
  ('DEFINES', 'structural', 'defines', 'is defined in', 'active'),
  ('IMPORTS', 'structural', 'imports', 'is imported by', 'active'),
  ('HAS_FIELD', 'structural', 'has field', 'is field of', 'active'),
  ('TESTED_BY', 'structural', 'is tested by', 'tests', 'active'),
  ('IMPLEMENTS_ROUTE', 'structural', 'implements route', 'is implemented by', 'active'),
  ('EXPOSES_TOOL', 'structural', 'exposes tool', 'is exposed by', 'active'),
  ('USES_MODEL', 'structural', 'uses model', 'is used by', 'active'),
  ('USES_PROMPT', 'structural', 'uses prompt', 'is used by', 'active'),
  ('USES_SYMBOL', 'structural', 'uses symbol', 'is used by', 'active'),
  ('HAS_FOREIGN_KEY_TO', 'structural', 'has foreign key to', 'is foreign-key target of', 'active'),
  ('RELATES_TO', 'structural', 'relates to', 'relates to', 'deprecated'),
  ('REFERENCES', 'structural', 'references', 'is referenced by', 'retired'),
  ('IMPACTS', 'semantic', 'can make stale', 'is made stale by', 'active'),
  ('LINKS_TO', 'navigational', 'links to', 'is linked from', 'active'),
  ('OVERRIDES', 'provenance', 'overrides in its organization', 'is overridden by', 'active'),
  ('MENTIONS', 'navigational', 'mentions', 'is mentioned in', 'active'),
  ('WAS_DERIVED_FROM', 'provenance', 'was derived from', 'was source for', 'active'),
  ('HAD_PRIMARY_SOURCE', 'provenance', 'had primary source', 'is primary source of', 'active'),
  ('USED', 'provenance', 'used as input', 'was input to', 'active'),
  ('WAS_INFORMED_BY', 'provenance', 'was informed by', 'informed', 'active'),
  ('DOC_REFERENCES', 'provenance', 'references document', 'is referenced by document', 'deprecated'),
  ('EA_REPRESENTS', 'semantic', 'models', 'is modelled by', 'active'),
  ('ACCESSES', 'semantic', 'accesses', 'is accessed by', 'active'),
  ('ASSIGNED_TO', 'semantic', 'is assigned to', 'has assigned', 'active'),
  ('COMPOSED_OF', 'semantic', 'is composed of', 'is part of', 'active'),
  ('INFLUENCES', 'semantic', 'influences', 'is influenced by', 'active'),
  ('REALIZES', 'semantic', 'realizes', 'is realized by', 'active'),
  ('SERVES', 'semantic', 'serves', 'is served by', 'active'),
  ('TRIGGERS', 'semantic', 'triggers', 'is triggered by', 'active'),
  ('FLOWS_TO', 'semantic', 'flows to', 'receives flow from', 'active'),
  ('SPECIALIZES', 'semantic', 'specializes', 'is generalization of', 'active'),
  ('ASSOCIATED_WITH', 'semantic', 'is associated with', 'is associated with', 'deprecated'),
  ('SEQUENCE_FLOW', 'semantic', 'is followed by', 'follows', 'active'),
  ('CONDITIONAL_FLOW', 'semantic', 'conditionally flows to', 'conditionally follows', 'active'),
  ('DEFAULT_FLOW', 'semantic', 'defaults to', 'is default after', 'active'),
  ('MESSAGE_FLOW', 'semantic', 'sends message to', 'receives message from', 'active'),
  ('DATA_ASSOCIATION', 'semantic', 'passes data to', 'takes data from', 'active'),
  ('CONTAINS', 'semantic', 'contains', 'is contained in', 'active'),
  ('CONNECTS', 'semantic', 'connects', 'is connected by', 'active'),
  ('TRACES', 'semantic', 'traces to', 'is traced from', 'active'),
  ('SATISFIES', 'semantic', 'satisfies', 'is satisfied by', 'active'),
  ('VERIFIES', 'semantic', 'verifies', 'is verified by', 'active'),
  ('REFINES', 'semantic', 'refines', 'is refined by', 'active'),
  ('ALLOCATES', 'semantic', 'allocates to', 'is allocated', 'active'),
  ('REDIRECTS_TO', 'semantic', 'redirects to', 'is redirect target of', 'active'),
  ('SYSML_ALLOCATES', 'semantic', 'allocates to (cross-notation)', 'is allocated (cross-notation)', 'active'),
  ('SYSML_TRACES', 'semantic', 'traces to (cross-notation)', 'is traced from (cross-notation)', 'active'),
  ('SYSML_VERIFIES', 'semantic', 'verifies (cross-notation)', 'is verified by (cross-notation)', 'active'),
  ('REALIZES_PROCESS', 'semantic', 'realizes process', 'is process realized by', 'active'),
  ('PERFORMS', 'semantic', 'performs', 'is performed by', 'active'),
  ('DETAILS', 'semantic', 'details', 'is detailed by', 'active')

ON CONFLICT ("key") DO NOTHING;

CREATE INDEX "graph_edge_rel_type_idx" ON "graph_edge"("rel_type");

-- NOT VALID: every new write is checked now; existing rows are validated once the
-- retype items (BI-28C22BE3, BI-92804832) have cleared the deprecated types.
ALTER TABLE "graph_edge" ADD CONSTRAINT "graph_edge_rel_type_fkey"
    FOREIGN KEY ("rel_type") REFERENCES "graph_relation_type"("key")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
