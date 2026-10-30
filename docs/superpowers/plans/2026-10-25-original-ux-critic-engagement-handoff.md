---
status: active
---
# Original UX Critic engagement handoff implementation plan

Backlog: BI-BCBCA8D1. Workroom: WC-6CCF8DAB.
Design: docs/superpowers/specs/2026-10-25-original-ux-critic-engagement-handoff-design.md.

## Scope and acceptance

This is one atomic correction to the existing engagement execution contract,
separated by the existing E27 owner's acknowledged handoff. Reuse its partial
code with provenance; do not copy its unrelated framework or replay E85C.
No phase is independently shippable because dispatch without attributable result
persistence reproduces the defect and result projection without safe dispatch
cannot prove execution. Admission/coverage must be current before source edits.

Original BI acceptance, verbatim:
- An authorized low-risk service engagement can execute through a governed catalog lifecycle and return attributable findings and artifact references.
- Advisory design critique remains distinct from formal initiative gate receipts; refusal returns a usable supported remedy when needed.
- Status requested, running, completed and failed reflect execution and never equate request creation with completed review.

Contract references: original-engagement-execution; immutable-revision-association;
server-owned-read-provenance; original-workroom-result-return.
Flow references: request-authorize-dispatch-execute-persist-return;
lost-response-observe-same-task; unknown-effects-no-replay.
Verification references: engagement-regression-suite; governed-integration-checks;
original-ce-live-critic-result; attributable-routing-author-disposition.
Requirement references: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7.

## Sequence

1. Record the live trace and decision for code rather than generic configuration.
Reconcile existing ownership and exact scope claims. Resolve impact advice for
all claimed paths before Red. Use existing BI and immutable plan provenance for
the live coverage receipt. Keep failed/unrun gates explicit.
2. Write failing behavioral regressions against existing partial contract:
metrics-only audit, incomplete source, free-text f52 substitution, concurrent
reservation, changed authority, unknown effects and duplicate Workroom return.
Expected touched tests: engagement-fulfillment.test.ts,
engagement-task-contract.test.ts, engagements.test.ts,
external-coworker-task-adapter.test.ts and coworker-service-catalog-pack.test.ts;
add engagement-read-provenance.test.ts for shared compact read evidence.
3. Refactor existing partial fulfillment into pure binding, source-provenance,
result validation and transactional lifecycle helpers. Integrate through existing
task submit/worker/authority boundaries after normal shared-file claim handoffs.
Preserve original CEs and exact immutable scope; add explicit revision association.
4. Add actionable failure/read states and idempotent result return using existing
Workroom activity/projection and engagement metadata. Update contributor/user
workflow docs and generated artifacts identified by the impact contract.
5. Run affected tests and package typechecks. The current impact contract requires
style-drift-guard and doc-index/capability-completeness derived checks. Resolve
additional shared-file impact obligations before editing those paths. Run exact
canonical integration and required checks; publish a ready signed PR and use the
protected merge queue. No test result is implied by this plan.
6. Request canonical self-upgrade, verify served source, and fulfill original
CE-724328D6 with its f52 artifact through the supported tool. Reconcile CE-1FE20783
within its original research/no-runtime-mutation boundary. Associate any newer
review explicitly. Read actual task/engagement result, provenance and Workroom
return; send genuine result to original routing chat for author disposition.

## Backlog coverage

One atomic deliverable: original-engagement-handoff, BI-BCBCA8D1; dependsOn=[].
Coverage receipt: cmvo23l846g8i01muim8ioqrg at immutable plan f93da777d5795fcf8fe75da20c60cb8f55b69fe4; research initiative-ed514e78-0428-45af-84d8-80ec7ca3b9c8; implementation admitted IRD-8699D18EC453. Refresh coverage after source/scope changes.

## Risks and rollback

Authority validation, durable task admission and result provenance are the main
risks. Missing provider read authority or room admission is an actionable refusal,
never permission to self-grant or share source using the requester's identity.
Source-only checks remain structural; acceptance requires actual Critic execution.
Rollback retains historical bindings/effects and disables new admission; unknown
outcomes remain fenced and unreplayed. Review and deployment proof are separate.


## Live continuation correction (2026-10-25)

The canonical .133 runtime admitted CE-724328D6 once, then its original task
failed in immutable request reconstruction before execution reservation. The
JSONB round trip reordered nested binding keys used by the v2 JSON.stringify
digest. Preserve the original digest by normalizing only engagement bindings
into the original admission order, including nested locators. Do not change
non-engagement packet hashing. Verify actual PostgreSQL readback and unchanged
original packet. Load reconciliation dependencies before its transaction and
retain atomic completion plus Workroom return; phase timings locate any remaining
latency. Observation errors must identify projection failure without dispatch.

An explicit identical fulfillment may reserve one continuation of this exact
known pre-admission failure on the same TaskRun. Require the worker's exact
reconstruction error, original digest/CE/prompt/scope, unclaimed dispatch 1,
no heartbeat, no effects/inference/messages/fences and no prior continuation.
Revalidate current caller and original authority with the existing same OAuth
family continuity contract; retain the origin identity and digest. Keep the
entire failed progress snapshot in a versioned continuation record, CAS the
original failed row, and persist a fresh deterministic dispatch event 2. Never
resume an unknown or started execution. Observer calls never reserve work.
This adds no service, authority grant, table, replacement CE or new TaskRun.

## Capacity continuation correction (2026-10-25)

The real original worker passed reconstruction and authorization on .135, then
received four known Anthropic quota refusals before any tool ran. Preserve that
known failure separately from unknown provider outcomes. Supported Codex model
discovery succeeds but supplies no context/output capacity: retain unknown
limits and current clearance; do not invent evidence to force routing.

Explicit identical fulfillment must wake only its original submitted, due
capacity wait through the existing deterministic outbox/CAS. Reconstruct and
match the complete stored engagement packet; validate both current caller and
original authority in the same consent family. No new CE/task, origin rewrite,
backoff/budget override, unknown replay or observation-triggered execution.
Preserve server-owned pre-admission continuation history at the shared settlement
seam for capacity, success, refusal and exception results. Add behavioral
regressions for targeted queueing, due times, cancellation, concurrent retry,
changed scope/current authority and immutable history. Source graph found the
existing dispatch/worker/receipt-heal and adapter/fulfillment suites; settlement
has no linked test, so add one and run the wider source-local execution suites.
Existing import-cycle, architecture, derived-artifact, typecheck and governed
integration obligations remain required. Completion still needs the real result.

Attributable route evidence supersedes the capacity hypothesis for this turn:
RouteDecisionLog cmvoeada201qc01p8m6kpkurf excluded every Codex/ChatGPT model for
missing imageInput; raw authenticated model/list explicitly reports
inputModalities=[text,image]. The shared OpenAI extractor discards this source
field. Extend only that authenticated catalog shape, validate the supported
modality list, retain explicit text-only versus unknown, preserve existing admin
overrides and all unknown capacity values. The unchanged supported discovery/
profile refresh then makes actual capability evidence available to routing.
No coworker requirement, clearance, credential or grant is weakened. Related
catalog BI-59E37E39 remains with its existing ownership; this narrow extractor
correction is necessary to execute the original CE and is coordinated with E27.


## Native read transport correction (2026-10-26)

DEV v2026.10.26 / 966b served verification passed. Same-task dispatch 3 completed
with zero actual ToolExecution rows. Both normally returned Codex turns refused the
text-described tool protocol even though the private prompt archive contained
all three schemas. The evidence guard correctly withheld the unverified draft;
CE-724328D6 is unavailable, not a critique. This is no longer a provider-capacity
failure. No completed attempt has been replayed.

Reuse the existing internal MCP session transport for a server-bound read-only
Codex lane: exact three enabled readers, same user/coworker/task execution fence,
original OAuth and current grant intersection revalidated by every governed
call, private per-child configuration streamed over stdin, required startup,
read-only sandbox with shell disabled, owned-child closure and private cleanup.
No native calls are extracted or dispatched a second time. Fold this attempt's
native executions once before the evidence guard. Add a read-evidence completion
policy using existing immutable traversal/profession/calibration provenance;
incomplete evidence must not trigger another inference or accept prose as evidence.

A completed legacy INV5 attempt is NOT resumable from zero governed DB calls
alone: its unrestricted native shell/descendant/credential effects were not
captured. Preserve that uncertainty; the new restrictive transport is never
retroactive proof. The existing recovery owner must supply a supported finite
disposition before CE724 can proceed. No legacy replay has occurred.

Prospective incomplete contributions remain held and nonresumable too unless
the existing execution-proof producer supplies qualified actual dispatch/native
closure/effect evidence. No caller-applied profile string authorizes a retry.
BI-7906C73E retains generic proof-producer ownership. This bounded repair attaches
native readers, accounts real governed calls once, validates full source/corpus
contributions, and exposes a truthful missing-proof next action; it adds no
generic attestation subsystem, writer or unsupported retry. Existing known
pre-inference capacity recovery and completed-result idempotent observation
remain intact. Verify source, regression coverage, canonical publication and
actual served behavior; original f52 critique remains open until the existing
recovery owner supplies a supported finite disposition and the real result runs.

Official CLI contract: https://learn.chatgpt.com/docs/extend/mcp?surface=cli and
https://learn.chatgpt.com/docs/config-file/config-reference (2026-10-26).


### Dependency correction and original research participation

Host preflight rejected the new routing-to-MCP import. Keep token creation in
mcp-task-execution, prebound to the exact server-owned principal, task and fence
with fixed read scopes. Pass a no-argument minter through the existing transient
completion policy and adapter session. Routing validates its exact reader surface
and fails closed without that minter; no dependency exception is introduced.
Regression coverage includes actual routing, fallback and provider-to-adapter
callback propagation, private staging and absent-minter refusal.

CE-1FE20783 remains a separate original request for research/prototype advice on
the proposed three-column explorer. Current binding/idempotency checks found no
TaskRun for it; the broad metadata match is CE724's separately bound task. After
the served transport correction, seek its FIRST fulfillment under the unchanged
objective and input digest. Explicitly associate the later concrete d236 prototype
as research material; it was not originally pinned in CE1. Require actual source,
WSID/corpus and calibration provenance and the routing author's attributable
response. This does not resolve CE724, confer current-code acceptance or authorize
production edits. No execution or successful Critic result is asserted here.


### Provided rendered input correction (2026-10-26)

Before any first CE1 dispatch, verify actual image transport: CLI adapters currently
serialize image_url blocks into text. Source-only output cannot fulfill the Critic's
rendered-surface craft contract. Keep the original request and first explicit d236
prototype association, with four allowed public HTTPS captures in immutable managed
DocumentVersions and one hashed manifest. This is supplied evidence, not Critic
participation, CE724/f52 coverage, current application review, or acceptance.

Reuse existing document-version refs, ChatMessage image blocks and private Codex
stdin staging; pass real --image files, bound count/bytes/formats, exclude pixels
from prompt archives, and clean private files on all paths. Unsupported image
channels must refuse before provider admission or inference, without health changes.
Validate exact source/engagement/organization/actor/version ownership and current
credential plus provider read authority before loading supplied bytes; no new grant,
identity, arbitrary path/URL fetch, runtime activation or document substrate.
Authority inspection confirmed registry_read is an existing canonical doc_load
alternative. Native pinned-manifest read succeeded under that supported grant;
document_write never implies read authority and no read denial was circumvented.
Server completion must bind actual provided image inputs, real source/corpus reads
and model contribution, preserving old bindings and holding incomplete results.

Red/green coverage: pixel forwarding and archive exclusion, image budgets and MIME,
immutable manifest/source matching, cross-org/owner/restricted/ref/digest rejection,
old request compatibility, no unsupported inference, complete/held result persistence.
No gate lease was admitted for 01c7; its preclaim quiescence wait is superseded only
by this corrected frozen candidate. Run affected tests/types/guards and the normal
canonical integrated gate, protected PR/release and served happy path. Completion
still requires an actual persisted Critic result and attributable routing disposition.


Independent source review found that an updatedAt receipt CAS could mistake a
benign heartbeat/provenance append for attempt displacement after successful
inference. Reuse the existing source-provenance transaction and TaskRun FOR UPDATE
pattern: lock, read fresh metadata, check actual status/fence/binding, and update
only metadata by the locked row identity. Preserve unrelated provenance and
heartbeats; cancellation or a real fence/binding change still refuses. The real
interleaving regression failed against the old code, then passed with this change.
This also removes the metadata predicate that the heartbeat guard misclassified;
no guard exception, heartbeat/status write or provider retry is added.


The end-to-end autonomous seam can run a generic inline review/debate after the
agentic loop returns. Restoring verified JSON afterward cannot undo that extra
inference, and held work has no accepted contribution to restore. The existing
TAK inline-review helper must return its unchanged draft before provider dispatch
when a read-evidence workflow owns completion. Cover verified and held scopes,
review and debate postures, normal unscoped behavior and async scope isolation.
This prospective guard neither proves historical execution nor edits the shared
autonomous seam, changes posture preferences, grants authority or permits retry.


Live readiness confirmed UX profession pages exist while calibrated critiques
remain empty. The new visual UX packet names the existing wiki_query professionKey
option and concrete craft terms so broad kernel/org ranking is not mistaken for
corpus absence. This uses supported retrieval configuration, adds no search tool,
and leaves legacy admitted prompts unchanged. The Critic still performs its own
reads, selects criteria/findings, and reports the actual empty-calibration limit.


Held failures must retain the completion validator's precise missing requirement
in both the visible task response and persisted timeline summary. The actual
missing immutable guidance traversal regression first failed against the generic
message, then passed with one captured inspection result. This is diagnostic
retention only; held state, no approval, execution-proof and no-replay boundaries
remain unchanged.


### First live CE1 completion failure and prospective diagnostic retention

Recovery 142 served exact merged daba68549295df81956069fd74a548afbb1fcc39;
canonical preflight returned CAN-TEST. CE-1FE20783's FIRST actual task ending
D170F2F755AF executed 17 successful governed Critic reads, all pinned source and
guidance traversal, one profession query and an empty calibrated-only query.
Its four actual image inputs were delivered through Codex/gpt-5.6-luna. The
8225-character normal response failed generic contribution validation and was
replaced with held prose before task settlement; no original response was kept.
TaskMessage 02fb0f6f-7f95-4b07-bbcc-5d2fda18b90b retains only that first generic
failure. RV-CE1-FIRST-142-HELD records a failed workflow verification. Neither
the precise rejected predicate nor actual findings can be reconstructed.
There is no completed Critic result, acceptance or author disposition.

The bounded follow-up uses the existing execution scope, TaskMessage metadata
and held TaskRun projection. Capture one authoritative first inspection and the
original provider text before conversion; retain at most 100000 UTF-8 bytes,
digest, original byte length and truncation/redaction state. Exclude image data
and credential-shaped output. Mark retained output unvalidated assessment data,
under the original task's current access and sensitivity; never execute it or
publish it as a contribution. Preserve first parse/schema/profession-reference,
source, corpus, image and task-state reasons. Settlement consumes the same first
inspection and never validates generated hold prose. Completion validation and
replay/effect requirements do not change. Add actual loop/settlement regressions,
run affected tests/types and the required canonical gate and protected publication.
The existing BI-7906C73E owner alone retains generic finite execution disposition;
no retrospective receipt, task promotion, rekey, replacement request or replay.

Independent assessment reproduced native dpfmcp_ token retention in the first
prospective matcher. Consolidate the existing functional-evidence and build-tool
diagnostic redactors with retained-output exclusion in one shared policy, rather
than adding another partial scanner. Keep original digest/byte attribution while
withholding the whole retained text on a known sensitive/image pattern. Pattern
redaction cannot establish that arbitrary output contains no secrets.

Protected c1ab (PR 6546) added initiative-specific present reassessment and reader
scope identity checks. Integrate that actual framework, preserve the original
ReadEvidencePolicy object identity, and capture the first inspection through an
explicit terminal-output helper. Actual new integration tests initially exposed
four policy-identity failures; do not weaken their assertions. Retain the
engagement test in a focused file instead of growing the legacy execution suite
past its 800-line limit. No limit or baseline is raised. The present-reassessment
policy is restricted to its independently approved initiative subject; it does
not admit either original Critic engagement, and no fake initiative binding,
replacement request, retrospective closure receipt or replay is permitted.

The initial dirty-worktree host preflight ended inconclusive with a real module
size failure (802/831 lines) on superseded source. Its 84 passing guards are
historical executions, not qualified exact-candidate evidence. Re-run the normal
canonical gate on the final clean candidate after the module extraction and
protected-framework integration; no skip or receipt identity rewrite.
