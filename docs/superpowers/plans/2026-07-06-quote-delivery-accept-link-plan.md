# Plan — Quote delivery + customer accept link (BI-8E45CCA3)

Date: 2026-07-06. Epic: EP-B51FA3BC. Build-order slice 5 of the parity gap matrix.

## Substrate finding (dpf-verify-substrate-first)

The invoice payment portal is the exact rail to mirror: `Invoice.payToken` (nullable
unique) minted by `sendInvoice`, public page at `(storefront)/s/pay/[token]`, e-sign-lite
capture. Quotes had `sendQuote` (status flip only) and an internal-only Accept button —
customer acceptance required an internal user to click.

## Design

- Migration `20260706080000`: `Quote.acceptToken String? @unique` (nullable add).
- `sendQuote` mints the token on first send (idempotent re-send keeps it).
- `quote-accept-public.ts` (public, token-authorized): `getQuoteByAcceptToken` (guards
  trivially short tokens), `acceptQuoteByToken` — validates sent + in-date, idempotent on
  already-accepted, drives the existing `acceptQuote` (order + invoice + closed-won), and
  records the acceptor's name/email as a timeline activity.
- Public page `(storefront)/s/quote/[token]`: quote summary + line items + totals +
  `AcceptQuoteForm` (name + email + one Accept button); accepted/expired states.
- Internal quote page: when sent, shows the customer accept link with a copy control
  (clipboard-unavailable fallback reveals the URL inline — no native dialogs).
- Deliberately deferred: PDF rendering and automated email send — the tokenized link IS
  the delivery mechanism, matching how invoice pay links are shared today.

## Verification

quote-accept-public tests: happy path + acceptor recorded, idempotency, draft/expired/
invalid-token/identity guards, short-token refusal. Live: send a quote, open the link in
a fresh session, accept, watch order+invoice appear.
