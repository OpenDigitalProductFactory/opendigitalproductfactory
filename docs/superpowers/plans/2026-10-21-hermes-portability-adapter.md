---
status: draft
---

# Hermes portable-profile adapter implementation plan

**Backlog item:** BI-FEA232AF

**Epic:** EP-B932453F · **Workroom:** WC-D80DF71B

**Design:** [Hermes import and enforcement fit](../specs/2026-10-21-hermes-portability-adapter-design.md), immutable commit `c176019484fe69dbd214948bc3ec2421c0da9b63`, blob `16641ca0befd7045fbbccba9908c55c63bb48099`, SHA-256 `35364cba40b83d241ff3b806ef1b64ac7d9c4fbd38920db16de120387f6dfa62`.

**Planning admission:** `IRD-198F9950CB8C`, `initiative-readiness.v3`, PLAN allowed at `2026-10-21T07:17:35.169Z`, declared/effective `delivery-medium@1.0.0`, low sensitivity, unmet/blockers empty.

For agentic workers: execute this plan one independently reviewable backlog item
at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
`dpf-local-merge-ci-before-push` plus the completion gate below before a success
claim, and `dpf-pr-with-dco` for handoff.

This action writes the plan only. Coverage, independent plan review,
implementation admission, target selection/access and all implementation/runtime
checks remain pending. No Hermes version, operating profile, host, model, account
or executing surface is selected. A medium-shape readiness projection that reads
implementation allowed does not waive the repository's plan/coverage rules, the
BI's explicit dependency or its prohibition on installation/mutation by capture.

## Existing acceptance criteria and traceability

The following four statements are copied verbatim from the native item read at
`2026-10-21T07:17:28.290Z`. Labels retain the design's local traceability aids;
they are not a new baseline or a changed conformance denominator.

| Intake reference | Existing acceptance criterion |
|---|---|
| I-HER-1 | Import/validation and bounded execution are reproducible on a named Hermes version. |
| I-HER-2 | A capability/loss report separates instruction compatibility from runtime enforcement. |
| I-HER-3 | Target-profile qualification/equivalence is supported by evidence; no inherited DPF authorization is assumed. |
| I-HER-4 | If mandatory execution controls cannot be implemented safely, provide a reviewed incompatibility result and safe supported posture; do not claim full conformance. |

| Existing criterion | Design checks retained | Planned observations, all UNRUN |
|---|---|---|
| I-HER-1 | AC-HER-01, AC-HER-02, AC-HER-04, AC-HER-05, AC-HER-06 | HER-V01/02/03 static import/projection/staging; HER-V05/06/07/08 eventual named-target behavior. Static success cannot pass the bounded-execution part. |
| I-HER-2 | AC-HER-03, AC-HER-04, AC-HER-08 | HER-V04 control/loss report; HER-V05/06 alternative-path and hook cases; HER-V10 limitations and incompatibility disposition. |
| I-HER-3 | AC-HER-05, AC-HER-07 | HER-V07 exact authority/effect binding; HER-V09 qualification and revalidation; independent attributable assessment. |
| I-HER-4 | AC-HER-03, AC-HER-06, AC-HER-08 | HER-V04/08 unresolved controls and effects; HER-V10 reviewed incompatibility with dependent activities disabled. |

The design objectives remain OBJ-HER-IMPORT, OBJ-HER-CONTROLS and
OBJ-HER-EVIDENCE. Its AC-HER-01 through AC-HER-08 refine the four intake criteria;
they do not replace them. A reviewed incompatibility is an explicitly valid
possible outcome. The acceptance reviewer must preserve any unrun or unmet part
of I-HER-1 when evaluating I-HER-4; no static refusal is relabeled a successful
runtime reproduction or full conformance.

## Backlog coverage

- Decision: atomic
- Parent: BI-FEA232AF
- Receipt: blocked-by: Coordinator must publish this immutable plan through the supported ordinary lane, then issue and verify canonical coverage against its exact source and current declared scope before implementation.
- Rationale: Import/projection, control-fit reporting, evidence mapping and the bounded reproduction or reviewed incompatibility result jointly answer one Hermes reproduction outcome; these phases cannot independently satisfy its four intake criteria.
- Dependencies: BI-07A2B207 delivered package/inspection interface; BI-F9582C48 contracts; BI-2AB781FA assessment denominator; BI-F3C2EC7A specimen when required by that denominator.

**Proposed decision: atomic.** One deliverable, `hermes-portability-adapter`, maps
to existing **BI-FEA232AF**. Import/projection, control-fit reporting, evidence
mapping and the bounded reproduction or reviewed incompatibility result jointly
answer this item's four criteria. A native-content copier alone cannot establish
safe import or enforcement; a report without exact source and target evidence
cannot establish the item's qualification or incompatibility conclusion. Phases
below are internal sequencing, not separately shippable platform capabilities.
No new BI, workroom or independent implementation outcome is proposed.

The live coverage receipt is **pending**, not fabricated in this document. The
coordinator records and checks coverage against the exact immutable plan and
current item using `record_plan_backlog_coverage` and
`check_plan_backlog_coverage`; the server selects the applicable receipt schema.
Do not assume v3 merely from medium effort, or bypass any actual baseline history.
This stable section points to the future canonical receipt on the existing item.
A Markdown mapping is not coverage, a plan review, or implementation authority.
The lookup is the item's canonical `plan_backlog_coverage` activity for this exact
plan path and immutable source; that lookup pointer is not a passing receipt.
Do not edit this plan merely to insert its own later-generated receipt identity.
For schema v3, all four reference arrays must contain nonempty strings present
verbatim in the immutable plan. They are not restricted to baseline OBJ/AC labels.
The table below supplies explicit requirement, contract, flow and verification
references without selecting or fabricating the server's receipt schema.

| Deliverable | Live BI | Dependencies | Requirement references | Contract references | Flow references | Verification references |
|---|---|---|---|---|---|---|
| hermes-portability-adapter | BI-FEA232AF | BI-07A2B207 delivered package/inspection interface; BI-F9582C48 contracts; BI-2AB781FA assessment denominator; BI-F3C2EC7A specimen where required by that denominator | I-HER-1, I-HER-2, I-HER-3, I-HER-4; AC-HER-01, AC-HER-02, AC-HER-03, AC-HER-04, AC-HER-05, AC-HER-06, AC-HER-07, AC-HER-08 | trusted-artifact 0.1.0; package-inventory 1.0.0; TAK-PD-006; TAK-PD-007; GAID-PD-001; JSI-PD-002; GPP binding/shape revision separation | inspect-validate; project-report; stage-inert; observe-reconcile; assess-or-incompatible | HER-V01, HER-V02, HER-V03, HER-V04, HER-V05, HER-V06, HER-V07, HER-V08, HER-V09, HER-V10 |

**BI-07A2B207 remains an undelivered dependency hold.** Its approved design at
`2067baab3c199119cd2108f5fe3169c8193a6310` and plan source at
`f9555c917c6ebfeb2a326d05b423841376734f48` describe the package, but do not prove
that its inspector, trusted tools or release exist. Recheck delivered interfaces,
normal review/coverage/admission and actual dependency disposition before adapter
implementation. Do not replace missing package delivery with a local parser,
untrusted archive executable or another independently editable inventory.

The simple dependency chain is: **normal plan/coverage and package delivery →
static adapter/report → inert staging checks → separately admitted named-target
assessment → independent acceptance or reviewed incompatibility**. An unresolved
earlier prerequisite stops later dependent work. No second graph, scheduler,
permission service or qualification registry is needed.

## Source grounding and planned files

The source checkout at `c176019484fe69dbd214948bc3ec2421c0da9b63` contains the
F958 importer/reference loop and current design. Native spec search found the
existing portable-contract and programme owners; bounded code-graph/local search
found no Hermes portability implementation to extend. This is a bounded search,
not proof of universal absence. Future BI07 interfaces must be read from their
delivered source before imports are bound.

| Existing owner | Reuse and compatibility boundary |
|---|---|
| `packages/validators/src/trusted-agent-contracts.ts` | Reuse `importTrustedArtifact`, bounded JSON, exact extension semantics, references/restrictions and explicit trusted observation time. Do not change the five artifact meanings or add an authority schema. |
| `packages/validators/src/trusted-agent-reference-loop.ts` and `trusted-agent-examples.ts` | Reuse exact-effect/attempt transitions and simulated examples. These supply no durable storage, target authorization or dispatcher. |
| `packages/integration-shared/src/canonical-json.ts` and `scripts/lib/canonical-json.mjs` | Reuse their sanctioned serialization boundaries; no local canonicalizer or digest-algorithm relabeling. |
| BI07's planned `reference-package-contracts.ts` / `reference-package-semantics.ts` in validators and `scripts/lib/portable-reference-package/inspect.ts` | Consume only their delivered successful inspection result and validated inventory. These files are proposed in BI07's plan, not asserted present at this source head. Keep parsing, dependency/license closure, safe paths and limits with that owner. |
| BI07's planned trusted-tools build/config | Extend its explicit trusted entrypoint closure after delivery if needed. Reuse its existing pinned compiler/dependencies and independently trusted tool provenance; no second build service or package lifecycle execution. |
| `docs/architecture/trusted-agent-reference-contract.md` | Preserve authenticated effect events, durable CAS/state-command boundaries, uncertainty/reconciliation and current authorization at actual use. |

Proposed **new** cohesive adapter modules live under
`scripts/lib/hermes-portability/`: `native-profile-contract.ts`, `projection.ts`,
`control-fit.ts`, `staging.ts`, `evidence.ts`, and focused `*.test.ts` files. A thin
**new** `scripts/hermes-portability.ts` exposes inspect/project/report operations;
it has no install, activate, connect, schedule or grant verb. Add a **new**
`docs/architecture/hermes-portability-adapter.md` guide only when implementation
has real behavior to explain. These are planned paths, not code authored or
implementation scope claimed now. No new package, dependency, database or API.

### One typed native/discovery definition

`native-profile-contract.ts` is the single typed definition for Hermes native
component kinds and discovery-root kinds. It records each kind's native path
description, projection eligibility, disclosure requirements and discovery-root
relationship. Its closed set covers home/profile, configuration, skills, hooks,
plugins, MCP and cron/scheduler locations, including manifest/persona descriptions.
Actual local root values are separate bounded target context, not hardcoded
paths or environment assignments.

The runtime schema, projection dispatch and staging exclusion policy derive from
that same definition. Infer their unions/schema enums from it; do not maintain
three independent string lists, a separate root enum in the CLI, or hand-edited
JSON Schema. Exhaustive cases test every canonical kind and reject unknown kinds.
If a required active/configured root cannot be resolved safely, staging holds.
This is a typed description/checking seam, not a new host policy engine.

## Phase 0 — Complete normal prerequisites and scope discipline

**Deliverable:** valid coverage, required independent plan verdict, delivered
package interfaces and actual implementation admission. This phase is not
performed by the current plan-authoring action.

1. Recheck all four intake criteria, current classification/baseline history,
   dependency evidence and source restrictions. Obtain normal immutable coverage
   and required plan review; preserve pending or inconclusive outcomes. BI07's
   undelivered package blocks adapter implementation even if the proportional
   readiness projection omits that dependency requirement.
2. Before implementation, bind the ordinary claim to the same actual owner and
   exact source, declare implementation intent, then claim its precise code/test/
   guide paths. Consume the new impact contract; unresolved advice requires
   explicit resolution and exhaustive verification. The document-only advice
   below cannot exempt future code or effects.
   Revalidate canonical coverage after those normal code-path claims and before
   any source implementation. Schema-v3 scope identity includes item body, shape,
   sensitivity and declared edit paths: an unchanged plan blob does not preserve
   coverage across a changed scope digest. Refresh coverage through its normal
   writer when required, verify it against the current scope, and recheck any
   affected admission before the first code edit. No code paths or coverage are
   claimed or written by this plan-authoring action.
3. **Before every commit, read the normal native scope claims and compare every
   staged path with an active edit claim in the owning workroom.** Claim missing
   paths normally before editing them; stop on overlap/refusal without force or
   identity changes. Verify branch, head and staged diff as well. The initial
   design's late path-claim correction remains historical; do not repeat it.

The current plan path was claimed before writing, at
`2026-10-21T07:17:38.669Z`. Its resolved impact contract covers the plan plus the
already claimed design path: no testImpact, guardObligations, routes, migrations,
ratchets or unresolved paths; derived doc-index check
`node scripts/gen-doc-index.mjs --check`. Only the plan is edited now; the design
remains byte-identical to `c176019484fe69dbd214948bc3ec2421c0da9b63`.

## Phase 1 — Validated input, projection and loss report

**Deliverable:** deterministic inert mapping/report; internal sequencing only.
**Files:** proposed contract/projection/control-fit/evidence modules and tests.
**Flows:** inspect-validate; project-report. **Verification:** HER-V01/02/04/09.

1. Write failing cases before implementation for malformed/unknown required
   semantics, inaccessible required references, expired restrictions, source/output
   mismatch and a misleading declaration of supported controls. Receive BI07's
   inspected result and run F958 semantic checks with trusted `options.now`;
   never execute package code, fetch private references or parse the archive again.
2. Implement the single typed definition above. Generate bounded candidate
   `distribution.yaml`, persona/configuration and skill/resource mappings only
   where allowed by the design and source rights. Native paths are mapping data;
   secrets, credential references, grants, private memory, executable MCP settings
   and live schedule state remain excluded. No Hermes build/profile is chosen.
3. Bind each proposed output to inventory/archive/source identities, adapter
   revision, transformation parameters and exact bytes. Use the package owner's
   bounds/provenance and the existing serializer; a native version/name is not
   exact composition identity.
4. Build the report from canonical requirement references: mandatory flag,
   affected stage/capability, all reachable effect paths, implementation/evidence
   references, declared versus assessed support, semantic loss and dependent hold.
   Unknown documentation or missing evidence remains unknown; it is not proof
   of absence. Unknown/unsupported mandatory behavior prevents dependent effects.
5. Preserve original qualification scheme/status/subject/composition/assessor/
   scope/validity and permitted evidence references. No new target inherits a
   source assessment or DPF authorization through import.

**Exit:** source-to-output closure and report negatives pass with synthetic data;
no Hermes process, hook, plugin, model, endpoint or schedule was invoked. This
exit establishes static behavior only and cannot pass I-HER-1 runtime execution.

## Phase 2 — Staging outside discovery and executable trust

**Deliverable:** optional inert output with measured filesystem boundaries.
**Files:** proposed staging module/tests and thin CLI; existing BI07 path checks.
**Flow:** stage-inert. **Verification:** HER-V03, plus HER-V01/02 compatibility.

1. Reuse BI07's portable path grammar and validated bytes. Before materialization,
   resolve the destination and existing ancestors against every active/configured
   discovery root from the canonical typed definition. Reject missing root
   knowledge, symlink redirection, nested discovery destinations and existing
   destination replacement. A new directory inside a discovery root is unsafe.
2. Test fresh paths within home/profile/configuration/skill/hook/plugin/MCP/cron
   roots, external-looking parents redirected by symlinks, duplicate/case-colliding
   paths, partial writes and cleanup. Reject before writing or executable loading.
   `~/.hermes` is not an extraction destination, and native dot paths cannot
   weaken package grammar.
3. Observe filesystem/process/network sentinels and importer/registration spies.
   No native install/import, hook/plugin registration, startup or `HERMES_HOME`
   reassignment occurs. Archive-supplied verifiers, hooks and modules remain data.
   Preserve independently trusted tool identity; packaging cannot bootstrap trust.

**Exit:** measured fixture results show only permitted inert output or an explicit
hold. A timeout/resource-starved or interrupted fixture is inconclusive. No
runtime mediation or complete-confinement claim follows from staging tests.

## Phase 3 — Evidence translation and assessment readiness

**Deliverable:** exact-boundary evidence/report mappings and a held assessment
request for the existing owner; internal sequencing only.
**Files:** proposed control-fit/evidence modules and tests; existing F958 modules
are reused, with no new dispatcher, ledger or policy engine.
**Flows:** observe-reconcile; assess-or-incompatible. **Verification:** HER-V04/07/08/09/10.

1. Test exact actor/tool/target/account, arguments digest/canonicalization,
   purpose, work/profile revisions, policy generation and GPP binding/shape
   revisions. Material mutation invalidates prior authority. Hooks and shell
   allow-lists remain proposed implementations, not current grants or confinement.
2. Translate authenticated observations using the existing effect/attempt
   distinction and unknown outcome. Model-visible transformations, subagent
   summaries, missing completion events and process exit cannot fabricate an
   original-writer receipt. Uncertain prior dispatch blocks another submission;
   only authoritative reconciliation can support a later retry decision.
3. Record the unresolved prerequisites for any runtime exercise: named observed
   Hermes build/OS/surface, authorized synthetic work/profile, current account/
   service authority, effective tool/memory/configuration and policy/hook identity,
   all reachable/disabled paths, accountable recovery and independent assessor.
   Missing inputs hold runtime work. This phase neither selects nor obtains them.
4. Produce the report-only incompatibility branch when mandatory behavior is
   demonstrated unsupported, preserving exact scope/evidence/unknowns and disabled
   dependent activities. An unproven mapping stays an evidence hold. Present either
   branch to the existing assessment owner; no invented qualification status.

**Exit:** static evidence mappings preserve all holds and provenance. No simulated
observation is mislabeled a target receipt or an independent qualification result.

## Phase 4 — Separately admitted target observation and acceptance

**Deliverable:** bounded named-target evidence or reviewed incompatibility, only
after prerequisites and actual execution authority are available.
**Files:** use the existing family harness/fixture owner once its denominator is
provided; claim any exact new adapter integration-test paths before authoring.
Do not freeze a second local conformance suite or invent runtime commands now.
**Flow:** assess-or-incompatible. **Verification:** HER-V05–10 as applicable.

1. The coordinator confirms BI07 delivery, current family denominator/specimen,
   normal implementation/runtime admission and target-specific access. Record
   the observed version and effective composition rather than assuming a declared
   compatibility range. No installation, connection or mutation follows from this
   plan alone. Unavailable governed environment means UNRUN/inconclusive.
2. Exercise permitted synthetic cases through the actual selected boundary.
   Observe required human approval, hook failure/missing execution, argument
   changes, alternative effects, descendants, current authority and uncertainty.
   Use authoritative target evidence; a read-only annotation cannot prove safe
   replay. Preserve model/instruction/tool/memory/enforcement differences.
3. A suitable executing composition requires complete evidence for its declared
   scope and scheme-defined target assessment or attributable equivalence.
   If a mandatory control cannot be implemented safely, obtain the reviewed
   incompatibility result and safe supported posture with dependent effects
   disabled. If evidence is insufficient, retain an explicit hold.
4. Independently assess the original four criteria with exact observations and
   exclusions. Retain unrun cases and unmet portions; neither a native design
   review nor static fixtures can substitute. Complete normal acceptance and
   existing lifecycle reconciliation only when their real conditions are met.

## Verification ledger and comparator traceability

All rows are **UNRUN** for this implementation. These labels schedule proposed
checks, not a frozen family denominator or target selection.

| Verification | Observable boundary | Criterion / design check |
|---|---|---|
| HER-V01 | Trusted package result plus F958 semantic import; malformed, unknown mandatory, inaccessible and expired inputs hold without a duplicate parser. | I-HER-1; AC-HER-01. |
| HER-V02 | Complete reproducible source/output inventory; credentials/private state/active settings excluded; single canonical native-kind definition used by schema and projection. | I-HER-1; AC-HER-02. |
| HER-V03 | Fresh discovery-root and ancestor-symlink negatives; no import/registration/startup, outside write or environment reassignment. | I-HER-1; AC-HER-02. |
| HER-V04 | Every mandatory control and reachable effect path has attributable support/loss/unknown evidence and dependent hold. | I-HER-2, I-HER-4; AC-HER-03, AC-HER-08. |
| HER-V05 | Actual hook permit/deny/approval, crash/timeout/malformed output and missing-hook startup; altered arguments rechecked. | I-HER-1, I-HER-2; AC-HER-04. |
| HER-V06 | Actual shell/direct-code/file/network/MCP/plugin/subagent/background boundaries and surviving descendants. | I-HER-1, I-HER-2; AC-HER-03, AC-HER-04. |
| HER-V07 | Exact effect binding, current authority/revocation and original-writer receipt provenance; no grants inherited from content. | I-HER-1, I-HER-3; AC-HER-05. |
| HER-V08 | Lost transport, restart/cancellation and missing evidence retain unknown; no duplicate submission before authoritative reconciliation. | I-HER-1, I-HER-4; AC-HER-06. |
| HER-V09 | Changed build/model/tool/memory/policy/oversight and expired or conflicting qualification trigger scoped revalidation/equivalence. | I-HER-3; AC-HER-07. |
| HER-V10 | Reviewer can distinguish bounded reproduction, demonstrated incompatibility and evidence hold, with exact scope and disabled dependent activities. | I-HER-2, I-HER-4; AC-HER-08. |

The design's official-source comparisons are reused below; no product is adopted
or selected by this mapping. Hermes hook semantics, command-checking limits,
managed-scope failure and MCP replay/trust differences remain in that design and
the retained 25-source research, not a second policy specification.

| Comparator in the unchanged design | Control/acceptance implication scheduled here |
|---|---|
| Agent Skills | Instruction/resource compatibility and discovery do not grant tool authority: AC-HER-02/03, HER-V02/04. |
| MCP tools | Server identity/annotations do not settle exact authority or replay safety: AC-HER-05/06, HER-V07/08. |
| Agent Plugins 1.0.0 | Permissive loading cannot discard mandatory semantics: AC-HER-01/03, HER-V01/04. |
| Cursor plugins | Host path/loading differences remain explicit losses: AC-HER-02/03, HER-V02/04. |
| Claude plugins | Distributable content and target-local settings/grants remain separate: AC-HER-02/05, HER-V02/07. |
| VS Code extension manifest | Declared compatibility/dependencies do not qualify an executing composition: AC-HER-01/07, HER-V01/09. |

Future source verification uses the repository's pinned tooling: focused new
adapter tests via `pnpm exec tsx --test scripts/lib/hermes-portability/*.test.ts`,
F958 importer/reference-loop regression tests and validators typecheck if their
import closure or exports change, and the delivered trusted-tools type/build
closure when adapter entrypoints are added. Consume actual implementation
testImpact/guardObligations before choosing the final command set. None of these
implementation commands is run by the current plan-authoring action.

Plan-source checks are document-index freshness, related documentation impact,
relative source links, verbatim intake criteria, precommit path-scope/staged-file
comparison and whitespace/DCO checks. Canonical documentation evidence, normal
coverage and plan review are subsequent coordinator actions; the design's older
documentation/spec receipts do not cover this new plan head.

## Risks, rollback and stop conditions

The highest risk is mistaking a new directory for inert content inside a Hermes
discovery root. Derive discovery exclusion from the canonical typed definition,
resolve ancestor redirection before materialization, and measure executable-load
and state effects. Unknown root/context information holds staging. A host-native
installer cannot replace these checks or relax package path rules.

Package interfaces may differ when BI07 is delivered. Reconcile the imported
types and documented trust boundary then; do not preempt its owner, add a second
archive parser, change approved format limits or silently adopt an unreviewed
dependency. An architecture-changing mismatch returns to normal design/coverage.

Hook semantics and available boundaries may differ on the eventual build or
surface. Reproduce each required condition before a scoped claim. A mandatory
loss may make incompatibility the correct result. Authority, privacy, rights and
destination restrictions stay with their existing owners; this plan creates no
approval, permission remedy, outreach or publication right.

Before activation, rollback removes only the adapter's newly created disposable
staging outputs or reverts its source through the ordinary PR path. It must not
delete a profile, credentials, unrelated directories or another workroom's state.
After possible effects, retain original identities/evidence and reconcile through
the accountable target; restoring files never reverses remote effects.

Stop at an unmet dependency, ownership refusal, unknown mandatory control,
unavailable evidence or required gate. Preserve failed/unrun/inconclusive outcomes
without a force, alternate identity or invented receipt. The existing GitHub PR
403 restriction remains in force; this plan action neither retries that operation
nor publishes source. The immediate handoff is a DCO plan commit and normal head
synchronization for the coordinator's later documentation, coverage and review.
