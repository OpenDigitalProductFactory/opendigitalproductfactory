---
status: draft
---

# The instance's direction: mission, vision and top-level outcomes

**Backlog:** BI-916216E7 (capture and edit), BI-8AB6B4F7 (decision layers read it). **Epic:** EP-OUTCOME-HIERARCHY.
**Parent design:** [outcome hierarchy](2026-10-28-outcome-hierarchy-design.md), WWMD DI-DDB4BDE852BB. This design fills in the instance level of that hierarchy. It does not build the epic, item or room levels.
**Kernel decisions:** DI-5C99BCBB0AF4 (storage shape), DI-475144E38C9E (where it is captured).

## 1. Problem

The operator, 2026-10-28: the instance's mission, vision and outcomes are the prime definer for the WWMD, WWWD and WSID decision layers, and the owner needs a way to enter them, including at setup.

What exists at commit 4f00cb5:

- `BusinessContext.mission` (`packages/db/prisma/schema/core-identity.prisma`). The owner types it in `BusinessContextForm` at the business-context setup step (`/storefront/settings/business`).
- `org-context-bundle.ts` puts `Mission:` into the MCP server's ORGANIZATION CONTEXT.
- `apply-mission-prompt.ts` writes the Block 0 company-mission prompt. It runs only in `runSetupCompletionSeeds`, so a mission edited after setup never reaches coworkers.
- No vision, no top-level outcomes, and nothing asks an install for them later.

## 2. Research

| Practice | What it does | DPF takes | DPF leaves |
|---|---|---|---|
| Hoshin Kanri | Vision, then a few breakthrough objectives, then cascaded annual objectives, with catchball between levels | The cascade: every lower outcome serves one parent. A small, fixed number of top outcomes | Catchball, the X-matrix and annual ceremonies (parent spec) |
| OKR | An objective plus measurable key results | Each outcome has a plain statement and an optional "how we'll know" | Quarterly scoring and grading |
| Balanced-scorecard strategy maps | A mission and vision with a handful of strategic objectives | Mission and vision as two separate sentences | Four fixed perspectives |

## 3. Design

### 3.1 Data

- `BusinessContext.vision String?`.
- `InstanceOutcome`: `id`, `organizationId` (FK, indexed), `statement`, `howWeKnow?`, `sortOrder`, `retiredAt?`, `createdAt`, `updatedAt`. Rows are retired, never deleted, so the epic level (BI-7CD178F8) can point at a stable id.
- `InstanceDirectionRevision`: append-only. `organizationId` (FK), `version` (unique per organization), `mission`, `vision`, `outcomes` (JSON snapshot of the active outcomes), `changedByUserId` (FK to User, nullable), `source`, `createdAt`. One row per save. This is the same pattern as `WikiPageRevision` and `PromptRevision`.
- An instance has at most 5 active outcomes. Setup asks for 1 to 3.

### 3.2 Owner entry

- A Direction panel on `/storefront/settings/business` shows and edits mission, vision and outcomes. Mission moves out of `BusinessContextForm`, so mission has one place to edit it.
- Saving is an owner server action. It needs an admin session. It writes the fields, retires removed outcomes, appends a revision, and re-renders Block 0.
- Fields start empty. The archetype mission starter appears only as a button the owner presses. Nothing is filled in for them.

### 3.3 Setup

- A new `direction` setup step comes right after `business-context`. It routes to `/storefront/settings/business?section=direction`. The query string forces a fresh render, so the overlay moves to the step.
- The setup overlay's existing Skip skips it, and setup never blocks on it.
- The `organization-direction` attention source raises one Needs-you item while the mission, the vision or every outcome is missing. It is worked out from live state, so an install that skipped the step, or finished setup before the step existed, gets the same single item.

### 3.4 Decision layers read it

- `buildOrgContextBundle` loads vision and active outcomes. `formatOrgContextInstructions` adds `Vision:` and `Outcomes:` lines, each bounded in length. Up to 5 outcomes, 120 characters each.
- Block 0 lists mission, vision and outcomes.
- The WWWD alignment corpus (`loadOrgAlignmentCorpora`) gains the direction as evidence (`direction:mission@vN`, `direction:vision@vN`, `direction:outcome:<id>@vN`). The ledger's amendment lineage then names which direction revision a decision read.
- The WSID gate records the same direction refs on its ledger payload. When nothing is recorded, the payload says `direction: none recorded`. Nothing is invented.

## 4. Objectives and acceptance

**OBJ-1:** The owner can state and later change the instance's mission, vision and up to five top-level outcomes, and every change is versioned.

**OBJ-2:** First-run setup asks for them in plain language, can be skipped, and never blocks. A missing direction leaves exactly one Needs-you prompt, on new and existing installs.

**OBJ-3:** The WWMD, WWWD and WSID context and the agent ORGANIZATION CONTEXT carry vision and outcomes beside mission, bounded in size, and never invent them.

| AC | Objective | Statement |
|---|---|---|
| AC-1 | OBJ-1 | An admin saves mission, vision and outcomes from the Direction panel. Reloading shows them. Each save appends one revision with the next version number and the saving user. |
| AC-2 | OBJ-1 | Removing an outcome retires its row rather than deleting it. More than five outcomes, or an empty statement, is refused with a plain message. |
| AC-3 | OBJ-2 | The setup step list contains `direction` after `business-context`, routed to the Direction panel. Skipping it advances setup. |
| AC-4 | OBJ-2 | With mission, vision or all outcomes missing, the attention aggregate contains exactly one `organization-direction` item linking to the panel. With all present, it contains none. |
| AC-5 | OBJ-3 | ORGANIZATION CONTEXT shows Vision and Outcomes lines when recorded, says "not recorded yet" when not, and stays bounded. |
| AC-6 | OBJ-3 | The WWWD alignment corpus and Block 0 include the recorded direction. No agent path writes an instance outcome. |

## 5. Out of scope

- The epic outcome and its link to an instance outcome (BI-7CD178F8).
- Rolling item observations up to instance outcomes.
- AI drafting of outcome wording. The owner can ask the COO in chat. Nothing is saved without the owner pressing Save.
