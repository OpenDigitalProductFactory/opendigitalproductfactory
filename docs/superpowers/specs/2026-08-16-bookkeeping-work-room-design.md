---
title: "Bookkeeping Work Room — recurring, triggered, multi-coworker books maintenance"
date: 2026-08-16
bi: BI-1585FA9E
epic: EP-EMAIL-COMMS
status: draft
---

# Bookkeeping Work Room (BI-1585FA9E)

## Kernel routing (recorded, honored here)

`principle_decide` DI-56B045130A22 (this batch) returned **pipeline-and-decompose** over promote-whole (composite 9.54 vs 1.70, margin 7.84, high confidence, no commandment conflict). This BI is cross-cutting substrate spanning four epics; the founder suitability boundary routes it to a **direct expert build, decomposed into slices** — not a whole-BI Build Studio promotion. This spec executes next-action (c): the decomposition. It does **not** attempt a monolithic build, and it records the two standing blockers on the *full functional* outcome so no reader mistakes machinery for reconciled books.

## Standing blockers on the full outcome (not resolvable by building)

1. **Owner data.** The BI's own worked example ends: *importing real transactions needs the operator's card-statement CSV export; no fictitious data on the live instance.* The machinery is buildable; a reconciled period is owner-gated.
2. **Build-Studio route (only for BS-routed slices).** BI-04E4F111 — the Plan phase has no eligible routing endpoint — must land before any slice is routed to Build Studio. The substrate slices below go via **direct expert build** and do not depend on it.

## Substrate audit (grounded 2026-08-16)

| Capability | State on `main` | Implication |
| --- | --- | --- |
| Banking loop | `apps/web/lib/actions/banking.ts` has `createBankAccount`, `importTransactions`, `matchTransaction`/`unmatchTransaction`, `suggestMatches`, `createBankRule`/`listBankRules`, `getReconciliationSummary` — **as UI server actions only** | **No banking MCP tools and no banking grant key exist.** A coworker cannot drive the books loop through governed tools today. This is the load-bearing gap. |
| Enrichment pattern | `enrichment_write` grant + BI-B2497DFB (merged #4282): offer → permission → act → provenance | Reuse verbatim for vendor→supplier resolution; no rebuild. |
| Grant vocabulary | closed set includes `enrichment_write`, `crm_read/write`, `document_read/write`, `financial_report_create`, `work_room_read/write`, `registry_read`, `backlog_read` — **no `banking_*`** | The finance-loop slice must add a banking grant key to the closed vocabulary. |
| Finance coworkers | `finance-controller` (oversight; grants `registry_read/backlog_read/portfolio_read` only) and `finance-agent` exist; **no bookkeeper** | A bookkeeper (transaction-level import/categorize/reconcile) is a genuinely distinct operational role, not the controller missing a grant. |
| Work Rooms | EP-WORKROOM-COMMS: agents join/post/read, outcome-scoped membership, finite/standing rooms, value-stream+lifecycle structure (#4302) | Compose for room orchestration + lifecycle. |
| Lifecycle grammar | BI-E55991E9 (merged #4289); the stance-consistency guard (BI-EAD441E0 #4379) now governs its structure | The room lifecycle is expressed as a declared grammar; adding a `bookkeeping-room` grammar is governed by the guard shipped this batch. |
| Email seam | BI-4F7BB48B (Mailroom inbound email) | Compose for receipt/statement arrival triggers. |
| Scheduling | recurring/scheduled-task substrate | Compose for the weekly cadence trigger. |

## Decomposition — four slices (the kernel's named cut)

| Slice | Deliverable | Executor | Depends on | Ships alone? |
| --- | --- | --- | --- | --- |
| **S-FIN — finance loop (FOUNDATION)** | Wrap the existing banking server actions as governed MCP tools (`import_bank_statement`, `apply_bank_rules`, `reconcile_bank_account`, `create_bank_account`, `get_reconciliation_summary`…); add a `banking_write` (+ `banking_read`) grant key to the closed vocabulary and `TOOL_TO_GRANTS`; consequential writes (import, account create) route the governance gate (EP-1C37C089). Provenance-carrying; no fabrication (amounts from statements, gaps surfaced). | direct expert build | existing banking actions only | **Yes** — a governed books loop any coworker/UI can call |
| **S-BK — Bookkeeper coworker** | Establish the `bookkeeper` coworker via the factory door (`dpf-establish-coworker`): roster + `HARDCODED_COWORKER_GRANTS` (`banking_read/write` from S-FIN, `enrichment_write`, `crm_read/write`, `document_read`, `work_room_read/write`, `registry_read`), persona bound to an existing finance route, model floor (confidential → strong), a `finance`/bookkeeper profession corpus page, certification via the nightly sweep. | direct expert build | S-FIN (for its headline grants) | Yes (holds today's grants; gains the loop when S-FIN lands) |
| **S-ROOM — room orchestration + lifecycle** | A `bookkeeping-room` lifecycle grammar (open → gather → import+categorize → reconcile → owner-review → closed) + outcome-scoped membership (Bookkeeper leads; convenes CRM/enrichment + a governance/approval participant); Outcome Packet (period reconciled + owner summary + open decisions). | direct expert build | S-BK, lifecycle grammar | Yes |
| **S-TRIG — trigger wiring** | Weekly-cadence scheduled trigger AND on-arrival (statement/receipt via the email seam) that opens/advances the room. | direct expert build (or Build Studio once BI-04E4F111 lands) | S-ROOM, scheduling, email seam | Yes |

**Sequence:** S-FIN → S-BK → S-ROOM → S-TRIG. S-FIN is the foundation — everything else composes the governed books loop it exposes.

## Acceptance mapping (BI-1585FA9E)

- Recurring room opens on schedule + on arrival → **S-TRIG** + **S-ROOM**
- Admits Bookkeeper + convenes others (outcome-scoped) → **S-BK** + **S-ROOM**
- Coworkers read receipts/statements, set up/import accounts, categorize, reconcile via governed tools with provenance; consequential writes route governance → **S-FIN** (tools + gate) + **S-BK** (grants)
- Canonical stage+state lifecycle + Outcome Packet → **S-ROOM**
- No fabrication; gaps surfaced → **S-FIN** (provenance/no-guess contract)
- Recurs each cycle → **S-TRIG**

## Research & benchmarking

Bank-feed + rules + reconcile is the standard SMB-bookkeeping loop (QuickBooks bank rules, Xero bank reconciliation, Ledger-likes' import+categorize). DPF adopts the same import→rule→match→reconcile shape but keeps consequential writes behind the governance gate and every amount provenance-bound to a source document — the differentiator vs. auto-categorizers that silently guess. No new external dependency; the loop already exists as server actions and only needs governed exposure.

## Risks & rollback

- **S-FIN grant/tool cascade** (adding MCP tools + a grant key touches `TOOL_TO_GRANTS`, tool-tier, advise-safety classification, tests) — bounded, well-trodden; each tool is a thin wrapper over an existing, tested action.
- **S-BK CI friction** (conformance, grant-consistency, seed-fit, profession-corpus coverage, and the global UX Route Budget Sweep re-baseline that adding any coworker triggers) — expected; handled per `dpf-establish-coworker`.
- **Full functional verification is owner-gated** (real statement export) — the slices are verified on the machinery (governed tool call, rule match, reconcile summary) with fixture data; the live reconciled period waits on the owner.
