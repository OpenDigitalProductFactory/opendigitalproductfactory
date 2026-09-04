---
status: active
---

# Codex subscription model eligibility implementation plan

| Field | Value |
| --- | --- |
| Backlog item | BI-37719AAB |
| Canonical design | `docs/superpowers/specs/2026-09-01-codex-subscription-model-eligibility-design.md` |
| Decision | Atomic |
| Why atomic | Selection and failure classification repair one externally observable dispatch contract; shipping either alone leaves the incident reproducible. |

Governance condition at authoring time: no initiative scope baseline exists for
this item. The coverage table below is therefore the durable mapping until an
independent passing spec-approval receipt mints that baseline and allows the
platform coverage recorder to bind it.

## Governed traceability

- Requirement: `OBJ-CODEX-ELIGIBILITY`
- Verification: `AC-CODEX-ELIGIBILITY-1`, `AC-CODEX-ELIGIBILITY-2`, `AC-CODEX-ELIGIBILITY-3`, `AC-CODEX-ELIGIBILITY-4`
- Contracts: `endpoint manifest eligibility`, `capacity error classifier`
- Flows: `Codex OAuth routing`, `Runtime Health`

## Outcome

A ChatGPT-authenticated Codex connection never dispatches a model the CLI has
declared unsupported, selects a supported sibling without a local-runtime detour,
and records only genuine capacity failures as rate limits.

## Ordered implementation

1. Add failing unit contracts for the exact unsupported-model stderr, genuine
   429/weekly/usage limits, OAuth model eligibility, API-key preservation,
   routing exclusion, and runtime-health explanation.
2. Add a pure account/model eligibility policy at the endpoint-manifest boundary.
3. Feed the policy result into the existing routing hard filter and exclusion
   trace so routing previews and Runtime Health remain truthful.
4. Replace the adapter's broad `rate` substring with explicit capacity
   signatures while preserving auth-first classification.
5. Run focused tests, every graph-linked routing test, typecheck, style guard,
   preflight, and the exact-tree canonical gate.
6. Push a DCO-signed branch, open a ready PR, verify merge readiness
   mechanically, merge through the queue, deploy through `/ops/self-upgrade`,
   and exercise the live ChatGPT-account route.

## Verification contract

- `codex-cli-adapter.test.ts`: exact HTTP 400 prose is not rate limit; 429 and
  subscription usage exhaustion remain rate limits.
- `codex-subscription-model-eligibility.test.ts`: OAuth excludes
  `gpt-5.3-codex`, keeps `gpt-5.4`; API-key and other providers are unchanged.
- `loader.test.ts` and `codex-subscription-model-routing.test.ts`: the incompatible endpoint remains
  visible with a hard exclusion reason while supported fallbacks remain eligible.
- `routing-exclusion-buckets.test.ts`: Runtime Health maps the reason to a
  specific owner action.
- Graph-linked suite from `find_related_tests`, `pnpm run pregate:preflight`,
  and `pnpm run pregate` are the implementation and exact-tree gates.

## Documentation impact

The canonical CLI routing design is updated because account mode is a routing
dimension and failure classification affects operator-visible capacity state.
No user guide, route map, schema documentation, or migration note changes: the
surface behavior is corrective and uses existing Runtime Health presentation.
