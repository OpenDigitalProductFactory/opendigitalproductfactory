# Marketing Readiness Task-Class Correction

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time - one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

**Backlog item:** `BI-C1943813`
**Decision:** `DI-475F8F0D86E3`
**Branch:** `fix/marketing-readiness-task-class`

## Outcome

Make the existing food-hospitality Marketing campaign service advertise the
same representative work that the live Ask Marketing path performs: creative
campaign planning with tool use. Marketing becomes available only when that
specific contract can route; Customer Advisor remains fail-closed.

## Evidence

The governed live page at `/platform/ai/agent/AGT-WS-MARKETING` projects the
campaign service but reports `Needs attention` because no configured model
satisfies its route. The live configuration has an `adequate` coworker floor,
tool use enabled, no provider/model pin, cloud routing allowed, and no Golden
Triangle override. The service declaration instead labels its representative
probe `tool-action`, whose canonical meaning is multi-step external API work
and whose built-in floor is `frontier`.

Against the same 16-endpoint live snapshot:

- current `tool-action` probe: blocked;
- the same probe with only its tier lowered to `strong`: routes through
  `codex/gpt-5.3-codex`;
- the existing `creative` probe with `requiresToolUse: true`: routes through
  `codex/gpt-5.3-codex`.

WWMD compared reusing `creative` plus tool use, lowering the global
`tool-action` floor, adding a Marketing-only task type, and raising Marketing's
entire model floor. It selected the existing `creative` contract with high
confidence (composite `10.243`, margin `4.142`, no commandment conflict).

## Substrate

- Declaration source: `packages/db/src/coworker-service-catalog-seed.ts`
- Declaration invariant tests:
  `packages/db/src/coworker-service-catalog-seed.test.ts`
- Runtime projection:
  `apps/web/lib/coworker-service-catalog/route-readiness.ts`
- Existing task contracts: `apps/web/lib/routing/task-requirements.ts`

No model, enum, task type, route, or UI primitive is added. The existing
`creative` task class supplies the quality floor; the probe's existing
`requiresToolUse: true` and Marketing's existing minimum capability continue to
enforce tool support.

An independent exact-SHA review found one fleet-state compatibility gap in the
first candidate: historical `TaskRequirement` rows replace the built-in
contract, but the current table cannot persist `minimumTier`. Installs carrying
the old `creative` seed could therefore lose the built-in `strong` floor. The
loader now overlays representable persisted fields onto the built-in contract,
so operator configuration still wins while built-in-only fields remain
load-bearing. Unknown DB-only task types remain unchanged.

## Delivery

1. Add a failing seed invariant asserting the campaign service declares
   `taskType: "creative"` while retaining `requiresToolUse: true` and the
   governed restaurant campaign prompt.
2. Run the focused test and capture the expected red against the current
   `tool-action` declaration.
3. Add a failing compatibility test proving a persisted `creative` row that
   cannot store `minimumTier` retains the built-in `strong` floor.
4. Change the campaign service readiness probe to `creative` and merge
   persisted task fields over built-in-only contract fields.
5. Prove the upsert update payload carries the corrected probe and route
   readiness rejects an adequate endpoint, rejects a strong endpoint without
   tools, and accepts the intended strong tool-capable endpoint.
6. Run the seed tests, route-readiness tests, typecheck, and the exact merged-code
   local integration gate.
7. Merge through a ready PR, advance through governed self-upgrade, then verify
   on desktop and mobile that Marketing is Available, Ask Marketing is present,
   a harmless campaign-planning request returns from Marketing, and Customer
   Advisor remains unavailable.

## Backlog Coverage

- Receipt: `cmsaf1hns0doe01qqj34vgg4c`
- Decision: atomic
- Parent: `BI-C1943813`
- Deliverable: `marketing-readiness-task-class` (not independently shippable)
- Dependencies: none
- Rationale: the declaration correction, seed invariant, and governed live
  acceptance together repair one behavior; none is complete or useful alone.

## Risk And Rollback

The source blast radius is one seeded service declaration plus the canonical
task-requirement compatibility loader. Persisted fields still override their
built-in counterparts; only fields absent from the persistence contract are
filled from the matching built-in definition. The seed upsert converges
system-owned metadata on install startup; it does not alter operator
configuration or add a migration. A false green would make Marketing visible
when its tools cannot route, so exact route tests and live Ask Marketing are
mandatory. Rollback is a one-PR revert restoring the prior probe and loader
behavior; no data rollback is required.

## Documentation Impact

No operator guide changes are required because the intended UI and help text
already say Marketing is available for the restaurant archetype. This repair
aligns runtime evidence with that published contract. This plan records the
diagnosis, design choice, and acceptance evidence for contributors.
