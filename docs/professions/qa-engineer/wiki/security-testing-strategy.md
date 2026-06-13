---
title: Web security testing strategy (OWASP WSTG)
pageKind: principle
status: published
abstract: Security testing is a structured, repeatable practice spanning many categories, referenced by stable WSTG identifiers — not a single pass. It is integrated across the lifecycle by testers and organizations.
principleTier: contextual
principleDirection: Test security across the WSTG categories with stable, repeatable scenarios; integrate it into the lifecycle, not a final gate.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"public_safety": 0.8, "governance_compliance": 0.6}
professionCompetencyLevel: expert
sources:
  - owasp/wstg
---

## Rule

Treat security testing as a **structured, repeatable practice** that spans many categories and is integrated across the development lifecycle — not an afterthought before release.

## Why

The OWASP Web Security Testing Guide (WSTG) is a framework of best practices used by penetration testers and organizations worldwide. Its scenarios are referenced with stable identifiers (`WSTG-<category>-<number>`), which makes security coverage **consistent and repeatable** across runs and teams. Security testing spans multiple categories (information gathering, application and web-service vulnerability domains) rather than a single sweep.

## How To Apply

1. **Use the categories as a checklist.** Map WSTG categories to your application's surface so coverage is deliberate, not ad hoc.
2. **Reference by identifier.** Cite `WSTG-<category>-<number>` so a finding maps to a repeatable test.
3. **Integrate, don't gate.** Fold security tests into the pipeline per [[professions/qa-engineer/risk-based-testing-shift-left]].
4. **Weight by quality attribute.** Security is one ISO 25010 characteristic among several — see [[professions/qa-engineer/iso-25010-quality-model]].

## See Also

- [[professions/qa-engineer/risk-based-testing-shift-left]]
- [[professions/qa-engineer/iso-25010-quality-model]]
