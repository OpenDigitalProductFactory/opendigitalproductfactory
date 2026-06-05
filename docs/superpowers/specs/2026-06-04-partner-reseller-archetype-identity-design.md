# Partner / Reseller Archetype Extension And Partner Identity Design

**Date:** 2026-06-04
**Status:** Draft
**Author:** Claude (Opus 4.8) with founder direction
**Decision basis:** WWMD `principle_decide` (recorded §7); governing profile `mark-dpf-platform`
**Related specs:**
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md` (operating-model axes + capability derivation — the substrate this extends)
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` (Principal convergence — the binding identity rule)
- `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md`
**Related epics:** `EP-ARCH-8D4F2A` (Archetype Model V2), `EP-EDGE-NODE`, the enterprise-auth identity track

---

## 1. Problem Statement

Some business archetypes sell **through** other businesses, not only direct to end customers. A SaaS platform has referral, reseller, and technology partners. An IT managed-service provider is itself a channel partner of its vendors and may sub-contract. A goods brand sells wholesale through distributors and resellers. These businesses need to onboard, tier, enable, and pay a **partner/reseller network** — and those partners need to **log in** to a surface that is *not* the customer storefront and *not* the internal workforce console.

Today DPF models exactly two external-facing operating assumptions and exactly two human identity kinds:

- **Archetype layer.** `OperatingModelAxes.primaryConsumer` already enumerates `"channel-partner"`, and the MSP spec acknowledges that an MSP's "products sold" portfolio is "largely a resale" — but **no archetype activates a partner channel**, and there is no typed contract describing the partner operating model the way `BillingPatternProfile` describes the billing model.
- **Identity layer.** Login is a strict binary: `User` (workforce, session `type:"admin"`) vs `CustomerContact` (storefront customer, session `type:"customer"`). A partner is *neither* — it is an external organization that transacts on its own paper, sees margin/deal-registration data a customer never should, and is governed by a partner agreement rather than an employment relationship or a purchase.

This design extends the archetype substrate to **derive** a partner program from operating-model axes (so partner support is a function of an archetype's axes, not a hand-authored flag), and specifies the **partner identity and login** as a third principal kind under the platform's binding Principal-convergence rule.

## 2. Live Backlog Context

Live DPF MCP reads on 2026-06-04 (no DB fallback). Relevant state:

- `EP-ARCH-8D4F2A` — *Archetype Model V2: Unified Business Archetypes* (in-progress) is the natural epic home for the archetype-layer primitives.
- `EP-EDGE-NODE`, `EP-SITE-7C4D2B`, and the MSP segmentation spec already landed the axes + portfolio + capability-derivation substrate this design plugs into (`packages/storefront-templates/src/{capability-registry,applicability-rules,activation-profile}.ts`).
- The enterprise-auth-directory-federation spec (2026-04-22) + its 2026-05-09 Principal-convergence addendum are the binding identity contract; the partner login slice is an extension of that track, **not** a new auth stack.

No existing spec, epic, or backlog item covers partner/reseller support — verified by `search_specs_and_plans`, `search_knowledge`, and a repo-wide grep. This design is the first.

## 3. Research & Benchmarking

### 3.1 Channel / partner taxonomy (Partner Relationship Management)

The channel-sales industry has a stable, well-documented partner taxonomy. The platform adopts these names verbatim so the classification stays aligned with how customers already think about their channel.

| Partner type | What they do | Distinguishing need |
| --- | --- | --- |
| Referral | Introduce a lead; paid on close; never take title | Tracking links, commission/payout |
| Affiliate | Marketing partner driving tracked traffic | Tracking links, payout automation |
| Reseller / VAR | Buy-to-resell; transact on their own paper | Deal registration, quoting, sales enablement |
| Distributor | Sell to downstream resellers | Tiered access, inventory visibility |
| Managed service provider | Deliver + resell under their own brand | Sub-customer estate, recurring agreements |
| Technology / ISV | Co-built or co-marketed integration | Joint solution docs, co-marketing |
| Franchise | Operate the brand under licensed territory | Territory scoping, brand controls |
| Agent / broker | Sell on commission without taking title | Commission tracking |

**Deal registration** is the canonical channel-conflict-management mechanism: a partner registers a lead and gets time-boxed "first dibs" before it reopens to other partners. **Partner tiering** (registered → authorized → silver/gold/platinum) incentivizes performance and gates margin and portal entitlements. A **partner portal** is the distinct login surface where partners reach deal registration, enablement content, and performance analytics.

Sources:
- Impartner — *20 Common Types of Channel Partners*: https://impartner.com/resources/blog/types-of-channel-partners
- Kiflo — *Reseller vs Referral: Choosing the Right Type of Partner*: https://www.kiflo.com/blog/reseller-vs-referral-partner
- Channeltivity — *Deal Registration Best Practices*: https://www.channeltivity.com/blog/prm-best-practices-deal-registration/
- Magentrix — *What is PRM (Partner Relationship Management)?*: https://www.magentrix.com/glossary/prm
- Gartner — *Partner Relationship Management Applications* (market definition): https://www.gartner.com/reviews/market/partner-relationship-management-applications

Adopted patterns: the 8-type partner taxonomy; deal registration; tier ladder; a dedicated partner portal surface.
Rejected patterns: cloning a full PRM (MDF management, LMS, co-branded asset studios) in the first slice; vendor-specific deal-registration workflows hard-coded into the platform.

### 3.2 Partner identity (B2B / Partner IAM)

The identity industry treats **partner/B2B access as a third population**, distinct from both workforce (internal) and consumer/customer (B2C) login. Partner IAM emphasizes invitation-based onboarding, federated login (SAML/OIDC) against the partner's own IdP, delegated administration (a partner admin manages their own users), scoped RBAC, multi-org separation, and SCIM lifecycle provisioning.

Sources:
- Microsoft Entra — *What is B2B collaboration?* / *External ID overview*: https://learn.microsoft.com/en-us/entra/external-id/what-is-b2b , https://learn.microsoft.com/en-us/entra/external-id/external-identities-overview
- LoginRadius — *B2B vs B2C Authentication* / *What is Partner IAM?*: https://www.loginradius.com/blog/identity/b2b-vs-b2c-authentication , https://www.loginradius.com/blog/identity/what-is-partner-iam
- SecureAuth — *B2B and Partners Access Management*: https://docs.secureauth.com/ciam/en/b2b-and-partners-access-management.html

Adopted patterns: partner login is its own population (not overloaded onto customer auth); federated OIDC/SAML; delegated partner-admin; SCIM provisioning; per-partner-org policy isolation.
Why this fits DPF cleanly: the enterprise-auth spec **already chose** an authentik identity edge with OIDC/SAML + SCIM and a DPF authority core. Partner login is the partner-population projection of that same edge — no new protocol stack. Rejected pattern: a parallel partner auth stack (see §7 WWMD and §11 doctrine).

## 4. Design Goals

1. Make a partner/reseller channel **derive from operating-model axes**, so adding partner support to an archetype is a function of its axes — not a per-archetype boolean (matches the MSP spec's anti-flag-sprawl architecture).
2. Provide a typed `PartnerProgramProfile` contract describing the partner operating model (types, tiers, deal registration, downstream projection), parallel to `BillingPatternProfile`.
3. Activate partner support for the archetypes that **typically** have it (SaaS/software-platform, IT managed-services, retail wholesale/distribution) without forcing it on direct-to-consumer archetypes (salon, healthcare, HOA).
4. Model partner login/identity as a **third principal kind** under the binding Principal-convergence rule — not a parallel identity table, and not overloaded onto `CustomerContact`.
5. Give partners a distinct portal surface (`/partners`) with strict partner-account isolation, delegated partner administration, and partner-only data (margin, deal registration, downstream sub-customers).
6. Reuse the existing external-account substrate and the already-chosen identity edge; introduce the minimum new substrate.

## 5. Non-Goals

- A full PRM (MDF, partner LMS, co-branded asset generation, channel-incentive engines) in the first slice.
- Multi-tenant partner-operated DPF installs. Partners are strict partner-account scopes inside the operator's org, mirroring the MSP customer-estate decision (§8 of the MSP spec).
- Customer→partner identity merge/split rules (a shared-email person who is both) — deferred to the convergence open-questions list.
- Replacing customer social login or workforce auth.
- Commission/payout execution and accounting sync in the first slice (prepared-not-prescribed, like MSP billing).

## 6. Core Architecture — Two Layers

### 6.1 Layer A — Archetype operating model (LANDED in this change)

Partner support plugs into the existing `axes → capability-registry → applicability-rules → activation-profile` derivation chain exactly as MSP customer-estate does.

**Primitives added (`packages/storefront-templates/src/`):**

- `types.ts`
  - `PartnerType` — the 8-type PRM taxonomy (§3.1).
  - `PartnerTier` — `registered | authorized | silver | gold | platinum`.
  - `PartnerPortalMode` — `none | available | primary`.
  - `PartnerGraphMode` — `none | separate-partner-projection` (mirrors `CustomerGraphMode`).
  - `PartnerProgramProfile` — `{ portalMode, partnerTypes, tiers, dealRegistration, partnerGraph }`.
  - `OwnershipScope` extended with `"partner-account"`; `CapabilityIsolation` extended with `"strict-partner-scope"`.
- `capability-registry.ts` — new capability `partner-program` (portfolio `productsAndServicesSold`, default scope `partner-account`, isolation `strict-partner-scope`, surfaces `["partners","partner-portal"]`).
- `applicability-rules.ts`
  - `derivePartnerProgramProfile(axes, portfolios)` — pure derivation, precedence: channel-partner primaryConsumer → `primary`; platform/ecosystem → `available`; MSP (business + recurring-agreement + primary delivery) → `available`; wholesale (goods + business) → `available`; else `none`.
  - `partner-channel-from-axes` rule — sets `partner-program` to `required` when `portalMode==="primary"`, `recommended` when `"available"`, leaves `not-applicable` otherwise.
- `activation-profile.ts` — `NormalizedActivationProfile.partnerProgram` computed in `readActivationProfile`, alongside `billingProfile`.

**Derivation matrix (rendered view of the rules; the rules are the source of truth):**

| Archetype example | primaryConsumer | platform | form / commercial | `partner-program` | portalMode |
| --- | --- | --- | --- | --- | --- |
| Software platform / SaaS | business | yes-developer | services / subscription | recommended | available |
| IT managed services (MSP) | business | no | services / recurring-agreement | recommended | available |
| Retail wholesale / distribution | business | no | goods / transactional | recommended | available |
| Pure channel/reseller business | channel-partner | — | — | required | primary |
| Hair salon / beauty | individual | no | services / appointment-checkout | not-applicable | none |
| Healthcare, HOA, nonprofit | individual/household | no | services / recurring-agreement | not-applicable | none |

Adding the 50th archetype to a partner channel is a matter of its axis values, not a new rule.

### 6.2 Layer B — Partner identity & login (DESIGNED here; staged for the gated slice)

Per AGENTS.md §11 and the enterprise-auth 2026-05-09 convergence addendum (**binding**): any identity-bearing entity introduced after 2026-05-09 must be a `PrincipalAlias` linked to a `Principal`, not a parallel identity table. Therefore:

- **Partner contact (the human who logs in)** → `Principal.kind = "partner"` + `PrincipalAlias.aliasType = "partner-contact"`. Authorization resolves on the `Principal`; the alias kind tells the platform the request authenticated through the partner surface. This is the "not exactly customer, not exactly employee" third kind, expressed the way the convergence model already expresses workforce vs customer vs agent vs edge-node.
- **Partner organization (the reseller company)** → an external account record. Schema-audit first (§11): reuse `CustomerAccount` with an `accountKind` discriminator (`customer | partner`) if its shape fits, OR a thin `PartnerAccount` if partner-specific fields (tier, agreement, margin terms, deal-registration ledger) justify separation. The partner *org* is account data; only the partner *contact* is identity-bearing and bound by convergence. Decision deferred to the schema-audit task in the plan.
- **Auth surface** → extend `UserType = "admin" | "customer"` to `"admin" | "customer" | "partner"`; add a Partner credentials provider mirroring the existing Customer provider in `apps/web/lib/govern/auth.ts`; session carries `partnerAccountId`, `partnerTier`, `partnerContactId`. Federated partner login (OIDC/SAML against a partner IdP) and SCIM provisioning are the authentik-edge projection per the enterprise-auth spec — partner is simply that spec's partner population.
- **Authorization** → partner capabilities resolve through the same effective-auth-context evaluator, gated to `partner-account` ownership scope with `strict-partner-scope` isolation. A partner sees only their own partner-account records (deal registrations, margin, downstream sub-customers); never another partner's, never the operator's internal estate, never raw customer PII beyond what the partner agreement permits. Delegated partner-admin (a partner admin manages their own contacts) is a partner-scoped role.
- **Portal route** → `/partners` (external partner experience), distinct from `/storefront` (internal management) and `/portal` (customer). The `partner-program` capability's `surfaces: ["partners","partner-portal"]` gate the route — visible only when the normalized profile's `partner-program` applicability is `required`/`recommended`, never by comparing raw `archetypeId`.

### 6.3 Setup-time activation & "add it later" (persisted org choice)

**The derivation answers "is a partner channel applicable to this business model?" — it does not answer "did this org opt in, and can they turn it on later?"** Today, capability applicability is purely derived from axes and silently applied: there is no setup-time question, no persisted per-org choice, and no admin toggle (verified 2026-06-04 — `apps/web/lib/storefront/archetype-activation.ts`, `StorefrontConfig`, `BusinessContext` carry no org-level capability-activation state). That is a gap for *every* `recommended`/`optional` capability; partner-program is the first to need it, so it is solved generically here.

**Model: a persisted org-choice overlay on top of the derived applicability.** The derivation says how strongly a capability is offered; the org's stored `CapabilityActivationChoice` (`enabled | disabled`, default unset) says whether this org turned it on. Both the setup wizard and the admin toggle resolve through one function, `resolveCapabilityActivation(applicability, choice?)` (`capability-activation.ts`, landed in this change), so "ask at setup" and "add it later" share a single source of truth:

| Derived applicability | Setup wizard | Default state | Add later (admin)? |
| --- | --- | --- | --- |
| `required` (channel-partner archetype) | confirmed (informed) | **on** (core to the model) | yes (re-enable if opted out) |
| `recommended` (SaaS / MSP / wholesale) | **asked** — "Do you sell through partners/resellers?" | off until opt-in | **yes** |
| `optional` | not surfaced (keeps wizard clean) | off | **yes** |
| `not-applicable` / `hidden` | never | off | no |

So: when an archetype whose axes derive `partner-program = recommended` is chosen at setup, the wizard **asks** whether the partner channel applies; the answer is stored; and if the org declines (or the model changes), the partner channel can be **enabled later** from admin. A pure-channel/reseller archetype (`primaryConsumer = channel-partner`, derived `required`) is on by default but still confirmed.

**Staged substrate (needs migration + runtime gates):** a persisted `OrganizationCapabilityActivation` overlay keyed by `(organizationId, capabilityKey) → CapabilityActivationChoice` (generic — not partner-specific), the setup-wizard question for `promptAtSetup` capabilities, and the admin capability toggle for `canEnableLater` capabilities. The resolution logic primitive is landed; the persistence + UI are Phase 1b/3 (build-gated on the canonical install). The archetype must also be changeable post-setup (re-deriving applicability) for the add-later path to be complete — currently it is not.

## 7. WWMD Verification

`principle_decide` (population `external_coding_agent`, surface `partner-archetype-design`, governing profile `mark-dpf-platform`) scored three partner-identity options:

| Option | Composite | Verdict |
| --- | --- | --- |
| **A. `Principal.kind="partner"` + alias, reuse account substrate, derive from axes** | **1.280** | **Recommended** |
| C. Parallel `Partner`/`PartnerContact` identity table + own auth stack | 1.192 | Rejected |
| B. Reuse `CustomerContact` with a partner role flag | 1.186 | Rejected |

Top contributor for A: **Principal Convergence** (alignment 0.78), followed by Verify-substrate-before-proposing-new and Organization-as-canonical-identity. No commandment conflict. The margin (0.087) fell below the 0.2 tie threshold → flagged low-confidence/human-review; that flag is a **semantic artifact** (commandments supplied no structured features, so the three options scored close on the core principles alone). The tie is resolved **decisively by the binding written rule**: the convergence addendum *prohibits* Option C (parallel table) for any identity entity created after 2026-05-09, and the convergence model explicitly separates identity *kinds* rather than overloading one (`CustomerContact`), which disqualifies Option B. Option A is therefore both the kernel recommendation and the doctrine-mandated path. Human-review flag is satisfied: this design is the founder-directed artifact.

## 8. Data Model Direction

First (landed) slice — archetype layer:
- Pure TypeScript in `@dpf/storefront-templates`. No DB table, no migration. Partner program is derived JSON on the normalized profile, exactly like `billingProfile`.

Identity slice (staged, gated):
- Add `Principal.kind` value `"partner"` and `PrincipalAlias` kind `"partner-contact"` (no new identity table — convergence-compliant).
- Schema-audit decision: `CustomerAccount.accountKind` discriminator vs a thin `PartnerAccount` for partner-org fields (tier, agreement ref, deal-registration ledger, margin terms).
- `UserType` + Partner credentials provider + session shape (`partnerAccountId`, `partnerTier`).
- Migration applies cleanly + UX verification on the canonical install (build gate §5) — this is why the identity slice is staged behind the pure-TS primitive slice.

## 9. Acceptance Criteria

1. `derivePartnerProgramProfile` produces `primary` for channel-partner axes, `available` for platform/MSP/wholesale axes, and `none` for direct-to-consumer axes — from axis values alone, no per-archetype hand-edits. *(Met — `applicability-rules.test.ts`.)*
2. The `partner-program` capability is `required` for channel-partner, `recommended` for platform/MSP/wholesale, `not-applicable` otherwise, with `partner-account` ownership and `strict-partner-scope` isolation. *(Met.)*
3. `NormalizedActivationProfile.partnerProgram` is populated by `readActivationProfile`. *(Met.)*
4. `resolveCapabilityActivation` makes `recommended` capabilities ask at setup + opt-in + add-later, `required` on-by-default, `optional` add-later-only, `not-applicable`/`hidden` never. *(Met — `capability-activation.test.ts`.)*
5. Package typecheck + vitest green. *(Met — 38/38 tests, tsc clean.)*
6. (Phase 1b) When a `recommended` partner archetype is chosen at setup the wizard asks "Do you sell through partners/resellers?"; the answer persists; a declining org can enable it later from admin; the archetype is changeable post-setup. *(Staged.)*
7. (Identity slice) Partner login resolves to a `Principal.kind="partner"` via a `partner-contact` alias; authorization resolves on the Principal; `/partners` is gated by `partner-program` applicability, never by raw archetype id; a partner cannot see another partner's or the operator's internal records. *(Staged.)*
8. (Identity slice) No parallel partner identity table is introduced; migration applies cleanly; UX verified on the canonical install. *(Staged.)*

## 10. Phases

- **Phase 0 (landed in this change):** archetype-layer partner primitives + derivation + the `resolveCapabilityActivation` setup/add-later resolution logic + tests.
- **Phase 1:** wire the target archetypes' `activationProfile.axes` so `software-platform`, `it-managed-services`, and a retail wholesale archetype activate the partner program; assert the §6.1 matrix from the rules; QA on canonical install.
- **Phase 1b (setup question + add-later):** persisted generic `OrganizationCapabilityActivation` overlay `(organizationId, capabilityKey) → CapabilityActivationChoice`; wire the setup wizard to **ask** about `promptAtSetup` capabilities (partner-program first); admin capability toggle for `canEnableLater`; make the archetype changeable post-setup so applicability re-derives. Migration + UX gates. (§6.3)
- **Phase 2:** schema-audit the partner-org account (reuse `CustomerAccount` vs thin `PartnerAccount`); add `Principal.kind="partner"` + `partner-contact` alias + sync function in `principal-linking.ts`; migration.
- **Phase 3:** `UserType="partner"` + Partner credentials provider + session shape; effective-auth-context partner scope; `/partners` portal shell gated by `partner-program`.
- **Phase 4:** deal registration + tiering records (prepared-not-prescribed); delegated partner-admin role.
- **Phase 5:** partner federation (OIDC/SAML) + SCIM via the authentik edge, per the enterprise-auth spec's partner population.

## 11. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Partner identity becomes a parallel island | Binding Principal-convergence: `Principal.kind="partner"` + alias, authorization on the Principal. |
| Partner data bleeds across partners or into customer/operator views | `strict-partner-scope` isolation, partner-account ownership, server-side scope guards, tests. |
| Per-archetype partner flags proliferate | Partner program derives from axes; no archetype-id conditionals in feature code. |
| Overloading customer auth with partners | Distinct `UserType="partner"`, distinct `/partners` surface, partner-only entitlements. |
| Overbuilding PRM | Prepared-not-prescribed deal registration/tiering first; defer MDF/LMS/co-branding. |
