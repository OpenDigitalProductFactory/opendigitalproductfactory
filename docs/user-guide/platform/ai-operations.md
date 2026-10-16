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

Open **Platform → AI Operations → Providers & Routing**, then choose **Traffic**, **Evaluation** or **Providers** in the shared AI navigation. These views replace the wider AI tabs while you investigate routing. **All AI workspaces** returns to the workforce and other AI tools. The same destinations are available in the mobile view selector.

Choose a task, provider, data sensitivity and time window; the URL preserves those choices for reload, browser Back and provider round trips. Provider pages show the retained investigation context once above their settings. Traffic and Evaluation show it in their filters.

## Follow traffic

The default view groups assignments on the left and providers on the right. Counts describe the recorded decisions in your scope. Open **All** to search a larger assignment or provider catalog; model lists come from configured model profiles, including models that received no traffic. **Recent decisions** is a small preview; **View all** opens searchable traffic.

On a narrow screen, traffic and evaluation rows keep their task and model together, with labeled outcome and cost values below. All four scope filters remain directly available.

Select a decision to inspect its sensitivity, screening, exclusions, recorded attempts, tokens and cost in an overlay. Escape or Close returns to the same view. Attempts are ordered by their recorded start time. Missing traces or traces shared by several decisions cannot safely attribute attempts or cost, so the inspector states that limitation.

Recorded cost uses correlated token usage when present, otherwise correlated route outcomes. Adapter estimates are displayed separately and are not added again to recorded cost. Coverage states how many decisions have prices. Unknown price does not mean free.

## Investigate stops and provider setup

Data policy and clearance, token/context limits, quota/cooldown, payment, disabled configuration, sign-in, operator pause and unavailable capacity evidence are distinct reasons. Current provider restrictions come from the same read model as provider settings; an exclusion on an older decision is historical evidence, not a claim about current eligibility.

A quota with no confirmed reset remains paused for ordinary work. An estimated retry time allows an availability check; it does not mean the account has recovered. DPF keeps the observed capacity and exclusion reason with each routing decision. If no eligible account remains, it reports the hold before starting a provider request. Completed recovery evidence must be newer than the quota observation; an old success cannot clear a newer limit.

Supported ChatGPT and Codex subscription checks run at most hourly and may find recovery before a provider's estimated reset. They preserve manual pauses, sign-in changes and independent billing or access restrictions. A channel without a supported check remains explicitly held; retrying an uncertain review is not a recovery check.

**Settings & overrides** opens the existing provider detail. The Providers navigation returns to the catalog; Traffic or Evaluation restores the routing scope. Provider settings remain the place to manage credentials, connections, operator pauses and sensitivity overrides. Risk acceptance still requires the existing warning, acknowledged scope, rationale and expiry. Revoking an override or lifting a pause does not clear another restriction. Assignment settings remain the place for coworker model pins.

Account identity is not inferred from a provider name. If the safe receipt has no account attribution, it says so. An attempt's channel describes its recorded adapter or quota pool; it does not certify retention or data clearance for that account.

## Evaluate outcomes

Evaluation groups the same task, provider, model, recipe and evaluator. Execution success has a known-evidence denominator, while missing execution remains unknown. Evaluator quality is separate from accepted/retried operator feedback. A configured evaluator name is not proof that it ran. Without a decision-linked score or comparable rubric/version evidence, the view does not rank models.

Open **Technical routing and replay** for Designed/Observed/Compare architecture, replay, provider/A2A topology, activity diagnostics, governed tuning proposals and source evidence. Existing architecture focus links open this disclosure directly. Compare here is design conformance; Evaluation is task outcome analysis.

The view loads a bounded number of recent records per evidence source within the selected window. Coverage can be partial even when traffic is healthy. Widen the window or inspect canonical evidence before treating a small cohort as representative.

## Technical architecture and replay

Inside **Technical routing and replay**, the architecture map has five stable stations:

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
  evidence together. Use it to inspect design conformance when something appears
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

### Confirm a routing override

When the activity routing workbench recommends a different confidence for an
activity's harness, **Confirm override** applies it. It is your own decision,
so there is no separate approval step: the platform checks your access, records
the change in the audit log, and keeps the override until someone confirms a
different one for the same activity and recipe. Routing uses it from the next
request. Overrides approved before this change keep applying.

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

## Understanding background inference

Simple prompts about colors, JSON or greetings can be model calibration probes.
They measure the model named in the request, so routing them to another provider
would measure the wrong model. Chat probes run only on text-generating models and
use bounded output limits; embedding models are excluded.

Selected endpoint diagnostics also support Responses providers such as ChatGPT.
They use the selected discovered model and report unavailable targets without
substituting a default. Each probe allows 512 output tokens and waits at most
30 seconds; scenarios allow 1,024 output tokens with the same waiting limit.
That allowance includes prompt assembly and any required scenario grading.
A failed sign-in, capacity hold, timeout or truncated response leaves the run
incomplete and does not lower the model's capability rating. The runner stops
that model's remaining tests after an incomplete call. A provider may continue
computing after client cancellation if its transport cannot stop the operation.
Probe and scenario traces link adapter telemetry to the recorded test run;
older runs without those traces remain unattributed at the individual-call level.
Scenario quality updates are recorded after the selected run finishes completely;
a missing required grader score leaves it unverified.

For a local concurrency check, an authorized coworker can select
`concurrencyOnly=true` in `run_endpoint_tests` with an explicit local `endpointId`
and discovered `modelId`. This runs exactly two ordinary calls in one 30-second
observation, instead of capability probes or scenarios. It cannot be combined
with exhaustive options, a task type, or `probesOnly=true`. The recorded run
preserves each answer, completion reason, token counts, trace and admission
events. A pass requires an observed queued handoff, release and two nonempty,
complete answers. Missing contention, cancellation, capacity holds and truncated
answers leave the check unverified. This check never changes capability ratings.
Missing admission or completion metadata also leaves the check unverified when
answer text is present. An unobserved release is not evidence of a leaked slot.

Background evaluations and endpoint probes use the background admission lane,
so queued interactive requests take priority. A concurrent first-time evaluation
must acquire its model's reservation before it performs inference. Docker Model
Runner and Ollama share the single local-compute admission lane.

The server checks production coworkers' route readiness every six hours. It
raises a critical health issue when ordinary requests have no eligible route and
a separate warning when only requests at the sensitive payload ceiling are
blocked. Both include the affected coworkers and route reason, appear in the
existing platform-health attention view, and resolve when readiness recovers.
These checks do not relax data policy or enable a provider. Temporary capacity
limits age according to the same recorded observation used by live routing;
authentication and billing failures continue to require their recorded remedy.

Decision Concierge panels originate from unresolved decision records. Its standing
governance room reports cases skipped because the question lacks context, a panel
is unfinished or the case has not changed since the previous panel. A changed
question, options or evidence can make a completed case eligible again. Skipping
a panel leaves the decision unresolved and preserves its evidence.

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

## Repair disagreement in installed runtime capabilities

When runtime health reports that installed services and saved capability settings
disagree, ask your platform coworker to inspect the runtime reconciliation preview.
The preview changes nothing. It reports the validated installation snapshot,
saved settings, disagreement and the packaged code that can apply a repair.

Choose which capabilities should be enabled before applying the repair. Optional
services are never enabled merely because their initial saved settings say active.
The coworker submits the complete observed baselines, explicitly chosen enabled
capabilities, desired saved settings and the keys allowed to change through the
same governed runtime transition. Untouched settings, including custom operator
states, remain unchanged. Active attributed work can require a drain first.

A changed baseline refuses the repair. An interrupted request keeps its original
transition identity, signed recovery packet and immutable promoter image. Keep
that request for supported recovery; starting another request does not settle an
uncertain outcome. Completion requires a signed host result, required service
health and the owned saved-state commit. Remaining disagreement stays visible.

Coworker tools: `preview_runtime_capability_reconciliation` is read-only;
`reconcile_runtime_capabilities` applies explicit intent with platform-management
authority. Unavailable compatibility evidence requires the qualified platform
update before the repair can proceed.

## Defaults for work rooms

Priority & Models also carries the default for **work rooms** — how hard rooms push and
whether they may act without asking. It is listed separately from the per-coworker controls
because it governs work happening in a room rather than one coworker's own behaviour.

A room can override it, and what the work actually is overrides both. See
[Priority and outcomes](../ai-workforce/priority-and-outcomes.md).
