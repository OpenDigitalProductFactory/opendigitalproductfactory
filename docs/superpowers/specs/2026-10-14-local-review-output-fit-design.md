# Complete native local reviews within their authorized allowance

- Backlog: BI-3CF78C8E; related acceptance work BI-68EED40A and BI-128AEC8D.
- Workroom: WC-26F4D73B; branch `codex/local-review-output-fit`.
- Profile: fix; delivery shape: server-derived `delivery-small@1.0.0`.
- Source inspected: `e74ab9d0b5da4233dd2f9a5759f75ef152453e8c`.
- Direction: WWMD DI-CDF5289BF7C4. Task completeness and thoroughness remain the criterion; latency is a measurement, not an acceptance substitute.
- Status: design and research; implementation and live calibration unrun. Canonical plan coverage must be recorded before implementation.

## Problem and observed evidence

Native reconciliation TR-GATE-074E5ED7E7E4D307D3DA157A settled with diagnostic receipt `cmv7df1zz3i5u01o9gwowz4er`. The local branch returned HTTP 200, `finish_reason=length`, 16,384 completion tokens and no final content. Reasoning consumed the completion allowance. The other required branch deferred before inference because capacity was unavailable. Neither result is a code-failure verdict. The request ran for about 27 minutes, proving that the deployed parent-deadline repair no longer imposes the old 600-second cutoff. No unchanged retry was submitted.

The separate affected document workflow TR-GATE-357E568ADCCFFA161E94B64A produced a genuine independent PASS, receipt `cmv7cfb3m24nn01o9g2nglx8h`. This is a legacy v2 receipt, not proof of v3 artifact-role activation, publication of the original 27cf source, or complete model calibration.

Read-only Docker diagnostics identify Model Runner server v1.2.8 and llama.cpp b9879-metal, image `sha256:b70706f473b4043ca3e0c32704a7fda3412b83bceef0564684187b8011230de8`. Preserved request-engine telemetry reports a 131,072-token served context. The model card advertises 262,144; that advertised value is not configured capacity evidence. No Docker configuration, provider setting, grant or live image was changed.

The current source computes a proportional thinking allowance in `effort-expression.ts`, but the local request does not carry the supported numeric engine field. Native review declares `successShape: decision` while requiring a parsed JSON object. Activity harness response policy is not incorporated into the dispatch plan. These wiring failures require route-to-wire regression tests, not a prompt-only workaround.

An additional source hypothesis must be tested: the Anthropic adapter can expand `max_tokens` to a thinking budget plus 2,048 even after activity binding has set an explicit total completion allowance. No live cloud reproduction or paid probe has run. A correction must preserve the existing allowance on actual fallback dispatches, without changing unrelated calls.

## Design grounding

Reuse the [local tier plan](../plans/2026-08-15-qwen38-27b-local-tier-plan.md), [Reasoning Economy scope](2026-07-11-coworker-reasoning-economy-scope.md), [activity routing contract](2026-06-28-activity-level-ai-routing-harness-design.md), and existing runtime observation, effort expression, execution-plan and semantic-review modules. This adds no table, role, approval lane or independent routing system.

The exact installed vendor contracts are verified in primary source:

- [llama.cpp b9879 request parser](https://github.com/ggml-org/llama.cpp/blob/b9879/tools/server/server-common.cpp) accepts per-request `thinking_budget_tokens`.
- [DMR v1.2.8 HTTP handler](https://github.com/docker/model-runner/blob/v1.2.8/pkg/inference/scheduling/http_handler.go) exposes read-only `/engines/status` and model-filtered `/engines/_configure`, and forwards the complete inference body.
- [DMR v1.2.8 model configuration](https://github.com/docker/model-runner/blob/v1.2.8/pkg/inference/scheduling/api.go) identifies backend, model digest and operation mode. Completion mode is distinct from embedding mode.

A provider name or model family is insufficient evidence of the engine dialect. Extend the existing selected-model runtime observation to carry supported reasoning-budget evidence beside served context. Unknown, older, ambiguous or unreachable backend evidence remains unknown/unexpressed. It must not be silently presented as an enforced budget. No global `_configure` write or model reload is part of this repair.

The existing proportional effort decision remains the input. For a backend that supports a numeric limit, compile that decision inside the actual total completion allowance, leaving final-answer room. A tentative reserve is one quarter of the completion allowance, with the existing 2,048-token final-output floor where it fits. The reserve is a candidate to verify against task completion; it is not a claim of measured quality. Do not disable thinking, increase the activity's total tokens or reset its parent deadline. Reject malformed or impossible budgets rather than silently widening them.

Bind JSON success requirements before provider capability fencing and sampling. Carry the admitted response policy through execution planning and fallback to the actual HTTP request. Preserve the final-content channel: scratchpad, empty content and truncated responses cannot become semantic verdicts. PR #6270 already separates reasoning from final content; retain that repair rather than duplicate it.

## Objectives and acceptance

**OBJ-BUDGET:** The selected supported local engine receives the existing reasoning allowance within the unchanged total completion budget and has room to produce a final verdict.

**OBJ-CONTRACT:** The declared review response contract reaches actual dispatch and only a complete final response can supply an independent verdict.

**OBJ-GOVERNANCE:** Request identity, completed checkpoints, current authority, deadline, fencing, single-flight and paid-work limits remain intact across routing and recovery.

**OBJ-QUALITY:** Verify task completion and thoroughness on the actual served model/runtime; distinguish execution, selection accuracy, structured arguments and complete multi-step outcomes.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-WIRE | OBJ-BUDGET | A failing-before/passing-after regression inspects the real adapter HTTP body and shows the supported numeric allowance plus unchanged total max_tokens. |
| AC-SUPPORT | OBJ-BUDGET, OBJ-GOVERNANCE | Unsupported, ambiguous, stale or unreadable backend evidence never claims numeric effort was expressed; model/provider labels alone cannot enable the dialect. |
| AC-ENVELOPE | OBJ-BUDGET, OBJ-GOVERNANCE | Smaller activity allowances, invalid numbers, fixed provider thinking and fallback dispatch cannot exceed the authorized total; unrelated unbound calls retain their contract. |
| AC-JSON | OBJ-CONTRACT | Native review requests JSON through the actual route and wire policy; malformed, empty, reasoning-only and truncated output remains inconclusive. |
| AC-RECOVERY | OBJ-GOVERNANCE | Existing replay, expiry, cancellation, executor-loss and late-writer tests remain green; no request, receipt, deadline, authority or retry budget is fabricated or reset. |
| AC-QUALITY | OBJ-QUALITY | Record an actual complete native review and meaningful normal/adversarial task-completion checks with exact model/runtime/prompt/schema/tool-surface/budget identities. A known defective fixture must receive a relevant finding; a legitimate FAIL is a genuine verdict. |
| AC-DELIVERY | OBJ-GOVERNANCE | DCO source, independent exact-commit assessment, exact-head canonical gate, protected merge queue, canonical deployment and post-deployment verification are recorded. Unavailable gates remain unrun until reconciled. |

## Ordered fix and verification

All steps deliver one correction to the review completion contract. None is independently shippable; transport support without envelope compilation or final-response verification would misrepresent the repair.

1. **Reproduction and support evidence** (`AC-WIRE`, `AC-SUPPORT`). Add the failing route-to-wire behavior tests. Extend selected-model observation in `dmr-runtime-config.ts` and `local-model-context-reconcile.ts`; keep read-only probes finite, scoped to the selected provider/model and separated from authority. Exercise unknown/malformed/ambiguous response fixtures.
2. **Allowance compilation** (`AC-WIRE`, `AC-ENVELOPE`). Reuse `loader.ts`, `effort-expression.ts` and `execution-plan.ts`; apply the final reserve after the actual activity allowance is known. Map only supported dialects in `chat-adapter.ts`. Test local tools' existing non-thinking policy, activity binding, caller effort, explicit provider budgets and fallback HTTP bodies. Do not alter the capacity owner's single admission boundary.
3. **Completed response contract** (`AC-JSON`, `AC-RECOVERY`). Bind native `routed-semantic-review.ts` JSON requirements in `route-contract-builder.ts` before fences; preserve strict policy through plan binding. Keep empty, scratchpad and truncated output inconclusive. Run deadline, transport, cancellation and semantic-review failure suites.
4. **Governed delivery and task completeness** (`AC-QUALITY`, `AC-DELIVERY`). Commit, independently assess, run canonical exact-head CI, publish a DCO PR, merge through the queue and request canonical self-upgrade. Verify a fresh authorized native workflow and normal/adversarial completion controls. Reuse completed evidence; do not resubmit the expired TR074 packet or issue paid direct-to-engine probes. Broader 8/15/24/32/48-tool calibration remains explicitly tracked by BI-68EED40A and must not be claimed from these narrower review checks.

The Workroom's resolved change-impact contract requires graph-linked and colocated tests for nine source paths. `find_related_tests` returned a ready graph and exact related tests for each, including routed semantic review; DMR/runtime context; route contract, streaming and pipeline capability; inference activity overrides/background/attribution; chat adapter, local thinking, Gemini schema, tools, transport and admission; effort expression; execution plan and durable MCP routing; loader and fallback. Include these suites in the affected loop. Run the style-drift obligation, regenerate/check the doc index, both required typechecks, host preflight and canonical CI. A source-local pass does not replace a runtime gate.

## Backlog coverage

Implementation parent: BI-3CF78C8E. Canonical ordered fix: this document. Reference lists for atomic coverage are `AC-WIRE`, `AC-SUPPORT`, `AC-ENVELOPE`, `AC-JSON`, `AC-RECOVERY`, `AC-QUALITY`, `AC-DELIVERY`; `ActivityContract.tokenEnvelope`, `EffortDecision`, `RoutedExecutionPlan`, `SemanticReviewRequest`; `selected-model-observation`, `route-to-wire`, `native-review-completion`, `governed-delivery`; and `source-red-green`, `affected-suites`, `canonical-exact-head`, `live-task-completion`.

Coverage receipt: pending. Design/research admission is not implementation admission. Record the immutable committed artifact and live coverage, then read readiness before editing implementation. Keep the prior tiering/tool-selection evidence with its original date and limited scope.

## Risks and rollback

Numeric thinking limits can degrade thoroughness; JSON constraints can reveal inaccurate capability declarations or reject otherwise useful routes. Backend observations can become stale, and a model/runtime may change while a request is queued. Test these boundaries and disclose support as unexpressed when it cannot be established. Never infer a PASS from faster execution or valid JSON alone.

Revert this scoped change through a DCO PR and canonical deployment if functional verification fails. Reversion restores the earlier finite completion behavior and its known inconclusive-output limitation; it cannot restore a fabricated verdict or widen a deadline. Preserve prior receipts, request identities and benchmark evidence. No destructive data repair, provider credential change, live runtime configuration or manual image swap is required.
