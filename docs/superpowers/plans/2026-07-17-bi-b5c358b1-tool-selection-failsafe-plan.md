# BI-B5C358B1 — Local-model tool-selection fail-safe (Phase 1)

**Epic:** EP-E431FC8A · **BI:** BI-B5C358B1 · **Spec:** `docs/superpowers/specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md` · **Kernel:** DI-2A6C75048353

## Goal

Make the coworker turn fail *safe*, not *false*, for the incident class: a live-data question routed to a low-fidelity local model. Fix the three root causes (RC1 fidelity-vs-capacity cap, RC2 message-blind attachment, RC3 no evidence gate) without changing coworker authority. This is Phase 1 of the hybrid-hierarchical architecture; it fully resolves the Scrum Master incident and lays the seams for P2–P4.

## Current substrate (origin/main — verify in a fresh worktree)

- `apps/web/lib/actions/coworker-tool-budget.ts` — `deriveCoworkerToolCap`, `selectCoworkerToolBudget`, `MAX_COWORKER_ATTACHED_TOOLS=48`, `ACCURACY_CLIFF_PRONE_MAX_CONTEXT=32768`, `LOAD_TOOLS_TOOL`.
- `apps/web/lib/actions/agent-coworker.ts:~1181–1321` — assembles authorized tools → `deriveCoworkerToolCap` → `selectCoworkerToolBudget` → prepends `load_tools`.
- `apps/web/lib/tak/agentic-loop.ts:1582–2075` — zero-tool branch; `detectFabrication` (375), `shouldNudge` (620); `tool_choice` always `"auto"`.
- `apps/web/lib/tak/context-economy-metrics.ts` — `LOCAL_TOOL_SELECTION_CLIFF=15`, per-turn `toolSurface/surfaceZone/toolAccuracy` gauge.
- `apps/web/lib/tak/route-context-map.ts` — `/ops` `domainTools`; `prompt-assembler.ts:215` (prose-only today).
- `apps/web/lib/routing/pipeline-v2.ts:103` — `contract.requiresTools && !supportsToolUse` hard filter; `recipe-types.ts:63` — `tool_choice: "auto"|"required"|"none"`.
- `RouteOutcome` / `AdapterRunTelemetry` — audit substrate for recovery logging.

## Plan (red → green, DPF-governed)

### Step 1 — Fidelity-bounded cap (RC1) — single source (INV-6)
1. New pure module `apps/web/lib/routing/tool-fidelity-policy.ts`: `capForModel({ providerTier, profileConfidence, servedContextTokens, surfaceCandidate, allowListed }) → number`. Rule: if `providerTier === "bundled"` (local), NOT on the validated allow-list, and no measured fidelity (`profileConfidence` not yet `high`) → **cliff-prone (min(window-fit, LOCAL_TOOL_SELECTION_CLIFF))** at ANY context window. Cloud (`null` served context) and allow-listed/measured profiles keep the window-fit ceiling (**INV-2 non-regression**). Make this module the single home the 15/48 constants reference (route `deriveCoworkerToolCap` and `fallback.ts`'s `LOCAL_FALLBACK_MAX_TOOLS` through it).
2. Seed allow-list: enumerate known-good local profiles that work at 48 today (from `known-model-seeding.ts` provenance) so Phase 1 does not regress them to 15 before the Phase-2 eval exists.
3. Failing unit tests first: (a) `capForModel` with `servedContextTokens=131072`, `providerTier=bundled`, low confidence, not allow-listed → 15; (b) allow-listed local @131072 → 48 (non-regression); (c) cloud (`null`) → 48.
4. Wire into `deriveCoworkerToolCap`'s caller (`agent-coworker.ts:~1323`). P1 keeps the `localServedContext` proxy as input (no model-identity dependency — the endpoint isn't resolved until inside the model call); model-keyed lookup is deferred to P2 once resolution is hoisted.

### Step 2 — Close the intent-ranker recall gap (RC2)
1. The relevance ranker ALREADY exists (`selectCoworkerToolBudget` `intentQuery` → `scoreToolIntentRelevance`/`tokenizeIntent`; caller passes `intentQuery: trimmedContent` at `agent-coworker.ts:~1332`). Do NOT add a second ranker. Improve recall inside `scoreToolIntentRelevance`: route-anchored boosting (tools named in the route's `domainTools` get a floor score) + capability-tag/synonym matching so "pressing issues resolved" reaches `list_backlog_items`/`query_backlog`.
2. Force route `domainTools` into tier-0 (always-attached) in `agent-coworker.ts` attachment — not just the prompt prose block (`agent-coworker.ts:~778`).
3. Failing test first: backlog-intent message on `/ops/self-upgrade` → `attached` includes `list_backlog_items` + `query_backlog` even at cap 15 (score > 0 / tier-0).

### Step 3 — Evidence-integrity gate (RC3, INV-1/4/5)
1. New module `apps/web/lib/tak/evidence-requirement.ts`: `classifyEvidenceRequirement(message, routeContext, resolvedTools) → { required: boolean, taskClass }`. Phase-1 form: derive from **tool metadata** where possible — a turn is evidence-required when the route/intent maps to authoritative/live-state tools (reuse the route's `domainTools` set + an authoritative-tool tag), with a small keyword seed as bootstrap. Name the fully data-driven form as the P2 `IntentClassifier` target; keep it data-shaped, not a sprawling hardcoded branch.
2. In the agentic-loop zero-tool branch: when `evidenceRequired && executedAuthoritativeTools === 0`, enter the bounded recovery ladder (spec §4): (a) one retry with a reduced, task-compiled catalog + `tool_choice="required"` (transport exists — `chat-adapter.ts:~342` applies `plan.toolPolicy.toolChoice`), **pinned to the local endpoint with `callWithFallbackChain` disabled** so recovery makes zero paid-provider calls (INV-4); (b) if still zero → return INV-5 message ("I couldn't verify this against live data …"), never the model's factual prose. Record a `RouteOutcome` recovery row. Bounded: max 1 forced retry, no provider-tier escalation.
3. Failing tests first: (i) evidence-required + zero authoritative tool + factual prose → rejected/recovered, not returned; (ii) evidence-required + successful tool → passes; (iii) non-evidence turn → unchanged behavior; (iv) recovery path performs **zero paid-provider calls**.

### Step 4 — Reproduce + functionally verify
1. Integration test reproducing the incident: ops-coordinator, `/ops/self-upgrade`, qwen3.6 profile @131072, "have the pressing issues been resolved?" → cap ≤15, backlog tools attached, and a zero-tool factual answer is rejected → recovery.
2. Live-install functional verification (`dpf-verify-on-live-install` preflight → CAN-TEST): drive the real turn; prove the local model answers from live rows (710/23/142/4/194) or fails safe with INV-5. Record `record_runtime_verification`.

## Verification commands

- `pnpm --filter web exec vitest run lib/routing/tool-fidelity-policy.test.ts lib/actions/coworker-tool-budget.test.ts lib/tak/evidence-requirement.test.ts lib/tak/agentic-loop.test.ts`
- `NODE_OPTIONS="--max-old-space-size=8192" pnpm --filter web typecheck && pnpm --filter web build`
- Local-CI pregate before push (`pnpm run pregate`).

## Rollback

Attachment/loop-policy only; no authority change, no destructive migration. Revert the three new modules + their wiring; the size-only cap returns. No data backfill.

## Out of scope (later phases, file after arch review)

P2 intent classifier + `ToolSelectionFidelitySample` eval harness; P3 capability broker replacing model-driven `load_tools`; P4 specialist delegation (MoE) + DB-vs-JSON grant reconciliation.
