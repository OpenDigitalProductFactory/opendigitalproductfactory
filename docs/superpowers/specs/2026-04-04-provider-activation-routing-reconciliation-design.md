# Provider Activation Routing Reconciliation Design

**Date:** 2026-04-04
**Status:** Draft
**Author:** Codex
**Related:**
- [2026-03-15-codex-provider-integration-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-03-15-codex-provider-integration-design.md)
- [2026-03-20-contract-based-selection-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-03-20-contract-based-selection-design.md)
- [2026-03-30-db-driven-model-classification-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-03-30-db-driven-model-classification-design.md)
- [2026-03-31-auto-discover-on-provider-activation.md](/h:/opendigitalproductfactory/docs/superpowers/plans/2026-03-31-auto-discover-on-provider-activation.md)

---

## Overview

The platform already intends routing to be dynamic: when a new provider is connected, its models should become part of the eligible routing pool without manual code changes or a local-model restart. In practice, this is not happening reliably for Codex-family models in consumer installs. The result is a misleading runtime state where Codex is configured and healthy, but ordinary AI coworkers still fall back to weaker local models.

This design closes the gap between provider activation and routing eligibility. It treats provider activation as a reconciliation event that must:

1. refresh the runtime model catalog,
2. normalize newly introduced models into canonical routing classes and capabilities,
3. reconcile provider lifecycle changes including additions, retirements, and interface drift,
4. update routing eligibility for affected task families and agents,
5. preserve local models as last-resort fallback rather than accidental first winner.

---

## Problem Statement

The intended runtime behavior is:

- provider is connected,
- models are discovered or seeded,
- model metadata is normalized,
- routing immediately considers the new models for relevant tasks,
- local fallback is used only when no suitable configured provider is eligible.

The observed behavior differs:

- Codex can be configured in the running install,
- the coworker runtime still reports `No eligible AI endpoints`,
- the local fallback response is used,
- the installed local model remains the effective winner even though stronger cloud capability exists.

### Source-grounded root cause

The current source shows a structural mismatch:

1. Generic contract routing defaults to `chat` and `reasoning` model classes when no explicit `requiredModelClass` is set.
2. The known Codex model is currently seeded as `modelClass: "agent"`.
3. The canonical `ModelClass` union does not include `"agent"`; it includes `"code"`.
4. Preferred provider overrides happen after eligibility filtering, so a configured provider cannot win if it never became eligible.
5. Providers add and retire models over time, and sometimes expose different invocation interfaces for adjacent models. The current runtime does not fully reconcile those changes into routing eligibility and execution compatibility.

This means Codex can be present in the database but still be filtered out before ranking for many coworker tasks, especially when task classification lands on `unknown` or another generic task type.

---

## Goals

1. Make provider activation a first-class routing reconciliation event.
2. Ensure newly introduced models are usable without manual admin cleanup.
3. Normalize Codex-family models into canonical model classes used by the routing pipeline.
4. Support capability-first routing:
   - coding agents/tasks prefer Codex-family models,
   - general coworkers prefer strong chat/reasoning models,
   - local models remain final fallback.
5. Detect and reconcile provider-side model churn:
   - new models,
   - retired models,
   - changed interfaces or parameter contracts.
6. Ensure consumer installs behave correctly after provider activation, not just source checkouts and fresh seeds.

## Non-Goals

1. Replacing the routing architecture.
2. Making Codex the global default for every task.
3. Removing local model fallback.
4. Solving unrelated provider adapter bugs except where they directly block eligibility.

---

## Research and Benchmarking

### Systems compared

#### OpenAI model catalog and Codex docs

OpenAI currently documents:

- `codex-mini-latest` as a fast reasoning model optimized for Codex CLI, with function calling and structured outputs supported.
- `gpt-5-codex` as the stronger Codex-optimized model for agentic coding workflows.
- `gpt-5.4` and `gpt-5.4-mini` as general-purpose flagship and mini models for complex reasoning and coding.

What we learn:

- Codex-family models should be represented as coding-capable, tool-capable models in the runtime catalog.
- They should not be represented with a private internal class that the router does not understand.
- The runtime should distinguish "best for coding" from "best for general conversation" rather than collapsing everything into one default.

Sources:
- <https://developers.openai.com/api/docs/models/codex-mini-latest>
- <https://developers.openai.com/api/docs/models/gpt-5-codex>
- <https://developers.openai.com/api/docs/models>

#### Existing platform design

The platform already has the right building blocks:

- provider activation hooks,
- model discovery and profiling,
- known-model seeding for non-discoverable providers,
- request contracts,
- model class filtering,
- per-agent routing preferences.

What we learn:

- The missing piece is not a brand new subsystem.
- The missing piece is reconciliation between activation, canonical classification, and eligibility.

### Patterns adopted

- Canonical model classes drive routing, not provider-specific labels.
- Provider activation should trigger model-catalog refresh automatically.
- Provider reconciliation should be repeatable and idempotent, not a one-time bootstrap operation.
- Capability-first routing should distinguish coding workloads from generic chat workloads.
- Strong cloud models should be preferred only when they are eligible for the current task family.

### Patterns rejected

- Global Codex-first routing for all coworkers.
  Reason: this would make generic conversational coworkers less predictable and would overfit the whole platform to a coding-specialized model family.

- Relying on seed-time classification alone.
  Reason: consumer installs connect providers after first boot, so runtime reconciliation is required.

### Anti-patterns identified

- Introducing provider-specific pseudo-classes like `"agent"` into a canonical routing pipeline.
- Treating provider activation as complete before routing metadata is reconciled.
- Applying preferred-provider logic only after hard exclusion.
- Letting local bootstrap defaults remain sticky after stronger providers are connected.
- Assuming a provider's model list and invocation interface stay stable after the first successful activation.

---

## Current-State Diagnosis

### What works

- The platform can store provider credentials.
- The platform can seed known models for non-discoverable providers.
- The routing system can express task-type, model-class, capability, and agent-level preferences.

### What fails

- Newly activated providers do not reliably become routable for the task families that should use them.
- Codex-family models are classified in a way that does not map to the canonical router.
- Generic coworkers can classify to `unknown`, making the router use default class filtering that excludes Codex.
- Consumer installs can therefore appear properly configured while still behaving as if Codex were absent.
- Provider evolution is not fully reconciled:
  - new models may not become eligible,
  - retired models may linger too long,
  - invocation interfaces can drift from what the registered adapter expects.

---

## Design

## Section 1: Treat provider activation as reconciliation

Provider activation must no longer stop at "credential valid" or "provider status active."

Activation completion means all of these are true:

1. provider credentials are valid,
2. model catalog is refreshed,
3. model metadata is normalized to canonical classes/capabilities,
4. provider-specific invocation compatibility is refreshed,
5. routing eligibility caches and task-family mappings are refreshed.

### Proposed behavior

When a provider is activated through OAuth, API key validation, or sibling activation:

- run discovery or known-model seeding,
- upsert model profiles,
- normalize model class and capability metadata,
- refresh routing-facing state for those models,
- emit a reconciliation result with counts and failures.

This should be one server-side flow, not a sequence of loosely related manual steps.

### Reconciliation must also be periodic

Provider reconciliation cannot run only at initial activation. Providers add, retire, and reshape models continuously. The same reconciliation flow should therefore be callable from:

- OAuth/API-key activation,
- manual sync,
- scheduled periodic refresh,
- runtime failure recovery when the provider reports `model_not_found`, unsupported parameters, or interface mismatch.

This keeps the runtime aligned with provider reality instead of requiring repeated design-time patches.

---

## Section 2: Canonicalize Codex-family models

Codex-family models must be stored using canonical classes understood by the router.

### Decision

- `codex-mini-latest` becomes `modelClass: "code"`
- `gpt-5-codex` is added to the known/seeded catalog as `modelClass: "code"`

### Why

The current `"agent"` value is not part of the canonical model-class type and is therefore a metadata leak from product language into routing language. Routing should care about functional capability, not marketing category.

### Capability expectations

Codex-family known models should be marked with:

- tool use,
- streaming,
- structured output,
- coding-oriented dimension scores,
- best-for metadata that strongly biases them toward coding and multi-step implementation tasks.

They should not automatically become top-ranked for ordinary generic chat tasks.

---

## Section 3: Split routing by task family, not provider

The router should remain capability-first.

### Task-family intent

- Coding-heavy tasks and coding agents:
  prefer `code`, then `reasoning`, then `chat`

- General coworkers:
  prefer `chat` and `reasoning`

- Fallback:
  allow local basic models only when no stronger eligible provider remains

### Concrete implication

Build Studio and other coding-specialist routes should explicitly allow or prefer `code` class models. Generic coworker routes should not accidentally exclude Codex when the request is clearly coding-oriented, but they also should not route all generic traffic to Codex by default.

### Handling `unknown`

For `unknown` tasks, the router should not collapse to "chat/reasoning only" if the available tool/capability signals clearly indicate a coding-style task. The reconciliation design therefore includes:

- improved fallback classification for ambiguous coding requests,
- or broader eligibility rules that permit `code` class for generic tool-using coding flows.

---

## Section 4: Reconfigure routing after model introduction

When new models appear, the runtime should re-evaluate:

- agent/provider preference effectiveness,
- task-family eligibility,
- quality-tier mapping,
- fallback chains.

### Proposed mechanism

After activation reconciliation completes:

1. recompute quality tier and canonical class for new/updated profiles,
2. rebuild any routing metadata derived from model profiles,
3. re-run agent preference compatibility checks,
4. mark newly eligible models available for immediate ranking.

This does not require rebuilding the entire app; it requires the runtime to stop assuming the seed-time routing view is sufficient.

---

## Section 5: Reconcile retirements and interface drift

Provider lifecycle reconciliation must treat stale models and stale invocation strategies as first-class failure modes.

### Retired models

When a provider no longer offers a model:

- the runtime should mark that model retired after reconciliation confirms absence,
- remove it from preferred routing candidates,
- preserve audit history without continuing to route to it,
- fall forward to the next best eligible model in the same capability family.

### Interface drift

Providers sometimes keep a model name but change how it must be called:

- endpoint family changes,
- parameter support changes,
- structured output behavior changes,
- tool calling schema changes,
- streaming behavior changes.

The runtime should therefore separate:

- model identity,
- canonical routing class/capabilities,
- execution adapter compatibility.

### Proposed compatibility contract

Each model profile should be reconciled into an execution-compatibility view that answers:

- which execution adapter should be used,
- whether the adapter is confirmed compatible,
- whether capabilities are verified or inferred,
- whether the model should remain routable, degraded, or retired.

If compatibility is uncertain after reconciliation, the model should be downgraded rather than silently treated as healthy.

---

## Section 6: Consumer install behavior

Consumer installs like `D:\DPF` can start with a local bootstrap model such as `ai/llama3.1`. That is acceptable as the worst-case fallback.

What is not acceptable is for that bootstrap model to remain the effective winner after stronger providers are connected.

### Decision

Consumer-mode install defaults remain:

- local model selected at install time,
- local `LLM_BASE_URL` configured,
- local routing available immediately.

But after a stronger provider is activated:

- coding routes should promote Codex-family models into eligibility,
- chat routes should promote strong chat/reasoning cloud models where configured,
- local model should move to the end of the fallback chain unless explicitly pinned.

---

## Data Model Stewardship

This feature does not require a new canonical identity model, but it does require cleaner canonical ownership of routing metadata.

### Canonical ownership decisions

- `ModelProfile.modelClass` is the canonical routing class.
- Known-model catalogs must only contain canonical class values.
- Provider activation flows are the canonical trigger for runtime catalog reconciliation.
- Execution compatibility must have one canonical source of truth rather than being split across seed assumptions, adapter defaults, and stale profile metadata.

### Future refactoring

If routing metadata continues to drift between seed, known-model catalogs, and profile extraction, a single canonical model-normalization module should become the only writer for:

- class,
- quality tier,
- capability projection,
- best-for / avoid-for metadata,
- execution compatibility state.

---

## Testing Strategy

### Automated

1. Add regression tests proving Codex known models normalize to `code`, not `agent`.
2. Add routing tests proving `code` class models become eligible for coding-oriented requests.
3. Add provider-activation tests proving newly activated known models become routable without manual intervention.
4. Add reconciliation tests proving retired models are de-ranked or retired cleanly.
5. Add adapter-compatibility tests proving interface drift degrades models instead of leaving them falsely routable.
6. Add consumer-install tests proving local fallback remains available but no longer masks eligible Codex models.

### Manual

1. Activate Codex in a fresh consumer install.
2. Verify model profiles exist after activation.
3. Verify Build Studio routes to a Codex-family model.
4. Verify a generic non-coding coworker still prefers chat/reasoning models.
5. Simulate a retired or unsupported model and verify fallback switches cleanly.
6. Verify disabling cloud providers falls back cleanly to the local model.

---

## Rollout Plan

1. Normalize known-model metadata for Codex-family models.
2. Add `gpt-5-codex` to the known/seeded catalog.
3. Extend activation reconciliation to refresh routing-facing state and execution compatibility.
4. Update routing eligibility rules for coding task families.
5. Add retirement and interface-drift reconciliation hooks.
6. Validate in source checkout first, then in consumer install workflow.

---

## Open Questions

1. Should generic `unknown` requests allow `code` models when tools are present, or only when the agent itself is coding-oriented?
2. Should `gpt-5-codex` be preferred over `codex-mini-latest` automatically for `quality_first` coding routes, with `codex-mini-latest` preferred for balanced/minimize-cost?
3. Should the platform surface a visible "provider activated, routing refreshed" status to admins so reconciliation failures are obvious?
4. Should reconciliation be strictly pull-based on activation/schedule, or also trigger opportunistically after runtime provider errors such as `model_not_found` and unsupported-parameter responses?

---

## Recommended Direction

Implement capability-first routing with explicit Codex-family support:

- normalize Codex to canonical `code` class,
- add `gpt-5-codex` to the known/seeded runtime catalog,
- make provider activation refresh routing eligibility,
- keep local models as the last fallback, not the accidental default winner.
