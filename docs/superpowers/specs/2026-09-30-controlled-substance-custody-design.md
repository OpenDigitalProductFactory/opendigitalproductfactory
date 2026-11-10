---
status: draft
---

# Controlled-Substance Custody — Shared Design

**Date:** 2026-09-30
**Status:** Proposed. Needs DPF architecture review, plus a review of the rule text by a licensed
practitioner and a compliance reviewer, before any archetype tells customers it complies.
**Epic:** `EP-CSC-CUSTODY` (filed with this design)
**Scope:** Common substrate used by every archetype that holds controlled drugs:
`healthcare-wellness/*` (medical, dental, veterinary, home health), shelter and rescue
(euthanasia solution), and mobile veterinary services.
**Consumers:** the veterinary design's pharmacy and controlled-drug slice (its §14 traceability table), the pet-rescue
operating model (§4 controlled-substance log), and the workforce staffing design
(named-capability presence for an authorized key-holder).

## 1. Problem

Three archetypes need a legally defensible controlled-drug record, but none exists. The
platform has no medication, lot, movement or controlled-substance model.
`StockItem` holds a quantity snapshot only, so it "cannot prove lot, expiry, custody,
recall, administration, wastage, or controlled balances" (veterinary design §6). The
only shipped provision is an annual reminder to renew registrations
(`packages/db/src/seed-vertical-recurring-compliance.ts`). Customers in these archetypes
still keep a paper or spreadsheet register outside DPF, and if that register fails to
balance, the consequence is criminal, not just administrative.

The veterinary design already sets out the target behaviour for one leaf: an append-only
ledger with witness, before/after balance, reverse-and-restate correction, and count
snapshots. If each archetype built its own, the platform would hold three ledgers that
contradict each other. This design defines **one** custody substrate that each archetype
composes.

## 2. Regulatory baseline (US federal first)

Rules are carried as configuration and evidence requirements, effective-dated, and are
never hardcoded as universal truth. US federal (DEA, 21 CFR) is the first profile. State
overlays (for example Illinois 77 IAC 3100 annual inventory) and non-US regimes (for
example the UK Misuse of Drugs Regulations 2001 register) are separate profiles,
described in §9.

| Obligation | Source | Design consequence |
|---|---|---|
| Complete, accurate, current record of every substance received, dispensed, or otherwise disposed of, wastage included | [21 CFR 1304.21(a)](https://www.law.cornell.edu/cfr/text/21/1304.21) | Every quantity change is a ledger movement. The record has no "silent adjust" path. |
| Separate records for each registered location | [21 CFR 1304.21(b)](https://www.law.cornell.edu/cfr/text/21/1304.21), [1304.04](https://www.law.cornell.edu/cfr/text/21/1304.04) | A **register** is bound to one registration (organization or practitioner licence record) and one site. |
| Dispenser record contents: name, form and strength, units received with date and supplier, units dispensed or administered with patient, date, and dispenser | [21 CFR 1304.22(c)](https://www.law.cornell.edu/cfr/text/21/1304.22) | Movement carries product, quantity, counterparty, patient, occurred-at, and actor. These are required by kind and refused when absent. |
| Initial inventory and a new inventory at least every two years; exact count for Schedule I/II; estimate allowed for III–V unless an opened container holds more than 1,000 units; record whether taken at opening or close of business | [21 CFR 1304.11](https://www.law.cornell.edu/cfr/text/21/1304.11) | A **count** is a first-class record (kind, timing, method per line). The exact-versus-estimate rule is enforced, and the biennial due date is computed. |
| Schedule I/II records kept separate; III–V separate or readily retrievable; retained at least 2 years | [21 CFR 1304.04](https://www.law.cornell.edu/cfr/text/21/1304.04) | Ledger reads filter by schedule class. Retention is `retained` with a statutory basis. The platform keeps 7 years, because state rules and the clinical record often exceed the federal minimum. |
| Destruction witnessed by two employees and recorded (DEA Form 41); exception for an unusable remainder of a dose for immediate administration, which is recorded under ordinary record-keeping | [21 CFR 1317.95](https://www.law.cornell.edu/cfr/text/21/1317.95), [1304.21(e)](https://www.law.cornell.edu/cfr/text/21/1304.21) | `destruction` requires a witness who is a different, authorized person, and a document reference. `waste` (partial-dose remainder) records the remainder; its witness requirement is policy, defaulting to required for Schedule II. |
| Theft or significant loss: written notice to DEA within one business day of discovery; DEA Form 106 within 45 days | [21 CFR 1301.76(b)](https://www.law.cornell.edu/cfr/text/21/1301.76) | A **discrepancy case** classed as suspected theft or significant loss carries both computed deadlines and a refusal to close without their evidence. |
| Physical security; access limited to authorized persons | 21 CFR 1301.71–1301.76 | Each register has an **authorized handler list** (who may receive, administer, waste, witness, count, reconcile), effective-dated. Staffing reads it for key-holder presence. |

**Claim boundary.** DPF supplies records, controls, and deadlines. The registrant remains
responsible for registrations, applicability, policy, and filing with the regulator. DPF
does not file DEA forms; it records their references. This design is not legal advice.

## 3. Research & Benchmarking

| System | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| [OpenEMR Pharmacy Dispensary module](https://www.open-emr.org/wiki/index.php/Pharmacy_Dispensary_Module) | Drug catalog, inventory lots per warehouse, sales (dispense) and adjustment transactions against lots. Community add-ons add serialized and DEA-schedule handling. | Product catalog separate from lot movements; dispense linked to patient. | Lot quantity held as an editable column and adjustments that rewrite it. There is no first-class witness or two-person control. |
| [OpenMRS OpenHMIS Inventory](https://openmrs.atlassian.net/wiki/x/IoWEAQ) | Items, stockrooms, and typed stock operations (receipt, distribution, transfer, adjustment) with an operation history. | Typed operations per stockroom (our register); operation history as the source of truth. | Generic adjustment without a reason or witness; no regulated count semantics. |
| [Odoo Inventory](https://www.odoo.com/documentation/latest/applications/inventory_and_mrp/inventory.html) (stock moves and quants) | Completed stock moves are history; on-hand quants are derived; returns create new reverse moves; physical inventory produces adjustment moves. | **Movements are history and balances are derived; corrections are new reverse movements; a physical count produces explicit variance.** | Count variance auto-posting as a silent adjustment. In a controlled register, variance opens a case first. |

Commercial veterinary controlled-drug registers (for example Vet S8) confirm the operator
expectations: chronological entries, witness on waste, and running balance. They do not
change the design.

**Net:** adopt the moves-and-derived-balance model from Odoo and typed operations per
stockroom from OpenMRS. Add what none of the three provides: database-enforced
append-only history, a tamper-evident hash chain, witness and authority gates, and
regulated count and loss-reporting clocks.

## 4. Existing substrate reused (no parallel stores)

| Need | Authority reused |
|---|---|
| Tenant | `Organization` |
| People, coworkers, witnesses | `Principal` |
| Registrant (DEA registration) | `OrganizationLicenseRecord` (institutional) or `PersonLicenseRecord` (practitioner). Exactly one per register. The registration number, expiry and renewal live there, never copied. |
| Site | `CareLocation` (optional; shelters without a care site use an organization-level register with a storage label) |
| Patient | `PatientProfile` (human, and veterinary animal per DI-8BCD8C073E0D) or `AnimalProfile` (shelter animal). A movement names at most one, by real foreign key, never by a free-text subject ref. |
| Row lifecycle | `RecordLifecycle` enum convention |
| Physical general stock | Not reused. `StockItem` stays a retail snapshot. The future physical stock-lot ledger (veterinary design §7) may *project* from controlled movements, never the other way around. |

## 5. Data contract

All models are organization-scoped and carry semantic ids (`CSP-`, `CSR-`, `CSM-`,
`CSC-`, `CSD-`, `CSA-`).

- **`ControlledSubstanceProduct`**: org catalog entry. Name, active ingredient,
  strength, dosage form, `schedule` (enum, US federal first), optional NDC, `baseUnit`
  (enum), optional container size, `wasteWitnessRequired` (policy; default true for
  Schedule II), lifecycle.
- **`ControlledSubstanceRegister`**: the custody account. Binds organization, exactly
  one registrant licence record (database CHECK), optional `CareLocation`, and a storage
  label ("Safe A", "Euthanasia lockbox"). Balances are per register and product.
- **`ControlledSubstanceHandlerAuthorization`**: who may do what on a register.
  Principal, scope (enum: receive, administer, dispense, waste, witness, transfer,
  destroy, count, reconcile), granted by, effective from/to. Revocation sets `effectiveTo`.
  Effective-dated rows are kept.
- **`ControlledSubstanceMovement`**: **append-only** (database trigger refuses UPDATE
  and DELETE). Per (register, product): a monotonic `sequence` (unique, which acts as an
  optimistic lock), `kind` (enum), signed `quantityDelta`, `balanceBefore`,
  `balanceAfter`, lot and expiry, `occurredAt`, `recordedAt`, actor, witness,
  patient (`patientProfileId` or `animalProfileId`, at most one — database CHECK),
  counterparty name and registration, `documentRef` (invoice, Form 222/CSOS,
  Form 41, Form 106), reason, `reversesMovementId` (unique: a movement is reversed at most
  once), `countId`, `discrepancyId`, `previousHash`, and `entryHash` (SHA-256 chain).
- **`ControlledSubstanceCount`** and **`ControlledSubstanceCountLine`**: **append-only.**
  Kind (initial, biennial, state annual, periodic, shift change, discrepancy recount,
  newly controlled), timing (opening or close of business), taker, witness, and per
  line expected, counted, method (exact or estimated), and variance.
- **`ControlledSubstanceDiscrepancy`**: case record (mutable workflow). Source count line
  or movement, variance, classification (unexplained variance, recording error, suspected
  theft, significant loss, breakage or spill), status following the veterinary design's
  discrepancy lifecycle (detected → contained → investigating → adjustment approved or
  escalated → reconciled → closed; detection never auto-adjusts the ledger), the DEA
  notice deadline and the
  evidence that notice was given, the Form 106 deadline and its reference, resolution, and
  resolver. Closing a theft or loss case without both evidences is refused in the domain
  layer.

Organization isolation is enforced primarily by the custody commands, which scope every
read and write to the caller's organization, and by composite `(id, organizationId)`
foreign keys, which the database enforces for every role. Every table also carries a FORCE
row-level-security policy on `app.organization_id`, matching the care tables, as defense in
depth. That policy binds only roles without `BYPASSRLS`. The portal's runtime role is
currently a superuser, so the policy does not filter at runtime until `BI-30EA38F7` moves the
portal to a non-bypassing role. Every relation uses `onDelete: Restrict`; retained evidence is
never cascaded away. Metadata: `@dpf lifecycle=regulated-record retention=retained
basis=21_CFR_1304.04 minYears=7 sensitivity=confidential`.

## 6. Ledger invariants (domain layer, pure and tested)

1. Sign by kind: receipt and transfer-in are positive. Administration, dispense, waste,
   return to supplier, transfer out, destruction and loss/theft are negative.
   Count adjustment is either sign and must cite a count and a discrepancy.
   A reversal is the exact negation of its target.
2. A balance never goes below zero. A negative result is refused, and the attempt
   points to a discrepancy.
3. Required fields by kind: administration and dispense need a patient (1304.22(c)).
   Receipt, return, and transfers need a counterparty and document. Destruction needs a
   witness and a document. Loss/theft needs a discrepancy.
4. Witness: required for destruction, for count adjustments, and for waste when the
   product policy says so. The witness must differ from the actor, and must hold the
   `witness` scope on the register at `occurredAt`.
5. Authority: the actor must hold the scope matching the movement kind at `occurredAt`.
   AI coworkers can never hold scopes (principal kind check). Break-glass never grants a
   scope.
6. Corrections reverse and restate. A wrong entry is never edited; a reversal movement
   cites it, and a new correct movement follows.
7. Tamper evidence: `entryHash = sha256(previousHash || canonical(movement))`. A
   verifier recomputes the chain per register and product and reports the first break.

## 7. Counts and reconciliation

- The method rule is enforced: Schedule I/II requires exact. III–V may estimate unless the
  container holds more than 1,000 units.
- A count line's variance is counted minus the ledger balance as of the count. A non-zero
  variance opens a discrepancy case, which may only be cleared by an explained count
  adjustment with a witness, or classified as loss or theft.
- Due dates: initial when the first register is opened; biennial at 2 years after the
  last initial or biennial count; state annual per overlay. Overdue counts are an
  attention signal, not a hard block on dispensing.

## 8. Loss and theft clock

For suspected theft or significant loss, the notice is due by the end of the next
business day after discovery (Saturday, Sunday and configured holidays skipped), and
Form 106 is due 45 calendar days after discovery. Significance factors
(1301.76(b)(1)–(6)) are captured as a checklist on the case. The classification is a
human judgment, recorded with its rationale.

## 9. Out of scope for the first slices (separate BIs)

- Portal UI (register view, movement entry with witness confirmation, count sheet,
  discrepancy queue) behind the UX gate.
- Advise-safe MCP read tools for coworkers (balances, overdue counts, open cases). No
  write tool is advise-safe here.
- Jurisdiction overlays: state annual inventory, state wastage witness rules, UK register.
- Ordering (DEA Form 222 / CSOS), e-prescribing of controlled substances (EPCS), and
  state prescription-monitoring program checks.
- Archetype composition: veterinary encounter and procedure wiring (veterinary design pharmacy slice), the
  shelter euthanasia workflow, medical-practice dispensing, the staffing key-holder
  presence rule, and seeded compliance obligations for counts.
- Licensed SME and compliance validation of the rule text before customer-facing claims.

## 10. Acceptance criteria (substrate slices)

- **AC-CSC-001** History cannot be changed: an UPDATE or DELETE on movement, count, or
  count-line rows fails at the database.
- **AC-CSC-002** Every movement that would break an invariant in §6 is refused with a
  typed reason, and no row is written.
- **AC-CSC-003** The balance after N movements equals the sum of deltas, and the hash
  chain verifies. Tampering with any field is detected by the verifier.
- **AC-CSC-004** The count method rule and variance-to-discrepancy behaviour hold for
  each schedule class.
- **AC-CSC-005** The loss/theft deadlines compute correctly across weekends and
  holidays, and closing a case without notice and Form 106 evidence is refused.
