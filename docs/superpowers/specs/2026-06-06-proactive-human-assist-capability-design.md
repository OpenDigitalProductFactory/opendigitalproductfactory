# Proactive Human-Assist Capability — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-HITL-MOBILE — Realtime HITL + Mobile companion |
| **BI** | BI-3F455757 |
| **First instance** | BI-1EBBCB61 (finance coworker reads LLM-provider billing) |
| **Status** | Draft |
| **Created** | 2026-06-06 |
| **Author** | Claude Code (Opus 4.8) for Mark Bodman |
| **Scope** | A first-class way for any AI coworker to proactively ask a human to look at / do / provide something it cannot do itself, with interchangeable response modalities, governed by the org's WWWD profile, surfaced through existing HITL channels, recorded and PAR-aware. |
| **Anchors** | `CoworkerActionEnvelope`, `AgentActionProposal`, the actionable-coworker-response convention, EP-HITL-MOBILE surfaces, the WWWD Decision Perspective Gate (`docs/user-guide/ai-workforce/decision-perspective.md`), the PAR principle, `CoworkerCapabilityNeed`, the browser-driving capability (`2026-06-05-coworker-browser-driving-capability-design.md`) |
| **Standing procedure** | Each architect-default ran through `principle_decide`. Verdicts recorded in §3. Operator may override. |

---

## 1. Problem Statement

An AI coworker doing real work routinely hits a step **only a human can do**: look at an auth-walled page and read a figure, paste a screenshot, type a value the coworker has no source for, perform an external action (sign a form, click a vendor's button), or make a judgment call. Today the coworker has **no governed, structured, recorded way to ask** — it either silently stalls, hallucinates a value, or buries the ask in chat prose with no tracking or resolution state.

The operator directive (2026-06-06): *"we want proactivity in the way the AI coworker can interact with the humans, asking them to look at or do something that they can't, to complete the overall mission of their job, and the company per WWWD."*

This surfaced concretely in the finance-billing thread (BI-1EBBCB61): the finance coworker needs authoritative provider spend it can't self-serve, and the lowest-cognitive-load answer is to **ask the human** — *paste a screenshot, open your billing page, or just type the number* — rather than force credential setup. That is one instance of a general pattern.

**This is distinct from approving the coworker's own action.** `CoworkerActionEnvelope` gates a destructive action the *coworker* will take (the human says approve/deny). A human-assist request asks the *human* to perform or provide something the coworker **cannot** — a different direction of agency, a different lifecycle, different response shapes.

---

## 2. The capability in one line

> A coworker raises a bounded **`HumanAssistRequest`** — "I need you to {look at / do / provide} X, because {mission link}" — the platform routes it to the right human through the right channel **per the org's WWWD interruption policy**, the human answers via whichever **modality** is easiest, and the answer flows back into the coworker's work, fully recorded.

---

## 3. WWMD verdicts (architect defaults)

Two load-bearing decisions, scored via `principle_decide` (`callingPopulation: external_coding_agent`, full-kernel `ringScope`). Both **high confidence, no commandment conflict**.

### Verdict 1 — Primitive shape

> **Recommendation: `new-human-assist-primitive`** — composite 12.81, margin 4.91, confidence **high**.

Introduce a **dedicated `HumanAssistRequest`** record for coworker→human asks. Do **not** overload `CoworkerActionEnvelope` (which stays the destructive-action-approval gate). Rejected: `overload-coworker-action-envelope` (7.91). The kernel reads conflating two opposite-agency lifecycles in one table as the shortcut; *Architecture Over Shortcuts*, *Single Source of Truth*, and *Proper Fix Over Quick Fix* all pull toward a clean, distinct primitive. The two reuse the same *surfaces* and *audit*, but are separate records.

### Verdict 2 — Where interruption policy lives

> **Recommendation: `wwwd-decision-perspective-gate`** — composite 12.96, margin 5.49, confidence **high**.

When/who/which-channel a coworker may interrupt is governed by the **customer org's WWWD Decision Perspective profile**, honoring the **non-inherit boundary** (a customer profile does not inherit platform business judgment as authority by default). The platform ships **advisory defaults only**. Rejected: `platform-kernel-hardcoded-policy` (7.47). Interrupting a human is a *customer business-operations* decision (it concerns the customer's people, their attention, their working hours) — *Single Source of Truth* + *Research and Use Standards* pull hard toward the org's own WWWD, not a one-size platform rule. This mirrors the WWMD-vs-WWWD boundary in AGENTS.md §16.

**Everything below is bound by these two verdicts.**

---

## 4. Substrate anchoring (verified)

Per `dpf-verify-substrate-first`. What exists, and the gap:

- **`CoworkerActionEnvelope`** (`packages/db/prisma/schema.prisma`) — gates the coworker's *own* destructive action (`status` String default `"proposed"` → `approved` → `executed`; `argsJson`/`rationale`/`delegatingUserId`/`threadId` all confirmed present). **Different agency** (approve *my* action), not "please do X for me." Reused as the *model* of a governed, recorded, human-gated record — but a sibling, not the same table (Verdict 1). Note the existing lifecycle is a free-form `String`, not a hard Prisma enum — `HumanAssistRequest.status` should follow the same convention for consistency.
- **`AgentActionProposal`** (`packages/db/prisma/schema.prisma`) — proposal-mode action approval. Same approve/deny shape; same distinction. **Precedent for Verdict 1:** the schema already keeps `AgentActionProposal` as its own table *separate from* `CoworkerActionEnvelope` — the codebase has already chosen separate sibling records over one overloaded table for two approval shapes. `HumanAssistRequest` is the third sibling, not a discriminator bolted onto either.
- **Actionable-coworker-response convention** — coworkers end turns with concrete user choices. The human-assist request is the *structured, durable, routable* form of that, instead of ephemeral chat prose.
- **EP-HITL-MOBILE** (Realtime HITL + mobile companion) — the **delivery surfaces** a request rides on (in-portal, push, mobile). This BI lives under that epic.
- **WWWD Decision Perspective Gate** (`decision-perspective.md`) — the **governance** of *whether/when/who* to interrupt (Verdict 2). Non-inherit boundary applies.
- **PAR (Propose, Acknowledge, Reassign)** — the resolution discipline: the named human must acknowledge before the request is "owned," and reassignment (defer/decline/reassign) is explicit, recorded as state, not chat.
- **`CoworkerCapabilityNeed`** — the coworker's *standing* capability gaps (long-lived). A `HumanAssistRequest` is a *task-scoped* runtime ask. Related but distinct: a recurring assist may *graduate* into a capability need (or an automation).

**Gap:** none of these is "coworker asks a human to perform/provide a thing the coworker can't, with a typed response." That is the new primitive.

---

## 5. The `HumanAssistRequest` primitive

A thin, durable, auditable record. Fields:

- `requestId` (unique)
- `coworkerAgentId` — the asking coworker
- `threadId` / `taskRunId?` — the work this unblocks (mission link)
- `kind` — `look-and-report` | `provide-value` | `upload-artifact` | `perform-external-action` | `decide`
- `prompt` — plain-language ask ("Read your OpenAI billing total for last month")
- `rationale` — why it's needed / what it unblocks (the mission tie-in)
- `allowedModalities` — the response shapes the human may use (see §6); the coworker offers the set, the human picks one
- `responseSchema?` — optional shape for `provide-value`/`decide` (e.g. `{amount: number, currency: string}`)
- `assigneePolicyJson` — the *resolved* routing (who/channel/urgency) computed from WWWD (§7) — recorded for audit, not hand-set
- `assignedPrincipalId?` — the human it's routed to (resolved per WWWD)
- `status` — `proposed → acknowledged → answered | declined | deferred | expired | reassigned` (PAR-aligned)
- `responseModality?` / `responseJson?` / `responseArtifactId?` — how it was answered + the answer
- `sensitivity` — drives redaction + channel eligibility
- `createdAt` / `acknowledgedAt?` / `resolvedAt?` / `expiresAt?`

Invariants:
- A request is **never** auto-answered; only a human transitions it past `acknowledged`.
- `expiresAt` bounds it; on expiry the coworker is told and chooses fallback (re-ask, escalate, proceed-degraded, abandon) — never silently proceed on a missing answer.
- The answer flows back into the originating thread/task as a typed result the coworker consumes.

This composes with `CoworkerActionEnvelope` rather than replacing it: a request whose answer then triggers a *destructive* coworker action still gates that action through an envelope. Two records, two gates, one flow.

---

## 6. Response modalities (interchangeable, human picks the easiest)

One ask, several ways to answer — the human chooses. The coworker offers the relevant subset:

| Modality | For | Cognitive load | Stores a credential? |
|---|---|---|---|
| **Manual entry** | `provide-value` / `decide` | lowest | no |
| **Screenshot upload** | `look-and-report` (vision reads it) | low | no |
| **View-and-report** (deep-link → human reads the live page) | `look-and-report` on an auth-walled page | low | no |
| **Live-session read** (coworker reads the human's already-authenticated browser via the operator-live browser path) | `look-and-report` where the coworker can extract directly | low | no (uses the live session) |
| **Do-and-confirm** | `perform-external-action` | varies | no |
| **Approve/deny** | `decide` | low | no |

The finance instance (BI-1EBBCB61) uses the first four. **None of the default modalities stores a credential** — that is the whole point of preferring human-assist over autonomous browser-driving for attended work. Autonomous, unattended operation (stored creds, scheduled) is the opt-in *upgrade*, not the default, and is the browser-driving capability's job — the coworker *offers* it when it notices repeated identical asks.

---

## 7. WWWD-governed interruption (Verdict 2)

A coworker may not interrupt a human arbitrarily. Before routing, the platform consults the **org's WWWD Decision Perspective Gate**: *given this org's business judgment, should this coworker interrupt this human now, through what channel, at what urgency?*

**Decide vs. route — keep them distinct.** The Gate is a *decision-maker*, not a routing engine. It returns one of its four standard outcomes — `recommend` / `arbitrate` / `escalate` / `defer` — plus a confidence score and a `DecisionInteraction` audit row (per `decision-perspective.md`). The Gate's job is to *decide whether and how aggressively* to interrupt; the new human-assist machinery *executes* the resulting routing. Concretely, the Gate's outcome shapes:

- **Whether** to ask now vs. batch vs. defer (`recommend`/`defer` map directly; a low-urgency billing read batches into a daily digest, an outage-blocking ask interrupts immediately).
- **Who** — the right human by role/ownership (finance ask → the finance owner, not whoever's nearest).
- **Channel** — in-portal, push/mobile (EP-HITL-MOBILE), email — by urgency + the org's norms.
- **Quiet hours / working-hours** — the org's policy, not a platform default.
- **Batching** — coalesce similar low-urgency asks to reduce interruption count.

An `escalate` outcome (low confidence, contradictory sources) raises the existing operator approval surface rather than auto-routing — exactly the safety property we want when the org's interruption policy is thin.

The **non-inherit boundary** holds, and it rides the Gate's existing four-level inheritance chain: *active WWWD/customer profile → DPF product doctrine → DPF organizational principles → `defer`*. DPF ships *advisory defaults* (sane urgency tiers, quiet-hours off by default, owner-routing) that live at the doctrine level and are overridden the moment the org's own WWWD profile carries interruption material. DPF doctrine is advisory until the org seeds its own WWWD; the raw WWMD/founder kernel does **not** decide a customer's interruption policy.

> **Instance caveat (verified):** in *this* DPF portal, the `organization` (WWWD) profile is a *shipped surface with deferred content* and currently points at the platform (WWMD) profile, because the product and the business are the same thing (`decision-perspective.md` §Profile Kinds; customer WWWD seeding is in-progress under EP-WWMD). So today the Gate answers interruption questions from platform doctrine. That is acceptable for the advisory-defaults phase, but Phase 2 below has a **hard dependency** on customer-WWWD-profile content existing — flagged in §11.

This is the lever that makes proactivity *welcome* rather than *noisy*: the coworker is proactive, but the *org's own judgment* shapes when that proactivity reaches a person.

---

## 8. Surfacing & resolution

- **One request, multiple delivery surfaces** (resolved per WWWD): coworker chat (the actionable-response slot), the mobile companion / push (EP-HITL-MOBILE), and notifications. The request is the single source of truth; surfaces render it.
- **PAR discipline:** the routed human **acknowledges** (state, not a chat "ok") before owning it; **reassignment** (defer / decline / reassign to another human / escalate) is explicit and recorded. An unacknowledged request after `expiresAt` escalates per WWWD or returns to the coworker for a fallback decision.
- **Audit (two linked trails, no new substrate):** (1) the request lifecycle itself — request + response modality + answer + latency — rides the existing `ToolExecution` audit substrate (`capabilityId: human-assist`, confirmed present at `schema.prisma`), linked to the thread/task and the coworker's job; (2) the *interruption decision* that routed it is already captured as the Gate's `DecisionInteraction` row (active profile version, cited materials, confidence, outcome). Joining the two answers both "what did my workforce ask of my people, how often, how fast did they answer?" **and** "on whose judgment was each interruption authorized?" — a real management surface built entirely from existing audit records.

---

## 9. Research & Benchmarking

Per AGENTS.md §10.

**Open-source / framework patterns:**
- **LangGraph human-in-the-loop / `interrupt`** — graph nodes that pause, surface state to a human, and resume on input. **Adopted:** the durable pause-and-resume shape (a request is a typed await on a human). **Rejected:** its in-graph-only scope — DPF needs the ask routable across channels and governed by org policy, not just a checkpoint.
- **Temporal / Inngest "wait for signal/event"** — durable workflow steps that block until a human signal arrives, with timeouts. **Adopted:** durable, timeout-bounded await + the resolution-state machine. DPF's `HumanAssistRequest.status` + `expiresAt` is this pattern made a first-class record.
- **n8n / agent "human approval" nodes** — pause for a human yes/no. **Adopted:** approve/deny modality. **Anti-pattern:** they conflate "approve my action" with "do this for me" — exactly the conflation Verdict 1 rejects.

**Commercial patterns:**
- **AWS Augmented AI (A2I)** — routes model predictions to human review loops with worker assignment + SLA. **Adopted:** typed task + assignee routing + SLA/expiry. **Rejected:** its fixed worker-pool model — DPF routes by org ownership/WWWD, not a labeling pool.
- **PagerDuty / on-call routing** — urgency tiers, escalation policies, quiet hours, who-to-page. **Adopted wholesale** as the *interruption-policy vocabulary* (urgency, escalation, quiet hours, owner routing) — but sourced from the org's **WWWD**, not a static on-call schedule.
- **ServiceNow / Zendesk human task assignment** — assign, acknowledge, reassign, SLA, audit. **Adopted:** the PAR-aligned lifecycle + audit trail.

**Gap this fills:** none of these unify (a) a coworker-initiated, typed, multi-modal human ask, (b) governed by the *customer org's own* business judgment about interrupting its people, and (c) recorded as a managed workforce-interaction record. That tri-fold is the DPF differentiator.

---

## 10. Relationship to adjacent capabilities

- **`CoworkerActionEnvelope`** — sibling, not parent (Verdict 1). Envelope = "approve the action I'm about to take." HumanAssistRequest = "do/provide something I can't." A flow may use both (ask → get value → envelope-gate the resulting destructive action).
- **Browser-driving (EP-BROWSER-DRIVE)** — supplies two *modalities* (view-and-report deep-link; live-session read) and is the **unattended upgrade** when an assist recurs. Human-assist is the attended, zero-credential default; browser-driving with stored creds is the autonomous opt-in.
- **`CoworkerCapabilityNeed`** — a recurring assist is a signal to *graduate* into a capability/automation (or a stored-credential autonomous path), surfaced to the operator.
- **Finance instance (BI-1EBBCB61)** — the first concrete consumer; should build on this primitive (or prototype it and graduate here).

---

## 11. Phasing

- **Phase 1 — primitive + manual/screenshot/value modalities + chat surface.** `HumanAssistRequest` model + lifecycle (PAR states, expiry), the three no-browser modalities, surfaced in coworker chat, recorded. Unblocks the finance instance's default path immediately. WWWD routing starts with advisory defaults.
- **Phase 2 — WWWD interruption policy + multi-channel.** Decision Perspective Gate resolves whether/who/channel/quiet-hours/batching; mobile/push delivery (EP-HITL-MOBILE); escalation on no-ack. **Dependency:** this phase needs the org's WWWD profile to actually carry interruption material. That content is a deferred deliverable today (EP-WWMD, see §7 instance caveat) — so Phase 2 is gated on either customer-WWWD seeding *or* a decision to encode the interruption dimension as platform-advisory doctrine the Gate reads at the inheritance chain's doctrine level. Resolve this fork (open question 2) before Phase 2 starts, or it stalls on missing profile content.
- **Phase 3 — browser modalities + graduation.** View-and-report deep-link + live-session read (browser-driving); recurring-assist → capability-need/automation graduation; the operator "what is my workforce asking of my people" management view.

---

## 12. Open questions

1. Does `HumanAssistRequest` reuse the `CoworkerActionEnvelope` table with a discriminator, or its own table? Verdict 1 says distinct primitive, and the existing `AgentActionProposal`/`CoworkerActionEnvelope` split is direct precedent for separate sibling tables (§4). Default to a third sibling table; only revisit if schema review (AGENTS.md §11) shows a shared base model is materially cleaner.
2. WWWD policy shape for interruptions — does the interruption policy live as **profile material the Gate reasons over** (urgency tiers / quiet-hours / owner-routing as `PerspectiveMaterial` the Gate weighs), or as a **structured policy object** the Gate's outcome references? The Gate today returns `recommend/arbitrate/escalate/defer` over weighted materials — it is not a typed policy store — so a structured quiet-hours/urgency table likely needs to live beside it and be *cited* by the decision, not computed inside it. Needs the decision-perspective owner. This fork also gates Phase 2 (§11).
3. Batching/coalescing semantics — how similar must two asks be to batch, and who decides (coworker vs. platform vs. WWWD)?
4. Expiry fallback authority — when a request expires, may the coworker proceed degraded autonomously, or must it always escalate? Likely WWWD-governed per sensitivity.

## 13. Decision record

- **WWMD Verdict 1** (primitive shape): `new-human-assist-primitive`, composite 12.81, margin 4.91, high confidence, no commandment conflict.
- **WWMD Verdict 2** (interruption governance): `wwwd-decision-perspective-gate`, composite 12.96, margin 5.49, high confidence, no commandment conflict.
- **BI**: BI-3F455757 (EP-HITL-MOBILE). First instance: BI-1EBBCB61.

## 14. Recommendation

Build a dedicated **`HumanAssistRequest`** primitive — a coworker-initiated, typed, multi-modal, PAR-aligned, audited ask — distinct from `CoworkerActionEnvelope`, surfaced through the existing HITL/mobile channels, and **governed by the customer org's WWWD** for whether/when/who/how to interrupt (advisory platform defaults, non-inherit boundary). Ship the no-credential modalities first (manual / screenshot / value) so the finance billing instance lands on it immediately, then layer WWWD routing, multi-channel delivery, and the browser modalities + graduation. This makes coworker proactivity a **managed, welcome** property of the AI workforce rather than noise — the coworker keeps its mission moving by asking for exactly what only a human can give, on the org's own terms.
