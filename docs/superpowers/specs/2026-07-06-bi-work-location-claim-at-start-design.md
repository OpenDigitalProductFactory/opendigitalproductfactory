---
status: binding
---

# Claim-at-start BI ↔ work-location binding

- BI: BI-7D20BFDF
- Date: 2026-07-06

## Problem

A parallel agent could pick up a BacklogItem that another session was already
working on **directly** (outside Build Studio). The direct-build claim gate
(`triage_backlog_item` → status `in-progress` in `apps/web/lib/mcp-tools.ts`)
only fires when an agent flips the BI status through the governed tool. An
external contributor (Claude / Codex / Grok) that clones a worktree, cuts a
branch, and starts editing never touches that gate — so the BI still reads as
unclaimed. The result was two sessions independently building the same BI (the
EP-F7E35344 collision class), with no shared record tying the BI to *where* the
work is happening (which worktree, which branch, which session).

## Substrate

`WorkCapsule` (`packages/db/prisma/schema.prisma`) is the unified work-tracking
model. It already carries both `backlogItemId`/`epicId`/`featureBuildId` **and**
`repositoryFullName`/`headBranch`/`worktreePath`/`baseBranch`/`executorRef`. The
store (`apps/web/lib/work-capsules/work-capsule-store.ts`) has two creation
paths that had never been joined:

- `createWorkCapsule` — binds the BI/epic/build identity, **no** branch/worktree.
  Idempotent on `idempotencyKey`.
- `adoptWorktreeCapsule` — binds the location (`repositoryFullName` + `headBranch`
  + `worktreePath`), **no** BI. Idempotent on `(repositoryFullName, headBranch)`.

`BacklogItem` already has the claim fields (`claimStatus`, `claimedById`,
`claimedByAgentId`, `claimedAt`) and a 12h-stale / force-override convention in
`mcp-tools.ts`. No schema migration was needed — this work is purely optional
inputs + wiring over existing columns.

The "direct-agent gap" lived in
`apps/web/lib/work-capsules/external-session-capture.ts`:
`captureExternalSessionEvidence` recorded external work into a capsule but passed
**no** `backlogItemId`, so evidence never bound the BI.

## Design — soft claim-at-start

A single new store function, `claimBacklogItemWorkspace`, joins the two paths:

1. Resolve the `BacklogItem` (by `BI-*` id or cuid); throw if absent.
2. Call `adoptWorktreeCapsule` with the BI id + location + session. This creates
   the `(repo, branch)` capsule bound to the BI, or — critically — **late-binds**
   an existing branch capsule that was adopted before the BI was known
   (`backlogItemId == null` → set it, record a `WorkCapsuleActivity` note).
3. Stamp the `BacklogItem` claim (`claimStatus="active"` + claimant + `claimedAt`)
   following the existing 12h-stale convention — **unless** the BI already holds a
   FRESH (`< 12h`) active claim by a different agent/session, in which case the
   existing claim is **not** overwritten.

The claim is **advisory, not a lock**. Even when another session holds the BI
claim, the capsule for *this* location is still bound (so the work is tracked and
visible) and the caller gets non-blocking `conflict` metadata describing the
other active claim and any other in-flight locations. Multiple capsules per BI
(one per branch) are expected and are **not** a conflict — a conflict is
specifically (a) the BI already actively claimed by a different agent, or (b)
another non-archived capsule on the same BI on a different branch/session.

## WWMD kernel decision

Claim-at-start (soft) was weighed against a hard lock. Kernel outcome:
**claim-at-start won**, composite **6.07**, margin **0.32** (high). The hard-lock
option was rejected against the operator-friction commandments — a hard lock
would block a legitimate second branch or a founder taking over stalled work, and
would turn a coordination signal into a gate. The soft signal preserves the
existing force/stale override semantics already used on the direct-build path.

## API — `claim_backlog_item_for_work`

MCP tool in `apps/web/lib/mcp/packs/work-capsules-pack.ts`
(handler `claimBacklogItemForWorkTool` in
`apps/web/lib/work-capsules/mcp-handlers.ts`), grant `work_capsule_adopt`.

Params:

- `itemId` (required) — `BI-*`.
- `worktreePath` (required) — local worktree location.
- `branchName` (required) — head branch; the capsule is keyed on `(repo, branch)`.
- `repositoryFullName` (optional) — defaults to `DPF_REPO_FULL_NAME` env or the
  platform repo full name.
- `baseBranch` (optional) — defaults to `main`.
- `provider` (required) — mapped to an executor kind via `providerToExecutorKind`.
- `sessionRef` (required) — owner/session id, stored as the capsule `executorRef`.

Returns `{ capsuleId, backlogItemId, headBranch, worktreePath, claimed, conflict }`.
When `conflict` is present the human-readable message states the BI already has
active work elsewhere (branch/session listed) and that the call did **not** steal
the claim — the tool still returns success with the capsule bound.

## Evidence-gap closure

`captureExternalSessionEvidence` now accepts optional `backlogItemId`,
`worktreePath`, `branchName`, `repositoryFullName`, `baseBranch`, threaded from
new optional params on `record_external_development_evidence`. When
`worktreePath` + `branchName` are supplied it prefers the adopt path so the
capsule carries the location too; otherwise it binds the BI on the
`createWorkCapsule` path. All new params are optional — fully backward-compatible.

## Tests

`apps/web/lib/work-capsules/work-capsule-store.test.ts` covers: adopt persists
`backlogItemId`/`epicId`; late-bind on reuse (and the no-op when already bound);
claim stamps the BI; non-blocking conflict when the BI is freshly claimed by
another agent; stale (>12h) reclaim; a second capsule on a different branch for
the same BI without a blocking claim conflict; and idempotent branch reuse.

## 2026-08-31 hardening — single live owner by default

`BI-BFBF1BBB` supersedes only the soft-conflict portion of this design. Live
evidence showed that `get_backlog_item` could report no active build while a
different Workroom was already delivering the BI. The advisory response was
therefore too late: it created the duplicate Workroom before disclosing the
conflict.

WWMD decision `DI-ABFED7DDB995` selected **refuse by default with an audited
override** (composite 9.0006, margin 1.7066, high confidence). An absolute lock
was rejected because deliberate recovery and scoped co-delivery remain valid;
the old silent-success default was rejected because it makes duplicate effort
the normal path.

### Governed objectives

**OBJ-BIWO-001:** A normal claim against a BacklogItem with a different live
Workroom is refused before any second Workroom is created, bound, or used to
replace the canonical BI claim.

**OBJ-BIWO-002:** Claim admission remains race-safe and backward-compatible:
concurrent first claims produce one winner, the same Workroom/session replay is
idempotent, and terminal or genuinely dead Workrooms do not prevent reclaim.

**OBJ-BIWO-003:** Deliberate parallel delivery is an explicit audited exception
that requires both `force=true` and a non-empty reason identifying who
overrode which live ownership and why.

**OBJ-BIWO-004:** The canonical backlog-item read model and owner-facing backlog
row expose the same active Workroom ownership facts used by claim admission,
including Workroom link, status, executor, branch, and true liveness, without
displaying filesystem, session, principal, or lease internals by default.

The hardened contract is:

1. Lock the canonical `BacklogItem` row inside the existing governed claim
   transaction so two first claims cannot both observe an empty state.
2. Read every non-archived Workroom bound to the BI and classify it with the
   existing Workroom liveness contract. A live room on the same repository and
   branch is an idempotent readback; any other live room refuses the claim before
   adoption with `backlog_item_already_claimed`.
3. Permit a deliberate co-claim only with `force=true` and a non-empty
   `overrideReason`. Record the reason, actor, and displaced live Workroom
   summaries in `WorkroomActivity`.
4. Project all bound Workrooms, including their liveness verdicts, from
   `get_backlog_item`, so selection and claim use the same ownership facts.
5. Retain the legacy BI claim fields for compatibility, but do not use their
   12-hour age as the source of Workroom liveness.

No table, migration, new status vocabulary, or second liveness engine is added.
The source of truth remains `Workroom.backlogItemId` plus
`classifyWorkCapsuleLiveness`.

### Hardening acceptance mapping

| Acceptance ID | Objective IDs | Required evidence |
| --- | --- | --- |
| AC-BIWO-001 | OBJ-BIWO-001 | A different live Workroom returns `backlog_item_already_claimed`, and an immediate read proves no second Workroom or BI-claim mutation occurred. |
| AC-BIWO-002 | OBJ-BIWO-002 | Tests prove serialized concurrent claims, same-room idempotency, and reclaim after terminal or dead ownership. |
| AC-BIWO-003 | OBJ-BIWO-003 | Tests prove a missing override reason is refused and a reasoned override records actor, reason, and displaced Workroom summaries. |
| AC-BIWO-004 | OBJ-BIWO-004 | `get_backlog_item` and `/ops` show the canonical owner facts; desktop and narrow verification show no empty chrome, leaked internals, or horizontal overflow. |
| AC-BIWO-005 | OBJ-BIWO-001, OBJ-BIWO-002, OBJ-BIWO-003, OBJ-BIWO-004 | Focused tests, production build, PR/merge-group checks, exact-SHA live readiness, and canonical functional acceptance pass. |
