---
title: "The \"Needs You\" Inbox"
area: workspace
order: 2
---

## Overview

The **"Needs you" inbox** is the one place for decisions that need *you*, right now — kept deliberately separate from the work backlog. It answers a different question than the backlog does:

| | Backlog | "Needs you" inbox |
| --- | --- | --- |
| Holds | Work to **schedule** — features, bugs, chores | Decisions to **make now** — approvals, escalations, paused AI |
| Answers | "What should we build next?" | "What needs *me*, and why can't the AI finish it?" |
| Cadence | Planned, prioritized, eventually built | Blocking, time-sensitive, perishable |
| Lives on | Operations | Your Workspace |

Folding "a human must decide this now" into the backlog is a category error: the two have different owners, cadence, and half-lives. The inbox gives time-sensitive decisions their own home so they don't get buried under planned work.

## Key Concepts

- **Kernels-first — you see only the residue.** Every decision is routed through the platform's governed scopes first ([decision perspective](../ai-workforce/decision-perspective) — WWMD / WWWD / WSID). The inbox holds only what those scopes genuinely *cannot* resolve on their own, and only when the item is one they can honestly speak to. If the AI can decide it within your standing guidance, you never see it — that is the point.
- **Honest "why it's here."** Every item carries the real reason it reached you — a coverage gap the governed scopes had no material for, a principle conflict the kernel was torn on, a policy that requires a human for this risk level, a coworker waiting on your input, or a missing credential. Never a fabricated confidence score.
- **Triage, not a magic number.** Items are incommensurable — an overdue bill, a five-minute-old paused build, a compliance filing due tomorrow. The inbox makes them comparable by surfacing the *same* objective factors on every card — time to act, risk, what's blocked until you decide, and how much effort the decision takes — and orders them by a transparent, explainable rule. It never invents a single cross-axis "priority: 0.73" to rank them.
- **A projection, not another queue.** The inbox is a read-only view *over* each area's own records; it is not a second backlog or ticket tracker. Acting on an item updates the record in its home area.

## What Shows Up Here

- **Escalations** — a build the AI could not self-repair, now waiting on you.
- **Approvals** — bills and expense claims awaiting sign-off, outbound messages pending review, regulatory submissions with a filing deadline.
- **Paused AI** — a coworker that needs your input to continue, or a missing credential (a *permission* gap, not a *judgment* one).
- **Decisions the kernel escalated or deferred** — the residue of the governed scopes, with the honest reason attached.

## What You Can Do

- **Open in context** — jump straight to the item's home area to act on it with full detail.
- **Approve / reject / request changes** — for approval items, decide directly from the card.
- **Answer** — give a paused coworker the input it is waiting for.
- **Snooze or dismiss** — clear an item you have handled or that no longer needs you.
- Ask your [AI coworker](../getting-started/ai-coworker) for a briefing on what is in the inbox and why.

Deadline-bearing items (bills, expenses, compliance filings) surface in the imminent tiers as their due dates approach; the rest are ordered by risk, blast radius, and age.

---

*Derived from the design spec [The Attention Surface — a kernels-first "Needs you" inbox](../../superpowers/specs/2026-06-23-human-attention-surface-design.md). This user guide is the operator-facing view; the spec holds the full rationale and non-goals.*
