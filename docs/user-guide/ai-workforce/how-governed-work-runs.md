---
title: "How Governed Work Actually Runs"
area: ai-workforce
order: 2
description: "One pass end to end: the room a coworker works in, the shape that bounds it, the pace it sets, the corpus it consults, the gate on the tool, and the receipt you review afterwards."
relatedCode:
  - apps/web/lib/work-management/room-shapes.ts
  - apps/web/lib/work-management/room-posture.ts
  - apps/web/lib/work-posture/derive.ts
  - apps/web/lib/work-posture/temporal-band.ts
  - apps/web/lib/tak/consequential-tool-policy.ts
  - apps/web/lib/mcp-governed-execute.ts
  - apps/web/lib/work-management/autonomy-envelope.ts
---

## What This Covers

Individual guides explain each control on its own. This page is the connective one: it
walks a single piece of work from the moment it is convened to the moment you read the
receipt, and names which control acts at each step.

Read it once to get the shape of the system. Every heading links to the guide that owns the
detail, so nothing here is a second copy of a fact documented elsewhere.

## The one-sentence version

> A **Workroom** holds the work. Its **shape** bounds what may happen there at all. Its
> **posture** decides how hard and how fast a coworker pushes inside those bounds. When the
> coworker reaches a real decision it consults the **corpus** that owns that kind of
> question. When it reaches for a tool, the **gate** checks authority. What happens is
> written to a **receipt** you can review.

Each step can only narrow the one before it. Nothing later in the chain can widen what an
earlier step allowed — that invariant is what makes the whole sequence safe to describe in
one sentence.

## 1. The Workroom holds the work

A Workroom is a focused place where authorized people and AI coworkers coordinate toward a
named outcome. It is not an open chat channel: it carries a purpose, an outcome, a scope, an
accountable owner, an authority level, a sensitivity ceiling, measures, timing, and a rule
for when it closes.

Rooms come in two modes. A **finite** room closes when its bounded outcome is satisfied. A
**standing** room supports recurring work, and each cycle gets its own objective, measures,
stop conditions, and structured outcome.

Conversation alone never completes a room. Closing one produces an **Outcome Packet** built
from governed decisions, artifacts, actions, receipts, evidence, and — importantly — the
work left unresolved, each item with an explicit disposition.

→ [My Work and Workrooms](../workspace/work-rooms.md) is the full operator guide.

## 2. The shape bounds what may happen

A room is convened with a **collaboration shape**. The shape is the answer to "what kind of
collaboration is this", and it decides which roles must be present before the room may act
at all.

| Shape | What it is for | Roles it requires, in order |
| --- | --- | --- |
| `specialist-alignment` | A corpus check routed to a qualified specialist before the accountable approver receives the verdict | coordinator → specialist → approver |
| `approval-sign-off` | A specialist prepares evidence; an accountable approver signs off | coordinator → specialist → approver |
| `outward-review` | Something leaving the business under its own name gets specialist review and an explicit send or publish approval | coordinator → specialist → approver |
| `change-consequential` | A consequential change is reviewed and confirmed before it executes | coordinator → reviewer → approver |
| `escalation` | A veto returns to the originating coordinator and accountable owner to accept, block, or amend | coordinator → approver |
| `craft-stewardship` | The standing profession room: specialists curate their corpus and triage findings | coordinator → specialist |

Two properties matter beyond the role list:

- **Authority level.** The first five shapes operate at *action* level. `craft-stewardship`
  operates at *content* level — curating a corpus is not the same permission as acting on
  the business.
- **Sensitivity step-up.** Every shape except `craft-stewardship` requires stronger
  authentication when the room's sensitivity ceiling is confidential, restricted, or
  critical.

A room that never declared a shape gets a **derived** one from what it already is — a
standing profession room is craft stewardship by definition; launch-readiness work is an
approval sign-off; governance and remediation work is consequential. Declaring a shape is
therefore a way to be more specific than the default, not a required step.

If the required roles are not filled, the shape reports the gaps and the room is not
allowed to proceed on that basis. A missing approver is a stated gap, not a silent pass.

→ [Work shapes and the decision gate](../../architecture/work-shapes-and-the-decision-gate.md)
covers the four independent shape axes and the code that owns each.

## 3. The posture sets the pace

Posture is the newer half of the picture, and it is the answer to a question operators kept
asking: *why is this coworker behaving like this?*

Historically a coworker had one proactivity level and one cost/quality/time preference tied
to **its own identity** — the same posture whether it was drafting a note on a Saturday
evening or releasing a payroll run on the statutory due date. Identity turned out to be a
poor proxy for what a piece of work actually needs.

Posture is now resolved from the **work**, through one precedence ladder:

1. **Hard policy** — data residency, sensitivity ceiling, regulated ceiling. Never relaxed.
2. **The room's own declaration** — an explicit choice made when the room was convened.
3. **Derived** — from the shape of the work, the business's value stream, the clock, and the stakes.
4. **The coworker's own saved posture.**
5. **Organization or activity-family default.**
6. **Platform default** — Balanced.

Layer 3 is the new one. Three things feed it:

- **The shape of the work.** An escalation pushes harder, because someone is waiting.
  Outward-facing work is verified before it goes. Standing corpus curation stays in the
  background.
- **What the business does.** A business whose demand is emergency-driven, or whose capacity
  is destroyed rather than deferred when it goes unused, warrants earlier attention. This is
  derived from the business type's own value stream, not authored per industry.
- **The clock.** Read from the operating hours the organization already configured. When the
  business is closed, follow-up quietens. When an obligation's deadline is approaching, it
  speeds up.

### The two rules that make this safe

**A derivation may tighten. It may never widen.** A derived posture can raise urgency,
require an extra approval, or add a verification step. It can never remove one, lower a
floor, or relax data residency. Closing time changes how loudly a coworker follows up; it
never changes what a coworker is allowed to do.

**Some work is never quietened.** Security incidents, platform and queue health, and a field
appointment already running late keep their pace when the business is closed — because those
problems get worse while nobody is looking. The exemption list is explicit and tested.

Every adjustment records *why* it applied, so a setting that did not take effect explains
itself rather than appearing to be ignored.

→ Each room's **Pace and priority** panel shows the result and its provenance; see
[My Work and Workrooms](../workspace/work-rooms.md). Per-coworker levels live in
[Coworker Proactivity](coworker-proactivity.md).

### The priority half

The same posture carries a cost / quality / time preference — the **Golden Triangle**. It is
a preference-to-policy compiler, not a model picker: you express intent in plain terms and it
produces explicit policy adjustments against the routing and decision contracts that already
exist. It feeds model routing as *defaults*; an explicit setting and the local-only
sovereignty switch still win.

Two properties keep it safe on the shared inference path: it **fails open** — any error
falls back to today's behaviour — and it is **Balanced-inert**, so a default posture produces
no adjustments at all.

→ [Priority, Outcomes & Calibration](priority-and-outcomes.md) covers where to set it, how the
kind of work raises the floor, and how to read what actually ran.

## 4. The corpus decides the question

When a coworker hits a real decision rather than a routine step, it does not improvise and it
does not blend everything into one opinion. It routes the question to the scope that owns it.
Three scopes, three corpora, three different questions. They are siblings, not a hierarchy.

| Scope | The question it answers | What it reads |
| --- | --- | --- |
| **WSID** — profession | *How should I, in my craft, do this?* | The profession's own corpus of recorded techniques and standards |
| **WWMD** — platform | *What should we do about the platform itself?* | The kernel principles |
| **WWWD** — organization | *Does this fit the company — mission, market, product, go-to-market?* | The stances your organization has authored |

Routing a question to the wrong scope is the failure this separation exists to prevent. A
customer's business decision must not inherit platform judgment as authority.

Three properties of the profession gate are worth knowing, because they shape how a coworker
behaves when its corpus is thin:

- It is **scoped to the calling coworker**. There is no anonymous craft judgment.
- **Stakes raise the bar.** Higher-consequence questions require more confidence before the
  gate will return a recommendation at all.
- A thin corpus does not produce a bad recommendation — **it produces an escalation.**

That last point is the practical one: corpus coverage is an input to autonomy, not a
nice-to-have. A coworker whose profession corpus is empty will keep asking you, correctly.

→ [Decision Perspective](decision-perspective.md) for the model;
[Decision Perspective in Practice](decision-perspective-in-practice.md) walks a real
question end to end.

## 5. The gate checks the tool

Consulting a corpus produces a recommendation. It does not produce permission. Permission is
decided separately, when the coworker reaches for a tool.

Every governed tool call is classified into one of three consequence classes:

- **routine-read** — reads only.
- **ordinary-mutation** — changes internal state.
- **consequential-mutation** — spends money, reaches a third party, changes who may act, or
  destroys state.

Classification is not a hand-maintained list of tool names. It runs from the declared
consequence on the tool itself, on the central governed execution path, so it covers every
governed call. A consequential tool also carries the collaboration shape its use implies —
which is how a tool reaching outward pulls `outward-review` into the picture even when
nobody named it.

Two independent checks then apply, and both must pass:

- **The authority intersection.** A tool is unavailable unless the coworker's grant *and*
  the acting user's capability both allow it. Default deny. Asking in natural language is not
  a route around this.
- **The autonomy envelope.** This decides whether a human turn is required at all:
  *shadow-only* (recorded, never taken), *propose-for-approval*, *supervised-action*, or
  *autonomous-action* — the only mode that permits acting without a human.

The posture from step 3 and the envelope are one projection, and **the stricter of the two
wins**. A proactivity setting cannot buy autonomy the envelope would deny, and an autonomous
envelope cannot act on work whose shape declared that it must be proposed.

Denials come back as named reasons — a missing decision interaction, a missing envelope, a
tripped stop condition, a missing verification receipt — not as a generic refusal. A denial
tells you what to fix.

### The floors nothing crosses

Two hold at every posture, every autonomy level, and every proactivity setting:

- **Money leaving the business always comes to you.**
- **Anything that goes public always comes to you.**

A third class joins them where the work is regulated: statutory filing and licensed advice
carry a mandatory verification requirement that the posture cannot trade away. For these,
verification is not advisory — the action cannot close without the verification receipt on
the case.

→ [Identity and Access](../platform/identity-and-access.md) for the authority model;
[AI Workforce](index.md) for tool grants.

## 6. The receipt is what you review

Every governed outcome writes a receipt: who acted, what they did, why, under whose
authority, and what resulted. This is the part most worth building a habit around, because
it is where the previous five steps become inspectable rather than theoretical.

Four surfaces read that trail, each answering a different question:

- **Coworker Decision Engine** — the decisions themselves, the stance and craft corpora
  behind them, and the open reviews waiting on you.
- **Coworker proactivity** — every coworker and the level it currently acts at, grouped by
  business area, with derived defaults distinguished from ones you set.
- **Priority outcomes** — what the cost/quality/time posture asked for compared with what
  actually ran, with an infrastructure failover distinguished from a deliberate trade-off.
  The distinction matters: one is a fault to fix, the other is the system doing what you
  asked.
- **The room's own Shape panel** — the gates this work passed through, one status mark per
  stage: passed, holding, declined, awaiting a person, or not reached. *Declined* and
  *awaiting a person* are deliberately different marks — a decline is a settled answer to act
  on, an open question is not.

Where the audit trail has nothing to say, these surfaces say so rather than guessing. A stage
with no records reads **No records yet**. A room with no posture of its own reads **Running on
defaults**. That is deliberate: a picture that never disagrees with the ledger is worth more
than one that always looks complete.

## Known limits

Stated plainly, so nothing here reads as more finished than it is:

- **The decision-gate stage is not attributed to a coworker.** The decision record does not
  yet identify which coworker acted, so the shape view leaves that stage empty rather than
  attributing a decision on a guess.
- **The consultation ledger is per-process.** A decision consulted in one process is not
  visible to another; only the receipt it writes survives the turn.
- **Priority outcomes are reconstructed against the current posture.** Recent runs are
  compared with the posture in force now, and historical failover is not reconstructed.
- **Proactivity only produces unattended work for coworkers that have standing work bound to
  them.** For every other coworker the level shapes conversation and nothing else. Turning an
  idle coworker to Assertive will not make it start working. See
  [Coworker Proactivity](coworker-proactivity.md) for which coworkers currently self-drive.

## Related

- [My Work and Workrooms](../workspace/work-rooms.md) — the room, its cycles, and its participants
- [Coworker Proactivity](coworker-proactivity.md) — the per-coworker pace control
- [Decision Perspective](decision-perspective.md) — WWMD, WWWD, and WSID in full
- [Decision Perspective in Practice](decision-perspective-in-practice.md) — one question, end to end
- [Priority, Outcomes & Calibration](priority-and-outcomes.md) — the cost/quality/time half, and its receipts
- [AI Workforce](index.md) — the coworker directory, grants, and availability
- [Work shapes and the decision gate](../../architecture/work-shapes-and-the-decision-gate.md) — the architecture behind steps 2 and 5

## The pace a room runs at

Work happening in a room resolves its own pace, rather than inheriting only the acting
coworker's settings. Four things decide it: what the room declares, what kind of work it is,
what the business does, and what time it is. Outside your operating hours a room quietens
down; work whose harm grows while nobody is looking — a security incident, a late
appointment — does not.

None of that changes what a coworker is allowed to do. Timing and authority are separate:
a quieter room still asks permission for exactly the same things.

You can set a room's pace on the room itself, and a default for all rooms under
Priority & Models. See [Work Rooms](../workspace/work-rooms.md).
