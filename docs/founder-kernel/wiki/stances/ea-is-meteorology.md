---
title: Deliver forecasts, not raw models
pageKind: stance
status: published
abstract: The deliverable to a decision-maker is a forecast — a recommendation, a confidence level, and the trade-offs being accepted — not the raw model behind it. This began as a stance about enterprise architects reporting to leadership; in DPF it is how every coworker reports to an operator, and it is the founding shape of the decision-governance surface itself.
sources:
  - articles/possible-futures-enterprise-architecture
---

## The position

Anyone who holds a model on someone else&#39;s behalf — an enterprise architect, a data team, or a DPF coworker — should be a **judgment surface on top of the model, not the model exhibit**. Function like a meteorologist: collect the inputs, run the model internally, and produce a **forecast** that drives the decision. The deliverable is the recommendation, the confidence, and the trade-offs — not the diagram.

I first made this argument about enterprise architecture: most IT organisations have little to no business architecture in play, which makes technology investment impossible to trace to business outcomes. The fix was never more diagrams — it was a *guidance layer* on top of whatever model you already have. That conviction is why DPF exists in the shape it does.

## Why

Showing a decision-maker the raw model is showing them the radar imagery instead of the weather forecast. They aren&#39;t radar specialists — they are deciding whether to invest, retire, consolidate, hire, or wait. A weather forecast has four properties, and a good decision output should have all four:

- It uses a model the consumer doesn&#39;t have to see.
- It states its confidence explicitly.
- It updates as conditions change.
- It is useful even when it turns out wrong, because it made the unknowns legible.

This is the founding shape of DPF&#39;s decision governance, not a metaphor bolted on afterward. "What would Mark do?" (WWMD), "what would *we* do?" (WWWD), and "what would someone in this role do?" (WSID) are all **forecast questions**. When a coworker faces a call, the platform surfaces a recommendation with its confidence and the principles that pulled for and against it — the kernel as a forecast engine — rather than handing the operator the raw principle corpus to reason out. An architect who can&#39;t say "I&#39;m 70% confident option B is right, because of X, Y, Z" isn&#39;t forecasting; a coworker that dumps the model instead of the call has made the same mistake.

## When this applies

- Any point where a coworker reports a judgment to an operator — the WWMD/WWWD/WSID decision surfaces, a recommended action, a build gate.
- Executive-level reviews and investment decisions — the original enterprise-architecture setting.
- Any time someone who isn&#39;t a modeller asks "what should we do?" rather than "what does the model say?"

## When it doesn&#39;t

- Peer-to-peer review where the model *is* the medium — two architects, or two agents exchanging a structured handoff, need the model itself.
- Compliance / audit contexts that require the model on record.
- Engineering hand-off where the next team (or the next agent) needs the model to build against.

## Heuristics derived from this stance

- `[[heuristics/be-a-meteorologist]]` — the operational rule.

## See also

- Substrate: `[[entities/it4it]]` provides the model; this stance is about how to deliver from it.
- Raw source: `[raw-sources/articles/possible-futures-enterprise-architecture](../../raw-sources/articles/possible-futures-enterprise-architecture.md)`
