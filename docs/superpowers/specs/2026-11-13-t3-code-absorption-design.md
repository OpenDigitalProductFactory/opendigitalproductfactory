---
status: draft
---

# Absorbing T3 Code: the platform's own coding capability (rung 0)

**Backlog:** BI-FCEB5C22 (epic EP-INPLATFORM-CODING; delivery-xlarge, decomposed below and never implemented directly). This design record is its doc slice BI-4A269553. **Related:** BI-9816A49D records the owner's rung-0 ruling in WWMD.
**First slice already built:** BI-53BED66C, [T3 as a first-class executor](2026-11-13-t3-code-first-class-executor-design.md).
**Evidence:**
- [T3 runtime trial](../research/2026-11-12-t3-code-runtime-trial.md) (BI-4DE79C8D);
- [T3 source delta review](2026-09-04-t3-code-source-delta-review.md) (DI-580C8D86B161);
- the 2026-11-13 inventory of T3 0.1.9 as installed on the owner's Mac. Read-only; source pinned to `pingdotgg/t3code@24e77473ecf4`, the exact build installed.

**Decisions** (WWMD, all high confidence, no commandment conflict):

| Decision | Choice | Composite | Alternatives |
|---|---|---|---|
| DI-C2095F79DA5B | Refactor DPF toward T3's patterns | 12.58 | 4.99 keep T3 as an external harness; 3.57 vendor T3's code |
| DI-B806C8D27736 | Devices are execution hosts under one Workroom authority | 10.99 | 9.57 portal-only execution; 3.98 per-device ledgers |
| DI-BEAADBEEB92C | Adopt T3's decide/commit/outbox core on the Workroom log | 10.80 | 4.69 keep the runtime as is |
| DI-1BB965D732C9 | Adopt T3's plan windows and per-turn usage, keep DPF's economics | 12.06 | 8.09 extend DPF's stores only |

## Purpose

Owner direction (Mark, 2026-11-13, verbatim):
- "T3 is already working across 3 of my devices, including here. I want the platform to absorb it, to evolve what it does into our requirements."
- "T3 has an excellent architecture and does many of the things we aspire to do, or do poorly."
- "coding is the baseline, rung 0 to make this platform self-aware, recursive, and iterate on itself."

So the goal is not a better wrapper around T3. The platform takes over what T3 does as its own capability, under workrooms, delivery shapes, GPP and the profession corpora. It adopts T3's architecture where T3's is better. Then T3 is retired device by device.

The design is judged by one question: does it let the platform iterate on its own source safely? That means finding its own gaps, filing them, building fixes in workrooms, reviewing them through the profession experts, and learning from the outcomes, all under GPP. Coding is the first rung of that ladder.

This follows the commandment [Absorb, Don't Adopt](../../founder-kernel/wiki/principles/absorb-dont-adopt.md): own the capability, shrink the dependency surface. The transition follows [Mirror, don't migrate](../../founder-kernel/wiki/principles/mirror-dont-migrate.md). Founder policy for shared platform work is 80% refactoring and reliability, 20% new capability. Almost all of this is refactoring DPF's own substrate toward a proven design, which fits that split.

### What changes from the 2026-09-04 review

DI-580C8D86B161 rejected "a global T3-style thread/session ledger across installations" as violating one Workroom authority. This design keeps that rejection: there is still one backlog and one Workroom authority, and no second ledger.

What the owner's direction supersedes is the narrower conclusion that T3's patterns needed no new substrate. Two exceptions now apply:
- **The owner's devices become execution hosts of their installation.** This adds a registry, not a ledger (decision DI-B806C8D27736).
- **The workroom runtime adopts an effect outbox** (DI-BEAADBEEB92C).

## Licence and provenance

- **T3 Code's own code is MIT**, copyright 2026 T3 Tools Inc. Both the repository and the installed `package.json` say so. Patterns may be absorbed freely. Any ported code carries the MIT notice and a provenance line naming `pingdotgg/t3code@<commit>` and the source path, recorded in `THIRD-PARTY-NOTICES` with the slice that ports it.
- **Not taken:**
  - the bundled `@anthropic-ai/claude-agent-sdk` (proprietary). DPF drives the `claude` CLI's stream-json interface directly, as it already does;
  - `@cursor/sdk` (proprietary);
  - `heic-to` (LGPL-3.0);
  - the hosted services: T3 Connect relay, Clerk, T3 Chat linking, PostHog/Axiom/Statsig telemetry.
- **Patterns, not vendored code.** T3's `main` moved 985 commits in two days after the installed build. Vendoring would import that churn. DI-C2095F79DA5B scored vendoring lowest.

## What T3 does, and how DPF compares

Each row compares T3's design with DPF's current one and gives the verdict:
- **Adopt:** DPF refactors toward T3's pattern.
- **Keep:** DPF's design holds.
- **Layer:** T3's mechanism carries DPF's governance on top.

| Area | T3 (pinned build) | DPF today | Verdict |
|---|---|---|---|
| **Durability core** | An I/O-free orchestrator decides. One transaction commits events, projections, the command receipt and outbox effects. A leased effect worker runs side effects and reports back as commands. An acknowledgement means the intent committed. | A per-room `WorkroomActivity` sequence and command receipts exist (`command-receipts.ts` is already modelled on T3's `CommandReceiptStore`). But `workspaceState` is mutated directly, and runtime logs are written fire-and-forget (`supervisor.ts` `enqueue`). | **Adopt** (DI-BEAADBEEB92C). Built on DPF's existing activity log and receipts, plus one outbox table. |
| **Deterministic ids for server work** | Ids such as `limit-arm:<thread>:<run>:<reset>` and `limit-resume:…`. Launch sagas with step flags make retry resumable. | Command receipts for client calls. Server-originated work (drive, recovery) has no deterministic ids. Adopt-then-claim left half-made rooms (BI-E1020AAE). | **Adopt.** Claim, worktree and session start become one resumable saga. |
| **Executor identity** | App ids are primary; provider ids are references. A *driver* is an integration; an *instance* is an account and configuration. Routing is by instance. A missing capability is explicit. | `executorKind` names a client surface. Codex and Claude each run through three separate paths: workroom runtime, Build Studio dispatch and inference routing. Each keeps its own session handling, and the tool-trace parser is duplicated. | **Adopt.** One driver per client and one instance per account. The three paths collapse onto one adapter per client. This is the largest refactor and the most debt removed. |
| **Plan and capacity accounting** | Live windows (`usedPercent`, `resetsAt`, window length) pushed by Codex `account/rateLimits/updated`, plus Claude readers. Windows are pooled per account across environments. Usage is recorded per turn by token class. A `usage_limit` error class triggers a guarded auto-resume at reset. | Subscription estimator (cost per unit, PR #7019). Two capacity stores, `CliPoolStatus` and `ProviderCapacityStatus`. The Codex adapters report zero usage, and the runtime drops usage events. Slice 1 adds visible capacity waits. | **Adopt** windows, per-turn usage and guarded resume. One per-account window store replaces both stores. **Keep** the estimator, portfolio-level budgets (owner ruling) and routing to another executor (slice 1). Together these are DI-1BB965D732C9. |
| **Usage outside the harness** | Scans native Claude, Codex, Grok and Pi histories, so usage outside T3 counts against the plan. | Only in-platform calls are recorded. | **Adopt,** read-only. A plan window is shared with the owner's own direct use, so the estimate is wrong without it. |
| **Multi-device** | Each machine owns its environment, with no sync. Clients hold ordered route lists (LAN, tailnet, HTTPS, relay). Peer links run over MCP OAuth and can only narrow access. Linked work carries an immutable origin fence. | Installation-level federation and work sync between portals. No registry of which device runs a session. | **Adopt** environment-owned execution, route lists and narrowing links. **Keep** one backlog and one Workroom authority on the portal (DI-B806C8D27736). Devices register as execution hosts; they keep no ledger. |
| **Handover** | Switching provider is an explicit context-handoff record: a budgeted set of real messages, not a summary. | Two-step, owner-scoped handover with digests, lock-time snapshots and executor checkpoints (slice 1 removes the routine approvals). | **Layer.** **Keep** DPF's authority (propose then acknowledge, owner scope). **Adopt** T3's context-handoff record as what the receiver gets. |
| **Recovery** | No provider process survives a restart. Effects tied to a lost process are retired, not replayed. Questions become answerable by a new message. Unsent input stays queued. | Reattach within a 24 h horizon, otherwise mark the session lost. Held questions are envelopes. | **Adopt** retire-not-replay and held input. **Keep** held questions as GPP envelopes. |
| **Tool authority for agents** | A capability ceiling (runtime mode), not a scope list. Every MCP tool must declare its access or it does not compile. Forwarded calls only narrow. Each provider session gets its own token, revoked on release. | The room session token (`dpfroom_`) is bound to one room but not to a tool set. GPP gates consequence. | **Adopt** per-tool declared access and a per-session ceiling. This is the M2 workroom-bound toolset, the first slice of BI-3E2B7A96. **Keep** GPP consequence gates and owner approval for out-of-scope acts. |
| **Default posture** | New threads default to full access (`dangerFullAccess` / `bypassPermissions`). All 93 threads on the owner's Mac run that way. The server binds 0.0.0.0:3773 over plain HTTP. Telemetry is on and includes hashed account ids. | Sandboxed runtime (`sandbox-launcher`), escalation for outward actions, no third-party telemetry. | **Keep** DPF's posture. Devices bind loopback and tailnet over authenticated routes, and there is no external telemetry. |
| **Checkpoints and revert** | Hidden git refs per turn. A revert is refused before files change if the provider cannot rewind its conversation. | Advisory checkpoint notes only. | **Adopt later** (slice S7), with refs inside the worktree's namespace. T3's refs have accumulated in the owner's main clones (25 in `~/dpf`, 92 in `~/DPF2`). |
| **PR linking and settlement** | Multiple PR links per thread, settlement reactors after merge/close commands. | PR follow-through and the review-tail loop (covered by the 09-04 review). Slice 1 adds a governed queue step. | **Keep,** with the 09-04 amendments. |
| **Orchestrator MCP for its own agents** | Delegate to a subagent on any instance, create and steer threads, wait and cancel. | MCP is the coordination plane. Agents claim, record and hand over through tools. | **Keep** MCP as the plane. **Adopt** `delegate_task` semantics through workroom delegation, not a second queue. |

**What DPF learns from T3:** to make intent durable before acting; to give server-originated work deterministic ids; to model executors as drivers and instances with explicit capabilities; to treat plan windows as first-class, live data; to keep execution where the files are; and to grant agents a ceiling, not a list.

**What DPF keeps:**
- one queue and one Workroom authority;
- owner-scoped propose-then-acknowledge;
- GPP consequence gates and profession review;
- portfolio budgets;
- a sandboxed default posture.

## Target architecture

1. **Workroom runtime core.** Adopted from T3's Orchestrator, EventSink and EffectWorker.
   - Commands are decided without I/O.
   - Each decision commits its `WorkroomActivity` rows, the room projection, the receipt and any `WorkroomEffect` outbox rows in one transaction.
   - A leased effect worker starts turns, captures checkpoints and calls providers, then reports back as commands.
   - Server-originated commands use deterministic ids.
   - On restart, effects tied to a lost process are retired.
2. **Executor drivers and instances.**
   - A driver per client: codex app-server, claude stream-json, grok and antigravity over ACP.
   - An instance per account and configuration, routed by instance.
   - Workroom runtime, Build Studio dispatch and inference routing all call the one driver per client.
3. **Plan windows and usage.**
   - A per-instance window store, fed live by the drivers. It replaces `CliPoolStatus` and `ProviderCapacityStatus`.
   - Per-turn `TokenUsage` by class, plus a read-only importer of native client histories.
   - The estimator prices them, and portfolio budgets gate them.
   - At a limit:
     - a guarded resume is armed for the reset (an early reset clears it);
     - the room is offered to an unblocked instance through the slice-1 handover.
4. **Execution hosts (devices).**
   - Each of the owner's devices runs a DPF host agent and registers with its installation as an execution host. This extends the agent toolchain's host agent, not a new daemon beside it.
   - A workroom's session runs on the host that owns its worktree.
   - Clients reach hosts by ordered routes: loopback, tailnet, authenticated HTTPS.
   - Host links only narrow authority.
   - The paired Dev install stays a federated peer with work sync. It never becomes an execution host of production.
5. **Workroom-bound toolset.**
   - Each session gets a ceiling and a token bound to its room and tool set, revoked on release.
   - Every tool declares its access.
   - GPP decides consequence.

## Moving the owner's devices off T3

T3 runs on the owner's Mac, a Windows desktop (`DESKTOP-A290QNG`) and an iPhone client. The Mac and the Windows machine are linked with full access until 7 December. Nothing in this plan stops T3 before its device's replacement is proven, and the owner keeps using T3 meanwhile.

1. **Mirror (now).**
   - DPF reads each device's T3 plan windows and usage read-only, through the host agent, into the per-instance window store.
   - T3 threads that work DPF items run under slice 1's executor binding.
2. **Run alongside.**
   - The DPF host agent on each device runs the absorbed runtime for new workrooms.
   - T3 keeps its existing threads.
   - Parity is measured on: items merged, lead time, cost per item, approvals reaching the owner, and plan-limit handling.
3. **Cut over per device** after two weeks at parity.
   - New work stops going to T3 on that device.
   - T3's history stays readable.
   - The owner retires T3 there. Uninstalling is the owner's action on his own machine; an agent never does it.
4. **Clean up.**
   - Remove T3's hidden refs from DPF clones.
   - Close leftover trial rooms and processes.
   - Retire the full-access device link.

## Rung 0: the platform iterating on itself

The loop, each step in an existing primitive:
1. **Find.** Detectors and agents file platform gaps as `automated-detection` backlog items: failing guards, repeated refusals, stalled rooms, approval counts.
2. **Build.** A coworker claims the item in a workroom and builds the fix with the absorbed runtime on DPF's own source.
3. **Review.** The profession experts review it through semantic review and GPP.
4. **Land.** It goes through the gate and the merge queue.
5. **Learn.** The outcome is recorded (`record_decision_outcome`) and feeds the profession corpus.

Safety rails that make recursion safe:
- **The capability cannot widen its own authority.** A change to authority, GPP, approval routing or this runtime's own gates is classified high sensitivity. That raises the shape to large and keeps profession and owner review.
- **Budgets bound every loop.** Portfolio budgets and the work-in-progress allowance apply to platform self-work like any other work.
- **Every merge is reversible and attributed.** The workroom, evidence and decision ids travel with the PR.
- **A kill switch.** One installation setting stops autonomous self-work dispatch without affecting human-started work.
- **Measured weekly:** self-filed items merged, regressions caused, approvals reaching the owner, and spend.

## Delivery slices

Each slice is its own backlog item, sized delivery-medium or smaller, in this order. The first four are the M2 pilot's foundation.

| Slice | Item | Delivers | Depends on |
|---|---|---|---|
| S1 | BI-53BED66C | T3 as a first-class executor (built) | none |
| S2 | BI-C64EDA33 | Workroom runtime core: decide/commit/outbox, deterministic ids, retire-not-replay | S1 |
| S3 | BI-A01B06F6 | One driver per client, instance routing; collapse the three client paths | S2 |
| S4 | BI-1E498941 | Per-instance plan windows, per-turn usage, history importer, guarded resume and reroute; one store replaces two. Absorbs open BI-02A513D1 | S3 |
| S5 | BI-687E7D81 | Workroom-bound toolset and per-session ceiling (first slice of BI-3E2B7A96) | S3 |
| S6 | BI-5A866218 | Execution hosts: registry, host runtime, route lists, narrowing links. Extends the per-user host service from BI-65C17737 | S3, S4 |
| S7 | BI-2C132569 | Context-handoff record; checkpoints and safe revert | S2, S3 |
| S8 | BI-8B3DBAD8 | Device mirror, parity measures, per-device cutover; T3 retired | S4, S6 |
| S9 | BI-204C9EE6 | Rung-0 loop: gap detectors to backlog, autonomous dispatch with rails and kill switch, outcome learning | S5, S8 |

## Objectives and acceptance

- **AC-1.** Every T3 capability the owner uses has a DPF home, delivered by a slice above: driving plan sessions, plan windows and resets, multi-device use, handover, recovery and agent tools.
- **AC-2.** Each adopt-or-keep choice has a recorded decision. The comparison table is kept current as slices land.
- **AC-3.** Ported code carries T3's MIT notice and a pinned provenance line. No proprietary or copyleft component is taken.
- **AC-4.** The paired Dev install and each of the owner's devices keep working through the move: no forced stop, and history stays readable.
- **AC-5.** T3 is retired on each device only after two weeks at parity.
- **AC-6.** The platform delivers at least one fix to its own source, from a self-filed gap to merge, through the absorbed capability with no routine owner approvals and no widening of its own authority.

## Risks seen on the owner's devices

These come from the read-only inventory. They are reported for the owner's decision; nothing was changed.
- T3's desktop server listens on all interfaces at port 3773 over plain HTTP. A pairing code is the only lock. `t3 status` reports "Local network off" because it describes the uninstalled background service.
- All 93 threads run full access.
- Telemetry is on and sends hashed OpenAI and Claude account ids.
- T3's hidden checkpoint refs have accumulated in `~/dpf` (25) and `~/DPF2` (92).
- A DPF wait process from the 12 November trial is still running from a T3 worktree.

## Out of scope

- Cost-and-latency routing for ordinary inference (BI-BB620D03). S4 supplies its inputs.
- Running official clients inside the portal under subscriptions (BI-2E63DEC7, E4). S3 and S6 give it its architecture; that item narrows to what remains.
- Any change on the owner's devices without his decision.
