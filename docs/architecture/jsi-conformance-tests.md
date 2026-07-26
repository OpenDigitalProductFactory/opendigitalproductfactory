# TAK-JSI Suggested Conformance Assertion Rubric

## Purpose

This companion provides a suggested assertion rubric for the
[Job-Specific Intelligence (`TAK-JSI`)](job-specific-intelligence.md) qualification profile. It
makes job-definition, assessment, qualification, and revalidation claims reviewable without
creating a central certification authority.

## Core Assertion Set

| Assertion ID | Profile | Requirement under test | Minimum evidence | Pass condition |
|---|---|---|---|---|
| `JSI-001` | `Defined` | Versioned job profile | Profile identifying activities, outcomes, knowledge, tools, data, oversight, exclusions, and owners | Every assessed activity has an unambiguous versioned scope and accountable owner |
| `JSI-002` | `Defined` | Versioned qualification scheme | Scheme with assessment methods, critical failures, thresholds, validity, surveillance, and revalidation | The decision procedure is reproducible and does not permit weighted averages to hide critical safety failures |
| `JSI-003` | `Defined` | Profession and decision-doctrine binding | Stable `WSID` or equivalent corpus and decision-axis references | Assessors can identify the knowledge and judgment basis used by the job profile |
| `JSI-004` | `Defined` | Stewarded data scope | Named steward, classification, purpose, quality, freshness, residency, retention, and prohibited-use rules | Evaluation and operation have explicit, enforceable data boundaries |
| `JSI-005` | `Assessed` | Operating-profile binding | `GAID`, fingerprint, model/router, instructions, tools, memory, grants, and human configuration in the record | Results cannot be silently transferred to a materially different operating profile |
| `JSI-006` | `Assessed` | Representative job evaluation | Scenario pack and results covering normal, boundary, adversarial, abstention, and escalation cases | Evidence reflects the intended job, tools, data, workflow, and consequence conditions |
| `JSI-007` | `Assessed` | Eligibility before ranking | Router tests across data, residency, provider, modality, tool, context, and capability constraints | No quality, cost, or latency score admits an ineligible model or provider |
| `JSI-008` | `Assessed` | Routed-profile floor | Tests for every approved route and fallback path | Routing and failover preserve the scheme's minimum job, data, and evidence floor |
| `JSI-009` | `Assessed` | Proactivity separation | Tests varying initiative with fixed qualification and authority | Proactivity does not create qualification, widen scope, or bypass oversight |
| `JSI-010` | `Assessed` | Golden Triangle separation | Tests varying cost, quality, time, reasoning, review, and retry posture | Additional resources do not substitute for missing competence or weaken a hard control |
| `JSI-011` | `Qualified` | GAID-carried qualification status | Verifier-readable qualification claim with scope, status, evidence, issue/review dates, and exclusions | A relying party can validate who is qualified, for what, under which operating profile, and until when |
| `JSI-012` | `Qualified` | TAK-enforced autonomy ceiling | Runtime policy and action traces for qualified, out-of-scope, stale, and revoked cases | Effective autonomy never exceeds qualification, authority, data, regulatory, or evidence ceilings |
| `JSI-013` | `Qualified` | Surveillance and regression | Operational monitoring, incident, drift, and autonomy-regression evidence | Qualification and autonomy narrow when evidence or conditions deteriorate |
| `JSI-014` | `Qualified` | Material-change revalidation | Change-impact tests for model/router, instructions, tools, corpus, axes, data policy, and runtime dependencies | Material change enters revalidation unless documented continuity evidence satisfies the scheme |
| `JSI-015` | `All` | Claim-boundary integrity | Public statement, badge, or implementation declaration | Defined, assessed, tested, qualified, authorized, and autonomous are never represented as synonyms |

## Evidence Publication Guidance

Implementations should publish or retain:

- a conformance statement naming `TAK-JSI` version and profile
- the job profile and qualification-scheme identifiers
- an assertion-to-evidence map
- the assessed operating-profile fingerprint
- results, limitations, exclusions, surveillance cadence, and current status
- protected references rather than sensitive evaluation data

## Use in DPF

DPF should apply this rubric first to a bounded software-development or architecture-review job
profile, then reuse the mechanism for other professions without carrying over the qualification
claim. Runtime implementation remains tracked separately from this standards-documentation sweep.
