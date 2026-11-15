---
status: draft
---

# Absorbing T3 Code: the platform's own coding capability (rung 0)

**Backlog:** BI-FCEB5C22 (epic EP-INPLATFORM-CODING; delivery-xlarge, decomposed below and never implemented directly). This design record is its doc slice BI-4A269553. **Related:** BI-9816A49D records the owner's rung-0 ruling in WWMD. [Agent dialog broker](2026-10-27-agent-dialog-broker-design.md) (BI-C9C4F5ED): rooms are how agents talk to each other, and every slice below keeps them working ([§ Rooms and agent dialog](#rooms-and-agent-dialog-what-every-slice-carries-forward), BI-FD5D9302).
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
| **Agent-to-agent dialog** | Threads talk only to their own user. A subagent reports back to the thread that spawned it. No shared room, addressing or cross-installation dialog. | Work Rooms: GAID-addressed messages with a per-participant cursor; wake for in-platform coworkers (bounded by a hop limit and an hourly budget); push to connected MCP clients; supervised sessions receive addressed messages as turns; A2A binding between installations. | **Keep.** DPF is ahead here. Every slice that rebuilds a path rooms run on carries rooms forward (see [§ Rooms and agent dialog](#rooms-and-agent-dialog-what-every-slice-carries-forward)). |

**What DPF learns from T3:** to make intent durable before acting; to give server-originated work deterministic ids; to model executors as drivers and instances with explicit capabilities; to treat plan windows as first-class, live data; to keep execution where the files are; and to grant agents a ceiling, not a list.

**What DPF keeps:**
- one queue and one Workroom authority;
- owner-scoped propose-then-acknowledge;
- GPP consequence gates and profession review;
- portfolio budgets;
- a sandboxed default posture;
- Work Rooms as the one place agents and people talk, addressed by GAID.

## Adopt the code or reproduce it, per capability

Owner direction (2026-11-13, verbatim): "we need to take as much as makes sense", and "this is still [the owner's organization], and still Open Digital Product Factory at the end of the day. We need to take what makes sense and merge it in tightly, no seams, no extra UX where not needed."

Each capability below was weighed on the same four questions:
- **Licence and provenance.**
- **Upstream velocity.** Copied code must be tracked or forked.
- **Audience fit.** T3 targets developers; DPF serves non-technical people running a company.
- **Fit with workrooms, GPP and expert review.**

Each row also carries the seams check: where the user meets the capability, and which existing DPF surface carries it.

Code-level detail, read at the pinned build, is in the 2026-11-13 capability notes. Almost everything in T3 is built on Effect (effect-ts) and its own SQLite orchestrator. Even its most separable parts, the protocol clients, are mostly generated code bound to Effect. So the general answer is to reproduce T3's design, which its own docs describe precisely. The exceptions are small permissively licensed tools taken as pinned internal dependencies.

Items are in rung-0 order: what most helps the platform improve itself comes first.

| Rank | Capability | Verdict | What is adopted as code | Where the user meets it (existing surface) | Decision | Item |
|---|---|---|---|---|---|---|
| 1 | Driving native AI tools (Claude Code, Codex, ACP agents) | Reproduce one driver per client | Pinned: `@agentclientprotocol/sdk` (Apache-2.0); Codex app-server bindings generated by the Codex CLI itself. Not taken: Anthropic's proprietary Agent SDK (Claude is driven through its CLI) | Workroom executor binding, Build Studio dispatch | DI-300A68C07417 | BI-A01B06F6 (S3) |
| 2 | Thread detail reaching every surface | Reproduce a run/node/turn-item projection on the Workroom log | None | Workroom live feed, room messages, handover record | DI-1BA9FAAEF942 | BI-F7AF4A36 |
| 3 | Delegation across providers (A2A) | Extend DPF's own A2A and `spawn_subagents`. DPF is ahead here: T3 has no A2A or Agent Cards | None | Nested-room coordination panel, coworker profile | DI-D7BF0C933D30 | BI-7DBE498F (related: BI-ADB5CC1C) |
| 4 | Keeping the native AI tools updated in the background | Reproduce T3's rules in DPF's signed host job | None | Ops fleet readiness | DI-606CBA71B78A | BI-EE14AB91 |
| 5 | Agent work inside the product | Reproduce T3's interaction rules, not its ~220k lines of developer components | None | Workroom page, Build Studio change band, Attention | DI-C908AF84424F (the ux-design corpus had no guidance; gap CWN-EC09A52A) | BI-0C13668F |
| 6 | Phone and iPhone | Reproduce the app features in the existing Expo app. Adopt the simulator tools pinned | Pinned behind a DPF host adapter: `expo-device-hub` (MIT), `agent-device` (MIT), `serve-sim` (Apache-2.0) | Phone app Approvals and Ops tabs and push; Build Studio "preview on phone" | DI-C908AF84424F, DI-1203951984C7 | BI-9BB90708 (related: BI-CA9A49AB) |
| — | Everything else (scheduled tasks and webhooks, browser automation, voice, PR review guides, idle compaction, managed policy) | Keep DPF's equivalents, or reproduce when needed | None. Not taken: T3's terminal for owners, its relay, sign-in and telemetry services | Ops, Build Studio, coworker chat | — | — |

What no capability brings into the product:
- **No T3 identity.** Absorbed capabilities appear as Open Digital Product Factory capabilities.
- **No new app or screen.** The six rows land in surfaces that already exist.
- **Attribution stays out of the UX.** It lives in source headers and `THIRD-PARTY-NOTICES` / NOTICE, as the licences require.

## Rooms and agent dialog: what every slice carries forward

The [agent dialog broker](2026-10-27-agent-dialog-broker-design.md) is built and live:
- **A**: read newest-first with a cursor;
- **B**: addressed delivery and wake (BI-31C1FDEC; a coworker that cannot post is not woken, BI-8747A73D);
- **C**: push to connected MCP clients (BI-ED52AB82);
- **D**: a supervised session receives an addressed message as its next turn (BI-F5D58F29), and its replies count against the room's hop limit (BI-FDE1B10C);
- **E**: the A2A dialog binding between installations (BI-ADB5CC1C, in progress).

Several slices rebuild the paths these run on, so each carries these requirements. They come from the broker design and add nothing new.

| Slice | Must keep | How it lands |
|---|---|---|
| S2 runtime core | A message's wake is decided exactly once; a supervised turn is delivered at most once; restart re-attach and `supervision-lost` | Room delivery becomes `WorkroomEffect` outbox rows written in the same transaction as the decision. That replaces the wake state written on the message and the claim-before-turn guard (`claimPendingWake`) with the outbox's own exactly-once. Effects tied to a lost session are retired; the message stays readable from the cursor. |
| S3 one driver per client | The supervised-session port (`SupervisedSessionPort`: `isLive`, `deliver`, in `supervised-turn-delivery.ts`), the `addressedAs` qualifier, `deliveredCursor`, and the turn prompt (addressed message, sender GAID, case key, up to 20 room-wide messages since the cursor) | Each driver implements the port. Room delivery calls the driver; it does not know which client sits behind it. |
| Executor instances (S3, C3) | One identity per subject (GAID §6.9) | An instance is operating state of its client's GAID, never an identity: `gaid:…:agt-ext-codex#instance=<id>`, with `#session=<thread>` as today. Routing, delegation to a specific executor (C3) and room addressing all use that form. Instance ids appear on no message as a sender identity. |
| S5 workroom-bound toolset | A session in a room can read and post there, and subscribe to its messages | The room ceiling always includes `read_room_messages`, `post_room_message` and the room's message resource. The per-session token also identifies the session, so a session's posts carry `senderSession` from the token rather than from the starter's room token. This simplifies BI-FDE1B10C's matching. |
| S6 execution hosts | An addressed message reaches the session wherever it runs | A supervised session on a device host is reached through that host's route. The host reports liveness and re-attaches after its own restart. Broker §7.2 states the delivery rules. A desktop session that a host now supervises becomes deliverable instead of `held-for-executor`. |
| S7 context handoff | Nothing a room participant said is lost at handover | The handoff record's budgeted messages are drawn from the room's messages since the receiver's cursor, plus the outgoing session's own turns. |
| C2 thread detail | One message stream per room | Turn items project onto the Workroom log. Room messages stay `WorkItemMessage` rows, and the feed shows both without copying either into the other. |
| C3 delegation (A2A) | One binding for agent-to-agent work across installations | Delegation to a specific executor goes through the A2A dialog binding (BI-ADB5CC1C) and `TaskRun`, not a second channel. |
| S9 rung-0 loop | Self-work stays inside the room's bounds | Autonomous self-dispatch runs through rooms: the hop limit and hourly wake budget apply. Coworkers it relies on need `work_room_write`; whether every coworker gets it by default is the owner's open decision BI-022026AB (8 of 132 coworkers could post on 2026-11-12). |

**Convergence with DPF2's OS layer.** DPF2 records the same direction in its own plan (owner decisions of 2026-11-13: T3 absorbed as DPF2's working core; OS-layer placement). There, the protected launcher starts each agent process with its identity (GAID and principal), its access (the permit, enforced as containment) and its corpus. Two slices here land on that model:
- S5's per-session ceiling and token are the DPF form of that launcher property;
- S6's execution hosts are where such a launcher runs.

The `#instance=` and `#session=` qualifiers above match it: a process carries its subject's GAID, and the qualifier names its operating state. DPF2's open questions (where WWMD and WWWD sit relative to the OS-layer corpus; one transport for peer links and linked environments) belong to DPF2's plan and are not answered here.

## Target architecture

1. **Workroom runtime core.** Adopted from T3's Orchestrator, EventSink and EffectWorker. Built in S2 (BI-C64EDA33, plan `docs/superpowers/plans/2026-11-14-workroom-runtime-core.md`).
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

T3 runs on the owner's Mac, a Windows desktop and an iPhone client. The Mac and the Windows machine are linked with full access until 7 December. Nothing in this plan stops T3 before its device's replacement is proven, and the owner keeps using T3 meanwhile.

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
| C2 | BI-F7AF4A36 | Thread-detail projection | S2 |
| C3 | BI-7DBE498F | Delegation to a specific executor | S3 |
| C4 | BI-EE14AB91 | Background client updates | S3 |
| C5 | BI-0C13668F | Agent work in existing surfaces | C2, S4 |
| C6 | BI-9BB90708 | Phone and iPhone | C5, S6 |

Rung-0 build order: S2 → S3 → C2 → S4 → S5 → C3 → C4 → S6 → C5 → S7 → S8 → C6 → S9.

Each slice's acceptance includes the room requirements in [§ Rooms and agent dialog](#rooms-and-agent-dialog-what-every-slice-carries-forward). The broker's existing tests for wake, push and supervised turns must pass after S2, S3 and S6.

## Objectives and acceptance

- **AC-1.** Every T3 capability the owner uses has a DPF home, delivered by a slice above: driving plan sessions, plan windows and resets, multi-device use, handover, recovery and agent tools.
- **AC-2.** Each adopt-or-keep choice has a recorded decision. The comparison table is kept current as slices land.
- **AC-3.** Ported code carries T3's MIT notice and a pinned provenance line. No proprietary or copyleft component is taken.
- **AC-4.** The paired Dev install and each of the owner's devices keep working through the move: no forced stop, and history stays readable.
- **AC-5.** T3 is retired on each device only after two weeks at parity.
- **AC-5b.** After S2, S3, S5 and S6, the room features A–D still work: an addressed coworker is woken or refused with a reason, a connected client hears a new message, and a supervised session, on the portal or on a device host, receives an addressed message as its next turn exactly once.
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
