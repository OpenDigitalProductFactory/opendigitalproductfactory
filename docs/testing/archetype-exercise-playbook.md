# Archetype Exercise Playbook — what it costs to do the next one

The restaurant exercise (2026-07-29 → 07-31) took ten merged PRs. Reading that
as "ten PRs per archetype" would be badly wrong, and would make the programme
look unaffordable. **All ten were one-time platform work.** This playbook
separates what is already paid from what each additional archetype actually
costs, sequences which archetype to take next, and settles where scenario data
lives.

Companions: [archetype exercise harness](archetype-exercise-harness.md) (the
runner) · [archetype job validation](archetype-job-validation.md) (the per-job
loop) · `dpf-add-archetype` skill (provisioning, the step *before* this one).

## 1. What the restaurant exercise actually bought

Every PR below is archetype-neutral platform substrate. A second archetype
inherits all of it for free.

| Shipped | What it fixed | Reusable by |
| --- | --- | --- |
| #3720 (peer session) | Local model serves its real context window | every archetype |
| #3725 | A scheduled coworker run that dies on provider failure **fails loudly and retries** instead of recording success | every archetype |
| #3733 · #3740 | Autonomous runs budget their tool attachment to the serving model, total-inclusive of the local-fallback gate | every archetype |
| #3763 | `list_storefront_activity` — coworkers can read orders/reservations/inquiries with a demand rollup | any archetype with a storefront |
| #3805 | Install owner cleared for confidential, so the owner can authorize the coworkers the seed ships | every archetype |
| #3826 | Stock coverage substrate: supplies, recipe lines, derived coverage | any archetype consuming supplies |
| #3721 | Order fulfilment lane in the owner inbox | any purchase-CTA archetype |
| #3723 | Phone numbers no longer garbled on confirmations | every archetype |
| #3722 · #3744 | The harness runner and the job-validation methodology | every archetype |

**Nothing in that list is restaurant-specific.** The restaurant-specific residue
of the whole exercise is one file — `scripts/harness/scenarios/restaurant.mjs`
(catalog, personas, demand wave, supplies/recipes) — plus its job matrix.

## 2. What the next archetype costs

| Work | Effort | Notes |
| --- | --- | --- |
| Scenario pack (`scenarios/<name>.mjs`) | hours | catalog, personas, demand wave, stock/recipes if it consumes supplies |
| Outcome/job matrix rows | hours | the physical outcomes and who owns each (see the job-validation doc) |
| **Measured pre-DPF baselines** | hours | see §4 — currently missing, and the pass bar is unfalsifiable without it |
| Exercise + deficiency capture | 1 session | drive it, file BIs with correct `scopeKind` |
| Archetype-specific defects found | unknown | the point of the exercise; scope honestly to leaf/category/common/platform |

The honest expectation: **the second archetype should cost a fraction of the
first**, and the deficiencies it finds should skew archetype-specific rather
than platform-wide. If it does not — if the next archetype again turns up
platform-wide serving, authorization, or tool-surface defects — that is the
signal that the substrate is thinner than this exercise concluded, and is worth
reporting as such.

## 3. Which archetype next

Pick for **operational-shape contrast**, not category size — the goal is to
stress the generalization, not to re-run the same shape.

Restaurant exercised: *booking + purchase order + consumable stock*.

1. **Trades / field service (e.g. HVAC contractor)** — recommended first.
   Different shape (dispatch, crews, site visits, expected presence), the
   largest category (12 leaves), a dispatch board already exists in the portal,
   the business-activity simulator already models its lifecycle against real
   `@dpf/validators`, and the Field Ops substrate items (BI-FIELDOPS-001…005)
   are already filed — so findings land against planned work rather than
   creating an unplanned backlog.
2. **Asset rental (e.g. equipment rental)** — second. `RentableUnit` /
   `RentalAgreement` already model reserve → checkout → return → re-pool, a
   genuinely different lifecycle with a returnable-asset twist restaurant never
   touched.
3. **Professional services** — later. Mostly inquiry → engagement → delivery,
   which overlaps the shapes above; lower marginal learning per session.

## 4. The gap to close before the next run

**No pre-DPF baseline was ever measured.** The job-validation loop's pass bar
is *"the journey with DPF must not take more steps than the pre-DPF baseline"* —
but no baseline exists for restaurant, so nothing has actually been tested
against it. Before or during the next exercise, record for each journey the
step count of doing that job **without** DPF (paper, spreadsheet, or the
incumbent tool the archetype's operators actually use). Until then the
value-not-burden claim is an assertion.

Three other known gaps, each already tracked: per-job login driving in the
harness (BI-0AA828E3), WWWD starter stances so day-one decisions clear the
confidence threshold (BI-00A1DB81), and the archetype completeness depth floor —
note that **food-hospitality itself is still on `archetype-completeness-baseline.txt`**,
so being exercised is not the same as being complete.

## 5. Where scenario data lives

Two systems now describe archetype behaviour and must not drift:

| | Business-activity simulator | Exercise harness |
| --- | --- | --- |
| Runs | in-process, CI, deterministic | live portal over HTTP |
| Scores | financial/lifecycle invariants (FIN1-5, LC1) | UX dead ends, coworker behaviour, authorization |
| Data | `archetype-flows.ts` | `scenarios/<name>.mjs` |
| Catches | broken money/lifecycle logic | what only appears at runtime |

They are complementary, and the restaurant exercise is the evidence: **none** of
the defects it found — silent no-op runs, tool-surface overload, a missing read
tool, an owner who could not authorize their own coworkers — are visible to an
in-process simulation.

The risk is duplicated archetype *definitions*. The intended convergence is one
declarative archetype scenario (catalog, personas, demand, lifecycle) consumed
by both: the simulator projects it into flows, the harness projects it into HTTP
calls. Until that lands, a change to one must be mirrored in the other, and any
new archetype should be added to whichever system will actually exercise it —
not both by default.

## 6. Jurisdiction is a test axis, learned by pattern

**The founder's rule (2026-10-28) applies to every archetype:** jurisdictions vary, and the platform will never know every possibility. It must know the *need*. Gaps close by testing a few jurisdictions and folding the pattern back in, not by enumerating every locale up front.

What that means for an exercise:

- **Model the need, not the country.** Each archetype's measure-of-success outcome declares the rule slots it depends on: documents, eligibility, preconditions, money, windows, records, reporting. Each slot carries a provenance: generic default, operator-attested, or confirmed regulation. Platform code never branches on a country code, and no pack asserts a jurisdiction's law. Law enters only through cited, human-confirmed research (BI-50DF2A92). The pet-rescue adoption design is the first worked example: `docs/superpowers/specs/2026-10-28-rescue-adoption-locale-policy-design.md`.
- **Run the outcome in a test jurisdiction.** A scenario pack names the jurisdiction it runs in (ISO 3166-1, plus ISO 3166-2 where the rules are sub-national). The exercise drives the outcome end to end and records three things:
  - a slot that was **missing**: the jurisdiction needed a rule the model had no place for;
  - a slot that was **wrong**: the default would have produced an unlawful or failed outcome;
  - a slot that was **fine** on its default.
- **Fold the pattern back.**
  - A missing slot is added to the archetype's generic pack, so every deployment gains it.
  - Values go through the research path for confirmation.
  - Gaps the slot model itself could not express become BIs scoped `common` or `platform`, not leaf.
  - A second jurisdiction that surfaces no new slot is the signal the model has converged for that outcome.
- **Ship the capability, not a jurisdiction library.** What ships is:
  - the archetype's rule slots;
  - the setup-time investigation (cited research plus human confirmation) that the implementing organization's own install runs to fill those slots.

  Test jurisdictions prove and improve that investigation; they are not shipped value packs. Only new slots and generic values fold back into the platform. A cited, provenance-tagged starter set for a test jurisdiction is fine. A comprehensive out-of-the-box jurisdiction library is out of scope: it is too large to build now and would have to be maintained forever.
- **Test order: US states first.** Start with the test install's own state: US-TX for the operator's DEV install, which is in Texas. Then test other US states. **Everywhere else runs on the archetype's generic default pack** until the founder extends the order.

  > *Superseded:* an earlier statement the same day put English-speaking countries first (US-TX, GB-ENG, CA-ON, AU-NSW, then IE, NZ). The founder's later answer, "model US states first (start with the dev install's state), using the generic default pack elsewhere", replaces it. GB-ENG, CA-ON, AU-NSW, IE and NZ are not scheduled.
- **Prove it once, then apply it everywhere.** Rescue adoption is the first outcome to run this loop. Once it has converged, every archetype in §3 adopts the same loop. Each exercise of trades, asset rental and professional services runs its outcome in at least two US states. Restaurant and pet rescue are re-run when their next exercise is due.

| Archetype | Outcome under test | Exercised | Jurisdictions run |
| --- | --- | --- | --- |
| Restaurant (food-hospitality) | booking + order + stock | 2026-07-29 → 07-31 | none recorded (pre-rule) |
| Pet rescue (nonprofit-community) | lawful adoption | 2026-10-28 walkthrough (DEV) | none recorded; the design defines the slots |
| Trades / field service | dispatch → visit → invoice | queued | — |
| Asset rental | reserve → checkout → return | queued | — |
| Professional services | inquiry → engagement → delivery | queued | — |
