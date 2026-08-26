---
status: active
title: Resumable external TaskRuns after transient pre-inference capacity
---

# Resumable external TaskRuns after transient pre-inference capacity

**Backlog item:** `BI-42CE2CE7`  
**Epic:** `EP-56AE0F69`  
**Workroom:** `WC-5A2685AD`  
**Design base:** `40a7e46afc35039d2f0d86d33de6d11159867213`

## 1. Decision summary

An immutable external reviewer request must not be consumed when every eligible
provider is temporarily busy before inference begins. Today
`submitRemoteCoworkerTask` creates the deterministic `TaskRun`, receives a
structured `capacity` or `busy` dead-end with zero tool executions, and then
marks that row `completed`. A later call with the same token and request key is
only an idempotent read of that terminal result, while a new key would create a
different review identity. The caller therefore cannot resume the governed
review that the server already bound.

The repair keeps that exact `TaskRun` in the existing nonterminal `submitted`
state, records a typed resource-wait projection in `progressPayload`, and lets
an exact immutable replay compare-and-set reserve the same row before invoking
the same execution path. The request digest, token namespace, TaskRun ID,
review binding, authority scope, thread, message, and audit attribution remain
unchanged. Only structured `capacity` and `busy` outcomes that occur before any
tool execution are resumable. Configuration, credentials, policy, context,
unknown, post-tool, approval, and terminal outcomes keep their current
fail-closed behavior.

This is a source-owned repair. It adds no schema, no new global status, no
provider exception, no lower model floor, and no retry that invents another
review identity.

## 2. Objective baseline

| Objective | Baseline | Target |
|---|---|---|
| `OBJ-RESUME-IDENTITY` | A pre-inference provider-busy result finalizes the deterministic external `TaskRun`; recovery requires a fresh key and therefore a new identity. | The same token, key, digest, TaskRun, and immutable review binding resume after capacity changes. |
| `OBJ-RESUME-HONEST` | Zero-tool transient capacity is projected as `completed`, which implies that the requested work ran. | The durable row stays nonterminal with an explicit resource-wait reason and next action. |
| `OBJ-RESUME-ONCE` | Concurrent replays can only observe the terminal row; there is no reservation for a resumable row. | One exact replay wins a compare-and-set reservation; concurrent callers observe the existing run without duplicate inference. |
| `OBJ-TERMINAL-SAFETY` | All dead ends share one completion path. | Only `capacity`/`busy` plus zero tools pause; every other dead end remains terminal and no side effect is replayed. |
| `OBJ-RECOVERY-SUBSTRATE` | `BI-MCP-EFF-0285909C` has a broader durable nonproduction notification design but no deployed implementation. | BI-42 exposes a narrow same-row resume seam that the generic capacity-event substrate can invoke without changing reviewer identity. |

## 3. Evidence before diagnosis

The recurring live occurrences are immutable and must remain in the audit
trail:

- WordPress research TaskRun `TR-MCP-...-207CE01115DE` completed with zero tool
  executions because the eligible local reviewer was busy.
- BI-47 research TaskRun `TR-MCP-...-7440A336BD9E` used a server-issued packet
  containing `read_source_at_version` and `record_initiative_evidence` after
  endpoint health `TR-D6491A4E` passed all eight probes. It nevertheless
  completed before inference with zero tools and no receipt because all
  eligible providers were busy.
- A second BI-SIG integration occurrence `TR-MCP-...-B48A7E92B214` likewise
  completed before inference with zero tools and no receipt. Its immutable key
  is consumed and will not be reused.

The code path matches those observations:

1. `apps/web/lib/tak/agentic-loop.ts` returns an `AgenticResult.failure` with a
   structured `InferenceDeadEndKind`.
2. `apps/web/lib/tak/inference-dead-ends.ts` distinguishes `capacity` and `busy`
   from credentials, policy/capability, context, missing model, and unknown
   failures.
3. `apps/web/lib/mcp-task-submit.ts` ignores `result.failure` and marks the run
   `completed` after every returned result unless a tool already moved it to
   `input-required`.
4. Its existing idempotent replay path returns the stored row and only has a
   special resume path for an approved `input-required` envelope.

The cause is therefore not model selection, endpoint health, or packet
serialization. It is the external TaskRun terminal-state projection and the
absence of a same-row execution reservation.

## 4. Research and benchmarking

- The [OpenAI Agents SDK human-in-the-loop guide](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
  resumes the original serialized `RunState` rather than creating a second run.
  It also fails closed when a checkpoint cannot prove whether a provider
  accepted an output-bearing request. **Adopt:** resume the original durable
  identity only where the pre-acceptance boundary is provable. **Reject:**
  serializing a second agent runtime into DPF; `TaskRun`, `TaskMessage`, and
  `a2aMetadata` already hold the DPF request boundary.
- [Temporal's durable execution contract](https://docs.temporal.io/) preserves
  workflow progress across infrastructure outages and resumes from recorded
  state. **Adopt:** the durable row is the recovery anchor and reservations are
  idempotent. **Reject:** introducing a second workflow engine for one external
  MCP transition.
- [Inngest `waitForEvent`](https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event)
  keeps one run paused until a correlated event arrives and retains an audit
  trail. **Adopt:** represent the wait explicitly and expose an event-callable
  resume seam. **Reject:** making BI-42 own the generic capacity event service;
  `BI-MCP-EFF-0285909C` remains the system-wide notification/reconciliation
  owner.

Across all three, the relevant invariant is the same: infrastructure waiting is
a nonterminal state of one durable execution, not successful completion and
not a newly identified successor attempt.

## 5. Existing substrate

- `TaskRun.status` already supports A2A-aligned nonterminal `submitted` and
  `working` states; no enum or migration is required.
- `TaskRun.progressPayload` already carries structured approval and execution
  progress and can carry the bounded wait projection.
- `createAutonomousWorkRun` persists the exact agent, route, title, objective,
  prompt identity, thread/context, authority scope, token source, request digest,
  collaboration kind, risk class, and initiative-review binding.
- `TaskMessage` persists the original user prompt.
- `deterministicExternalTaskRunId` and the token-scoped lookup already enforce
  one durable row per token/request key.
- `markTaskRunWorking` is the canonical transition to `working`, including the
  heartbeat write required by source policy.
- `BI-MCP-EFF-0285909C` owns generic nonproduction capacity notification and
  reconciliation. BI-42 supplies the narrow callable resume behavior and does
  not duplicate that queue.

## 6. Options and kernel decision

`principle_decide` ledger `DI-A76E92CF4EEE` selected
`submitted-cas-resume` with high confidence (composite `3.5528`, margin
`2.4875`), no blocker, and no commandment conflict.

| Option | Result |
|---|---|
| Existing `submitted` state + typed wait + compare-and-set same-row resume | **Selected.** Smallest state surface, preserves immutable identity, and reuses the canonical heartbeat transition. |
| New `waiting-resource` status + global worker | Rejected. It expands schema/projections/watchdogs before the narrow failure is proven to need them. |
| Mark the first run terminal and create a linked successor | Rejected. It changes the immutable reviewer identity and makes a transient resource miss consume a governed request. |

## 7. State and data contract

### 7.1 Typed wait projection

For a resumable result, update the existing row atomically to:

```ts
{
  status: "submitted",
  completedAt: null,
  progressPayload: {
    summary: result.failure.message,
    riskClass,
    executedToolCount: 0,
    resourceWait: {
      schemaVersion: 1,
      kind: "provider-capacity",
      failureKind: "capacity" | "busy",
      resumeMode: "same-taskrun",
      attempt: number,
      observedAt: string,
    },
  },
}
```

The projection never contains a new request key, a successor TaskRun ID, raw
credentials, or caller-supplied authority. `attempt` is observability only; it
does not change the immutable request digest.

### 7.2 Resumability predicate

A result is resumable only when all are true:

1. `result.failure.kind` is exactly `capacity` or `busy`;
2. `result.executedTools.length === 0`;
3. the active row has not moved to `input-required` or another terminal state;
4. the stored token-scoped request digest equals the incoming digest.

No regular-expression inference from prose is allowed at this layer. The
structured dead-end classification is the authority.

### 7.3 Compare-and-set reservation

An exact replay may resume only a row whose status is `submitted` and whose
`progressPayload.resourceWait` satisfies the versioned contract. It reserves
execution with `updateMany` constrained by `taskRunId`, status, and `updatedAt`.
The winner calls `markTaskRunWorking` and runs the shared execution function.
The loser returns the latest row as an idempotent replay. This gives at-most-one
active inference attempt per observed wait generation without locks held across
provider I/O.

### 7.4 Same execution path

Extract the post-creation external execution body into a reusable function that
accepts the already parsed immutable request plus the existing TaskRun/thread
identity. Both first submission and same-row resume call it. The function must:

- resolve canonical authority attribution and legacy model-routing identity as
  it does today;
- attach and narrow the same exact tools from the same authority scope and
  `initiativeReviewBinding`;
- derive the same review effort warrant;
- write assistant messages and terminal state once;
- preserve the existing approval-envelope behavior;
- re-enter `submitted` resource wait only under the predicate above.

The refactor is behavior-preserving for all non-capacity outcomes.

## 8. Recovery entry points

The immediate entry point is an exact `tasks/submit` replay with the same token,
request key, and packet. This makes recovery usable without waiting for the
generic event project.

The extracted same-row resumer is also exported behind a narrow contract for
`BI-MCP-EFF-0285909C`: given a TaskRun ID and a capacity-change occurrence, it
loads the server-owned immutable request, performs the same compare-and-set,
and invokes the same execution path. BI-42 does not implement polling, a new
queue, or provider score mutation.

If reconstruction cannot prove every required immutable field, the resumer
returns a terminally non-mutating refusal and leaves the row submitted. It does
not create a successor or guess missing bindings.

## 9. Failure semantics

| Outcome | TaskRun result |
|---|---|
| `capacity` or `busy`, zero tools | `submitted`; typed resource wait; resumable same row |
| `capacity` or `busy`, one or more tools | Terminal failure; never replay possible side effects |
| credentials, policy/capability, context, model missing, unknown | Terminal failure with existing actionable message |
| governed writer proposes approval | Existing `input-required` path |
| approved envelope replay | Existing exact-tool approval resume path |
| successful loop | `completed` |
| thrown execution error | `failed` |
| digest mismatch | Existing `idempotency_conflict`; no mutation |

Capacity is not success, but neither is it a product/configuration failure. The
status projection and returned result must say that the TaskRun is waiting and
can resume, without implying a receipt or approval exists.

## 10. Security and governance

- No identity churn: the token namespace, request key, digest, and TaskRun ID
  remain fixed.
- No authority reconstruction from caller additions: replay must match the
  original digest and uses the stored packet/binding.
- No grant or model-policy expansion: provider eligibility, confidentiality,
  tool grants, subject/organization checks, and writer authority are unchanged.
- No side-effect replay: any tool execution makes the result terminal.
- No fabricated evidence: only persisted governed writer executions can create
  initiative receipts.
- No self-review: independent reviewer selection and initiative-readiness gates
  remain unchanged.

## 11. Scalability and observability

The repair performs one compare-and-set and one provider attempt per genuine
resume occurrence. Waiting rows consume no process, lease, GPU, or database
transaction. Existing token/request uniqueness bounds cardinality.

The `resourceWait` payload provides stable dimensions for metrics and UI:
failure kind, attempt, observed time, and same-row resume mode. Logs must include
TaskRun ID and failure kind but never bearer credentials or full sensitive
prompts. A later capacity reconciler can query only versioned resource waits
rather than scanning prose.

## 12. Delivery slices and acceptance trace

| Slice | Acceptance evidence |
|---|---|
| Classification | Unit tests show only structured `capacity`/`busy` with zero tools become resumable. |
| Durable wait | Unit test asserts `submitted`, `completedAt: null`, versioned `resourceWait`, and unchanged metadata. |
| Exact replay | Unit test submits the same packet against a waiting row, wins CAS, and executes on the original TaskRun/thread. |
| Concurrency | Unit test makes CAS lose and proves no second inference runs. |
| Terminal safety | Table-driven tests cover credentials, policy, context, missing model, unknown, post-tool failure, and digest conflict. |
| Approval compatibility | Existing approved-envelope and `input-required` tests remain green. |
| Event seam | Unit test loads a waiting external run and proves an event caller can invoke the same reservation without a new key or TaskRun. |
| Live proof | One previously capacity-blocked governed reviewer resumes the same TaskRun after a genuine provider-capacity change and persists the required reader/writer executions and receipt. |

## 13. Planned source boundary

Expected implementation paths:

- `apps/web/lib/mcp-task-submit.ts`
- `apps/web/lib/mcp-task-submit.test.ts`
- one narrowly named external TaskRun resume helper and test only if extraction
  keeps `mcp-task-submit.ts` within repository module-size guidance
- generated documentation index after the canonical design and plan land

No Prisma schema/migration, UI route, provider compiler, model score, reviewer
floor, readiness policy, or initiative writer changes are in scope.

## 14. Verification and rollback

1. Observe the focused red cases before production code changes.
2. Run focused Vitest for `mcp-task-submit` and any extracted helper.
3. Run web typecheck and relevant source-policy/derived-doc guards.
4. Perform architecture and blast-radius review of the stable committed tree.
5. Obtain an independent exact-tree semantic PASS before pregate/publication.
6. Run preflight and the governed exact-tree local integration CI once on the
   final SHA, then DCO PR health and protected merge.
7. Publish/deploy through the normal immutable release path, then prove same-run
   live recovery without reusing any consumed historical key.

Rollback is a normal revert of the source commit. Waiting rows remain valid
`submitted` TaskRuns and are safe to inspect; rollback must not mark them
completed or manufacture successor attempts.

