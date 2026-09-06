---
status: active
---

# Town-Informed Company Work Loop Implementation Plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Town-informed Work Case spec into an evidence-gated DPF implementation path that proves the municipal launch-readiness exercise, then adds the smallest missing coworker-engagement Work Case projection if the exercise confirms that gap.

**Architecture:** Keep Work Case as the durable company-work projection and keep `/workspace` / Needs You as the only owner decision surface. The first chunk creates the exercise evidence artifact required by the spec; later chunks only add source registry, read-model, loader, and UI changes if that artifact proves `CoworkerEngagement` needs first-class Work Case projection. No new database table, no standalone assistant UI, and no parallel dashboard.

**Tech Stack:** Next.js 16 app in `apps/web`, TypeScript, Prisma models from `packages/db`, Vitest, React server rendering tests, DPF `report-kit` UI primitives, Markdown docs under `docs/superpowers`.

---


> **Rescue note (2026-08-16).** Recovered from a branch that was pushed and never proposed as a PR, found in the 2026-08-15 never-proposed-branch sweep. **The design landed here; the implementation did not.**
>
> - Tracked by `BI-3B01B725` (recovered tail designs). Read it before acting on this document.
> - Preserved implementation: `doc/town-company-work-loop` @ `d903bac20cad8297e68ae5e54f010805c68719d5`, pinned at `refs/salvage/2026-08-15/doc/town-company-work-loop` and listed in `~/dpf-deleted-remote-branch-tips-2026-08-15.txt`. Restore with `git push origin d903bac20cad8297e68ae5e54f010805c68719d5:refs/heads/doc/town-company-work-loop`.
> - Backlog labels cited below that do **not** resolve in this install: `historic-F309BB95`. Treat them as historic labels, not links.
> - Live implementation item for the current branch: `BI-0EA09322` (Project coworker service engagements into Work Case company work).
> - Current exercise evidence: `docs/superpowers/evidence/2026-09-06-town-informed-company-work-loop-exercise.md`.
> - No coverage receipt is recorded and none should be until a thread actually starts — a receipt bound to unstarted work would be fiction. This document is deliberately outside the plan-backlog-coverage gate (it carries no bolded backlog-item metadata line).

## File Structure

- Create: `docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md`
  - Responsibility: one human-readable exercise record for the historic-F309BB95 exercise label, including coworker packets, Needs You decision, evidence, "none found" entries, and proven gaps.
- Modify: `apps/web/lib/work-management/source-registry.ts`
  - Responsibility: register `coworker-engagement` as a Work Case source only if Chunk 1 proves the source is needed.
- Modify: `apps/web/lib/work-management/source-registry.test.ts`
  - Responsibility: lock the registry entry and keep account-resolver keys explicit.
- Modify: `apps/web/lib/work-management/case-types.ts`
  - Responsibility: add the source-ref kind needed to show coworker engagements in Work Case timelines.
- Modify: `apps/web/lib/work-management/status-projection.ts`
  - Responsibility: map `CoworkerEngagement.status` values to Work Case state/A2A status without leaking technical recovery into Needs You.
- Modify: `apps/web/lib/work-management/case-read-model.ts`
  - Responsibility: accept a coworker-engagement read-model input and project it into summary/source refs/timeline.
- Modify: `apps/web/lib/work-management/case-read-model.test.ts`
  - Responsibility: prove `needs-approval` creates an awaiting-decision Work Case and completed/rejected states are terminal.
- Modify: `apps/web/lib/work-management/workspace-case-loader.ts`
  - Responsibility: load coworker engagements requested by or visible to the owner and merge them with WorkItem-backed cases.
- Modify: `apps/web/lib/work-management/workspace-case-loader.test.ts`
  - Responsibility: prove mixed WorkItem and CoworkerEngagement cases sort by attention and detail loads from one encoded Work Case key.
- Modify: `apps/web/components/workspace/WorkCaseDetailView.tsx`
  - Responsibility: show coworker contribution/source refs using existing theme tokens and `report-kit`, without a new dashboard surface.
- Modify: `apps/web/components/workspace/WorkCaseDetailView.test.tsx`
  - Responsibility: prove coworker engagement source refs render and no hardcoded colors are introduced.
- Maybe modify: `apps/web/components/workspace/WorkCaseAttentionLens.tsx`
  - Responsibility: only if needed, make copy/sorting labels clear for coworker-engagement cases while preserving the existing Work Cases route.
- Maybe modify: `apps/web/components/workspace/WorkCaseAttentionLens.test.tsx`
  - Responsibility: prove the lens still uses report-kit and remains one attention surface.

---

## Chunk 1: Exercise Evidence Gate

### Task 1: Create The Municipal Launch-Readiness Exercise Artifact

**Files:**
- Create: `docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md`
- Reference: `docs/superpowers/specs/2026-07-24-town-informed-company-work-loop-design.md`
- Reference: `docs/superpowers/specs/2026-06-27-work-management-architecture-design.md`
- Reference: `docs/superpowers/specs/2026-06-23-human-attention-surface-design.md`
- Reference: `docs/superpowers/specs/2026-06-30-coworker-service-offer-catalog-design.md`

- [ ] **Step 1: Verify the evidence file does not already exist**

Run:

```powershell
Test-Path 'docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md'
```

Expected: `False`

- [ ] **Step 2: Write the exercise artifact**

Use this exact section structure:

```markdown
# Town-Informed Company Work Loop Exercise

| Field | Value |
| --- | --- |
| Date | 2026-07-24 |
| Governing spec | docs/superpowers/specs/2026-07-24-town-informed-company-work-loop-design.md |
| Governing epic | EP-2984B02B |
| Primary backlog item | BI-0EA09322 |
| Exercise mode | source-grounded dry run |
| Runtime limitation | Live runtime was not used; findings are valid only for source/schema/read-model/UI planning. |

## Initial Broad Request

Capture one municipal services portal launch-readiness outcome as a Work Case.

## Compact Turn-By-Turn Summary

Record the decomposition from one broad request into strategy, architecture, compliance, storefront, finance, operations, Build Studio, and QA coworker contributions. Use one row per turn or decision point.

## Work Case Identity

Record the proposed Work Case id, source type, source id, sponsor, and owning decision scope.

## Coworker Contribution Packets

| Coworker | Source reference | Expected output packet | Approval trigger | Evidence/receipt required | Result |
| --- | --- | --- | --- | --- | --- |
| Strategy / COO | Work Case business brief | Launch goal, stakeholders, success criteria, risks | Scope changes that affect launch commitment | Operator note or governed action receipt | Recorded |
| Enterprise Architect | Architecture evidence | Primitive reuse and boundary review | WWMD if DPF substrate changes | Architecture evidence note | Recorded |
| Compliance / Legal | Compliance packet | Privacy, retention, accessibility, and approval constraints | WWWD/WSID when obligations alter launch posture | DecisionInteraction or compliance evidence | Recorded |
| Storefront / Product | Portal flow source | Resident request lifecycle and Build Studio brief | WWWD for resident-facing process commitments | Product packet evidence | Recorded |
| Finance | Finance packet | Fees, refunds, payments, procurement concerns | Funding or paid-provider approval | ApprovalContext and finance evidence | Recorded |
| Operations / Dispatcher | Dispatch source mapping | Routing, assignment, SLA, field exception path | Operational policy exception | Dispatch evidence note | Recorded |
| Build Studio | Work Capsule reference | Implementation scope only after gates are clear | WWMD for platform build scope | Work Capsule/evidence link | Recorded |
| QA / Assurance | Verification source | Launch checklist and acceptance tests | Release readiness decision | Verification receipt | Recorded |

## Required Needs You Decision

Record one human-facing decision, why it belongs in Needs You, and why no technical recovery item should inflate the Needs You count.

## Evidence And Receipts

List the evidence IDs, receipt IDs, source refs, and any source-level limitation.

## Gap Results

| Hypothesis | Result | Evidence | Follow-up |
| --- | --- | --- | --- |
| CoworkerEngagement as Work Case source | Proven or not proven | Source/code reference | File BI only if proven |
| Multi-coworker session rollup | Proven or not proven | Source/code reference | File BI only if proven |
| Routine promotion edge | Proven or not proven | Source/code reference | File BI only if proven |
| Needs You source coherence | Proven or not proven | Source/code reference | File BI only if proven |
| Memory and Commons boundary | Proven or not proven | Source/code reference | File BI only if proven |
| Work Case read-model coverage | Proven or not proven | Source/code reference | File BI only if proven |

## Explicit None Found Entries

- Follow-on backlog items: none found, or list exact filed IDs.
- Repeated-work/routine candidates: none found, or list exact candidate.
- Memory/commons candidates: none found, or list exact candidate.
- Implementation gaps: none found, or list exact proven gap.

## Planning Decision

Use exactly one gate-result line:

- Gate result: source-level implementation may proceed
- Gate result: runtime exercise is mandatory first

Then record:

- Live-runtime dependency: yes or no
- Implementation gap selected: none found, CoworkerEngagement as Work Case source, Work Case read-model coverage, or other exact gap
- Reason: one paragraph grounding the decision in the evidence above
```

- [ ] **Step 3: Run doc verification**

Run:

```powershell
pnpm docs:index:check
pnpm docs:links
rg -n "[^\x00-\x7F]" 'docs\superpowers\evidence\2026-07-24-town-informed-company-work-loop-exercise.md'
$path = 'docs\superpowers\evidence\2026-07-24-town-informed-company-work-loop-exercise.md'
$content = Get-Content -Raw -LiteralPath $path
$requiredHeadings = @(
  '## Initial Broad Request',
  '## Compact Turn-By-Turn Summary',
  '## Work Case Identity',
  '## Coworker Contribution Packets',
  '## Required Needs You Decision',
  '## Evidence And Receipts',
  '## Gap Results',
  '## Explicit None Found Entries',
  '## Planning Decision'
)
foreach ($heading in $requiredHeadings) {
  $count = ([regex]::Matches($content, "(?m)^$([regex]::Escape($heading))$")).Count
  if ($count -ne 1) { throw "Expected exactly one heading: $heading; found $count" }
}
$requiredPatterns = @(
  '^-\s+Gate result: (source-level implementation may proceed|runtime exercise is mandatory first)$',
  '^-\s+Live-runtime dependency: (yes|no)$',
  '^-\s+Implementation gap selected: (none found|CoworkerEngagement as Work Case source|Work Case read-model coverage|.+)$',
  'CoworkerEngagement as Work Case source',
  'Multi-coworker session rollup',
  'Routine promotion edge',
  'Needs You source coherence',
  'Memory and Commons boundary',
  'Work Case read-model coverage',
  'Follow-on backlog items:',
  'Repeated-work/routine candidates:',
  'Memory/commons candidates:',
  'Implementation gaps:'
)
foreach ($pattern in $requiredPatterns) {
  $count = ([regex]::Matches($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::Multiline)).Count
  if ($count -lt 1) { throw "Missing required artifact content matching: $pattern" }
}
if (([regex]::Matches($content, '(?m)^-\s+Gate result:')).Count -ne 1) { throw 'Expected exactly one Gate result line' }
if (([regex]::Matches($content, '(?m)^-\s+Live-runtime dependency:')).Count -ne 1) { throw 'Expected exactly one Live-runtime dependency line' }
if (([regex]::Matches($content, '(?m)^-\s+Implementation gap selected:')).Count -ne 1) { throw 'Expected exactly one Implementation gap selected line' }
```

Expected:
- `pnpm docs:index:check` exits 0 with `doc index fresh`.
- `pnpm docs:links` exits 0 with no error-level findings.
- `rg` exits 1 with no matches.
- the PowerShell assertion exits 0; otherwise it throws the missing or duplicated heading/field.

- [ ] **Step 4: Commit the evidence artifact**

Run:

```powershell
git add docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md
git commit -s -m "docs: add town-informed work loop exercise"
git push
```

Expected: one signed docs commit pushed to `origin/doc/town-company-work-loop`.

### Task 2: Stop If The Exercise Does Not Prove A Code Gap

**Files:**
- Read: `docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md`

- [ ] **Step 1: Read the `Planning Decision` section**

Run:

```powershell
rg -n "Planning Decision|Gate result:|Live-runtime dependency:|Implementation gap selected:" 'docs\superpowers\evidence\2026-07-24-town-informed-company-work-loop-exercise.md'
```

Expected: output includes exactly one `Gate result:` line, one `Live-runtime dependency:` line, and one `Implementation gap selected:` line.

- [ ] **Step 2: Apply the gate**

Evaluate live-runtime dependency first. If `Live-runtime dependency: yes` or `Gate result: runtime exercise is mandatory first` appears, stop regardless of which gap was proven and run the live runtime exercise before code work.

If `Implementation gap selected: none found`, stop after Chunk 1 and report that no code should be changed yet.

If `Live-runtime dependency: no`, `Gate result: source-level implementation may proceed`, and `Implementation gap selected:` is `CoworkerEngagement as Work Case source` or `Work Case read-model coverage`, continue to Chunk 2.

---

## Chunk 2: Coworker Engagement Work Case Projection

### Task 3: Add Failing Registry And Status Projection Tests

**Files:**
- Modify: `apps/web/lib/work-management/source-registry.test.ts`
- Modify: `apps/web/lib/work-management/status-projection.test.ts`
- Modify: `apps/web/lib/work-management/case-read-model.test.ts`
- Modify: `apps/web/lib/work-management/status-projection.ts` only after the failing test is observed

- [ ] **Step 1: Add a source-registry test for coworker engagement**

Add this test:

```ts
it("registers coworker engagements as company-work sources without account resolution", () => {
  const entry = getWorkCaseSourceEntry("coworker-engagement");

  expect(entry).toMatchObject({
    sourceKey: "coworker-engagement",
    displayLabel: "Coworker engagement",
    owningArea: "coworker-service-catalog",
    domainCategory: "ai-coworker-service",
    defaultDecisionScope: "wwwd",
    accountResolverKey: null,
  });
});
```

- [ ] **Step 2: Add status-projection tests for coworker engagement lifecycle**

Add direct tests in `status-projection.test.ts`:

```ts
it("projects coworker engagement waits and working states", () => {
  expect(
    projectWorkCaseState({
      coworkerEngagement: { engagementId: "CE-1", status: "needs-approval" },
    }),
  ).toMatchObject({
    state: "awaiting-decision",
    a2aStatus: "auth-required",
    terminal: false,
    blockingActorKind: "decision",
    sourceRef: { kind: "coworker-engagement", id: "CE-1", status: "needs-approval" },
  });

  expect(
    projectWorkCaseState({
      coworkerEngagement: { engagementId: "CE-2", status: "accepted" },
    }),
  ).toMatchObject({
    state: "active",
    a2aStatus: "working",
    terminal: false,
  });

  expect(
    projectWorkCaseState({
      coworkerEngagement: { engagementId: "CE-3", status: "in-progress" },
    }),
  ).toMatchObject({
    state: "active",
    a2aStatus: "working",
    terminal: false,
  });
});

it("projects coworker engagement terminal states", () => {
  expect(
    projectWorkCaseState({
      coworkerEngagement: { engagementId: "CE-4", status: "completed" },
    }),
  ).toMatchObject({
    state: "resolved",
    a2aStatus: "completed",
    terminal: true,
  });

  expect(
    projectWorkCaseState({
      coworkerEngagement: { engagementId: "CE-5", status: "rejected" },
    }),
  ).toMatchObject({
    state: "cancelled",
    a2aStatus: "rejected",
    terminal: true,
  });
});
```

- [ ] **Step 3: Add read-model tests for coworker engagement composition**

Add tests that call `buildWorkCaseSummary` and `buildWorkCaseDetail` with a new `coworkerEngagement` input:

```ts
it("projects a coworker engagement that needs approval as an owner decision", () => {
  const summary = buildWorkCaseSummary({
    source: { sourceType: "coworker-engagement", sourceId: "CE-1" },
    coworkerEngagement: {
      engagementId: "CE-1",
      status: "needs-approval",
      requestedOutcome: "Prepare the municipal launch finance packet.",
      providerAgentId: "finance-agent",
    },
  });

  expect(summary).toMatchObject({
    caseId: "coworker-engagement:CE-1",
    title: "Prepare the municipal launch finance packet.",
    sourceLabel: "Coworker engagement",
    state: "awaiting-decision",
    a2aStatus: "auth-required",
    nextAction: "Resolve pending decision",
    attention: { required: true },
  });
  expect(summary.sourceRefs).toContainEqual({
    kind: "coworker-engagement",
    id: "CE-1",
    status: "needs-approval",
  });
});

it("keeps coworker engagement evidence in the Work Case timeline", () => {
  const detail = buildWorkCaseDetail({
    source: { sourceType: "coworker-engagement", sourceId: "CE-2" },
    coworkerEngagement: {
      engagementId: "CE-2",
      status: "completed",
      requestedOutcome: "Prepare the storefront packet.",
      providerAgentId: "product-agent",
    },
    evidence: [{ evidenceId: "CE-2:receipt", kind: "governed-action", summary: "Packet accepted." }],
  });

  expect(detail.summary).toMatchObject({
    state: "resolved",
    terminal: true,
  });
  expect(detail.timeline.map((event) => event.sourceRef.kind)).toEqual([
    "coworker-engagement",
    "evidence",
  ]);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/source-registry.test.ts lib/work-management/status-projection.test.ts lib/work-management/case-read-model.test.ts
```

Expected: FAIL because `coworker-engagement` is not registered and `coworkerEngagement` is not accepted by the read model.

### Task 4: Implement The Registry, Types, And Status Mapping

**Files:**
- Modify: `apps/web/lib/work-management/source-registry.ts`
- Modify: `apps/web/lib/work-management/case-types.ts`
- Modify: `apps/web/lib/work-management/status-projection.ts`
- Modify: `apps/web/lib/work-management/case-read-model.ts`

- [ ] **Step 1: Add source registry entry**

Add this entry to `WORK_CASE_SOURCE_REGISTRY`:

```ts
{
  sourceKey: "coworker-engagement",
  displayLabel: "Coworker engagement",
  owningArea: "coworker-service-catalog",
  domainCategory: "ai-coworker-service",
  defaultDecisionScope: "wwwd",
  accountResolverKey: null,
  titleProjection: "Use the requested outcome.",
  summaryProjection: "Use provider agent, status, approval context, and attached Work Capsule.",
  supportedTransitions: STANDARD_TRANSITIONS,
  receiptPolicy: GOVERNED_RECEIPT_POLICY,
},
```

- [ ] **Step 2: Add the source-ref kind**

In `case-types.ts`, add `"coworker-engagement"` to `WorkCaseSourceRefKind`.

- [ ] **Step 3: Add coworker engagement status input and projection**

Extend `WorkCaseStatusProjectionInput`:

```ts
coworkerEngagement?: {
  engagementId: string;
  status: string;
} | null;
```

Add a projector before `projectCapsule` and after `projectRuntimeVerification`:

```ts
function projectCoworkerEngagement(
  engagement: NonNullable<WorkCaseStatusProjectionInput["coworkerEngagement"]>,
): WorkCaseStateProjection | null {
  const status = normalized(engagement.status);
  if (status === "needs-approval") {
    return projection({
      state: "awaiting-decision",
      reason: "Coworker engagement is waiting on owner approval.",
      sourceRef: ref("coworker-engagement", engagement.engagementId, engagement.status),
      blockingActorKind: "decision",
      a2aStatus: "auth-required",
    });
  }
  if (status === "requested") {
    return projection({
      state: "triage",
      reason: "Coworker engagement is requested and waiting to start.",
      sourceRef: ref("coworker-engagement", engagement.engagementId, engagement.status),
    });
  }
  if (status === "accepted" || status === "in-progress") {
    return projection({
      state: "active",
      reason: "Coworker engagement is actively executing.",
      sourceRef: ref("coworker-engagement", engagement.engagementId, engagement.status),
    });
  }
  if (status === "completed") {
    return projection({
      state: "resolved",
      reason: "Coworker engagement completed.",
      sourceRef: ref("coworker-engagement", engagement.engagementId, engagement.status),
    });
  }
  if (status === "rejected" || status === "cancelled") {
    return projection({
      state: "cancelled",
      reason: "Coworker engagement is no longer active.",
      sourceRef: ref("coworker-engagement", engagement.engagementId, engagement.status),
      a2aStatus: status === "rejected" ? "rejected" : "canceled",
    });
  }
  return null;
}
```

Then call it inside `projectWorkCaseState` before capsule projection:

```ts
if (input.coworkerEngagement) {
  const engagementProjection = projectCoworkerEngagement(input.coworkerEngagement);
  if (engagementProjection) return engagementProjection;
}
```

- [ ] **Step 4: Add read-model input and source refs**

Add this interface to `case-read-model.ts`:

```ts
export interface WorkCaseReadModelCoworkerEngagementInput {
  engagementId: string;
  status: string;
  requestedOutcome: string;
  providerAgentId?: string | null;
  workCapsuleId?: string | null;
}
```

Add `coworkerEngagement?: WorkCaseReadModelCoworkerEngagementInput | null;` to `BuildWorkCaseReadModelInput`.

In `sourceRefsForInput`, push:

```ts
if (input.coworkerEngagement) {
  refs.push({
    kind: "coworker-engagement",
    id: input.coworkerEngagement.engagementId,
    status: input.coworkerEngagement.status,
  });
}
```

In `buildWorkCaseSummary`, include `coworkerEngagement` in `projectionInput` and set title fallback:

```ts
title: input.workItem?.title ?? input.coworkerEngagement?.requestedOutcome ?? `${sourceEntry?.displayLabel ?? input.source.sourceType} ${input.source.sourceId}`,
```

In `buildWorkCaseDetail`, add a timeline event before evidence:

```ts
function coworkerEngagementTimelineEvent(
  engagement: WorkCaseReadModelCoworkerEngagementInput,
): WorkCaseTimelineEvent {
  return {
    eventId: `coworker-engagement:${engagement.engagementId}`,
    label: engagement.requestedOutcome,
    sourceRef: {
      kind: "coworker-engagement",
      id: engagement.engagementId,
      status: engagement.status,
    },
  };
}
```

The final timeline array should place coworker engagement before evidence:

```ts
timeline: [
  ...(input.coworkerEngagement ? [coworkerEngagementTimelineEvent(input.coworkerEngagement)] : []),
  ...capsules.map(capsuleTimelineEvent),
  ...decisions.map(decisionTimelineEvent),
  ...evidence.map(evidenceTimelineEvent),
],
```

- [ ] **Step 5: Run tests to verify registry/read-model pass**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/source-registry.test.ts lib/work-management/status-projection.test.ts lib/work-management/case-read-model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Chunk 2 core projection**

Run:

```powershell
git add apps/web/lib/work-management/source-registry.ts apps/web/lib/work-management/source-registry.test.ts apps/web/lib/work-management/case-types.ts apps/web/lib/work-management/status-projection.ts apps/web/lib/work-management/status-projection.test.ts apps/web/lib/work-management/case-read-model.ts apps/web/lib/work-management/case-read-model.test.ts
git status --short
git commit -s -m "feat: project coworker engagements as work cases"
git push
```

Expected: `git status --short` shows only Chunk 2 files staged; one signed feature commit pushed.

---

## Chunk 3: Workspace Loader And UI Composition

### Task 5: Add Failing Workspace Loader Tests

**Files:**
- Modify: `apps/web/lib/work-management/workspace-case-loader.test.ts`

- [ ] **Step 1: Extend the fake Prisma client**

Add `coworkerEngagement.findMany` and `coworkerEngagement.findFirst` to `prismaFor`. Keep existing work-item tests unchanged.

- [ ] **Step 2: Add a lens test for mixed Work Cases**

Add a test that returns one normal WorkItem and one CoworkerEngagement with status `needs-approval`. Assert:

```ts
expect(lens.cases.map((item) => item.caseId)).toContain("coworker-engagement:CE-1");
expect(lens.cases[0]).toMatchObject({
  caseId: "coworker-engagement:CE-1",
  sourceLabel: "Coworker engagement",
  state: "awaiting-decision",
  attentionRequired: true,
  href: "/workspace/cases/coworker-engagement%3ACE-1",
});
expect(lens.cases).toHaveLength(2);
```

- [ ] **Step 3: Add a detail test for coworker engagement case keys**

Assert `loadWorkspaceWorkCaseDetail` loads `caseKey: "coworker-engagement%3ACE-1"` and includes:

```ts
expect(fakeDb.coworkerEngagement.findFirst).toHaveBeenCalledWith(
  expect.objectContaining({
    where: {
      AND: [
        { engagementId: "CE-1" },
        {
          OR: [
            { requestedByUserId: "user-1" },
            { requestedByUserId: null },
          ],
        },
      ],
    },
  }),
);
expect(detail?.workItemId).toBeNull();
expect(detail?.workItemTitle).toBeNull();
expect(detail?.sourceRefs).toContainEqual({
  kind: "coworker-engagement",
  id: "CE-1",
  status: "needs-approval",
});
expect(detail?.sourceRefs).toContainEqual({
  kind: "work-capsule",
  id: "WC-1",
  status: "linked",
});
expect(detail?.evidenceTimeline.map((event) => event.sourceRef)).toEqual(
  expect.arrayContaining([
    { kind: "coworker-engagement", id: "CE-1", status: "needs-approval" },
    { kind: "evidence", id: "coworker-engagement:CE-1:approval-context", status: "approval-context" },
    { kind: "evidence", id: "coworker-engagement:CE-1:audit-refs", status: "audit-refs" },
    { kind: "evidence", id: "coworker-engagement:CE-1:metadata", status: "metadata" },
  ]),
);
```

- [ ] **Step 4: Run tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/workspace-case-loader.test.ts
```

Expected: FAIL because the loader only queries `workItem`.

### Task 6: Implement Workspace Loader Projection

**Files:**
- Modify: `apps/web/lib/work-management/workspace-case-loader.ts`
- Modify: `apps/web/components/workspace/WorkCaseDetailView.tsx`

- [ ] **Step 1: Make non-WorkItem details safe before loading coworker details**

Change `WorkspaceWorkCaseDetailView` so comment fields are nullable:

```ts
workItemId: string | null;
workItemTitle: string | null;
```

In `WorkCaseDetailView`, render `WorkItemCommentBox` only when both fields are present:

```tsx
{detail.workItemId && detail.workItemTitle ? (
  <section aria-labelledby="work-case-comment-title" className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
    <h2 id="work-case-comment-title" className="sr-only">Add a comment</h2>
    <WorkItemCommentBox workItemId={detail.workItemId} workItemTitle={detail.workItemTitle} />
  </section>
) : null}
```

Existing WorkItem-backed detail returns the same non-null values as before. Coworker-engagement detail must return `workItemId: null` and `workItemTitle: null`; never use an empty string sentinel.

- [ ] **Step 2: Add a coworker engagement record type**

Add a local type with fields used by the read model:

```ts
type WorkspaceCoworkerEngagementRecord = {
  engagementId: string;
  requestedOutcome: string;
  status: string;
  priority: string;
  providerAgentId: string;
  provider?: { displayName?: string | null } | null;
  requestedByUserId: string | null;
  requestedByAgentId?: string | null;
  workCapsuleId: string | null;
  approvalContext?: unknown;
  auditRefs?: unknown;
  metadata?: unknown;
  createdAt: Date | string;
  updatedAt?: Date | string;
};
```

Extend `WorkspaceCasePrismaClient` with:

```ts
coworkerEngagement?: {
  findMany(args: unknown): Promise<WorkspaceCoworkerEngagementRecord[]>;
  findFirst(args: unknown): Promise<WorkspaceCoworkerEngagementRecord | null>;
};
```

- [ ] **Step 3: Convert coworker engagement records to list items**

Add helper functions:

```ts
function sourceForEngagement(engagement: WorkspaceCoworkerEngagementRecord) {
  return { sourceType: "coworker-engagement", sourceId: engagement.engagementId };
}

function coworkerAssignmentLabel(engagement: WorkspaceCoworkerEngagementRecord): string {
  const displayName = engagement.provider?.displayName?.trim();
  return displayName ? `Coworker: ${displayName}` : "AI coworker";
}

function coworkerPriorityLabel(priority: string | null | undefined): string {
  const normalized = priority?.trim();
  if (!normalized) return "Normal";
  return normalized.slice(0, 1).toUpperCase() + normalized.slice(1).replaceAll("-", " ");
}

function toCoworkerEngagementListItem(
  engagement: WorkspaceCoworkerEngagementRecord,
): WorkspaceWorkCaseListItem {
  const source = sourceForEngagement(engagement);
  const summary = buildWorkCaseSummary({
    source,
    coworkerEngagement: {
      engagementId: engagement.engagementId,
      status: engagement.status,
      requestedOutcome: engagement.requestedOutcome,
      providerAgentId: engagement.providerAgentId,
      workCapsuleId: engagement.workCapsuleId,
    },
  });
  return {
    caseId: summary.caseId,
    href: `/workspace/cases/${encodeWorkCaseKey(source)}`,
    title: summary.title,
    sourceLabel: summary.sourceLabel,
    state: summary.state,
    stateReason: summary.stateReason,
    a2aStatus: summary.a2aStatus,
    terminal: summary.terminal,
    nextAction: summary.nextAction,
    urgency: engagement.priority,
    urgencyLabel: coworkerPriorityLabel(engagement.priority),
    effortLabel: "Coworker",
    dueAt: null,
    assignmentLabel: coworkerAssignmentLabel(engagement),
    attentionRequired: summary.attention.required,
    attentionReason: summary.attention.reason,
    description: null,
    sourceRefs: summary.sourceRefs,
  };
}
```

- [ ] **Step 4: Merge coworker engagements into the lens**

In `loadWorkspaceWorkCaseLens`, query `coworkerEngagement?.findMany` for visible active records:

```ts
const engagements = await prismaClient.coworkerEngagement?.findMany({
  where: {
    OR: [
      { requestedByUserId: userId },
      { requestedByUserId: null },
    ],
    status: { notIn: ["completed", "cancelled", "rejected"] },
  },
  include: { provider: { select: { displayName: true } } },
  orderBy: [{ createdAt: "asc" }],
  take: limit,
}) ?? [];

const cases = [
  ...items.map((item) => toListItem(item, userId, now)),
  ...engagements.map((engagement) => toCoworkerEngagementListItem(engagement)),
].sort(sortCases).slice(0, limit);
```

- [ ] **Step 5: Project engagement evidence from approval, audit, metadata, and capsule refs**

Add a helper that converts structured engagement fields into evidence records:

```ts
function summarizeRecord(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record).filter(([, entry]) => entry !== null && entry !== undefined && entry !== "");
  return entries.length > 0 ? entries.map(([key, entry]) => `${key}: ${String(entry)}`).join("; ") : null;
}

function evidenceFromCoworkerEngagement(
  engagement: WorkspaceCoworkerEngagementRecord,
): WorkCaseReadModelEvidenceInput[] {
  const evidence: WorkCaseReadModelEvidenceInput[] = [];
  const approval = summarizeRecord(engagement.approvalContext);
  if (approval) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:approval-context`,
      kind: "approval-context",
      summary: approval,
    });
  }
  const audit = summarizeRecord(engagement.auditRefs);
  if (audit) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:audit-refs`,
      kind: "audit-refs",
      summary: audit,
    });
  }
  const metadata = summarizeRecord(engagement.metadata);
  if (metadata) {
    evidence.push({
      evidenceId: `coworker-engagement:${engagement.engagementId}:metadata`,
      kind: "metadata",
      summary: metadata,
    });
  }
  return evidence;
}
```

If `engagement.workCapsuleId` is present, pass it to `buildWorkCaseDetail` as:

```ts
capsule: { capsuleId: engagement.workCapsuleId, status: "linked", title: "Coworker execution capsule" },
```

- [ ] **Step 6: Load coworker engagement details by encoded case key**

At the start of `loadWorkspaceWorkCaseDetail`, if `decoded.sourceType === "coworker-engagement"`, query `coworkerEngagement?.findFirst`, build detail via `buildWorkCaseDetail`, and return a `WorkspaceWorkCaseDetailView`.

The detail query must use the same owner-visibility boundary as the lens:

```ts
where: {
  AND: [
    { engagementId: decoded.sourceId },
    {
      OR: [
        { requestedByUserId: userId },
        { requestedByUserId: null },
      ],
    },
  ],
}
```

Return `workItemId: null` and `workItemTitle: null` for coworker-engagement details. Include `provider.displayName`, `approvalContext`, `auditRefs`, `metadata`, and `workCapsuleId` in the query/projection. Do not pass an empty work item id into `WorkItemCommentBox`.

- [ ] **Step 7: Run loader tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/workspace-case-loader.test.ts
```

Expected: PASS.

### Task 7: Keep The Detail UI Work-Case Native

**Files:**
- Modify: `apps/web/components/workspace/WorkCaseDetailView.tsx`
- Modify: `apps/web/components/workspace/WorkCaseDetailView.test.tsx`
- Maybe modify: `apps/web/components/workspace/WorkCaseAttentionLens.tsx`
- Maybe modify: `apps/web/components/workspace/WorkCaseAttentionLens.test.tsx`

- [ ] **Step 1: Add a failing detail UI test**

Create a coworker-engagement fixture with no `workItemId`. Assert the HTML contains `Coworker engagement`, the source ref, and no comment form.

- [ ] **Step 2: Verify comment capability is explicit**

Confirm `WorkspaceWorkCaseDetailView` uses nullable comment fields:

```ts
workItemId: string | null;
workItemTitle: string | null;
```

Confirm `WorkCaseDetailView` renders `WorkItemCommentBox` only when both fields are present.

- [ ] **Step 3: Add an overflow-safe assignment label test**

In `WorkCaseAttentionLens.test.tsx`, add a fixture with a long `assignmentLabel` and assert the rendered HTML uses truncation or wrapping classes on the assignment line. Do not expose raw `providerAgentId` in the expected owner-facing label; use `Coworker: <displayName>` or `AI coworker`.

In `WorkCaseDetailView.test.tsx`, assert the coworker detail HTML does not contain the raw `providerAgentId` when a display name is available. Put the raw provider id in the fixture's `providerAgentId`, `metadata`, `approvalContext`, and `auditRefs` so the test catches accidental leakage through evidence summaries as well as the assignment label.

- [ ] **Step 4: Use existing report-kit and theme tokens only**

Do not add new status color maps beyond existing `STATE_INTENT`. Do not add a new card style if `StatusBadge`, `StatCard`, `Notice`, or existing sections cover the need.

- [ ] **Step 5: Run UI tests**

Run:

```powershell
pnpm --filter web exec vitest run components/workspace/WorkCaseDetailView.test.tsx components/workspace/WorkCaseAttentionLens.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Chunk 3 loader/UI**

Run:

```powershell
git add apps/web/lib/work-management/workspace-case-loader.ts apps/web/lib/work-management/workspace-case-loader.test.ts apps/web/components/workspace/WorkCaseDetailView.tsx apps/web/components/workspace/WorkCaseDetailView.test.tsx apps/web/components/workspace/WorkCaseAttentionLens.tsx apps/web/components/workspace/WorkCaseAttentionLens.test.tsx
git commit -s -m "feat: show coworker engagement work cases in workspace"
git push
```

Expected: one signed feature commit pushed. If `WorkCaseAttentionLens.tsx` is not changed, omit it and its test from `git add`.

---

## Chunk 4: Final Verification And Handoff

### Task 8: Run Focused And Broad Verification

**Files:**
- Verify changed source/tests/docs.
- Create: `docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-desktop.png`
- Create: `docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-mobile.png`
- Create: `docs/superpowers/evidence/2026-07-24-town-work-loop-pr-body.md`

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/work-management/source-registry.test.ts lib/work-management/status-projection.test.ts lib/work-management/case-read-model.test.ts lib/work-management/workspace-case-loader.test.ts components/workspace/WorkCaseDetailView.test.tsx components/workspace/WorkCaseAttentionLens.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: PASS. If this fails because Next typegen requires unavailable runtime state, record the exact failure and run the fallback command below before handoff.

Fallback run:

```powershell
pnpm --filter web exec tsc --noEmit --pretty false --project tsconfig.json
```

Fallback expected: exit 0 with no TypeScript errors. If this fallback also fails, stop and report both exact failures; do not claim typecheck passed.

- [ ] **Step 3: Run docs and composition checks**

Run:

```powershell
pnpm docs:index:check
pnpm docs:links
pnpm check:reporting-composition
```

Expected: PASS.

- [ ] **Step 4: Capture desktop/mobile Workspace UX evidence under a governed lease**

Before starting or using any local preview, call `mcp__dpf__claim_nonprod_environment_lease`:

```json
{
  "environmentKey": "local-integration-ci",
  "ownerProvider": "codex",
  "ownerSessionId": "town-company-work-loop-implementation",
  "branchName": "doc/town-company-work-loop",
  "worktreePath": "D:/DPF-worktrees/town-company-work-loop",
  "url": "http://localhost:3000",
  "ports": [3000],
  "purpose": "Desktop/mobile UX verification for Town-informed Work Case workspace changes",
  "expiresAt": "<UTC now plus 45 minutes in ISO-8601 format>"
}
```

Expected: the tool returns a `leaseId`. If it returns a conflict and no governed reusable preview is available for this branch, do not start a preview; record `Desktop/mobile Workspace UX evidence: BLOCKED - nonproduction lease conflict` in the PR body.

If the lease is granted, keep the `leaseId` and release it after the screenshot/UX sweep work by calling `mcp__dpf__release_nonprod_environment_lease`:

```json
{ "leaseId": "<leaseId returned by claim_nonprod_environment_lease>" }
```

If the UX pass takes longer than 20 minutes, call `mcp__dpf__renew_nonprod_environment_lease` before the lease expires:

```json
{
  "leaseId": "<leaseId returned by claim_nonprod_environment_lease>",
  "ownerSessionId": "town-company-work-loop-implementation",
  "ttlMinutes": 45
}
```

With the governed preview available at `http://localhost:3000` and authenticated storage state present at `apps/web/e2e/.auth/state.json`, run:

```powershell
pnpm --filter web ux:sweep -- --base-url http://localhost:3000
pnpm --filter web exec playwright screenshot --load-storage=e2e/.auth/state.json --viewport-size=1440,1000 http://localhost:3000/workspace/my-queue ..\..\docs\superpowers\evidence\2026-07-24-town-work-loop-workspace-desktop.png
pnpm --filter web exec playwright screenshot --load-storage=e2e/.auth/state.json --viewport-size=390,844 http://localhost:3000/workspace/my-queue ..\..\docs\superpowers\evidence\2026-07-24-town-work-loop-workspace-mobile.png
```

Expected:
- `pnpm --filter web ux:sweep` exits 0, or records only unrelated skipped authenticated routes while `/workspace/my-queue` is measured without new budget regressions.
- both screenshots are created under `docs/superpowers/evidence/`.
- visual inspection confirms the Work Case lens is nonblank, the coworker assignment label does not overflow, Needs You remains a single route/surface, and no raw `providerAgentId` appears.

If authenticated storage state is missing or the route redirects to login, record that exact limitation and do not claim desktop/mobile UX evidence.

- [ ] **Step 5: Create an actual-results PR body**

Create `docs/superpowers/evidence/2026-07-24-town-work-loop-pr-body.md` with this structure, replacing every bracketed value with the observed result from Task 8:

```markdown
## Summary
- Add the Town-informed DPF Work Case design.
- Add the municipal launch-readiness exercise evidence.
- Project coworker engagements into Work Case only if the exercise proved the gap.

## Verification
- Focused Vitest: [PASS or exact failure] - [observed output summary]
- Typecheck: [PASS or exact failure] - [observed output summary]
- Docs index/link checks: [PASS or exact failure] - [observed output summary]
- Reporting composition: [PASS or exact failure] - [observed output summary]
- Desktop/mobile Workspace UX evidence: [PASS or exact limitation] - docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-desktop.png and docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-mobile.png
```

If screenshots were captured, keep the screenshot paths on the desktop/mobile line. If screenshots were not captured, replace the desktop/mobile line with:

```markdown
- Desktop/mobile Workspace UX evidence: BLOCKED - [exact lease/auth/runtime limitation]; no screenshot evidence captured.
```

Do not leave command-only bullets in this file, and do not reference screenshot paths unless the files exist.

- [ ] **Step 6: Commit verification evidence**

Run:

```powershell
$evidenceFiles = @('docs/superpowers/evidence/2026-07-24-town-work-loop-pr-body.md')
if (Test-Path 'docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-desktop.png') {
  $evidenceFiles += 'docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-desktop.png'
}
if (Test-Path 'docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-mobile.png') {
  $evidenceFiles += 'docs/superpowers/evidence/2026-07-24-town-work-loop-workspace-mobile.png'
}
git add -- $evidenceFiles
git status --short
git commit -s -m "docs: add town work loop verification evidence"
git push
```

Expected: `git status --short` shows only the PR body plus any screenshot files that actually exist; one signed evidence commit pushed. If UX evidence could not be captured because the lease, authenticated runtime, or preview was unavailable, commit only the PR body with the exact limitation and do not reference nonexistent screenshots as passing evidence.

- [ ] **Step 7: Run Git hygiene checks**

Run:

```powershell
git diff --check
git status --short --branch
```

Expected: no whitespace errors; branch clean and tracking `origin/doc/town-company-work-loop` after all commits are pushed.

- [ ] **Step 8: Record DPF coordination-plane handoff evidence**

Call `mcp__dpf__record_external_development_evidence` after final verification and pushes:

```json
{
  "provider": "codex",
  "externalSessionId": "town-company-work-loop-implementation",
  "routeContext": "/build",
  "backlogItemId": "BI-0EA09322",
  "branchName": "doc/town-company-work-loop",
  "worktreePath": "D:/DPF-worktrees/town-company-work-loop",
  "summary": "Town-informed company Work Case loop implementation and verification handoff.",
  "changedFiles": [
    "docs/superpowers/specs/2026-07-24-town-informed-company-work-loop-design.md",
    "docs/superpowers/plans/2026-07-24-town-informed-company-work-loop.md",
    "docs/superpowers/evidence/2026-07-24-town-informed-company-work-loop-exercise.md",
    "apps/web/lib/work-management/source-registry.ts",
    "apps/web/lib/work-management/status-projection.ts",
    "apps/web/lib/work-management/case-read-model.ts",
    "apps/web/lib/work-management/workspace-case-loader.ts",
    "apps/web/components/workspace/WorkCaseDetailView.tsx"
  ],
  "verification": [
    "Focused Vitest result from Task 8",
    "Typecheck result from Task 8",
    "Docs/reporting checks from Task 8",
    "Desktop/mobile UX evidence result or exact limitation from Task 8"
  ]
}
```

Expected: DPF records the branch, files, commits, and verification summary on the external-development evidence plane. If the MCP plane is unavailable, record that limitation in the PR body and final handoff.

### Task 9: Open PR Only After Gates Pass

**Files:**
- No source changes.

- [ ] **Step 1: Stop if required verification failed**

If any required non-UX verification in Task 8 failed, do not open a PR. If UX evidence was blocked by lease/auth/runtime limitations, open the PR only if the PR body records the limitation plainly and the code/doc verification gates passed.

- [ ] **Step 2: Create PR when branch is ready for review**

Run:

```powershell
gh pr create --base main --head doc/town-company-work-loop --title "Add Town-informed company work loop" --body-file docs/superpowers/evidence/2026-07-24-town-work-loop-pr-body.md
```

Expected: a regular ready-for-review PR, not a draft PR.

- [ ] **Step 3: Run PR health**

Run:

```powershell
$prNumber = gh pr view --json number -q .number
pnpm pr:health $prNumber
```

Expected: terminal passing checks, no conflicts, zero unresolved review threads. If checks are still pending, report pending status instead of claiming merge readiness.
