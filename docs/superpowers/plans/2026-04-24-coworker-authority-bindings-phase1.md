# Coworker Authority Bindings Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Phase 1 coworker authority-binding control plane so DPF can centrally configure route/workspace coworker application and human/coworker access from both `/platform/identity/authorization` and `/platform/ai/assignments`.

**Architecture:** Add an additive `AuthorityBinding` schema layer that sits beside the current `Agent`, `AgentGovernanceProfile`, `AgentToolGrant`, `DelegationGrant`, and `AuthorizationDecisionLog` models. Build one shared binding read/write service and one shared list + detail drawer UI, then mount that UI from the two existing admin entry points with different default pivots while extending the audit inspector to include binding-based narrowing in effective permission evaluation.

**Tech Stack:** Next.js 16 App Router, React Server Components + client components, Prisma 7, PostgreSQL, TypeScript, Vitest, existing platform identity/audit UI components.

**Authoritative spec:** [docs/superpowers/specs/2026-04-24-coworker-authority-binding-admin-design.md](../specs/2026-04-24-coworker-authority-binding-admin-design.md)

---

## Incremental Merge Slices

To keep concurrent-thread merge risk down, Phase 1 should land as a sequence of smaller PRs rather than one long-lived branch.

1. **Slice A: Binding substrate and shared admin surfaces**
   - authority-binding schema and migration
   - shared binding query/editor services
   - shared list/detail UI
   - `/platform/identity/authorization` and `/platform/ai/assignments` mounts

2. **Slice B: Audit and evidence linkage**
   - effective-permissions route/binding explanation
   - audit deep-link back to shared binding editor
   - `AuthorizationDecisionLog.authorityBindingId` wiring
   - binding evidence panel fed by real decision logs

3. **Slice C: Bootstrap and operational hardening**
   - idempotent binding inference/bootstrap
   - filter UX polish
   - broader route/workspace seed coverage
   - any follow-on migration/data repair required by live rollout

The current branch should stop at the end of Slice B. Slice C should start from a fresh branch after this work merges.

---

## File Structure

Expected files and responsibilities before task execution:

- `packages/db/prisma/schema.prisma`
  - add `AuthorityBinding`, `AuthorityBindingSubject`, `AuthorityBindingGrant`, and nullable `authorityBindingId` on `AuthorizationDecisionLog`
- `packages/db/prisma/migrations/<timestamp>_add_authority_bindings/migration.sql`
  - additive migration with inline bootstrap SQL where confidence is high
- `apps/web/lib/authority/bindings.ts`
  - shared query helpers for listing, loading, and summarizing bindings
- `apps/web/lib/authority/binding-editor.ts`
  - create/update logic and monotonicity validation
- `apps/web/lib/authority/effective-authority.ts`
  - helper that adds binding narrowing into the existing effective permission explanation path
- `apps/web/lib/authority/bootstrap-bindings.ts`
  - one-shot, idempotent inference logic for initial binding creation (commit and dry-run modes)
- `apps/web/lib/authority/bindings.test.ts`, `binding-editor.test.ts`, `bootstrap-bindings.test.ts`, `effective-authority.test.ts`
  - unit coverage for list shaping, monotonicity validation, inference idempotency, and effective-authority explanation
- `apps/web/components/platform/authority/BindingList.tsx`
  - shared list with URL-backed filters and pivoting
- `apps/web/components/platform/authority/BindingDetailDrawer.tsx`
  - the only editable binding UI
- `apps/web/components/platform/authority/BindingFilters.tsx`
  - filter controls used by both admin entry points
- `apps/web/components/platform/authority/BindingEvidencePanel.tsx`
  - read-only evidence slice inside the drawer
- `apps/web/components/platform/authority/*.test.tsx`
  - component tests for list, drawer, and filter behavior
- `apps/web/app/(shell)/platform/identity/authorization/page.tsx`
  - mount shared binding list with human-first default pivot
- `apps/web/app/(shell)/platform/ai/assignments/page.tsx`
  - mount shared binding list with coworker-first default pivot beside existing model assignment table/tabs
- `apps/web/app/(shell)/platform/identity/authorization/bindings/[bindingId]/page.tsx`
  - full-page fallback for deep links
- `apps/web/app/(shell)/platform/ai/assignments/bindings/[bindingId]/page.tsx`
  - full-page fallback for deep links
- `apps/web/app/(shell)/platform/audit/authority/page.tsx`
  - wire `authorityBindingId` into effective permission inspection and add deep-link affordance
- `apps/web/components/platform/EffectivePermissionsPanel.tsx`
  - show binding term in the effective permission explanation
- `apps/web/app/api/platform/authority-bindings/*`
  - CRUD endpoints or server actions for binding edit flows, matching repo conventions
- `tests/e2e/platform-qa-plan.md`
  - add platform QA cases for binding management and audit-to-config deep-linking

---

## Chunk 1: Schema And Authority Service Foundation

### Task 1.1: Add the authority-binding schema

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_authority_bindings/migration.sql`
- Create: `packages/db/src/authority-bindings.test.ts`

- [ ] **Step 1: Write the failing DB test**

```ts
it("creates a route-scoped authority binding with subjects and grants", async () => {
  const binding = await prisma.authorityBinding.create({
    data: {
      bindingId: "AB-000001",
      name: "Finance workspace controller",
      scopeType: "route",
      status: "active",
      resourceType: "route",
      resourceRef: "/finance",
      approvalMode: "proposal-required",
      subjects: {
        create: [{ subjectType: "platform-role", subjectRef: "HR-400", relation: "allowed" }],
      },
      grants: {
        create: [{ grantKey: "ledger_write", mode: "require-approval" }],
      },
    },
    include: { subjects: true, grants: true },
  });

  expect(binding.subjects).toHaveLength(1);
  expect(binding.grants[0]?.mode).toBe("require-approval");
});
```

- [ ] **Step 2: Run the targeted DB test**

Run: `pnpm --filter @dpf/db test authority-bindings`

Expected: FAIL because the Prisma models do not exist yet.

- [ ] **Step 3: Add the new Prisma models**

Add the minimal additive shape from the spec:

```prisma
model AuthorityBinding {
  id                String                   @id @default(cuid())
  bindingId         String                   @unique
  name              String
  scopeType         String
  status            String                   @default("draft")
  resourceType      String
  resourceRef       String
  appliedAgentId    String?
  policyJson        Json?
  authorityScope    Json?
  approvalMode      String                   @default("none")
  sensitivityCeiling String?
  createdAt         DateTime                 @default(now())
  updatedAt         DateTime                 @updatedAt
  subjects          AuthorityBindingSubject[]
  grants            AuthorityBindingGrant[]
}
```

Also add:

- `AuthorityBindingSubject`
- `AuthorityBindingGrant`
- nullable `authorityBindingId` on `AuthorizationDecisionLog`

- [ ] **Step 4: Generate the migration**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name add_authority_bindings --create-only
```

- [ ] **Step 5: Add inline bootstrap SQL**

Inside the generated migration:

- create rows only where a safe initial binding can be inferred
- do not attempt speculative mapping for every route
- backfill `authorityBindingId` only for rows that can be deterministically matched

- [ ] **Step 6: Apply migration and rerun DB test**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate deploy
pnpm --filter @dpf/db test authority-bindings
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/authority-bindings.test.ts
git commit -s -m "feat(authority): add authority binding schema"
```

### Task 1.2: Add shared binding query helpers

**Files:**
- Create: `apps/web/lib/authority/bindings.ts`
- Create: `apps/web/lib/authority/bindings.test.ts`

- [ ] **Step 1: Write the failing list-shaping tests**

```ts
it("groups bindings by subject for the human-first pivot", async () => {
  const result = await listAuthorityBindings({ pivot: "subject" });
  expect(result.rows[0]).toMatchObject({
    pivotLabel: "HR-400",
    resourceRef: "/finance",
  });
});

it("groups bindings by coworker for the coworker-first pivot", async () => {
  const result = await listAuthorityBindings({ pivot: "coworker" });
  expect(result.rows[0]?.appliedAgentId).toBeTruthy();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/bindings.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the list/load helpers**

Include:

- `listAuthorityBindings({ pivot, filters })`
- `getAuthorityBinding(bindingId)`
- `getAuthorityBindingEvidence(bindingId)`

Keep return types explicit and UI-friendly.

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/bindings.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/authority/bindings.ts apps/web/lib/authority/bindings.test.ts
git commit -s -m "feat(authority): add shared binding query helpers"
```

### Task 1.3: Add monotonicity validation and editor helpers

**Files:**
- Create: `apps/web/lib/authority/binding-editor.ts`
- Create: `apps/web/lib/authority/binding-editor.test.ts`

- [ ] **Step 1: Write the failing validation tests**

```ts
it("rejects a binding grant that widens an intrinsic agent grant", async () => {
  await expect(validateBindingGrant({
    intrinsic: [],
    requested: [{ grantKey: "ledger_write", mode: "allow" }],
  })).rejects.toThrow(/cannot widen/i);
});

it("accepts a binding grant that narrows an intrinsic agent grant", async () => {
  await expect(validateBindingGrant({
    intrinsic: ["ledger_write"],
    requested: [{ grantKey: "ledger_write", mode: "require-approval" }],
  })).resolves.not.toThrow();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/binding-editor.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement minimal validation and CRUD wrappers**

Implement:

- `validateBindingGrant()`
- `createAuthorityBinding()`
- `updateAuthorityBinding()`

Validation rules:

- binding grants can narrow only
- applied coworker must exist
- subject rows cannot duplicate `(binding, type, ref, relation)`

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/binding-editor.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/authority/binding-editor.ts apps/web/lib/authority/binding-editor.test.ts
git commit -s -m "feat(authority): enforce monotonic binding edits"
```

### Task 1.4: Add bootstrap inference for initial bindings

**Files:**
- Create: `apps/web/lib/authority/bootstrap-bindings.ts`
- Create: `apps/web/lib/authority/bootstrap-bindings.test.ts`

The spec requires a seed pass that **infers initial bindings from existing route↔coworker mappings and existing `UserGroup`/`PlatformRole`/`Team` relationships**, writing bindings only when confidence is high. Without this, every admin starts with an empty bindings list and no way to explain current behavior. This task isolates the inference so it is testable, idempotent, and safe to re-run after migration.

- [ ] **Step 1: Write the failing inference tests**

```ts
it("creates one binding per (route, applied coworker) pair with high-confidence subjects", async () => {
  await seedFixture({
    coworkers: ["finance-controller"],
    routeMappings: [{ route: "/finance", agentId: "finance-controller" }],
    roleAssignments: [{ roleId: "HR-400", userEmail: "cfo@example.com" }],
  });

  const report = await bootstrapAuthorityBindings({ writeMode: "commit" });

  expect(report.created).toBe(1);
  expect(report.skipped).toBe(0);
  const binding = await prisma.authorityBinding.findFirstOrThrow({ where: { resourceRef: "/finance" } });
  expect(binding.appliedAgentId).toBe("finance-controller");
  expect(binding.status).toBe("active");
});

it("is idempotent — a second run creates nothing new", async () => {
  await bootstrapAuthorityBindings({ writeMode: "commit" });
  const report = await bootstrapAuthorityBindings({ writeMode: "commit" });
  expect(report.created).toBe(0);
});

it("skips low-confidence inferences in dry-run mode", async () => {
  const report = await bootstrapAuthorityBindings({ writeMode: "dry-run" });
  expect(report.lowConfidence.length).toBeGreaterThan(0);
  expect(await prisma.authorityBinding.count()).toBe(0);
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/bootstrap-bindings.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the inference helper**

Requirements:

- read existing route↔coworker mappings and role/team/group data; do not mutate any of them
- generate a deterministic `bindingId` from the `(resourceType, resourceRef, appliedAgentId)` tuple so re-runs are idempotent
- support `writeMode: "dry-run" | "commit"`; dry-run returns a structured report only
- refuse to widen anything — all inferred bindings start at `status: "active"` with subjects sourced from current role/group data and grants empty (no narrowing yet, matching today's posture)
- emit a `lowConfidence` list for ambiguous mappings so admins can review manually instead of silently losing state

- [ ] **Step 4: Wire the bootstrap into the migration path**

Options:

- run once from the portal-init container after `prisma migrate deploy` completes
- or expose as a server action callable from the new bindings list page when it is empty

Pick the one that matches the repo's seed conventions (`packages/db/src/seed-*.ts`). Prefer the init-container path for fresh installs so the admin never sees an empty list.

- [ ] **Step 5: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/bootstrap-bindings.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/authority/bootstrap-bindings.ts apps/web/lib/authority/bootstrap-bindings.test.ts
git commit -s -m "feat(authority): bootstrap initial bindings from existing mappings"
```

---

## Chunk 2: Shared Binding UI

### Task 2.1: Build the shared list component

**Files:**
- Create: `apps/web/components/platform/authority/BindingList.tsx`
- Create: `apps/web/components/platform/authority/BindingFilters.tsx`
- Create: `apps/web/components/platform/authority/BindingList.test.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
it("renders subject-first rows for the identity entry point", () => {
  render(<BindingList pivot="subject" rows={[sampleRow]} />);
  expect(screen.getByText("HR-400")).toBeInTheDocument();
});

it("renders coworker-first rows for the AI entry point", () => {
  render(<BindingList pivot="coworker" rows={[sampleCoworkerRow]} />);
  expect(screen.getByText("Finance Controller")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/components/platform/authority/BindingList.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the list and filter UI**

Requirements:

- theme-aware styling only
- URL-driven filters
- no duplicate logic between pivots
- row click opens the shared drawer

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/components/platform/authority/BindingList.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/authority/BindingList.tsx apps/web/components/platform/authority/BindingFilters.tsx apps/web/components/platform/authority/BindingList.test.tsx
git commit -s -m "feat(authority): add shared binding list UI"
```

### Task 2.2: Build the shared detail drawer

**Files:**
- Create: `apps/web/components/platform/authority/BindingDetailDrawer.tsx`
- Create: `apps/web/components/platform/authority/BindingEvidencePanel.tsx`
- Create: `apps/web/components/platform/authority/BindingDetailDrawer.test.tsx`

- [ ] **Step 1: Write the failing drawer tests**

```tsx
it("renders summary, subjects, coworker application, and evidence panels", () => {
  render(<BindingDetailDrawer binding={sampleBinding} />);
  expect(screen.getByText("Summary")).toBeInTheDocument();
  expect(screen.getByText("Subjects")).toBeInTheDocument();
  expect(screen.getByText("Coworker application")).toBeInTheDocument();
  expect(screen.getByText("Evidence")).toBeInTheDocument();
});

it("disables widening grant edits", () => {
  render(<BindingDetailDrawer binding={sampleBinding} />);
  expect(screen.getByText(/can only narrow/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/components/platform/authority/BindingDetailDrawer.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the drawer**

Panels required for Phase 1:

- Summary
- Subjects
- Coworker application
- Evidence

Leave Resource Context and Danger Zone as TODOs only if they block no acceptance case.

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/components/platform/authority/BindingDetailDrawer.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/authority/BindingDetailDrawer.tsx apps/web/components/platform/authority/BindingEvidencePanel.tsx apps/web/components/platform/authority/BindingDetailDrawer.test.tsx
git commit -s -m "feat(authority): add shared binding detail drawer"
```

### Task 2.3: Add binding server actions or API handlers

**Files:**
- Create: `apps/web/app/api/platform/authority-bindings/route.ts`
- Create: `apps/web/app/api/platform/authority-bindings/[bindingId]/route.ts`
- Create: `apps/web/app/api/platform/authority-bindings/route.test.ts`

- [ ] **Step 1: Write the failing API tests**

```ts
it("updates binding subjects from the shared editor", async () => {
  const response = await PATCH("/api/platform/authority-bindings/AB-000001", {
    subjects: [{ subjectType: "platform-role", subjectRef: "HR-500", relation: "allowed" }],
  });
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/app/api/platform/authority-bindings/route.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement thin handlers over `binding-editor.ts`**

Keep the API thin:

- parse input
- authorize editor
- call the shared editor helper
- return normalized UI payload

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/app/api/platform/authority-bindings/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/platform/authority-bindings apps/web/app/api/platform/authority-bindings/route.test.ts
git commit -s -m "feat(authority): add binding CRUD endpoints"
```

---

## Chunk 3: Admin Entry Points

### Task 3.1: Extend `/platform/identity/authorization`

**Files:**
- Modify: `apps/web/app/(shell)/platform/identity/authorization/page.tsx`
- Create: `apps/web/app/(shell)/platform/identity/authorization/bindings/[bindingId]/page.tsx`
- Modify: `apps/web/app/(shell)/platform/identity/authorization/page.test.tsx` (file already exists — extend it, do not overwrite)

- [ ] **Step 1: Write the failing page test**

```tsx
it("renders the human-first binding list above the existing authorization bundle", async () => {
  render(await PlatformIdentityAuthorizationPage());
  expect(screen.getByText(/authorization bindings/i)).toBeInTheDocument();
  expect(screen.getByText(/role bundles/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/app/(shell)/platform/identity/authorization/page.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Mount the shared list**

Requirements:

- default pivot: `subject`
- preserve `AuthorizationBundlePanel`
- support `?binding=<id>` drawer open state
- add full-page fallback route

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/app/(shell)/platform/identity/authorization/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/identity/authorization/page.tsx apps/web/app/(shell)/platform/identity/authorization/bindings/[bindingId]/page.tsx apps/web/app/(shell)/platform/identity/authorization/page.test.tsx
git commit -s -m "feat(identity): mount human-first authority bindings"
```

### Task 3.2: Extend `/platform/ai/assignments`

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/assignments/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/assignments/bindings/[bindingId]/page.tsx`
- Create: `apps/web/app/(shell)/platform/ai/assignments/page.test.tsx`

- [ ] **Step 1: Write the failing page test**

```tsx
it("renders coworker bindings without replacing the model assignment surface", async () => {
  render(await AssignmentsPage());
  expect(screen.getByText(/AI Coworker Model Assignment/i)).toBeInTheDocument();
  expect(screen.getByText(/resource bindings/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/app/(shell)/platform/ai/assignments/page.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Add the coworker-first binding view**

Requirements:

- do not create `/platform/ai/routing`
- keep model assignment table intact
- add a tab or peer section for `Resource Bindings`
- default pivot: `coworker`

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/app/(shell)/platform/ai/assignments/page.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(shell)/platform/ai/assignments/page.tsx apps/web/app/(shell)/platform/ai/assignments/bindings/[bindingId]/page.tsx apps/web/app/(shell)/platform/ai/assignments/page.test.tsx
git commit -s -m "feat(ai): mount coworker-first authority bindings"
```

---

## Chunk 4: Audit Integration And Acceptance Verification

### Task 4.1: Extend effective permissions to include bindings

**Files:**
- Create: `apps/web/lib/authority/effective-authority.ts`
- Create: `apps/web/lib/authority/effective-authority.test.ts`
- Modify: `apps/web/components/platform/EffectivePermissionsPanel.tsx`
- Modify: `apps/web/app/(shell)/platform/audit/authority/page.tsx`

- [ ] **Step 1: Write the failing explanation tests**

```ts
it("shows the binding term as the reason a permission was narrowed", async () => {
  const result = await explainEffectiveAuthority({
    roleId: "HR-400",
    agentId: "finance-controller",
    resourceRef: "/finance",
    actionKey: "ledger_write",
  });

  expect(result.binding?.bindingId).toBe("AB-000001");
  expect(result.decision).toBe("require-approval");
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/effective-authority.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the explanation helper and wire the panel**

Requirements:

- preserve existing role × agent inspection
- add binding context into the explanation chain
- show "Open binding" deep-link when a binding is present

- [ ] **Step 4: Rerun the targeted test**

Run: `pnpm --filter web test apps/web/lib/authority/effective-authority.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/authority/effective-authority.ts apps/web/lib/authority/effective-authority.test.ts apps/web/components/platform/EffectivePermissionsPanel.tsx apps/web/app/(shell)/platform/audit/authority/page.tsx
git commit -s -m "feat(audit): explain authority bindings in effective permissions"
```

### Task 4.2: Populate `authorityBindingId` at evaluation time

**Files:**
- Modify: whatever call-site currently writes `AuthorizationDecisionLog` rows (grep for `authorizationDecisionLog.create` in `apps/web/lib/`)
- Create or Modify: targeted test next to the evaluation module

Task 1.1 added the nullable `authorityBindingId` FK, but nothing populates it yet. Without this, the "Open binding" affordance in `EffectivePermissionsPanel` (Task 4.1) and the audit → config deep-link in User Flow D will always have a null binding reference. This task closes that loop.

- [ ] **Step 1: Locate the decision-log write path**

Run: `rg "authorizationDecisionLog\.create" apps/web/lib --type ts -l` and skim each match. Identify the single chokepoint (there should be one; if there is more than one, consolidate first).

- [ ] **Step 2: Write the failing integration test**

```ts
it("stamps authorityBindingId on decisions mediated by a binding", async () => {
  const binding = await createBindingFixture({ resourceRef: "/finance", appliedAgentId: "finance-controller" });

  await evaluateAuthority({
    actorType: "agent",
    actorRef: "finance-controller",
    actionKey: "ledger_write",
    routeContext: "/finance",
  });

  const log = await prisma.authorizationDecisionLog.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  expect(log.authorityBindingId).toBe(binding.id);
});

it("leaves authorityBindingId null when no binding applies", async () => {
  await evaluateAuthority({
    actorType: "agent",
    actorRef: "finance-controller",
    actionKey: "ledger_read",
    routeContext: "/unmanaged-route",
  });

  const log = await prisma.authorizationDecisionLog.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  expect(log.authorityBindingId).toBeNull();
});
```

- [ ] **Step 3: Run the targeted test**

Expected: FAIL.

- [ ] **Step 4: Wire the binding resolution into the evaluation path**

Requirements:

- resolve the governing `AuthorityBinding` using the same helper as `explainEffectiveAuthority` from Task 4.1 — do not duplicate the lookup logic
- write `authorityBindingId` on the log row whenever a binding narrowed the decision (including `allow` with `approvalMode: proposal-required`)
- never fail the evaluation if the binding lookup errors — log and continue with `authorityBindingId: null`, since this column is evidence, not policy

- [ ] **Step 5: Rerun the targeted test**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add <touched-files>
git commit -s -m "feat(authority): stamp binding ID on authorization decisions"
```

### Task 4.3: Add platform QA cases

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md`

- [ ] **Step 1: Add the new QA cases**

Map cases to spec user flows so reviewers can trace coverage:

- **Flow A** — narrow a coworker grant on a route from `/platform/ai/assignments`
- **Flow B** — restrict a route's subject list from `/platform/identity/authorization`
- **Flow D** — audit → config repair: from a narrowed decision in `/platform/audit/authority`, click "Open binding" and confirm the drawer opens on whichever list page was most recently used (default: human-first)
- Drawer-receiving half of **Flow C** — direct navigation to `/platform/identity/authorization?binding=<id>` opens the drawer with the human-first breadcrumb. The runtime-originator half (`AppliedPolicySummary`) is Phase 2 and is out of scope for these cases.
- Monotonicity guardrail — attempting to widen via the drawer is rejected in the UI and in the API

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/platform-qa-plan.md
git commit -s -m "test(qa): add authority binding admin cases"
```

### Task 4.4: Run verification and browser QA

**Files:**
- No source changes expected unless failures are found

- [ ] **Step 1: Run the targeted unit tests**

Run:

```bash
pnpm --filter @dpf/db test authority-bindings
pnpm --filter web test apps/web/lib/authority/bindings.test.ts apps/web/lib/authority/binding-editor.test.ts apps/web/lib/authority/bootstrap-bindings.test.ts apps/web/lib/authority/effective-authority.test.ts
pnpm --filter web test apps/web/components/platform/authority/BindingList.test.tsx apps/web/components/platform/authority/BindingDetailDrawer.test.tsx
pnpm --filter web test apps/web/app/(shell)/platform/identity/authorization/page.test.tsx apps/web/app/(shell)/platform/ai/assignments/page.test.tsx
```

Then run the full suites once to catch regressions:

```bash
pnpm --filter web test
pnpm --filter @dpf/db test
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter web typecheck`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `pnpm --filter web build`

Expected: PASS. (Do not use `npx next build` — CLAUDE.md forbids `npx` for workspace-pinned tools because it downloads latest from npm.)

- [ ] **Step 4: Rebuild the production runtime if route/UI behavior changed**

Run:

```bash
docker compose build --no-cache portal portal-init sandbox && docker compose up -d portal-init sandbox && docker compose up -d portal
```

- [ ] **Step 5: Run browser QA**

Exercise these paths; each maps to a spec user flow:

1. **Flow B** — `/platform/identity/authorization`
   - default pivot is `subject`
   - filter bindings by subject, resource, coworker, status (URL-encoded)
   - click a row to open the drawer; URL updates to `?binding=<id>`
   - edit subject rows; changes persist on reload
2. **Flow A** — `/platform/ai/assignments`
   - switch to the new `Resource Bindings` tab (existing model-assignment table is still present)
   - default pivot is `coworker`
   - open the same binding that was edited from the identity side; confirm it shows the updated subjects (proves both surfaces edit one record)
3. **Drawer-receiving half of Flow C** — direct-navigate to `/platform/identity/authorization?binding=<id>` and `/platform/identity/authorization/bindings/<id>`
   - drawer opens with human-first breadcrumb on the query-param form
   - full-page fallback renders the drawer inline
4. **Flow D** — `/platform/audit/authority`
   - inspect a narrowed decision in `EffectivePermissionsPanel`; confirm the binding term is attributed
   - click "Open binding"; confirm the drawer opens on the correct list page (default: human-first) with the narrowed grant visible
5. **Monotonicity guardrail** — in the drawer, attempt to widen an intrinsic grant
   - UI shows the "can only narrow" message from the drawer tests
   - API call (via devtools replay) returns a validation error
6. **Out of scope for Phase 1 — do not test here** — runtime `AppliedPolicySummary` on `/finance`, `/storefront`, `/build`. That ships in Phase 2.

- [ ] **Step 6: Commit any verification fixes**

```bash
git add <files-fixed-during-verification>
git commit -s -m "fix(authority): polish binding admin verification issues"
```

---

## Out Of Scope For This Plan

These belong in follow-on plans after Phase 1 lands:

- `RouteResource` registry and route seeding
- runtime `AppliedPolicySummary`
- GAID / `AIDoc` projection
- A2A `AgentCard` export
- broader identity-admin refactor of `UserGroup` into richer group semantics

---

## Execution Notes

- Follow the repo's current IA: configuration in `/platform/identity/*` and `/platform/ai/*`; evidence in `/platform/audit/*`.
- Do not create `/platform/ai/routing`; that slug is already a legacy redirect for routing-decision evidence.
- Keep edits additive. No big-bang rewrites of the current identity or coworker governance models.
- Every commit that touches TypeScript must pass local typecheck via the repo hook or an explicit `pnpm --filter web typecheck`.
- Every user-facing change must be browser-tested before the branch is called done.

Plan complete and saved to `docs/superpowers/plans/2026-04-24-coworker-authority-bindings-phase1.md`. Ready to execute?
