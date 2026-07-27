---
title: "AI Operations"
area: platform
order: 2
---

## Use This Doc For

- `/platform/ai`
- `/platform/ai/capacity-continuity`
- `/platform/ai/operations`
- `/platform/ai/operations-map`
- `/platform/ai/capability-needs`
- `/platform/ai/history`
- `/platform/ai/assignments` — **Priority & Models**: the everyday Cost / Quality / Time priority (platform default) and the advanced per-coworker guardrails on one surface (`/platform/ai/priority` redirects here)

## Workflow

1. Start at **AI Workforce** (`/platform/ai/overview`) when the job is to find, compare, configure, or work with a coworker. The directory leads with work, interaction, business-type availability, and approval posture.
2. Review Capacity Continuity when paid AI capacity is idle, blocked, or expected to keep working during holidays, vacations, business events, after-hours windows, or owner inactivity.
3. Use the coworker record's **Capabilities**, **Autonomy & Governance**, and **Activity** sections before opening fleet-wide technical pages.
4. Review history or systems health when a result looks wrong, slow, or inconsistent.
5. Adjust **Priority & Models** only after you understand whether the problem is role design, model selection, tool access, standing orders, or calendar state. Set the everyday Cost / Quality / Time priority at the top of that surface (or per coworker from the triangle at its composer). Use tier and capability floors for hard limits. A provider/model pin is an exceptional preference among already-eligible routes, not a way to cross policy, sensitivity, residency, or capability boundaries.

## Architecture and evidence

- [Model Routing & Lifecycle](../ai-workforce/model-routing-lifecycle.md) — current
  operator explanation of discovery, eligibility, selection, exceptional
  preferences, and fallback.
- Contributor and AI coworker documentation starts at
  `docs/architecture/ai-routing-document-map.md`, which classifies the proposed
  owner-readable subway map, technical drill-through, target-state designs, and
  historical records.
- Authorized architecture users can open a routing element in `/ea` and use
  **Architecture context** to move to its related BPMN, SysML, or ArchiMate element,
  inspect the governed decision vocabulary and source version, or open the same
  station in the Operations Map Compare lens. The inspector shows bounded labels and
  evidence freshness; it never shows prompt or protected-data content.

## What To Watch

- work being routed to the wrong specialist
- paid AI capacity going unused without a clear blocker
- repeated retries or stalled history patterns
- assignment changes that solve one route but weaken another
- capacity work that produces token spend without durable evidence, backlog movement, or reviewable output
- capability needs without submitter context, route context, or a clear backlog follow-up
