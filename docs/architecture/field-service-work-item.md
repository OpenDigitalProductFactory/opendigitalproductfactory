# Field-Service Work Item — Lifecycle Architecture

**Status:** as-built reference for the shipped F1 contract, plus the roadmap it grounds.
**Source of truth:** [`packages/validators/src/field-dispatch.ts`](../../packages/validators/src/field-dispatch.ts) (the contract) and spec [`2026-06-13-field-dispatch-capability-design.md`](../superpowers/specs/2026-06-13-field-dispatch-capability-design.md) (ADR-7/8/10). Prior framing: [`2026-05-19-field-service-trades-ai-dispatch-design.md`](../superpowers/specs/2026-05-19-field-service-trades-ai-dispatch-design.md) (§5 substrate audit, ADR-1).
**Tracked by:** BI-FS-002 (this contract), BI-FS-004 (the dispatcher coworker that reads it).

## ADR-1 — A field-service job is a `WorkItem`, not a new `Job` entity

The operational record for field-service work is a **`WorkItem`** row (`packages/db/prisma/schema.prisma`, the `WorkItem` model) with `sourceType = "field-service-job"`. `WorkItem` was already a polymorphic unit-of-work substrate carrying exactly the fields a job needs — `status` state, `urgency`, `effortClass`, `assignedToUserId` / `assignedToAgentId`, `calendarEventId`, `dueAt`, `evidence` Json, `parentItemId` hierarchy, a `WorkItemMessage` thread, and `routingDecision` Json.

Introducing a parallel `Job` model would duplicate that substrate, fragment routing, and split the dispatcher coworker's "what work is open?" view across two tables. So field service **extends `WorkItem`**; it does not create a new top-level model. Parent/child (`parentItemId`) models the "main visit + parts orders + follow-up" composition. Invoices are generated *from* a completed `WorkItem`, not the other way around.

## ADR-7 — The lifecycle is an application vocabulary, not a DB enum

`WorkItem.status` is a generic string column (DB default `"queued"`), shared by every `sourceType`. Field dispatch therefore owns its lifecycle vocabulary as a **typed application contract**, validated in `field-dispatch.ts` — not as a Prisma enum. The contract is pure (no Prisma, no React, no `Date.now`), so it is instant-testable and reusable by the dispatcher coworker (F2) and the dispatch board (F3).

### The status vocabulary

Canonical order (`FIELD_DISPATCH_JOB_STATUSES`):

```
quoted → scheduled → confirmed → en-route → on-site → complete → invoiced → paid
```

plus two off-lifecycle states:

- **`cancelled`** — a job that will not proceed.
- **`needs-review`** — the sentinel `parseFieldDispatchStatus` maps *any* unrecognized persisted status to (a freshly-created `WorkItem` defaulting to `"queued"`, a legacy row, or a typo), so the board always has a place to surface "this job has no valid dispatch state" and never silently drops a row.

### Derived predicates (the shipped lifecycle model)

The contract models progression through **order + predicates** rather than a formal from→to transition matrix:

| Helper | Meaning |
|---|---|
| `fieldDispatchStatusOrder(status)` | Canonical sort index; `needs-review` sorts first as an exception. |
| `isTerminalStatus(status)` | No further dispatch action expected — `paid` or `cancelled`. |
| `isWorkComplete(status)` | On-site work done — `complete` / `invoiced` / `paid`; the persistence layer stamps `WorkItem.completedAt` the first time a job enters this band. |
| `needsDispatcherAttention(status)` | Needs a dispatcher to progress — `needs-review`, `quoted`, or `scheduled` (unconfirmed). |
| `isFieldDispatchJobStatus(value)` / `parseFieldDispatchStatus(value)` | Type guard / total parse into the vocabulary. |

> **Note on legal transitions.** No formal `FIELD_SERVICE_LEGAL_TRANSITIONS` matrix ships here, and neither spec defines one — the F1 design deliberately expresses lifecycle constraints through order + terminal/attention predicates (ADR-7). Whether a formal guarded transition matrix is warranted (and its exact edges — cancellation sources, backward moves, `needs-review` off-ramp) is an open design decision, not an oversight. See BI-FS-002.

## ADR-10 — On-site capture is evidence metadata + references, never inline regulated content

Photos, sign-off forms, refrigerant logs, and parts consumed are written to `WorkItem.evidence` (a shared Json column) through the field-dispatch evidence schema:

- `fieldDispatchEvidenceEntrySchema` — an append-only entry with `kind` (`note` / `parts-used` / `photo` / `signoff` / `compliance` / `status-change`), a caller-supplied ISO `at` timestamp, optional `byUserId` / `byAgentId`, and — for a `status-change` entry — `fromStatus` / `toStatus` (the audit envelope of a lifecycle move).
- Regulated or heavy artifacts are **referenced by id only** — `mediaAssetId` → a `MediaAsset` row, `complianceArtifactRef` → a compliance artifact (F9 owns the content). Nothing regulated is stored inline. PHI-heavy verticals are not first-slice consumers.
- `parseFieldDispatchEvidence(raw)` never throws — because `evidence` is shared Json other domains may also write, a non-object / missing-`entries` / malformed entry degrades to dropping the bad data (`{ entries: [] }`), so callers treat the result uniformly. `collectPartsUsed(evidence)` flattens parts across entries.

## What is built vs. roadmap

**Built (F1, shipped):** the contract above — vocabulary, parse/guard, order + predicates, and the evidence schema — with unit coverage in `field-dispatch.test.ts`.

**Roadmap (grounded on this contract):**

- **Helper services** `listFieldServiceJobs` / `transitionFieldServiceJob` over `WorkItem` (Prisma). `transitionFieldServiceJob`'s guard semantics depend on the legal-transition decision noted above. (BI-FS-002 residual.)
- **Dispatcher coworker** — reads this vocabulary; seeded (`agentId=dispatcher`) and live, with the boot-guard / prompt-template / WWMD-escalation / portal panel outstanding. (BI-FS-004.)
- **Dispatch board** (F3), running-late cascade (F6), voice-first capture (F8), native job→invoice (F12), warranty-aware service (F14) — see the F-map in the 2026-06-13 spec.
