# Work shapes and the decision gate

**Scope:** canonical Workroom shape and decision-gate architecture
**Epic:** `EP-WORK-CONVERGENCE`
**Status:** Current

A Workroom is not a generic container. It is convened with a **shape**, and that shape
is what bounds the actions available inside it. Within those bounds, the kernel decides
whether a coworker may proceed unattended. Two levels, in that order:

> **The room's work shape bounds what is permitted at all. `principle_decide` gates
> autonomy within that envelope.**

Neither level substitutes for the other. A shape that permits an action does not make it
autonomous; a high-confidence kernel recommendation does not widen the envelope the shape
set. This page states the shape vocabulary, where the decision gate sits, and what the
shape does next once a gate clears.

Vocabulary for the three layers (record → projection → view) is fixed in
[Workroom vocabulary boundary](workroom-vocabulary-boundary.md); this page starts where
that one deliberately stops.

## The flow

```mermaid
flowchart TD
    convene[Room convened with a shape] --> envelope[Action envelope<br/>what this shape permits at all]
    envelope --> action[A consequential action is proposed]

    action --> gate{Decision gate}
    gate -->|WSID: craft| wsid[evaluate_profession_decision<br/>profession corpus]
    gate -->|WWMD: platform| wwmd[principle_decide<br/>kernel principles]
    gate -->|WWWD: business| wwwd[evaluate_org_business_decision<br/>org stance]

    wsid --> verdict[Confidence-scored recommendation]
    wwmd --> verdict
    wwwd --> verdict

    verdict -->|high confidence| mode[Autonomy mode decides the turn]
    verdict -->|low confidence or<br/>commandment conflict| escalate[Escalate to a human]

    mode --> act[Act, or propose for approval]
    escalate --> act

    act --> receipt[Receipt on the case]
    receipt --> stop{Stop condition met?}
    stop -->|no| action
    stop -->|yes| packet[Outcome packet<br/>cycle closed or carried over]
```

## Shape is four orthogonal choices, not one taxonomy

A common misreading is that "work shape" is a single enum. It is four independent axes,
each owned by a different part of the substrate. A room picks one value on each.

| Axis | Values | Owner |
| --- | --- | --- |
| **Activity kind** — what the work *is* | `delivery`, `support`, `improvement`, `governance`, `launch-readiness`, `craft-judgment`, `lifecycle`, `remediation` | `WORK_CAPSULE_SCOPE_ACTIVITY_KINDS` in `apps/web/lib/work-capsules.ts` |
| **Mode** — how long it lives | `finite` (one bounded decision or action), `standing` (ongoing activity) | `WorkroomMode` in `apps/web/lib/work-management/room-types.ts` |
| **Participant roles** — who is in it, as what | `accountable`, `coordinator`, `contributor`, `specialist`, `approver`, `reviewer`, `observer` | `WorkroomParticipantRole`, same file |
| **Collaboration shape** — how a gate inside it routes | `specialist-alignment`, `approval-sign-off`, `outward-review`, `change-consequential`, `escalation`, `craft-stewardship` | `WORKROOM_SHAPE_KEYS` in `apps/web/lib/work-management/room-shapes.ts` |

The first three are live code. The fourth **is now a registry with a write path**
⟦runtime: 2026-08-23⟧: `WORKROOM_SHAPE_KEYS` in
`apps/web/lib/work-management/room-shapes.ts` is the enum, and a room is convened with a
shape by passing `workroomShape` to `create_workroom` or `adopt_worktree`. It persists as a
`scopeClaims` entry — no migration — and is read back by `readWorkroomShapeClaim`.

A room that never declared one gets a **derived** shape from what it already is
(`derive-workroom-shape.ts`): a standing WSID room is craft stewardship by definition,
`launch-readiness` is an approval sign-off, `governance` and `remediation` are consequential
changes. The derivation deliberately returns **null** for `delivery`, `support`,
`improvement`, `lifecycle`, a bare `wwmd`/`wwwd` scope, or no signal — several shapes could
fit and the room has not said which, so it is reported unshaped rather than guessed.

Measured on the reference install at the time of writing: shape coverage went from **0% to
9.2%** (30 of 327 rooms), because the scope signals the derivation reads exist on only
~13% of rooms. The remainder closes as rooms are convened with a shape, not by backfill.
So a claim that a room "has" a collaboration shape is now queryable — but check whether it
was **declared or derived**, and expect most older rooms to have neither.

Finite and standing rooms are explained for end users in
[Work Rooms](../user-guide/workspace/work-rooms.md).

Definition and occurrence identity are not a fifth shape axis. The Work Case source
registry owns a stable, versioned room-definition projection. The Work Case owns the room
instance, with its primary source, current cycle, and active execution carriers forming
the occurrence trace. This keeps the same definition useful for business-only and
development rooms: repository, worktree, pull-request, token, and CI records are optional
execution evidence, never prerequisites for room identity.

## The gate: which scope decides

Three decision surfaces, three corpora. They are siblings, not a hierarchy, and each
answers a different question. Routing a question to the wrong one is the failure mode the
`consult-scopes-before-asking` commandment exists to prevent.

| Scope | Tool | Question it answers | Corpus |
| --- | --- | --- | --- |
| **WSID** (profession) | `evaluate_profession_decision` | *How should I, in my craft, do this?* | the coworker's profession corpus — recorded techniques and standards |
| **WWMD** (platform) | `principle_decide` | *What should we do about the platform itself?* | kernel principles |
| **WWWD** (organization) | `evaluate_org_business_decision` | *Does this fit the company — mission, market, product, GTM?* | the org's authored stances |

**WSID is the specialist's gate.** Its handler is
`apps/web/lib/mcp/packs/profession-decision-pack.ts`. Three properties matter for how it
behaves as a gate:

- It is **scoped to the calling coworker**. A profession decision with no agent identity
  reaching the tool is refused outright — there is no anonymous craft judgment.
- **Stakes raise the bar.** Higher consequence tiers require more confidence before the
  tool will return a recommendation at all.
- It **falls back to platform defaults only as advisory** when the profession has no
  recorded guidance, and **escalates to a human on low confidence** rather than guessing.

That last property is the one to design around: an empty or thin profession corpus does
not produce a bad recommendation, it produces an escalation. Corpus coverage is therefore
an autonomy input, not a nice-to-have.

The composition rule from the [standards family](agent-standards-family.md) still governs
who may run the check: `GAID identity → JSI qualification → TAK intersection → GAID
receipt`. A qualification is not permission to act; the gate layers on top of it.

## What the gate does to the turn

A cleared gate does not mean "act". It means the autonomy envelope now decides whether
this coworker takes the turn or hands it to a human. That projection lives in
`apps/web/lib/work-management/autonomy-envelope.ts`:

| Decision mode | What happens |
| --- | --- |
| `shadow-only` | the action is recorded, never taken |
| `propose-for-approval` | a human turn is required |
| `supervised-action` | acts, with a supervising human in the loop |
| `autonomous-action` | **the sole mode that permits acting without a human turn** |

**The two ladders are now one projection** ⟦runtime: 2026-08-23⟧.
The decision mode above and the proactivity `actionBoundary` (`advise` · `propose` ·
`preauthorized`) used to decide the same question separately and never meet, so a
`preauthorized` posture could imply autonomy the envelope would deny and vice versa.
`joinAutonomy` (`work-management/hitl-join.ts`) now returns the **stricter** of the two —
neither ladder may purchase autonomy the other withholds. `advise` maps to `shadow-only`,
not `propose-for-approval`: advising is saying what should happen, not putting an action
forward to be approved.

**Verification is load-bearing.** A consequential action at the kernel floor
(`RiskClass.outbound-or-floor` — outward, financial, irreversible, access-control) is denied
by name — `missing_verification_evidence` — unless verification evidence exists on the case.
A room's posture may ADD a verification requirement to work that would not otherwise carry
one; nothing can remove the floor's. Until this landed, `verificationDepth` was compiled,
rendered as a "Deep verification" chip and written to receipts while gating nothing.

The trust level feeding this is already risk-capped before it arrives, and
`requiresCoworkerEnvelope` can demand an approved envelope either `always` or only
`when-supervised`, per the action descriptor in `action-registry.ts`. Denials come back
as named reasons from `policy-envelope.ts` — including `missing_decision_interaction`,
`missing_coworker_envelope`, and `stop_condition_tripped` — not as a generic refusal.

## What is actually enforced today

The seam is `apps/web/lib/tak/decision-routing-governance-hook.ts`. Read it before
assuming coverage, because the honest scope is narrow by design:

- **Tool coverage:** `CONSEQUENTIAL_DECISION_TOOLS` currently holds **two** tools —
  `triage_backlog_item` and `retire_backlog_item`.
- **Surface:** only `source: "agentic-loop"` (in-portal coworker and Build Studio).
  External CLI sessions are governed by the plane-1 `PreToolUse` hook instead; direct
  REST/JSON-RPC is operator traffic and out of scope.
- **Consultation window:** a `principle_decide` call clears the gate for
  `CONSULT_WINDOW_MS` — 30 minutes. The intended bypass is "consult first".
- **Mode:** `DPF_DECISION_GATE_MODE` = `enforce` (default) | `shadow` | `off`.
- **Fail-open:** any error allows. A governance guard must never wedge the loop.
- **Ledger:** the consultation map is per-process and in-memory, so it holds for a
  single-portal deployment and would need a durable store for multi-instance portals.

The gate was itself kernel-consulted (2026-07-04) and shipped deliberately narrow: the
consult recorded a genuine judgment call between enforcing narrowly and auditing in
shadow, so it does both — narrow enforcement plus a structured audit signal on every
unconsulted consequential decision.

**Do not read this seam as "consequential tool use is gated."** Two tools on one surface
are gated. The general pre-execution interceptor over all consequential tool calls — with
its four check families (alignment, authority and policy, consequence/HITL, and
precondition/ordering) — is the target architecture in the
[governance-gate spec](../superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md),
not the current state.

## The shape's next steps, after the gate

Clearing a gate advances the room; it does not finish it. The shape determines what
happens next, and each step leaves a durable record:

1. **Act or propose**, per the autonomy mode above.
2. **Receipt.** The action lands as a `ReceiptEnvelope` on the case
   (`receipt-envelope.ts`), carrying the acting identity, the policy refs consulted, and a
   `rawRef` back to the row it came from. A gate verdict is a `DecisionInteraction`
   receipt; a tool call is a tool-execution receipt.
3. **Stop conditions.** `stop-conditions.ts` decides whether the cycle continues.
   A tripped condition is itself a policy denial reason, so a room cannot quietly run past
   its own boundary.
4. **Verification**, where the shape calls for it — a verification activity on the case,
   not a claim in prose.
5. **Cycle close or carry-over.** A finite room produces its **outcome packet**
   (`outcome-packet.ts`) — decisions, artifacts, actions, receipts, evidence, plus
   explicitly unresolved work with a disposition. A standing room closes the cycle and
   carries the remainder forward (`cycle-opened`, `cycle-closed`, `cycle-carried-over` in
   the activity kinds).

The unresolved-work list is the load-bearing part of an outcome packet: a shape that ends
with silent remainders is how work escapes the room. Naming the remainder with a
disposition is what keeps the next cycle honest.

## Setting the posture, and the default for rooms

⟦runtime: shipped 2026-08-23⟧ Both write paths are operator-facing, which they were not
when the posture first shipped: `WorkroomPosture.tsx` displayed a pace and priority with
zero interactive elements and no server action behind it, while every settable control was
per-coworker.

- **Per room** — shape, pace and action boundary, inside the room's existing collapsed
  section (`WorkroomPostureControl`, actions in `lib/actions/workroom-posture.ts`). The
  shape claim REPLACES any prior entry rather than appending, because
  `readWorkroomShapeClaim` returns the first valid declaration and a stale entry would win.
- **Decreed default for rooms** — `WorkroomDefaultControl` on the priority surface, stored
  migration-free under `autonomyPolicy.workroomPostureDefault`
  (`workroom-posture-defaults.ts`).

Ladder position for the default: **above** the coworker ladder, because it is specifically
about rooms and they are not; **below** derivation, because what the work actually is
outranks a blanket preference about rooms. Both paths run the action boundary through the
tighten-only clamp, so neither control can widen authority — and the UI states that, since
an invariant the operator cannot see is one they will be surprised by.

## Known gaps

Stated plainly so nobody plans against a capability that is not there:

- **The consultation ledger is in-memory and per-process.** A decision consulted in one
  process is not visible to another; only the receipt it writes survives the turn.
- **The decision-gate stage cannot be attributed to a coworker.** The decision record does
  not identify which coworker acted, so the shape view leaves that stage empty rather than
  attributing another coworker's decision on a guess.
- **Interceptor coverage is classification-wide, enforcement-narrow.**
  `classifyConsequentialTool` runs on the governed execution path, so every governed tool
  call is classified. The workroom-shape hook
  (`lib/governance/workroom-shape-governance-hook.ts`) governs consequential calls bound to
  a room, and its computed decision mode actually decides the turn
  rather than only being recorded in the shadow verdict. The full interceptor over every
  consequential call, room-bound or not, remains the platform-wide decision gate.

Three gaps listed here previously have closed; they are recorded so a reader returning to
this page does not plan against a stale limitation:

- **Collaboration shape is a registry** ⟦runtime: 2026-08-23⟧ —
  `WORKROOM_SHAPE_KEYS` is the enum, `bindWorkroomShape` is the binding, and a room's shape
  is queryable through `readWorkroomShapeClaim`. Six shapes, not five: `craft-stewardship`
  joined the five originally specified.
- **Classification is no longer a hand-listed pair** — the legacy name-keyed list survives
  only for tools that predate the declared `ToolDefinition.consequence` axis, and a
  conformance test now asserts every name in it resolves to a real tool.
- **The shape view is rendered** — `WorkroomShapeSection` on the
  room and `CoworkerShapePanel` on the coworker record draw the same picture. The room now
  presents that picture in the default **Overview** and defers cycles, activity, evidence,
  receipts, and technical references to **Details**.

**Shape now also sets posture** ⟦runtime: added 2026-08-22⟧. The same four
axes feed the room's *posture* — how persistently the coworker follows up and how it trades
cost against quality against time — through `resolveWorkroomPosture`
(`apps/web/lib/work-management/room-posture.ts`), layered over the existing proactivity and
Golden Triangle engines. `WorkroomView.posture` carries the result and the reason for every
clamp. The load-bearing rule mirrors the two-level rule above: a derivation may TIGHTEN the
action boundary and may never widen it, so shape can restrict autonomy but never grant it.
Design: [Work Posture](../superpowers/specs/2026-08-22-workroom-work-posture-design.md).

## Related

- [Workroom vocabulary boundary](workroom-vocabulary-boundary.md) — what the word means at each layer
- [Trustworthy AI Agent Standards Family](agent-standards-family.md) — TAK, GAID, JSI and the composition rule
- [A Governance Gate on Consequential Tool Use](../superpowers/specs/2026-08-13-wwwd-constitutional-alignment-gate.md) — the target architecture
- [Work Rooms](../user-guide/workspace/work-rooms.md) — the end-user view
