# EP-GRC-001: Compliance Engine Core

**Status:** Draft
**Date:** 2026-03-17
**Epic:** Compliance Engine Core
**Scope:** Universal regulatory compliance lifecycle engine — obligation registry, control framework, evidence collection, risk assessment, incident management, corrective action tracking, audit management, compliance calendar, immutable audit trail, workspace tile + `/compliance` route

---

## Problem Statement

The platform targets regulated industries where evidence of decisions is critical. The existing foundation handles agent governance (`DirectivePolicyClass`, `AgentGovernanceProfile`, `AuthorizationDecisionLog`), backlog traceability (attribution fields), and build disciplines (evidence trail for shipped features). What is missing is a dedicated compliance domain for managing external regulatory obligations.

Organizations face 60+ major regulatory frameworks across financial (SOX, DORA, FFIEC, OFAC), healthcare (HIPAA, OSHA, FDA), data privacy (GDPR, PCI-DSS, ISO 27001), and industry-specific regulations (NERC CIP, FSMA, CMMC, Solvency II). These span 15+ jurisdictions with different reporting cadences, evidence requirements, and penalty structures. Staying on top of regulatory changes is a significant operational burden — and a natural fit for AI agent assistance.

Cross-industry research identified 14 universal compliance patterns that repeat in every regulated industry, 8 common lifecycle stages, and 15 evidence types. The critical insight: **regulation-specific content is configuration; the compliance lifecycle is universal.** Every compliance program — nuclear plant, food manufacturer, law firm, or bank — runs the same five interlocking loops:

1. **Obligation → Control → Evidence** — know what's required, do something about it, prove it
2. **Risk → Control → Monitoring → Corrective Action** — check controls work, fix when they don't
3. **Incident → Investigation → Root Cause → Correction → Verification** — find and fix the cause
4. **Plan → Do → Check → Act** — the program improves over time
5. **Regulator → Submission → Acknowledgment** — maintain regulatory relationships

This spec builds the universal engine. Regulation-specific content, AI-assisted monitoring, and internal policy management are separate epics that build on this foundation.

## Goals

1. Generic compliance lifecycle engine that works for ANY regulation, ANY industry, ANY jurisdiction
2. Obligation registry with control mapping and evidence collection
3. Risk assessment with control linkage
4. Incident management with regulatory notification tracking
5. Corrective action lifecycle (open → investigate → remediate → verify → close)
6. Audit management with findings and corrective action generation
7. Immutable compliance audit trail on all records
8. Integration with existing platform infrastructure: CalendarEvent, EmployeeProfile, AI Coworker (agentId)
9. Workspace tile and `/compliance` route with compliance posture dashboard
10. Full evidence trail for regulated industry audit readiness

## Non-Goals

- Pre-loaded regulation templates or curated regulation library (EP-GRC-002: Regulatory Intelligence)
- AI-assisted regulation parsing, monitoring, or change detection (EP-GRC-002)
- Regulatory submission automation or gap assessment dashboards (EP-GRC-003: Reporting & Submissions)
- Internal policy lifecycle, employee acknowledgments, or training attestation tracking (EP-POL-001: Internal Policy Management)
- Third-party/supplier compliance portal (future epic)
- Document management or file upload infrastructure (consumed when available, not built here)

## Epic Roadmap

| Epic | Depends On | Scope |
|------|-----------|-------|
| **EP-GRC-001** (this spec) | None | Universal compliance engine — schema, CRUD, route, dashboard, audit trail |
| EP-GRC-002: Regulatory Intelligence | EP-GRC-001 | AI agent for regulation monitoring, regulation template library, regulatory change alerts, auto-parsing of regulatory text |
| EP-GRC-003: Reporting & Submissions | EP-GRC-001 | Regulatory submission workflows, gap assessment dashboards, audit preparation packages, compliance posture reports |
| EP-POL-001: Internal Policy Management | EP-GRC-001 | Policy lifecycle (draft→approve→publish→review→retire), employee acknowledgments, training requirements, attestation tracking. Linked to obligations via `sourceType: "internal"` |

---

## Design

### 1. Schema

All models follow existing platform patterns: `id` as cuid PK, `status` for soft-delete, `createdAt`/`updatedAt`, explicit `onDelete`, `@@index` on all FK columns. Ownership uses `EmployeeProfile` (not `User`) — matches CalendarEvent, PerformanceReview, Timesheet patterns. AI coworker attribution via `agentId: String?` (same pattern as BacklogItem, Epic, ImprovementProposal).

#### 1.1 Regulation

Groups obligations by their regulatory source. A user might register "GDPR", "SOX Section 404", "ISO 27001 Annex A", "OSHA General Industry" as regulations.

```prisma
model Regulation {
  id            String   @id @default(cuid())
  regulationId  String   @unique // "REG-GDPR", "REG-SOX-404"
  name          String   // "General Data Protection Regulation"
  shortName     String   // "GDPR"
  jurisdiction  String   // "EU", "US-Federal", "US-CA", "UK", "Global"
  industry      String?  // "financial", "healthcare", "cross-industry"
  sourceType    String   @default("external") // "external" | "internal" — hook for EP-POL-001
  effectiveDate DateTime?
  reviewDate    DateTime? // when to re-check for regulatory updates
  sourceUrl     String?  // link to authoritative regulatory text
  notes         String?
  agentId       String?  // AI coworker that created/last modified this
  status        String   @default("active") // active | inactive | superseded
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  obligations Obligation[]

  @@index([status])
  @@index([jurisdiction])
  @@index([sourceType])
}
```

#### 1.2 Obligation

A single requirement from a regulation. GDPR Article 33 breach notification, OSHA 1904.39 fatality reporting, SOX 302 CEO certification — each is one obligation.

```prisma
model Obligation {
  id                String    @id @default(cuid())
  obligationId      String    @unique // "OBL-GDPR-ART33"
  regulationId      String
  title             String    // "Breach notification to supervisory authority"
  description       String?   // full text or summary of requirement
  reference         String?   // "Article 33(1)" — citation within the regulation
  category          String?   // "data-protection", "safety", "financial-reporting", "environmental"
  frequency         String?   // "event-driven", "annual", "quarterly", "continuous"
  applicability     String?   // conditions under which this applies
  penaltySummary    String?   // "Up to €20M or 4% global turnover"
  ownerEmployeeId   String?
  reviewDate        DateTime?
  agentId           String?
  status            String    @default("active")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  regulation     Regulation       @relation(fields: [regulationId], references: [id], onDelete: Restrict)
  ownerEmployee  EmployeeProfile? @relation("ObligationOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  controls       ControlObligationLink[]
  evidence       ComplianceEvidence[]

  @@index([regulationId])
  @@index([ownerEmployeeId])
  @@index([status])
  @@index([category])
}
```

#### 1.3 Control + Obligation Link

A policy, procedure, technical measure, or activity that satisfies one or more obligations. Many-to-many with Obligation via join table.

```prisma
model Control {
  id                   String    @id @default(cuid())
  controlId            String    @unique // "CTL-DPO-APPOINTMENT"
  title                String    // "Appoint Data Protection Officer"
  description          String?
  controlType          String    // "preventive" | "detective" | "corrective"
  implementationStatus String    @default("planned") // "planned" | "in-progress" | "implemented" | "not-applicable"
  ownerEmployeeId      String?
  reviewFrequency      String?   // "annual", "quarterly", "continuous"
  lastReviewedAt       DateTime?
  nextReviewDate       DateTime?
  effectiveness        String?   // "effective" | "partially-effective" | "ineffective" | "not-assessed"
  agentId              String?
  status               String    @default("active")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  ownerEmployee   EmployeeProfile?      @relation("ControlOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  obligations     ControlObligationLink[]
  evidence        ComplianceEvidence[]
  riskAssessments RiskControl[]
  auditFindings   AuditFinding[]

  @@index([ownerEmployeeId])
  @@index([status])
  @@index([implementationStatus])
  @@index([controlType])
}

model ControlObligationLink {
  id           String   @id @default(cuid())
  controlId    String
  obligationId String
  notes        String?
  createdAt    DateTime @default(now())

  control    Control    @relation(fields: [controlId], references: [id], onDelete: Cascade)
  obligation Obligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@unique([controlId, obligationId])
  @@index([controlId])
  @@index([obligationId])
}
```

#### 1.4 ComplianceEvidence

Immutable once created — no edits, only superseded. Linked to obligations and/or controls.

```prisma
model ComplianceEvidence {
  id                    String    @id @default(cuid())
  evidenceId            String    @unique // "EVD-2026-0001"
  title                 String    // "Q1 2026 DPO Training Completion Report"
  evidenceType          String    // "policy" | "procedure" | "training-record" | "audit-report" | "test-result" | "incident-report" | "approval" | "submission" | "assessment" | "other"
  description           String?
  obligationId          String?
  controlId             String?
  collectedAt           DateTime  @default(now())
  collectedByEmployeeId String?
  fileRef               String?   // reference to uploaded file (future file storage integration)
  retentionUntil        DateTime? // when this record can be disposed
  supersededById        String?   // if this evidence was replaced
  agentId               String?
  status                String    @default("active") // "active" | "superseded" | "expired"
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  obligation  Obligation?      @relation(fields: [obligationId], references: [id], onDelete: SetNull)
  control     Control?         @relation(fields: [controlId], references: [id], onDelete: SetNull)
  collectedBy EmployeeProfile? @relation("EvidenceCollector", fields: [collectedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([obligationId])
  @@index([controlId])
  @@index([collectedByEmployeeId])
  @@index([status])
  @@index([evidenceType])
}
```

#### 1.5 RiskAssessment + RiskControl

```prisma
model RiskAssessment {
  id                   String    @id @default(cuid())
  assessmentId         String    @unique // "RA-2026-001"
  title                String    // "GDPR Data Breach Risk Assessment"
  scope                String?
  hazard               String    // threat/hazard identified
  likelihood           String    // "rare" | "unlikely" | "possible" | "likely" | "almost-certain"
  severity             String    // "negligible" | "minor" | "moderate" | "major" | "catastrophic"
  inherentRisk         String    // "low" | "medium" | "high" | "critical" — before controls
  residualRisk         String?   // after controls applied
  assessedByEmployeeId String?
  assessedAt           DateTime  @default(now())
  nextReviewDate       DateTime?
  notes                String?
  agentId              String?
  status               String    @default("active")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  assessedBy EmployeeProfile? @relation("RiskAssessor", fields: [assessedByEmployeeId], references: [id], onDelete: SetNull)
  controls   RiskControl[]
  incidents  ComplianceIncident[]

  @@index([assessedByEmployeeId])
  @@index([status])
  @@index([inherentRisk])
}

model RiskControl {
  id               String   @id @default(cuid())
  riskAssessmentId String
  controlId        String
  mitigationNotes  String?
  createdAt        DateTime @default(now())

  riskAssessment RiskAssessment @relation(fields: [riskAssessmentId], references: [id], onDelete: Cascade)
  control        Control        @relation(fields: [controlId], references: [id], onDelete: Cascade)

  @@unique([riskAssessmentId, controlId])
  @@index([riskAssessmentId])
  @@index([controlId])
}
```

#### 1.6 ComplianceIncident + CorrectiveAction

```prisma
model ComplianceIncident {
  id                   String    @id @default(cuid())
  incidentId           String    @unique // "INC-2026-001"
  title                String
  description          String?
  occurredAt           DateTime
  detectedAt           DateTime?
  severity             String    // "low" | "medium" | "high" | "critical"
  category             String?   // "data-breach" | "safety" | "financial" | "environmental" | "operational" | "other"
  regulatoryNotifiable Boolean   @default(false)
  notificationDeadline DateTime?
  notifiedAt           DateTime?
  rootCause            String?
  riskAssessmentId     String?
  reportedByEmployeeId String?
  agentId              String?
  status               String    @default("open") // "open" | "investigating" | "remediated" | "closed"
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  riskAssessment    RiskAssessment?  @relation(fields: [riskAssessmentId], references: [id], onDelete: SetNull)
  reportedBy        EmployeeProfile? @relation("IncidentReporter", fields: [reportedByEmployeeId], references: [id], onDelete: SetNull)
  correctiveActions CorrectiveAction[]

  @@index([riskAssessmentId])
  @@index([reportedByEmployeeId])
  @@index([status])
  @@index([severity])
  @@index([regulatoryNotifiable])
}

model CorrectiveAction {
  id                    String    @id @default(cuid())
  actionId              String    @unique // "CA-2026-001"
  title                 String
  description           String?
  rootCause             String?
  sourceType            String    // "incident" | "audit-finding" | "gap-assessment" | "management-review"
  incidentId            String?
  auditFindingId        String?
  ownerEmployeeId       String?
  dueDate               DateTime?
  completedAt           DateTime?
  verificationMethod    String?
  verificationDate      DateTime?
  verifiedByEmployeeId  String?
  agentId               String?
  status                String    @default("open") // "open" | "in-progress" | "completed" | "verified" | "overdue"
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  incident     ComplianceIncident? @relation(fields: [incidentId], references: [id], onDelete: SetNull)
  auditFinding AuditFinding?       @relation(fields: [auditFindingId], references: [id], onDelete: SetNull)
  owner        EmployeeProfile?    @relation("CorrectiveActionOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  verifiedBy   EmployeeProfile?    @relation("CorrectiveActionVerifier", fields: [verifiedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([incidentId])
  @@index([auditFindingId])
  @@index([ownerEmployeeId])
  @@index([status])
  @@index([dueDate])
}
```

#### 1.7 ComplianceAudit + AuditFinding

```prisma
model ComplianceAudit {
  id              String    @id @default(cuid())
  auditId         String    @unique // "AUD-2026-001"
  title           String    // "ISO 27001 Internal Audit — Access Controls"
  auditType       String    // "internal" | "external" | "certification" | "regulatory-inspection"
  scope           String?
  auditorName     String?   // external auditor name
  auditorEmployeeId String? // FK to EmployeeProfile if internal
  scheduledAt     DateTime?
  conductedAt     DateTime?
  completedAt     DateTime?
  overallRating   String?   // "conforming" | "minor-nonconformity" | "major-nonconformity" | "observation"
  notes           String?
  agentId         String?
  status          String    @default("planned") // "planned" | "in-progress" | "completed" | "cancelled"
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  auditor  EmployeeProfile? @relation("AuditAuditor", fields: [auditorEmployeeId], references: [id], onDelete: SetNull)
  findings AuditFinding[]

  @@index([auditorEmployeeId])
  @@index([status])
  @@index([auditType])
}

model AuditFinding {
  id          String    @id @default(cuid())
  findingId   String    @unique // "FND-2026-001"
  auditId     String
  controlId   String?   // which control was found deficient
  title       String
  description String?
  findingType String    // "nonconformity-major" | "nonconformity-minor" | "observation" | "opportunity"
  dueDate     DateTime?
  resolvedAt  DateTime?
  agentId     String?
  status      String    @default("open") // "open" | "in-progress" | "resolved" | "accepted"
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  audit             ComplianceAudit    @relation(fields: [auditId], references: [id], onDelete: Cascade)
  control           Control?           @relation(fields: [controlId], references: [id], onDelete: SetNull)
  correctiveActions CorrectiveAction[]

  @@index([auditId])
  @@index([controlId])
  @@index([status])
}
```

#### 1.8 RegulatorySubmission

```prisma
model RegulatorySubmission {
  id                    String    @id @default(cuid())
  submissionId          String    @unique // "SUB-2026-001"
  title                 String    // "GDPR Breach Notification — ICO"
  regulationId          String?
  recipientBody         String    // "ICO", "SEC", "OSHA", "FCA"
  submissionType        String    // "breach-notification" | "annual-report" | "certification" | "license-renewal" | "incident-report"
  submittedAt           DateTime?
  dueDate               DateTime?
  submittedByEmployeeId String?
  confirmationRef       String?   // receipt/reference number from regulator
  responseReceived      Boolean   @default(false)
  responseDate          DateTime?
  responseSummary       String?
  notes                 String?
  agentId               String?
  status                String    @default("draft") // "draft" | "pending" | "submitted" | "acknowledged" | "rejected"
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  submittedBy EmployeeProfile? @relation("SubmissionSubmitter", fields: [submittedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([submittedByEmployeeId])
  @@index([status])
  @@index([dueDate])
}
```

#### 1.9 ComplianceAuditLog (Immutable Trail)

Separate from the existing `AuthorizationDecisionLog` — tracks every action in the compliance domain.

```prisma
model ComplianceAuditLog {
  id                    String   @id @default(cuid())
  entityType            String   // "regulation" | "obligation" | "control" | "evidence" | "risk-assessment" | "incident" | "corrective-action" | "audit" | "finding" | "submission"
  entityId              String
  action                String   // "created" | "updated" | "status-changed" | "assigned" | "reviewed" | "linked" | "unlinked" | "superseded"
  field                 String?  // which field changed (for updates)
  oldValue              String?
  newValue              String?
  performedByEmployeeId String?
  agentId               String?  // AI coworker that performed this action
  performedAt           DateTime @default(now())
  notes                 String?

  performedBy EmployeeProfile? @relation("ComplianceAuditLogActor", fields: [performedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([entityType, entityId])
  @@index([performedByEmployeeId])
  @@index([performedAt])
}
```

#### 1.10 CalendarEvent Extension

Two new nullable fields on the existing CalendarEvent model for compliance back-linking:

```prisma
model CalendarEvent {
  // ... existing fields ...
  complianceEntityType String?  // "obligation" | "audit" | "control-review" | "submission" | "incident-notification"
  complianceEntityId   String?  // cuid of the linked compliance record

  @@index([complianceEntityType, complianceEntityId])
}
```

Compliance deadlines create standard CalendarEvent records with `category: "compliance"`, `eventType: "deadline"`, and these fields populated. They appear on the workspace calendar alongside all other events.

#### 1.11 EmployeeProfile Reverse Relations

```prisma
model EmployeeProfile {
  // ... existing relations ...
  obligationOwnership       Obligation[]             @relation("ObligationOwner")
  controlOwnership          Control[]                @relation("ControlOwner")
  evidenceCollected         ComplianceEvidence[]     @relation("EvidenceCollector")
  riskAssessments           RiskAssessment[]         @relation("RiskAssessor")
  incidentsReported         ComplianceIncident[]     @relation("IncidentReporter")
  correctiveActionsOwned    CorrectiveAction[]       @relation("CorrectiveActionOwner")
  correctiveActionsVerified CorrectiveAction[]       @relation("CorrectiveActionVerifier")
  auditsPerformed           ComplianceAudit[]        @relation("AuditAuditor")
  regulatorySubmissions     RegulatorySubmission[]   @relation("SubmissionSubmitter")
  complianceAuditLogs       ComplianceAuditLog[]     @relation("ComplianceAuditLogActor")
}
```

### 2. Route Structure

```
app/(shell)/
  compliance/
    layout.tsx          — auth gate: view_compliance
    page.tsx            — dashboard (compliance posture overview)
    regulations/
      page.tsx          — regulation registry list
      [id]/
        page.tsx        — regulation detail + its obligations
    obligations/
      page.tsx          — all obligations (filterable by regulation, category, owner, status)
    controls/
      page.tsx          — control registry (filterable by type, status, effectiveness)
    evidence/
      page.tsx          — evidence library (filterable by type, obligation, control)
    risks/
      page.tsx          — risk assessment register
    incidents/
      page.tsx          — incident log (filterable by severity, status, category)
    audits/
      page.tsx          — audit schedule and history
      [id]/
        page.tsx        — audit detail + findings
    actions/
      page.tsx          — corrective action tracker (filterable by status, source, owner)
    submissions/
      page.tsx          — regulatory submission log
```

All pages are server components following the existing pattern (auth check → prisma query → render). Navigation within `/compliance` uses a horizontal tab bar at the top of the layout.

### 3. Workspace Tile

New entries in `apps/web/lib/permissions.ts`:

```ts
// CapabilityKey — add:
| "view_compliance"
| "manage_compliance"

// PERMISSIONS — add:
view_compliance:   { roles: ["HR-000", "HR-100", "HR-200", "HR-300"] },
manage_compliance: { roles: ["HR-000", "HR-200"] },

// ALL_TILES — add:
{ key: "compliance", label: "Compliance", route: "/compliance", capabilityKey: "view_compliance", accentColor: "#ef4444" },
```

Tile metrics on the workspace page:

```ts
compliance: {
  metrics: [
    { label: "Obligations", value: activeObligationCount, color: "#ef4444" },
    { label: "Open incidents", value: openIncidentCount, color: openIncidentCount > 0 ? "#fbbf24" : "#4ade80" },
    { label: "Controls", value: `${implementedControlCount}/${totalControlCount}`, color: "#38bdf8" },
  ],
  ...(overdueCount > 0
    ? { badge: `${overdueCount} overdue item${overdueCount !== 1 ? "s" : ""}`, badgeColor: "#fbbf24" }
    : {}),
},
```

### 4. Dashboard Page

The `/compliance` landing page is a compliance posture overview:

**Posture Summary** — 4 metric cards:
- Obligations: count of active obligations. Green if all have at least one implemented control linked; amber otherwise.
- Controls: implemented/total ratio. Amber if coverage < 80%.
- Open Incidents: count. Red if > 0, green if 0.
- Overdue Actions: corrective actions past dueDate and not completed/verified. Red if > 0.

**Upcoming Deadlines** — next 5 compliance CalendarEvents from the existing calendar infrastructure. Links to workspace calendar filtered by compliance category.

**Recent Activity** — last 10 ComplianceAuditLog entries showing who did what and when (including AI coworker actions).

**By Regulation** — grid of regulation cards. Each shows: shortName, jurisdiction badge, obligation count, control coverage %, open incident count, and a status indicator (green/amber/red).

### 5. Sub-Page Patterns

All list pages follow the existing platform pattern (Employee, Backlog, Inventory):

- Header with title + count + "Add" button
- Filter bar (varies per entity)
- Table/card grid with key fields
- Click-through to detail

Create/edit uses centered modal pattern (consistent with backlog panel from `2026-03-16-backlog-panel-centered-modal-design.md`). Detail pages for Regulation and Audit use full pages since they have child records.

Key UI behaviors:
- Obligation list: coverage indicator — green if at least one implemented control linked, amber if controls exist but none implemented, red if no controls
- Incident list: `regulatoryNotifiable` incidents highlighted with distinct badge and countdown to deadline
- Corrective action list: overdue items highlighted (past dueDate, not completed)
- Evidence records: read-only after creation (immutable) — only "Supersede" action available
- ComplianceAuditLog entries appear as collapsible activity timeline on every detail view

### 6. API Layer

All server actions in `apps/web/lib/actions/compliance.ts`, following the existing pattern.

#### 6.1 Regulation

- `listRegulations(filters?)` — filterable by status, jurisdiction, sourceType, industry
- `getRegulation(id)` — includes obligations
- `createRegulation(data)` — logs to ComplianceAuditLog
- `updateRegulation(id, data)` — logs changes
- `deactivateRegulation(id)` — sets status → "inactive"

#### 6.2 Obligation

- `listObligations(filters?)` — filterable by regulationId, category, ownerEmployeeId, status, frequency
- `getObligation(id)` — includes regulation, controls, evidence
- `createObligation(data)` — logs; creates CalendarEvent if frequency set
- `updateObligation(id, data)` — logs changes

#### 6.3 Control + Linking

- `listControls(filters?)` — filterable by controlType, implementationStatus, effectiveness, ownerEmployeeId
- `getControl(id)` — includes obligations, evidence, riskAssessments
- `createControl(data)` / `updateControl(id, data)`
- `linkControlToObligation(controlId, obligationId, notes?)` / `unlinkControlFromObligation(controlId, obligationId)`

#### 6.4 Evidence (immutable)

- `listEvidence(filters?)` — filterable by evidenceType, obligationId, controlId, collectedByEmployeeId, status
- `getEvidence(id)`
- `createEvidence(data)` — no updateEvidence exists
- `supersedeEvidence(existingId, newData)` — creates new record, sets old to superseded in a transaction

#### 6.5 Risk Assessment + Control Linking

- `listRiskAssessments(filters?)` / `getRiskAssessment(id)`
- `createRiskAssessment(data)` / `updateRiskAssessment(id, data)`
- `linkRiskToControl(riskAssessmentId, controlId, notes?)` / `unlinkRiskFromControl(riskAssessmentId, controlId)`

#### 6.6 Incident + Corrective Action

- `listIncidents(filters?)` / `getIncident(id)` — includes correctiveActions, riskAssessment
- `createIncident(data)` — auto-creates CalendarEvent if regulatoryNotifiable + notificationDeadline
- `updateIncident(id, data)`
- `listCorrectiveActions(filters?)` — includes overdue filter
- `createCorrectiveAction(data)` / `updateCorrectiveAction(id, data)`
- `verifyCorrectiveAction(id, verifiedByEmployeeId, method)` — sets verificationDate, verifiedById, status → "verified"

#### 6.7 Audit + Findings

- `listAudits(filters?)` / `getAudit(id)` — includes findings
- `createAudit(data)` — auto-creates CalendarEvent if scheduledAt set
- `updateAudit(id, data)`
- `createAuditFinding(auditId, data)` / `updateAuditFinding(id, data)`

#### 6.8 Regulatory Submission

- `listSubmissions(filters?)` / `createSubmission(data)` / `updateSubmission(id, data)`

#### 6.9 Dashboard Aggregation

```ts
getComplianceDashboard(): {
  obligationCount: number
  controlCoverage: { implemented: number, total: number }
  openIncidentCount: number
  overdueActionCount: number
  upcomingDeadlines: CalendarEvent[]  // next 5 compliance CalendarEvents
  recentActivity: ComplianceAuditLog[]  // last 10
  regulationSummaries: Array<{
    id: string, shortName: string, jurisdiction: string,
    obligationCount: number, controlCoverage: number, openIncidents: number
  }>
}
```

#### 6.10 Audit Logging Helper

Every write action calls a shared helper:

```ts
async function logComplianceAction(
  entityType: string, entityId: string, action: string,
  performedByEmployeeId: string | null, agentId: string | null,
  details?: { field?: string, oldValue?: string, newValue?: string, notes?: string }
): Promise<void>
```

Append-only — no update or delete actions on ComplianceAuditLog.

#### 6.11 Calendar Integration Helper

```ts
async function ensureComplianceCalendarEvent(
  entityType: string, entityId: string, title: string,
  dueDate: DateTime, ownerEmployeeId: string,
  recurrence?: string
): Promise<CalendarEvent>
```

Creates or updates a CalendarEvent with `category: "compliance"`, `eventType: "deadline"`, `complianceEntityType`/`complianceEntityId` set. Called by createObligation, createAudit, createIncident (if notifiable), createSubmission (if dueDate set).

---

## Migration & Seed Strategy

### Schema Migration

Single Prisma migration adding:
- 13 new tables: Regulation, Obligation, Control, ControlObligationLink, ComplianceEvidence, RiskAssessment, RiskControl, ComplianceIncident, CorrectiveAction, ComplianceAudit, AuditFinding, RegulatorySubmission, ComplianceAuditLog
- 2 new fields on CalendarEvent: `complianceEntityType`, `complianceEntityId` (both nullable) + composite index
- Reverse relations on EmployeeProfile (Prisma schema only — no DB change)

### Seed Data

None — the engine starts empty (Engine-First approach). Users register their applicable regulations and define obligations. Future EP-GRC-002 can provide regulation template packs as optional seed data.

### Existing Data

No backfill required. No existing records affected. CalendarEvent gains two nullable fields — existing events have null values. No breaking changes.

---

## Security & Access Control

- `view_compliance` (HR-000, HR-100, HR-200, HR-300) — read access to all compliance data and dashboard
- `manage_compliance` (HR-000, HR-200) — create, update, link, supersede actions
- Layout auth gate uses `view_compliance`; all write server actions check `manage_compliance`
- ComplianceAuditLog is **append-only** — no update/delete server actions, no soft-delete. Records are permanent.
- ComplianceEvidence is **immutable** — no updateEvidence action. Only supersedeEvidence creates a new record with a back-link.
- All EmployeeProfile FKs use `onDelete: SetNull` — compliance records persist when employees leave
- Regulation uses `onDelete: Restrict` — cannot delete a regulation that has obligations
- `agentId` is a plain String (no FK constraint) — matches existing platform pattern

---

## Testing & Success Criteria

### Schema

- All 13 models support create, read, update (where applicable) via Prisma client
- FK constraints enforce referential integrity (Restrict on Regulation→Obligation, Cascade on join tables, SetNull on optional employee links)
- ControlObligationLink and RiskControl unique constraints prevent duplicate links

### CRUD

- Every server action validates auth (view_compliance for reads, manage_compliance for writes)
- createEvidence produces immutable record — no updateEvidence path exists
- supersedeEvidence creates new record AND updates old record in a transaction
- All write actions produce ComplianceAuditLog entries with correct entityType, entityId, action, performer (employee and/or agentId)
- createIncident with regulatoryNotifiable=true auto-creates CalendarEvent with notification deadline

### Calendar Integration

- Compliance CalendarEvents created with category "compliance" and complianceEntityType/Id populated
- Compliance deadlines appear on workspace calendar
- Upcoming deadlines query returns correct results on dashboard

### Dashboard

- getComplianceDashboard returns accurate counts across all metrics
- Control coverage calculated as implemented/total ratio
- Overdue actions = corrective actions past dueDate with status not in ["completed", "verified"]
- Regulation summaries show per-regulation breakdown

### Permissions

- Workspace tile visible for HR-000, HR-100, HR-200, HR-300
- Workspace tile NOT visible for HR-400, HR-500
- Write actions rejected for HR-100, HR-300 (read-only roles)
- Write actions permitted for HR-000, HR-200

---

## Appendix: Research Foundation

Cross-industry regulatory research covering 11 industry sectors (energy, telecom, manufacturing, construction, education, food, transport, defense, insurance, legal, non-profit) and 60+ regulatory frameworks across 15+ jurisdictions identified the universal compliance patterns that inform this design:

### 14 Universal Compliance Patterns

1. Obligation Register — inventory of applicable rules
2. Policy Framework — documented commitments, version-controlled
3. Risk Assessment — identify hazards, assess likelihood/severity, determine controls
4. Controls Implementation — documented, implemented, assigned to owners
5. Training and Competence — records of who was trained, when, on what
6. Monitoring and Measurement — ongoing checks that controls work
7. Incident Reporting and Investigation — detect, classify, notify, investigate, correct
8. Corrective Action — identify nonconformity, root cause, fix, verify
9. Document and Records Control — version-controlled documents, immutable records
10. Internal Audit — periodic self-assessment of compliance effectiveness
11. Management Review — leadership reviews compliance performance data
12. Continuous Improvement — PDCA cycle across the compliance program
13. Supply Chain / Third-Party Obligations — extend compliance into supply chain
14. Regulatory Notification — defined events reported to regulators within specified timeframes

### 5 Interlocking Loops (Schema Mapping)

| Loop | Models |
|------|--------|
| Obligation → Control → Evidence | Regulation, Obligation, Control, ControlObligationLink, ComplianceEvidence |
| Risk → Control → Monitoring → Correction | RiskAssessment, RiskControl, Control, CorrectiveAction |
| Incident → Investigation → Correction → Verification | ComplianceIncident, CorrectiveAction |
| Plan → Do → Check → Act | ComplianceAudit, AuditFinding, CorrectiveAction |
| Regulator → Submission → Acknowledgment | RegulatorySubmission + CalendarEvent integration |

### Regulations Covered by This Engine

The engine is regulation-agnostic by design. Any regulation can be modeled as a Regulation record with Obligation children. The following is a non-exhaustive sample of frameworks validated against this schema during research:

**Financial:** SOX, DORA, FFIEC, OFAC, Basel III, AML/KYC, MiFID II, Dodd-Frank
**Healthcare/Safety:** HIPAA, OSHA, FDA 21 CFR Part 11/820, EU MDR, GxP
**Data Privacy/Security:** GDPR, CCPA/CPRA, PCI-DSS, ISO 27001, SOC 2, NIS2, EU AI Act
**Industry-Specific:** NERC CIP, FSMA, CMMC, NIST 800-171, Solvency II, ITAR/EAR, FERPA
**International:** UK FCA, UK HSE, EU CSRD, Japan J-SOX, Singapore PDPA, Brazil LGPD, India DPDPA

---

## Appendix: Backlog Item Mapping

| Backlog Item | Coverage in This Spec |
|---|---|
| Compliance engine core — obligation and control framework | Sections 1.1–1.3 — Regulation, Obligation, Control, ControlObligationLink |
| Evidence collection and immutable audit trail | Sections 1.4, 1.9 — ComplianceEvidence (immutable), ComplianceAuditLog (append-only) |
| Risk assessment register | Section 1.5 — RiskAssessment, RiskControl |
| Incident management with regulatory notification | Section 1.6 — ComplianceIncident with regulatoryNotifiable, notificationDeadline |
| Corrective action lifecycle | Section 1.6 — CorrectiveAction with verification workflow |
| Audit management with findings | Section 1.7 — ComplianceAudit, AuditFinding |
| Regulatory submission tracking | Section 1.8 — RegulatorySubmission |
| Compliance workspace tile and dashboard | Sections 2–4 — route, tile, dashboard, sub-pages |
| Calendar integration for compliance deadlines | Sections 1.10, 6.11 — CalendarEvent extension + helper |
| Employee and AI coworker integration | Sections 1.11, throughout — EmployeeProfile FKs + agentId on all models |
