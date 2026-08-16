---
title: Embedding coverage self-heals on a schedule, visibly — implementation plan
authoredAt: 2026-08-16
authoredBy: operator
epic: EP-DECISION-TIER-REBALANCE
---

# Embedding coverage self-heals on a schedule, visibly

## Backlog coverage

- Decision: single
- Parent: BI-ED117C82
- Dependencies: none — completes the third ask of BI-ED117C82; the first two shipped in #4341.
- Rationale: the shipped boot hook proved the repair works but cannot retry, and no operator-facing repair path is acceptable for this failure.
- Mappings:
  - scheduled-embedding-coverage -> BI-ED117C82

## Problem

`reconcilePublishedWikiEmbeddings` originally had **no caller at all**, despite a
source comment since BI-D4C1E05E claiming it was "the fleet self-heal wired into
portal boot". #4341 wired it into `instrumentation.ts` and made it honest — it
reports coverage as a number and names a provider outage instead of logging a
clean pass. Verified live: `[wiki-embeddings] Coverage 332/332`.

Two things are still wrong.

**A boot hook can only retry at restart** — and it attempts repair at the moment
least likely to succeed. Local inference is routinely deferred by local-CI
capacity reservations (observed four separate times on 2026-08-15/16) while other
startup work competes for the host. One attempt, then an unbounded wait.

**The repair was framed as something an operator does.** The earlier BI asked for
"an admin action or MCP tool". That assumes the operator knows their corpus is
partially embedded, knows that is why coworkers re-ask settled questions, and
knows a button exists. None of that holds for a non-technical owner running a
business on this platform — the symptom they see is "the AI is asking me things
I already decided", which points nowhere near a vector store.

An unembedded stance degrades stance relevance to lexical, and the BI-7E1F128A
fail-safe then escalates by design. Verified live: DI-6C07E9BAEA59 escalated at
confidence 0.80 purely because relevance had fallen back to lexical.

## Approach

**Retry on a schedule.** `embeddingCoverageReconcileScheduled` runs every 2h at
:40 through the existing Inngest cron substrate, behind the same quiescence gate
every other scheduled job uses, serialized with itself. A gap closes within a
working session with no restart, no script, and no button. The run is cheap when
there is nothing to do — one page scan plus one vector scan, no model calls.
A `run-now` event twin exists for an agent or admin surface to trigger it, but
nothing depends on anyone using it.

**Report into a Workroom.** The Workroom is the collection point for
outcome-specific activity an AI coworker manages on the operator's behalf, which
is how cognitive load moves human → coworker → code. Each run upserts a durable
`Corpus health` Workroom and appends one `WorkroomActivity` carrying operator
language plus the numbers:

> "330 of 332 reference pages are searchable by your coworkers. 2 could not be
> processed because the local AI model was busy — nothing was lost and this
> retries automatically within a couple of hours. Until then your coworkers may
> ask about things you have already decided."

The text states the CONSEQUENCE, not the mechanism, because the operator cannot
otherwise connect a vector gap to what they actually experience.

**Keep the boot hook.** It is cheap and sometimes succeeds; it is now the
opportunistic first attempt rather than the mechanism.

## May NOT do

- Require a container restart, a maintainer script, or an admin button to repair.
- Let a visibility failure break the repair — the Workroom write is wrapped and
  never throws.
- Bound the scan; a limit would silently decide which pages stay unretrievable.
- Report a clean pass during a provider outage (`providerUnavailable` already
  distinguishes "could not" from "nothing to do").

## Verification

- 574 tests green across `lib/wiki`, `lib/operate/scheduled-jobs` and the
  queue-registry parity suite, including the catalog↔registry parity guard and
  the scheduling-map same-tick contention check.
- Operator-language assertions are explicit: the outage summary must NOT contain
  restart/script/button/admin wording.
- Live check after deploy: confirm a `Corpus health` Workroom exists carrying an
  `embedding-coverage` activity, and that a run during a local-CI capacity lease
  records `providerUnavailable: true` rather than a clean pass.
