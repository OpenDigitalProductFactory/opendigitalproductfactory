# Implementation Plan — BI-DFC30977

**Route unknown (null) tool-capability as attempt-and-calibrate, without overriding explicit per-transport floors; dedup shadowed qwen3-coder profiles.**

> Supersedes the earlier antigravity plan, which was built on a falsified premise (a model-identity "cloud capability prior"). See §Premise.

## Premise (why the earlier plan was wrong)

Tool capability is a property of **(model × transport)**, not of model identity. `apps/web/lib/routing/known-provider-models.ts:377-405` sets `chatgpt/gpt-5.4 → toolUse:false` **deliberately** (the ChatGPT-subscription backend `/codex/responses` supports only Codex built-in tools, not custom function tools — which is what every DPF tool is), while `codex/gpt-5.4` (`:342-374`, routes to `api.openai.com/v1/responses`) is correctly `true`. Forcing `true` by identity would override a correct floor and cause runtime tool-call failures.

The real, narrower defect: capability that is genuinely **unknown** (`null`) is coerced to `false` and excluded, with no recovery path. `metadata-extractor.ts` only derives tool support for ollama/gemini/openrouter; every other provider's discovery returns `null`.

**Non-goals:** no identity-based cloud prior; no change to the `chatgpt/gpt-5.4 → false` floor; no operator/config actions (reconnecting Anthropic / enabling the Codex provider is the separate live lever and needs no build).

## Open questions
None blocking. One design choice resolved inline in Phase 2: the calibrate signal writes the `supportsToolUse` **boolean** from the measured `tool_call` dimension (the gates read the boolean, not `toolFidelity`).

---

## Phase 1 — Attempt: treat `null` (unknown) as allowed, keep explicit `false` excluded

Keep unknown capability alive to the gate, and change the four gates from "falsy excludes" to "only explicit `false` excludes". `resolveToolUse` already floors every explicit-false source (provider floor, `capabilityOverrides.toolUse:false`, catalog/profile `false`) to `false` (never `null`), so this preserves correct exclusions while letting `null` through.

- **`apps/web/lib/routing/loader.ts:191`** — `supportsToolUse: resolveToolUse(mp) ?? false` → `supportsToolUse: resolveToolUse(mp)` (let `null` survive). `EndpointManifest.supportsToolUse` type must allow `boolean | null` — confirm and widen if needed.
- **`apps/web/lib/routing/pipeline-v2.ts:93`** — `if (contract.requiresTools && !ep.supportsToolUse)` → `=== false`.
- **`apps/web/lib/routing/pipeline.ts:152`** — `if (caps.supportsToolUse && !ep.supportsToolUse)` → `=== false`.
- **`apps/web/lib/routing/task-router.ts:141`** — `...supportsToolUse && !endpoint.supportsToolUse` → `=== false`.
- **`apps/web/lib/routing/agent-capability-types.ts:45`** — `if (floor.toolUse && !endpoint.supportsToolUse)` → `=== false`.

**Scope guard:** only the `toolUse` gate changes. The sibling capability floors (`structuredOutput`, `imageInput`, `computerUse`, …) keep `!== true` semantics — do not "consistency-fix" them; that is a separate decision.

**Tests (lock the invariant):**
- `pipeline-v2.capability.test.ts` — add: `supportsToolUse:null` + `requiresTools` → **eligible**; `supportsToolUse:false` + `requiresTools` → **excluded** ("Missing required capability: toolUse"). Assert `chatgpt/gpt-5.4` (explicit false) stays excluded.
- Mirror the false-stays-excluded assertion in the legacy paths (`pipeline.test.ts`, `task-router.test.ts`, `agent-capability-types.test.ts`).

## Phase 2 — Calibrate: close the loop so a null model that can't tool-call converges to `false`

**Gap confirmed:** `eval-runner.ts` (`runDimensionEval`, ~line 490-557) writes measured dimension *scores* (incl. `toolFidelity` via the `tool_call` dimension at `:150`) and promotes `profileSource→evaluated`, but it never writes the `supportsToolUse` **boolean** the gates read. So an attempted null model that fails tool-calls would keep being reselected.

- In `eval-runner.ts`, when the `tool_call` dimension is **conclusive** (not `inconclusive`), also write `supportsToolUse = (toolFidelity >= THRESHOLD)` in the same `modelProfile.update` (§547). Threshold: reuse the existing tool-fidelity cutoff if one exists; else introduce a named constant (start ~35, matching the magistral-tier prior boundary) and document it. Writing it as an `evaluated`-owned value means `resolveSyncedToolUse` (precedence step 3) preserves it against later low-confidence re-discovery.
- **Runtime safety net (already present, no change):** the pipeline-v2 circuit-breaker soft-exclusion cools a just-failed endpoint so a null model can't be reselected on every agentic-loop iteration *before* the eval calibrates. Note it in comments so the interplay is explicit.

**Tests:** `eval-runner` test — a conclusive low `tool_call` result writes `supportsToolUse:false`; a passing one writes `true`; an `inconclusive` result leaves the boolean unchanged (no clobber).

## Phase 3 — Dedup the shadowed qwen3-coder profiles + enforce uniqueness

Live DB has **two** non-retired `local/docker.io/ai/qwen3-coder:latest` rows: `cmqem1jz…` (`evaluated`, toolFidelity 100, `capabilityOverrides={toolUse:true}`) and `cmrlkwpqx…` (`seed`, toolFidelity 80, no override). `RouteDecisionLog` shows the **stale seed row is the one actually routing** — the measured profile is being shadowed. Two rows sharing `(providerId, modelId)` means the `@@unique([providerId, modelId])` the upsert relies on is not enforced in this DB.

> **WITHDRAWN 2026-07-23 — superseded by the upstream collation-drift repair; not shipped in this PR.**
>
> Re-checked against live data after the portal returned: the duplicates are gone and
> `ModelProfile_providerId_modelId_key` exists. The repair came from an established
> upstream program for **collation-drift index corruption**, not from a missing
> constraint as this phase assumed — see `docs/runbooks/2026-07-20-collation-drift-index-corruption.md`,
> `docs/data-impact/2026-07-21-retire-quarantined-duplicate-rows.data-impact.json`,
> and the `repair_*_index_integrity` migrations. That mechanism frees the unique pair
> by renaming losers to `__dpf_quarantined__<id>__<modelId>` rather than deleting them,
> so the migration drafted here would now match zero rows. Shipping it would add a
> competing dedup path over a solved problem.
>
> **Residual defect, split out rather than fixed here:** the upstream repair kept the
> *wrong* survivor for `local/qwen3-coder:latest` — the stale `seed` row (toolFidelity 40,
> no overrides) survived while the `evaluated` row (toolFidelity 100,
> `capabilityOverrides {"toolUse":true}`) was quarantined, losing both the measured
> calibration and the admin pin. Precedence + override-preservation on survivor choice
> belongs in the quarantine-triage path, not in a separate migration.
>
> **CLOSED 2026-07-24 — BI-84792669.** The precedence + override-preservation design
> drafted above was implemented as a reusable module,
> `packages/db/src/model-profile-precedence.ts` (`pickModelProfileSurvivor`,
> `pickCapabilityOverrides`), and applied to the live quarantine-triage state via
> `packages/db/prisma/migrations/20260724150000_retriage_quarantined_model_profiles`.
> That migration re-ranks every already-quarantined `(providerId, modelId)` group with
> the precedence this phase specified (`evaluated > admin > catalog > seed`, tie-broken
> on `evalCount`, `toolFidelity`, `lastEvalAt`, `generatedAt`) and copies forward any
> `capabilityOverrides` pin the survivor lacks. Live-verified: the `evaluated` row for
> `local/docker.io/ai/qwen3-coder:latest` reclaimed the natural key with `toolFidelity
> 100` and `capabilityOverrides {"toolUse":true}` restored.

- ~~**Reconcile migration/script**: for any `(providerId, modelId)` with >1 non-retired row, keep the highest-precedence row (`evaluated` > `seed`; tie-break higher `evalCount`/`toolFidelity`, and merge a present `capabilityOverrides`), retire/delete the rest.~~
- ~~**Verify the constraint:** confirm `@@unique([providerId, modelId])` exists in `packages/db/prisma/schema.prisma`.~~ Confirmed present and enforced live.

## Verification (functional — structural pass is not verification)

1. **`resolve_model_selection`** before/after: a tool-requiring phase whose only eligible endpoint has `supportsToolUse=null` goes from "no eligible endpoint" → routed.
2. **Live tool-call turn** against a null-capability endpoint: the model is attempted and, on repeated tool-call failure, is demoted (`supportsToolUse=false`) after the eval — confirm via `ModelProfile` + `RouteDecisionLog.excludedReason` on the next turn.
3. **Explicit-false invariant, live:** with the same config, `chatgpt/gpt-5.4` stays excluded from tool-requiring turns (never routed for a tool task).
4. ~~**Dedup**~~ — withdrawn with Phase 3; already zero duplicate rows live.

### Automated
- `pnpm --filter @dpf/db test`
- `pnpm --filter web exec vitest run lib/routing/ lib/inference/`
- Required CI gates: Typecheck · Prod Build · DCO · Unit.

## Blast radius / risks
- The gate change touches the hot routing path for every turn — the false-stays-excluded tests are the guardrail; land them first (TDD).
- Phase 2 without Phase 1 is inert; Phase 1 without Phase 2 risks a null incapable model looping until the circuit breaker cools it — **ship Phases 1+2 together.**
- ~~Phase 3 is independent and can land first.~~ Withdrawn — see the Phase 3 note above.
