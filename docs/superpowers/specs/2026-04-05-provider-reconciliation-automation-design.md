# Provider Reconciliation Automation Design

**Date:** 2026-04-05  
**Status:** Draft  
**Scope:** AI provider lifecycle reliability, startup self-healing, routing-state repair, and provider UX  
**Related specs:**  
- [2026-04-04-provider-activation-routing-reconciliation-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-04-04-provider-activation-routing-reconciliation-design.md)  
- [2026-04-02-ai-provider-agent-operational-monitoring-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-04-02-ai-provider-agent-operational-monitoring-design.md)  
- [2026-04-05-continuous-improvement-flywheel-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-04-05-continuous-improvement-flywheel-design.md)

## Overview

The platform currently relies too heavily on users remembering a repair sequence after rebuilds or provider changes:

1. reconnect or test the provider,
2. sync models and profiles,
3. repair routing metadata,
4. retry the coworker or Build Studio flow.

That sequence works for debugging, but it is a brittle operating model. The platform principle should be the opposite: remove avoidable failure opportunities, self-heal stale runtime state automatically, and make unavoidable failures visible with specific remediation.

This design introduces an automated provider reconciliation loop that runs:

- on startup,
- on provider-page load,
- after successful provider authentication or configuration,
- after successful provider tests,
- after runtime routing/provider failures,
- on a periodic schedule.

The loop uses the real provider execution path, repairs stale model and routing state when possible, and records explicit advisories when human intervention is required.

## Problem Statement

The platform already has many of the right parts:

- provider authentication and storage,
- known-model seeding for non-discoverable providers,
- discovery and profiling for discoverable providers,
- routing backfill and recipe seeding,
- provider health and advisory concepts,
- fallback-triggered reconciliation hooks.

But they are not yet orchestrated into one reliable lifecycle.

### Current failure mode

In practice, the platform can enter a state where:

- a provider is configured,
- the token or key is technically present,
- the model catalog is stale or partially repaired,
- routing metadata is stale or inconsistent,
- the provider page still looks mostly healthy,
- Build Studio or AI coworkers fail because the runtime never completed the full repair sequence.

Examples observed in practice include:

- missing OAuth scope,
- stale or invalid tokens after rebuilds,
- provider-side funding or billing problems,
- retired or inaccessible models,
- unsupported parameters due to backend interface drift,
- stale `ModelProfile` rows for known-catalog providers,
- rebuilt containers still running with partially repaired state.

The root issue is that reconciliation is available but not guaranteed.

## Goals

1. Automatically reconcile configured AI providers on startup and on key lifecycle events.
2. Eliminate manual repair steps as a prerequisite for a healthy platform.
3. Preserve manual controls for debugging and admin intervention.
4. Make provider failures visible as structured, actionable advisories.
5. Keep routing state, model profiles, and execution recipes aligned with provider reality.
6. Use the same reconciliation logic for both automatic and manual flows.

## Non-Goals

1. Replacing manual provider controls.
2. Hiding provider problems from admins.
3. Continuously probing providers so aggressively that the platform creates noise or unnecessary spend.
4. Solving every provider-specific API issue in this spec.
5. Introducing a separate provider operations subsystem disconnected from existing AI Workforce UX.

## Research & Benchmarking

### Existing platform patterns

The platform already demonstrates good patterns in adjacent areas:

- bundled local provider health checks,
- scheduled sync jobs,
- runtime advisories,
- route-failure-triggered reconciliation,
- known-catalog seeding for non-discoverable providers.

What is missing is orchestration and consistency.

Patterns adopted:

- idempotent server-side repair flows
- scheduled and event-driven health reconciliation
- clear separation between automatic recovery and required human action

Patterns rejected:

- manual-only repair
- separate logic paths for automatic and manual recovery
- opaque “provider unavailable” banners without remediation detail

### Industry-aligned lessons

Across cloud services and control-plane systems, reliable integrations usually distinguish:

- authentication state,
- runtime usability,
- catalog freshness,
- execution compatibility,
- operator action required.

This spec adopts that same separation. A provider is not “healthy” merely because a credential exists.

## Design Summary

The recommended design is a **provider reconciliation orchestrator** that unifies health verification, catalog refresh, routing repair, and advisory creation.

Core rule:

- **automatic by default**
- **manual by choice**

The operator should still be able to run each stage individually, but the normal path should not depend on memory or tribal knowledge.

## Trigger Model

The reconciliation loop should run at these points.

### Automatic triggers

- platform startup
- provider page load
- successful OAuth completion
- successful API key save or credential update
- successful `Test connection`
- runtime provider/model failure that indicates drift or staleness
- scheduled recurring reconciliation

### Manual triggers

- `Test connection`
- `Sync models & profiles`
- `Repair routing metadata`
- `Seed/repair execution recipes`
- `Run full reconciliation`

All manual actions should call the same underlying reconciler stages rather than maintain divergent logic.

## Reconciliation Strategy

Each provider should be reconciled according to its catalog strategy.

### Strategy A: Known-catalog providers

Examples:

- `codex`
- `chatgpt`

These providers should:

1. probe the real runtime/auth path,
2. reseed from the curated catalog,
3. repair model metadata from curated catalog entries,
4. repair routing metadata and recipes,
5. optionally verify a preferred model on the real backend.

Key rule:

- placeholder `rawMetadata` with `source: "known_catalog"` is not authoritative by itself
- curated catalog data is authoritative for routing metadata unless live execution disproves it

### Strategy B: Discoverable providers

Examples:

- `openai`
- `anthropic`
- `gemini`
- `openrouter`
- `ollama`

These providers should:

1. probe the real runtime/auth path,
2. discover models if reachable,
3. profile models,
4. retire missing or inaccessible models conservatively,
5. backfill routing metadata,
6. seed or repair execution recipes.

## Reconciliation Flow

For each provider, the orchestrator should run a procedural and idempotent flow.

### Stage 1: Load state

Load:

- `ModelProvider`
- `CredentialEntry`
- relevant `ModelProfile` rows
- last reconciliation/advisory outcome
- provider catalog strategy

### Stage 2: Probe health

Probe against the real execution path, not just token existence.

Outcomes:

- healthy
- degraded
- action required
- unreachable

### Stage 3: Classify failure

If the provider is not healthy, classify the failure before mutating state:

- reconnect required
- missing scope
- billing/funding problem
- model retired or inaccessible
- interface drift / unsupported parameter
- transient network/provider outage
- misconfiguration

The failure class becomes the basis for advisories and retry behavior.

### Stage 4: Repair runtime state

If the provider is healthy, run the repair sequence appropriate to the provider strategy:

- reseed or discover models
- refresh `ModelProfile`
- repair routing metadata
- reseed/repair execution recipes
- clear stale advisories

### Stage 5: Persist operational outcome

Persist:

- last run time
- result class
- summary
- next retry time / backoff
- any actionable advisory

## Failure Classes and Remediation

The UI and operations layer should distinguish provider failure causes explicitly.

### Failure classes

- `reconnect_required`
- `missing_scope`
- `billing_issue`
- `model_retired`
- `model_inaccessible`
- `interface_drift`
- `provider_outage`
- `network_error`
- `misconfigured`

### Operator-facing remediation examples

- `Reconnect required` — sign in again
- `Billing issue` — update funding or subscription
- `Model retired` — run reconciliation and review fallback selection
- `Interface changed` — platform adapter needs review; provider temporarily degraded

These should show up as advisories, not as vague coworker failures.

## UX Design

The provider page should become the control plane for both visibility and debugging.

### Provider status model

Each provider card and detail page should show one of:

- `Healthy`
- `Reconciling`
- `Degraded`
- `Action required`

Each status must show:

- a short reason
- last reconciliation time
- whether automation is retrying
- the next recommended action

### Manual controls

Keep the existing controls, but align them to the same reconciler:

- `Test connection`
- `Sync models & profiles`
- `Repair routing metadata`
- `Seed/repair execution recipes`
- `Run full reconciliation`

This keeps debugging simple while making the default path automated.

### Startup visibility

On startup, provider reconciliation should run in the background. If it fails:

- the platform should create a visible advisory
- coworker/build flows should degrade clearly
- the admin should be able to open the provider page and see the exact cause

## Routing Integration

Routing should consume reconciliation state rather than infer health indirectly.

### Principles

- a provider with stale metadata but confirmed healthy should be repaired before being treated as unavailable
- a provider with confirmed runtime failure should degrade with an explicit reason
- runtime failure classes should influence fallback and future reconciliation attempts

### Specific behaviors

- startup reconciliation should refresh pinned provider viability for agents like Build Studio
- runtime routing failures such as `model_not_found` or `unsupported parameter` should trigger provider reconciliation
- known-catalog providers should not lose curated capabilities during backfill

## Runtime Advisory Integration

Provider reconciliation should create or update `RuntimeAdvisory` records when human action is required.

Advisories should include:

- provider id
- severity
- failure class
- operator message
- suggested remediation
- first seen / last seen timestamps
- whether automation is retrying

This gives the platform a durable operational memory of provider problems instead of relying on transient logs.

## Scheduling and Backoff

Automatic reconciliation should be frequent enough to heal drift, but not noisy.

### Suggested policy

- startup: run immediately
- provider-page load: run if stale or failing
- post-auth/post-test: run immediately
- recurring schedule: daily for configured providers, more frequently only for recently failing providers
- failure backoff: exponential or capped retry for repeat failures

This prevents hammering broken providers while still keeping state fresh.

## Data Model and Stewardship

This feature should reuse existing structures where possible.

### Reuse

- `ScheduledJob` for recurring reconciliation orchestration
- `RuntimeAdvisory` for visible operator action
- `ModelProvider` for coarse provider state
- `ModelProfile` for routable model truth

### Refactoring guidance

The reconciliation flow should become the canonical writer for:

- provider health outcome
- known-catalog reseeding
- routing metadata repair
- recipe repair
- provider advisories

That avoids the current problem where several separate buttons and hooks can partially repair state in different ways.

## Testing Strategy

### Automated

1. startup reconciliation runs for configured providers and does not require manual button presses
2. successful provider auth triggers full reconciliation automatically
3. known-catalog providers preserve curated capabilities during repair
4. runtime advisories are created for reconnect, billing, and drift failures
5. manual actions call the same underlying reconciliation stages
6. runtime routing failures trigger provider reconciliation

### Manual

1. rebuild platform with a configured known-catalog provider
2. verify provider becomes healthy without pressing manual repair buttons
3. simulate stale profile rows and verify startup self-heals them
4. simulate a billing or scope failure and verify advisory text is clear
5. verify manual buttons still work for debugging

## Rollout Plan

### Phase 1

- create canonical provider reconciliation orchestrator
- wire it to startup, auth completion, and provider tests
- reuse existing repair functions where possible

### Phase 2

- add advisory creation and status UX
- unify manual buttons under the same orchestration flow

### Phase 3

- add scheduled recurring reconciliation with backoff
- improve failure classification for provider-specific cases

### Phase 4

- feed reconciliation failures into the continuous improvement flywheel as normalized signals

## Success Criteria

This design is successful when:

- a rebuilt platform with configured providers self-heals stale provider state automatically
- users do not need to remember the repair sequence to restore coworker/build routing
- failures that cannot be auto-healed show up as explicit advisories with clear remediation
- manual controls still exist and invoke the same logic for debugging
- provider/routing drift becomes a visible and governed operational concern, not a hidden source of random coworker failures

## Principle Statement

The platform should eliminate avoidable operational failure paths wherever possible. Provider lifecycle management is therefore not a manual checklist. It is a self-healing control loop with human-visible status and manual override.
