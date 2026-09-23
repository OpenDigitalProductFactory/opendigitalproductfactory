---
status: draft
---

# Plan — Quality by Process, Not by Floor

**Design:** [2026-09-18-quality-by-process-not-by-floor-design.md](../specs/2026-09-18-quality-by-process-not-by-floor-design.md)
**Epic:** EP-4DC5A9B2
**Branch base:** `main`

## Backlog coverage

| Item | Scope | Spec | State |
|---|---|---|---|
| BI-1A5204A0 | Routing confidence becomes an activation input | §1 | landed |
| BI-A08285BC | A below-floor run is an attributable event | §4 | partial — structural, not yet persisted |
| BI-0FC71985 | Grade and record reviewer independence | §3 | open |
| BI-A8EAC294 | Register `multi-pass` as a pattern | §2 | open |
| BI-2A67FAE2 | Cap escalation cost on the Golden Triangle dial | §5 | open |

Every spec section maps to an item; no item is spec-less.

---

## Sequencing

The wire first, because it is the whole defect and it is small. Everything after
it either refines what escalates (§3, §5) or adds a new thing to escalate *to*
(§2).

### Phase 1 — BI-1A5204A0 + BI-A08285BC (structural) · The wire

`qualityFloorRelaxed` was set, threaded up, and concatenated into a sentence
nothing read. Phase 1 makes it readable and makes something read it.

1. `routing-confidence.ts` — the signal, the risk mapping, and the operator-facing
   reason. Mapped onto the **risk** axis rather than widening the closed
   `DeliberationTriggerSource` set, which is both the smaller change and the
   honest one: low routing confidence is a risk statement about the output.
2. `activation.ts` takes the higher of declared risk and confidence risk, so the
   existing strengthen-but-not-weaken rule does the work unchanged.
3. `RouteDecision.routingConfidence` carries it structurally, for the same reason
   `preferenceResolution` is structural — behaviour must not depend on parsing
   prose.

**Guards:** a confident route is byte-identical to no signal at all; a declared
critical risk can never be lowered; an escalation the confidence axis did not
cause is not claimed.

### Phase 2 — BI-2A67FAE2 · Bound the cost

Before adding passes, bound them. One escalation step per turn, `multi-pass` N at
most 3, and an `economy` posture does not escalate at all. Doing this before §2
means the new pattern is born inside a budget rather than having one retrofitted.

### Phase 3 — BI-0FC71985 · Grade independence

Take the strongest available diversity mode and record which one was used, so a
same-model review during an outage cannot read like heterogeneous review. Cheap,
and it makes the §2 results interpretable.

### Phase 4 — BI-A8EAC294 · `multi-pass`

The largest piece: N runs, reconciliation through the existing `majority-vote` /
`synthesis` modes, and divergence surfaced rather than averaged away. Ranked
*below* `review` in strength — a second sample is a weaker instrument than an
independent critic and must never displace one.

### Phase 5 — BI-A08285BC (persistence) · The event

Promote the signal from structural to countable, so "how often did we run below
the floor last week, and why" is answerable. Deliberately last: the column it
needs sits on `RouteDecisionLog`, which is also being extended by BI-B4081AA1 on
another branch. Landing both at once would collide for no benefit.

---

## Risks

**Escalation is real spend.** Every activation costs a model call and latency.
Phase 2 exists to bound it before Phase 4 makes it bigger, and the `economy`
posture must remain a genuine opt-out rather than a discount.

**A degraded reviewer is weak scrutiny.** During a full drain the author and the
reviewer are the same local model. §3 says run it anyway and grade it honestly;
whether that is worth the latency in an interactive turn is a measurement we do
not have. Phase 4's agreement rate under degradation is what would answer it, and
until then the honest position is that this catches carelessness, not bias.

**The trigger could fire constantly on a small install.** An install with one
model ranks one candidate on every call, so `candidateCount <= 1` would escalate
everything. This is the sharpest open risk in the design. Phase 2's budget caps
the blast radius, but if the event stream from Phase 5 shows constant escalation
on single-model installs, the rule needs a floor — escalate on *unexpected*
scarcity, not on an install that only ever had one model.

---

## Not in scope

Upgrade-window routing — holding cloud endpoints eligible through a self-upgrade
drain — is the design's open question 2. Four drains blocked writes during the
session that produced this plan, and the one observed quality collapse happened
inside such a window. If Phase 5's events show below-floor runs clustering there,
that is the better fix and it deserves its own design rather than being absorbed
here.
