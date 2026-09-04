---
status: active
---

# Work Posture — making proactivity and the Golden Triangle workroom-, shape- and time-aware

**Epic:** `EP-WORK-CONVERGENCE` (posture ladder) · `EP-1C37C089` (gate binding)
**Status:** Design — approved direction, decomposition in §9
**Kernel consult:** `DI-D2A1964BD351` — `derive-and-layer` recommended, composite 10.603, margin 6.373, high confidence, no commandment conflict

Proactivity and the Golden Triangle were designed before the Workroom existed. Both
resolve against *who* is acting (agent, org, platform) and, for proactivity, a flat
`activityFamily`. Neither knows *what shape of work is happening*, *what the archetype's
value stream demands*, or *what time it is for the business*. This design closes that
without replacing either engine: one pure composition layer derives posture from
substrate that already exists, and lets a room declare an override.

> **The room's shape bounds what is permitted; the posture decides how hard and how fast
> the coworker pushes inside those bounds. A derivation may tighten authority. It may
> never widen it.**

---

## 1. What is actually true today

Every claim here is code-verified, not inferred.

| # | Finding | Evidence |
| --- | --- | --- |
| 1 | **Neither posture knows the room.** Proactivity scopes are `agent:` → `route-context:` → `activity-family:`. Golden Triangle scopes are agent → organization → platform. `Workroom` appears in neither ladder. | `proactivity-resolver.server.ts` `scopeKeysForInput`; `golden-triangle/persistence.ts` `getEffectivePostureForAgent` |
| 2 | **`taskClass` is a dead input.** It is declared on `CompileInput`, threaded through every caller, and **never read** by `compileGoldenTrianglePolicy`. Every live caller passes the literal `"conversation"`. The "what kind of work is this" slot already exists and does nothing. | `golden-triangle/types.ts` `CompileInput.taskClass`; `compile.ts` (no reference); `dispatch.ts`, `coworker-review.ts`, `telemetry-receipts.ts` |
| 3 | **There is no temporal input.** `ProactivityResolverInput` carries `deadlineWindowDays`, consulted for exactly one family (`tax-compliance`, ≤ 7 days). Nothing damps immediacy when the business is closed; nothing raises it when it is open and the work is load-bearing. | `proactivity-types.ts`; `proactivity-resolver.ts` `resolveLevel` |
| 4 | **Operating-hours substrate exists and is unused by posture.** `BusinessProfile.businessHours` + `timezone` + `lowTrafficWindows` are read by the self-upgrade window and deployment windows. No proactivity or routing path consults them. | `operating-hours-read.ts`, `operating-hours-types.ts`, `actions/deployment-windows.ts` |
| 5 | **`verificationDepth` is inert.** The compiler emits it, the chips render it, the right-sizing dial reads it as a label — **no verification step is gated by it**. "Marketing and payroll require verification" is currently unenforceable. | `compile.ts` header comment; only consumers are `posture-display.ts`, `GoldenTriangleOutcomes.tsx`, `explore/build-rightsizing-dial.ts`, `receipt.ts` |
| 6 | **Archetype awareness is one archetype deep.** `ProactivityResolverInput.archetype` accepts `demandSignature` / `capacityUnit` / `loadBearingStageKeys` / `trustGates`. The **only** supplier is field dispatch. The OVSM projection already derives all four for every leaf archetype. | `field-dispatch-proactivity.ts` is the sole populator; `packages/storefront-templates/src/operational-value-stream.ts` derives them universally |
| 7 | **Scheduled work carries no posture and no trigger.** `ScheduledAgentTask` holds cron + timezone + `taskKind` + `taskConfig`. The proactivity plan is consulted only *after a failure*, to size retry cadence. Nothing records **why** the job exists, so nothing can judge immediacy at fire time. | `ai-coworker.prisma` `ScheduledAgentTask` (`attempts` comment); `attention/sources/scheduled-task.ts` |
| 8 | **The posture never reaches the autonomy envelope.** `resolveWorkCaseAutonomyEnvelope` decides HITL from trust level, risk class and regulatory ceiling. The proactivity plan's `actionBoundary` (`advise`/`propose`/`preauthorized`) is a **parallel, unjoined** ladder. Two mechanisms decide "may a human be skipped" and they never meet. | `work-management/autonomy-envelope.ts` vs `proactivity-types.ts` `ProactivityActionBoundary` |

**The one place the two postures are already treated as one thing** is
`proactivity/delegated-posture.ts`, which composes a caller's proactivity *and* Golden
Triangle preference for a delegated subtask, with `regulated` / `qualityCritical`
receiver overrides that the receiver may not have traded away. That module is the seed
this design generalizes — it is not new thinking, it is thinking that was applied to one
narrow path and never promoted.

## 2. Why this is a design problem and not five bug fixes

Findings 1–8 look like eight independent gaps. They are one gap seen from eight angles:
**posture is resolved from identity, and work is not identity.** A `finance-controller`
coworker has one proactivity level and one Cost/Quality/Time posture, whether it is
drafting a marketing note at 9pm on a Saturday or releasing a payroll run on the
statutory due date. Identity is a poor proxy for what the work needs.

The four things that actually determine what a turn needs are all already modelled
somewhere in the platform, and none of them reach the posture:

- **shape** — what kind of collaboration this is (`WorkroomShapeKey`, `activityKind`, `mode`)
- **stream** — what the archetype's operational value stream demands (OVSM)
- **clock** — where "now" sits against operating hours and the obligation's deadline
- **stakes** — whether this action is outward-facing, moves money, or is regulated

## 3. Approach: derive and layer

Rejected alternatives, with the kernel's scoring in `DI-D2A1964BD351`:

- **Unify into one new primitive** (composite 4.230). Replacing both engines and migrating
  every caller — CRM packs, field dispatch, stall surface, build custodian, attention
  sources, the dispatch hot path, coworker panels — buys a cleaner diagram at the cost of
  a large blast radius and a long period where posture behaviour is unproven. Rejected.
- **Author posture per archetype** (composite 2.431). 111 leaf archetypes each hand-tuned
  is unmaintainable, drifts on the first archetype addition, and contradicts the OVSM
  contract's own rule — *derive, never author*. Rejected.

**Adopted:** one pure composition layer over the two existing engines. No new tables. No
replacement. The room-level declaration rides `Workroom.scopeClaims` exactly as the
declared collaboration shape already does (`workroom-shape-claim.ts`), so this lands
migration-free and folds into a first-class column when W2 referential integrity ships.

### 3.1 The single ladder

Both postures resolve through one precedence order:

```
1. Hard policy          residency · sensitivity ceiling · regulated ceiling   (never relaxed)
2. Room declaration     an explicit choice made when the room was convened
3. Derived              work shape × archetype stream × temporal band × stakes
4. Agent                Golden Triangle priority only — never proactivity
5. Org / activity-family
6. Platform default     Balanced / balanced — byte-identical to today
```

Layer 3 is the new one. Layers 1, 4, 5 and 6 already exist and keep their current
meaning; layer 2 is new but is a straight reuse of the shape-claim mechanism.

**Operator correction — proactivity is not identity state (2026-08-30).** The earlier
ladder incorrectly retained the coworker's saved proactivity as an inheritance layer.
For proactivity, the outcome-specific Workroom is authoritative: every participant
shares its level, cadence, channel and action boundary. Participant-specific trust,
qualifications, grants and autonomy envelopes remain safety ceilings and may only narrow
the room; they never supply or override its proactivity. Unroomed activity uses the
activity-family/platform default; proactive work without an outcome-specific Workroom is a
modelling gap, not permission to fall back to identity. This correction does not change the
separate Golden Triangle priority control.

**Retired under `BI-87C9C91C` (2026-09-01).** The `agent:<agentId>` scope is gone from
`scopeKeysForInput` in `lib/proactivity/proactivity-resolver.server.ts`, so no production
resolver reads a per-coworker proactivity override. The controls that wrote one are gone
with it: the coworker record's setting (replaced by a pointer to the room), the chat
composer dock's proactivity half (its Golden Triangle priority half is a different axis and
stays), and the consolidated roster, which is now a read-only projection of what a coworker
does outside any room. `getCoworkerProactivityPreference`, `getCoworkerProactivityPreferences`
and `saveCoworkerProactivityPreference` were deleted rather than deprecated — a save path
whose value nothing reads reports success and changes nothing.

Existing `aiCoworkerProactivity:agent:*` UserFacts are left in place and inert. They are
deliberately NOT migrated into room declarations: an identity preference cannot be
reinterpreted as an outcome preference without inventing a choice the owner never made.

Two interactive paths that previously read the coworker's saved level — the coworker turn
(`lib/actions/agent-coworker.ts`) and the opening briefing (`lib/agent/opening-briefing-loader.ts`)
— now take the platform default, which is byte-identical to what an agent with no saved
preference resolved before. Standing work that genuinely has an outcome resolves from the
room instead, through `lib/work-management/drive-resolution.ts`.

### 3.2 The safety invariant

> **A derivation may tighten. It may never widen.**

This mirrors the Golden Triangle's existing "residency is never relaxed" rule and is the
property that makes it safe to ship a derivation on the hot path:

- A derived posture may raise a proactivity level, tighten an `actionBoundary`
  (`preauthorized` → `propose` → `advise`), raise a tier floor, or add a verification
  requirement.
- A derived posture may **never** loosen an `actionBoundary`, lower a tier floor, remove
  a verification requirement, or relax residency. Out-of-hours damping changes **cadence
  and channel only** — never authority.
- Every clamp is recorded as a `PolicyAdjustment` with a stable `reasonCode`, so the
  operator sees *why* their setting did not apply, exactly as the compiler does today.
- **Damping is the single reducing lever, and it is separate by construction.** A bias that
  wants a coworker to be quieter sets `damp`; it cannot express that as a proactivity
  level, because the clamps only raise. This is what keeps "be less noisy" from ever being
  a route to "act unattended" — the two live in different parameters, and `damp` has no
  access to the authority axes. A derivation table entry that tries to say "quiet" the
  other way is inert, and a conformance test rejects it rather than letting it read as
  working.

Combined with **Balanced-inert** (a fully default context derives no deltas, so the
composed result is byte-identical to today) this makes the layer shippable on the shared
inference path without a flag-day.

## 4. Deriving from shape

The four shape axes are already live code. Each contributes a *bias*, declared once in a
code table — not authored per room and not per archetype.

| Shape / kind | Proactivity bias | Priority bias | Boundary floor |
| --- | --- | --- | --- |
| `change-consequential` | balanced | quality | `propose` |
| `approval-sign-off` | balanced | quality + verification | `propose` |
| `outward-review` | balanced | quality + verification | `propose` |
| `escalation` | **assertive** | time | `propose` |
| `specialist-alignment` | balanced | balanced | — |
| `craft-stewardship` | damped one step | cost-tolerant | — |
| `activityKind: remediation` | assertive | time | — |
| `activityKind: governance` | balanced | quality | `propose` |
| `mode: standing` | damped one step between cycles | — | — |

`taskClass` (finding 2) is the carrier: the resolver passes the room's shape as the
task class, and `compileGoldenTrianglePolicy` gains a task-class table. This turns a dead
contract field into the load-bearing one, rather than adding a parallel input.

## 5. Deriving from the archetype's stream

No per-archetype authoring. The OVSM projection already derives four properties for every
leaf archetype; the resolver consumes those four:

- `demandSignature` — `emergency-reactive` and `synchronized-contention` raise immediacy;
  `fiscal-calendar` binds the work to deadline bands; `steady` contributes nothing.
- `capacityUnit` — perishable and contended units (`slot-hours`, `perishable-stock`,
  `physical-hard-cap`) raise immediacy, because unused capacity is destroyed rather than
  deferred.
- `loadBearingStageKeys` — work on a load-bearing stage raises immediacy.
- `trustGates` — a stage carrying a trust gate raises the **verification** floor.

"All archetypes require adjustment" is therefore satisfied *mechanically*: a conformance
test asserts every leaf archetype resolves a posture from its own OVSM, and adding a new
archetype inherits the behaviour with no posture authoring. This is the same discipline
the OVSM itself declares — derive, never author.

## 6. Deriving from the clock

A pure function of `(now, weeklySchedule, timezone, lowTrafficWindows, dueAt)` yields one
temporal band. It reads the operating-hours substrate that already exists (finding 4);
it does not introduce a second calendar.

| Band | Meaning | Effect |
| --- | --- | --- |
| `in-hours` | inside the business's operating window | no change |
| `out-of-hours` | business closed | immediacy damped one step; channel drops to in-app; **cadence only, authority unchanged** |
| `low-traffic` | open, but inside a declared low-traffic window | cost-tolerant priority; batch-friendly |
| `pre-deadline` | inside the obligation's warning window | immediacy raised one step |
| `breach-imminent` | at or past the due boundary | assertive floor |

**Closed outranks cheap** ⟦runtime: corrected 2026-08-22 against live install data⟧. The
band is the *immediacy* answer; the low-traffic trough is a separate *cost* signal reported
alongside it. Ranking `low-traffic` above `out-of-hours` looked reasonable and was wrong:
an install's derived troughs are typically the exact complement of its business hours, so
every closed instant resolved as `low-traffic` and "the business is closed" never damped
immediacy anywhere. The live install proved it — Mon–Fri 09:00–17:00 America/Chicago with
troughs covering 17:00–09:00. `out-of-hours` now wins the band, and `lowTraffic` rides
along as a flag so the cost opportunity is still taken while closed.

**Out-of-hours exemptions.** Damping is wrong for work whose harm accrues while the
business is closed. These families are exempt and stay at their derived level:
`security-incident`, `platform-health`, `queue-health`, and any
`field-dispatch-appointment` already running late. The exemption list is explicit and
tested — a silent damp on a security incident is the failure mode this design most needs
to avoid.

## 7. Stakes: making verification load-bearing

Finding 5 is the sharpest gap. Three stake classes carry a **quality floor plus mandatory
verification** expressed as `PolicyConstraints` the posture cannot trade away:

- **outward-facing** — anything that leaves the business under its own name (marketing
  sends, customer communication, published content)
- **money-movement** — payroll runs, disbursements, refunds
- **regulated** — statutory filing, licensed advice

For these, `verificationDepth: "deep"` stops being decorative: the autonomy envelope
requires the verification receipt on the case before the action may close. The denial
reason joins the existing named set alongside `missing_decision_interaction` and
`stop_condition_tripped` — it is a policy denial, not a generic refusal.

This is also where finding 8 closes: the proactivity `actionBoundary` and the autonomy
envelope's `decisionMode` become **one projection**, with the stricter of the two winning.
A `preauthorized` proactivity setting can no longer imply autonomy that the envelope
would deny, and an `autonomous-action` envelope can no longer act on work whose shape
declared `propose`.

## 8. Triggers on scheduled work

⟦runtime: shipped 2026-08-23, `BI-5087F34F`⟧ The record lives on the existing
`ScheduledAgentTask.taskConfig` JSON under a `trigger` key — migration-free, the same
discipline the workroom shape and posture claims use on `scopeClaims`. It carries the
trigger kind (the four sources below, not a fifth taxonomy), the room served, and the
obligation discharged. `temporalInputForTrigger` feeds the obligation's due date — not the
cron time — into the band resolver, so the 03:00-tick-for-a-09:00-deadline case now reads
`pre-deadline`. A task with no trigger recorded behaves exactly as before.

Finding 7: a scheduled job knows *when* it fires and nothing about *why*. The four
trigger sources are already named in the governed value-stream design (§5.1) — time,
user request, incoming message, detected need. Scheduled work records:

- the **trigger kind** it represents,
- the **room / shape** it serves, so posture resolves through §3.1 at fire time rather
  than from cron alone,
- the **obligation** it discharges, where one exists, so §6's deadline bands apply.

The immediate consequence: a job that fires at 03:00 to discharge an obligation due at
09:00 resolves `pre-deadline`, not `out-of-hours`. Today it would resolve neither,
because the resolver is never asked.

## 8.1 The operator control ⟦runtime: shipped 2026-08-23⟧

Slice D shipped the room's posture as a READ-ONLY section, and the gap that left was
visible to the founder immediately: every settable control was per-coworker
(`CoworkerPriorityControl`, `CoworkerPriorityDock`, `CoworkerProactivitySetting`), so the
room displayed a posture with no way to change it. `WorkroomPosture.tsx` had zero
interactive elements and no server action existed.

Two altitudes now ship: the room's own settings inside the existing collapsed section
(kernel consult `DI-D553722A20B6` — inside-existing-section, 8.846, over a separate
settings section and an admin-page-only control), and a **decreed default for rooms** on
the priority surface beside the coworker controls.

The default's place in the ladder is the load-bearing decision: **above** the coworker
ladder, because it is specifically about rooms and they are not; **below** derivation,
because what the work actually is outranks a blanket preference about rooms. Both write
paths pass the action boundary through the tighten-only clamp, and the UI says so in
words — an invariant the operator cannot see is one they will be surprised by.

## 9. Decomposition

Each slice is independently shippable and independently inert until the next lands.

| Slice | Content | Inert until |
| --- | --- | --- |
| **A** | Temporal band resolver — pure function over the existing operating-hours substrate, with the exemption list. No caller. | B |
| **B** | Work-posture resolver — the §3.1 ladder as a pure composition over both engines, with `PolicyAdjustment` provenance and the tighten-only invariant. Not wired. | D |
| **C** | Task-class table in the Golden Triangle compiler — makes the dead `taskClass` field live; shape → priority bias. Balanced-inert. | — |
| **D** | Room declaration + room-derived posture — `scopeClaims` reader/writer, shape and archetype derivation, wired at the room-scoped seams. | — |
| **E** | Verification becomes load-bearing — stake classes, the envelope join, the new named denial reason. | — |
| **F** | Scheduled-work trigger record — trigger kind, room/shape link, obligation link, posture at fire time. | — |
| — | **Shipped state ⟦runtime: 2026-08-23⟧.** A, B, C, D, E, F and G have landed; H (the rich provenance surface) has not. `taskClass` is live, verification refuses, the two HITL ladders are one projection, scheduled work records why it exists, and a conformance test covers the whole archetype catalogue. | — |
| **G** | Archetype conformance — a test asserting every leaf archetype resolves a posture from its own OVSM. | — |
| **H** | Surface — the posture and its provenance rendered on the room, answering "why is it behaving like this". | D |

## 10. Research & Benchmarking

Three comparable open-source approaches to context-sensitive autonomy and scheduling
posture were examined before settling on derive-and-layer.

- **Temporal (temporal.io) — workflow policy inheritance.** Retry policies, timeouts and
  task-queue priority are declared per workflow *type* and overridable per execution,
  with the child inheriting the parent's policy unless it declares its own. DPF **adopts**
  the inheritance-with-explicit-override precedence and the principle that a policy is
  attached to the *work definition*, not the worker. DPF **rejects** Temporal's
  worker-side policy resolution: our equivalent must resolve where governance can see it,
  because the posture feeds an authority decision, not just a retry count.
- **Kubernetes — PriorityClass, PodDisruptionBudget and maintenance windows.** Scheduling
  urgency is a named class attached to the workload, and disruption is bounded by an
  independently-declared budget that the scheduler may not trade away. DPF **adopts**
  exactly this split: derived urgency (our temporal band and shape bias) is separate from,
  and subordinate to, an inviolable budget (our `PolicyConstraints`). This is the direct
  precedent for §3.2's tighten-only invariant.
- **OPA / Open Policy Agent — external decision point with a decision log.** Policy is
  evaluated outside the calling code and every decision is logged with its inputs. DPF
  **adopts** the decision-log discipline — every derived posture carries its
  `PolicyAdjustment` provenance so an operator can see which layer won and why. DPF
  **rejects** the external-PDP topology for this layer: the posture resolver must stay a
  pure function on the hot path, fail-open, with `principle_decide` remaining the only PDP.

**Standards basis.** The tighten-only invariant and the mandatory-verification classes
are the NIST AI RMF *Manage* function applied concretely: risk controls that automation
may tighten but not relax, with a recorded basis for each decision. The HITL join in §7
implements the `human-in-the-loop-at-phase-boundaries` commandment at a boundary that is
currently unguarded — a posture setting must not be able to purchase autonomy.

## 11. Non-goals

- Not replacing the proactivity resolver or the Golden Triangle compiler — this composes them.
- Not a new decision engine; `principle_decide` remains the PDP.
- Not per-archetype posture authoring (§5), and not a new calendar (§6).
- Not a new table — the room declaration rides `scopeClaims` until W2 lands.

## 12. Related

- [Work shapes and the decision gate](../../architecture/work-shapes-and-the-decision-gate.md) — the shape axes and the gate this posture sits beside
- [Golden Triangle Decision Primitive](../../design/golden-triangle-design.md) — the preference-to-policy compiler
- [AI Coworker Proactivity Policy](2026-06-29-ai-coworker-proactivity-policy-design.md) — the proactivity engine
- [Governed Value-Stream Lifecycles](2026-08-15-governed-value-stream-lifecycles-design.md) — §5.1 names the four triggers this design binds
- [A Governance Gate on Consequential Tool Use](2026-08-13-wwwd-constitutional-alignment-gate.md) — the envelope this posture must not be able to widen
