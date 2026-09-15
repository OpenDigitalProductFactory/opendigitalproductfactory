-- Close the remaining unindexed cascading-FK gaps (BI-402CB8FE).
--
-- Follow-up to the cascading-FK index guard added with the DiscoveredRelationship
-- incident. That guard asserts the rule the PLANNER actually applies: every
-- ON DELETE CASCADE / SET NULL relation needs an index whose LEADING column is
-- the FK column. Postgres must find a parent's referencing children before it may
-- delete the parent, so without one it seq-scans the whole child table ONCE PER
-- DELETED PARENT ROW.
--
-- The guard found 39 further gaps and recorded them in a KNOWN_GAPS ratchet. This
-- closes all 39 and empties the ratchet, so the invariant now holds with no
-- exemptions and any NEW cascading FK must arrive indexed.
--
-- Why now rather than "none of these is at incident scale": the cost is not
-- linear and it is invisible until it is not. The original incident sat at
-- effectively zero cost for months and became a 74-minute, two-core, zero-rows-
-- deleted stall once the child table crossed ~500k rows. The most exposed entry
-- here is already large:
--
--   ContributorInventorySnapshot.syncRunId (Cascade)   263,224 rows
--   InventoryRelationship.toEntityId      (Cascade)      1,746 rows
--     (fromEntityId is covered only because it LEADS the composite unique;
--      toEntityId is not, which is exactly the trap the guard exists to catch)
--   DiscoveryFingerprintObservation.approvedRuleId       222 rows
--   AuthorizationDecisionLog.patientSubjectPrincipalId    51 rows
--
-- the rest are currently empty on this install and are indexed so they can never
-- become the next one.
--
-- @migration-safety: data-safe: purely additive. Creates btree indexes only.
-- Alters no column, constraint or row; no backfill, no data movement, nothing
-- tightened -- no existing row can violate a constraint that did not already
-- apply to it, so this applies cleanly against any data state. IF NOT EXISTS
-- throughout, so an operator who pre-created one for relief does not break
-- migrate deploy.
--
-- Lock note: plain CREATE INDEX (Prisma runs each migration in a transaction, so
-- CONCURRENTLY is unavailable). Each takes a brief SHARE lock blocking WRITES to
-- that table only, for the duration of the build. The largest table here is
-- ContributorInventorySnapshot; every other is under 2k rows, so the builds are
-- sub-second to seconds.

CREATE INDEX IF NOT EXISTS "AccountInvite_accountId_idx" ON "AccountInvite"("accountId");
CREATE INDEX IF NOT EXISTS "Application_currentStageId_idx" ON "Application"("currentStageId");
CREATE INDEX IF NOT EXISTS "AssuranceRun_releaseBundleId_idx" ON "AssuranceRun"("releaseBundleId");
CREATE INDEX IF NOT EXISTS "AuthorizationDecisionLog_patientSubjectPrincipalId_idx" ON "AuthorizationDecisionLog"("patientSubjectPrincipalId");
CREATE INDEX IF NOT EXISTS "BeautyResourceService_itemId_idx" ON "BeautyResourceService"("itemId");
CREATE INDEX IF NOT EXISTS "BomDocument_artifactRevisionId_idx" ON "BomDocument"("artifactRevisionId");
CREATE INDEX IF NOT EXISTS "BomDocument_assuranceRunId_idx" ON "BomDocument"("assuranceRunId");
CREATE INDEX IF NOT EXISTS "BookingHold_itemId_idx" ON "BookingHold"("itemId");
CREATE INDEX IF NOT EXISTS "BookingHold_providerId_idx" ON "BookingHold"("providerId");
CREATE INDEX IF NOT EXISTS "CatalogPriceListEntry_catalogItemId_idx" ON "CatalogPriceListEntry"("catalogItemId");
CREATE INDEX IF NOT EXISTS "CatalogPromotionItem_catalogItemId_idx" ON "CatalogPromotionItem"("catalogItemId");
CREATE INDEX IF NOT EXISTS "ContributorInventorySnapshot_syncRunId_idx" ON "ContributorInventorySnapshot"("syncRunId");
CREATE INDEX IF NOT EXISTS "DiscoveryFingerprintObservation_approvedRuleId_idx" ON "DiscoveryFingerprintObservation"("approvedRuleId");
CREATE INDEX IF NOT EXISTS "DocumentTag_documentId_idx" ON "DocumentTag"("documentId");
CREATE INDEX IF NOT EXISTS "EaReferenceAssessment_modelElementId_idx" ON "EaReferenceAssessment"("modelElementId");
CREATE INDEX IF NOT EXISTS "EdgeNode_subscriptionId_idx" ON "EdgeNode"("subscriptionId");
CREATE INDEX IF NOT EXISTS "EpicPortfolio_epicId_idx" ON "EpicPortfolio"("epicId");
CREATE INDEX IF NOT EXISTS "IdentityResolutionLog_fingerprintRuleId_idx" ON "IdentityResolutionLog"("fingerprintRuleId");
CREATE INDEX IF NOT EXISTS "InventoryRelationship_toEntityId_idx" ON "InventoryRelationship"("toEntityId");
CREATE INDEX IF NOT EXISTS "KnowledgeArticlePortfolio_articleId_idx" ON "KnowledgeArticlePortfolio"("articleId");
CREATE INDEX IF NOT EXISTS "KnowledgeArticleProduct_articleId_idx" ON "KnowledgeArticleProduct"("articleId");
CREATE INDEX IF NOT EXISTS "MemberEquityEntry_memberAccountId_idx" ON "MemberEquityEntry"("memberAccountId");
CREATE INDEX IF NOT EXISTS "PatientAuthority_revokedByPrincipalId_idx" ON "PatientAuthority"("revokedByPrincipalId");
CREATE INDEX IF NOT EXISTS "PatientAuthority_verifiedByPrincipalId_idx" ON "PatientAuthority"("verifiedByPrincipalId");
CREATE INDEX IF NOT EXISTS "PatientConsentDirective_revokedByPrincipalId_idx" ON "PatientConsentDirective"("revokedByPrincipalId");
CREATE INDEX IF NOT EXISTS "PatientConsentDirective_verifiedByPrincipalId_idx" ON "PatientConsentDirective"("verifiedByPrincipalId");
CREATE INDEX IF NOT EXISTS "PatientProfile_recordedByPrincipalId_idx" ON "PatientProfile"("recordedByPrincipalId");
CREATE INDEX IF NOT EXISTS "PatientProfile_verifiedByPrincipalId_idx" ON "PatientProfile"("verifiedByPrincipalId");
CREATE INDEX IF NOT EXISTS "RentalAgreement_storefrontItemId_idx" ON "RentalAgreement"("storefrontItemId");
CREATE INDEX IF NOT EXISTS "RuntimeVerification_gitPromotionCandidateId_idx" ON "RuntimeVerification"("gitPromotionCandidateId");
CREATE INDEX IF NOT EXISTS "ScheduledInterview_stageId_idx" ON "ScheduledInterview"("stageId");
CREATE INDEX IF NOT EXISTS "Scorecard_interviewId_idx" ON "Scorecard"("interviewId");
CREATE INDEX IF NOT EXISTS "TaxLiabilityEntry_periodId_idx" ON "TaxLiabilityEntry"("periodId");
CREATE INDEX IF NOT EXISTS "WeightAdjustmentProposal_ruledByUserId_idx" ON "WeightAdjustmentProposal"("ruledByUserId");
CREATE INDEX IF NOT EXISTS "WikiPageLink_fromPageId_idx" ON "WikiPageLink"("fromPageId");
CREATE INDEX IF NOT EXISTS "WikiPageSource_pageId_idx" ON "WikiPageSource"("pageId");
CREATE INDEX IF NOT EXISTS "WorkbookRow_createdById_idx" ON "WorkbookRow"("createdById");
CREATE INDEX IF NOT EXISTS "WorkbookShare_userId_idx" ON "WorkbookShare"("userId");
CREATE INDEX IF NOT EXISTS "WorkbookView_createdById_idx" ON "WorkbookView"("createdById");