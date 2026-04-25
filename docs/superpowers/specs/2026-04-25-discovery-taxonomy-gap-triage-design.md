# Discovery Taxonomy Gap Triage Design

| Field | Value |
|-------|-------|
| Status | Draft |
| Date | 2026-04-25 |
| Author | OpenAI Codex with Mark Bodman |
| Scope | Daily AI coworker process for closing discovered-infrastructure taxonomy and identity gaps |
| Related specs | `2026-03-14-discovery-taxonomy-attribution-design.md`, `2026-04-02-infrastructure-auto-discovery-design.md`, `2026-04-14-taxonomy-to-action-v4-v5-design.md` |
| Separate sibling thread | Discovery fingerprint contribution pipeline and hive-mind catalog governance |

## 1. Problem Statement

DPF can already discover infrastructure, persist `InventoryEntity` records, score taxonomy candidates, surface `needs_review` records, and allow manual attribution from the inventory exception queue. The missing operating process is what happens after discovery repeatedly finds infrastructure that cannot be confidently identified or placed.

Today, a gap can remain a one-off review item. That is not enough for a platform that should learn from discovery. If a device, service, or software signature is discovered but not placed into the taxonomy, the platform needs a daily activity that determines why:

- the taxonomy already has a home, but the recognition rule is missing
- the device or software identity is not understood well enough
- the evidence is ambiguous or incomplete
- the taxonomy itself has a structural gap
- the item should not become a product or managed infrastructure record

The desired model is largely automated. AI coworkers should perform the daily triage, apply high-confidence decisions automatically, escalate low-confidence or ambiguous cases to humans, and leave an auditable trail of what happened. Accepted decisions should become durable patterns so future discoveries are classified by deterministic rules rather than repeatedly relying on ad hoc reasoning.

## 2. Current-State Evidence

Live backlog state was queried on 2026-04-25 from the running Postgres container. Open epics were:

- `EP-CTRL-5E21A4` - Automated Control Utility: Desktop QA and Remote Assist Foundation
- `EP-SITE-7C4D2B` - Customer Site Records & Location Validation
- `EP-LAB-6A91C2` - Integration Lab Sandbox & Private Connectivity Foundation
- `EP-INT-2E7C1A` - Integration Harness: Benchmarking and Private Deployment Foundation

No open epic directly covers daily taxonomy gap triage or discovery fingerprint operationalization. This should become a separate epic because it is a cross-cutting discovery governance capability, not a site-location, integration-harness, or desktop-control feature.

Live inventory state from the same check showed:

- `210` `InventoryEntity` records with `attributionStatus = "attributed"`
- `1` `InventoryEntity` record with `attributionStatus = "needs_review"`
- the unresolved record was `service:prom:windows-host:windows-host`, with weak candidate confidence for `foundational/compute/servers`

Repo evidence:

- `packages/db/src/discovery-attribution.ts` already supports deterministic and heuristic attribution.
- `packages/db/src/discovery-sync.ts` persists attribution status, confidence, evidence, candidate taxonomy, and quality issues.
- `apps/web/components/inventory/InventoryExceptionQueue.tsx` already provides a basic human review surface.
- `apps/web/lib/actions/inventory.ts` already supports accept, reassign, dismiss, and quality issue resolution.
- `packages/db/prisma/schema.prisma` includes `ScheduledAgentTask`, which can host the daily coworker activity.

## 3. Research & Benchmarking

### 3.1 ServiceNow Discovery Patterns

ServiceNow Discovery uses patterns for horizontal and top-down discovery. Patterns are assigned to CI types and may discover a main CI type plus related CI types. ServiceNow ships updated discovery patterns through the ServiceNow Store, and organizations can create custom patterns for proprietary devices or applications.

Adopted pattern:

- separate vendor/platform-provided recognition content from local customizations
- attach patterns to CI/device classes rather than treating them as generic text matches
- test patterns before running them in scheduled discovery

Rejected pattern:

- DPF should not require a full proprietary pattern designer before it can learn simple fingerprints.

Reference: https://www.servicenow.com/docs/r/xanadu/it-operations-management/discovery-and-service-mapping-patterns/c_MappingPatternsCustomization.html

### 3.2 BMC Discovery TKU / TPL

BMC Discovery uses Technology Knowledge Updates (TKUs) and Extended Data Packs to improve discovery coverage over time. Customers can also write custom TPL patterns to identify uncommon software, SNMP devices, and additional attributes.

Adopted pattern:

- ship recognition knowledge as versioned content
- support custom local patterns while preserving upgradeable shared content
- include examples and techniques for versioning and identity extraction

Rejected pattern:

- DPF should not create a heavyweight pattern language before the first useful loop exists.

Reference: https://docs.bmc.com/xwiki/bin/view/IT-Operations-Management/Discovery/BMC-Discovery/Configipedia/Getting-started/

### 3.3 Lansweeper / Fing Device Recognition

Lansweeper's device-recognition approach uses an expanding knowledge base across protocol evidence such as Bonjour/mDNS, UPnP, SNMP, DHCP, and NetBIOS. The important lesson is that device identity is not usually proven by one field. It is inferred from a bundle of protocol observations.

Adopted pattern:

- represent fingerprints as multi-signal evidence bundles
- score device identity separately from category/taxonomy placement
- preserve raw protocol evidence for later re-evaluation

Rejected pattern:

- DPF should not send customer-sensitive fingerprints to any shared catalog without explicit redaction and contribution policy.

Reference: https://developer.lansweeper.com/docs/device-recognition-api/get-started/welcome/

### 3.4 Nmap Fingerprint Submission

Nmap service/version detection sends probes, matches responses against a signature database, and emits unknown service fingerprints with a contribution path when it cannot identify a service.

Adopted pattern:

- when recognition fails, emit a structured fingerprint instead of only saying "unknown"
- separate probe response evidence from the final product/version classification
- use contributed fingerprints to improve future deterministic recognition

Rejected pattern:

- DPF should not allow raw, unredacted internal network evidence to be contributed automatically.

Reference: https://nmap.org/book/vscan.html

## 4. Goals

1. Run a daily AI coworker triage activity for discovery identity and taxonomy gaps.
2. Score device/software identity confidence separately from taxonomy placement confidence.
3. Automatically apply decisions only when evidence is strong, reproducible, and policy-allowed.
4. Escalate low-confidence, ambiguous, missing-evidence, or taxonomy-changing cases to humans.
5. Create an auditable decision/activity log for every automated and human decision.
6. Convert accepted decisions into durable deterministic recognition patterns.
7. Feed approved reusable fingerprints into a repo-owned hive-mind contribution process.
8. Keep discovered entities visible even when attribution remains unresolved.

## 5. Non-Goals

- Implement the fingerprint contribution catalog in this spec. That belongs to the parallel sibling thread.
- Replace the existing discovery attribution pipeline.
- Make AI coworkers invent taxonomy structure without evidence and approval.
- Automatically publish customer or internal fingerprints outside the install.
- Treat every discovered technical component as a `DigitalProduct`.
- Build a ServiceNow/BMC-style full pattern designer in the first implementation slice.

## 6. Core Design Decision

Use a confidence-gated fingerprint lifecycle.

Every discovered gap should be evaluated as two related but independent questions:

1. **Identity:** What is this infrastructure, device, service, software, or package?
2. **Taxonomy:** Where does it belong in the DPF taxonomy, and what should the platform do with it?

The daily coworker may act automatically only when both questions clear policy thresholds and the evidence packet is strong enough to replay. Otherwise it must create or update a human review item.

## 7. Operating Model

### 7.1 Daily Scheduled Activity

A `ScheduledAgentTask` should run daily under the appropriate infrastructure/portfolio governance coworker. The task should:

1. Find unresolved and weakly resolved inventory:
   - `attributionStatus = "needs_review"`
   - attribution confidence below the automatic threshold
   - repeated unknown signatures across discovery runs
   - quality issues related to attribution, stale identity, or missing taxonomy placement
2. Build an evidence packet for each candidate.
3. Compute identity confidence and taxonomy confidence.
4. Choose one of five outcomes:
   - auto-accept existing taxonomy candidate
   - auto-create deterministic recognition rule for an existing taxonomy node
   - propose taxonomy extension for human review
   - request more discovery evidence
   - dismiss or suppress as non-actionable noise
5. Persist a decision log entry.
6. Update inventory, quality issues, and backlog/review surfaces as needed.

### 7.2 Evidence Packet

The evidence packet should be stored as structured JSON and should include:

- inventory entity ID, key, type, name, source, first seen, last seen
- discovery run IDs and collector names
- raw observed attributes
- normalized descriptor used for scoring
- candidate taxonomy nodes and scores
- identity candidate list and scores
- matched deterministic rules, if any
- protocol evidence where available:
  - ports
  - banners
  - Prometheus labels
  - container image/name
  - process name
  - package/software evidence
  - SNMP system fields
  - MAC/OUI vendor
  - DHCP host/vendor hints
  - mDNS/Bonjour service names
  - UPnP descriptors
  - NetBIOS names
- evidence freshness and reproducibility
- redaction status

The packet must preserve enough raw evidence for later re-scoring without requiring a new discovery run.

### 7.3 Confidence Scores

The triage process should compute:

- `identityConfidence`: confidence that the entity identity is known
- `taxonomyConfidence`: confidence that the selected taxonomy node is correct
- `evidenceCompleteness`: whether enough evidence types are present for the entity class
- `reproducibilityScore`: whether the same signature has appeared consistently across runs
- `policyRisk`: whether automatic action is safe

Suggested initial thresholds:

| Outcome | Identity | Taxonomy | Evidence | Action |
|---------|----------|----------|----------|--------|
| Auto-apply rule match | >= 0.95 | >= 0.95 | complete/reproducible | Apply and log |
| Auto-apply coworker proposal | >= 0.90 | >= 0.90 | complete/reproducible | Apply, create pending reusable pattern |
| Human review | 0.60-0.89 | any | partial or ambiguous | Create review item |
| More evidence needed | < 0.60 | any | incomplete | Request targeted discovery |
| Taxonomy gap review | >= 0.85 | no suitable node | complete | Propose taxonomy extension |

The initial thresholds should be configuration-backed, not hard-coded in UI components.

### 7.4 Automatic Decision Rules

The coworker may auto-apply a decision only when all are true:

- identity and taxonomy scores clear the configured threshold
- at least two independent evidence signals support the decision, unless a deterministic rule explicitly allows one strong signal
- no conflicting candidate is within the ambiguity margin
- the selected taxonomy node already exists
- the action does not introduce a new external contribution
- the fingerprint has passed redaction checks
- the affected entity is not marked customer-sensitive or proprietary-only

Automatic actions must still create activity logs. Automation changes who performs the work, not whether it is accountable.

### 7.5 Human Escalation Rules

The coworker must route to humans when:

- identity confidence is low
- taxonomy confidence is low
- two or more candidates are close
- the evidence packet is missing required signals
- the best answer appears to require a new taxonomy node
- the proposed fingerprint may expose sensitive customer or network data
- the same unresolved signature has failed automated triage repeatedly
- the decision would affect many entities at once

Human review should show the evidence packet, AI recommendation, candidate differences, and the proposed future deterministic rule.

## 8. Taxonomy Gap Handling

When the identity is clear but no taxonomy node fits, the process should classify the issue as a taxonomy gap rather than an attribution failure.

Taxonomy gap outcomes:

1. **Existing node with enrichment gap**
   - Add discovery hints, aliases, or examples to an existing node.
2. **Existing branch with missing child**
   - Propose a child node with action semantics and product-boundary guidance.
3. **Portfolio-boundary ambiguity**
   - Escalate to taxonomy governance review.
4. **Not a taxonomy object**
   - Dismiss or model as evidence/dependency rather than a taxonomy node.

The coworker must not silently add taxonomy nodes. It may prepare the proposal, evidence, and backlog item.

## 9. Pattern Operationalization

Accepted decisions should become durable patterns through a rule synthesis step:

1. Capture the accepted evidence packet.
2. Reduce it to a stable fingerprint:
   - required signals
   - optional signals
   - excluded/negative signals
   - taxonomy target
   - identity target
   - confidence floor
3. Add or update the deterministic recognition catalog.
4. Add regression tests using sanitized evidence fixtures.
5. Re-run attribution against affected unresolved entities.
6. Record the decision and pattern version.

This is the bridge from AI-assisted triage to perpetual process. AI can discover the rule, but future discovery should prefer deterministic matching.

## 10. Audit And Activity Log

Every triage attempt and decision should be logged. The log should support answering:

- what entity was evaluated
- what evidence was used
- which coworker or human made the decision
- what candidates were considered
- what confidence scores were assigned
- what changed in inventory, taxonomy, backlog, or rule catalogs
- whether the decision created a reusable pattern
- whether the decision was automatic or human-approved
- whether the fingerprint was contributed to the hive-mind catalog

Recommended new model:

```prisma
model DiscoveryTriageDecision {
  id                    String   @id @default(cuid())
  decisionId            String   @unique
  inventoryEntityId     String?
  qualityIssueId        String?
  actorType             String   // agent | human | system
  actorId               String?
  outcome               String   // auto_attributed | human_review | needs_more_evidence | taxonomy_gap | dismissed
  identityConfidence    Float?
  taxonomyConfidence    Float?
  evidenceCompleteness  Float?
  reproducibilityScore  Float?
  selectedTaxonomyNodeId String?
  selectedIdentity      Json?
  evidencePacket        Json
  proposedRule          Json?
  appliedRuleId         String?
  requiresHumanReview   Boolean  @default(false)
  humanReviewedAt       DateTime?
  createdAt             DateTime @default(now())
}
```

This model can coexist with `ToolExecution`, `PortfolioQualityIssue`, and `AdminActivity`. `ToolExecution` records the tool call. `DiscoveryTriageDecision` records the domain decision.

## 11. UI / UX Requirements

The existing inventory exception queue should evolve into a triage workbench:

- grouped cards by outcome: auto-applied, needs human review, needs more evidence, taxonomy gap
- compact evidence summary with expandable raw evidence
- confidence indicators for identity and taxonomy separately
- suggested action with why/why not automatic
- accept, reassign, request evidence, propose taxonomy update, dismiss
- decision history for the entity
- preview of the deterministic rule that would be created

Design rules:

- use the Business/Operations shell patterns already present in the repo
- keep the queue dense and operational, not a marketing page
- use theme-aware CSS variables from `docs/platform-usability-standards.md`
- avoid hardcoded colors except permitted contrast cases

## 12. AI Coworker Responsibilities

The daily triage coworker should:

- review unresolved inventory and attribution quality issues
- build evidence packets
- compare against existing rules and prior decisions
- propose or apply classification decisions based on thresholds
- create review tasks when confidence is insufficient
- recommend targeted evidence collection when needed
- synthesize candidate deterministic rules after accepted decisions
- produce a daily summary of:
  - auto-resolved gaps
  - human review queue size
  - taxonomy gaps proposed
  - new reusable fingerprints proposed
  - repeated unresolved evidence gaps

The coworker should not:

- invent taxonomy nodes without review
- contribute raw fingerprints externally
- override human decisions without a new evidence basis
- collapse device identity and taxonomy placement into one score

## 13. Integration Points

Implementation should extend:

- `packages/db/src/discovery-attribution.ts`
  - add confidence-gated result types and deterministic fingerprint rule matching
- `packages/db/src/discovery-sync.ts`
  - persist triage-relevant evidence and preserve candidate history
- `apps/web/lib/actions/inventory.ts`
  - add review outcomes beyond accept/dismiss
- `apps/web/lib/consume/discovery-data.ts`
  - expose triage decision history and grouped review queues
- `apps/web/components/inventory/InventoryExceptionQueue.tsx`
  - evolve to triage workbench
- `packages/db/prisma/schema.prisma`
  - add `DiscoveryTriageDecision` and likely a rule/catalog model once the fingerprint thread finalizes the shape
- `packages/db/data/agent_registry.json`
  - ensure the responsible coworker has grants for discovery triage, backlog proposal, and inventory attribution

## 14. Backlog Recommendation

Create a new epic:

**Discovery Taxonomy Gap Triage & Pattern Operationalization**

Suggested backlog items:

1. Define discovery triage decision log schema and migration.
2. Implement daily scheduled coworker triage over unresolved `InventoryEntity` records.
3. Add confidence scoring for identity, taxonomy placement, evidence completeness, and reproducibility.
4. Extend inventory review UX into a triage workbench with evidence packets and decision history.
5. Add automatic application path for high-confidence existing taxonomy matches.
6. Add human escalation path for ambiguous, low-confidence, and taxonomy-gap cases.
7. Add deterministic rule synthesis for accepted decisions using sanitized fixtures.
8. Connect approved reusable fingerprints to the sibling hive-mind contribution pipeline.

## 15. Testing Strategy

### Unit Tests

- confidence threshold routing
- ambiguity margin handling
- evidence completeness scoring
- deterministic rule synthesis from accepted evidence
- audit log payload creation
- human escalation classification

### Integration Tests

- `needs_review` inventory entity enters daily triage
- high-confidence existing taxonomy match auto-applies and logs decision
- low-confidence match creates human review decision
- no suitable taxonomy node creates taxonomy gap proposal
- accepted human decision becomes deterministic rule candidate
- repeated unresolved signature escalates priority

### UX Verification

Run the inventory triage surface against the real app:

- verify grouped queues render correctly
- verify confidence scores do not imply certainty when evidence is weak
- verify accept/reassign/request-evidence/dismiss flows update the decision history
- verify theme-aware styling in light and dark/brand modes

### Production Verification

Before this feature is considered done:

- run affected unit tests
- run `pnpm --filter web typecheck`
- run `cd apps/web && npx next build`
- run affected browser QA against the production-served app

## 16. Open Questions

1. Which coworker should own daily triage: Monitoring, Enterprise Architecture, AI Workforce Governance, or a new Discovery Steward?
2. Should high-confidence taxonomy enrichment changes require human approval even when identity and placement are strong?
3. What is the first approved privacy/redaction policy for fingerprints before hive-mind contribution?
4. Should customer-managed estate discoveries use the same triage queue as platform infrastructure, or a tenant-scoped queue?
5. Which fields should count as sensitive by default in protocol evidence?

## 17. Smallest Implementation Slice

The first slice should avoid building the full contribution pipeline. It should:

1. Add `DiscoveryTriageDecision`.
2. Add a daily scheduled coworker task that reads current `needs_review` entities.
3. Compute identity/taxonomy confidence using existing candidate taxonomy and evidence.
4. Persist a decision log entry.
5. Auto-apply only existing taxonomy-node matches over the configured threshold.
6. Route all other cases to the inventory review surface with a structured evidence packet.

That creates the perpetual operating loop. The sibling fingerprint-contribution thread can then plug approved reusable patterns into the same decision log and rule synthesis path.
