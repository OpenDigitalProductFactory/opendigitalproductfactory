---
title: "Duplicate advisory at filing time"
status: active
backlog: BI-3722E9A1
date: 2026-09-12
---

# Duplicate advisory at filing time

> **BI-3722E9A1.** Sibling of [implementation scan at filing](2026-08-05-implementation-scan-at-filing.md),
> which established the advisory-on-the-created-message shape this
> reuses, and hooks the same shared ingest front door
> ([work-intake unification](../specs/2026-06-06-work-intake-unification-design.md), EP-INTAKE-UNIFY).

## The gap

The implementation-scan plan states that "the platform detects that a new BI
duplicates **another BI** (`apps/web/lib/demand/dedup.ts`, trigram Dice over
backlog text)". That was the reasonable reading, and it is not what happens.
`findDuplicateCandidates` is reachable only through the opt-in
`find_duplicate_candidates` MCP tool, which a filer must know to call. Nothing
runs it at filing. `create_backlog_item` instead carries the check in its own
description: *"Before creating: list_backlog_items or search_knowledge for an
existing BI on the same defect."*

That is the platform asking an agent to remember, which this install has now
paid twice to remove:

- **BI-D35B85BF**, the queued-claim resumer: *"durable-task in practice meant an
  AI session may or may not remember to re-run me — 13 of 41 did."*
- **BI-9C384562**, exact-bound authority: the projector required a human
  ratification that no surface offered, so every routine receipt fell to a
  per-action approval card.

**Live case, 2026-09-12.** Session 156da776 spent roughly an hour diagnosing
spurious `host-cpu-high` local-CI pool closures (observed at ~24% real CPU with
26 GB free) and filed BI-91B1C23D carrying that diagnosis. PR #5334
(BI-48F42581) had already measured the same defect with stronger evidence: the
probe used load average as a utilization percentage, reading 24.2% while the VM
was 55.2% busy. One subsystem took six items in a day from at least two
sessions, including one full duplicate diagnosis.

## Why two signals, not one

The obvious build is to run the existing lexical scorer at filing. It would not
have caught the case above, and the fixture in
`backlog-ingest-duplicate-advisory.test.ts` asserts that miss on purpose.

The two items are the same subsystem and share almost no vocabulary. One is
written about memory fencing a running gate; the other about load average not
being CPU. A title-dominant Dice score cannot see the relation. Lowering the
threshold until it did would fire constantly across a 1,300-item open backlog
and train filers to skip the line — the exact failure the advisory exists to
avoid, and worse than no advisory at all.

So the scan runs both:

| Signal | Catches | Misses |
|---|---|---|
| Lexical (`findDuplicateCandidates`, threshold 0.6) | a reworded restatement of the same item | the same subsystem described in different words |
| Semantic (`searchPlatformKnowledge`, `entityType: "backlog"`) | shared meaning across different vocabulary | nothing when embeddings are unavailable |

Neither subsumes the other, so the advisory names which signal spoke, and
agreement between them is reported as `both`.

The semantic index is not new substrate: this same front door already writes
every filed item into it via `storePlatformKnowledge`. The corpus existed and
went unread at the one moment it was most useful.

## What it is not

**Not blocking.** A similarity score cannot tell the same defect from an
adjacent one, and that judgment belongs to the filer. Filing never fails because
something looked similar, and any error reading the candidate pool swallows to
an empty advisory.

**Not a verdict.** The wording is a prompt to read, matching the contract the
implementation-scan advisory settled. Asserting a duplicate trains people to
ignore the line.

**Not silent when degraded.** `searchPlatformKnowledge` reports `unavailable`
with a reason when embeddings are deferred or failed, and that reason reaches
the filer. AGENTS.md §4 states this for gates: a check that could not run is not
a clean result. An advisory that silently degrades teaches the same wrong lesson,
and embedding failures are observed regularly on this host under concurrent gate
load.

## Shape

1. `dedup.ts` gains `FILING_DUPLICATE_THRESHOLD` (0.6, matching
   `findDuplicatePairs` rather than the looser 0.5 of the deliberate sweep,
   because this runs on every filing), `FILING_DUPLICATE_LIMIT` (3), and
   `renderFilingDuplicateAdvisory`.
2. `backlog-ingest.ts` computes both signals after the item is created, merges
   them by item id, records an `intake_origin` activity row so the advice
   outlives the tool response, and returns `duplicateCandidates` plus
   `duplicateSemanticUnavailable`.
3. `backlog-pack.ts` appends the advisory to the created message, beside the
   implementation-scan advisory.

Both the candidate pool read and the semantic search are injectable, so tests
need neither Prisma nor Qdrant, and an install without embeddings files normally
with a lexical-only advisory that says so.

## Verification

`backlog-ingest-duplicate-advisory.test.ts` covers the wording contract, the
degraded path, a genuinely distinct pair, the reworded pair the lexical signal
must catch, and the real 2026-09-12 pair it cannot. The last is the honest one:
it asserts the lexical miss and records why closing it needed a second signal
rather than a threshold tweak.

Not proven by test: that the semantic signal retrieves BI-48F42581 for
BI-91B1C23D on the live corpus. That needs the live index and is the acceptance
step on the install.
