# GAID Suggested Conformance Assertion Rubric

## Purpose

This companion document provides a suggested conformance-assertion rubric for `Global AI Agent Identification and Governance Framework (GAID)` implementations.

It is intended to make identity, badging, and receipt claims reviewable by implementers, customers, auditors, and standards reviewers.

## Assertion Format

Each assertion should identify:

- assertion id
- applicable `GAID` profile
- requirement under test
- minimum evidence expected
- pass condition

## Core Assertion Set

| Assertion ID | Profile | Requirement Under Test | Minimum Evidence | Pass Condition |
|--------------|---------|------------------------|------------------|----------------|
| `GAID-001` | `Private` | Stable identifier issuance | Identifier registry and lifecycle policy | The same materially continuous agent subject retains one stable `GAID` across ordinary runtime or model changes |
| `GAID-002` | `Private` | Namespace discrimination | Issuance rule or schema showing installation, domain, or stable discriminator in the issuer prefix | Private identities cannot collide across independent installations that later federate |
| `GAID-003` | `Private` | Minimum viable `AIDoc` publication | Resolved `AIDoc` sample | The implementation can resolve the required minimum fields for a governed private agent |
| `GAID-004` | `Private` | Validation continuity expression | `AIDoc` sample with `operating_profile_fingerprint` or equivalent state marker | A relying party can distinguish stable subject identity from current validated operating state |
| `GAID-005` | `Private` | Directory projection | `LDAP`, `SCIM`, or equivalent projection mapping | Internal IAM systems can reference the canonical private `GAID` without fragmenting identity |
| `GAID-006` | `Private` | Authorization class mapping | Mapping artifact from portable classes to local runtime policy | Portable authorization classes exist and are not treated as proof of present authorization by themselves |
| `GAID-007` | `Federated` | Badge evidence and assurance | Badge samples with evidence links, assurance level, and review or expiry metadata | A relying party can inspect what is claimed, for what scope, under what assurance, and with what evidence |
| `GAID-008` | `Federated` | Material-change invalidation | Badge lifecycle tests covering model, tool, or credential changes | Affected badges do not silently remain current after material change without explicit policy and evidence |
| `GAID-009` | `Federated` | Signed receipt issuance | Receipt samples with signature, trace context, and parent-child linkage | Consequential actions produce tamper-evident receipts that can be correlated and verified |
| `GAID-010` | `Federated` | Receipt verification | Receipt verifier output or test harness | The implementation can detect subject mismatch, stale receipt state, invalid signature, or broken parent linkage |
| `GAID-011` | `Federated` | Issuer trust and status checking | Trust-list publication or equivalent trust-anchor metadata | Verifiers can determine whether an issuer is recognized and whether current status material is fresh |
| `GAID-012` | `Public` | Public verifier flow | Demonstrated resolver flow for `GAID`, `AIDoc`, issuer status, and badge status | A relying party can validate the public subject without private prompts, secrets, or undisclosed internal data |
| `GAID-013` | `Public` | Public identity binding | Public certificate, domain-control proof, or approved decentralized binding | Publicly exposed identity is bound to an accountable organization or issuer-controlled trust anchor |
| `GAID-014` | `Public` | Privacy minimization | Public `AIDoc` and receipt samples | Public disclosures minimize unnecessary personal data and avoid leaking sensitive internal-only context |
| `GAID-015` | `All` | Conformance statement publication | Public or internal implementation statement naming profile and version | The implementation states what `GAID` profile and version it actually claims, plus known limitations or extensions |
| `GAID-016` | `All` | Qualification claim binding | `AIDoc` and badge samples naming the `GAID`, operating-profile fingerprint, `TAK-JSI` scheme, and job-profile version | A qualification can be resolved to exactly one assessed operational subject and scope |
| `GAID-017` | `Federated` | Qualification scope disclosure | Qualification badge with activities, exclusions, data/risk constraints, autonomy ceiling, evidence, and evaluator | A relying party can distinguish the qualified scope from declared capability and prohibited use |
| `GAID-018` | `Federated` | Qualification lifecycle status | Status and history tests covering pending revalidation, restriction, suspension, expiry, and revocation | Stale or invalid qualifications are not advertised as current and historical evidence is preserved |
| `GAID-019` | `All` | Qualification is not authorization | Verifier and runtime-integration tests | Resolving an active qualification never independently grants a token, entitlement, tool, or live action permission |

## Evidence Publication Guidance

Implementations should publish, at minimum:

- a conformance statement naming the claimed `GAID` version and profile
- one minimum viable `AIDoc` example
- representative badge and receipt samples
- issuer-status or trust-anchor validation material for federated or public profiles
- known deviations, compensating controls, or profile extensions

## Use in DPF

`DPF` should use this rubric as the first prototype assertion catalog for private `GAID`, `AIDoc`, badge, and receipt verification work, then extend it as public or federated identity features mature.
