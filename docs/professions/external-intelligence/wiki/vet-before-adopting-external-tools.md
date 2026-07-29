---
title: Never adopt an unvetted external tool
pageKind: principle
status: published
abstract: Every external tool, MCP server, or package carries supply-chain risk and must be vetted before adoption. Guard against typosquatting, dependency confusion, and hijacking; reject vulnerable or end-of-life components. A "verified" badge is a signal, not a clearance.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Vet every external tool/package for supply-chain risk before adoption; never treat a registry badge as a substitute for independent assessment.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"public_safety": 0.8, "blast_radius": -0.7, "governance_compliance": 0.6}
professionCompetencyLevel: foundational
sources:
  - owasp/component-analysis
  - owasp/dependency-chain-abuse
  - smithery/registry-docs
---

## Rule

Never adopt an external tool, MCP server, or package without vetting it for supply-chain risk first. Component analysis exists to identify "potential areas of risk from the use of third-party and open-source software" — vetting is mandatory, not optional.

## Attack Vectors To Guard Against

- **Typosquatting** — "publication of malicious packages with similar names to those of popular packages."
- **Dependency confusion** and **dependency hijacking** — including "obtaining control of the account of a package maintainer on the public repository."
- **Brandjacking** and other dependency-chain abuse (OWASP CICD-SEC-3).

## Reject Criteria

- **Known vulnerabilities** and **excessive age** — OWASP advises limiting "acceptable component age to three years maximum" and prohibiting end-of-life components.
- **Ongoing cost** — "operational and maintenance cost of using open source will increase with the adoption of every new component"; each dependency is a standing liability.

A registry **"verified" badge is a signal, not a clearance** — verification status is one filter, never a substitute for independent risk assessment.

## How To Apply

1. **Vet every candidate** from [[professions/external-intelligence/external-tool-catalog-reconnaissance]] before it can be suggested.
2. **Run the health assessment** — see [[professions/external-intelligence/server-health-assessment]].
3. **Factor vetting + maintenance cost** into the build-vs-buy call — see [[professions/external-intelligence/capability-gap-to-governed-suggestion]].

> This aligns with DPF's own Tool Evaluation Pipeline (AGENTS.md §9): external tools must pass security/architecture/compliance/integration review before adoption.

## See Also

- [[professions/external-intelligence/external-tool-catalog-reconnaissance]]
- [[professions/external-intelligence/server-health-assessment]]
- [[professions/external-intelligence/capability-gap-to-governed-suggestion]]
