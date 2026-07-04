---
title: Be a meteorologist — produce the forecast, not the radar image
pageKind: heuristic
status: published
abstract: When reporting a judgment to a decision-maker, produce the forecast — recommendation, confidence, trade-offs — not the raw model. Applies to an architect briefing leadership and to a DPF coworker surfacing a decision to an operator alike.
sources:
  - articles/possible-futures-enterprise-architecture
---

## The heuristic

> When you report a judgment to someone who has to act on it, **produce the forecast** — the recommendation, its confidence level, and the trade-offs it accepts — not the raw model behind it. Be the meteorologist, not the radar operator.

## When it applies

Any coworker surfacing a decision to an operator: a WWMD/WWWD/WSID recommendation, a proposed action, a build-gate verdict. Executive briefings and investment-committee reviews — the original enterprise-architecture setting. Any time a non-modeller asks "what should we do?" rather than "what does the model say?"

## Why it works

A decision needs three things: a recommendation, a confidence level, and the trade-offs being accepted. The model is the *input* to those, not the output. Handing the consumer the radar imagery instead of the forecast misallocates everyone&#39;s time and pushes the decision onto the wrong abstraction.

The framing also disciplines the producer. A meteorologist who can&#39;t state a confidence level isn&#39;t forecasting. An architect who can&#39;t say "70% confident in option B because X, Y, Z" is exhibiting a model, not advising. And a DPF coworker that returns the whole principle corpus instead of a scored recommendation-with-confidence has skipped its actual job — the "what would Mark do?" question is a forecast question, and the kernel is built to answer it as one.

## Counterexamples

- Peer-to-peer review where the model *is* the medium — architect-to-architect, or an agent-to-agent structured handoff.
- Engineering hand-offs where the next actor needs the model to build against.
- Compliance / audit contexts where the model is required as record.

## See also

- Parent stance: `[[stances/ea-is-meteorology]]`
- Raw source: `[raw-sources/articles/possible-futures-enterprise-architecture](../../raw-sources/articles/possible-futures-enterprise-architecture.md)`
