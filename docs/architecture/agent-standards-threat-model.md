# TAK and GAID Shared Threat Model Companion

## Purpose

This companion document provides a shared starter threat model for the `TAK` and `GAID` standards family.

It is not a substitute for an implementation-specific threat model. It is a structured baseline that helps implementers identify the minimum assets, actors, trust boundaries, and abuse paths that trustworthy agent platforms must account for.

## Protected Assets

The standards family assumes at least the following protected assets:

- human authority and approval context
- agent identity records and `AIDoc` payloads
- issuer keys, verification material, and trust anchors
- tool credentials, API tokens, and delegated access rights
- immutable directives and governed instruction bundles
- memory stores, retrieval context, and evidence history
- queue state, retry state, and provider budget state
- badge evidence, evaluation reports, and conformance statements
- receipts, trace context, and parent-child delegation lineage

## Threat Actors

At minimum, implementations should consider:

- malicious or careless end users
- compromised agent subjects
- compromised orchestrator or supervisor agents
- compromised tools, connectors, or `MCP` servers
- hostile or malfunctioning providers
- malicious or negligent issuers
- over-privileged insiders or operators
- external relying parties attempting spoofing, replay, or badge misuse

## Trust Boundaries

The minimum trust boundaries typically include:

- human-to-runtime request boundary
- runtime-to-model-provider boundary
- runtime-to-tool or connector boundary
- parent-agent-to-delegate boundary
- private-identity-to-public-identity publication boundary
- issuer-to-verifier boundary
- receipt or evidence store to auditor or relying-party boundary

## Core Abuse Paths

The shared baseline should cover at least these abuse paths:

- prompt injection that attempts to override immutable or governed instructions
- malicious tool output that is reinterpreted as trusted control input
- connector or tool compromise that widens the agent's effective authority
- forged or replayed receipts
- forged or stale `AIDoc` resolution
- badge reuse after material runtime change
- silent failover to an unapproved provider or capability tier
- cross-principal or cross-tenant memory leakage
- forged delegation lineage or missing parent-child traceability
- public identity spoofing through issuer or certificate confusion

## Control Families

`TAK` primarily mitigates:

- authority mediation failures
- uncontrolled tool execution
- unsafe queueing, retry, failover, and escalation behavior
- memory and context-governance failures
- missing runtime evidence and supervisor transparency

`GAID` primarily mitigates:

- identity spoofing
- stale or misleading badge claims
- weak issuer trust and verifier confusion
- broken chain-of-custody and receipt validation
- weak public and private identity boundary handling

## Mapping Guidance

Implementations should map relevant scenarios to:

- `OWASP Top 10 for Agentic Applications`
- `CSA MAESTRO`
- `MITRE ATLAS`

The exact mapping will vary by platform, but conformance claims should make clear which threat categories were actually exercised.

## Use in DPF

`DPF` should treat this document as the shared starter model for the prototype standards implementation, then refine it with runtime-specific assets, connectors, approval flows, and public-surface assumptions as the conformance work matures.
