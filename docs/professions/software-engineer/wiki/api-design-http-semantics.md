---
title: API design follows HTTP semantics
pageKind: principle
status: published
abstract: REST APIs follow the method, status-code, and idempotency semantics defined by RFC 9110 (HTTP Semantics, STD 97). Methods and status codes communicate intent precisely rather than being chosen by habit.
principleTier: core
principleDirection: Choose HTTP methods and status codes by their defined semantics — safe, idempotent, and correctly coded — not by convention or convenience.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"long_term_maintainability": 0.8, "human_cognitive_load": 0.7, "reusability": 0.6}
professionCompetencyLevel: practitioner
sources:
  - ietf/rfc-9110
---

## Rule

Design HTTP APIs against the semantics defined in **RFC 9110 (HTTP Semantics)**, an Internet Standard (STD 97). The method and status code are part of the contract; they carry meaning that clients, caches, and proxies rely on.

## Why

RFC 9110 defines semantics that hold across HTTP versions:

- **Safe methods** (GET, HEAD, OPTIONS, TRACE) are read-only and are expected not to change server state.
- **Idempotent methods** (GET, HEAD, PUT, DELETE) produce the same server state whether invoked once or repeatedly; POST does not. Retries and at-least-once delivery depend on this distinction.
- **Status codes** signal outcome precisely: `200 OK` for success, `201 Created` with a `Location` header for creation, `204 No Content` for success without a body; `400/401/403/404/409` for the corresponding client errors; `500/503` for server errors.

Choosing codes by habit (everything `200`, errors as `200` with a body flag) breaks caching, observability, and client error handling.

## How To Apply

1. **Match method to effect.** Reads are GET; full replacement is PUT; partial state-changing creation is POST. If a call must be safely retryable, make it idempotent.
2. **Code the outcome.** Return the status code RFC 9110 defines for the situation; reserve `2xx` for success.
3. **Design for idempotency** where clients may retry — see [[professions/software-engineer/dependency-supply-chain-integrity]] for the build-side analog of deterministic, repeatable operations.

## See Also

- [[professions/software-engineer/secure-coding-no-injection-validate-input]]
- [[professions/software-engineer/semantic-versioning]]
