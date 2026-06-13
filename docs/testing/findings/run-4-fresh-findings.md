# Run 4 Fresh-Install Findings — Fitness & Recreation

**Run**: 4 (fitness-recreation, fresh-install fast-track pass)
**Archetypes tested**: yoga-studio *(complete)*, gym *(complete)*, dance-studio *(complete)*
**Run date**: 2026-06-12 → 2026-06-13
**Method**: Tier 2 DB-only reset per archetype; golden dump `/tmp/golden.dump`; `/setup` onboarding → `/storefront/setup` wizard.
**Tester**: Autonomous agent

> **Baseline**: confirms/refutes systemic findings in [run-2-fresh-findings.md](run-2-fresh-findings.md) and the education surprises in [run-3-fresh-findings.md](run-3-fresh-findings.md). Recurring findings recorded as "🔁 Recurring"; full detail reserved for NEW findings.

---

## ⚠️ Methodology notes for this run

1. **Concurrent-session collision (shared install).** Mid-run, a *second* Claude session began an audit against the **same shared Docker install** and reset the database, wiping my in-progress Gym run (the org had changed to "Curl Up Hair Studio" and the portal container had been restarted). With operator approval I re-reset and re-drove Gym. The shared `dpf-portal`/`dpf-postgres` install is a single contended resource across sessions — a structural risk for this audit campaign, not a platform defect.
2. **Mid-run self-upgrade / deploy skew.** The portal container restarted partway through (≈03:39 UTC) and the running bundle changed. Archetypes driven **before** the restart (Yoga) show the older behaviour (Europe/London timezone, no publish-reminder banner); archetypes driven **after** (Gym redo, Dance Studio) show newer behaviour (**publish-reminder banner**, **America/Chicago** timezone). Findings below note which bundle each observation came from. This means two Run-2/3 recurring findings appear **fixed in the newer bundle** (see TIMEZONE and PUBLISH below).

---

## Run-level headline — fitness is the "Member Portal" family, and booking is broken by a seed gap

1. **Portal type is "Member Portal"** 🆕 for all three (Dashboard · Sections · **Classes & Memberships** · **Instructors** · **Bookings** · Settings). Third distinct portal type after Run 2's "Booking Portal"/"Patient Portal" and Run 3's "Academy Portal". Member/class vocabulary fitness is **good**.
2. **Financial model is Subscription + Recurring Required** for all three (fits membership billing). Storefront CTAs remain service-type-driven (Buy / Book Now).
3. **Member Portal inbox uses CLEAN operator language** 🆕 — the DPF meta-language Critical (#1752) **does NOT reproduce** on fitness. See INBOX below.
4. **Booking is broken out-of-the-box for every fitness archetype** 🆕 (Important, code-confirmed) — no default service provider is seeded, so every booking calendar is empty. Root cause is a missing `schedulingDefaults` on these templates plus a guard test that doesn't catch it. See PROVIDER below.
5. **Price-less Purchase items 404 their "Buy" CTA** 🔁 — the Run 3 driving-school finding reproduces on all three fitness archetypes. Systemic.

---

## Yoga Studio — Serenity Yoga Studio (fresh install) *(pre-restart bundle)*

**Company**: Serenity Yoga Studio · **URL slug**: serenity-yoga-studio · **Portal type**: Member Portal · **Archetype**: yoga-studio

#### AUDIT-R4-YOGA-A-001 · Pass/Observation · Subscription + Recurring Required
Payment = Subscription, Recurring = Required, Invoices = Prepared Not Prescribed, VAT = No. Base currency displayed **USD** (browser autofill from prior USD selections this session — a real operator would still see the GBP default; the GBP-default issue is unchanged, just masked by autofill here).

#### AUDIT-R4-YOGA-B-001 · Important · Portal starts Unpublished
🔁 Recurring. (No publish-reminder banner on this pre-restart bundle — contrast Gym/Dance below.)

#### AUDIT-R4-YOGA-P-001 · Pass · 6 services, mixed Purchase + Booking, matches preview
Classes & Memberships: Class Pack (10 classes) **Purchase**, Monthly Unlimited **Purchase**, Drop-in Class **Booking**, Private Session **Booking** (/session), Beginners Course **Purchase**, Retreat Day **Purchase**. The 4 Purchase items carry **no price** ("—").

#### AUDIT-R4-YOGA-F-001 · 🆕 Important · Booking flow broken — 0 providers auto-seeded, empty calendar
Instructors tab: **"Service Providers (0) — No providers yet."** Drop-in Class booking calendar renders with **every date disabled** — unbookable. (Root cause: PROVIDER finding below.) Timezone label: **"Times shown in Europe/London"** 🔁.

#### AUDIT-R4-YOGA-F-002 · 🔁 Important · Price-less Purchase "Buy" CTA → 404 order page
`/s/serenity-yoga-studio/order/itm-pJpALOVo` (Class Pack) → platform 404. Same root cause as Run 3 AUDIT-R3-DRV-F-002 (`order/[itemId]` `notFound()`s on `priceAmount === null`). Public portal shows 4 Buy + 2 Book Now; all 4 Buy items are price-less → all 404.

#### AUDIT-R4-YOGA-I-001 · 🆕 Pass · Inbox uses operator language — DPF meta-language (#1752) does NOT appear
The "Bookings" tab (`/storefront/inbox`) banner reads **"Inquiries from your storefront / Use to turn an inquiry into tracked work you can follow up on. / Send to backlog"** — clean operator language. The Run 2/Run 3 "Customer-zero inquiry intake is wired to product backlog triage … Digital Product Factory" banner is **absent**. #1752 does not reproduce on Member Portal.

---

## Gym — Iron Forge Gym (fresh install) *(post-restart bundle; re-driven after concurrent-session collision)*

**Company**: Iron Forge Gym · **URL slug**: iron-forge-gym · **Portal type**: Member Portal · **Archetype**: gym

#### AUDIT-R4-GYM-A-001 · Pass/Observation · Subscription + Recurring Required; USD (autofill)
Same fitness model.

#### AUDIT-R4-GYM-B-001 · 🆕 Pass · Publish-reminder banner present (#1770 fix landed)
Dashboard shows a banner: **"Your storefront is ready — publish it now. It is not live yet, so the public link returns a 404. Publish it so customers can find you."** with a "Publish now" button. This directly addresses the Run 2 "wizard portal starts Unpublished with no reminder" finding. (Present on the post-restart bundle; absent on Yoga's pre-restart bundle — consistent with the mid-run self-upgrade. Matches main commit "fix(storefront): prompt operators to publish their new portal (#1770)".)

#### AUDIT-R4-GYM-P-001 · Pass · 6 services, 5 Purchase + 1 Booking, matches preview
Monthly Membership **Purchase** (no price), Day Pass **Purchase** (no price), Personal Training **Booking** (/session), Annual Membership **Purchase** (no price), Student Membership **Purchase** (no price), Family Membership **Purchase** (From… — priced).

#### AUDIT-R4-GYM-F-001 · 🆕 Important · Booking flow broken — 0 providers auto-seeded
Instructors: **"Service Providers (0)."** Personal Training (the only Booking item) is unbookable. Root cause = PROVIDER finding.

#### AUDIT-R4-GYM-F-002 · 🔁 Important · Price-less Purchase "Buy" → 404
`/s/iron-forge-gym/order/itm-iFp-PxTZ` (Monthly Membership) → 404. Public portal: 5 Buy + 1 Book Now; 4 of 5 Buy items price-less → 404.

#### AUDIT-R4-GYM-I-001 · 🆕 Pass · Inbox operator language (no #1752)
Banner: **"Requests from your storefront / Use to track a customer request as work you can follow up on. / Send to backlog."** Clean. (Slightly different wording from Yoga's, but both operator-appropriate.)

---

## Dance Studio — Rhythm Dance Studio (fresh install) *(post-restart bundle)*

**Company**: Rhythm Dance Studio · **URL slug**: rhythm-dance-studio · **Portal type**: Member Portal · **Archetype**: dance-studio

#### AUDIT-R4-DANCE-A-001 · Pass/Observation · Subscription + Recurring Required; USD (autofill)

#### AUDIT-R4-DANCE-B-001 · 🆕 Pass · Publish-reminder banner present (#1770)
Same banner as Gym.

#### AUDIT-R4-DANCE-P-001 · Pass · 5 services, 4 Booking + 1 Purchase, matches preview
Term Booking **Purchase** (no price), Trial Class **Booking** (Free), Private Lesson **Booking** (/session), Drop-in Class **Booking**, Exam Preparation **Booking** (/session). **4 of 5 items are Booking-type** — the catalog is overwhelmingly booking-oriented.

#### AUDIT-R4-DANCE-F-001 · 🆕 Important · Booking flow broken — 0 providers; nearly the whole storefront is dead out-of-the-box
Instructors: **"Service Providers (0)."** All 4 Booking items render empty calendars (Trial Class calendar confirmed — every date disabled). Combined with the price-less Term Booking (Buy → 404), **all 5 storefront items are non-functional on a fresh install**. Worst case observed in the audit.

#### AUDIT-R4-DANCE-F-002 · 🆕 Pass · Booking calendar timezone is **America/Chicago** (Europe/London default appears fixed)
The Trial Class calendar shows **"Times shown in America/Chicago"** — a US timezone, NOT the Europe/London seen in every prior archetype (Runs 2–4 incl. Yoga). This is the first archetype to show a US-locale timezone. It appears on the **post-restart bundle**, so the long-standing Europe/London default (Run 2 AUDIT-R2-*-B-005, Run 3 recurring) looks **resolved in the current build**. Deploy-skew caveat: Yoga (pre-restart) still showed Europe/London this same run.

#### AUDIT-R4-DANCE-F-003 · 🔁 Important · Price-less Purchase "Buy" → 404
Term Booking (`/s/rhythm-dance-studio/order/itm-p3xDMqKM`) → 404 (price-less).

#### AUDIT-R4-DANCE-I-001 · 🆕 Pass · Inbox operator language (no #1752)
Banner: **"Requests from your storefront / … / Send to backlog."** Same clean language as Gym.

---

## PROVIDER — root cause of the broken booking flow (code-confirmed)

**Defect**: archetypes whose template lacks `schedulingDefaults` never get a default `ServiceProvider`, availability, or per-item `bookingConfig` seeded at activation — so their Booking-type items have empty calendars and cannot be booked on a fresh install.

**Evidence**:
- `apps/web/app/api/storefront/admin/setup/route.ts:168` — provider/availability/booking-config seeding is wrapped in `if (template?.schedulingDefaults) { … }`. Inside it: create `ServiceProvider` named after the org (`:174`), seed `providerAvailability` (`:217`), link the provider to **all item-level booking items** (`ctaType: "booking"`, `:222-231`), and set `bookingConfig` per item (`:234`).
- `packages/storefront-templates/src/archetypes/fitness-recreation.ts` — `gym`, `yoga-studio`, `dance-studio` define **no `schedulingDefaults`**. `education-training.ts` — `driving-school` also has none (Run 3 AUDIT-R3-DRV-F-001). Contrast: `tutoring`/`music-school` (EDUCATION_SCHEDULING), all beauty (BEAUTY_SCHEDULING), all healthcare, banking, pet-services — these DO define it and their bookings work.
- **Why the guard test misses it**: `packages/storefront-templates/src/archetypes/archetypes.test.ts:52-57` asserts schedulingDefaults only for `ALL_ARCHETYPES.filter(a => a.ctaType === "booking")` — i.e. it keys on the **archetype-level** ctaType. gym/yoga-studio/dance-studio/driving-school have a non-booking top-level ctaType but contain **item-level** booking items, so they're excluded from the assertion and pass. The provider-seeding code, by contrast, links by **item-level** ctaType. That mismatch is the gap.

**Impact**: every fitness-recreation archetype + driving-school ships a live "Book Now" button that opens a permanently empty calendar. Likely affects any other archetype with booking items but a non-booking top-level ctaType (candidates to re-check: bakery, catering, and mixed-catalog archetypes in trades/retail/etc.).

**Suggested fix (for triage)**: (a) add `schedulingDefaults` to fitness-recreation + driving-school templates (and any other archetype with booking items); (b) change the guard test to assert schedulingDefaults for any archetype with ≥1 item where `ctaType === "booking"` (item-level), not archetype-level; (c) optionally, the setup route should still create a default provider whenever booking items exist, falling back to sane 09:00–17:00 defaults if `schedulingDefaults` is absent.

---

## Run 4 Summary

| Category | Count |
|----------|-------|
| Critical | 0 (the #1752 inbox Critical does NOT reproduce on Member Portal) |
| Important | 9 (booking-broken ×3, price-less-Buy-404 ×3, Unpublished ×1 [Yoga only], + provider root cause, + GBP-masked) |
| Pass / Observation | 14 |

### NEW findings this run

1. **Member Portal** (🆕, all 3) — fitness renders a third portal type with Classes & Memberships / Instructors / Bookings nav. Answers the brief's "portal type other than Booking/Patient" watch item again.
2. **Member Portal inbox uses clean operator language** (🆕, all 3) — DPF meta-language Critical (#1752) does **not** reproduce on fitness. Inbox language is **portal-type-dependent** (Booking/Patient/Academy = DPF meta-language; Member = clean). Strong signal that the #1752 fix or template differs by portal type.
3. **Booking broken by missing `schedulingDefaults`** (🆕 Important, code-confirmed) — no default provider → empty calendars for gym/yoga-studio/dance-studio (and driving-school from Run 3). Guard test keys on archetype-level ctaType and misses item-level booking items. See PROVIDER section.
4. **Publish-reminder banner (#1770) present** (🆕 Pass) on the post-restart bundle (Gym, Dance) — addresses the Run 2 "no publish reminder" finding.
5. **Europe/London timezone appears fixed** (🆕 Pass) — Dance Studio (post-restart) shows **America/Chicago**; the long-standing Europe/London default looks resolved in the current build (Yoga, pre-restart, still showed Europe/London).

### Recurring reconfirmed
- **Price-less Purchase items → "Buy" 404** (🔁 Important) — all 3 fitness archetypes; same root as Run 3 DRV-F-002. Now confirmed across 4 archetypes (driving-school + 3 fitness) → **systemic**.
- **Subscription + Recurring Required** financial model (all 3).
- **Unpublished on create** — present on Yoga (pre-restart); **mitigated** by the publish-reminder banner on the post-restart bundle (Gym, Dance).
- **GBP default** — masked by browser autofill this session (USD pre-filled); not re-proven, not refuted.
