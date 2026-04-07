# Fix Routing Agent Output — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Relocate and fix the 7 root-level routing files a previous agent dropped in the wrong place, resolve all code bugs, add quality-tier gate, and align with EP-INF-012 + Anthropic adaptive-model guidance.
**Architecture:** The new files belong in `apps/web/lib/routing/` alongside the existing pipeline. `task-router.ts` is a lightweight `TaskRequirement`-contract router that wraps the existing `EndpointManifest` type system. `task-dispatcher.ts` calls the existing `callProvider` / `logTokenUsage` from `@/lib/ai-inference`.
**Tech Stack:** TypeScript, Prisma (`@dpf/db`), Vitest, Next.js path aliases (`@/lib/...`)

---

## Bugs Fixed

| File | Bug | Fix |
|------|-----|-----|
| root `types.ts` | `EndpointManifest` duplicates existing; `SensitivityLevel` from wrong package | Delete; re-export from `./types` |
| root `task-requirements.ts` | Async function body embedded after `return` (dead code, TS error) | Collapse into single async function |
| root `router.test.ts` | Duplicate `import` lines 4–5; `c.id` not on `CandidateTrace` | Remove line 4; fix to `c.endpointId` |
| root `dispatcher.ts` | `logTokenUsage` wrong call signature; `selectedEndpointId` null violates schema | Fix both |
| root `dispatcher.test.ts` | Mocks `"@/lib/db"` but module imports `"@dpf/db"` | Fix mock path |
| root `seed.ts` | Uses raw `PrismaClient` outside workspace package | Move to `packages/db/prisma/`, use `@dpf/db` |
| All root files | Wrong directory — `@/` aliases and `@dpf/db` don't resolve from repo root | Move to `apps/web/lib/routing/` |

## Spec Gap Closed (EP-INF-012 + Anthropic Adaptive Guidance)

- `minimumTier` field added to `TaskRequirement`; built-in requirements pre-populated.
- Stage 0.5 tier gate in `task-router.ts` excludes endpoints below `minimumTier` before dimension scoring. This is the routing equivalent of the "thinking cap" — simple tasks never even see frontier-tier endpoints.
- `qualityTier` added to `EndpointManifest` and mapped in `loader.ts`.
- `CandidateTrace` now carries `providerId`+`modelId` so dispatcher avoids N+1 lookup.

---

### Task 1: Add `qualityTier` to `EndpointManifest` + loader

**Files:**
- Modify: `apps/web/lib/routing/types.ts` — add `qualityTier?: QualityTier`
- Modify: `apps/web/lib/routing/loader.ts` — map `mp.qualityTier` into manifest

- [ ] Add `import type { QualityTier } from "./quality-tiers"` to `types.ts`
- [ ] Add `qualityTier?: QualityTier` to the `EndpointManifest` interface
- [ ] In `loader.ts`, map `qualityTier: (mp.qualityTier as QualityTier | null) ?? undefined`
- [ ] Commit: `feat(routing): add qualityTier to EndpointManifest`

---

### Task 2: Create `task-router-types.ts`

**Files:**
- Create: `apps/web/lib/routing/task-router-types.ts`

- [ ] Re-export `EndpointManifest` from `./types` (no duplication)
- [ ] Import `SensitivityLevel` from `./types`
- [ ] Import `QualityTier` from `./quality-tiers`
- [ ] Define `TaskRequirement` with `minimumTier?: QualityTier`
- [ ] Define `PolicyRule` (condition as structured Record)
- [ ] Define `CandidateTrace` with `providerId` + `modelId` fields
- [ ] Define `TaskRouteDecision` (renamed to avoid collision with existing `RouteDecision`)

---

### Task 3: Create `task-requirements.ts`

**Files:**
- Create: `apps/web/lib/routing/task-requirements.ts`

- [ ] Import `prisma` from `@dpf/db`
- [ ] Import `QualityTier` from `./quality-tiers`; `TaskRequirement` from `./task-router-types`
- [ ] Define `BUILT_IN_TASK_REQUIREMENTS` with `minimumTier` per task type:
  - `greeting`, `status-query`, `summarization` → `adequate`
  - `data-extraction`, `web-search`, `creative` → `strong`
  - `reasoning`, `code-gen`, `tool-action` → `frontier`
- [ ] Implement single `export async function getTaskRequirement(taskType)`: cache → DB → built-in
- [ ] Commit: `feat(routing): task-requirements — async DB-first with tier awareness`

---

### Task 4: Create `task-requirements.test.ts`

**Files:**
- Create: `apps/web/lib/routing/task-requirements.test.ts`
- Test: same file

- [ ] Mock `@dpf/db` prisma
- [ ] Test: built-in returns correct `minimumTier` for each tier level
- [ ] Test: DB row takes precedence over built-in
- [ ] Test: unknown taskType returns undefined
- [ ] Test: result is cached on second call (prisma called once)

---

### Task 5: Create `task-router.ts`

**Files:**
- Create: `apps/web/lib/routing/task-router.ts`

- [ ] Import `EndpointManifest`, `SensitivityLevel` from `./types`
- [ ] Import `TIER_MINIMUM_DIMENSIONS`, `QualityTier` from `./quality-tiers`
- [ ] Import `TaskRequirement`, `PolicyRule`, `CandidateTrace`, `TaskRouteDecision` from `./task-router-types`
- [ ] Stage 0: policy filter (existing logic, correct)
- [ ] Stage 0.5: tier gate — exclude endpoints whose `qualityTier` is below `minimumTier`
- [ ] Stage 1: hard filter (status, retiredAt, sensitivityClearance, capabilities, context)
- [ ] Stage 2: dimension scoring with `preferCheap` blend
- [ ] Stage 3: rank (fitness → cost → failure rate → latency)
- [ ] Stage 4: select + explain, return `TaskRouteDecision`

---

### Task 6: Create `task-router.test.ts`

**Files:**
- Create: `apps/web/lib/routing/task-router.test.ts`

- [ ] Fix duplicate import (single import from `./task-router-types`)
- [ ] Fix `c.id` → `c.endpointId` in tie-breaker test
- [ ] Add tests for Stage 0.5 tier gate: endpoint below minimumTier is excluded

---

### Task 7: Create `task-dispatcher.ts`

**Files:**
- Create: `apps/web/lib/routing/task-dispatcher.ts`

- [ ] Import `callProvider`, `logTokenUsage`, `InferenceError` from `@/lib/ai-inference`
- [ ] Import `observe` from `@/lib/process-observer`
- [ ] Import `prisma` from `@dpf/db`
- [ ] Define `ProviderCallPayload` type matching `callProvider` args
- [ ] Fix `callWithFallbackChain`: resolve `providerId`+`modelId` from `candidates` array
- [ ] Fix `logTokenUsage` call: use `{agentId, providerId, contextKey, inputTokens, outputTokens, inferenceMs}`
- [ ] Fix `persistDecision`: use `selectedCandidate.providerId` for DB lookup; use `""` not `null` for selectedEndpointId when all fail
- [ ] Commit: `feat(routing): task-dispatcher — fixed imports and call signatures`

---

### Task 8: Create `task-dispatcher.test.ts`

**Files:**
- Create: `apps/web/lib/routing/task-dispatcher.test.ts`

- [ ] Change mock path from `"@/lib/db"` → `"@dpf/db"`
- [ ] Update mock `callProvider` signature to match actual args `(providerId, modelId, messages, systemPrompt)`
- [ ] Verify all 5 test cases still pass as written

---

### Task 9: Move seed script

**Files:**
- Create: `packages/db/prisma/seed-task-requirements.ts`
- Delete: `seed.ts` (root)

- [ ] Change `import { PrismaClient } from "@prisma/client"` → `import { prisma } from "@dpf/db"`
- [ ] Remove manual `prisma.$disconnect()` (managed by `@dpf/db`)
- [ ] Keep identical upsert logic

---

### Task 10: Delete root-level files

- [ ] `git rm` all 8 root files: `types.ts router.ts router.test.ts dispatcher.ts dispatcher.test.ts task-requirements.ts task-requirements.test.ts seed.ts`
- [ ] Commit: `fix(routing): remove misplaced root-level files`

---

### Task 11: Open PR

- [ ] `git push -u origin feat/fix-routing-agent-output`
- [ ] `gh pr create` with summary of bugs fixed + spec additions
