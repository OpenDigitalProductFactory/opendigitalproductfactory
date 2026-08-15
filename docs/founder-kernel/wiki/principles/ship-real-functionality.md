---
title: Ship Real Functionality
pageKind: principle
status: published
abstract: PR only real, working functionality wired to live sources. Never ship hardcoded, placeholder, or fictional surfaces presented as real — unless a mock/stub IS the feature's stated intent, and then label it as such.
principleTier: commandment
principleDirection: Ship only functionality that is real and sourced from live state, code, or a genuine computation; never present hardcoded or fabricated values as real unless a mock/stub/fixture is the explicit, stated intent of the feature.
principleDimensionVector: {"evidence_density": 0.9, "long_term_maintainability": 0.6, "governance_compliance": 0.5, "evidence_confidence": 0.7, "cost_efficiency": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters need assurance that what the platform displays is real. Fictional surfaces that look authoritative erode trust and hide broken or unbuilt features behind plausible-looking output.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

A pull request must deliver real, working functionality. Every value a surface presents as real — versions, counts, statuses, metrics, timestamps, identities, health, progress — must be sourced at runtime from live state, code, or a genuine computation. Do not ship hardcoded constants, never-updated static files, placeholder defaults, or fabricated data dressed up as real output.

The only exception is when non-real output IS the feature's stated intent — a mock-up, a design prototype, an interface stub, or a test fixture. Then the non-real nature must be explicit on two fronts: named as such in the PR, and visibly labeled in the surface (e.g. "sample data", "preview", "stub") so no operator mistakes it for truth. "Otherwise specified" means the requester explicitly asked for the stub; silence is not permission.

## Why

A fictional surface is worse than a missing one, for the same reason a fabricated claim is worse than "I don't know": it looks authoritative. A portal that displays "version 1.0.0" from a hand-edited file that nothing updates — while the platform actually ships v5.x — sends every operator decision down a wrong path and hides the fact that the real wiring was never built. These landmines pass review precisely because they render plausibly; they detonate later, when someone trusts the number. Shipping only real functionality keeps the platform's displayed state and its actual state in agreement — which is the entire basis on which the platform is operated and trusted.

## Applies To

In-platform coworkers, external coding agents, and humans authoring changes. Symmetric. Applies to every user- and operator-facing surface: UI components, API responses, dashboards, status pages, reports, notifications, exported documents. Does NOT apply to: genuine loading / empty / error states; compile-time constants that ARE the real value (enum members, schema shape); or explicitly-requested mocks, stubs, and fixtures that are labeled as non-real.

## How To Apply

Before opening a PR, trace every displayed value to its source. If a value is presented as real, confirm it derives from live state, code, or a real computation — not a literal, a never-updated file, or a default that ships to production. If the feature's intent genuinely requires non-real output (mock-up, prototype, stub, fixture), say so explicitly in the PR description and label it in the surface itself. When you encounter an existing fictional surface, treat it as a defect: file it and wire it to the real source rather than refreshing the fake value. Composes with "Live State Over Seed Data" (where to read) and "Never Fabricate" (don't invent claims) — this principle governs what you are allowed to ship.

## Decision Dimensions

- `evidence_density: 0.9` — a real surface is grounded in live evidence; a fictional one has none.
- `long_term_maintainability: 0.6` — landmines that render plausibly survive review and rot silently; real wiring stays correct as the system changes.
- `governance_compliance: 0.5` — shipping fiction-as-real violates the evidence-based contract; explicitly labeling an intended stub affirms it.

## Examples

- **Positive:** The platform version is read at runtime from the git release tag baked into the image (`git describe`), so it always reflects what is actually deployed. A design prototype is shipped behind a "Preview — sample data" banner and described as a mock-up in its PR.
- **Counterexample:** A `version.json` hand-edited to "1.0.0" is displayed as the platform version while the repo ships v5.6.0; nothing sources or updates the "1". It passes review because it renders, and silently misleads every operator who reads it until someone traces it.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
