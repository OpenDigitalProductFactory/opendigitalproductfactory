# EA Reference Model Assessment Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic EA reference-model assessment foundation in `/ea`, seed IT4IT as the first authoritative model, and support portfolio-first scoring plus an AI proposal lane.

**Architecture:** Extend the existing EA meta-model in Prisma with reference-model registry, model elements, artifacts, portfolio scopes, assessments, and proposals. Keep IT4IT import logic in focused seed/import utilities under `packages/db`, expose read models and server actions under the existing EA data/action modules in `apps/web`, and add a minimal EA assessment read surface without trying to solve the full long-term UX in one slice.

**Tech Stack:** Prisma/PostgreSQL, TypeScript, Next.js App Router, React Server Components, Vitest, pnpm

---

## File Structure

### Database and import layer

- Modify: `packages/db/prisma/schema.prisma`
  - Add the new EA reference-model tables and relations.
- Create: `packages/db/src/reference-model-types.ts`
  - Shared import and normalization types for reference-model ingestion.
- Create: `packages/db/src/reference-model-import.ts`
  - Pure normalization helpers for workbook rows, priority mapping, and slug generation.
- Create: `packages/db/src/reference-model-import.test.ts`
  - Unit tests for normalization and priority semantics.
- Create: `packages/db/src/seed-ea-reference-models.ts`
  - Idempotent seeding for portfolio scopes, IT4IT model registry, authoritative artifacts, and imported model elements.
- Modify: `packages/db/src/seed.ts`
  - Call the new seed function in the normal bootstrap sequence.
- Modify: `packages/db/src/index.ts`
  - Export new seed/import helpers.

### Web read/action layer

- Modify: `apps/web/lib/ea-data.ts`
  - Add EA reference-model summary queries, portfolio rollups, and model detail loaders.
- Modify: `apps/web/lib/actions/ea.ts`
  - Add assessment and proposal server actions with validation.
- Create: `apps/web/lib/reference-model-types.ts`
  - Serialized view types for the assessment UI.
- Create: `apps/web/lib/reference-model-data.test.ts`
  - Read-model tests using mocked Prisma responses.
- Modify: `apps/web/lib/actions/ea.test.ts`
  - Add targeted tests for new assessment/proposal actions.

### EA UI layer

- Modify: `apps/web/app/(shell)/ea/page.tsx`
  - Add a reference-model summary panel above or beside the existing view list.
- Create: `apps/web/app/(shell)/ea/models/[slug]/page.tsx`
  - Model detail route for IT4IT and later reference models.
- Create: `apps/web/components/ea/ReferenceModelSummary.tsx`
  - Portfolio rollup cards and model counts.
- Create: `apps/web/components/ea/ReferenceModelPortfolioTable.tsx`
  - Portfolio x status matrix for one model.
- Create: `apps/web/components/ea/ReferenceProposalQueue.tsx`
  - Minimal review queue for proposed items.

### Docs

- Modify: `docs/superpowers/specs/2026-03-13-ea-reference-model-assessment-foundation-design.md`
  - Update status and any implementation notes discovered during execution.

### Known baseline caveat before implementation

- `pnpm --filter web typecheck` currently fails in this worktree because of unrelated unresolved modules/types.
- `pnpm --filter @dpf/db test` currently fails in `packages/db/src/ea-validation.test.ts`.

Do not silently "fix" those as part of this feature unless the user explicitly asks. Execute feature work with targeted tests first, then run broader verification and clearly separate pre-existing failures from new regressions.

---

## Chunk 1: Schema And Seed Foundation

### Task 1: Add failing schema expectations for the new reference-model tables

**Files:**
- Modify: `packages/db/src/seed.test.ts`
- Test: `packages/db/src/seed.test.ts`

- [ ] **Step 1: Write failing schema/seed expectations**

Add assertions that the seed entrypoint invokes a reference-model seeding helper and that the helper name is exported from the package surface.

```ts
it("exports seedEaReferenceModels", async () => {
  const mod = await import("./index.js");
  expect(typeof mod.seedEaReferenceModels).toBe("function");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/seed.test.ts`

Expected: FAIL because `seedEaReferenceModels` does not exist yet.

- [ ] **Step 3: Add the Prisma models**

Update `packages/db/prisma/schema.prisma` with:

```prisma
model EaReferenceModel {
  id              String                   @id @default(cuid())
  slug            String                   @unique
  name            String
  version         String
  authorityType   String
  status          String                   @default("draft")
  description     String?
  primaryIndustry String?
  sourceSummary   String?
  artifacts       EaReferenceModelArtifact[]
  elements        EaReferenceModelElement[]
  assessments     EaReferenceAssessment[]
  proposals       EaReferenceProposal[]
  createdAt       DateTime                 @default(now())
  updatedAt       DateTime                 @updatedAt
}

model EaReferenceModelElement {
  id              String                    @id @default(cuid())
  modelId         String
  model           EaReferenceModel          @relation(fields: [modelId], references: [id])
  parentId        String?
  parent          EaReferenceModelElement?  @relation("EaReferenceModelTree", fields: [parentId], references: [id])
  children        EaReferenceModelElement[] @relation("EaReferenceModelTree")
  kind            String
  slug            String
  name            String
  code            String?
  description     String?
  normativeClass  String?
  sourceReference String?
  properties      Json                      @default("{}")
  assessments     EaReferenceAssessment[]
  @@unique([modelId, slug])
}
```

Add the rest of the models from the spec:
- `EaReferenceModelArtifact`
- `EaAssessmentScope`
- `EaReferenceAssessment`
- `EaReferenceProposal`

- [ ] **Step 4: Generate Prisma client**

Run: `pnpm --filter @dpf/db generate`

Expected: PASS and Prisma client regenerated.

- [ ] **Step 5: Wire the exported symbol**

Create a stub `seedEaReferenceModels()` and export it from `packages/db/src/index.ts`.

```ts
export async function seedEaReferenceModels(): Promise<void> {
  return;
}
```

- [ ] **Step 6: Re-run the targeted test**

Run: `pnpm --filter @dpf/db test -- src/seed.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/src/index.ts packages/db/src/seed.test.ts
git commit -m "feat: add EA reference model schema foundation"
```

### Task 2: Build import normalization utilities with TDD

**Files:**
- Create: `packages/db/src/reference-model-types.ts`
- Create: `packages/db/src/reference-model-import.ts`
- Create: `packages/db/src/reference-model-import.test.ts`

- [ ] **Step 1: Write failing tests for priority normalization and slugging**

```ts
import { describe, expect, it } from "vitest";
import { normalizePriorityClass, slugifyReferenceModelName } from "./reference-model-import.js";

describe("normalizePriorityClass", () => {
  it("maps must and shall to required", () => {
    expect(normalizePriorityClass("Must align to business objectives")).toBe("required");
    expect(normalizePriorityClass("Shall map to Enterprise Architecture")).toBe("required");
  });

  it("maps should to recommended and may to optional", () => {
    expect(normalizePriorityClass("Should review standards")).toBe("recommended");
    expect(normalizePriorityClass("May conduct an environmental scan")).toBe("optional");
  });
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/reference-model-import.test.ts`

Expected: FAIL because the file/functions do not exist.

- [ ] **Step 3: Implement the minimal normalization helpers**

Add helpers such as:

```ts
export function normalizePriorityClass(text: string | null | undefined): "required" | "recommended" | "optional" | null {
  const value = text?.trim().toLowerCase() ?? "";
  if (value.startsWith("must ") || value.startsWith("shall ")) return "required";
  if (value.startsWith("should ")) return "recommended";
  if (value.startsWith("may ")) return "optional";
  return null;
}
```

Also add focused row types for:
- functional criteria rows
- value stream rows
- participation matrix rows

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter @dpf/db test -- src/reference-model-import.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/reference-model-types.ts packages/db/src/reference-model-import.ts packages/db/src/reference-model-import.test.ts
git commit -m "feat: add reference model normalization utilities"
```

### Task 3: Seed portfolio scopes and IT4IT reference model

**Files:**
- Create: `packages/db/src/seed-ea-reference-models.ts`
- Modify: `packages/db/src/seed.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/seed.test.ts`

- [ ] **Step 1: Write a failing seed test for the four portfolio scopes**

Add a small unit around the new seed helper that expects upserts for:
- `foundational`
- `manufacture_and_delivery`
- `provided_internally`
- `provided_externally`

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter @dpf/db test -- src/seed.test.ts`

Expected: FAIL because the helper does not seed scopes yet.

- [ ] **Step 3: Implement idempotent scope and model seeding**

In `seed-ea-reference-models.ts`:
- upsert `EaAssessmentScope` rows from `Portfolio.slug`
- upsert the `it4it_v3_0_1` model
- register authoritative/supporting artifacts under `docs/Reference`
- import functional criteria, value streams, and stages from `IT4IT_Functional_Criteria_Taxonomy.xlsx`

Use `xlsx`-safe parsing in Node if already available in the repo; if not, keep the importer minimal and local to the DB package rather than spreading it across the app.

- [ ] **Step 4: Call the helper from `packages/db/src/seed.ts`**

Add the new seeding step after portfolio/taxonomy seeding so scope references exist.

- [ ] **Step 5: Re-run the targeted seed test**

Run: `pnpm --filter @dpf/db test -- src/seed.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed-ea-reference-models.ts packages/db/src/seed.ts packages/db/src/index.ts packages/db/src/seed.test.ts
git commit -m "feat: seed IT4IT reference model and portfolio scopes"
```

---

## Chunk 2: Assessment Reads And Actions

### Task 4: Add failing tests for EA assessment read models

**Files:**
- Modify: `apps/web/lib/ea-data.ts`
- Create: `apps/web/lib/reference-model-types.ts`
- Create: `apps/web/lib/reference-model-data.test.ts`

- [ ] **Step 1: Write failing tests for portfolio rollups**

```ts
it("builds per-portfolio status totals for one model", async () => {
  // mock prisma.eaReferenceAssessment.findMany()
  // expect rollup.foundational.implemented === 3
});
```

Cover:
- one model summary row
- per-portfolio counts by `coverageStatus`
- value-stream/stage counts if present

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- lib/reference-model-data.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement focused read models**

In `apps/web/lib/ea-data.ts`, add:
- `getReferenceModelsSummary()`
- `getReferenceModelDetail(slug: string)`
- `getReferenceModelPortfolioRollup(slug: string)`

Keep serialization in `apps/web/lib/reference-model-types.ts`.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- lib/reference-model-data.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ea-data.ts apps/web/lib/reference-model-types.ts apps/web/lib/reference-model-data.test.ts
git commit -m "feat: add EA reference model read models"
```

### Task 5: Add failing server-action tests for assessment and proposal updates

**Files:**
- Modify: `apps/web/lib/actions/ea.ts`
- Modify: `apps/web/lib/actions/ea.test.ts`

- [ ] **Step 1: Write failing tests for assessment updates**

Add tests covering:
- valid coverage status update
- rejection of unsupported coverage status
- proposal review status transition

Example:

```ts
it("updates an assessment coverage status", async () => {
  const result = await updateReferenceAssessment({
    assessmentId: "asmt-1",
    coverageStatus: "partial",
    rationale: "backlog exists but workflow is incomplete",
  });
  expect(result.coverageStatus).toBe("partial");
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts`

Expected: FAIL because the actions do not exist yet.

- [ ] **Step 3: Implement minimal server actions**

Add actions such as:
- `updateReferenceAssessment(...)`
- `reviewReferenceProposal(...)`

Validate allowed statuses with local constant arrays:

```ts
const COVERAGE_STATUSES = ["implemented", "partial", "planned", "not_started", "out_of_mvp"] as const;
```

Keep permissions aligned with the existing EA management permission checks.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- lib/actions/ea.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/ea.ts apps/web/lib/actions/ea.test.ts
git commit -m "feat: add reference assessment and proposal actions"
```

---

## Chunk 3: EA UI Surface

### Task 6: Add a minimal EA summary panel for reference models

**Files:**
- Create: `apps/web/components/ea/ReferenceModelSummary.tsx`
- Modify: `apps/web/app/(shell)/ea/page.tsx`
- Test: `apps/web/app/(shell)/ea/page.test.tsx` if present, otherwise add component-level tests only

- [ ] **Step 1: Write a failing component test for the summary**

If there is no stable page test yet, add a component test around the summary card list.

```tsx
it("renders model cards with portfolio counts", () => {
  render(<ReferenceModelSummary models={[...]} />);
  expect(screen.getByText("IT4IT 3.0.1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- ReferenceModelSummary`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component and page integration**

Render:
- model name/version
- number of criteria
- four-portfolio rollup counts
- link to `/ea/models/[slug]`

Keep the current EA view list intact below the new summary surface.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- ReferenceModelSummary`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ea/ReferenceModelSummary.tsx apps/web/app/(shell)/ea/page.tsx
git commit -m "feat: add EA reference model summary panel"
```

### Task 7: Add a model detail route with portfolio matrix and proposal queue

**Files:**
- Create: `apps/web/app/(shell)/ea/models/[slug]/page.tsx`
- Create: `apps/web/components/ea/ReferenceModelPortfolioTable.tsx`
- Create: `apps/web/components/ea/ReferenceProposalQueue.tsx`

- [ ] **Step 1: Write failing tests for the portfolio matrix component**

```tsx
it("renders coverage counts by portfolio and status", () => {
  render(<ReferenceModelPortfolioTable rows={[...]} />);
  expect(screen.getByText("Foundational")).toBeInTheDocument();
  expect(screen.getByText("implemented")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `pnpm --filter web test -- ReferenceModelPortfolioTable`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the detail route**

The route should show:
- model metadata
- authoritative vs advisory artifact list
- portfolio matrix
- lightweight proposal queue

Do not add inline editing UI in this phase; read-first is enough.

- [ ] **Step 4: Re-run the targeted test**

Run: `pnpm --filter web test -- ReferenceModelPortfolioTable`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/ea/models/[slug]/page.tsx apps/web/components/ea/ReferenceModelPortfolioTable.tsx apps/web/components/ea/ReferenceProposalQueue.tsx
git commit -m "feat: add EA reference model detail route"
```

---

## Chunk 4: Verification, Status Sync, And Handoff

### Task 8: Add implementation notes to the spec and verify targeted commands

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-ea-reference-model-assessment-foundation-design.md`

- [ ] **Step 1: Update the spec status and any final implementation notes**

Change the status from `Draft` to the appropriate implemented status and add short notes if the final code differs in a material way from the draft.

- [ ] **Step 2: Run targeted verification for this feature**

Run:

```bash
pnpm --filter @dpf/db test -- src/reference-model-import.test.ts src/seed.test.ts
pnpm --filter web test -- lib/reference-model-data.test.ts lib/actions/ea.test.ts
pnpm --filter @dpf/db generate
```

Expected:
- targeted tests PASS
- Prisma client generation PASS

If broader commands still fail, capture them as pre-existing baseline issues rather than bundling them into this feature.

- [ ] **Step 3: Run broader verification and record results**

Run:

```bash
pnpm --filter @dpf/db test
pnpm --filter web test
pnpm --filter web typecheck
```

Expected:
- If failures persist only in the pre-existing baseline areas, document that clearly.
- If new failures appear in changed files, fix them before claiming completion.

- [ ] **Step 4: Commit final implementation/doc sync**

```bash
git add docs/superpowers/specs/2026-03-13-ea-reference-model-assessment-foundation-design.md
git commit -m "docs: sync EA reference model assessment spec status"
```

---

## Execution Notes

- Keep this implementation in `d:/OpenDigitalProductFactory/.worktrees/feature-ea-reference-model-assessment-foundation`.
- Do not mix in unrelated main-workspace changes.
- Prefer targeted tests while the repository baseline is not green.
- Keep IT4IT-specific parsing isolated to seed/import helpers so the core model stays generic.
- Do not add UI upload/import flows in this slice.
- Do not generalize the first scope beyond the four portfolios in this slice.
