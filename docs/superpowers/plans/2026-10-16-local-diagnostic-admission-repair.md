---
status: draft
backlog: BI-3B3F477B
---

# Local diagnostic admission and checkpoint repair

For agentic workers: execute through BI-3B3F477B and WC-DB3E0AF7. Use the
existing DPF red-green, integration and protected publication procedures.

## Problem and recorded direction

The founder's recorded requirement in BI-3B3F477B is to let a healthy local
processor finish on slower hardware and to keep hardware timeouts out of
capability scores. This repair starts with the reproducible diagnostic caller
conflict. It does not claim to finish the item's remaining quiet/stall surfaces.

On served Recovery 105, source 6bbf191fd9a5ec58857a21656ca985a120485da2,
run fidelity-b166eef0-361b-4c7e-ab39-5e18940bd5e1 canceled its first call at
29,997 ms. Its first observation is incomplete and the other 44 are unrun.
Verification RV-LOCAL-FIDELITY-105-B166EEF0 retains this failed acceptance.
There are no completed cohorts or verified reads, and no cap changed.

The caller sets its 30-second timer before local admission and a four-minute
matrix deadline. The timer therefore covers admission and provider work.
The recorded attempt has no queued/acquired split: whether it actually acquired
the slot is UNKNOWN. Other local calls overlapped and completed in 161,795 and
100,577 ms. Those observations do not prove cold loading or this caller's wait.

The existing local-inference-runtime-policy grants the selected Qwen3.8 27B a
600,000 ms provider window; general local defaults are 120,000 ms. Existing
origin-specific admission has its own finite policy. The shorter diagnostic
caller preempts these policies. Raising one arbitrary timeout is insufficient.

WWMD DI-BC90C7B123C6 recommends checkpoint-one-observation with usable signal,
autonomy eligible and no commandment conflict. Feature magnitudes are explicitly
grade-C engineering estimates, not measured option outcomes. Earlier
DI-1B6E1B4F4C89 abstained because the author supplied malformed and mismatched
citations; that result remains retained, not a passing decision.

Alternatives considered: observer-only retains the policy conflict; stretching
one synchronous 45-case call can hold stale authority for hours. The selected
approach returns after one distinct observation and retains progress in the
existing EndpointTestRun. It is not a new queue, table, transport or tool.
The existing durable one-shot recipe is Gemini/no-tools and cannot stand in as
local tool-execution authority.

## Unchanged owning acceptance criteria

The following BI-3B3F477B criteria are quoted verbatim. This bounded publication
does not erase or claim completion of the wider quiet/stall requirements.

- A local turn that runs well beyond the current quiet threshold, while still producing, is never rendered as stuck or stalled and is never reaped.
- A timeout attributable to hardware speed does not write a dimension score; the profile records "not measured" instead.
- Stall and quiet thresholds derive from the running endpoint's observed performance, not a fixed constant.
- Owner-facing copy for a long local turn states that it is still working and that local hardware is slower.
- Regression test covers a long-running-but-healthy local turn and asserts it is neither flagged stuck nor reaped.

C2 remains awaiting acceptance. Its existing nine goldens, surfaces
8/15/24/32/48, >=90 percent accuracy and >=5 independent observations per
declared cohort are unchanged. Preserve its stronger complete-coverage check,
all completed negatives and every incomplete/unrun result. Never promote caps
or confidence from fixture tests, timing evidence or this implementation.

## Checkpoint contract

CONTRACT-CHECKPOINT: extend only the observational mode of run_endpoint_tests.
An explicit start key resolves to one deterministic, authority-bound runId using
the existing unique EndpointTestRun.runId. Repeated start requests read the same
run. Continuation supplies that run and the expected observation index; replay
of a completed index returns its retained result and cannot advance another
case. Ordinary probes, scenarios and concurrency diagnostics keep their scope.

The public operation explicitly accepts ONE observation, not a whole matrix.
Its response states remaining coverage and whether another distinct step is
permitted. It never promises that an invisible client loop will finish a matrix.
Accepted case identity and progress belong to the server row across disconnect,
credential refresh, client/executor changes and portal restart. Readback itself
requires current authorization. A changed executor must use its actual current
identity and supported authority; it may inspect authorized status but cannot
impersonate the old executor or adopt an in-flight claim. An interrupted case
remains held until actual recorded settlement, never safe-to-repeat by default.

The existing JSON result retains the immutable selection/runtime/source/catalog
fingerprints, ordered 45-case schedule, original authority binding, observation
records and a versioned checkpoint. Only one next distinct case can be claimed.
Use database compare-and-swap against the exact checkpoint revision and state,
with a server-issued claim fence, before any inference. Concurrent callers must
not both start a case. A losing claim returns current progress without inference.
Never use a process-local mutex as the durable execution fence.

Claimed/started work never silently returns to unrun. An expired or uncertain
claim becomes held/incomplete; a new caller does not steal or replay it. A late
worker cannot replace a held or superseded claim. A completed negative remains
in its denominator. An incomplete case holds further execution; no automatic
retry, new request key or provider switch repairs it. Preserve the original
failed 105 run as a separate historical observation.

## Authority and identity

CONTRACT-AUTHORITY: every step arrives through the existing governed tool and
uses its current original executor/catalog closure. Store no executor closure,
bearer token, raw prompt, tool arguments, result body or secret in the checkpoint.
Revalidate the current actor, user, token scope/grants and authorized surface,
thread/task/build and room restrictions before admission and before dispatch.
Reuse resolveMcpTaskAuthorityKey for current OAuth-family authority where
applicable; a token refresh is not authority to change the caller. Missing or
revoked authority holds the run. Never synthesize a TaskRun or borrow a reviewer.

The implementation must prove the exact trusted room binding available from
the executor before it admits resumable room-scoped calls. A matching tool-name
catalog alone is not proof of an identical room. If the current context lacks
enough canonical authority identity, refuse continuation rather than infer it.

Account execution revision, model/runtime digest, served source/content hash,
template/config and fresh authorized catalog digest must match the original
cohort. Current account/model status, allowed work, capacity and budget guards
remain active. Identity or catalog drift holds the run without a model call.
Completed proof still requires the exact server-issued successful ToolExecution
identity with actor/thread/task/tool binding and metrics-only privacy intact.

## Admission, execution and expiry

CONTRACT-TIMING: attach the existing withInferenceAdmissionObserver and preserve
its actual phase vocabulary and order. Record bounded queued/acquired/released/
canceled/timed-out metadata and elapsed admission/after-acquisition intervals.
No acquired event means acquisition is unverified, not zero execution time.
Acquisition itself is not proof that provider bytes or a tool call executed.

Derive finite admission and provider windows from the existing current-origin
admission policy and selected model's canonical runtime policy. Do not replace
those policies with a guessed constant or grant a false parent-deadline override.
The step's absolute wall bound is their finite composition, intersected with
any real inherited cancellation/deadline. Each subsequent step is a newly
authorized invocation, not an extension of an expired invocation's allowance.
An overall checkpoint expiry must be finite and derived from the declared
schedule/policy, never renewed by polling or a duplicate request.

The request must distinguish waiting cancellation from cancellation after
acquisition and unknown phase. Timers and observations must close reliably;
queued cancellation removes the queued request, while active work retains its
resource slot until the actual work settles. Check absolute expiry immediately
before governed read dispatch and after audit verification, even if timer
delivery is delayed. Late results never qualify or overwrite a fenced claim.

Reconcile the tool's quiescence wait-budget entry with its policy-derived
single-step upper bound. It is a wait estimate/force-cancel boundary, not a new
authorization source. Preserve normal draining/cancellation and explicit
unsettled execution if interrupted; no forced upgrade or lease override.

## Ordered implementation and verification

FLOW-CHECKPOINT: first freeze this design and obtain bounded independent review
of CAS, duplicate requests, authority/room binding, expiry and cancellation.
Record normal research and immutable proportional coverage; implementation
requires an allowed claim. Resolve every graph-linked test before RED.

1. Extend the existing runner with a bounded admission evidence collector and
   meaningful queued-versus-after-acquisition cancellation regressions. Reuse
   existing observer events; never reserve capacity or alter admission priority.
2. Factor pure checkpoint/schedule/proof projection into the operate leaf and
   implement single-case durable CAS, idempotent start/readback and terminal
   fencing. Keep original scoring, identity checks and executor dispatch.
3. Integrate explicit continuation fields in the existing tool pack and document
   progress/hold states and finite timing. Update quiescence budget consistently.
4. VERIFY-NEGATIVES: test concurrent claims, lost-response replay, stale workers,
   expired claims, token/grant/room/account/source/catalog drift, late timers,
   queued cancellation, cancellation after acquisition, completed negatives and
   unchanged caps/ratings. A fake healthy call beyond 30 seconds must be allowed
   only inside the actual canonical/inherited window. These are source tests.
5. Run affected tests, both TypeScript programs, architecture/style/derived-doc
   checks and exact shared integration. Publish only after independent exact
   source assessment and current receipt policy; use protected PR/merge queue.
6. VERIFY-LIVE: after a containing canonical release and CAN-TEST, perform a
   justified corrected local-only run through the supported operation, advancing
   distinct scheduled cases under current authority. Stop on any held/unknown
   result. Only completed exact-identity cohorts can satisfy C2 acceptance.

The broader quiet/reaping criteria remain open under BI-3B3F477B until separately
verified against the existing stall/quiet owners. Do not reopen DONE
BI-B550D9E5, edit WC-35B59F09's five owned paths, or declare this finite slice
to have implemented their unrelated lifecycle surfaces.

## Impact and ownership

Existing claimed paths: operate/tool-fidelity-runner.ts and its tests, new
operate/tool-fidelity-checkpoint.ts and tests, mcp/packs/build-ops-pack.ts and
tests, mcp/tool-timeouts.ts and tests, this plan and provider-developer-notes.
Resolve any additional shared authority-type path through its actual owner
before changing it. No application-boundary/import-cycle baseline increase.
New modules remain below 800 lines. Design-Grounding-Decision is required.
The resolved impact contract requires find_related_tests for runner, checkpoint,
tool pack and timeout registry; missing advice expands verification. Run
scripts/check-style-drift.mjs and regenerate only actually changed derived docs.

## Risk and rollback

Primary risks are duplicate inference, stale authority reuse, false success
from admission events and late worker overwrite. Persisted claim fences,
original current executor checks, unchanged exact audit proofs and strict holds
contain them. Revert the checkpoint integration as one concern and retain all
EndpointTestRun/audit evidence. No migration, credential or historical rewrite.

## Backlog coverage

BI-3B3F477B is the existing owning work item; WC-DB3E0AF7 is its normal medium
design workroom. Atomic sequencing for this diagnostic repair: evidence,
checkpoint and tool integration are not separate local-qualification outcomes.
Requirement refs: AC-LOCAL-PERSISTENCE, AC-NO-TIMEOUT-SCORE, AC-OBSERVED-TIMING,
AC-HONEST-PROGRESS, AC-REGRESSION. Contract refs: CONTRACT-CHECKPOINT,
CONTRACT-AUTHORITY, CONTRACT-TIMING. Flow: FLOW-CHECKPOINT. Verification:
VERIFY-NEGATIVES, VERIFY-LIVE. Immutable provider-verified coverage is pending;
this draft is not implementation admission or a completed acceptance receipt.
Prior coverage cmvawa9tt08ix01p0oqpdmp0g binds the ab1de1b draft. Refresh the
native immutable coverage after publishing this scope clarification; the native
record is authoritative and no self-referential document hash is manufactured.
