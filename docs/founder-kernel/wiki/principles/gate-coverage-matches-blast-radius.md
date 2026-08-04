---
title: A Gate's Coverage Must Match The Blast Radius Of What It Governs
pageKind: principle
status: published
abstract: A gate scoped narrower than the thing it governs produces false assurance — the green check is read as "this is covered" when whole classes of the subject were never looked at.
principleTier: core
principleDirection: Scope a gate to everything its subject can break, and derive that scope from the artifact that already decides it — a gate narrower than its blast radius reports safety it never checked.
principleDimensionVector: {"long_term_maintainability": 0.5, "governance_compliance": 0.5, "evidence_density": 0.4, "blast_radius": -0.4, "human_cognitive_load": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts: []
principlePublic: false
principlePublicRationale: ""
sources: []
---

## Rule

When you build a gate, scope it to everything its subject can break — not to the part you were looking at when you wrote it. Derive the scope from the artifact that already decides it rather than restating it, and prefer a rule the gate can decide without anyone remembering to annotate.

## Why

A gate is read as a claim about its subject, not about its implementation. "Docs Impact: green" is heard as *the documentation is consistent with this change* — not as *the subset of documentation this script happens to walk is consistent with this change*. When those diverge, the check is worse than absent: absence prompts a human to look, while a green check actively suppresses that instinct. The narrower scope is invisible at exactly the moment it matters.

The failure is not that someone scoped a gate badly once. It is that scope is usually set from whatever the author had in view, and the subject then grows past it silently. Nothing fails when a new directory, surface, or corpus falls outside the walk — the gate keeps passing, because passing is what it does when it sees nothing.

Two properties make the divergence self-correcting. **Derive, don't restate:** if the gate reads its scope from the artifact that genuinely determines it, the scope cannot drift without the subject drifting too. **Decide, don't ask:** a gate that only inspects things someone opted into protects the cases someone already thought about, which are not the cases that hurt. Opt-in coverage reproduces the very "somebody must remember" failure the gate exists to remove.

The corollary is a discipline about scope reduction. Narrowing a gate — a path exclusion, a baseline entry, a skip — is a governance act, not a maintenance one. It is legitimate, often necessary, and must leave a reviewable trace. A hardcoded exemption buried in the checker is the same defect as the original narrow walk: an unreviewed decision presented as coverage.

## Applies To

Anyone authoring or narrowing an automated check: CI gates, guards, ratchets, freshness checks, lint rules, policy validators, and the attestations that stand in for them. It applies most sharply when the gate's subject spans more than one corpus, surface, or repository area.

It does not demand that every gate be exhaustive. A deliberately partial gate is fine — a fast pre-check, a sampled audit, a single-dimension lint. What the principle forbids is a partial gate whose *name and result* imply completeness, and a scope that narrowed by accretion rather than by decision.

## How To Apply

Before you finish a gate, state what its subject can break and check the walk covers it. Ask where the scope comes from: if it is a literal in the checker, look for the artifact that already answers the question — a site config, a manifest, a route map, a package graph — and read from that instead. Then ask what the gate does about a case nobody annotated; if the answer is "passes", you have an opt-in gate, and you should either add a decidable rule alongside it or say plainly in the gate's own output that coverage is opt-in.

When you must narrow, put the narrowing somewhere a reviewer will see it: a baseline file, a registry entry, an explicit attestation — never a path exclusion inside the checker. And when the same fact is consulted by two checkers, extract it once; two scripts answering "what counts as published?" independently will disagree eventually, and the disagreement will be silent. This composes with [[principles/single-source-of-truth]] (one home per fact) and [[principles/governance-approves-evidence-not-provenance]] (a gate reads evidence, never who produced it).

## Decision Dimensions

- `long_term_maintainability: 0.5` — a derived scope keeps matching its subject as the codebase grows; a restated one silently rots and must be re-audited by hand.
- `governance_compliance: 0.5` — the check's claim and its actual coverage stay aligned, which is what makes a green result usable as evidence at all.
- `evidence_density: 0.4` — a gate whose scope is grounded in a real artifact yields findings that can be trusted without re-deriving what it looked at.
- `blast_radius: -0.4` — this pulls *against* blast radius: the whole point is that the region a change can damage is the region the gate inspects, so damage stops being discovered downstream.
- `human_cognitive_load: -0.2` — nobody has to remember which corpora a gate covers, or to annotate a page for it to be protected.

## Examples

- **Positive:** A documentation-impact gate derives its corpus from the site config's own exclude list — the artifact the publisher already obeys — so a newly added doc directory is covered the day it lands, with no script to remember to widen.
- **Positive:** A guard that must exempt a page records the exemption in a ratcheted baseline file rather than a path check inside the checker, so every exemption stays countable and can only shrink.
- **Counterexample:** A doc gate walks only the user-guide corpus while the published site also serves architecture and operations pages. A datastore is retired; the architecture page describing it and the incident runbook instructing operators to restore it both go stale, and the gate reports green throughout — because it never looked. Worse, a sibling script in the same repository already scanned both corpora and said so in a comment; the two had drifted apart with nothing to notice.
- **Counterexample:** A gate that only flags files a page opted into via frontmatter. It protects the pages someone already thought carefully about, and is structurally blind to the ones nobody remembered — which is the population the gate was built for.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
