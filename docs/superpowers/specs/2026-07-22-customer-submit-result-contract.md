# Customer submit-result contract (BI-F20763F5)

**Status:** implemented
**Date:** 2026-07-22
**Backlog item:** BI-F20763F5 — "Customer submissions need clear success, validation, and owner handoff feedback"
**Epic:** EP-UX-COGLOAD (Live UX cognitive-load audit follow-up)

## Problem

A live customer submit/result audit (2026-07-22) found the public storefront can
submit and create owner-side work, but the feedback contract is too thin for a
non-technical Restaurant customer or owner:

- Public forms relied on **browser-native `required` blocking only** — no visible
  inline or summary validation, several controls with empty accessible labels.
- A safe inquiry submit landed on `/s/<slug>/checkout?ref=INQ-…&type=inquiry`
  ("Enquiry received! … We'll be in touch shortly.") — success plumbing that
  reads like a checkout and omits **what was requested, response channel/time,
  what happens next, and how to correct/cancel/contact**.
- The owner `/storefront/inbox` inquiry row exposed a generic **`Send to backlog`**
  action with no row context or consequence copy.

## Design grounding

- **Source of truth:** `docs/platform-usability-standards.md` (accessible form
  contract, owned/extended by BI-8E74C749) and the public storefront route
  substrate under `apps/web/app/(storefront)/s/[slug]/`.
- **Substrate check (grep + open PRs):** the shared `apps/web/components/ui/form/`
  primitives, `SlotBookingFlow`, `BookingForm`, auth forms, and the owner inbox
  **booking** rows are already claimed by in-flight sibling PRs (#3386, #3387,
  #3383). This work is scoped to the **uncontended delta**: the public
  **inquiry** form, the **result page/route**, and the owner **inquiry** row.
- **Decision:** create a new, self-contained contract (this spec) that *composes*
  with the form-primitive work rather than depending on it at compile time — a
  public form can adopt visible validation without waiting for #3386 to merge.
  The two share the same accessible pattern (`aria-invalid` +
  `aria-describedby` + a `role="alert"` summary), not shared code.

## Contract

### 1. Visible, accessible, branded validation

`apps/web/lib/storefront/form-validation.ts` is the single pure validation
contract (`validateRequiredFields`): required-empty + email-format rules, a
stable error order for the summary, and `errorId` for `aria-describedby`. The
public inquiry form (`InquiryForm`) renders:

- a `role="alert"`, focus-managed **error summary** listing each failing field
  (anchored to the field), and
- **inline** per-field messages with `aria-invalid`/`aria-describedby` and an
  accessible "(required)" marker.

`noValidate` disables browser-native bubbles so our visible contract is the
single source of feedback.

### 2. Named result routes (never `/checkout` for non-checkout actions)

`apps/web/lib/storefront/submission-result-content.ts` (pure) maps each
submission type to a **result-named** route:

| Type      | Route (under `/s/[slug]`) |
|-----------|---------------------------|
| inquiry   | `inquiry/received`        |
| booking   | `booking/confirmed`       |
| order     | `order/received`          |
| donation  | `donation/received`       |

`submission-result.ts` adds `loadSubmissionResult`, which validates the
reference against the storefront and assembles a branded model. Each route is a
thin server page rendering `SubmissionResultView`, which inherits the storefront
brand/nav from `s/[slug]/layout.tsx` and shows:

- reference, **what you submitted** (name/email/item/date-time/message/notes),
- **response channel** (email) + an honest **expected time** (an *aim*, not a
  fabricated SLA),
- **what happens next** (ordered, brand-personalised steps),
- **correction/cancel/contact** (reply-to-email framing + `mailto:`/`tel:` when
  the storefront has configured contact channels), and a branded return link.

`InquiryForm` now navigates to `inquiry/received`. The old `/checkout` page is
retained only as a **back-compat redirect** that forwards any submit path still
targeting `/checkout?ref=&type=` to the matching named route — so the
booking/order/donation flows owned by sibling PRs land correctly without this
change touching their files.

### 3. Owner inquiry handoff

`StorefrontInbox` inquiry rows keep the reference + customer + message (request
context) and replace the generic `Send to backlog` with a **row-specific** label
(`Send inquiry INQ-… to backlog`), a full-context `aria-label`, and
**consequence copy** ("Creates an internal work item … The customer isn't
notified."). Booking rows are untouched (owned by BI-3DA1DFDC / #3387).

## Coordination

| BI / PR | Overlap | How this work stays additive |
|---------|---------|------------------------------|
| BI-8E74C749 / #3386 | shared `ui/form` primitives; auth + `BookingForm` | Inquiry form uses the *same accessible pattern* without importing the primitives (no merge-order dependency). Does not touch auth/BookingForm. |
| BI-3DA1DFDC / #3387 | owner inbox **booking** rows + `booking-summary.ts` | Only the **inquiry** branch of `StorefrontInbox` is edited; booking branch and inbox page booking mapping untouched. |
| BI-0E4A1228, BI-36807E68 / #3383 | booking final-form fields | `SlotBookingFlow` is not modified; booking success reaches `booking/confirmed` via the `/checkout` redirect. |
| BI-4A68EDF6 | public trust/brand + gating unsupported paths | Result pages inherit storefront brand; `/checkout` now redirects (no bare checkout surface). Path gating remains that BI's scope. |
| BI-348766E5, BI-7D7EE150 | workspace attention; owner action safety | Consequence copy on the inquiry action aligns; workspace reconciliation and destructive-action confirmation remain those BIs' scope. |

## Tests

- `form-validation.test.ts` — empty validation, email format, public-auth field
  contract, deterministic booking final-form validation (pure, no side effects).
- `submission-result.test.ts` — route naming (never `/checkout`), headings,
  next-steps, response channel/time copy.
- `SubmissionResultView.test.tsx` — reference, submitted context, response
  channel/time, what-next, correction/cancel/contact, graceful no-contact case.
- `InquiryForm.test.tsx` — empty submit shows summary + blocks network/nav;
  invalid email blocked; safe valid submit calls the action and routes to
  `inquiry/received` (never `/checkout`); server error surfaced without nav.
- `StorefrontInbox.test.tsx` — inquiry row shows ref/customer/request context,
  row-specific label, consequence copy, uniquely targetable per row.

> Note: `InquiryForm.test.tsx` imports `next/navigation` (mocked, as ~dozens of
> existing specs do) and therefore transforms only where `next` is installed
> (CI), not in a source-only worktree. All other specs run locally green.
