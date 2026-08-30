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
claiming the entire PAAW research-room profile as operationally conformant.

## 5. Delivery graph

```text
BI-636638A6  standards/design publication
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
| `BI-1B7BB954` — evaluation integrity | 20 | 16 | 4 | 20% |
| `BI-6DB95601` — revalidation interlock | 20 | 16 | 4 | 20% |

Allowed refactoring:

- one parser and vocabulary for experiment invalidation and integrity reasons;
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
- `docs/superpowers/specs/2026-06-27-governed-adaptive-playbooks-design.md`
- `docs/superpowers/specs/2026-07-25-governed-playbook-experimentation-autonomous-build-studio-design.md`
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

1. all three delivery BIs have their own signed PR and evidence;
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
| `evaluation-integrity-transfer` | `BI-1B7BB954` | yes | `standards-design-publication`, `BI-C6801B5A` for qualification-grade criteria |
| `qualification-revalidation-interlock` | `BI-6DB95601` | yes | `evaluation-integrity-transfer`, `BI-514826D3`, `BI-C6801B5A`, `BI-3E99ACFA` |

After spec approval, adopt an umbrella-bound governed Workroom at the immutable plan head, record
the mappings above with `record_plan_backlog_coverage`, and replace this condition with the returned
receipt. Markdown mappings alone are not completion evidence.
