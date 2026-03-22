# Change & Deployment Management

**Date:** 2026-03-21
**Status:** In Progress
**Epic:** EP-CHG-MGMT
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-21-foundation-portfolio-operations-console-design.md` (operational graph, health probes, impact analysis API)
- `docs/superpowers/specs/2026-03-17-development-lifecycle-architecture-design.md` (ChangePromotion, ProductVersion, git pipeline)
- `docs/superpowers/specs/2026-03-15-calendar-infrastructure-design.md` (CalendarEvent scheduling)
- `docs/superpowers/specs/2026-03-21-digital-product-unified-ontology-design.md` (ontology — parallel track)

## Problem Statement

The platform has a code promotion pipeline (`ChangePromotion` → `ProductVersion` → git tags) that handles software deployments for digital products built within the platform. But change management is broader than code deployment:

1. **Infrastructure changes** — upgrading Postgres, rotating TLS certificates, scaling containers, modifying network configuration. These affect the Foundation portfolio but have no formal change process.
2. **Configuration changes** — environment variables, feature flags, AI routing profiles, provider registry updates. These can break production without touching code.
3. **External system changes** — customers manage systems outside this platform (on-premises servers, third-party SaaS, network equipment). These need the same change discipline.
4. **Business-aware scheduling** — changes should respect business hours, storefront traffic patterns, and explicit blackout periods. Currently there is no mechanism to schedule changes against the business calendar or prevent deployment during peak times.
5. **Maintenance windows** — when a change is scheduled, affected stakeholders need visibility, and the system may need to block new bookings or display status banners during execution.

The platform targets regulated industries where every change must be traceable: who requested it, what was assessed, who approved it, when it was executed, and what was the outcome. The existing `ChangePromotion` model provides this for code deployments but nothing covers the broader change landscape.

## Design Summary

An ITIL-style change management process with business-aware deployment windows:

1. **Change Request (RFC)** — umbrella model above the existing `ChangePromotion`, covering all change types
2. **Change Items** — individual changes within an RFC, each targeting a specific entity or system
3. **Deployment Windows** — business-aware scheduling constraints derived from operating hours, storefront traffic, and explicit blackout periods
4. **Impact Analysis** — automated blast radius assessment using the operational dependency graph from EP-FOUND-OPS
5. **Maintenance Window Enforcement** — calendar integration, booking blocks, and status banners during change execution
6. **External System Coverage** — RFC support for changes to systems outside the platform's inventory

### Key Principles

- **RFC is the umbrella** — every change, regardless of type, flows through an RFC. The existing `ChangePromotion` becomes one type of change item within an RFC, preserving backward compatibility.
- **Business model drives scheduling** — deployment windows are derived from the organization's operating profile, not hardcoded. A business with a storefront has different constraints than a back-office-only operation.
- **Same process, any scope** — platform changes and external system changes use the same approval workflow. The difference is automated vs. manual impact assessment.
- **Calendar is the coordination surface** — approved changes appear as `CalendarEvent` records, visible to affected stakeholders, integrated with booking and availability systems.

---

**Research basis:** Patterns informed by ServiceNow Change Management, Octopus Deploy Lifecycles, Spinnaker/Kayenta canary analysis, Harness Continuous Verification, LaunchDarkly kill switches, and GitLab self-managed deployment safety. See research notes in implementation plan.

**Schema convention note:** Model pseudocode below uses simplified types for readability. Implementation must follow the project's schema conventions: `String @id @default(cuid())` for all IDs, `String` for all foreign keys, `@relation` annotations on all FK fields, and `@@index` directives for query performance. Multiple FK fields referencing the same model require named relations.

### Research-Driven Additions (2026-03-21)

The following patterns were identified from best-in-class research and incorporated:

1. **Scheduling conflict detection** (ServiceNow Schedule Assist) — when scheduling an RFC, check for other active RFCs targeting overlapping inventory entities in the same time window. Prevents conflicting concurrent changes.
2. **Ordered execution with health gates** (Octopus Deploy, ArgoCD Sync Waves) — `ChangeItem.executionOrder` drives sequential execution with health verification between each item. If item N fails, items N+1..M are skipped and rollback begins from item N-1 backward.
3. **Automated rollback triggers** (Harness CV, Kubernetes readiness probes) — post-deploy health loop polls affected services. Three consecutive health failures within the verification window trigger automatic rollback.
4. **Rollback strategy per item type** (Harness Database DevOps, Docker rollout) — `code_deployment`: revert Docker image tag to previous `ProductVersion.gitTag`. `infrastructure`: restore from `PromotionBackup`. `configuration`: revert to previous env var snapshot. `external`: execute manual rollback plan.
5. **One-click rollback** (GitLab deployment safety) — RFC detail view exposes "Roll Back" button. System handles image revert, database restore, and service restart. No technical knowledge required.
6. **Self-development auto-RFC** (GitLab dogfooding) — when the platform ships a build (`shipBuild()`), an RFC is auto-created wrapping the `ChangePromotion`. Human approval gate cannot be bypassed for self-development changes.
7. **Expand-contract for database migrations** (Harness, Liquibase) — breaking schema changes use two releases: first adds new schema alongside old (expand), second removes old schema (contract). Each release is independently rollback-safe.

## Section 1: Change Request Model

### 1.1 New Schema Models

#### ChangeRequest

The RFC — umbrella for one or more change items.

```
model ChangeRequest {
  id                Int               @id @default(autoincrement())
  rfcId             String            @unique       // human-readable, e.g., "RFC-2026-0042"
  title             String
  description       String
  type              String                          // standard | normal | emergency
  scope             String                          // platform | external | both
  riskLevel         String            @default("low") // low | medium | high | critical
  status            String            @default("draft")
  // Lifecycle timestamps
  submittedAt       DateTime?
  assessedAt        DateTime?
  approvedAt        DateTime?
  scheduledAt       DateTime?
  startedAt         DateTime?
  completedAt       DateTime?
  closedAt          DateTime?
  // People
  requestedById     Int?                            // employee who requested
  assessedById      Int?                            // employee or agent who assessed impact
  approvedById      Int?                            // employee who approved (or agent for standard changes)
  executedById      Int?                            // employee or agent who executed
  // Scheduling
  deploymentWindowId Int?
  plannedStartAt    DateTime?
  plannedEndAt      DateTime?
  calendarEventId   Int?                            // link to CalendarEvent for visibility
  // Impact
  impactReport      Json?                           // auto-generated from EP-FOUND-OPS impact API
  // Outcome
  outcome           String?                         // success | partial | failed | rolled-back
  outcomeNotes      String?
  postChangeVerification Json?                      // health probe results after change
  // Relations
  changeItems       ChangeItem[]
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

#### ChangeItem

Individual change within an RFC.

```
model ChangeItem {
  id                Int               @id @default(autoincrement())
  changeRequestId   Int
  changeRequest     ChangeRequest     @relation(fields: [changeRequestId], references: [id], onDelete: Cascade)
  itemType          String                          // code_deployment | infrastructure | configuration | external
  title             String
  description       String?
  // Target
  inventoryEntityId Int?                            // for platform changes — links to InventoryEntity
  digitalProductId  Int?                            // for code deployments — links to DigitalProduct
  externalSystemRef String?                         // for external changes — free text identifier
  // Code deployment link
  changePromotionId Int?              @unique       // links to existing ChangePromotion for code deploys
  // Execution
  status            String            @default("pending") // pending | in-progress | completed | failed | skipped
  executionOrder    Int               @default(0)   // sequence within the RFC
  impactDescription String?                         // manual impact description (required for external changes)
  executionNotes    String?
  completedAt       DateTime?
  // Rollback
  rollbackPlan      String?                         // what to do if this item fails
  rolledBackAt      DateTime?
  rollbackNotes     String?
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

### 1.2 Change Types

| Type | Approval | Use Case |
|------|----------|----------|
| `standard` | Pre-approved — no per-instance approval needed | Routine changes with known risk: scheduled probe maintenance, image tag updates, config rotations |
| `normal` | Requires explicit approval after impact assessment | Most changes: infrastructure upgrades, code deployments, configuration changes with business impact |
| `emergency` | Expedited — approval during or after execution | Critical fixes: security patches, production outages, data corruption recovery |

Standard changes are pre-approved via a **Standard Change Catalog** — a list of change templates with pre-assessed risk. Creating an RFC from a catalog template auto-sets type to `standard` and skips to `scheduled` status.

### 1.3 Status Lifecycle

```
draft ──► submitted ──► assessed ──► approved ──► scheduled ──► in-progress ──► completed ──► closed
  │          │              │           │             │              │               │
  ▼          ▼              ▼           ▼             ▼              ▼               │
cancelled  rejected      rejected    cancelled    cancelled    rolled-back ─────────┘
                                                                    │
                                                                    ▼
                                                                  closed
```

Each transition is timestamped and attributed to a person or agent. Emergency changes can enter at `in-progress` and receive assessment/approval retrospectively.

**Emergency change flow:** An emergency RFC is created directly in `in-progress` status with `startedAt` set. After the change completes (success or failure), it transitions to `completed` or `rolled-back`. A retrospective review then fills `assessedAt`/`assessedById` and `approvedAt`/`approvedById` before transitioning to `closed`. If retrospective approval is denied, the outcome is recorded but the change cannot be undone — the denial is documented as part of the audit trail.

**Multi-approver (future):** The initial implementation supports single-approver (`approvedById`). For regulated environments requiring Change Advisory Board (CAB) review, a future enhancement will add a `ChangeApproval` junction model supporting multi-party approval chains with quorum rules.

---

## Section 2: Deployment Windows

### 2.1 Business Profile

New model capturing the organization's operating characteristics.

```
model BusinessProfile {
  id                Int               @id @default(autoincrement())
  profileKey        String            @unique       // e.g., "default", "holiday-season"
  name              String
  description       String?
  isActive          Boolean           @default(true)
  // Operating hours
  businessHours     Json                            // array of { dayOfWeek: 0-6, open: "HH:mm", close: "HH:mm" }
  timezone          String            @default("UTC")
  // Storefront awareness
  hasStorefront     Boolean           @default(false)
  lowTrafficWindows Json?                           // auto-derived or manually set: [{ dayOfWeek, start, end }]
  // Relations
  deploymentWindows DeploymentWindow[]
  blackoutPeriods   BlackoutPeriod[]
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

#### DeploymentWindow

Recurring time slots when changes are permitted.

```
model DeploymentWindow {
  id                Int               @id @default(autoincrement())
  businessProfileId Int
  businessProfile   BusinessProfile   @relation(fields: [businessProfileId], references: [id])
  windowKey         String            @unique       // e.g., "weeknight-maintenance"
  name              String
  description       String?
  // Schedule
  dayOfWeek         Int[]                           // 0=Sun through 6=Sat
  startTime         String                          // "HH:mm" in business timezone
  endTime           String                          // "HH:mm" in business timezone
  // Constraints
  maxConcurrentChanges Int            @default(1)   // how many RFCs can execute simultaneously
  allowedChangeTypes   String[]       @default(["standard", "normal"]) // which RFC types
  allowedRiskLevels    String[]       @default(["low", "medium"]) // which risk levels
  // Enforcement
  enforcement       String            @default("advisory") // advisory | enforced
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

#### BlackoutPeriod

Explicit no-change windows.

```
model BlackoutPeriod {
  id                Int               @id @default(autoincrement())
  businessProfileId Int
  businessProfile   BusinessProfile   @relation(fields: [businessProfileId], references: [id])
  name              String                          // e.g., "Month-end close", "Holiday peak"
  reason            String?
  startAt           DateTime
  endAt             DateTime
  scope             String            @default("all") // all | platform | external
  exceptions        String[]          @default([])  // change types exempt (e.g., ["emergency"])
  calendarEventId   Int?                            // visible on calendar
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

### 2.2 Window Calculation

When scheduling an RFC, the system:

1. Loads the active `BusinessProfile`
2. Checks `BlackoutPeriod` — if the proposed time falls within a blackout, reject (unless emergency)
3. Checks `DeploymentWindow` — find windows that match the RFC's type and risk level
4. If storefront is active, cross-references `lowTrafficWindows` with available deployment windows
5. If storefront has booking data, queries `BookingHold` and `ProviderAvailability` for the proposed time to assess booking density
6. Returns: available windows ranked by suitability (low traffic first, then off-hours, then business hours)

### 2.3 Storefront Traffic Awareness

For businesses with a storefront:
- **Booking density** — query upcoming bookings in the proposed change window. Fewer bookings = safer time.
- **Historical patterns** — if booking history exists, derive typical traffic patterns per day/hour (deferred to EP-FULL-OBS for statistical analysis)
- **Manual override** — operators can specify low-traffic windows manually in the `BusinessProfile`
- **Advisory display** — when scheduling an RFC, the UI shows: "This window has N active bookings and is [within/outside] low-traffic hours"

---

## Section 3: Impact Analysis Integration

### 3.1 Automated Assessment

When an RFC is submitted (transitions from `draft` → `submitted`):

1. For each `ChangeItem` targeting an `InventoryEntity`:
   - Call the EP-FOUND-OPS impact API (`/api/portfolio/foundational/ops/impact/:entityId`)
   - Collect: affected entities, affected digital products, affected service offerings
2. For each `ChangeItem` targeting a `DigitalProduct`:
   - Query `InventoryEntity` records attributed to that product
   - For each, call the impact API to find infrastructure dependencies
3. Aggregate across all change items into a unified impact report
4. Auto-calculate risk level:

| Factor | Low | Medium | High | Critical |
|--------|-----|--------|------|----------|
| Affected entities | 1-3 | 4-10 | 11-25 | 26+ |
| Affected products | 1 | 2-3 | 4-6 | 7+ |
| Affected portfolios | 1 | 1-2 | 3 | 4 |
| Current health issues | None | Warning on affected | Critical on affected | Critical on dependencies |
| Business hours overlap | Outside | Partial | Full | Peak traffic |

Risk level = highest factor across all dimensions. Operator can override with justification.

### 3.2 Manual Assessment for External Systems

For `ChangeItem` records with `itemType: 'external'`:
- No automated impact analysis (system has no graph data for external systems)
- RFC requires manual `impactDescription` field on the change item
- Risk level must be manually assessed by the submitter
- Approver can request additional impact documentation

### 3.3 Impact Report Structure

Stored as `ChangeRequest.impactReport` JSON:

```json
{
  "generatedAt": "2026-03-21T10:30:00Z",
  "changeItems": [
    {
      "changeItemId": 1,
      "targetType": "inventory_entity",
      "targetName": "postgres-primary",
      "affectedEntities": [
        { "entityKey": "app-container-web", "name": "Web App", "depth": 1, "healthStatus": "healthy" }
      ],
      "affectedProducts": [
        { "productId": "dpf-core", "name": "DPF Core Platform", "portfolio": "foundational" }
      ],
      "affectedServiceOfferings": [
        { "offeringId": "svc-platform-api", "name": "Platform API", "availabilityTarget": "99.5%" }
      ]
    }
  ],
  "riskSummary": {
    "calculatedRiskLevel": "medium",
    "totalAffectedEntities": 5,
    "totalAffectedProducts": 2,
    "totalAffectedPortfolios": 1,
    "businessHoursOverlap": "outside",
    "currentHealthIssues": "none"
  }
}
```

---

## Section 4: Maintenance Window Enforcement

### 4.1 Calendar Integration

**Design decision (2026-03-22):** CalendarEvent ownership resolved — `ownerEmployeeId` = the employee who approved the RFC (`ChangeRequest.approvedById`). For standard changes from the catalog, ownership falls to the catalog entry's `approvedById`. No schema change needed; the existing non-nullable constraint is preserved. If no approver is set (edge case), the CalendarEvent is gracefully skipped.

When an RFC is approved and scheduled:
- `ownerEmployeeId` is set to the employee who approved or scheduled the RFC. For automated standard changes, use the catalog entry's `approvedById`.
- A `CalendarEvent` is created with:
  - `eventType: 'action'`
  - `category: 'platform'`
  - `title`: RFC title
  - `description`: RFC summary + affected systems
  - `startAt` / `endAt`: planned change window
  - `visibility`: configurable (all stakeholders, affected product owners only, platform team only)

### 4.2 Booking Interaction

If the change window overlaps with bookable service hours (storefront):
- **Advisory mode:** Warning displayed to RFC scheduler — "N bookings exist in this window"
- **Enforced mode:** System blocks new bookings for affected services during the maintenance window
- **Existing bookings:** System flags them for manual resolution (reschedule notification)
- Blocking is implemented by creating a `ProviderAvailability` override with `isBlocked: true` and `reason` linking to the RFC

### 4.3 Status Communication

During change execution (`status: 'in-progress'`):
- Platform status banner capability: rendered in the UI shell for affected stakeholders
- Status exposed via API for external consumption: `GET /api/platform/status` returns active maintenance windows
- Storefront can conditionally display maintenance notice to customers

### 4.4 Post-Change Verification

When an RFC transitions to `completed`:
1. System triggers immediate health probe execution for all affected `InventoryEntity` records
2. Probe results stored in `ChangeRequest.postChangeVerification` JSON
3. If any probes return `critical` or `unreachable`, the RFC status shows a verification warning
4. Operator decides: close as successful, or initiate rollback

---

## Section 5: External System Coverage

### 5.1 Scope

Not everything a customer manages runs on this platform. The change management process must accommodate:
- On-premises servers and infrastructure
- Third-party SaaS platforms
- Network equipment and configuration
- Physical systems (if relevant to the business)

### 5.2 External System Registry

Changes to external systems reference them by name/identifier rather than by `InventoryEntity`. Future enhancement: an external system registry model that provides lightweight tracking without full discovery.

For now, `ChangeItem.externalSystemRef` is a free-text identifier (e.g., "Office 365 tenant", "Cisco switch core-sw-01", "Shopify store"). Operators provide manual impact descriptions and risk assessments.

### 5.3 Same Workflow, Different Fidelity

| Aspect | Platform Changes | External Changes |
|--------|-----------------|-----------------|
| Impact analysis | Automated via operational graph | Manual description by submitter |
| Risk calculation | Auto-calculated from graph + health | Manually assessed |
| Deployment windows | Same business-aware scheduling | Same |
| Approval workflow | Same | Same |
| Post-change verification | Automated health probes | Manual verification by operator |
| Audit trail | Full | Full |

---

## Section 6: Standard Change Catalog

### 6.1 Purpose

Pre-assessed change templates for routine operations that don't need per-instance approval.

```
model StandardChangeCatalog {
  id                Int               @id @default(autoincrement())
  catalogKey        String            @unique       // e.g., "scc-image-update"
  title             String
  description       String
  category          String                          // infrastructure | configuration | maintenance
  preAssessedRisk   String                          // low | medium (high/critical cannot be standard)
  templateItems     Json                            // array of change item templates
  approvalPolicy    String                          // auto | delegated
  validFrom         DateTime          @default(now())
  validUntil        DateTime?                       // expiry for periodic re-assessment
  approvedById      Int                             // who pre-approved this catalog entry
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
}
```

### 6.2 Usage

1. Operator selects a standard change from the catalog
2. System creates an RFC with `type: 'standard'`, pre-filled impact and risk from the catalog entry
3. RFC skips `submitted` → `assessed` → `approved` — goes directly to `scheduled`
4. Standard changes still require scheduling within a valid deployment window
5. Audit trail records which catalog entry was used

### 6.3 Catalog Governance

- Standard change catalog entries require initial approval by an authorized employee
- Entries have optional expiry dates for periodic re-assessment
- If an entity changes significantly (new dependencies discovered, health issues), related catalog entries are flagged for re-assessment

---

## Section 7: UI Surface

### 7.1 Route

`/ops/changes` — nested under the existing `/ops` route (backlog operations area).

### 7.2 Layout

| Tab | Content |
|-----|---------|
| **Active** | RFCs in submitted/assessed/approved/scheduled/in-progress status. Grouped by status. |
| **Calendar** | Calendar view showing scheduled changes, deployment windows, blackout periods. Reuses CalendarEvent infrastructure. |
| **History** | Completed/closed/rejected RFCs. Searchable, filterable by date/type/scope/outcome. |
| **Catalog** | Standard change catalog. Create RFC from template. |
| **Windows** | Deployment window and blackout period configuration. Business profile editor. |

### 7.3 RFC Detail View

- Header: RFC ID, title, type badge, risk level badge, status
- Impact report visualization (graph subset showing affected entities)
- Change items list with status per item
- Approval chain: who requested → who assessed → who approved → who executed
- Timeline: status transitions with timestamps
- Post-change verification results (if completed)
- Actions: submit, assess, approve, schedule, start, complete, roll back, cancel (role-gated)

---

## Implementation Sequence

| Phase | Scope | Status | Deliverables |
|-------|-------|--------|-------------|
| 1 | Schema | **Done** | `ChangeRequest`, `ChangeItem`, `BusinessProfile`, `DeploymentWindow`, `BlackoutPeriod`, `StandardChangeCatalog` models. Migration applied. |
| 2 | RFC lifecycle | **Done** | Create/submit/assess/approve/schedule/execute/complete/rollback workflow. 28 tests. Self-dev auto-RFC on shipBuild(). |
| 3 | Impact integration | Deferred | Auto-assessment on submission using EP-FOUND-OPS impact API. Blocked on EP-FOUND-OPS delivery. |
| 4 | Deployment windows | **Done** | Window calculation. Blackout enforcement. Scheduling conflict detection. Default profile seeded. 20 tests. |
| 5a | CalendarEvent on schedule | **Done** | CalendarEvent created when RFC transitions to scheduled. Owner = approvedById (per spec Section 4.1). Event category `platform`, type `action`. CalendarEvent ID stored in `ChangeRequest.calendarEventId`. Graceful skip when no approver. 2 tests. |
| 5b | Status banner API | **Done** | `GET /api/platform/status` — public endpoint returning `{ status, maintenanceActive, activeMaintenanceWindows[] }`. Returns in-progress RFCs with affected items. No auth required (storefront/external consumption). |
| 5c | Booking blocks | Deferred | Blocking new bookings via `ProviderAvailability` override during maintenance. Blocked on CalendarEvent integration with booking system (EP-FOUND-OPS). |
| 6 | UI | **Done** | `/ops/changes` route. Active/Completed/History/Catalog filters. RFC detail panel with one-click rollback, approve/reject, cancel. |
| 7 | Standard changes | **Done** | Catalog CRUD server actions + API (`/api/v1/ops/catalog`). Template-based RFC creation with auto-approval (`/api/v1/ops/catalog/:key/create-rfc`). Catalog UI tab in Changes view. Expiry validation. Risk-level guardrail (only low/medium). 7 tests. |
| — | Execution engine | **Done** | Ordered execution with health gates. Per-type rollback (code/infra/config/external). One-click RFC rollback. 27 tests. |
| — | API routes | **Done** | 9 REST endpoints for RFC lifecycle, execution, rollback, windows, business profile, catalog, catalog RFC creation, platform status. |
| — | Integration tests | **Done** | 7 end-to-end tests: self-dev flow, auto-rollback, one-click rollback, invalid transitions. |
