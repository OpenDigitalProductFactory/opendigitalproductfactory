---
title: Pitch simple, adjust per audience
pageKind: heuristic
status: published
abstract: Lead with the simplest framing the audience can ingest, and adjust language per audience — never lead with the model itself. Originally a framework-evangelism tactic; in DPF it is how a coworker frames a recommendation for the operator in front of it.
sources:
  - articles/open-group-2017-managing-business-of-it
  - articles/briefings-direct-it4it-2019
---

## The heuristic

> When explaining anything built on a model — a framework, an architecture, a recommendation — **lead with the simplest framing the specific audience can ingest** and adjust per audience. Never lead with the model.

## When it applies

- **A DPF coworker reporting to an operator.** The same call — "retire this product," "consolidate these two" — should be framed for its reader: an outcome for a founder, a trade-off for an operator, a mechanism for an engineer. This is the operational partner of `[[stances/ea-is-meteorology]]`: deliver the forecast, and phrase the forecast for whoever receives it.
- **Introducing a standard or framework** (`[[entities/it4it]]`, TOGAF, `[[entities/csdm]]`) to a new audience — the original setting for this rule.
- Executive briefings, board-level investment conversations, and cross-functional alignment meetings where the audience is mixed.

## Why it works

Anything built on a model has layers. The audience doesn&#39;t need the whole stack on first contact — they need the entry point that lets them place it in their existing mental model. Once it&#39;s placed, depth follows naturally as questions surface.

The original evangelism example makes the mechanic concrete: *"I pitch IT4IT as a framework for managing IT and leave it at that. I might also say it&#39;s an operating model."* For executives at commercial enterprises, "framework for managing IT" or "operating model" works. For federal CIOs, connect to FITARA and FEA — those are the words that map onto the framework they&#39;re already operating in. For architects in a TOGAF-fluent org, lead with reference architecture; the value-stream layer follows.

The same discipline governs a coworker&#39;s output. A coworker that dumps its full reasoning chain on every operator has led with the model. Lead with the call and the one framing that operator can act on; keep the model one click away for whoever asks.

The corollary: **don&#39;t evangelise depth the audience didn&#39;t ask for**. If they engage, they&#39;ll ask. If they don&#39;t, more detail won&#39;t change their mind.

## Counterexamples

- Peer-to-peer technical reviews where everyone already knows the model — pitch the depth. (Two architects, or two agents exchanging a structured handoff, need the model itself.)
- Compliance contexts where the standard&#39;s specific structure matters for audit.
- Adoption-planning sessions past the "what is this?" stage and into the "how do we contextualise it?" stage.

## See also

- Parent stance: `[[stances/contextualize-dont-transform]]`
- Parent stance: `[[stances/it4it-is-substrate]]`
- Related stance: `[[stances/ea-is-meteorology]]` — deliver the forecast, not the raw model.
- Related heuristic: `[[heuristics/find-at-least-one-champion]]`
- Related heuristic: `[[heuristics/contextualize-before-transforming]]`
