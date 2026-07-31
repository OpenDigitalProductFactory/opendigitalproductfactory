# Invoicing Overhaul — Implementation Plan

- **Epic:** EP-778F1CED
- **Date:** 2026-07-31
- **Binding decision ledger:** DI-763E5529F491 (profile `mark-dpf-platform`)
- **Origin:** Founder report — invoices cannot be edited, test invoices cannot be deleted, sent documents are not retained or revision-tracked.

## Problem

Three structural gaps, confirmed against `main`:

1. **No edit.** `updateInvoiceStatus` ([finance.ts:144](../../../apps/web/lib/actions/finance.ts)) is status-only. The PATCH route parses four more fields and silently discards them.
2. **No delete or void.** Neither exists in any layer — action, route, or UI — despite `void` being a declared status with a `voidedAt` column. Status transitions are entirely unvalidated.
3. **No persisted document.** The PDF is rendered per request and discarded, so the document a customer received is unrecoverable and revisions cannot be tracked.

## Binding decision

`Document` has no polymorphic owner column, and the repo has **no established pattern** for binding a managed document to a business record — the only mechanism, `DocumentReference.targetExternalRef`, is free-form text whose sole production caller attaches nothing.

Routed through `principle_decide`. Recommendation: **typed join table**, high confidence.

| Option | Composite |
|---|---|
| Typed join table (`InvoiceDocument`) | **10.074** |
| Polymorphic `ownerType`/`ownerId` on `Document` | 6.441 |
| `DocumentReference.targetExternalRef` | 3.749 |

Margin 3.633, no commandment conflict. Strongest contributors: *Ship Real Functionality*, *Research and Use Standards*, *Single Source of Truth*, *Never Assume — Verify*.

This sets the precedent for quotes, purchase orders, and contracts. The trade accepted: a join table per record type, in exchange for real foreign keys and cascade semantics.

## Phases

Each phase is one BI, one branch, one PR.

### Phase 1 — Guarded lifecycle: delete, void, transitions (BI-83574A1F)

Sequenced first: it unblocks the operator immediately and establishes the status gates that Phase 2 depends on.

- Declare one transition map as the single source of truth; enforce in `updateInvoiceStatus`, consult from `sendInvoice`.
- `deleteInvoice(id)` — draft-only, and only with no `PaymentAllocation`, no `DunningLog`, no sourced `JournalEntry`. NULLs `TimesheetEntry.invoiceId`/`invoicedAt` so billable time returns to the unbilled pool.
- `voidInvoice(id, reason)` — unwinds allocations, posts reversing journal entries where GL postings exist, records reason.
- DELETE handler on the v1 route.

**Verification:** every legal transition accepted, every illegal one rejected; `sendInvoice` on a void invoice rejected; void re-bills linked timesheet entries.

### Phase 2 — Edit (BI-3FDFBFD3)

Depends on Phase 1's status gates.

- `updateInvoice(id, input)` accepting header fields plus a full `lineItems` array.
- Extract the total-recomputation arithmetic out of `createInvoice` into a shared pure helper — do not duplicate it.
- Full edit while `draft`; post-draft narrows to `notes`, `internalNotes`, `paymentTerms`, `dueDate`, so a sent invoice's economics cannot change under a customer who already holds the PDF.
- Fix the PATCH silent-discard bug.
- Relax the grid adapter to the same draft-only field set; keep `canAddRow`/`canDeleteRow` false.

**Verification:** draft edit recomputes totals; non-draft economic edit rejected; PATCH round-trips every schema field.

### Phase 3 — Document persistence (BI-C86BD108)

The largest phase and the one that closes the audit gap.

- New `InvoiceDocument` model: `invoiceId` (FK, cascade), `documentVersionId` (FK), `role`, `revision`, `sentToEmail?`, `@@unique([invoiceId, revision, role])`.
- Snapshot on send: persist the rendered Buffer via `saveManagedDocument`, bind the resulting `DocumentVersion`.
- Snapshots are immutable. A reissue creates revision N+1; it never mutates N.
- **Open question to resolve during build:** blob storage is filesystem-backed (`documents/sha256/aa/bb/<sha>`), not object storage. Confirm the retention and backup story before a finance artifact depends on it.
- Re-check the migration timestamp for collision after every rebase.

**Verification:** the persisted `sha256` matches the emailed bytes; re-sending after an edit yields revision 2 with revision 1 byte-identical; a revision stays retrievable after the invoice is voided.

### Phase 4 — UX (BI-F8A20878)

- Edit / Void / Delete controls, each rendered only when its gate passes, with confirmations naming the real consequence.
- Document revision panel — visibly distinct from the live re-render, since the two diverge after an edit.
- Timestamps via shared `LocalTime`, viewer timezone.
- Run `dpf-ux-fit-review` before implementation. No new tab or route family.

## Precedent to retire

On 2026-07-31 the five seeded test invoices (`INV-2026-0001`–`0005`) were voided by direct SQL against `dpf-postgres-1`, because no governed path existed. Phase 1 is what makes that unnecessary.
