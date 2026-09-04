---
status: active
---

# Provider trust status honesty

**Backlog:** BI-231CA01C  
**Status:** implementation-ready

## Problem

The provider detail page currently labels any non-current restricted-routing claim as **Action needed**. That contradicts a successfully saved account declaration, implies a provider-wide fault, and tells operators to add evidence even when no evidence workflow exists on the page. The empty processing-region input also uses `eu, uk` as a placeholder, which resembles saved data.

## Decision

Keep routing and evidence semantics unchanged. Change only the provider-page projection:

- A valid account declaration is acknowledged independently from restricted-work eligibility.
- Missing or non-current claims produce a count and the consequence: sensitive/restricted work remains blocked; general work is governed separately.
- Claims captured by the account form point to that form. Contract-only claims such as a DPA state plainly that this page cannot capture them and that reviewed supplier evidence must be linked through platform governance.
- The page never labels the whole connection as faulty solely because restricted-work evidence is incomplete.
- An empty region field renders no example value inside the input. Adjacent help text explains the empty state and supplies examples outside the control.

The existing `AiProviderConnection`, `SupplierContract`, `ComplianceEvidence`, and `resolveProviderTrustEvidence` paths remain the source of truth. No routing policy, evidence classification, schema, or authorization changes.

## Objective manifest

**OBJ-PROVIDER-TRUST-TRUTH:** Present provider trust evidence as scoped routing restrictions with honest consequences and available next actions, without contradicting a saved account declaration or weakening fail-closed policy.

| Acceptance ID | Objective IDs | Statement |
|---|---|---|
| AC-PROVIDER-TRUST-1 | OBJ-PROVIDER-TRUST-TRUTH | A saved account declaration is acknowledged independently from restricted-work evidence status. |
| AC-PROVIDER-TRUST-2 | OBJ-PROVIDER-TRUST-TRUTH | Missing DPA and region evidence states that restricted work remains blocked and names whether resolution is available on this page. |
| AC-PROVIDER-TRUST-3 | OBJ-PROVIDER-TRUST-TRUTH | An empty processing-region value cannot be mistaken for saved example regions. |
| AC-PROVIDER-TRUST-4 | OBJ-PROVIDER-TRUST-TRUTH | Claim-state tests, production verification, documentation, and live desktop and narrow-page checks pass. |

## Research & benchmarking

This follows established assurance-UX patterns used by current cloud security and identity consoles. Microsoft Entra distinguishes policy outcomes such as success, failure, user action required, and not applied instead of collapsing them into one account-health alarm ([Microsoft Learn](https://learn.microsoft.com/en-us/azure/active-directory/conditional-access/concept-conditional-access-report-only)). AWS Security Hub separately derives control status from scoped findings and links failed findings to remediation guidance ([status model](https://docs.aws.amazon.com/securityhub/latest/userguide/controls-overall-status.html), [control details](https://docs.aws.amazon.com/securityhub/latest/userguide/securityhub-standards-control-details.html)). DPF adopts that separation, scoped consequence, and explicit next action. It rejects a single red/amber provider-health badge because evidence can be sufficient for public work while still insufficient for restricted work, and rejects controls that imply an unsupported upload workflow.

## Acceptance

- A saved declaration is not contradicted by a generic page-level alarm.
- Missing DPA/region evidence is described as a restricted-work limitation.
- Every non-current claim names either an available on-page action or the absence of an on-page evidence workflow.
- Empty regions cannot be mistaken for saved `eu, uk`.
- Valid, missing, expired, rejected, conflicting, and superseded claim display remains covered.
- Focused tests, production build, UX-fit review, and live provider-page verification pass.
- Operator documentation uses the revised language.

## Risks and controls

- **False reassurance:** copy explicitly says restricted work stays blocked; routing code is untouched.
- **Invented workflow:** contract claims explicitly say the page cannot capture them.
- **Status regression:** tests exercise all six claim states and both complete/incomplete summaries.
