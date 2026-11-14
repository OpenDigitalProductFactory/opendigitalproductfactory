---
status: active
---

# Plan — Situational LLM Call Parameterization

**Design:** [2026-09-18-situational-llm-call-parameterization-design.md](../specs/2026-09-18-situational-llm-call-parameterization-design.md)
**Epic:** EP-70FF623B
**Branch base:** `main`

## Backlog coverage

| Item | Scope | Spec | State |
|---|---|---|---|
| BI-8CFA1CA8 | Preferences, not pins — close the three leaks | §5 | landed |
| BI-1F5DAABC | `ModelCardSampling` + `resolveSamplingProfile` on every path | §1 | landed |
| BI-40DA6D05 | Contract-family temperature replaces budget-class | §2 | landed |
| BI-DBAFEC10 | Effort expression across all providers, proportional budgets | §3 | landed |
| BI-5C48438C | Sampling and constrained decoding reach local | §4 | landed (partial — see below) |
| BI-8B2DB9E8 | Native `/api/chat` for `top_k`, `min_p`, per-request `num_ctx` | §4 | request builder landed, transport off by default |
| BI-B4081AA1 | The audit log records how a model was called, with provenance | §5 | landed |
| BI-4690CB37 | Route-audit panels read their copy from the message catalog | §5 | landed |
| BI-B4081AA1 | Parameters and provenance in the explanation | §6 | landed — persisted on the audit record and shown in the audit row |

Every spec section maps to at least one item; no item is spec-less.

### What §4 actually delivered, and what it did not

Temperature and `top_p` reach the local endpoint, and `response_format` constrains
JSON decoding — which also fixed a third dead field found on the way:
`responsePolicy.strictSchema` was carried on every plan and never sent to any
provider.

Ollama's OpenAI-compatible endpoint **silently ignores** `top_k`, `min_p`,
`repeat_penalty` and `num_ctx`. Qwen3's published thinking profile is
0.6 / 0.95 / 20 / 0; through `/v1` we deliver the first two.

**BI-8B2DB9E8 now ships the request builder for `/api/chat`, with the transport
switch defaulting to OFF.** The body construction is pure and unit-tested — the
full sampling set, `num_predict`, `num_ctx` read from the reconciler, `think`, and
schema-constrained `format`. What is *not* exercised is the response side:
`/api/chat` returns a different shape, and the current local branch carries
several hard-won tool-call rescue paths (textual `<tool_call>` markers,
Anthropic-style `tool_use` emitted as content) that a new transport must not lose.

Turning it on is therefore an explicit, evidence-backed decision rather than a
default, because the local path is the platform's *fallback* — the one that
catches everything during an outage or an upgrade drain. That is the worst path
to gamble with on untested transport code.

`num_ctx` is less urgent than it first appeared: the served window is already
reconciled server-side, VRAM-aware, by `local-model-context-reconcile.ts`.

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

---

## Acceptance coverage — BI-B4081AA1 and BI-4690CB37 (Phase 5)

Phase 5's acceptance criteria, quoted from `BI-B4081AA1`, each against the deliverable that satisfies it. Two deliverables, both independently shippable; the second depends on the first.

### `call-parameter-receipt` — a route decision records its call parameters with per-value provenance

Satisfies AC-1 through AC-6 and AC-8.

- **AC-1** A persisted route decision carries the wire parameters actually sent — temperature, top_p, top_k and the effort expression — and not a recomputation of them.
- **AC-2** Each recorded parameter names the layer that set it: vendor floor, contract family, recipe, or operator override. A reader can tell an operator's choice from a vendor default without reading code.
- **AC-3** A route decision states the resulting determinism in words, so a non-technical operator can read variability without interpreting a temperature number.
- **AC-4** A run that routed below the quality floor is countable from the log. `qualityFloorRelaxed` reaches a persisted column instead of being discarded mid-flight.
- **AC-5** Parameters that a local provider's OpenAI-compatible endpoint silently discards are either delivered by a transport that carries them, or the loss is recorded. Neither is silent.
- **AC-6** The native local transport is off by default, so local dispatch does not change behaviour on merge.
- **AC-8** Two migrations add the columns, each with a data-impact attestation under `changes/`.

Contracts: [`call-parameter-receipt.ts`](../../../apps/web/lib/routing/call-parameter-receipt.ts) · [`local-native-request.ts`](../../../apps/web/lib/routing/local-native-request.ts) · `packages/db/prisma/migrations/20260923010000_route_decision_call_parameters/migration.sql` · `packages/db/prisma/migrations/20260924010000_route_decision_routing_confidence/migration.sql`

Flows: [`loader.ts`](../../../apps/web/lib/routing/loader.ts) · [`RouteDecisionLogClient.tsx`](../../../apps/web/components/platform/RouteDecisionLogClient.tsx)

Verification: local-CI gate PASS on `d7e2da70186155e87c5f00604e7729e1dd080a49` · `changes/route-decision-call-parameters.data-impact.json` · `changes/route-decision-routing-confidence.data-impact.json`

### `route-audit-localization` — the route-audit panels read their copy from the message catalog

Satisfies AC-7. Depends on `call-parameter-receipt`.

- **AC-7** Both audit panels read their copy from the message catalog; no user-facing string is hard-coded in JSX.

Contracts: `packages/i18n/src/messages/en-US/routeAudit.json` · `packages/i18n/src/catalog.ts`

Flows: `apps/web/app/(shell)/platform/audit/routes/page.tsx`

Verification: `scripts/check-no-unlocalized-ui.mjs` · `scripts/prose-lint-baseline.json`

### Across both

- **AC-9** The full unit suite and package typecheck pass, and the local-CI gate passes on the exact pushed head.

2824 tests passing, typecheck clean, gate PASS on `d7e2da70186155e87c5f00604e7729e1dd080a49`.

### What Phase 5 did not deliver

A true UX measurement. Production refuses `issue_ux_verification_sign_in` until an operator records `automation.signIn.enabled`. The UX-Fit gate's silence on this branch is structural — localizing the copy moved it out of JSX, so the detector no longer trips — which is an argument, not a measurement. Phase 5's §4.3 gate is therefore **unrun, not passed**.

The parameter line is on the audit panels rather than in `formatDecisionForUser` as this plan first sketched: that function was found to have zero callers, so wiring it would have added a surface nobody reads. The provenance display landed on the route-audit log, not `platform/ai/routing`; the newer `RoutingManagementInspector` is the intended second consumer and should read `callParameters` rather than recompute it.
