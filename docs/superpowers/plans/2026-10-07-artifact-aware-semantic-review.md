---
status: draft
backlogItem: BI-AEEEFA15
---

# Artifact-aware semantic review

Backlog: BI-AEEEFA15. Workroom: WC-13456836. This is the remaining document
review slice of BI-A2A71149. Existing immutable-artifact primacy remains authoritative.

## Current evidence and choice

On d59fddea0ed58034ab52f7168a4c4ebaa5700d1d, direct execution of
`semantic-change-review.ts` produced identical spec/code-change prompts and
accepted a spec receipt as fresh for code-change with identical source hashes.
The operation already receives the artifact role but drops it at prompt and
identity construction. Running these pure functions eliminates provider,
transport and ambient checkout as causes of this reproduction.

Wording alone cannot fix receipt reuse. A separate document reviewer/store would
duplicate existing contracts. Extend the existing artifact enum through prompt,
receipt freshness, request validation, gate identity and local adapter instead.
Historical receipts remain unchanged and become stale when unsupported.

## Acceptance criteria

- A reviewer prompt explicitly treats the embedded digest-bound CODE CHANGES artifact as authoritative for an unpublished change.
- A stale or unrelated /workspace checkout cannot by itself cause cannot-verify when the artifact is non-empty and structurally valid.
- Empty, truncated, malformed, or identity-mismatched artifacts still fail closed.
- Tests reproduce the stale-workspace substitution and prove the reviewer evaluates the supplied diff.
- No publication, receipt, authority, grant, or GitHub protection is weakened.
- Publish through normal DCO, exact-tree CI, PR protection and merge queue; verify a live unpublished semantic review reaches a real verdict from the embedded diff.
- Artifact type selects relevant review expectations for spec, plan, code-change, architecture-decision, policy and research-question.
- A changed artifact type invalidates receipt reuse and semantic-review single-flight identity even when source hashes and risk match.
- Persisted request artifact type and identity must agree; mismatches fail closed.
- Historical receipts remain intact, and the legacy Build Studio code prompt remains compatible.

REQ-ARTIFACT-1: all acceptance criteria above bind this atomic repair.
CON-ARTIFACT-1: the existing semantic-review request, receipt and gate key share
one explicit artifact type; no filename inference or mutation of old evidence.
FLOW-ARTIFACT-1: input role -> coordination identity -> persisted packet -> routed
prompt -> receipt -> freshness/publication. Every boundary must preserve the role.
VER-ARTIFACT-1: role mutation, missing legacy role, mismatched packet role and
identical-hash/different-role single-flight tests, plus existing compatibility tests.

## Ordered implementation and verification

### Canonical contract and compatibility

The existing owner is `DeliberationArtifactType` in
`apps/web/lib/deliberation/external-review-activation.ts`: `spec`, `plan`,
`code-change`, `architecture-decision`, `policy`, `research-question`. Export its
values as the shared runtime tuple and derive the type and request validator from
it; remove the duplicate request tuple. This is an existing TypeScript/JSON
contract, not a Prisma enum. No relational column or database enum changes.

Persisted representations are the request in `TaskArtifact.parts`, the receipt in
`ExternalEvidenceRecord.details` and `WorkroomActivity.payload`, and the local
`dpf-semantic-review-gate.json` sidecar. `GateRunIdentity` hashes the role as part
of its evidence-plan identity. The CLI reads the same supported role registry;
it must bind an explicit requested role, never infer one from a filename or copy
the receipt's role as proof of what was requested. Build Studio supplies
`code-change` explicitly and retains its existing code prompt fixture.

Expand first: readers distinguish versioned legacy and new envelopes while
preserving raw historical bytes. Legacy requests may finish under their original
contract, budget and prompt, but their receipts cannot authorize the new role-bound
contract. New request writers emit the explicit role in both request and identity;
their parser requires equality. New receipts require role and a new schema/reviewer
version. New gate keys include role, so different roles never join one execution.
Old receipts remain readable for audit and are stale for new publication.

There is no backfill of inferred roles and no reset of in-flight tasks. Migrate
consumers in this atomic repair: request reader/writer, operation, prompt, gate
identity and CLI policy/sidecar. Test legacy packet execution separately from
new receipt freshness. Contract only after the old deadline/budget window drains;
removing historical read support is outside this repair. Rollback must continue
reading both envelope versions or leave new tasks explicitly unsupported without
dispatch; reverting may not reinterpret a new receipt under old semantics.

### Execution sequence

1. Add failing role-aware prompt/freshness tests. Preserve the existing Build
   Studio prompt fixture and immutable artifact primacy tests.
2. Propagate role through the existing operation, request schema, gate identity
   and local publication validator. Version changed contracts; refuse mismatches.
3. Run graph-linked tests: semantic-change-review, operation, request,
   enforcement, single-flight, authority, background, failure-readiness-publication
   and build-reviewers-compatibility; add gate identity and local adapter tests.
   Run package typechecks and the Style Drift Guard required by the claimed impact
   contract. Regenerate/check the document index for this new plan.
4. Record exact-tree canonical CI and independent semantic review, publish a DCO
   PR through protections and merge queue, then verify the canonical deployed
   unpublished-document review. Infrastructure failures remain inconclusive.

Steps are internal sequencing, not independently shippable deliverables: a prompt
without identity binding or an identity unsupported by consumers is incomplete.

## Risks and rollback

Risk: cross-role reuse, stale legacy receipt acceptance, or stranded in-flight
requests. Negative tests cover the first two; preserve old requests and report
unsupported versions without rewriting or resetting retry budgets. Revert source
through a protected PR if required; retain all persisted artifacts and receipts.
No schema migration, authority expansion or new queue is proposed.

| Failure | User effect | Prevention and detection | Containment and recovery |
| --- | --- | --- | --- |
| Role omitted or changed | A document is approved using code criteria or another role's receipt. | Require one enumerated role across request, prompt and freshness; mutation tests hold all hashes constant. | Refuse mismatches; preserve source and old receipt; request an exact fresh review after correction. |
| Gate-key collision | Unrelated role reviews share execution and return the wrong verdict. | Include role in gate identity; simultaneous same-hash/different-role tests assert distinct tasks. | Preserve both requests; fail closed on mismatch; resume only the correctly bound request. |
| Stale checkout or missing artifact | Reviewer approves different bytes or invents findings about unavailable material. | Keep embedded-artifact primacy; test stale checkout, empty/truncated input and digest mismatch. | Return inconclusive with missing reference; restore immutable source without changing receipt history. |
| Mixed-version rollout | Queued reviews strand or old receipts bypass new expectations. | Versioned readers before writers; legacy/new fixtures and deadline-preservation tests. | Drain original tasks under original contracts; old receipts remain stale for new publication; rollback retains read compatibility. |

BI-AEEEFA15 owns these residual risks. The current documentation gate proves only
document integrity. It does not prove the proposed mitigations work. Before
implementation publication, each row requires passing final-change regression
evidence, canonical CI and independent review; live acceptance remains a separate
obligation. A plan review judges the design and this verification strategy, not
unwritten implementation. No hypothetical test is recorded as passed.

## Backlog coverage

Atomic deliverable ARTIFACT-REVIEW maps to BI-AEEEFA15 with no new child item.
Live immutable plan coverage is pending; this file alone grants no admission.
