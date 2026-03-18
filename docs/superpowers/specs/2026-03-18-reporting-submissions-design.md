# EP-GRC-003: Reporting & Submissions

**Status:** Draft
**Date:** 2026-03-18
**Epic:** Reporting & Submissions
**Scope:** Gap assessment dashboard, compliance posture report with trend analysis, enhanced regulatory submission workflow, periodic compliance snapshots
**Dependencies:** EP-GRC-001 (Compliance Engine Core — already implemented), EP-GRC-002 (Regulatory Intelligence — already implemented), EP-POL-001 (Internal Policy Management — already implemented)

---

## Problem Statement

The compliance engine (EP-GRC-001) stores obligations, controls, evidence, incidents, audits, and corrective actions. The regulatory intelligence module (EP-GRC-002) monitors for changes. The policy management module (EP-POL-001) tracks acknowledgments and training. But the platform has no way to answer the three questions auditors and regulators always ask:

1. **"Where are your gaps?"** — Which obligations have no controls? Where is the organization exposed?
2. **"What is your compliance posture?"** — Overall health score, trends over time, per-regulation breakdown
3. **"Show me the submission"** — Regulatory filings with preparation evidence, deadline tracking, confirmation

The data exists. The views to slice it usefully do not.

## Goals

1. Gap assessment view showing obligation-to-control coverage per regulation with red/amber/green indicators
2. Compliance posture report with composite score (0-100), per-regulation breakdown, and trend over time
3. Periodic ComplianceSnapshot records for trend analysis — created after monthly scans and on-demand
4. Enhanced regulatory submission workflow — detail page with preparation checklist, evidence chain, status transitions
5. New "Gaps" and "Posture" tabs in compliance navigation
6. All analytics computed from existing data — no redundant data entry

## Non-Goals

- PDF/CSV export (future enhancement — screen-first for now)
- Custom report builder or drag-and-drop dashboards
- Scheduled email reports
- AI-generated executive summaries
- Audit preparation wizard (posture report serves this need initially)
- Historical data backfill (trend starts from first snapshot forward)

---

## Design

### 1. Schema

Only 1 new table — periodic snapshots for trend analysis. All other features are analytics queries against existing EP-GRC-001 data.

#### 1.1 ComplianceSnapshot

Immutable point-in-time record of compliance metrics. Created after monthly regulatory scans, or on-demand via "Take Snapshot" button.

```prisma
model ComplianceSnapshot {
  id                  String   @id @default(cuid())
  snapshotId          String   @unique // "SNAP-XXXXXXXX"
  takenAt             DateTime @default(now())
  triggeredBy         String   // "scheduled" | "manual" | "scan-complete"
  totalRegulations    Int
  totalObligations    Int
  coveredObligations  Int      // obligations with at least one implemented control
  totalControls       Int
  implementedControls Int
  openIncidents       Int
  overdueActions      Int
  publishedPolicies   Int
  pendingAlerts       Int
  overallScore        Float    // 0-100 composite score
  regulationBreakdown Json     // [{regulationId, shortName, obligations, covered, controls, implemented, score}]
  agentId             String?
  createdAt           DateTime @default(now())

  @@index([takenAt])
}
```

Intentionally omits `status` and `updatedAt` — snapshots are immutable point-in-time records.

**Composite score formula:**
```
overallScore = (
  (coveredObligations / max(totalObligations, 1)) * 0.4 +
  (implementedControls / max(totalControls, 1)) * 0.3 +
  (1 - openIncidents / max(totalObligations, 1)) * 0.15 +
  (1 - overdueActions / max(totalControls, 1)) * 0.15
) * 100
```

Clamped to 0-100. Weights: obligation coverage (40%), control implementation (30%), incident-free rate (15%), action timeliness (15%).

**Snapshot trigger points:**
- After each monthly regulatory scan completes (`triggeredBy: "scan-complete"`) — wired into `regulatory-monitor.ts`
- Manual trigger via "Take Snapshot" button on posture page (`triggeredBy: "manual"`)

### 2. Route Structure

```
app/(shell)/
  compliance/
    gaps/
      page.tsx          — gap assessment view
    posture/
      page.tsx          — compliance posture report + trend
    submissions/
      page.tsx          — (existing — enhanced with deadline countdown, status colors)
      [id]/
        page.tsx        — submission detail + evidence links + preparation checklist
```

### 3. ComplianceTabNav Update

Add "Gaps" and "Posture" tabs. Updated order:

```
[Dashboard] [Policies] [Regulations] [Obligations] [Controls] [Evidence] [Risks] [Incidents] [Audits] [Actions] [Gaps] [Posture] [Submissions]
```

### 4. Gap Assessment Page (`/compliance/gaps`)

Answers: "Which obligations have no controls? Where are we exposed?"

**Layout:**
- Top: overall gap summary — "3 uncovered obligations across 2 regulations"
- Per-regulation cards, each showing:
  - Regulation shortName + jurisdiction badge
  - Coverage bar: "12/15 obligations covered (80%)"
  - List of obligations, color-coded:
    - Green dot: at least one implemented control linked
    - Amber dot: controls linked but none yet implemented
    - Red dot: no controls linked at all
  - Uncovered obligations listed first (red, then amber, then green)

### 5. Posture Report Page (`/compliance/posture`)

**Current Posture** (top):
- Overall score as large number (0-100), color-coded: green ≥80, amber ≥60, red <60
- 4 metric cards: obligation coverage %, control implementation %, open incidents, overdue actions
- Per-regulation score table: regulation, obligation coverage %, control implementation %, open incidents, composite score
- "Take Snapshot" button (manage_compliance only)

**Trend** (bottom):
- Table of last 12 snapshots: date, overall score, obligations covered, controls implemented, incidents, actions
- Score trend visible as numbers (sparkline is a future enhancement)

### 6. Enhanced Submissions

**List page** (existing, enhanced):
- Deadline countdown: days remaining for pending/draft submissions. Red text if overdue, amber if < 7 days.
- Status badges with color coding: draft (gray), pending (yellow), submitted (blue), acknowledged (green), rejected (red)
- Filter by status, submission type

**Detail page** (`/compliance/submissions/[id]`, new):
- Full submission metadata (title, recipient, type, dates, confirmation ref, response)
- Linked regulation (clickable to regulation detail)
- **Preparation checklist** — auto-generated from the regulation's obligations. For each obligation: "Evidence gathered?" with count of linked ComplianceEvidence records. Not persisted — computed at render time from obligation→evidence relationships.
- **Linked evidence** — ComplianceEvidence records connected to this submission's regulation via the obligation chain. Shows evidence title, type, collected date.
- Status transition buttons: Draft → Pending → Submitted → Acknowledged (manage_compliance). Transitions enforce order.

### 7. API Layer

New file `apps/web/lib/actions/reporting.ts`. Uses shared helpers from `compliance-helpers.ts`.

#### Gap Analysis
- `getGapAssessment()` — returns per-regulation breakdown with each obligation's coverage status (covered/partial/uncovered) and control count

#### Posture
- `getCompliancePosture()` — computes current posture: overall score, per-regulation scores, metric counts
- `takeComplianceSnapshot(triggeredBy)` — captures current metrics into ComplianceSnapshot record
- `getPostureTrend(limit?)` — returns last N snapshots for trend display

#### Submission Enhancement
- `getSubmission(id)` — full detail with regulation, evidence chain, preparation checklist computed from obligations
- `transitionSubmissionStatus(id, newStatus)` — enforces status workflow: draft→pending→submitted→acknowledged/rejected. Sets `submittedAt` on transition to "submitted".

#### Submission Status State Machine
```
draft → pending (ready for review)
pending → submitted (filed with regulator — sets submittedAt)
pending → draft (sent back for revision)
submitted → acknowledged (regulator confirmed receipt)
submitted → rejected (regulator rejected — needs re-submission)
rejected → draft (start over)
```

### 8. Snapshot Integration with Regulatory Monitor

After the monthly scan completes in `regulatory-monitor.ts`, call `takeComplianceSnapshot("scan-complete")` to automatically capture a posture snapshot. This creates the trend data with zero manual effort.

---

## Security & Access Control

- `view_compliance` — view gaps, posture, submissions, snapshots
- `manage_compliance` — take snapshots, transition submission status
- ComplianceSnapshot is immutable — no update/delete actions
- Submission status transitions logged to ComplianceAuditLog
- Preparation checklist is read-only (computed, not persisted)

---

## Migration & Seed Strategy

### Schema Migration
Single Prisma migration adding:
- 1 new model: ComplianceSnapshot

### Seed Data
None.

### Existing Data
- No changes to existing models or data
- Trend analysis starts from first snapshot forward — no backfill

---

## Testing & Success Criteria

### Schema
- ComplianceSnapshot creates with all metric fields
- Snapshot is immutable — no update action exists

### Gap Assessment
- Regulation with 3 obligations (2 covered, 1 uncovered) returns correct gap count
- Obligation with implemented control = "covered"
- Obligation with planned-only control = "partial"
- Obligation with no controls = "uncovered"

### Posture
- Score calculation: 100% coverage + 100% implementation + 0 incidents + 0 overdue = 100
- Score calculation: 50% coverage + 50% implementation + some incidents = score < 100
- takeComplianceSnapshot stores correct denormalized values
- getPostureTrend returns snapshots in reverse chronological order

### Submissions
- Valid status transitions succeed
- Invalid transitions rejected (e.g., draft→submitted skipping pending)
- submittedAt set on transition to "submitted"
- Preparation checklist computed correctly from obligation→evidence chain

---

## Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/reporting-types.ts` | Types, ID generator, score calculation, submission state machine |
| `apps/web/lib/reporting-types.test.ts` | Type tests |
| `apps/web/lib/actions/reporting.ts` | Gap analysis, posture, snapshot, submission enhancement actions |
| `apps/web/lib/actions/reporting.test.ts` | Server action tests |
| `apps/web/app/(shell)/compliance/gaps/page.tsx` | Gap assessment page |
| `apps/web/app/(shell)/compliance/posture/page.tsx` | Posture report page |
| `apps/web/app/(shell)/compliance/submissions/[id]/page.tsx` | Submission detail page |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add ComplianceSnapshot model |
| `apps/web/components/compliance/ComplianceTabNav.tsx` | Add "Gaps" and "Posture" tabs |
| `apps/web/app/(shell)/compliance/submissions/page.tsx` | Enhance with deadline countdown, status colors |
| `apps/web/lib/actions/regulatory-monitor.ts` | Call takeComplianceSnapshot("scan-complete") after scan completes |

---

## Implementation Order

Nine chunks, sequenced by dependency:

### Chunk 1: Schema Migration
- Add ComplianceSnapshot model
- Run prisma validate + generate
- **Gate:** Migration succeeds

### Chunk 2: Types and Validation
- reporting-types.ts: snapshot ID generator, score calculation function, submission state machine, gap/posture types
- Tests (TDD)
- **Gate:** All type tests pass

### Chunk 3: Server Actions — Gap Analysis + Posture + Snapshot
- reporting.ts: getGapAssessment, getCompliancePosture, takeComplianceSnapshot, getPostureTrend
- **Gate:** Gap returns correct coverage, posture computes score, snapshot persists

### Chunk 4: Server Actions — Submission Enhancement
- Append to reporting.ts: getSubmission, transitionSubmissionStatus
- **Gate:** Submission detail with evidence chain, status transitions enforced

### Chunk 5: ComplianceTabNav + Gap Assessment Page
- Add Gaps and Posture tabs
- Create gaps/page.tsx
- **Gate:** Gap page renders with per-regulation coverage breakdown

### Chunk 6: Posture Report Page
- Create posture/page.tsx with current posture + trend table
- **Gate:** Posture renders with score, metrics, trend data

### Chunk 7: Submission Detail + List Enhancement
- Create submissions/[id]/page.tsx with preparation checklist and evidence chain
- Enhance submissions/page.tsx with deadline countdown and status colors
- **Gate:** Submission detail renders, status transitions work

### Chunk 8: Wire Snapshot into Regulatory Monitor
- Update regulatory-monitor.ts to call takeComplianceSnapshot after scan
- **Gate:** Monthly scan produces a snapshot automatically

### Chunk 9: Tests + Final Verification
- Server action tests for gap, posture, snapshot, submission
- Run full test suite
- **Gate:** All tests pass

---

## Appendix: Backlog Item Mapping

| Backlog Item | Coverage in This Spec |
|---|---|
| Compliance gap assessment dashboard | Sections 4, 7 — per-regulation obligation coverage with color indicators |
| Compliance posture report with scoring | Sections 5, 7 — composite score, per-regulation breakdown, trend |
| Periodic compliance snapshots for trend | Section 1.1 — ComplianceSnapshot model with auto-trigger after scans |
| Enhanced regulatory submission workflow | Sections 6, 7 — detail page, preparation checklist, status state machine |
| Audit preparation support | Section 5 — posture report serves as audit preparation summary |
