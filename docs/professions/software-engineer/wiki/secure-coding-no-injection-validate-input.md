---
title: Never trust input — validate, encode, and parameterize
pageKind: principle
status: published
abstract: Untrusted input must be validated, output-encoded, and bound as parameters — never concatenated into an interpreter string. Injection and broken access control remain the top web application risks.
principleTier: commandment
principleWeight: 0.2
principleWeightRationale: Specialist profession rule — full-strength within its profession ring, weighted light in cross-domain aggregation so profession rules cannot collectively outvote engineering doctrine on decisions they have no bearing on (BI-68553F96 golden-decision drift; calibrated against the quick-vs-proper-normal margin floor).
principleDirection: Treat all external input as hostile; parameterize queries, encode output, and enforce authorization server-side by default.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "public_safety": 1.0, "blast_radius": -0.9}
professionCompetencyLevel: foundational
sources:
  - owasp/top-ten
  - owasp/asvs
---

## Rule

Every value that crosses a trust boundary — request parameters, headers, cookies, uploaded content, third-party API responses — is hostile until proven otherwise. Validate it, encode it for the context it lands in, and bind it as a parameter. Never concatenate it into a SQL string, shell command, HTML document, or any other interpreter input.

Authorization is enforced **server-side, deny-by-default**. The client is never trusted to scope its own access.

## Why

The OWASP Top 10:2025 ranks **Broken Access Control (A01)** as the most critical web application security risk and lists **Injection (A05)** among the ten most critical. Both share a root cause: code trusting data it should not.

The OWASP Application Security Verification Standard (ASVS) provides the testable controls that close these gaps — it covers injection and cross-site-scripting defenses as a security baseline and is intended to be used as a security metric, as implementation guidance, and as a procurement specification.

## Applies To

Any AI coworker generating or reviewing code that handles external input, constructs queries, renders output, or makes an authorization decision. The rule does not relax for "internal tools" or "trusted callers" — those framings are how injection and access-control failures ship.

## How To Apply

1. **Parameterize.** Queries use bound parameters, never string interpolation. (See the data-architect commandment [[professions/data-architect/parameterized-queries-commandment]] for the SQL-specific form.)
2. **Encode on output.** Encode for the exact sink — HTML, attribute, URL, JS — to prevent cross-site scripting.
3. **Authorize server-side.** Deny by default; check every request against the caller's actual permissions, not a client-supplied role.
4. **Verify against ASVS.** Map the relevant ASVS requirement IDs (e.g. `v5.0.0-1.2.5`) to tests in CI.

## See Also

- [[professions/software-engineer/owasp-top-ten]]
- [[professions/software-engineer/owasp-asvs-summary]]
- [[professions/software-engineer/dependency-supply-chain-integrity]]
