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
- `/platform/ai/priority/outcomes` — **Priority — Outcomes**: what recent runs actually did against the priority you set, separating an infrastructure failover from a deliberate trade-off, plus a calibration suggestion once enough runs accumulate. See [Priority, Outcomes & Calibration](../ai-workforce/priority-and-outcomes.md).

## Workflow

1. Start at **AI Workforce** (`/platform/ai/overview`) when the job is to find, compare, configure, or work with a coworker. The directory leads with work, interaction, business-type availability, and approval posture.
2. Review Capacity Continuity when paid AI capacity is idle, blocked, or expected to keep working during holidays, vacations, business events, after-hours windows, or owner inactivity. Each mode is described by what your people are doing — **Employees are available** (coworkers assist and prepare decisions) versus **Employees are busy** (coworkers continue safe work and batch non-urgent interruptions).
3. Use the coworker record's **Capabilities**, **Autonomy & Governance**, and **Activity** sections before opening fleet-wide technical pages.
4. Review history or systems health when a result looks wrong, slow, or inconsistent.
5. Adjust **Priority & Models** only after you understand whether the problem is role design, model selection, tool access, standing orders, or calendar state. Set the everyday Cost / Quality / Time priority at the top of that surface (or per coworker from the triangle at its composer). Use tier and capability floors for hard limits. A provider/model pin is an exceptional preference among already-eligible routes, not a way to cross policy, sensitivity, residency, or capability boundaries.

## Read the routing picture

Open **AI Operations Map** (`/platform/ai/operations-map`) when you need one
at-a-glance answer for how AI work is supposed to move and what the system
actually recorded.

The first map has five stable stations:

1. **Ask & context** — a coworker asks for AI help and assembles the minimum
   work context.
2. **Data safety** — the platform classifies the work and data, applies policy,
   protects values, keeps work local, requests review, or stops.
3. **Eligible & available routes** — only routes that satisfy capability,
   boundary, availability, limit, and fallback obligations remain.
4. **Select & dispatch** — the router balances quality, time, and cost, then
   calls the selected local or external adapter.
5. **Evidence & return** — the platform records privacy-safe evidence and
   returns only the response the receiving actor may see.

Switch the same map between:

- **Designed** for the governed architecture and its implementation status.
- **Observed** for privacy-safe counts, timings, coverage, and findings in the
  selected evidence window.
- **Compare** to keep the station geometry fixed while seeing design and
  evidence together. This is the best starting point when something appears
  unsafe, unavailable, unexpectedly expensive, or inconsistent with design.

Select a station to open its owner steps, technical names, source files,
architecture version, safe evidence metrics, and conformance findings. Use
**Open in Enterprise Architecture** for the governed design context. The map
never projects prompts, credentials, detected sensitive values, customer or
employee content, or token maps.

The unified coworker/provider/A2A canvas below the owner map is the
authoritative technical topology. Its **View and replay** rail filters provider
routes and coworker interactions, keeps both halves on one replay clock, and
preserves the saved A2A filter preference. Open **List and evidence table** for
the keyboard- and screen-reader-friendly equivalent of every visible
connection. Select a route, interaction, or evidence marker on the canvas for
safe source, authority, state, and timing detail. Activity routing and
deliberation detail remain under **Technical diagnostics**. There are no
separate provider or A2A diagrams to reconcile with this map.

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
- Architecture links can open the Operations Map directly in **Compare** mode
  with the related design stage focused. Mode and focus remain in the URL so
  the exact explanatory view can be shared or revisited.

## When a coworker says it used the backup model

A reply can carry a note that the turn ran on the bundled local model instead of
your strongest provider. The note names which of two different situations you are
in, and they need different responses:

- **"… is switched off"** — a provider you had connected was turned off
  automatically after its sign-in stopped working. Nothing you can rephrase will
  help; reconnect it under **Platform > AI > Providers**. This case also raises a
  **Reconnect &lt;provider&gt;** item in your "Needs you" inbox, so you hear about
  it before a coworker turn degrades rather than after.
- **"Your configured providers stayed available, but …"** — everything is
  connected and healthy; this particular request was ruled out of the stronger
  route. The note names the **one** reason that actually held the turn back, not
  every reason in play: if several providers were ruled out for different
  reasons, the note names the binding one and says how many others there were.
  What to do depends on which reason you are given, and only some of them are
  about the request itself:

  - **"longer than its context window"** — a shorter request, or a new thread,
    routes back to the stronger model.
  - **"it had reached its rate limit"** — the same question in a few minutes
    reaches it.
  - **"data policy required this work to stay on this machine"** or **"it isn't
    cleared for this data sensitivity"** — this is a data-handling rule, not a
    size limit. Rewording or shortening will not change it, and retrying costs
    you the wait for nothing. Ask the same thing somewhere that does not carry
    confidential data, or change what the page in question is classified as.
  - **"needed a capability it doesn't offer"** or **"its model isn't the class
    this work requires"** — the stronger model is not offered for this kind of
    work, whatever length you send.

The two are mutually exclusive: a single reply never tells you a provider is both
available and switched off. If a coworker also reports hitting its safety limit,
the wording of that message matches the same cause.

## What To Watch

- work being routed to the wrong specialist
- paid AI capacity going unused without a clear blocker
- repeated retries or stalled history patterns
- assignment changes that solve one route but weaken another
- capacity work that produces token spend without durable evidence, backlog movement, or reviewable output
- capability needs without submitter context, route context, or a clear backlog follow-up

## Defaults for work rooms

Priority & Models also carries the default for **work rooms** — how hard rooms push and
whether they may act without asking. It is listed separately from the per-coworker controls
because it governs work happening in a room rather than one coworker's own behaviour.

A room can override it, and what the work actually is overrides both. See
[Priority and outcomes](../ai-workforce/priority-and-outcomes.md).
