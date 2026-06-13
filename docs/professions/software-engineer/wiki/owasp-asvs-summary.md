---
title: OWASP ASVS v5.0.0 — verification levels
pageKind: summary
status: published
abstract: The OWASP Application Security Verification Standard is a vendor-neutral standard of testable application-security requirements, organized in three rigor tiers (L1/L2/L3).
professionCompetencyLevel: expert
sources:
  - owasp/asvs
---

## What This Source Is

The **OWASP Application Security Verification Standard (ASVS) v5.0.0** is a vendor-neutral standard of testable application-security requirements, published under CC BY-SA 4.0. Where the [[professions/software-engineer/owasp-top-ten]] raises awareness of risk categories, ASVS provides the concrete, verifiable controls.

## Three Uses

ASVS is designed to serve three purposes:

1. A **security metric** — measure an application against a defined bar.
2. **Implementation guidance** — tell developers which controls to build.
3. A **procurement specification** — state security requirements in contracts.

## Verification Levels

ASVS defines three tiers of increasing rigor — **L1**, **L2**, and **L3** — with higher levels applying to higher-assurance applications. Requirements are addressed by stable identifiers of the form `v5.0.0-<chapter>.<section>.<requirement>` (e.g. `v5.0.0-1.2.5`), so a control maps cleanly to a test.

> Note: the precise scope of each level is defined in the downloadable ASVS document; this summary records the three-tier structure and the addressing scheme from the project page. Authoring deeper per-level doctrine requires fetching the ASVS document itself.

## How DPF Coworkers Use It

- Choose a target level by the application's assurance needs.
- Map relevant ASVS requirement IDs to CI tests, satisfying [[professions/software-engineer/automated-testing-verification]].
- Treat injection/access-control requirements as enforcement of [[professions/software-engineer/secure-coding-no-injection-validate-input]].
