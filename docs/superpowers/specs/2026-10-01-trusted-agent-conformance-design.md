---
status: draft
---

# Executable trusted-agent conformance assessment

**Backlog:** BI-2AB781FA · **Epic:** EP-B932453F · **Workroom:** WC-5D2B3806
**Author:** Codex, under the continuing epic implementation directive.
**Date:** 2026-10-01 (America/Los_Angeles).
**State:** proposed design; independent review and implementation admission pending.

## Outcome and scope

Turn the existing TAK, GAID, TAK-JSI and GPP requirements into a reproducible
assessment: a frozen requirement denominator, named test vectors, actual results,
explicit gaps and links to the evidence for each assertion. A passing unit test
must not become a claim that a live agent is qualified or a tool boundary is
enforced. The assessment must also show whether governance imposes avoidable work
on the operator while preserving required controls.

The first assessed job is the bounded software/documentation-change Workroom
proposed in the [MBSE baseline](2026-09-27-trusted-agent-mbse-baseline-design.md).
BI-9236453D owns its concrete actor, shape, synthetic dataset and operating-profile
snapshot. This item supplies assessment machinery and executable reference vectors;
BI-F3C2EC7A owns executing the complete DPF specimen on the canonical runtime.
Hermes, Cursor, distribution and independent second-archetype reproduction remain
in BI-FEA232AF, BI-0E56BA38, BI-07A2B207 and BI-72ED2A22.

No policy engine, authorization ledger, credential issuer, model evaluator service,
new dependency or database table is introduced. This work does not promote GPP
bindings, change grants, certify an agent or grant permission to release software.

## Existing substrate and architectural fit

Source inspected at `68b5ae4333dfd6acbe87e5b42f23b7706490d32c` and live backlog
read before design. PR #5919 is merged; BI-F9582C48 is done. The prior governed
autonomy plan owns improving control reach, not a portable assessment runner.

| Existing owner | Reuse and boundary |
|---|---|
| `packages/validators/src/trusted-agent-contracts.ts` and `trusted-agent-reference-loop.ts` | Execute public imports in reference vectors; do not copy decision or authority logic into the oracle. |
| TAK/GAID/JSI rubrics and GPP Annex B | Existing assertion identifiers and evidence expectations. Their row count is not the normative requirement denominator. |
| `apps/web/lib/assurance/adapter-contract.ts` | Existing adapter input/output and `passed`, `failed`, `partial`, `error` results. Add a conformance adapter using this contract. |
| `apps/web/lib/assurance/with-assurance-run.ts` | Canonical build-scoped writer. Extract a shared scoped writer and keep the existing build wrapper behavior unchanged; no second persistence implementation. |
| `AssuranceRun`, `AssuranceFinding`, `finding-key.ts` | Existing assessment history and normalized findings. Use existing `policy-violation` and `build-artifact-revision` classifications. |
| `coworker-lifecycle/certification-runner.ts` and its oracles | Job-specific runtime evidence and inconclusive capacity treatment. Read eligible evidence references through an adapter; never translate a certification success into blanket family conformance. |
| `lib/gpp/bindings.ts`, `binding-enforcement.ts`, permit and reach tests | GPP owns binding versions, permits and promotion. The current promoted set is empty; test fixtures cannot change that fact. |
| `governedExecuteTool`, `ToolExecutionReceipt`, `DecisionInteraction` | Runtime mediation and trace owners. The runner requests observations from an adapter; it does not dispatch raw tools or mint replacement authority. |

The existing assurance model already has scope, adapter/version, summary, timestamps
and execution/receipt references. Its summary can retain the bounded assessment
report without a migration. Finding deduplication uses existing canonical keys.
No new persisted closed-set field is needed. All new in-memory/report vocabularies
have one typed owner and strict validation.

## Research & Benchmarking

Primary sources checked on 2026-10-01 local time. These are design comparisons,
not dependencies or claims that the referenced systems implement TAK.

| Source | Adopt | Reject or limit |
|---|---|---|
| [OPA policy testing](https://www.openpolicyagent.org/docs/policy-testing) | Parameterized positive/negative tests, distinct error and skipped results, machine-readable reports and failure on an empty selection. | Line coverage and successful test discovery do not establish policy completeness or target effects. No Rego engine is added. |
| [Cedar authorization](https://docs.cedarpolicy.com/auth/authorization.html) | Explicit decision semantics, deny precedence and diagnostics as test inputs. | Cedar skips errored policies; a permit plus diagnostics must not silently satisfy a required-control assertion. Preserve the assessed runtime's declared error policy and evaluate it. No Cedar engine is added. |
| [A2A specification](https://a2a-protocol.org/dev/specification/) | Version-bound task-state and cancellation contracts for adapter scenarios. | The development specification is not a frozen normative baseline. Task cancellation or completion is not proof of an external effect or its absence. Pin any protocol version used by an actual adapter. |

The durable reuse approach is a small assessment core plus adapters to existing
assurance and runtime evidence. Embedding everything in the certification runner
would couple deterministic standards checks to model/provider availability.
Creating a separate certification service would duplicate the assurance ledger and
increase dependencies. Neither alternative is needed for this bounded outcome.

## Frozen assessment contract

### Requirement manifest

Select the first baseline as TAK-Basic, GAID-Private, TAK-JSI-Defined and
GPP-Modeled, with the principle-directed and data-governance amendments explicitly
included. This is the **assessment target**, not a current conformity claim.
The proposed specimen does not imply GAID-Public, JSI-Qualified or GPP-Enforced.
Additional profiles use separate manifests and cannot reuse a lower-profile pass.

The manifest pins the exact source commit/blob of all four normative documents,
profile names, all applicable mandatory statements (including referenced/general
requirements), assessment identifiers, original clause references and exact text
digests. For the design's inspected revision the source blobs are:

| Document | Git blob |
|---|---|
| `docs/architecture/trusted-ai-kernel.md` | `2fc0b7ae2790a11193bfeba6d79765052abd4fb2` |
| `docs/architecture/GAID.md` | `f0b60a4dfa7d3f18518c5c65d6e1d32291f6d536` |
| `docs/architecture/job-specific-intelligence.md` | `c10f170920efb5f51c10959cbb375108ce7c5210` |
| `docs/architecture/gated-permissions-process.md` | `1dbddf761a0b0a52544cf7048b194dcdc6580e03` |

A source inventory finds candidate MUST/MUST NOT statements in normative sections.
Each candidate receives a reviewed include/exclude disposition with a reason and
source span; profile applicability is not inferred from a regular expression.
Informative examples, quoted requirements and profile-specific exclusions remain
visible in that inventory. Requirements containing several independently falsifiable
obligations split into assessment sub-identifiers without renaming the source clause.
Conditional requirements retain their condition and require evidence for any
not-applicable finding. An unreviewed applicability record keeps the manifest draft.

Every included requirement has at least one executable assertion or a specific
non-automated assessment procedure, named assessor role and required evidence.
An unavailable runtime implementation is **unsupported**, not a manual-review pass.
The checked-in manifest, reviewed source inventory and fixture/oracle versions are
frozen together before a run. Changes require a new manifest revision. Drift in
source bytes fails manifest verification; previous reports remain historical.

### Report and evidence

The versioned report contains run ID, manifest digest, source/adapter versions,
specimen/profile/shape/binding references, environment identity, start/end times,
execution boundary, ordered assertion results, coverage counts and limitations.
Bounds are explicit: 2,000 requirements, 4,000 assertions, 128 evidence references
per result and 10 MiB for a serialized report. Excess is rejected, not truncated.
Larger assessments are partitioned with an explicit parent manifest and disjoint
coverage; no partial page is presented as the whole denominator.

An assertion result is one of `passed`, `failed`, `inconclusive`, `not-run`,
`unsupported` or `assessment-required`. It records expected and actual structured
observations and evidence references. The adapter declares `reference-simulation`,
`source-analysis` or `canonical-runtime`; the caller cannot upgrade that boundary
by editing a report flag. Runtime evidence must be resolved and authenticated by
the host adapter against the actual run/target and current access policy.

Missing evidence, unreachable services, malformed responses, timeout and lost
acknowledgements produce non-verdicts. Only an observed counterexample is a failed
control. An adapter exception never proves that the target did nothing. Already
observed failures remain failures even when another assertion is inconclusive.
The aggregate retains both counts rather than erasing either result.

Coverage reports **mapped / applicable mandatory**, **executed / executable** and
**supported passed / applicable mandatory** separately. A requirement passes only
when all its required assertions/assessments pass at the required boundary. Zero
requirements, empty selections, duplicate IDs, unknown references or omitted results
are invalid/incomplete and cannot return a successful assessment.

Every report labels itself an assessment, not a badge or permission. A complete
profile result is withheld while any mandatory requirement is unresolved, failed,
unsupported or only simulated when runtime evidence is required. For GPP, modeled,
enforced and evidenced eligibility is computed separately; a mode downgrade to
shadow is retained on the individual call. A numeric percentage cannot confer a
higher profile or hide a critical failure.

## Executable vectors and adapters

The reference adapter executes the merged public portable contract and transition
functions without DPF, a model or network access. It emits actual returned commands
and states. Oracles compare those observations against separately authored expected
invariants; returning the expected value as the observation is prohibited.

| Vector group | Required observation | Runtime dependency or limit |
|---|---|---|
| S-01 allowed bounded action | Decision, binding, reservation and outcome remain linked to exact revisions. | Reference sequence is simulated; target receipt requires DPF demo. |
| S-02 missing grant / prohibited effect | No dispatch; the owning gate identifies missing authority. | Live discovery and execution both need runtime adapters. |
| S-03 evidence / scope conflict | Correct hold/escalation, never default admission; owner remains WWMD/WWWD/WSID. | No substituted preference scorer or cross-scope doctrine. |
| S-04 material profile change | Old assessment/authority cannot be transferred to changed actor, tool or profile. | Qualification lifecycle tests remain owned by certification. |
| S-05 expiry / revocation | Current binding and exact-action checks precede dispatch. | Race containment and next-reach behavior need target evidence. |
| S-06 lost response | Effect remains uncertain; observation-only recovery precedes another attempt. | A timeout alone cannot assert `not-submitted` or `no-effect`. |
| S-07 replay / concurrent budget | Duplicate consumption and widening are detected by the relevant oracle. | Durable concurrency must be tested against real storage, not pure-loop fixtures. |
| S-08 shadow / evaluator unavailable | No enforcement claim; unavailable evaluation stays inconclusive. | Preserve per-call downgrade and actual promoted set. |
| S-09 Public authorized data | Valid explicit Public source can proceed to an approved destination. | BI-1F8CCBFF and BI-0212E871. |
| S-10 missing / mixed / noncontiguous classifications | No implicit Public or rank-derived permission. | BI-1F8CCBFF. |
| S-11 transformed / revoked source | Restrictions survive retrieval, summaries, attachments, cache and memory. | BI-BBE6A910; test each supported path. |
| S-12 destination / fallback | No transmission to an unauthorized account; valid fallback re-evaluates. | BI-0212E871 and adapter egress evidence. |
| GPP binding and permit cases | Resolve scope/stage/capabilities; detect stale revision, forgery, replay, changed parameters and unmediated/nested paths. | BI-69415B68 and BI-6DA17863; reuse GPP-001..015 with explicit applicability. |
| Cancellation and bounds | Cancelled work cannot be recreated by generic retry posture; uncertain old effects remain observable. | Resolve PR #5919's cancellation-disposition advisory before live integration. |

Unsupported vectors are listed and executable as capability-negotiation checks,
but do not pretend to execute an unavailable target. Non-automated assessments
include issuer accountability, job-scheme adequacy, threat models and evidence
retention policy where the source requires judgment. They name concrete artifacts
and assessor roles; they are not a miscellaneous bucket for missing tests.

GPP binding revision is independent of shape version. The adapter explicitly maps
portable `enforce` to runtime `enforced`, with `shadow` and `off` preserved, and
rejects unknown modes. A satisfied GPP binding only narrows the actual grant
intersection. A decision score, qualification or MCP token cannot create authority.

Mutation tests deliberately remove exact-binding checks, permit repeat dispatch,
mislabel shadow as enforced, omit a mandatory requirement and convert evaluator
failure to pass. The frozen oracles must detect each mutant. These are test-only
adapters; no intentionally faulty implementation is installed or exposed to users.

## Execution, persistence and privacy

The portable assessment core accepts a validated frozen manifest and a registered
adapter. It runs selected cases deterministically with a fixed test clock and
bounded sequential execution. Adapter identity/version is selected by trusted host
code, never loaded from an arbitrary URL or executable path in a manifest.
The CLI uses the repository's pinned TypeScript tooling and runs without the UI.
Runtime adapters require the canonical nonproduction lease and explicit synthetic
target setup; the CLI cannot silently substitute a simulation after runtime failure.

The DPF adapter returns the existing `AssuranceRunOutput`: complete supported
success maps to `passed`; observed violations map to `failed`; unresolved coverage
without an observed violation maps to `partial`; inability to validate/start the
assessment maps to `error`. Assertion-level non-verdicts remain in the summary.
A reference-only successful run is still labeled reference-only and cannot update
certification status or a GPP enforcement claim.

Generalize the existing ledger writer through a shared scoped primitive, retaining
the current build wrapper and its tested data shape. The new caller persists under
the actual build-artifact revision with genuine execution/receipt references. It
does not invent a build, a human principal or a ToolExecutionReceipt to make storage
work. Standalone runs produce local reports; governed import validates immutable
digests and provenance before adding canonical evidence. Recording the same run
identity is idempotent; different bytes under that identity are a conflict.

Retain source references and redacted bounded observations, not raw prompts, secrets,
permit handles or customer tool arguments. The runtime adapter performs disclosure
and retention checks before export. Reports include policy and target identities
only where the recipient may see them. An external adapter's self-asserted result
is unverified evidence until its provenance is assessed; schema validation is not
authentication. No new public publishing endpoint is added.

## Operator burden and boundedness

Record the existing GPP §11 measures with their denominators and environment when
runtime evidence is available. The cleanup approval encountered in this chat is a
concrete test case: releasing one's own claims after verified completion must be
distinguishable from taking another owner's claim or releasing active risky work.
An unnecessary approval is a governance-friction finding, not permission to bypass
the current gate. The workroom-lifecycle owner repairs that behavior separately.

Requirement and case lookup use indexed maps; evaluation is linear in selected
cases plus declared evidence links. No organization-wide or fleet-wide scan runs
for a single assessment. Reports are bounded as above; the current epic owns the
partitioning contract, not a claim that one in-memory run scales without limit.

## Initiative scope baseline

1. **OBJ-CF-COVERAGE:** Establish a reviewed, version-pinned mandatory-requirement denominator across the selected TAK/GAID/JSI/GPP profiles.
2. **OBJ-CF-VERDICTS:** Produce reproducible assertion results that distinguish violations from missing, unsupported and unavailable evidence.
3. **OBJ-CF-EXECUTION:** Execute positive, negative and fault vectors against the reference implementation and expose an honest adapter boundary for runtime assessment.
4. **OBJ-CF-REUSE:** Integrate assessment evidence with existing assurance records without duplicating authority, qualification or persistence owners.

| Acceptance | Objectives | Statement | Evidence |
|---|---|---|---|
| AC-CF-01 | OBJ-CF-COVERAGE | The frozen source inventory dispositions every candidate mandatory statement; every applicable requirement maps to executable assertions or a concrete non-automated assessment, with profile exclusions reviewed. | Inventory/manifest completeness and source-drift tests; independent manifest review. |
| AC-CF-02 | OBJ-CF-COVERAGE, OBJ-CF-VERDICTS | Empty, omitted, duplicate, mismatched or unsupported mandatory evidence cannot produce a complete passing profile assessment. | Negative denominator and aggregation tests. |
| AC-CF-03 | OBJ-CF-VERDICTS | Infrastructure failure, unavailable evaluators, timeouts and lost responses remain non-verdicts while genuine observed violations remain visible. | Mixed-result and error-injection tests. |
| AC-CF-04 | OBJ-CF-EXECUTION | Reference vectors execute real public functions and detect the named unsafe mutants; runtime-only vectors are explicitly unsupported until a qualified adapter supplies target evidence. | Standalone runner and mutation tests. |
| AC-CF-05 | OBJ-CF-EXECUTION, OBJ-CF-VERDICTS | GPP scope, separate revisions, grant narrowing, permit/replay, mode mapping and bypass cases are represented, with no enforced/evidenced claim derived from shadow or simulation. | GPP manifest/oracle tests and boundary-negative tests. |
| AC-CF-06 | OBJ-CF-REUSE | The DPF assurance adapter and shared scoped writer preserve existing build callers, exact run identity, receipt linkage and non-verdict detail, without a new ledger or automatic certification change. | Adapter/writer compatibility and persistence-idempotency tests. |
| AC-CF-07 | OBJ-CF-REUSE, OBJ-CF-VERDICTS | Reports enforce bounds and disclosure/provenance contracts, preserve actual versions and document target/environment limitations and retention obligations. | Malformed/oversize/redaction/provenance tests. |
| AC-CF-08 | OBJ-CF-EXECUTION, OBJ-CF-COVERAGE | A documented CLI produces reproducible standalone reports and an assertion-to-evidence map; runtime verification uses the canonical target and remains distinguishable from unit evidence. | CLI output fixture, consumer guide and scoped canonical verification. |

## Verification, rollout and documentation

Follow test-first implementation after design, independent approval and plan
coverage. Run validator tests, assurance adapter/writer regressions, certification
consumers affected by any refactor, typechecks and repository guards. New runtime
integration is exercised on the leased canonical target before any runtime claim.
The heavy production build remains in the cloud merge queue. No migration is
planned; if a persisted closed axis becomes necessary, revise this design first.

Update the conformance assessment document and consumer instructions in the same
implementation branch. Preserve the normative owners and existing rubric IDs;
point to versioned reports rather than manually copying coverage numbers into
multiple pages. Public claims must name the assessed profile and actual boundary.

Roll out additively: reference runs first, assurance evidence integration next,
then separately governed runtime adapters through their existing items. Rollback
reverts the runner/adapter PR; retained AssuranceRuns remain historical and readable.
No live grants, binding promotion, scheduler default or qualification state changes
need reversing. The full epic remains open after this assessment deliverable.
