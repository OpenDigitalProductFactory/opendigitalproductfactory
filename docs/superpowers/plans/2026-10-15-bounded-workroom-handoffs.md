# Bounded Workroom handoffs implementation plan

Backlog: BI-5366EF78, successor to BI-B22C8E02. PR #6202 remains frozen.
Design: [same-mandate handoffs](../specs/2026-10-15-bounded-workroom-handoffs-design.md).

## Sequence and verification

1. Publish and independently review the successor design. Bind the plan's live
   coverage to this immutable scope before source implementation. Resolve the
   live tool-pack scope held by WC-1D447592 before editing that path.
2. Claim exact paths and refresh gate context. Add meaningful failing tests for
   AC-1 through AC-5: pending request leaves executor untouched, exact receiver
   acceptance, current delegation, no admission/grant/owner mutation, stale lease
   and boundary refusal, retry/concurrent acknowledgement and failure rollback.
3. Extend the existing command and activities with the explicit phase lifecycle.
   Extract the shared same-mandate snapshot/predicate for classification and the
   writer. Preserve the legacy controlled writer. This is internal sequencing of
   one atomic deliverable, not independently shippable work.
4. Project pending/completed/failed on the existing timeline and MCP readback.
   Test understandable states, including a failed request never looking complete.
5. Run affected Workroom/authority/receipt tests and both web TypeScript programs,
   relevant deterministic guards, doc-index generation and the exact-tree shared
   pregate. Obtain independent semantic review and protected PR checks, merge by
   queue, then advance only through request_self_upgrade.
6. Verify the served DEV flow with the feature SHA preflight and disposable
   authorized room participants. Record no fresh approval, pending-before-ack,
   exact receiver completion and a protected-boundary refusal. No production or
   paired-peer writes. Unrun checks remain unrun.

## Backlog coverage

Atomic deliverable `bounded-executor-handoff` maps to BI-5366EF78, with no
dependencies. Requirements AC-1, AC-2, AC-3, AC-4, AC-5; contract
`same-mandate-boundary`; flow `request-acknowledge-complete`; verification
`handoff-concurrency-regressions`. The phases cannot ship independently: removing
approval without receiver acceptance, concurrency checks and the shared writer
predicate would weaken the existing authority contract.

Coverage receipt is pending provider verification of the published plan. No
implementation coverage or passing independent review is claimed by this text.

## Impact, risk and rollback

Initial scope impact resolves doc-index generation and exact-source pregate;
module claims alone do not measure source test impact. Refresh exact-path claims
before Red and include every returned testImpact and guardObligation. Verification
is exhaustive when impact is unresolved. Managed dependency bootstrap reports
compile-ready with pnpm 10.33.2 and no ignored builds.

Main risks are classification/execution races, accidental admission or ownership
change, and duplicate transfer. Reuse the room lock and command receipts and
positively revalidate identity/policy inside the writer. Rollback restores legacy
authority; it does not remove historical activities or complete pending transfers.
