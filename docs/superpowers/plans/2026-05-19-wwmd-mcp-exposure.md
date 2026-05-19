# WWMD MCP Exposure — Sprint 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose the existing `evaluateDecisionPerspective` engine via two MCP tools (`wwmd_evaluate`, `wwmd_record_outcome`) so external agent sessions (Claude Code, Codex CLI) can consult Mark's decision substrate before asking him recurring micro-decisions.

**Architecture:** Two new MCP tools live in a sibling module (`mcp-tools-wwmd.ts`) and are spread into `PLATFORM_TOOLS` alongside `DELIBERATION_TOOLS`. The read path (`wwmd_evaluate`) reuses `resolveProfileMaterial` + `evaluateDecisionPerspective` + a new fingerprint-based dedup lookup in `persistence.ts`. The write path (`wwmd_record_outcome`) creates a draft `PerspectiveMaterial` candidate tied to an existing `DecisionInteraction`, with a per-agent daily rate cap. Schema change: one new column `questionFingerprint` on `DecisionInteraction` plus an index. No decision-logic re-implementation anywhere — MCP layer is a thin orchestration shell.

**Tech Stack:** TypeScript, Next.js, Prisma, PostgreSQL. Test runners: vitest for unit/integration. MCP tool registration follows existing pattern in `apps/web/lib/mcp-tools.ts` / `mcp-tools-deliberation.ts`.

**Source spec:** [`docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md`](../specs/2026-05-19-wwmd-mcp-exposure-design.md)

**Scope boundary (from spec §8):** Tasks 1–11 below. Persona prose, auto-promotion, multi-profile resolver UI, hive contribution all deferred — they MUST NOT appear in this plan.

**Commit cadence:** Commit after every task (every passing test cycle). DCO sign-off required (`git commit -s`).

---

### Task 1: Module skeleton & registration scaffold

**Files:**
- Create: `apps/web/lib/mcp-tools-wwmd.ts`
- Create: `apps/web/lib/mcp-tools-wwmd.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts` (around line 33 — add import alongside `DELIBERATION_TOOLS`; around line 363 — spread `...WWMD_TOOLS` into `PLATFORM_TOOLS`)

Mirror the structure of [`apps/web/lib/mcp-tools-deliberation.ts`](../../apps/web/lib/mcp-tools-deliberation.ts). Export `WWMD_TOOLS: ToolDefinition[]` as an empty array initially; export placeholder handler signatures.

- [ ] **Step 1:** Write `mcp-tools-wwmd.test.ts` — assert `WWMD_TOOLS` is an array, exports are defined, module is importable.
- [ ] **Step 2:** Run `pnpm --filter web vitest run apps/web/lib/mcp-tools-wwmd.test.ts` — verify it fails (module does not exist).
- [ ] **Step 3:** Create `mcp-tools-wwmd.ts` with `export const WWMD_TOOLS: ToolDefinition[] = [];` and stub handlers `wwmdEvaluateMcpHandler` and `wwmdRecordOutcomeMcpHandler` returning `{ success: false, message: "not implemented" }`.
- [ ] **Step 4:** Import + spread into `mcp-tools.ts`. Run the test — passes.
- [ ] **Step 5:** Run `pnpm typecheck`. Commit (`-s`).

---

### Task 2: Question fingerprint utility

**Files:**
- Create: `apps/web/lib/decision-perspective/fingerprint.ts`
- Create: `apps/web/lib/decision-perspective/fingerprint.test.ts`

Exports `computeQuestionFingerprint(input: { profileId: string; domainClass: DecisionDomainClass; question: string; options: string[] }): string`. Normalization rules from spec §3.1: `lowercase + collapse whitespace + strip trailing punctuation`. Options sorted alphabetically before hashing. Hash with `crypto.createHash("sha256")` → hex → first 32 chars. Output format: `QF-<hash>` (length 35).

- [ ] **Step 1:** Write `fingerprint.test.ts` with table-driven cases:
  - identical inputs → identical fingerprint
  - whitespace differences → identical fingerprint
  - option order differences → identical fingerprint
  - different `profileId` → different fingerprint
  - different `domainClass` → different fingerprint
  - trailing `?` vs no `?` → identical fingerprint
- [ ] **Step 2:** Run tests — fail (module missing).
- [ ] **Step 3:** Implement `computeQuestionFingerprint`. Pure function — no DB, no I/O.
- [ ] **Step 4:** Run tests — pass.
- [ ] **Step 5:** Commit.

---

### Task 3: Schema migration — `questionFingerprint` column

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (line 8186 — `DecisionInteraction` model; add field + index)
- Create: `packages/db/prisma/migrations/<TIMESTAMP>_add_decision_interaction_fingerprint/migration.sql`

Add column: `questionFingerprint VARCHAR(64) NOT NULL DEFAULT ''`. Add index: `@@index([profileId, questionFingerprint, createdAt(sort: Desc)], name: "DecisionInteraction_profile_fingerprint_idx")`. Backfill existing rows with `''` default; the column is NOT NULL but legacy rows are allowed to carry the empty sentinel (dedupe ignores empty fingerprints — they never collide).

- [ ] **Step 1:** Update `schema.prisma`:
  ```prisma
  questionFingerprint String   @default("") @db.VarChar(64)
  // ...
  @@index([profileId, questionFingerprint, createdAt(sort: Desc)])
  ```
- [ ] **Step 2:** Run `pnpm --filter @dpf/db prisma migrate dev --name add_decision_interaction_fingerprint --create-only` to generate the migration SQL without applying.
- [ ] **Step 3:** Inspect generated SQL. Confirm: `ALTER TABLE "DecisionInteraction" ADD COLUMN "questionFingerprint" VARCHAR(64) NOT NULL DEFAULT '';` + `CREATE INDEX ...`. Add a SQL comment block at top explaining the empty-sentinel convention.
- [ ] **Step 4:** Run `pnpm --filter @dpf/db prisma migrate dev` to apply. Run `pnpm --filter @dpf/db prisma generate`.
- [ ] **Step 5:** Run `pnpm --filter @dpf/db test` to confirm schema tests pass. Commit migration SQL + schema.prisma together.

---

### Task 4: Persist fingerprint on write

**Files:**
- Modify: `apps/web/lib/decision-perspective/persistence.ts` (function `persistDecisionInteraction`, lines 185–237)
- Modify: `apps/web/lib/decision-perspective/persistence.test.ts` (or create if absent — check first)

`persistDecisionInteraction` already takes `evaluation`. Add an optional `questionFingerprint?: string` to the input; if omitted, compute from `evaluation` via `computeQuestionFingerprint`. Pass into the `create.data` block. No behavior change for existing callers (build-studio-gate.ts continues to work).

- [ ] **Step 1:** Add failing unit test: `persistDecisionInteraction` writes a fingerprint when none provided; computes it from evaluation fields.
- [ ] **Step 2:** Add failing unit test: explicit `questionFingerprint` input overrides the computed value.
- [ ] **Step 3:** Run tests — fail.
- [ ] **Step 4:** Implement: import `computeQuestionFingerprint`, derive default, write column.
- [ ] **Step 5:** Run tests — pass. Run `pnpm --filter web typecheck`. Commit.

---

### Task 5: Fingerprint dedup lookup

**Files:**
- Modify: `apps/web/lib/decision-perspective/persistence.ts` — add `findDecisionInteractionByFingerprint`
- Modify: `apps/web/lib/decision-perspective/persistence.test.ts`

Signature:
```ts
export async function findDecisionInteractionByFingerprint(input: {
  db: DecisionInteractionClient;
  profileId: string;
  questionFingerprint: string;
  withinDays?: number; // default 30
}): Promise<{ interactionId: string; evaluation: DecisionPerspectiveEvaluationResult } | null>
```

Returns the most recent matching row whose `createdAt > now - withinDays`. Returns `null` when fingerprint is empty (legacy rows can't collide). Reuses existing `decisionInteractionRowToEvaluation`.

- [ ] **Step 1:** Add failing tests: returns null for empty fingerprint; returns null when no match; returns most recent within window; returns null when match is older than `withinDays`; returns null when match has been cleared (existing `interactionWasCleared` guard).
- [ ] **Step 2:** Run tests — fail.
- [ ] **Step 3:** Implement using `findFirst` with `orderBy: { createdAt: "desc" }` + `createdAt: { gt: cutoff }` filter.
- [ ] **Step 4:** Run tests — pass. Commit.

---

### Task 6: `wwmd_evaluate` handler

**Files:**
- Modify: `apps/web/lib/mcp-tools-wwmd.ts` — implement `wwmdEvaluateMcpHandler`
- Modify: `apps/web/lib/mcp-tools-wwmd.test.ts`

Handler signature mirrors `deliberateOnMcpHandler` in [`mcp-tools-deliberation.ts:45`](../../apps/web/lib/mcp-tools-deliberation.ts).

Flow:
1. Validate inputs (`question`, `options[≥2]`, `domainClass`, `riskTier` required; `profileId` defaults to `MARK_DPF_PLATFORM_PROFILE.profileId`).
2. Compute `questionFingerprint`.
3. Call `findDecisionInteractionByFingerprint`. If hit, log `[wwmd-trace] dedup-hit interactionId=...`, fall through to step 4 to re-evaluate against current material (confidence may have moved) — but reuse the dedup `interactionId` when writing.
4. Call `resolveProfileMaterial({ profileId, domainClass })`. On `coverageGap`, return `defer` outcome shape directly without persisting (per spec §3.3 "calling 1000 times creates no records") — except: still surface to caller with `gapReason: "no-applicable-material"`.
5. Build `DecisionPerspectiveEvaluationInput`, call `evaluateDecisionPerspective`.
6. Call `persistDecisionInteraction` (passing existing `interactionId` from step 3 if present). Note: persistDecisionInteraction currently hardcodes `routeContext: "/build"`, `phaseFrom: "plan"`, `phaseTo: "build"` (line 205–207); add input parameters to override those — this is a non-breaking change.
7. Compute `recommendedOption`: parse rationale for the chosen option string match against `options[]`; null if `defer`/`escalate`.
8. Return `ToolResult` with `success: true`, `data: { evaluation, interactionId, recommendedOption, operatorMessage }`.

**Operator message format:** `"WWMD ${outcomeType} (${confidenceScore.toFixed(2)}): ${recommendedOption ?? "no clear direction"}"`.

- [ ] **Step 1:** Add failing test: valid inputs against a mocked db with seeded principle material → `outcomeType: "recommend"`, non-null `recommendedOption`, expected `interactionId` shape.
- [ ] **Step 2:** Add failing test: missing `question` → `success: false, error: "missing_question"`.
- [ ] **Step 3:** Add failing test: coverage gap → `outcomeType: "defer"`, `gapReason: "no-applicable-material"`, NO database write happens (assert `decisionInteraction.create` mock NOT called).
- [ ] **Step 4:** Add failing test: dedup hit reuses `interactionId`.
- [ ] **Step 5:** Run tests — fail.
- [ ] **Step 6:** Modify `persistDecisionInteraction` signature to accept optional `routeContext`, `phaseFrom`, `phaseTo` overrides. Run existing persistence tests — they must still pass with defaults.
- [ ] **Step 7:** Implement `wwmdEvaluateMcpHandler`.
- [ ] **Step 8:** Run all tests — pass. Commit.

---

### Task 7: `wwmd_evaluate` ToolDefinition registration

**Files:**
- Modify: `apps/web/lib/mcp-tools-wwmd.ts` — add ToolDefinition to `WWMD_TOOLS`

```ts
{
  name: "wwmd_evaluate",
  description: "Consult the WWMD decision perspective for a recurring or ambiguous decision before asking the human. Returns recommend/arbitrate/escalate/defer with confidence, rationale, and source materials. Read-only — produces no state mutations on repeat calls within a 30-day fingerprint window (dedup).",
  inputSchema: {
    type: "object",
    properties: {
      question: { type: "string" },
      options: { type: "array", items: { type: "string" }, minItems: 2 },
      domainClass: { type: "string", enum: ["plan-readiness", "architecture-tradeoff", "risk-assessment"] },
      riskTier: { type: "string", enum: ["low", "medium", "high", "critical"] },
      profileId: { type: "string" },
      evidence: { type: "array", items: { type: "object" } },
      routeContext: { type: "string" },
      agentId: { type: "string" },
    },
    required: ["question", "options", "domainClass", "riskTier"],
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: false,
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
},
```

- [ ] **Step 1:** Add test asserting `WWMD_TOOLS` contains `wwmd_evaluate` with `sideEffect: false` and required fields.
- [ ] **Step 2:** Add test asserting the tool is discoverable via `PLATFORM_TOOLS` (import from `mcp-tools.ts`).
- [ ] **Step 3:** Run tests — fail.
- [ ] **Step 4:** Add the ToolDefinition to `WWMD_TOOLS` array.
- [ ] **Step 5:** Run tests — pass. Also run `pnpm --filter web vitest run apps/web/lib/mcp-tools-backlog.test.ts` as a smoke test (touches same module). Commit.

---

### Task 8: `wwmd_record_outcome` handler

**Files:**
- Modify: `apps/web/lib/mcp-tools-wwmd.ts` — implement `wwmdRecordOutcomeMcpHandler`
- Modify: `apps/web/lib/mcp-tools-wwmd.test.ts`

Flow:
1. Validate inputs (`interactionId`, `chosenOption`, `rationale`, `overrodeRecommendation` required).
2. Load `DecisionInteraction` by `interactionId`; 404 if absent.
3. Rate limit: count `PerspectiveMaterial` rows with `sourceType: "interaction-outcome"`, `sourceRef.recordedByAgentId === context.agentId`, `createdAt > now - 24h`. If ≥ 20, return `{ success: false, error: "rate_limited", message: "wwmd_record_outcome cap reached: 20 candidates per agent per 24h" }`.
4. Create `PerspectiveMaterial`:
   - `profileId` = interaction's `profileId`
   - `sourceType` = `"interaction-outcome"`
   - `sourceRef` = `{ interactionId, recordedByAgentId, overrodeRecommendation, originalOutcomeType }`
   - `summary` = first 280 chars of rationale
   - `domainClass` = interaction's `domainClass`
   - `direction` = `"neutral"` (humans don't pre-classify; review surface assigns direction on approval)
   - `freshness` = `"current"`
   - `evidenceGrade` = `"C"` (single human data point; promotion to A/B happens through review)
   - `confidenceWeight` = `0.5`
   - `reviewStatus` = `"draft"` (NON-NEGOTIABLE per spec §3.3)
   - `promotionState` = `"candidate"` (NON-NEGOTIABLE per spec §3.3)
   - `materialId` = `PM-<random12hex>`
5. Append `humanOutcome` JSON to the source `DecisionInteraction` row: `{ chosenOption, rationale, overrodeRecommendation, recordedAt }`.
6. Return `ToolResult` with `success: true, entityId: materialId, message: "WWMD outcome captured as draft candidate material; review queue will pick it up."`.

- [ ] **Step 1:** Add failing test: valid inputs → creates material with `reviewStatus: "draft"`, `promotionState: "candidate"`.
- [ ] **Step 2:** Add failing test: missing `interactionId` → `error: "missing_interactionId"`.
- [ ] **Step 3:** Add failing test: unknown `interactionId` → `error: "interaction_not_found"`.
- [ ] **Step 4:** Add failing test: 20 prior records in last 24h → `error: "rate_limited"`, no new material created.
- [ ] **Step 5:** Add failing test: written material's `reviewStatus` is `"draft"` even when caller is `dpf-agent` (spec invariant).
- [ ] **Step 6:** Run tests — fail.
- [ ] **Step 7:** Implement handler.
- [ ] **Step 8:** Run tests — pass. Commit.

---

### Task 9: `wwmd_record_outcome` ToolDefinition registration

**Files:**
- Modify: `apps/web/lib/mcp-tools-wwmd.ts` — append ToolDefinition

```ts
{
  name: "wwmd_record_outcome",
  description: "Record the human's actual decision for a prior wwmd_evaluate interaction. Always lands as a draft candidate material — never auto-promoted. Rate limit: 20 outcomes per agent per 24h.",
  inputSchema: {
    type: "object",
    properties: {
      interactionId: { type: "string" },
      chosenOption: { type: "string" },
      rationale: { type: "string" },
      overrodeRecommendation: { type: "boolean" },
    },
    required: ["interactionId", "chosenOption", "rationale", "overrodeRecommendation"],
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: true,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
},
```

- [ ] **Step 1:** Add test asserting tool present in `WWMD_TOOLS` and `PLATFORM_TOOLS`.
- [ ] **Step 2:** Add test asserting `sideEffect: true` and `destructiveHint: false` (additive write, not destructive).
- [ ] **Step 3:** Run tests — fail.
- [ ] **Step 4:** Add ToolDefinition.
- [ ] **Step 5:** Run tests — pass. Commit.

---

### Task 10: `[wwmd-trace]` durable logging

**Files:**
- Modify: `apps/web/lib/mcp-tools-wwmd.ts` — both handlers

Per the `[tool-trace] durable logging` project memory: every adapter response logs under a stable prefix. Add `console.log("[wwmd-trace] ...")` lines for:

- `wwmd_evaluate` entry: `[wwmd-trace] evaluate fp=<fingerprint> profileId=<id> domain=<class> risk=<tier>`
- `wwmd_evaluate` dedup-hit: `[wwmd-trace] dedup-hit interactionId=<id>`
- `wwmd_evaluate` exit: `[wwmd-trace] evaluate outcome=<type> confidence=<n> interactionId=<id>`
- `wwmd_evaluate` coverage-gap: `[wwmd-trace] coverage-gap profileId=<id> domain=<class>`
- `wwmd_record_outcome` entry: `[wwmd-trace] record interactionId=<id> agentId=<id>`
- `wwmd_record_outcome` rate-limit: `[wwmd-trace] rate-limited agentId=<id> windowCount=<n>`
- `wwmd_record_outcome` exit: `[wwmd-trace] record-ok materialId=<id>`

- [ ] **Step 1:** Add test using a `vi.spyOn(console, "log")` to assert each trace line emits in the expected scenario.
- [ ] **Step 2:** Run tests — fail.
- [ ] **Step 3:** Add the log statements at the right points.
- [ ] **Step 4:** Run tests — pass. Commit.

---

### Task 11: Golden-path integration test

**Files:**
- Create: `apps/web/lib/mcp-tools-wwmd.golden.test.ts`

This is the canonical end-to-end assertion called out in spec §3.1 ("Golden-path test"). Uses the real Prisma client against the test database (existing test setup; mirror an existing `*.golden.test.ts` if one exists, otherwise pattern-match `build-governed.test.ts`).

Setup:
1. Reset test DB (or transaction-wrap).
2. Seed `MARK_DPF_PLATFORM_PROFILE` (existing helper in [`apps/web/lib/decision-perspective/default-profile.ts`](../../apps/web/lib/decision-perspective/default-profile.ts)).
3. Seed one `PerspectiveMaterial` with `sourceType: "principle"`, `domainClass: "plan-readiness"`, `direction: "support"`, `freshness: "current"`, `evidenceGrade: "A"`, `reviewStatus: "approved"`, `promotionState: "promoted"`, `confidenceWeight: 0.9`, `summary: "Approved spec is immediately committed to main AND fed to writing-plans; never ask between those steps."`

Assertions:
1. **First call:** `wwmd_evaluate({ question: "Should I commit this revised spec to main and feed it to writing-plans for the Sprint 1 plan?", options: ["commit and feed to writing-plans", "wait for explicit go"], domainClass: "plan-readiness", riskTier: "low" })`
   - `data.evaluation.outcomeType === "recommend"` OR `"arbitrate"` (both are valid autonomy outcomes)
   - `data.evaluation.confidenceScore >= 0.55`
   - `data.recommendedOption === "commit and feed to writing-plans"`
   - `data.interactionId` matches `/^DI-[A-F0-9]{12}$/`
2. **Second identical call:** same `interactionId` returned (dedup verified).
3. **`wwmd_record_outcome`:** with `interactionId` from step 1, `chosenOption: "commit and feed to writing-plans"`, `overrodeRecommendation: false`
   - Returns `success: true`, `entityId` matches `/^PM-/`
   - DB lookup: new `PerspectiveMaterial` exists with `reviewStatus === "draft"` and `promotionState === "candidate"`
4. **Rate limit:** invoke 21 record calls back-to-back; the 21st returns `error: "rate_limited"`.
5. **Coverage gap path:** call `wwmd_evaluate` against a non-existent `profileId` → `outcomeType: "defer"`, `gapReason: "no-applicable-material"`. Assert `DecisionInteraction` count did NOT increment (zero state mutation on read path with coverage gap).

- [ ] **Step 1:** Read an existing `apps/web/lib/**/*.golden.test.ts` or similar to confirm test-DB pattern.
- [ ] **Step 2:** Scaffold the file with `describe.skip` to confirm test runner picks it up.
- [ ] **Step 3:** Implement setup + each of the five assertions one at a time, removing `.skip` and committing after each section passes.
- [ ] **Step 4:** Run `pnpm --filter web vitest run apps/web/lib/mcp-tools-wwmd.golden.test.ts` — all green.
- [ ] **Step 5:** Run full test suite `pnpm --filter web vitest run` (per memory `feedback_run_full_tests_before_push`). Fix any unrelated breakage caused by the persistence.ts signature widening. Commit.

---

### Task 12: Operator-facing documentation

**Files:**
- Create: `docs/operators/wwmd-mcp-quickstart.md` (or extend the existing operator-doc folder if a different convention is in use — sweep `docs/operators/` and match)
- Modify: `docs/superpowers/articles/index.md` (or wherever the existing MCP article index lives — discover via `grep -r "wwmd" docs/`)

Content outline:
1. **What `wwmd_evaluate` does** — one paragraph for a non-engineer.
2. **When to call it from Claude Code / Codex** — checklist of decision categories.
3. **Reading the outcome** — table mapping `recommend` / `arbitrate` / `escalate` / `defer` → caller behavior (copy from spec §5).
4. **How `wwmd_record_outcome` closes the loop** — show one worked example using Mark's "commit spec + plan" question.
5. **Limits** — 20-per-day rate cap; draft-only; no auto-promotion.
6. **Where to inspect captured outcomes** — link to the existing review surface (find via grep: `decision-perspective` UI route).

- [ ] **Step 1:** Sweep existing docs for operator-facing conventions; pick the matching folder.
- [ ] **Step 2:** Draft the document following spec §5 + §3.
- [ ] **Step 3:** Cross-reference: add a one-line pointer back from the spec to this operator doc.
- [ ] **Step 4:** Commit. Push branch; open PR against main with description summarizing all 12 tasks.

---

## Done criteria

- [ ] All 12 tasks committed.
- [ ] `pnpm --filter web vitest run` green.
- [ ] `pnpm --filter web typecheck` green.
- [ ] Golden-path test demonstrates the "commit spec + plan?" → `recommend` flow end-to-end.
- [ ] PR opened against `main`, DCO-signed, no overlapping work confirmed via overlap-sweep before push (per memory `feedback_continuous_overlap_check`).
- [ ] Spec PR #813 merged (or rebased into this PR if reviewers prefer a single landing commit).

## Out of scope (deferred — DO NOT add tasks for these)

Per spec §3.2: auto-promotion of candidate → promoted; persona voice / WWTD prose layer; multi-profile selection UI; streaming / partial evaluation; cross-installation hive contribution of approved materials.
