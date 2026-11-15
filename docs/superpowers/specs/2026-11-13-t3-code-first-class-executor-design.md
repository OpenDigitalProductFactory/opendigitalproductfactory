---
status: draft
---

# T3 Code as a first-class delivery executor

**Backlog:** BI-53BED66C (epic EP-INPLATFORM-CODING, before milestone M2). **Workroom:** WC-9BB70CAA.
**Absorbs:** BI-E1020AAE (adopt-then-claim leaves an unclaimable room).
**Evidence:** [T3 runtime trial](../research/2026-11-12-t3-code-runtime-trial.md) (BI-4DE79C8D, PR #7018); trial PR #7011 (BI-EF5E89A5, room WC-1920C35F).
**Builds on:** [bounded workroom handoffs](2026-10-15-bounded-workroom-handoffs-design.md) (BI-5366EF78, BI-F1FC0B62 / PR #6902), own-room takeover (BI-1986D3C1 / PR #7022), [executor takeover](2026-10-21-executor-takeover-design.md) checkpoints, the subscription estimator (BI-F98BBE4F / PR #7019), provider capacity status (`ProviderCapacityStatus`).

Owner direction (Mark, 2026-11-13): "continue till we are properly amalgamated." Standing rulings: routine actions within one owner and scope never reach his inbox, and same-owner, same-scope handover is propose then acknowledge, with no human step.

## Problem

The M1 trial carried a delivery-small item from claim to a gated PR, but the PR has not merged. The causes were all in DPF, not in T3. Read again on 2026-11-13 from code and production rows (read-only), they are:

| # | Gap | Root cause (source on `6b934ef5`) |
|---|---|---|
| G1 | Gate evidence never reached the review | The gate records the client thread id (`scripts/lib/agent-identity.mjs`, `CODEX_THREAD_ID`). The claim stored the agent's descriptive `sessionRef`. `findLocalCiEvidenceWorkroom` (`apps/web/lib/nonprod/local-ci-evidence-workroom.ts`) matches only on `executorRef`, so the row was saved unlinked and `resolveEvidenceByIds` (`apps/web/lib/change-review/failure-analysis-evidence.ts`) could not see it. The bind helper (`scripts/lib/workroom-bind.mjs`) reads neither `CODEX_THREAD_ID` nor what the gate reads, and the gate ignores `DPF_SESSION_REF`. |
| G1b | Adopt-then-claim leaves an unclaimable room (BI-E1020AAE) | `planLiveCapsuleBinding` (`work-capsule-branch-identity.ts`) late-binds a null backlog item or session but never a null `executorKind`, so the claim's readback differs and is refused `CAPSULE_IDENTITY_MISMATCH`. |
| G2a | A same-owner handover asked the owner (envelope `cmwfdcrs400580ep4k6we4wux`) | The room's lapsed lease was held by the platform's Software Engineer coworker (`cmqh8yf7…`, `Principal.kind = agent`), which the room's drive had dispatched for the reproduce stage. `snapshotHandoff` refuses a lapsed lease unless the holder is the owner (`bounded-handoff-authority.ts:84`), and `assertRequestedSource` and `own-room-takeover.ts:43` do the same. A refusal becomes the `authority` consequence (`bounded-handoff-tool.ts:56-61`), which mints an envelope. |
| G2b | An approved envelope could not execute (`cmweiy4zf00op0eqlz0xpctw0`) | The approved call had no `commandId`. Before #7022 a malformed phase call minted an envelope instead of being refused. Approval also never helps a phase call: the re-run repeats the same `assessBoundedHandoff`, so any refusal recurs (the second envelope's approved run failed again with `handoff-lease-expired`). |
| G3 | Codex ran out of plan usage and the item stalled silently | DPF already knows: `ProviderCapacityStatus` for `codex` and `chatgpt` reads `quota_resets_at`, retry 2026-11-17 03:54 UTC (Mon 16 Nov, 9:54 PM Central). Nothing connects that to the room. Liveness (`liveness.ts`) can only say "a token-limited session may return", and after its fixed 24 h grace it reads the room as `lease-expired` and reapable, three days before the plan resets. |
| G4 | No governed merge route for an unattended coworker | `pnpm land` queues with `gh pr merge --auto`. The owner's Codex rules make that a prompt, and T3 runs Codex unattended, so it is refused. No MCP tool queues a workroom's PR; server-side auto-merge exists only for Build Studio builds and assurance remediation (`enablePullRequestAutoMerge`, `github-pr-readiness.ts`). |
| G5 | DPF cannot say the work runs in T3 | `providerToExecutorKind("t3")` returns `human`. |

## Research

| Comparable | What it does | DPF adopts | DPF rejects |
|---|---|---|---|
| GitHub Actions runners: `runner.name` plus labels | A job records the machine that ran it separately from the workflow identity that authorizes it | The authenticated client surface stays the executor kind; the orchestrating harness is a separate, descriptive label | Making the harness an authority identity |
| Kubernetes leases and the node lifecycle controller | A lapsed lease held by a controller-owned pod is reclaimable by the controller's owner; a lapsed lease held by another tenant is not | A lapsed lease held by a platform coworker leaves nobody else holding the room | Reclaiming a person's lapsed lease without their acknowledgement |
| GitHub auto-merge with `expectedHeadOid`, Bors and Mergify queues | Enqueue is a separate, idempotent step guarded by the reviewed head SHA | A workroom-scoped "queue this PR" step guarded by the room's head and its bound passing gate | Merging directly and bypassing required checks |
| HTTP 429 with `Retry-After` (RFC 9110 §10.2.3), Codex `rateLimits.resetsAt` | The server states when to come back; clients wait to that time, not on a fixed backoff | The room waits until the provider's stated reset and says so, then is offered to an unblocked executor | A fixed grace that ignores a known reset |

Standard followed for identity: OpenTelemetry's resource versus instrumentation scope split. `service.instance.id` (the thread) identifies the instance, and the harness is an attribute. It does not change who is authenticated.

## Design

### D1. One session identity, bound wherever it is spelled (G1, G1b)

1. **The bind names the session the gate records.** `workroom-bind.mjs` reads `CODEX_THREAD_ID` before `CODEX_SESSION_ID` (and `GROK_THREAD_ID`), as `agent-identity.mjs` already does for the gate. The gate does not read `DPF_SESSION_REF`: a value inherited from a parent shell would override the real thread (review finding), and step 2 covers a descriptive claim name anyway.
2. **The server binds by proof, not by spelling.** When no room matches the gate's session on the gated branch, `findLocalCiEvidenceWorkroom` falls back to the single live room on that branch where all of these hold:
   - the room's head is exactly the gated commit;
   - the room's owner, lease holder, creator or requester is the same human principal as the authenticated gate caller.
   Two or more such rooms stay unlinked ("ambiguous"); they are never guessed. The match records how it was made (`attribution: "same-owner-exact-head"`). Attribution still grants no review authority: the failure-analysis resolver re-checks the head, the status, the validity window and the content as today.
3. **A claim on an existing room fills a missing executor kind.** `planLiveCapsuleBinding` late-binds `executorKind` when the room has none and the claiming session is the room's session or the room has none. A room that already has a kind is never rewritten here; that stays the handover's job.

### D2. Same-owner handover never needs the owner (G2a, G2b)

1. **A lapsed coworker lease is not another holder.** One predicate, `lapsedLeaseLeavesRoomUnheld(room, holderKind, now)`. It is true when the lease has expired and the holder is the owner, or is a principal of kind `agent` (a platform coworker). `snapshotHandoff`, `assertRequestedSource` and the own-room takeover use it. The holder's kind is read inside the handoff's locked transaction (`FOR SHARE` on the principal row). A live coworker lease still refuses. A person other than the owner, live or lapsed, still refuses.
2. **A refused phase call is refused, not escalated.** `boundedHandoffConsequenceForCall` returns no consequence for a `BoundedHandoffRefusal` on a phase call, so the handler returns the refusal with its code and next action. Only an unverifiable boundary (not a refusal) stays `authority`. No envelope is minted that an approval could not execute.
3. Everything else stays gated, as #6902 and #7022 left it: another owner, another mandate, an unadmitted receiver, a build-linked, native-task, restricted or archived room, and personal-access-token callers.

### D3. A plan-limited executor waits visibly or is routed (G3)

1. **Server-side detection, no client needed.** A new module `executor-capacity.ts` maps an executor kind to the provider ids that serve it: `codex-desktop` to `codex` and `chatgpt`; `claude-desktop` to `anthropic-sub` and `anthropic`; `grok-desktop` to `xai`. It reads `ProviderCapacityStatus` rows in `quota_resets_at` or `rate_limited` with a future `retryAt`, and returns the latest reset.
2. **The executor can say so too.** `heartbeat_workroom`'s checkpoint gains an optional `capacity` (`{ provider, resetAt, note }`). A session that sees its plan warning, or the harness coordinating it, records it before it stops. This is an accelerator: the platform read in step 1 works without it.
3. **Liveness tells the truth.** `classifyWorkCapsuleLiveness` takes an optional `capacityWait: { resetAt, provider, alternatives }`. When the lease has lapsed and a reset is known in the future, the room reads `paused` with the reason "Codex plan limit reached; resumes Mon 16 Nov, 9:54 PM Central". It is not reapable until the reset plus the normal grace; after the reset it reads "plan reset at …; waiting for the session to resume". `liveness-inventory.ts` fills `capacityWait` for listed rooms, and `get_workroom` returns it.
4. **Routing.** `alternatives` lists the owner's other executor surfaces whose providers are not blocked, in estimator cost order where an estimate exists (`subscriptionEstimateForProvider`), for example `claude-desktop` when Codex is blocked. Each entry carries the exact governed step: `reassign_workroom_executor` phase `request`, then acknowledgement by the receiver. Under D2 that needs no approval. In T3 the same thread can switch provider (T3 drives `codex` and `claudeAgent`). That is a new executor surface and session, so it uses the same handover.
5. **In-platform runtime.** The workroom runtime supervisor classifies a failed turn as a plan limit (`cli-result-errors` classifier). It then records the same checkpoint capacity, with the reset parsed by `parseAbsoluteResetAt` or read from `ProviderCapacityStatus`, instead of the bare "Turn failed". The supervisor merges that note into the existing checkpoint without renewing the lease, so the wait shows and the next executor keeps the prior next action and risks (review finding).

6. **A stated reset is an upper bound, not a promise.** Providers also reset early, on their own periodic schedule and at random (owner, 2026-11-13). On the day this was written, Codex was serving turns again while its row still said Monday. So:
   - a capacity row counts only while its `lastSuccessAt` is older than its `lastObservedAt`;
   - a checkpoint `capacity` is superseded by any later lease renewal or room activity from the executor;
   - a live lease always reads live, whatever the provider row says;
   - the room's text reads "expected back by …", says the existing hourly quota recheck (`subscription-quota-recovery.ts`) is watching, and never says the room *will* wait until then;
   - alternatives are offered at once rather than after the stated reset, and the room is never reaped while a future reset is recorded.

This does not weigh cost against latency for ordinary routing; that remains BI-BB620D03.

### D4. A coworker can queue its own gated PR (G4)

New MCP tool `queue_workroom_pull_request({ capsuleId, commandId })`, a receipted workroom tool:

- **Refuses unless:**
  - the room has a PR, and the PR's head is the room's `headSha`;
  - a passing, unexpired local-CI evidence row is bound to the room at that head;
  - the caller may act in the room.
- **Then:** it enables auto-merge (squash) through GitHub GraphQL with `expectedHeadOid` set to the room head. The merge queue still runs every required check.
- **Consequence:** `ordinary` for the room's own executor or owner. Any other caller is `authority`.
- **Record:** the room records `pr-queued`.

When `gh pr merge --auto` is refused, `pnpm land` (`scripts/land-branch.mjs`) names this tool as the next step. It does not call the tool itself: the script's credential is a personal access token, and such callers keep the owner's approval (#7022). The agent calls the tool through its own signed-in connector, as the room's executor.

### D5. T3 is named, not disguised (G5)

`claim_backlog_item_for_work` accepts an optional `harness` (closed set: `t3-code`). The room records it as `workspaceState.executorHarness`, and readback and `get_workroom` show it. The executor kind stays the authenticated client surface (`codex-desktop` when T3 drives Codex). That is what OAuth admission and the handoff surface map check, and changing it would break both. A provider string that names only a harness ("t3", "t3-code") is refused with `provider_harness_only`, which says to pass the model client as `provider` and the harness as `harness`, instead of silently becoming `human`.

The T3 brief in the delivery-surfaces runbook says:
- claim first with `provider: codex|claude`, `harness: t3-code` and `sessionRef` set to the client thread id;
- run the gate in the same thread;
- land with `pnpm land`.

## Objectives and acceptance

**OBJ-1:** A T3-run item reaches merge inside its workroom with no workaround. **OBJ-2:** No routine same-owner step reaches the owner. **OBJ-3:** A plan-limited executor never stalls silently.

- **AC-1** (OBJ-1): A gate run whose session id differs from the claim's `sessionRef` links to the caller's own room when that room is the only live room on the branch at exactly the gated head; with two such rooms it stays unlinked; another person's room is never linked.
- **AC-2** (OBJ-1): Adopt without an executor kind, then claim with one, succeeds and records the kind (BI-E1020AAE).
- **AC-3** (OBJ-1): The bind helper resolves a Codex thread to `CODEX_THREAD_ID`, the id the gate records.
- **AC-4** (OBJ-2): A same-owner two-step handover of a room whose lapsed lease is held by a platform coworker completes, request then acknowledgement, with no approval envelope; a live coworker lease and any lease held by another person still refuse.
- **AC-5** (OBJ-2): A phase handover call the handler would refuse returns that refusal and mints no envelope.
- **AC-6** (OBJ-3): A room whose lease lapsed while its executor's provider is quota-limited reads `paused`, names the provider and the reset time, is not reapable before the reset, and lists unblocked alternative executors with the handover step.
- **AC-6b** (OBJ-3): An early reset clears the wait: a capacity row whose last success is newer than its last limit observation, or a checkpoint capacity followed by a lease renewal, no longer holds the room as plan-limited.
- **AC-7** (OBJ-3): A checkpoint `capacity` recorded by the executor is shown the same way, and a malformed one is refused without renewing the lease.
- **AC-8** (OBJ-1): `queue_workroom_pull_request` enables auto-merge only for a PR whose head equals the room head with passing bound gate evidence, and refuses otherwise with a typed reason.
- **AC-9** (OBJ-1): A claim with `harness: t3-code` records and shows the harness; `provider: "t3"` is refused with `provider_harness_only`.
- **AC-10** (OBJ-1, OBJ-2): After deployment, a delivery-small item is delivered end to end by T3 inside its workroom with zero owner approvals.

## Compatibility and rollback

- No schema migration: harness, capacity and checkpoint data live in `workspaceState` JSON, which the existing readers ignore when absent.
- Every change is additive or narrows a refusal to the stated same-owner cases. Reverting the PR restores today's behaviour; no data needs repair.
- Rooms already linked to evidence are untouched; the fallback only applies to rows that would otherwise be unlinked.

## Out of scope

- Cost-and-latency routing for ordinary calls (BI-BB620D03).
- Portal-run official clients and their sandbox posture (BI-2E63DEC7, E4).
- The workroom-bound toolset that replaces T3's full-access shell (BI-3E2B7A96, M2 first slice).
- T3's own worktree location. The runbook brief points T3 at `~/dpf-worktrees`; T3's default is its own setting.
- Closing the trial's leftover rooms WC-AA3A9FFF and WC-BFC8C53D. That is an operational step, recorded on BI-4DE79C8D.
