# Approval Inbox progress — BI-372D6E2E

One atomic small bug repair; Workroom WC-B03C3E1C, branch codex/approval-inbox-progress.
No new schema, route, tool, grant, dependency or funding decision.

## Design grounding

Extend docs/superpowers/specs/2026-06-23-human-attention-surface-design.md §4.1.
The envelope loader takes 25 and the owner projection counts rendered entries as
the whole queue. Existing exact approval-result readback stays canonical.

**OBJ-1:** Make bounded approval enumeration honest and traversable.

| Acceptance | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | More than 25 pending approvals expose a scoped total and bounded older-request navigation. |
| AC-2 | OBJ-1 | A completed decision leaves the pending page, retains exact result readback and decreases the pending total. |
| AC-3 | OBJ-1 | The daily count describes displayed items and separates approval totals from other notices. |
| AC-4 | OBJ-1 | Traversal preserves owner isolation, equal-timestamp ordering and progress after decided rows disappear. |
| AC-5 | OBJ-1 | Failed queue reads are disclosed rather than described as zero pending requests. |

## Plan (one deliverable, internal sequencing)

1. Add regression tests with 30 requests, a successful decision, equal timestamps,
   foreign owners, malformed cursors and failures. Observe Red before Green.
2. Extend the existing envelope source with a stable createdAt/id cursor, a
   26-row lookahead, 25 rendered rows and an owner-scoped pending count. Preserve
   the array-returning wrapper for existing consumers and exact links.
3. Inbox uses this page result alongside the existing aggregate, excluding its
   default envelope loader only for this caller. Show total/shown and older/latest
   links. Keep approval and decline endpoints unchanged.
4. Describe the daily number as displayed items. Test the composed page and update
   the existing attention design and user guide.
5. Run affected unit tests, web typecheck, gate context, required shared integration,
   UX-fit and semantic verification before ready PR publication. Verify the served
   target after canonical deployment; structural checks alone do not close it.

## Traceability

requirement: BI-372D6E2E acceptance.
contract: apps/web/lib/attention/sources/coworker-envelope.ts owner/expiry boundary.
flow: request → exact decision result → refreshed bounded pending queue.
verification: 30-request traversal regression and served Inbox result readback.

## Risk and rollback

Concurrent decisions can change totals between reads; every navigation reads live
status and owner again. Cursor values confer no authority. Preserve expired weekly
items, failed-source warnings and bounded work. One revert; no data migration.

## Backlog coverage

Atomic deliverable maps to BI-372D6E2E. Coverage receipt
cmveixse63k2w01o79qqnum7a binds the immutable plan at
8957cca3ca21f2c4ded222ddf02a6371db35baac, blob
f9870f0cd6f2e3ed65e86557ab8444af573d45b5.

## Verification record

The three queue regression cases failed before implementation, then passed.
The broader source run passed 432 tests with 3 skipped in 43 files; web
TypeScript passed. These are source checkpoints, not runtime acceptance.
Prototype interactions exercised 30 → 29 pending while 25 remained displayed,
five older requests and unavailable recovery. They use local fixture data,
not the real approval runner. Advisory critique CE-7139E0BB is requested;
completion is not claimed. The UX option decision is DI-50AE2EDE873D.
Shared integration and served acceptance remain due.
