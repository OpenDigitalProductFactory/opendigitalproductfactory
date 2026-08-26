---
status: active
---

# Cloud Clearance at First Run — Implementation Plan

**Goal:** A fresh install where the owner connects one cloud provider either uses it for ordinary work, or says plainly why it cannot and what to do — instead of silently running everything on the local model.

**Primary BI:** `BI-575F0046`
**Epic:** `EP-B9DD37C7`
**Decision:** `DI-5C13155815D2` — operator chose `guided-attestation-and-loud`; the kernel scored the same set independently and reached the same option (composite 9.668, margin 1.422, high confidence, no commandment conflict).

## The defect

Three correct-looking things compose into a dead install:

| stage | behaviour |
|---|---|
| seed (`packages/db/src/seed.ts`) | LLM providers land `status: "unconfigured"`, `sensitivityClearance: []` |
| connect (`deriveActivationClearance`) | a new cloud account gets `["public"]` until its trust evidence is reviewed |
| every route (`ROUTE_SENSITIVITY`) | floors at `internal`; `Agent.sensitivity` defaults to `internal`; 17 seeded coworkers are `confidential` |
| select (`pipeline-v2.ts:95`) | excludes an endpoint whose clearance lacks the turn's level |

The intersection of "what a new cloud provider is cleared for" and "what any turn can be" is **empty**.

The clearance policy is sound and is not being changed. Authentication proves a credential works; it does not prove the account carries commercial data protections. What was wrong is that nothing reported the resulting state — and the workspace home actively mis-reported it, computing `hasCloudProvider` by counting active non-local providers, so connecting a provider *removed* the local-only notice.

Live shapes on the reference install: `anthropic-sub` `{public,internal,confidential}` (reviewed at some point) against `chatgpt` `{public}`. Every new install starts where `chatgpt` is.

## Slice 1 — visibility (delivered)

- `resolveCloudProviderReadiness` — pure over provider rows, returns `none | public-only | ready`. Shared so the workspace home and the attention queue cannot disagree about what "has a cloud provider" means, which is the failure being fixed.
- Workspace home keeps the local-only notice for `none`; a distinct notice for `public-only`. Different copy on purpose: "add a cloud provider" is wrong when one is already added, and reconnecting fixes nothing.
- `selectUnclearedCloudProviders` projects the same state into the Needs-you inbox, in its own lane — the existing provider-credential lanes cover expired credentials and routing-disabled providers, both of which are failures. This is not a failure.
- Owner-facing copy carries no clearance or sensitivity vocabulary; tests assert that on both surfaces.

## Slice 2 — guided attestation (not started)

Extend the existing `ai-providers` setup step (`SETUP_STEPS`, `/platform/ai/providers`) rather than adding a step: after a provider connects, walk the owner through account class, no-training entitlement and evidence so clearance is earned during onboarding.

**Binding constraint from the decision ledger.** The core principle *Zero-Click Provider Setup* scores AGAINST the chosen option and FOR the rejected `grant-internal-on-connection`. It is the only principle pulling that way and it is not wrong: an install that demands paperwork before it works is its own defect. The attestation must therefore be genuinely quick — defaults pre-filled from the connected account where they can be known, one screen, skippable with the Slice 1 notice as the consequence. If it turns into a form, it has traded a silent failure for a tedious one and should be re-scored.

- [ ] Decide what can be derived rather than asked (account class from the OAuth token's plan, `noTraining` from the provider's published terms per catalog entry).
- [ ] Extend the `ai-providers` step to surface the attestation immediately after a successful connection.
- [ ] Let the owner defer explicitly; deferral leaves the Slice 1 notice and attention item in place.
- [ ] `SetupContext.hasCloudProvider` becomes readiness-aware so the COO's setup guidance stops claiming cloud AI is available when it is not.

## Acceptance

- A fresh install + one connected cloud provider + no other action either routes ordinary coworker turns to it, or shows both the workspace notice and the attention item.
- A regression test over seed + activation asserting post-connect clearance intersects the sensitivity of a default coworker turn, or that the uncleared state is surfaced. The check must run against seed + activation, not a hand-configured install.
- `deriveActivationClearance` is unchanged; any change to it is a separate kernel decision.
