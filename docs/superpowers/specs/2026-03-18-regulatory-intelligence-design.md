# EP-GRC-002: Regulatory Intelligence

**Status:** Draft
**Date:** 2026-03-18
**Epic:** Regulatory Intelligence
**Scope:** Monthly AI-driven regulatory monitoring scan, change detection, alert management, compliance dashboard integration, calendar integration for scan schedule and alert deadlines
**Dependencies:** EP-GRC-001 (Compliance Engine Core — already implemented), Agent model + callWithFailover (already implemented), ScheduledJob model (already implemented), CalendarEvent (already implemented)

---

## Problem Statement

Organizations register regulations in the compliance engine (EP-GRC-001) but have no way to know when those regulations change. Regulatory bodies update rules, issue new guidance, change deadlines, and introduce enforcement actions continuously. Staying on top of these changes is a significant operational burden — missed updates can lead to non-compliance, fines, and audit failures.

The platform has AI agents with LLM access (`callWithFailover`), a scheduled job infrastructure (`ScheduledJob`), and a compliance engine with `Regulation` records that include `sourceUrl` fields. The missing piece is an automated monitoring loop that checks registered regulations for changes and surfaces actionable alerts to the compliance team.

## Goals

1. Monthly automated scan of all registered regulations for changes using AI agents
2. Alert generation when changes are detected — with severity, description, and suggested action
3. Confidence filtering to reduce noise (only medium/high confidence findings generate alerts)
4. Alert management workflow: review, dismiss, or action (create obligation, update regulation)
5. Graceful degradation when no LLM is available — scan fails cleanly, no false alerts
6. Manual trigger for on-demand scans
7. Calendar integration — monthly scan on workspace calendar, deadline events for high/critical alerts
8. Dashboard integration — alert summary, scan status, "Run Scan Now" button
9. All actions logged to existing ComplianceAuditLog

## Non-Goals

- Real-time or daily monitoring (monthly cadence is sufficient)
- Regulation template library / starter packs (separate future epic)
- Automated obligation creation without human approval (AI suggests, human decides)
- Subscription to paid regulatory data feeds or APIs
- Cross-regulation conflict detection or impact analysis
- Regulatory horizon scanning for not-yet-enacted legislation

---

## Design

### 1. Schema

All models follow existing platform patterns: cuid PK, status, createdAt, explicit onDelete, @@index on all FK columns.

#### 1.1 RegulatoryMonitorScan

Tracks each monthly (or manual) scan run.

```prisma
model RegulatoryMonitorScan {
  id                 String    @id @default(cuid())
  scanId             String    @unique // "SCAN-XXXXXXXX"
  triggeredBy        String    // "scheduled" | "manual"
  status             String    @default("running") // "running" | "completed" | "failed"
  regulationsChecked Int       @default(0)
  alertsGenerated    Int       @default(0)
  summary            String?   // LLM-generated summary of findings
  agentId            String?
  startedAt          DateTime  @default(now())
  completedAt        DateTime?
  errorMessage       String?
  createdAt          DateTime  @default(now())

  alerts RegulatoryAlert[]

  @@index([status])
  @@index([startedAt])
}
```

Intentionally omits `updatedAt` — scan records are effectively append-only (status transitions from running to completed/failed, then frozen).

#### 1.2 RegulatoryAlert

Individual finding from a scan.

```prisma
model RegulatoryAlert {
  id                   String    @id @default(cuid())
  alertId              String    @unique // "RALRT-XXXXXXXX"
  scanId               String
  regulationId         String?   // null for new-regulation alerts
  alertType            String    // "change-detected" | "new-regulation" | "deadline-approaching" | "enforcement-action"
  severity             String    @default("medium") // "low" | "medium" | "high" | "critical"
  title                String
  description          String?   // LLM-generated description of what changed
  sourceUrl            String?
  sourceSnippet        String?
  suggestedAction      String?   // LLM suggestion
  reviewedByEmployeeId String?
  reviewedAt           DateTime?
  resolution           String?   // "dismissed" | "obligation-created" | "regulation-updated" | "flagged-for-review"
  resolutionNotes      String?
  agentId              String?
  status               String    @default("pending") // "pending" | "reviewed" | "actioned" | "dismissed"
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  scan       RegulatoryMonitorScan @relation(fields: [scanId], references: [id], onDelete: Cascade)
  regulation Regulation?           @relation(fields: [regulationId], references: [id], onDelete: SetNull)
  reviewedBy EmployeeProfile?      @relation("AlertReviewer", fields: [reviewedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([scanId])
  @@index([regulationId])
  @@index([reviewedByEmployeeId])
  @@index([status])
  @@index([severity])
  @@index([alertType])
}
```

#### 1.3 Regulation Extension

Three new fields on the existing `Regulation` model:

```prisma
model Regulation {
  // ... existing fields ...
  lastKnownVersion String?   // "GDPR as amended 2024-03-15"
  sourceCheckDate  DateTime? // when the source was last checked
  changeDetected   Boolean   @default(false) // flag set by scan, cleared on review

  // ... existing relations ...
  alerts RegulatoryAlert[]
}
```

#### 1.4 EmployeeProfile Extension

Add reverse relation:
```prisma
model EmployeeProfile {
  // ... existing relations ...
  alertsReviewed RegulatoryAlert[] @relation("AlertReviewer")
}
```

### 2. Scan Execution

#### 2.1 Monthly Scan Flow

```
ScheduledJob ("regulatory-monitor", monthly)
  → triggerRegulatoryMonitorScan("scheduled")
    → creates RegulatoryMonitorScan (status: "running")
    → creates CalendarEvent for next month's scan
    → for each active Regulation:
        → calls LLM via callWithFailover
        → if change detected (confidence ≥ medium):
            → creates RegulatoryAlert
            → sets regulation.changeDetected = true
            → sets regulation.sourceCheckDate = now()
            → if severity high/critical: creates CalendarEvent deadline (7 days)
        → if no change: updates regulation.sourceCheckDate only
    → updates scan (status: "completed", summary, counts)
    → logs to ComplianceAuditLog
```

#### 2.2 LLM Prompt

For each regulation, the scan sends this prompt to the LLM:

```
You are a regulatory compliance monitor. Check whether this regulation has been updated or changed.

Regulation: {name} ({shortName})
Jurisdiction: {jurisdiction}
Last known version: {lastKnownVersion ?? "unknown"}
Last checked: {sourceCheckDate ?? "never"}
Source URL: {sourceUrl ?? "none provided"}

Respond in JSON:
{
  "hasChanged": boolean,
  "confidence": "high" | "medium" | "low",
  "summary": "brief description of what changed or 'no changes detected'",
  "severity": "low" | "medium" | "high" | "critical",
  "suggestedAction": "what the compliance team should do"
}
```

**Confidence filtering:** Only `hasChanged: true` AND `confidence` of "medium" or "high" generates an alert. Low-confidence results are logged in the scan summary but don't create alerts — reduces noise.

#### 2.3 Graceful Degradation

- **No LLM available:** scan completes with status "failed", error message logged. No alerts generated. Dashboard shows "Last scan failed — no AI provider available."
- **Partial failure:** individual regulation check failures don't stop the scan. Failed checks noted in scan summary. Successfully checked regulations get updated `sourceCheckDate`.
- **No regulations registered:** scan completes immediately with `regulationsChecked: 0`. Not an error.
- **No sourceUrl:** the agent uses regulation name + jurisdiction for the query. Less precise but still useful.

### 3. Alert Management

#### 3.1 Alert Lifecycle

```
pending → reviewed (human looked at it, needs more analysis)
pending → actioned (human took action — created obligation, updated regulation)
pending → dismissed (false positive or not relevant)
reviewed → actioned
reviewed → dismissed
```

#### 3.2 Create Obligation from Alert

Convenience action: `createObligationFromAlert(alertId, obligationInput)` creates an Obligation in the compliance engine, links it to the alert's regulation, and marks the alert as "actioned". The obligation input is pre-populated from the alert's `suggestedAction` but human-editable before submission.

### 4. Route & UI

**No new routes.** All regulatory intelligence UI lives on the existing `/compliance` dashboard.

#### 4.1 Dashboard Additions

**Regulatory Alerts section** (prominent, below posture summary):
- Pending alert count by severity (critical badge in red, high in orange)
- Last scan date, status, and "Run Scan Now" button (manage_compliance only)
- List of pending alerts: title, regulation shortName, severity badge, suggested action preview
- Per-alert actions: "Review" (opens modal), "Dismiss", "Create Obligation"

**Recent Scans section** (collapsible):
- Last 5 scans: date, triggered by, status, regulations checked, alerts generated

#### 4.2 Alert Review Modal

Uses existing ComplianceModal. Shows:
- Full alert detail: description, source snippet, suggested action
- Regulation link (clickable)
- Resolution options: dismiss (with notes), flag for review, create obligation (opens obligation form pre-filled from suggestion)

#### 4.3 Workspace Tile

Add pending alert count to the compliance tile badge. If there are pending high/critical alerts, the badge shows them prominently.

### 5. API Layer

New file `apps/web/lib/actions/regulatory-monitor.ts`. Uses shared helpers from `compliance-helpers.ts`.

#### Scan Execution
- `triggerRegulatoryMonitorScan(triggeredBy)` — runs full scan, returns scan ID
- `getLatestScan()` — most recent scan with counts
- `listScans(limit?)` — recent scans

#### Alert Management
- `listAlerts(filters?)` — filterable by status, severity, alertType, regulationId
- `getAlert(id)` — full detail
- `reviewAlert(id, resolution, notes?)` — marks reviewed, sets resolution
- `dismissAlert(id, notes?)` — shortcut for dismiss resolution
- `createObligationFromAlert(alertId, obligationInput)` — creates obligation, marks alert actioned

#### Dashboard
- `getRegulatoryAlertSummary()` — pending counts by severity, last scan info

### 6. Calendar Integration

Uses existing `ensureComplianceCalendarEvent` helper:

- **Monthly scan schedule:** recurring CalendarEvent with `complianceEntityType: "regulatory-scan"`, `recurrence: "monthly"`
- **High/critical alert deadlines:** CalendarEvent with `complianceEntityType: "alert-review"`, due date = alert creation + 7 days

Both appear on the workspace calendar alongside all other compliance deadlines.

### 7. ScheduledJob Seed

Seed a ScheduledJob record on migration:
- `jobId: "regulatory-monitor"`
- `name: "Monthly Regulatory Monitor Scan"`
- `schedule: "monthly"`
- `nextRunAt`: first day of next month

The existing scheduled job runner picks this up and calls `triggerRegulatoryMonitorScan("scheduled")` on the monthly cadence.

---

## Security & Access Control

- `manage_compliance` (HR-000, HR-200) — trigger scans, review/dismiss/action alerts
- `view_compliance` (HR-000, HR-100, HR-200, HR-300) — view alerts, scans, dashboard
- LLM responses are advisory — every alert requires human review before action
- No automatic changes to regulations or obligations — `createObligationFromAlert` is human-triggered
- Scan execution and all alert actions logged to ComplianceAuditLog
- LLM prompt does not include sensitive organizational data — only regulation metadata (name, jurisdiction, sourceUrl)

---

## Migration & Seed Strategy

### Schema Migration
Single Prisma migration adding:
- 2 new models: RegulatoryMonitorScan, RegulatoryAlert
- 3 new fields on Regulation: lastKnownVersion, sourceCheckDate, changeDetected
- Reverse relation `alerts` on Regulation
- Reverse relation `alertsReviewed` on EmployeeProfile

### Seed Data
- ScheduledJob record: `regulatory-monitor` with `schedule: "monthly"`
- CalendarEvent for first scan: recurring monthly

### Existing Data
- Regulation records gain 3 nullable fields (default null/false). No backfill needed.
- No breaking changes.

---

## Testing & Success Criteria

### Schema
- Both models create/read/update via Prisma
- RegulatoryAlert cascades on scan deletion
- Regulation extension fields nullable, changeDetected defaults to false

### Scan Execution
- Mock LLM returns `hasChanged: true, confidence: "high"` → alert created, regulation flagged
- Mock LLM returns `hasChanged: false` → no alert, sourceCheckDate updated
- Mock LLM returns `hasChanged: true, confidence: "low"` → no alert (confidence filter)
- No LLM available → scan status "failed", no alerts
- No regulations → scan completes with regulationsChecked: 0

### Alert Management
- Review alert → status changes, reviewedBy set
- Dismiss alert → status "dismissed", resolution set
- createObligationFromAlert → obligation created in compliance engine, alert actioned
- Invalid resolution rejected

### Calendar
- Scan creates recurring monthly CalendarEvent
- High/critical alerts create deadline CalendarEvent (7 days)

### Dashboard
- getRegulatoryAlertSummary returns correct counts
- Pending alerts grouped by severity

---

## Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/regulatory-monitor-types.ts` | Types, validators, ID generators, alert constants |
| `apps/web/lib/regulatory-monitor-types.test.ts` | Type tests |
| `apps/web/lib/actions/regulatory-monitor.ts` | Scan execution, alert CRUD, dashboard summary |
| `apps/web/lib/actions/regulatory-monitor.test.ts` | Server action tests |
| `apps/web/components/compliance/RegulatoryAlerts.tsx` | Alert list + review modal client component |
| `apps/web/components/compliance/ScanStatus.tsx` | Scan status + "Run Scan Now" button |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add 2 new models, extend Regulation (3 fields + alerts relation), EmployeeProfile reverse relation |
| `apps/web/app/(shell)/compliance/page.tsx` | Add alert summary and scan status sections |
| `apps/web/app/(shell)/workspace/page.tsx` | Add pending alert count to compliance tile badge |

---

## Implementation Order

Eight chunks, sequenced by dependency:

### Chunk 1: Schema Migration
- Add RegulatoryMonitorScan and RegulatoryAlert models
- Extend Regulation with 3 new fields + alerts relation
- Add EmployeeProfile reverse relation
- Run prisma validate + generate
- **Gate:** Migration succeeds, client generates

### Chunk 2: Types and Validation
- regulatory-monitor-types.ts: ID generators, constants, input types, validators
- Tests (TDD)
- **Gate:** All type tests pass

### Chunk 3: Server Actions — Scan Execution
- regulatory-monitor.ts: triggerRegulatoryMonitorScan with LLM integration
- Confidence filtering logic
- Graceful degradation (no LLM, partial failure)
- **Gate:** Scan creates alerts for changed regulations, skips unchanged, fails gracefully

### Chunk 4: Server Actions — Alert Management
- listAlerts, getAlert, reviewAlert, dismissAlert, createObligationFromAlert
- getRegulatoryAlertSummary
- **Gate:** Full alert lifecycle works, obligation creation from alert works

### Chunk 5: UI Components
- RegulatoryAlerts.tsx: alert list with review/dismiss/action buttons + review modal
- ScanStatus.tsx: last scan info + "Run Scan Now" button
- **Gate:** Components render, actions work

### Chunk 6: Dashboard + Workspace Integration
- compliance/page.tsx: add alert summary + scan status sections
- workspace/page.tsx: add pending alert count to compliance tile
- **Gate:** Dashboard shows alerts, tile shows badge

### Chunk 7: ScheduledJob Seed + Calendar
- Seed ScheduledJob record for monthly scan
- Calendar event creation for scan schedule and alert deadlines
- **Gate:** Job seeded, calendar events created

### Chunk 8: Tests + Final Verification
- Server action tests (scan execution, alert management, confidence filtering)
- Run full test suite
- **Gate:** All tests pass

---

## Appendix: Backlog Item Mapping

| Backlog Item | Coverage in This Spec |
|---|---|
| Automated regulatory change monitoring | Sections 2, 3 — monthly scan with LLM-driven change detection |
| Regulatory alert management | Sections 1.2, 3, 5 — alert lifecycle with review/dismiss/action workflow |
| AI-assisted compliance monitoring | Section 2.2 — LLM prompt with confidence filtering |
| Compliance dashboard alerts | Section 4 — alert summary, scan status on dashboard |
| Calendar integration for regulatory deadlines | Section 6 — monthly scan + alert deadline CalendarEvents |
