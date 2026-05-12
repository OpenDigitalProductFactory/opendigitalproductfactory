# 2026-05-11 Licensing, Permit, and Jurisdictional Readiness Design

**Epic:** `EP-LIC-C64FC2` Licensing, Permit, and Jurisdictional Readiness: Archetype-Aligned Compliance Foundation

**Status:** Draft for review

## 1. Problem Statement

DPF now has a meaningful tax-remittance capability, but it does not yet have a matching capability for the broader licensing, permit, legality, and qualification landscape that businesses must navigate before they can safely operate, market, hire, and remit.

This gap matters because:

- a business may be lawful in one jurisdiction and prohibited or heavily restricted in another
- some obligations apply to the organization, some to staff, and some to both
- some requirements are true licenses or permits, while others are registrations, certifications, endorsements, or display obligations
- some credentials drive fees, renewals, and payment schedules in finance
- some credentials must be displayed publicly or are strategically used in marketing as trust signals
- the correct investigation path depends on both business archetype and operating geography

The platform should not pretend it can know every jurisdictional rule from static seed data. It should become licensing-ready: able to bootstrap the investigation, guide the user through legality and licensing questions, store verified operational truth, track evidence and renewal posture, and connect the results cleanly to Compliance, Finance, Staff management, Marketing, and archetype-aware coworker behavior.

## 2. Live Backlog Context

Live backlog was queried first through the DPF MCP backlog surface.

Findings:

- tax-remittance epics `EP-TAX-6C82D1` and `EP-TAX-41A6F2` are already done
- `EP-ARCH-8D4F2A` Archetype Model V2 remains open
- no existing open epic covered licensing, permits, legality, or jurisdictional readiness as a dedicated capability

The new adjacent epic was then created by **live DB fallback** because this session's MCP token allowed backlog reads but returned `Unauthorized` for `create_build_epic`:

- `EP-LIC-C64FC2` Licensing, Permit, and Jurisdictional Readiness: Archetype-Aligned Compliance Foundation

Seeded backlog items:

1. `BI-LIC-7D476E` Research & spec the licensing, permit, and legality investigation capability
2. `BI-LIC-F36A08` Design the domain model for jurisdictional license requirements and organization/person credentials
3. `BI-LIC-3621D8` Add archetype-aware coworker investigation flow for licensing and permit readiness
4. `BI-LIC-247DB1` Add compliance workspace surfaces for licensing, display obligations, fees, and staff qualifications
5. `BI-LIC-AA90DB` Seed and refresh jurisdiction bootstrap data for licensing and permit investigation

Implication:

- this should remain a separate adjacent epic rather than reopening the completed tax-remittance work
- it should connect to archetype work, but not be buried inside the archetype epic

## 3. Current Repo Posture

The repo already contains strong adjacent seams, but not the required capability:

- `/compliance` exists as the natural operational home for regulatory posture, obligations, evidence, submissions, and audits
- `/finance/settings/tax` now owns tax registrations, periods, credentials, and remittance execution readiness
- archetype context is already injected into route context and prompts through `StorefrontConfig.archetypeId`
- employee/staff and marketing surfaces already exist as separate product areas that can consume verified licensing outputs

What is not present today:

- a first-class licensing or permit domain model
- a bridge between archetype and likely legality/licensing investigation
- organization-level and person-level license tracking
- structured display obligations
- fee and renewal modeling tied to licensing readiness
- a coworker investigation flow for licensing and permit discovery

This means the feature should be treated as net-new platform capability that reuses existing route, coworker, and authority patterns rather than extending tax tables with unrelated concepts.

## 4. Research & Benchmarking

### 4.1 Official/Public Jurisdiction Sources

These sources support a bootstrap-seed-plus-live-verification model:

- United States: the U.S. Small Business Administration publishes federal/state/local license and permit guidance and explicitly distinguishes federal licenses from state or local permitting: [SBA — Apply for licenses and permits](https://www.sba.gov/business-guide/launch-your-business/apply-licenses-permits)
- United Kingdom: GOV.UK provides a licence finder and separately maintains the Regulated Professions Register, showing that activity permits and professional qualification requirements are related but not identical: [Find a licence](https://www.gov.uk/find-licences), [Regulated Professions Register](https://www.regulated-professions.service.gov.uk/)
- Australia: ABLIS provides business licence information across Australian government, state/territory, and local layers, which is exactly the kind of seedable authority map DPF needs: [ABLIS](https://ablis.business.gov.au/about)
- Canada: BizPaL aggregates permit and licence requirements across federal, provincial/territorial, and municipal governments: [BizPaL Initiative](https://ised-isde.canada.ca/site/bizpal/en)
- European Union: Your Europe makes clear that permit and licence requirements remain country-specific, while the regulated professions database provides structured cross-country qualification visibility: [Registration, permits and licences for business in the EU](https://europa.eu/youreurope/business/running-business/developing-business/registration-permits-licences/index_en.htm), [Database of regulated professions](https://single-market-economy.ec.europa.eu/single-market/services/free-movement-professionals/database-regulated-professions_en)
- South America: country-specific official gateways exist, but the region is more fragmented and less suitable for one shared seed. Good examples include Brazil's business licensing flow and Chile's business setup/operating-permit ecosystem: [Brazil licenciamento](https://www.gov.br/empresas-e-negocios/pt-br/redesim/abrir-cnpj/licenciamento), [Chile Tu Empresa en un Día](https://www.registrodeempresasysociedades.cl/Default.aspx/Default.aspx), [Chile operating permits](https://www.investchile.gob.cl/es/permisos-de-operacion/)

Patterns adopted:

- seed official authority directories, not legal conclusions
- separate business legality, operating permits, and professional qualification checks
- expect mixed authority layers: federal, state/province, county, city, municipal, professional board
- preserve country-specific execution rather than pretending one global taxonomy fits all licensing systems

Patterns rejected:

- treating one bootstrap directory as authoritative truth
- assuming tax jurisdiction seed data is enough for legality or licensing
- expecting one region-wide source to fully cover South America

### 4.2 Commercial Platform Benchmarks

#### Avalara Business Licenses

Avalara positions business licensing as an operational compliance service that spans registration, renewal, and jurisdictional monitoring rather than as a simple document store: [Avalara Business Licensing Solutions](https://www.avalara.com/us/en/products/business-licenses.html/)

Patterns adopted:

- licensing is a separate capability from tax filing
- the core unit is a jurisdictional requirement plus an operational license record
- renewal readiness and jurisdiction expansion matter as much as initial setup

Patterns rejected:

- trying to become a managed licensing service provider in phase 1

#### Harbor Compliance

Harbor Compliance emphasizes cross-jurisdiction requirement research, company profile reuse, general business licenses, professional licenses, and repeatable workflow automation: [Harbor Compliance Software](https://www.harborcompliance.com/software), [Harbor Compliance Platform](https://www.harborcompliance.com/)

Patterns adopted:

- separate requirement intelligence from the business's actual license inventory
- support both organization-level and individual/professional licensing
- drive repeated workflows from a shared company profile and jurisdictional knowledge base

Patterns rejected:

- outsourcing all operating truth to an external portal without an inspectable internal source of truth

#### ServiceTitan Contractor Licensing

ServiceTitan's contractor-licensing guidance shows a service-business reality DPF must support: trade businesses often have company-level and responsible-individual requirements, plus insurance, exams, and renewal processes that influence operations and marketing: [ServiceTitan Contractor Licenses](https://www.servicetitan.com/licensing/contractor)

Patterns adopted:

- tie licensing requirements to the business type, not only the geography
- model person-held responsible parties and staff-linked credentials
- preserve fee and renewal implications

Patterns rejected:

- hardcoding only contractor-industry assumptions into the shared platform

### 4.3 Open-Source / ERP Pattern Benchmarks

#### Odoo Certifications

Odoo supports person-held certifications as employee-linked records with issue/expiration handling: [Odoo Certifications](https://www.odoo.com/documentation/18.0/applications/hr/employees/certifications.html)

Patterns adopted:

- person-held credentials belong to staff records, not only to the organization
- expiration and renewal dates should be first-class data
- the same credential may be operationally required and HR-relevant

Patterns rejected:

- using employee certifications alone as the whole business-licensing model

#### ERPNext Healthcare Practitioner and Training Results

ERPNext's healthcare practitioner and training records illustrate the value of keeping qualifications and operating actors explicit: [Healthcare Practitioner](https://docs.frappe.io/erpnext/v13/user/manual/en/healthcare/healthcare_practitioner), [Training Result](https://docs.frappe.io/erpnext/v14/user/manual/en/human-resources/training-result)

Patterns adopted:

- staff qualifications and responsible practitioners need dedicated records
- qualification evidence should be linkable to operational workflows
- credentials can influence finance and service workflows without becoming finance-native data

Patterns rejected:

- folding organization permits and person qualifications into one generic employee note field

#### Dolibarr Employee / User Management

Dolibarr's employee/user posture is simpler, but it reinforces that staff-linked operational records and attachments are common SMB expectations: [Dolibarr employees and users management](https://www.dolibarr.org/presentation-users-employees.php)

Patterns adopted:

- simple user/staff records often need attached operational documents
- hierarchy and accountability matter when renewal or verification tasks are assigned

Patterns rejected:

- relying only on file attachments without structured readiness fields

### 4.4 Design Takeaways

The benchmarking points to a layered model:

1. **Requirement intelligence** about authorities, archetypes, legality, and likely obligations
2. **Business truth** about what this organization and its staff actually hold
3. **Operational workflow** for investigation, verification, renewal, payment, evidence, and display

That is the same pattern that made the tax-remittance design workable, but the licensing domain has broader cross-module consequences and needs a stronger split between business-held and person-held credentials.

## 5. Why This Is Separate From Tax Remittance

Tax remittance answers:

- where do we owe indirect tax?
- what registrations and filing periods exist?
- what is due, when, and by whom?

Licensing and permit readiness answers:

- is this business activity lawful in this jurisdiction?
- what company permits or licenses are required before operating?
- what staff qualifications or professional licenses are required?
- what must be displayed publicly or maintained as evidence?
- what fees, renewals, and operational dependencies exist?

These domains intersect, but they are not the same:

- tax registration is not a substitute for operating authority
- a company may be tax-registered but still unlicensed for the service it sells
- a person may hold a required professional credential even when the company permit is missing, or vice versa
- marketing can legitimately depend on licensing posture in ways tax should never drive

So this should be integrated with the tax capability, not folded into it.

## 6. Design Goals

1. Make legality, licensing, permitting, and qualification readiness a first-class platform capability.
2. Keep Compliance as the operational home while exposing clean cross-links to Finance, Staff, Marketing, and archetype setup.
3. Use bootstrap seed plus live verification rather than pretending the platform owns the law.
4. Let archetypes shape investigation without silently hardcoding legal conclusions.
5. Track organization-held and person-held credentials separately.
6. Model display obligations and marketing-eligible credentials explicitly.
7. Support fees, renewals, and payment implications without collapsing them into tax remittance.
8. Keep the coworker conversational and proactive, while keeping operational pages factual and inspectable.

## 7. Scope

### In Scope

- legality and licensing investigation support for business setup and expansion
- organization-level licenses, permits, registrations, and endorsements
- person-level licenses, certifications, credentials, and work-authority records
- jurisdictional requirement references and authority bootstrap data
- display obligations and public-trust usage flags
- renewal cadence, fees, evidence, and issue tracking
- coworker-led investigation and live-verification workflow
- Compliance UX as the main operational surface
- finance linkage for payable fees and renewal spend readiness
- staff linkage where licenses are attached to employees or responsible managers
- marketing linkage where credentials are displayable or trust-relevant

### Out Of Scope For Phase 1

- full global coverage from day one
- automated filing/submission into every licensing portal
- replacing specialist legal or licensing services
- guaranteed legal interpretation without human validation
- deep workforce credentialing workflows for every profession
- every municipal edge case in South America or ancillary regions

## 8. Core Design Decision

DPF should use an **archetype-aware bootstrap seed + live verification + coworker investigation fallback** model.

That means:

- the platform seeds known issuing authorities, portals, broad obligation categories, and archetype applicability hints
- the coworker uses business archetype, geography, and services delivered to ask the next useful question
- the coworker verifies official sources before it marks any operational posture as ready
- if the seed is missing or stale, the coworker researches from zero and records what it found

Archetypes should influence **what to investigate**, not silently determine **what is true**.

## 9. Domain Boundaries

The platform should separate five related but distinct concepts.

### 9.1 Legality Rules

Questions about whether an activity is allowed in a jurisdiction at all, or only under constrained conditions.

Examples:

- prohibited activity
- activity allowed only in certain counties or municipalities
- activity allowed only with a specific zoning, board approval, or local ordinance

### 9.2 Organization Licenses and Permits

The business's own authority to operate, advertise, manufacture, transport, serve, sell, or occupy.

Examples:

- business licenses
- contractor licenses
- health permits
- municipal operating permits
- state registrations tied to regulated activity

### 9.3 Person-Held Licenses and Certifications

Credentials that belong to staff, owners, or designated responsible individuals.

Examples:

- plumber, electrician, nurse, or broker licenses
- certifications needed for compliance or insurance
- designated premises supervisors or responsible managing individuals

### 9.4 Display Obligations

Requirements or strong business practices around public display, posting, or customer-visible trust signals.

Examples:

- must display license at premises
- must post permit publicly
- should display certification badge in marketing

### 9.5 Financial Obligations

The fees, renewals, and related payments needed to stay current.

Examples:

- application fees
- annual renewal fees
- person-specific renewal costs
- jurisdiction-specific filing or inspection charges

## 10. Proposed Domain Model

### 10.1 `LicenseRequirementReference`

Purpose:

- seeded and researched knowledge about a licensing or permit requirement pattern

Suggested fields:

- `requirementRefId`
- `jurisdictionRefId`
- `authorityName`
- `authorityType`
- `requirementType` (`license`, `permit`, `registration`, `certification`, `endorsement`, `inspection`, `display_rule`, `legality_gate`)
- `scopeLevel` (`organization`, `person`, `premises`, `activity`, `vehicle`, `equipment`)
- `archetypeCategories`
- `activityTags`
- `summary`
- `officialWebsiteUrl`
- `applicationUrl`
- `renewalUrl`
- `feeInfoUrl`
- `displayRuleSummary`
- `renewalCadenceHint`
- `sourceUrls`
- `researchedAt`
- `lastVerifiedAt`
- `confidence`

### 10.2 `OrganizationLicenseProfile`

Purpose:

- top-level licensing readiness posture for the organization

Suggested fields:

- `organizationId`
- `setupStatus`
- `investigationMode` (`unknown`, `existing`, `new_business`, `expanding`)
- `homeCountryCode`
- `primaryRegionCode`
- `operatingFootprintSummary`
- `legalActivityConfidence`
- `researchCoverageStatus`
- `notes`

### 10.3 `OrganizationLicenseRecord`

Purpose:

- one concrete company-held permit/license/registration/approval

Suggested fields:

- `licenseRecordId`
- `organizationLicenseProfileId`
- `requirementReferenceId`
- `jurisdictionRefId`
- `authorityName`
- `licenseKind`
- `status` (`draft`, `researching`, `applied`, `active`, `expired`, `suspended`, `not_required`, `blocked`)
- `licenseNumber`
- `issuedAt`
- `effectiveFrom`
- `expiresAt`
- `renewalCadence`
- `renewalFeeAmount`
- `renewalFeeCurrency`
- `displayRequirementStatus`
- `officialSourceUrl`
- `lastVerifiedAt`
- `verificationNotes`

### 10.4 `PersonLicenseRecord`

Purpose:

- one staff-held or principal-held credential relevant to the business

Suggested fields:

- `personLicenseRecordId`
- `employeeProfileId` or future `PrincipalAlias` reference
- `organizationId`
- `requirementReferenceId`
- `jurisdictionRefId`
- `credentialType`
- `credentialNumber`
- `issuingAuthority`
- `status`
- `issuedAt`
- `expiresAt`
- `renewalCadence`
- `supervisoryOrDisplayRole`
- `officialSourceUrl`
- `lastVerifiedAt`

### 10.5 `LicenseDisplayObligation`

Purpose:

- structured rule about what must or should be displayed, where, and how it may be reused

Suggested fields:

- `displayObligationId`
- `licenseRecordId` or `personLicenseRecordId`
- `displayType` (`premises_posting`, `vehicle_marking`, `website_badge`, `proposal_attachment`, `customer_visible_certificate`)
- `requirementLevel` (`required`, `recommended`, `marketing_optional`)
- `displayLocation`
- `evidenceArtifactId`
- `isSatisfied`

### 10.6 `LicenseFeeSchedule`

Purpose:

- financial posture for fees and renewals, without making Finance the source of licensing truth

Suggested fields:

- `feeScheduleId`
- `licenseRecordId` or `personLicenseRecordId`
- `feeType`
- `amount`
- `currency`
- `dueDate`
- `paymentStatus`
- `financeHandoffMode`
- `externalReference`

### 10.7 `LicenseReadinessIssue`

Purpose:

- gaps, blockers, stale verification, missing displays, overdue renewals, unclear legality, and similar exceptions

Suggested fields:

- `issueId`
- `organizationLicenseProfileId`
- `organizationLicenseRecordId?`
- `personLicenseRecordId?`
- `issueType`
- `severity`
- `status`
- `details`
- `openedAt`
- `resolvedAt`

## 11. Archetype Alignment Model

Archetypes should contribute investigation heuristics, not legal conclusions.

The alignment layer should answer:

- which categories of licenses are commonly relevant to this archetype?
- does the archetype usually involve person-held professional credentials?
- are there common display obligations or marketing trust signals?
- are there likely premises, vehicle, equipment, health, or board approvals?
- is the business type potentially regulated differently by locality?

Examples:

- a plumber archetype likely triggers contractor-license, responsible-individual, premises, and public-display investigation
- a software platform operator archetype may need fewer occupational licenses but may still need local business registrations and specific regulated-profession checks for staff in certain countries
- a healthcare archetype likely triggers person-held professional registration, facility permits, and stricter display/evidence rules

The archetype layer should therefore provide:

- `archetypeCategories`
- `activityTags`
- `likelyRequirementFamilies`
- `likelyPersonCredentialFamilies`
- `likelyDisplayPatterns`
- `investigationPrompts`

This is conceptually similar to the existing marketing skill-rule pattern, but it must stay guidance-oriented and verification-backed.

## 12. Coworker Investigation Capability

The finance/compliance coworker should act as an expert investigator, not a static form filler.

It should first classify the situation:

- already licensed and operating
- partially configured
- new business
- expanding into new jurisdictions or lines of business

Then it should investigate in sequence:

1. what the business does
2. where it operates, serves, hires, and advertises
3. whether the activity appears legal in those locations
4. what organization-level licenses likely apply
5. what staff-held credentials likely apply
6. what must be renewed, displayed, paid, or handed off

The coworker must:

- use the dedicated coworker UX for dialog
- label uncertainty explicitly
- store factual findings and open issues into inspectable operational records
- verify official sources before marking readiness
- create follow-up tasks when a legal or specialist review is needed

The coworker must not:

- invent legal conclusions from archetype alone
- treat seed hints as authoritative
- bury operational truth inside conversation only

## 13. UX Home And Cross-Module Boundaries

### 13.1 Compliance As Primary Home

The main operational workspace should live under `/compliance`.

Likely sub-surfaces:

- Licensing overview
- Organization licenses
- Staff credentials
- Display obligations
- Fees and renewals
- Open readiness issues

### 13.2 Finance Linkage

Finance should consume:

- renewal fees
- application fees
- payment due dates
- handoff to accounting or payment workflows

But Finance should not own the definition of what a license is.

### 13.3 Staff Linkage

Employee/staff surfaces should consume:

- person-held licenses
- expiration posture
- missing qualifications for role coverage
- responsible individual assignments

### 13.4 Marketing Linkage

Marketing surfaces should consume:

- credentials that are safe and valuable to display
- display obligations that are mandatory
- trust-badge candidates

Marketing should never infer a credential that Compliance has not verified.

## 14. Seed Strategy And Coverage Order

Coverage should be phased:

### Phase 1 Bootstrap

- United States
- United Kingdom
- Australia

These have the strongest official bootstrap surfaces and the highest near-term value for DPF's current business-archetype direction.

### Phase 2

- Canada

BizPaL provides a strong cross-government bootstrap seam.

### Phase 3

- EU

Use Your Europe and the regulated professions database as umbrella sources, then country-specific portals underneath.

### Phase 4

- South America

Seed selected country-level gateways first and expect more country-specific research from zero.

### Ancillary

- other jurisdictions as-needed

The seed should contain:

- official authority names
- portal URLs
- application/renewal entry points when public
- broad requirement families
- archetype applicability hints
- display or fee notes when stably published
- provenance and verification timestamps

## 15. Risks And Anti-Patterns

Main risks:

- oversimplifying legality and licensing into one flat table
- letting archetypes silently author legal conclusions
- mixing tax, licensing, and HR credentials into one muddled workflow
- relying on stale seed data without live verification
- hiding investigative reasoning only in chat history
- making Marketing or Finance the source of truth for compliance posture

Avoid these anti-patterns:

- one global "licensed" switch
- free-text-only notes with no structured operational state
- treating employee certifications as a substitute for company permits
- treating company permits as a substitute for professional staff licensing
- showing coworker guidance cards on the operational page instead of in the dedicated coworker UX

## 16. Recommended Rollout Phases

### Phase 1: Research And Readiness Foundation

- jurisdiction and requirement reference model
- organization and person license records
- coworker investigation design
- Compliance UX framing
- USA / UK / Australia bootstrap seed strategy

### Phase 2: Operational Workspace

- compliance licensing workspace
- organization and person credential lists
- evidence and display-obligation tracking
- issue detection and renewal visibility

### Phase 3: Cross-Module Integration

- finance fee linkage
- staff qualification linkage
- marketing trust-signal linkage
- archetype-aware onboarding triggers

### Phase 4: Stronger Automation

- scheduled renewal reminders
- authority-specific research refresh
- richer fee/payment orchestration
- later portal submission or managed-service integration where appropriate

## 17. Recommended Next Implementation Slice

The first buildable slice should not try to automate every license workflow.

Recommended starting point:

1. add the reference and operational schema foundation
2. build a Compliance-side licensing workspace with inspectable records
3. add coworker investigation prompts and factual issue creation
4. seed bootstrap data for USA, UK, and Australia only

That creates real operational value quickly and gives the coworker somewhere truthful to persist its research before deeper automation is attempted.
