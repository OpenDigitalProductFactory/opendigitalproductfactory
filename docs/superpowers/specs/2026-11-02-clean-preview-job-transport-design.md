---
status: draft
---

# Clean shared-preview job transport repair

Status: author design only; implementation, independent approval, plan coverage,
runtime execution and deployment are unrun. Backlog: BI-PIR-7f040ec5.
Workroom: WC-032AE7C8. Related duplicate symptom: BI-PIR-71c52a5a.
Consumer repairs: BI-D0D2FF0D and BI-7DC3B91D remain separate delivery units.

## Problem and evidence

The shared preview defaults to Inngest without its event key. The original
build/review.verify and rendition-backfill failures are recorded on the two
existing BIs. Current source/configuration inspection supports a missing
transport prerequisite; a new exact-source enqueue failure has not been run.
Rendering a preview or persisting a TaskRun does not establish background work.

The existing Postgres engine (BI-85E6EF14) is delivered but default-off. Its
September 25 design records successful throughput and restart benchmarks and
permits per-domain soak, not a global production switch. Partial routing in
jobs/routing.ts still sends events to Inngest as well as Postgres. Setting only
DPF_JOBS_POSTGRES_FUNCTIONS therefore does not solve the missing-key problem.

Current preview initialization runs the canonical image's sanitized clone after
worktree migrations. That clone does not quarantine all JobEvent, JobRun,
TaskRun or schedules. Enabling workers on a copied organization database could
execute copied work. A fresh clean fixture is a prerequisite, not a later purge.

The preview helper also accepts custom reservation keys, while
local-provider-capacity.ts exempts only dev-portal:. Two recent custom-key
preview attempts consequently competed with normal inference. The first was
never admitted; the second expired after interrupted cloning. Neither is a
successful served coworker test. Existing evidence: cmvzzj7c10uyp01o24duvgl4t
and cmvzzhw4w0uxc01o2sxz82wsd.

## Design grounding

Reviewed existing substrate: scripts/lib/dev-preview-runtime.mjs;
packages/db/src/sanitized-clone.ts and sanitized-clone-identity-reset.ts;
apps/web/lib/jobs/{index,routing,serve}.ts; jobs/postgres/{start,send,registry}.ts;
queue/functions/index.ts; queue/functions/build-review-verification.ts;
queue/functions/document-renditions.ts; instrumentation.ts; and
routing/local-provider-capacity.ts. The foreground worker exists on the separate
unpublished foreground repair branch, not protected main at 36b468668706.

Reuse the canonical shared-runtime lease, database binding, seed/migration and
Postgres worker infrastructure. No new job engine, table, work ledger, provider
credential, authority model or independent preview server is proposed.

Platform decision DI-17477B81359E recommends isolated_postgres_target over a
separate Inngest preview service or read-only previews with CI-only execution.
This records the author adopting that design direction. It is not independent
spec approval, a funding decision, rollout permission or a production flag flip.

## Objectives

**OBJ-1:** Preview job requests execute through DPF's existing job machinery on a clean, explicitly admitted test target without production transport credentials.

**OBJ-2:** Preview execution cannot replay copied business work or run a function outside its admitted cohort.

**OBJ-3:** Preview reservations preserve inference availability while genuine heavy verification retains its capacity protection.

**OBJ-4:** Verification distinguishes transport, authority and model failures and proves automatic continuation using the same original request.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1, OBJ-2 | A clean preview is prepared through the canonical lease and runtime, with exact source/image/lease/database identities and no organization clone, copied credentials, pending jobs or copied schedules; preparation failure prevents worker startup. |
| AC-2 | OBJ-1, OBJ-2 | An explicitly admitted function/event cohort uses Postgres without Inngest dual-send; unadmitted events and functions fail closed with an actionable reason, while normal production routing remains unchanged. |
| AC-3 | OBJ-2 | Seeded poison work, production database bindings, stale or foreign leases, cloned-target mode and absent admission all prevent execution before any handler or provider effect. |
| AC-4 | OBJ-3 | Preview keys are normalized or rejected to retain the dev-portal namespace, actual preview reservations do not pause inference, and real heavy verification reservations still do. |
| AC-5 | OBJ-1 | Both original build/review.verify and rendition-backfill event paths have actual isolated-target tests demonstrating correct enqueue, one bounded handler result and actionable transport-unavailable recovery without a production key; an expected missing-sandbox skip proves delivery only, never successful build verification or conversion. |
| AC-6 | OBJ-4 | On a source containing the foreground repair, one authorized synthetic Finance request retains request/thread/task identity through capacity hold, automatic continuation, duplicate delivery, saved answer and page reload; exactly one answer persists without owner resubmission. |
| AC-7 | OBJ-4 | Separate negative cases identify unavailable transport, absent Finance authority and unavailable model without presenting queued work, owner-review state or a rendered page as a coworker result. |
| AC-8 | OBJ-1, OBJ-2 | Cleanup stops only owned processes, closes the exact reservation through its required native gate, and records failures and unrun checks without changing source or claiming rollout success. |

## Contracts

### C-TARGET — preparation and admission

Keep copied read-only UI previews as an explicit separate profile. Add a clean
execution profile to the same canonical helper, not a second runtime lane.
Prepare the disposable database from migrations plus minimal existing fixture
seed machinery; never run sanitized-clone in this profile. Validate physical
destination identity against the production source and canonical dev target
before any reset. Fail closed on aliases or unresolved physical identity.
No existing target is converted in place while a worker is running.

The host binds the current admitted lease, source tree and canonical image to
the clean target. Before startup, prove initialization completed and persisted
job/event/task/schedule state contains only this attempt's explicitly created
fixtures. Admission is derived from that verified host preparation, not from a
caller-supplied environment flag alone. Revalidate lease/target ownership before
fixture dispatch. Missing or conflicting bindings are a refusal, never a reset.

The clean startup branch runs immediately after the Node/runtime build gate in
instrumentation.register, before importing the normal boot-task graph. Its
complete permitted startup list is: verify clean-target admission; register the
existing in-memory tool-governance hooks; mirror the platform version into this
fixture database; start the admitted Postgres worker; start the admission
watchdog. Return before normal instrumentation continues. No production boot
reconciler, issue bridge, converter image reconciliation, federation, backup,
self-upgrade, model placement, provider synchronization, code-graph bootstrap,
LDAP listener, render backfill or other operational timer runs. Required UI
baseline data is prepared by the fixture seed, not background convergence.
Measurement-runtime behavior is relevant prior art, but its flag alone is not
this boundary: it also skips worker startup and still permits boot writes.

Do not mount the Docker socket, production storage, production credentials or
host home into the clean portal. Worktree source is read-only to handlers;
database, logs, temporary files and document storage belong to this attempt's
disposable target. Converter, sandbox and external-provider access are absent
from the initial transport probe. An unavailable UI prerequisite is a fixture
defect to repair explicitly, not grounds to enable the normal boot graph.

Admission is invalidated by lease expiry/revocation, owner/source/image/database
binding changes or a failed watchdog read. Startup and every process restart
must revalidate the current persisted binding; a durable JobRun lease supplies
no preview authority. The worker validates before fan-out, claims, cron ticks,
handler entry and each new durable step. Loss prevents new work, stops polling,
notifications and maintenance, and tears down the owned runtime through the
keeper. Completed durable steps are retained. An already dispatched external
effect is UNKNOWN until reconciled by its existing owner; invalidation cannot
promise to undo it or authorize replay. Initial probes have no external effects.

No credentials are copied; operator consent remains necessary for real provider
access. Synthetic organization/user/coworker fixtures use the existing authority
path. A role label never stands in for an actual capability grant.

### C-ROUTING — finite cohort and one transport

Extend the existing jobs facade and function selection with an explicit clean
preview admission. Normal unset/Inngest routing and production per-domain soak
keep their present behavior. For an admitted clean preview only, select a finite
function cohort, build its event-name registry from declared triggers, register
only those functions with the existing Postgres worker, and disable Inngest
dispatch for that cohort. Reject an unknown event before persistence. Do not
return a fake event id for unsupported work. Avoid importing and registering all
production functions as a side effect of selecting Postgres.

Required repair probes include build/review-verification and
documents/rendition-backfill. Use a fixture build without a sandbox and assert
the existing terminal result `sandbox or build missing`; prohibit capture,
finalizeBuildForReview, semantic review, browser-use, dispatchShip and publication.
This proves the originally broken event transport and handler entry only.
Rendition backfill runs with an empty fixture document set and no converter
access. Its existing availability check returns before scanning. Capture the
attempt-specific `converter unavailable ... nothing swept` log, correlated by
the supplied reason, alongside the durable handler result; zero processed alone
does not identify this outcome. It creates no converter/container. Positive
backfill scanning, build verification and conversion remain unrun workflows.

The finite inventory is:

| Cohort | Function | Trigger | Permitted downstream work |
| --- | --- | --- | --- |
| Transport probe | build/review-verification | build/review.verify | Load owned missing-sandbox fixture and return the existing skip result only |
| Transport probe | documents/rendition-backfill | documents/rendition.backfill-requested | Existing converter-unavailable early return, identified by attempt-specific log and durable result; no scan, generation event or conversion |
| Foreground, after its separate source is available | agent/foreground-work-run | agent/foreground-work.run | Existing authorized foreground worker on the one retained fixture request |
| Foreground, after its separate source is available | agent/task-dispatch | Existing five-minute cron | Only its existing reconcile-retained-foreground-work step, which may emit agent/foreground-work.run |

In the admitted foreground profile, agent/task-dispatch returns after its
existing retained-work reconciliation step, before acceptance-upgrade wakeup,
hourly coworker self-task convergence, provider-lane planning or other scheduled
tasks. This is a test-target boundary, not a production scheduler change.
Other crons are absent. Import these exact defining modules in the admitted
startup path instead of the complete queue/functions index. Verify transitive
imports cannot start producers; an unexpected producer/registration is a failing
boundary test. Registration, event acceptance and timer selection share this one
inventory. No excluded event is silently accepted or marked successful.

The existing CI-only Finance conformance admission stays CI-only. Shared preview
uses its own verified canonical lease/target contract, never forged GHA flags.

### C-CAPACITY — classification, not bypass

The canonical preview helper preserves dev-portal: identity even with a useful
caller suffix, or rejects a conflicting override before creating a lease.
Capacity classification continues to protect actual heavy verification. Tests
cover admitted and queued previews, terminal reservations and genuine heavy
gates. No global capacity exemption and no impersonation of another owner.

### C-EVIDENCE — outcomes and retained work

Transport admission and delivery, Finance tool authority and model readiness
are separate observations. The proof records original request, thread, TaskRun,
job/event identities, source, target and provider binding. It waits for actual
terminal output and reads persisted output after reload. Capacity/restart and
duplicate tests prove one result and bounded recovery without resubmission.
No real mail, customer edge action or paid provider activation is part of this
synthetic transport repair. Those remain explicit business acceptance work.

## Flows

F-PREPARE: claim canonical dev-portal reservation -> prepare clean database ->
verify exact target/source and absence of copied work -> admit finite cohort ->
start canonical worker and portal. Any failed boundary stops before execution.

F-EXECUTE: authorized fixture request -> facade validates admitted event ->
Postgres event/run -> existing handler -> persisted result. Restart resumes from
existing durable state; duplicates do not create additional business output.

F-RECOVER: explicit unavailable dependency -> retained wait with original
identity -> existing bounded scheduler resumes after recovery -> one saved
answer -> reload reads the same answer. Distinct authority denial stays denied.

F-CLEANUP: stop owned keeper/processes -> verify owned container inventory ->
native exact-reservation release/approval -> record actual terminal lease state.

## Ordered fix and verification

This is one atomic transport-admission repair: clean preparation without bounded
routing is unsafe; bounded routing without a clean target is unsafe; neither
proves the repair without actual delivery. Consumer product fixes remain in
their own existing BIs and branches. No coverage receipt has yet been issued.

1. V-BOUNDARY: after independent scope approval and valid v2 coverage, claim
   exact implementation paths and consume their change-impact obligations.
   Write failing tests for clean-vs-cloned preparation, physical target identity,
   lease/source binding, poison work and startup refusal. Reuse existing seed
   helpers after confirming their exact minimal-data contract. Assert the clean
   instrumentation branch never imports or calls the normal boot graph, mounts
   no production resources and starts only the enumerated timers. Invalidate
   admission before claim, before a step and on restart, and prove no new effect.
2. V-ROUTING: write failing registry/routing tests for finite function selection,
   forbidden events, absent Inngest key, no dual send and unchanged production
   defaults. Implement in existing facade/registry/startup boundaries. Run all
   affected job-engine unit tests and web typecheck.
3. V-CAPACITY: write failing helper/classifier tests for custom preview suffix,
   queued/admitted/terminal leases and actual heavy gates. Repair at the narrow
   canonical identity boundary; do not weaken inference protection.
4. V-DELIVERY: on a fresh governed clean target, run both original event probes
   and restart/duplicate/transport-outage cases against actual Postgres jobs.
   Reuse valid existing engine benchmarks, but do not count them as these cases.
5. V-FOREGROUND: after the separate foreground source is properly available,
   exercise AC-6/AC-7 through the served signed-in portal. Provider doubles prove
   controlled recovery only; they do not establish live provider/mail readiness.
6. V-RELEASE: required local checks, exact-tree canonical gate, independent
   committed-source review, PR health/merge queue and canonical self-upgrade.
   Run served verification on delivered bytes and record cleanup. The existing
   architecture publication blocker BI-9BEB3D56 remains with its paired owner;
   this design does not waive the unchanged guard.

## Rollback and risks

Leave the clean execution profile off unless explicitly admitted. A failed
boundary stops workers and retains diagnostics; rollback selects the existing
read-only profile through normal canonical preparation. Do not turn a seeded
target into a copied live organization in place. Production default routing,
provider secrets and existing queued work stay outside this repair's scope.

Main risks are imported registration side effects, copied background work,
physical database aliases, scheduler dependency omission, and accidental
inference contention. AC-1 through AC-8 are required release evidence, not claims
that those risks have already been tested. Funding purpose remains unresolved;
this source design authorizes no new provider, spending, access or rollout.
