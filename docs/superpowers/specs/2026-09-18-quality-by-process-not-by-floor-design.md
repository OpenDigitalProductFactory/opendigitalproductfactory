---
status: draft
---

# Quality by Process, Not by Floor

**Date:** 2026-09-18
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)

**Extends:** [Deliberation Pattern Framework](2026-04-21-deliberation-pattern-framework-design.md) §7 (activation policy). That spec owns the pattern registry, the execution engine and the visualization surface; all of it stands. This adds one activation axis it already anticipated — goal 87, "risk-based escalation" — and one pattern it already left room for — goal 97, "multi-pass verification".

**Companion:** [Situational LLM Call Parameterization](2026-09-18-situational-llm-call-parameterization-design.md). That design makes each individual call as good as it can be. This one accepts that individual calls vary anyway, and puts the recovery in process. Neither substitutes for the other.

---

## Problem Statement

Routing decides quality **once, in advance, by prediction**: a model's dimension scores are compared against a floor derived from the contract, and the winner is whatever ranks best. Two things are wrong with that as the platform's quality mechanism.

**A predicted floor cannot see the actual answer.** Model quality varies run to run, on frontier models as much as on local ones. A capability score is a prior about a model, not a measurement of the output in front of the user. No floor, however well calibrated, changes that.

**And when the floor is missed, nothing happens.** The floor is already a *soft* exclusion (BI-16A1B4A3): when no endpoint clears it, routing relaxes it, runs anyway, and sets `qualityFloorRelaxed`. Tracing that flag through the tree:

```
pipeline-v2.ts:281   let qualityFloorRelaxed = false;
pipeline-v2.ts:334   qualityFloorRelaxed = true;
pipeline-v2.ts:422   return { ..., qualityFloorRelaxed };
pipeline-v2.ts:766   const degradedReason = hardResult.qualityFloorRelaxed ? " No endpoint met…" : "";
pipeline-v2.ts:774   `${ranked.length} candidate(s) ranked.${preferenceReason}${degradedReason}`
```

It is set, threaded up, and concatenated into a sentence. **Nothing reads it.** The platform knows it is about to produce lower-confidence work and does nothing differently.

Observed live on 2026-09-18: during a five-minute self-upgrade drain, every routed phase fell to a local 27B with `8 endpoint(s) excluded; 1 candidate(s) ranked` and the relaxed-floor sentence in the rationale. Normal work continued at materially lower confidence, through a routine and recurring event, with no compensation and no signal beyond a string nobody reads.

### What already exists

Almost all of it, which is why this design is small.

- **Patterns and an engine.** `review` and `debate` are registered patterns with a full execution engine (`lib/deliberation/` — orchestrator, branch-execution, consensus, synthesizer, evidence) plus a fast inline path for interactive turns (`golden-triangle/coworker-review.ts` → `tak/coworker-inline-review.ts`).
- **An activation policy with the right shape.** `deliberation/activation.ts` resolves in the order: explicit invocation → **risk escalation** (high/critical → debate, medium → review) → stage default → none. It carries a *strengthen-but-not-weaken* rule and a strength ordering (`debate` > `review`), so any new input can only ever add scrutiny.
- **A vocabulary that already names the answer.** `DELIBERATION_DIVERSITY_MODES` = `single-model-multi-persona | multi-model-same-provider | multi-provider-heterogeneous`. `DELIBERATION_STRATEGY_PROFILES` = `economy | balanced | high-assurance | document-authority`. `DELIBERATION_ADJUDICATION_MODES` includes `majority-vote`.
- **An independent reviewer.** The inline reviewer calls `routeAndCall` with `modelTier: "robust"` and *deliberately no `agentId`*, so it does not inherit the author's configuration.

The gap is a wire, not a mechanism: **routing's confidence in its own answer is not an input to activation.**

---

## Goals

1. Make degraded routing confidence a first-class activation trigger, so process compensates where prediction failed.
2. Add multi-pass verification as a registered pattern, so "run it twice or three times and reconcile" is a named platform capability rather than an ad hoc human habit.
3. Keep the reviewer independent of the author, and be explicit about how much independence a given situation can actually buy.
4. Make a below-floor run visible and attributable, not a sentence in a rationale string.
5. Spend more only where the work warrants it — the extra passes are a real cost and belong on an existing dial.

## Non-Goals

1. Replacing the quality floor. It stays as a *signal*; this design demotes it from the platform's only quality mechanism, not from existing.
2. Replacing governance gates. This is a pre-gate quality layer, exactly as the framework spec states.
3. Changing the pattern execution engine, the registry, or the visualization surface.
4. Changing model *selection*. Ranking is unchanged.

---

## Section 1 — Routing confidence becomes an activation input

`activation.ts` gains one axis alongside risk and stage: **the confidence routing has in the endpoint it chose.**

```typescript
export interface RoutingConfidenceSignal {
  /** The floor was relaxed because nothing cleared it. */
  qualityFloorRelaxed: boolean;
  /** How far the winner sits below the floor it did not meet (0 = at floor). */
  floorShortfall: number;
  /** The winner was reached by fallback, not by ranking (outage, capacity, fence). */
  fallbackUsed: boolean;
  /** Ranked candidates. One means there was no choice, only an outcome. */
  candidateCount: number;
}
```

It maps to the same `DeliberationActivatedRiskLevel` the policy already consumes, so it composes through the existing strengthen-but-not-weaken rule and cannot weaken anything:

| Signal | Effective risk contribution |
|---|---|
| floor relaxed, small shortfall | `medium` → `review` |
| floor relaxed, large shortfall | `high` → `debate` |
| only one candidate ranked | `medium` — no choice was made, so verify the outcome |
| fallback used after an outage | `medium` |
| floor met, multiple candidates | none — unchanged behaviour |

**This is the whole fix for the observed incident.** During the upgrade drain the platform would have run the same local model, then reviewed its own output before using it, instead of shipping a below-floor answer silently.

### Why this is the right lever

The floor is a prediction about a *model*. Deliberation is a measurement of an *output*. When the prediction says "this will probably be weak", the correct response is to look at what actually came out — which is what a reviewer does. Escalating on low confidence spends effort where the prediction is least trustworthy, which is precisely where a static floor has nothing left to offer.

---

## Section 2 — `multi-pass` as a registered pattern

`review` improves a draft. `debate` stress-tests it. Neither addresses **run-to-run variance on a single model**, which is the failure mode when the same prompt to the same frontier model produces a good answer and then a careless one.

Register `multi-pass`: run the same request N times (N=2 or 3, defaulting to 2), reconcile with the existing `majority-vote` or `synthesis` adjudication mode, and surface disagreement rather than hiding it. Strength ordering places it between the existing two:

```
multi-pass (1) < review (2) < debate (3)
```

— because a second sample is a weaker instrument than an independent critic, and should never displace one.

**Agreement is itself a quality signal.** Two passes that agree are evidence the answer is stable; two that diverge are evidence it is not, and that divergence is worth showing the operator. This is the cheapest honest confidence measure available, and the only one that works when there is exactly one model to ask.

---

## Section 3 — Independence, and being honest about it

A reviewer sampled from the same degraded model as the author is weak scrutiny. The diversity vocabulary already grades this, so the design states which mode a situation can actually buy rather than pretending all review is equal:

| Situation | Diversity mode | What it is worth |
|---|---|---|
| Multiple healthy providers | `multi-provider-heterogeneous` | Genuine independence — different training, different failure modes |
| One provider, several models | `multi-model-same-provider` | Partial — correlated failure modes remain |
| One local model (the drain case) | `single-model-multi-persona` | Weakest, and still worth running — catches careless errors and instability, not systematic bias |

The rule: **take the strongest mode available, and record which one was used.** A `single-model-multi-persona` review during an outage is not equivalent to heterogeneous review, and the receipt must not let those read the same. The inline reviewer already avoids inheriting the author's config (no `agentId`); this extends that to a stated, recorded independence grade — and `modelTier: "robust"` becomes "better than whatever produced the draft" rather than a fixed rung.

---

## Section 4 — A below-floor run is an event

`qualityFloorRelaxed` stops being a substring. It becomes:

1. a field on the route decision, already carried structurally rather than in prose;
2. an input to activation (§1);
3. an attributable, countable event — so "how often did we run below the floor last week, and why" is answerable.

The last one matters most for the observed case. Every self-upgrade drains the portal; if below-floor runs cluster there, that is an operational finding about upgrade windows, not a routing finding — and today nothing could tell you that, because the only trace was a sentence in a rationale.

This is the [local-fallback-eligibility-invariant](2026-08-26-local-fallback-eligibility-invariant-design.md) `OBJ-VISIBLE-DEGRADE` objective — "a degraded posture leaves a trace" — applied to the quality floor.

---

## Section 5 — Paying for it

Extra passes cost money and latency, so they belong on a dial the platform already has: the Golden Triangle Cost/Quality/Time posture, which is what emits `deliberationPattern` today.

**This is where `budgetClass` genuinely belongs.** The companion parameterization design removes budget class from temperature, because how much we will *spend* says nothing about how much we will *vary*. It says a great deal about how many passes we will run. `economy` accepts a degraded answer with a note; `high-assurance` escalates. Same signal, honest lever.

Escalation is capped: at most one escalation step per turn, and `multi-pass` N never exceeds 3. A degraded turn must not become an unbounded spend.

---

## Research & Benchmarking

Per AGENTS.md §7. The framework spec's §4 covers multi-agent council patterns; this section covers only what is new here — escalating on *measured low confidence*.

**Model cascades (FrugalGPT and its successors)** — run a cheap model first, score confidence, escalate to a stronger model only when confidence is low. *Adopt:* the core claim, that confidence should be evaluated after generation rather than predicted before it, and that escalation should be selective. *Reject:* cascade-by-default. DPF's ranking already picks the best available endpoint, so the cheap-first premise does not apply; our escalation trigger is a floor we could not meet, not a cost tier we chose.

**Self-consistency sampling** — sample a reasoning task several times and take the majority answer; the standard finding is that agreement across samples correlates with correctness. *Adopt:* directly, as §2's `multi-pass` with `majority-vote`. *Note the limit honestly:* it works best where answers are comparable (a value, a classification, a decision) and degrades for long free-form prose, where "majority" is ill-defined. `synthesis` adjudication, which the registry already has, is the right mode there.

**LLM-as-judge** — a separate model scores or critiques an output. *Adopt:* already adopted as `review`. *Reject as a gate:* a judge is itself a model with variance, so its verdict escalates or improves work, never authorizes it — which is exactly the framework spec's "internal quality layer before existing gates, not a replacement for approval". Known bias toward verbosity and toward its own outputs is the reason §3 grades independence rather than assuming it.

**What DPF does that these do not.** All three assume a healthy pool and choose to spend more for quality. DPF's sharpest case is the opposite: a *shrunken* pool, where the platform is forced below its floor and has one model left. None of the comparators address compensating for degradation you did not choose. §1's trigger and §3's honest independence grading are the response, and they are only possible because routing already knows it was cornered — it simply never told anyone.

---

## Testing Strategy

- `activation.routing-confidence.test.ts` — a relaxed floor yields review; a large shortfall yields debate; a single candidate escalates; a met floor changes nothing (the byte-identical guard); strengthen-but-not-weaken holds when the confidence axis would *lower* a stage or risk default.
- `multi-pass.test.ts` — N passes run; `majority-vote` reconciles comparable answers; divergence is surfaced, not averaged away; N is capped at 3.
- `independence-grade.test.ts` — the strongest available diversity mode is chosen and recorded; a single-model install records `single-model-multi-persona` and never claims heterogeneity.
- `quality-floor-event.test.ts` — a below-floor run emits an attributable event; the prose rationale is no longer the only trace.
- Escalation-cost test — one escalation step per turn maximum; `economy` posture does not escalate.
- **Regression guard for the observed incident:** a route resolving with one candidate and a relaxed floor activates a pattern. That is the case that ran silently on 2026-09-18.

---

## Open Questions

1. **Does a degraded *reviewer* mean anything?** During a full drain, both author and reviewer are the same local model. §3 says run it anyway and grade it honestly. Whether that is worth the latency in an interactive turn is a measurement we do not have yet — the `multi-pass` agreement rate under degradation would answer it.
2. **Should sustained below-floor operation stop being a per-turn concern?** If §4's events show below-floor runs clustering in upgrade windows, the real fix may be upgrade-window routing (hold cloud endpoints eligible through the drain), not per-turn escalation. That is an operational design, and this spec's event stream is what would justify opening it.
