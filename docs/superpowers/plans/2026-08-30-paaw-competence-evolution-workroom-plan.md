---
status: draft
date: 2026-08-30
umbrella_backlog_item: BI-41460872
design_backlog_item: BI-636638A6
workroom: WC-2122F7AC
---

# PAAW competence-evolution assurance implementation plan

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time —
> one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
> `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and
> `dpf-pr-with-dco` for handoff.

## 1. Outcome

Close the assurance seam between the shipped Governed Playbook Experimentation Loop and TAK-JSI.
The delivered system must invalidate gamed or unsupported-transfer evidence and must resolve the
qualification impact of every material WorkPattern change before TAK activates it.

The design authority is
[`2026-08-30-paaw-competence-evolution-workroom-design.md`](../specs/2026-08-30-paaw-competence-evolution-workroom-design.md).

## 2. Fixed boundaries

- Extend the existing Workroom, `TaskRun`, `DecisionShadowLedger`, WorkPattern,
  `DecisionInteraction`, `AuthorityBinding`, GAID/AIDOC, and TAK-JSI paths.
- Do not add a research-agent service, experiment scheduler, wiki store, approval queue, work ledger,
  or general qualification table inside this bundle.
- The canonical JSI qualification carrier must be established by the criterion/readiness dependency
  work before Delivery 2 writes qualification state. `AuthorityBinding` cannot double as the
  qualification record.
- PAAW Candidate 0.2.0 receives an informative application-profile pointer. Normative adoption and
  conformance IDs require the human Standards Steward's minor-version decision.
- No delivery may widen authority. A missing or stale qualification restricts or suspends the
  changed profile.
- Each delivery reserves 20% of effort for the consolidation named in Section 6.

## 3. Verified current substrate

| Concern | Current source | Planning consequence |
| --- | --- | --- |
| Experiment identity and profile attribution | `apps/web/lib/tak/work-pattern-experiment-types.ts`, `work-pattern-experiment-identity.ts` | Extend the versioned definition; do not create another manifest. |
| Cell execution and isolated workspaces | `apps/web/lib/build/work-pattern-experiment-adapter.ts`, `work-pattern-experiment-runtime.ts`, `work-pattern-build-replay.ts` | Add integrity evidence at the existing dispatch/verification boundary. |
| Effective append-only evidence | `apps/web/lib/tak/work-pattern-effective-ledger.ts`, `packages/db/prisma/schema/decision-governance.prisma` | Add invalidation reasons and attribution to the effective projection; retain corrections. |
| Promotion and rollback | `apps/web/lib/tak/work-pattern-promotion-policy.ts`, `work-pattern-experiment-promotion.ts`, `work-pattern-activation.ts` | Put hard integrity and revalidation gates before the existing activation transaction. |
| Active method | `packages/db/prisma/schema/core-identity.prisma` `AuthorityBinding` and `apps/web/lib/tak/work-pattern-binding-reader.ts` | Keep it as the active-method authority, not the qualification record. |
| Operating-profile identity | `apps/web/lib/identity/aidoc-resolver.ts`, `agent-identity-snapshot.ts`, `apps/web/lib/tak/agent-card-service.ts` | Reuse the fingerprint and validation projection; do not infer a complete JSI carrier from it. |
| Operator surface | `apps/web/components/platform/coworker-record/NeedsAndPlaybooksPanel.tsx` | Extend the current panel; no new dashboard. |

The code graph returned WorkPattern runtime and UI hits but no canonical
`JobSpecificIntelligence`/qualification-record implementation. Delivery 2 therefore has an explicit
dependency gate rather than inventing the missing carrier in this plan.

## 4. Live backlog and dependency map

### Bundle

| BI | Delivery | State at planning |
| --- | --- | --- |
| `BI-41460872` | Umbrella competence-evolution assurance outcome | open / build / xlarge |
| `BI-636638A6` | Standards and design publication | open / build / medium |
| `BI-EFFD97B4` | Workroom definition trigger, grant, and measure contract | open / build / medium |
| `BI-4CB2EF76` | Persisted typed Workroom roster | open / build / medium |
| `BI-3913EB49` | Workroom Process Overseer and shape conformance | open / build / large |
| `BI-1B7BB954` | Evaluation integrity and target-profile transfer | open / build / large |
| `BI-6DB95601` | TAK-JSI revalidation and activation interlock | open / build / large |

### Reused dependencies

| BI | Why it is reused instead of duplicated | Required before |
| --- | --- | --- |
| `BI-C6801B5A` | Owns the JSI job-specific criterion inventory. | Delivery 1 qualification-grade criteria and Delivery 2 carrier contract |
| `BI-514826D3` | Owns the WWMD/WWWD/WSID verdict-to-action-warrant bridge. | Delivery 2 consequential activation |
| `BI-DE1333A1` | Owns commons-first durable knowledge, contradiction, and staleness enforcement. | Full evidence→knowledge→method loop; not required for the evaluator's first red tests |
| `BI-D4C110BC` | Owns external-agent and multi-agent collaboration binding to Work Cases. | Research Workrooms that coordinate external agents |
| `BI-4CB2EF76` | Owns persisted Workroom participants. | Multi-agent research-room roster conformance |
| `BI-EFFD97B4` | Owns Workroom triggers, grants, and measures. | Standing/self-starting competence-evolution rooms |
| `BI-3E99ACFA` | Owns A2A, GAID, TAK, and JSI readiness proof. | Delivery 2 activation and end-to-end canary |

The Workroom dependencies do not block the bounded WorkPattern evaluator implementation. They block
claiming the entire PAAW research-room profile as operationally conformant. `BI-3913EB49` owns the
controller that consumes those dependencies; it does not stretch participant persistence or the
definition contract into a second responsibility.

## 5. Delivery graph

```text
BI-636638A6  standards/design publication
       |
       +----> BI-EFFD97B4 + BI-4CB2EF76  definition + roster foundation
       |             |
       |             +----> BI-3913EB49  Process Overseer + shape conformance
       |
       v
BI-1B7BB954  evaluation integrity + target-profile transfer
       |
       +---- depends on BI-C6801B5A for qualification-grade criteria
       v
BI-6DB95601  qualification impact + activation interlock
       |
       +---- depends on BI-514826D3 and BI-3E99ACFA
       v
contained dogfood canary and umbrella acceptance
```

Each BI is independently shippable. Delivery 1 may ship behind the existing shadow/default-off
posture before Delivery 2. Delivery 2 must fail closed when the canonical JSI carrier dependency is
not ready.

## 6. Effort and refactoring allocation

| Delivery | Total units | Feature/doc units | Refactor units | Refactor share |
| --- | ---: | ---: | ---: | ---: |
| `BI-636638A6` — documentation | 5 | 4 | 1 | 20% |
| `BI-EFFD97B4` + `BI-4CB2EF76` — Workroom foundations | 20 | 16 | 4 | 20% |
| `BI-3913EB49` — Process Overseer | 20 | 16 | 4 | 20% |
| `BI-1B7BB954` — evaluation integrity | 20 | 16 | 4 | 20% |
| `BI-6DB95601` — revalidation interlock | 20 | 16 | 4 | 20% |

Allowed refactoring:

- one parser and vocabulary for experiment invalidation and integrity reasons;
- one pure Workroom shape-conformance projection shared by finite transitions and standing-room
  reconciliation;
- one resource/seed/retry/submission budget projection;
- one operating-profile material-change diff and affected-binding resolver;
- one qualification/binding transition adapter after the canonical JSI carrier exists;
- one UI projection for integrity and qualification impact.

Do not spend this budget on unrelated TAK cleanup, navigation redesign, a schema rewrite, or a new
experiment/qualification product.

## 7. Delivery 0 — standards and design publication (`BI-636638A6`)

### Files

- `docs/superpowers/specs/2026-08-30-paaw-competence-evolution-workroom-design.md`
- `docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md`
- `docs/architecture/job-specific-intelligence.md`
- `docs/architecture/work-shapes-and-the-decision-gate.md`
- `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`
- `docs/superpowers/specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md`
- `docs/superpowers/specs/2026-08-29-proactive-workrooms-design.md`
- `docs/superpowers/plans/2026-08-29-proactive-workrooms.md`
- this plan

### Steps

1. Record the external findings and explicit adopt/reject decisions.
2. Define the PAAW Workroom trace, scoped-commons separation, evaluation-integrity contract, and
   promotion-to-revalidation interlock in one canonical design.
3. Add short owned requirements or pointers to PAAW, TAK-JSI, and the playbook designs.
4. Keep the PAAW application profile informative pending human Standards Steward approval.
5. File the umbrella and independent delivery BIs; record live coverage against this plan.
6. Regenerate/check the documentation index and run reference/prose guards.

### Verification

- `git diff --check`
- `pnpm docs:index`
- `pnpm check:doc-links`
- `pnpm check:prose-lint`
- `pnpm pregate:preflight`

Exit: the design and plan are indexed, linked, source-cited, live-BI covered, and make no false
implementation claim.

## 7. Delivery F — Workroom definition and roster foundations (`BI-EFFD97B4`, `BI-4CB2EF76`)

These two BIs ship in one PR because the roster is the observed side of the definition contract.
They remain separate backlog outcomes and commits so either result stays attributable. This delivery
does not turn on Process Overseer enforcement; `BI-3913EB49` consumes the contracts afterwards.

The canonical design authority for this delivery is
[`2026-08-30-workroom-definition-roster-contracts-design.md`](../specs/2026-08-30-workroom-definition-roster-contracts-design.md).

### Red tests first

- A definition cannot omit a trigger without an explicit imperative-only justification.
- Room grants can only intersect standing agent grants and can never confer a missing grant.
- Standing `scheduled` and `bookkeeping-period` definitions preserve their current behavior.
- A persisted roster survives the loss of every presence row and still reports its occupied roles.
- Presence never creates membership or authority, and an absent required role remains queryable.
- Multiple roles for one Principal remain one participant with normalized role assignments.
- Existing rooms without persisted membership retain their current read/access projection through an
  explicitly labelled legacy-derived compatibility path.

### Implementation

1. Reuse the existing definition registry and its version identity for trigger, tighten-only grant,
   and measure declarations; do not introduce a scheduler or authority store.
2. Add a normalized Workroom-to-Principal membership relation plus role assignments, keyed to the
   canonical Principal rather than user/agent-specific foreign keys. Store work state, admission
   reason, and admission time on membership; keep presence outside the roster.
3. Add one pure roster projection that merges persisted membership metadata with live presence and
   produces occupied-role and missing-role conformance without rendering a page.
4. Make the workspace loader prefer the persisted roster, retain a labelled legacy-derived fallback
   for existing rooms, and keep the existing access ladder unchanged.
5. Extend the current Workroom participant surface so membership, active presence, work state, and
   missing required roles are visually distinct using existing theme-aware report primitives.
6. Spend the four refactor units consolidating assignment, conversation-lineage, coordinator, and
   presence merging behind that one pure projection. Do not spend them on unrelated cleanup.

### Verification

- source-registry tighten-only and conformance tests;
- Prisma migration apply from an existing populated state plus generated-client/schema checks;
- participant projection, roster-store, shape-binding, workspace-loader, and access-regression tests;
- participant component tests plus narrow/wide and light/dark Workroom inspection;
- merged-code pregate and migration smoke in the shared local-CI environment.

### Rollback

Stop writing new roster rows and return the loader to the labelled legacy-derived projection. Keep
the additive tables and definition fields readable until a forward migration removes their use;
never reinterpret presence as membership during rollback.

## 7A. Delivery W — Workroom Process Overseer (`BI-3913EB49`)

### Dependency gate

Verify `BI-4CB2EF76` supplies persisted participant/coordinator assignment and `BI-EFFD97B4`
supplies the definition-level trigger, grant, and measure contract. If either carrier is not ready,
implement only the pure declared-versus-observed conformance projection and keep dispatch
enforcement default-off. Do not create a shadow roster or room-definition table.

### Red tests first

Add failing cases for:

- zero, multiple, or only legacy-derived coordinators on an executable room;
- a coordinator without applicable JSI or TAK authority;
- missing required participant, out-of-order stage, absent prerequisite receipt, exhausted budget,
  due review point, met stop condition, and attempted authority widening;
- coordinator overlap with an independent evaluator or approver where the shape forbids it;
- duplicate finite-room events and repeated standing-room reconciliation producing one disposition;
- closure attempted with an unresolved deviation missing from the outcome packet.

### Implementation

1. Keep `coordinator` as the canonical role and distinguish explicit persisted assignment from
   read-model derivation.
2. Add one pure `WorkroomShapeConformance` result containing the exact collaboration-shape and
   WorkShapeDefinition versions, observed state, typed deviations, disposition, and next permitted
   transition.
3. Consume it at convene, before and after stage dispatch, at review/close, and through a bounded
   delta sweep for standing rooms. Append receipts and attention items on divergence; never invent
   participants, skip gates, widen authority, or retry silently.
4. Keep accountable owner, Process Overseer, executor, independent evaluator/reviewer, and approver
   separate. Resolve AI-overseer eligibility through the canonical JSI/TAK paths.
5. Extend the existing Workroom surface with coordinator identity/source, conformance state,
   current and expected next stage, unresolved deviations, last check, and intervention reason.
6. Spend the refactor allocation consolidating existing coordinator, shape-binding, stage, and
   stop-condition checks behind the shared projection.

### Verification

- targeted coordinator, participation, shape, finite-transition, standing-drive, outcome-packet,
  JSI, and TAK tests;
- event replay and bounded-reconcile idempotency tests;
- narrow/wide and light/dark UI inspection that distinguishes membership from presence and
  explicit coordinator assignment from derivation;
- contained nonproduction rooms demonstrating continue, pause, escalate, rollback, and close;
- the canonical merged-code gate and live-install verification required by the implementation
  Workroom.

### Rollback

Disable transition consumption of the new result and leave rooms paused where their explicit
coordinator or contract cannot be proven. Preserve conformance receipts and deviations; do not
reinterpret them as passes.

## 8. Delivery 1 — evaluation integrity and transfer validity (`BI-1B7BB954`)

### Red tests first

Add failing cases beside the existing WorkPattern tests for:

- held-out fixture/label/evaluator credential exposed to the candidate workspace;
- evaluator submission or retry budget exceeded;
- missing or unattributed seed/cohort selection;
- candidate-selected best seed presented as the full result;
- capability-floor regression masked by an aggregate safety gain;
- unsupported transfer to a different actual provider/model or operating-profile fingerprint;
- legitimate evidence-store/provider infrastructure failure recorded as `inconclusive`, not subject
  failure;
- append-only invalidation/correction preserving the original observation.

Likely test files:

- `apps/web/lib/tak/work-pattern-experiment-types.test.ts`
- `apps/web/lib/tak/work-pattern-effective-ledger.test.ts`
- `apps/web/lib/tak/work-pattern-promotion-policy.test.ts`
- `apps/web/lib/tak/work-pattern-experiment-promotion.test.ts`
- `apps/web/lib/build/work-pattern-experiment-runtime.test.ts`
- `apps/web/lib/build/work-pattern-build-replay.test.ts`

### Implementation

1. Extend the versioned experiment definition with an `evaluationIntegrityPolicy` reference and
   normalized fields for evaluator owner, holdout class, capability floors, seed/cohort authority,
   retry/submission budgets, and allowed transfer/equivalence scope.
2. Include the policy version and relevant digests in the experiment definition identity so a
   policy or holdout change cannot reuse earlier evidence silently.
3. Capture actual selection/submission/budget facts at the current runtime boundary without placing
   protected fixture content in `TaskRun` metadata.
4. Extend `DecisionShadowLedger` metadata and the effective-ledger projection with stable
   invalidation reasons. Prefer JSON contract evolution; add schema only if an audited integrity or
   indexed-query requirement cannot be enforced otherwise.
5. Make promotion fail closed for integrity invalidation, capability-floor failure, or unsupported
   transfer. Keep infrastructure failure `inconclusive`.
6. Add integrity and transfer-scope fields to the existing read model and Needs and Playbooks panel.
7. Consolidate invalidation and budget parsing as the 20% refactor allocation.

### Verification

- affected unit tests above;
- a contained paired experiment whose candidate is denied holdout access;
- forced evaluator-leak and cherry-picked-seed fixtures;
- same-method cross-model negative-transfer fixture;
- light/dark and narrow/wide inspection of the existing Needs and Playbooks panel;
- query-plan evidence if new JSON filtering or indexes are introduced;
- the repository's fast local gate and canonical merged-code gate required by the active Workroom.

### Rollback

Keep the new policy version additive and default new promotion requests to fail closed when integrity
evidence is absent. Roll back consumption by disabling the new promotion-policy version; do not
delete ledger evidence or reinterpret old experiments.

## 9. Delivery 2 — TAK-JSI revalidation interlock (`BI-6DB95601`)

### Dependency gate

Before Red, verify `BI-C6801B5A` and `BI-3E99ACFA` have established the canonical qualification
carrier, status vocabulary, profile-to-qualification lookup, and evidence boundary. If not, stop
this BI at the dependency gate. Do not store qualification state in `AuthorityBinding.policyJson`,
Agent status, or AIDOC validation state as a shortcut.

### Red tests first

Add failing cases for:

- a promoted skill/prompt/corpus change leaving an affected active qualification unchanged;
- an explicit no-impact decision preserving an unaffected qualification;
- activation racing with revalidation and producing two effective states;
- TAK dispatch reading a binding whose qualification is pending, restricted, suspended, expired,
  or profile-incompatible;
- rollback restoring a WorkPattern version while qualification evidence remains stale;
- cross-model/provider substitution without target qualification.

### Implementation

1. Define one material-change diff over operating-profile inputs already represented in the
   WorkPattern execution profile and GAID/AIDOC fingerprint source.
2. Resolve affected qualifications and bindings through indexed profile/asset relationships from
   the canonical JSI carrier; do not scan the fleet.
3. Record an attributable qualification-impact decision for every candidate: `unaffected`,
   `pending-revalidation`, `restricted`, `suspended`, or `rejected` as owned by the JSI contract.
4. Serialize activation behind the impact decision. The existing scope-keyed advisory lock remains
   the activation concurrency boundary unless the canonical carrier requires a stricter one.
5. Intersect promotion scope, active compatible qualification, grants, data/regulatory policy, and
   operational evidence in the TAK read path.
6. Treat rollback as another material-change transition and re-evaluate freshness/compatibility.
7. Project qualification impact and next accountable action into the existing panel and Agent Card.
8. Consolidate material-change and transition adapters as the 20% refactor allocation.

### Verification

- affected WorkPattern activation, binding-reader, AIDOC/Agent Card, and JSI-carrier unit tests;
- concurrent activation/revalidation integration test;
- contained canary: promote a low-risk method, observe pending revalidation, qualify the target
  profile, then activate;
- forced stale-qualification and rollback canaries;
- TAK receipt proves the effective qualification and binding used for the action;
- operator UI inspection at narrow/wide and light/dark settings;
- canonical runtime verification for the full activation path.

### Rollback

Disable the new binding version and return affected profiles to the prior safe binding only when its
qualification remains active and fresh. Otherwise retain restriction/suspension and escalate. Never
manufacture a previous qualification from the method rollback.

## 10. Scale, privacy, and security checks

- Profile-impact lookup must begin from changed fingerprints/assets and use indexed relationships;
  no full-agent or full-qualification scan.
- Ledger and WorkOccurrence queries are cursor-bounded and time/scope constrained.
- Protected fixtures, labels, evaluator credentials, customer content, and private code are not
  copied into TaskRun metadata, UI projections, Hive aggregates, or cross-install evidence.
- Cross-install evidence carries scope and aggregate references; one install's artifacts are never
  promoted as fleet-visible content.
- Factorial matrices have a declared factor ceiling and stage screening before expansion.
- Retention distinguishes immutable audit observations from rebuildable read models and disposable
  candidate workspaces.

## 11. Completion gate

The umbrella is ready for acceptance only when:

1. all four delivery BIs have their own signed PR and evidence;
2. the dependency BIs required by each claim are complete or the corresponding profile claim remains
   explicitly unsupported;
3. the held-out leak, seed gaming, capability-floor, negative-transfer, stale-qualification, and
   rollback scenarios have executed through the real governed path;
4. the active binding and qualification status shown to the operator match the records TAK used;
5. no new parallel store, scheduler, approval queue, or decision engine exists;
6. the 20% refactor allocation is evidenced by consolidated seams, not unrelated cleanup; and
7. an acceptance reviewer reconciles delivered outcomes against the approved design baseline.

## 12. Backlog coverage

- Decision: `decomposed`
- Umbrella: `BI-41460872`
- Plan path: `docs/superpowers/plans/2026-08-30-paaw-competence-evolution-workroom-plan.md`
- First immutable publication: commit `8dfe79a674e43d8aa575178f3b89a117dbd20d7f`, plan blob
  `35a62ea2875dc289e1abdff3a31dd3fffd6918b2`
- Coverage receipt: not yet recordable because no initiative scope baseline exists for
  `BI-41460872`. An independent in-platform reviewer must pass the umbrella's spec-approval gate;
  the resulting objective and acceptance IDs are the traceability vocabulary accepted by
  `record_plan_backlog_coverage`.

| Deliverable key | BI | Independently shippable | Depends on |
| --- | --- | --- | --- |
| `standards-design-publication` | `BI-636638A6` | yes | none |
| `workroom-process-overseer` | `BI-3913EB49` | yes | `standards-design-publication`, `BI-4CB2EF76`, `BI-EFFD97B4` |
| `evaluation-integrity-transfer` | `BI-1B7BB954` | yes | `standards-design-publication`, `BI-C6801B5A` for qualification-grade criteria |
| `qualification-revalidation-interlock` | `BI-6DB95601` | yes | `evaluation-integrity-transfer`, `BI-514826D3`, `BI-C6801B5A`, `BI-3E99ACFA` |

After spec approval, adopt an umbrella-bound governed Workroom at the immutable plan head, record
the mappings above with `record_plan_backlog_coverage`, and replace this condition with the returned
receipt. Markdown mappings alone are not completion evidence.
