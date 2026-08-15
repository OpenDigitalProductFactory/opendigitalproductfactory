# Governed Value-Stream Lifecycles — Entity × ValueStream × Lifecycle × Gate × Orchestrator × Evidence

**Status:** Design candidate — architecture for `EP-VSL-GOVERN`
**Date:** 2026-08-15
**Track:** Enterprise-architecture / platform-governance design
**Primary audience:** Platform architects and operators formalizing how everything the business tracks flows through a value stream under governed, auditable gates
**Extends / binds (do NOT rebuild):**
- [2026-08-15-canonical-lifecycle-grammar-design.md](2026-08-15-canonical-lifecycle-grammar-design.md) — the Stage → in-stage State → advancement-gate grammar (`EP-VSL-SURFACE` / BI-E55991E9). **This is the common state-tracking primitive every value stream expresses its stages through.**
- [2026-06-07-unified-lifecycle-backbone-design.md](2026-06-07-unified-lifecycle-backbone-design.md) — the canonical axes + `LifecycleEvent` ledger.
- `packages/storefront-templates/src/operational-value-stream.ts` — OVSM per-archetype value streams (attract→retain).
- The principle_decide governance gate (`EP-1C37C089`) — the Policy Decision Point that adjudicates consequential transitions.
- The Work Room multi-agent substrate (`EP-WORKROOM-COMMS`) — the collaboration/coordination plane the orchestrator runs on.
- The decision audit log (BI-E286E148) + `LifecycleEvent` — the evidence spine.

---

## 1. Problem

The business tracks *many* different things — the digital products this platform embodies (IT4IT: Strategy-to-Portfolio, Requirement-to-Deploy, Request-to-Fulfil, Detect-to-Correct), the goods and services it sells, the non-digital materials it consumes (ingredients for a food business), customers, subscriptions, the tech stack it is subject to, partners, employees. Each of these **flows through a value stream**, and at each step there are **expectations** (what must be true to advance) and, for consequential steps, **gates** (a decision that must be made and evidenced).

Today these are modelled in pieces that don't reference each other:
- **Value streams** exist as OVSM per-archetype (`operational-value-stream.ts`) and as the IT4IT-aligned backbone stages (`lifecycle.ts`), but the other streams the business runs — **source-to-pay**, **order-to-cash**, **recurring processes** — are not formalized in one shape.
- **Lifecycle position** now has a common primitive — the canonical grammar (Stage + in-stage State + advancement gate) delivered under EP-VSL-SURFACE — but nothing yet says *"this value stream's stages ARE this grammar."*
- **Gates** exist (principle_decide as a Policy Decision Point, EP-1C37C089), but they are invoked ad hoc on tool use, **not bound to specific lifecycle transitions** of specific value streams. "When do we gate?" is answered case by case rather than declared.
- **Orchestration** — who drives an entity through its stream — is implicit. There is no declared default orchestrator (the COO) per subject/value-stream.
- **Evidence** — `LifecycleEvent` and decision records exist, but they are not rolled into **audit-grade value-stream views** that serve internal improvement (measure the flow, find the bottleneck) *and* external regulatory attestation (a defensible trail of who decided what, on what evidence, at each gate).

The result: the same governance idea — "an entity advances through stages, gated where it matters, leaving evidence" — is re-implemented per feature, and the *expectations and gates are not visible* as a design surface. The owner's requirement is a **strong architecture that keeps design grounded, makes expectations and gates visible, and produces audit-grade evidence** — one pattern every subject follows.

## 2. The architecture — six planes bound by one contract

Everything the business tracks is an **Entity** flowing through a **Value Stream**; its position is a **Lifecycle** point (Stage + State) in the canonical grammar; transitions are **Gated** by principle_decide against declared criteria; an **Orchestrator** (default: the COO, specialised per subject/value-stream) drives the flow; and every gate firing emits **Evidence** that rolls into an audit trail.

The binding is a single declarative contract, `ValueStreamDefinition`:

```ts
export type ValueStreamDefinition = {
  key: string;                         // e.g. "recurring-process", "source-to-pay", "order-to-cash"
  label: string;
  /** The entity kind(s) that flow through this stream (register in LIFECYCLE_GRAMMAR_KINDS terms). */
  entityKinds: readonly string[];
  /** The stream's stages+states — a LifecycleGrammar (the common tracker). */
  grammar: LifecycleGrammar;
  /** Per-transition governance: WHEN we gate, on what criteria, collecting what evidence. */
  transitions: readonly {
    from: string;                      // stage key
    to: string;                        // stage key
    gate?: {
      /** principle_decide dimensions/criteria to evaluate at this transition. */
      criteria: readonly string[];
      /** Decision profile / altitude (WWMD / WWWD / WSID) the gate runs at. */
      decisionProfile: string;
      /** Evidence the gate must collect to be satisfiable + auditable. */
      evidenceRequired: readonly string[];
    };
  }[];
  /** Default orchestrator role that drives entities through this stream. */
  defaultOrchestrator: string;         // e.g. "coo", or a stream specialist role key
  /** How instances are coordinated at runtime (see §5). */
  coordination: "work-room" | "queue" | "inline";
};
```

One artifact answers all three owner goals: it **grounds design** (every stream declared identically), **makes expectations + gates visible** (stages and gate criteria are readable, not buried in code), and **formalizes the gate** (transition → principle_decide criteria → required evidence).

### 2.1 The planes

| Plane | Role | Bound substrate |
|---|---|---|
| **Entity** | the subject that flows | `DigitalProduct`, business goods/services, `CustomerAccount`, `Subscription`, `InventoryEntity` (materials/ingredients), tech-stack components, partners, employees — classified into a stream via `entityKinds` |
| **Value stream** | the flow | OVSM + IT4IT + the new `ValueStreamDefinition`s (source-to-pay, order-to-cash, recurring processes) |
| **Lifecycle** | where the entity is (common tracker) | the canonical grammar + `LifecycleEvent` (EP-VSL-SURFACE) — every stream's `grammar` field |
| **Gate** | when/whether it may advance | principle_decide PDP (EP-1C37C089), bound per `transitions[].gate` |
| **Orchestrator** | who drives it | coworker role model; default **COO**, specialised per subject/value-stream; runs on Work Rooms (§5) |
| **Evidence** | proof | `LifecycleEvent` (stage+state axis) + decision audit records → audit rollups (§6) |

## 3. Value streams in scope

- **Already surfaced** (EP-VSL-SURFACE): customer relationship (OVSM), the digital-product/backbone (IT4IT), tech-stack currency. These are re-expressed as `ValueStreamDefinition`s so they share the gate + orchestrator + evidence machinery.
- **First new stream (this epic): recurring processes.** Subscription/renewal and other recurring cycles (renew → invoice → dunning → retain/churn), building on the retain instrumentation shipped under BI-A72D29BE. Recurring processes are **coordinated via Work Rooms** (see §5).
- **Named for follow-on**: source-to-pay (procure-to-pay for vendors/materials incl. ingredients), order-to-cash (quote→order→fulfil→invoice→collect). Declared in the same shape when built.
- **Per-archetype OVSM formalization**: lift the simple per-archetype value-stream definitions into the same `ValueStreamDefinition` shape so every archetype's stream is uniformly gate-able and audit-able.

## 4. Gates — formalizing *when* we gate

The recent governance work (EP-1C37C089, principle_decide as PDP) settled *how* to gate a consequential action. This architecture settles *when*: a gate is bound to a **specific lifecycle transition of a specific value stream**. Advancement `from → to` is legal only when:
1. the entity is in an exit-ready state of `from` (the canonical grammar's `canAdvance`), AND
2. if the transition declares a `gate`, principle_decide returns an allow (or an amend) against the declared `criteria`, with the `evidenceRequired` present.

The gate outcome (allow / amend / veto) and its evidence are written as one `LifecycleEvent` (carrying the stage+state axis) plus a decision audit record. This makes the gate **visible** (declared in the definition), **enforceable** (checked at the transition), and **auditable** (evidenced).

## 5. Orchestration — the COO on Work Rooms

The **default orchestrator is the COO** coworker; a value stream may name a specialist (e.g. a procurement lead for source-to-pay, a customer-success lead for retain). The orchestrator is accountable for driving entities through the stream and invoking each transition's gate.

**Recurring processes coordinate through Work Rooms** (EP-WORKROOM-COMMS): a recurring-process instance runs in its own work room (a `WorkCase`) with the orchestrator as Coordinator; participants (agents + humans) join outcome-scoped; each stage transition and its gate happen in-room, so the room *is* the coordination and evidence surface. **Sub-processes spawn child work rooms** — a step that fans out into a sub-outcome opens a child room, forming interactive, process-coordinated outcomes that roll their result back to the parent. `coordination: "work-room"` on the definition declares this; other streams may use `"queue"` (scarce-resource queue substrate) or `"inline"`.

### 5.1 Triggers — a gated transition IS the trigger; the proactivity dial decides auto-vs-surface

The orchestrator does not need a new proactivity engine — it **binds to the one that exists**. The load-bearing insight: an entity reaching an **exit-ready state** (or going **overdue**) at a gated transition is a *detectable need*. What happens next is governed by the existing per-coworker proactivity dial — `ProactivityLevel` (quiet · balanced · assertive) × `ActionBoundary` (`advise` · `propose` · `preauthorized`), resolved into a `ProactivityPlan` + delegated posture (`lib/proactivity/*`), tunable at `/coworker-decisions/proactivity`:
- **`preauthorized`** → the orchestrator auto-fires the gate (principle_decide), advances the stream, and writes the evidence — autonomous.
- **`propose`** → surfaces an attention item with a one-click advance for the operator.
- **`advise`** → surfaced for visibility only.

The four trigger sources, each mapped to substrate that already exists (bind, do not rebuild):

| Trigger | Substrate | Binding |
|---|---|---|
| **Time** | `ScheduledAgentTask` + the `*/5` Inngest cron → `executeScheduledAgentTask` → `createAutonomousWorkRun({trigger:"scheduled"})` (the only path that auto-spawns agent work today) | a recurring-process instance ticks on a schedule (renewal/dunning cycle checks) |
| **User request** | `POST /api/v1/agent/message` (user→coworker) + `summon_coworker`/`request_coworker` | the operator asks the COO to open or advance a stream |
| **Incoming message** | `ingestWorkRoomChannelEvent` appends an external message to a Work Room by channel binding — **wired substrate with no HTTP caller today** (live inbound email only persists + hands to the marketing responder) | a customer reply during a cycle routes into that instance's room — **requires wiring the inbound→room transport (a named gap)** |
| **Detected need** | pull-based **attention sources** (`lib/attention/sources/*`, ~18) surfaced on inbox/cockpit load; **no central act-loop** — detection queues for a human except via the scheduled cron | add a **value-stream attention source** that detects due/overdue gated transitions, governed by the `actionBoundary` above |

### 5.2 Visibility — current-state board, the room, the "needs you" inbox

Three surfaces make a value stream and its position visible, reusing existing homes:
- **Current-state board** (the primary gap). Today value streams render only as a static EA **diagram** (`/ea/value-streams` → `/ea/views/[id]` chevron canvas) with no work-in-stage counts, and **no page reads `LifecycleEvent`/`getLifecycleSummary` for an estate-wide current-state view** (the only `LifecycleEvent` UI is a per-employee timeline). The board reads `getLifecycleSummary(grammarKey)` — count-by-stage AND state-within-stage (on-track/blocked/ready) — turning the diagram into a live operations board.
- **The Work Room** is the per-instance surface (participants, transitions, gate decisions, messages) — reached today only via the my-queue lens / portal cases / deep link; a **rooms/instances index** makes an instance discoverable.
- **The "needs you" inbox** (`/workspace/inbox` + `OperatorCockpit`) is where `propose`/`advise` gate items land as attention items, alongside the ~18 existing sources.

## 6. Evidence & audit — internal improvement + external regulatory

Every gate firing and every stage/state transition appends to the evidence spine (`LifecycleEvent` + decision audit record). Two rollups consume it:
- **Internal improvement**: per-stream flow metrics — count-by-stage, state-within-stage (on-track/blocked/ready), cycle time, gate pass/veto rates, bottleneck detection — surfaced through the §5.2 current-state board off `getLifecycleSummary`. This finally *measures* the value streams that today are "drawn but not measured."
- **External regulatory attestation**: a defensible, replayable trail — for any entity, the sequence of transitions, who/what decided each gate, on what criteria and evidence, at what altitude. The `ValueStreamDefinition` doubles as the control catalogue an auditor reads: here are the gates, here is the evidence each requires.

## 7. Non-goals

- Not replacing OVSM, IT4IT, the grammar, the principle_decide gate, the room substrate, or the coworker model — this **binds** them.
- Not a new decision engine — principle_decide remains the PDP.
- Not a workflow-builder UI in this epic — the definitions are code-declared contracts first; operator-facing authoring is later.

## 8. Decomposition (BIs)

1. **`ValueStreamDefinition` contract + registry** (foundational): the type, a registry mirroring `LIFECYCLE_GRAMMARS`, `validateValueStream` (every stage in the grammar; every gated transition names criteria + evidence; orchestrator role resolves), and re-expression of the already-surfaced streams (customer/OVSM, backbone/IT4IT, tech-currency) as definitions.
2. **Transition→gate binding + value-stream attention source**: wire `transitions[].gate` to principle_decide at the recordLifecycleTransition seam, writing the gate decision + evidence to the ledger; add a value-stream **attention source** (`lib/attention/sources/*`) that detects due/overdue gated transitions and, governed by the proactivity `actionBoundary`, auto-fires (`preauthorized`), proposes (one-click attention item), or advises (§5.1).
3. **Recurring-process value stream on Work Rooms**: the first concrete stream — renewal/dunning/retain cycle, orchestrated by the COO in a work room, ticked by a `ScheduledAgentTask`, with child-room spawning for sub-processes **and wiring the inbound-message→room transport** (`ingestWorkRoomChannelEvent`, currently caller-less) so an incoming message routes into the instance's room (§5.1).
4. **COO orchestrator binding**: resolve `defaultOrchestrator` to the COO coworker (or a specialist) and give it the drive-the-stream capability across all four triggers.
5. **Current-state board + audit rollups**: the §5.2 live current-state board reading `getLifecycleSummary` (count-by-stage + state-within-stage — the primary visibility gap), plus a rooms/instances index, per-stream flow metrics (internal), and the regulatory attestation view (external) off the evidence spine.
6. **Follow-on streams**: source-to-pay, order-to-cash, per-archetype OVSM formalization — each a definition.

## Backlog Coverage

Decomposed — see §8. The `ValueStreamDefinition` contract (BI 1) is the foundation the others bind to; the recurring-process stream (BI 3) is the first end-to-end proof (entity → stream → grammar → gate → COO-on-work-room → evidence). Each subsequent stream is an independently shippable definition on the same contract.
