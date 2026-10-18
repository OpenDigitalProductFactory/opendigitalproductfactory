---
status: draft
---

# Reusable architecture extraction sequence

**Umbrella:** BI-E23432C1. **Design Workroom:** WC-3803E996.
**Source base:** `20f932062657053e463b93ed4167760085c45dec`.
**Canonical proposal:** [source extraction map](../specs/2026-10-18-reusable-architecture-extraction-design.md).
**State:** publication of these two planning artifacts authorized; no implementation admission or coverage receipt.

For agentic workers: execute this plan one independently reviewable backlog item
at a time, with one BI, one branch and one PR. Use `dpf-tdd` for characterization
and meaningful adverse behavior, `dpf-local-merge-ci-before-push` and the slice's
completion gate before success claims, and `dpf-pr-with-dco` for handoff.

## Current task brief and stop condition

Produce working reusable implementations with real DPF consumers, beginning with
Workroom flow/evidence, GPP tooling and scoped judgment. Audit all seven families;
extract working subsets honestly. DPF2 remains read-only. No live business data,
credential, grant, infrastructure or enforcement promotion is authorized. The
operator explicitly allows production backlog and Workroom coordination writes.
On October 18 the operator additionally authorized publication of only the map
and this sequence to the existing public source repository for required review.
Refactoring code, releases and deployments remain unpublished.

The map now exists and 622 source-local characterization tests passed. No
component has been moved and no caller retired. Design/plan review and live
coverage remain unrun. `record_plan_backlog_coverage` requires a provider-verified
immutable Git blob. The verified source repository is PUBLIC. Its source resolver
reads GitHub, not local uncommitted files. Publishing these two planning documents
is now authorized to satisfy that source prerequisite. Source implementation
still requires independent approval and live coverage; do not fabricate a receipt
or lower the delivery shape.
The Workroom's funding allocation is unresolved, so no funded capacity or budget
decision is made here.

Applicable procedure: current AGENTS §§3–5, branch/worktree and planning runbooks,
`dpf-worktree-per-session`, `dpf-writing-plans`, then per-slice build/review rules.
The design claim is `delivery-xlarge@1.0.0`, allowed for design only. The umbrella
must be decomposed and must never enter implementation as xlarge.

## Backlog coverage

**Coverage receipt: not recorded.** The rows below map proposed independently
shippable slices to live intake items; they do not constitute governed coverage,
triage approval or implementation readiness. Child items remain triaging.
Existing portable trust work is reused, not recreated or claimed complete here.
The server chooses the receipt contract; this client may not choose a weaker one.

| Key | Live BI | Independent | Dependencies | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|---|---|---|
| workroom-kernel | BI-DBA1FE11 | Yes | Approved umbrella baseline/coverage | AC-EX-01, AC-EX-02, AC-EX-03, AC-EX-05, AC-EX-06 | WK-01 | WF-01 | CT-WK |
| gpp-toolkit | BI-721C467A | Yes | workroom-kernel | AC-EX-02, AC-EX-04, AC-EX-05, AC-EX-06 | GP-01 | GF-01 | CT-GP |
| scoped-judgment | BI-4DD124E7 | Yes | Approved umbrella baseline/coverage | AC-EX-02, AC-EX-04, AC-EX-05, AC-EX-06 | SJ-01 | JF-01 | CT-SJ |
| workroom-policy-modules | BI-D30CD423 | Yes | workroom-kernel | AC-EX-02, AC-EX-03, AC-EX-05 | WP-01 | PF-01 | CT-WP |
| operating-profiles | BI-9874488F | Yes | workroom-kernel; existing portable trust contract | AC-EX-02, AC-EX-03, AC-EX-04, AC-EX-05 | OP-01 | OF-01 | CT-OP |
| business-surfaces | BI-9A6163AD | Yes | workroom-kernel | AC-EX-02, AC-EX-05, AC-EX-07 | BS-01 | BF-01 | CT-BS |
| commons-exchange | BI-0D316824 | Yes | workroom-kernel; scoped-judgment | AC-EX-02, AC-EX-04, AC-EX-05, AC-EX-08 | HX-01 | HF-01 | CT-HX |

The design map supplies AC-EX-01 and the authority/qualification constraints
shared by every slice. The following WK/GP/SJ/WP/OP/BS/HX and flow/test references
name responsibilities within this plan, not new platform entities or standards.
Record a `decision: decomposed` receipt only after the immutable plan and approved
scope baseline exist. Bind the complete graph, BI mappings and four reference
lists above; then retain the returned receipt and validate it with
`check_plan_backlog_coverage`. If a baseline or receipt is refused, follow its
specific remedy without switching lanes or self-approving.

## Design grounding and impact contract

Read the source map's current file/owner/consumer evidence before claiming code
scope. Existing designs remain authoritative for runtime semantics. DPF2's
component/absorption/core/experience contracts require one canonical command and
transaction owner and explicitly retire duplicated lifecycle paths.

The current docs-only scope claim returned a resolved change-impact contract:
no test-impact or guard obligations, with doc-index regeneration/check required.
Claim the generated index path before changing it. Each implementation slice
must make a fresh exact edit-path claim and consume its returned `testImpact` and
`guardObligation` entries before edits. An unresolved contract means exhaustive
verification. The current claim is not permission to edit code paths.

## Slice 1: Workroom graph and evidence kernel

**Contract WK-01.** Existing structural shape, graph element, marking,
receipt/run/iteration and transition-intent contracts, independent
of application aliases/registries. Trusted time and observed effect/child facts
are inputs. Canonical command/effect/persistence ownership remains in DPF.
**Flow WF-01.** Pinned graph → marking/event → validated intent → existing host
transaction → durable receipt → next evaluation.

Host precondition: only a validated exact pinned definition enters this kernel.
Retain `workroom-shape-claim.ts`, `getWorkShapeVersion` and
`workroom-shape-rebind.ts` as the existing definition/marking identity and rebind
owners. Their checks must also exist in the synthetic host adapter. The current
graph builder can skip dangling edges and retain first duplicate identities;
the marking step alone does not reject stale definition identity.

Existing DPF receipt wildcard/kind semantics remain compatibility behavior during
the move. The synthetic host requires exact non-empty run/cycle/stage identity,
iteration/attempt, declared receipt kind and current profile/binding context.
It verifies protected artifact content/revision and transitive input lineage,
actual required human decisions and confirmed effects before projecting receipts
into the kernel. It rechecks old accepted evidence, invalidates reworked inputs
and holds pending/uncertain effects. Structural extraction does not retire DPF2's
protected artifact, lineage, admission, permit or readiness validation.

1. Characterize `work-shape-flow-graph.ts`, `workroom-drive-receipts.ts`,
   `drive-marking.ts`, shared IDs/diagnostics/construct vocabulary and the exact
   consumer closure. Include the currently unsupported forward-to-failure/budget
   stop topology as an explicit refusal, not a silently enabled feature.
2. Separate contracts from registry-bearing `work-shapes.ts`; give portable
   structural contracts one existing home. Avoid importing the web GPP schema
   just for `GppShapeDocument` types. Reuse types/validators rather than adding a
   package or creating a second action/result vocabulary. Keep `DriveTokenPlan`
   and action/reason dispatch policy in the existing resolver; share the minimal
   prior-latch type and move the canonical action-result helper with real callers.
3. Move the smallest executable closure, migrate `drive-resolution-graph.ts`,
   runtime marking consumers and the GPP interpreter/checks directly, and delete
   displaced implementations. Keep reference interpreter independence for parity.
4. Add a standalone synthetic host consumer with linked customer-report and
   self-improvement rooms. It owns its in-memory transaction and uses the same
   transitions for both jobs. No Next.js, Prisma, Inngest or provider import.
   Build and execute only its manifested source/fixtures in an isolated Node 24,
   ESM, TypeScript NodeNext project with `.js` relative imports and exact pinned
   dependency closure. No aliases, workspace-wide resolution or producer
   dependency symlinks. Keep the browser-safe graph/schema entry separate from
   Node-only compiler code. Node 24.16.0 is available; this proof remains unrun.
   Deliver the exact TypeScript/toolchain version, standalone manifest/lock,
   NodeNext configuration and executable emitted entry. Resolve `catalog:` and
   `workspace:` specifications to pinned standalone dependencies.
5. Publish the slice's contract/closure/provenance/rollback record when authorized.
   A graph builder plus WorkUnit adapter alone cannot be called a Workroom engine.

**CT-WK.** Existing graph/marking/receipt/parity/sequential tests plus malformed
marking, stale pinned definition, missing evidence, duplicate delivery,
run/iteration separation, midnight continuation, refuse/rework, cancellation and
uncertain-effect holds at the relevant responsibility. Verify retained ordering
and serialization. Test trusted time through input, not wall-clock sleeps.
Require wrong/missing run and receipt kind, cycle/iteration mismatch, changed
artifact content/profile/binding/input lineage, cross-room upstream rework,
identical replay and conflicting-payload replay fixtures. The host atomically
owns evidence, marking, dedupe and intents; an unknown effect never completes.
Update WorkUnit's path-sensitive conformance guard only if WorkUnit actually moves.

**Retire/rollback.** Remove moved pure web implementation and update real imports
in this slice. Revert its package move and caller changes together. No persistent
identity, DB table, issued hash or queue ownership changes.

## Slice 2: GPP toolkit

**Contract GP-01.** Strict source → schema/resolve/diagnostics → lowered shape,
draft binding and deterministic emitted artifact; DPF policy facts and emission
destination are ports. **Flow GF-01.** Current `.gpp.json` → offline compiler →
registered generated definition → unchanged Workroom execution path.

1. Extract stable outcome/evidence/trigger/shape vocabularies without bringing the
   application registry. Move parser, schema, resolution, diagnostics, compiler,
   emitter and portable soundness checks into existing module homes.
2. Retain `GppResolveSources`; inject DRC's grant/consequence/gate/enforcement facts
   and emitted type-import destination. Keep DPF `resolve-sources.ts`, ratification
   and enforcement state in application adapters. Missing check data remains
   explicitly unevaluated.
3. Migrate `apps/web/scripts/build-gpp-shapes.ts` and real interpreter/soundness
   consumers. Delete displaced pure compiler files; do not leave a permanent
   re-export directory with no actual caller.
4. Run an application-free compiler consumer and unchanged byte/diagnostic
   fixtures. Extend Slice 1's synthetic host with a supported serial generated
   shape, pinned definition and binding versions, and actual-human-required hold.
   Test a field-by-field mapping from each generated stage to the consumer's
   actor, action, output, admitted envelope and binding, retaining exact versions,
   unresolved facts, unsupported refusal and not-evaluated diagnostics. Missing
   facts cannot acquire permissive defaults. Exercise this in the subsequent GPP
   slice, not as extra scope in the first graph move. Separate browser-safe schema
   exports from the Node-only offline compiler and prove both declared closures.
   Map shape/stage identity; resolve `accountablePrincipalRef` and
   `advance.decisionScope/gate` separately to assigned actor and owning authority.
   Map `tools` to supported actions/capabilities, preserving absent versus empty;
   `evidence` alone cannot establish an accepted output artifact. The host supplies
   missing output kind, effect/cost bounds, capability envelope and qualification
   facts. Binding labels cannot establish qualified enforcement or override the
   actual-human co-occurrence gate. Unresolved or unrepresentable mappings refuse.
   Parameterize the emitter's `../work-shapes` type import and compile generated
   output against the portable contract.

**CT-GP.** Parser limits and duplicate decoded keys, schema strictness, missing
resolution facts, malformed/unknown constructs, deterministic hashes/IDs/output,
legacy/current versions, generated integrity, DRC/soundness and interpreter/drive
parity. Errors must emit no executable module. Empty enforced-binding state and
unassessed capability/containment checks remain visible.

**Retire/rollback.** Retire exact pure compiler/check duplicates and seed/fixture
definitions only where the new compiler actually replaces them. Restore prior
generator and module imports together on revert. Preserve old signed/persisted
hash semantics; a canonical JSON helper substitution needs separate byte parity.

## Slice 3: Scoped judgment

**Contract SJ-01.** Declared scope and revisioned context/principle references,
applicability, constraints and options produce bounded advisory evaluation,
reasons, uncertainty/missing context and feedback intent. Authenticated owning
decisions and scoped corpus retrieval are host responsibilities.
**Flow JF-01.** Owning-scope context → pure evaluation → advice → existing
scope-specific gate → canonical decision/audit record → authorized owner outcome
capture → same-scope standing context → next equivalent consult. DPF's
`wiki/org-decision-capture.ts` and `lib/actions/org-decision-capture.ts` own WWWD
capture/standing stance; `lib/actions/decision-perspective.ts` owns the WWMD
adapter. A complete portable WSID feedback loop is unsupported in this slice.

1. Preserve current scoring/quality fixtures before moving implementation.
2. Extract `option-scoring.ts` and `mcda-quality-gates.ts` into validators. Retain
   one scope vocabulary. Split any retry calculation from async persistence and
   escalation rather than pulling those into the package.
3. Add the scoped boundary and meaningful finite/range/duplicate/config/size and
   missing-context validation. Coordinate BI-9889566B's existing malformed-option
   work; do not create a second validation policy.
   Keep move-only parity fixtures separate from each intentional new rejection;
   record its diagnostic, real caller compatibility and version treatment.
4. Migrate actual MCP/perspective/golden-decision callers. Remove the displaced
   scoring implementation. Any temporary compatibility export names its actual
   caller, `@markdbodman`, BI-4DD124E7 and final-import removal condition.
5. Extend the synthetic consumer with WWMD, WWWD and WSID advice. Cross-scope
   fallback remains advisory; absent owning authority cannot become admission.
   Private corpus fixtures are prohibited; use synthetic scoped references.

**CT-SJ.** Existing primitive/MCDA/three-band/overlap/backtest/retry fixtures;
adverse bounds and identities; wrong/revoked/stale source context;
WWWD organization-owned fallback behavior; WSID producing-gate identity; missing
context and independent human admission. Record unsupported semantics instead of
returning a favorable default.

Exercise synthetic WWWD owner capture and re-consult, wrong-scope capture refusal
and absence of automatic promotion from feedback intent. Existing
`wiki/org-decision-capture.test.ts` and `lib/actions/org-decision-capture.test.ts`
remain adapter characterization; no private company ruling is bundled.

**Retire/rollback.** Remove moved math; keep one decision ledger and profile/corpus
owner. Revert callable boundary and consumers as one change. A score is never a
permit, qualification certificate or business-owner decision.

## Remaining independently reviewable slices

| Slice and contract | Concrete sequence and consumer | Required flow and checks | Retirement / qualification limit |
|---|---|---|---|
| Workroom policies, WP-01 | Separate current trigger/proactivity/autonomy/funding/attention facts from DPF loaders; migrate actual scheduler and attention consumers. Reuse canonical commitment/budget owners. | PF-01: proposed commitment/wake → current authority and budget resolution → eligible room intent. CT-WP: duplicate wake, revoked/stale context, missing budget, cancellation, deadline attention and capacity hold. | Remove displaced policy copies; no second calendar, scheduler, commitment, approval or budget database. No schedule or recommendation grants authority. |
| Operating composition, OP-01 | Extend existing portable profile references; characterize AIDoc fingerprint consumers; migrate one identity/memory consumer through a versioned adapter and add an application-free composition/fingerprint consumer sharing contract fixtures. | OF-01: canonical composition → exact version/digest → current qualification query. CT-OP: every material prompt/skill/tool/model/supervision change, revocation, equivalent config ordering, old algorithm compatibility and missing evidence in both consumers. | Remove old hash/composition implementation only after stored-record compatibility checkpoint. Existing freshness-only certification cannot stand in for complete JSI. |
| Business surfaces, BS-01 | Reuse storefront derivation; separate authorized fact/snapshot projection from renderer; migrate a real workspace snapshot consumer and canonical shelter fact adapter. | BF-01: canonical business facts → versioned snapshot → current work/responsibility/commitments/constraints/contextual actions. CT-BS: software/customer plus restaurant seating or shelter intake/care/adoption, stale/concurrent facts, privacy, keyboard/screen-reader/mobile and useful density. | Retire listing-as-custody metrics, replaced booking-centric interpretations and remaining legacy snapshot facade callers. Keep real Hospitality/Resource migration obligations and demo limits explicit. |
| Commons exchange, HX-01 | Join code/finding/result candidates through current Workroom and contribution ledger; inject typed source/transport/review ports; migrate real callers. | HF-01: private candidate → exact-content/destination review → approved egress intent → receipt/delivery → accepted intake → governed adoption. CT-HX: private/mixed source refusal, changed reviewed bytes, revoke/cancel, transport failure/retry, duplicate/conflicting receipt, uncertain delivery and adoption hold. | Retire FeatureBuild-only source selection and inconsistent contributed-on-failure handling. No automatic public transport, corpus export, second knowledge store or generalized adoption claim. |

These scopes are not permission to implement unbuilt capabilities speculatively.
Each must first bound its working subset and refine its own design/impact plan.
Family 5 uses the existing draft contracts/reference transitions and leaves
trusted production mediation in DPF. It introduces no eighth alternative engine.

## Source characterization actually run

Managed dependency bootstrap reported `compile-ready`, pinned pnpm `10.33.2`, no
ignored builds and no stale workspace links in the isolated worktree. Vitest was
`5.0.5`. Each command used an explicit package root and named test files.

| Run | Files | Tests | Result and limits |
|---|---|---|---|
| Workroom/GPP baseline | 16 | 484 | Passed, exit 0; independent interpreter parity and existing source only. |
| Judgment and identity baseline | 9 | 88 | Passed, exit 0; no production assurance or complete profile qualification. |
| Portable trust baseline | 2 | 50 | Passed, exit 0; draft simulated protocol only. |

Exact commands, run from the isolated worktree:

```sh
pnpm --filter web exec vitest run \
  --root /Users/markbodman/dpf-worktrees/reusable-architecture/apps/web \
  lib/work-management/work-shape-flow-graph.test.ts \
  lib/work-management/workroom-drive-receipts.test.ts \
  lib/work-management/drive-marking.test.ts \
  lib/work-management/drive-parity-parallel.test.ts \
  lib/work-management/drive-parity-rework.test.ts \
  lib/work-management/drive-parity-deadline.test.ts \
  lib/work-management/drive-parity-sub-shape.test.ts \
  lib/work-management/drive-sequential-run.test.ts \
  lib/gpp/shape-language/parse.test.ts \
  lib/gpp/shape-language/compile.test.ts \
  lib/gpp/shape-language/determinism.test.ts \
  lib/gpp/shape-language/drc-corpus.test.ts \
  lib/gpp/shape-language/soundness.test.ts \
  lib/gpp/shape-language/interpreter.test.ts \
  lib/gpp/shape-language/interpreter-parity.test.ts \
  lib/gpp/shape-language/bindings-emit.test.ts --maxWorkers=2

pnpm --filter web exec vitest run \
  --root /Users/markbodman/dpf-worktrees/reusable-architecture/apps/web \
  lib/wiki/principle-decide.test.ts \
  lib/decision/option-scoring.insufficient-signal.test.ts \
  lib/decision/option-scoring.overlap-scan.test.ts \
  lib/decision/mcda-quality-gates.test.ts \
  lib/decision/three-band-verdict.test.ts \
  lib/decision/situational-weighting.backtest.test.ts \
  lib/decision/uncertain-retry.test.ts \
  lib/identity/aidoc-resolver.test.ts \
  lib/identity/agent-identity-snapshot.test.ts

pnpm --filter @dpf/validators exec vitest run \
  --root /Users/markbodman/dpf-worktrees/reusable-architecture/packages/validators \
  src/trusted-agent-contracts.test.ts src/trusted-agent-reference-loop.test.ts
```

The initial unfiltered root `pnpm exec` invocation was hook-refused; the documented
filtered invocation ran without override. A Vite future configuration-loader
warning was non-failing. No product defect is inferred from that invocation
refusal. No typecheck, database integration, served-target UX, full build,
extracted-component contract consumer, live enforcement or release check has
passed as part of this audit. Surface-family tests were inspected only.

## Per-slice completion and DPF2 handoff

Each slice needs its actual edit-scope contract, affected unit tests and package
typecheck. Reuse valid characterization evidence when source/identity permits.
Runtime-bound build and applicable UX checks use the canonical/shared governed
nonproduction runtime, never a hand-built live image. No migration is proposed
for the first three slices. Follow repository source-review and merge rules only
after publication is authorized; local test success cannot substitute for gates.

The completed-slice handoff must include:

1. Exact commit and portable entry points/types/schemas; complete transitive
   dependency closure and notices, including retained dependencies and absorption
   alternatives.
2. Supported/unsupported behavior and runnable normal/adverse conformance tests
   usable by DPF2 without starting DPF.
3. Required trusted adapters for authenticated context/time/revocation,
   transaction/effect reservation/dispatch/reconciliation and scoped knowledge.
4. The actual migrated DPF caller and removed implementation/imports, with any
   bounded compatibility owner/BI/removal condition.
5. DPF2 target and retirements: adapt into current `packages/core`; retain
   `apps/control/src/store.ts` as transaction owner and `packages/experience` as
   projection. Retire corresponding handwritten checks only after unchanged
   fixture parity. Do not modify DPF2 in the producer task.
6. Maintenance owner, upstream revision/reconciliation duties and one scoped
   revert. Preserve issued hash, definition/profile/binding and record identity.

## Remaining decisions and resumption

The operator authorized publication of these exact two planning documents. Obtain
the independent baseline/review and plan coverage through the existing governed
route, map the deliverables, then claim and execute the first admitted local
slice. Publishing refactoring code still needs a separate later decision about
the completed code; do not publish it under the planning-documents exception.
No runtime deployment, package release, website change or private-corpus
publication follows from this permission.

If the governed review or coverage route refuses admission, preserve the exact
refusal and follow its recorded remedy before source implementation. This is the
explicit stop required by the planning contract, not a completed extraction or an
enforcement/qualification result.
