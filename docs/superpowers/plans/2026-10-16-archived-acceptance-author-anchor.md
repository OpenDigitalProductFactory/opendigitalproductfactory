---
status: active
---

# Independent body acceptance after author-room archival

Backlog: BI-F89EC5BA. Follow-up to the original body-baseline acceptance plan,
not a replacement for its completed delivery or historical evidence.
Current reproduction: BI-CAP-1774FB7A, WC-EEF1CFD8, PR6265.

## Design grounding

Reuse DI-126E18560441 and the proportional-gates design
`docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`.
The source substrate is body-baseline-persistence, body-baseline-reader,
terminal-recovery, objective-mapping-submission-admission,
objective-mapping-repository and backlog-completion-evaluation under
`apps/web/lib/backlog/initiative-readiness/`. Reuse the existing provider-verified
`contributor-change-lanes/pull-request-observation.ts` snapshot parser. No new
receipt, identity, permission, persistence model or runtime is required.

## Observed failure

IRD-F5432E49A210 and IRD-D9D9C8C631B1 pass delivery but refuse independent
acceptance with workroom-not-found. After one supported identity correction and
resume, WC-EEF1CFD8 sequence 130 records ready and sequence 132 archives it as
DELIVERED because its branch merged. A live lease cannot override delivery.
Repeated reopening would fight the intentional execution retirement policy.

## Acceptance criteria (verbatim existing BI)

- Medium product-linked work with valid body criteria receives an executable independent acceptance request bound to versioned criteria, delivered source identity and eligible evidence.
- Criteria, source or evidence changes invalidate stale requests; retries are idempotent.
- Ineligible and author reviewers, wrong item and organization bindings fail closed under existing authority checks.
- Recovery accurately names missing prerequisites; no product unlink, shape lowering, self-approval or fabricated receipt.
- Failure is proven before source fix; affected unit tests and typecheck and governed build gate pass before ready PR.
- Canonical deployment and independent BI-CAP-437F7745 acceptance, grant/revoke, reconnect and provisioning persistence verification are recorded separately; administrator approval gates remain.

## Ordered atomic repair

1. **V-RED:** Resolve every changeImpactContract testImpact through
   find_related_tests and colocated tests before Red. Missing graph advice
   expands verification. Prove archived, exactly merged body acceptance fails
   against existing entrypoints before changing behavior.
2. **C-AUTHOR-ANCHOR:** Introduce one shared body-baseline author-room resolver.
   Keep the current active path. An archived source may be used only when the
   current attempt is unambiguous and a server-owned, fingerprint-validated PR
   observation proves the exact repository, PR number, branch and head merged.
   Abandoned, superseded, ambiguous, missing, draft, closed-unmerged, changed-head
   and superseded-attempt inputs fail closed. Do not reactivate execution leases.
3. **F-INDEPENDENT-ACCEPTANCE:** Reuse that source identity consistently at body
   baseline capture, recovery dispatch, immutable reader, request admission,
   objective-mapping writer and completion reconciliation. Limit the archived
   path to item-body/document-version acceptance. Preserve actual current actor,
   reviewer TaskRun liveness, grants, content access, author separation, tenant,
   artifact, baseline, evidence and request-key bindings. Existing spec and PIR
   lanes retain their liveness contract.
4. **V-REGRESSIONS:** Test merged archival success and refusal of wrong source,
   multiple/current replacement attempts, invalid provider proof, stale criteria
   and evidence, author/self review, wrong tenant and revoked access. Retain
   existing request idempotency and current reader/writer tests. Run affected
   tests and both web typechecks, Style Drift Guard, documentation index checks,
   host preflight and the exact-tree governed integration gate before ready PR.
5. **V-LIVE:** DCO-signed normal push, independent frozen source assessment,
   required review and protected merge queue. Coordinate the next canonical
   release with its existing owner; do not block the already frozen 101 batch.
   Verify successful upgrade, NORMAL writes and exact served source membership,
   then obtain genuine independent BI-CAP-1774FB7A acceptance through the native
   completion recovery packet. Historical grant/revoke, reconnect and original
   BI-CAP-437F7745 evidence retain their actual target and attribution.

At least twenty percent of relevant implementation effort is shared-resolution
refactoring: replace repeated source-author lookups rather than add parallel
exceptions. This is reliability repair within the recorded platform scope.

## Risks and rollback

An archival exception could accidentally accept stale source or reopen execution
authority. Keep verified merge proof and current-attempt selection centralized,
preserve immutable exact bindings and use adversarial refusal tests. Do not
change the reaper. No schema migration or historical receipt rewrite. Revert the
source change through a normal PR if needed; retained baseline history remains
immutable and any unavailable proof is UNRUN/refused, never a synthetic pass.

## Backlog coverage

One atomic deliverable maps to BI-F89EC5BA with no dependencies. Partial delivery
would route an acceptance request which its reader/writer rejects or would retain
a receipt completion cannot reconcile; no phase is independently shippable.
Requirement reference: existing-body-acceptance-contract (the verbatim criteria
above). Contract reference: C-AUTHOR-ANCHOR. Flow reference:
F-INDEPENDENT-ACCEPTANCE. Verification references: V-RED, V-REGRESSIONS, V-LIVE.
The live immutable coverage receipt will be recorded against the published plan
and checked before implementation; this paragraph itself grants no admission.
