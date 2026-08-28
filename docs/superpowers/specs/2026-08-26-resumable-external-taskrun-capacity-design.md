---
status: active
title: Resumable external TaskRuns after transient pre-inference capacity
---

# Resumable external TaskRuns after transient pre-inference capacity

**Backlog item:** `BI-42CE2CE7`  
**Epic:** `EP-56AE0F69`  
**Workroom:** `WC-5A2685AD`

## Decision

An immutable external reviewer request must not be consumed when every eligible
provider is busy before inference. Today that zero-tool result completes the
deterministic `TaskRun`; the same key only reads it and a new key changes review
identity.

Keep that exact row in the existing nonterminal `submitted` state, record a
versioned resource-wait projection in `progressPayload`, and let an exact replay
compare-and-set reserve the row before invoking the same execution path. The
token namespace, request key, digest, TaskRun/thread IDs, authority scope,
initiative-review binding, tools, model floors, and audit attribution remain
unchanged. No schema, global queue, provider exception, or successor TaskRun is
introduced. Kernel decision `DI-A76E92CF4EEE` selected this design with high
confidence and no commandment conflict.

## Evidence and existing substrate

WordPress and BI-47 runs reached healthy eligible endpoints but completed before
inference with zero tools and no receipt. `agentic-loop.ts` already classifies
structured `capacity`/`busy`; `mcp-task-submit.ts` currently completes every
returned result. Existing `submitted`/`working`, `progressPayload`,
`TaskMessage`, A2A metadata, and `markTaskRunWorking` provide the required state,
request, and heartbeat substrate. `BI-MCP-EFF-0285909C` remains owner of any
generic capacity notification service.

An unpublished artifact review must run from a governed standalone source
clone whose Git object store is inside the mounted preview. A host worktree
whose `.git` file points outside the container must fail closed and is not a
source-backed review surface.

TaskRun resumption is deliberately scoped to one durable database identity.
Replacing a nonproduction database from a sanitized clone is not a resume
operation: the original TaskRun, digest, approval envelope, and tool executions
must still exist before the server may continue them. A missing row fails
closed. Operators must keep one governed preview/database alive across an
approval-and-resume sequence; they must never recreate a consumed request key
after a preview refresh and call the replacement the same review.

## State contract

A result is resumable only when all are true:

1. `result.failure.kind` is exactly `capacity` or `busy`;
2. `result.executedTools.length === 0`;
3. the row has not moved to `input-required` or a terminal state; and
4. the stored token-scoped request digest equals the incoming digest.

The durable projection is:

```ts
{
  status: "submitted",
  completedAt: null,
  progressPayload: {
    summary,
    riskClass,
    executedToolCount: 0,
    resourceWait: {
      schemaVersion: 1,
      kind: "provider-capacity",
      failureKind: "capacity" | "busy",
      resumeMode: "same-taskrun",
      attempt,
      observedAt,
    },
  },
}
```

An exact replay may resume only this versioned waiting shape. It uses an
`updateMany` compare-and-set constrained by TaskRun ID, `submitted` status, and
the observed `updatedAt`. The winner calls `markTaskRunWorking` and executes the
stored request on the same TaskRun/thread; a loser returns the latest row and
does not invoke inference. Provider I/O occurs outside database transactions.

The shared execution function preserves authority attribution, legacy routing,
tool narrowing, effort warrant, approval behavior, messages, and terminal
writes. An event caller may resume by TaskRun ID only when server-owned state
reconstructs every immutable field; otherwise it leaves the row submitted.

## Fail-closed boundary

- `capacity`/`busy` with zero tools: submitted resource wait, same-row resume.
- `capacity`/`busy` after any tool: terminal; possible side effects never replay.
- credentials, policy, context, missing model, unknown, or thrown errors:
  terminal under current behavior.
- approval proposal: existing `input-required` path; approved-envelope replay is
  unchanged.
- missing original TaskRun, digest, approval envelope, or stored request after
  database replacement: fail closed; no successor identity is inferred.
- digest mismatch: existing `idempotency_conflict`, with no mutation.

Caller data cannot reconstruct authority. Only a governed writer can create a
receipt; prose or transport completion never does.

## Acceptance and delivery boundary

Tests prove the predicate and typed wait, exact identity reuse, one CAS winner,
no inference on loss, terminal handling for every other dead end and post-tool
capacity, approval compatibility, the missing-store boundary, and a
server-owned event seam. Live evidence must resume one blocked reviewer on the
same TaskRun and durable database without refreshing its preview store, then
persist its required reader/writer executions and receipt.

Expected source scope is `apps/web/lib/mcp-task-submit.ts`, its tests, and at
most one narrowly named resume helper/test if extraction is required for module
size. There is no Prisma migration, UI, model-score, reviewer-floor, readiness,
or writer change. Implementation follows red/green TDD, architecture and blast
review, exact-tree semantic PASS, preflight, governed local CI, DCO PR,
protected merge, immutable release, and live same-run verification. Rollback is
a normal revert; waiting rows remain `submitted` and are never replaced.
