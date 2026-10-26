---
status: active
---

# Bounded deliverable outcomes implementation

Backlog: BI-A798975C. Workroom: WC-5D6B124A.
Design: docs/superpowers/specs/2026-10-25-bounded-deliverable-outcomes-design.md.

## Fixed delivery boundary

Deliver the agreement/context/handoff contract in one coherent PR. Internal
phases below are not independent products; capture without enforced preservation
or a truthful reader would not satisfy the owner's outcome. The owner explicitly
requests the minimum PR set because local verification is a bottleneck.
Do not implement approval policy or broaden this item into all neighboring
platform programs. Existing recommendations remain linked to their canonical BIs.

## Verbatim acceptance criteria

- AC-1: A finite Workroom captures an immutable delivery agreement with the objective and acceptance/source identity used at start; later objective text and additional findings cannot silently replace it.
- AC-2: DEV deliverable context records whether its declared paired installation was checked, the source/version/time and applicability of guidance, or a named unavailable/denied condition; foreign guidance never becomes local authority automatically.
- AC-3: The existing Workroom view shows agreed outcome, current completion disposition, blockers/owner and follow-on references using accessible progressive disclosure and shared status/report primitives.
- AC-4: Completion evaluates the agreed delivery and emits a durable handoff through existing evidence/terminal paths; unresolved in-scope requirements remain blocked, while separately owned follow-on work does not reopen a delivered room.
- AC-5: Retry/replay, changed objectives, changed or unavailable peer guidance, completed delivery with follow-on work and genuine missing outcome evidence are covered by focused tests; canonical served verification remains distinct from source tests.
- AC-6: Refactoring consolidates agreement parsing, completion/handoff projection and shared source identity instead of adding a second work ledger, approval engine or periodic scan.

## Grounding and traceability

Requirements: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6.
Contract references: C-BOUND-AGREEMENT, C-BOUND-CONTEXT, C-BOUND-FINISH.
Flow reference: F-BOUND.
Verification reference: V-BOUND.
These references resolve to the companion design; they grant no authority.

## Internal implementation sequence

1. Claim exact edit paths and consume changeImpactContract. Test first with
   dpf-tdd. Add a pure typed agreement/context/handoff parser and projection;
   prove original identity survives repeated claims and later objective changes.
2. Integrate initial capture with existing Workroom creation/claim; boundary
   edits retain the original snapshot. Resolve paired context through current installation/link evidence,
   with unavailable guidance distinct from a successful read. Record no secrets.
   Preserve standing rooms, historical records and optimistic concurrency.
3. Feed the shared projection to MCP and room detail; add one concise disclosure
   beside the existing outcome/boundary. Keep original evidence/finish state and
   separately linked follow-on work visible without another status engine.
4. Retain the existing governed terminal checks; append a bounded handoff only
   after successful completion. Test failed/inconclusive completion and replay.
5. Run affected suites/typecheck, proportional repository guards and exact-tree
   canonical integration once. Obtain independent exact-change review under its
   actual policy mode. Open a DCO-signed ready PR, use the merge queue, verify
   deployed identity and served finite-work happy path. Record delivery separately
   from pending operational acceptance and end the authoring session.

## Overlap and related recommendations

BI-1581BE10: TaskRun writer convergence (separate existing scope).
BI-34999E95 / BI-B93E9C6E / BI-69803ACC: trustworthy measurement and outcome scorecard.
BI-A472354E: execution-profile cohort evaluation.
BI-1B7BB954 / BI-6DB95601: evaluator integrity and qualification interlock.
BI-73780C2E: approval/correction loop, owned by Rationalize approval list.
No item is marked delivered merely by its inclusion here.

## Risks and rollback

A permissive parser could erase an initial agreement or mislabel missing source
checks. Keep malformed/legacy states explicit and forbid replacement. A closeout
projection must not override canonical readiness or confuse delivery with business
acceptance. Preserve audit records; revert this PR without destructive migration.

## Backlog coverage

Atomic delivery maps to BI-A798975C. Obtain the native receipt against this exact
committed plan before implementation; retain the immutable locator and genuine
receipt in WC-5D6B124A. An embedded self-referential receipt is not fabricated.
