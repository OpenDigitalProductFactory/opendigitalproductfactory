---
title: ISO/IEC 25010 product quality model (summary)
pageKind: summary
status: published
abstract: ISO/IEC 25010 defines the product quality characteristics — functional suitability, performance efficiency, compatibility, reliability, interaction capability, security, maintainability, flexibility, safety. Expert QA trades them off rather than maximizing one.
professionCompetencyLevel: expert
sources:
  - iso25000/quality-model
---

## What This Source Is

**ISO/IEC 25010** defines a product quality model — the set of characteristics by which software quality is judged. Expert QA work is about **trading these off** against each other under constraints, not maximizing any single one.

> Provenance/licensing note: the ISO/IEC 25010 standard itself is a licensed work. This page is distilled from an open summary (iso25000.com) and is checklist-only — use the ISO text for any formal or contractual citation.

## The Quality Characteristics

The model's product-quality characteristics include:

- **Functional Suitability** — provides functions that meet stated and implied needs.
- **Performance Efficiency** — performs within time and throughput constraints.
- **Compatibility** — exchanges information with other products/systems.
- **Reliability** — performs specified functions under specified conditions for a period (faultlessness, availability, fault tolerance, recoverability).
- **Interaction Capability** (formerly Usability), **Security**, **Maintainability**.
- **Flexibility** — can be adapted to changes in requirements, contexts, or environment.
- **Safety** — avoids states endangering human life, health, property, or the environment.

(The 2023 revision renamed Usability → Interaction Capability and Portability → Flexibility, and added Safety.)

## How DPF Coworkers Use It

- Use the characteristics as the vocabulary for non-functional requirements and trade-off discussions.
- Security maps to [[professions/qa-engineer/security-testing-strategy]]; risk-weighting these attributes feeds [[professions/qa-engineer/risk-based-testing-shift-left]].

## See Also

- [[professions/qa-engineer/security-testing-strategy]]
- [[professions/qa-engineer/risk-based-testing-shift-left]]
