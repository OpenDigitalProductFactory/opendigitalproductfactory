---
title: Configuration Scope
pageKind: principle
status: published
abstract: Finite known-at-build-time values are code enums; unbounded customer data may be JSON config with a strict schema; security-sensitive behavior rules stay in code unless the domain requires runtime composability with validation.
principleTier: core
principleDirection: Prefer code-level enums for closed finite sets; use schema-validated configuration only for unbounded or operator-owned data; do not put security-sensitive transition matrices in free-form JSON without validation and docs.
principleDimensionVector: {"long_term_maintainability": 0.7, "schema_grounding": 0.8, "evidence_confidence": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: false
sources: []
---

## Rule

**Finite, known-at-build-time values** (status enums, role types, well-known channels, closed work-types) must be **code-level enums** (TypeScript + matching DB/MCP lists — AGENTS.md strongly-typed string enums).

**Unbounded, externally managed, or customer-defined data** (channel credentials, custom field mappings, operator policy knobs within a fixed schema) may live as **JSON configuration** — only with a **strict schema enforced at write time**.

**Behavior rules** (workflows, status-transition matrices, authorization decisions) that are performance-sensitive or security-relevant must be **code**, not free-form JSON, unless the domain explicitly requires runtime composability **and** you provide schema validation, comprehensive docs, and tests.

## Why

JSON-without-schema is how two code paths drift and how agents invent invalid statuses. Code enums are compiler-checked and MCP-tool-aligned. Config is right for install-specific or customer-owned data that should not require a deploy to change — never for closed platform contracts.

## Applies To

Spec authors, schema designers, and agents proposing status matrices, workflow engines, or "put it in PlatformConfig JSON" shortcuts. (BI-IMP-815D2ED3)

## How To Apply

1. Ask: is the set closed and known at build time? → enum in code + seed.
2. Ask: is the data install- or customer-specific with unbounded values? → JSON under a named schema + validators package.
3. Ask: is this a transition/authorization rule? → code (or schema-validated policy that compiles to code-checked gates).
4. Never invent a second status list in a page-local helper.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
