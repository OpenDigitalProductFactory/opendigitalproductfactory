// apps/web/lib/mcp/pack-registry.ts — EP-8DC217EB BET-4
//
// The single tool-pack registry, extracted from mcp-tools.ts so that ADDING a
// pack no longer conflicts on one shared line. Each pack is ONE import line +
// ONE array entry; this file is `merge=union` (see .gitattributes), so two
// branches that each add a pack merge cleanly instead of colliding — the
// cascade-killer pattern (BI-3B0AD9CF) applied to the pack registry.
//
// RULES (enforced by pack-registry.test.ts):
//   - one pack per line, trailing comma, so additions are union-mergeable;
//   - every imported pack appears in the array and vice-versa;
//   - no duplicate packId (a union merge that duplicated a line, or a human
//     double-add, fails the test rather than shipping a broken registry).
//
// Adding a pack: add its `import { xPack } from "./packs/x-pack";` line and a
// `xPack,` line in the array. Nothing in mcp-tools.ts changes.

import { composeToolPacks } from "./tool-registry";
import { deliberationSiemPack } from "./packs/deliberation-siem-pack";
import { roomMessagingPack } from "./packs/room-messaging-pack";
import { runtimeCoordinationPack } from "./packs/runtime-coordination-pack";
import { workCapsulesPack } from "./packs/work-capsules-pack";
import { workbooksPack } from "./packs/workbooks-pack";
import { feedbackPack } from "./packs/feedback-pack";
import { orgDecisionPack } from "./packs/org-decision-pack";
import { complianceScopePack } from "./packs/compliance-scope-pack";
import { capabilityCompletenessPack } from "./packs/capability-completeness-pack";
import { founderReviewPack } from "./packs/founder-review-pack";
import { professionDecisionPack } from "./packs/profession-decision-pack";
import { uxCritiquePack } from "./packs/ux-critique-pack";
import { optimizationPack } from "./packs/optimization-pack";
import { marketingPack } from "./packs/marketing-pack";
import { bankingPack } from "./packs/banking-pack";
import { workCapturePack } from "./packs/work-capture-pack";
import { activityRoutingPack } from "./packs/activity-routing-pack";
import { selfUpgradePack } from "./packs/self-upgrade-pack";
import { coworkerServiceCatalogPack } from "./packs/coworker-service-catalog-pack";
import { coworkerToolGrantPack } from "./packs/coworker-tool-grant-pack";
import { coworkerEstablishPack } from "./packs/coworker-establish-pack";
import { coworkerMemoryPack } from "./packs/coworker-memory-pack";
import { surfaceReadinessPack } from "./packs/surface-readiness-pack";
import { effortContextPack } from "./packs/effort-context-pack";
import { coworkerGoalPack } from "./packs/coworker-goal-pack";
import { subagentFanoutPack } from "./packs/subagent-fanout-pack";
import { mdmStewardshipPack } from "./packs/mdm-stewardship-pack";
import { crmContactsPack } from "./packs/crm-contacts-pack";
import { crmEnrichmentPack } from "./packs/crm-enrichment-pack";
import { storefrontActivityPack } from "./packs/storefront-activity-pack";
import { stockCoveragePack } from "./packs/stock-coverage-pack";
import { queueAwarenessPack } from "./packs/queue-awareness-pack";
import { documentPack } from "./packs/document-pack";
import { screenPack } from "./packs/screen-pack";
import { surfacePack } from "./packs/surface-pack";
import { nonprodLeasePack } from "./packs/nonprod-lease-pack";
import { knowledgePack } from "./packs/knowledge-pack";
import { demandScoringPack } from "./packs/demand-scoring-pack";
import { workforcePack } from "./packs/workforce-pack";
import { policyPack } from "./packs/policy-pack";
import { staffingPack } from "./packs/staffing-pack";
import { versionHistoryPack } from "./packs/version-history-pack";
import { eaOntologyPack } from "./packs/ea-ontology-pack";
import { discoveryInventoryPack } from "./packs/discovery-inventory-pack";
import { estatePosturePack } from "./packs/estate-posture-pack";
import { deliberationRunPack } from "./packs/deliberation-run-pack";
import { scheduledAgentTaskPack } from "./packs/scheduled-agent-task-pack";
import { crmSalesPipelinePack } from "./packs/crm-sales-pipeline-pack";
import { platformUpdatePack } from "./packs/platform-update-pack";
import { wikiOverlayPack } from "./packs/wiki-overlay-pack";
import { licensingPack } from "./packs/licensing-pack";
import { marketingOpsPack } from "./packs/marketing-ops-pack";
import { coworkerCapabilityPack } from "./packs/coworker-capability-pack";
import { coworkerBacklogLensPack } from "./packs/coworker-backlog-lens-pack";
import { recruitingPipelinePack } from "./packs/recruiting-pipeline-pack";
import { leaveDecisionPack } from "./packs/leave-decision-pack";
import { publicWebDesignPack } from "./packs/public-web-design-pack";
import { projectFilesPack } from "./packs/project-files-pack";
import { sorReadPack } from "./packs/sor-read-pack";
import { workThreadPack } from "./packs/work-thread-pack";
import { codeIntelligencePack } from "./packs/code-intelligence-pack";
import { contributionHivePack } from "./packs/contribution-hive-pack";
import { taxonomyArchetypePack } from "./packs/taxonomy-archetype-pack";
import { modelProviderPack } from "./packs/model-provider-pack";
import { aiPlatformPosturePack } from "./packs/ai-platform-posture-pack";
import { wikiPack } from "./packs/wiki-pack";
import { discoveryPack } from "./packs/discovery-pack";
import { coworkerPack } from "./packs/coworker-pack";
import { platformUtilitiesPack } from "./packs/platform-utilities-pack";
import { backlogPack } from "./packs/backlog-pack";
import { sandboxPack } from "./packs/sandbox-pack";
import { adminPack } from "./packs/admin-pack";
import { buildEnginePack } from "./packs/build-engine-pack";
import { buildEvidencePack } from "./packs/build-evidence-pack";
import { buildOpsPack } from "./packs/build-ops-pack";
import { decompositionPack } from "./packs/decomposition-pack";
import { buildVisibilityPack } from "./packs/build-visibility-pack";
import { buildEvidenceExtraPack } from "./packs/build-evidence-extra-pack";
import { changeReviewPack } from "./packs/change-review-pack";
import { principleDecidePack } from "./packs/principle-decide-pack";
import { decisionReverifyPack } from "./packs/decision-reverify-pack";
import { productOutcomesPack } from "./packs/product-outcomes-pack";
import { initiativeReadinessPack } from "./packs/initiative-readiness-pack";

import { grokSigninPack } from "./packs/grok-signin-pack";
import { releasePack } from "./packs/release-pack";
import { buildLifecyclePack } from "./packs/build-lifecycle-pack";
import { buildReviewPack } from "./packs/build-review-pack";
import { buildChangePack } from "./packs/build-change-pack";
import { gateContextPack } from "./packs/gate-context-pack";
import { uxVerificationPack } from "./packs/ux-verification-pack";

export const TOOL_PACK_REGISTRY = composeToolPacks([
  deliberationSiemPack,
  roomMessagingPack,
  runtimeCoordinationPack,
  workCapsulesPack,
  workbooksPack,
  feedbackPack,
  orgDecisionPack,
  complianceScopePack,
  capabilityCompletenessPack,
  founderReviewPack,
  professionDecisionPack,
  uxCritiquePack,
  optimizationPack,
  marketingPack,
  bankingPack,
  workCapturePack,
  activityRoutingPack,
  selfUpgradePack,
  uxVerificationPack,
  coworkerServiceCatalogPack,
  coworkerToolGrantPack,
  coworkerEstablishPack,
  coworkerMemoryPack,
  effortContextPack,
  coworkerGoalPack,
  subagentFanoutPack,
  mdmStewardshipPack,
  crmContactsPack,
  crmEnrichmentPack,
  storefrontActivityPack,
  stockCoveragePack,
  queueAwarenessPack,
  documentPack,
  screenPack,
  surfacePack,
  nonprodLeasePack,
  knowledgePack,
  demandScoringPack,
  workforcePack,
  policyPack,
  staffingPack,
  versionHistoryPack,
  eaOntologyPack,
  discoveryInventoryPack,
  estatePosturePack,
  deliberationRunPack,
  scheduledAgentTaskPack,
  crmSalesPipelinePack,
  platformUpdatePack,
  wikiOverlayPack,
  licensingPack,
  marketingOpsPack,
  coworkerCapabilityPack,
  coworkerBacklogLensPack,
  recruitingPipelinePack,
  leaveDecisionPack,
  publicWebDesignPack,
  projectFilesPack,
  grokSigninPack,
  sorReadPack,
  workThreadPack,
  codeIntelligencePack,
  contributionHivePack,
  taxonomyArchetypePack,
  modelProviderPack,
  aiPlatformPosturePack,
  wikiPack,
  discoveryPack,
  coworkerPack,
  platformUtilitiesPack,
  backlogPack,
  sandboxPack,
  releasePack,
  buildLifecyclePack,
  buildReviewPack,
  buildChangePack,
  gateContextPack,
  adminPack,
  buildEnginePack,
  buildEvidencePack,
  buildOpsPack,
  decompositionPack,
  buildVisibilityPack,
  buildEvidenceExtraPack,
  changeReviewPack,
  principleDecidePack,
  decisionReverifyPack,
  productOutcomesPack,
  initiativeReadinessPack,
  surfaceReadinessPack,
]);
