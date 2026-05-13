---
title: EA is meteorology — provide forecasts, not raw models
pageKind: stance
status: published
abstract: Architects should be like meteorologists — produce forecasts and recommended actions, not exposed models. The deliverable to leadership is the guidance, not the diagram.
sources:
  - articles/possible-futures-enterprise-architecture
---

## The position

Enterprise Architecture&#39;s job is to be a **judgment surface on top of the models**, not the model exhibit. Architects should function like meteorologists: collect the inputs, run the models internally, and produce a forecast that drives the decision. The deliverable to leadership is the recommendation, not the diagram.

Most IT organisations have little to no business architecture in play, effectively making most current and future technology investment impossible to trace to business outcomes. The fix for that isn&#39;t more diagrams — it&#39;s a *guidance layer* on top of whatever model you have.

## Why

Showing leadership the raw architecture model is showing them the radar imagery instead of the weather forecast. They are not radar specialists. They are decision-makers. They need to know whether to invest, retire, consolidate, hire, or wait — not which functional component sits behind which API in the application portfolio.

The meteorology analogy carries further. Weather forecasts:

- Use a model the consumer doesn&#39;t see.
- State confidence levels explicitly.
- Update as conditions change.
- Are useful even when they&#39;re wrong, because they made the unknowns legible.

EA should produce outputs with the same properties.

This is also the philosophical frame behind DPF&#39;s wiki kernel. The platform exists to be the guidance layer, not the model exhibit — "what would Mark do?" is a forecast question, not a diagram question.

## When this applies

- Executive-level architecture reviews.
- Investment decisions on portfolios or platforms.
- Any time an architect is asked to "show the model" by someone who isn&#39;t an architect.

## When it doesn&#39;t

- Peer-to-peer architecture discussions where the model *is* the medium.
- Compliance / audit contexts that require the model on record.
- Engineering hand-off where the next team needs the model to build against.

## Heuristics derived from this stance

- `[[heuristics/be-a-meteorologist]]`

## See also

- Parent context: `[[entities/it4it]]` provides the substrate; this stance is about how to deploy the substrate to leadership.
- Raw source: `[raw-sources/articles/possible-futures-enterprise-architecture](../../raw-sources/articles/possible-futures-enterprise-architecture.md)`
