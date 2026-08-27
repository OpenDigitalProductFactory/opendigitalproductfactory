---
status: active
title: Resumable external TaskRun capacity implementation plan
---

# Resumable external TaskRun capacity implementation plan

**Backlog item:** `BI-42CE2CE7`  
**Epic:** `EP-56AE0F69`  
**Workroom:** `WC-5A2685AD`  
**Design:** `docs/superpowers/specs/2026-08-26-resumable-external-taskrun-capacity-design.md`  
**Decision:** `DI-A76E92CF4EEE`

## 1. Delivery shape

This plan is one atomic deliverable. The durable wait projection, same-row
compare-and-set reservation, shared execution path, and event-callable resume
seam change one idempotency contract. Shipping any subset would either leave a
provider-capacity result terminal or permit a replay without the concurrency
and authority guarantees that make it safe.

### Requirements

- `REQ-RESUME-001`: A structured `capacity` or `busy` result before any tool
  execution leaves the existing external TaskRun nonterminal and auditable.
- `REQ-RESUME-002`: Exact replay preserves the token namespace, request key,
  request digest, TaskRun ID, thread, authority scope, and immutable initiative
  review binding.
- `REQ-RESUME-003`: One compare-and-set winner may resume inference; concurrent
  callers observe the same run and do not start duplicate inference.
- `REQ-RESUME-004`: Capacity-event recovery can invoke the same server-owned
  resumer without reconstructing authority from caller input.
- `REQ-RESUME-005`: Credentials, policy, context, missing-model, unknown,
  post-tool, approval, digest-conflict, and completed outcomes retain their
  current fail-closed or idempotent semantics.
- `REQ-RESUME-006`: A successful resumed reviewer execution persists its
  governed reader/writer ToolExecutions and receipt normally.

### Contracts

- `CONTRACT-WAIT-V1`: `progressPayload.resourceWait` is a versioned,
  non-sensitive projection with failure kind, attempt, observation time, and
  `same-taskrun` resume mode; status remains `submitted` and `completedAt`
  remains null.
- `CONTRACT-RESUME-CAS`: A resume reservation is conditional on TaskRun ID,
  `submitted` status, the observed row version, a valid wait payload, and an
  equal stored request digest.
- `CONTRACT-STORED-AUTHORITY`: Resume uses the original persisted TaskMessage,
  route metadata, authority scope, initiating/canonical agent identities, and
  initiative review binding. Callers cannot add or widen them.
- `CONTRACT-NO-SIDE-EFFECT-REPLAY`: Any prior tool execution makes the result
  terminal; approval-envelope replay remains solely on the existing
  `input-required` path.
- `CONTRACT-TERMINAL-HONESTY`: Only typed pre-tool `capacity` and `busy`
  outcomes wait. Other failures remain terminal and preserve their actionable
  diagnostics.

### Flows

- `FLOW-FIRST-WAIT`: Submit immutable packet -> create deterministic TaskRun ->
  reserve working -> route/infer -> receive typed pre-tool capacity result ->
  persist `submitted` resource wait -> return same TaskRun as resumable.
- `FLOW-EXACT-REPLAY`: Replay identical token/key/body -> validate digest and
  wait payload -> CAS reserve -> mark working/heartbeat -> execute shared path
  -> persist approval, completion, terminal failure, or another wait.
- `FLOW-CONCURRENT-REPLAY`: Two exact replays observe one wait generation ->
  one CAS wins -> loser reads and returns the latest same TaskRun -> one
  inference attempt exists.
- `FLOW-CAPACITY-EVENT`: Trusted capacity reconciler supplies TaskRun identity
  -> server loads immutable request state -> invokes the same reservation -> no
  successor TaskRun or new request key.
- `FLOW-TERMINAL`: Non-resumable failure or post-tool capacity -> persist the
  existing terminal projection -> later exact replay is read-only/idempotent.

### Verification

- `VERIFY-CLASSIFIER`: Table-driven tests prove only typed `capacity`/`busy`
  with zero tools enter the wait projection.
- `VERIFY-WAIT`: Tests assert `submitted`, null `completedAt`, the versioned
  resource-wait payload, unchanged identity metadata, and an honest response.
- `VERIFY-REPLAY`: Tests prove an exact replay resumes the original TaskRun and
  thread without creating a second row.
- `VERIFY-CAS`: A losing concurrent replay performs no provider call and
  returns the latest original row.
- `VERIFY-AUTHORITY`: Tests prove replay uses stored authority/review binding
  and rejects missing or mismatched immutable state.
- `VERIFY-TERMINAL`: Existing and new matrix cases cover credentials, policy,
  context, missing model, unknown, post-tool failure, approval, digest conflict,
  and completed replay.
- `VERIFY-EVENT-SEAM`: A trusted server-side capacity occurrence invokes the
  same resumer and cannot supply replacement authority.
- `VERIFY-LIVE`: After protected release, one historical capacity-blocked
  governed review resumes the same TaskRun and writes genuine reader/writer
  executions plus its receipt.

## 2. Atomic deliverable mapping

| Deliverable | Backlog mapping | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|---|
| `DELIV-RESUMABLE-EXTERNAL-TASKRUN` — preserve and resume one immutable external TaskRun across transient pre-inference capacity | `BI-42CE2CE7` | `REQ-RESUME-001` through `REQ-RESUME-006` | `CONTRACT-WAIT-V1`, `CONTRACT-RESUME-CAS`, `CONTRACT-STORED-AUTHORITY`, `CONTRACT-NO-SIDE-EFFECT-REPLAY`, `CONTRACT-TERMINAL-HONESTY` | `FLOW-FIRST-WAIT`, `FLOW-EXACT-REPLAY`, `FLOW-CONCURRENT-REPLAY`, `FLOW-CAPACITY-EVENT`, `FLOW-TERMINAL` | `VERIFY-CLASSIFIER`, `VERIFY-WAIT`, `VERIFY-REPLAY`, `VERIFY-CAS`, `VERIFY-AUTHORITY`, `VERIFY-TERMINAL`, `VERIFY-EVENT-SEAM`, `VERIFY-LIVE` |

## 3. Test-first implementation sequence

### Task 1: Lock the wait classification and durable projection

**Files:**

- Modify `apps/web/lib/mcp-task-submit.test.ts`
- Modify `apps/web/lib/mcp-task-submit.ts`
- Optionally add one narrowly named helper/test pair under `apps/web/lib/` if
  extraction is required by module-size guidance

1. Add failing tests for typed `capacity` and `busy` with zero tools.
2. Add table-driven red cases proving other dead ends and any post-tool result
   remain terminal.
3. Implement the smallest typed predicate and versioned resource-wait payload.
4. Persist waiting rows as `submitted` with no completion timestamp.
5. Run the focused Vitest file and keep existing approval tests green.

### Task 2: Extract one reusable external execution path

1. Add a failing test showing first submission and resume use one execution
   function with the original TaskRun/thread/authority context.
2. Extract the current post-creation body without changing tool narrowing,
   routing identity, effort warrant, message writes, or approval behavior.
3. Keep all non-capacity outcomes byte-for-byte equivalent where practical.
4. Run focused tests after each refactor step.

### Task 3: Add exact replay reservation

1. Add a failing same-token/key/digest replay test for a waiting row.
2. Add a concurrent replay test where one conditional update loses.
3. Implement the `submitted` + wait-payload + observed-version CAS.
4. Make the winner mark the original run working and invoke the shared path;
   make the loser return the latest row without inference.
5. Prove digest conflict and ordinary terminal replay remain unchanged.

### Task 4: Expose the trusted capacity-event seam

1. Add a failing test that resumes by TaskRun ID using only server-loaded
   immutable state.
2. Implement a narrow exported resumer that accepts no replacement packet,
   grants, agent identity, or review binding.
3. Return a non-mutating refusal when stored state is incomplete or not a valid
   wait generation.
4. Leave scheduling, polling, and notifications to `BI-MCP-EFF-0285909C`.

### Task 5: Verify architecture and blast radius

1. Trace every production caller of `submitRemoteCoworkerTask`, the extracted
   execution helper, TaskRun status projections, and the external coworker
   adapter.
2. Run the focused TaskRun tests, web typecheck, source-policy guards, and
   derived doc-index checks.
3. Verify no schema, migration, UI route, provider score, model floor, tool
   grant, or initiative writer changed.
4. Obtain architecture/blast evidence and an independent exact-tree semantic
   PASS on the stable commit.

### Task 6: Ship and prove the same-run recovery

1. Run preflight, then one governed exact-tree local integration CI gate.
2. Publish a DCO-signed branch and PR; read bot findings and PR health.
3. Enter protected merge and publish one official immutable release.
4. Coordinate one governed live upgrade with the canonical verifier.
5. Resume a preserved provider-capacity TaskRun through the server contract and
   prove the TaskRun ID is unchanged and governed reader/writer executions plus
   a receipt are persisted.
6. Notify the dependent WordPress task only after live same-run proof.

## 4. Scope and rollback

The implementation is limited to the external MCP TaskRun submission/resume
seam, its focused tests, and these governed artifacts. It does not modify the
installed runtime, WordPress source, readiness policy, reviewer routing,
provider eligibility, or lease scheduling.

Rollback is a normal revert of the source commit. Existing waiting TaskRuns
remain valid submitted records for inspection; rollback must not mark them
completed, delete audit data, or manufacture successor requests.
