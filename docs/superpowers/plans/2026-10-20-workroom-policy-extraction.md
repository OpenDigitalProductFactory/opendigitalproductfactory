---
status: active
---

# WP-01: portable Workroom policies

BI-D30CD423 · Workroom WC-67DEE1B6 · base 4fa796b64425b6129f172a01b89d8c8887c065fc.

## Authority and task brief

Implement the working WP-01 subset under the explicitly recorded human local-only
refactor exception. The existing Workroom carries a design claim; native spec,
architecture, plan approval, immutable coverage and implementation admission are
unrun, not passed. After independent source review and local verification, the
parent authorized a DCO-signed local commit for integration. Publication,
runtime/credential/grant changes, DPF2 writes and production business mutations
remain outside this work.

Objective: extract existing pure trigger, proactivity, posture, stricter HITL join,
deadline/hold and author-funded conjunction; migrate actual scheduler, attention
and drive consumers. Keep one Workroom marking engine and the existing budget,
authority, operating-hours, scheduling and persistence owners.

## Acceptance criteria

- Extract working policy/resolution subsets using trusted time, authenticated facts and existing budget/commitment owners.
- Keep scheduling and recommendations unable to widen current authority and preserve separate accountable roles.
- Migrate actual scheduler/attention/funding callers through one Workroom lifecycle and remove displaced policy copies.
- Prove recurring wake, duplicate/cancel, missing-budget, stale authority and capacity-hold behavior with synthetic fixtures.

## Design grounding and boundary

Reuse the umbrella extraction map/sequence dated 2026-10-18, the existing
2026-08-22 workroom-work-posture design, the 2026-09-24 portfolio budget/WIP
design, GPP and the already extracted WK/GP/SJ contracts. Source inspection
confirmed real callers in scheduled-work-posture.server, agent-task-scheduler,
scheduled-task attention, graph planning and deadline/hold notification.

Move the pure implementations into packages/validators/src/workroom-policy.
Internal imports use relative .js paths. Shared exact policy types have one
leaf at packages/validators/src/policy-types.ts; clock contracts have one leaf
at workroom-policy/clock-types.ts. Application owners reexport those same types.
No portable import may reach apps/web, Prisma, server-only, credentials or a
registry-bearing app barrel. Deadline bookkeeping references the existing
Workroom marking contract; it never advances tokens.

Keep the preauthorization record reader/writer, current operator check,
portfolio attribution, delivered/in-flight investment arithmetic and budget
records in DPF. Extract only their already-resolved conjunction; the DPF author
adapter retains delivery-shape/xlarge/coworker policy. Its candidate role binding
is not a grant or independent admission.

Keep incumbent fallbacks visible: absent posture context uses the inherited
plan; malformed trigger metadata does not abort a scheduled job; capacity
dispatch floors at one slot; delegated executionAllowed is advisory metadata.
These are not portable qualification, stale-authority holds or a reservation.
Deadline sends remain at least once; no exactly-once/full-estate claim.

## Impact and coordination

Exact edit paths were claimed in WC-67DEE1B6 on 2026-10-20. Three overlaps were
refused for root coordination: instrumentation.ts, actions/agent-coworker.ts,
and validators/package.json. The first two remain untouched. After the manifest
owner released its claim, a normal claim permitted copying the coordinated
frozen OP/WP/HX exports; that manifest claim was then released. No force claim
is used.
The planned scope gate context returned no unresolved paths; 101 source paths
were queried through find_related_tests, all available, yielding 156 unique
related tests plus colocated tests. The scope response itself exceeded its
context budget, so its unread fields cannot supply an exemption. Verification
expands to the complete selected policy/consumer corpus and both web TS programs.
Guard obligations: design grounding, existing module caps, prose/style checks;
UI import-only changes add no controls or rendered behavior.

## Sequence

1. Provision managed dependencies and observe compile-ready. Preserve existing
   behavior with the scoped source characterization corpus before moving code.
2. Move pure policies unchanged, separate type leaves, migrate direct callers
   and tests, remove displaced implementations. Temporary exports are allowed
   only for coordinated blocked callers with named owner, BI and removal rule.
3. Extract the narrow resolved-authority/funding conjunction and retain DPF
   domain/funding adapters. Add characterization for each refusal and equality
   boundary; add no new financial ledger or permission owner.
4. Add an isolated Node24.16.0/TypeScript6.0.3 synthetic consumer with explicit
   source hashes, notices, no aliases or producer dependency links. Supplied
   trusted host facts separately cover recurring/duplicate/cancelled wakes,
   authority revocation, missing/stale budget, unavailable capacity, changed
   run/iteration, lost notification acknowledgment and uncertain effects.
   Qualification holds belong to the synthetic host, not an invented production
   enforcement service. Missing authority or funding never becomes a favorable
   synthetic default; timers/attention never complete work.
5. Run affected tests, validators and both web TypeScript programs; inspect
   import/source closure and moved-source parity. Reuse unchanged valid evidence.
   Record failed/skipped/unrun checks accurately. Native/runtime/browser gates
   remain unrun under the exception. Obtain independent source review and fix
   actionable findings before the parent receives a locally reviewable diff.

## Verification and rollback

CT-WP exercises canonical policies and the host boundary with injected time and
synthetic references. Existing scheduler claim/cancellation, funding,
preauthorization, posture, HITL, deadline/hold and attention suites remain adapter
characterization. Postgres-only stall/reservation qualification requires its
governed environment and cannot be claimed from local doubles.

Revert moved policies and their import migration together. Preserve all persisted
taskConfig, hold/deadline keys, notice acknowledgment semantics and prior WK/GP/SJ
contracts. No schema/data migration is introduced. Stop at locally ready review;
publication and production acceptance remain separate, unrun actions.

## Observed local verification

Managed bootstrap reported compile-ready. Before the move, 28 selected suites
passed 330 tests. After migration, the exact 164-file web selection passed 163
suites and skipped one: 2070 tests passed, four skipped and five existing todos
remained. The new resolved-author/funding conjunction passed five package tests.
Validators and both web TypeScript programs passed using the repository's
TypeScript 7 check wrapper. Twelve moved module bodies matched the base after
import/comment normalization and the structural deadline type rename.

The isolated consumer passed ten groups, strict NodeNext ES2022/types[], Node
24.16.0 and TypeScript 6.0.3, with 29 reachable copied sources and no runtime
dependencies. Its output records source/fixture hashes. Exact commands and
the full selected test paths are recorded in
[verification.json](../../../examples/workroom-policies/verification.json).

Module-size, style, prose (including 26 guard tests), canonical record guard
and whitespace checks passed. Native governance/runtime acceptance remains
unrun. Doc-index generation is left to root coordination because another active
Workroom holds that artifact; no force claim or conflicting edit was made.

Independent review caught a mutable-alias defect in the synthetic host's returned
attempt. Eight regressions first failed against the old prepare/replay returns
(state, nested marking, authority and funding for each). Returning deep snapshots
on both paths made all eight green without changing a production policy.
