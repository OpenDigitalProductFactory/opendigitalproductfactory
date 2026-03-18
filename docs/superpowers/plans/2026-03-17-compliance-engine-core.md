# EP-GRC-001: Compliance Engine Core — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the universal regulatory compliance lifecycle engine — 13 new schema tables, `/compliance` route with posture dashboard, server actions for full CRUD, immutable audit trail, integrated with CalendarEvent, EmployeeProfile, and AI coworker patterns.

**Architecture:** Engine-first approach — regulation-agnostic schema modeling the 5 universal compliance loops (Obligation→Control→Evidence, Risk→Control→Monitoring→Correction, Incident→Investigation→Correction→Verification, PDCA via Audit, Regulator→Submission→Acknowledgment). All write actions log to an append-only ComplianceAuditLog. Evidence records are immutable (supersede-only). Calendar deadlines flow through the existing CalendarEvent infrastructure.

**Tech Stack:** Next.js 14 (App Router, server components, server actions), Prisma (PostgreSQL), TypeScript, Vitest, existing platform UI patterns (dark theme, `var(--dpf-*)` CSS variables, centered modals, tab navigation).

**Spec:** `docs/superpowers/specs/2026-03-17-compliance-engine-core-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `packages/db/prisma/schema.prisma` (modify) | Add 13 new models + CalendarEvent extension + EmployeeProfile relations |
| `apps/web/lib/compliance-types.ts` | TypeScript types, input validators, ID generators, status constants |
| `apps/web/lib/actions/compliance.ts` | All compliance server actions (CRUD, linking, dashboard, audit log helper, calendar helper) |
| `apps/web/lib/permissions.ts` (modify) | Add `view_compliance`, `manage_compliance`, compliance tile |
| `apps/web/components/compliance/ComplianceTabNav.tsx` | Horizontal tab navigation for `/compliance` sub-routes |
| `apps/web/components/compliance/ComplianceModal.tsx` | Reusable create/edit modal (centered, dark theme) |
| `apps/web/app/(shell)/compliance/layout.tsx` | Auth gate + tab nav wrapper |
| `apps/web/app/(shell)/compliance/page.tsx` | Dashboard server component |
| `apps/web/app/(shell)/compliance/regulations/page.tsx` | Regulations list |
| `apps/web/app/(shell)/compliance/regulations/[id]/page.tsx` | Regulation detail + obligations |
| `apps/web/app/(shell)/compliance/obligations/page.tsx` | Obligations list |
| `apps/web/app/(shell)/compliance/controls/page.tsx` | Controls list |
| `apps/web/app/(shell)/compliance/evidence/page.tsx` | Evidence library |
| `apps/web/app/(shell)/compliance/risks/page.tsx` | Risk assessments |
| `apps/web/app/(shell)/compliance/incidents/page.tsx` | Incidents list |
| `apps/web/app/(shell)/compliance/audits/page.tsx` | Audits list |
| `apps/web/app/(shell)/compliance/audits/[id]/page.tsx` | Audit detail + findings |
| `apps/web/app/(shell)/compliance/actions/page.tsx` | Corrective actions list |
| `apps/web/app/(shell)/compliance/submissions/page.tsx` | Regulatory submissions list |
| `apps/web/app/(shell)/workspace/page.tsx` (modify) | Add compliance metric queries + tile status |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/compliance-types.test.ts` | Input validation, ID generation, status helpers |
| `apps/web/lib/actions/compliance.test.ts` | Server action auth checks, CRUD operations, audit log creation, evidence immutability, calendar integration |

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add Regulation and Obligation models to schema.prisma**

Add after the `// ─── Calendar ───` section (end of file). Include the section header:

```prisma
// ─── Compliance Engine ──────────────────────────────────────────────────────

model Regulation {
  id            String   @id @default(cuid())
  regulationId  String   @unique
  name          String
  shortName     String
  jurisdiction  String
  industry      String?
  sourceType    String   @default("external")
  effectiveDate DateTime?
  reviewDate    DateTime?
  sourceUrl     String?
  notes         String?
  agentId       String?
  status        String   @default("active")
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  obligations Obligation[]
  submissions RegulatorySubmission[]

  @@index([status])
  @@index([jurisdiction])
  @@index([sourceType])
}

model Obligation {
  id              String    @id @default(cuid())
  obligationId    String    @unique
  regulationId    String
  title           String
  description     String?
  reference       String?
  category        String?
  frequency       String?
  applicability   String?
  penaltySummary  String?
  ownerEmployeeId String?
  reviewDate      DateTime?
  agentId         String?
  status          String    @default("active")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  regulation    Regulation       @relation(fields: [regulationId], references: [id], onDelete: Restrict)
  ownerEmployee EmployeeProfile? @relation("ObligationOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  controls      ControlObligationLink[]
  evidence      ComplianceEvidence[]

  @@index([regulationId])
  @@index([ownerEmployeeId])
  @@index([status])
  @@index([category])
}
```

- [ ] **Step 2: Add Control and ControlObligationLink models**

```prisma
model Control {
  id                   String    @id @default(cuid())
  controlId            String    @unique
  title                String
  description          String?
  controlType          String
  implementationStatus String    @default("planned")
  ownerEmployeeId      String?
  reviewFrequency      String?
  lastReviewedAt       DateTime?
  nextReviewDate       DateTime?
  effectiveness        String?
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

- [ ] **Step 3: Add ComplianceEvidence model (with self-referential relation)**

```prisma
model ComplianceEvidence {
  id                    String    @id @default(cuid())
  evidenceId            String    @unique
  title                 String
  evidenceType          String
  description           String?
  obligationId          String?
  controlId             String?
  collectedAt           DateTime  @default(now())
  collectedByEmployeeId String?
  fileRef               String?
  retentionUntil        DateTime?
  supersededById        String?
  agentId               String?
  status                String    @default("active")
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  obligation   Obligation?         @relation(fields: [obligationId], references: [id], onDelete: SetNull)
  control      Control?            @relation(fields: [controlId], references: [id], onDelete: SetNull)
  collectedBy  EmployeeProfile?    @relation("EvidenceCollector", fields: [collectedByEmployeeId], references: [id], onDelete: SetNull)
  supersededBy ComplianceEvidence? @relation("EvidenceSupersession", fields: [supersededById], references: [id], onDelete: SetNull)
  supersedes   ComplianceEvidence[] @relation("EvidenceSupersession")

  @@index([obligationId])
  @@index([controlId])
  @@index([collectedByEmployeeId])
  @@index([status])
  @@index([evidenceType])
}
```

- [ ] **Step 4: Add RiskAssessment and RiskControl models**

```prisma
model RiskAssessment {
  id                   String    @id @default(cuid())
  assessmentId         String    @unique
  title                String
  scope                String?
  hazard               String
  likelihood           String
  severity             String
  inherentRisk         String
  residualRisk         String?
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

- [ ] **Step 5: Add ComplianceIncident and CorrectiveAction models**

```prisma
model ComplianceIncident {
  id                   String    @id @default(cuid())
  incidentId           String    @unique
  title                String
  description          String?
  occurredAt           DateTime
  detectedAt           DateTime?
  severity             String
  category             String?
  regulatoryNotifiable Boolean   @default(false)
  notificationDeadline DateTime?
  notifiedAt           DateTime?
  rootCause            String?
  riskAssessmentId     String?
  reportedByEmployeeId String?
  agentId              String?
  status               String    @default("open")
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
  id                   String    @id @default(cuid())
  actionId             String    @unique
  title                String
  description          String?
  rootCause            String?
  sourceType           String
  incidentId           String?
  auditFindingId       String?
  ownerEmployeeId      String?
  dueDate              DateTime?
  completedAt          DateTime?
  verificationMethod   String?
  verificationDate     DateTime?
  verifiedByEmployeeId String?
  agentId              String?
  status               String    @default("open")
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  incident     ComplianceIncident? @relation(fields: [incidentId], references: [id], onDelete: SetNull)
  auditFinding AuditFinding?       @relation(fields: [auditFindingId], references: [id], onDelete: SetNull)
  owner        EmployeeProfile?    @relation("CorrectiveActionOwner", fields: [ownerEmployeeId], references: [id], onDelete: SetNull)
  verifiedBy   EmployeeProfile?    @relation("CorrectiveActionVerifier", fields: [verifiedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([incidentId])
  @@index([auditFindingId])
  @@index([ownerEmployeeId])
  @@index([verifiedByEmployeeId])
  @@index([status])
  @@index([dueDate])
}
```

- [ ] **Step 6: Add ComplianceAudit, AuditFinding, RegulatorySubmission, ComplianceAuditLog models**

```prisma
model ComplianceAudit {
  id                String    @id @default(cuid())
  auditId           String    @unique
  title             String
  auditType         String
  scope             String?
  auditorName       String?
  auditorEmployeeId String?
  scheduledAt       DateTime?
  conductedAt       DateTime?
  completedAt       DateTime?
  overallRating     String?
  notes             String?
  agentId           String?
  status            String    @default("planned")
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  auditor  EmployeeProfile? @relation("AuditAuditor", fields: [auditorEmployeeId], references: [id], onDelete: SetNull)
  findings AuditFinding[]

  @@index([auditorEmployeeId])
  @@index([status])
  @@index([auditType])
}

model AuditFinding {
  id          String    @id @default(cuid())
  findingId   String    @unique
  auditId     String
  controlId   String?
  title       String
  description String?
  findingType String
  dueDate     DateTime?
  resolvedAt  DateTime?
  agentId     String?
  status      String    @default("open")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  audit             ComplianceAudit    @relation(fields: [auditId], references: [id], onDelete: Cascade)
  control           Control?           @relation(fields: [controlId], references: [id], onDelete: SetNull)
  correctiveActions CorrectiveAction[]

  @@index([auditId])
  @@index([controlId])
  @@index([status])
}

model RegulatorySubmission {
  id                    String    @id @default(cuid())
  submissionId          String    @unique
  title                 String
  regulationId          String?
  recipientBody         String
  submissionType        String
  submittedAt           DateTime?
  dueDate               DateTime?
  submittedByEmployeeId String?
  confirmationRef       String?
  responseReceived      Boolean   @default(false)
  responseDate          DateTime?
  responseSummary       String?
  notes                 String?
  agentId               String?
  status                String    @default("draft")
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  regulation  Regulation?      @relation(fields: [regulationId], references: [id], onDelete: SetNull)
  submittedBy EmployeeProfile? @relation("SubmissionSubmitter", fields: [submittedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([regulationId])
  @@index([submittedByEmployeeId])
  @@index([status])
  @@index([dueDate])
}

// Intentionally omits status and updatedAt — records are permanent and immutable.
model ComplianceAuditLog {
  id                    String   @id @default(cuid())
  entityType            String
  entityId              String
  action                String
  field                 String?
  oldValue              String?
  newValue              String?
  performedByEmployeeId String?
  agentId               String?
  performedAt           DateTime @default(now())
  notes                 String?

  performedBy EmployeeProfile? @relation("ComplianceAuditLogActor", fields: [performedByEmployeeId], references: [id], onDelete: SetNull)

  @@index([entityType, entityId])
  @@index([performedByEmployeeId])
  @@index([performedAt])
}
```

- [ ] **Step 7: Add CalendarEvent extension fields**

Find the existing `CalendarEvent` model and add two fields before the closing `}`:

```prisma
  complianceEntityType String?
  complianceEntityId   String?

  @@index([complianceEntityType, complianceEntityId])
```

- [ ] **Step 8: Add EmployeeProfile reverse relations**

Find the existing `EmployeeProfile` model and add these relations before the closing `}`:

```prisma
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
```

- [ ] **Step 9: Run migration**

Run: `cd packages/db && npx prisma migrate dev --name compliance_engine_core`
Expected: Migration succeeds, all 13 tables created, CalendarEvent extended.

- [ ] **Step 10: Verify Prisma client generation**

Run: `cd packages/db && npx prisma generate`
Expected: Client generated with all new models accessible.

- [ ] **Step 11: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add compliance engine core schema — 13 new models"
```

---

## Task 2: Types and Validation

**Files:**
- Create: `apps/web/lib/compliance-types.ts`
- Create: `apps/web/lib/compliance-types.test.ts`

- [ ] **Step 1: Write failing tests for compliance types**

```ts
// apps/web/lib/compliance-types.test.ts
import { describe, expect, it } from "vitest";
import {
  generateRegulationId,
  generateObligationId,
  generateControlId,
  generateEvidenceId,
  generateIncidentId,
  generateActionId,
  generateAuditId,
  generateFindingId,
  generateSubmissionId,
  generateAssessmentId,
  validateRegulationInput,
  validateObligationInput,
  validateControlInput,
  REGULATION_STATUSES,
  OBLIGATION_CATEGORIES,
  CONTROL_TYPES,
  EVIDENCE_TYPES,
  RISK_LIKELIHOODS,
  RISK_SEVERITIES,
  INCIDENT_SEVERITIES,
} from "./compliance-types";

describe("ID generators", () => {
  it("generates unique regulation IDs with REG- prefix", () => {
    const id1 = generateRegulationId();
    const id2 = generateRegulationId();
    expect(id1).toMatch(/^REG-[A-Z0-9]{8}$/);
    expect(id1).not.toBe(id2);
  });

  it("generates unique obligation IDs with OBL- prefix", () => {
    expect(generateObligationId()).toMatch(/^OBL-[A-Z0-9]{8}$/);
  });

  it("generates unique control IDs with CTL- prefix", () => {
    expect(generateControlId()).toMatch(/^CTL-[A-Z0-9]{8}$/);
  });

  it("generates unique evidence IDs with EVD- prefix", () => {
    expect(generateEvidenceId()).toMatch(/^EVD-[A-Z0-9]{8}$/);
  });

  it("generates unique incident IDs with INC- prefix", () => {
    expect(generateIncidentId()).toMatch(/^INC-[A-Z0-9]{8}$/);
  });

  it("generates unique corrective action IDs with CA- prefix", () => {
    expect(generateActionId()).toMatch(/^CA-[A-Z0-9]{8}$/);
  });

  it("generates unique audit IDs with AUD- prefix", () => {
    expect(generateAuditId()).toMatch(/^AUD-[A-Z0-9]{8}$/);
  });

  it("generates unique finding IDs with FND- prefix", () => {
    expect(generateFindingId()).toMatch(/^FND-[A-Z0-9]{8}$/);
  });

  it("generates unique submission IDs with SUB- prefix", () => {
    expect(generateSubmissionId()).toMatch(/^SUB-[A-Z0-9]{8}$/);
  });

  it("generates unique assessment IDs with RA- prefix", () => {
    expect(generateAssessmentId()).toMatch(/^RA-[A-Z0-9]{8}$/);
  });
});

describe("validateRegulationInput", () => {
  it("returns null for valid input", () => {
    expect(validateRegulationInput({ name: "GDPR", shortName: "GDPR", jurisdiction: "EU" })).toBeNull();
  });

  it("rejects empty name", () => {
    expect(validateRegulationInput({ name: "", shortName: "GDPR", jurisdiction: "EU" })).toBe("Name is required.");
  });

  it("rejects empty shortName", () => {
    expect(validateRegulationInput({ name: "GDPR", shortName: "  ", jurisdiction: "EU" })).toBe("Short name is required.");
  });

  it("rejects empty jurisdiction", () => {
    expect(validateRegulationInput({ name: "GDPR", shortName: "GDPR", jurisdiction: "" })).toBe("Jurisdiction is required.");
  });
});

describe("validateObligationInput", () => {
  it("returns null for valid input", () => {
    expect(validateObligationInput({ title: "Breach notification", regulationId: "abc" })).toBeNull();
  });

  it("rejects empty title", () => {
    expect(validateObligationInput({ title: "", regulationId: "abc" })).toBe("Title is required.");
  });

  it("rejects missing regulationId", () => {
    expect(validateObligationInput({ title: "Test", regulationId: "" })).toBe("Regulation is required.");
  });
});

describe("validateControlInput", () => {
  it("returns null for valid input", () => {
    expect(validateControlInput({ title: "Appoint DPO", controlType: "preventive" })).toBeNull();
  });

  it("rejects invalid controlType", () => {
    expect(validateControlInput({ title: "Test", controlType: "invalid" })).toBe("Control type must be one of: preventive, detective, corrective.");
  });
});

describe("constants", () => {
  it("exports expected regulation statuses", () => {
    expect(REGULATION_STATUSES).toContain("active");
    expect(REGULATION_STATUSES).toContain("inactive");
    expect(REGULATION_STATUSES).toContain("superseded");
  });

  it("exports expected control types", () => {
    expect(CONTROL_TYPES).toEqual(["preventive", "detective", "corrective"]);
  });

  it("exports expected evidence types", () => {
    expect(EVIDENCE_TYPES).toContain("policy");
    expect(EVIDENCE_TYPES).toContain("training-record");
    expect(EVIDENCE_TYPES).toContain("audit-report");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/compliance-types.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement compliance-types.ts**

```ts
// apps/web/lib/compliance-types.ts
import * as crypto from "crypto";

// ─── ID Generators ──────────────────────────────────────────────────────────

function genId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export const generateRegulationId = () => genId("REG");
export const generateObligationId = () => genId("OBL");
export const generateControlId = () => genId("CTL");
export const generateEvidenceId = () => genId("EVD");
export const generateIncidentId = () => genId("INC");
export const generateActionId = () => genId("CA");
export const generateAuditId = () => genId("AUD");
export const generateFindingId = () => genId("FND");
export const generateSubmissionId = () => genId("SUB");
export const generateAssessmentId = () => genId("RA");

// ─── Constants ──────────────────────────────────────────────────────────────

export const REGULATION_STATUSES = ["active", "inactive", "superseded"] as const;
export const REGULATION_SOURCE_TYPES = ["external", "internal"] as const;

export const OBLIGATION_CATEGORIES = [
  "data-protection", "safety", "financial-reporting", "environmental",
  "cybersecurity", "employment", "operational", "other",
] as const;
export const OBLIGATION_FREQUENCIES = ["event-driven", "annual", "quarterly", "monthly", "continuous"] as const;

export const CONTROL_TYPES = ["preventive", "detective", "corrective"] as const;
export const CONTROL_IMPLEMENTATION_STATUSES = ["planned", "in-progress", "implemented", "not-applicable"] as const;
export const CONTROL_EFFECTIVENESS = ["effective", "partially-effective", "ineffective", "not-assessed"] as const;

export const EVIDENCE_TYPES = [
  "policy", "procedure", "training-record", "audit-report", "test-result",
  "incident-report", "approval", "submission", "assessment", "other",
] as const;

export const RISK_LIKELIHOODS = ["rare", "unlikely", "possible", "likely", "almost-certain"] as const;
export const RISK_SEVERITIES = ["negligible", "minor", "moderate", "major", "catastrophic"] as const;
export const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

export const INCIDENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const INCIDENT_CATEGORIES = [
  "data-breach", "safety", "financial", "environmental", "operational", "other",
] as const;
export const INCIDENT_STATUSES = ["open", "investigating", "remediated", "closed"] as const;

export const CORRECTIVE_ACTION_STATUSES = ["open", "in-progress", "completed", "verified", "overdue"] as const;
export const CORRECTIVE_ACTION_SOURCE_TYPES = ["incident", "audit-finding", "gap-assessment", "management-review"] as const;

export const AUDIT_TYPES = ["internal", "external", "certification", "regulatory-inspection"] as const;
export const AUDIT_STATUSES = ["planned", "in-progress", "completed", "cancelled"] as const;
export const AUDIT_RATINGS = ["conforming", "minor-nonconformity", "major-nonconformity", "observation"] as const;

export const FINDING_TYPES = ["nonconformity-major", "nonconformity-minor", "observation", "opportunity"] as const;

export const SUBMISSION_TYPES = ["breach-notification", "annual-report", "certification", "license-renewal", "incident-report"] as const;
export const SUBMISSION_STATUSES = ["draft", "pending", "submitted", "acknowledged", "rejected"] as const;

// ─── Input Types ────────────────────────────────────────────────────────────

export type RegulationInput = {
  name: string;
  shortName: string;
  jurisdiction: string;
  industry?: string | null;
  sourceType?: string;
  effectiveDate?: Date | null;
  reviewDate?: Date | null;
  sourceUrl?: string | null;
  notes?: string | null;
};

export type ObligationInput = {
  title: string;
  regulationId: string;
  description?: string | null;
  reference?: string | null;
  category?: string | null;
  frequency?: string | null;
  applicability?: string | null;
  penaltySummary?: string | null;
  ownerEmployeeId?: string | null;
  reviewDate?: Date | null;
};

export type ControlInput = {
  title: string;
  controlType: string;
  description?: string | null;
  implementationStatus?: string;
  ownerEmployeeId?: string | null;
  reviewFrequency?: string | null;
  nextReviewDate?: Date | null;
  effectiveness?: string | null;
};

export type EvidenceInput = {
  title: string;
  evidenceType: string;
  description?: string | null;
  obligationId?: string | null;
  controlId?: string | null;
  collectedByEmployeeId?: string | null;
  fileRef?: string | null;
  retentionUntil?: Date | null;
};

export type RiskAssessmentInput = {
  title: string;
  hazard: string;
  likelihood: string;
  severity: string;
  inherentRisk: string;
  scope?: string | null;
  residualRisk?: string | null;
  assessedByEmployeeId?: string | null;
  nextReviewDate?: Date | null;
  notes?: string | null;
};

export type IncidentInput = {
  title: string;
  occurredAt: Date;
  severity: string;
  description?: string | null;
  detectedAt?: Date | null;
  category?: string | null;
  regulatoryNotifiable?: boolean;
  notificationDeadline?: Date | null;
  rootCause?: string | null;
  riskAssessmentId?: string | null;
  reportedByEmployeeId?: string | null;
};

export type CorrectiveActionInput = {
  title: string;
  sourceType: string;
  description?: string | null;
  rootCause?: string | null;
  incidentId?: string | null;
  auditFindingId?: string | null;
  ownerEmployeeId?: string | null;
  dueDate?: Date | null;
};

export type AuditInput = {
  title: string;
  auditType: string;
  scope?: string | null;
  auditorName?: string | null;
  auditorEmployeeId?: string | null;
  scheduledAt?: Date | null;
  notes?: string | null;
};

export type FindingInput = {
  title: string;
  findingType: string;
  controlId?: string | null;
  description?: string | null;
  dueDate?: Date | null;
};

export type SubmissionInput = {
  title: string;
  recipientBody: string;
  submissionType: string;
  regulationId?: string | null;
  dueDate?: Date | null;
  submittedByEmployeeId?: string | null;
  notes?: string | null;
};

// ─── Validators ─────────────────────────────────────────────────────────────

export function validateRegulationInput(input: Pick<RegulationInput, "name" | "shortName" | "jurisdiction">): string | null {
  if (!input.name.trim()) return "Name is required.";
  if (!input.shortName.trim()) return "Short name is required.";
  if (!input.jurisdiction.trim()) return "Jurisdiction is required.";
  return null;
}

export function validateObligationInput(input: Pick<ObligationInput, "title" | "regulationId">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!input.regulationId.trim()) return "Regulation is required.";
  return null;
}

export function validateControlInput(input: Pick<ControlInput, "title" | "controlType">): string | null {
  if (!input.title.trim()) return "Title is required.";
  if (!(CONTROL_TYPES as readonly string[]).includes(input.controlType)) {
    return `Control type must be one of: ${CONTROL_TYPES.join(", ")}.`;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/compliance-types.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/compliance-types.ts apps/web/lib/compliance-types.test.ts
git commit -m "feat: add compliance types, validators, and ID generators"
```

---

## Task 3: Permissions and Workspace Tile

**Files:**
- Modify: `apps/web/lib/permissions.ts`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`

- [ ] **Step 1: Add compliance capabilities and tile to permissions.ts**

In `CapabilityKey` type, add:
```ts
| "view_compliance"
| "manage_compliance"
```

In `PERMISSIONS`, add:
```ts
view_compliance:   { roles: ["HR-000", "HR-100", "HR-200", "HR-300"] },
manage_compliance: { roles: ["HR-000", "HR-200"] },
```

In `ALL_TILES`, add after the `admin` tile:
```ts
{ key: "compliance", label: "Compliance", route: "/compliance", capabilityKey: "view_compliance", accentColor: "#ef4444" },
```

- [ ] **Step 2: Add compliance metrics to workspace page**

In `apps/web/app/(shell)/workspace/page.tsx`, add to the `Promise.all` array:
```ts
prisma.obligation.count({ where: { status: "active" } }),
prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
prisma.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
prisma.control.count({ where: { status: "active" } }),
prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
```

Add corresponding destructured variables: `activeObligationCount`, `openIncidentCount`, `implementedControlCount`, `totalControlCount`, `overdueActionCount`.

Add to `tileStatus`:
```ts
compliance: {
  metrics: [
    { label: "Obligations", value: activeObligationCount, color: "#ef4444" },
    { label: "Open incidents", value: openIncidentCount, color: openIncidentCount > 0 ? "#fbbf24" : "#4ade80" },
    { label: "Controls", value: `${implementedControlCount}/${totalControlCount}`, color: "#38bdf8" },
  ],
  ...(overdueActionCount > 0
    ? { badge: `${overdueActionCount} overdue item${overdueActionCount !== 1 ? "s" : ""}`, badgeColor: "#fbbf24" }
    : {}),
},
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/permissions.ts apps/web/app/(shell)/workspace/page.tsx
git commit -m "feat: add compliance workspace tile and permissions"
```

---

## Task 4: Server Actions — Core CRUD (Regulation, Obligation, Control)

**Files:**
- Create: `apps/web/lib/actions/compliance.ts`

- [ ] **Step 1: Create compliance.ts with auth helpers, audit log helper, and Regulation CRUD**

Follow the pattern from `backlog.ts` — `requireManageCompliance()` helper, session-based auth, `revalidatePath("/compliance")` after writes.

```ts
"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { revalidatePath } from "next/cache";
import {
  generateRegulationId, generateObligationId, generateControlId,
  validateRegulationInput, validateObligationInput, validateControlInput,
  type RegulationInput, type ObligationInput, type ControlInput,
} from "@/lib/compliance-types";

export type ComplianceActionResult = { ok: boolean; message: string; id?: string };

async function requireViewCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function requireManageCompliance() {
  const session = await auth();
  if (!session?.user || !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_compliance")) {
    throw new Error("Unauthorized");
  }
  return session.user;
}

async function getSessionEmployeeId(): Promise<string | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const profile = await prisma.employeeProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } });
  return profile?.id ?? null;
}

async function logComplianceAction(
  entityType: string, entityId: string, action: string,
  performedByEmployeeId: string | null, agentId: string | null,
  details?: { field?: string; oldValue?: string; newValue?: string; notes?: string },
) {
  await prisma.complianceAuditLog.create({
    data: {
      entityType, entityId, action,
      performedByEmployeeId, agentId,
      field: details?.field ?? null,
      oldValue: details?.oldValue ?? null,
      newValue: details?.newValue ?? null,
      notes: details?.notes ?? null,
    },
  });
}

// ─── Regulation ─────────────────────────────────────────────────────────────

export async function listRegulations(filters?: { status?: string; jurisdiction?: string; sourceType?: string }) {
  await requireViewCompliance();
  return prisma.regulation.findMany({
    where: {
      ...(filters?.status && { status: filters.status }),
      ...(filters?.jurisdiction && { jurisdiction: filters.jurisdiction }),
      ...(filters?.sourceType && { sourceType: filters.sourceType }),
    },
    orderBy: { shortName: "asc" },
  });
}

export async function getRegulation(id: string) {
  await requireViewCompliance();
  return prisma.regulation.findUniqueOrThrow({
    where: { id },
    include: { obligations: { orderBy: { title: "asc" } } },
  });
}

export async function createRegulation(input: RegulationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateRegulationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const regulationId = generateRegulationId();

  const record = await prisma.regulation.create({
    data: {
      regulationId,
      name: input.name.trim(),
      shortName: input.shortName.trim(),
      jurisdiction: input.jurisdiction.trim(),
      industry: input.industry ?? null,
      sourceType: input.sourceType ?? "external",
      effectiveDate: input.effectiveDate ?? null,
      reviewDate: input.reviewDate ?? null,
      sourceUrl: input.sourceUrl ?? null,
      notes: input.notes ?? null,
    },
  });

  await logComplianceAction("regulation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: `Regulation ${input.shortName} created.`, id: record.id };
}

export async function updateRegulation(id: string, input: Partial<RegulationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: {
    ...(input.name !== undefined && { name: input.name.trim() }),
    ...(input.shortName !== undefined && { shortName: input.shortName.trim() }),
    ...(input.jurisdiction !== undefined && { jurisdiction: input.jurisdiction.trim() }),
    ...(input.industry !== undefined && { industry: input.industry }),
    ...(input.sourceType !== undefined && { sourceType: input.sourceType }),
    ...(input.effectiveDate !== undefined && { effectiveDate: input.effectiveDate }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
    ...(input.sourceUrl !== undefined && { sourceUrl: input.sourceUrl }),
    ...(input.notes !== undefined && { notes: input.notes }),
  }});

  await logComplianceAction("regulation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation updated." };
}

export async function deactivateRegulation(id: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.regulation.update({ where: { id }, data: { status: "inactive" } });
  await logComplianceAction("regulation", id, "status-changed", employeeId, null, { field: "status", newValue: "inactive" });
  revalidatePath("/compliance");
  return { ok: true, message: "Regulation deactivated." };
}
```

- [ ] **Step 2: Add Obligation CRUD**

Append to `compliance.ts`:

```ts
// ─── Obligation ─────────────────────────────────────────────────────────────

export async function listObligations(filters?: { regulationId?: string; category?: string; ownerEmployeeId?: string; status?: string }) {
  await requireViewCompliance();
  return prisma.obligation.findMany({
    where: {
      ...(filters?.regulationId && { regulationId: filters.regulationId }),
      ...(filters?.category && { category: filters.category }),
      ...(filters?.ownerEmployeeId && { ownerEmployeeId: filters.ownerEmployeeId }),
      ...(filters?.status ? { status: filters.status } : { status: "active" }),
    },
    include: { regulation: { select: { shortName: true, jurisdiction: true } }, ownerEmployee: { select: { id: true, displayName: true } } },
    orderBy: { title: "asc" },
  });
}

export async function getObligation(id: string) {
  await requireViewCompliance();
  return prisma.obligation.findUniqueOrThrow({
    where: { id },
    include: {
      regulation: true,
      ownerEmployee: { select: { id: true, displayName: true } },
      controls: { include: { control: true } },
      evidence: { where: { status: "active" }, orderBy: { collectedAt: "desc" } },
    },
  });
}

export async function createObligation(input: ObligationInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const error = validateObligationInput(input);
  if (error) return { ok: false, message: error };

  const employeeId = await getSessionEmployeeId();
  const record = await prisma.obligation.create({
    data: {
      obligationId: generateObligationId(),
      regulationId: input.regulationId,
      title: input.title.trim(),
      description: input.description ?? null,
      reference: input.reference ?? null,
      category: input.category ?? null,
      frequency: input.frequency ?? null,
      applicability: input.applicability ?? null,
      penaltySummary: input.penaltySummary ?? null,
      ownerEmployeeId: input.ownerEmployeeId ?? null,
      reviewDate: input.reviewDate ?? null,
    },
  });

  await logComplianceAction("obligation", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: `Obligation created.`, id: record.id };
}

export async function updateObligation(id: string, input: Partial<ObligationInput>): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.obligation.update({ where: { id }, data: {
    ...(input.title !== undefined && { title: input.title.trim() }),
    ...(input.description !== undefined && { description: input.description }),
    ...(input.reference !== undefined && { reference: input.reference }),
    ...(input.category !== undefined && { category: input.category }),
    ...(input.frequency !== undefined && { frequency: input.frequency }),
    ...(input.applicability !== undefined && { applicability: input.applicability }),
    ...(input.penaltySummary !== undefined && { penaltySummary: input.penaltySummary }),
    ...(input.ownerEmployeeId !== undefined && { ownerEmployeeId: input.ownerEmployeeId }),
    ...(input.reviewDate !== undefined && { reviewDate: input.reviewDate }),
  }});

  await logComplianceAction("obligation", id, "updated", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Obligation updated." };
}
```

- [ ] **Step 3: Add Control CRUD and linking actions**

Append to `compliance.ts` — Control CRUD follows the same pattern as Regulation/Obligation. The linking functions are the novel pattern:

```ts
// ─── Control ────────────────────────────────────────────────────────────────

// listControls, getControl, createControl, updateControl — follow Regulation pattern

// ─── Control ↔ Obligation Linking ───────────────────────────────────────────

export async function linkControlToObligation(controlId: string, obligationId: string, notes?: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const existing = await prisma.controlObligationLink.findUnique({ where: { controlId_obligationId: { controlId, obligationId } } });
  if (existing) return { ok: false, message: "Link already exists." };

  await prisma.controlObligationLink.create({ data: { controlId, obligationId, notes: notes ?? null } });
  await logComplianceAction("control", controlId, "linked", employeeId, null, { notes: `Linked to obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Control linked to obligation." };
}

export async function unlinkControlFromObligation(controlId: string, obligationId: string): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.controlObligationLink.delete({ where: { controlId_obligationId: { controlId, obligationId } } });
  await logComplianceAction("control", controlId, "unlinked", employeeId, null, { notes: `Unlinked from obligation ${obligationId}` });
  revalidatePath("/compliance");
  return { ok: true, message: "Link removed." };
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/compliance.ts
git commit -m "feat: add compliance server actions — regulation, obligation, control CRUD"
```

---

## Task 5: Server Actions — Risk, Incident, Corrective Action

**Files:**
- Modify: `apps/web/lib/actions/compliance.ts`

- [ ] **Step 1: Add RiskAssessment + RiskControl CRUD and linking**

Append RiskAssessment `list`, `get`, `create`, `update` + `linkRiskToControl` / `unlinkRiskFromControl`.

- [ ] **Step 2: Add ComplianceIncident CRUD with CalendarEvent creation**

Append Incident `list`, `get`, `create`, `update`. The `createIncident` action auto-creates a CalendarEvent when notifiable:

```ts
export async function createIncident(input: IncidentInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  const record = await prisma.complianceIncident.create({ data: {
    incidentId: generateIncidentId(),
    title: input.title.trim(),
    description: input.description ?? null,
    occurredAt: input.occurredAt,
    detectedAt: input.detectedAt ?? null,
    severity: input.severity,
    category: input.category ?? null,
    regulatoryNotifiable: input.regulatoryNotifiable ?? false,
    notificationDeadline: input.notificationDeadline ?? null,
    rootCause: input.rootCause ?? null,
    riskAssessmentId: input.riskAssessmentId ?? null,
    reportedByEmployeeId: input.reportedByEmployeeId ?? employeeId,
  }});

  // Auto-create calendar deadline for notifiable incidents
  if (input.regulatoryNotifiable && input.notificationDeadline && employeeId) {
    await ensureComplianceCalendarEvent(
      "incident-notification", record.id,
      `REGULATORY NOTIFICATION: ${input.title}`,
      input.notificationDeadline, employeeId,
    );
  }

  await logComplianceAction("incident", record.id, "created", employeeId, null);
  revalidatePath("/compliance");
  return { ok: true, message: "Incident recorded.", id: record.id };
}
```

- [ ] **Step 3: Add ensureComplianceCalendarEvent helper**

```ts
async function ensureComplianceCalendarEvent(
  entityType: string, entityId: string, title: string,
  dueDate: Date, ownerEmployeeId: string, recurrence?: string,
) {
  const eventId = `CE-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.calendarEvent.create({
    data: {
      eventId,
      title,
      startAt: dueDate,
      allDay: true,
      eventType: "deadline",
      category: "compliance",
      ownerEmployeeId,
      visibility: "team",
      recurrence: recurrence ?? null,
      complianceEntityType: entityType,
      complianceEntityId: entityId,
    },
  });
}
```

- [ ] **Step 4: Add CorrectiveAction CRUD + verifyCorrectiveAction**

Append CorrectiveAction `list`, `get`, `create`, `update` (follow Regulation pattern). The verification workflow is business-critical:

```ts
export async function verifyCorrectiveAction(
  id: string, verifiedByEmployeeId: string, method: string,
): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  await prisma.correctiveAction.update({ where: { id }, data: {
    verificationMethod: method,
    verificationDate: new Date(),
    verifiedByEmployeeId,
    status: "verified",
  }});

  await logComplianceAction("corrective-action", id, "status-changed", employeeId, null, {
    field: "status", oldValue: "completed", newValue: "verified",
    notes: `Verified by ${verifiedByEmployeeId} — method: ${method}`,
  });
  revalidatePath("/compliance");
  return { ok: true, message: "Corrective action verified." };
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/compliance.ts
git commit -m "feat: add compliance actions — risk, incident, corrective action CRUD"
```

---

## Task 6: Server Actions — Audit, Evidence, Submission, Dashboard

**Files:**
- Modify: `apps/web/lib/actions/compliance.ts`

- [ ] **Step 1: Add ComplianceAudit + AuditFinding CRUD**

Audit `list`, `get`, `create`, `update`. AuditFinding `createAuditFinding`, `updateAuditFinding`. `createAudit` should call `ensureComplianceCalendarEvent` if `scheduledAt` is set.

- [ ] **Step 2: Add ComplianceEvidence create + supersede (immutable)**

```ts
export async function createEvidence(input: EvidenceInput): Promise<ComplianceActionResult> {
  // ... auth, validate, create with generateEvidenceId(), log, revalidate
}

export async function supersedeEvidence(existingId: string, newInput: EvidenceInput): Promise<ComplianceActionResult> {
  await requireManageCompliance();
  const employeeId = await getSessionEmployeeId();

  // Interactive transaction — atomic: create new record, then update old with pointer
  const newRecord = await prisma.$transaction(async (tx) => {
    const created = await tx.complianceEvidence.create({ data: {
      evidenceId: generateEvidenceId(),
      title: newInput.title.trim(),
      evidenceType: newInput.evidenceType,
      description: newInput.description ?? null,
      obligationId: newInput.obligationId ?? null,
      controlId: newInput.controlId ?? null,
      collectedByEmployeeId: newInput.collectedByEmployeeId ?? employeeId,
      fileRef: newInput.fileRef ?? null,
      retentionUntil: newInput.retentionUntil ?? null,
    }});
    await tx.complianceEvidence.update({ where: { id: existingId }, data: {
      status: "superseded",
      supersededById: created.id,
    }});
    return created;
  });

  await logComplianceAction("evidence", newRecord.id, "created", employeeId, null, { notes: `Supersedes ${existingId}` });
  await logComplianceAction("evidence", existingId, "superseded", employeeId, null, { field: "status", newValue: "superseded" });
  revalidatePath("/compliance");
  return { ok: true, message: "Evidence superseded.", id: newRecord.id };
}
```

Note: No `updateEvidence` function exists — evidence is immutable.

- [ ] **Step 3: Add RegulatorySubmission CRUD**

Submission `list`, `create`, `update`. `createSubmission` calls `ensureComplianceCalendarEvent` if `dueDate` is set.

- [ ] **Step 4: Add getComplianceDashboard aggregation**

```ts
export async function getComplianceDashboard() {
  await requireViewCompliance();

  const [
    obligationCount,
    implementedControlCount,
    totalControlCount,
    openIncidentCount,
    overdueActionCount,
    upcomingDeadlines,
    recentActivity,
    regulations,
  ] = await Promise.all([
    prisma.obligation.count({ where: { status: "active" } }),
    prisma.control.count({ where: { implementationStatus: "implemented", status: "active" } }),
    prisma.control.count({ where: { status: "active" } }),
    prisma.complianceIncident.count({ where: { status: { in: ["open", "investigating"] } } }),
    prisma.correctiveAction.count({ where: { status: { in: ["open", "in-progress"] }, dueDate: { lt: new Date() } } }),
    prisma.calendarEvent.findMany({
      where: { complianceEntityType: { not: null }, startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 5,
    }),
    prisma.complianceAuditLog.findMany({ orderBy: { performedAt: "desc" }, take: 10, include: { performedBy: { select: { displayName: true } } } }),
    prisma.regulation.findMany({ where: { status: "active" }, include: { _count: { select: { obligations: true } } } }),
  ]);

  return {
    obligationCount,
    controlCoverage: { implemented: implementedControlCount, total: totalControlCount },
    openIncidentCount,
    overdueActionCount,
    upcomingDeadlines,
    recentActivity,
    regulationSummaries: await Promise.all(regulations.map(async (r) => {
      // Per-regulation control coverage: find controls linked to this regulation's obligations
      const oblIds = (await prisma.obligation.findMany({ where: { regulationId: r.id, status: "active" }, select: { id: true } })).map((o) => o.id);
      const linkedControlIds = oblIds.length > 0
        ? [...new Set((await prisma.controlObligationLink.findMany({ where: { obligationId: { in: oblIds } }, select: { controlId: true } })).map((c) => c.controlId))]
        : [];
      const implCount = linkedControlIds.length > 0
        ? await prisma.control.count({ where: { id: { in: linkedControlIds }, implementationStatus: "implemented", status: "active" } })
        : 0;
      return {
        id: r.id, shortName: r.shortName, jurisdiction: r.jurisdiction,
        obligationCount: r._count.obligations,
        controlCoverage: linkedControlIds.length > 0 ? Math.round((implCount / linkedControlIds.length) * 100) : 0,
        openIncidents: 0, // Scoped to regulation in EP-GRC-003 — show 0 for now
      };
    })),
  };
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/compliance.ts
git commit -m "feat: add compliance actions — audit, evidence, submission, dashboard"
```

---

## Task 7: Compliance Layout and Tab Navigation

**Files:**
- Create: `apps/web/components/compliance/ComplianceTabNav.tsx`
- Create: `apps/web/app/(shell)/compliance/layout.tsx`

- [ ] **Step 1: Create ComplianceTabNav component**

Follow the `OpsTabNav` pattern from `apps/web/components/ops/OpsTabNav.tsx`:

```tsx
// apps/web/components/compliance/ComplianceTabNav.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "Dashboard", href: "/compliance" },
  { label: "Regulations", href: "/compliance/regulations" },
  { label: "Obligations", href: "/compliance/obligations" },
  { label: "Controls", href: "/compliance/controls" },
  { label: "Evidence", href: "/compliance/evidence" },
  { label: "Risks", href: "/compliance/risks" },
  { label: "Incidents", href: "/compliance/incidents" },
  { label: "Audits", href: "/compliance/audits" },
  { label: "Actions", href: "/compliance/actions" },
  { label: "Submissions", href: "/compliance/submissions" },
];

export function ComplianceTabNav() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/compliance" ? pathname === "/compliance" : pathname.startsWith(href);

  return (
    <div className="flex gap-1 mb-6 border-b border-[var(--dpf-border)] overflow-x-auto">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={[
            "px-3 py-1.5 text-xs font-medium rounded-t transition-colors whitespace-nowrap",
            active(t.href)
              ? "text-white border-b-2 border-[var(--dpf-accent)]"
              : "text-[var(--dpf-muted)] hover:text-white",
          ].join(" ")}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create compliance layout with auth gate**

Follow the pattern from `apps/web/app/(shell)/ops/layout.tsx`:

```tsx
// apps/web/app/(shell)/compliance/layout.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { ComplianceTabNav } from "@/components/compliance/ComplianceTabNav";

export default async function ComplianceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (
    !session?.user ||
    !can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "view_compliance")
  ) {
    notFound();
  }

  return (
    <>
      <ComplianceTabNav />
      {children}
    </>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/compliance/ComplianceTabNav.tsx apps/web/app/(shell)/compliance/layout.tsx
git commit -m "feat: add compliance layout with auth gate and tab navigation"
```

---

## Task 8: Dashboard Page

**Files:**
- Create: `apps/web/app/(shell)/compliance/page.tsx`

- [ ] **Step 1: Create dashboard server component**

Follow the pattern from `apps/web/app/(shell)/ops/page.tsx`:

```tsx
// apps/web/app/(shell)/compliance/page.tsx
import { getComplianceDashboard } from "@/lib/actions/compliance";

export default async function CompliancePage() {
  const dashboard = await getComplianceDashboard();

  const coveragePct = dashboard.controlCoverage.total > 0
    ? Math.round((dashboard.controlCoverage.implemented / dashboard.controlCoverage.total) * 100)
    : 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Compliance</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          {dashboard.regulationSummaries.length} regulation{dashboard.regulationSummaries.length !== 1 ? "s" : ""} · {dashboard.obligationCount} obligation{dashboard.obligationCount !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Posture Summary — 4 metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Obligations" value={dashboard.obligationCount} color="#ef4444" />
        <MetricCard label="Control Coverage" value={`${coveragePct}%`} color={coveragePct >= 80 ? "#4ade80" : "#fbbf24"} />
        <MetricCard label="Open Incidents" value={dashboard.openIncidentCount} color={dashboard.openIncidentCount > 0 ? "#ef4444" : "#4ade80"} />
        <MetricCard label="Overdue Actions" value={dashboard.overdueActionCount} color={dashboard.overdueActionCount > 0 ? "#ef4444" : "#4ade80"} />
      </div>

      {/* Upcoming Deadlines */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Upcoming Deadlines</h2>
        {dashboard.upcomingDeadlines.length === 0
          ? <p className="text-sm text-[var(--dpf-muted)]">No upcoming compliance deadlines.</p>
          : <ul className="space-y-2">
              {dashboard.upcomingDeadlines.map((e) => (
                <li key={e.id} className="text-sm text-white flex justify-between">
                  <span>{e.title}</span>
                  <span className="text-[var(--dpf-muted)]">{new Date(e.startAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
        }
      </section>

      {/* Recent Activity */}
      <section className="mb-8">
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">Recent Activity</h2>
        {dashboard.recentActivity.length === 0
          ? <p className="text-sm text-[var(--dpf-muted)]">No compliance activity yet.</p>
          : <ul className="space-y-2">
              {dashboard.recentActivity.map((log) => (
                <li key={log.id} className="text-sm text-[var(--dpf-muted)]">
                  <span className="text-white">{log.performedBy?.displayName ?? log.agentId ?? "System"}</span>{" "}
                  {log.action} {log.entityType} — {new Date(log.performedAt).toLocaleString()}
                </li>
              ))}
            </ul>
        }
      </section>

      {/* By Regulation */}
      <section>
        <h2 className="text-xs text-[var(--dpf-muted)] uppercase tracking-widest mb-3">By Regulation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {dashboard.regulationSummaries.map((r) => (
            <a key={r.id} href={`/compliance/regulations/${r.id}`}
              className="block p-4 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-white">{r.shortName}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[#333] text-[var(--dpf-muted)]">{r.jurisdiction}</span>
              </div>
              <p className="text-xs text-[var(--dpf-muted)]">{r.obligationCount} obligation{r.obligationCount !== 1 ? "s" : ""}</p>
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className="p-4 rounded-lg border border-[var(--dpf-border)]">
      <p className="text-xs text-[var(--dpf-muted)] mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{value}</p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(shell)/compliance/page.tsx
git commit -m "feat: add compliance dashboard page with posture metrics"
```

---

## Task 9: List Pages — Regulations, Obligations, Controls

**Files:**
- Create: `apps/web/app/(shell)/compliance/regulations/page.tsx`
- Create: `apps/web/app/(shell)/compliance/regulations/[id]/page.tsx`
- Create: `apps/web/app/(shell)/compliance/obligations/page.tsx`
- Create: `apps/web/app/(shell)/compliance/controls/page.tsx`

- [ ] **Step 1: Create regulations list page**

Server component: calls `listRegulations()`, renders card grid with shortName, jurisdiction badge, obligation count, status badge. "Add regulation" button (visible only if `manage_compliance`).

- [ ] **Step 2: Create regulation detail page**

Server component: calls `getRegulation(id)`, renders regulation fields + obligations table. Link to add obligation.

- [ ] **Step 3: Create obligations list page**

Server component: calls `listObligations()`, renders table with title, regulation shortName, category badge, owner, coverage indicator (green/amber/red based on linked controls).

- [ ] **Step 4: Create controls list page**

Server component: calls `listControls()`, renders table with title, controlType badge, implementationStatus badge, effectiveness badge, obligation count.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/compliance/regulations/ apps/web/app/(shell)/compliance/obligations/ apps/web/app/(shell)/compliance/controls/
git commit -m "feat: add compliance list pages — regulations, obligations, controls"
```

---

## Task 10: List Pages — Evidence, Risks, Incidents

**Files:**
- Create: `apps/web/app/(shell)/compliance/evidence/page.tsx`
- Create: `apps/web/app/(shell)/compliance/risks/page.tsx`
- Create: `apps/web/app/(shell)/compliance/incidents/page.tsx`

- [ ] **Step 1: Create evidence list page**

Table with title, evidenceType badge, linked obligation/control, collectedAt, status. No edit button — only "Supersede" for active evidence.

- [ ] **Step 2: Create risks list page**

Table with title, inherentRisk/residualRisk badges, likelihood, severity, linked controls count, assessedBy.

- [ ] **Step 3: Create incidents list page**

Table with title, severity badge, category, status, regulatoryNotifiable flag (highlighted), notification countdown for notifiable incidents. Open/investigating incidents appear first.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(shell)/compliance/evidence/ apps/web/app/(shell)/compliance/risks/ apps/web/app/(shell)/compliance/incidents/
git commit -m "feat: add compliance list pages — evidence, risks, incidents"
```

---

## Task 11: List Pages — Audits, Actions, Submissions

**Files:**
- Create: `apps/web/app/(shell)/compliance/audits/page.tsx`
- Create: `apps/web/app/(shell)/compliance/audits/[id]/page.tsx`
- Create: `apps/web/app/(shell)/compliance/actions/page.tsx`
- Create: `apps/web/app/(shell)/compliance/submissions/page.tsx`

- [ ] **Step 1: Create audits list page**

Table with title, auditType badge, status, scheduledAt/conductedAt, overallRating, findings count.

- [ ] **Step 2: Create audit detail page**

Shows audit fields + findings table. Link to add finding. Findings show findingType badge, status, linked control, due date.

- [ ] **Step 3: Create corrective actions list page**

Table with title, sourceType badge, owner, dueDate, status. Overdue items highlighted (past dueDate, not completed/verified). Filter by status including "overdue" virtual filter.

- [ ] **Step 4: Create submissions list page**

Table with title, recipientBody, submissionType badge, dueDate, status, confirmationRef.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/compliance/audits/ apps/web/app/(shell)/compliance/actions/ apps/web/app/(shell)/compliance/submissions/
git commit -m "feat: add compliance list pages — audits, actions, submissions"
```

---

## Task 12: Create/Edit Modals

**Files:**
- Create: `apps/web/components/compliance/ComplianceModal.tsx`
- Modify: All list pages to wire up modals

- [ ] **Step 1: Create reusable ComplianceModal component**

Centered modal following the backlog panel pattern. Dark theme, `var(--dpf-*)` CSS variables, escape to close, overlay click to close.

- [ ] **Step 2: Wire regulation create/edit modal**

"Add regulation" button on regulations list opens modal with name, shortName, jurisdiction, industry, sourceType, effectiveDate, sourceUrl, notes fields. Calls `createRegulation` / `updateRegulation`.

- [ ] **Step 3: Wire obligation create/edit modal**

Fields: title, regulationId (dropdown), description, reference, category (dropdown), frequency (dropdown), applicability, penaltySummary, ownerEmployeeId (dropdown), reviewDate.

- [ ] **Step 4: Wire control create/edit modal**

Fields: title, controlType (dropdown), description, implementationStatus (dropdown), ownerEmployeeId (dropdown), reviewFrequency (dropdown), nextReviewDate, effectiveness (dropdown).

- [ ] **Step 5: Wire evidence + submission modals**

Evidence create modal (no edit — immutable) with evidenceType dropdown, title, description, obligationId/controlId dropdowns, fileRef. Submission create/edit modal with recipientBody, submissionType dropdown, regulationId dropdown, dueDate, notes.

- [ ] **Step 6: Wire risk + incident + corrective action modals**

RiskAssessment modal with hazard, likelihood/severity/inherentRisk dropdowns, scope, notes. Incident modal with severity dropdown, category dropdown, regulatoryNotifiable checkbox (shows notificationDeadline field when checked), occurredAt. CorrectiveAction modal with sourceType dropdown, owner, dueDate, linked incident/finding.

- [ ] **Step 7: Wire audit + finding modals**

Audit create/edit with auditType dropdown, scope, auditorEmployeeId, scheduledAt. AuditFinding create/edit with findingType dropdown, linked controlId, dueDate.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/compliance/ apps/web/app/(shell)/compliance/
git commit -m "feat: add compliance create/edit modals for all entity types"
```

---

## Task 13: Server Action Tests

**Files:**
- Create: `apps/web/lib/actions/compliance.test.ts`

- [ ] **Step 1: Write auth tests**

Test that `listRegulations` rejects unauthenticated users, that `createRegulation` rejects users without `manage_compliance`, that HR-100 can read but not write.

Mock pattern from `apps/web/lib/actions/workforce.test.ts`: mock `@/lib/auth`, `@/lib/permissions`, `@dpf/db`.

- [ ] **Step 2: Write CRUD tests**

Test `createRegulation` creates record with correct fields and generates audit log. Test `updateRegulation` updates fields and logs. Test `deactivateRegulation` sets status.

- [ ] **Step 3: Write evidence immutability tests**

Test that no `updateEvidence` function is exported. Test that `supersedeEvidence` creates new record, marks old as superseded, and logs both actions.

- [ ] **Step 4: Write calendar integration tests**

Test that `createIncident` with `regulatoryNotifiable: true` creates a CalendarEvent with `category: "compliance"` and `complianceEntityType: "incident-notification"`.

- [ ] **Step 5: Run all tests**

Run: `cd apps/web && npx vitest run lib/actions/compliance.test.ts`
Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/compliance.test.ts
git commit -m "test: add compliance server action tests — auth, CRUD, immutability, calendar"
```

---

## Task 14: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd apps/web && npx vitest run`
Expected: All existing tests still pass, all new tests pass.

- [ ] **Step 2: Run type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run dev server and verify visually**

Run: `cd apps/web && npm run dev`
Verify:
- Workspace tile visible for admin user
- `/compliance` route renders dashboard
- Tab navigation works across all sub-pages
- All list pages render (empty state)
- Creating a regulation through modal works
- Audit log entries appear in dashboard activity feed

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
git status
# Review output — only commit compliance-related files. Do NOT add docker-compose.override.yml or other unrelated files.
git add apps/web/lib/ apps/web/app/(shell)/compliance/ apps/web/components/compliance/ packages/db/prisma/
git commit -m "feat: EP-GRC-001 compliance engine core — complete implementation"
```
