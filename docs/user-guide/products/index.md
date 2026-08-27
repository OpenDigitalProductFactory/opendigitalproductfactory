---
title: "Product Inventory"
area: products
order: 1
---

## Overview

DPF keeps two related product concepts separate:

- **Business products** are the goods, services, experiences, or access the
  organization sells. They belong to an organization-owned product line under
  **Goods and Services for Sale**. Storefront setup creates the initial
  hierarchy from lines the operator confirms.
- **Digital products** are software, data, platforms, or other digital
  architecture. The Product Inventory is the structured catalogue for these
  digital products. Every digital product has a lifecycle stage, operational
  status, portfolio and taxonomy links, and associated backlog.

A business product may later be traced to digital products that constitute or
augment it, once a real relationship and consuming workflow exist. Setup does
not invent that trace, and it does not turn a salon service, hotel room, meal,
or retail good into a digital product.

## Understand what supports a digital product

Open a digital product and choose **Operate > Dependencies**. This is the
single product-scoped home for four related views that keep their source
semantics separate:

- product-to-product relationships;
- deployed or discovered estate;
- CycloneDX software composition from the current SBOM; and
- sourced support-lifecycle milestones for shared component identities.

The Digital Product Factory Portal uses the same surface for its own platform
SBOM and technology currency. The platform seed persists the generated
lockfile SBOM idempotently, so repeated installation or upgrade runs replace
occurrences instead of creating parallel documents. The former **Supply
Chain** tab and Operations **Stack Currency** page are compatibility redirects
to the software-composition section, not additional ledgers.

DPF assembles product-management summaries from a read-only operating context.
That context follows the business hierarchy first, then includes a digital
product only when a real operational Offering link establishes it. Research and
competitive evidence can be organization-wide or explicitly scoped to one
enabling digital product. An empty section means no matching evidence exists;
an unavailable section means the platform does not yet have a safe typed link.
Neither state is silently presented as healthy, complete, or zero.

## Use Product Direction

Open **Products** and start in **Goods and Services for Sale**. This is the
business-product hierarchy created from the product mix confirmed during
Storefront setup. Select a product line to compare its managed products, or
select a product to open its **Direction** brief.

A product-line Direction page compares recorded performance over an explicit
current period and baseline. Recognized Product Sold sales and revenue exclude
cancelled and fully refunded records. Each root sale is counted once; package
allocations remain non-additive attribution. Mixed currencies are labelled
instead of being presented as one valid currency total.

The page also shows attributed demand and compatible objective posture when
those records exist. Conversion, repeat purchase, package attach rate, margin,
capacity, stock, quality, and cannibalization remain visibly unavailable until
a canonical business-Product evidence adapter exists. A missing measure is
never shown as zero.

**What deserves attention?** lists only deterministic, evidence-backed
investigations. Each recommendation identifies the evidence window,
confidence, blind spots, approval boundary, and follow-up measure. In Simple
mode the language is owner-operator friendly; Full mode reveals the denser
decision detail. Both modes use the same projection.

Open the page coworker and choose **Ask what this business would do** to turn a
recommendation into reversible options and consult the organization's WWWD
stance. Rendering the page does not call a model or change pricing, capacity,
marketing, catalog, or funding.

The product brief is ordered around work:

1. demand that needs a decision;
2. changed research and delivery evidence;
3. funded or in-progress bets;
4. outcome posture;
5. scheduled coworker runs.

The **Simple** navigation preference uses guided language and collapses source
detail. **Full** uses a denser professional presentation. This changes only the
projection; it does not create a different role, product model, provider, or
consumer.

### Activate product demand with evidence

Product Direction projects the same demand records owned by **Operations >
Delivery Flow**. Choose **Review demand decisions** to open that canonical flow
already filtered to the current organization, product line, or Product.

Historical backlog rows with no demand stage appear as **Needs
classification**. They are not silently called raw. For an active request:

1. classify it as product demand;
2. state the customer or business problem;
3. link at least one reviewed source such as published Knowledge, customer
   feedback, a booking, order, subscription, fulfillment record, or research;
4. record value, confidence, and an attributed effort estimate;
5. reconcile AI and human effort when they differ;
6. move the request through screened and shaped;
7. request the organization-governed funding decision.

**Why this score?** shows the exact inputs, confidence, evidence count, effort
source, missing fields, and whether the result is provisional. Scoring does not
move an item through the lifecycle. Each transition is a separate audited act,
and only the funding decision can move shaped demand to ready.

Evidence links retain the source system's stable reference; they do not copy or
replace the source fact. Product Direction shows the latest rationale and
decision history as a read-only projection, so it cannot diverge from Delivery
Flow.

An unavailable card means the owning contract is not active or no safe typed
association exists. An empty card means the source is available but has no
matching evidence. Neither condition is rendered as a healthy zero.

### Learn from product outcomes

From a business Product, open **Direction → Outcomes**. Define the first
outcome in ordinary business language:

1. name what is happening now;
2. describe the change you expect and why;
3. choose how you will notice it;
4. record an honest starting point and target;
5. choose when to review the evidence.

Measures may be a number, percentage, currency, duration, or qualitative
change. Currency, duration, and business-specific counts retain their unit so
unlike observations are not compared. Qualitative outcomes use written
starting and target expectations rather than invented numeric scores. A
missing baseline, target, or observation is shown as insufficient evidence.

New outcomes begin as drafts. Choose **Start learning** when the contract is
ready, then append observations as evidence arrives. An observation names its
source and can include a stable reference and confidence. If a value was
wrong, choose **Correct observation**: DPF appends the correction and retains
the original in history.

Only backlog work already scoped to the same business Product can be linked as
contributing work. The link does not move, fund, or reassign the backlog item.
Closing or archiving an outcome preserves its observations and work links.
Product-line outcome posture is derived from its real Products; no second
product-line outcome ledger is created.

### Read the evidence-derived roadmap

Open a business Product and choose **Direction → Roadmap**. A product line also
shows its rolled-up roadmap on its **Direction** page. Both are current
projections over the same operating context; neither is a separate planning
board.

The default view is **Now / Next / Later**:

- **Now** contains funded, active-objective-linked work with current delivery
  evidence.
- **Next** contains funded, active-objective-linked work that is ready to
  sequence.
- **Later** contains committed work whose confidence, dependency, or
  architecture evidence prevents a safer near-term position.

A funded item is not a committed roadmap bet until it is explicitly linked to
an active product objective. Unclassified demand, work that has not passed the
funding gate, inactive objectives, and contradictory delivery records appear
under **Needs evidence before commitment**. The roadmap does not guess the
missing state.

**Timeline**, **Outcomes**, and **Dependencies** are alternate views of the
same projection. Timeline entries appear only when a canonical delivery or
release record supplies a date. Digital-product architecture dependencies are
shown as coordination evidence; they are not silently converted into business
backlog dependencies.

Choose **Review with coworker** to explain commitments, readiness gaps,
confidence, dates, and coordination before recording a stakeholder review
through the existing business-decision audit. **Download current snapshot**
creates a timestamped JSON evidence packet with the filters, source IDs, and
confidence shown on screen. The packet is marked non-importable and never
replaces live demand, objective, dependency, or delivery records.

The stable product URL is shared through a compatibility boundary. A business
Product receives the business header and Direction navigation. A
`DigitalProduct` keeps its existing lifecycle, architecture, delivery, and
operations navigation. DPF never guesses a business Product from a digital
product or offering; an ambiguous identifier fails closed.

**Preview a demand review** explains the read scope, sources, proposed writes,
approval boundary, and schedule effect before leaving the page. The Direction
brief itself does not send a prompt, approve funding, or mutate backlog data.

## Build Continuous Product Intelligence

From a business Product, open **Direction → Intelligence**. The page keeps four
things visibly separate:

- research proposals waiting for a person to approve or skip;
- completed research drafts waiting for Knowledge review;
- published Wiki knowledge that has been reviewed;
- competitive battlecards, which retain positioning without becoming a second
  citation store.

Choose **Propose research** to write one focused question. The preview shows the
business Product scope and the proposed write before anything is saved. Saving
creates a pending proposal only. A web and inference run begins only after a
person approves it, and its result remains a draft until someone reviews and
publishes it in Knowledge.

Choose **Schedule a recurring scan** when the question should be revisited
weekly or monthly. Each run creates another reviewable proposal; it does not
search, spend inference capacity, or publish automatically. You can pause,
resume, or request the next proposal run from the same page.

Evidence labels distinguish **This product**, **Product line**, **Whole
business**, and **Enabling digital architecture**. ProductLine/Product evidence
does not become DigitalProduct architecture, and a DigitalProduct link is never
used to infer a business Product. Reviewed research exposes its source URLs,
retrieval time, confidence, and whether it is the first baseline or a change
since the last reviewed baseline. A stale warning means the evidence is older
than 30 days; it is not a claim that the finding is false.

If no source returns a useful result, the completed proposal says so instead of
creating a fabricated report. Failed runs remain visible with their failure
summary. A first-run page offers one useful research action rather than
displaying a zero-filled dashboard.

## Schedule recurring product work

Product and ProductLine **Direction** pages offer optional coworker playbooks
for recurring reviews such as weekly intelligence, demand triage, roadmap
refresh, outcome review, commercial opportunity review, and stakeholder
briefing. Nothing is scheduled by setup and selecting a playbook does not run
it.

Choose a useful review, then select **Preview first run**. The preview shows the
current business scope, evidence sources, allowed tools, proposed writes,
approval boundary, cadence, and failure behavior. Only after that preview can
you explicitly confirm the schedule. If the recipe's permissions or write
boundary later changes, DPF requires another preview before rerun.

Scheduled cards distinguish current, unchanged, partial, failed, paused, and
permission-changed states in text. A partial or failed run does not replace the
last successful evidence fingerprint. Use **Inspect last run** for the audited
run record, or pause, resume, and request a rerun from the same Direction
surface.

**Export owner brief** downloads a timestamped, source-linked snapshot of the
current operating context. It is derived evidence marked `importable: false`;
it cannot become a second roadmap, objective, demand, or decision authority.
Adoption measures appear only when canonical timestamps and decision or review
records support them. Unsupported measures say **Unavailable** instead of
inventing movement or acceptance.

## From Product To Something A Customer Can Select

The commercial path is:

`Product line → Product → Offering → Catalog item → Storefront item`

- A **Product** is the durable good, service, experience, or access the
  organization manages.
- An **Offering** is the provider's commercial promise for that Product.
- A **Catalog item** is the exact selectable or requestable thing shared by
  storefront, sales-desk, quote, partner, and future mobile channels.
- A **Storefront item** is the public presentation of that catalog item. Its
  name, description, price, and quote requirement come from the catalog while
  storefront-only presentation such as image, category, call to action, and
  display order remains on the Storefront item.

For the common one-product case, DPF creates and updates the Product, default
Offering, and Catalog item together. Owners keep using **Storefront → Items**;
the underlying record layers are not exposed unless the commercial definition
actually diverges. A one-line business sees no product-line control. When the
confirmed business mix has multiple lines, the add-item form asks which real
line owns the new item. An item labeled **Needs setup link** is an older projection
that lacks real product-line evidence. Finish or reconcile setup rather than
guessing a relationship.

A reusable standard configuration may later receive a SKU. A one-off
configuration selected for a specific quote is captured immutably on that
quote line and does not create permanent catalog or SKU clutter.

## Package And Price A Catalog Item

After an item has a catalog link, open **Storefront → Items** and choose
**Manage packaging and sales options** from that item's actions. The first
control is intentionally simple: confirm how customers complete the purchase.
Ordinary fixed-price purchases and bookings continue directly; a quote is
required only when the selected route says so.

Open **Advanced packaging and sales options** only when the business actually
needs one of these:

- combine existing things you sell into a package;
- divide one package sale across components for non-additive analysis;
- add an effective-dated price or seasonal offer;
- publish a deliberately reusable standard option and SKU;
- promote a successful one-off quoted option into that reusable catalog;
- allow or disallow the catalog item in a sales channel.

Adding a package does not move its components to another product line. A
seasonal offer does not create another Product. New package components begin
with equal revenue attribution; use **Set exact revenue attribution** when the
business has a defensible percentage split. The percentages must total 100,
and the package is still counted as one sale.

## Review Customer Purchases And Use

From a catalog-linked item, choose **Customer purchases and use** to review
what customers actually selected. Each purchase keeps the historical Product,
Offering, Catalog item, provider, configuration, and charged amount that
applied at the time. Later catalog edits do not rewrite that record.

The ordinary view shows the purchase, amount, status, available customer
evidence, and fulfillment. Open **More traceability** only when you need the
underlying commercial and transaction references. A package is shown as one
charged purchase; included-item allocations are labelled as analysis, not
additional revenue.

DPF distinguishes captured customer details from a canonical customer record.
For example, a booking email remains useful transaction evidence, but DPF says
that the customer/account link is not established until a real Customer
Account or Customer Contact is linked. A purchase by itself never fabricates a
consumer, subscriber, entitlement, or installed instance.

For configured goods such as cars or homes, an off-the-lot selection can point
to an exact reusable SKU. A build-to-order selection stays as an immutable
one-off quote or order snapshot unless an operator explicitly promotes it.

## Key Concepts

- **Lifecycle Stage** — Where the product is in its development and operational life: Plan, Design, Build, Production, or Retirement.
- **Status** — The current operational state: Draft (not yet active), Active (in use), or Inactive (paused or decommissioned).
- **Stage-Gate Readiness** — A checklist of criteria that must be met before a product can advance from one lifecycle stage to the next. Gates ensure quality and governance before promotion.
- **Taxonomy Attribution** — Each product is tagged with nodes from the DPPM taxonomy tree, enabling comparison with similar products and portfolio-level filtering.
- **Software Enrichment** — Inventory entity details can show the latest known version, update posture, canonical manufacturer/product identity and CPE, plus sourced support-lifecycle milestones when that enrichment is available.
- **Canonical Inventory Record** — Normal inventory lists, product counts, and
  product inventory tabs show the active canonical record for a discovered
  entity. Superseded records remain retained as governed repair evidence but do
  not appear in normal operational views or inflate their counts. An old direct
  entity link redirects to the canonical record.

## What You Can Do

- Confirm the initial business product mix during Storefront setup
- Use the Goods and Services for Sale hierarchy for business-product reporting
- Edit the common Product, default Offering, and Catalog item through one
  collapsed Storefront item workflow
- Manage optional packages, dated prices, promotions, reusable SKUs, channel
  eligibility, and fulfillment routes without creating parallel products
- Review catalog-linked purchases and fulfillment with honest customer evidence
- Review product context with organization-wide and product-specific evidence
  kept visibly distinct
- Propose, approve, review, and repeat product research while retaining source
  provenance and human publication control
- Schedule proposal-only competitive scans without unattended research or
  publication
- Preview, schedule, inspect, pause, resume, and rerun evidence-bound product
  playbooks without creating a second planning authority
- Export a non-importable owner brief with source provenance
- Define, review, close, and archive business-product outcomes
- Append quantitative or qualitative observations with source provenance and
  correction history
- Link only real, same-product backlog work to the outcome it contributes to
- Compare product-line sales evidence and drill into a business Product's
  Direction brief
- Switch between guided and professional density without forking product truth
- Browse all products with filtering by lifecycle stage, status, portfolio, and taxonomy
- View a product's full profile including its health metrics, linked backlog items, and architecture models
- Inspect available software identity and support-lifecycle facts without leaving the inventory entity detail page
- Follow an older inventory-entity link to the canonical record without editing
  a retained superseded copy
- Check stage-gate readiness and see which criteria are outstanding before the next stage
- Advance a product through lifecycle stages once gate criteria are satisfied
- Register a new product and assign it to a portfolio and taxonomy category

## Reading Product Health

The product health view includes the same capability-aware service summary used by platform monitoring. A disabled optional capability is shown as **Optional — inactive**, not as a false outage. An enabled optional service that cannot be observed is **Optional — degraded**; an unavailable required service is **Required — unavailable**. External AI runtimes are labeled **External — provider managed** and use reconciled provider evidence. These labels and their actions, rather than color alone, explain whether operator attention is required.
