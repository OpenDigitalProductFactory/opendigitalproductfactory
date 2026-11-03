---
status: draft
---

# Recover an original review under current connection authority

Backlog: BI-C28A2C75. Workroom: WC-F77F4FF2. Blocks: BI-2AB781FA.
Source baseline: `b58ef2c2e3be056d1d54112a3355b05c697ee1f7`.
This is a source design, not a permission grant or a recovery receipt.

## Problem and verified evidence

The original architecture review in WC-5D2B3806 is paused at its terminal-writer
checkpoint. Its exact request digest is
`0802deea55e5472497529be2043b48dd96884fe475a1a069463b7f29398829de`.
Its task identity is
`TR-MCP-b2F1dGgtZmFtaWx5OmNiYzdiMGRkLTkxMDQtNDVkZS05NTdkLThmMmQ4ZjY3MDJmMQ-75B65E116B07`.

PR #6269 repaired historical reader controls and is included in canonical served
commit `1ace3621feb63c476b377a71e75a594456ad5395`. That does not repair authority
continuity. `tasks/submit` finds existing requests under the current user's task
authority namespace. The original interactive OAuth family has zero unexpired,
unrevoked token rows. A fresh native connector audit identifies a different
family and authority binding. The CLI credential is also a distinct identity.
Replaying the stored packet through it created another task, immediately
cancelled through `tasks/cancel`. The original request and checkpoint are intact.

The reproduction is recorded in WC-5D2B3806. Diagnosis read only TaskRun,
TaskMessage and value-free token/audit metadata; it did not read credentials or
mutate production rows. The independent recovery chat checked the served source
and confirmed the namespace boundary. A successful review on another task is
not evidence that this original review completed.

## Existing substrate and overlap

Reuse `mcp-task-submit.ts`, `mcp-task-capacity-contract.ts`,
`mcp-task-oauth-recovery.ts`, `mcp-task-terminal-writer-recovery.ts`,
`mcp-task-background-worker.ts`, `auth/oauth-task-authority.ts`, current OAuth
authority predicates, Workroom access, and the independent reviewer issuer.
The existing task/thread, evidence, outbox and CAS reservations remain canonical.

BI-801313EB covers durable async recovery and is done; this is a remaining
connection-identity gap. BI-06AE6833 owns PR-tail convergence. BI-B986A18B owns
consent and connection setup. BI-CAP-21C511CA and BI-CAP-29F5787B own task
readback. BI-EDC0DAF2 covers zero-tool reader hydration, and BI-B949993E covers
native reviewer session binding. None replaces this exact-original-task transfer.

## Direction and limits

DI-E16BBBE91BCF selects explicit recovery through the existing submission lane
over another lifecycle entry point or requiring the unavailable original family.
It returned a usable, autonomy-eligible, high-confidence recommendation, no
commandment conflict, and stable sensitivity. Feature magnitudes are engineering
estimates, not measurements. DI-42546C5975E7 supplied no feature vectors and
returned no recommendation; it does not govern this design.

Extend the existing native reviewer request and task submission contract with an
explicit, server-issued recovery target: original TaskRun, saved request digest,
and observed state/version. Resolve that target before ordinary new-namespace
task creation. An invalid recovery target must refuse, never fall through into
creating another task. Ordinary submission retains its current namespace rules.
Do not add a table, task ledger, provider, credential mechanism or general
cross-user ownership-transfer capability.

First scope is the same authenticated human and canonical acting coworker,
recovering an independent initiative review in a Workroom where both currently
have action access. No PAT or credentials-client substitution is used to evade
the interactive reviewer authorization contract. A task handle is a locator,
not authority; the server must issue and validate the exact recovery packet.

Retain immutable original request metadata, authority namespace, source binding,
reader executions, rejected writer attempts and receipts. Record current
execution authority separately through existing server-owned task/audit state;
the worker validates it afresh at dispatch and nested tool execution. Do not
rewrite an expired credential, revive an old family, or infer continuing grants
from the original snapshot. Current revocation always stops execution.

All recorded deadlines, total retry budgets and consumed approvals remain in
force. A historical task with no absolute deadline does not acquire an invented
one from this design; existing execution ceilings still apply. Completed,
cancelled, superseded, exhausted, actively executing or execution-uncertain tasks
cannot be revived. Provider settlement is evidence, not an inference from age.

## Recovery contract pseudocode

```text
recover(request, authenticatedCaller):
  require explicit server-issued original-task recovery target
  load original task and immutable request under authorized owner read
  validate current human, acting coworker, OAuth binding and token scopes
  validate exact Workroom, reviewer, tool/item boundaries and data constraints
  match saved request digest, artifact, head and baseline; reject widening
  establish eligible stopped checkpoint and remaining recorded budgets
  if a valid writer receipt already exists: return its real outcome
  CAS-reserve original task and current execution authority as one transition
  preserve original request, evidence and namespace; audit authority continuity
  resume existing bounded reader/writer path on the ORIGINAL TaskRun
  recheck current authority at dispatch, each effect, and receipt commit
  reconcile actual writer outcome; never equate dispatch with acceptance
```

The actual implementation must reuse lifecycle reservations and fencing rather
than implementing these steps as a second task engine. Approved consequential
effects retain their exact one-shot approval contract and are not retried merely
because inference is recoverable.

## Ordered correction

1. Freeze this design, capture WWMD outcome, resolve native issuer/transport
   details. Follow the current proportional readiness decision for this fix;
   bind the branch/head and declare exact scope before runtime-code edits.
   Independent committed-change assessment remains required before publication.
2. Add failing tests for cross-family explicit recovery, invalid-target refusal
   before new-task creation, and unchanged ordinary idempotency. Test revoked or
   changed caller, wrong room, changed request/baseline, widened tools, active or
   uncertain execution, cancellation, expiry and exhausted budgets.
3. Extend the existing packet/parser and original-task selection seam. Centralize
   current execution-authority resolution for synchronous, background and nested
   writer paths; preserve immutable origin. Test expired current credentials,
   successor events, cancellation/takeover races and stale writer commits.
4. Exercise concurrent recovery and restart: one reservation/outbox, original
   TaskRun, persisted reader evidence, no duplicate inference or effect. Resolve
   every gate-context test impact; run source/test TypeScript, guards and the
   canonical integration gate. Infrastructure outcomes remain inconclusive.
5. Update MCP authorization/recovery documentation in the same implementation
   branch. Obtain exact committed-change semantic review; publish DCO PR and use
   protected merge queue. Canonical deployment remains a separate governed act.
6. Verify served bytes, recover the actual original task through the native
   connector's supported packet, and require a genuine writer receipt. Reconcile
   this BI only after acceptance; resume conformance planning under its own gates.

Steps are internal sequencing for one atomic repair. The issuer, selection,
authority revalidation and fencing cannot ship independently: an entry point
without those controls would either duplicate work or admit unauthorized replay.
Implementation uses these steps as its bounded plan; publication and live
acceptance still require their own recorded evidence.

## Acceptance criteria

- A currently authorized caller can recover the eligible original task after its original connection expires or changes, without another task identity or duplicate inference.
- Changed user/coworker, revoked current authority, widened scope, changed request/artifact/baseline, wrong room, active or uncertain prior execution, cancellation, exhausted attempts and expired immutable budgets refuse with precise remediation.
- Concurrent recoveries reserve once; stale executors cannot commit a writer after takeover.
- Source and execution authority history remain auditable; original immutable metadata and evidence are retained.
- Discovery/status yields the supported recovery action and preserves real provider/writer failures instead of claiming success.
- On the canonical runtime, recover the actual original architecture task and verify its genuine writer receipt before reconciling BI-2AB781FA.

## Compatibility, risk and rollback

Legacy same-family submissions and task identities remain unchanged. Historical
tasks missing enough identity or settlement evidence receive a precise refusal;
this repair does not fabricate a migration baseline. No database migration is
proposed. Native host protocol access and reviewer packet equality must be tested,
not assumed from an available CLI transport. ARTIFACT_AUTHOR_REQUIRED remains a
separate readiness finding until its actual evidence is resolved.

The main risks are mistaken authority transfer, stale workers and loss of
immutable provenance. Negative authorization tests, lock-time revalidation and
conditional settlement are required. Roll back through a DCO-signed revert and
protected queue. Preserve any recorded transfer audit; old code must refuse
unsupported recovery state rather than silently restore the expired origin.

Runtime verification, a native semantic receipt, independent design assessment,
coverage and all implementation tests are unrun for this repair at capture time.
Neither this design nor the deployed reader/deadline fixes completes EP-B932453F.

## Original-result collection amendment — 2026-10-18

Owning scope remains BI-C28A2C75. Current design work is bound to WC-988A6FFA,
`codex/original-task-result-collector`, executor Codex chat
`01a15241-2a2e-7a02-9b2f-ce0f198f8e63`, in the dedicated sibling worktree
`/Users/markbodman/dpf-worktrees/original-task-result-collector`. Its source base
is `e22a9996c58a21e6af868baa0f48ee2195573bc2`. Historical WC-F77F4FF2 and its
reassigned physical checkout do not supply current admission. Design admission
IRD-2EE4DA4F423B covers this amendment; implementation admission must be checked
against its committed source before runtime-code edits.

This amendment makes proposal `cmvdcpn2n620r01nq3fmzvgym` explicit in the owning
design and resolves the missing contract recorded in `cmvepep1466bv01o7j9ursy2k`.
The previous delivery closure retained missing acceptance; it does not prove this
collector exists. The collector extends existing task readback and issuer recovery.
It does not change execution eligibility in the authority-recovery design above.

### Read contract and provenance

Under current original-owner read authority, collect only existing observations
for the exact original TaskRun, immutable request digest, execution attempt and
writer checkpoint. Validate the saved deterministic task identity, reviewer,
writer, immutable artifact, Workroom/source binding and receipt binding. Retain
the observation's source and recorded time; report missing or incompatible proof
explicitly. A task handle, an expired credential or administrator status grants
no additional read authority. Do not expose raw prompts, provider output,
credentials, arbitrary SQL or screen contents.

Use the existing successful governed writer receipt and original native dispatch,
outer-process and child-closure observations. Project four distinct states:

- `receipt-complete`: an existing genuine successful writer receipt matches the
  original request, writer, artifact and checkpoint. Return its recorded outcome.
- `proven-not-dispatched`: exact original-attempt evidence establishes refusal
  before dispatch and no unresolved or late effects.
- `proven-settled-without-receipt`: original-attempt dispatch and closure evidence
  proves all execution and child effects ended, with no matching writer receipt.
- `unknown`: missing, truncated, stale, mismatched or contradictory evidence,
  uncertain execution, unresolved children, or possible late effects.

An outer process exiting, old heartbeat, transport timeout, canceled request or
absence of a receipt is insufficient proof of settlement. Historical observations
whose child closure is `unverified` remain unknown. Do not manufacture stronger
native observations to obtain a preferred classification. Preserve a real
budget/capacity refusal as its original observation, without converting it to a
product failure or claiming another attempt is authorized.

Read-only collection/projection is separate from receipt-backed CAS/history
healing. Readback never writes a verdict, dispatches or replays a task, transfers
execution authority, resets a deadline/attempt/approval, widens grants, changes
identity, or turns no-receipt settlement into permission for a successor. Existing
receipt healing may reconcile only a matching genuine receipt under its current
version/status CAS. Concurrent changes invalidate the collected snapshot; return
unknown rather than combine observations from different attempts or checkpoints.

### Implementation and verification plan

1. Bind this committed amendment to the current Workroom and obtain actual scoped
   implementation readiness, retaining its exact refusal/remedy if unavailable.
2. Add bounded typed collection/projection at the existing initiative-review
   outcome and native observation seams. Use existing persisted task/evidence
   records; add no table, queue, provider, authority system or generic proxy.
3. Expose it through existing original-owner MCP Tasks/result and issuer recovery.
   Keep replay admission independent and closed whenever its existing predicate
   refuses. Support useful unknown readback without issuing another review.
4. Test late effects, wrong task/digest/attempt/writer/artifact/checkpoint,
   missing child closure, current-owner denial, concurrent reconciliation,
   budget refusal and preservation of provenance. Test real matching receipt
   projection independently from the existing CAS healer.
5. Run affected tests/typechecks and required policy checks. Obtain independent
   committed-change assessment under the checked-in publication procedure,
   publish a protected DCO PR, merge through the queue, and request the canonical
   upgrade. Record unavailable native gates as unrun, never passed.
6. Verify served bytes and actual authorized original-task reader behavior with
   provenance. Report exactly what is proved or unknown. Do not retry either
   parent task or substitute another task family's receipt.

The specific original design-spec task ends `D2E5E2765847`; its distinct original
spec-approval task ends `4E1879A26F6B`. They belong to the parent's original OAuth
family and must be read under that parent's current authority. This chat does
not acquire their authority through the source repair. A supported reader may
legitimately leave either result unknown. Collector delivery alone does not
complete original AC5, cache useful-task acceptance, scheduler repair or daily
AI Ops reporting.
