---
status: draft
---

# Rescue adoption that fits its locale: setup seeds an adoption policy, every adoption carries the rules it was made under

**Date:** 2026-10-28

**Status:** Draft; awaiting independent spec approval.

**Backlog:** `BI-9B6C3BFD` (umbrella, xlarge, decomposed below) under `EP-5102F494` (animal-welfare operations vertical).

**Extends:**
- `docs/superpowers/specs/2026-08-25-pet-rescue-operating-system-and-help-recovery-design.md` §6.1 (custody before placement).
- `docs/superpowers/specs/2026-09-04-bi-7111af0c-animal-intake-safety-design.md` (frozen requirement snapshots).
- `2026-09-24-jurisdiction-setup-and-coverage-gap-design.md` (BI-50DF2A92, branch `feat/jurisdiction-setup-and-coverage-gap`): the "Laws that apply" step and cited, human-confirmed `Regulation` rows.
- `2026-09-24-localization-and-multi-currency-architecture-design.md` (EP-6B33A840): org locale and currency.

**Decision:** DI-4BD7468BAC46. `principle_decide` (platform scope, elevated stakes) recommended policy packs plus an org policy plus snapshots, with high confidence and a margin of 6.0. It rejected an untyped settings page and WWWD-decisions-only.

## 1. Why

The founder, 2026-10-28:

> Every locale and its laws handle adoption differently in a real-world setting. Payments vary by location, as does the legal paperwork. Setting up a business properly at installation, in this context, has to account for the most critical part of the process, which is also how this archetype organization measures success. The instance must support what every locale has in common, whatever the detail and nuance. But we need to configure it proactively from this context, and adapt intelligently to each DPF deployment situation.

A rescue succeeds when an animal reaches a **lawful, recorded, paid-or-waived, transferred adoption**. Every locale shares that outcome. The rules that make it lawful vary by locale: documents, disclosures, adopter eligibility, veterinary preconditions, fees and tax, and return windows. Today the platform knows none of these rules. It learns them at the counter, or never.

## 2. What the walkthrough found (DEV, 2026-10-28)

The adoption was driven end to end as staff, using a newly admitted animal.

| Step | What happened | What the instance assumed |
|---|---|---|
| Intake | AN-QNUOG27S admitted, custody episode CE-A1Z0SQ3HPY opened (after the BI-6A41ADCD fix) | Intake source mode `staff-assisted` |
| Housing | Admission is refused until a kennel exists; a test kennel was added | Kennel and foster-home kinds from the archetype profile |
| Readiness | 7 evidence items plus housing, then "Verify placement readiness" | One fixed list (`pet-rescue-intake.v1`) for every org, species and jurisdiction. Vaccination is one free-text product. Sterilization must be completed or previously verified. |
| Application | AA-PE6HON7QFI recorded with five fixed screening answers | No adopter age, ID, address or contact. Questions are the same for every org. |
| Screening, meet-and-greet, home check | Two visit engagements created | Visit time stored and shown as **UTC** (the rescue is in Central time) |
| Approve and reserve | Reserved immediately | No agreement, no disclosures, no reservation expiry |
| Complete adoption | "Adoption completed. Custody is closed and the listing is withdrawn." | Fee is optional, free text, hard-coded **USD**, recorded as a donation left `pending`. No signature, no identity check. |
| After | Visits still `planned`; no follow-up scheduled | Nothing |
| Adopter side | `/s/rescue` offers enquiry only; policy page is generic | No public application, no adoption terms, no jurisdiction or return wording |

Pip shows the same pattern from another angle. Migration `20260904090000_pet_rescue_operating_system` gave legacy animals a profile but no custody, and no path existed to start one (fixed by BI-785385B4). Storefront admin still creates animals that way (BI-89A37502).

## 3. Setup → adoption gap map

**Captured at setup today:**
- Country, which sets `OrgSettings.countryCode/baseCurrency/locale` through `applyOrgCountry`.
- US state only (`BusinessContext.stateCode`).
- Compliance blocs `us|eu|uk|global`.
- Timezone (`StorefrontConfig.timezone`).
- Housing kinds (archetype activation profile).

| Adoption need | Layer | Captured at setup? | Owner after this design |
|---|---|---|---|
| A record exists for every animal in custody | core | n/a; was broken for legacy animals | BI-785385B4 (done), BI-89A37502 |
| Transfer is lawful: signed agreement + required disclosures | core mechanism / locale content | no | S4 BI-2E3CD65B; content from policy slots |
| Adopter eligibility: minimum age, identity, landlord consent | locale | no | S2 slots, S4 enforcement |
| Veterinary preconditions: sterilization (or deferred with contract), rabies by age, microchip | locale | no; fixed constants | S3 BI-78F156B6 |
| Licensing or registration on adoption (e.g. municipal pet licence) | locale | no | S2 slot, S6 seeding |
| Fee schedule, waiver reasons | locale | no; free text | S5 BI-CDCE6326 |
| Fee currency | locale (from org) | **yes, but adoption ignores it** | S1 BI-50EF15FF |
| Tax treatment and receipt type (fee vs. donation) | locale | no | S5 |
| Payment method and processor | locale; operator decision | no | S5 (decision stays with the operator) |
| Legal entity and charity status | locale | no | BI-9BD41BE1 (L1.0 LegalEntity), read by S6 |
| Sub-national jurisdiction (state/province, county, municipality) | locale | US state only | BI-50DF2A92 `operatingSubdivisions` (ISO 3166-2) |
| Cooling-off and return window, refund rule | locale | no | S2 slot, S7 |
| Reservation hold window | locale (org practice) | no | S2 slot, S7 |
| Post-adoption follow-up schedule | org practice | no | S2 slot, S7 |
| Record retention period | locale | no | S2 slot; enforcement out of scope (§8) |
| Reporting to authorities (e.g. intake/outcome statistics, bite reports) | locale | no | S2 slot; reporting out of scope (§8) |
| Visit scheduling in local time | core | timezone captured, adoption ignores it | BI-86997C0B |

Of the 17 needs, setup captures one fully (housing kinds). It captures two partially (currency and US state), and adoption ignores even those.

## 4. Common core vs. locale layer

**Common core.** Platform code, the same in every deployment:
1. An animal is in recorded custody (episode open) before it can be placed.
2. It meets the readiness requirements frozen on its intake checklist.
3. An application records the adopter and screening answers the policy requires.
4. Approval reserves the animal for one applicant, under a hold window.
5. Transfer requires every document, disclosure and attestation the policy snapshot requires, then closes custody and records the outcome.
6. The fee is due, paid or waived with a reason, in the org currency, and paid money reaches Finance.
7. Follow-ups and returns are scheduled and recorded under the snapshot's windows.

**Locale layer.** Data, not code: the values in each rule slot, the agreement and disclosure templates, the fee schedule, and the payment arrangement. Each value carries its provenance.

The core never branches on a country code. It reads slots.

## 5. Design

### 5.1 What exists and is reused, not rebuilt

- **Requirement snapshot pattern.** `buildAnimalIntakeRequirementSnapshot` and `placement-readiness.ts` already freeze requirements and honour `required`. S3 changes only where the list comes from.
- **Jurisdiction capture and cited law.** BI-50DF2A92 already provides `operatingSubdivisions`, `Regulation.provenance/reviewState`, the propose-then-human-confirm rule, and the "Laws that apply" step owned by the Compliance Officer. This design consumes confirmed `Regulation` rows and does not add a second law store.
- **Org locale.** `resolveOrgLocale` and `getOrgBaseCurrency` (EP-6B33A840) supply currency, locale and timezone.
- **Documents.** The office document engine renders the agreement.
- **Money into Finance.** BI-D649585A carries a paid fee or donation into Finance.
- **The skill and gates.** `jurisdiction-layered-requirement-read` (recurring legal-ops read) and `check-archetype-completeness.mjs` gain a policy-coverage dimension in S6.

### 5.2 `AdoptionPolicy` and its rule slots (S2)

One `AdoptionPolicy` per org (archetype `pet-rescue`). It holds typed **slots**. Each slot holds `value`, `provenance` (`generic_default | operator_attested | regulation`), an optional `regulationId` (a confirmed BI-50DF2A92 row), `confirmedByUserId` and `confirmedAt`.

| Slot group | Slots |
|---|---|
| Eligibility | `adopterMinimumAge`, `identityRequired`, `identityDocumentKinds[]`, `landlordConsentRequired`, `screeningQuestions[]` |
| Readiness (per species) | `requirements[]` (key, required, evidence fields), `sterilization` (`required` / `deferred-with-agreement` / `not-required`), `rabiesFromAgeWeeks`, `microchipRequired` |
| Documents | `agreementTemplateRef`, `disclosures[]` (key, text ref, required), `signature` (`adopter` / `staff-witnessed`) |
| Money | `feeSchedule[]` (species, age band, amount), `waiverReasons[]`, `receiptKind` (`fee` / `donation`) |
| Holds and windows | `reservationHoldDays`, `coolingOffDays`, `returnRefundRule`, `followUpScheduleDays[]` |
| Records and reporting | `retentionYears`, `reportingDuties[]` (name, authority, cadence, `regulationId`) |

**The `pet-rescue-adoption.v1` generic pack** supplies the slot structure, conservative defaults (e.g. ID required, signature required, sterilization required) and a placeholder agreement. Every default is labelled "generic default — not confirmed for your jurisdiction". **No pack claims what any jurisdiction's law is.** This follows BI-50DF2A92 §4.6: law enters only through operator attestation or cited research that a human confirms.

Later packs (`pet-rescue-adoption.v1+<ISO 3166-2>`) are bundles of *references to confirmed `Regulation` rows plus suggested slot values*. They are produced by the research path, not shipped as platform assertions. A pack can be shared through the Hive only after human confirmation (out of scope here).

**Snapshots.** An `AnimalAdoptionApplication` freezes `policySnapshot` (slots + pack version + policy version) at submission. The intake checklist already freezes its requirements. An open application keeps its rules when the policy changes. That is the adopter's protection and the audit trail.

### 5.3 Proactive configuration at installation (S6)

Order, for a pet-rescue archetype:

1. **Business context** captures country, which sets currency, locale and timezone (BI-6982F7D9 fixes country not reaching OrgSettings).
2. **Laws that apply** (BI-50DF2A92) confirms the footprint (ISO 3166-2). The Compliance Officer asks what the operator already knows, and offers cited research.
3. **How you place animals** is new. It walks the AdoptionPolicy slots in plain language, one group per screen. Each slot is prefilled in this order:
   - from a confirmed `Regulation` that applies, where one exists;
   - otherwise from the operator's answer;
   - otherwise from the generic default.

   The step:
   - asks for legal entity and charity status, read from or written to the L1.0 `LegalEntity` (BI-9BD41BE1);
   - asks for the fee schedule;
   - asks whether to take payments, and which way. It records the operator's answer and never picks a processor.
   - offers to draft the agreement from the slots for the operator to edit and confirm.
4. **Skipping is allowed and visible.** Unconfirmed slots appear on the rescue cockpit and the setup checklist as "N adoption rules still on generic defaults". A skip never reads as a pass.

An install that finished setup before this change gets the generic pack and the same visibility, and has a permanent page for the step.

### 5.4 Enforcement in the adoption path (S3, S4, S5, S7)

Each rule is enforced at the step that needs it, reading the snapshot. Refusals show the reason (the BI-785385B4 lesson).
- **S3:** readiness requirements come from the policy.
- **S4:** completion requires the rendered agreement, the required disclosures acknowledged, identity and age attested per slot, and a signature.
- **S5:** the fee is due, paid or waived with a reason, in org currency. Paid fees settle into Finance.
- **S7:**
  - visits close when the adoption completes or is cancelled;
  - follow-ups are scheduled from `followUpScheduleDays`;
  - reservations past `reservationHoldDays` surface as overdue;
  - returns record whether they fall inside `coolingOffDays`.

## 6. Research and benchmarking

- **Comparable systems:**
  - Shelterluv and PetPoint (shelter management) keep adoption contracts as org-edited templates with merge fields, plus per-org fee tables.
  - RescueGroups.org exposes adoption fees and requirements per animal and per org.
  - None of them encodes jurisdictional law. They leave it to the org.

  DPF adopts the template + fee-table shape and the per-record snapshot. DPF rejects "leave it entirely to the org" because the founder requires proactive configuration. The proactive part is done through cited, human-confirmed research (BI-50DF2A92), not through platform-asserted law.
- **Standards:**
  - ISO 3166-1/3166-2 for jurisdiction;
  - ISO 4217 for currency;
  - IETF BCP 47 for locale;
  - Shelter Animals Count basic data matrix as the reference shape for `reportingDuties` (US; other countries supply their own).
- **Rejected:**
  - An untyped "adoption settings" page. It scored lower: it gives no provenance, no snapshot, and pushes high cognitive load onto the operator.
  - Answering each rule as a WWWD decision at adoption time. That is not legible to staff, has no frozen record, and the record is what the adopter's protection depends on.

## 7. Objectives and acceptance

| Objective | Criterion | Evidence |
|---|---|---|
| OBJ-1 Core outcome | A fresh install completes intake → readiness → application → approval → agreement → fee (paid or waived) → transfer, and custody closes with outcome `adoption` | Live run on DEV, plus a unit test per command |
| OBJ-2 Locale from setup | After "How you place animals", every slot has a provenance. Slots with an applicable confirmed `Regulation` cite it. | DB read of `AdoptionPolicy`; setup step test |
| OBJ-3 Rules travel with the record | Changing the policy does not change an open application's rules; the snapshot shows the pack and policy version | Unit test |
| OBJ-4 Two jurisdictions | Two fixture jurisdictions (`XX-AA`, `XX-BB`, synthetic authorities) produce different readiness lists, agreements and fees, and both complete | Test; no real law asserted |
| OBJ-5 Money is right | The fee is in org currency, and a paid fee reaches Finance with the policy's receipt kind | Test plus live check after BI-D649585A |
| OBJ-6 Gaps are visible | Skipped or default slots are counted on the cockpit and setup checklist | UI test |

## 8. Out of scope

- Enforcing record retention (purging) and filing reports to authorities. The slots record the duty; execution is a later slice.
- Choosing or integrating a payment processor. That is the operator's financial decision, and S5 records it.
- Hive sharing of confirmed jurisdiction packs.
- The public adopter application and front door (BI-46437AEF, BI-3B82A5DD). They will read the same policy.

## 9. Delivery slices

| # | Slice | Backlog | Shape | Rank | Depends on |
|---|---|---|---|---|---|
| S1 | Adoption reads org currency | BI-50EF15FF | small | blocks | none |
| S2 | `AdoptionPolicy`, generic pack v1, application snapshot | BI-4D8ACB34 | medium (migration) | blocks | none |
| S3 | Readiness from policy | BI-78F156B6 | medium | degrades | S2 |
| S4 | Agreement, disclosures, identity before transfer | BI-2E3CD65B | medium | blocks | S2 |
| S5 | Fee schedule, waiver, settlement | BI-CDCE6326 | medium | degrades | S2, BI-D649585A |
| S6 | Setup step "How you place animals" + permanent page + completeness-gate dimension | BI-EA2DE491 | medium (UI) | blocks | S2, BI-50DF2A92 S2–S5, BI-9BD41BE1 |
| S7 | Reservation expiry, visit closure, follow-ups, cooling-off | BI-1364908D | small | degrades | S2 |

Related defects found in the same walkthrough:
- BI-86997C0B: visit times shown in UTC.
- BI-89A37502: storefront admin creates pre-custody animals.
- BI-6490C5BC: suspected transition bypass of placement; to be reproduced first.

## 10. Decisions for the founder

These are the only decisions this design leaves for the founder:
1. **Which jurisdictions to model first.** These are the first confirmed packs the research path should produce, e.g. Texas plus one non-US jurisdiction.
2. **Whether DPF should offer a payment processor integration at all** for adoption fees, or only record payments taken elsewhere. This is a financial and vendor decision.
