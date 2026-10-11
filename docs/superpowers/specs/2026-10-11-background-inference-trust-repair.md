---
status: active
---

# Background inference trust repair

## Recovery brief

The operator authorized further investigation and source changes on October 11,
2026. This chat exposes no DPF MCP tools. The supported toolchain bootstrap
refreshed the plugin but reports authorization pending; the current tool registry
remains unchanged. The checked-in recovery-routing procedure and
`gate-context.mjs --situation mcp-unavailable` permit bounded source repair and
local verification, with coordination reconciled when the connector returns.
No live records, decisions, model status, or install assets will be patched.
Backlog/workroom claim, independent review, coverage receipt, runtime verification
and deployment are pending, not passed. Base: origin/main 9f95f3c9b7a5bbf647e2654950aa19687bd30367.

## Problem and evidence

On the observed development install v2026.10.10, startup queued one local calibration at
2026-10-11T17:17:10.630Z. Chat tests targeted nomic-embed-text-v1.5 and returned
HTTP 500; the logs report retirement at 17:19:54.402Z. Existing model metadata
already describes embedding output, but evaluation admission checks the provider
rather than the model. Golden tests declare token limits that are not passed to
the inference adapter. Decision Concierge also panelled the unresolved August 27
Grok sign-in question; its run ended with no consensus, confidence 0.19 and no
evidence bundles. Claude attempts hit its quota and local attempts hit capacity.
The existing alignmentStatement implementation already prevents new bare tool
labels (BI-63B14D4B); old records remain in the ledger. The self-review's
isBareQuestion rule already identifies these as defects. This patch shares that
rule with the concierge instead of inventing a second definition.

## Objectives and acceptance

**OBJ-1:** Calibration measures a compatible model without changing unrelated capabilities.

**OBJ-2:** Background panels spend capacity only on an answerable, changed case.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Embedding-only models cannot enter or execute chat dimension evaluations, including stale queued events and forced runs. |
| AC-2 | OBJ-1 | Text-generating models retain calibration, and each golden test's declared token budget reaches the provider. |
| AC-3 | OBJ-1 | Skipping an incompatible evaluation does not retire, demote, or overwrite that model. |
| AC-4 | OBJ-2 | An empty tool-action question is reported as needing context without dispatching a panel. |
| AC-5 | OBJ-2 | An unchanged completed or pending panel is not automatically repeated; a changed decision case can be considered again. |
| AC-6 | OBJ-2 | Skipped cases remain visible in sweep counts, with explicit reasons; no human decision is inferred or resolved. |

## Architecture and sequence

Reuse ModelProfile modelClass/outputModalities and the existing generation
eligibility helper; centralize calibration admission across discovery, catch-up
queueing and execution. Pass a bounded execution plan to the existing provider
adapter, retaining explicit calibration attribution. Reuse DecisionInteraction
and DeliberationRun rather than creating an activity ledger or retry table.
Prevent repeat panels only when the saved case still matches the current case;
preserve an explicit explanation for operators and permit meaningful updates.

Implementation covers admission and token budgets, shared panel-brief construction,
case comparison and reservation before dispatch. Focused regression tests exercise
the observed prompts, incompatible models, unchanged evidence, concurrent passes
and dispatch failure. No pre-change failing test run was recorded. Reconcile live
backlog coverage and route review when MCP is available.

## Verification record

Eleven focused test files passed, 208 tests total, including the decision
self-review suite. Production and test-program typechecks passed after the final
source refactor. Runtime build, live functional verification and deployment are
unrun because the DPF connector is unavailable. Source changes are preserved on
`fix/inference-background-trust` in `D:/DPF-worktrees/inference-background-trust`.
The first broad preflight found private install identity and missing spec status
in this brief; both were corrected. Its installer Bash test failed when Windows
selected WSL bash for a Windows path; rerunning that test with Git Bash passed.
The source module-size and private-identity guards passed after correction.

## Compatibility and limits

No schema migration, provider enablement, quota bypass, decision reclassification,
new model download, or live upgrade. Existing wrongly retired embedding profiles
need separately governed reconciliation; this patch must not revive a manually
disabled model. Inference UI work remains dependent on an available served target
and should reuse the existing trace projection. Complete routing exclusions could
not be read because the posture tool truncates its unfiltered response.

## Operator-authorized follow-through

The operator authorized proceeding with each finding on October 11. This is a
recovery work packet, not a live backlog claim or a completed deployment receipt.
The connector dry run still reports `authorization_pending`, and this chat's
attached tool registry has no DPF calls. A client reconnect/fresh session is the
first dependency; repeated bootstrap writes cannot refresh the current registry.

Proceed in this order, reusing the existing DPF substrates and recorded evidence:

| Step | Work | Completion evidence |
| --- | --- | --- |
| 1 | Restore the native DPF connector and read its installation contract; reconcile this packet into the live backlog/workroom. | Callable governed tools, authorized scope and recorded work ownership. |
| 2 | Refresh the topic branch against current main, obtain required review and build evidence, and deliver the calibration/concierge repair through the normal PR and self-upgrade paths. | Required checks and review pass, deployed image identity includes the repair, live probes reject incompatible calibration and repeat panels. |
| 3 | Read the saved ChatGPT/Codex connection facts, request-scoped policy receipts and routing traces. Identify the exact rule producing each exclusion before altering it. | One representative blocked request correlated with its allowlist/suitability explanation and connection identity. |
| 4 | Correct unintended exclusions or stale connection facts through their owning governed configuration. Prefer healthy ChatGPT/Codex routes for eligible work, retaining local-only data boundaries. | An eligible request completes on the connected ChatGPT/Codex account; a local-only request remains local; an exhausted cloud route falls back without repeated quota retries. |
| 5 | Measure local memory, queue delay, prompt/output tokens and latency under a representative authorized workload. Compare the existing context pin with the resource-aware serving default, then retain the setting that improves service while fitting required local-only prompts. | Before/after latency and memory evidence, no context truncation, no new concurrent local inference, explicit rollback setting. |
| 6 | Verify the existing AI Operations evidence view names request origin, selected provider and binding exclusion reason. Extend the existing trace projection only if those facts remain inaccessible. | The operator can explain a representative local request from its record, including whether it is calibration, a panel or a fallback. |

New read-only hardware evidence: on the observed 24 GB GPU, 23,587 of 24,564 MiB
were allocated, while utilization was 1 percent at the sampling instant. The
resident model was the 27B Q4 chat model; approximately 9.4 GiB of host RAM was
free. This proves little memory headroom at that instant, not sustained GPU
saturation or a measured benefit from reducing context. The previous runtime
warning reports a 40,960-token pin versus an estimated 24,576-token ceiling;
neither is a benchmark result. Do not reduce context solely from that warning.

Source tracing confirms request allowlists are hard filters and can be produced
by data screening and connection-specific provider suitability. Cloud preference
is already ranked above bundled local routes among eligible providers. Available
subscription allowance cannot override an exclusion or prove the install's
credentials work. No live policy, serving setting or provider grant was changed.

Before further implementation, refresh main: four upstream commits arrived after
the prior repair was committed. Preserve the 208-test/typecheck evidence as
source-local evidence, re-running affected checks when the refreshed diff warrants
it. Runtime build, governed review and deployment remain pending.
