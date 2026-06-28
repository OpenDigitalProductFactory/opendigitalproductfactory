# Governed Adaptive Playbooks Read Model Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 2 by projecting stamped Governed Work Pattern metadata and capability-need evidence into an operator-ready Living Playbooks view for each coworker.

**Architecture:** Keep persistence on existing substrates: `TaskRun.a2aMetadata.workPattern`, `TaskRun.repeatedPatternKey`, and `CoworkerCapabilityNeed` evidence/readiness JSON. Add one typed read model that groups observed patterns by pattern key, agent, route, outcome, and risk, then render that projection in the existing AI Workforce coworker record. No new WorkPattern table, no activation path, no prompt/skill/grant/model-route mutation.

**Tech Stack:** Next.js 16 server components, Prisma 7 client, Vitest, existing coworker-record tab/panel components.

---

## File Structure

- Create `apps/web/lib/tak/work-pattern-read-model.ts` for DB-backed and injectable read-model projection.
- Create `apps/web/lib/tak/work-pattern-read-model.test.ts` for TDD coverage of grouping, evidence links, candidate-only projection, and no-activation guarantees.
- Add `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx` for the preloaded needs and playbook summaries panel, reusing coworker-record primitives without growing the shared panel module.
- Modify `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.tsx` to load `getCoworkerCapabilityNeedReview({ agentId })` and `getWorkPatternReadModel({ agentId })`, then add the `Needs & Playbooks` tab.
- Modify `apps/web/app/(shell)/platform/ai/agent/[agentId]/page.test.tsx` to mock the new loaders and assert the tab/panel is rendered.

## Task 1: Work Pattern Read Model

- [x] **Step 1: Write the failing read-model test**

Add tests that inject fake TaskRun and CoworkerCapabilityNeed rows:

- Two completed runs and one failed run with the same `a2aMetadata.workPattern.patternKey` group into one summary.
- Evidence refs include TaskRun and ToolExecution ids from metadata.
- A capability need with `evidenceJson.patternKey` links to the summary and increments open need counts.
- A need with `evidenceJson.patternKey` but no matching TaskRun creates a candidate-only summary.

Run:

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-read-model.test.ts
```

Expected: FAIL because `work-pattern-read-model.ts` does not exist.

- [x] **Step 2: Implement the minimal read model**

Implement:

- `getWorkPatternReadModel(input, deps?)`
- `WorkPatternReadModelDb` with injected `listTaskRuns` and `listCapabilityNeeds`
- grouping by `patternKey`, `agentId`, `routeContext`, and `riskClass`
- parsing with `parseWorkPatternMetadata`
- fallback summaries from `repeatedPatternKey`
- candidate-only summaries from capability need `evidenceJson.patternKey`
- readiness via `evaluatePatternReadiness`

Do not add writes. Do not add a Prisma model.

- [x] **Step 3: Verify the read-model test passes**

Run the same Vitest command. Expected: PASS.

## Task 2: Coworker Record Living Playbooks Tab

- [x] **Step 1: Write the failing page/panel test**

Update `page.test.tsx` to mock:

- `getCoworkerCapabilityNeedReview`
- `getWorkPatternReadModel`

Assert rendered markup contains:

- `Needs & Playbooks`
- `Living Playbooks`
- a candidate pattern title/need from the mocked read model

Run:

```powershell
corepack pnpm --filter web exec vitest run -t "Needs & Playbooks"
```

Expected: FAIL before UI wiring.

- [x] **Step 2: Implement the panel and page wiring**

Add a compact server-rendered panel using existing `Section`, `Chip`, and table/card styling:

- Open needs section links to `/ops?origin=capability-need`
- Living Playbooks section groups summaries by route/status
- Rows show pattern status, scope, run counts, latest observation, readiness blockers, and evidence counts
- Copy uses product language: `Living Playbooks`; code/types keep `WorkPattern`

Use only DPF theme tokens and existing layout primitives.

- [x] **Step 3: Verify page/panel tests pass**

Run the page test command. Expected: PASS.

## Task 3: Gates and Evidence

- [x] **Step 1: Run focused tests**

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-read-model.test.ts
corepack pnpm --filter web exec vitest run -t "AgentDetailPage"
```

- [x] **Step 2: Run affected broader tests**

```powershell
corepack pnpm --filter web exec vitest run lib/tak/work-pattern-types.test.ts lib/tak/pattern-observer.test.ts lib/tak/pattern-observer-service.test.ts lib/tak/pattern-observer/observer.test.ts
```

- [x] **Step 3: Run build gate**

```powershell
corepack pnpm --filter web build
```

- [x] **Step 4: Record capsule evidence and commit**

Record test/build results on Work Capsule `WC-75F39A23`, then commit with DCO sign-off.
