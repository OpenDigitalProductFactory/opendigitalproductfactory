# Workroom data classification and admission

Status: proposed; independent baseline review required before implementation.
Backlog: BI-1F8CCBFF. Programme: EP-B932453F. Workroom: WC-23CB10A0.
Source examined: `0d827752665f790d3c4d3eba789ae908c45d78ba`.

## Problem and design grounding

A coworker can create and accept a room it cannot subsequently use. The exact-room
resolver substitutes Internal for an undeclared boundary, while the shared pure
helper substitutes Public. The helper also interprets a noncontiguous clearance
list as a rank: Public plus Confidential silently grants Internal. The authority
and provider gates elsewhere use explicit membership. Public source work is
therefore blocked by an accidental default, while other paths widen authority.

The 2026-09-27 read-only investigation of WC-54BD4138 found a denied
`claim_workroom_scope`, followed by an audited Public-to-Public/Internal grant
for AGT-EXT-CODEX and a successful claim. The room had no boundary classification.
That is evidence of the fallback defect, not grounds to grant every external
coworker Internal or to classify installation data Public.

Existing owners and contracts:

- [OAuth external build authority](2026-09-21-oauth-external-build-authority-design.md)
  owns principal binding, grant intersection and exact-room admission. This
  design replaces only its implicit Internal treatment of missing room labels.
- [TAK/GAID standards family](2026-04-18-tak-gaid-standards-family-design.md)
  remains the normative programme design. BI-9236453D maps this implementation
  specimen; BI-A484D58F owns composition; BI-2AB781FA owns portable conformance.
- [Data lifecycle convergence](2026-09-08-data-lifecycle-stewardship-convergence-design.md)
  and EP-A33A5C61 own metadata installation. BI-EA61F512 and BI-D9F158AF already
  repair catalog comments and convergence; this work must consume their output.
- `room-participation.ts`, `workroom-agent-access.server.ts`,
  `workspace-room-access.ts`, `workroom-boundary-claim.ts`,
  `actions/workroom-boundary.ts`, `work-capsule-store.ts`,
  `governed-work-claim.ts` and `mcp-governed-execute.ts` are the admission substrate.
- `Principal`, `PrincipalAlias`, `AgentToolGrant`, human capability resolution,
  `ModelProvider`, `AiProviderConnection`, provider suitability and inference
  screening retain their current authoritative responsibilities.

Intake similarity suggestions BI-A7797C2C (terminal review), BI-ADAC33D5
(measured autonomy) and BI-AAA13210 (terminal coherence) were inspected. They
do not own data admission; none is superseded or duplicated.

## Objectives

**OBJ-1:** Use explicit, independently checked human and coworker clearances and
exact-room roles for all workroom admission.

**OBJ-2:** Represent classification in the existing boundary and make absent or
invalid classification actionable before work is accepted.

**OBJ-3:** Provide an authorized, audited classification path that cannot silently
declassify private contents or widen action or provider permissions.

**OBJ-4:** Converge existing and fresh installations with one server contract and
reusable positive and negative conformance evidence.

## Authoritative stores and evaluation

No new policy table, duplicated sensitivity enum, client allowlist or provider
registry is introduced. `Workroom.scopeClaims.workroomBoundary.sensitivityCeiling`
is the room declaration until its owning normalization migration explicitly
supersedes it. Parent `WorkItem.evidence.workroomPolicy` can further restrict it.
Principal clearance stays on Principal. Tool grants remain AgentToolGrant.

Evaluate human authorization and tool scope, then canonical active coworker
identity and grants, then exact-room membership/role, then every applicable data
restriction, then the approved model/account/destination before processing.
Each condition narrows the result. A success in one condition never supplies
another. Recheck at use and egress; claim-time success is not a durable permit.

Clearance is an explicit set. Public plus Confidential does not imply Internal.
Use the canonical vocabulary in `@dpf/db/principal-sensitivity`; `critical` and
other unrecognized values are invalid, not aliases. Rank remains useful for
combining data classifications, never for inventing grants. Human emergency
administrative affordances do not transfer to a coworker or processing endpoint.

Missing classification is a validation state, not a fifth sensitivity level.
An admitted principal receives a stable classification-required reason and a
route to the existing boundary editor. Unrelated principals still receive
not-admitted; do not disclose private room titles or classifications to them.
Malformed labels fail closed with correction guidance, including for callers
whose explicit clearance includes Restricted.

## Defaults matrix

| Work | Explicit room declaration | Required data handling | Processing eligibility |
| --- | --- | --- | --- |
| Public development | Public, after confirming released source and synthetic fixtures | Both principals need Public plus real action grants and room assignment | Approved Public model/account/destination |
| Private development | Internal, or stronger where actual content requires it | Explicit applicable clearances; repository visibility supplies none | Reviewed connection admitted by current provider policy |
| Customer operations | Confidential where customer content warrants it | Customer/purpose scope plus applicable clearances; sensitive fields may be Restricted | Approved organization destination, residency and no-training requirements |
| Sensitive work | Restricted where content warrants it | Need-to-know role and explicit Restricted grants; credentials remain references | Only destinations allowed by the actual data policy; secrets are not prompt material |

These are named choices with explanations, not automatic classifications inferred
from a repository or client. Private installation logs, customer records,
credentials and unpublished security findings retain their actual restrictions.
The room envelope does not lower them. A Public room rejects private context or
directs an authorized person to a private workroom; it does not relabel the data.

## Ordered implementation and atomic delivery

The admission correction is one security change owned by BI-1F8CCBFF. These steps
are sequencing, not independently releasable features: enforcing classification
without the correction affordance strands users; accepting labels without the
authorization checks permits declassification; client-only checks are bypassable.

1. Add regressions to the shared room predicate and exact-room resolver for
   noncontiguous clearances, absent/invalid labels, Public source admission,
   unrelated rooms, observer/action separation and stricter parent restrictions.
2. Replace rank-based clearance with canonical explicit-set validation. Remove
   Public/Internal substitution in relevant admission resolvers. Preserve ordinary
   human administrative access for remediation, without admitting an AI through it.
3. Type and validate boundary input using the existing sensitivity vocabulary.
   Authorize changes from current server-side human identity and room ownership;
   record old/new classification and accountable actor in existing activity/audit
   records in the same transaction. Reject silent lowering of an existing label.
   Missing legacy labels require an explicit owner declaration; never infer Public.
4. Thread classification through existing creation/claim scope contracts and
   portal/MCP schemas. A draft may be created without it, with no accepted work
   lease. Acceptance, adoption and claim must preflight the current principals,
   membership/role and declared/inherited restrictions atomically. On failure,
   rollback active status, lease and ownership changes. Preserve idempotency.
5. Use the same server admission path for Build Studio and external clients.
   Provider eligibility remains an independent prerequisite: this change never
   treats a room label, executor name or invitation as a provider approval.
6. Update the boundary editor and external-client documentation with specific
   remediation. Run affected source tests and typecheck, then governed runtime
   acceptance and fresh-install verification. Publish through the normal PR gates.

## Acceptance contract

| ID | Objective | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Explicitly Public source-only room admits Public human and coworker with matching role and action authority; assignment alone does not admit Internal data. |
| AC-2 | OBJ-1 | Public plus Confidential clearance cannot access Internal, unrelated Public rooms remain inaccessible, and observer membership cannot mutate. |
| AC-3 | OBJ-2 | Missing or invalid classification produces actionable refusal before a work claim is accepted; failed preflight leaves no active lease or ownership widening. |
| AC-4 | OBJ-2 | Creation, adoption, resumed claims and retries use the same declaration; parent restrictions cannot be weakened by a Public child room. |
| AC-5 | OBJ-3 | Unauthorized boundary edits fail; authorized legacy classification is audited; lowering an existing classification cannot silently expose prior private content. |
| AC-6 | OBJ-3 | Assignment and Public visibility grant neither code modification, merge, deployment nor provider authorization; existing independent gates remain required. |
| AC-7 | OBJ-4 | Existing undeclared/invalid rooms receive correction guidance without bulk relabeling; fresh installs have the same explicit classification contract and no automatic Internal grant. |
| AC-8 | OBJ-4 | Build Studio, Codex, Claude, Grok and another MCP client produce equivalent admission results for the same principal, grants, data and destination inputs. |

## Migration, regression and release

No table migration is needed for the retained JSON boundary. Do not backfill
rooms Public from repository visibility, title, executor, contribution mode or
historical successful access. Inventory missing/invalid declarations using the
canonical reader, present them to authorized owners and keep remediation usable.
An existing explicit parent declaration remains an additional restriction, not a
reason to overwrite a room. Existing grants and connection approvals remain intact.

Test matrix includes absent, malformed, all four valid labels, noncontiguous and
empty grants, inactive principal, revoked participant, active observer, duplicate
claim retry, competing claims, parent/child conflict and transaction rollback.
Exercise fresh schema plus seed, repeated seed, existing rooms with no boundary,
legacy object-form boundary, and canonical array boundary without losing other
scope entries. Runtime evidence must name the served SHA. Worktree tests do not
prove deployed behavior or fresh-install convergence.

The temporary AGT-EXT-CODEX Internal grant remains unchanged during delivery.
After explicit Public rooms and the full processing path pass acceptance, use
the existing audited clearance editor to remove it only if no legitimate private
work still requires it. Removal is an operator permission decision, not a seed fix.

## Adjacent delivery slices and standards handoff

The complete reviewed policy also needs independently scoped work for:

- Provider seed/activation convergence and selected-connection egress: stop seeds
  from restoring broad hosted clearances; screen outbound MCP results and fallback
  routes against the actual approved processing destination.
- Restriction propagation across retrieval, tool results, attachments, memory and
  assembled model context, including private content associated with public repos.

These retain existing stores and screening/dispatch machinery. They are not
claimed as implemented or covered by this admission item's acceptance. The
programme baseline and conformance owners consume the resulting contract/tests;
the normative standard remains in its existing home. Portable tests must distinguish
what DPF controls from arbitrary local files or models an external client selects.

## Research & Benchmarking

[NIST SP 800-162](https://csrc.nist.gov/pubs/sp/800/162/upd2/final) supplies the
subject/object/action/environment decomposition. DPF maps its existing facts to
those dimensions without introducing another authority store.

Two open-source comparisons were inspected on 2026-09-27:

- [OPA data filtering](https://www.openpolicyagent.org/docs/filtering) separates
  single-resource decisions from authorized query results. Adopt this distinction
  for retrieval and discovery tests; reject adding a second policy service.
- [Cedar policy semantics](https://docs.cedarpolicy.com/policies/syntax-policy.html)
  make principal/action/resource explicit and a matching deny override permits.
  Adopt explicit narrowing and negative tests; reject duplicating DPF grants in
  Cedar policies or treating container membership as all-purpose authority.

These inform testable semantics. They do not certify DPF, replace the existing
kernel decisions, or justify claiming end-to-end protection before egress and
derived-context work is complete.
