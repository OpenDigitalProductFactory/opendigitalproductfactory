---
title: Threat modeling
pageKind: heuristic
status: published
abstract: Threat modeling answers four questions — what are we building, what can go wrong, what will we do about it, did we do a good enough job — and uses STRIDE to enumerate threat categories during design.
professionCompetencyLevel: expert
sources:
  - owasp/threat-modeling
  - owasp/top-ten
---

## Heuristic

Model threats during design, not after deployment. The OWASP four-question frame structures the exercise:

1. **What are we working on?** — model the system (data-flow diagrams, trust boundaries).
2. **What can go wrong?** — enumerate threats, typically with STRIDE.
3. **What are we going to do about it?** — choose a response for each threat.
4. **Did we do a good enough job?** — review and validate the model.

## STRIDE

STRIDE enumerates six threat categories, each the violation of a security property:

- **S**poofing (authentication), **T**ampering (integrity), **R**epudiation (accounting), **I**nformation disclosure (confidentiality), **D**enial of service (availability), **E**levation of privilege (authorization).

## Responses

For each identified threat, choose to **mitigate**, **eliminate**, **transfer**, or **accept** it. Threat modeling is the practice that addresses **Insecure Design (A06:2025)** in the OWASP Top 10 — design-time risk that testing alone cannot catch.

## How DPF Coworkers Use It

- Run the four questions on any new design surface; record threats and responses.
- Authorization threats map to [[professions/security/least-privilege-deny-by-default]].
- Feed posture into [[professions/security/nist-csf-2-six-functions]].

## See Also

- [[professions/security/least-privilege-deny-by-default]]
- [[professions/security/nist-csf-2-six-functions]]
