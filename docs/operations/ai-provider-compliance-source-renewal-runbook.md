# Runbook — Renewing the AI-provider compliance sources

- **Owner:** Platform operator, with whoever owns compliance judgement for the install
- **BI:** BI-68D44727
- **Cadence:** driven by the alert, not the calendar — the shortest window is 60 days
- **Registry:** [`packages/db/src/provider-compliance-source-registry.ts`](../../packages/db/src/provider-compliance-source-registry.ts)
- **Freshness arithmetic:** [`apps/web/lib/routing/provider-suitability/source-freshness.ts`](../../apps/web/lib/routing/provider-suitability/source-freshness.ts)

## Why this exists

When someone connects an AI provider, DPF advises whether it is suitable for company
data, and cites governed sources for that advice: the vendors' own data-privacy and
model-training policies, plus GDPR/ICO guidance. Each source carries the date DPF
retrieved it and how long that copy stays trustworthy (`maxAgeDays`).

Past that window, [`provider-compliance-advisory.ts`](../../apps/web/lib/routing/provider-suitability/provider-compliance-advisory.ts)
emits `stale-source`, grounding validation fails, and advice that would have said
"conditional" degrades to a deterministic non-approval. **That direction is correct.**
DPF must not vouch for a vendor's data-handling terms from a stale copy.

What was missing was the other half: nothing refreshed the corpus and nothing warned
first. The degradation was silent, product-wide, and dated. To an operator it reads as
"the AI got worse", not "an evidence copy expired" — and it lands whenever they next try
to onboard a provider, which is exactly when they can least afford to debug it.

The warning now fires in the attention inbox 21 days ahead. This runbook is what to do
when it does.

## This is a review, not a scrape

The renewal is **not** "re-download the page and bump the date". The registry does not
merely cite a document; it cites specific *claims* from it, each scoped to particular
providers, services, account classes, jurisdictions and workloads. A vendor can rewrite a
policy without changing what DPF relies on — or leave the page looking similar while
narrowing exactly the entitlement a claim depends on.

So the question at renewal is never "is the URL still live?" It is **"does this source
still support this claim, for this scope?"** That is a judgement a person owns. Automating
the fetch is possible; automating the attestation is not, and should not be.

## Procedure

### 1. Identify what is lapsing

The attention item names the source, the publisher, and the days remaining. For the full
picture across every source:

```bash
node -e "import('./apps/web/lib/routing/provider-suitability/source-freshness.ts').then(m=>console.table(m.summarizeComplianceSourceFreshness().sources))"
```

The three `provider-terms` sources (OpenAI and Anthropic) carry the short 60-day window —
deliberately, because vendor data-handling terms change far more often than statute. The
GDPR/ICO sources sit at 180–365 days.

### 2. Read the current source

Open the `url` from the registry entry. Read the **current** published policy, not a
cached copy and not a summary of it.

### 3. Re-attest each claim

For every entry in that source's `claims[]`, confirm the `summary` still holds **and** that
`appliesTo` is still correctly scoped. Watch for the failure that matters most: a claim
that is still broadly true but no longer true *for the account class or region DPF applies
it to*. That is the change most likely to slip through, because the page still "says the
right thing".

Outcomes:

- **Claim unchanged** → nothing to edit but the retrieval date.
- **Claim narrowed or reworded** → update `summary` and/or `appliesTo` to match reality.
  Narrow rather than broaden when the new wording is ambiguous; the fail-closed direction
  is the safe one.
- **Claim withdrawn** → remove it. Do not leave a claim DPF can no longer substantiate.
  Removing a claim may change advice from "conditional" to "insufficient evidence" — that
  is the system working, not a regression to paper over.

### 4. Update the registry

Edit the entry in `provider-compliance-source-registry.ts`:

- Set `retrievedAt` to the date you actually read the page (`YYYY-MM-DD`).
- Apply any claim edits from step 3.
- Reconsider `maxAgeDays` if the vendor's revision pace has visibly changed. Shorten it
  freely; lengthen it only with a reason you would be willing to defend in an audit.

Only bump `retrievedAt` for sources you genuinely re-read. Touching every date to silence
the alert converts a working control into decoration, and the next person will trust it.

### 5. Verify

```bash
cd apps/web && pnpm vitest run lib/routing/provider-suitability
```

```bash
pnpm --filter @dpf/db exec vitest run src/provider-compliance-source-registry.test.ts
```

`validateProviderComplianceSourceRegistry` enforces the structural rules (HTTPS URLs,
unique claim ids, non-empty applicability axes, no `secondary` authority). The freshness
tests assert the warning arithmetic against pinned clocks.

Then confirm the attention item has cleared — it disappears once every source is outside
the 21-day warning window.

### 6. Ship it

A normal DCO PR. Record in the body which sources you re-read and what changed in the
claims, so the next renewal can see whether a given vendor's terms are stable or churning.

## Deliberately not a CI gate

There is no per-PR check that fails when a source lapses, and there should not be. A
required check with a date in it is a fleet-blocking time bomb with a known detonation
date — precisely the failure this work exists to prevent (see the 2026-08-01T15:00Z
outage, fixed in #3883/#3885, and the detector added in #3899).

The warning belongs where a human can act on it and nowhere that can block a merge.

## If it has already lapsed

Nothing is broken and nothing is unsafe — the platform is refusing to substantiate advice
it can no longer ground, which is the designed behaviour. Users will see "a human needs to
review this" instead of a recommendation.

Work the procedure above. If an answer is needed before the review can be completed, that
answer is a human compliance decision, made and recorded as such — not a temporary widening
of `maxAgeDays` to make the warning go away.
