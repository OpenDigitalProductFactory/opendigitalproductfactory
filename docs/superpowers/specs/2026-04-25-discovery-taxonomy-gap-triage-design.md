# Discovery Taxonomy Gap Triage Design

| Field | Value |
| --- | --- |
| Status | Draft |
| Date | 2026-04-25 |
| Author | OpenAI Codex with Mark Bodman |
| Scope | Daily AI coworker process for closing discovered-infrastructure taxonomy and identity gaps |
| Related specs | `2026-03-14-discovery-taxonomy-attribution-design.md`, `2026-04-02-infrastructure-auto-discovery-design.md`, `2026-04-14-taxonomy-to-action-v4-v5-design.md`, `2026-03-26-hive-mind-contribution-assessment-design.md` |
| Separate sibling thread | Discovery fingerprint contribution pipeline and hive-mind catalog governance — see §13.1 for boundary with the existing hive-mind contribution-assessment spec |

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

Reference: [ServiceNow Mapping Patterns Customization](https://www.servicenow.com/docs/r/xanadu/it-operations-management/discovery-and-service-mapping-patterns/c_MappingPatternsCustomization.html)

### 3.2 BMC Discovery TKU / TPL

BMC Discovery uses Technology Knowledge Updates (TKUs) and Extended Data Packs to improve discovery coverage over time. Customers can also write custom TPL patterns to identify uncommon software, SNMP devices, and additional attributes.

Adopted pattern:

- ship recognition knowledge as versioned content
- support custom local patterns while preserving upgradeable shared content
- include examples and techniques for versioning and identity extraction

Rejected pattern:

- DPF should not create a heavyweight pattern language before the first useful loop exists.

Reference: [BMC Discovery Configipedia — Getting Started](https://docs.bmc.com/xwiki/bin/view/IT-Operations-Management/Discovery/BMC-Discovery/Configipedia/Getting-started/)

### 3.3 Lansweeper / Fing Device Recognition

Lansweeper's device-recognition approach uses an expanding knowledge base across protocol evidence such as Bonjour/mDNS, UPnP, SNMP, DHCP, and NetBIOS. The important lesson is that device identity is not usually proven by one field. It is inferred from a bundle of protocol observations.

Adopted pattern:

- represent fingerprints as multi-signal evidence bundles
- score device identity separately from category/taxonomy placement
- preserve raw protocol evidence for later re-evaluation

Rejected pattern:

- DPF should not send customer-sensitive fingerprints to any shared catalog without explicit redaction and contribution policy.

Reference: [Lansweeper Device Recognition API](https://developer.lansweeper.com/docs/device-recognition-api/get-started/welcome/)

### 3.4 Nmap Fingerprint Submission

Nmap service/version detection sends probes, matches responses against a signature database, and emits unknown service fingerprints with a contribution path when it cannot identify a service.

Adopted pattern:

- when recognition fails, emit a structured fingerprint instead of only saying "unknown"
- separate probe response evidence from the final product/version classification
- use contributed fingerprints to improve future deterministic recognition

Rejected pattern:

- DPF should not allow raw, unredacted internal network evidence to be contributed automatically.

Reference: [Nmap Service and Application Version Detection](https://nmap.org/book/vscan.html)

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

### 7.1 Scheduled Triage Activity

A `ScheduledAgentTask` row drives the triage loop. The activity fires on a cadence-or-volume trigger:

- **Cadence:** daily at 08:00 in the install timezone (cron `0 8 * * *`). Discovery cadence is bursty; daily-only would let a bad-collector morning flood the queue for 24 h before the next sweep.
- **Volume override:** an `inventory.needsReview.threshold` event handler additionally fires the same task when the count of `attributionStatus = "needs_review"` entities crosses a configurable floor (initial default `25`). The two triggers share idempotency on `(date, agentId)` so a same-day cadence run after a volume-fire is a no-op.

`ScheduledAgentTask` row fields ([packages/db/prisma/schema.prisma:3632](packages/db/prisma/schema.prisma#L3632) is the source of truth — every field below is required):

| Field | Initial value | Notes |
| --- | --- | --- |
| `taskId` | `discovery-taxonomy-gap-triage-daily` | Stable slug for idempotent seeding |
| `agentId` | `inventory-specialist` | Resolved owner: the existing Digital Product Estate Specialist already owns `/platform/tools/discovery` route context |
| `title` | `Discovery taxonomy gap triage` | |
| `prompt` | Seeded operational prompt that tells the estate specialist to invoke `run_discovery_triage` and summarize the result | The `.prompt.md` template remains in the prompt catalog for revision history, but `ScheduledAgentTask.prompt` stores the direct operational instruction string |
| `routeContext` | `/platform/tools/discovery` | Canonical discovery operations route so scheduled execution resolves the same coworker and route context humans see |
| `schedule` | `0 8 * * *` | Cron, not a "daily" flag |
| `timezone` | Install timezone (defaults to `UTC`) | |
| `ownerUserId` | First user with `isSuperuser = true` | Resolved at seed time, not hard-coded |

### 7.1.1 Owner-gated seed and registry decision

The remaining seed/registry blocker is not one question, but two tightly related ones:

1. **Which coworker identity owns the task?**
   - This determines `ScheduledAgentTask.agentId`.
   - It also determines which prompt greeting/role language is correct.
   - It also determines whether `packages/db/data/agent_registry.json` needs a **new coworker entry** or only **grant changes to an existing coworker**.

2. **Which install user owns the scheduled row?**
   - This determines `ScheduledAgentTask.ownerUserId`.
   - This is an install-local runtime concern, not a product design concern.
   - In the current schema the relevant durable field is `User.isSuperuser`, not a `role = "superuser"` string on `User`.

The first question is the actual approval gate. The second is an implementation detail that must follow the approved owner pattern.

**Decision options for `agentId`:**

| Option | What changes | Benefits | Tradeoffs |
| --- | --- | --- | --- |
| New `discovery-steward` coworker | Add new registry entry, new grants, dedicated identity/prompt | Clean ownership boundary, durable specialist for future fingerprint work | More registry/governance surface now |
| Existing `enterprise-architecture` coworker | Reuse existing coworker, add triage grants only if missing | Lowest operational churn, no new coworker to explain | Blends day-to-day discovery ops into a broader architecture role |
| Another existing coworker | Reuse another current identity with added grants | Could align with a future discovery/platform-ops owner | Risks muddling responsibility unless explicitly named in backlog/spec |

**What is allowed before this decision is approved:**

- runner implementation
- MCP tool bridge
- prompt file creation
- UI/workbench work
- metrics and audit logging
- scheduler execution support

**What stays blocked until the decision is approved:**

- seeding a `ScheduledAgentTask` bootstrap row
- adding a new coworker entry to `agent_registry.json`
- modifying an existing coworker's grants specifically for this task
- baking a final owner identity into seed/runtime defaults

**Resolution recorded 2026-04-25:**

- The approved owner is the existing `inventory-specialist` coworker.
- No new coworker entry is needed for this slice.
- The seed/bootstrap row may be created now because the owner decision is no longer provisional.
- The prompt template remains discovery-specific, but its identity language should align to the Digital Product Estate Specialist.

The task should:

1. Find unresolved and weakly resolved inventory:
   - `attributionStatus = "needs_review"`
   - `attributionConfidence` below the configured `auto-apply` threshold
   - **repeated unknown signatures** — defined as `attributionStatus IN ("needs_review", "unmapped") AND lastConfirmedRunId IS NOT NULL AND (lastSeenAt - firstSeenAt) >= INTERVAL '3 days' AND COUNT(DISTINCT lastConfirmedRunId across DiscoveredItem) >= 3`. Slice 1 derives this from existing fields; if the cost is non-trivial under load, slice 2 adds an `unresolvedRunCount: Int` denormalization on `InventoryEntity` plus a backfill migration.
   - open `PortfolioQualityIssue` records with `issueType IN ("attribution", "stale-identity", "missing-taxonomy")`
2. Build an evidence packet for each candidate (§7.2).
3. Compute identity confidence and taxonomy confidence (§7.3).
4. Choose one canonical outcome from §10's `TRIAGE_OUTCOMES` enum. The mapping from §7.1 reasoning to enum value:
   - existing-taxonomy match clears auto-apply thresholds → `auto-attributed`
   - taxonomy match clears thresholds AND a stable fingerprint can be synthesized → `auto-attributed` plus a `proposedRule` payload (rule synthesis is bookkeeping, not a separate outcome)
   - identity clear but no suitable taxonomy node → `taxonomy-gap`
   - either confidence falls in the human-review band → `human-review`
   - evidence is incomplete or non-reproducible → `needs-more-evidence`
   - signal is repeatedly noise (e.g., transient probe artifact) → `dismissed`
5. Persist a `DiscoveryTriageDecision` log entry.
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
- redaction status — slice 1 sets every packet to `redactionStatus: "unverified"` and the auto-decision rules in §7.4 block any path that would contribute or publish externally. Defining the redaction policy itself is owned by the sibling fingerprint-contribution thread (§13.1, §16 Q3).

The packet must preserve enough raw evidence for later re-scoring without requiring a new discovery run.

### 7.3 Confidence Scores

The triage process computes four scores per candidate:

- `identityConfidence`: confidence that the entity identity is known
- `taxonomyConfidence`: confidence that the selected taxonomy node is correct
- `evidenceCompleteness`: whether enough evidence types are present for the entity class
- `reproducibilityScore`: whether the same signature has appeared consistently across runs

A fifth signal, `policyRisk`, is evaluated as a boolean gate in §7.4 rather than a numeric threshold here.

**Existing `InventoryEntity` confidence fields.** `InventoryEntity` already carries two floats: `confidence` (set by some collectors at discovery time, semantics inherited from the auto-discovery spec) and `attributionConfidence` (set during attribution). This spec writes only to `attributionConfidence`. `confidence` is left as-is for now; the question of whether to fold it into `identityConfidence` or deprecate it is tracked as a follow-up in §16 Q6.

**Threshold table (closed bands — both Identity AND Taxonomy must clear the row, otherwise the next-most-permissive row applies).**

| Outcome | Identity | Taxonomy | Evidence | Decision enum |
| --- | --- | --- | --- | --- |
| Auto-apply, deterministic rule match | >= 0.95 | >= 0.95 | complete and reproducible | `auto-attributed` |
| Auto-apply, coworker proposal | >= 0.90 | >= 0.90 | complete and reproducible | `auto-attributed` (with `proposedRule`) |
| Taxonomy gap (identity clear, no node fits) | >= 0.85 | no suitable node | complete | `taxonomy-gap` |
| Human review | >= 0.60 AND < 0.90 | any | partial or ambiguous | `human-review` |
| More evidence needed | < 0.60 | any | incomplete | `needs-more-evidence` |

**Resolution rule.** Rows are evaluated top-to-bottom; the first row whose Identity and Taxonomy bands both match wins. This closes the prior gap where an entity at Identity 0.85 + Taxonomy 0.95 fell through.

The initial thresholds are configuration-backed (`platform_settings.discovery_triage.thresholds`), not hard-coded in UI components.

### 7.4 Automatic Decision Rules

The coworker may auto-apply a decision only when all are true:

- identity and taxonomy scores clear the configured threshold
- at least two independent evidence signals support the decision, unless a deterministic rule explicitly allows one strong signal
- no conflicting candidate is within the **ambiguity margin** — defined as `score(leader) - score(runner-up) >= 0.05` on the same axis (identity or taxonomy). Candidates inside the margin force `human-review`.
- the selected taxonomy node already exists
- the action does not introduce a new external contribution (slice 1 always satisfies this — see §7.2 redaction default)
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
4. Add regression tests using sanitized evidence fixtures under `packages/db/src/__fixtures__/discovery-triage/`.
5. Re-run attribution against affected unresolved entities.
6. Record the decision and pattern version.

This is the bridge from AI-assisted triage to perpetual process. AI can discover the rule, but future discovery should prefer deterministic matching.

## 10. Audit and activity log

Every triage attempt and decision is logged. The log answers:

- what entity was evaluated
- what evidence was used
- which coworker or human made the decision
- what candidates were considered
- what confidence scores were assigned
- what changed in inventory, taxonomy, backlog, or rule catalogs
- whether the decision created a reusable pattern
- whether the decision was automatic or human-approved
- whether the fingerprint was contributed to the hive-mind catalog

### 10.1 Canonical string enums (mandatory compliance)

Per CLAUDE.md ("Strongly-Typed String Enums — MANDATORY COMPLIANCE"), the new enum-valued fields below are canonical even though the DB column is `String`. Hyphens, not underscores. Source-of-truth file: `apps/web/lib/discovery-triage.ts` exporting `as const` arrays plus the matching TypeScript union types. Any MCP tool that exposes these fields must mirror the same `enum:` arrays in `apps/web/lib/mcp-tools.ts`.

| Field | Canonical values |
| --- | --- |
| `DiscoveryTriageDecision.actorType` | `"agent"` `"human"` `"system"` |
| `DiscoveryTriageDecision.outcome` | `"auto-attributed"` `"human-review"` `"needs-more-evidence"` `"taxonomy-gap"` `"dismissed"` |
| `PortfolioQualityIssue.issueType` (new values added by this spec) | `"attribution"` `"stale-identity"` `"missing-taxonomy"` |

Legacy enum values (`InventoryEntity.attributionStatus = "needs_review" \| "unmapped" \| ...`) predate the hyphen rule and are intentionally untouched in this spec — see §16 Q7.

**Existing-code fix included in the same change set.** [packages/db/src/discovery-attribution.ts:57](packages/db/src/discovery-attribution.ts#L57) currently uses `attributionMethod: "ai_proposed"` — underscored. The migration in slice 1 also renames this to `"ai-proposed"` (forward-only data update; same commit) so the codebase converges on the hyphen rule.

### 10.2 Recommended new model

```prisma
model DiscoveryTriageDecision {
  id                    String   @id @default(cuid())
  decisionId            String   @unique
  inventoryEntityId     String?
  qualityIssueId        String?
  actorType             String   // see §10.1 — "agent" | "human" | "system"
  actorId               String?
  outcome               String   // see §10.1 canonical values
  identityConfidence    Float?
  taxonomyConfidence    Float?
  evidenceCompleteness  Float?
  reproducibilityScore  Float?
  selectedTaxonomyNodeId String?
  selectedIdentity      Json?
  evidencePacket        Json
  proposedRule          Json?    // slice 1 stores synthesized rules here only — see §13.2
  appliedRuleId         String?  // null until the deterministic-rule catalog ships in a later slice
  requiresHumanReview   Boolean  @default(false)
  humanReviewedAt       DateTime?
  createdAt             DateTime @default(now())

  @@index([outcome])
  @@index([inventoryEntityId])
  @@index([requiresHumanReview, createdAt])
}
```

This model coexists with `ToolExecution`, `PortfolioQualityIssue`, and `AdminActivity`. `ToolExecution` records the tool call. `DiscoveryTriageDecision` records the domain decision.

### 10.3 Operational metrics

Per-decision logs are not enough on their own — the recursive-self-improvement loop only works if Mark and the responsible coworker can see whether triage is actually learning. The following aggregates are computed daily from `DiscoveryTriageDecision` and surfaced on the inventory triage workbench:

- **Auto-rate** — share of last 7 days' decisions with `outcome = "auto-attributed"`. Target ≥ 60% once the rule catalog is populated; ≤ 30% at slice 1 launch is expected.
- **Escalation queue depth** — open decisions with `requiresHumanReview = true`. Alerts when depth exceeds the volume-trigger floor (default 25, §7.1).
- **Time-to-rule-synthesis** — median hours between an `auto-attributed` decision being recorded and an entry appearing in the deterministic-rule catalog (or in `proposedRule` during slice 1).
- **Pattern reuse rate** — share of new discoveries in the last 7 days that matched an existing rule (`appliedRuleId IS NOT NULL`) rather than being scored from scratch.
- **Repeat-unresolved count** — entities matching the §7.1 "repeated unknown signature" predicate. Rising = the loop is failing to learn.
- **Taxonomy-gap proposals** — count of `outcome = "taxonomy-gap"` per week, broken down by parent portfolio.

Slice 1 emits these as a daily structured summary in the `ScheduledAgentTask.lastError` / `lastStatus` channel and as a JSON payload attached to the daily summary thread; the dashboard tile is a follow-on task.

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

### 13.1 Boundary with the existing hive-mind contribution-assessment spec

[`2026-03-26-hive-mind-contribution-assessment-design.md`](2026-03-26-hive-mind-contribution-assessment-design.md) already defines a contribution-assessment pipeline for shipped Build Studio features (FeaturePack, `ImprovementProposal.contributionStatus`, DCO attestation). That pipeline assesses **features**; this spec produces **fingerprints / deterministic recognition rules**. To prevent two contribution surfaces from drifting:

- **Reuse, do not duplicate, the contribution-assessment pipeline.** When the sibling fingerprint-contribution thread lands, an approved fingerprint is packaged as a `FeaturePack` of category `discovery-rule` (or equivalent) and flows through the existing contribution machinery — same DCO attestation, same `ImprovementProposal` lifecycle, same proprietary-sensitivity check.
- **What this spec owns:** the per-install triage loop, the `DiscoveryTriageDecision` log, and the `proposedRule` payload. It does not define the contribution model, the FeaturePack manifest extensions, or the assessment criteria for a discovery rule.
- **What the sibling thread owns:** the deterministic-rule catalog model (see §13.2), the redaction policy (§7.2, §16 Q3), the contribution UX, and the FeaturePack-shape extension for rules.

### 13.2 Files to extend

- `packages/db/src/discovery-attribution.ts`
  - add confidence-gated result types and deterministic fingerprint rule matching
  - rename `attributionMethod: "ai_proposed"` → `"ai-proposed"` per §10.1
- `packages/db/src/discovery-sync.ts`
  - persist triage-relevant evidence and preserve candidate history
- `apps/web/lib/actions/inventory.ts`
  - add review outcomes beyond accept/dismiss
- `apps/web/lib/discovery-triage.ts` *(new)*
  - export `TRIAGE_OUTCOMES`, `TRIAGE_ACTOR_TYPES`, `TRIAGE_QUALITY_ISSUE_TYPES` `as const` arrays plus union types — source of truth per §10.1
- `apps/web/lib/consume/discovery-data.ts`
  - expose triage decision history and grouped review queues
- `apps/web/components/inventory/InventoryExceptionQueue.tsx`
  - evolve to triage workbench
- `packages/db/prisma/schema.prisma`
  - add `DiscoveryTriageDecision`
  - **Rule-catalog dependency.** The deterministic-rule catalog model is owned by the sibling fingerprint-contribution thread. Until that ships, slice 1 stores synthesized rules only as the `proposedRule: Json` field on `DiscoveryTriageDecision`. `appliedRuleId` is reserved as a forward-compatible nullable string. Backlog items 7 and 8 in §14 are explicitly blocked on the sibling spec.
- `packages/db/data/agent_registry.json`
  - ensure the responsible coworker has grants for discovery triage, backlog proposal, and inventory attribution
- `prompts/specialist/discovery-taxonomy-gap-triage.prompt.md` *(new)*
  - the daily-task prompt seeded into `PromptTemplate`, per the project rule that prompts live in DB seeded from `.prompt.md` files

## 14. Backlog Recommendation

Create a new epic: **Discovery Taxonomy Gap Triage and Pattern Operationalization**.

Suggested backlog items with acceptance criteria. Detailed task decomposition is owned by writing-plans; the acceptance criteria here are the spec-level "done when" gates.

1. **Discovery triage decision log schema and migration**
   - Done when: `DiscoveryTriageDecision` model lands per §10.2, migration applies on a fresh install, and the `ai_proposed` → `ai-proposed` rename in §13.2 is included in the same commit.
2. **Scheduled coworker triage task seeded**
   - Done when: a `ScheduledAgentTask` row matching the §7.1 field table exists after seed, the cron triggers fire in the install timezone, and the volume-override event handler is wired.
3. **Confidence scoring for identity, taxonomy, evidence completeness, reproducibility**
   - Done when: the four scores are computed for every triage candidate, persisted on `DiscoveryTriageDecision`, and unit-tested per §15.
4. **Inventory triage workbench**
   - Done when: `InventoryExceptionQueue.tsx` is replaced/evolved per §11, queues are grouped by `outcome`, evidence packets render with confidence indicators, and the existing accept/reassign/dismiss actions remain functional.
5. **Automatic application path for high-confidence existing taxonomy matches**
   - Done when: an entity satisfying §7.4's auto-apply rules and the §7.3 top two threshold rows is updated to `attributionStatus = "attributed"` with `attributionMethod = "ai-proposed"` and a `DiscoveryTriageDecision` row of `outcome = "auto-attributed"`.
6. **Human escalation path**
   - Done when: any candidate whose scores fall in the human-review band, or whose ambiguity margin is < 0.05, or whose taxonomy placement requires a new node, results in `outcome IN ("human-review", "taxonomy-gap")` with `requiresHumanReview = true` and a workbench card.
7. **Deterministic rule synthesis (`proposedRule` payload only — slice-1 scope)**
   - Done when: every `auto-attributed` decision writes a synthesized `proposedRule` JSON payload per §9, fixtures live under `packages/db/src/__fixtures__/discovery-triage/`, and regression tests replay the rule against the original packet. Persistent rule-catalog row creation is **out of scope** until the sibling thread ships (§13.1).
8. **Connect approved reusable fingerprints to the sibling hive-mind contribution pipeline**
   - **Blocked** on the sibling fingerprint-contribution spec (§13.1). Tracked in this epic as a placeholder so the dependency is visible.

Each item carries the §15 verification gates as part of its done-when.

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

Developer-side gates before opening a PR:

- run affected unit tests (informational; not merge-blocking — see CLAUDE.md "broken tests tracking")
- run `pnpm --filter web typecheck`
- run `pnpm --filter web exec next build` (avoid `npx next` per CLAUDE.md — npx ignores the workspace-pinned version)
- run affected browser QA against the production-served app

CI merge-blocking gates per [`CLAUDE.md`](../../../CLAUDE.md) branch protection: **Typecheck**, **Production Build**, **DCO**. Unit tests run on every PR but are temporarily informational.

## 16. Open Questions

1. **Resolved 2026-04-25.** Daily triage is owned by the existing `inventory-specialist` coworker because discovery operations already route to the Digital Product Estate Specialist. This keeps the route context, coworker identity, and scheduled execution aligned without introducing a parallel coworker surface.
2. Should high-confidence taxonomy-enrichment changes require human approval even when identity and placement are strong?
3. What is the first approved privacy/redaction policy for fingerprints before hive-mind contribution? (Owned by sibling thread per §13.1.)
4. Should customer-managed estate discoveries use the same triage queue as platform infrastructure, or a tenant-scoped queue?
5. Which fields count as sensitive by default in protocol evidence?
6. Should `InventoryEntity.confidence` be folded into the new `identityConfidence` score, deprecated, or kept with distinct semantics? (Touched in §7.3.)
7. The existing `attributionStatus` values `"needs_review"`, `"unmapped"`, `"attributed"`, `"stale"` predate the CLAUDE.md hyphen rule. Renaming `"needs_review"` is a wider migration (collectors, seed, every Postgres row) and is intentionally **out of scope** for this spec. Track as: should this legacy rename be folded into the slice-1 migration, deferred to a hygiene PR, or left until a broader enum-audit sweep?

## 17. Smallest Implementation Slice

The first slice avoids building the full contribution pipeline. It is bounded by §13.1 (no rule catalog, no contribution UX) and §7.2 (every packet `redactionStatus: "unverified"`, no auto-contribution paths).

1. Add `DiscoveryTriageDecision` per §10.2 plus the canonical-enum source-of-truth file per §10.1.
2. Add the scheduled coworker task per §7.1 (cron + volume override) reading current `attributionStatus = "needs_review"` entities.
3. Compute identity/taxonomy/evidence/reproducibility confidence using existing candidate taxonomy and evidence.
4. Persist a decision log entry. Synthesized rules live only in `proposedRule: Json` until the sibling thread ships the catalog model.
5. Auto-apply only existing taxonomy-node matches that clear the §7.3 top two threshold rows AND every §7.4 gate.
6. Route all other cases to the inventory review surface with a structured evidence packet.
7. Emit the §10.3 daily metrics summary as a JSON payload on the scheduled-task thread.

That creates the perpetual operating loop. The sibling fingerprint-contribution thread plugs approved reusable patterns into the same decision log and rule-synthesis path via the FeaturePack pipeline described in §13.1.
