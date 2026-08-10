---
title: Architecture Over Shortcuts
pageKind: principle
status: published
abstract: Choose the architecturally sound solution. Quick fixes that bypass the design create more debt than they save.
principleTier: commandment
principleDirection: Prefer architecturally sound solutions over quick fixes that bypass the design.
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.7, "speed_to_value": -0.4, "reusability": 0.6, "blast_radius": -0.35}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: This is DPF's stated technical posture — adopters need to know the platform will choose the sound option even when a faster hack is available.
sources:
  - articles/why-product-centric-approach-needed
---

## Rule

When a problem has a quick fix and an architecturally sound fix, choose the sound one. Quick fixes that bypass the design (special-case branches, hardcoded values that should be data, parallel code paths to dodge a refactor) create more debt than they save — they accelerate today's task by an hour and slow every future task in that area by a fraction of that hour, compounding.

## Why

The sound fix lands once and stays correct as the surrounding system evolves. The quick fix lands once and silently corrupts the surrounding system every time the system changes — because the quick fix is the special case the next change forgets about. The math compounds against the quick fix within a few sprint cycles. DPF treats technical debt as a first-class operating cost (the 20-percent refactoring budget); the way to avoid paying it is to not take it on in the first place. When the user asks for the quick fix anyway, surface the trade-off — show what the sound version would cost vs. what the quick version will cost over the next year.

## Applies To

In-platform coworkers building features, external coding agents executing on the codebase, and humans setting direction. Symmetric. Applies to code design, schema design, API design, agent topology design, and operational procedures. Does NOT apply when the user explicitly authorizes a quick fix for a known-temporary surface (demo code, proof-of-concept slated for replacement) — but those exceptions are named, dated, and tracked, not silent.

## How To Apply

Before implementing, ask: is this the sound fix, or am I dodging a refactor I should be doing? If you're dodging, name the refactor in the PR description so it lands as a backlog item. When two approaches differ in cost, the sound one is usually clear — it removes a special case, consolidates duplicated logic, replaces a string with an enum, or fits cleanly under an existing abstraction. The quick one is usually clear too — it adds a branch, copies an existing function with one parameter different, or hardcodes a value that should be configurable. Pick the sound one. When the sound one is too large to fit in the current PR, split: do the small piece soundly, file the rest as planned refactor work.

## Decision Dimensions

- `long_term_maintainability: 1.0` — this principle IS the maintainability axis. Maximum weight.
- `schema_grounding: 0.7` — sound architectural choices respect the schema; quick fixes are how the schema gets corrupted.
- `speed_to_value: -0.4` — explicitly negative. The principle costs raw throughput on today's task. The payback is on every future task.

## Examples

- **Positive:** Faced with "the seed walker silently skips a file when frontmatter is malformed," the sound fix is to throw with a clear message. The quick fix would be to add a `try/catch` that logs and continues. The sound fix lands; the seed regresses loudly and gets fixed instead of accumulating silent skips.
- **Counterexample:** A hypothetical world where `principle_decide` accepts a `tier` filter via a top-level `principleTier` field AND a legacy `tier` field that maps to the same thing, "to avoid breaking callers." Two code paths to maintain, an inevitable drift in validation logic, and every future filter addition has to think about both surfaces. The chief-architect review caught this exact case and forced canonical names everywhere.


## Regulatory & interoperability boundaries

When the sound path is a healthcare / regulated substrate, architecture-over-shortcuts
includes **boundary enforcement as architecture**, not as a late bolt-on (BI-IMP-6DF60418):

1. **Payload integrity** — external clinical interchange (e.g. FHIR R4 resources) must
   validate against the declared profile and carry integrity hashing / signature where
   the jurisdiction requires non-repudiation; do not ship a "parse and store free-form JSON"
   shortcut past the validator.
2. **Residency gates** — HIPAA / GDPR / provincial residency constraints are **routing and
   storage architecture**. Cross-border or cloud-region placement is a design decision with
   an explicit gate, not an env default left for ops to discover.
3. **Immutable provenance** — care-critical writes keep an append-only trail (who / when /
   what changed) co-designed with the primary model; do not add provenance as a parallel
   table after the feature ships.

Canonical patterns live with the healthcare program specs and validators; this principle
forbids skipping them for speed. Future healthcare substrates inherit this baseline.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
