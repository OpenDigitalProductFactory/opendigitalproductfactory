---
backlog: BI-8B8731EE
status: active
---

# Maintenance evidence for interrupted native reviews

The owner directed this chat to close the reviewer blocker before delivering
BI-5366EF78. WC-1D447592 owns the containing CLI repair and runtime advance.
This bounded contribution supplies evidence; it does not retry tasks or certify
that their effects settled. Original reviewer attempts remain unknown.

## Existing contracts and missing evidence

`promote.sh` already recreates the portal and sandbox. Sandbox refresh can fail
after a successful portal upgrade. Neither that success nor the quiescence
TaskRun status snapshot proves all old native executions ended. Current
`recoverSandbox` records a restart summary and current container, without a
retired epoch receipt. The three blocked reviews have document-read audits and
no writer record; audit absence and expired JWTs do not prove settlement.

Reuse the existing promoter, state mount, runtime transition signing secret,
canonical JSON, SelfUpgradeRun completion evidence and server-side importer
pattern. Add no ledger, table, credential, retry API or authority override.
Docker's container removal contract supplies the retirement observation:
[Engine container inspect](https://docs.docker.com/reference/cli/docker/inspect/)
and [container listing](https://docs.docker.com/reference/cli/docker/container/ls/).
Observe full identities and successful daemon inventory; an inspect failure
alone could be a transport failure. No implementation test runs maintenance.

## Finite acceptance

- EP-1: Before the canonical swap, capture the actual daemon, Compose project,
  full portal/sandbox container IDs, start times and service labels. Bind the
  signed checkpoint to the actual SUR, target source, promoter digest and
  migration/recovery point identity. Missing identity yields no usable proof.
- EP-2: After the existing sandbox refresh, require the same daemon, different
  running replacement IDs, matching project/service labels, and successful
  complete inventory proving both old IDs absent. Sign the actual observation.
  Failed/optional sandbox refresh, unreadable inventory, restart without removal
  or identity mismatch never produces a complete retirement receipt.
- EP-3: Authenticate every nested byte using existing signing primitives and
  canonical payload bytes. Bind import to the exact known run, source, recovery
  point and promoter identity. Reject tampering, unknown fields/versions,
  inconsistent/future timestamps, cross-run reuse and conflicting replay.
- EP-4: Persist only validated retirement evidence into the existing run using
  an observed-value CAS. Exact replay is idempotent; concurrent evidence changes
  must survive. Missing or invalid proof remains unavailable, never a pass.
- EP-5: Evidence states only environment retirement. It grants no task replay,
  does not infer provider settlement, and never clears uncertainty. Future task
  recovery must additionally verify original TaskRun/digest/attempt membership,
  current authorization, canonical receipts and all effect reservations under
  its generation fence. Broad grant exposure cannot be ignored.

## Ordered implementation and checks

One internal contribution under BI-8B8731EE. Resolve exact scope and related
tests before Red. Write failing adversarial receipt, producer and importer tests.
Build a pure signed receipt validator, an injected read-only Docker observer,
and a server importer. Then add bounded hooks around the existing canonical
swap, plus promoter packaging and sensitivity coverage. Keep optional new
evidence unavailable on N-1 callers lacking its script; never wedge their upgrade
or fabricate a historical baseline. Source qualification remains separate.

Run Node fixtures, affected promoter packaging/signing/N-1 contract tests, web
importer tests and both web typechecks, style/doc guards and exact-tree gate in
the containing candidate. Required convergence attestation: self-upgrade-step;
the canonical promoter produces evidence only when it actually carries the new
module. Independent exact-source assessment is required; native review remains
unrun under the checked-in bounded DEV infrastructure recovery procedure.

Rollback removes observation hooks/importer. Existing maintenance and retained
evidence remain intact. This contribution cannot close the historical blocker
until real maintenance evidence and task-effect reconciliation are verified.

## Executed source evidence and limits

First-failing runs established missing observer/validator modules, missing server
importer, missing canonical recovery-digest carrier and missing persistence.
After implementation, 117 Node tests passed across receipt authentication,
observation/persistence, signing, packaging, N-1 contracts and namespace guards.
All 188 affected web tests across eight files passed, as did both TypeScript 7
programs, Bash syntax, style drift, copied-script imports, canonical-JSON and
argv guards, documentation links and whitespace checks. Existing mocked upgrade
tests log missing database configuration; their assertions passed. No test
requested a real maintenance or model/provider job.

The packaging tests first caught missing JIT and Dockerignore entries; both
were repaired. The unchanged namespace test expected one state mount while the
unchanged catalog now declares portal, portal-init and federation mounts. Its
exception now targets those exact core-service volume fields, with negative
tests for executable fields and mounts on another service. No catalog changed.

The observation script signs canonical payload bytes with the existing runtime
transition secret and domain-separated envelope kind. The canonical launcher
passes the digest of its actual recorded recovery point. Import requires the
exact succeeded/deployed source, enforced readiness/promoter identity, successful
Postgres recovery members, timestamps and updatedAt CAS. Another evidence write
wins a race; it is never overwritten. Exact replay is idempotent.

The checkpoint and immutable final receipt live with the existing recovery
backup. A transient state-mount copy feeds the existing reconciliation cadence.
An N-1 staging closure lacking the script, missing run/digest identity, failed
sandbox refresh, missing secret or secret rotation leaves evidence unavailable.
No retry authority follows from this artifact. Actual epoch membership for the
original TaskRun, all effects, grants and generation fencing still require
separate server verification before any original attempt can resume.

## Prospective CLI launch binding — October 16 design amendment

Design/preparation owner: BI-06AE6833 / WC-1D447592, canonical-delivery chat
01a12c34-f7d3-74d3-8da6-01ffd0752516. Normal design admission and exact document
scope were accepted. This amendment is DESIGN ONLY: no implementation, new
review execution, replay admission or historical membership is established.

Fresh task99B4B339F227, created after servedc38, still has no durable original
TaskRun/requestDigest/generation/full child-container launch binding. Its safe
diagnostics report quota error and outer process closure while retaining child
closure and effects as unverified. This is independent of the N-1 maintenance
digest limit. A future retirement receipt cannot supply missing membership for
this task,941,870 or the original three handoff reviews.

### Existing substrate and bounded decision

The existing AsyncInferenceOp and AsyncInferenceOperationTransition models carry
request and binding digests, TaskRun/Workroom identity, a start-claim fence,
leases, startAttemptedAt and immutable transition history. Their shared worker
distinguishes definite rejection from start_indeterminate and reconciles an
ambiguous start without starting again. Inspect async-operation-contract,
async-operation-lifecycle, async-operation-worker and async-operation-store
before implementing a native CLI adapter. These are the preferred lifecycle
substrate; this design does not authorize a parallel attempt table or scheduler.

TaskArtifact is available for bounded evidence tied to the same TaskRun, but its
existence is not an execution lease or fence. The existing local sandbox
provider owns host/container execution. CLI adapters and cli-owned-runner must
share that execution boundary instead of independently resolving a mutable
sandbox alias for preparation, launch and cleanup.

Adapter fit must be established before implementation admission. The existing
durable worker expects a provider operation identifier; a PID, locally minted
identifier or Docker handle must never be represented as a provider-issued ID.
If a native process cannot satisfy the current worker interface, document the
smallest extension to that same interface and its compatibility proof. Do not
silently replace synchronous tool execution with a second inference or claim
that a prospective lifecycle integration settles already-started work.

### Required prospective contract

- CL-1: Persist the accepted TaskRun, exact request digest, adapter/provider and
  actual selected account/recipe version, attempt identity and current existing
  fence before external IO. A racing duplicate joins that identity. A crash
  after start intent retains start_indeterminate; it cannot launch again merely
  because the client or worker lost the response.
- CL-2: Resolve the actual full container and daemon identity once before
  preparation. Bind the managed execution handle to that identity and the
  accepted operation/fence. Preparation, launch, observation and cleanup use
  that immutable target. Alias replacement must refuse or reconcile, never
  silently move part of an attempt to the replacement container.
- CL-3: Persist bounded authenticated launch/terminal observations using the
  existing operation transitions and evidence primitives. Exclude prompts,
  tokens, environment dumps, raw provider output and secret paths. Verify actual
  emitter, identity, ordering and fence; a client success flag is not evidence.
  Missing process evidence remains unavailable after client/portal interruption.
- CL-4: Keep outer closure, managed child-tree closure, canonical domain receipt
  and remote/provider effects distinct. Process closure does not settle remote
  effects. Cancellation and current authority win at the actual effect boundary;
  the BI-8B8731EE receipt-dedup primitive alone supplies neither a full execution
  generation fence nor closure of other reachable effects or child operations.
- CL-5: The same existing TaskRun observation surfaces expose attributable
  bounded evidence or its specific absence. Unknown/future/malformed evidence
  cannot enable Resume. No new recovery API, grant, bypass, synthesized review
  verdict, replacement request key or reset attempt budget is introduced.

### Verification and admission sequence

First prove adapter fit with source-local injected process/container/store
fixtures. Cover a lost create/start response, alias swap between preparation and
spawn, duplicate launch, stale fence, cancellation, lease loss, portal/client
restart, truncated/missing/tampered terminal evidence and cleanup failure. Retain
the original result after a race; test that there is no second provider launch.
Exercise both Claude and Codex through one shared process-observation contract.
Do not claim a mocked process proves real child-tree or provider settlement.

Then obtain independent exact-source design assessment, valid implementation
mapping/coverage and normal implementation admission before editing runtime
source. The normal owner must resolve graph-linked tests and impact guards for
the actual paths. Approximately one fifth consolidates repeated adapter target,
identity and observation handling. Protected publication and one qualified
canonical release precede an actual safe prospective launch/observation check.
Rollback retains historical evidence and returns unavailable/uncertain states;
it cannot reinterpret old launches, clear uncertainty or authorize repetition.
