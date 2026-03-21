# EP-GRC-ONBOARD: Regulation & Standards Onboarding

**Status:** Draft
**Date:** 2026-03-21
**Epic:** Regulation & Standards Onboarding
**Scope:** Generic onboarding process for any regulation, standard, or framework. Hybrid AI-assisted + manual workflow. Onboarding wizard, AI coworker entry point, sourceType extension, policy-obligation many-to-many linking, and critical compliance UI gap fixes.
**Dependencies:** EP-GRC-001 (Compliance Engine Core — implemented), EP-POL-001 (Internal Policy Management — implemented)

---

## Problem Statement

The GRC system was architected as a universal compliance engine — 16 schema models, 38 server actions, 24 UI pages, comprehensive test suites. But it's operationally hollow:

- **No onboarding process.** There is no way to bring a new regulation or standard into the platform other than writing SQL seed scripts. The only regulation in the database (DORA) was manually seeded by a developer.
- **No standards support.** The `Regulation.sourceType` field exists but only supports `"external"`. Standards (WCAG, ISO 27001), frameworks (IT4IT, COBIT), and internal standards have no representation.
- **Policy linking is limited.** `Policy.obligationId` is an optional many-to-one FK — a policy can link to at most one obligation. Real policies span multiple obligations across multiple frameworks.
- **Critical UI gaps.** The DORA dogfood identified 12 missing UI items — no edit forms for regulations/obligations, no create forms for evidence/risks/incidents, no control-obligation linking UI. You can onboard a regulation but can't manage it afterward.
- **Not testable.** Compliance requirements exist as text in the database but nothing connects them to automated verification (e.g., WCAG contrast checks, branding validation).

This was a founding requirement of the platform — it targets regulated industries where compliance is not optional. The engine is built; the on-ramp is missing.

## Goals

1. Any regulation, standard, framework, or internal standard can be onboarded through a structured 4-step wizard
2. AI coworker can research a public standard (web) or extract obligations from an uploaded document (PDF), then pre-fill the wizard
3. The onboarding wizard also works fully manually for users who prefer direct entry
4. `sourceType` supports `external`, `standard`, `framework`, `internal` — all use the existing Regulation model
5. Policies link to multiple obligations via a many-to-many junction table
6. After onboarding, users can edit regulations, obligations, and link them to policies and controls via the UI
7. Create forms exist for evidence, risks, and incidents — the entities needed to demonstrate compliance

## Non-Goals

- Specific regulatory features (GDPR processing activities, DORA ICT risk dashboards) — those are separate epics
- Spreadsheet/CSV bulk import (future epic)
- Automated compliance testing integration (connecting GRC to Build Studio UX tests — future epic)
- Risk-control linking UI, audit/corrective action create forms, submission prep checklists
- LLM-driven regulatory monitoring (EP-GRC-002, separate)
- Regulatory alert workflow actions

---

## Design

### 1. sourceType Extension

Extend the `Regulation.sourceType` field to support four values:

| Value | Meaning | Examples |
|-------|---------|----------|
| `external` | Legally mandated regulation (existing default) | GDPR, DORA, SOX |
| `standard` | Voluntary compliance standard | WCAG 2.2, ISO 27001, SOC 2 |
| `framework` | Operational/governance framework | IT4IT, COBIT, ITIL, NIST CSF |
| `internal` | Organization's own internal standards | Internal security policy, coding standards |

No schema change needed — `sourceType` is already a `String` field. The code change is in `compliance-types.ts`: expand the `REGULATION_SOURCE_TYPES` constant from `["external", "internal"]` to `["external", "standard", "framework", "internal"]` and update its test (currently asserts `toHaveLength(2)`, needs `toHaveLength(4)`). The `CreateRegulationForm` and `EditRegulationForm` already import this constant, so they will pick up the new values automatically. The onboarding wizard also uses this constant for its dropdown. List pages show a sourceType filter so users can view regulations, standards, or frameworks separately.

### 2. Onboarding Wizard

A new page at `/compliance/onboard` with a 4-step wizard component.

**Step 1 — Identity:**

| Field | Required | Description |
|-------|----------|-------------|
| Name | Yes | Full name (e.g., "General Data Protection Regulation") |
| Short Name | Yes | Abbreviation (e.g., "GDPR") |
| Source Type | Yes | Dropdown: external, standard, framework, internal |
| Jurisdiction | Yes | Geographic scope (e.g., "EU", "UK", "Global"). Required to match the existing `Regulation.jurisdiction` non-nullable field and `CreateRegulationForm` validation. |
| Industry | No | Industry applicability (e.g., "Financial Services", "All") |
| Source URL | No | Link to official text |
| Effective Date | No | When the regulation takes effect |
| Document Upload | No | PDF upload for proprietary standards. Processed in-memory for AI extraction, not persisted (avoids licensing issues). |
| Notes | No | Internal notes |

**Step 2 — Obligations:**

A table of obligations extracted from the source (AI-drafted or empty for manual entry). Each row:

| Column | Required | Maps to |
|--------|----------|---------|
| Title | Yes | `obligation.title` |
| Reference | No | `obligation.reference` (e.g., "Art. 5(1)(a)", "Clause 6.1.2") |
| Category | No | `obligation.category` — values from `OBLIGATION_CATEGORIES` constant (defaults to "other") |
| Frequency | No | `obligation.frequency` — values from `OBLIGATION_FREQUENCIES` constant: "event-driven", "annual", "quarterly", "monthly", "continuous" |
| Applicability | No | `obligation.applicability` (who/what this applies to) |
| Description | No | `obligation.description` |

Table supports:
- Inline editing of all fields
- Add row (manual entry)
- Delete row
- Reorder via drag or move-up/move-down buttons

When AI-drafted, all rows are pre-filled. The admin reviews, edits, and confirms.

**Step 3 — Controls (optional):**

Suggested control mappings. Each row:

| Column | Required | Maps to |
|--------|----------|---------|
| Title | Yes | `control.title` |
| Type | Yes | Dropdown: preventive, detective, corrective |
| Linked Obligations | Yes | Multi-select from Step 2 obligations |
| Implementation Status | No | Dropdown: planned, in-progress, implemented, not-applicable (default: planned) |

This step is optional — controls can be added later via the existing Controls UI. The AI suggests controls when it can identify obvious mappings (e.g., WCAG contrast requirements → "Contrast validation at save time").

**Step 4 — Confirm:**

Summary view:
- Regulation/standard name, sourceType, jurisdiction
- Obligation count
- Control count and mapping count
- "Commit to compliance register" button

**On commit:** A new `onboardRegulation()` server action wraps everything in a single `prisma.$transaction()` call for atomicity — if obligation 15 of 30 fails, nothing is committed. The transaction creates:
1. `Regulation` record (reuses validation logic from `createRegulation`)
2. All `Obligation` records with `regulationId` set (reuses validation from `createObligation`)
3. All `Control` records if any (reuses validation from `createControl`)
4. All `ControlObligationLink` records if any
5. `ComplianceAuditLog` entry via `logComplianceAction("regulation", record.id, "onboarded", employeeId, shortName)`

Shared validation logic (ID generation, input validation, required fields) is extracted from the existing individual server actions into helper functions that both the individual actions and the transactional onboard action can call.

### 3. AI Coworker Entry Point

A new coworker skill on the `/compliance` route:

```
{
  label: "Onboard a regulation or standard",
  description: "Research and import a regulation, standard, or framework into the compliance register",
  capability: "manage_compliance",
  taskType: "analysis",
  prompt: "Help the user onboard a new regulation, standard, or framework. Ask what they want to onboard. Then: (1) Research it using web search for public standards, or ask for a document upload for proprietary ones. (2) Extract the obligation structure — titles, references, categories, frequency, applicability. (3) Suggest control mappings where obvious. (4) Present the findings and open the onboarding wizard pre-filled with the drafted structure."
}
```

**AI research flow:**
1. User says "We need to comply with ISO 27001" or "Onboard WCAG 2.2"
2. Coworker uses web search (for public standards) or reads an uploaded PDF attachment (for proprietary standards)
3. Coworker extracts obligations into a structured list
4. Coworker calls a new MCP tool `prefill_onboarding_wizard` that stores the draft in the `OnboardingDraft` table (see Section 6) and navigates the user to `/compliance/onboard?draft={draftId}`
5. The wizard loads the pre-filled draft

**New MCP tool — `prefill_onboarding_wizard`:**

```ts
{
  name: "prefill_onboarding_wizard",
  description: "Pre-fill the regulation onboarding wizard with AI-drafted data. Opens the wizard for human review.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string" },
      shortName: { type: "string" },
      sourceType: { type: "string", enum: ["external", "standard", "framework", "internal"] },
      jurisdiction: { type: "string" },
      industry: { type: "string" },
      sourceUrl: { type: "string" },
      obligations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            reference: { type: "string" },
            category: { type: "string" },
            frequency: { type: "string" },
            applicability: { type: "string" },
            description: { type: "string" },
          },
        },
      },
      suggestedControls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            controlType: { type: "string", enum: ["preventive", "detective", "corrective"] },
            linkedObligationIndices: { type: "array", items: { type: "number" } },
          },
        },
      },
    },
    required: ["name", "shortName", "sourceType"],
  },
  requiredCapability: "manage_compliance",
  sideEffect: true,
}
```

The tool stores the draft as a `OnboardingDraft` record in the database (or in-memory via a simple JSON field on a temporary table) and returns the URL for the wizard. The coworker navigates the user there.

### 4. Policy ↔ Obligation Many-to-Many

**New junction table:**

```prisma
model PolicyObligationLink {
  id           String     @id @default(cuid())
  policyId     String
  obligationId String
  notes        String?
  createdAt    DateTime   @default(now())

  policy       Policy     @relation(fields: [policyId], references: [id], onDelete: Cascade)
  obligation   Obligation @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  @@unique([policyId, obligationId])
  @@index([policyId])
  @@index([obligationId])
}
```

**Add relations to existing models:**
- `Policy`: add `obligationLinks PolicyObligationLink[]`
- `Obligation`: add `policyLinks PolicyObligationLink[]`

**Migration:** The existing `Policy.obligationId` field is kept for backward compatibility. A data migration moves any existing `obligationId` values into `PolicyObligationLink` records. After migration, `obligationId` is no longer used by the UI but remains in schema to avoid breaking existing queries until a future cleanup.

**Policy detail page update:**
- Replace the single "Linked to obligation: {title}" display with a section showing all linked obligations grouped by their parent regulation/standard
- Add a "Link Obligation" button that opens a form with:
  - Filter by sourceType (regulation / standard / framework / internal)
  - Filter by regulation name
  - Search by obligation title
  - Multi-select to link several obligations at once
  - Optional notes field per link

**Server actions:**
- `linkPolicyToObligation(policyId, obligationId, notes?)` — creates PolicyObligationLink
- `unlinkPolicyFromObligation(policyId, obligationId)` — deletes PolicyObligationLink
- `getPolicyObligations(policyId)` — returns linked obligations with parent regulation info

### 5. Existing UI Enhancements

Most compliance UI components (edit forms, create forms, linking forms) already exist. This section covers only the enhancements needed to support the onboarding workflow.

**Already implemented (no changes needed):**
- `EditRegulationForm.tsx` — exists, imports `updateRegulation` and `REGULATION_SOURCE_TYPES`
- `EditObligationForm.tsx` — exists, imports `updateObligation`
- `CreateEvidenceForm.tsx` — exists, imports `createEvidence`
- `CreateRiskAssessmentForm.tsx` — exists, imports `createRiskAssessment`
- `CreateIncidentForm.tsx` — exists
- `LinkObligationForm.tsx` — exists (control → obligation linking)
- `EditControlForm.tsx`, `EditIncidentForm.tsx`, `EditCorrectiveActionForm.tsx` — exist

**Enhancements needed:**
- `CreateRegulationForm.tsx` — add `sourceType` dropdown using the expanded `REGULATION_SOURCE_TYPES` constant (currently only has "external" and "internal", needs "standard" and "framework")
- `EditRegulationForm.tsx` — already imports `REGULATION_SOURCE_TYPES`, will pick up new values automatically once the constant is updated
- Regulation list page — add sourceType filter dropdown
- Obligation list page — add regulation/category filter dropdowns
- Policy detail page — replace single `obligationId` display with `PolicyObligationLink` many-to-many section

### 6. Onboarding Draft Storage

The AI coworker needs to pass a potentially large draft (30+ obligations) to the wizard page. Options considered:

**Chosen approach:** Store the draft as a JSON record in a new `OnboardingDraft` table:

```prisma
model OnboardingDraft {
  id        String   @id @default(cuid())
  data      Json
  createdBy String
  createdAt DateTime @default(now())
  expiresAt DateTime // Auto-expire after 24 hours
}
```

The `prefill_onboarding_wizard` tool creates a draft and returns the wizard URL with `?draft={id}`. The wizard reads the draft on load and deletes it after commit.

**Cleanup:** Lazy cleanup on wizard page load — before loading any draft, delete all `OnboardingDraft` records where `expiresAt < now()`. This avoids the need for a separate cron job or scheduled task infrastructure. Drafts expire after 24 hours.

This avoids URL length limits (query string can't hold 30+ obligations) and session storage complexity.

---

## Data Model

**New models:**
- `PolicyObligationLink` — many-to-many junction between Policy and Obligation
- `OnboardingDraft` — temporary storage for AI-drafted onboarding data (auto-expires)

**Modified models:**
- `Policy` — add `obligationLinks PolicyObligationLink[]` relation
- `Obligation` — add `policyLinks PolicyObligationLink[]` relation

**No changes to Regulation schema** — `sourceType` is already a String field. The `REGULATION_SOURCE_TYPES` constant in `compliance-types.ts` is expanded from 2 to 4 values (and its test updated).

## Files Affected

**New files:**
- `apps/web/app/(shell)/compliance/onboard/page.tsx` — onboarding wizard page
- `apps/web/components/compliance/OnboardingWizard.tsx` — 4-step wizard component
- `apps/web/components/compliance/LinkPolicyObligationForm.tsx` — policy ↔ obligation many-to-many linking form
- `packages/db/prisma/migrations/YYYYMMDD_policy_obligation_link/` — migration for PolicyObligationLink + OnboardingDraft

**Modified files:**
- `packages/db/prisma/schema.prisma` — add PolicyObligationLink, OnboardingDraft, relation fields on Policy and Obligation
- `apps/web/lib/actions/compliance.ts` — add `onboardRegulation()` transactional server action, extract shared validation helpers from existing create actions
- `apps/web/lib/actions/policy.ts` — add linkPolicyToObligation, unlinkPolicyFromObligation, getPolicyObligations
- `apps/web/lib/compliance-types.ts` — expand `REGULATION_SOURCE_TYPES` to 4 values, add onboarding input types, update test
- `apps/web/lib/mcp-tools.ts` — add `prefill_onboarding_wizard` tool definition + execution
- `apps/web/lib/route-context-map.ts` — add "Onboard a regulation or standard" skill to `/compliance` route
- `apps/web/app/(shell)/compliance/policies/[id]/page.tsx` — replace single obligation display with many-to-many linked obligations section
- `apps/web/app/(shell)/compliance/regulations/page.tsx` — add sourceType filter, "Onboard" button
- `apps/web/app/(shell)/compliance/obligations/page.tsx` — add regulation/category filter dropdowns
- `apps/web/components/compliance/CreateRegulationForm.tsx` — add sourceType dropdown using `REGULATION_SOURCE_TYPES` constant (currently has no sourceType field); verify effectiveDate field presence
- `apps/web/components/compliance/ComplianceTabNav.tsx` — add "Onboard" entry or button

**Already exist (no changes needed unless noted):**
- `apps/web/components/compliance/EditRegulationForm.tsx` — already imports `REGULATION_SOURCE_TYPES`, gains new values automatically
- `apps/web/components/compliance/EditObligationForm.tsx` — already implemented
- `apps/web/components/compliance/CreateEvidenceForm.tsx` — already implemented
- `apps/web/components/compliance/CreateRiskAssessmentForm.tsx` — already implemented
- `apps/web/components/compliance/CreateIncidentForm.tsx` — already implemented
- `apps/web/components/compliance/LinkObligationForm.tsx` — already implemented (control → obligation direction)

## Testing Strategy

- **Unit tests:** OnboardingWizard state management (step transitions, obligation add/edit/delete, form validation)
- **Server action tests:** Regulation update, obligation update, evidence create, risk create, policy-obligation link/unlink
- **Integration test:** Full onboarding flow — create draft via tool, load wizard, modify obligations, commit, verify database records
- **Migration test:** Existing `Policy.obligationId` values migrated to `PolicyObligationLink` records
- **AI extraction test:** Mock web search result → verify obligation structure extraction matches expected format

## Demo Story

The compliance officer opens the AI coworker on the compliance page and says "We need to comply with WCAG 2.2 AA." The coworker searches the web, finds the WCAG specification, and extracts 25 success criteria as obligations — each with its criterion number (e.g., "1.4.3"), category ("Perceivable"), and applicability. It suggests 8 controls (contrast validation, focus indicators, alt text requirements, etc.) and opens the onboarding wizard pre-filled.

The compliance officer reviews the obligations table — removes 3 that don't apply to their product, edits 2 descriptions for clarity, and adds a note to one. She reviews the suggested controls, accepts 6, removes 2 she'll handle differently. She confirms.

WCAG 2.2 AA appears in the compliance register as a "standard" (not a regulation). She navigates to the UX Accessibility policy, clicks "Link Obligations," filters by "WCAG 2.2," and links the relevant success criteria. The policy detail page now shows: "Linked to 22 obligations across 1 standard (WCAG 2.2 AA)."

Later, a new team member opens the compliance dashboard. They see DORA (regulation), WCAG 2.2 (standard), and IT4IT (framework) — each with obligation counts, control coverage, and gap assessment scores. The system works the same way regardless of whether the source is a law or a voluntary standard.
