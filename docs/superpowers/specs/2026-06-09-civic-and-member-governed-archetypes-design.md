# Civic & Member-Governed Archetypes Design

**Date:** 2026-06-09
**Status:** Draft — pending operator review (enterprise-architecture review pass applied 2026-06-09; substrate + overlap verified against `origin/main` @ 60ecf228e)
**Author:** Claude with user direction (Mark Bodman)
**New archetypes:** `cooperative`, `small-town-municipality`, `municipal-utility`, `law-enforcement-agency`; **governance/finance/compliance deltas onto** `community-bank`, `credit-union` (leaves defined by the BIAN spec below)
**Related docs:**
- `docs/superpowers/specs/2026-06-09-bian-banking-archetypes-design.md` + `docs/superpowers/plans/2026-06-09-bian-banking-archetypes.md` (**landed on main the same day, PRs #1680/#1683, BI-5D9DCDE6** — owns the `banking-financial-services` category and the `community-bank`/`credit-union`/`mortgage-lending` leaf definitions; this spec layers on top, see §6.4/§7)
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md` (canonical axes/portfolio/capability contract)
- `docs/superpowers/specs/2026-06-04-partner-reseller-archetype-identity-design.md` (precedent for adding a second party type)
- `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md`
- `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md`
- `docs/superpowers/specs/2026-05-11-licensing-permit-jurisdiction-readiness-design.md` (jurisdiction/permit substrate this spec consumes)
- Related epics: `EP-ARCH-8D4F2A` (Archetype Model V2), `EP-LIC-C64FC2` (licensing/permit/jurisdiction readiness), `EP-PARTNER-CHANNEL`, `EP-SBO`

## 1. Problem Statement

DPF ships 45 archetypes across 12 categories (plus the three `banking-financial-services` leaves specified by the landed BIAN spec, implementation pending), all of which assume an **investor-owned business serving customers by contract**. Six large, badly underserved verticals do not fit that assumption:

1. **Community banks** — customers by contract, but with a regulator-defined operating model (call reports, exams, board committees) and an inverted balance sheet.
2. **Credit unions** — the served party is a **member-owner**: field-of-membership eligibility, one-member-one-vote, elected volunteer board, dividends on shares.
3. **Cooperatives** (ag, electric, consumer/food, housing, worker) — the member is simultaneously owner, patron, and governor; patronage allocation and equity retirement are the heart of the back office.
4. **Small towns / municipalities** — the served party is a **resident by jurisdiction**: the town cannot refuse or "churn" a resident; statutory rights (records access, due process, equal treatment) attach; finance is GASB fund accounting with budget-to-actual as the core statement.
5. **Municipal utilities** (water, sewer, electric, gas) — residents become **ratepayers** with utility accounts; rates are set in public session; compliance calendars (sampling, CCR, NPDES) drive operations.
6. **Police / law enforcement** — the served party may be a victim, witness, suspect, or arrestee, each with distinct statutory rights; CJIS is the architectural gate.

Citizens and members are different from business customers — but have many of the same needs (requests, accounts, billing, communication, portals). The platform shape must flex: who the served party is, how governance works, how money works, and which compliance regime applies are all archetype-driven.

The existing substrate is closer than it first appears (HOA already has members-ish homeowners, recurring assessments, board+contractors vocabulary; the compliance schema already has Regulation/Obligation/Control/Evidence/Audit/Submission; EP-LIC-C64FC2 covers permits/jurisdiction). The gap is a **governance dimension** and a **served-party generalization** that the current axes don't express.

**Same-day overlap (resolved in this spec):** the BIAN banking-archetypes spec landed on `main` 2026-06-09 (PRs #1680/#1683) and already defines the `community-bank` and `credit-union` **engagement-layer leaves** — storefront items grounded in BIAN v14 Service Domains, member vocabulary, KYC posture, and a required jurisdiction/charter onboarding step on the licensing substrate. For those two archetypes this spec therefore contributes only what the BIAN spec deliberately left out: the `governance` axis value, `member-governance` machinery (credit union), `ledgerModel: financial-institution`, and the recurring-obligation compliance packs. Verticals 1–2 in the list above are read as "the leaf exists; the governance/finance/compliance machinery does not."

## 2. Live Backlog Context

Live MCP reads on 2026-06-09:

- `EP-ARCH-8D4F2A` "Archetype Model V2: Unified Business Archetypes" — in-progress (3 items). This spec's substrate work belongs under or beside it; do not fork a parallel archetype-model effort. **BI-5D9DCDE6 (BIAN banking archetypes, spec + plan landed 2026-06-09) sits under the same epic** — the banking halves of this spec are deltas onto that work, sequenced after its Phase 1 wiring lands (§12).
- `EP-LIC-C64FC2` "Licensing / Permit / Jurisdiction readiness foundation" — in-progress. Municipal permits/licenses must build on this, not a new permit substrate; the BIAN spec's §9 already establishes the pattern of archetype-required jurisdiction capture on this substrate.
- `EP-PARTNER-CHANNEL` — in-progress; established the precedent for introducing a new party type (PartnerContact) and deriving identity surfaces from axes rather than archetype-id conditionals.
- `EP-SBO` (Small Business OS parity) and `EP-CRM-MKT-OPS` — the customer-account substrate these archetypes will re-skin.
- Recent landed substrate: business capability perspectives (#1196), archetype-aware supplier stance (#1376), WWWD archetype-intelligent seed (#1369), portfolio wiring (`EP-BOM-WIRING`).

Planning implication: this is **axis-value and capability work on the existing archetype contract**, plus a small number of genuinely new capability modules (member governance, public-body governance, fund-accounting finance profile, compliance packs). No new archetype engine.

## 3. Research & Market Scope

Full research with citations gathered 2026-06-09 (FDIC/NCUA/Census/BJS/EPA/APPA/USDA primary sources). Summary:

### 3.1 Market size — the long tail nobody serves

| Vertical | US entity count | Dominant size class | Incumbents & price floor | Whitespace |
| --- | --- | --- | --- | --- |
| Community banks | 3,909 (90% of all FDIC charters) | $200M–$500M assets, 30–150 staff | Fiserv/Jack Henry/FIS own the core ledger; GRC point tools | Around-the-core ops: exam findings, policies, vendor due diligence, board packets |
| Credit unions | 4,287 federally insured; 144.7M members | Half of shrinking CUs < $50M assets; "small" = < $100M | Symitar/Fiserv/Corelation cores | Same seam + member-governance machinery (elections, annual meeting, supervisory committee, DOR tracking) |
| Cooperatives | ~30,000 (1,647 ag; ~832 electric; ~5,000 food; 751–1,300 worker; 1.2M+ housing-co-op families) | 5–200 employees typical | NISC/Meridian (electric CIS), AGRIS (ag); **nothing** for worker/consumer/housing | Strongest whitespace: patronage/equity lifecycle + governance has no horizontal product |
| Municipalities | 19,491 municipal + 16,214 township | **84% under 10k population**; 1–3 admin FTE typical | Tyler (six figures); point tools $3.5k–35k/yr | ~16,000 towns on spreadsheets/paper |
| Municipal utilities | ~2,000 public power + ~50,000 community water systems + ~1,000 public gas + ~900 electric co-ops | **81% of water systems serve ≤ 3,300 people** | Tyler/Harris CIS mid-market; Muni-Link et al. billing-only | ~40,000 small systems with no integrated ops + compliance + billing |
| Law enforcement | 17,541 agencies (~11,800 PDs, ~3,000 sheriffs) | **75% < 25 sworn; ~half < 10** | Motorola/CentralSquare/Axon per-seat contracts | ~13,000 small agencies on paper/Excel; CJIS is the design gate |

Combined: **>100,000 organizations**, overwhelmingly small, all priced out of their vertical incumbents, all running the business around their core system in spreadsheets. An open-source, self-hosted, AI-native platform where the AI coworker compensates for the 1.5-FTE office is structurally suited to exactly this tail — and self-hosting is an *advantage* in the CJIS/public-records contexts where cloud vendors struggle.

### 3.2 The two structural clusters

Research converged on two governance shapes that cut across the six verticals:

**Member-governed** (credit unions + all co-op types): member = owner + patron + governor. One member one vote, elected board, annual meeting, member eligibility rules, patronage/dividends, member equity subledgers. Credit unions are the most homogeneous (one regulator, one call report, one vocabulary) — easiest to ship first.

**Jurisdiction-governed** (towns, utilities, police): served party = resident/ratepayer/citizen by residency, not contract. Public-body governance (open-meetings law, agenda/minutes, public records requests), GASB fund accounting, statutory due process. Utilities and police are specializations layered on the municipal base (enterprise-fund rates and CJIS-grade posture respectively).

**Community banks** are the outlier: customer-by-contract like existing archetypes, plus a heavy regulatory overlay and financial-institution finance model. They share the compliance pack pattern with credit unions and the board-governance machinery with both clusters.

### 3.3 Universal wedge

In every one of the six verticals, the core system of record (core banking ledger, utility CIS, police RMS/CAD) is owned by an incumbent and is **out of scope** — consistent with the platform principle that DPF is a conduit, not a replacement for the customer's core. What no incumbent owns: exam/audit findings remediation, policy & training management, board/council governance workflow, records/FOIA lifecycle, compliance calendars, vendor due diligence, projects, communications. That seam is DPF's existing strength.

## 4. Design Goals

1. Express "who is the served party" and "how is the org governed" as **operating-model axes**, so the six archetypes fall out of the rules engine — zero archetype-id conditionals in feature code.
2. One **member-governance capability** shared by credit unions and all co-ops (and available to fitness/sports-club/HOA archetypes that are already member-flavored).
3. One **public-body governance capability** (agendas/minutes/open-meetings/records-requests) shared by towns, utilities, police — and reusable by any future public-sector archetype (schools, libraries, fire districts).
4. Finance profiles that can express **fund accounting** (budget-to-actual, funds as the first-class dimension), **financial-institution** ledgers (NIM/ACL shape, call-report mapping), and **cooperative equity** (patronage, allocated equity) without disturbing the commercial default.
5. Compliance packs seeded through the **existing** Regulation/Obligation/Control substrate (BSA/AML, NCUA, FDIC, SDWA, open-meetings/public-records, POST/CJIS) — per-archetype seed data, not new schema.
6. Stay out of core-of-record scope: no core banking ledger, no CAD/dispatch, no NCIC integration, no meter-data management in v1. Explicitly: **no CJI (criminal justice information) storage in Phase 1** of the police archetype — agency ops around the RMS first, CJIS-aligned controls as a stated later gate.

## 5. Non-Goals

- Core banking / share-account ledger, loan origination or servicing (banks, CUs).
- Utility meter-data management, AMI head-end, outage management (SCADA-adjacent).
- CAD/dispatch, NCIC/state hot-file integration, evidence digital-asset storage (BWC video).
- Citizen-facing tax payment / court fine payment rails in the first slice (payment *records*, yes; processor integrations later).
- Multi-jurisdiction consolidation (one install = one org stands: a county hosting multiple towns is out of scope, consistent with single-org-per-install).
- Election/voting machinery for *public* elections (member-governance elections for boards are in scope; municipal ballot elections are not).

## 6. Core Architecture Decision

### 6.1 Two new axis values + one new axis

Per the §6.5 contract in the 2026-05-22 spec, new archetype behavior enters through axis vocabulary, proposed first as workbook column updates:

**Extend `primaryConsumer`** (workbook col *Primary External Consumer*) with:
- `member` — served party is an owner-patron with governance rights (credit union, co-op; HOA may migrate here later).
- `resident` — served party is defined by jurisdiction, with statutory rights and universal-service obligation (town, utility, police).

**Add new axis `governance`** (new workbook column *Governance Model*):
- `investor-owned` (default; every existing archetype normalizes here)
- `member-owned` — elected board from membership, annual meeting, one-member-one-vote
- `public-body` — council/elected board, open-meetings and public-records law, fund accounting

`governance` is orthogonal to `primaryConsumer` and the matrix has real off-diagonal cells, which is why it must be its own axis and not inferred: a **community bank** is `investor-owned` + serves `individual`/`business` customers but still needs heavy board-committee governance via its compliance pack; an **electric co-op** is `member-owned` + serves `member` ratepayers with usage-based billing; a **municipal utility** is `public-body` + serves `resident` ratepayers with the same usage-based billing.

Rules-engine derivations (additive; existing rules untouched):

- `governance === "member-owned"` → `member-governance.applicability = required` (board, committees, elections, annual meeting, member-eligibility), `member-equity.applicability = recommended` (required for co-ops via `commercialModel = patronage`-bearing profiles), vocabulary base switches to member terms.
- `governance === "public-body"` → `public-body-governance.applicability = required` (agenda/minutes/meetings, records-request lifecycle), `financeProfile.ledgerModel = "fund-accounting"`, procurement-threshold guardrails recommended.
- `primaryConsumer === "resident"` → `service-request-311.applicability = required`, customer-account vocabulary becomes resident/ratepayer account, **refusal/termination flows gain statutory-notice gates** (you can disconnect a ratepayer with due process; you cannot "fire" a resident).
- `primaryConsumer === "member"` → join/eligibility workflow precedes account creation (field-of-membership / membership application), member communications surface activates.

### 6.2 Finance: `ledgerModel` on the billing/finance profile

Add a `ledgerModel` to the finance profile (derived, overridable):

- `commercial` (default — all 45 existing archetypes)
- `fund-accounting` — funds (General/Special Revenue/Enterprise/Capital/Debt Service) as a first-class dimension; budget-to-actual is the primary statement; appropriations are the constraint. (GASB 34 alignment.)
- `financial-institution` — interest-margin P&L shape, regulatory-report mapping (FFIEC call report for banks / NCUA 5300 for CUs). DPF tracks the *management* view; the core system remains authoritative for the ledger.
- `cooperative-equity` — commercial P&L + patronage allocation, allocated vs unallocated equity, per-member equity subledger, equity-retirement schedule (Subchapter T alignment).

This is profile shape + seeded chart-of-accounts templates in `packages/finance-templates`, not a new accounting engine.

Placement (substrate-verified): `packages/finance-templates/src/profiles.ts` has **no ledger concept today** — `ledgerModel` is an additive optional field on the existing financial-profile shape, defaulting to `commercial` so all 45 existing profiles are untouched. The BIAN plan (item 5) already specifies a banking financial profile (interest-income / fee-income / interest-expense categories); that profile **becomes the `financial-institution` instance of `ledgerModel`** rather than a parallel concept — whichever PR lands second adopts the other's shape, coordinated under EP-ARCH-8D4F2A.

### 6.3 Party model: reuse `CustomerAccount`, skin it, gate it

Following the partner-identity precedent (vocabulary + applicability over new tables): members, residents, and ratepayers remain `CustomerAccount`/`CustomerContact` rows. What changes per archetype:

1. **Vocabulary** (stakeholder labels, portal labels — §8).
2. **Lifecycle gates** as capabilities: membership-eligibility step (member), statutory-notice flows (resident), victim/witness/suspect role sensitivity (police — Phase 2).
3. **A `partyRole` vocabulary on the account relationship** only if Phase 1 implementation proves labels insufficient — deferred decision, biased against new schema.

### 6.4 Archetype categories

One new `ArchetypeCategory` value, one adopted from the landed BIAN spec:

- `banking-financial-services` — **already introduced by the BIAN spec** (with leaves `community-bank`, `credit-union`, `mortgage-lending`; room for `insurance-agency`, `wealth-advisory` later). This spec does **not** add a competing `financial-services` category; the banking deltas in §7 attach to the BIAN leaves.
- `public-sector` (new, 14th) → `small-town-municipality`, `municipal-utility`, `law-enforcement-agency` (room for `fire-district`, `library-district`, `school-district` later)

**`cooperative` goes in `nonprofit-community`** rather than a dedicated category: co-ops span sectors (an electric co-op is closest to `municipal-utility`, a food co-op to retail), so the *cooperative-ness* lives in the `governance = member-owned` axis, and the `cooperative` archetype is the general-purpose entry with a setup question selecting the co-op sub-type (ag / electric / consumer-food / housing / worker), which tunes templates and vocabulary. Electric co-ops may alternatively pick `municipal-utility` + answer "member-owned" at setup — both paths normalize to the same axes, which is the architecture working as intended.

## 7. The Six Archetypes

Axis declarations (capability sets are derived; the table in §9 is a rendered view, not source of truth). The `community-bank` and `credit-union` columns are **deltas over the landed BIAN leaf definitions** — where this table differs from the BIAN spec's §7 activation posture, the BIAN declaration stands except for the two migrations this spec introduces: (a) `credit-union.primaryConsumer` moves `individual/household` → `member` when the Phase-0 axis value lands (a coordinated EP-ARCH-8D4F2A change, not a fork), and (b) both leaves gain the new `governance` axis and `ledgerModel`. `consumptionChannel` for bank/CU stays the BIAN-declared `multi-channel`.

| | `community-bank` | `credit-union` | `cooperative` | `small-town-municipality` | `municipal-utility` | `law-enforcement-agency` |
| --- | --- | --- | --- | --- | --- | --- |
| `form` | services | services | per sub-type | services | services | services |
| `delivery` | hybrid | hybrid | per sub-type | physical | physical | physical |
| `primaryConsumer` | individual+business | **member** | **member** | **resident** | **resident** | **resident** |
| `governance` | investor-owned | **member-owned** | **member-owned** | **public-body** | **public-body** | **public-body** |
| `consumptionChannel` | multi-channel (BIAN) | multi-channel (BIAN) | per sub-type | onsite-plus-portal | onsite-plus-portal | onsite-plus-portal |
| `commercialModel` | account-based-fees | account-based-fees | per sub-type | **statutory-fees-and-levies**¹ | usage-based | **statutory-fees-and-levies**¹ ² |
| `provisioning` | account-with-kyc | account-with-kyc | account-with-billing | account-with-billing | account-with-billing | none |
| `ledgerModel` | financial-institution | financial-institution | cooperative-equity | fund-accounting | fund-accounting (enterprise fund) | fund-accounting |
| Compliance pack | FDIC/OCC + BSA/AML + CRA + fair lending | NCUA + BSA/AML + FOM | Subchapter T + sector (RUS/PUC for electric, USDA for ag) | open-meetings + public-records + state audit + procurement | + SDWA/NPDES sampling calendar, CCR, rate covenants | + POST training, policy attestation, **CJIS posture (Phase 2 gate)** |
| Workspace emphasis | Compliance calendar, exam findings, board packets | Member services + compliance + board/supervisory committee | Member equity + patronage + board | Service requests + permits + council meetings + budget | Utility accounts + service orders + compliance sampling + board | Cases/records workflow + training/certs + policy attestation |

¹ `statutory-fees-and-levies` is a proposed new `commercialModel` value (workbook first): revenue arrives by levy/assessment/fee schedule set by ordinance, not by sale.

² Every archetype must declare a value from the `CommercialModel` enum — "(none)" is not a legal axis value. Police agencies do operate a statutory fee schedule (alarm permits, report copies, special-event details), so the same proposed value covers them; the General-Fund-appropriation funding reality is expressed by `ledgerModel: fund-accounting`, not by inventing a second new commercial-model value.

Per-archetype notes:

- **`community-bank`** *(delta on the BIAN leaf)*: storefront, item templates (BIAN Service-Domain-grounded product descriptions, never accounts), CTA, KYC posture, and the required jurisdiction/charter onboarding step are **already specified by the BIAN spec** — not respecified here. This spec adds: `ledgerModel: financial-institution`, the recurring-obligation compliance pack (§10), board-committee governance via the compliance pack (not member-governance), vendor due diligence emphasis.
- **`credit-union`** *(delta on the BIAN leaf)*: as bank, plus `primaryConsumer: member` migration, `member-governance` required (annual meeting, board + supervisory committee, elections), membership-eligibility intake formalized as the capability behind the BIAN leaf's existing field-of-membership form field. NCUA 5300/DOR tracking in the compliance pack. Vocabulary is already decided by the BIAN spec (Members / Member Portal / **Member Advisor** via the `ArchetypeDefinition.vocabulary` → `customVocabulary` mechanism) — this spec adds no second override.
- **`cooperative`**: setup question selects sub-type → tunes item templates (grain/agronomy vs grocery vs units vs kWh), vocabulary (capital credits vs patronage refund), and finance seeds. `member-equity` + patronage year-end workflow are the differentiating modules.
- **`small-town-municipality`**: the public-sector base. Service-request (311) lifecycle, permits/licenses **on the EP-LICENSING substrate**, records-request lifecycle, council meeting workflow (agenda packet → meeting → minutes → publication), budget-to-actual by fund. CTA `inquiry`; storefront = town website surface (departments, news, meetings, how-do-I).
- **`municipal-utility`**: municipal base + ratepayer accounts (service connection → metering reference → billing readiness → delinquency with statutory notice), rate schedules as items, compliance sampling calendar, outage notices as communications. Setup asks utility type(s) (water/sewer/electric/gas) and ownership (city dept / district / co-op — the co-op answer flips `governance` to member-owned and adds capital-credits).
- **`law-enforcement-agency`**: **Phase-gated hardest case.** Phase 1 = agency operations with **no CJI**: training/certification tracking (POST), policy management with officer attestation (existing Policy/PolicyAcknowledgment models), equipment/asset assignment, scheduling/overtime awareness, citizen-facing non-CJI surfaces (records-request intake, compliment/complaint intake, alarm permits via EP-LICENSING). Phase 2 (separate spec + security review) = anything touching case/incident data, which triggers CJIS Security Policy posture (MFA, audit logging, encryption, personnel screening). Setup asks agency type (PD / sheriff — sheriff adds civil process + jail vocabulary later).

## 8. Vocabulary

New entries in `archetype-vocabulary.ts` (category-level), with per-leaf overrides through the mechanism the BIAN spec decided: `ArchetypeDefinition.vocabulary?: Partial<ArchetypeVocabulary>` seeded into `StorefrontArchetype.customVocabulary` and read by `getVocabulary()` — no new override path.

- `banking-financial-services`: category vocabulary and the credit-union override (stakeholders "Members", portal "Member Portal", agent "Member Advisor") are **owned by the BIAN spec §7.4** — nothing to add here.
- `public-sector`: items "Services & Programs" / portal **"Resident Portal"** / stakeholders **"Residents"** / team "Staff" / inbox **"Service Requests"** / agent "Resident Services". Utility override: stakeholders "Ratepayers"(/"Members" if co-op-owned), inbox "Service Orders". Police override: portal "Community Portal", stakeholders "Community", inbox "Requests & Reports", agent "Community Liaison".
- `cooperative` (in nonprofit-community, via customVocabulary): stakeholders **"Member-Owners"**, portal "Member Portal", inbox "Member Requests", price label "Patronage/Price" per sub-type.

Category suggestions per archetype follow the existing `CATEGORY_SUGGESTIONS` pattern (e.g., town: Permits, Utilities, Parks & Rec, Public Works, Court; utility: Residential, Commercial, Irrigation, Connection Fees; CU: Share Accounts, Lending, Member Services).

## 9. Capability Applicability (rendered view of rules output)

| Capability | bank | credit-union | cooperative | town | utility | police |
| --- | --- | --- | --- | --- | --- | --- |
| Customer accounts | required (customers) | required (members) | required (members) | required (residents) | required (ratepayers) | optional (non-CJI contacts only) |
| Membership eligibility intake | n/a | required | required | n/a | n/a (unless co-op) | n/a |
| Member governance (board/elections/meetings) | n/a (board via compliance pack) | required | required | n/a | n/a (unless co-op) | n/a |
| Public-body governance (agenda/minutes/open meetings) | n/a | n/a | n/a | required | required | required (commission/council reporting) |
| Records-request lifecycle | n/a | n/a | n/a | required | required | required (with LE exemption handling) |
| Service requests (311) | n/a | n/a | optional | required | required (service orders) | optional (non-emergency intake) |
| Permits & licensing (EP-LICENSING) | n/a | n/a | n/a | required | optional (connections/taps) | optional (alarm permits) |
| Compliance-readiness pack | required (FDIC/BSA) | required (NCUA/BSA) | recommended (sector) | required (state/audit) | required (SDWA/PUC) | required (POST/policy) |
| Member equity / patronage | n/a | n/a (dividend via core) | required | n/a | n/a (capital credits if co-op) | n/a |
| Recurring/usage billing readiness | optional | optional | per sub-type | optional (assessments) | required (usage-based) | not-applicable |
| Fund/budget-to-actual view | n/a | n/a | n/a | required | required (enterprise fund) | required (department budget + grants) |
| Appointment checkout / POS | hidden | hidden | per sub-type | hidden | hidden | hidden |
| Customer estate / edge node | optional (internal IT) | optional | optional | optional (facilities) | recommended (plant/asset registry) | optional |

If a cell disagrees with the rules engine, the rules engine wins (per the 2026-05-22 contract).

## 10. Compliance Packs (seed data on existing substrate)

Each regulated archetype ships a seed pack on the **existing** Regulation/Obligation/Control/RegulatorySubmission models, with `Regulation.industry` set to the archetype family.

**Substrate delineation (single-source-of-truth):** two regulatory substrates now coexist and must not double-track the same regime. The rule: *who-may-we-be and what-must-we-display* — jurisdiction, charter, credential identifiers (FDIC cert / NCUA charter / NMLS), display obligations — lives on the **licensing-readiness substrate** (`OrganizationLicenseProfile` / `OrganizationLicenseRecord` / `LicenseDisplayObligation`), as the BIAN spec §9 already wires for banking. *What-must-we-keep-doing* — recurring obligations, controls, evidence, submission calendars (SAR/CTR cadence, call report / 5300 due dates, sampling calendars, open-meetings notice deadlines) — lives on the **compliance models** below. A regime that spans both (e.g. BSA/AML: FinCEN registration posture vs ongoing SAR/CTR cadence) splits along that line and cross-references; it is never seeded twice.

- **bank**: BSA/AML (SAR/CTR cadence), CRA, fair lending (ECOA/HMDA), Reg O, quarterly FFIEC call report (as RegulatorySubmission with due dates), exam-finding remediation workflow.
- **credit-union**: BSA/AML, NCUA 5300 quarterly submission, FOM compliance, supervisory-committee audit cadence, DOR (document of resolution) tracking.
- **cooperative**: Subchapter T patronage requirements (≥20% cash on qualified allocations), annual-meeting statutory requirements, sector add-ons (RUS/NERC-adjacent for electric, Capper-Volstead awareness for ag).
- **town**: open-meetings notice deadlines, records-request response deadlines (state-configurable), records-retention schedule, annual state-audit prep, procurement thresholds.
- **utility**: + sampling calendar (SDWA via state primacy), CCR annual delivery, NPDES reporting, rate-covenant (debt-service coverage) checks.
- **police**: + POST training-hours per officer, policy attestation cadence, BWC-retention schedule awareness (state-configurable), **CJIS posture checklist as a Phase-2 readiness gate, not a Phase-1 claim**.

State-by-state variance (deadlines, retention) is handled as org-level configuration on the seeded obligations, not 50 seed variants.

## 11. Onboarding & Setup Questions

Following the existing SetupWizard pattern (questions only where the axes genuinely fork):

- `cooperative`: "What kind of cooperative?" (ag / electric / consumer-food / housing / worker)
- `municipal-utility`: "Which services?" (water/sewer/electric/gas multi-select) + "Who owns the utility?" (city department / special district / member-owned cooperative)
- `law-enforcement-agency`: "Agency type?" (police department / sheriff's office)
- `small-town-municipality`: "Does the town run its own utility?" (yes → recommend the utility capability set in the same install)
- All public-sector: state selection → configures records-request deadlines and retention defaults.

## 12. Implementation Roadmap

Three phases, each independently shippable; breakdown into BIs happens after operator review.

**Phase 0 — Substrate (under EP-ARCH-8D4F2A):**
1. `governance` axis + `primaryConsumer` values (`member`, `resident`) + `commercialModel` value (`statutory-fees-and-levies`) — workbook proposal first, then enums, normalizer defaults (`investor-owned`), rules-engine additions with tests.
2. `ledgerModel` on the finance profile + COA templates (fund-accounting, financial-institution, cooperative-equity) in `packages/finance-templates` — coordinated with BIAN plan item 5 (the banking financial profile), per §6.2.
3. One new category (`public-sector`) + vocabulary entries; `banking-financial-services` lands via the BIAN plan, not here.
4. Capability registry entries: `member-governance`, `public-body-governance`, `records-request`, `service-request-311`, `member-equity` (registry + applicability rules; UI surfaces follow in archetype phases).

**Phase 1 — First archetype per cluster (prove the rules):**
5. `credit-union` (most homogeneous regulated member-governed vertical) — **sequenced after the BIAN plan's leaf wiring lands** (the leaf, vocabulary, storefront, and jurisdiction-capture step come from there). This phase adds the deltas: `primaryConsumer: member` migration, NCUA/BSA recurring-obligation compliance pack, membership-eligibility intake capability, member-governance v1 (board/committee records, meeting workflow, annual-meeting checklist).
6. `small-town-municipality` — archetype definition, public-body governance v1 (agenda → meeting → minutes), records-request lifecycle v1, service-request (311) lifecycle, budget-to-actual fund view v1, permits on EP-LICENSING.

**Phase 2 — Fan-out (mostly axis declarations + packs, per the acceptance criterion that new archetypes are cheap):**
7. `community-bank` deltas (compliance pack + financial-institution ledger templates; no member machinery) — the leaf itself ships with the BIAN plan.
8. `cooperative` (sub-type setup question, patronage/member-equity module, sector packs).
9. `municipal-utility` (ratepayer account lifecycle, rate-schedule items, sampling calendar, statutory-notice delinquency flow).
10. `law-enforcement-agency` Phase 1 scope only (training/certs, policy attestation, equipment assignment, non-CJI citizen surfaces). CJIS-scoped case/records work = separate future spec + security review.

## 13. Acceptance Criteria

1. All six archetypes are produced by axis values + portfolio scopes + compliance-pack seeds; no `archetypeId` string comparisons in feature code.
2. The 45 existing archetypes normalize to `governance: "investor-owned"` with zero behavior change (regression suite proves it).
3. A credit union install shows Members (never "Customers"), a membership-eligibility step before account creation, board/supervisory-committee surfaces, and an NCUA/BSA obligation calendar — from seed, no manual configuration.
4. A small-town install shows Residents, a 311 service-request queue, a council-meeting agenda→minutes workflow, a records-request queue with deadline tracking, and a budget-to-actual fund view.
5. Fund-accounting ledger model renders budget-to-actual as the primary finance statement without disturbing commercial-archetype finance surfaces.
6. The police archetype Phase 1 stores no CJI and states the CJIS Phase-2 gate explicitly in its activation summary.
7. Vocabulary flows through `getVocabulary` + `customVocabulary` only — no hardcoded "Member"/"Resident" strings in components.
8. Compliance packs seed through existing Regulation/Obligation/Control models; zero new compliance tables — and no regime appears on both the licensing substrate and the compliance models (§10 delineation).
9. Banking deltas land on the BIAN-defined `community-bank`/`credit-union` leaves — exactly one `ArchetypeDefinition` per leaf, no forked or duplicate banking archetype rows.

## 14. Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Governance axis bloats into a parallel feature flag system | It gates exactly two capability modules (member-governance, public-body-governance); everything else stays rules-derived from existing axes |
| Fund accounting scope-creeps into a GL engine | `ledgerModel` shapes views + COA templates only; DPF remains conduit to the org's actual accounting system |
| CJIS claims made prematurely | Hard phase gate: Phase 1 = no CJI by design; CJIS posture is a separate spec with security review before any case data |
| 50-state compliance variance explodes seed data | Obligations seed with org-configurable deadlines/retention; state selection sets defaults |
| Six archetypes at once stalls delivery | Phase 1 ships two archetypes that prove both clusters; fan-out is cheap by construction (acceptance criterion 1) |
| Overlap with EP-ARCH-8D4F2A / EP-LIC-C64FC2 in-flight work | Substrate lands under EP-ARCH-8D4F2A; municipal permits consume EP-LIC-C64FC2; overlap re-sweep before each PR |
| Parallel banking definitions diverge from the landed BIAN spec | Banking leaves, category, vocabulary, and jurisdiction capture are owned by the BIAN spec/plan; this spec contributes only governance axis, ledgerModel, member-governance, and obligation packs as deltas (§6.4, §7); the CU `primaryConsumer` migration is a coordinated EP-ARCH-8D4F2A change |
| Same regulatory regime tracked on two substrates | §10 delineation rule: licensing substrate = posture/credentials/display; compliance models = recurring obligations/submissions; cross-reference, never seed twice |

## 15. Open Questions for Operator Review

1. **Category for co-ops**: keep `cooperative` in `nonprofit-community` (this spec) vs a dedicated `cooperative` category? Dedicated category is cleaner in the picker; axis-based is cleaner architecturally.
2. **HOA migration**: should `hoa-management` migrate to `primaryConsumer: member` + `governance: member-owned` in Phase 2 (it is structurally a member-governed org)? Recommended yes, as a validation that the axis fits.
3. **Phase 1 pair**: credit-union + small-town is the recommended pairing (one per cluster). Alternative: lead with cooperative (biggest whitespace) at the cost of sub-type complexity in the first slice.
4. **Police archetype naming**: `law-enforcement-agency` (covers PD + sheriff) vs `police-department`. Spec uses the broader id.
5. **Storefront fit for public sector**: towns/police don't "sell" — the storefront surface becomes the public website (departments, meetings, how-do-I). Confirm this reuse is desired vs hiding the storefront module for public-sector archetypes.
