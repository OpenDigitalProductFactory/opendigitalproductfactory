-- @migration-safety: data-safe: every FOREIGN KEY below is added NOT VALID, so it is
-- never checked against pre-existing rows — legacy installs with orphan link values
-- apply this migration cleanly and only NEW writes are enforced. The index additions
-- are plain (non-unique) CREATE INDEX statements, which cannot fail on data.
--
-- BI-640B011D (Simplify & Strengthen W2, architecture pass 2026-08-16 §3.2-b):
--   1. Leading indexes for a JUSTIFIED cohort of declared-FK relations (each carries
--      its query-path citation; the remaining misses are budgeted by
--      scripts/check-fk-index-coverage.mjs, not mechanically indexed).
--   2. Real FK constraints for the Workroom ("WorkCapsule") bare *Id link columns
--      whose write paths use canonical row ids. backlogItemId / epicId are
--      deliberately excluded: live writers store mixed key shapes (BI-*/EP-*
--      semantic keys vs cuid row ids), so a FK would break a writer family.
--   3. FK constraints for the 20 models carrying organizationId with no relation
--      to Organization (the Staffing* family among them). organizationId itself is
--      NOT indexed: single-org-per-install makes it a one-value column.

-- ── 1. FK-leading indexes — recursive/tree/self-relation parents ─────────────
-- Query path: root/child traversal, apps/web/lib/actions/build.ts:1295 (findFirst parentId: null per portfolio)
CREATE INDEX "TaxonomyNode_parentId_idx" ON "TaxonomyNode"("parentId");
-- Query path: product-line hierarchy traversal (composite FK parentId+organizationId)
CREATE INDEX "ProductLine_parentId_organizationId_idx" ON "ProductLine"("parentId", "organizationId");
-- Query path: org-chart dotted-line reverse lookup, apps/web/lib/actions/workforce.ts:379
CREATE INDEX "EmployeeProfile_dottedLineManagerId_idx" ON "EmployeeProfile"("dottedLineManagerId");
-- Query path: duplicate-chain reverse lookup, apps/web/lib/mcp/backlog-retirement-handlers.ts:55
CREATE INDEX "BacklogItem_duplicateOfId_idx" ON "BacklogItem"("duplicateOfId");
-- Query path: duplicate-chain reverse lookup (capability-need triage merge path)
CREATE INDEX "CoworkerCapabilityNeed_duplicateOfId_idx" ON "CoworkerCapabilityNeed"("duplicateOfId");
-- Query path: supersession-chain reverse lookup, apps/web/lib/tak/user-facts.ts:440
CREATE INDEX "UserFact_supersededById_idx" ON "UserFact"("supersededById");
-- Query path: supersession-chain reverse lookup (compliance evidence supersede flow)
CREATE INDEX "ComplianceEvidence_supersededById_idx" ON "ComplianceEvidence"("supersededById");
-- Query path: EA view-element tree traversal, apps/web/lib/actions/ea.ts:651
CREATE INDEX "EaViewElement_parentViewElementId_idx" ON "EaViewElement"("parentViewElementId");
-- Query path: grouped-booking child lookup (parent/child booking tree)
CREATE INDEX "StorefrontBooking_parentBookingId_idx" ON "StorefrontBooking"("parentBookingId");
-- Query path: quote revision-chain reverse lookup (previousId self-relation)
CREATE INDEX "Quote_previousId_idx" ON "Quote"("previousId");

-- ── 1. FK-leading indexes — join tables missing the second-side index ────────
-- @@id([epicId, portfolioId]) only covers the epic side; portfolio-side lookups scan.
CREATE INDEX "EpicPortfolio_portfolioId_idx" ON "EpicPortfolio"("portfolioId");
-- @@id([articleId, digitalProductId]) only covers the article side.
CREATE INDEX "KnowledgeArticleProduct_digitalProductId_idx" ON "KnowledgeArticleProduct"("digitalProductId");
-- @@id([articleId, portfolioId]) only covers the article side.
CREATE INDEX "KnowledgeArticlePortfolio_portfolioId_idx" ON "KnowledgeArticlePortfolio"("portfolioId");
-- @@id([pageId, sourceId]) only covers the page side.
CREATE INDEX "WikiPageSource_sourceId_idx" ON "WikiPageSource"("sourceId");
-- @@unique leads on userId and @@index on productId; role-side lookups scan.
CREATE INDEX "BusinessModelRoleAssignment_businessModelRoleId_idx" ON "BusinessModelRoleAssignment"("businessModelRoleId");

-- ── 1. FK-leading indexes — high-traffic spine FKs (cited query paths) ───────
-- Query path: open-items-per-epic scan, apps/web/lib/mcp/backlog-retirement-handlers.ts:168
CREATE INDEX "BacklogItem_epicId_idx" ON "BacklogItem"("epicId");
-- Query path: contacts-of-account relation join, apps/web/app/api/v1/customer/visits/route.ts:71
CREATE INDEX "CustomerContact_accountId_idx" ON "CustomerContact"("accountId");
-- Query path: portfolio coverage listing, apps/web/app/(shell)/portfolio/[[...slug]]/page.tsx:106
CREATE INDEX "DigitalProduct_portfolioId_idx" ON "DigitalProduct"("portfolioId");
-- Query path: sibling-products-by-node, apps/web/lib/explore/feature-build-data.ts:455
CREATE INDEX "DigitalProduct_taxonomyNodeId_idx" ON "DigitalProduct"("taxonomyNodeId");
-- Query path: active-agents-per-portfolio groupBy, apps/web/lib/evaluate/portfolio-data.ts:72
CREATE INDEX "Agent_portfolioId_idx" ON "Agent"("portfolioId");
-- Query path: bills-for-PO lookup, apps/web/lib/actions/ap.ts:569
CREATE INDEX "Bill_purchaseOrderId_idx" ON "Bill"("purchaseOrderId");
-- Query path: token revocation by user, apps/web/app/api/v1/auth/logout/route.ts:33
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken"("userId");
-- Query path: integration-backed server listing, apps/web/lib/actions/connection-catalog.ts:96
CREATE INDEX "McpServer_integrationId_idx" ON "McpServer"("integrationId");
-- Query path: provider-day busy-booking scan, apps/web/lib/slot-engine/compute-slots.ts:139
CREATE INDEX "StorefrontBooking_providerId_idx" ON "StorefrontBooking"("providerId");
-- Query path: provider-service cleanup per item, apps/web/app/api/storefront/admin/items/[id]/route.ts:166
CREATE INDEX "ProviderService_itemId_idx" ON "ProviderService"("itemId");
-- Query path: open promotions per build, apps/web/instrumentation.ts:503
CREATE INDEX "ProductVersion_featureBuildId_idx" ON "ProductVersion"("featureBuildId");
-- Query path: storefront-by-archetype relation join, apps/web/lib/demo/load-demo-business.ts:335
CREATE INDEX "StorefrontConfig_archetypeId_idx" ON "StorefrontConfig"("archetypeId");

-- ── 1. FK-leading indexes — new Workroom FK support ──────────────────────────
-- Query path: SET NULL fan-out on Principal delete + lease-holder lookups
CREATE INDEX "WorkCapsule_leaseHolderPrincipalId_idx" ON "WorkCapsule"("leaseHolderPrincipalId");
-- Query path: SET NULL fan-out on Principal delete
CREATE INDEX "WorkCapsule_createdByPrincipalId_idx" ON "WorkCapsule"("createdByPrincipalId");

-- ── 2. Workroom bare-link FK constraints (NOT VALID — legacy orphans stay) ───
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_featureBuildId_fkey" FOREIGN KEY ("featureBuildId") REFERENCES "FeatureBuild"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_taskRunId_fkey" FOREIGN KEY ("taskRunId") REFERENCES "TaskRun"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_gitPromotionCandidateId_fkey" FOREIGN KEY ("gitPromotionCandidateId") REFERENCES "GitPromotionCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_changePromotionId_fkey" FOREIGN KEY ("changePromotionId") REFERENCES "ChangePromotion"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_leaseHolderPrincipalId_fkey" FOREIGN KEY ("leaseHolderPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_createdByPrincipalId_fkey" FOREIGN KEY ("createdByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkCapsule" ADD CONSTRAINT "WorkCapsule_requestedByPrincipalId_fkey" FOREIGN KEY ("requestedByPrincipalId") REFERENCES "Principal"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ── 3. organizationId FK constraints (NOT VALID — legacy orphans stay) ───────
ALTER TABLE "BillableRate" ADD CONSTRAINT "BillableRate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OutboundDraft" ADD CONSTRAINT "OutboundDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "InboundChannelMessage" ADD CONSTRAINT "InboundChannelMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MarketingChannelSpendCeiling" ADD CONSTRAINT "MarketingChannelSpendCeiling_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ScheduledOutboundAction" ADD CONSTRAINT "ScheduledOutboundAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OutboundAutopilotPolicy" ADD CONSTRAINT "OutboundAutopilotPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MediaAttachment" ADD CONSTRAINT "MediaAttachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "AdoptableAnimal" ADD CONSTRAINT "AdoptableAnimal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "GearInterface" ADD CONSTRAINT "GearInterface_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingDemand" ADD CONSTRAINT "StaffingDemand_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingShift" ADD CONSTRAINT "StaffingShift_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingAssignment" ADD CONSTRAINT "StaffingAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingCrew" ADD CONSTRAINT "StaffingCrew_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingResourceLink" ADD CONSTRAINT "StaffingResourceLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EmployeeAvailabilityWindow" ADD CONSTRAINT "EmployeeAvailabilityWindow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "EmployeeSchedulingPreference" ADD CONSTRAINT "EmployeeSchedulingPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingConstraintRule" ADD CONSTRAINT "StaffingConstraintRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingProposalRun" ADD CONSTRAINT "StaffingProposalRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "StaffingExceptionRequest" ADD CONSTRAINT "StaffingExceptionRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "WorkforceCandidateFact" ADD CONSTRAINT "WorkforceCandidateFact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
