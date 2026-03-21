-- Epic Reconciliation — 2026-03-20
-- Run after data restore to align epic statuses with actual implementation state.
-- See: docs/superpowers/specs/2026-03-20-epic-review-and-reconciliation.md

BEGIN;

-- ============================================================
-- CATEGORY A: Close as DONE (implemented in code)
-- ============================================================

-- CRM Core (superseded by CRM Sales Pipeline — both are done)
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: fully implemented. Superseded by CRM Sales Pipeline epic.'
WHERE title = 'CRM Core' AND status != 'done';

-- CRM Sales Pipeline & Quote-to-Order
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: Opportunity, Quote, SalesOrder, Activity, Engagement models + routes + APIs all built.'
WHERE title = 'CRM Sales Pipeline & Quote-to-Order' AND status != 'done';

-- HR Core
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: 13 HR models, 16 components, employee directory/lifecycle/reviews/timesheets all implemented.'
WHERE title = 'HR Core' AND status != 'done';

-- EA Modeler
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: 14+ EA models, 26 components, React Flow canvas, viewpoints, reference models all implemented.'
WHERE title = 'EA Modeler' AND status != 'done';

-- Calendaring Core (superseded by EP-CAL-001)
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: core calendar implemented. Superseded by EP-CAL-001 for remaining items.'
WHERE title = 'Calendaring Core' AND status != 'done';

-- Theme & Branding Modernization
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: BrandingConfig model, wizard, preview, quick-edit all implemented.'
WHERE id = 'EP-UI-THEME-001' AND status != 'done';

-- Live LLM Conversations
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: AgentThread/Message models, streaming endpoint, 12 agent components, provider registry all implemented.'
WHERE id = 'EP-LLM-LIVE-001' AND status != 'done';

-- Agent Task Execution with HITL Governance
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: AgentActionProposal, AuthorizationDecisionLog, governance profiles, delegation grants all implemented.'
WHERE id = 'EP-AGENT-EXEC-001' AND status != 'done';

-- Platform REST API v1
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: 70+ API endpoints across all domains, JWT + session auth, versioned under /api/v1/.'
WHERE id = 'EP-REST-API-001' AND status != 'done';

-- Storefront Foundation
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: 8 storefront models, 19+ components, multi-tenant routing, booking/donation/checkout all implemented.'
WHERE id = 'EP-STORE-001' AND status != 'done';

-- ============================================================
-- CATEGORY B: Update to IN-PROGRESS (partially implemented)
-- ============================================================

-- Financial Management Suite (Phase A+B done, C-E open)
UPDATE "Epic" SET status = 'in-progress'
WHERE id = 'EP-FINMGMT-001' AND status = 'open';

-- Calendar Infrastructure (core items done, advanced items open)
UPDATE "Epic" SET status = 'in-progress'
WHERE id = 'EP-CAL-001' AND status = 'open';

-- Infrastructure Registry
UPDATE "Epic" SET status = 'in-progress', description = description || E'\n\n[2026-03-20] Updated: InventoryEntity, DiscoveryRun models + /inventory route implemented. CI detail and health tracking still open.'
WHERE title = 'Infrastructure Registry' AND status = 'open';

-- Standalone Docker Deployment
UPDATE "Epic" SET status = 'in-progress', description = description || E'\n\n[2026-03-20] Updated: docker-compose files exist, Ollama components built. Full managed sidecar not yet wired.'
WHERE id = 'EP-DEPLOY-001' AND status = 'open';

-- ============================================================
-- CATEGORY D: Close as SUPERSEDED
-- ============================================================

-- Financial Primitives and Budget Management (superseded by EP-FINMGMT-001)
UPDATE "Epic" SET status = 'done', description = description || E'\n\n[2026-03-20] Closed: SUPERSEDED by EP-FINMGMT-001 (Financial Management Suite). Original ERPNext approach replaced with native implementation.'
WHERE title = 'Financial Primitives and Budget Management' AND status != 'done';

-- ============================================================
-- CATEGORY A: Close backlog items for done epics
-- ============================================================

-- Mark all backlog items under done epics as done (where not already)
UPDATE "BacklogItem" SET status = 'done'
WHERE "epicId" IN (
  SELECT id FROM "Epic"
  WHERE status = 'done'
    AND (
      title IN ('CRM Core', 'CRM Sales Pipeline & Quote-to-Order', 'HR Core', 'EA Modeler', 'Calendaring Core', 'Financial Primitives and Budget Management')
      OR id IN ('EP-UI-THEME-001', 'EP-LLM-LIVE-001', 'EP-AGENT-EXEC-001', 'EP-REST-API-001', 'EP-STORE-001')
    )
)
AND status != 'done';

-- ============================================================
-- Mark Phase A+B items as done within EP-FINMGMT-001
-- (items 1-7 in the financial management epic)
-- ============================================================

UPDATE "BacklogItem" SET status = 'done'
WHERE "epicId" = 'EP-FINMGMT-001'
  AND title IN (
    'Invoice data model and sequential numbering',
    'Invoice lifecycle and payment recording',
    'Invoice generation from sales orders',
    'Invoice sending, Pay Now portal, view tracking',
    'Invoicing UI — 60-second creation',
    'Supplier model, bill capture with OCR, approval routing',
    'Purchase order workflow'
  )
  AND status != 'done';

COMMIT;

-- ============================================================
-- Verification query — run after to confirm
-- ============================================================
SELECT status, count(*) as epic_count
FROM "Epic"
GROUP BY status
ORDER BY status;
