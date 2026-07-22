# Customer submit-result contract (BI-F20763F5)

Status: implementing · Epic: EP-UX-COGLOAD · Date: 2026-07-22

## Problem

The live customer submit/result audit (2026-07-22) found that public Restaurant
forms can submit and create owner-side work, but the feedback contract is too
thin for a non-technical customer or owner:

- `/s/<slug>/inquire` empty-submit relies on **browser-native** required-field
  blocking only; the page adds no visible inline/summary feedback, and several
  controls have empty accessible labels.
- A safe dummy inquiry created reference `INQ-FGQXCF4X` and navigated to
  `/s/<slug>/checkout?ref=INQ-FGQXCF4X&type=inquiry` — a **checkout** route for a
  non-checkout action. The success page said only *"Enquiry received! Reference:
  INQ-FGQXCF4X We'll be in touch shortly."* — no response channel/time, no
  submitted context, no correction/cancel/contact path.
- Owner `/storefront/inbox` shows the inquiry with a generic **`Send to
  backlog`** action that does not name the request or explain what it changes.

## Scope & coordination

This BI is scoped **disjoint** from four in-flight sibling PRs in the same epic so
they can merge in any order. An overlap sweep (`gh pr list` by file) drove the
final scope:

- **BI-8E74C749 / PR #3386** owns the shared `apps/web/components/ui/form/`
  primitives and the accessibility of `BookingForm`, `SignInForm`, `SignUpForm`.
  This BI does **not** touch those files.
- **BI-3DA1DFDC / PR #3387** owns the **booking** reservation-context row and the
  booking `Confirm`/`Cancel` accessible labels in `StorefrontInbox`, plus
  `inbox/page.tsx` booking fields. This BI does **not** edit `inbox/page.tsx`.
- **BI-4F4252DB / PR #3394** owns the **owner inquiry Send-to-backlog per-row
  action** — it already delivers the row-specific `aria-label="Send inquiry <ref>
  to backlog"` and the "✓ Sent to backlog" completed state. To avoid duplicate,
  conflicting work on the same JSX block, this BI **defers the per-row action to
  #3394** and contributes only the non-conflicting section-level **consequence
  copy** in the inbox banner ("…track a customer request as internal follow-up
  work. It doesn't notify the customer.").
- **BI-4A68EDF6 / PR #3396** enriches the shared `/checkout` confirmation and
  keeps booking/order/donation there. This BI moves **only inquiry** off checkout
  with a minimal early `redirect()` inserted in a region #3396 does not touch, so
  both changes auto-merge; #3396's inquiry-branch copy simply becomes unreachable.

So this BI owns, end-to-end: the **inquiry** form validation, the **inquiry**
success result route/page, the inquiry `/checkout` → `/inquiry/received` redirect,
and the inbox consequence copy. The validation utility it introduces is field-set
agnostic, so its deterministic tests also cover the auth (email/password) and
booking (name/email/date/time) required-field sets without importing the sibling
components.

## Design

### 1. Visible, accessible validation (`apps/web/lib/storefront/inquiry-validation.ts`)

A pure, framework-agnostic validator: `validateRequiredFields(fields, values)`
returns `{ [name]: message }` for empty required fields (`"<Label> is
required"`) and malformed emails (`"Enter a valid email address"`). No React, no
I/O — deterministic and side-effect-free.

`apps/web/components/storefront/InquiryForm.tsx` uses it and renders:

- an **error summary** at the top (`role="alert"`, focus-managed) that links to
  each invalid field;
- **inline** per-field errors (`aria-invalid`, `aria-describedby`,
  `<label htmlFor>` associations, `aria-required`);
- `noValidate` on the `<form>` so our messaging replaces the native popups.

Errors block the server call — an invalid empty submit performs **no** network or
navigation side effect. All colours use storefront `--dpf-*` branding tokens.

### 2. Named result route (`apps/web/app/(storefront)/s/[slug]/inquiry/received/page.tsx`)

Successful inquiries now route to `/s/<slug>/inquiry/received?ref=…` instead of
`…/checkout`. The presenter `apps/web/components/storefront/InquiryReceived.tsx`
shows: the reference; **what you sent us** (name, email, phone, item, message,
archetype fields mapped through the form schema labels); **what happens next**
(review + response channel = the customer's email, expected time); and **need to
make a change?** (correction/cancel = contact the business, quoting the
reference, via `mailto:`/`tel:` when contact details exist) plus a link back to
the storefront. Copy is honest: no confirmation email is claimed because none is
sent. `apps/web/app/(storefront)/s/[slug]/checkout/page.tsx` now `redirect()`s the
`type=inquiry` branch to the named route so old links still resolve.

### 3. Owner inquiry handoff (`apps/web/components/storefront-admin/StorefrontInbox.tsx`)

Owner-side is a coordinated split. The per-row `Send to backlog` action — its
row-specific label and completed state — is owned by **#3394** and is not
duplicated here. This BI adds only the **consequence copy** to the inbox banner
so a non-technical owner learns, before clicking, that Send-to-backlog creates
internal follow-up work and does not notify the customer. This edit sits well
away from the per-row block (#3394) and the booking region (#3387), so it
auto-merges. Rows already show reference/customer/message for inquiries, so item
"owner inbox rows show the same reference/customer/request context" holds on main.

## Tests (no payment, no external side effects)

- `inquiry-validation.test.ts` — inquiry/auth/booking required-field sets: empty →
  flagged, filled → clean, bad email → flagged (covers *public auth validation*
  and *deterministic booking final-form validation* as pure logic).
- `InquiryForm.test.tsx` — empty submit shows summary + inline and calls neither
  the action nor the router; valid submit calls the action once and routes to
  `/s/<slug>/inquiry/received`.
- `InquiryReceived.test.tsx` — reference, submitted context, response channel,
  what-next, correction/contact all present.
Owner-inbox smoke coverage (item 7's "owner inbox visibility") is provided by
#3394's `StorefrontInbox.test.tsx`; this BI does not add a competing test file on
that path.
