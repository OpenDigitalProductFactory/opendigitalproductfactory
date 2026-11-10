---
status: active
---

# Workroom stage evidence binding

Backlog: BI-9DC43E17. Workroom: WC-042C344C.

The served Workroom inspector cannot correlate journal evidence to a requirement because the writer records no versioned source context and the reader emits no process binding. Extend the existing WorkroomActivity payload and ReceiptEnvelope adapter; retain the existing bounded journal and observed status.

## Design grounding

Use the existing versioned work-shape registry, scopeClaims reader, initiative-evidence current-source predicate, and shape-projection requirement binder. WorkroomActivity remains the journal; no new ledger, schema, tool, or completion authority. The server stamps repository, commit, definition, stage and kind from the room at write time. Readers bind only a matching current room/source/definition. Legacy, malformed, stale and wrong-stage notes remain visible but unbound. A binding means an observed record for a requirement, never a passing gate or stage completion.

## Verification and delivery

1. Resolve graph-linked writer, receipt and projection tests; reproduce the missing binding with a regression test.
2. Add a pure shared binding validator, writer stamp and reader adapter. Preserve deferred publication and existing stage advancement rules.
3. Check stale source, different room/repository/shape/stage, caller-supplied binding, legacy data and observed-only status; run affected suites and package typechecks.
4. Obtain independent review and the exact-source governed gate before publication; deploy through the existing single producer and native upgrade path.
5. Verify the enterprise → initiative → room → step → actual evidence journey on the served target. Do not mark the seven runtime scenarios or parent initiative complete from this adapter change.

The existing BI-9DC43E17 owner confirmed no overlapping code edits; its future journal sequencing work retains ownership of atomic sequence/high-water semantics.

## October 15 bounded history regression

The deployed recovery97 room has a current-source implement/pr-gate receipt behind
99 newer activities. The recent 20-event feed omits it and incorrectly leaves the
requirement without a correlated record. Keep that activity feed bounded, but read
the latest matching receipt for each declared room/stage/evidence requirement from
the same journal independently. Reuse the existing versioned binding validator and
receipt adapter; deduplicate by immutable row ID. Missing/unavailable sources remain
partial, stale/malformed bindings never satisfy a requirement, and all journal
receipts remain observed rather than stage verdicts. No schema, new ledger, runner,
authorization change, or replay is needed. Prove the >20-event regression first,
then test deduplication, source drift, unavailable reads, and room isolation.

## October 23 in-flight refresh continuation

Continuation: BI-9DC43E17 / WC-2EE23DD6, branch `fix/workroom-inflight-refresh`,
base `3c6ed3e54fed49ecb6af43d4672bf5fb5223233b`. Preserve the original
WC-042C344C, PR 6445, its failed scope request and the existing acceptance case.
The original merged execution is intentionally archived; this continuation owns
the observed refresh failure and the responsive evidence disclosure defect below.
Design admission IRD-2D14ED5F09F5 is
allowed. Production implementation remains held until BI-B87514F5 is deployed
and a current native implementation claim is allowed. The original research
receipt is retained; do not fabricate replacement evidence to satisfy the old
parent/child digest mismatch.

### Observed failure and chosen repair

On served f8d1e80, aborting one actual case RSC GET while the browser stayed online
caused a hard document navigation, moved focus from Refresh state to the body,
and closed Projection gaps. Existing partial-source refresh acceptance passed;
RV-WORKROOM-INFLIGHT-FAILURE-F8-20261023 remains failed. A browser online hint or
preflight request cannot cover a connection lost after the refresh dispatch.

Replace that refresh transport with one authenticated JSON projection read owned
by the mounted process section. Extract the page's authorized case/room selection
into a shared server detail loader used by both the page and the new projection
route. Reuse workspace-case-loader, workroom-only-case-projection, projectRoomShape
and existing access checks; no parallel status model or unguarded room lookup.

The response binds the canonical case key and expected exact Workroom row ID.
An explicit room selection remains explicit; changed or ambiguous selection is a
conflict rather than silently choosing the newest room. Return graph, definition,
mode/current-cycle context and flow-map state as one snapshot from that selected
room. Validate identity before applying it. Surfaces that carry one readAt change
atomically; a flow-map failure is explicit and cannot leave an old map under a
fresh badge. Other page panels retain their own truthful age.

The client owns one abortable manual request and a finite read deadline. Reject
repeat activation while pending; abort on target change/unmount and ignore late
results from another generation. Keep the prior snapshot, selected step, list/map
choice, filters, disclosure state and focus during transient failure. Replace the
snapshot only with a complete, identity-valid response. No automatic refresh on
mount, visibility, focus, online events or retry timers; no router.refresh,
global fetch patch, reload, or preflight reachability probe.

Use typed session-required (401), unavailable/forbidden (404 without disclosing
which), selection-changed (409), and sanitized read-failed (500) outcomes.
Session/access loss must hide the protected process content and provide a clear
manual recovery action; it must not leave protected content presented as current.
An ordinary transport failure retains the saved snapshot and explains that a
manual retry is available. Keep the existing themed button, 44px target, polite
announcements and focus behavior; do not steal focus if the operator moved it.

### Test-first and delivery sequence

1. Prepare a real WorkroomShapeSection behavioral test as an external design
   artifact using existing process/freshness components and a controlled fetch boundary.
   Start in List view with a selected step/filter and open evidence disclosures.
   Require one owned request, reject it after dispatch, and assert retained
   focus, selection, filter, disclosures, definition and exact checked text,
   visible failure and zero router refresh. After native implementation admission, place the regression test in source and observe RED against unchanged production code.
2. After native implementation admission, implement the shared authorized loader,
   JSON route, typed snapshot and manual controller; separate freshness display
   from transport. This shared loader/controller extraction is the refactoring
   investment and avoids duplicated authorization or derived status rules.
3. Add focused tests for atomic graph/definition/flow-map replacement, partial
   health preservation, exact case/room mismatch, finite timeout, stale late
   response after target switch, cancellation, rapid duplicate activation, no
   background retry and session/access loss. Test authorization using the actual
   existing loader seams; route errors must not leak raw provider/server text.
4. Resolve the final scope's change-impact contract; run affected tests and both
   web TypeScript programs. Preserve the existing aging/offline/focus tests while
   replacing their unrealistic promise-returning router refresh mock. Update the
   user guide and measured UX-fit manifest for the implemented surface.
5. Root owns independent exact-source review, the single governed gate and normal
   PR/release coordination. On the canonical deployed image, repeat the actual
   in-flight JSON failure at narrow width, verify no document navigation and
   retained interactions, then verify one successful explicit retry. Do not mark
   parent initiative or other scenarios complete from this repair.

The existing F646 owner retains workspace-case-loader.test.ts,
workroom-only-case-projection.test.ts, workroom-execution-evidence.test.ts,
workroom-initiative-evidence.test.ts, mcp-workroom-recovery.test.ts and
liveness-inventory.test.ts. This continuation does not edit those files. Its new
shared-loader tests are workspace-case-detail.server.test.ts. No production path
has been edited during preparation, and a source-only dependency classification
is not test evidence.
## October 24 narrow evidence disclosure amendment

This remains BI-9DC43E17 / WC-2EE23DD6 and the same operator-view deliverable.
The recorded acceptance criterion already requires: "Narrow/mobile, keyboard,
screen-reader, dark/light, loading, partial, stale, failed, empty, and reconnect
states pass the platform usability standards and UX budget gate."
Preserve the published refresh plan at commit
`27782e7f3d4f66968fe117a63bb35013abb29325` and its evidence; this amendment adds
one observed failure in that existing responsive contract, not a new work item.

On served f8d1e80, keyboard-opening Observed execution (20 events / 2 receipts)
at a 375px viewport increased document scroll width from 360px to 375px while
client width stayed 360px; actual horizontal scroll reached 15px. Closing the
disclosure restored 360px and reopening reproduced the failure in both themes.
The nested evidence summary's text range reached 374.97px with normal wrapping;
its containing element boxes remained within the viewport. The outer summary
was 40px high. This is a measured browser failure, not a JSDOM layout result.

The existing `Evidence` renderer in `WorkroomShape.tsx` serves selected-step
records, events and receipts. Add wrapping and the existing 44px target and
focus-visible theme treatment to its summary, sharing the local disclosure
styling with Observed execution where applicable. Preserve full journal labels,
source/receipt identities, keys, order and native details/summary behavior.
Use the adjacent evidence component's wrapping convention and verify long
unbroken identifiers in the browser. Do not hide horizontal overflow, truncate
record labels, introduce global CSS, or add another component substrate.

After native implementation admission, include the retained long checkpoint
label and a long source identity in the actual evidence fixture. Keep this
layout correction in `WorkroomShape.tsx` and its existing test path alongside
the refresh repair; do not edit the F646-owned tests listed above. Component
checks preserve complete evidence and disclosure behavior, but cannot prove
layout through mocked geometry or CSS-class assertions.

On the canonical deployed image, keyboard-open, close and reopen both levels
of evidence disclosure at 375px in light and dark themes. Require document
scroll width no greater than client width apart from one pixel of rounding,
no horizontal scrolling, summaries at least 44px high, retained keyboard focus
and readable complete text. Repeat the in-flight refresh failure with evidence
open: disclosure, focus, selected step, filter, layout and previous readAt remain
intact. Then verify one successful explicit refresh applies a valid atomic
snapshot. Existing admission, independent review, governed gate and release
requirements above remain; this design amendment reports no repaired runtime
or passing implementation test.

## October 25 shared header reflow

Continue the same BI-9DC43E17 / WC-2EE23DD6 responsive acceptance contract.
The original BI-5366EF78 / WC-A4E8BC72 case at390px genuinely measured
document375/668 and a635.109375px implicit header grid track. Preserve failed
RV-WORKROOM-HEADER-OVERFLOW-RECOVERY132-20261025 and its original evidence.
The previously delivered refresh/disclosure passes do not close this failure.

The earlier source owner protected-merged PR6575 and normally released its idle
claims after restoring live own-lease proof. Root's fresh normal path claim is
accepted. Preserve the finite-room originalObjective and delivery-agreement
disclosure from that source; restore only the confirmed participant separator's
four corrupted codepoints to the original middle dot using explicit UTF-8 IO.

Reuse WorkroomHeader: constrain its existing header and grid with min-w-0,
declare one narrow grid track and inherit overflow-wrap:anywhere. Keep md two
columns and xl four columns, full IDs, text, status/read models, landmarks,
controls, keyboard behavior and theme tokens. This consolidates wrapping at the
existing shared boundary rather than copying rules into every field. No global
overflow hiding, truncation, new primitive or new route is part of the repair.
Decision DI-668BC894A43F selects shared-header-reflow over per-field rules and
clipping; commit the exact-header propose-n-pick fit manifest.

The related-test graph has no Header edges. Run the existing full WorkCaseDetailView
consumer tests and adjacent delivery-agreement/stage-decision/shape-rebind tests,
both web TypeScript programs and required source guards, then one governed gate.
Do not create CSS-class assertions or mocked layout tests. The actual browser
failure is RED evidence; source-local checks cannot establish rendered GREEN.
Freeze the changed source, obtain a separately attributed corrective assessment
including the added separator change, and publish through normal DCO/protected
checks. Preserve uncertain native reviews; do not infer a verdict from merge.

After a qualified containing deployment and CAN-TEST, repeat the exact original
case at390px in light/dark: document scroll width must equal client width within
one pixel, all reviewer/source IDs remain complete and no page scrolling is
hidden. Check narrow and desktop breakpoints, existing keyboard focus/disclosures
and the participant separator. Preserve finite-room objective/disclosure behavior
and intentional process-strip scrolling. Independent scoped acceptance remains
required; the wider BI and original seven scenarios stay open.


## October 26 recorded blocker visibility continuation

Continue BI-9DC43E17 / WC-2EE23DD6. Preserve the completed refresh/header
source and independent scoped acceptance. This is a new observed failure in the
existing blocker/next-action visibility contract, not a replacement initiative
or a recovery attempt against an old reviewer.

On served966b7164fa25544c91980424fb461735b44a23f9,
RV-WINDOWS-BLOCKER-PROJECTION-966-20261026 records a failed UI result:
WC-C6796FCF correctly becomes waiting-on-system, yet Overview and expanded
recovery omit its current recorded explanation and retain a generic wait.
The bounded native status-override activity42 independently retains the reason
and expiry. The approved transfer remains failed before request creation and
the old executor remains assigned; explanation is not successful transfer.

Source diagnosis: status-projection reduces a blocked capsule to a generic
reason; case loaders pass only its identity/status/title into that projection.
projectWorkroomRecovery considers source identity and reviewer execution but
does not accept blocked status/recorded explanation, so a complete-identity room
with no observed reviewer can incorrectly return actionable. A missing source
field or an unread review inventory must never be invented to reuse that helper.

Research the existing status writer and recovery projection, shared case/room
read models, authorized selection, source evidence and report-kit primitives.
Reuse the current workspaceState.statusOverride reason/until carrier. Add a
small pure recorded-blocker projector within the existing recovery substrate;
MCP and UI consume the same validated observation. Do not add another work or
recovery ledger, a new grant, a global source lookup or a text-to-command parser.
This shared normalization and precedence work is the useful refactoring slice.

A current blocked/provider-blocked room remains blocked even if its explanation
is absent, malformed, blank, expired or too large. A resolved/terminal room must
not be reopened by a stale status note. Validate record shape, expiry and text
bounds; distinguish unavailable/expired explanation from an empty successful
read. Keep identity-repair and independent-review uncertainty explicit and
preserve every existing request, receipt and budget. A bounded readback must
retain the compact blocker observation even if the raw workspace snapshot does
not fit. Its text is reported coordination, never instrumented cause proof.

Project only from the already authorized selected room. Anchored and standalone
cases use their existing content checks before loading; cross-case/sibling
selection and discovery-only access must not expose blocker text. Do not add
unqueried source-identity fields or treat missing review input as an empty audit.
Do not scan an activity history to rediscover the current status override.

Room accountability stays separate from repair responsibility. Never extract
an owner, item, URL, tool packet or permission from reason prose. An executable
repair action or repair owner requires an existing typed, current, separately
authorized source linkage; otherwise show the absence explicitly. Read-only
inspection is not approval, resumption, notification or retry. In particular,
the Windows explanation cannot authorize the main transaction-guard handoff.

The working design prototype is the local
workroom-recorded-blocker.prototype.html in this chat's evidence directory.
It compares full inline explanation with a compact attention area and full
attributed details. DI-0BD1DDAB44FE chose compact-shared-blocker with usable,
high-confidence, autonomy-eligible advice and no commandment conflict; all four
feature axes are engineering estimates, not measured human performance.
The consultation's runtime citation time00:44:27.730Z belongs to the underlying
status event; its failed UI snapshot actually dates01:00:27.081Z, as corrected
in the recorded decision outcome. Retain that provenance distinction.

Keep the existing Attention/Next action/accountability layout. The full
explanation and diagnostic identity belong in the existing Delegation and recovery
disclosure below the workforce, reachable from either Overview or Details.
Use existing native disclosure, focus and theme tokens. If adding an inspection
link or disclosure, carry the exact propose-n-pick UX manifest and keep it
strictly read-only. No new dashboard, retry button, source-specific hardcoding,
silent clipping or prose-derived action is allowed. Engage the UX specialist
through its existing governed offer for this genuinely new deliverable; do not
replace or replay any earlier engagement or immutable input.

Before runtime edits, finish this normal design publication, refresh genuine
author research and implementation readiness, claim the owning paths and
resolve test impact. AC02 currently owns room-read-model.ts during its frozen
gate; coordinate sequential integration and never disturb that source.
Test actual blocked-to-actionable regression, exact-expiry/malformed/over-budget
explanations, terminal precedence, missing versus unread evidence, authorization
and selected-room fences, and hostile prose with no executable action.
Reuse existing recovery/case/room and component tests rather than class-name
assertions or mocked layout proofs. Both web TypeScript programs and the exact
governed gate remain mandatory; old gates do not cover this continuation.

After protected delivery, a qualified containing deployment and CAN-TEST,
independently repeat the original Windows failed case. The actual recorded
blocker must be reachable, old executor/failed transfer remain unchanged,
accountability and repair ownership remain distinct, and absent typed action
must not look like permission. Verify narrow light/dark layout, keyboard
inspection and stale/missing source states. Source tests and prototype do not
earn this runtime acceptance. Full BI9, the original seven scenarios, main
transaction-guard repair and the whole thread outcome remain open.


### Recorded blocker implementation verification

The shared projector and actual native readback tests are committed at ea691663.
The follow-through uses one inventory snapshot clock, preserves stronger process,
review and drive directions, and passes the same bounded observation through both
existing content-authorized selected-room loaders. Terminal case projection drops
stale blocker metadata. No repair owner, URL, action packet or grant is extracted
from reported text.

The header keeps its compact layout and adds an in-page inspection link to the
existing Delegation and recovery disclosure. It opens and focuses the actual
blocker heading, including repeated inspection of the same fragment. Other
disclosures remain open. A missing workforce or unreadable coordination chain
does not remove the selected room's authorized blocker explanation. Copy uses the
existing typed Workroom catalog and pseudo-locales; raw reported explanation is
rendered as text. This is UI navigation only.

Normal scope release and admission, rather than a forced co-claim, sequenced the
AC02-owned model, loader and catalog paths. Native claim sequence233 admitted the
integration. The existing UX-specialist engagement CE-0EA43EDA remains requested;
no specialist verdict or participation has been inferred. The existing working
HTML prototype could not be rendered through Browser Use because its local-file
URL is disallowed; that visual check is unrun and no alternate browser workaround
was attempted. Source tests are not a substitute for changed-source live layout.

Actual source-local verification: the inventory clock regression first failed
current-versus-expired, then122 tests passed across4 recovery suites. The new UI
cases first failed4, and the selected/standalone/model cases first failed3 for
missing behavior. Integrated graph-linked and colocated verification passed419
tests across28 files; i18n passed42 tests across3 files. Both web TypeScript
programs passed, along with prose-lint and26 prose-guard tests. Style/token drift
passed before final localization; the exact frozen tree still needs its full
governed gate, independent UI/source review, protected publication and qualified
deployment. Harness corrections (missing jest-dom matchers and source-helper
line endings) are not product failures or runtime acceptance.

Self-review additionally reproduced one disclosure regression: a refreshed reason
reopened a manually closed panel when its fragment remained selected. The effect
now reacts to blocker presence and explicit inspection, preserving the operator
choice across new readback objects. The focused39 UI tests passed afterward.
The UX manifest lists the two control-adding files derived with the checked-in
guard; route and workforce files only carry the already authorized observation.

### Independent exact-room permission correction

Independent review of43c939ce found P1-selected-room-blocker-disclosure in
both loaders. WorkItem content admission and a standalone historical creator
check do not establish the canonical room roster, removal/narrowing, declared or
backlog-derived clearance. The attributed changes-requested assessment is
D:/DPF-temp/workroom-blocker-43c939-independent-assessment-20261026.json,
SHA25661013c35a4c4bfecb104993a84ac8b81c20e0c17c11b8ee6c33ca6663bbe3fef.
The frozen source and finding remain preserved; no native approval is inferred.

Four meaningful disclosure regressions reproduced the finding. The shared reader
now withholds explanation unless a canonical row and explicit current content
decision are available; refusal, missing authority or permission-read error
returns no private observation. Both loaders use this one admission-before-read
seam. The authenticated server adapter binds the existing
resolveHumanWorkroomAccess predicate to the actual session user, selected row and
source database. It passes this callback into anchored and standalone paths; it
never substitutes WorkItem membership, an administrator flag or client input.
Six additional server-binding cases first failed, then the five affected suites
passed165 tests, including the existing canonical removal and sensitivity policy.
Authorized positive controls still expose their own explanation.

Normal claim238 followed the profile owner's release of server.ts/test.ts; no
forced overlap or foreign Workroom mutation occurred. This common permission seam
lands first. AC02 must integrate the actual protected change, apply the same
canonical decision to its new source-context read, and verify its changed tree.
The profile's earlier frozen gate remains historical, not acceptance of the new
integration. Follow-up independent assessment and the final exact-tree governed
gate remain required before publication.


### Original S6 typed failed-handoff recovery

The original acceptance requires a verified repair owner and an executable
recovery action where current authority permits one. The245ec107 explanation
repair deliberately leaves both absent. Independent assessment
workroom-s6-typed-recovery-gap-245ec-20261026.json records this remaining
acceptance gap; its SHA256 is
c1b810d9e1b92f8266b3c85223e0aa48fc7045e0853e145648be63aceab1b5a9.
Continue this same BI9 concern. Earlier source reviews and source-local tests
remain historical to their exact trees.

Reuse the server-only original failed approval/execution binding in
coworker/approval-action-evidence.ts. It validates exact owner, assistant,
operation, input fingerprint, one genuine failed execution and recorded time.
Extract the shared validated reader only as needed; expose no raw execution
result, approval binding or unbounded argument object. Bounded discovery must
be scoped to the current authorized room and actual owner, refuse ambiguity
or incomplete history, and perform canonical room content admission before
reading private explanation or action evidence. Do not infer correlation from
a reason string, a URL, the room's human accountable owner or a chat title.

Project the originating assistant as recovery owner only when the failed
operation establishes that responsibility. A separate platform-code repair
owner needs a genuine typed dependency and stays unavailable when absent.
Retain exact original failed envelope and execution locators as history.
Nothing changes that envelope's status, consent, execution or original command.

Only an actual authenticated OAuth source assistant may receive a fresh typed
request action. The browser human session must not impersonate it. Parse the
original typed bounded request, preserve its declared destination and mandate,
require source identity and exact current room/source/lease, and call the
existing read-only assessBoundedHandoff predicate for current admission,
owner, role, dependency and clock checks. Missing, changed, unavailable,
restricted, archived, revoked or expired prerequisites withhold the action
and retain an exact safe reason. A positive preview is not execution authority:
the normal governed reassign_workroom_executor writer repeats all checks
under receipt locks, then still waits for the real receiver's exact native
acknowledgement. Do not reuse the original failed command id or envelope,
acknowledge for another actor, clear a blocker automatically or create a new
executor, recovery ledger, grant, scheduler or tool.

Share this typed observation between the existing MCP recovery readback and
the already authorized selected-room UI where feasible. The compact existing
recovery disclosure may display verified owner, original failure and current
action availability. It must distinguish an executable packet for its actual
assistant from an unavailable action for a human observer. Keep room
accountability, stronger review uncertainty, terminal precedence and the
original inspection link. No browser mutation control is justified by this
amendment alone. Extend the existing UX manifest only if adding a control.

Before implementation refresh author research, ordinary path claims and test
impact. Tests first reproduce the absent typed owner/action; positive control
requires exact current bound actor. Cover foreign actor/room, denied content,
ambiguous or forged execution, fingerprint mismatch, no bounded phase, changed
destination/source/lease, failed dependency, unreadable prerequisite, stale
preview and exact receiver ACK remaining mandatory. Actual native acceptance
requires qualified containing deployment and CAN-TEST on the original failed
Windows case; source mocks cannot qualify that outcome. Shared extraction,
canonical binding and predicate reuse are the useful refactoring portion.


### Pending and completed handoff lineage precedes fresh recovery

Independent review of f819ec4 found P2: an eligible fresh action must not
precede validation of an existing pending request or completed receiver ACK.
The assessment is workroom-s6-typed-recovery-plan-f819-review-20261026.json,
SHA256e744863601ada95235b03a4f5e4229c7f525e17df178542adb3bdef87d3ce9a8.
This amendment corrects that ordering before implementation, preserving the
reviewed artifact and the original acceptance obligation.

After exact current room content admission and original failed-operation
binding, inspect the existing typed handoff lineage first. Reuse readRequest
and acceptedHandoff validation with exact room, immutable request digest,
original failure locators and actual accepted command receipt. A currently
pending matching request names its exact receiver and waits for that receiver;
it must not produce another fresh request. The read projection never
acknowledges for that receiver. A validated later completed ACK to the actual
current destination resolves the original refusal as historical without
rewriting it. Only after no existing applicable lineage is established may
a fresh-request eligibility preview run. Missing, forged, conflicting or
unreadable lineage makes recovery explicitly unavailable, not absent.

The actual Windows request handoff-df26f135-35b3-4f20-848c-1d2f8f4f1b4f
and actual receiver ACK61 now exist on Recovery139. Their immutable manifest
contains priorFailure locators. This is the real resolved acceptance case;
do not recreate a refusal or retain a stale retry merely to exercise UI.
Source tests must cover valid pending/no duplicate request, valid completed
resolution with no fresh action, mismatched priorFailure, missing or forged
request/receipt/digest and changed current executor. Source/history evidence
is not a new approval, inference retry or proof of unrelated effect closure.
