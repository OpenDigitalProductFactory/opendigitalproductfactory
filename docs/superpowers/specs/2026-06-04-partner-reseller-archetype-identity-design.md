---
status: active
---

# Partner / Reseller Archetype Extension, Capability Activation, And Partner Identity Design

**Date:** 2026-06-04
**Status:** Draft
**Author:** Claude (Opus 4.8) with founder direction
**Decision basis:** WWMD `principle_decide` (recorded §7); governing profile `mark-dpf-platform`
**Related specs:**
- `docs/superpowers/specs/2026-05-22-archetype-capability-applicability-and-msp-segmentation-design.md` (operating-model axes + capability derivation — the substrate this extends)
- `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md` (Principal convergence — the binding identity rule)
- `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md`
**Related epics:** `EP-PARTNER-CHANNEL` (primary), `EP-ARCH-8D4F2A` (Archetype Model V2), `EP-EDGE-NODE`, the enterprise-auth identity track

---

## 1. Problem Statement

Some business archetypes sell **through** other businesses, not only direct to end customers. A SaaS platform has referral, reseller, and technology partners. An IT managed-service provider is itself a channel partner of its vendors and may sub-contract. A goods brand sells wholesale through distributors and resellers. These businesses need to onboard, tier, enable, and pay a **partner/reseller network** — and those partners need to **log in** to a surface that is *not* the customer storefront and *not* the internal workforce console.

The current platform still exposes only two external-facing login populations and does not yet have a persisted partner-program activation or partner portal. The archetype substrate now has the first Phase 0 partner-program primitives, but the catalog/UI/auth layers are still incomplete:

- **Archetype layer.** `OperatingModelAxes.primaryConsumer` already enumerates `"channel-partner"`, and the MSP spec acknowledges that an MSP's "products sold" portfolio is "largely a resale". Phase 0 now adds a typed partner operating model, but target catalog wiring is still partial: `it-managed-services` normalizes into the partner rules, while `software-platform` and retail wholesale/distribution still need explicit activation-profile axes.
- **Identity layer.** Login is a strict binary: `User` (workforce, session `type:"admin"`) vs `CustomerContact` (storefront customer, session `type:"customer"`). A partner is *neither* — it is an external organization that transacts on its own paper, sees margin/deal-registration data a customer never should, and is governed by a partner agreement rather than an employment relationship or a purchase.

This design extends the archetype substrate to **derive** a partner program from operating-model axes (so partner support is a function of an archetype's axes, not a hand-authored flag), and specifies the **partner identity and login** as a third principal kind under the platform's binding Principal-convergence rule.

## 2. Live Backlog Context

Live DPF MCP reads on 2026-06-05 UTC / the 2026-06-04 local operating day (no DB fallback). Relevant state:

- `EP-PARTNER-CHANNEL` — *Partner / Reseller Channel & Identity* (in-progress) is now the primary epic for this design. It has six captured items:
  - `BI-DE3FA72C` — Phase 0 archetype-layer partner primitives (`in-progress`, small, build).
  - `BI-D4C550E1` — Phase 1 target archetype axis wiring.
  - `BI-66CF1AA4` — Phase 1b setup-time capability question + add-later admin toggle.
  - `BI-DE47EC0B` — Phase 2 partner identity + partner-org schema audit.
  - `BI-00E69FBA` — Phase 3 partner login + `/partners` shell.
  - `BI-C47A568C` — Phases 4-5 deal registration, tiering, delegated admin, federation, and SCIM.
- `EP-ARCH-8D4F2A` — *Archetype Model V2: Unified Business Archetypes* (in-progress) remains the upstream architecture epic. Its open implementation item (`BI-ARCH-4C1E90`) covers setup/business-archetype unification and software-platform defaults; this partner work must not duplicate that axis/setup substrate.
- `EP-EDGE-NODE`, `EP-SITE-7C4D2B`, and the MSP segmentation spec already landed the axes + portfolio + capability-derivation substrate this design plugs into (`packages/storefront-templates/src/{capability-registry,applicability-rules,activation-profile}.ts`).
- The enterprise-auth-directory-federation spec (2026-04-22) + its 2026-05-09 Principal-convergence addendum are the binding identity contract; the partner login slice is an extension of that track, **not** a new auth stack.

`search_specs_and_plans` did not return an earlier indexed partner/reseller spec for the searched terms, so this artifact remains the canonical design document for the new partner/reseller track. It is no longer accurate to say there is no related epic or backlog item: the governed backlog now exists and should be kept in sync with this spec.

## 2.1 Current Repo Truth Vs Target Contract

The rest of this design uses an explicit truth map to avoid blending landed code with future architecture:

| Bucket | Verified repo state | Implication |
| --- | --- | --- |
| Current archetype substrate | `PrimaryConsumer` already includes `"channel-partner"`; Phase 0 has added `PartnerProgramProfile`, `PartnerType`, `PartnerTier`, `PartnerPortalMode`, `PartnerGraphMode`, `CapabilityActivationChoice`, `partner-account`, and `strict-partner-scope` in `packages/storefront-templates/src/types.ts`. | Partner support can derive from axes without a new archetype-id switch. |
| Current capability derivation | `CAPABILITY_REGISTRY["partner-program"]`, `derivePartnerProgramProfile`, `partner-channel-from-axes`, `readActivationProfile(...).partnerProgram`, and `resolveCapabilityActivation` exist in the Phase 0 source. | The pure TypeScript layer is real; persistence and UI are not. |
| Current catalog wiring | `it-managed-services` normalizes into the partner rules (`portalMode=available`). **Phase 1 added** a new `wholesale-distribution` archetype (retail-goods, `form=goods` + `primaryConsumer=business` → `portalMode=available`) with catalog-level tests. `software-platform` still carries **no** `activationProfile` — left untouched by design because its axis/setup defaults are co-owned by `BI-ARCH-4C1E90` (PAR: propose-acknowledge before mutating another epic's substrate). | Two of the three target built-ins now derive a partner program from axes alone; `software-platform` is the remaining catalog wiring, to be set as `platform: "yes-developer"` *in coordination with* `BI-ARCH-4C1E90` rather than as a competing definition here. |
| Current setup/admin UI | `SetupWizard` previews activation summaries and writes `StorefrontConfig` / `BusinessContext`; there is no persisted org-level capability choice and no admin add-later toggle. | `OrganizationCapabilityActivation` must be generic and shared by setup + admin; partner-program is only the first consumer. |
| Current auth | `apps/web/lib/govern/auth.ts` has `UserType = "admin" | "customer"` and credentials providers for workforce and customer contacts. Sessions do not yet carry partner fields or a canonical `principalId`. | Partner login must extend the auth/session shape deliberately and should not clone customer auth without principal convergence. |
| Current principal spine | `Principal` and `PrincipalAlias` are live schema tables with free-string `kind` / `aliasType`; `principal-linking.ts` currently uses alias types such as `"customer_contact"` and `"agent"` (and Edge Node uses `"edge_node"`). | Use the implemented alias vocabulary style (`partner_contact`) unless a separate identity cleanup normalizes alias kinds. |
| Current account model | `CustomerAccount` is customer/CRM-heavy and has no `accountKind` discriminator. | The partner-org decision must be a real schema audit, not a casual column add. |

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
- PartnerPulse — *The Complete Guide to Partner Portals*: https://www.partnerpulse.io/blog/complete-guide-partner-portals

Adopted patterns: the 8-type partner taxonomy; deal registration; tier ladder; a dedicated partner portal surface.
Rejected patterns: cloning a full PRM (MDF management, LMS, co-branded asset studios) in the first slice; vendor-specific deal-registration workflows hard-coded into the platform.

2026-06-05 refresh: recent partner-portal/deal-registration guidance still reinforces the same minimum loop: a partner signs in, sees onboarding/enablement status, registers opportunities with a short form, tracks performance/commission state, and gets support. DPF adopts the loop but not the vendor-specific breadth: the first slice should expose **deal registration, partner tier/status, enablement resources, account/team administration, and performance readouts**, with payout/accounting execution deferred.

### 3.2 Partner identity (B2B / Partner IAM)

The identity industry treats **partner/B2B access as a third population**, distinct from both workforce (internal) and consumer/customer (B2C) login. Partner IAM emphasizes invitation-based onboarding, federated login (SAML/OIDC) against the partner's own IdP, delegated administration (a partner admin manages their own users), scoped RBAC, multi-org separation, and SCIM lifecycle provisioning.

Sources:
- Microsoft Entra — *What is B2B collaboration?* / *External ID overview*: https://learn.microsoft.com/en-us/entra/external-id/what-is-b2b , https://learn.microsoft.com/en-us/entra/external-id/external-identities-overview
- Microsoft Entra — *Cross-tenant access settings for B2B collaboration*: https://learn.microsoft.com/en-us/azure/active-directory/external-identities/cross-tenant-access-settings-b2b-collaboration
- LoginRadius — *B2B vs B2C Authentication* / *What is Partner IAM?*: https://www.loginradius.com/blog/identity/b2b-vs-b2c-authentication , https://www.loginradius.com/blog/identity/what-is-partner-iam
- SecureAuth — *B2B and Partners Access Management*: https://docs.secureauth.com/ciam/en/b2b-and-partners-access-management.html

Adopted patterns: partner login is its own population (not overloaded onto customer auth); federated OIDC/SAML; delegated partner-admin; SCIM provisioning; per-partner-org policy isolation.
Why this fits DPF cleanly: the enterprise-auth spec **already chose** an authentik identity edge with OIDC/SAML + SCIM and a DPF authority core. Partner login is the partner-population projection of that same edge — no new protocol stack. Rejected pattern: a parallel partner auth stack (see §7 WWMD and §11 doctrine).

> **Superseded stance (2026-08-26, EP-24741BBF / `BI-5167932D`).** The enterprise-auth spec's choice to adopt authentik as a runtime identity edge has been **reversed**. DPF absorbs the directory over its own `Principal` spine and adds no IdP to any install. Consuming an external IdP as an *upstream* remains supported and optional. See [Directory Service — Identity Absorption Design](2026-08-23-directory-service-identity-absorption-design.md) and [the authentik evaluation](../../security/tool-evaluations/2026-08-23-authentik.md).


2026-06-05 refresh: Microsoft Entra External ID continues to treat external business collaborators as their own governed population with cross-tenant inbound/outbound access settings, application targeting, MFA/device-claim trust, and lifecycle governance. This reinforces DPF's direction: partner access is a scoped external-identity policy surface, not a customer-contact role flag.

### 3.3 Partner portal UX and DPF reporting standards

The partner surface is an operations workspace, not a marketing site. The first viewport should show the partner's active work and standing:

- open and expiring deal registrations
- tier / authorization / agreement status
- next onboarding tasks or blocked enablement steps
- resource/library shortcuts tied to active products
- performance summary and exportable rows where applicable
- support/escalation entry point

DPF-specific UI standards override vendor screenshots:

- Use the platform theme tokens only (`--dpf-*`) and no hardcoded colors.
- Compose reporting/data-display from `apps/web/components/ui/report-kit/` (`StatusBadge`, `StatCard`, `DataTable`, `FilterBar`, `ExportButton`, `Chart`) instead of hand-rolled status pills, KPI cards, or tables.
- Keep setup progressive: ask only the essential 3-5 partner-program activation questions during first-run setup, with advanced partner policy deferred to admin.
- Use the same route/activation contract as other archetype-derived surfaces: the UI reads resolved capability activation, not raw `archetypeId`.
- The DPF design-intelligence MCP catalog returned no matching partner-portal UX entries for the searched terms on 2026-06-05; this spec therefore grounds UX in DPF's local standards and current B2B partner-portal patterns rather than pretending the catalog had guidance it did not return.

## 4. Design Goals

1. Make a partner/reseller channel **derive from operating-model axes**, so adding partner support to an archetype is a function of its axes — not a per-archetype boolean (matches the MSP spec's anti-flag-sprawl architecture).
2. Provide a typed `PartnerProgramProfile` contract describing the partner operating model (types, tiers, deal registration, downstream projection), parallel to `BillingPatternProfile`.
3. Activate partner support for the archetypes that **typically** have it (SaaS/software-platform, IT managed-services, retail wholesale/distribution) without forcing it on direct-to-consumer archetypes (salon, healthcare, HOA).
4. Model partner login/identity as a **third principal kind** under the binding Principal-convergence rule — not a parallel identity table, and not overloaded onto `CustomerContact`.
5. Give partners a distinct portal surface (`/partners`) with strict partner-account isolation, delegated partner administration, and partner-only data (margin, deal registration, downstream sub-customers).
6. Reuse the existing external-account substrate and the already-chosen identity edge; introduce the minimum new substrate.
7. Make first-run setup and later admin enablement share one generic capability-activation overlay, so partner-program does not create a one-off setup branch.
8. Make the partner UX operational and theme-aware: partner workbench first, report-kit for data display, no hardcoded colors, no marketing landing page as the default partner surface.
9. Reserve at least 20 percent of implementation capacity for refactoring shared primitives that partner support exposes (capability activation, scope policy, principal/session context, report-kit coverage), rather than shipping partner-only helpers that will be thrown away.

## 5. Non-Goals

- A full PRM (MDF, partner LMS, co-branded asset generation, channel-incentive engines) in the first slice.
- Multi-tenant partner-operated DPF installs. Partners are strict partner-account scopes inside the operator's org, mirroring the MSP customer-estate decision (§8 of the MSP spec).
- Customer→partner identity merge/split rules (a shared-email person who is both) — deferred to the convergence open-questions list.
- Replacing customer social login or workforce auth.
- Commission/payout execution and accounting sync in the first slice (prepared-not-prescribed, like MSP billing).
- Building a partner-specific setup system. The setup/add-later layer must be generic capability activation.
- Adding a partner-specific password table (`PartnerContact.passwordHash`) before the identity-edge or generic principal-credential decision is made.

## 6. Core Architecture

### 6.1 Layer A — Archetype operating model (LANDED in Phase 0)

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

Important boundary: Phase 0 lands the **contract and rules**, not all catalog data. The matrix above is the target rendered view. As of this review, `it-managed-services` already normalizes to MSP axes and produces partner-program applicability through the rules. `software-platform` and retail/wholesale need Phase 1 catalog wiring because their current built-in entries do not yet carry the target `activationProfile.axes`.

### 6.1.1 Refactoring Allocation For Implementation

Partner support exposes several platform-wide seams. The implementation plan must reserve at least 20 percent of capacity for the following refactors before adding feature-specific UI:

| Refactor | Why it belongs here | Done when |
| --- | --- | --- |
| Generic capability activation overlay | Partner-program is the first obvious opt-in capability, but the same pattern applies to any `recommended` / `optional` capability. | `OrganizationCapabilityActivation` (or the chosen equivalent) is generic by `(organizationId, capabilityKey)`, and both setup + admin resolve through `resolveCapabilityActivation`. |
| Capability-driven route guards | `/partners` must not branch on `archetypeId`; future surfaces need the same capability gate. | A shared helper answers "is capability X active for this org on surface Y?" from normalized profile + org choice. |
| Scope-policy vocabulary | `partner-account` and `strict-partner-scope` need the same rigor as customer/site isolation. | Server-side read/write helpers accept partner-account scope and tests prove no cross-partner data reads. |
| Principal/session context | Current session state is surface-specific (`admin` / `customer`) and lacks canonical `principalId`. | The auth slice adds partner context while moving toward principal-centered authorization, not another surface-specific special case. |
| Report-kit coverage | Partner portal will need status badges, tables, filters, KPI cards, CSV export, and later charts. | Any missing primitive/intent is added to report-kit/status intent registry rather than per-page local maps. |

### 6.2 Layer B — Partner identity & login (DESIGNED here; staged for the gated slice)

Per AGENTS.md §11 and the enterprise-auth 2026-05-09 convergence addendum (**binding**): any identity-bearing entity introduced after 2026-05-09 must be a `PrincipalAlias` linked to a `Principal`, not a parallel identity table. Therefore:

- **Partner human (the person who logs in)** → `Principal.kind = "partner"` plus a `PrincipalAlias` for the partner surface. The current implemented alias vocabulary uses snake_case strings such as `"customer_contact"` and `"edge_node"`, so the staged implementation should use `aliasType = "partner_contact"` unless the identity track first lands a broader alias-kind normalization. Authorization resolves on the `Principal`; the alias type only tells the platform which surface/protocol authenticated the request.
- **Partner organization (the reseller company)** → account/domain data, not identity. Run the schema audit before choosing:
  - Reuse `CustomerAccount` with an `accountKind` discriminator only if partner accounts can safely share CRM/customer hierarchy, invoices, opportunities, and customer-site semantics without ambiguous leakage.
  - Prefer a thin `PartnerAccount` if partner-specific fields (tier, agreement ref, margin policy, delegated-admin policy, deal-registration ledger, downstream partner graph) would pollute `CustomerAccount`.
  - If the same external company can be both customer and partner, model that as an explicit relationship/crosswalk rather than auto-merging on email or name.
- **Partner membership / delegated admin** → if partner users need roles inside a partner org, add a relationship row such as `PartnerAccountPrincipal` / `PartnerAccountMembership` keyed by `(partnerAccountId, principalId)` with partner-scoped roles. That row is not a credential store and does not own identity; it is account membership and authorization context.
- **Credential/auth source** → do **not** create a partner-specific password table by cloning `CustomerContact.passwordHash`. Either:
  - route partner login through the chosen identity edge (OIDC/SAML via authentik; SCIM for lifecycle); or
  - first add a generic principal-local credential substrate and make workforce/customer/partner converge on it over time.
  A local Partner credentials provider may exist only after this credential decision is made.
- **Session surface** → extend `UserType = "admin" | "customer"` to include `"partner"` and add partner fields deliberately: `principalId`, `partnerAccountId`, `partnerMembershipId`, `partnerRole`, and `partnerTier`. Keep any legacy `id` semantics explicit during transition so partner routes do not accidentally treat a domain membership id as the canonical authorization subject.
- **Authorization** → extend the effective-auth-context evaluator to understand `partner-account` ownership scope with `strict-partner-scope` isolation. A partner sees only their own partner-account records (deal registrations, margin, downstream sub-customers); never another partner's, never the operator's internal estate, never raw customer PII beyond what the partner agreement permits. Delegated partner-admin is a partner-scoped role, not a platform role.
- **Portal route** → `/partners` (external partner experience), distinct from `/storefront` (internal management) and `/portal` (customer). The `partner-program` capability's `surfaces: ["partners","partner-portal"]` gate the route — visible only when the normalized profile + org activation choice resolve the `partner-program` capability as active, never by comparing raw `archetypeId`.

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

**Staged substrate (needs migration + runtime gates):** a persisted `OrganizationCapabilityActivation` overlay (or equivalently named table) keyed by `(organizationId, capabilityKey) → CapabilityActivationChoice` (generic — not partner-specific), the setup-wizard question for `promptAtSetup` capabilities, and the admin capability toggle for `canEnableLater` capabilities. The resolution logic primitive is landed; persistence + setup/admin UI are Phase 1b and must be build-gated on the canonical install. The archetype must also be changeable post-setup (re-deriving applicability) for the add-later path to be complete — currently a reset helper exists, but no polished operator-facing archetype-change workflow exists.

Implementation shape:

1. Setup wizard reads the normalized activation profile, resolves all visible capabilities through the org-choice overlay, and asks only `promptAtSetup` capabilities.
2. Admin capability settings show `required`, `recommended`, and `optional` capabilities with `canEnableLater=true`; partner-program is the first row, not a special page.
3. Both setup and admin write the same overlay table and call the same resolver.
4. Capability activation changes emit audit/evidence rows so later Build Studio and release QA can prove which org choice enabled `/partners`.

### 6.4 Partner Portal UX Contract

The first `/partners` release should be a work surface, not a landing page. A partner logging in should immediately see status, next actions, and the records they can act on.

**Information architecture:**

| Area | Purpose | First-slice components |
| --- | --- | --- |
| Partner Home | One-screen operating picture for the signed-in partner account. | `StatCard` summary for open deals, expiring registrations, onboarding completion, support state; "next action" strip; recent activity. |
| Deal Registrations | Channel-conflict workflow. | `DataTable` + `StatusBadge` + `FilterBar`; detail page for registered opportunity, owner, expiry, decision, notes, attachments later. |
| Enablement | Resources and readiness tasks. | Resource list grouped by product/program, onboarding checklist, required agreement/evidence statuses. |
| Performance | Read-only analytics and exports. | `StatCard`, `DataTable`, `ExportButton`; chart only when there is meaningful time-series data. |
| Team | Delegated partner-admin scope. | Partner-account members, roles, invitations, federation/provisioning state. |
| Settings | Partner account metadata and program terms. | Tier, agreement refs, notification preferences, identity/federation state. |

**Interaction rules:**

- The primary command is `Register deal` when deal registration is active; use a normal command button with an icon and a short label.
- First-slice deal registration form stays short: account/prospect, opportunity name, expected value/range, target close date, notes, and conflict/territory fields only if the program requires them.
- Status names must come from a typed domain list and render through `StatusBadge` / `statusColors`; do not introduce page-local color maps.
- Tables must be scan-first: stable columns, sortable where useful, no marketing copy inside rows, row-level drill-in.
- Empty states should help the partner act ("No registered deals yet" + register action) rather than explain the whole product.
- `/partners` must be externally safe: no workforce nav, no customer portal copy, no operator-only shortcuts, no internal margin fields unless explicitly partner-visible.
- Setup/admin UI for enabling partner-program should use progressive disclosure: the initial setup prompt asks whether the org sells through partners/resellers; advanced partner types, tiers, deal registration policy, and federation live in admin.

**Visual/system rules:**

- Use only theme tokens (`var(--dpf-*)`) and the existing report-kit primitives.
- Use lucide icons where a symbol is clearer than a text-only command.
- Cards are for repeated records and metric tiles, not nested page sections.
- Partner UI must remain dense and operational: no hero section, no decorative gradients, no partner-program marketing page as the first screen.

## 7. WWMD Verification

`principle_decide` (population `external_coding_agent`, surface `partner-archetype-design`, governing profile `mark-dpf-platform`) scored three partner-identity options:

| Option | Composite | Verdict |
| --- | --- | --- |
| **A. `Principal.kind="partner"` + alias, schema-audited account substrate, derive from axes** | **1.280** | **Recommended** |
| C. Parallel `Partner`/`PartnerContact` identity table + own auth stack | 1.192 | Rejected |
| B. Reuse `CustomerContact` with a partner role flag | 1.186 | Rejected |

Top contributor for A: **Principal Convergence** (alignment 0.78), followed by Verify-substrate-before-proposing-new and Organization-as-canonical-identity. No commandment conflict. The margin (0.087) fell below the 0.2 tie threshold → flagged low-confidence/human-review; that flag is a **semantic artifact** (commandments supplied no structured features, so the three options scored close on the core principles alone). The tie is resolved **decisively by the binding written rule**: the convergence addendum *prohibits* Option C (parallel identity table) for any identity entity created after 2026-05-09, and the convergence model explicitly separates identity *kinds* rather than overloading one (`CustomerContact`), which disqualifies Option B. Option A is therefore both the kernel recommendation and the doctrine-mandated path. Human-review flag is satisfied: this design is the founder-directed artifact.

## 8. Data Model Direction

First (landed) slice — archetype layer:
- Pure TypeScript in `@dpf/storefront-templates`. No DB table, no migration. Partner program is derived JSON on the normalized profile, exactly like `billingProfile`.

Persistence slice (staged, gated):
- Add generic org capability choice storage: `(organizationId, capabilityKey, choice, source, decidedByPrincipalId, decidedAt)` with uniqueness on `(organizationId, capabilityKey)`.
- Do not add a partner-specific activation table. The same overlay supports future recommended/optional capabilities.
- Add audit/evidence activity for setup/admin changes so the operator can explain why a capability is active.

Partner account slice (staged, gated):
- Run schema audit before choosing the partner-org model.
- Preferred decision criteria:
  - `CustomerAccount.accountKind` is acceptable only if partner accounts behave as normal CRM/customer accounts in the relevant workflows.
  - `PartnerAccount` is preferred if tier, agreement, margin, deal-registration policy, delegated admin, and downstream partner graph need fields that would make `CustomerAccount` ambiguous.
  - If a business is both a customer and partner, link records explicitly; do not merge by email/name.
- Partner membership should be a `Principal`-keyed relationship row (`partnerAccountId`, `principalId`, role/tier/admin flags), not a credential-owning identity table.

Identity/auth slice (staged, gated):
- Add `Principal.kind = "partner"` and `PrincipalAlias.aliasType = "partner_contact"` (or the post-normalization alias value if identity vocabulary is cleaned up first).
- Extend session/auth to carry canonical `principalId` plus partner fields (`partnerAccountId`, `partnerMembershipId`, `partnerRole`, `partnerTier`).
- Avoid a partner-only password store. Use the identity edge or a generic principal-local credential substrate before adding a local Partner credentials provider.
- Migration applies cleanly + UX verification on the canonical install (build gate §5) — this is why the identity/account slice is staged behind the pure-TS primitive slice.

## 9. Acceptance Criteria

1. `derivePartnerProgramProfile` produces `primary` for channel-partner axes, `available` for platform/MSP/wholesale axes, and `none` for direct-to-consumer axes — from axis values alone, no per-archetype hand-edits. *(Met in Phase 0 rule tests — `applicability-rules.test.ts`.)*
2. The `partner-program` capability is `required` for channel-partner, `recommended` for platform/MSP/wholesale, `not-applicable` otherwise, with `partner-account` ownership and `strict-partner-scope` isolation. *(Met in Phase 0 rule tests.)*
3. `NormalizedActivationProfile.partnerProgram` is populated by `readActivationProfile`. *(Met in Phase 0 source; add a direct regression assertion if missing from the test file before PR.)*
4. `resolveCapabilityActivation` makes `recommended` capabilities ask at setup + opt-in + add-later, `required` on-by-default, `optional` add-later-only, `not-applicable`/`hidden` never. *(Met — `capability-activation.test.ts`.)*
5. Package typecheck + vitest pass on the source-local worktree. *(Source-local gate; not canonical-runtime evidence.)*
6. (Phase 1) Built-in catalog entries for `software-platform`, `it-managed-services`, and retail wholesale/distribution carry target axes and assert the rendered §6.1 matrix without raw archetype-id branching.
7. (Phase 1b) When a `recommended` partner archetype is chosen at setup, the wizard asks whether the org sells through partners/resellers; the answer persists in a generic org-capability overlay; a declining org can enable it later from admin; setup and admin share `resolveCapabilityActivation`.
8. (Phase 1b) The add-later/admin UI uses DPF theme tokens and, where it displays capability status lists, report-kit primitives. No hardcoded colors, local status maps, or partner-only activation tables.
9. (Phase 2) Partner account schema audit is completed and documented; partner org data is separate from partner human identity; same-company customer/partner overlap is represented by an explicit relationship, not email/name merge.
10. (Phase 3) Partner login resolves to `Principal.kind="partner"` via a convergence-compliant alias (currently expected `partner_contact`); authorization resolves on the Principal; `/partners` is gated by resolved active `partner-program`, never by raw archetype id.
11. (Phase 3) No partner-specific password table is introduced. Local credentials, if needed before federation, use a generic principal-credential substrate or the identity edge.
12. (Phase 3) A partner cannot see another partner's records or the operator's internal records; strict server-side scope tests cover list, detail, mutation, and export paths.
13. (Phase 3) `/partners` opens to an operational workbench with deal registrations, onboarding/enablement, performance, team, and settings affordances; UX is verified against the canonical local install or shared local-CI convergence sandbox.
14. (Identity/account slices) Migrations apply cleanly; runtime-bound gates name their substrate per AGENTS.md §15.

## 10. Phases

- **Phase 0 (landed in this change):** archetype-layer partner primitives + derivation + the `resolveCapabilityActivation` setup/add-later resolution logic + tests.
- **Phase 1 (partially landed):** wire the target archetypes' `activationProfile.axes` so they activate the partner program; assert the §6.1 matrix from the rules. **Landed:** new `wholesale-distribution` archetype (retail-goods, `form=goods`+`primaryConsumer=business` → `available`) + catalog-level partner-derivation tests; `it-managed-services` already derives `available`. **Remaining:** `software-platform` axes (`platform: "yes-developer"`), set *in coordination with* `BI-ARCH-4C1E90` per PAR (not a competing definition here); seed reconciliation + portal QA for the new archetype on the canonical install.
- **Phase 1b (setup question + add-later):** persisted generic `OrganizationCapabilityActivation` overlay `(organizationId, capabilityKey) → CapabilityActivationChoice`; wire the setup wizard to **ask** about `promptAtSetup` capabilities (partner-program first); admin capability toggle for `canEnableLater`; make archetype change/refresh operator-facing enough that applicability re-derives. Migration + UX gates. (§6.3)
- **Phase 2 (partner account + membership):** schema-audit the partner-org account (`CustomerAccount.accountKind` vs `PartnerAccount` vs explicit crosswalk); add partner-account membership keyed by `principalId`; no credential-owning partner contact table.
- **Phase 2a (identity/auth refactor checkpoint):** decide identity-edge-first vs generic principal-local credentials before any local Partner credentials provider is written. Add `syncPartnerPrincipal` / alias helpers in `principal-linking.ts` using the current alias vocabulary (`partner_contact`) unless a prior cleanup changes it.
- **Phase 3:** `UserType="partner"` + session shape with canonical `principalId`; effective-auth-context partner scope; `/partners` portal shell gated by active `partner-program`; partner workbench UI with report-kit primitives.
- **Phase 4:** deal registration + tiering records (prepared-not-prescribed), delegated partner-admin role, and export/reporting paths with strict partner-account scope guards.
- **Phase 5:** partner federation (OIDC/SAML) + SCIM via the authentik edge, per the enterprise-auth spec's partner population.

## 11. Risks And Mitigations

| Risk | Mitigation |
| --- | --- |
| Partner identity becomes a parallel island | Binding Principal-convergence: `Principal.kind="partner"` + alias, authorization on the Principal. |
| Partner data bleeds across partners or into customer/operator views | `strict-partner-scope` isolation, partner-account ownership, server-side scope guards, tests. |
| Per-archetype partner flags proliferate | Partner program derives from axes; no archetype-id conditionals in feature code. |
| Overloading customer auth with partners | Distinct `UserType="partner"`, distinct `/partners` surface, partner-only entitlements. |
| Overbuilding PRM | Prepared-not-prescribed deal registration/tiering first; defer MDF/LMS/co-branding. |
| Setup becomes partner-specific | Generic org capability overlay and shared resolver; partner-program is only the first consumer. |
| `CustomerAccount` becomes semantically overloaded | Schema audit with explicit decision criteria; prefer a thin `PartnerAccount` or crosswalk if partner fields would pollute customer CRM semantics. |
| Partner login clones customer password storage | Identity-edge-first or generic principal-local credential substrate; no `PartnerContact.passwordHash` table. |
| Alias naming drifts from implementation | Use current implemented alias vocabulary (`partner_contact`) unless a separate alias-kind normalization lands first. |
| Partner portal ships as a marketing dashboard | UX contract requires operational workbench, report-kit components, setup/admin progressive disclosure, and canonical-runtime UX verification. |
