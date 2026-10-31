# Local provider pause at execution boundaries

Backlog: BI-CD3C1E50. Workroom: WC-7C284292. Delivery: small, bounded defect repair.

## Design grounding

Extend [operator provider pause](../specs/2026-10-11-provider-pause-design.md), OBJ-PAUSE and OBJ-RESUME, and [provider pause integrity](2026-10-28-provider-pause-integrity.md). The latter supersedes the original embedding exclusion. This follow-up addresses two omitted execution boundaries; it does not replace those work items or the active release work.

Source baseline: ea62f5fb890390bde854b618834f5e77fd3865ea. Existing authority is ModelProvider.status plus AiProviderConnection.status, read by apps/web/lib/inference/provider-routing-admission.ts. Kernel decision DI-F394AD0C510D favors reusing that reader rather than adding state or a supervisor.

Live observation on 2026-10-31: Qwen was preloaded by local-model-context reconciliation while the default local account remained paused. New normal completion ledger entries remained absent. Source inspection confirmed a separate race: OpenCode checks endpoint readiness before waiting for its lane, then spawns without rereading operator eligibility. The queued-spawn race is not yet functionally reproduced.

## Acceptance criteria

- Paused, disabled, or inactive local routing prevents every load-inducing DMR configuration POST, including a pause between multi-mode writes.
- A local coding job paused while waiting for its resource lane does not spawn; the caller receives the existing provider-unavailable/deferred behavior.
- Enabled routing retains existing configuration and coding behavior; existing running subprocesses are not killed.
- Regression tests exercise the pause at each side-effect boundary using the shared provider admission reader.

## Ordered implementation

One atomic lifecycle repair: both adapters must respect the same existing operator veto. The steps below are internal sequencing, not separate products.

1. Reproduce the omissions in focused tests. Related-test lookup returned dmr-runtime-config.test.ts, opencode-dispatch.test.ts and capacity-deferral.test.ts. Add a controlled queued-dispatch test and extend local-model-context-reconcile.test.ts to check caller behavior.
2. In apps/web/lib/inference/dmr-runtime-config.ts, call readEnabledRoutingProvider immediately before each model-loading configuration POST. Preserve GET probes, configured context, existing flags, keep-alive intent and CPU embedder placement. Return the existing failure/deferred result with the actual hold reason. Eligibility-read errors fail closed and must not masquerade as an unreachable DMR endpoint.
3. In apps/web/lib/build/opencode-dispatch.ts, check local routing near entry and again inside the resource-lane callback immediately before runSandboxAgentCli. Re-throw ProviderRoutingDeferredError before generic failure/capacity recording. Extend apps/web/lib/build/capacity-deferral.ts to recognize the routing hold and preserve its reason; existing retry/wait paths then avoid consuming repair budgets. Do not put provider policy in generic resource-lane.ts.
4. Run the focused tests, package typecheck, style-drift guard and exact-diff gate context. Regenerate the doc index. Run pregate:preflight and the governed exact-tree pregate before protected publication. Obtain independent review and pr:health before claiming merge readiness.
5. Canonical live verification follows the existing release owner and request_self_upgrade. With the new image, paused reconciliation must not reload an unloaded completion model; a queued local coding job paused before admission must not launch. Resume must permit normal work. Source-local checks are not live verification.

## Verification references

- TEST-DMR-PAUSE: zero configuration POST while paused/inactive/missing, including pause between completion and embedding modes.
- TEST-DMR-ENABLED: preserve context, flags, residency and CPU placement; existing no-op behavior remains.
- TEST-OPENCODE-PAUSE: initial pause and pause during lane wait prevent spawn and failed-capacity evidence.
- TEST-OPENCODE-ENABLED: enabled launch still succeeds.
- TEST-HOLD-CLASSIFICATION: preserve operator reason with no expected-free time.
- GATE-SOURCE: affected tests, web typecheck, style-drift guard, doc-index check and pregate.
- GATE-LIVE: canonical deployed-image verification; remains owed until actual runtime evidence.

## Risks and rollback

An admission read failure now prevents a model load or coding launch rather than risking work against a disabled provider. Checks are immediately before side effects; they do not cancel an already-started request or subprocess, nor establish a cross-system transaction with Docker. Existing resident models are not forcibly unloaded. No new schema, lifecycle state, route, clearance, capacity grant or UI is introduced. Revert this scoped commit through the normal PR/release path if necessary; keep operator pause intact. Do not hand-build or swap the live image.

## Backlog coverage

Parent and sole deliverable: BI-CD3C1E50. Decision: atomic. Scope: the two execution adapters and their regression tests. Requirement reference OBJ-PAUSE; contract reference readEnabledRoutingProvider; flow reference local-load-and-launch-admission; verification references TEST-DMR-PAUSE and TEST-OPENCODE-PAUSE. There are no independent deliverables or dependency edges.

The immutable plan will be submitted to record_plan_backlog_coverage before implementation; its returned receipt will be recorded here. Research receipt: initiative-e90e4c45-9361-4f27-bf3b-7fc4d8e4cfce. Change impact contract requires the related tests above, style-drift guard, doc-index regeneration, exact-tree pregate and pr:health.
