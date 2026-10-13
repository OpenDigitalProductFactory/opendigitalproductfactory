# Body-baseline independent acceptance repair

Backlog: BI-F89EC5BA. Reproduction and final acceptance: BI-CAP-437F7745.
Decision: DI-126E18560441 (document-version, followed). Revisits the measured
trigger of DI-FDAB20135537; BI-0F8E39D5 and BI-9D327C32 remain completed.

## Objective and boundaries

A medium product-linked item with valid body criteria must obtain an executable
independent acceptance request. Preserve its product link, delivery shape,
completion gates, tenant boundaries, grant intersection and administrator
approval requirements. BI-56E9CEC2 role-and-room configuration is excluded.

## Reproduction

On the canonical install, IRD-E90BF7B75A1B passes OBJECTIVE_BASELINE_REQUIRED
and DELIVERY_EVIDENCE_REQUIRED for BI-CAP-437F7745, but refuses completion with
ACCEPTANCE_EVIDENCE_REQUIRED. Recovery returns reviewerRoutes=[] and
body-baseline-unpersisted. Evidence cited by that transition:
cmv65vse2149101mr7j27ydli, cmv65vsg9149401mrysmfrxuy,
cmv65vshr149701mrwhseqhkf, cmv65vsja149a01mrl4rnkppx,
cmv65vskv149d01mr346e5vc0, cmv65y63x15ax01mrekpkjfey.

## Design grounding

Extend the proportional-gates design
`docs/superpowers/specs/2026-09-02-work-shape-taxonomy-and-proportional-gates-design.md`
section 4: medium criteria in the body are minted as the baseline. Reuse
`item-body-baseline.ts`, `baseline-repository.ts`, `baseline-source.ts`,
`terminal-recovery.ts`, `objective-mapping-repository.ts`,
`mcp-task-review-contract.ts`, `mcp-task-objective-mapping-request-key.ts`,
`initiative-readiness-tool-grants.ts`, `initiative-review-objective.ts`,
`independent-review-request.ts`, the version-history pack and terminal tool policy.
DocumentVersion, retention pins, baseline activities, TaskRun and mapping
activities remain the only durable stores. No new authority or receipt store.

## Acceptance criteria (verbatim BI scope)

- Medium product-linked work with valid body criteria receives an executable independent acceptance request bound to versioned criteria, delivered source identity and eligible evidence.
- Criteria, source or evidence changes invalidate stale requests; retries are idempotent.
- Ineligible and author reviewers, wrong item and organization bindings fail closed under existing authority checks.
- Recovery accurately names missing prerequisites; no product unlink, shape lowering, self-approval or fabricated receipt.
- Failure is proven before source fix; affected unit tests and typecheck and governed build gate pass before ready PR.
- Canonical deployment and independent BI-CAP-437F7745 acceptance, grant/revoke, reconnect and provisioning persistence verification are recorded separately; administrator approval gates remain.

## Ordered implementation (one atomic repair)

1. **V-RED / R-ROUTE:** Resolve colocated and graph-linked affected tests. Add the
   product-linked medium reproduction with valid body criteria and no persisted
   baseline. Execute it against unchanged production code and retain the failure.
2. **C-BASELINE / R-VERSION:** Persist an immutable body criteria version and
   initiative_scope_baseline in a serialized, authorized triage/claim or completion
   mutation. Existing approved or inherited spec baselines win. Capture parsed
   statements, line anchors, body digest, item/organization and author provenance;
   mint no spec-approval receipt. Reuse exact versions on retries and append an
   explicit superseding baseline on changed criteria. Missing author provenance
   or malformed history fails closed. Never mutate from a read projection.
3. **C-BINDING / F-DISPATCH:** Extend immutable review bindings to retain both the
   criteria DocumentVersion and delivered repository source, plus the exact
   eligible evidence set. The retained review document contains the exact body
   and provider-verified source bytes with their separate identities, so one
   bounded immutable document traversal covers both without a second evidence
   hydration state machine. Both criteria and source must be read before disposition. Admit
   objective mapping as an independent acceptance lane without making research
   or dependency-disposition independent. Require current reviewer eligibility
   and exclude criteria/source authors at dispatch and again at the writer.
4. **C-FRESHNESS / R-INVALIDATION:** Request admission and receipt writing must
   resolve the current criteria, source head, item/organization and eligible
   evidence under existing authority checks. Stale inputs refuse; unchanged
   retries reuse TaskRun/proposal identity. Preserve historical receipts and
   the existing request-key evolution rules; active old authority is not churned.
5. **F-RECOVERY / V-GUIDANCE:** Explain the actual absent prerequisite: readable
   criteria, persisted version, source identity, fresh eligible evidence or
   eligible independent reviewer. Keep missing completion-manifest feedback on
   its author-owned lane. Update contributor and operator acceptance guidance.
6. **V-GATES / V-LIVE:** Run affected unit tests, package typecheck, host guards,
   exact-tree governed build gate and semantic review; push a DCO-signed branch
   and open a ready PR only after required checks pass. Merge through the queue.
   Request canonical self-upgrade and verify source membership and served image.
   Obtain the independent BI-CAP-437F7745 result and exercise grant/revoke,
   reconnect and provisioning persistence through the approved administrator
   procedures. Missing approval remains an outstanding prerequisite.

Twenty percent of implementation effort is reserved for relevant refactoring:
centralize immutable artifact identity and baseline parsing used by issuer,
admission, terminal traversal and writer. Keep existing spec/build lanes stable.

## Verification and impact

R-ROUTE, R-VERSION and R-INVALIDATION are covered by V-RED, V-GATES and V-LIVE.
Tests cover valid routing, changed criteria, stale source and evidence,
ineligible/author reviewers, idempotent retries, wrong item and wrong organization.
The Workroom change-impact contract requires related-test resolution, Style Drift
Guard, Design Grounding and regenerated documentation index. A new persisted
projection requires the normal data-impact declaration; reuse existing model
classification and retention rather than add tables. UX feedback uses existing
recovery surfaces and theme tokens; measure the affected flow before handoff.

## Risks and rollback

Adding baseline history can invalidate proportional plan coverage and earlier
receipts. Limit minting to body-baseline shapes and preserve approved/inherited
scope precedence; do not reinterpret existing spec receipts. Historical requests
retain their immutable identity and fail closed if no longer current. A rollback
cannot delete versions, pins or baseline activities; deploy a forward repair if
an older reader cannot handle the new artifact branch. No grant reconciliation
or authority expansion is performed by this repair.

## Backlog coverage

Atomic: baseline persistence, immutable dual-artifact binding, reviewer admission
and receipt freshness are one acceptance contract. Shipping only minting or only
routing leaves a new unreachable or stale authority path. Coverage must be
recorded against this immutable plan before source implementation.
