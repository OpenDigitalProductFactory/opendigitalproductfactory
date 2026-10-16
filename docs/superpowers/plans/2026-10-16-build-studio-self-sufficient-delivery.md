---
title: Self-sufficient Build Studio delivery implementation
date: 2026-10-16
status: draft
backlog_item: BI-B87FB47D
---

# Self-sufficient Build Studio delivery implementation

**Backlog item:** `BI-B87FB47D`.
**Design:** [Self-sufficient Build Studio](../specs/2026-10-16-build-studio-self-sufficient-delivery-design.md).
**Documentation:** `BI-F93608B0`, Workroom `WC-0554411A`.
**Decision:** `DI-DE359D847233`.

The owner authorized implementation after scoping, with as few coherent PRs as
practical. Use the three groups below instead of the generic one-BI-per-PR
template. Every independently shippable deliverable retains a live BI, its own
acceptance evidence and rollback boundary. No implementation starts until its
actual claim and initiative readiness permit it. A phase change alone does not
require another human approval.

## Design grounding

The design's §2 pins T3 to `86534db4d3525a070589a234d660a3e0373a42ea`
and compares OpenHands, BMAD, Replit and Cursor through primary sources. §3 records
the current DPF source findings. Reuse `AGT-WS-BUILD`, the Workroom coordinator,
`autonomous-build-custody`, `lib/workroom-runtime`, `SystemEventProvider`,
`useBackgroundOperationObserver`, `packages/api-client`, mobile auth,
`RuntimeTarget`/`RuntimeVerification`, browser-drive and the existing runner/host
authority. No new process engine, task ledger, device-job model or terminal-first
human interface is planned.

## Backlog coverage

Decomposition decision: **decomposed**. Immutable coverage receipt: **pending**.
This document does not substitute for that receipt. The root needs its actual
spec/research/review baseline before server-selected coverage can be recorded.

| Key | BI | Prerequisites | Objective / contract / flow / verification |
| --- | --- | --- | --- |
| observation | BI-E15E8897 | Existing Workroom event/projection infrastructure | OBJ-SELF-OBS / AC-SELF-OBS / F1,F2 / V-OBS |
| orchestration | BI-FE8CB8EC | observation; admitted internal runtimes | OBJ-SELF-RUN / AC-SELF-RUN / F1 / V-RUN |
| mobile-runtime | BI-05EDC704 | orchestration; current mobile auth/role contracts | OBJ-SELF-RUN / AC-SELF-RUN / F2 / V-MOBILE-RUN |
| continuation | BI-05715F4C | Existing child BIs and source evidence, not reimplementation of completed work | OBJ-SELF-CONT / AC-SELF-CONT / F1,F2 / V-CONT |
| phone | BI-8D1F1094 | observation, mobile-runtime, continuation | OBJ-SELF-UX / AC-SELF-UX / F2 / V-PHONE |
| result | BI-4B208A34 | observation, orchestration | OBJ-SELF-PREVIEW / AC-SELF-PREVIEW / F1,F3 / V-RESULT |
| device | BI-224C94C7 | result, host capability/lease, BI-CA9A49AB contract | OBJ-SELF-DEVICE / AC-SELF-DEVICE / F3 / V-DEVICE |
| exit | BI-3A3E0177 | All preceding deliverables and BI-06AE6833 review tail | OBJ-SELF-DELIVER,OBJ-SELF-EXIT / AC-SELF-DELIVER,AC-SELF-EXIT / F1,F2,F3 / V-EXIT |

Existing peer-origin records remain in their owning installation. Local source
integration references them without changing their remote ownership or declaring
their acceptance passed. Canonical coverage must explain any existing rollup and
its concrete children; a parent and its children must not count as duplicate work.

## PR group 1: internal orchestration and reliable observation

### A. Observation (independently shippable)

**BI-E15E8897 acceptance, verbatim:**

AC-SELF-OBS: switching A to B while A's response is delayed never overwrites B; reconnect rehydrates; hidden views stop unnecessary reads; the timeline remains bounded and reports freshness truthfully

Touch `components/build/BuildStudio.tsx`, `AgentSessionFeedLive.tsx`,
`lib/work-capsules/activity-stream.ts`, the existing activity-stream route, and
shared observer primitives only where required. Reproduce delayed selection,
snapshot/subscription gap and false Live status first. Introduce one cheap
authorized projection; share the existing event owner; keep durable state on the
server. Abort stale reads, retain useful content while refreshing, page older
history and bound visible entries. Remove replaced relay/timer/subscription paths
in the same diff rather than layering another loop.

V-OBS: focused race/gap/bounded-window/freshness tests, affected web typecheck,
observation-contract guard and served selection/reconnect/background cases.

### B. Coworker/internal runtime integration (independently shippable)

**BI-FE8CB8EC acceptance, verbatim:**

AC-SELF-RUN: a human outcome reaches the existing coworker and internal supervised runtime without an external client; no request is acknowledged before durable admission

Trace current `build-studio-room-coworkers`, build specialist route, autonomous
custody/eligibility, governed build actions and `lib/workroom-runtime` before
editing. Add only the missing integration/admission contract. Runtime status must
come from actual credential, capability, runner/lease and durable attempt state;
the October 13 binary-present probe is insufficient. Keep provider configuration
and terminal controls out of the owner workflow.

V-RUN: authorized intake through real dispatch and readback, denied/cross-room
requests, duplicate admission, unavailable capacity and internal provider failure.

### C. Mobile runtime and existing continuation (independent existing BIs)

Replace mobile message/stream stubs through existing authorized coworker/job and
event infrastructure in `api/v1/agent/{message,stream}` and typed `api-client` agent
endpoints. Preserve mobile auth/session semantics and durable admission. Do not
start a second LLM loop or acknowledge a job that exists only in memory.

Audit the concrete continuation children in design §7 before editing. Retain
working implementations and earned evidence; repair only actual gaps. Queue hold,
bounded retries, cancellation propagation, stale-decision rejection and process
loss are runtime contracts, not explanatory copy.

AC-SELF-CONT: navigation/restart/provider failure preserves a truthful durable result or wait, queue hold and bounded recovery; cancellation reaches children; stale approvals cannot run

V-MOBILE-RUN: authenticated role-bound message -> durable identity -> coworker
reply -> mobile stream/projection, token expiry/revocation and offline foreground.
V-CONT: provider/process-loss fixture, pending input after restart, cancellation
and handoff; existing affected tests plus canonical runtime evidence.

## PR group 2: desktop and phone outcome experience

### D. Phone Workroom (independently shippable existing BI-8D1F1094)

AC-SELF-UX: desktop and phone complete F1/F2 through the same Workroom without asking the human for terminal, branch, process or session mechanics

Extend existing mobile navigation, typed API, Workroom projection, conversation,
decision and notification primitives. The default interface is the orchestration
coworker with outcome/current action/decision/result, not a small IDE. Preserve
drafts and exact work links across foregrounding. Revalidate decisions online;
never replay a cached approval automatically. Suppress notifications for the
currently visible item and use privacy-safe payloads.

V-PHONE: same-work desktop -> phone -> desktop, start/unblock/stop and result,
stale decision, offline/background, read-only role and revocation; unit/component,
native test harness and actual served/device flow. Measure desktop and 390x844,
keyboard, themes, screen-reader path and target sizes through existing UX-fit.

### E. Workroom Result (independently shippable)

**BI-4B208A34 acceptance, verbatim:**

AC-SELF-PREVIEW: preview/evidence and feedback remain bound to the selected Workroom, exact revision and authorized target; a stale target cannot be mistaken for the delivered result

Compose current preview/evidence components and runtime coordination into the
selected work context; extend browser-drive rather than adding another browser
service. Attach feedback to immutable revision/target/evidence, with normal
attachments for bytes. Diagnostic terminal history does not open a live session.
Use current report-kit, DPF tokens and existing contextual disclosure patterns.

V-RESULT: cross-room and stale-revision refusal, target expiry, role access,
preview readback/feedback persistence and return-to-work navigation in both themes.

## PR group 3: device verification and internal delivery proof

### F. Device host (independently shippable)

**BI-224C94C7 acceptance, verbatim:**

AC-SELF-DEVICE: coworker invokes a capable leased device host, executes a declared scenario and records revision-bound result; unsupported/unavailable hosts and unauthorized controls fail explicitly

Discover the current registered host/action contract and runtime target capability
registry before proposing any type addition. Extend those owners for host-qualified
device target, typed control, accessibility/screenshot and scenario readback.
Isolate helpers under runner supervision. Verify iOS/macOS and Android/SDK placement
explicitly. Design source currently requires no migration; any new persistent
projection/type requires data-impact/classification/retention review first.

Evaluate T3 helper packages and native/transitive licenses before importing code or
installing binaries. Prefer existing host tools; a dependency addition needs its
retirement decision. Do not expose generic helper exec routes. Label screenshot
mode honestly; continuous streaming requires a reviewed protocol/fallback design.

V-DEVICE: adapter and action-readback tests, stale target, conflicting lease,
unsupported host/platform, helper crash, denied control and stream/screenshot
cleanup. Run real native scenarios when a capable host is admitted; unavailable
capacity remains unrun, never mocked into a pass.

### G. Production-shaped exit cohort (independently shippable evidence work)

AC-SELF-DELIVER: internal review, protected PR/merge, governed upgrade and served readback complete an authorized low-risk change entirely within DPF

**BI-3A3E0177 acceptance, verbatim:**

AC-SELF-EXIT: no ordinary acceptance case requires an external client; known unsupported cases and break-glass recovery are declared before retiring a dependency

V-EXIT: execute the design §6 cohort on governed nonproduction, with role separation,
real persistence, independent review, PR/check identity, protected merge and served
readback. Record all outcomes, not only successful trials. Update existing operator
and recovery docs to match actual capability. Keep unsupported device/native/store
and credential cases explicit. Do not remove the recovery surface to make a metric
look successful.

## Verification, investment and rollback

At every implementation claim, consume the actual Workroom change-impact contract;
put every `testImpact`/`guardObligation` into the affected step. Missing impact
resolution means exhaustive verification, not exemption. Affected tests and package
typechecks are local; heavy build and functional gates use the canonical/shared
leased runtime. Docs-only preparation uses spec status, reference/link and index
checks. Independent reviews attach to immutable source. No test is passed by prose.

At least 20% of estimated implementation is assigned to observer/status/API
consolidation and deletion of replaced paths; record actual effort separately.
New capability estimates do not reclassify reliability repairs as features to
avoid the allocation. Roll back an admitted feature through existing capability
configuration; retain durable jobs/evidence and reconcile commands. Never erase
history or replay stale authority. Verify each coherent PR group before advancing.
