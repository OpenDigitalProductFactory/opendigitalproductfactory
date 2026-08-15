# Pay-a-bill flow — fix plan

**Status:** draft for operator review · 2026-08-14
**Backlog item:** BI-8C7E6910
**Scope:** the accounts-payable "receive a bill → approve → pay" flow, as the worked example of the cross-cutting "flows arrive but can't continue" pattern from the UX surface analysis ("The UX Has No Spine").

## Backlog coverage

- Decision: decomposed
- Parent: BI-8C7E6910
- Receipt: cmsuhjdqi171501ppmvwhxcvl
- Dependencies: pay-surface-consolidation depends on in-shell-approve; generalize-approvals depends on in-shell-approve
- Rationale: each phase ships independently against a live BacklogItem; the keystone establishes the authority-gated approve pattern the later two reuse.
- Mappings:
  - approve-link-404 -> BI-451F6E1C
  - in-shell-approve (keystone) -> BI-18684670
  - pay-surface-consolidation -> BI-10832E25
  - generalize-approvals -> BI-E591399F

---

## 1. What the flow is, and where it actually breaks

Traced through source (`app/(shell)/finance/**`, `lib/actions/ap.ts`, `lib/attention/sources/business-approvals.ts`):

```
/finance/bills/new → submit → /finance/bills/[id] (draft)
   → SubmitBillButton → status = awaiting_approval
      → [approval] ─────────────────────────────► ??? 
   → (once approved) RecordBillPaymentButton  OR  /finance/payment-runs
      → /finance/payments
```

The breaks are **not** where I first assumed. Substrate verification changed the picture:

| Assumed gap | Actual finding |
|---|---|
| "No in-shell approval inbox — need to build one." | **Already exists.** `loadBillItems()` (`business-approvals.ts:97`) surfaces every `awaiting_approval` bill in the "Needs you" attention inbox as *"Approve bill {ref}"*, deadline-tiered by `dueDate`, deep-linked to the bill. Expenses (`loadExpenseItems`) and regulatory filings ride the same producer. |
| "Approvals happen off-surface via email." | True, but the attention inbox **already routes the owner in-shell** — its action is "Review bill" → `/finance/bills/[id]`. |
| — | **The real break:** the bill detail page renders **no approve control for `awaiting_approval`** (only `SubmitBillButton` for draft, `RecordBillPaymentButton` for approved). So the owner clicks "Review bill" from Needs-you, lands on the bill… and there is nothing to click. The *only* place approval can be actuated is the emailed public token page `/s/approve/[token]` — and that link is a 404 (BI-451F6E1C). |

**One-line diagnosis:** the approval *queue* is built and correct; the approval *action* is missing from the in-shell surface it points at, so the whole approval step is stranded on a broken email link.

Secondary frictions (real, lower severity):
- **Payment paths split across three Finance tab-families** — Bills/Suppliers under *Spend*, Payment Runs under *Close*, Payments under *Revenue* (`finance-nav.ts`). Paying in batch means Spend→Close; reviewing means Spend→Revenue.
- **Purchase Orders are absent from the Spend sub-nav** despite being the upstream of a bill (`/finance/purchase-orders` reachable only by deep link).
- **Two "pay" surfaces** (`RecordBillPaymentButton` vs `PaymentRunBuilder`) with no cross-link or guidance on which to use.

---

## 2. Fix — smallest change that makes the flow continue

Grounded in existing substrate (`lib/approval-authority.ts`, the attention producer, the AP actions). No new inbox, no new model.

### Phase 1 — make the approval actionable in-shell *(the keystone)*
1. Add `approveBill(billId)` server action in `lib/actions/ap.ts`, gated by `lib/approval-authority.ts` (reuse the same authority check the token page uses). Transitions `awaiting_approval → approved`, writes the audit row.
2. Add `ApproveBillButton` to `/finance/bills/[id]`, rendered **only** for `awaiting_approval` and **only** when the viewer passes the authority check. This is the control the attention inbox's "Review bill" link already points at.
3. Fix the emailed link (BI-451F6E1C) to resolve — either correct the URL to `/s/approve/[token]` or add the missing route as a redirect. The token page stays as the *out-of-office / delegate* channel; the in-shell button becomes the primary path.

*Result: the already-working "Needs you → Approve bill" queue becomes a real, one-click approval path. This is the pattern fix — the same three steps apply to expense claims and quote acceptance.*

### Phase 2 — de-fragment the pay surfaces
4. Move Payment Runs and Payments into the **Spend** family alongside Bills/Suppliers (or introduce a single "Pay" sub-tab), so the bill→pay→confirm arc lives in one Finance family.
5. Surface Purchase Orders in the Spend sub-nav and cross-link PO → derived Bill.
6. On the bill detail, when `approved`, show one clear "Pay" affordance that offers both single-payment and add-to-payment-run, instead of two disconnected surfaces.

### Phase 3 — generalize the keystone (separate flows, same shape)
7. Apply the Phase-1 pattern to **expense claims** (`/finance/expense-claims/[id]`, attention source `loadExpenseItems` already live) and **quote acceptance** (`/customer/quotes/[id]`), so no owner approval depends on an emailed public token page.

---

## 3. Child backlog items (filed)

| BI | Deliverable | workType | size | Depends on |
|---|---|---|---|---|
| `BI-18684670` | **P1 keystone:** in-shell `approveBill` action + `ApproveBillButton` on bill detail, authority-gated | feature | small | — |
| `BI-451F6E1C` | Fix emailed approval link to resolve to an existing route | bug | small | — |
| `BI-10832E25` | **P2:** consolidate Payment Runs + Payments + POs into the Finance *Spend* family; unify the "Pay" affordance | refactor | medium | P1 |
| `BI-E591399F` | **P3:** extend in-shell approve action to expense claims + quote acceptance (retire email-token dependence) | feature | medium | P1 |

Umbrella: `BI-8C7E6910`. Epic home: **EP-SAP-PARITY** (finance functional-parity gap closure) for the umbrella, keystone and P2, with the attention-surface producer as the integration point. P3 is cross-domain (finance + CRM) and also relates to EP-VSL-SURFACE.

---

## 4. Acceptance (flow-level)

- From "Needs you", clicking an *"Approve bill"* item lands on the bill with a working **Approve** control (authority-gated); approving flips status and clears the item from the queue.
- No owner-facing approval step depends on an emailed public-token page for its only actuation.
- The bill → approve → pay → confirm arc is reachable without leaving the Finance *Spend* family.
- A regression test asserts (a) the emitted approval attention item's deep-link target renders an approve control for `awaiting_approval`, and (b) the approval email URL resolves to an existing route.
