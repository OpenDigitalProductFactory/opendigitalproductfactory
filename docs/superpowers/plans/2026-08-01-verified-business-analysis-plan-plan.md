# Verified Business Analysis Plan — implementation plan

- **Date:** 2026-08-01
- **Design:** [Verified Business Analysis Plan](../specs/2026-08-01-verified-business-analysis-plan-design.md)
- **Umbrella backlog:** `BI-8EC3E4BF`
- **Follow-on backlog:** `BI-36358ACF`
- **Capsule:** `WC-7DCE297F`
- **Branch:** `feat/verified-business-analysis-contract`

## Outcome

Ship a pure, versioned, deterministic analysis-plan contract that resolves only canonical performance metrics, fails closed on ambiguity or invalid input, and can be reused by the later plan-review UI and watched-question scheduler.

## Scope boundaries

- Edit `packages/storefront-templates` contracts, catalog, exports, and tests.
- Add this dedicated design/plan and a narrow pointer from the parent business-performance design if conflict-free.
- Do not edit the active `BI-PLAN-005` claims: `apps/web/lib/performance`, `apps/web/components/performance`, `/performance`, Prisma schema/migrations, rollup queue function, or performance data assets.
- Do not add a graph database, general query language, SQL generator, runtime service, or dependency.

## Phase 1 — Define done with failing tests

1. Add `business-analysis-plan.test.ts` with fixtures for accepted status, missing comparison clarification, unknown metric refusal, unsupported grouping/filter refusal, deterministic normalization/fingerprint, and metric-definition compatibility.
2. Run the targeted Vitest file and capture the expected module/export failure.
3. Keep fixtures in business language and assert issue codes plus paths rather than full prose snapshots.

## Phase 2 — Refactor the canonical metric contract

1. Move metric closed axes into exported frozen tuples and derived union types.
2. Replace prose-only `aggregation` with typed calculation structure plus a separate human-readable `definition`.
3. Update the catalog helper and definitions mechanically; retain keys, labels, units, source owners, grain, comparison, sensitivity, and drill-down behavior.
4. Add a catalog invariant that every map key matches the definition key and every referenced calculation input is non-empty.

This is the reserved refactoring tranche: it removes the untyped aggregation seam and centralizes closed axes before adding the plan compiler. It is approximately 20% of the implementation effort.

## Phase 3 — Implement validation, normalization, and identity

1. Add `business-analysis-plan.ts` with versioned input/result contracts and issue codes.
2. Implement exhaustive runtime guards for untrusted JSON input.
3. Resolve metrics from the canonical catalog and enforce metric capabilities.
4. Separate clarification from refusal and ensure only accepted plans carry an executable normalized plan.
5. Canonically order set-like values, serialize stable keys, and compute the non-security fingerprint.
6. Export the contract from the package root.

## Phase 4 — Verify and document

1. Run the targeted test red-to-green, then the full storefront-template suite and typecheck.
2. Run source-local repository guards affected by docs/package exports.
3. Route the exact merged candidate through the governed local-CI build gate.
4. Record test/build/documentation evidence on `WC-7DCE297F` and `BI-8EC3E4BF`.
5. Run semantic change review against `origin/main...HEAD`; fix every blocker.
6. Commit with DCO, push, open a ready PR, verify with `pnpm pr:health`, and enter the merge queue.

## Backlog coverage

This plan is atomic. The metric refactor and plan validator are not independently useful: the refactor supplies the closed executable semantics the validator must verify, and shipping either alone would leave two authorities or a validator over prose.

| Key | Deliverable | Backlog | Independently shippable | Depends on |
| --- | --- | --- | --- | --- |
| verified-analysis-contract | Typed metric semantics plus deterministic BusinessAnalysisPlan validation | `BI-8EC3E4BF` | no | — |

### Coverage receipt

Recorded by the governed planning tool before production source edits:

- **Receipt:** `cmsakarvh075701qkmznqdvk9`
- **Decision:** `atomic`
- **Umbrella:** `BI-8EC3E4BF`
- **Rationale:** the typed metric refactor and validator form one contract boundary; either shipped alone would leave an incomplete or duplicate semantic authority.

## Verification matrix

| Gate | Evidence |
| --- | --- |
| Targeted unit | `business-analysis-plan.test.ts` red then green |
| Package regression | full `@dpf/storefront-templates` Vitest suite |
| Types | package typecheck plus production web build |
| Migration | not applicable; no schema change |
| UX | not applicable to contract-only slice; explicitly owned by `BI-36358ACF` |
| Docs | design, plan, package exports, parent-design pointer |
| Architecture | semantic change review and governed local merged-code gate |
