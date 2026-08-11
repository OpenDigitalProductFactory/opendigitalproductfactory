---
title: No Provider Pinning
pageKind: principle
status: published
abstract: Routing picks the right model by capability tier and task contract, dynamically. Never pin an agent to a specific provider or model.
principleTier: core
principleDirection: Express what a task needs as capability requirements and tiers; let routing pick the model. No hard pins in seeds, AgentModelConfig, or override tables.
principleDimensionVector: {"long_term_maintainability": 0.8, "vendor_lock_in": -0.9, "operational_independence": 0.6, "capacity_utilization": 0.4, "cost_efficiency": 0.5, "reusability": 0.45}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principleConsumerArchetype: universal
principleConsumerContexts:
  - data-model
  - mcp
principlePublic: true
principlePublicRationale: Routing-layer policy that adopters must rely on — DPF will pick the right model dynamically as the model landscape changes, without per-agent edits when a model is retired or a better one ships.
sources: []
---

## Rule

There are no hard pins from an agent to a specific provider or model — not in seeds, not in `AgentModelConfig`, not in `EndpointTaskPerformance` overrides, not in any `pinnedProviderId` / `pinnedModelId` / `pinned=true` field. The routing layer decides which LLM runs a given call based on the task's contract (required capabilities, reasoning depth, modality, sensitivity) and the candidate pool's capability tier.

## Why

Pins are a lie about the world. They force one specific model to be "the answer" forever, regardless of whether it's healthy, whether a better or cheaper option shipped, or whether the task actually needs that model's ceiling. When a pinned provider stumbles, routing still tries it first, fails, and the fallback chain silently slides down to whatever else is ranked — often far below what the task needed. The build-specialist incident on 2026-04-20 made this concrete: a pin to codex/gpt-5.4 → codex temporarily disabled → fallback walked all the way to local Gemma → Build Studio stalled for hours. New models can't improve an agent's behaviour without manual pin updates; retired models break agents until someone notices. The routing layer is the only place that has the information to choose dynamically — pinning routes around it.

## Applies To

In-platform coworkers configuring agent profiles, external coding agents authoring seeds and migrations, and humans operating provider connections. Symmetric. Applies to seed code, runtime configuration, override tables, and any code path that selects an LLM for an agent task.

## How To Apply

- Never add pinning to a seed. If a Prisma seed or docker-entrypoint SQL touches `AgentModelConfig.pinnedProviderId` / `pinnedModelId` or any `pinned=true` flag, that's a regression — reject it.
- When an agent needs a specific kind of model, encode the requirement on the agent: `AgentMinimumCapabilities`, `requiredModelClass`, `minimumDimensions` (reasoning, codegen, tool-fidelity scores), `qualityTier`, reasoning-depth floor. Let routing pick.
- If the right model isn't being picked, the fix is on the tiering side, not the agent side: adjust the task-requirement thresholds, the dimension scoring, or the candidate model's capability profile. Not a pin.
- As new models land via discovery, they enter the pool with auto-discovered profiles. They compete on the same contract. No agent-side change needed.
- Discovery + re-profiling is the update mechanism — not hand-editing `AgentModelConfig` rows.

## Decision Dimensions

- `long_term_maintainability: 0.8` — a no-pin routing layer adapts to the changing model landscape without per-agent edits.
- `vendor_lock_in: -0.9` — the principle directly negates provider lock-in. Pins concentrate dependence on one vendor; capability-tier routing distributes it.
- `operational_independence: 0.6` — a pinned agent fails when its provider stumbles; a capability-routed agent rolls over to the next qualifying model automatically.
- `capacity_utilization: 0.4` — routing can balance load across qualifying models; a pin forces one model to absorb everything.

## Examples

- **Positive:** "Build-specialist needs a model that can handle large diffs and call tools reliably" gets encoded as `reasoningDepth: high`, `qualityTier: quality_first`, `minimumDimensions: { codegen: 0.85, toolFidelity: 0.9 }`. Routing picks the best qualifying model today; when a new model ships that scores higher on those dimensions, the agent picks it up automatically.
- **Counterexample:** "Build-specialist must use codex/gpt-5.4" hardcoded in a seed. Codex goes offline → fallback walks the candidate list → ends on local Gemma → Build Studio stalls. The pin caused the failure by hiding the requirement from the routing layer.

## See Also

- `live-state-over-seed-data` (core) — seeds describe defaults, not runtime truth; pins try to use seeds as runtime truth and fail for the same reason.
- `fix-the-seed-not-the-runtime` (core) — when a pin causes a regression, the cleanup goes in the seed; this principle is why no new pin should ever land there.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
