---
title: Every non-text element needs a text alternative
pageKind: principle
status: published
abstract: Images and other non-text content need a concise text alternative so assistive technology can convey them. The alt attribute is mandatory; use empty alt only for decorative images.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Give every meaningful non-text element a concise text alternative; use alt="" only for purely decorative images.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 0.9, "public_safety": 0.4}
professionCompetencyLevel: foundational
sources:
  - mdn/img
  - mdn/accessibility
---

## Rule

Every meaningful non-text element needs a **text alternative**. For images the `alt` attribute is **mandatory** — it is a concise text replacement for the image's content that screen readers read aloud. Video, audio, and other media likewise need proper textual alternatives.

## Why

Assistive technology cannot perceive pixels — it relies on the text alternative to convey what a sighted user sees. MDN is explicit that `alt` is "mandatory and incredibly useful for accessibility." A missing or wrong alt makes the content invisible to non-visual users; this is one of the most common and most easily-avoided WCAG failures.

## How To Apply

1. **Describe the content/function, concisely.** For an action image, describe the action — `alt="next page"`, not `alt="arrow right"` or `alt="image"`.
2. **Decorative? Empty alt.** Use `alt=""` for purely decorative images and tracking pixels so assistive tech skips them — omitting `alt` entirely is not the same.
3. **Media needs alternatives too** — captions, transcripts, descriptions.
4. This satisfies the Perceivable principle of [[professions/frontend-engineer/wcag-four-principles-aa-conformance]].

## See Also

- [[professions/frontend-engineer/wcag-four-principles-aa-conformance]]
- [[professions/frontend-engineer/semantic-html-first]]
