---
status: draft
---

# Reusable DPF architecture: source map and extraction boundaries

**Backlog:** BI-E23432C1. **Design Workroom:** WC-3803E996.
**Source inspected:** `20f932062657053e463b93ed4167760085c45dec`, fetched `origin/main`, October 18, 2026.
**Execution sequence:** [implementation plan](../plans/2026-10-18-reusable-architecture-extraction.md).

This is a source-grounded extraction proposal. No component has been moved, no
caller migrated and no extraction qualified yet. Existing source characterization
passed 622 tests. Implementation remains held for immutable design/plan review
and live plan coverage. The source remote is public. The operator authorized
local implementation, production coordination records and, on October 18, public
publication of only this map and its implementation sequence so those reviews
can run. Refactoring code, releases and deployments remain unpublished.
No budget is allocated by this document: the Workroom reports
`funding-organization-unresolved`.

## Objective and acceptance baseline

**OBJ-REUSE:** Extract working domain responsibilities with actual DPF and portable consumers while maintaining one supported DPF product.

**OBJ-AUTHORITY:** Preserve canonical identities, separate accountable roles, owning-scope doctrine, exact versions, current authority and trusted effect mediation.

**OBJ-ABSORPTION:** Give DPF2 bounded, testable absorption slices with explicit retirements and maintenance obligations; keep its files read-only here.

**OBJ-TRUTH:** Distinguish working code, source-local tests, deployed behavior, production enforcement and standards qualification.

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-EX-01 | OBJ-REUSE, OBJ-TRUTH | Map all seven families to actual sources, tests, callers, persistent owners, coupling, competing implementations and qualification gaps. |
| AC-EX-02 | OBJ-REUSE | Each completed extraction has a documented public boundary and supported subset, meaningful normal/adverse tests, one application-free consumer and one migrated real DPF caller; displaced implementation is removed in the same slice. |
| AC-EX-03 | OBJ-AUTHORITY | Preserve serialization, ordering, definition/profile/binding versions, role identities, current revocation, independent review, rework/cancellation and uncertain-effect handling wherever the extracted responsibility owns them. |
| AC-EX-04 | OBJ-AUTHORITY | WWMD, WWWD and WSID retain separate authority and corpus ownership; advice and missing context do not grant execution reach; GPP's full capability combination retains an actual attributable human decision. |
| AC-EX-05 | OBJ-ABSORPTION | Every completed extraction records an exact source revision, entry points, dependency closure, runnable contract tests, trusted adapters, unavailable capabilities, notices, maintenance owner and concrete DPF2 absorption/retirement guidance. |
| AC-EX-06 | OBJ-REUSE, OBJ-ABSORPTION | A portable DPF2-shaped customer-report/self-improvement scenario exercises the common Workroom/GPP lifecycle without starting DPF or modifying DPF2. |
| AC-EX-07 | OBJ-ABSORPTION, OBJ-TRUTH | Operating-surface extraction proves useful joined software/customer work and a restaurant or shelter job, including current responsibility, commitments, constraints and actions; a gallery render alone is insufficient. |
| AC-EX-08 | OBJ-AUTHORITY, OBJ-TRUTH | No production business data, credentials, grants, infrastructure or unapproved public distribution changes; unqualified execution remains held. |

## Design grounding and existing owners

Read the current [rulebook](../../../AGENTS.md), [orientation](../../architecture/orientation.md),
[Workroom vocabulary boundary](../../architecture/workroom-vocabulary-boundary.md),
[GPP 0.19](../../architecture/gated-permissions-process.md),
[standards family](../../architecture/agent-standards-family.md),
[GPP compiler design](2026-10-02-gpp-shape-notation-and-compiler-design.md), and
[portable trust design](2026-09-27-portable-tak-contracts-design.md).
The [existing portable trust plan](../plans/2026-10-01-portable-tak-contracts.md)
already supplies contracts and reference transitions; rebuilding those is outside
this proposal.

Consumer context was read from `/Users/markbodman/DPF2`: `AGENTS.md`,
`docs/COMPONENT-ARCHITECTURE.md`, `docs/ABSORPTION-AND-DEPENDENCIES.md`,
`docs/IMPLEMENTATION-PLAN.md`, `packages/core/CONTRACT.md`,
`packages/experience/CONTRACT.md` and `evaluations/requirements.json`.
DPF2 has no commit yet, so its working files are context, not an immutable release.
Its R004–R006, R011–R020 and R028 require distinct scope owners, one work/command
path, exact binding/permit versions, non-widening authority and an atomic store
owner. Its native executor is unavailable. The existing core/control/experience
fixture composition is the adoption target; it is not evidence of live execution.

Later October 18 consumer guidance in `docs/WORKROOM-PRACTICES-AND-AUTONOMY.md`
and `research/work-practices-pr-patterns-and-autonomy.md` refines the reusable
unit to a complete work practice. Those read-only design inputs establish no
new implementation, production or publication authority. Their selected PR
study is a design hypothesis, not measured interruption rates or a reproduced
universal cause; this map does not adopt those claims as runtime evidence.

The package homes already exist: `packages/types` owns portable representation;
`packages/validators` owns Zod contracts and pure validation/reference behavior;
`packages/storefront-templates` owns archetype derivation. Prefer internal
submodules or narrow exports there. No observed isolation, ownership or load
requirement justifies a new service, queue, datastore or supported installation.
Do not add a package merely to mirror a family heading.

### Research and alternatives

This is an extraction of existing implementations, not a new workflow standard.
The inspected alternatives are the current DPF application modules, existing
portable trust modules and DPF2's independent fixture core. Retain DPF's working
graph and compiler semantics; use DPF2 as a second consumer that exposes hidden
coupling. Reject a wholesale directory copy: the compiler imports application
registries and enforcement policy. Reject running both orchestration engines
inside DPF or importing DPF's queue/database into DPF2. Separate distribution
remains a later decision after both consumers run the same conformance tests.

This document makes no new claim about external competitors, licensed standards
or market efficacy. Existing standards/design sources above remain normative for
their own scope; this refactor does not revise them.

### Reusable work practice and first proof

The reusable asset includes its scenario/objective, graph and collaboration,
skill/corpus requirements, JSI assessment scheme, GPP obligations, operating
presentation and ordinary/adverse/recovery cases. Compose those references over
the existing `WorkUnitDefinition`, `OperatingFlow`/Stage, WorkShape, archetype and
asset owners. A work practice is a description of that composition, not an eighth
engine, catalog, scheduler or knowledge store.

Keep four meanings distinct: reusable definition; company binding and tailoring;
the exact operating composition with its current qualification status; and the
actual occurrence with assignments, cycles, attempts, evidence and outcome.
Shipping an assessment scheme does not establish a passed assessment. Suggested
knowledge is distinct from required context; missing required context holds its
dependent obligation. Share scoped references and synthetic assets, never private
corpora, live grants or credentials.

`work-management/room-definition-contract.ts`, `room-review-profile.ts` and
`room-review-profile-catalog.ts` already compose common → source → shape → facet →
category → leaf → organization requirements. The composer preserves evidence and
critical failures, tightens freshness, reports conflicts and fingerprints the
result. It imports the source registry/catalog and Node hashing; separate those
adapters before portable reuse. Its read contract assesses neither evidence nor
authority. `room-review-profile.test.ts` characterizes non-removal, conflicts,
provenance, freshness and unsupported definitions; it was inspected, not run here.

Carry a bounded descriptor and referenced fixtures alongside the first safe
graph move: software/customer need → accepted improvement, including linked
self-improvement work. Identify unimplemented portions explicitly; do not require
an exhaustive practice catalog or portable profile-composer extraction before
that move. Later contrast shelter intake → housing → care handoff under the same
lifecycle, with canonical domain facts and authorized physical attestations.
Merged software delivery and an accepted customer outcome remain separate facts.

## 1. Workroom engine

**Actual source and consumers.** `apps/web/lib/work-management/drive-resolution.ts`
(`resolveDrivePlan`) and `drive-resolution-graph.ts` produce plans;
`apps/web/lib/queue/functions/workroom-drive.ts` (`applyDrivePlan`) owns execution.
`workroom-drive-review-stages.ts` also consumes the planner. Working pure seams
include `work-shape-flow-graph.ts`, `drive-marking.ts`,
`workroom-drive-receipts.ts`, `drive-deadlines.ts`, `drive-child-rooms.ts`,
`writeback-latch.ts`, `drive-conclusion.ts`, `room-relations.ts` and `work-unit.ts`.
`customer-status-projection.ts` consumes WorkUnit adapters.

**Persistence and identities.** `packages/db/prisma/schema/work-coordination.prisma`
owns `Workroom`, mapped to physical `WorkCapsule`, and its participant, relation
and activity records. Keep `WC-*` identities, requester/creator/executor/lease
holder distinctions, `scopeClaims` and `workspaceState.workroomDrive` marking.
Existing `TaskRun`, `ScheduledAgentTask`, WorkItem cycles, command receipts and
activity sequencing remain owners, not data to replicate in a component store.

**Distinctive behavior.** Stable graph element identity, ordered transitions,
typed relations and contains-cycle prevention, iteration/run-scoped receipts,
parallel joins, rework, recurring runs crossing UTC midnight, child rooms,
deadline notices and writeback latches. Missing receipt iteration means zero.
Malformed marking is retained and pauses work; deadlines do not advance stages.
Rework must invalidate prior evidence/reach rather than replay it. Runtime and
reference interpreter remain independent implementations checked for parity.

**Receipt compatibility and host protection.** Existing receipt matching can
treat an absent expected or recorded run as a wildcard and can count any
non-blocked receipt kind. Preserve that behavior for existing DPF callers during
the move; it is not a completion contract for a new host. The synthetic consumer
must require exact room/run/cycle/stage/iteration/attempt identity, a declared
receipt kind, current actor/profile/binding versions and confirmed effect facts.
It must validate artifact content/revision and transitive input lineage, invalidate
superseded evidence on rework, hold uncertain effects and reject changed-payload
replay. Recheck these facts at use rather than trusting a prior accepted receipt.
The marking step does not authenticate a human verdict or supply complete GPP
enforcement. Its host withholds completion until the required human and current
admission checks pass.

**Coupling.** `work-shapes.ts` combines definition contracts with the entire
registered-shape corpus; split that dependency before moving behavior. Keep
Prisma, Inngest, authenticated accountability lineage, DPF grants, portfolio
attribution, notifications and UI projections in application adapters.
`work-unit.ts` is already import-free, but moving it alone would export a
projection contract, not an orchestration engine.

**Boundary and consumers.** First extract structural graph/receipt contracts and
marking transitions into existing portable homes. Inputs supply pinned shape,
prior marking/receipts, trusted time and observed child/effect facts. Return
validated transitions or intents. DPF's drive adapter retains the transaction and
all side effects. The GPP interpreter and a synthetic DPF2-style coordinator are
additional consumers. Later extract the full planner after registry and policy
separation, preserving the single command path.

Only a host-validated exact pinned definition may enter the kernel. The current
graph builder can skip unresolved edges and keep the first duplicate identity;
the marking reader checks the supplied graph, not an independently authenticated
definition revision. Existing `workroom-shape-claim.ts`, `getWorkShapeVersion` and
`workroom-shape-rebind.ts` retain definition resolution, marking/definition
identity comparison and current rebind admission. Exercise those preconditions
in both DPF and synthetic-host fixtures; the token step alone does not supply them.

**Closure.** Minimal graph/receipt roots depend on `element-ids.ts`,
`diagnostics.ts`, `executable-constructs.ts` and the structural action-result
contract. They have no third-party runtime dependency. `element-ids.ts` still has
a type import from the web GPP schema. Split structural shape/prior-latch types
from the registry. Move the host dispatch representation `DriveTokenPlan` to its
existing resolver owner so action/reason policy need not enter the kernel. Move
the canonical structural action-result helper with a real caller bridge rather
than copying its vocabulary. Complete that closure; do not leave package imports
pointing back into `apps/web`.

**Adjacent modules.** `scheduling/scheduled-work-trigger.ts` normalizes existing
task triggers; `proactivity/proactivity-resolver.ts` separates policy from its
server loader. `author-stage-autonomy.ts` joins preauthorization with portfolio
funding but embeds delivery-shape/profession policy. `portfolio/investment-read-model.ts`
and `PortfolioBudgetPeriod` remain funding owners. Workroom stall/rebind attention
sources project holds into existing attention. `account-handover.ts` has exact-set
review but also Prisma-shaped ports and coordinator appointment. Extract those
working subsets in a separate slice; do not invent commitment or capacity stores.
Scheduling/attention/funding may propose, narrow or wake work, never widen reach.

**Retirements and risks.** Remove moved application implementations and migrate
all imports. Update `scripts/check-work-unit-conformance.mjs` if WorkUnit moves:
it names and inspects the current path. Workroom/WorkCapsule/capsule and
WorkItem/TaskRun are existing vocabulary seams, not competing authorization
systems to rename casually. All construct flags are true, yet a forward edge
into a failure/budget stop still throws `DriveConstructNotImplementedError` in
`drive-marking.ts`; explicit stop/refusal routes differ. Preserve this unsupported
topology until separately implemented and characterized. Unit parity does not
qualify live dispatch, concurrent workers or cancellation of external effects.

**Tests.** `work-shape-flow-graph`, `drive-marking`, `drive-resolution`,
`drive-parity-{parallel,rework,deadline,sub-shape}`, `drive-sequential-{run,identity}`,
`workroom-drive-{receipts,state,checkpoint}`, `room-relations`, `room-cycle*` and
`work-unit` tests provide the characterization corpus. Only the explicitly listed
subset in the plan was executed in this audit.

## 2. GPP toolkit

**Actual source/consumer.** `apps/web/lib/gpp/shape-language` owns strict parsing,
source schema, resolution, compilation, diagnostics, emission, bindings drafts,
soundness and reference interpretation. `apps/web/scripts/build-gpp-shapes.ts`
compiles `work-management/shape-documents/inquiry-response-watch.gpp.json` to a
generated shape registered by `work-shapes.ts`. This is a real build-time
consumer. The compiler itself has no datastore.

**Distinctive behavior.** Decoded duplicate-key rejection, BOM/CRLF/trailing and
depth rules, strict schemas, stable diagnostic pointers/element IDs, deterministic
emitted bytes/digests, no output on errors, resolution through `GppResolveSources`,
soundness S-1…S-6, bounded reference transitions and draft binding emission.
JSON source, lowered WorkShape and frozen prior definitions are compatibility
representations with different jobs. Preserve schema generation from Zod and
legacy/decompile round-trip fixtures as one definition system.

**Hidden coupling.** The schema imports outcome, evidence, collaboration-shape and
trigger vocabularies from web modules. Soundness imports `validateWorkShape` from
registry-bearing `work-shapes.ts`. DRC imports TAK/room grant checks, baseline
grants, gap lists, governed-stage derivation and the enforcement table. Resolver
types include DPF consequences. Emitter hardcodes `../work-shapes` as its generated
type-import destination. `resolve-sources.ts` loads DPF tools/grants/agent seed
facts and source scanning. Keep that adapter in DPF and inject portable facts and
output destination through narrow ports.

**Boundary/retirement.** Move parser/schema/resolve/diagnostics/compiler/emitter
and portable checks to validators, reusing Workroom structural contracts. Migrate
the actual build script and interpreter directly; remove displaced pure files.
Leave ratification, permit issuance/consumption, auth, enforcement promotion and
source-registry access in DPF. `GppPermit` and `GppPermitObservation` in
`ai-coworker.prisma` retain persistence. No compiler service is needed.

**Qualification limits.** `GPP_BINDING_ENFORCEMENT` is empty. DRC C-5 capability
co-occurrence and C-7 build-sandbox containment are `not-evaluated`; C-9 can also
be unevaluated without source facts. Draft binding output grants nothing. GPP
0.19 requires an actual attributable human decision for the supported full
capability combination; a validator result cannot stand in for it. Source flags,
compiler fixtures and mock adapters establish neither complete conformance nor
production mediation.

For GPP 0.19 §8, assess one actor/session's effective combined envelope across
relevant graph nodes and tool routes. Splitting untrusted input, sensitive access
and state change/outward communication across stages cannot evade its actual
human decision. A stage/session label alone proves no runtime isolation. DPF2's
current declared-stage fixtures do not implement general cross-stage aggregation;
the composed-envelope scenario is unimplemented/unrun, not a conformance claim.

**Tests.** Parser/schema/compile/determinism/emit, generated integrity, resolver
no-DB, DRC corpus, soundness, registry round-trip and interpreter/drive parity.
Golden emitted bytes, diagnostics, hashes and all pinned prior definitions are
compatibility assertions; do not silently replace digest semantics.

## 3. Scoped judgment and knowledge

**Actual source/callers.** `apps/web/lib/decision/option-scoring.ts` and
`mcda-quality-gates.ts` are pure. `uncertain-retry.ts` supplies bounded retry
behavior. Actual consumers include `mcp/packs/principle-decide-pack.ts` through
`wiki/principle-decide.ts`, `decision-perspective/option-recommendation.ts`,
`decision/golden-decisions.ts` and retry/ledger/drift/evidence code.
`packages/validators/src/decision-scope.ts` already owns scope literals.

**Owners/coupling.** `DecisionPerspectiveProfile`, its versions/materials and
`DecisionInteraction` remain in `decision-governance.prisma`; WikiPage and its
revision/source/link records remain scoped knowledge owners. The perspective
evaluator mixes pure calculation with material resolution/persistence. Do not
move organization/profile lookup, profession registry, embedding/provider calls,
corpus contents, escalation or decision recording into a generic library.

**Boundary.** Extract scoring and quality logic into validators, with a scoped
input/output boundary carrying declared owning scope, revisioned references,
applicability/constraints, missing-context result and reasons. Inject scoped
knowledge retrieval and outcome feedback. Numerical ranking is advice. Preserve
WWWD's organization-owned stance and advisory platform fallback, WSID profession
resolution and producing-gate audit scope even when a fallback profile was used.
Current scope admission uses declarations/tool consequence rather than prose.

Outcome feedback already has a bounded WWWD path:
`wiki/org-decision-capture.ts` validates capture and derives standing-stance page
content; `lib/actions/org-decision-capture.ts` authenticates and records
`captureOrgDecisionOutcome`, optionally promoting organization-owned stance.
WWMD outcome capture remains in `lib/actions/decision-perspective.ts`.
Keep these authenticated writers and corpus ownership in DPF adapters. Portable
evaluation can return feedback intent and synthetic tests can feed an authorized
owner ruling into the next equivalent consult. Do not infer a complete portable
feedback loop for WSID or move company rulings into the platform corpus.

**Hardening and competing terms.** Characterize before rejecting non-finite or
out-of-range values, duplicate identities, invalid config and excessive input.
Coordinate malformed-option work with BI-9889566B. Scorer
`proceed/uncertain/decline`, consultation
`recommend/arbitrate/escalate/defer/decline`, authorization
`allow/deny/require-approval`, runtime `allow/require_confirm/refuse` and assurance
`certified/failed/stale/never` describe different facts. Map them explicitly;
never collapse them into a single approval/status enum.

**Retirements.** Remove application scoring implementations after direct caller
migration. A compatibility export is allowed only for a real caller: name the
maintainer, BI-4DD124E7 and the condition that the final import is migrated. Keep
one scope vocabulary and one decision ledger. No private organization corpus is
copied into fixtures or DPF2.

**Tests.** `wiki/principle-decide`, insufficient-signal/overlap-scan, MCDA quality,
three-band verdict, situational-weighting backtest and uncertain retry; supplement
with scope fallback/missing-context/revision and adverse-input cases at the new
boundary. A pure scorer alone does not constitute scoped judgment.

## 4. Coworker operating profiles

**Working substrate.** `packages/validators/src/trusted-agent-contracts.ts`
already defines `trustedOperatingProfileSchema`. Runtime composition resides in
`tak/prompt-assembler.ts`, `prompt-loader.ts`, `agent-grants.ts` and the pure
`coworker-lifecycle/coworker-definition.ts` conformance projection.
`identity/aidoc-resolver.ts` builds the current operating-profile fingerprint;
it feeds governed/semantic memory, identity snapshots, agent cards and UI.

**Persistent owners.** `Agent`, `AgentGovernanceProfile`, `AgentExecutionConfig`,
`AgentSkillAssignment`, `AgentToolGrant`/revocation, `AgentModelConfig` and existing
prompt/skill assignment records. Reuse these sources through an adapter; do not
create another editable profile registry.

**Current maturity/gap.** Fingerprinting is real and tested. It hashes model
binding, sorted prompt-class `taskType:label` references, sensitivity, default
HITL and effective grants through `routing/metadata-hash.ts`. It omits exact
prompt/skill contents/revisions, doctrine, supervision/autonomy/delegation policy,
tool-operation revisions and harness/runtime version. Thus it does not identify
the complete operating composition required for transferable qualification.
`certification-status.ts` uses agent/run status and eight-day freshness;
`lifecycle-gate.ts` tolerates unknown/never/stale and infrastructure failures,
blocking failed certification only in strict mode. Profession-evidence relevance
is also called qualified in a separate path. Preserve these distinctions.

**Boundary/retirement.** Harden the existing versioned portable composition with
job/role/supervision/model/instruction/skill/tool/governed-memory/config references,
retaining GAID identity separately. Migrate a real AIDoc/memory caller; version
any fingerprint algorithm change and retain old stored-hash interpretation until
all consumers have a tested migration. New identity does not manufacture JSI
evidence. Remove displaced composition/hash code after that checkpoint.

**Tests/owner.** `identity/aidoc-resolver.test.ts`,
`agent-identity-snapshot.test.ts`, portable contract tests and composition-change
fixtures. Scope: BI-9874488F, with BI-07A2B207 retaining reference-package/export
ownership. Full composition qualification remains unavailable until evidenced.

**Process qualification.** Include coordinator and independent-reviewer jobs in
the assessment scheme: issued pinned packet → eligible reader/consumer →
authenticated judgment → durable exact-subject receipt. Cover admitted ownership
and delegation through cleanup, exact runtime/target and output codec, lost
acknowledgment, quota/capacity wait, deadlines, cancellation and replay. Preserve
failed versus unrun/inconclusive checks. An inaccessible receipt does not prove
no execution. These are qualification requirements, not completed assessments or
permission to repair production within this extraction.
Current `work-management/coordinator-eligibility.ts` returns `not-applicable` when
no scheme is present. Preserve that incumbent compatibility separately; never
export it as a passed portable qualification. Relevant characterization includes
`mcp/independent-review-packet-roundtrip.test.ts`,
`change-review/semantic-review-request.test.ts` and
`work-management/coordinator-eligibility.test.ts`; these were inspected, not run.

## 5. Trust contracts and runtime boundaries

**Already portable.** `packages/validators/src/trusted-agent-contracts.ts` and
`trusted-agent-reference-loop.ts` import and transition artifacts independently
of DPF. Their supported protocol is draft 0.1.0, simulated and non-authoritative;
no production importer/reference-loop consumer was found. Reuse this working
subset rather than building a competing protocol.

`trustedWorkDefinitionSchema` declares `flow: "sequential"`. The graph engine's
capabilities do not extend that draft interchange schema. Export only a declared
supported subset, or separately version and qualify graph exchange; never flatten
split/join/rework silently or claim existing reference transitions support them.

**Trusted production owners.** `mcp-governed-execute.ts`,
`govern/authority/coworker-authority-decision.ts`, `tak/gaid-actor-envelope.ts` and
`tak/tool-execution-receipt.ts` retain mediation. Principal aliases, grants,
`AuthorizationDecisionLog`, `CoworkerActionEnvelope`, `GppPermit`/observation and
`ToolExecutionReceipt` retain persistence. GAID identifies and binds receipts;
JSI qualifies; GPP describes the admitted envelope; TAK enforces current reach.

**Adapter obligations.** Authenticate context and events, use trusted time,
recheck current grant/profile/revocation/parameter reach at use, serialize state
transitions, reserve effects durably, consume dispatch once and reconcile
uncertain effects. Reference transitions return state/intents; they do not commit
to another store. Independent review and requester/reviewer/executor/human
identities remain separate.

Keep deterministic validity, independent acceptance, current bounded authority,
consequential human consent, funded budget, capacity and uncertain effects
distinct. Reuse valid authority within its exact scope; phase changes, routine
result recording and owned cleanup do not alone create a new human decision.
Recheck material purpose/reach/content/composition/binding changes, expiry and
revocation, and retain mandatory host/client consent and GPP human decisions.
A quota hold is capacity evidence; an uncertain attempt still requires original
effect reconciliation before a safe qualified fallback or replay.

**Tests/gaps.** Existing contract and reference-loop tests passed 50 cases here;
these do not prove production enforcement, tenant isolation or job qualification.
Keep BI-F9582C48's existing contract implementation and BI-2AB781FA's combined
conformance ownership. An extraction introduces no new credential, server or
enforcement configuration. No production trust path is retired by claiming a
reference loop is equivalent.

## 6. Business operating models and surfaces

**Working portable source.** `packages/storefront-templates/src/twin-profile.ts`
and `twin-value-stream.ts` derive physical/logical grammar, nouns, zones, queues,
capacity and value-flow bindings from `ArchetypeDefinition`. They already have
real twin/workspace consumers and tests. Keep that package as vocabulary owner.
`apps/web/lib/twin/operations-snapshot.ts` defines versioned slices/watermarks;
`operations-loader.ts` and `living-business-snapshot.ts` join domain facts.
`TwinView.tsx` and primitives render those inputs. The workspace panel strips
`cog`/`quests` so `OperatorCockpit` remains the home attention owner.

**Canonical facts and useful jobs.** Restaurant loader/projection/seat/move/turn
adapters join booking demand, tables, staffing and service turns. Canonical owners
are `StorefrontBooking`, `HospitalityResource`, capacity allocations and
`HospitalityServiceTurn`/events. Shelter lifecycle/readiness/intake/adoption/care
modules use `AnimalProfile`, `AnimalCustodyEpisode`/event, adoption application,
placement, resource occupancy and subject-bound `WorkEngagement` recurrence.
`OperationalSceneLayout` owns geometry only. Domain repositories retain atomic
mutation; renderers and generic allocation advice cannot acquire authority.

**Actual tests.** Restaurant loader/command/move/turn/projection tests cover stale
facts, overlap, combined tables, atomic turns, staff/guest privacy and capacity.
Animal-welfare intake/adoption/daily-care/readiness/cockpit tests cover legal
holds, duplicate/stale identity, full-housing rollback, exclusive reservation,
fees plus custody/housing completion, returns/new episodes, typed evidence,
recurrence and overdue-medication follow-up. These were inspected, not executed
in this audit. The existing restaurant browser signal test requires seeded demo
facts and can skip reconciliation without pending guests.

**Consolidation gaps.** Generic ROOMS still calls `buildDemoRoomsOperationalView`
for shelter/boarding; that is not the working shelter day. Generic non-FLOOR
`living-business-snapshot.ts` remains booking/provider-centric and can label paid
invoices as delivered jobs; TENANTS taxonomy/render tests do not establish a
software/customer operating day. `archetype-outcome-facts.ts` counts public
`AdoptableAnimal` listings for custody/adoption, while the rescue cockpit uses
canonical animal/custody facts. Replace that interpretation through a shared
canonical fact adapter after reconciliation. `Resource*` exists alongside live
`Hospitality*`/`Beauty*` callers; migration tests preserve legacy rows, so no
capacity-store retirement is established.

**Boundary/retirement.** Separate declarative profile, authorized fact/snapshot
projection and renderer. Port domain facts through their existing owners. Move
remaining `loadLivingBusinessSnapshot` consumers to versioned snapshots before
retiring its compatibility facade; retire listing-as-custody interpretation and
demo-only claims in the same relevant slice. Keep domains' actual work,
responsibility, commitment, constraint and contextual command references visible.
Verify software/customer and restaurant or shelter jobs plus accessibility and
information density. Do not broaden into a new metrics/task/policy database.

## 7. Commons learning and Hive exchange

**Working source/callers.** `hive/finding-contribution.ts` provides pure
eligibility/outcome rules. Its store/tool and `mcp/packs/contribution-hive-pack.ts`
call existing escalation and record successful contribution. The local-only
knowledge sweep routes/deduplicates findings but never contributes automatically.
`hive/result-intake.ts` plus `build/contribution-egress.ts` normalize bounded
allow-listed results; `result-store.ts`, `/api/v1/hive/results` and human actions
own durable receipt/delivery. Code contribution still resolves FeatureBuild to
FeaturePack and attempts a public PR through `mcp/contribution-hive-delivery.ts`.

**Owners/coupling.** `HiveContributionLedger` in `knowledge-docs.prisma` owns
receipt/provenance/review/retry facts; `ImprovementProposal` in work-coordination
owns the local finding/backlog link; `FeaturePack` owns incumbent code packaging.
Scoped commons retain content ownership. Transport/auth/federation/GitHub/config
and source selection stay injected adapters. The ledger is not another corpus.

**Actual inconsistency.** Finding-store tests require escalation success before
contributed status/ledger writes and distinguish policy refusal from fault.
`finalizeHiveContribution` instead updates matching proposals to contributed even
with `prUrl: null`, and its caller finalizes before returning PR failure; it does
not write a ledger. This is a source-level mismatch, not a diagnosed production
incident. Preserve separate saved/reviewed/share-approved/sent/delivered/accepted
facts instead of extracting both interpretations as supported engines.

**Boundary/retirement.** Use one private Workroom candidate/review/change
lifecycle, typed code/finding/result adapters and one provenance/content home.
Keep exact-content and destination review, scope privacy, pause/private/DCO
controls, opaque receipt dedupe and conflicting-payload refusal. Migrate actual
callers and retire FeatureBuild-only source resolution and conflicting lifecycle
handlers. Accepted intake is distinct from governed adoption. No generalized
code/knowledge adoption or complete Hive learning loop is established today.

**Tests.** Finding/store tests cover duplicates, missing backlog, skipped versus
failed escalation and success-only writes. Result/store tests cover bounded
allow-lists, size, durable intake independent of forge, payload conflicts and
idempotent remote delivery. Sweep tests cover routing/dedupe and no automatic
egress. Run synthetic/private transport tests only in this task; no public
contribution or organization-corpus export is authorized.

## Dependency, maintenance and absorption disposition

| Retained home | Retained dependency | Disposition and obligation |
|---|---|---|
| `@dpf/types` | TypeScript toolchain; no production dependency declared | Absorb only needed structural contracts into DPF2; keep one version owner. |
| `@dpf/validators` | Existing pinned Zod catalog dependency | Retain schema implementation where needed; a plain-data adapter is an alternative only with identical semantic tests. Do not import its entire barrel if that defeats bounded closure. |
| `@dpf/integration-shared/canonical-json` | The subpath itself is import-free; package also declares Undici | Use the narrow entry for new compatible hashing only. Existing signed/persisted hash helpers have deliberately different semantics; prove byte parity or version/migrate them individually. Do not pull HTTP transport into a pure component. |
| `@dpf/storefront-templates` | Existing source-derived archetype vocabulary | Absorb selected grammar/derivation with its dependency closure; do not copy private organization instances or a second editable catalog. |
| DPF web adapters | Next.js/React, Prisma, Inngest, providers and installation context | Keep at the product boundary. DPF2 supplies its own trusted adapters to its current command/store. |

The repository and the first two package manifests declare Apache-2.0. Preserve
`LICENSE`, source notices, upstream revision, modifications and fixture provenance
when copying source. This is a checked declaration, not a complete rights audit.
Do not infer third-party content rights from repository visibility. Existing
`.github/CODEOWNERS` names `@markdbodman`; that remains the accountable code owner.
Each slice must name its ongoing module maintainer at handoff rather than invent
a new team. Copying source transfers patching, security review, version drift,
test/toolchain and upstream reconciliation duties to the consumer.

Planned additions are internal modules, contract fixtures and documentation.
Planned removals are the displaced pure implementations, duplicated status
interpretations and obsolete imports/facades once their callers migrate. No
added process, image, store, credential, subscription, installation choice or
operational service is justified. Measure changed imports/dependency closure and
maintenance actions per slice; source movement alone proves no burden reduction.

Every completed slice must carry a manifest with exact commit and entry points,
public schemas/types, complete import closure, command-runnable contract tests,
supported/unsupported cases, required trusted adapters, actual caller removals,
notice disposition, owner and rollback. None exists as a completed extraction yet.

**Standalone closure proof.** Build and execute the delivered source and synthetic
fixtures in an isolated Node 24, ESM, TypeScript NodeNext project. Resolve only the
manifest's exact source and pinned runtime/type dependencies: no application
aliases, workspace-wide resolution or producer dependency symlinks. Use `.js`
relative imports and separate browser-safe graph/schema entries from the offline
compiler's Node-only entry (`compile.ts` uses `node:crypto`). A monorepo Vitest
import is insufficient. Node 24.16.0 is available locally; this isolated build and
execution remain unrun until the extraction exists.
Include the exact TypeScript/toolchain version, standalone manifest/lock, NodeNext
configuration and executable emitted entry. Resolve `catalog:`/`workspace:` to
pinned standalone dependencies. Parameterize the emitter's current
`../work-shapes` type import and compile generated output against the delivered
portable contract.

## Concrete DPF2 adoption targets

| Slice | Absorb into existing owner | Retire only after parity | Keep held or external |
|---|---|---|---|
| Workroom graph/evidence | `packages/core` structural/transition adapters | Only structural graph/dependency calculations actually replaced, after unchanged command/experience fixtures pass | Keep core's protected artifact/content/revision/transitive-lineage, admission, permit and readiness checks. `apps/control/src/store.ts` remains the atomic state/version/receipt/outbox owner. |
| GPP toolkit | Compiler-produced supported serial shape adapted to current core shape/binding types and fixtures | Duplicated supported serial shape validators and hand-built seed definitions where actually replaced | Runtime permit enforcement, actual-human full-combination gate and native executor qualification. |
| Scoped judgment | Typed advice port in core with scope/source versions and explicit missing context | Corresponding duplicated pure option evaluation only; current DPF2 has no complete scoped evaluator to claim retired | Standing-decision admission and WWWD/WWMD/WSID authority; current `Policy.doctrine` lacks WSID. |
| Operating profiles/trust | Existing profile/runtime port using portable draft contracts | Displaced fixture profile checks only after equivalent contract tests | Exact-composition JSI, authenticated event/receipt adapters, durable effect dispatch and current revocation. |
| Business projection | Existing `packages/experience/getOperatingSurface` contract | Only specific replaced calculations; `getBusinessOverview` is already retired and must not return | Authenticated scoped query completeness and non-software domain transactions. |
| Commons | Current private synthetic contribution/review flow | Corresponding replaced private candidate checks | Public transport, private corpus export and generalized adoption. |

The first portable scenario links a customer-report room to a self-improvement
room, compiles a supported shape, evaluates scoped advice, processes review and
rework, repeats a cycle and rejects revoked/stale reach or uncertain completion.
It runs under a synthetic host without importing Next.js, Prisma, Inngest or any
provider. Advice cannot advance the human gate. The control host still owns
transactions. A simulated permit/reference loop remains visibly simulated.
This is a proposed scenario, not an executed reuse claim.

## Review, migration and rollback

Review boundaries before moving files. Characterize the current bytes and
semantics first; then move one coherent responsibility, migrate its real caller,
delete its displaced implementation and run unchanged fixtures plus adverse
cases. Split DPF-specific policy from portable contracts without changing policy.
Separate move-only parity from intentional hardening changes. Each new refusal
must name its diagnostic, affected caller, compatibility/version treatment and
adverse fixture; do not present stricter input rejection as unchanged behavior.
No schema migration or production backfill is proposed for the first three
slices. If one becomes necessary, stop and design its expand/contract path with
the canonical data owner rather than silently extending this refactor.

Rollback each extraction as one scoped revert restoring callers and the prior
implementation together. Do not revert immutable DB migrations, rewrite issued
hashes or reinterpret old profile/binding records. A compatibility bridge needs
a real caller, `@markdbodman` ownership, its slice BI and a removal condition tied
to that caller's migration. Retain no unused alternative engine.

Implementation admission is separate from this map. Required next evidence is
independent baseline/review, provider-verified plan coverage and each slice's
exact edit-path impact contract. Source-local tests are not canonical runtime
evidence. No claim of production enforcement, tenant isolation, complete standard
conformance, real business outcomes or release readiness follows from this audit.
