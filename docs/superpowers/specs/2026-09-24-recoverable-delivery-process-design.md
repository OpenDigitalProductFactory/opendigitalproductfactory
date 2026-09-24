---
status: active
---

# Recoverable delivery process

Status: implemented in slices; each slice is its own pull request and backlog
item (listed in §9). Live acceptance on the development install is recorded in
§10 as it is run. This design applies the Durable Agentic Process recovery
contract (`docs/architecture/2026-06-09-long-running-agentic-process-architecture.md`
§5.1, made binding by PR #5537, BI-CB690D61) to one process: delivering a
change from authorized work to verified completion.

## 1. Problem

Delivery ran end to end only while one assistant session stayed alive and a
person stayed at the keyboard. On 2026-09-23 the same chain broke at almost
every hand-off:

- 129 of 134 driven Workrooms sat paused on `missing_explicit_coordinator`,
  writing about 9,700 identical pause records a day, because nothing wrote an
  owner when a room was born (BI-36FC2981, BI-E8C78E80).
- An approval was granted and never ran, because only the client could spend
  it (`cmue5mrlr3qw201uu09408gfh`, fixed by #5602 for direct calls). Approvals
  parked inside an external task still lapsed when the client restarted: four
  expired that day with their TaskRun still `input-required` (BI-9FD11E5E).
- The reviewer route was issued and authorized, but the author's client never
  refreshed its tool list (Codex issue 31469), so the review never ran
  (BI-A835D300).
- A local-CI wait that had been cancelled was re-queued by its own resumer, and
  a resumed gate could run against a different commit from the one queued
  (BI-D35B85BF).
- A replacement assistant for the same person was refused by its own person's
  room, and told to ask the owner, who was that person (BI-821EEB18).
- The install never received pull request events, because the compose file
  never passed the webhook secret to the portal (BI-C26D5DC5).
- `load_tools` answered an empty list with no reason (BI-949FBBAE), and the
  capability report disagreed with the runtime about which grants satisfy a
  tool (BI-378D3659).
- Claiming an unclaimed scope in one's own room needed a person's approval,
  because the escalation gate saw only the tool's worst case (BI-2D65BD1B).

Each failure had the same shape: the next step depended on a client, a chat
history, or a person doing procedural work, instead of on durable state that
the platform drives.

## 2. Design rules

These restate DAP §5.1 for delivery. Every transition in §3 is held to them.

1. **Durable state decides.** The Workroom, BacklogItem, TaskRun,
   CoworkerActionEnvelope, NonProductionEnvironmentLease, pull request and
   SelfUpgradeRun rows say where work stands. Chat history, client memory and
   notifications never do.
2. **The platform owns the next step.** A transition whose inputs are all
   durable is driven by a server-side trigger (queue, cron, webhook, approval
   route). A client may speed it up, never gate it.
3. **One effect per intent.** Every retried or duplicated trigger lands on an
   idempotency key or a compare-and-set, so it either performs the effect once
   or returns the recorded outcome.
4. **Authority is re-checked at the moment of effect.** Resuming work, spending
   an approval or acting on someone's connection re-validates the current
   person, assistant, consent, grants and exact room. Stored authority is never
   inherited by a different person, tenant, consent or room.
5. **A person decides only what needs judgment.** Routine platform direction
   goes to WWMD (decision `DI-CBE9B074DB3E` chose server continuation with
   idempotent replay for this work). A person is asked when an action is
   damaging or changes authority, and their answer is carried out without
   further shepherding.
6. **Every refusal names its repair.** A refusal carries the exact next call,
   or says who must act and why.
7. **Completion is honest.** "Done" means the durable evidence exists. Work
   that waits on something outside DPF says so, and names it.

## 3. Transition map

Each row names the durable state and its owner, the identity and evidence the
transition requires, what triggers it, and what happens on interruption,
timeout, cancellation, duplicate delivery and reassignment.

### 3.1 Authorize

- **State:** `BacklogItem` (status, triage outcome, effort, epic). Owner: the
  backlog, written through governed MCP tools.
- **Authority:** the escalation gate (`resolveEscalation`) classifies each call
  by its declared consequence. Proportional authority (BI-2D65BD1B): a tool may
  narrow its consequence for the exact call through `consequenceForCall`, never
  widen it, and a refiner that fails falls back to the declared consequence.
  Claiming an unclaimed scope in one's own claimable room carries no
  consequence, so it is a routine write that the person's consent steers; a
  forced co-claim, a non-claimable room or a live lease held by someone else
  keeps the declared `authority` consequence and asks a person.
- **Trigger:** a person, or a coworker within its grants.
- **Interruption / duplicate:** item writes are idempotent by `itemId`; the
  similar-item check on create surfaces duplicates before filing.

### 3.2 Claim

- **State:** `Workroom` (`WC-*`), its lease, and `WorkroomParticipant` rows.
  Owner: the work-capsule store.
- **Identity:** the claim resolves the person (OAuth `principalId`) and the
  assistant (`agentPrincipalId`). A delivery room is **born owned**
  (BI-36FC2981): the person becomes the explicit Process Overseer and the
  assistant a contributor, in the same transaction as the claim. The claim's
  readback refuses a room that does not end with exactly one owner.
- **Trigger:** `claim_backlog_item_for_work` or `adopt_worktree`.
- **Duplicate:** the claim is idempotent by item and branch; a repeat returns
  the same room after readback.
- **Legacy rooms:** the workroom drive gives an unowned delivery room its owner
  from the room's own record (requester, lease holder or creator who is a
  person), bounded per tick, and records a `coworker-joined` activity.
- **Reassignment:** see §5.

### 3.3 Bind source

- **State:** the room's `baseSha`, `headSha`, branch and repository.
- **Evidence:** full 40-character SHAs, validated on input. The claim readback
  refuses a recorded head that differs from the requested one. An adoption
  missing either SHA returns `data.identityRepair`, a packet to replay as given
  with the SHAs added; no reviewer can be routed to a room without them.
- **Forged binding:** a caller cannot bind another person's room (ownership
  check) or claim a head it did not request (readback). Reviewer packets must
  equal the packet readiness issues now (canonical JSON equality, #5590).

### 3.4 Research and design

- **State:** readiness decisions derived from recorded evidence.
- **Evidence:** RESEARCH_REQUIRED is satisfied by the cited delivery evidence
  the author already recorded (#5316, #5500), so a small item can close by its
  author.
- **Duplicate / interruption:** evidence writes are keyed; readiness is
  recomputed from state, never cached in a session.

### 3.5 Independent review

- **State:** the reviewer `TaskRun`, keyed by the readiness request key, and the
  review receipt.
- **Authority:** the bounded `request_coworker` lane (#5590) requires OAuth, a
  consent binding, `initiative_evidence_write`, exact-room access for both the
  person and the assistant, the packet readiness issues now, and a reviewer
  independent of the author. Self-review is refused by the lane and again by the
  receipt.
- **Trigger:** the author's client, or **the platform** (BI-A835D300): every two
  minutes `mcp/task-run-dispatch-reconciliation` sends each independent route a
  delivered item owes, through the author's own newest connection that queued
  work may still continue on (`isCurrentOAuthExecutionAuthority`), as the same
  governed call.
- **Duplicate:** the request key makes client and platform dispatch one
  TaskRun. The platform does not re-send a route within 30 minutes and records
  every attempt as a `reviewer-dispatch` activity on the room.
- **Interruption:** a dead client no longer blocks review. With no live
  connection the room records why, and the author can reconnect or request it.

### 3.6 Implement

- **State:** the worktree, the room's scope claims and lease.
- **Authority:** scope claims are fenced: an overlapping claim is refused with
  `scope_conflict`, and a live lease held by someone else with `lease_held`
  (BI-2D65BD1B).
- **Interruption:** the lease expires. The handover (§5) recovers the room
  without discarding its history; the stale-room reaper exists but is armed per
  install by an operator flag (BI-9A353411).

### 3.7 Test (local-CI gate)

- **State:** `NonProductionEnvironmentLease` (queued, active, cancelled,
  expired, released) and the per-worktree gate record.
- **Evidence:** the gate record binds branch, SHA and worktree; `pregate:status`
  is the verdict.
- **Trigger:** `pnpm run pregate`. A busy queue exits 75 and hands the wait to a
  detached resumer.
- **Resume (BI-D35B85BF):** the resumer carries a pin (branch, SHA, worktree,
  owner, and the lease it resumes). A resumed run verifies the pinned source and
  stops with exit 82 if the head moved or the tree is dirty. It supersedes its
  own queued lease instead of adding another (`resumeLeaseId`), so a resume
  never duplicates the queue entry.
- **Cancellation:** a cancelled lease is terminal. The resumer stops with exit
  81 (`local_ci_wait_cancelled`) and never re-queues it. Only a lease that
  expired because the host went quiet re-establishes its queue intent.
- **Timeout:** the resumer's deadline is bounded; exit codes 81 and 82 are
  classified `retry: false`, so no caller loops on them.

### 3.8 Pull request and merge

- **State:** the pull request and the merge queue.
- **Evidence:** DCO sign-off, the local gate record, `pnpm pr:health`, and the
  merge queue's own build of `main` plus the PR.
- **Duplicate / interruption:** the merge queue is the only writer of `main`;
  a dequeue is retried by the queue, not by hand.

### 3.9 Pull request events reach the install

- **State:** `GitIntake` rows keyed by GitHub's delivery id; the Workroom's
  recorded pull request and head.
- **Configuration (BI-C26D5DC5):** the installer, setup scripts, release
  asset installer and promoter all ensure `DPF_GIT_WEBHOOK_SECRET` exists, and
  the compose file passes it to the portal. A blank secret is treated as absent,
  and the receiver refuses unsigned deliveries.
- **Delivery:** the receiver records the delivery, then emits with a
  deterministic event id (`<event>:<deliveryKey>`). A failed emit leaves the
  row `emit-pending`; a redelivery re-emits instead of being dropped as a
  duplicate. The binder matches the repository, records the pull request URL
  and head SHA, and updates the room with a compare-and-set.
- **Recovery:** GitHub does not retry a failed delivery on its own, so the
  merged-PR reconciliation poll (#5308) remains the recovery path, not the
  primary one. On a development install with no public endpoint, `gh webhook
  forward` relays real events (see `docs/architecture/agent-dev-environments.md`).

### 3.10 Image publication and upgrade

- **State:** the release tag, published image and release assets; the
  `SelfUpgradeRun` (`SUR-*`) row and install state.
- **Trigger:** an annotated `v<date>-<slug>.N` tag on a `main` commit publishes
  the image; `ops/self-upgrade.run` promotes it.
- **Duplicate / competition:** one upgrade runs at a time; the queue
  (`get_self_upgrade_queue_status`) is checked first, and sessions coordinate so
  no two upgrades compete.
- **Interruption:** the promoter and quiescence gates own interruption
  durability (see the self-upgrade runbook); a gate run blocked by quiescence is
  reported as infrastructure, not as a code verdict.

### 3.11 Live acceptance and completion

- **State:** readiness v3 decisions, acceptance evidence (`ux_verified` and
  friends), and the item's status.
- **Honesty:** an item is `done` only when readiness allows it. Work that waits
  on something outside DPF (an upstream client defect, an operator action) is
  recorded as an external dependency with its owner, never as done.

## 4. Approvals

The approval is a durable interrupt. Its states are `proposed`, `approved`,
`declined`, `executed`, `failed`, `cancelled` and `expired`
(`CoworkerActionEnvelope`).

- **The approval carries out the call it approved.** A direct call runs once,
  on approval, as the same person and assistant (#5602). A call parked inside
  an external task resumes that task on approval (BI-9FD11E5E), from what the
  task stored at submission: the same person, requested coworker, route and
  submitting credential. It is the client replay's own resume, so a client
  that restarted no longer lets the approval lapse.
- **Exactly once.** Every approved run reserves its envelope with a
  compare-and-set; the task resume also reserves the waiting task. A racing
  client retry and the platform's run cannot both spend one approval. A retry
  after a successful run returns the recorded outcome.
- **Authority re-checked.** Both runners use one credential check
  (`approved-request-credential.ts`): live, same person, still admits the tool,
  and an OAuth consent that still names the connection's assistant.
- **Delayed approval.** An answer after the window closes settles the envelope
  as `expired` and says so on the card. The assistant's retry of the identical
  call raises a fresh card; nothing runs on stale approval.
- **Residual.** If the portal dies between recording an approval and running
  it, the envelope stays `approved` until its window closes; the assistant's
  retry within the window spends it once, and after the window a retry asks
  again. No second effect is possible in either case.

## 5. A replacement assistant resumes without chat history

A session can end at any point. Its person's next assistant is a different
agent with no memory of the work.

1. **Discover.** Any call naming the room returns
   `workroom_assistant_not_admitted` with the exact handover call in
   `data.handover` (BI-821EEB18), instead of "ask its owner".
2. **Hand over.** `reassign_workroom_executor` is let through only when the
   person owns the room (an active Process Overseer or accountable participant,
   or the holder of a room nobody oversees) and nobody has admitted, narrowed or
   removed that assistant. Case policy and clearance still apply. The tool
   changes authority, so the person approves it, and §4 carries it out. The
   executor change and the assistant's admission to that one room are one
   transaction.
3. **Read where the work stands.** `get_workroom` returns the recovery packet:
   title, objective, item, base branch, SHAs, and the next action.
4. **Continue.** Durable waits are pinned to their SHA and owned by their
   resumer (§3.7); approvals and reviewer dispatch no longer need the original
   client (§3.5, §4).

Another person's assistant, and one removed from the room, are still refused.

## 6. Failure-mode coverage

| Transition | Interruption | Timeout | Cancellation | Duplicate delivery | Reassignment |
|---|---|---|---|---|---|
| Authorize | Governed write is atomic | n/a | Item status | Similar-item check | n/a |
| Claim | Claim and ownership in one transaction; drive repairs legacy rooms | Lease expiry | Room status | Idempotent claim + readback | Handover (§5) |
| Bind source | `identityRepair` packet | n/a | n/a | Readback refuses a different head | Owner check |
| Review | Platform dispatch without the client | 30-minute re-send window | TaskRun terminal | Request key: one TaskRun | Author's current connection only |
| Implement | Lease; handover | Lease expiry | Scope release | `scope_conflict`, `lease_held` | Handover |
| Test | Pinned resumer; source-drift exit 82 | Resumer deadline | Terminal, exit 81 | Resume supersedes its queued lease | Pin carries owner and lease |
| PR events | `emit-pending` re-emit; reconciliation poll | Poll interval | n/a | Delivery-id key; deterministic event id | n/a |
| Approval | Server run on approval | Window → `expired` | `declined`, `cancelled` | Envelope CAS + task CAS; recorded outcome | Credential re-checked |
| Upgrade | Promoter durability | Quiescence | Run status | One run at a time | n/a |

Each cell is covered by the slice tests named in §9.

## 7. Security boundaries kept

- **Wrong room:** exact-room access for both the person and the assistant, on
  every governed call that names a room (`workroomTargetAccessRefusal`). The
  handover admits only an assistant nobody admitted or removed, for a person
  who owns that room.
- **Self-review:** refused by the request lane and by the receipt.
- **Forged bindings:** SHAs validated and read back; reviewer packets must equal
  the server-issued packet; approvals run only arguments that hash to the
  approved fingerprint (direct calls) or the task's own stored writer call
  (task resumes), and the gate re-checks the approval binding.
- **Consent:** an OAuth connection acts only while its consent still names its
  assistant; queued work continues only on a credential the platform's
  queued-work rule accepts.
- **Proportional authority narrows only:** `consequenceForCall` can lower a
  consequence for the exact call it can prove safe, never raise a tool's reach.

## 8. Tool discovery and the clear surface

- `load_tools` reports a status and reason for every requested name, including
  names it could not load, and an empty result says why (BI-949FBBAE). The
  capability report and the runtime use one grant-satisfaction rule, with a
  parity test (BI-378D3659).
- Refusals name the next call: `workroom_assistant_not_admitted` carries
  `data.handover`; an adoption without SHAs carries `data.identityRepair`; the
  approval card says why an approved request did not run.
- Room activity says what the platform did: `coworker-joined` (born owned,
  handover, drive repair) and `reviewer-dispatch`.

## 9. Delivery slices

| Slice | Items | Pull request | Refactoring in the slice |
|---|---|---|---|
| Proportional scope-claim authority | BI-2D65BD1B | #5606 | Tool consequence types moved to `tool-consequence.ts`; one `scopeClaimRefusal` mapper |
| Born-owned rooms and handover | BI-36FC2981, BI-E8C78E80, BI-821EEB18 | #5609 | One `admitRoomAssistant` rule for claim, adopt, drive repair and handover; reassign handler moved out of `mcp-handlers.ts` |
| Durable-wait cancellation and pinning | BI-D35B85BF | #5605 | Resume decisions in `gate-resume-pin.mjs`; lease resume in `environment-lease-resume.ts` |
| Pull request events | BI-C26D5DC5 | #5608 | One secret helper per installer; deterministic emit ids |
| Tool discovery | BI-949FBBAE, BI-378D3659 | #5607 | One grant-satisfaction rule shared by runtime, report and marketplace; route uses the shared token rule |
| Approved task resumes | BI-9FD11E5E | #5610 | One credential check and execution context for both approval runners; `resumeApprovedTask` split from the replay |
| Platform reviewer dispatch | BI-A835D300 | #5611 | Shared connection lookup (`standing-connection.ts`) |

All seven merged on 2026-09-24. #5605, #5607, #5608 and #5609 shipped in
`v2026.09.24-plan-review-race.1` (SUR-4B75FCA9, served `ca226845dce`);
#5610, #5606 and #5611 ship in `v2026.09.24-recoverable-delivery.1`.

## 10. Live acceptance

Run on 2026-09-24 on the development install serving `e7567f928db`
(SUR-CB9A1D7D). The OAuth checks used two real OAuth connections, registered
by dynamic client registration and consented as the development automation
persona: one acting as AGT-EXT-CODEX and one as `external-claude-code`. The
operator approved this for the run; both connections were revoked afterwards.

| Criterion | Result | Evidence |
|---|---|---|
| An external author routes an independent reviewer and gets a receipt that advances the gate | **Not shown** | See §11. No item with an assistant-authored room had an issued independent route, and no inference provider was available to run a reviewer. |
| A recorded approval survives a client restart and is consumed exactly once | **Shown** | Envelope `cmug3wygb6mgl01phjjcoitml`: the client never replayed; the person authorized in the inbox and the platform ran the call once. After a refresh-token rotation the client replayed the identical call and got "already ran once… it was not run again". One successful run, one card. |
| A delayed approval has a clear recovery path | **Shown** | Envelope `cmug3ydap6mhn01phnsb23ujj`: after its window the inbox no longer offered it; a stale Authorize returned 409 "…expired. Your coworker can ask again."; the envelope settled `expired` and nothing ran; the assistant's retry raised a fresh card. |
| A replacement agent resumes without chat history | **Shown** | `external-claude-code` was refused on WC-E40914A7 with `workroom_assistant_not_admitted` and `data.handover`; replaying that call admitted it, recorded `executor-changed` and `coworker-joined` (source `handover`), and `get_workroom` then answered from durable state. |
| Cancellation stays terminal | **Shown** | Probe lease NPEL-A4D0DFF6F2 cancelled while queued; its resumer stopped with exit 81 (`reason: cancelled`) and queued no replacement. |
| Duplicates and retries do not duplicate effects | **Shown** | The approved call's replay returned the recorded outcome (above). The same signed Git delivery sent twice returned the same candidate, `duplicate: true` the second time. A cancelled gate wait produced no replacement lease. |
| A real PR event reaches the install and advances durable work | **Partly shown** | The upgrade provisioned the signing secret; a correctly signed delivery returned 202, unsigned and forged ones 401 (before: 503 for all). A real GitHub delivery was not exercised; the operator did not approve a temporary repository webhook. |
| Wrong-room access, self-review and forged bindings are denied | **Shown** | Another person's room: read and takeover both `workroom_access_denied`. Self-review and a packet readiness never issued: `independent_review_request_denied`. A malformed SHA: `invalid_input` before any write. |
| Final status separates completed work from external dependencies | **Shown** | BI-821EEB18, BI-2D65BD1B and BI-949FBBAE closed `done` on live evidence. BI-D35B85BF, BI-9FD11E5E, BI-A835D300, BI-C26D5DC5, BI-36FC2981, BI-E8C78E80 and BI-378D3659 stay `awaiting-acceptance`, each with the check it still owes (§11). |

Two more observations from the run:

- **Proportional authority.** The Codex assistant's ordinary scope claim was
  allowed with no card; the decision log shows `consequenceRefinement
  {declared: authority, reason: ordinary-claim}` steered by
  `connection-delegation`.
- **Born-owned rooms.** The first drive tick after the release gave 50 rooms
  (the per-tick cap) exactly one owner each, and they moved from
  `conformance_pause` to `attention` at their current stage. An adoption by an
  OAuth assistant produced a born-owned room in one call.

## 11. External dependencies and open checks

- **Codex issue 31469.** The Codex client does not refresh its tool list after
  authorization changes. DPF no longer depends on it for review (§3.5), but a
  DPF release does not fix the client, and this design does not claim it does.
- **Inference capacity.** On the day of the run no chat model was loaded and
  every external provider reported busy (`provider=unknown`). A coworker task
  could not reach its first tool call, so the task-bound approval resume
  (BI-9FD11E5E) is covered by tests and the local-CI gate only, and no
  reviewer could produce a receipt.
- **Independent routes on medium items.** For BI-D35B85BF readiness issues no
  acceptance route: "no current objective baseline exists; complete independent
  spec approval before acceptance mapping", and no spec-approval route is
  issued either. Until that chain issues a route, the platform reviewer
  dispatch (BI-A835D300) correctly has nothing to send.
- **Webhook relay on a development install.** A development install has no
  public endpoint. Real pull request events reach it through `gh webhook
  forward`, which creates a repository webhook and needs the repository
  owner's permission; the reconciliation poll covers the gap without it.
- **Refusal wording.** `workroom_assistant_not_admitted` says the person "will
  be asked to approve" the handover. An operator-graduated assistant is not
  asked (seen live for `external-claude-code`); the text should say "may be".
- **Still open on BI-E8C78E80.** Born-owned rooms clear the missing-owner
  pause, but an operator-visible surface for paused rooms and escalation of
  repeated identical deviations are not built.

## 12. Research and benchmarking

The design uses established patterns rather than new machinery.

- **Durable execution** (Temporal, Inngest, AWS Step Functions): workflow state
  lives outside the worker; retried activities must be idempotent. DPF keeps
  that state in its own rows and runs recovery from Inngest (DAP §3.1).
- **Level-triggered reconciliation** (Kubernetes controllers): a controller
  compares desired and observed state on every pass, so a missed event is
  corrected on the next pass. The workroom drive's ownership repair, the
  reviewer dispatch and the merged-PR poll work this way.
- **Idempotency keys** (as in Stripe's API): a client-chosen key makes a retry
  return the first result instead of repeating the effect. The review request
  key, the TaskRun idempotency key and the recorded approval outcome follow it.
- **At-least-once webhooks** (GitHub): each delivery carries a unique
  `X-GitHub-Delivery` id, the same event can arrive more than once, and a
  failed delivery is not retried automatically. Hence a delivery-id key, a
  deterministic emit id, and reconciliation as the recovery path.
- **Transactional outbox:** record the intent before emitting, and re-emit
  from the record on retry. The `emit-pending` intake status is this pattern.
- **Compare-and-set fencing:** one writer wins a state transition, and a stale
  worker cannot overwrite its successor. Envelope reservation, task
  reservation, lease supersession and the PR binder all use it.
