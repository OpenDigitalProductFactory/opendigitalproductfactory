---
status: active
---

# Local-only inference policy repair

Backlog: BI-157696F8. Workroom: WC-46FC9F51. Shape: small fix.
Decision: DI-6C3C4523D3B1 selects strict shared reads over manufacturing a local-only value on failure.

## Problem and design grounding

The existing `getLocalOnlyInference` returns false on database failure. This grants cloud eligibility when the saved restriction could not be read. The control's technical label and optimistic state can also suggest coding enablement or a saved restriction before the server confirms it.

Reuse `PlatformConfig` key `inference-local-only`, the existing five-second cache, fresh reader, residency contract and manage-provider action. On cache miss/expiry, use the fresh reader and propagate failure. A missing row retains the existing cloud-allowed default. No new permission, policy store, schema, dependency or routing engine.

The existing component retains `initialEnabled` and `canWrite`. Present two explicit choices under **Where AI may run**, with coding impact and only confirmed saved state. Preserve pending/error/permission behavior. Prototype: [policy control](2026-10-12-local-inference-policy-repair.html).

Related active work: BI-7AA4EB6B owns flat provider/account presentation and the prominent effective-policy summary; BI-2BBD9D34 owns routing explanations/navigation. Both owning chats received authorized coordination notes. This repair does not replace their pages. The provider owner acknowledged no edits to this component/reader and confirmed prominent placement and removal of the Codex category heading.

Reviewed [multi-account design](2026-10-04-provider-multi-account-design.md), especially preservation inventory row for local-only policy; `local-only.ts`, `LocalOnlyInferenceToggle.tsx`, build-engine residency filtering, route-contract builder and shared report-kit. Unlike BI-A8BFEFCE (local-capacity probe), BI-BB337746 (retired local trust evidence), and BI-CAP-371D70E7 (review exceptions), this defect is the persisted residency-policy read and its existing control.

## Research and benchmarking

This is a repair of an existing contract, not a new routing feature. Reuse the multi-account design's routing research and filter-before-ranking decision. Compare existing cached reader (permissive on error) with the already strict async fresh reader: converge on the strict implementation. Reject an automatic boolean local-only fallback because it invents a saved state. UX critique requested as CE-7C9D03AD; advisory outcome remains pending.

## Acceptance and ordered implementation

- AC-READ: Failed cold/expired policy reads reject, including after a previously permissive cached value; retry can recover.
- AC-COMPAT: Missing config and valid true/false behavior remain; fresh reads bypass cache and successful writes invalidate it.
- AC-UX: Explain where AI may run and the coding impact; keep last confirmed policy during save and show accessible errors.
- AC-VERIFY: Source regression tests, web typecheck, guards, governed merged-code gate and served UI evidence precede delivery claims.

One atomic repair (POLICY-CONTROL): tests first for read failure and pending/error state, consolidate the reader, repair existing component, then verify and document. These are internal sequencing of the same misleading policy-control defect, not independent features. CONTRACT-POLICY is the existing boolean persistence and residency enforcement. FLOW-SAVE is select, pending, confirmed/error. VERIFY-POLICY covers reader/component tests, route-contract/build-engine regressions, typecheck, prose/style guards and served permission/keyboard/theme/narrow checks.

Declared files: `apps/web/lib/inference/local-only.ts`, colocated test, `apps/web/components/platform/LocalOnlyInferenceToggle.tsx`, colocated test, this design/prototype, user guidance and UX evidence. Generate the documentation index as required. The workroom impact contract requires colocated/graph test discovery, prose-lint and style-drift guards; no migrations.

## Risk and recovery

Policy read failure now stops a request instead of silently using cloud. The UI page may surface its existing error boundary when its policy read fails; it must not claim a fabricated local-only or cloud-allowed value. The valid five-second cache is unchanged, so this repair does not promise instantaneous cross-process policy invalidation. Revert only through normal PR delivery; reverting restores the known permissive error behavior. No live setting changes are needed for implementation.

## Backlog coverage

BI-157696F8 is the sole deliverable. Coverage receipt `cmv67neud1g9k01o7gqm7dyhw` records atomic coverage against design commit `67aa1fb2636ade9a18e6503cc3a6e77aee4f9262`; research receipt `initiative-4cd087d4-36cf-46d4-b53b-6cc747c11fd1` precedes allowed implementation decision `IRD-05F0561E6AFC`. Adjacent UI/layout changes remain in their existing BIs.
