# Attention Reach Layer — design (P1: deep link only)

- **Backlog item:** BI-C7D25599 (EP-ATTENTION-SURFACE)
- **Kernel decision:** DI-EFEB6002A5C5
- **Date:** 2026-08-01

## 1. Problem

The owner is reachable only in-app. A plumber on a job site does not have the portal open,
so an attention item that needs them waits until they next sit at a desk. Reach is the
point of the Attention Surface, not a nicety on top of it.

Everything needed already exists and is unjoined:

| Piece | State on `4d525c0b154` |
| --- | --- |
| Dispatcher spine (`lib/communications/`) | shipped — `dispatcher`, `channel-types`, `dispatch-policy`, `delivery-evidence`, `channel-bindings` |
| `email` as a channel | already in `COMMUNICATION_CHANNELS` — **no adapter registered** |
| Postmark send client | shipped at `lib/marketing/channels/email-postmark/client.ts` |
| Risk floors | shipped in `lib/attention/owner-routing.ts` (`MONEY_SOURCES`, `PUBLIC_SOURCES`, `hardFloor`) |
| HMAC + `timingSafeEqual` pattern | shipped in `lib/coworker-service-catalog/delegation-receipt.ts` |
| Blockers BI-D39484E7, BI-094A124F | both **done** |

So P1 is composition, not invention.

## 2. A contradiction found during substrate verification

The BI (2026-06-23) says the low-risk reversible class should get **signed one-click
approve/reject**, citing "the bills/expenses pattern" (`/s/approve/[token]`) as the model.

But `owner-routing.ts` — shipped later — **hard-floors `approval-bill` and
`approval-expense`** as `MONEY_SOURCES` with *"Money would leave the business"*, and the
BI's own 2026-07-17 update says the money-out/public floors (never one-tap) apply to the
notification body too.

**The cited exemplar is itself the money class the current floors say must never be
one-tap.** The BI also flags widening signed one-click as needing a per-class security
review it calls Open Decision 3 — which has not happened.

Two further facts make the June framing unbuildable as written:

- The bills token is an **opaque value stored in the per-domain `BillApproval` table**, not
  a signed token. It does not generalize without a new table per approval class.
- It grants a **state change from an unauthenticated URL**. Whatever the merits for bills,
  that is not a pattern to widen by default.

## 3. Decision

Kernel `DI-EFEB6002A5C5` scored three scopes:

| Option | Composite |
| --- | --- |
| **deep-link-only P1** | **11.855** |
| policy module + email adapter, no link | 10.466 |
| deep link **plus** signed one-click | 7.435 |

Margin 1.389, high confidence, no commandment conflict. The one-click option scored
**negative** on *Outbound and irreversible actions require explicit go* (−0.058) — the only
negative contribution in the whole ledger, and a direct signal rather than an aggregate.

**P1 ships reach with no action-from-email.** Every decision still happens on the
authenticated surface, through the same decision module and the same audit path.

## 4. What P1 builds

### 4.1 Risk-driven channel policy (`lib/attention/reach-policy.ts`)

`dispatch-policy.ts` today selects channels by **urgency alone**. Risk never enters, so a
money-out approval and a memory note route identically. The new policy composes the
existing `classifyOwnerAttentionLane` rather than re-deriving risk:

- `hardFloor` items (money out, goes public, customer waiting) — reach is *raised*: they
  earn email even at routine urgency, because the cost of the owner not seeing them is the
  whole point. But their message body is the most restricted, and they can never carry an
  action.
- `custodian`-lane items are technical, not owner judgment — they do not earn off-site
  reach at all in P1. An outage emailing the owner at 2am is the interruption this program
  exists to remove.
- `weekly-digest` items are batched and do not trigger an individual send.

The policy also computes `oneClickEligible` — the honest classification of whether an item
*could* ever be actioned from a message. In P1 nothing consumes it to build an action;
it drives the **wording**, so a hard-floored email says plainly that it cannot be actioned
from email and must be opened. That is a real user-visible difference, not a placeholder.

### 4.2 Signed reach links (`lib/attention/reach-link.ts`)

A stateless HMAC-SHA256 token over `{ itemId, deepLink, exp }`, base64url-encoded, verified
with `timingSafeEqual`. No new table.

**The token is a pointer, not an authorization.** It names *which* item to land on; the
route it lands on requires a normal authenticated session. A stolen link therefore reveals
nothing and grants nothing — the worst case is that an attacker learns an opaque item id
they cannot open. This is the property that lets P1 ship without the per-class security
review the one-click path genuinely needs.

Secret resolution: `DPF_ATTENTION_REACH_SECRET ?? AUTH_SECRET ?? NEXTAUTH_SECRET`, and it
**throws** when none is set. No default, no dev fallback — `never-hardcode-secrets`.

Expiry is enforced on verify, not merely encoded, and the reason is distinguishable
(`expired` vs `signature_mismatch` vs `malformed`) so an operator following a stale link
gets "this link has expired, open your inbox" rather than a generic failure.

### 4.3 Email adapter (`lib/communications/email-adapter.ts`)

Registers the `email` channel against the existing dispatcher, delegating to the shipped
Postmark client. Declares its capabilities honestly: `interactive: false` — this adapter
cannot carry an action, which is the machine-readable form of the P1 decision.

### 4.4 Landing route (`app/r/[token]/route.ts`)

A **route handler, not a page**: it verifies the token and redirects. Implementing it as a
page would add a UI surface with no UI, and would drag in four generated-artifact
companions for a redirect.

Unauthenticated visitors are sent to sign-in with a return path, so the link survives the
round trip — the 2026-07-22 audit finding that a decision link must preserve the specific
item, not dump the operator on a list.

### 4.5 Message content — OWASP "Lies in the Loop"

The message carries **no raw prompt or business content**: outcome class, urgency, and a
link. The authenticated surface shows the raw action beside the AI brief. An email is an
untrusted rendering surface and must never be where the operator reads what an agent
proposes to do.

## 5. Out of scope (governed follow-ups)

- **Signed one-click.** Needs the per-class security review the BI itself names, plus a
  decision on whether the shipped bills/expenses one-click should be brought into line with
  the money hard floor — a behavior change to a live customer flow that is not this PR's
  call to make.
- Answer-by-reply (inbound parsing exists in the Postmark client; the decision path does not).
- SMS / WhatsApp / Teams / Slack adapters — same shape, different provider.
- Push and native mobile (EP-HITL-MOBILE).

## 6. Acceptance

1. No channel can produce an actionable message for a hard-floored item — asserted by test.
2. A reach link verifies only with a valid signature and an unexpired `exp`; tampering with
   any payload field fails closed.
3. An unauthenticated visitor to a valid link lands on sign-in and, after auth, on the
   specific item — never a list.
4. The email body contains no business content beyond the outcome class.
5. `custodian`-lane and `weekly-digest` items generate no individual off-site send.
6. No new Prisma model; the dispatcher, delivery evidence, and risk classification are all reused.
