# Sales/CRM parity + delight gap matrix — research synthesis and build order

Date: 2026-07-06. Epic: EP-B51FA3BC. BI: BI-00FBDC20.
Inputs: five research tracks — Salesforce Sales Cloud functional reference (fidelity bar);
loved-mechanics sweeps of Pipedrive/Close, HubSpot (+Salesforce anti-patterns),
Salesloft/Outreach/Clay, Attio/Folk/Copper, and a dark-horse community sweep
(Less Annoying CRM, Streak, Bigin, Nutshell, Kommo, Day.ai).

## The one-sentence thesis

Every loved sales tool wins the same inversion: **the CRM records itself as a byproduct of
the rep's real work and gives something back immediately** (open-notification, next-step
prompt, prioritized queue), while Salesforce is hated where it makes the rep pay a data-entry
and click tax to feed management dashboards. DPF's AI-coworker motion is natively positioned
for this inversion — the coworker IS the auto-capture and next-step engine — so parity means
matching Salesforce's *functional* essence (objects + lifecycle mechanics) while shipping the
delight mechanics the incumbents bolt on.

## Fidelity bar — table stakes vs DPF today

| Capability (Salesforce essence) | DPF state | Evidence / gap |
|---|---|---|
| Account + status lifecycle | **EXISTS** | CustomerAccount prospect→active…closed; convert button (PR #2609) |
| Contacts (email identity, account FK) | **EXISTS** (as of #2629) | createCustomerContact + tool + UI; MDM dedup-gated |
| Opportunity w/ stage machine {open/won/lost, probability} | **EXISTS (PARTIAL)** | stages+probability+kanban exist; no forecast-category axis, no contact roles |
| Line items / product catalog / price books | **PARTIAL** | QuoteLineItem.productId → DigitalProduct exists; no price books, list-vs-sale price, or product picker in the quote UI |
| Quote lifecycle (draft→sent→accepted, versioning) | **EXISTS** | createQuote/reviseQuote/sendQuote/acceptQuote + UI buttons |
| Order mirroring accepted quote | **EXISTS** | SalesOrder auto-created on accept |
| Invoice + payment + GL | **EXISTS** | exceeds bar (double-entry GL posting) |
| Contract w/ term + renewal notice | **EXISTS (PARTIAL)** | Subscription (renewalDate, autoRenew); no renewal invoice materialization (BI-8681E93C), no amendments |
| **Lead + convert flow** | **MISSING** | BI-7906DAC0; check Engagement/acquisition-signal substrate first — it is the lead-shaped thing DPF already has |
| Activity mgmt (tasks/events, who/what, open vs history, follow-ups) | **PARTIAL** | Activity model + timeline exist; no open-task queue, no follow-up prompt, no auto-capture |
| Campaign → attribution | **PARTIAL** | marketing workspace + funnel exist; no campaign-member/response semantics, single-touch attribution absent |
| Lead/opportunity assignment (rules, queues, round robin) | **MISSING** | single-operator installs today; needed for multi-rep orgs |
| Weighted pipeline (amount × probability) | **EXISTS** | Pipeline tab shows total + weighted |
| Forecast categories + quota rollups | **MISSING** | funnel ≠ forecast; defer past delight slices (SF-mid tier) |
| Discount-threshold approval on quotes | **MISSING** | approval-process substrate exists elsewhere in DPF (governance); defer |
| Cases/service tickets vs account | **PARTIAL** | ServiceTicket exists; serviceAgreementId soft-FK unbacked → tie to Subscription |

Explicitly NOT gaps (Salesforce-enterprise complexity to skip): opportunity splits, territory
management, multi-touch campaign influence models, person accounts, product schedules,
reduction orders, CPQ machinery.

## Delight bar — the mechanics people love, ranked for DPF

1. **Auto-capture / "the CRM records itself"** (Close, Copper, Attio, HubSpot, Day.ai — and
   the #1 Salesforce hate inverted). DPF angle: every coworker conversation already touches
   the record — auto-log coworker interactions as Activities; later email/calendar sync.
2. **Always-a-next-step loop** (Pipedrive's done-activity→schedule-next prompt + no-next-step
   warning on deal cards). Cheap: Opportunity.nextActivityAt + pipeline-card warning + the
   coworker prompting for the next step whenever it completes one.
3. **Deal rotting / staleness as ambient visual state** (Pipedrive's red tiles; zero reports
   needed). Cheap: per-stage inactivity threshold → tile tint on the kanban; pairs with the
   existing isDormant flag.
4. **Prioritized daily queue with a "why"** (Close Inbox, Salesloft Rhythm's explained
   next-best-action). DPF angle: the coworker composes this from rotting deals, due
   follow-ups, renewal dates — an "engagement inbox" card on /customer.
5. **Email tracking + one-click scheduler** (HubSpot's hook features). Bigger lift (needs
   email infra); defer behind quote-delivery BI-8E45CCA3 which builds the send rail.
6. **Enrichment on capture** (Attio/Clay/Folk). The CSM already holds web_search — prompt it
   to enrich accounts (website/industry) on create; structured waterfall enrichment later.
7. **Anti-patterns to hold as constraints**: no required-field ambushes, minimal clicks
   (inline edits), no admin-priesthood config, price/complexity honesty, fast pages.

## Build order (value ÷ effort, after #2629)

1. **BI-8681E93C** recurring billing + renewal lifecycle (completes the contract story; reuse
   RecurringSchedule/work-capture expander).
2. **NEW: next-step loop + deal rotting** (delight mechanics #2+#3 — small schema touch:
   nextActivityAt; kanban tint; coworker prompt).
3. **BI-7906DAC0** lead/triage flow grounded in the Engagement substrate (fidelity gap that
   also unlocks funnel top).
4. **NEW: engagement inbox** — prioritized "work these now" queue w/ reasons (delight #4).
5. **BI-8E45CCA3** quote delivery + e-sign accept (reuses invoice rails; unlocks email
   mechanics later).
6. **NEW: coworker auto-activity capture** — log coworker-performed actions as Activities on
   the records they touch (delight #1, DPF-native form).
7. Products/price-book picker on quotes; contact roles; assignment rules — as follow-ups.

Items marked NEW to be filed as BIs under EP-B51FA3BC when their slice starts.
