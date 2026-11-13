---
status: active
---

# Audited approval consumption repair

Backlog: BI-6BA00C83. Workroom: WC-8903C5DA. Design: [audited approval consumption](../specs/2026-10-16-audited-approval-consumption-design.md).

For agentic workers: execute one independently reviewable backlog item at a time. Use dpf-tdd, dpf-local-merge-ci-before-push and dpf-pr-with-dco. No implementation success is claimed before actual checks and served verification.

## Delivery boundary

One atomic repair extends the existing envelope consumer contract. A producer-only identity rewrite would falsify the actual approver; an execution-only fix would still fail at consumption; a consumption-only change cannot create a valid record. Tests, capture and consumption therefore ship together as BI-6BA00C83. The owner authorized DEV workflow repairs through delivery. This is sequencing within that repair, not separate capabilities or a new policy initiative.

## Ordered work

1. Preserve the live approved-but-failed request and named-base reproduction. Publish this bounded design and plan; record research and immutable plan coverage. Confirm normal implementation admission before behavior edits.
2. Resolve test impact before Red. Native impact advice links the exemption test; the shared helper has no graph-linked tests, so add its direct tests and include on-behalf producer, expiry/concurrency and break-fix consumer suites.
3. Observe failing regressions for valid on-behalf execution and exception consumption. Cover exact owner/agent/tool/input binding, actual decision maker, reason, time, reservation, expiry, revocation and insufficient action authority. Keep direct-owner and existing owner-only break-fix compatibility tests.
4. Refactor the existing approval helper into one strict persisted-envelope interpretation with separate execution/consumption state requirements. Explicit action-consumer opt-in supplies the required capability. Preserve actual approver and delegated owner separately. Reuse canonical current-user and permission functions.
   The independent source review of de9129 found a missing legacy-persona case. Extract the canonical reserved identity from automation-sign-in into a pure leaf, preserve its exports, and share the exact predicate with upgrade requester classification. Include those two existing suites and real-verifier direct/on-behalf execution/consumption negatives with every fixture column null. This correction stays in the same approval boundary; it adds no identity store or grant.
5. Make exception capture and consumption use that interpretation. Retain all existing DEV/evolve-dpf, exact-source, evidence, expiry and failed-review requirements. Do not replay the failed original request or create an exception during source verification.
6. Run affected tests, both web TypeScript programs, style/module/boundary and documentation checks. Regenerate the documentation index through a normal claim only if required. Run one governed local integration gate, independent source review and the protected publication path, keeping native review uncertainty explicit.
7. Have the existing canonical release coordinator deliver the merged source. Verify a fresh supported request's approval, actual decider, execution and consumption on the exact served target. Close through the governed evidence transition only when its actual conditions are met.

## Coverage references

- Requirement: `AC-ONBEHALF`, plus AC-OWNER, AC-CAPABILITY, AC-BINDING, AC-CONSUMERS, AC-ASSURANCE and AC-LIVE in the design.
- Contract: `AC-OVERRIDE` in the existing approval convergence design; actual action authority remains required.
- Flow: `approved-reserved-executed-consumed` through the existing envelope and exception records.
- Verification: `persisted-approval-and-exception-regressions`, affected producer/consumer suites, both web types, governed integration and served happy path.

## Backlog coverage

Single deliverable: persisted approval interpretation and exception capture/consumption, mapped to BI-6BA00C83. Decision: atomic. Dependencies are the existing canonical approval contract and current source; no new independently shippable child.

Initial pre-implementation coverage: `cmvah4gdk0lk201obzzsaniv5`, binding published plan commit `0a6c6333b9d806cd377fc2abcd3f8275850313cb`, blob `c07bfad3c6d3c21be3c4515662bbd764149bf0fd`; the native resumability check returned valid. Research: `initiative-f51a312a-f343-4f1d-ab24-7708a3fa3074`. Implementation admission: `IRD-23445B38AB6F`. This annotation records that original receipt without claiming it binds future source revisions; refresh current immutable coverage when the normal server contract requires it.

## Risks and rollback

Authorization interpretation is sensitive. Prevent an admin-only capability from standing in for actual action authority; preserve the owner-only default for other consumers. Reject stale or unverifiable approvals at use time. Preserve legacy direct-owner records only when their exact durable approval remains valid. Roll back through a protected source revert; never repair history by mutating failed envelopes or evidence. Deployment, native review, and live acceptance remain unrun until their actual results exist.
