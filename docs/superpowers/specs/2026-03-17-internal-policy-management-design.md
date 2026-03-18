# EP-POL-001: Internal Policy Management

**Status:** Draft
**Date:** 2026-03-17
**Epic:** Internal Policy Management
**Scope:** Policy document lifecycle, policy requirements, employee acknowledgments, training tracking, optional link to compliance obligations, employee-facing surface, compliance dashboard integration
**Dependencies:** EP-GRC-001 (Compliance Engine Core — already implemented), CalendarEvent (already implemented), EmployeeProfile (already implemented)

---

## Problem Statement

The platform has a compliance engine (EP-GRC-001) for tracking external regulatory obligations, but organizations also need to manage internal policies — acceptable use, building security, ethics training, data handling procedures, workplace conduct. These policies:

- Have a lifecycle: draft → review → approve → publish → retire
- Require employee acknowledgment ("I have read and understood this policy")
- May require specific actions (complete training, pass an assessment, sign an attestation)
- May exist because of a regulation (GDPR requires a data processing policy) or independently (no-tailgating policy)
- Must be tracked for audit purposes — who acknowledged what, when, which version

The platform currently has no infrastructure for policy documents, employee acknowledgments, or training requirement tracking. The compliance engine provides the audit trail and obligation registry, but the policy lifecycle and employee-facing surface are missing.

## Goals

1. Policy document lifecycle management (draft → in-review → approved → published → retired)
2. Policy requirements — what employees must do (acknowledge, complete training, attest, take action)
3. Employee acknowledgment tracking with version awareness
4. Training requirement tracking with completion records and expiry for recurring requirements
5. Optional link from Policy to Obligation — regulation-driven policies link to their regulatory source, standalone policies don't
6. Employee-facing surface in `/employee` — "My Policies" showing pending acknowledgments and training
7. Compliance dashboard integration — policy compliance rates, overdue training, lowest-compliance policies
8. All actions logged to the existing ComplianceAuditLog
9. Integration with existing CalendarEvent for review dates and training deadlines

## Non-Goals

- Training content delivery (LMS) — the platform tracks requirements and completions, not courseware
- Policy document storage — `fileRef` field for future file upload integration, not built here
- Multi-reviewer approval workflow — single approver for now (approvedByEmployeeId)
- Policy versioning with diff view — version number tracked, prior versions are separate records
- Automated policy distribution (email/notification) — future enhancement
- Department-scoped policy assignment automation — `applicability` field is stored but filtering is manual for now

---

## Design

### 1. Schema

All models follow existing platform patterns: cuid PK, status for soft-delete, createdAt/updatedAt, explicit onDelete, @@index on all FK columns. Ownership uses EmployeeProfile. AI coworker attribution via agentId.

#### 1.1 Policy

The policy document — the organizational commitment. Has a lifecycle that governs when employees can see and acknowledge it.

```prisma
model Policy {
  id                    String    @id @default(cuid())
  policyId              String    @unique // "POL-XXXXXXXX"
  title                 String    // "Acceptable Use Policy"
  description           String?   // summary of what the policy covers
  category              String    // "security" | "hr" | "safety" | "ethics" | "operations" | "it" | "privacy" | "other"
  version               Int       @default(1)
  lifecycleStatus       String    @default("draft") // "draft" | "in-review" | "approved" | "published" | "retired"
  ownerEmployeeId       String?
  approvedByEmployeeId  String?
  approvedAt            DateTime?
  publishedAt           DateTime?
  retiredAt             DateTime?
  effectiveDate         DateTime? // when the policy takes effect
  reviewDate            DateTime? // next scheduled review
  reviewFrequency       String?   // "annual" | "biennial" | "quarterly"
  fileRef               String?   // future file storage integration
  obligationId          String?   // optional link to compliance obligation
  notes                 String?
  agentId               String?
  status                String    @default("active")
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  ownerEmployee    EmployeeProfile? @relation("PolicyOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  approvedBy       EmployeeProfile? @relation("PolicyApprover", fields: [approvedByEmployeeId], references: [id], onDelete: SetNull)
  obligation       Obligation?      @relation(fields: [obligationId], references: [id], onDelete: SetNull)
  requirements     PolicyRequirement[]
  acknowledgments  PolicyAcknowledgment[]

  @@index([ownerEmployeeId])
  @@index([approvedByEmployeeId])
  @@index([obligationId])
  @@index([lifecycleStatus])
  @@index([category])
  @@index([status])
}
```

**Lifecycle state machine:**
```
draft → in-review (submit for review)
in-review → approved (approver signs off — sets approvedByEmployeeId, approvedAt)
in-review → draft (sent back for revision)
approved → published (sets publishedAt — employees can now see and acknowledge)
published → retired (sets retiredAt — employees no longer prompted)
retired → draft (re-activate as new version — increments version number)
```

#### 1.2 PolicyRequirement

What employees must do for a given policy. A policy may have zero or many requirements.

```prisma
model PolicyRequirement {
  id              String   @id @default(cuid())
  requirementId   String   @unique // "PREQ-XXXXXXXX"
  policyId        String
  title           String   // "Read and acknowledge the Acceptable Use Policy"
  requirementType String   // "acknowledgment" | "training" | "attestation" | "action"
  description     String?
  frequency       String?  // "once" | "annual" | "quarterly" | "on-change" — null means once
  applicability   String?  // "all-employees" | "department:engineering" | "role:HR-000"
  dueDays         Int?     // days after publish/hire to complete (null = no deadline)
  agentId         String?
  status          String   @default("active")
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  policy              Policy               @relation(fields: [policyId], references: [id], onDelete: Cascade)
  trainingRequirement TrainingRequirement?
  completions         RequirementCompletion[]

  @@index([policyId])
  @@index([requirementType])
  @@index([status])
}
```

#### 1.3 RequirementCompletion

Proof an employee fulfilled a requirement. Covers acknowledgments, training completions, attestations, and actions in one table — the parent's `requirementType` distinguishes them.

```prisma
model RequirementCompletion {
  id                String    @id @default(cuid())
  completionId      String    @unique // "COMP-XXXXXXXX"
  requirementId     String
  employeeProfileId String
  completedAt       DateTime  @default(now())
  expiresAt         DateTime? // for recurring requirements — when this completion lapses
  method            String    // "digital-signature" | "checkbox" | "training-completion" | "manual-attestation"
  notes             String?
  agentId           String?
  status            String    @default("active") // "active" | "expired" | "revoked"
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  requirement     PolicyRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)
  employeeProfile EmployeeProfile   @relation("RequirementCompletions", fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@unique([requirementId, employeeProfileId, status])
  @@index([requirementId])
  @@index([employeeProfileId])
  @@index([status])
  @@index([expiresAt])
}
```

The unique constraint `[requirementId, employeeProfileId, status]` ensures one active completion per employee per requirement. When a recurring requirement expires, its status changes to "expired" and the employee becomes non-compliant until they complete it again (creating a new "active" record).

#### 1.4 TrainingRequirement

Optional 1:1 extension of PolicyRequirement when `requirementType: "training"`. Stores training-specific metadata.

```prisma
model TrainingRequirement {
  id                  String   @id @default(cuid())
  requirementId       String   @unique // 1:1 with PolicyRequirement
  trainingTitle       String   // "Annual Ethics Training 2026"
  provider            String?  // "internal" | "external-vendor-name"
  deliveryMethod      String?  // "online" | "in-person" | "self-paced" | "instructor-led"
  durationMinutes     Int?     // estimated duration
  externalUrl         String?  // link to training content/LMS
  passingScore        Float?   // minimum score to pass (null = completion only)
  certificateRequired Boolean  @default(false)
  agentId             String?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  requirement PolicyRequirement @relation(fields: [requirementId], references: [id], onDelete: Cascade)

  @@index([requirementId])
}
```

#### 1.5 PolicyAcknowledgment

Lightweight "I have read this policy" record tied directly to the policy document. Separate from RequirementCompletion — this is the quick document-level acknowledgment.

```prisma
model PolicyAcknowledgment {
  id                String   @id @default(cuid())
  policyId          String
  employeeProfileId String
  acknowledgedAt    DateTime @default(now())
  policyVersion     Int      // which version was acknowledged
  method            String   @default("digital-signature") // "digital-signature" | "checkbox"
  agentId           String?
  createdAt         DateTime @default(now())

  policy          Policy          @relation(fields: [policyId], references: [id], onDelete: Cascade)
  employeeProfile EmployeeProfile @relation("PolicyAcknowledgments", fields: [employeeProfileId], references: [id], onDelete: Cascade)

  @@unique([policyId, employeeProfileId, policyVersion])
  @@index([policyId])
  @@index([employeeProfileId])
}
```

Intentionally omits `status` and `updatedAt` — acknowledgments are permanent records. Append-only.

#### 1.6 Model Extensions

**Obligation** — add reverse relation:
```prisma
model Obligation {
  // ... existing fields ...
  policies Policy[]
}
```

**EmployeeProfile** — add reverse relations:
```prisma
model EmployeeProfile {
  // ... existing relations ...
  requirementCompletions RequirementCompletion[] @relation("RequirementCompletions")
  policyAcknowledgments  PolicyAcknowledgment[]  @relation("PolicyAcknowledgments")
  policiesOwned          Policy[]                @relation("PolicyOwner")
  policiesApproved       Policy[]                @relation("PolicyApprover")
}
```

### 2. Route Structure

```
app/(shell)/
  compliance/
    policies/
      page.tsx          — policy list (filterable by category, lifecycleStatus)
      [id]/
        page.tsx        — policy detail + requirements + acknowledgment rates
```

The "Policies" tab is added to `ComplianceTabNav` between "Dashboard" and "Regulations".

### 3. Policy List Page (`/compliance/policies`)

- Header with "Policies" title, count, "Add Policy" button (manage_compliance gated)
- Filter bar: category dropdown, lifecycle status dropdown
- Card per policy: title, category badge, lifecycle status badge (color-coded), version, owner, obligation link (if present), acknowledgment rate for published policies, review date with amber/red warnings

### 4. Policy Detail Page (`/compliance/policies/[id]`)

- Policy metadata: title, description, category, version, lifecycle status, owner, approver, effective date, review date
- Obligation link: clickable to regulation detail if present, "Not linked to a regulation" if not
- **Requirements section**: list of PolicyRequirement records with type badge, frequency, completion rate, training details if applicable
- **Acknowledgment section**: two-column view — "Acknowledged" (employee name + date) and "Pending" (employee names). Scoped to active employees.

### 5. Employee Integration (`/employee`)

New "My Policies" tab in `EmployeeTabNav`. When viewing own profile:

- **Pending Acknowledgments**: published policies the employee hasn't acknowledged at current version. "Acknowledge" button per policy.
- **Pending Training**: training requirements not completed or expired. Link to external training if `externalUrl` set.
- **Completed**: history of acknowledgments and completions with dates.

Self-service only — employees can only acknowledge/complete for themselves.

### 6. Compliance Dashboard Integration

New "Policy Compliance" section on `/compliance` dashboard page (below "By Regulation"):
- Overall acknowledgment rate across published policies
- Count of overdue/expired training requirements
- List of 3-5 policies with lowest compliance rates

### 7. Workspace Tile Update

Add published policy count to existing compliance tile metrics. Add badge for current user's pending acknowledgments if any.

### 8. API Layer

New file `apps/web/lib/actions/policy.ts`. Follows the same auth pattern as compliance.ts.

#### Policy CRUD
- `listPolicies(filters?)` — filterable by category, lifecycleStatus, ownerEmployeeId
- `getPolicy(id)` — includes requirements, acknowledgments, counts
- `createPolicy(input)` — creates draft, logs to ComplianceAuditLog
- `updatePolicy(id, input)` — updates fields, logs
- `transitionPolicyStatus(id, newStatus)` — enforces lifecycle state machine. Sets approvedByEmployeeId/approvedAt on approval, publishedAt on publish, retiredAt on retire. Creates CalendarEvent for reviewDate.

#### PolicyRequirement CRUD
- `createRequirement(policyId, input)` — creates requirement + optional TrainingRequirement if type is "training"
- `updateRequirement(id, input)` — updates fields
- `deleteRequirement(id)` — cascades completions

#### Completions & Acknowledgments
- `completeRequirement(requirementId, method, notes?)` — creates completion for current employee. Calculates expiresAt for recurring requirements.
- `getMyPendingRequirements()` — requirements the current employee hasn't completed or has expired completions for
- `acknowledgePolicy(policyId)` — creates acknowledgment for current employee at current policy version
- `getPolicyAcknowledgmentStatus(policyId)` — acknowledged vs pending employees

#### Employee-Facing
- `getMyPolicySummary()` — pending acknowledgment count, pending training count, recent completions. Used by employee My Policies tab and workspace tile.

#### Dashboard
- `getPolicyDashboardMetrics()` — overall acknowledgment rate, overdue training count, lowest-compliance policies

#### Audit Logging
All write actions call the existing `logComplianceAction` helper from compliance.ts (or a re-exported version). The ComplianceAuditLog tracks policy actions with `entityType: "policy"`, `"requirement"`, `"completion"`, `"acknowledgment"`.

#### Calendar Integration
Uses the existing `ensureComplianceCalendarEvent` helper from compliance.ts. Policy review dates and training deadlines create compliance calendar events.

---

## Security & Access Control

- `view_compliance` (HR-000, HR-100, HR-200, HR-300) — read access to all policy data
- `manage_compliance` (HR-000, HR-200) — create, update, transition policies and requirements
- **Employee self-service** — any authenticated employee with an EmployeeProfile can:
  - View published policies and their own pending requirements
  - Acknowledge policies (`acknowledgePolicy`)
  - Complete requirements (`completeRequirement`)
  - View their own completion history (`getMyPolicySummary`, `getMyPendingRequirements`)
- PolicyAcknowledgment is **append-only** — no delete or update. Permanent audit record.
- RequirementCompletion status can transition to "expired" (system) or "revoked" (admin), but records are never deleted.
- Policy lifecycle transitions are enforced — invalid state transitions are rejected.
- Employees can only acknowledge/complete for themselves — `getSessionEmployeeId()` enforced.
- All actions logged to ComplianceAuditLog.

---

## Migration & Seed Strategy

### Schema Migration
Single Prisma migration adding:
- 5 new models: Policy, PolicyRequirement, RequirementCompletion, TrainingRequirement, PolicyAcknowledgment
- Reverse relation on Obligation (policies)
- 4 new reverse relations on EmployeeProfile

### Seed Data
None — policies are created by users. Example policies (acceptable use, building security, ethics training) can be created through the UI after deployment.

### Existing Data
No backfill required. No existing records affected. No breaking changes.

---

## Testing & Success Criteria

### Schema
- All 5 models create/read/update via Prisma
- PolicyAcknowledgment unique constraint on [policyId, employeeProfileId, policyVersion]
- RequirementCompletion unique constraint on [requirementId, employeeProfileId, status]
- Policy→Obligation link is optional (nullable FK)

### CRUD
- Policy lifecycle transitions: valid transitions succeed (draft→in-review, in-review→approved, approved→published, published→retired), invalid transitions rejected (draft→published, retired→published)
- createRequirement with training type creates both PolicyRequirement and TrainingRequirement
- acknowledgePolicy creates record; duplicate for same version rejected by unique constraint
- completeRequirement creates completion; calculates expiresAt for recurring requirements

### Employee Integration
- getMyPendingRequirements returns only incomplete/expired requirements for current employee
- acknowledgePolicy scoped to current user's EmployeeProfile — cannot acknowledge for others
- My Policies tab renders for the current employee

### Dashboard
- getPolicyDashboardMetrics returns accurate acknowledgment rates
- Overdue training count matches requirements with expired completions

### Permissions
- manage_compliance required for policy CRUD and lifecycle transitions
- Any authenticated employee can acknowledge and complete their own requirements
- Read access to published policies for all authenticated users

---

## Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/policy-types.ts` | TypeScript types, validators, ID generators, lifecycle constants |
| `apps/web/lib/policy-types.test.ts` | Type/validator tests |
| `apps/web/lib/actions/policy.ts` | All policy server actions |
| `apps/web/lib/actions/policy.test.ts` | Server action tests |
| `apps/web/app/(shell)/compliance/policies/page.tsx` | Policy list page |
| `apps/web/app/(shell)/compliance/policies/[id]/page.tsx` | Policy detail page |
| `apps/web/components/compliance/CreatePolicyForm.tsx` | Policy create modal form |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add 5 new models + reverse relations on Obligation and EmployeeProfile |
| `apps/web/components/compliance/ComplianceTabNav.tsx` | Add "Policies" tab |
| `apps/web/app/(shell)/compliance/page.tsx` | Add policy compliance metrics section |
| `apps/web/app/(shell)/workspace/page.tsx` | Add policy count to compliance tile + pending ack badge |
| `apps/web/components/employee/EmployeeTabNav.tsx` | Add "My Policies" tab |
| `apps/web/app/(shell)/employee/page.tsx` | Add My Policies view |

---

## Implementation Order

Eight chunks, sequenced by dependency:

### Chunk 1: Schema Migration
- Add 5 new models to schema.prisma
- Add Obligation reverse relation (policies)
- Add EmployeeProfile reverse relations
- Run prisma validate + generate
- **Gate:** Migration succeeds, client generates

### Chunk 2: Types and Validation
- policy-types.ts: ID generators, constants, input types, validators
- policy-types.test.ts: TDD tests
- **Gate:** All type tests pass

### Chunk 3: Server Actions — Policy CRUD + Lifecycle
- policy.ts: auth helpers, Policy CRUD, transitionPolicyStatus with state machine enforcement
- **Gate:** Create, update, lifecycle transitions work, audit log written

### Chunk 4: Server Actions — Requirements, Completions, Acknowledgments
- Append to policy.ts: PolicyRequirement CRUD, completeRequirement, acknowledgePolicy, getMyPendingRequirements, getMyPolicySummary, getPolicyAcknowledgmentStatus, getPolicyDashboardMetrics
- **Gate:** Full requirement→completion lifecycle works, employee self-service works

### Chunk 5: Policy List + Detail Pages + Create Form
- ComplianceTabNav update (add Policies tab)
- policies/page.tsx (list with filters)
- policies/[id]/page.tsx (detail with requirements + acknowledgments)
- CreatePolicyForm.tsx (modal)
- **Gate:** Pages render, create form works

### Chunk 6: Employee Integration
- EmployeeTabNav update (add My Policies tab)
- employee/page.tsx update (My Policies view with pending acks, pending training, history)
- **Gate:** Employees see pending policies, can acknowledge

### Chunk 7: Dashboard + Workspace Tile
- compliance/page.tsx update (policy compliance section)
- workspace/page.tsx update (policy metrics in tile)
- **Gate:** Dashboard shows policy compliance rates, tile shows counts

### Chunk 8: Tests + Final Verification
- policy.test.ts: auth, CRUD, lifecycle, acknowledgment, completion tests
- Run full test suite
- Type check
- **Gate:** All tests pass, no type errors

---

## Appendix: Backlog Item Mapping

| Backlog Item | Coverage in This Spec |
|---|---|
| Internal policy document lifecycle management | Sections 1.1 — Policy model with draft→review→approved→published→retired state machine |
| Policy requirements and employee obligations | Sections 1.2, 1.3, 1.4 — PolicyRequirement, RequirementCompletion, TrainingRequirement |
| Employee policy acknowledgment tracking | Sections 1.5, 5 — PolicyAcknowledgment + My Policies employee view |
| Link internal policies to regulatory obligations | Section 1.1 — Policy.obligationId optional FK to Obligation |
| Policy compliance dashboard metrics | Section 6 — acknowledgment rates, overdue training, lowest-compliance policies |
| Training requirement tracking with expiry | Sections 1.3, 1.4 — RequirementCompletion.expiresAt + TrainingRequirement metadata |
