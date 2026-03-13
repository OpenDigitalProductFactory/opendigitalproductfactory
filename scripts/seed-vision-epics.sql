-- Seed 5 vision epics and their initial backlog item stories
-- Run via: cd packages/db && npx prisma db execute --file ../../scripts/seed-vision-epics.sql --schema prisma/schema.prisma
DO $$
DECLARE
  foundational_id   TEXT;
  mfg_delivery_id   TEXT;
  for_employees_id  TEXT;
  e1 TEXT; e2 TEXT; e3 TEXT; e4 TEXT; e5 TEXT;
BEGIN
  SELECT id INTO foundational_id  FROM "Portfolio" WHERE slug = 'foundational';
  SELECT id INTO mfg_delivery_id  FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';
  SELECT id INTO for_employees_id FROM "Portfolio" WHERE slug = 'for_employees';

  IF foundational_id IS NULL OR mfg_delivery_id IS NULL OR for_employees_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found — run the main seed first.';
  END IF;

  -- ── Epic 1: Neo4j + Digital Product Backbone ────────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Neo4j + Digital Product Backbone',
    'Establish Neo4j as the graph store for the Digital Product Backbone. Model cross-domain relationships (concept-to-operational), provider/consumer dependencies, and IT4IT data objects. This is the foundation for EA Modeler, impact analysis, and infrastructure registry.',
    'open', NOW(), NOW()
  ) RETURNING id INTO e1;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId") VALUES (e1, foundational_id), (e1, mfg_delivery_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Provision Neo4j instance and register it as a foundational infrastructure CI', 'portfolio', 'open', 1, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Define graph schema v1 for Digital Product entities (concept → logical → physical layers)', 'portfolio', 'open', 2, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Implement provider/consumer relationship model (directed edges with role metadata)', 'portfolio', 'open', 3, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Build Cypher query API layer for graph traversal (impact analysis foundation)', 'portfolio', 'open', 4, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Sync Prisma DigitalProduct and TaxonomyNode records into Neo4j on write', 'portfolio', 'open', 5, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Map IT4IT S2P, R2D, R2F, D2C data objects to graph node types', 'portfolio', 'open', 6, e1, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Seed Neo4j with foundational portfolio infrastructure nodes (PostgreSQL, Neo4j, Docker)', 'portfolio', 'open', 7, e1, NOW(), NOW());

  -- ── Epic 2: EA Modeler ───────────────────────────────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'EA Modeler',
    'Graph-native enterprise architecture modelling canvas built on JointJS + ArchiMate 4. Neo4j owns the semantic model. Scenarios capture proposed future states. Snapshots are immutable approval artefacts. Whiteboard-first interaction model with drag-to-connect and direct manipulation.',
    'open', NOW(), NOW()
  ) RETURNING id INTO e2;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId") VALUES (e2, mfg_delivery_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Route /ea/modeler: full-viewport canvas page (HR-300, HR-000 access)', 'product', 'open', 1, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'JointJS canvas setup with ArchiMate 4 shape library (18 element types, 4 layers)', 'product', 'open', 2, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'ELK.js auto-layout integration (layered + flow modes, lazy-load WASM bundle)', 'product', 'open', 3, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Scenario management CRUD (ModelScenario: draft → active → submitted → approved)', 'product', 'open', 4, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Viewpoint catalog: 4 viewpoints (Application Architecture, Technology/Deployment, Business Process, Portfolio/Capability)', 'product', 'open', 5, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Drag-to-connect interaction: port magnets, ghost link, valid/invalid target highlighting', 'product', 'open', 6, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Element search modal: search operational elements, reference vs. propose dialog', 'product', 'open', 7, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Snapshot creation: freeze subgraph JSON as ModelSnapshot, generate DR artifact', 'product', 'open', 8, e2, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Lifecycle state visual encoding: current (solid) / proposed (dashed) / approved (green) / retired (grey)', 'product', 'open', 9, e2, NOW(), NOW());

  -- ── Epic 3: Infrastructure Registry ─────────────────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Infrastructure Registry',
    'Operational footprint registry: track Docker instances, databases, services, and their provider/consumer relationships across portfolios. Links the foundational infrastructure to the manufacturing domain. Enables dependency impact analysis and operational visibility.',
    'open', NOW(), NOW()
  ) RETURNING id INTO e3;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId") VALUES (e3, foundational_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Infrastructure CI model: node types (server, container, database, service, network)', 'portfolio', 'open', 1, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Register existing instances: PostgreSQL, Neo4j, Docker host as foundational CIs', 'portfolio', 'open', 2, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Provider/consumer relationship UI: link CIs with directed dependency edges', 'portfolio', 'open', 3, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Infrastructure registry page: filterable CI list with status, type, owner portfolio', 'portfolio', 'open', 4, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'CI detail view: show upstream providers and downstream consumers from Neo4j graph', 'portfolio', 'open', 5, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Health status tracking: operational / degraded / offline with last-seen timestamp', 'portfolio', 'open', 6, e3, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Link infrastructure CIs to taxonomy nodes for ownership domain attribution', 'portfolio', 'open', 7, e3, NOW(), NOW());

  -- ── Epic 4: Unified Work Item Types (Phase 6B) ───────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Unified Work Item Types (Phase 6B)',
    'Extend the backlog system with a workItemType discriminator (story, bug, enabler, improvement, demand, incident, problem, change-request) and ITSM traceability fields (originType, originId). Enables the D2C-to-R2D traceability chain: incident → problem → bug → story.',
    'open', NOW(), NOW()
  ) RETURNING id INTO e4;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId") VALUES (e4, mfg_delivery_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Add workItemType field to BacklogItem schema (story | bug | enabler | improvement | demand | incident | problem | change-request)', 'portfolio', 'open', 1, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Add originType and originId traceability fields to BacklogItem', 'portfolio', 'open', 2, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Update BacklogPanel UI: workItemType selector with type-specific field visibility', 'portfolio', 'open', 3, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Bug type: add severity (1-4), steps to reproduce, expected vs actual fields', 'portfolio', 'open', 4, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Incident type: add urgency, impact, affected CI, SLA deadline, breach flag fields', 'portfolio', 'open', 5, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'OpsClient: group and filter unassigned items by workItemType', 'portfolio', 'open', 6, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Spawn delivery item from ITSM record: link Bug/Story back to originating Incident/Problem', 'portfolio', 'open', 7, e4, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Update backlog.ts constants and validators for all workItemTypes', 'portfolio', 'open', 8, e4, NOW(), NOW());

  -- ── Epic 5: ITSM Module ──────────────────────────────────────────────────────
  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'ITSM Module',
    'Native incident, problem, known error, change request, and service request management — purpose-built for small-to-mid sized companies who cannot justify a full ServiceNow deployment. Implements the IT4IT Detect to Correct (D2C) and Request to Fulfill (R2F) value streams within the platform.',
    'open', NOW(), NOW()
  ) RETURNING id INTO e5;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId") VALUES (e5, mfg_delivery_id), (e5, for_employees_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Incident management: create, update, resolve with urgency/impact/priority matrix and SLA tracking', 'portfolio', 'open', 1, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Problem management: link incidents, record RCA, promote to Known Error', 'portfolio', 'open', 2, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Known Error Database (KEDB): workaround documentation, fix decision tracking', 'portfolio', 'open', 3, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Change Request workflow: standard/normal/emergency types, approval chain, CAB decision', 'portfolio', 'open', 4, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Service Request catalog: catalog items, fulfillment workflow, SLA tracking', 'portfolio', 'open', 5, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'D2C-to-R2D traceability: spawn backlog items from ITSM records with full link chain', 'portfolio', 'open', 6, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, '/itsm route: unified ITSM dashboard (active incidents, open problems, pending changes)', 'portfolio', 'open', 7, e5, NOW(), NOW()),
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text, 'Notification and escalation: SLA breach alerts, pending approval reminders', 'portfolio', 'open', 8, e5, NOW(), NOW());

  RAISE NOTICE 'Done: 5 epics and 39 stories created.';
END $$;
