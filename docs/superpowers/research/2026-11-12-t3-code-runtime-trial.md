---
title: T3 Code runtime trial (M1)
date: 2026-11-12
status: recorded
backlogItem: BI-4DE79C8D
workroom: WC-CD5963F8
plan: ../plans/2026-11-04-in-platform-coding-coworker-readiness.md
---

# T3 Code runtime trial (BI-4DE79C8D)

This is the first time T3 Code was run against DPF. The 2026-09-04 review
([source delta review](../specs/2026-09-04-t3-code-source-delta-review.md)) only
read the code. Times are US Central, 12 November 2026.

## Result in one paragraph

T3 Code runs here and can carry a delivery-small item from claim to an open,
gated PR on the subscription. Run 2 did that inside one workroom: claim,
reproduction, test-first fix, 12 tests passing, shared local CI passing, DCO
commit, PR [#7011](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/7011).
**It has not merged.** Two blockers stop it, and neither is in T3. The Failure
Readiness review cannot find the gate result. The only governed fix is an
executor handover, and that waits on an owner approval. The merge-queue command is
refused by the owner's own Codex rules. The M1 go criterion ("completes one item
without leaving its workroom") is **not yet met**. Cost per item has a measured
estimate (below). All blockers found are platform-side, so this trial gives no
reason to switch harness. It does give a short list of things to fix before the
M2 pilot.

## Setup

- **Harness:** T3 Code (Beta) 0.1.9 desktop app, already installed on this Mac,
  driven headlessly with its own CLI (`t3 thread start | send | show`).
- **Provider and plan:** T3's `codex` provider, model `gpt-6.1-sol`, on the
  owner's ChatGPT subscription (Codex `auth_mode` chatgpt, plan type `promax`,
  one weekly usage window). The dpf MCP connector in Codex was already signed in.
- **Worktrees:** T3 created each one (`--worktree origin/main --branch …`) under
  `~/.t3/worktrees/dpf/`.
- **Supervision:** a Claude Code session started the threads, watched them, and
  sent operator notes. Every note is counted below as an intervention.

## Run 1: BI-17BBC2B8 (failed at claim)

Item: `list_workrooms view:atlas` ignores `decisionScope` and `status`.
10:27–10:32 PM, 5 agent turns, 2 minutes of agent time.

1. The agent called `adopt_worktree` and then `claim_backlog_item_for_work`
   (the order the claim hook's own message suggests). The adopt created room
   WC-AA3A9FFF with no executor kind and no base SHA. The implementation claim was
   refused `RESEARCH_REQUIRED`, which is correct for a fix. The design claim was
   refused `CAPSULE_IDENTITY_MISMATCH`. The claim derives `codex-desktop` from
   `provider`, but never writes it onto an existing room. Re-adopting does not
   change it either.
2. Four repair attempts, each prompted by an operator note: re-adopt with full
   identity (fixed the base SHA and lease, not the executor kind); claim without
   `provider` (refused, the parameter is required); create a replacement room
   WC-BFC8C53D on a new branch (refused `backlog_item_already_claimed` because the
   first room is still live); then `reassign_workroom_executor` on the first room,
   which returned `approval_required` (envelope `cmwehcipb0xqg0es5xsykw431`, to the
   owner, expires 19 Nov 10:31 PM).
3. The agent filed **BI-E1020AAE** (adopt-then-claim leaves a room nobody can
   claim). No source edits and no database writes. Stages 2–8 did not run.

Left behind: WC-AA3A9FFF (holds BI-17BBC2B8, unclaimable) and WC-BFC8C53D
(duplicate), both `ready`. BI-17BBC2B8 cannot be claimed by anyone until the
first room is fixed or closed.

## Run 2: BI-EF5E89A5 (PR open, not merged)

Item: Dependabot PR bodies fail the hidden-Unicode guard because of zero-width
spaces in @-mentions. The agent was told to claim first, with no adopt.
10:35–11:17 PM, workroom **WC-1920C35F** throughout.

| Stage | Central time | Result | Notes |
|---|---|---|---|
| 1 Claim | 10:35–10:37 | ok | Design claim first time; implementation admitted after the research receipt. One "continue" note needed: the agent ended its turn after the design claim. |
| 2 Research | 10:36–10:37 | ok | Reproduced on main; source and test receipts recorded. |
| 3 Change | 10:36–10:37 | ok | Test first. Exemption limited to U+200B directly after `@` in bodies authored by `dependabot[bot]` (author read from the event payload). 53 lines added, 2 removed, 2 files. |
| 4 Tests | 10:37–10:38 | ok | Managed dependency bootstrap, 12 affected tests pass. |
| 5 Gate | 10:37–11:05 | ok | `pnpm gate:wait` PASS on the committed head; 27 minutes, nearly all in shared local CI. |
| 6 Review | 10:37–11:17 | **blocked** | Self-review found nothing. The platform semantic review cannot resolve the gate evidence: the gate recorded T3's thread id as the session, and the room was claimed under a descriptive session name. Re-adopt was refused. The same-scope handover returned `approval_required` (envelope `cmweiy4zf00op0eqlz0xpctw0`, owner, expires 19 Nov 11:16 PM). Failure Readiness on the PR is red. |
| 7 PR | 11:05–11:11 | **partial** | PR #7011 open, non-draft, DCO-signed. `gh pr merge --squash --auto` refused by the owner's Codex rule (`gh pr merge` is `prompt` in `~/.codex/rules/dpf-routine.rules`; T3 runs Codex with approval policy "never", so a prompt becomes a refusal). |
| 8 Evidence | 11:07–11:16 | ok | Test, gate, PR link and blockers recorded on BI-EF5E89A5. Writes were refused about 3 minutes while the portal drained for an upgrade (`portal_quiescing`); the agent retried and succeeded. |

No stage was skipped. Stage 6 and the merge part of stage 7 are unrun, not
failed by the code.

## Measures

| Measure | Run 1 | Run 2 |
|---|---|---|
| Wall clock | 5 min | 42 min (27 in the gate) |
| Agent turn time | 2 min | 42 min |
| Input tokens (cached) | 1.77M (1.69M) | 27.18M (26.98M) |
| Output tokens (of which reasoning) | 4,952 (66) | 27,495 (4,577) |
| Plan capacity, weekly window | under 1 point (88% → 88%) | 3 points (89% → 92%) |
| API list-price equivalent | about $0.38 | about $3.36 |
| Operator interventions | 4 notes | 3 notes |
| Approvals that reached the owner | 1 | 1 |
| Stages skipped | 0 | 0 |

How the numbers were taken:

- Token counts are T3's own per-turn records (`turnTokenUsage` in its state
  database). Plan capacity is the `used_percent` Codex reports for the weekly
  window, at whole-percent resolution. The window resets Monday 16 November,
  9:54 PM. It was already 83% used before the trial. The 88% → 92% span also
  includes one small Codex call made to claim BI-4DE79C8D, and any other use of
  the account in that hour.
- The dollar figure prices the tokens at the `gpt-6.1-sol` rates in T3's bundled
  rate table: $2 per million input, $0.10 per million cached input and $10 per
  million output. That is what the same work would cost on a metered API. It is
  not the subscription's effective cost. The estimator that turns the monthly fee
  into a cost per unit (BI-F98BBE4F) is not built yet. When it is, run 2 costs
  about 3% of one weekly window, roughly 0.7% of a month's fee.
- Cached input is 99% of input. Most of the cost is the agent re-reading its
  context on each step, not new work.

## Tool gaps and defects found

1. **Adopt-then-claim leaves an unclaimable room.** The claim never writes the
   executor kind onto an existing room, and adopt only sets it when it creates
   the room. Filed as BI-E1020AAE by the trial agent. Claim-first works: run 2's
   room, and this record's room WC-CD5963F8, were both claimed that way first
   time.
2. **Binding the working session to its own room needs owner approval.** Both
   the governed executor reassignment and the same-scope handover returned
   `approval_required` for a room the same principal created minutes earlier.
   The M0 plan item BI-F1FC0B62 (same-scope handover without approval) is not
   covering this case on production. On 13 November, this record's own room hit
   the same gap. The owner approved the handover request, but it ended
   "authorized, but did not complete". What worked was the takeover that
   `get_workroom` offers to an unadmitted assistant acting for the room's
   owner: `reassign_workroom_executor` with no `phase`, which ran without an
   approval.
3. **Gate evidence is keyed to a different session id than the claim.** The
   gate records the harness thread id. The claim takes whatever `sessionRef` the
   agent chose. Nothing tells the agent to use the thread id, and correcting it
   later hits gap 2. Rebinding the room afterwards does not relink a result
   already recorded: the gate reuses the passing record unlinked, so the change
   needs a new commit and a fresh gate run.
4. **No governed merge-queue route for a coworker.** The runbook says
   `gh pr merge --squash --auto`. The owner's Codex rules make that a prompt,
   and T3 runs Codex unattended, so the command is refused. An in-platform
   coworker needs an MCP tool to queue a PR that has passed the gate.
5. **DPF has no executor kind for T3.** The provider-to-executor mapping turns
   "t3" into `human`. The trial used `codex-desktop`, which is true of the model
   but hides the harness.
6. **T3 runs Codex with full access.** That means a general shell, not the
   workroom-bound toolset M2 requires. The agent kept the trial rules (no
   database or shell workaround, ever), but nothing in T3 enforced them.
7. **A claim made through one client cannot be cached by another.** This record's
   claim (WC-CD5963F8) was made through Codex, the only dpf client signed in on the
   machine. `scripts/bind-worktree-cli.mjs` runs as a different identity and
   refused to cache it, so the claim hook blocked edits until they were made under
   the recorded `DPF_ALLOW_UNCLAIMED_WORK` override.

Smaller observations:

- T3 put worktrees under `~/.t3/worktrees`, not the canonical `~/dpf-worktrees`.
- The agent ended its turn early twice, reporting instead of carrying on. A
  pilot needs either a firmer brief or the platform's proactive drive to wake it.
- Reading an evidence record failed for lack of a coworker grant.
- T3's runtime file records the server bound to `0.0.0.0:3773`, while `t3 status`
  reports local-network access off. Worth checking before T3 runs unattended.
- The Claude Code dpf connector and the `claude` CLI's needed re-authentication.
- `claim_workroom_scope` on WC-CD5963F8 threw
  `scope-epoch-enrollment-held:canonical-writer-evidence-unavailable`.
- The worktree for this record lost 84 tracked files (installer scripts,
  `tools/`, `infra/`, `pnpm-lock.yaml`) shortly after it was created. A
  `dpf-reap.lock` in its git directory is stamped 10:27 PM, the minute it was
  created, while the session hygiene hook was describing it as "merged and
  clean". The files were restored from Git before anything was committed. The
  cause was not confirmed.
- Both local gate attempts for this record ran into a self-upgrade drain (from
  11:24 PM); the gate reported `blocked_quiescence`, which is unrun, not failed.

## Recommendation

Keep T3 Code as the M2 pilot harness. It started reliably, was fully scriptable,
recorded per-turn token use (which the estimator needs), managed its own
worktrees, and stopped cleanly on every refusal without working around it. Every
blocker in this trial is in DPF's claim, handover, evidence or merge paths, and
any other in-platform harness would hit the same ones.

Before the pilot starts, fix gaps 1 to 4 and file the rest under
EP-INPLATFORM-CODING. To finish this trial, the owner can approve the
handover for WC-1920C35F (envelope `cmweiy4zf00op0eqlz0xpctw0`). The agent then
runs the review and the PR can be queued. That approval is itself a routine
approval reaching the owner, so it counts against the pilot's target. The
leftover rooms WC-AA3A9FFF and WC-BFC8C53D should be closed so BI-17BBC2B8 can be
claimed again.
