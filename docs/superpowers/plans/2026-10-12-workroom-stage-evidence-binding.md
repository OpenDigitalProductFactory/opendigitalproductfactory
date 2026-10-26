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
