# UX Archetype Audit Rubric

**Status:** reusable runbook for archetype-specific UX follow-up studies  
**Backlog:** BI-24A77446 / EP-UX-SYSTEM  
**Related:** [Platform usability standards](../platform-usability-standards.md), [Theme-aware styling runbook](theme-aware-styling-runbook.md), live study evidence on BI-24A77446

## Purpose

Common portal surfaces get continuous UX attention. Each business archetype still needs its own pass. This rubric makes those passes **repeatable**: same measures, same route sample, same fail conditions — without requiring every dynamic detail page to be clicked by hand.

Use it for Restaurant today and for any of the archetype categories under `packages/storefront-templates/src/archetypes`.

## Study unit

One **archetype pass** = one leaf archetype (or the category demo install) audited against this checklist in a single evidence package (notes, counts, screenshots optional).

## Route sampling rules (minimum set)

Do not audit only the happy owner page. Every pass samples at least:

| Slice | Routes / surfaces |
| --- | --- |
| Public | Home, auth, intake/booking/order |
| Owner | Cockpit / Workspace, setup/settings, resource/capacity, inbox/attention |
| Support | One marketing, one finance or admin surface |
| Help | ≥3 context Docs/help links: owner cockpit, one public route, one setup route |
| Forms | Public auth, customer intake/booking, owner setup, employee/HR if present, admin/user, one publish/confirm |
| Mobile | One phone-width pass (~390px) on public home, auth, intake calendar/slot, final form |
| Technical reachability | `/platform`, `/platform/ai/overview`, one AI provider/routing page, one tools/integrations page, `/ops`, `/build`, `/coworker-decisions`, `/admin`, plus any owner-cockpit entry to those |

**Warehousing and Fulfilment exception:** category/direct routes may 404 until BI-72617848 / BI-B9D54962 land; record the gap rather than inventing pages.

## First-viewport Purpose Contract

For every sampled page, the first viewport must answer:

1. **What is this?**
2. **What should I do next?**
3. **What happens if I do nothing?**
4. **Is this reversible?**

Record audience (`owner`, `operator`, `builder`, `admin`) when the shell can reach technical surfaces.

## Quantitative capture (every page)

| Metric | How |
| --- | --- |
| Word count | Visible body text (exclude nav chrome if separable) |
| Visible actions | Buttons, links styled as actions, icon controls |
| Link count | Anchors and router links |
| Repeated labels | Duplicate button/heading strings |
| Long-option exposure | Selects/lists with high option counts in first view |
| Simple vs Full | Rendered delta when density modes exist |
| Broken links | Visible hrefs that 404 or error |
| Redirect outcomes | Unexpected destination after click |
| Sub-44px controls | Touch targets on mobile pass |
| Jargon / acronym hits | Raw product/seed language leakage |

## Cognitive load and progressive disclosure

Fail when:

- Primary job is unclear in the first viewport
- Majority-required content is hidden behind Advanced/Details
- Hundreds of links/controls, raw directories, queues, or provider matrices appear without an owner/advanced boundary
- Technical ledgers/logs/IDs precede plain status and next action (prefer self-upgrade owner-card pattern)

Pass when:

- One primary action is obvious
- Secondary material is disclosed, not dumped
- Brand/archetype vocabulary survives

## Inert and contradictory actions

For each sampled non-destructive control (`Feedback`, `Simple`/`Full`, help, assistant open/close, `...`, `x`, `+ Add`, filters, row actions):

| Check | Fail if |
| --- | --- |
| Result matches label | Visible result contradicts the label |
| User can tell what changed | State changed with no feedback |
| Overlay contract | Overlay persists into unrelated routes without context/close |
| After-action reconciliation | Old actions remain as if nothing changed; destination of result is unknown |
| Row-specific naming | Repeated identical `Confirm`/`Cancel` with no row identity |

## Form and action contracts

Per form, record: form count, field count, missing `name`/id-label, missing visible label, missing `autocomplete` on email/password/contact, required/optional exposure, inline validation, pending/success/failure feedback.

Mutating submits must answer: **what will change**, **who/what is affected**, **is it reversible**, **what can I do after**.

Public forms also need: empty required behavior, success recap, reference number when applicable, response channel/time, correction/cancel path, and no accidental checkout language on non-payment results.

## Help as recovery

Compare source route → help target:

- [ ] Source-route-specific next steps first
- [ ] Full docs catalog collapsed by default
- [ ] Archetype vocabulary preserved
- [ ] Risk / reversibility / no-action for setup routes
- [ ] Not shorter-but-still-generic product chrome

## Attention continuity (single owner truth)

Trace **one** public/customer intake → domain owner inbox → main Workspace / Needs You.

Fail if:

- Workspace says clear while vertical inbox has unhandled demand
- Live customer records exist only behind a secondary route with generic repeated actions
- Attention counts do not reconcile across surfaces

## Resource / capacity coherence

Compare public availability/intake, owner resource setup, operations/hours, items/offers, domain inbox, Workspace readiness.

Record whether scarce resources use business vocabulary, whether people/resources/offers are separated, whether capacity consume/release is visible, and whether public availability uses the same model.

## Public trust and unsupported paths

- Brand / name / tagline continuity
- Contact, location, hours when relevant
- Policy/trust cues and account/privacy context
- Unsupported public routes gated or customer-safe
- Public 404 recovers to storefront/customer task, not internal workspace/docs

## Archetype contamination and publish readiness

1. When a page names an active archetype, work products, prompts, KPIs, CTAs, and publish artifacts use **that** archetype's vocabulary and proof model.
2. Before external actions (`Publish`, `Send`, `Approve` for publishable content): channel, audience, artifact title, fit to current business, and no-action/reversibility consequences are visible.

## Owner setup as a workflow

Sample setup as a path, not isolated pages: brand/public profile, business context, hours/availability, resources/team, catalog/items, page sections, inbox/intake, advanced capabilities.

Answer: complete vs incomplete, what public artifacts were generated, what changes before save, how to restore/undo wrong setup. Flag internal/seed language and cross-archetype expansion leakage.

## Mobile public-flow pass

At ~390px width: horizontal overflow, first-viewport actions, targets under 44px, labels for fields and icon controls, selected state after step transitions, brand vocabulary, critical actions without precision tapping.

## Technical / admin reachability for non-technical owners

Even modest word count fails if the page exposes build queues, backlogs, provider matrices, or governance material without audience declaration and one safe next action. Prefer plain status first; technical detail behind Advanced.

## Evidence package shape

Each archetype pass files evidence with:

1. Archetype id / install identity
2. Date and auditor (human or agent)
3. Route list actually visited
4. Metric table (or structured notes) for failures
5. Attention-continuity path result
6. Mobile pass result
7. Links to backlog items filed from the study

Prefer attaching evidence to the vertical readiness epic and any EP-UX-SYSTEM / EP-UX-COGLOAD follow-ups rather than orphan notes.

## Standards basis (do not re-derive)

Purpose Contract and task-outcome measures align with ISO 9241-210, GOV.UK service manual task focus, W3C cognitive guidance, WCAG 2.2, Carbon/GOV.UK disclosure rules, and Microsoft HAX for AI clarity. Cite those when extending the rubric; do not invent a parallel purpose model.

## Change control

This file is the single reusable rubric. Study-specific findings go on backlog items or epic evidence; durable rubric changes land here in one place.
