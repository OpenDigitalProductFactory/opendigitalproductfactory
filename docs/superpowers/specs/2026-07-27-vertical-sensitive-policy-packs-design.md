# Vertical Sensitive-Data Policy Packs Design

**Date:** 2026-07-27  
**Backlog:** BI-F6018DB3  
**Epic:** EP-DATA-GOVERNANCE  
**Decision ledger:** DI-4485266A1EB6

## Problem

The pre-dispatch inference screen already detects governed data, evaluates the
canonical data policy decision point (PDP), masks replaceable values, constrains
provider routing, and records privacy-safe receipts. Its platform defaults are
intentionally broad, however: they do not distinguish a protected customer
record from clinical data, legal privilege, criminal-justice information, a
youth-safety record, or a credential.

That missing distinction creates two unsafe outcomes:

1. a protected transform can make every regulated class look equally eligible
   for external processing; and
2. provider/setup copy can imply a compliance conclusion that DPF does not have
   enough jurisdiction, contract, purpose, or authorization evidence to make.

## Design grounding

- Existing specs/plans reviewed:
  `docs/superpowers/specs/2026-07-17-data-management-governance-design.md`,
  `docs/superpowers/specs/2026-07-19-ai-provider-suitability-routing-design.md`,
  `docs/superpowers/specs/2026-06-28-regulatory-autonomy-ceiling-policy-design.md`,
  and `docs/superpowers/plans/2026-07-26-pre-dispatch-sensitive-llm-routing.md`.
- Current code substrate reviewed:
  `apps/web/lib/govern/data/policy-decision.ts`,
  `apps/web/lib/govern/data/executable-policies.ts`,
  `apps/web/lib/inference/data-screening/`,
  and `apps/web/lib/routing/provider-suitability/`.
- Live backlog reviewed: BI-3D210AF8, BI-DG-009, BI-DG-012,
  BI-AIPS-003, BI-AIPS-006, and BI-40CD8ACD.
- Open-PR sweep: no overlapping sensitive-data, PDP, or vertical-policy PR.
- Source of truth: the data-governance PDP remains the only policy authority;
  provider suitability may narrow its outcome but never widen it.

## Standards grounding and claim boundary

The packs are conservative technical routing defaults, not legal advice,
certification, or a declaration that an organization or provider is compliant.
Applicability still depends on jurisdiction, activity, contracts, purpose,
authorization, and current law.

The initial boundaries are grounded in:

- [HHS HIPAA Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html):
  administrative, physical, and technical safeguards for electronic PHI.
- [FTC Safeguards Rule](https://www.ftc.gov/legal-library/browse/rules/safeguards-rule):
  safeguards for customer information and oversight of service providers.
- [FBI CJIS Security Policy](https://www.fbi.gov/services/cjis):
  appropriate protection of criminal justice information.
- [U.S. Department of Education FERPA guidance](https://studentprivacy.ed.gov/ferpa):
  disclosure controls and records for education-record PII.
- [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions):
  parental-consent, minimization, and retention constraints for child data.
- [EEOC ADA confidentiality guidance](https://www.eeoc.gov/laws/guidance/ada-primer-small-business):
  narrow access and separate protection for employee medical information.
- [ABA Model Rule 1.6](https://www.americanbar.org/groups/professional_responsibility/publications/model_rules_of_professional_conduct/rule_1_6_confidentiality_of_information/):
  reasonable efforts against unauthorized client-information disclosure.
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10)
  and [NIST SP 800-53 Rev. 5](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final):
  governed human-AI roles, risk management, access control, and least privilege.

## Decision

Compile each detected inference data class into the existing canonical governed
asset, category, sensitivity, and residency vocabulary. Select the relevant
versioned pack rules, evaluate every class through the existing PDP, and combine
effects using the existing precedence lattice.

WWMD compared:

1. a sidecar vertical evaluator;
2. inference/vertical axes added to the generic PDP; and
3. canonical asset compilation through the existing PDP.

The ordered third option scored 12.302 with a 3.015 high-confidence margin,
strong structured coverage, and no commandment conflict. The MCP response
omitted rendered option IDs, so the ledger is referenced by ordered description
rather than an invented label.

## Pack contract

Each pack is immutable code configuration with:

- stable pack ID and semantic version;
- one governed inference data class and canonical `data:*` asset;
- applicable archetype categories for explanation and setup guidance only;
- public-provider eligibility (`never`, `protected-only`, or
  `approved-with-evidence`);
- protected external effect (`allow-with-obligations`, `review`, or `deny`);
- masking eligibility and material-detail behavior;
- disclosure/refusal and retention prompt codes;
- required provider evidence labels;
- authority references; and
- executable policies evaluated by the existing PDP.

Archetype applicability never weakens classification. Health data discovered in
a legal or home-service workflow receives the health-data boundary because the
data class, not the storefront label, is authoritative.

## Initial pack matrix

| Data class | Protected external boundary | Public/non-enterprise posture | Human boundary |
| --- | --- | --- | --- |
| Customer records | approved cloud + use log | protected only | authorized purpose/surface |
| Employee/HR records | approved cloud + use log | protected only | manager/role scope on disclosure |
| Payments/finance | approved cloud + use log | protected only with financial evidence | review for regulated decisions |
| Health/clinical | approved cloud + use log | protected only with health/contract evidence | authorized care/operations purpose |
| Student records | approved cloud + use log | protected only with student-data terms | authorized school purpose |
| Youth-sensitive | review | never by default | verified guardian/authorized role |
| Legal privileged | review | never by default | authorized legal role |
| Criminal-justice information | deny | never | governed CJIS boundary only |
| Safety-sensitive | review | never by default | accountable human checkpoint |
| Public-sector records | review | never by default | authorized agency purpose |
| Security logs | approved cloud + use log | protected only | security/fraud purpose |
| Regulated decisioning | review | never by default | human decision owner |
| Source code | approved cloud + use log | protected only | repository authorization |
| Secrets/credentials | deny | never | omit/rotate; never send |
| Unknown governed data | deny | never | classify before dispatch |

`approved cloud` is still conditional on provider-suitability evidence. A pack
never adds an allowed provider and cannot override a provider denial.

## Runtime flow

1. The classifier emits one or more governed inference data classes.
2. The pack registry resolves a canonical data profile for every class.
3. The inference PEP creates one PDP context per class, plus any explicit
   governed asset context.
4. Every decision uses the existing precedence lattice; effects and obligations
   are combined conservatively.
5. Untransformed restricted data remains local-only.
6. A verified mask/token transform may move eligible packs to
   `approved_cloud`; `review` and `deny` packs remain local-only.
7. Provider suitability intersects provider allowlists, unions denials, and may
   further tighten residency.
8. The receipt stores only hashes, decision/version IDs, pack versions, data
   classes, effects, obligations, and explanation codes.

## Refactoring allocation

Approximately 20% of implementation capacity is reserved to remove the duplicate
data-class-to-asset/category/sensitivity mapping currently split between
provider suitability and inference screening. One exported workload-profile
resolver will serve both consumers, and combination/deduplication helpers will
remain pure and independently tested.

## Risks and rollback

- **False positives:** narrow deterministic/path fixtures and governed hints
  outrank broad prose inference. A false positive narrows routing; it never
  widens it.
- **Compliance overclaim:** docs and explanations describe evidence and next
  actions, never “compliant” or “certified.”
- **Policy conflict:** the existing precedence/effect lattice resolves conflicts;
  pack array order has no authority.
- **Unenforceable obligations:** the inference PEP capability check fails closed.
- **Rollback:** remove the pack registry from inference policy composition and
  revert the three added classes. Generic restricted/confidential defaults remain
  intact, so rollback returns to the current conservative baseline.

## Verification

- Fixture coverage for clinical, financial, legal, CJI, safety, youth, HR,
  source-code, credential, and customer records.
- Pack registry invariants: unique IDs/versions, full class coverage, valid
  canonical profiles, authority links, and enforceable obligations.
- PDP tests for allow-with-obligations, deny, review, unknown context,
  precedence, and protected-transform behavior.
- Screen tests proving residency can only tighten and receipts contain no raw
  payload values.
- Provider-suitability tests proving pack results cannot add providers.
- Full web tests, typecheck, production build, and local merged-code gate.


## 2026-10-25: Invoice prose at committed-review admission

BI-12CD3010 repairs a confirmed input-detector defect. It does not change the
PDP, provider clearance, residency policy, or action authority.

The exact retained request in WC-CD6F907A, for committed head
aeeafe0ca70a25696a8d077b157611cecb63ee36, contains an Invoice table type example
and Compensation in rollback prose. The former matched payment-or-finance-text;
the latter matched employee-record-ambiguous-term. A precise finance match
made the shared corroboration predicate true, selected both vertical packs,
and produced restricted/local_only. Both branch checkpoints record
providerOutcome: not-dispatched. This is eligibility refusal, not provider outage.

The parser-validated reconstruction reproduces the Change Reviewer's original
screening input hash:
dce97f90a558e8d01dc3cb7c039094cc04d4a98c2c0097c9d5382fe53b2f3895.
The same unchanged input with the repair retains the ambiguous employee match
for audit, measures confidential, selects no vertical pack, and permits normal
residency. Raw values are not stored in the screening receipt.

Free-text invoice detection now requires a reference, date or amount. Bare invoice
vocabulary does not establish a payment record. Structured finance fields,
other precise detectors, governed classifications, explicit sensitivity floors,
local-only settings and embedded protected values retain their controls.
One data-only match set and one corroboration result feed both sensitivity and
PDP class derivation. Public repository provenance never exempts embedded data;
this review contract supplies no authoritative public-source classification,
so the internal caller floor remains.

The saved exclusion list contains first decisive failures: 13 residency,
7 clearance and 7 structuredOutput per branch. Removing a classification
defect does not establish that every endpoint meets context/output capacity,
structured-output, suitability or other independent requirements. The reviewer
attaches no tools and does not require streaming; its actual prompt determines
the context floor, including a 16,384-token completion reserve.

### Separate approval findings and supported remedies

Read-only samples establish distinct causes, not one common context-loss root:

- A scheduled evidence writer had an empty authorityScope, no delegation chain,
  and a server-resolved Propose boundary. Owner intent must reach the recorded
  mandate before execution; a task objective alone is not a grant.
- A handoff carried connection delegation but consequence refinement reported
  handoff-boundary-unproven. Prove the exact handoff boundary or obtain its
  action-specific authority; an unrelated approval cannot supply that proof.
- A scheduled initiative writer lacked an immutable review binding and later
  failed with AUTHORIZATION_DENIED: authenticated reviewer, authority decision and token scope are required. The policy projection labels this a human decision, while the
  technical writer still needs valid artifact and actor provenance.

BI-035BE8D1 and BI-331DBAD1 retain preflight ownership; BI-C5E51A15 owns bounded
consequence/intent calibration, BI-39946DC1 delegated GPP lineage, BI-8E7F0276
required-tool admission and BI-412A2F72 unchanged scheduled refusals.
The samples are shadow analysis only: no historical approval was approved,
replayed, or used to change live authority. Other text-only domain detectors
remain a separately testable precision concern; this repair proves the observed
invoice case rather than asserting universal record recognition.

### Verification and recovery boundary

The first regression run failed on five schema/prose cases. The repair passes
82 focused tests in its initial pass; the final expanded run passes 335 tests across 20 screening, memory, reviewer and authority suites. The latter
include exact active approval, changed parameters/subject, expired authority,
revoked grant, narrowed room and immutable binding controls. These are
source-local results, not live cross-surface conformance.

The original review deadline elapsed at 2026-10-25T16:45:39.665Z. Preserve that
execution and its evidence. After canonical deployment, use the server's
qualified expired-successor path against the unchanged committed source;
reconcile source/failure-evidence identity if that path requires a refreshed
request. Never reset budgets or claim an unavailable semantic review passed.

Plan: [context handling repair](../plans/2026-10-25-context-handling-repair.md).
Coverage receipt: cmvo2de7x6j3t01mu43fxnqtl, atomic BI-12CD3010.

