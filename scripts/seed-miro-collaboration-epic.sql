-- Seed Miro Board Collaboration epic
-- Run: cd packages/db && npx prisma db execute --file ../../scripts/seed-miro-collaboration-epic.sql
--
-- Architecture notes:
--   • Miro REST API v2 integration via OAuth 2.0 (team-level token)
--   • Bi-directional sync between platform EA models and Miro boards
--   • EA canvas (React Flow) ↔ Miro board export/import
--   • Value stream maps, capability maps, and ArchiMate views publishable to Miro
--   • Miro as collaboration surface for stakeholders without platform accounts
--   • Webhook-driven change detection for Miro → platform sync
--   • Lives in manufacturing_and_delivery (EA tooling) + for_employees (collaboration)
DO $$
DECLARE
  mfg_id      TEXT;
  emp_id      TEXT;
  epic_id     TEXT;
BEGIN
  SELECT id INTO mfg_id FROM "Portfolio" WHERE slug = 'manufacturing_and_delivery';
  SELECT id INTO emp_id FROM "Portfolio" WHERE slug = 'for_employees';

  IF mfg_id IS NULL OR emp_id IS NULL THEN
    RAISE EXCEPTION 'Expected portfolio slugs not found.';
  END IF;

  INSERT INTO "Epic" (id, "epicId", title, description, status, "createdAt", "updatedAt")
  VALUES (
    gen_random_uuid()::text,
    'EP-' || gen_random_uuid()::text,
    'Miro Board Collaboration',
    'Integrate Miro as a collaboration surface for EA models and planning artifacts. Platform EA views (value streams, capability maps, ArchiMate diagrams) can be published to Miro boards for stakeholder review and workshop facilitation. Changes made in Miro sync back via webhooks. OAuth 2.0 team-level auth. Enables non-platform users (executives, external consultants) to participate in architecture decisions without needing platform accounts.',
    'open', NOW(), NOW()
  ) RETURNING id INTO epic_id;

  INSERT INTO "EpicPortfolio" ("epicId", "portfolioId")
  VALUES (epic_id, mfg_id), (epic_id, emp_id);

  INSERT INTO "BacklogItem" (id, "itemId", title, type, status, priority, "epicId", "createdAt", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Miro OAuth 2.0 integration: MiroConnection model — teamId, accessToken (encrypted), refreshToken (encrypted), tokenExpiresAt, connectedByUserId FK, boardPermissionScope. OAuth flow via /platform/integrations/miro with token storage in provider registry pattern. Capability-gated (manage_integrations).',
     'portfolio', 'open', 1, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Board registry and mapping: MiroBoard model — boardId (Miro external ID), name, sourceType enum (value_stream/capability_map/archimate_view/freeform), sourceEntityId (FK to EA model entity), lastSyncedAt, syncDirection enum (push_only/pull_only/bidirectional), status enum (active/archived/error). CRUD server actions + /platform/integrations/miro/boards route.',
     'portfolio', 'open', 2, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'EA → Miro export engine: publishToMiro(sourceType, sourceEntityId) server action — converts React Flow node/edge graph to Miro sticky notes, shapes, connectors, and frames via Miro REST API v2. Maps ArchiMate element types to Miro shape styles (color coding by layer: strategy=yellow, business=blue, application=green, technology=purple). Preserves spatial layout. Creates or updates MiroBoard record.',
     'product', 'open', 3, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Miro → Platform sync via webhooks: register Miro webhook for board_changed events. MiroWebhookEvent model — eventType, boardId, payload (JSON), processedAt, syncResult. Webhook handler maps Miro item changes back to EA model nodes/edges — creates change proposals (not direct mutations) that surface in /ea for architect approval. Conflict detection when both sides changed.',
     'product', 'open', 4, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Value stream map Miro template: purpose-built Miro frame layout for value stream maps — stages as horizontal swim lanes, capabilities as grouped sticky notes within stages, metrics as data tags. "Publish Value Stream to Miro" button on value stream detail page. Template includes legend frame explaining ArchiMate color coding.',
     'product', 'open', 5, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Capability map Miro template: hierarchical capability tree rendered as nested Miro frames with heat-map coloring (maturity level → color gradient). "Publish Capability Map to Miro" button on capability map page. Includes assessment overlay showing current vs target maturity as dual-colored badges.',
     'product', 'open', 6, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Collaboration session support: MiroSession model — boardId, sessionType enum (workshop/review/async_feedback), createdByUserId, participants (email array for non-platform users), startsAt, endsAt, feedbackDeadline. "Start Workshop" action creates a time-boxed Miro board with facilitator guide frame. Session summary auto-generated from Miro comments and sticky note clusters when session closes.',
     'product', 'open', 7, epic_id, NOW(), NOW()),

    (gen_random_uuid()::text, 'BI-' || gen_random_uuid()::text,
     'Miro integration dashboard: /platform/integrations/miro overview showing connected boards count, last sync timestamps, sync error alerts, pending change proposals from Miro, active collaboration sessions. Quick actions: reconnect OAuth, force-sync board, archive stale boards. Integration health shown on /platform settings page.',
     'product', 'open', 8, epic_id, NOW(), NOW());

  RAISE NOTICE 'Miro Board Collaboration epic created with 8 stories.';
END $$;
