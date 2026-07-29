# Archetype Exercise Harness

`scripts/harness/archetype-exercise.mjs` stands up a business-archetype scenario
on a running portal and exercises it through the same HTTP surfaces the UI uses,
so what it proves is what a non-technical staff crew would experience. It is the
runner for redeployable archetype test packs (BI-41D8DF5F); the first pack is
`scripts/harness/scenarios/restaurant.mjs`.

## What it does

1. **Signs in** as the install admin via the NextAuth `workforce` credentials
   provider (`ADMIN_EMAIL`, default `admin@dpf.local`, + `ADMIN_PASSWORD` from
   the install's `.env`). Plain `node` + `fetch`, no dependencies.
2. **Optionally resets the archetype** (`--reset`) through
   `POST /api/storefront/admin/archetype-reset`, applying the scenario's
   identity (name/tagline). Note: reset currently leaves prior-archetype residue
   behind — tracked as BI-B36DE9C5.
3. **Seeds the scenario catalog** idempotently through
   `POST /api/storefront/admin/items` (skips items that already exist by name).
   The restaurant pack seeds 8 priced dishes with `purchase` CTAs alongside the
   archetype's booking items.
4. **Generates demand** from named guest personas. The demand wave is weighted
   so one item is the clear best-seller — the signal a proactive restocking
   coworker needs. Where a public flow has no JSON API (today: order submission
   is a page server action), the harness records a `capability-gap` observation
   in its report instead of faking the write.
5. **Writes a JSON report** (`--report out.json`) of steps + observations, the
   raw material for deficiency backlog items.

## Usage

```bash
ADMIN_PASSWORD=... node scripts/harness/archetype-exercise.mjs --scenario restaurant --report report.json
```

Flags: `--portal <url>` (default `http://localhost:3000`), `--reset` (swap the
storefront to the scenario's archetype first).

## Scenario pack contract

A pack at `scripts/harness/scenarios/<name>.mjs` default-exports:

- `archetypeId` — StorefrontArchetype slug the scenario targets
- `orgSlug` — the storefront's public slug
- `identity` — optional identity applied on `--reset`
- `catalog` — items for the admin items API (name/description/category/ctaType/price)
- `personas` — named customers with emails and addresses
- `demand` — ordered `{ kind: "order" | "booking", item, persona, qty }` wave
- `stubs` — where real-world rails are stubbed or deferred (e.g. card payment is
  order-then-settle today, so no card stub is needed at order time; supplier
  ordering awaits an ingredient-stock substrate)

Adding an archetype = adding one pack file; the runner is archetype-agnostic.

## Known limits

- Booking-demand driving (slot pick + contact submit) is not yet in the runner;
  bookings were exercised manually in the 2026-07-29 restaurant session.
- Public order submission has no JSON API; until one exists the runner reports
  the gap rather than submitting orders.
- Observation hooks (attention counts, coworker proposals, decision-ledger
  reads) are manual follow-ups today; candidates for a `--observe` pass.
