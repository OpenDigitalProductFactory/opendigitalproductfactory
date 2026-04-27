| Field | Value |
| --- | --- |
| Date | 2026-04-25 |
| Status | Draft |
| Author | Codex + Mark Bodman |
| Scope | Establish this install as the real Open Digital Product Factory production instance, separate it from development/runtime interference, and use it as customer-zero proof by running marketing, customer management, sales, and improvement work through DPF itself |

## 1. Problem Statement

This install is currently caught between two identities:

1. a generic business using DPF
2. the real Open Digital Product Factory business using DPF to market, sell, deliver, and improve DPF itself

The user direction for this work is explicit:

1. this instance should become the real production instance for Open Digital Product Factory
2. DPF should be represented here both as the business operating the instance and as a sold product in the market taxonomy
3. development activity must stop interfering with the production-served runtime on this machine
4. the team should begin using DPF as customer zero, including Hive Mind and governed delivery patterns, so the platform improves by being used the way customers are expected to use it

The primary goal is not storytelling polish. The primary goal is operational truth:

1. production and development must be distinct
2. DPF must be modeled correctly as the operator and sold product
3. this instance must actually be used to market, manage customers, and sell
4. the customer-zero story should emerge from that reality as a proof point

## 2. Inputs and Grounding

This spec is grounded in:

- `AGENTS.md`
- `docs/platform-usability-standards.md`
- `docs/superpowers/specs/2026-04-18-purpose-first-product-estate-design.md`
- `packages/db/prisma/schema.prisma`
- `apps/web/components/storefront-admin/SetupWizard.tsx`

Live runtime checks were performed against the Docker-backed PostgreSQL database on 2026-04-25.

Verified live state:

1. the only live `Organization` row is `Managing Digital` with slug `managing-digital`
2. the live `StorefrontConfig` is published
3. the live storefront archetype is `Corporate Training` in category `education-training`
4. the live storefront still contains six training-oriented `StorefrontItem` rows such as `Leadership Training` and `Compliance Training`
5. the live backlog has no dedicated epic yet for this production-instance / customer-zero work
6. the current setup UX still contains generic business-model language such as `Define your business model`
7. the current runtime schema file includes `MarketingPublishedSnapshot`, but the live database does not yet contain that table, so publication-boundary plans that depend on it are not live-ready yet

Operational implication:

- this install is still behaving more like a generic training-business example than the real Open Digital Product Factory production business

## 3. Goals and Non-Goals

### Goals

1. establish this install as the canonical production instance for Open Digital Product Factory
2. keep production runtime and development/runtime experimentation clearly separated on the same machine
3. model DPF as both:
   - the real operating business on this install
   - a sold product offering in the market taxonomy
4. use DPF itself for real marketing, customer, sales, and internal improvement work
5. make customer-zero operation a source of product truth and platform improvement
6. align Build Studio and related governed-delivery behavior with the same isolation model customers should adopt

### Non-Goals

1. redesigning every product, CRM, or portal surface in one pass
2. fully solving pricing, packaging, checkout, and release-management for all future DPF offerings
3. pretending that incomplete publication-boundary features are already live
4. merging business identity, sold-product taxonomy, and runtime workflow into one undifferentiated model

## 4. Research & Benchmarking

This design must follow the repo rule that new feature/system design be benchmarked before finalization.

### 4.1 Open source systems reviewed

#### GitLab

Sources:

- [GitLab dogfooding](https://about.gitlab.com/direction/dogfooding/)
- [GitLab review apps](https://docs.gitlab.com/ci/review_apps/)
- [Using review apps in the development of GitLab](https://docs.gitlab.com/development/testing_guide/review_apps/)

What it teaches:

1. dogfooding is strongest when it is tracked as a first-class operating practice, not just a marketing claim
2. per-branch or per-merge isolated preview environments are a practical pattern for preventing development from colliding with production
3. stakeholder-visible preview URLs reduce the temptation to test unfinished work against the production surface

Patterns adopted:

1. treat customer-zero usage as a managed operating model
2. require isolated development/build environments before promotion to the production-served instance

Patterns rejected:

1. using the live production route as the default development sandbox

#### ERPNext

Sources:

- [ERPNext homepage](https://erpnext.com/homepage)
- [ERPNext docs](https://docs.erpnext.com/)

What it teaches:

1. a business platform becomes more credible when it clearly covers the real operating loop of the company using it
2. product credibility rises when the platform is visibly used for order, customer, and operational workflows rather than only described abstractly

Patterns adopted:

1. this install should be used for real business operations, not remain a sample data shell
2. the sold-product story should connect directly to operational modules and customer handling

Patterns rejected:

1. a purely brochure-style product story detached from the actual operating system

#### Odoo

Sources:

- [Odoo](https://www.odoo.com/en_US)

What it teaches:

1. a unified business platform can legitimately present the same system as both business operating stack and productized offering
2. the value proposition becomes clearer when marketing, CRM, sales, operations, and customization live in one coherent platform story

Patterns adopted:

1. keep one platform story across marketing, CRM, sales, and operations
2. make the relationship between operating the business and selling the platform explicit rather than accidental

Patterns rejected:

1. forcing the user to mentally stitch together separate systems to understand how the business runs

### 4.2 Commercial systems reviewed

#### ServiceNow

Sources:

- [How ServiceNow uses ServiceNow](https://www.servicenow.com/company/how-servicenow-uses-servicenow.html)
- [Customer zero: 4 ways we use ServiceNow tech internally](https://www.servicenow.com/blogs/2023/4-ways-we-use-servicenow-tech-internally)

What it teaches:

1. `customer zero` can be a credible operating principle when the company uses its own platform across customer experience, operations, and internal service delivery
2. the strongest proof point is not just that the product is used internally, but that the company can point to specific operating loops run on it

Patterns adopted:

1. position DPF-on-DPF as real operating truth, not as a demo label
2. make customer-facing and internal operations both part of the customer-zero scope

Patterns rejected:

1. vague claims of internal use without concrete workflow and governance implications

#### Salesforce

Sources:

- [Salesforce on Salesforce](https://www.salesforce.com/salesforce-on-salesforce)
- [Salesforce on Salesforce series](https://www.salesforce.com/blog/salesforce-on-salesforce/)

What it teaches:

1. a platform company can explicitly present itself as customer zero while also using that fact to drive conversion and trust
2. unified data and workflow become more persuasive when internal use directly improves customer-facing experiences and sales execution

Patterns adopted:

1. use real internal adoption to improve lead handling, customer support, and product presentation
2. let sales and operating truth reinforce each other

Patterns rejected:

1. keeping customer-facing sales flows separate from the operating system that should power them

#### Atlassian

Source:

- [Dogfooding and frequent internal releases](https://www.atlassian.com/blog/archives/agile_development_dogfooding_and_frequent_internal_releases%24)

What it teaches:

1. external customer-visible systems should not be treated the same as rough internal milestone environments
2. controlled external exposure matters when unfinished changes can alter customer trust

Patterns adopted:

1. preserve a stricter boundary for the customer-visible production-served runtime
2. let earlier experimentation happen in isolated non-production environments

Patterns rejected:

1. assuming every internal dogfooding environment is suitable for public-facing use

## 5. Current-State Diagnosis

### 5.1 Identity mismatch

The live install is still branded and modeled as `Managing Digital`, not Open Digital Product Factory.

### 5.2 Sold-product mismatch

The live storefront content still represents training offerings rather than DPF as the product being sold.

### 5.3 Runtime-role mismatch

The machine currently hosts a production-served portal at port `3000`, but the user explicitly called out that development behavior still risks interfering with that production path. The current repo workflow and Build Studio design already point toward isolated development/runtime paths, but this install is not yet operationalized around that rule.

### 5.4 Customer-zero mismatch

DPF is not yet being used here strongly enough as the real system for:

1. product marketing
2. customer management
3. sales and inquiry handling
4. governed self-improvement

### 5.5 Publication-boundary mismatch

The schema suggests movement toward a curated publication boundary (`MarketingPublishedSnapshot`), but the live DB proves that boundary is not yet active on this install. The design therefore cannot assume a finished publish pipeline for customer-safe product context.

## 6. Design Principles

### 6.1 Production First, Narrative Second

The instance must first become the real operating production instance. The customer-zero story is evidence of that truth, not a substitute for it.

### 6.2 One Business, Two Legitimate Roles

DPF appears here in two roles:

1. as the business operating the platform
2. as a sold product offering in the market taxonomy

These are related but must not be collapsed.

### 6.3 Distinct Runtime Roles

Production runtime, development runtime, and governed promotion flow are different concerns and must behave differently.

### 6.4 Customer-Zero as Product Validation

The platform should improve because DPF uses it to run itself, not because the team keeps bypassing platform workflows with ad hoc external tooling.

### 6.5 Canonical Data Before Curated Copy

Business identity, sold-product taxonomy, and operating workflows must be canonical in the data model before optimizing sales copy and narrative polish.

### 6.6 Build Studio Is Part of the Proof

The same isolation and governed-delivery behavior sold to customers should be exercised here. This includes isolated build/dev paths, promotion discipline, and protection of the production-served runtime.

## 7. Target Model

### 7.1 Three-Layer Instance Model

This install should be understood through three layers.

#### Layer 1: Operating Business Identity

`Organization` remains the canonical model for the business running this install.

Target state:

1. the live organization should represent Open Digital Product Factory
2. business context should describe the real business, market, and operating model of DPF

#### Layer 2: Sold Product Taxonomy

The sold-product layer should represent DPF as an offering, not as a side effect of the operator identity.

Target state:

1. the storefront/product taxonomy should present DPF offerings
2. public-facing catalog and inquiry paths should reflect what DPF actually sells
3. the public product story should make clear that DPF is available as a product/platform for other organizations

#### Layer 3: Runtime and Improvement System

The instance should visibly function as the system DPF uses to run and improve itself.

Target state:

1. marketing, customer, sales, and delivery work happen here
2. governed change, Build Studio, and Hive Mind workflows are exercised here
3. production remains protected while development occurs in isolated environments

### 7.2 Canonical Relationship Between the Layers

The UX and architecture should communicate:

`Open Digital Product Factory uses DPF to build, run, market, sell, and improve DPF.`

This is not duplication. It is customer-zero operation.

## 8. Runtime Architecture and Environment Posture

### 8.1 Runtime Roles

Define three explicit runtime roles:

1. `production-served runtime`
   - customer- and operator-trusted live surface
   - canonical local production route
   - should remain stable and protected
2. `development/build runtime`
   - isolated local or external environment for active changes
   - never the default customer-facing path
3. `promotion path`
   - the governed route from dev/build into production
   - aligned with Build Studio, branch/PR, and validation rules

### 8.2 Local Port and Surface Policy

The user's concern about port `3000` is correct and should become policy.

This formalizes guidance that already exists in `AGENTS.md` § "Portal Runtime & Navigation", which states that production-path verification must use the Docker-served app at `http://localhost:3000` and not stale ad hoc `next dev` / `next start` sessions. This spec extends that rule from a verification convention into an operating boundary for the install.

Target rule:

1. `localhost:3000` is reserved for the production-served runtime of this install
2. local development must use separate ports and/or separate isolated environments
3. development workflows must not assume they can casually replace or hijack the production-served port

This is both a local safety rule and a product requirement, because customers using DPF will need the same separation.

### 8.3 Environment Isolation Expectations

Supported development shapes should include:

1. external development environments
2. isolated local dev ports
3. sandbox/build containers
4. per-branch/workflow preview environments where applicable

The important design constraint is not one specific tool. It is that production and in-progress work are never ambiguous.

### 8.4 Build Studio Alignment

Build Studio was designed to support this kind of governed separation. This install should use the same pattern it sells:

1. isolated work/build path
2. explicit verification
3. governed promotion to production

That makes DPF-on-DPF a real validation loop instead of an exception-ridden maintainer workflow.

## 9. UX and Workflow Implications

### 9.1 Business Setup

The setup and business identity flow should stop feeling like a generic-company bootstrap.

Target behavior:

1. the instance identifies as Open Digital Product Factory
2. setup language no longer implies a random example business
3. the operating business and sold-product roles are both visible, but clearly distinguished

### 9.2 Public Product Surface

The public-facing surface should present DPF as the product offering.

Target behavior:

1. the live storefront/catalog no longer reads as a training-company example
2. prospects can understand what DPF is, what it helps run, and how it is adopted
3. inquiry/demo/contact or similar conversion paths align with the real product

### 9.3 Customer and Sales Operations

This instance should actually be used to manage real customer/prospect flow.

Target behavior:

1. inquiries and customer records are handled in DPF-native surfaces
2. sales/customer workflows are not left in external ad hoc systems by default
3. the customer-facing and internal business loops strengthen each other

### 9.4 Customer-Zero Proof

The public/customer-visible narrative should be curated, not noisy.

Target behavior:

1. buyers can understand that DPF runs on DPF
2. the proof is visible as confidence and maturity
3. unfinished internal experimentation is not exposed as if it were production truth

## 10. Data Model Stewardship

### 10.1 Canonical Operator Identity

`Organization` remains the canonical business identity model.

### 10.2 Canonical Business Context

`BusinessContext` should describe the real DPF business rather than stale example-business content.

### 10.3 Sold Product Representation

The sold-product representation should be treated as product/storefront/catalog truth, not overloaded into `Organization` copy alone.

Current evidence suggests the live install still relies heavily on `StorefrontItem`-style catalog records rather than a broader first-class product packaging model. That is acceptable for the first slice if the content becomes truthful, but a later refactor may be needed so DPF product/package semantics are more explicit and reusable.

Planning prerequisite: open question 15.2 (whether the first sold-product representation can ride on `StorefrontItem` or needs a more explicit product/package model immediately) must be resolved before the first-slice replacement work in section 11.1 item 3 can be tasked. It is not a deferrable open question — the planner cannot write the catalog-replacement task without picking a model.

### 10.4 Archetype Constraint and DPF Identity

`StorefrontConfig.archetypeId` is the single source of truth for portal industry category and is treated as effectively write-once per the project rule in `CLAUDE.md` § "Portal Archetype". The live install's archetype is `Corporate Training` in category `education-training`, and none of the 11 canonical industries in `apps/web/lib/storefront/industries.ts` cleanly represents "software platform" or "digital product factory".

This means converting business and sold-product identity from `Managing Digital`/training to Open Digital Product Factory cannot be done by editing copy alone — it collides with the archetype rule. The implementation plan must pick one of:

1. add a new canonical industry slug (e.g. `software-platform` or `digital-products`) to `industries.ts` and seed a matching built-in archetype for DPF
2. classify DPF under `professional-services` as the closest existing fit and accept the imprecision in vocabulary/finance defaults
3. build the admin/support archetype-reset operation that `CLAUDE.md` describes but does not yet exist as a user-facing flow

This is captured as a new open question in section 15.

### 10.5 Publication Boundary

Because `MarketingPublishedSnapshot` is not live in the current database, this design treats publication-boundary work as a dependency or follow-on slice, not as already available infrastructure.

## 11. First Slice Recommendation

The first slice should be a `customer-zero production spine`, not a full redesign.

### 11.1 Scope

1. establish runtime separation rules and local production/dev posture
2. convert canonical business identity from generic/example state to Open Digital Product Factory (gated on resolving the archetype-rule collision in section 10.4 and open question 15.5)
3. convert sold-product storefront/catalog truth from training-example content to DPF product truth (gated on resolving the catalog-model decision in open question 15.2)
4. identify and route the initial real marketing/customer/sales loop through DPF-native surfaces (see section 12 starter set)
5. document how Build Studio and isolated development fit this install's production posture

### 11.2 Why this slice

This is the smallest slice that makes the install real:

1. it protects production
2. it gives the business the correct identity
3. it gives the sold product the correct identity
4. it starts using DPF operationally

## 12. Backlog Shape

This work should be tracked under a new epic rather than folded into unrelated open epics.

Overlap check: open and recently merged epic-adjacent work was reviewed against this scope, including the 2026-04-18 purpose-first product estate design, the customer marketing workspace phase 1 plan (2026-04-24), the external customer AI coworker design (2026-04-24), the build-studio governed backlog delivery design (2026-04-23), and the backlog → triage → Build Studio integration spec. Each of those is upstream infrastructure that this customer-zero work will exercise; none of them owns the operator/sold-product identity conversion or the production-vs-dev runtime boundary. A new epic is therefore appropriate.

Recommended epic theme:

- `DPF on DPF: Production Instance and Customer-Zero Operationalization`

Recommended first backlog items:

1. define and enforce local production-vs-dev runtime/port separation for this install
2. update canonical organization and business context to Open Digital Product Factory live truth
3. replace current training-example storefront/catalog content with DPF sold-product content
4. define the minimum DPF-native marketing/customer/sales operating loop for this instance
5. align Build Studio/local workflow guidance so production changes follow the same governed pattern sold to customers
6. audit current setup UX for generic/example copy that conflicts with DPF-on-DPF operation

Starter set for item 4 ("DPF-native surfaces"): the first prospect-to-customer loop should land on surfaces that already exist in the current branch/runtime truth, not on net-new concepts invented by the plan. Baseline candidates to evaluate during planning are:

1. the public storefront/catalog as the prospect entry point
2. the existing storefront inquiry/order flows and internal storefront inbox surfaces for conversion handling
3. the governed backlog workflow (`apps/web/lib/governed-backlog-workflow.ts`) for converting customer signal into product work

Adjacent in-progress work such as customer-assistant or customer-marketing modules may become follow-on candidates after they land, but they are not assumed as present in this plan's baseline. Open question 15.1 picks the concrete starter set.

## 13. Risks and Constraints

### 13.1 Overloading one model

If operator identity and sold-product taxonomy are merged into one data object, the system will become harder to reason about and extend.

### 13.2 Fake customer-zero

If the team keeps doing core marketing, sales, and improvement work outside DPF, the instance may tell a customer-zero story without actually validating the platform.

### 13.3 Runtime confusion

If local or external dev work continues to hijack the production-served route, this install will remain untrustworthy as a production reference.

### 13.4 Assuming future-state infrastructure is already live

The current gap between schema and live DB on publication-boundary tables is a reminder not to write aspirational architecture as if it is already enforced.

## 14. Success Criteria

This first design is successful when:

1. the production-served runtime is distinct from development/build runtime in practice
2. the live instance is canonically Open Digital Product Factory rather than a generic example business
3. DPF is presented as the sold product in the market-facing taxonomy
4. this instance is actually used to market, manage customers, and sell through DPF-native flows
5. customer-zero proof emerges from real operation rather than curated theater

## 15. Open Questions for Planning

These are implementation-plan questions. Items marked `(planning prerequisite)` must be answered before the corresponding first-slice work in section 11.1 can be tasked; the rest may be deferred into the plan itself.

1. which exact DPF-native surfaces should own the first real prospect-to-customer loop — pick from or extend the starter set in section 12 `(planning prerequisite for 11.1 item 4)`
2. whether the first sold-product representation can ride on `StorefrontItem` or needs a more explicit product/package model immediately `(planning prerequisite for 11.1 item 3)`
3. what the default local/external developer runtime matrix should be for this install
4. how strongly the public-facing UX should narrate `DPF on DPF` in phase 1 versus letting it appear more subtly as proof
5. how to satisfy the archetype-rule collision in section 10.4: add a new canonical industry slug for software/platform offerings, classify DPF under `professional-services`, or build the admin/support archetype-reset operation `(planning prerequisite for 11.1 item 2)`
