# Improvement signal intake

The shared writer is `apps/web/lib/improvement-flywheel/signals.ts`. It keeps
one signal per `(sourceType, sourceId)` using the existing unique constraint,
preserves the original evidence and returns an existing backlog link.

## Source identity and recurrence

For `platform_issue_report`, the source ID identifies one persisted report.
Re-delivering its reflection refreshes `lastSeenAt` without increasing
`recurrenceCount` or filing backlog work. Historical counts are preserved for
audit, but are not treated as independent observations. A different report ID
remains a different signal. This rule uses the exact existing source vocabulary;
it does not infer immutable identity from arbitrary caller names or timestamps.

Other sources retain their existing persistence contract. In particular, the
daily Workroom flow review and skill curator still increment a persistent
signal and file it through `ingestBacklogItem` at the existing threshold of
three. The signal's stable origin binds the backlog intake and backlink. A
failed intake leaves the signal available for later projection. Critical
MCP/A2A findings keep their direct source-specific intake paths.

A repeated tool failure is the exception to "the signal's origin binds the
intake" (BI-891E4E11). The work-pattern observer keys that signal per agent and
route, but the defect belongs to the tool. When the signal's evidence carries
`signal: "tool-failure"` and a `toolName`, the backlog origin is
`tool-defect:<toolName>` (`apps/web/lib/operate/tool-defect-origin.ts`). The
capability-need path uses the same origin. Every coworker's observation then
becomes an occurrence of one item instead of a new item.

Items filed before a shared origin existed can be folded late with
`merge_backlog_items`. The tool is declared `irreversible`, but a call needs no
person when both items are this installation's own, carry the same
`[origin:…]` marker, and the duplicate is open with no claim or live Workroom
(`apps/web/lib/demand/duplicate-merge-consequence.ts`, BI-EAFD2D09). That is the
same fold intake performs. Every merge writes a `duplicate_merge` activity on
the retired item with both rows' prior state, so it can be undone from the
record. Any other merge still reaches a person.

Those observer counts still describe repeated calls, not independently
identified observations. Retry-safe observation identity for those callers is
remaining work under BI-64E86574. It must preserve legitimate automatic filing
before replacing the existing behavior. No date bucket, call count or aggregate
is promoted here into proof of independence or improvement benefit.

## Concurrent delivery and failure

The writer uses the compound source-key upsert. If an adapter reports a unique
insert collision (`P2002`), it makes one update against that exact source key.
It does not retry indefinitely or claim success if that row is absent. Other
database failures propagate. Source-local mock tests verify these branches;
they do not establish actual database isolation or native-upsert execution.

Filing is one critical section per signal (BI-13C8F888). Touches that cross
the threshold together each read an empty backlink from their upsert, so the
writer takes a transaction-scoped advisory lock on the signal id, re-reads the
backlink, and files only when it is still empty. The others return the link
the first one wrote. A failed filing leaves the link empty for a later touch.

A caller whose source id names one observation passes `immutable: true`
(BI-3EC4722F). Like `platform_issue_report`, a repeat delivery then only
touches the signal: it never recurs and is never filed. The daily flow review
uses this to record each work shape's review once, under the shape version
and review day. It files a sustained bottleneck itself, through the shared
intake, with a routing answer on the intake activity.

## Remaining learning qualification

This bounded repair is part of BI-64E86574 and the approved
[cross-Workroom delivery plan](../superpowers/plans/2026-09-12-cross-workroom-learning-delivery-plan.md).
It does not implement cross-room occurrence aggregation, held-out assessment
or native activation. BI-1B7BB954 owns the existing evaluator work and
BI-6DB95601 the activation work. Those paths require their own qualification;
neither is a replacement already delivered by this writer.

Shared identity handling and collision recovery are the refactoring contribution.
No new table, ledger, scheduler, grant or runtime configuration is introduced.
