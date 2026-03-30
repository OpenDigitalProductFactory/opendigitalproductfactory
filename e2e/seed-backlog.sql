INSERT INTO "BacklogItem" (id, "itemId", title, status, type, body, priority, "epicId", "createdAt", "updatedAt")
VALUES
(gen_random_uuid()::text, 'BI-SPRV-001', 'Fix sandbox preview proxy to route to correct container', 'open', 'product',
'Fix /api/sandbox/preview/route.ts to read the build sandboxId from DB and construct the target URL dynamically per container. Currently hardcoded to SANDBOX_PREVIEW_URL.', 1,
'644decf3-d1e7-4c97-9b9d-e799df009c54', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SPRV-002', 'Propagate sandboxPort to SandboxPreview after allocation', 'open', 'product',
'Add sandbox:ready SSE event so BuildStudio component refreshes when sandboxId/sandboxPort are set. Currently the preview area stays on placeholder because client data is stale.', 2,
'644decf3-d1e7-4c97-9b9d-e799df009c54', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SPRV-003', 'Ensure preview server starts and serves generated preview', 'open', 'product',
'Kill zombie processes on port 3000 before starting preview server. Regenerate _preview/index.html after edit_sandbox_file and iterate_sandbox, not just generate_code.', 3,
'644decf3-d1e7-4c97-9b9d-e799df009c54', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SPRV-004', 'Add Playwright test verifying sandbox preview is visible during build', 'open', 'product',
'Extend e2e tests to verify the SandboxPreview iframe shows generated HTML during build phase. Screenshot captures preview content. Use headed config for visual verification.', 4,
'644decf3-d1e7-4c97-9b9d-e799df009c54', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-001', 'Get a build through build phase with passing typecheck', 'open', 'product',
'Build phase gate requires passing tests/typecheck. Auto-run typecheck after generate_code and provide error output for iteration. Goal: at least one build reaches review phase.', 1,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-002', 'Verify deploy_feature extracts diff and creates promotion', 'open', 'product',
'Test deploy_feature tool end-to-end: extract git diff from sandbox, categorize files, scan destructive ops, check deployment windows, create ChangePromotion record.', 2,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-003', 'Verify schedule_promotion schedules within deployment windows', 'open', 'product',
'After deploy_feature creates promotion, schedule_promotion must find the next available window and schedule it. Requires BusinessProfile with deployment windows configured.', 3,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-004', 'Verify executePromotion applies patch to production', 'open', 'product',
'Test the 10-step executePromotion pipeline: validate, check window, backup DB, apply git patch + prisma migrate, health check, mark deployed. Verify new page accessible in production.', 4,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-005', 'Test emergency change flow with retrospective approval', 'open', 'product',
'Emergency changes bypass deployment windows/blackouts. Verify: RFC type emergency starts in-progress, window checks skipped, blackout exceptions work, retrospective approval accessible.', 5,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW()),

(gen_random_uuid()::text, 'BI-SHIP-006', 'Add Playwright test for full ship-to-production lifecycle', 'open', 'product',
'Ultimate e2e test: create feature, ideate, plan, build (passing tests), review, ship, approve promotion, execute, verify new page in production. Headed mode with video recording.', 6,
'8962d836-05e2-4f55-9d39-d2c61951ea46', NOW(), NOW());
