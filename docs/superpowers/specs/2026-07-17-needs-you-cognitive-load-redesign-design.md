# Needs-you queue — cognitive-load redesign

- Date: 2026-07-17
- Epic: `EP-ATTENTION-SURFACE` (The Attention Surface — a kernels-first "Needs you" inbox, separate from the work backlog)
- Composes onto: `BI-01CC2356` (in-progress — "Needs you next" splits personal scope from company-wide residue)
- Open dependency: `BI-7D29937E` (research — COO overseer persona / attribution voice)
- Source: founder goal — walk the "Needs you" queue as a non-technical plumbing-company owner; reduce cognitive load without discarding detail.

## Problem (observed on the live install, 2026-07-17)

Two surfaces both carry a "Needs you" label at two different altitudes:

1. **`/ops` "Operations"** — the *builder's* console. Header alarms with "138 epics · 3040 items". Its "NEEDS YOU NEXT — 6, customer-blocking & high-risk first" band renders raw engineering tickets (e.g. `Voice Slice 1.6 — Upgrade-to-GPU button in SpeechToTextCard`), builder verbs (`open` / `edit` / `Resume build` / `report` / `del`), and "processing" a task opens `BacklogPanel` — a database-record editor asking the owner to choose Work Type, Type (portfolio/product), Priority (a number, lower = higher), an Epic (one of 138), and an "Ownership Domain" taxonomy slug. A non-technical owner cannot answer a single field.
2. **`/workspace` "What needs you now"** — the *intended owner* surface, already substantially better (plain verbs "Approve bill BILL-2026-0001", reason line "blocking a customer/business outcome", grouped customer-inward, explicitly "the work backlog lives in Operations; this is only what needs a decision now"). But it still **leaks platform-internal plumbing** into the owner's decision inbox: "qdrant is offline", "Sandbox is flooding with errors", "Stale memory-search alert".

The label "customer-blocking & high-risk first" is also unbacked — none of the surfaced items named a customer or a consequence.

Net: even a college-educated technical founder was lost; for the target plumber persona the task is impossible. The intent (`EP-ATTENTION-SURFACE`, "NO composite score" triage) is right; the realization leaks builder-grade vocabulary and volume onto the owner.

## Research & Benchmarking

### Open-source leaders and their data models

- **GitLab To-Do List.** GitLab models an attention item as an explicit action plus a typed target: `action_name`, `target_type`, target payload/URL, author, state, and timestamps. Its product surface describes the queue as items “waiting for your input” and supports snooze, done, undo, and bulk actions. We adopt the separation between *why attention was created* and *the underlying record*, but translate both into an owner decision before rendering. Sources: [To-Do List API](https://docs.gitlab.com/api/todos/), [To-Do List product behavior](https://docs.gitlab.com/user/todos/).
- **Novu Inbox.** Novu's current inbox contract preserves a rich notification record — subject/body, recipient, read/seen/archive/snooze state, timestamps, primary and secondary actions, redirect, tags, custom data, workflow, and severity — behind a composable inbox UI. We adopt the full-fidelity record plus replaceable presentation layer, and reject using unread state or generic severity as a proxy for owner priority. Sources: [Inbox architecture](https://docs.novu.co/platform/inbox), [Inbox notification data transfer object](https://github.com/novuhq/novu/blob/7c05fe37d186178dcafcfaada686d0bb928ea1f4/apps/api/src/app/inbox/dtos/inbox-notification.dto.ts).
- **Plane.** Plane's notification model keeps entity identity, raw title/message/data, sender/trigger actor, recipient, and separate `read_at`, `snoozed_till`, and `archived_at` lifecycle fields. We adopt its durable separation between source detail and inbox disposition, while rejecting a single chronological notification stream for business owners. Source: [Plane notification model](https://github.com/makeplane/plane/blob/7cef741c29cf61d3bca18dc892e6af11a1e7becc/apps/api/plane/db/models/notification.py).

### Commercial leaders

- **Linear Inbox and Pulse.** Linear puts work needing attention in one inbox, supports contextual actions and snooze, and delivers lower-urgency project updates as daily or weekly summaries. We adopt action-in-context and scheduled batching. We reject its broad “all subscribed notifications arrive” rule because the DPF owner lane must exclude platform plumbing. Sources: [Linear Inbox](https://linear.app/docs/inbox), [Linear Pulse](https://linear.app/docs/pulse).
- **Slack Activity.** Slack offers dense and detailed layouts, filters, direct actions, bulk clearing, and a recoverable Cleared view. We adopt the principle that clearing or demoting an item does not destroy its history. We reject owner-configured feed complexity as the default; the proactivity classifier should do that sorting. Source: [Slack Activity](https://slack.com/help/articles/19693583638803-Get-your-work-done-from-the-Activity-view).
- **Microsoft Teams Activity.** Teams distinguishes notification types and provides unread and category filters, but presents a broad activity timeline and expires entries after 30 days. We adopt recognizable type cues only where words improve the decision, and reject time-based loss of technical detail. Source: [Teams Activity feed](https://support.microsoft.com/en-us/teams/chat-channels/explore-the-activity-feed-in-microsoft-teams).

### Standards and resulting choices

The technical drawer follows the [WAI-ARIA disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/): a button owns the expanded state, exposes `aria-expanded`, references the controlled panel, and works with Enter and Space. The benchmark gap this design fills is altitude: the products above optimize notification triage, while DPF must first decide whether an item belongs to the owner, a weekly review, or the technical custodian. The adopted contract therefore preserves the rich source record, projects a separate owner question, and keeps irreversible money/public decisions above every proactivity setting.

## Design principles

- **Progressive disclosure** (founder patent domain): plain decision on top, full technical detail one click down — *never deleted*.
- **One altitude per person**: owners live at `/workspace`; `/ops` stays the builder console. A non-technical owner is never routed into the backlog to "process" work.
- **Decisions, not records**: the owner is offered a choice, never a form.
- **Reading level ≈ 9th–10th grade** (allows "graphics-card upgrade"; no bare acronyms).

## The redesign — five moves

### 1. Route by the per-coworker Proactivity dial (not a hard rule)
A classifier gates what reaches the owner using two tests: (a) does this genuinely need a *human* decision? (b) is it the *owner's* kind of decision (money, customers, staff, outbound, real business blocker) vs. platform plumbing? Platform-internal events route to the AI custodian lane and only surface to the owner if they force a *business* choice, translated.

Which of the qualifying events surface vs. auto-handle is governed by the coworker's **Proactivity** setting (Reactive / Balanced / Assertive), pre-set with sensible per-archetype defaults, human-adjustable, and self-adjustable by proposal (see move 5):
- **Reactive** — asks before most things; even routine fixes become a decision card.
- **Balanced** (default) — fixes plumbing silently and logs it; surfaces real business choices.
- **Assertive** — acts and reports after; only truly irreversible calls surface.

**Two hard floors override the dial always:** money leaving the business, and anything that goes public — these surface as a decision regardless of proactivity.

### 2. Every surfaced item is a decision card
Card contract (each layer mandatory):
- Headline — a question/statement, ≤ 8 words, no jargon.
- Why it matters — one sentence tying it to *their* business.
- If you do nothing — the honest consequence.
- Recommendation — the overseer's suggested choice, plain (attribution voice per `BI-7D29937E`; interim "Your COO recommends…", specialist byline names the function).
- Choices — 1–3 plain-verb buttons. Never the backlog form.
- Tags — risk/impact in words (Costs money · Goes public · Reversible · Due in 3 days).

### 3. Technical-detail drawer (detail preserved)
A collapsed "Technical detail — for builders and your digital team" expander holds every field that exists on the backlog today: original title, work type / effort, source, epic, ownership domain, FB/BI IDs, detected date + actor, and the builder verbs (Open in Operations, Resume build, Edit fields). Nothing is deleted; it moves to where a builder looks.

### 4. Calm, honest counts
Lead with "N things need you today". Demote the 3040-item / 138-epic / "276 builds" workload to a quiet "your digital team is handling — no action needed" strip. Those counts are the digital team's workload, not the owner's.

### 5. Batching + coworker self-tuning
- **Weekly digest** — low-urgency batchable items (e.g. "85 improvement proposals need review", coworker-gap suggestions, upcoming-bill previews) collect into a Friday digest, not the daily inbox. Actions: "Looks good, no changes" / "Snooze to next week" / per-item "Review".
- **Self-tune moment** — after a repeated pattern ("approved my last 8 bill payments unchanged"), the coworker *proposes* moving its own proactivity (Balanced → Assertive) within a stated bound ("recurring bills under £1,500"), owner accepts/declines/narrows. Ties to the trust-dial maturation model; the money-out and public floors still hold underneath.

## Attribution voice (open)
Per founder: the overseer is the **COO** persona, intentionally **un-named** (naming over-personifies AI; less-technical users anthropomorphize, researchers guard against it). The COO is the single overseer/router/funnel, deferring to specialists. The exact attribution contract (COO voice vs. named-function specialist bylines, anthropomorphization guardrails, overseer↔specialist handoff in UI) is scoped to `BI-7D29937E` and likely warrants a formal deliberation. This redesign adopts whatever that thread decides.

## Out of scope (designed conceptually, not in this cut)
- Off-site notification channel (email/SMS/push + signed one-click for the reversible class) — see `BI-C7D25599`.
- First-run onboarding screen that sets per-coworker proactivity defaults.
- The reassuring empty ("nothing needs you right now") state.

## Implementation items (filed under EP-ATTENTION-SURFACE)
See the BIs created 2026-07-17 for moves 1–5 and the plain-language translation contract.
