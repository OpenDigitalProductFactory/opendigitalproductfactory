---
status: draft
---

# Plan — Situational LLM Call Parameterization

**Design:** [2026-09-18-situational-llm-call-parameterization-design.md](../specs/2026-09-18-situational-llm-call-parameterization-design.md)
**Epic:** EP-70FF623B
**Branch base:** `main`

## Backlog coverage

| Item | Scope | Spec |
|---|---|---|
| BI-8CFA1CA8 | Preferences, not pins — close the three leaks | §5 |
| BI-1F5DAABC | `ModelCardSampling` + `resolveSamplingProfile` on every path | §1 |
| BI-40DA6D05 | Contract-family temperature replaces budget-class | §2 |
| BI-DBAFEC10 | Effort expression across all providers, proportional budgets | §3 |
| BI-5C48438C | Native local transport (`options` / `think` / `format`) | §4 |
| BI-B4081AA1 | Parameters and provenance in the explanation | §6 |

Every spec section maps to exactly one item; no item is spec-less.

---

## Sequencing

Five phases, each a separate PR scoped to one clean revert (§3). The order is deliberate: the pin work goes **first** even though it is not the largest, because it is independent of the parameter work, it is the defect an operator feels today, and it carries the only migration — landing it early keeps the migration away from a stack of parameter changes.

### Phase 1 — BI-8CFA1CA8 · Preferences, not pins

Independent of everything else. Three sub-changes, one PR:

1. Remove `preferredProviderId: "anthropic"` from `/compliance` ([agent-routing.ts:427](../../../apps/web/lib/tak/agent-routing.ts)); encode the real requirement as `minimumDimensions` / `qualityTier` / reasoning floor, mirroring how `/build` was fixed.
2. Add `no-literal-pins.test.ts` — fails on any literal `preferredProviderId` / `pinnedProviderId` in route config. **This is the load-bearing part.** The `/build` fix was correct and the next route still got a pin, because nothing stopped it.
3. Split `residencyPolicy` off `pinnedProviderId === "local"` ([mcp-task-execution.ts:118](../../../apps/web/lib/mcp-task-execution.ts)). Migration writes `residencyPolicy: "local_only"` explicitly for existing `local`-pinned rows — behaviour identical, intent now visible. Forward-only, backfill inline (§2).
4. Replace the `embedding-model-first` remediation text that recommends pinning.

Surfacing the unhonoured preference as a clearable event is **deferred to Phase 5**, where the notification lands with the rest of the operator-facing display rather than half here and half there.

**Gate:** unit + `pnpm --filter web build` + migration applies cleanly. No UX gate — no UI change in this phase.

### Phase 2 — BI-1F5DAABC + BI-40DA6D05 · The sampling foundation

These two are one change in practice: BI-40DA6D05's contract-family table is a *layer inside* the resolver BI-1F5DAABC introduces. Splitting them into separate PRs would ship a resolver with a hole in it.

1. `ModelCardSampling` type + Prisma JSON column + `known-model-seeding` values from the vendor table (spec §1).
2. `sampling-profile.ts` — the pure composition function.
3. `contract-family-sampling.ts` — the task-intent layer; delete `OPENAI_CHAT_TEMPERATURE`.
4. Wire into **both** `buildPlanFromRecipe` and `buildDefaultPlan` ([execution-plan.ts](../../../apps/web/lib/routing/execution-plan.ts)).
5. `recipe-seeder.ts` parameter construction moves out; it keeps tool/response policy.

**Tests first** (`dpf-tdd`): vendor floor wins; contract narrows within vendor range only; `unsupported` strips; `buildDefaultPlan` populated (D-1 guard); `quality_first` extraction is 0.0 not 1.0 (D-2 guard).

**Gate:** unit + build + migration. Runtime verification deferred to Phase 3, where local is the observable case.

### Phase 3 — BI-5C48438C · Native local transport

Depends on Phase 2 — the adapter needs resolved sampling values to send.

`adapter-local-native.ts` against `/api/chat`, selected on native-API advertisement, falling back to `/v1/chat/completions`. `options` from the resolver; `num_ctx` **read from** [local-model-context-reconcile.ts](../../../apps/web/lib/inference/local-model-context-reconcile.ts), never computed here; `think` from Phase 4's effort decision if landed, else the vendor thinking profile; `format` when `contract.requiresStrictSchema`.

**This is the phase with a real runtime gate** (§4.3): dispatch on the live install and confirm Qwen3 is actually called at 0.6 / 0.95 / 20 / 0 in thinking mode — the defect that started this. Needs a nonprod lease (`dpf-use-shared-nonprod-environment`); the live install advances only via `/ops/self-upgrade` (§1).

### Phase 4 — BI-DBAFEC10 · Effort across providers

Independent of Phase 3, depends on Phase 2's plan-building refactor. `resolveEffort()` + per-adapter expression; Gemini `thinkingConfig.thinkingBudget`, OpenRouter `reasoning.effort`, provider-native fields; `effortLevels` gating; `effortUnexpressed` recorded; budgets proportional to `estimatedInputTokens`.

Phases 3 and 4 can run concurrently in separate worktrees once Phase 2 lands. They touch different adapters; the shared surface is `RoutedExecutionPlan`, fixed by Phase 2.

### Phase 5 — BI-B4081AA1 · Transparency

Last, because it displays what Phases 2–4 produce. Parameter line in `formatDecisionForUser`; provenance display on `platform/ai/routing`; `effortUnexpressed` and preference `fallbackUsed` surfaced — the latter including the Phase 1 deferral (the clearable "your preference has been unavailable since…" event).

**Gate:** UX verification required (§4.3) — this is a UI change. Theme tokens only, no hardcoded colors (§9).

---

## Risks

**Sampling changes model behaviour everywhere at once.** Phase 2 alters parameters on every dispatch. The golden-test corpus ([golden-tests.ts](../../../apps/web/lib/routing/golden-tests.ts)) is the safety net and must be run, not just the unit tests — a parameter change that improves extraction and regresses conversation would otherwise pass. If goldens shift, that is a finding to report, not a baseline to realign.

**The vendor table is a curation liability.** It is correct on the day it is written and decays as Qwen/DeepSeek/Hermes iterate. Mitigated structurally by putting it on the model card under discovery rather than in code (§1), but it still needs an owner and a cadence per `commons-are-curated-not-just-appended`. Worth a follow-up item once the column exists.

**Local runtime verification needs the install.** Phase 3's gate is runtime-bound, so it routes through the canonical runtime or a shared lease (§1). Plan for the lease rather than discovering it at gate time.

**Open questions from the design** (operator-override expiry; whether champion/challenger should explore parameters) do not block any phase. Both want the §1 plumbing landed before they can be answered with evidence.

---

## Not in scope

Local serving-engine work — speculative decoding, KV-cache quantization, prefix caching — is real and adjacent but is a serving concern, not a call-parameter concern. It deserves its own design against the local-stack specs.

A learned/semantic router is evaluated and rejected in the design's Research & Benchmarking section; revisit when production reward data exists to train on.
