# Local Provider / Local-CI Capacity Reservation Plan

**Backlog:** `BI-8E2E8BAE`
**Work capsule:** `WC-0E7D2D46`

## Goal

Prevent any portal-owned local completion or embedding dispatch from starting a resident model while governed `local-integration-ci` owns the shared host, without blocking eligible cloud inference.

## Existing substrate

- `callProvider()` is the shared completion adapter boundary used by routed inference, agentic work, evaluation, endpoint checks, voice, and legacy callers.
- `generateEmbedding()` is the governed embedding choke point for durable knowledge and vector recall.
- `listActiveNonprodEnvironmentLeases()` is the authoritative active-capacity registry.
- `callWithFallbackChain()` already owns provider failover and can continue past a capacity-deferred local endpoint.
- Semantic review already returns infrastructure-inconclusive for capacity deferral; that contract must remain stable.

## Implementation

1. Add one typed local-provider capacity policy over the active lease registry; fail closed only for local dispatch when registry authority is unavailable.
2. Enforce it at `callProvider()` before provider setup and at `generateEmbedding()` before HTTP dispatch.
3. Teach the fallback chain to treat the typed condition as a deferred local endpoint, preserving cloud fallback and returning the typed condition for local-only chains.
4. Refactor semantic review to consume the shared policy while preserving its existing inconclusive result shape.
5. Prove local, `ollama`, cloud, registry-failure, embedding, fallback, and semantic-review behavior with focused tests; run TypeScript and the canonical exact-tree gate on the combined capacity candidate.

## Documentation impact

This is primarily an operator/runtime contract. The pre-PR gate runbook records
the exclusion and recovery semantics, and the provider user guide explains the
temporary local-capacity deferral without presenting it as provider failure.

## Evidence boundary

The motivating evidence is temporal: local-provider dispatch and model
residency coincided with the Windows free-physical-memory metric crossing the
CI fence. Docker's displayed model residency, GPU VRAM, WSL/shared-memory
accounting, and Windows physical memory remain separate measurements. This plan
does not infer that displayed model size is ordinary RAM or name a causal
mechanism without telemetry.
