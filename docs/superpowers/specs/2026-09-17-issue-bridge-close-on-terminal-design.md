---
status: active
---

# Issue bridge: close the upstream mirror on terminal transition

**BI:** `BI-AE9FCB4C`  
**Parent contract:** [Pseudonymous identity and backlog issue bridge](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md)  
**Related:** [Feedback resolution closure contract](2026-05-26-feedback-resolution-closure-design.md) (draft) owns the wider `PlatformIssueReport` closure ledger; this design covers only the `BacklogItem` / `Epic` mirror and adds no closure state of its own.

## Problem and scope

The hive issue bridge writes in one direction. `escalateToUpstreamIssue` files
the GitHub issue and stamps `upstreamIssueNumber` / `upstreamSyncedAt` on the
`BacklogItem` or `Epic`; nothing reads the stamp back when the item reaches
`done` or `retired`, and the forge adapter has no close operation at all. On
2026-09-17 the hive repository carried 54 open `hive:submitted` mirrors, nine of
them for items retired or done for weeks. The public issue list misstates the
platform's state and every burn-down regrows.

In scope: a close operation on the forge adapter; an idempotent close-on-terminal
function in the bridge; dispatch from the two governed terminal writers; a
periodic sweep as the safety net. Out of scope: deferred items (their mirror
stays open on purpose), the relay transport (a consumer install with no token
has no credential to close with), and any new table, tool, or migration.

## Objectives

- **OBJ-BRIDGE-CLOSE:** A `done` or `retired` item whose mirror exists is closed
  upstream with its resolution as a comment and the matching GitHub reason
  (`completed` for done, `not_planned` for retired).
- **OBJ-BRIDGE-IDEMPOTENT:** Re-running the close never duplicates a comment
  and never re-patches a closed issue; a reopened item is never re-closed.
- **OBJ-BRIDGE-NONFATAL:** No upstream failure changes a local transition; a
  miss stays a candidate and drains on the next sweep.

## Design (ordered deliverables)

1. **Forge adapter** — `GitHubForgeAdapter.closeIssue({ number, comment, reason })`:
   GET the issue; if already closed return `already-closed` without further
   calls; otherwise POST the comment (when given) then PATCH
   `state: closed, state_reason`. Failures classify through the existing
   `classifyGitHubFailure`. Types `CloseIssueInput` / `CloseIssueResult` join
   `forge/types.ts`.
2. **Bridge** — `closeUpstreamIssueForTerminal({ kind, id })` loads the row,
   applies `isUpstreamClosureCandidate` (terminal status, mirror present,
   `completedAt` set, `upstreamSyncedAt` older than `completedAt`), resolves the
   upstream target exactly as escalation does (contribution mode, remote URL,
   hive token), calls the adapter, and stamps `upstreamSyncedAt` on success.
   The comment is built by `buildClosureComment`, redacted like every other
   outbound string. `closeUpstreamIssueInBackground` is the fire-and-forget
   wrapper for transition paths.
3. **Dispatch** — the MCP terminal adapter (`mcp-terminal-status.ts`) dispatches
   the item's close after `done` commits, and the epic's when the epic
   auto-closed; the backlog pack's status writer dispatches after `retired`
   commits.
4. **Sweep** — `sweepUpstreamIssueClosures()` lists terminal rows with a mirror
   and runs the same function over the candidates (bounded per run, stops on the
   first install-wide skip). `instrumentation.ts` runs it at boot and every 20
   minutes beside the other reconcile nets.

The candidate filter is the idempotency key: escalation stamps the sync time
before completion, a successful close stamps it after, so a closed mirror stops
being a candidate and a reopened item (`completedAt` cleared by the writer) is
never one. Rows retired before `completedAt` was recorded are not candidates;
none of them carry a mirror on the reference install.

## Research and architecture grounding

Confirmed in code at `ad92bd689c`: `issue-bridge.ts` has only `escalateToUpstreamIssue`
and `recordEscalation`; `github-adapter.ts` has only `createIssue`; no caller
reads `upstreamIssueNumber`. Live DB on the reference install: 833 done and 309
retired items, none carrying a mirror (the 2026-08-23 mirrors were filed from a
prior install), which is why the fix must also run as a sweep and not only on
the transition. Reuses the adapter, the identity/redaction helpers, the
contribution-mode gate and the reconcile-net pattern in `instrumentation.ts`.
Adds no table, tool, grant, or migration.

## Acceptance

| Acceptance ID | Objective IDs | Required outcome |
|---|---|---|
| AC-BRIDGE-001 | OBJ-BRIDGE-CLOSE | Closing a retired item comments with the redacted resolution, then closes with `not_planned`; a done item closes with `completed`. |
| AC-BRIDGE-002 | OBJ-BRIDGE-IDEMPOTENT | An already-closed issue produces one GET and no comment or patch. |
| AC-BRIDGE-003 | OBJ-BRIDGE-IDEMPOTENT | A row synced after `completedAt`, a deferred row, or a row without a mirror is skipped without a network call. |
| AC-BRIDGE-004 | OBJ-BRIDGE-NONFATAL | A GitHub failure returns `failed`, leaves `upstreamSyncedAt` untouched, and the transition result is unchanged. |
| AC-BRIDGE-005 | OBJ-BRIDGE-CLOSE, OBJ-BRIDGE-NONFATAL | The sweep closes every candidate it can and reports closed/failed/skipped counts; a private install stops after one skip. |

## Verification

Vitest: `lib/forge/github-adapter.test.ts` (adapter), `lib/build/issue-bridge.test.ts`
(candidate filter, comment, close, sweep), plus the existing terminal-status,
backlog-pack and instrumentation suites unchanged. Web typecheck and lint.
UI and migration are not applicable: no route, component, schema or seed changes.
