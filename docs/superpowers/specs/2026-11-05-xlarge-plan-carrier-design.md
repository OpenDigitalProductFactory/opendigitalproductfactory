---
status: draft
backlogItem: BI-43E281BF
date: 2026-11-05
---

# Governed source provenance for a delegated parent plan

Backlog: BI-43E281BF. Epic: EP-129D11FD. Design carrier: WC-F35526EF, `fix/xlarge-plan-carrier`, source baseline `765a432c2c6c1ceb6009a8b390c4e7691a85b2a2`.

This is a proposed repair of two existing contracts. It grants no permission by publication. The xlarge parent keeps its read-only shape and cannot enter implementation. The current refusal remains in force until reviewed source is delivered and its real native path is verified.

## Problem and evidence

BI-FECE4497 has current planning admission IRD-112A7DA5CDF8, an approved scope baseline and six existing delivery children. Its xlarge Workroom cannot provision or adopt source. The existing D1 child BI-06EAE6C6 was admitted for design preparation in WC-7ED61BA6 and actually authored the immutable parent plan:

- repository: `OpenDigitalProductFactory/opendigitalproductfactory`;
- branch: `feat/stakeholder-assessments`;
- commit: `37e0b6e23b9960d89bfbedfcfe6f48936fe24b8a`;
- path: `docs/superpowers/plans/2026-10-25-stakeholder-concern-integration.md`;
- provider blob: `63238fc59df85d97cc630a9cb3f97837b48ad7a6`.

The signed commit was normally pushed after documentation evidence `cmw42jnmu0ojy01o90uckzw58` and independent semantic plan receipt `cmw42n00m0p4v01o9i818s5d9` passed. Those are document-publication evidence, not stakeholder feature delivery or decomposition coverage.

After the parallel upgrade completed, the native coverage writer returned `plan-artifact-invalid`: no live parent Workroom records the plan commit; WC-774D012F records historical design head `a6fb2bf2026db4e3e86785dbf7b5e7c9fb0b6415`. Its proposed adoption of the child's commit would misstate the parent's source. No such adoption, shape change, session substitution or external-evidence synchronization was performed.

Source confirms the conflict: `repository-artifact.ts` selects source rooms by the requested subject, while `plan-backlog-coverage.ts` additionally requires one exact live parent head and provider-corroborated creator. `delivery-shapes.ts` deliberately gives xlarge only `tool:read`.

A subsequent scope-enrollment hold during release finalization resolved when the canonical retirement evidence appeared; one corrected scope claim succeeded. That transient condition is not part of this repair.

## Existing design and ownership

Retain the contracts in [worktree provisioning under GPP](2026-10-14-worktree-provisioning-under-gpp-design.md) and [governed plan-coverage reachability](2026-08-23-governed-plan-coverage-reachability-design.md). Reuse `RepositorySourceAdmission`, `InitiativeReviewBinding.workroomRef`, the canonical principal/access resolvers, existing scope claims, scope baseline, provider blob reader and plan-coverage receipt. No new directory, permission service, table, lifecycle or job is proposed.

BI-595F388E owns already-accepted inherited-plan and same-item current-head revalidation. Its canonical proof and negative cases must be preserved. This repair addresses FIRST parent coverage through a different admitted source carrier. Recheck live path ownership before claiming shared resolver, canonical-plan-source or coverage modules. A status of in-progress without an active room does not transfer its ownership.

## Options and decision boundary

1. **Delegated planning carrier (proposed design):** retain the parent envelope; let the existing coverage writer accept a specifically authorized actual carrier with source and author proof. This adds a bounded source relationship to existing proof/receipt handling and needs careful bootstrap validation.
2. **Parent planning-write capability:** create an enforceable planning-only envelope across shapes, provisioning, hooks and all source clients. A generic worktree grant cannot enforce a document-only restriction. This is a larger capability change and is outside this repair.
3. **Keep the existing contract:** retain refusal and leave first coverage unavailable for the observed case.

WWMD DI-DF9F781C8C6E was unusable without structured features. DI-70142DA085D5 used explicitly provisional ordinal estimates and recommended option 3, with no commandment conflict. That result is retained: the current contract is not bypassed. Option 3 does not fulfill the operator's delivery objective; option 1 is presented for independent design/security judgment rather than treating the numeric result as new authority. Until that judgment accepts a lawful replacement, no source binding is widened. Do not re-score merely to obtain a preferred answer.

## Objectives

- **OBJ-PC-1:** Make first parent plan coverage reachable through true admitted source provenance.
- **OBJ-PC-2:** Keep source access, actor authority, scope approval and independent review separate.
- **OBJ-PC-3:** Use one canonical proof across capture, validation and downstream plan review without overwriting historical heads or duplicating BI-595F388E.

## Proposed contract

The existing `record_plan_backlog_coverage` interface may accept an optional `planSourceWorkroomId` locator. It is untrusted selection input, never an authority/proof token. Omission retains the existing directly authored subject path. No implicit first-match fallback is permitted.

The server constructs a `RepositorySourceAdmission` only after resolving current authenticated human/assistant identity and action access to both the parent planning context and selected carrier through existing access resolvers. Grant intersection, clearance, organization and subject authorization remain mandatory. The carrier must be live, unambiguous, on an admitted delivery shape, scoped to edit the exact canonical plan path, and actually bound to the declared repository, branch and immutable head. Its bound child must be one of the proposed real independently shippable deliverables. This is a new parent planning handoff within the existing coverage action, not permission to act for an unrelated subject.

The parent must currently allow planning under its authoritative classification and approved baseline. The complete decomposition must pass existing graph, live-BI and four-way baseline traceability checks. A named child alone, a checkpoint, an arbitrary path claim or caller text cannot establish this relationship. No first coverage is inferred from an already-accepted canonical proof that does not yet exist.

Resolve the provider commit, exact path/blob, DCO identity and canonical accountable author before publication. The carrier's actual creator must corroborate that author. Do not replace the artifact author with the parent's owner or current reviewer. The author's own signed source cannot satisfy an independent review.

Extend the existing immutable artifact resolver with the server-constructed admitted source selection; retain the actual requested parent subject. A caller cannot supply a callback, proof object, verified flag or author identifier. Reuse the provider reader and principal corroboration instead of introducing a second artifact parser. Repository selection must still follow canonical/private-source rules; this repair does not admit arbitrary public repositories.

## Transaction and durable provenance

Provider I/O remains outside the serializable transaction. Capture the parent baseline/admission inputs, selected carrier identity, exact edit scope, actor admission and source/author facts. Under the existing parent lock, re-read and lock the actual carrier and relevant mutable authority/scope rows in a deterministic order. Validate the same captured facts immediately before appending coverage; a concurrent change refuses the attempt and writes no partial receipt. Merely rechecking a head outside the transaction is insufficient.

Retain baseline-bound schema-v2 semantics for this xlarge parent. Add an optional typed source binding to the existing receipt using the canonical `workroomRef` shape plus actual source subject and accountable author. The new writer always records it for delegated capture. Do not choose schema v3 to escape an existing baseline. Reader validation must reject partial, forged, inconsistent or unrecognized delegated binding; legacy directly authored receipts retain their existing meaning and gain no delegated authority by absence of the field.

`loadCanonicalPlanSource` derives downstream proof only from the latest valid baseline-bound coverage that actually maps the child. Propagate the captured source author and immutable locator without making every child pretend to own the original commit. Reuse BI-595F388E for already-accepted plan lifecycle handling: first capture requires a live carrier; later lawful source branch retirement is distinct from revocation of accepted plan/scope authority. Mapping removal, changed baseline, changed blob or revoked authority must invalidate applicable current proof. Never revive an older pass after a newer invalid row.

The proof is evidence about a plan's origin. It grants neither worktree provisioning nor implementation, mutation or post-implementation acceptance. Parent and child readiness still evaluate their own actual remaining requirements.

## Acceptance criteria

These are the live item's criteria, retained verbatim:

- AC-PROVENANCE: the true immutable provider commit/blob and accountable author remain traceable through the approved parent plan and admitted source carrier; no fabricated parent source head.
- AC-REACH: the six existing mapped children can receive valid parent scope/coverage through the native writer after all actual prerequisites pass.
- AC-REFUSAL: foreign/unmapped carrier, wrong organization/author/repository/head/blob, archived or ambiguous carrier, provider outage and concurrent source/scope change refuse without writing coverage.
- AC-ENVELOPE: xlarge implementation and unadmitted worktree provisioning remain refused; no direct DB or external evidence bypass.
- AC-REGRESSION: existing directly authored parent plans, ordinary independent plans, inherited child baselines and historical immutable receipts retain their contracts. Meaningful red-green tests cover actual resolver/writer locking and native happy-path verification follows canonical release.

AC-REFUSAL's archived-carrier case applies to first capture; accepted immutable evidence follows the explicit lifecycle/revocation distinction above.

## Ordered implementation and verification

1. Complete this proportional design and author research receipt; obtain independent design/security assessment of the proposed handoff. Keep current native refusal until that assessment accepts the contract. Refresh ownership and claim exact paths before source implementation.
2. Add failing regressions through the real artifact resolver and coverage writer: approved parent plus admitted true child carrier, explicit selection and actual differing source heads. Assert the parent head is never updated. Do not stub the entire resolver to success.
3. Exercise negative actor/source/subject/mapping cases, revoked membership and grants, absent scope claim, bad author alias, wrong blob, unavailable provider and ambiguous rooms. Each refusal must leave the coverage activity count unchanged.
4. Exercise source, scope and authority changes between provider read and transaction publication using the real locked boundary in the governed database. A retry after supported input repair is a new attributable attempt.
5. Refactor shared source selection/proof validation into one internal home used by writer and reader. Proposed source seams: `mcp/packs/decomposition-pack.ts`, `planning/plan-backlog-coverage.ts`, `backlog/initiative-readiness/repository-artifact.ts`, `canonical-plan-source.ts` and their owning tests. File paths are design seams, not blanket edit claims. Avoid enlarging the already large coverage module with duplicated policy.
6. Run affected suites and web typecheck, applicable architecture/security/module guards, exact-tree integration evidence and independent committed-change review. Use canonical runtime/shared nonproduction for database-bound cases; no per-worktree runtime or live production mutation.
7. Publish through a signed protected PR and queue. Advance the DEV install only through its canonical release path. Verify the original native parent coverage request with the actual admitted carrier; then request original parent plan review and each real child admission. No prior receipt, source head or historical UNKNOWN execution is rewritten.

This repair is atomic: the admitted source selection, transaction proof and receipt/reader validation cannot ship independently without accepting evidence one side cannot verify. It is not a new independently shippable stakeholder deliverable. Record whatever live plan coverage current readiness requires; a Markdown statement is not a receipt.

## Research and benchmarking

This is a bounded defect repair, not a new feature framework. The two approved designs above are the applicable architectural baselines. Current source and native reproduction establish that read-only parent admission and exact-parent source matching are individually intentional but jointly unreachable for first delegated planning.

The existing `RepositorySourceAdmission` already distinguishes an internally proved current source from untrusted locators. `CanonicalPlanSourceProof` already distinguishes an accepted immutable plan from a child's current checkout, but depends on valid coverage and cannot bootstrap itself. Canonical Workroom access and principal/DCO resolution already exist. Adopt those boundaries and extend their composition; reject a new authority store, a generic source bypass or another provenance parser. The approved GPP design's source-control benchmark remains applicable; no external tool or dependency is adopted here.

## Compatibility, risks and rollback

No database migration or new personal-data category is planned. Public MCP input and receipt readers change additively; old absence keeps direct-source behavior. Exact new fields must be typed and validated at their owning wire registry and covered by external conformance tests. Old readers may refuse new delegated evidence until upgraded; they must never interpret it as an unproved direct-source pass.

The principal risk is a confused deputy accepting an unrelated child's source for a parent. Explicit locator selection, current action access to both contexts, approved parent planning scope, actual mapped child, provider/DCO proof and serialized revalidation are mandatory together. None alone is sufficient. An unreadable or revoked proof holds only the affected planning operation and names a supported remedy.

Rollback stops new delegated captures and retains readable historical immutable evidence and all original direct-source behavior. Never rewrite existing receipts, remove audit provenance, grant xlarge source writes or mark the stakeholder parent complete to recover. If safe interpretation of new evidence is unavailable, hold affected admission explicitly.

UI scope is refusal and next-action text on the existing MCP/headless surface. No new portal screen is introduced. Keep the failure message specific about parent, actual carrier and unmet proof without suggesting false historical adoption. Verify headless accessibility and existing authorized projections if their wire output changes.
