# Work Room as the Multi-Agent Collaboration & Communication Substrate — Design

**Status:** DRAFT (for founder review) · **Date:** 2026-08-12 · **Scope:** platform (WWMD)
**Relationship:** sibling to EP-WORK-CONVERGENCE (Universal Work Formula); augments the **Agentic Work Case (AWC)** standard candidate (BI-AADFFCAF); extends the Work Rooms projection (`2026-07-26-work-rooms-collaboration-design.md`), the A2A coordination layer (`2026-08-11-a2a-coordination-layer-design.md`), and federated GAID (`2026-08-08-federated-a2a-gaid-coordination-design.md`).
**Verified against:** `origin/main` @ `9fd5ce3ae` (2026-08-12).
**Kernel ratification (WWMD, `principle_decide`, external_coding_agent, HIGH confidence, no commandment conflict):**
- Phasing → **intra-first** (Phase 1 intra-install bus, Phase 2 GAID/A2A federated) · ledger **DI-A92A7184020F** (composite 3.89, margin 2.59). Full-federated-upfront lost on Least-Privilege and Outbound-Irreversible-Requires-Go.
- Coordinator → **first-class role** · ledger **DI-1C65C5205848** (composite 9.02, margin 4.33). Drivers: Orchestrator-Worker Pattern, Single Source of Truth, Principle-Based Rules Over Enumeration.
**Research & Benchmarking:** inherits the standards survey behind AWC (A2A / MCP Tasks / OMG CMMN / RACI-DACI; access 2026-08-12). Group chat + membership-scoped channels are the mainstream collaboration pattern (Slack channels, Teams, Matrix rooms); the novel layer here is **outcome-scoped membership for a human+AI mix**, which no surveyed standard defines.

---

## 0. Problem & thesis

Today every cross-agent interaction in DPF is **point-to-point or discrete orchestration**: `request_coworker` / `summon_coworker` / `spawn_work_thread` are pairwise; `start_deliberation` / debate is a discrete fan-out/fan-in vote-gather; and the A2A coordination layer deliberately chose *proposal-based, non-room* coordination. The Work Room is a **human-facing read-model projection** — `WorkItemMessage.senderType` can name an `"agent"`, but there is **no agent write path, no agent read/subscribe path**, and notifications are user-only. (Verified: `post-work-item-comment.ts` is human-`auth()`-gated; the "agent pull channel" is described in comments but has no consumer.)

**Thesis:** make the **Work Room the shared communication substrate** that participants — the local CLI client, in-platform AI coworkers, humans, and (later) external federated agents — **join and post to**, replacing much discrete A2A request/response with a common **broadcast-to-a-room-the-members-subscribe-to** pattern. A2A is not discarded; it becomes the **transport underneath** the room across sovereignty boundaries. This is the runtime realization of the AWC "collaboration room" layer.

Two regimes under one room abstraction:
- **Intra-install** (same trust boundary — local client + in-platform coworkers + humans): a **direct shared-room bus**. Agents and people join, post, and subscribe to the room feed.
- **Cross-install** (external federated agents/people): the **room is the shared semantic space; A2A stays the sovereign wire.** A remote participant's join/posts arrive as A2A messages the install **mirrors into** the room ("apply-by-proposal, never remote write" preserved). A2A `contextId` ⇄ room id.

---

## 1. Membership is any composition, governed by exposure and room-scoped rights (founder correction)

A room's participants may be **all people, all agents, or any mix.** Composition is not a fixed axis — it is whatever the room's membership admits.

**Joining is predicated on exposure + rights, scoped to the room, and outcome-specific.** A principal (person *or* agent) is admitted to a room only for **that room's outcome** — never broadly. This outcome-scoping is not incidental; it is **the mechanism that keeps a room on-task and focused**, and it is load-bearing in the room's definition.

- **Worked example (founder):** an HR management staff-planning room admits only management **and** AI agents specifically cleared for that HR room — no other person or coworker can join, discover, or post.
- **This reuses the room authorization model that already exists.** `authorizeWorkRoomAccess` (`room-participation.ts`) resolves a principal to `none < discover < content < action` from: admission, `discoverablePrincipalRefs`, and `sensitivityClearance` ≥ the room's `sensitivityCeiling`. The room's **boundary** (`purpose / outcome / scope / participants / accountable / authority / sensitivity / closure-rule`) is where the outcome and its clearance ceiling are declared. **Extension:** apply this identical model to **agent** principals (today it is wired for humans), and make it govern the new agent **join / post / subscribe** rights — not just read visibility.
- **Rights are per-room and outcome-derived, not global.** A coworker cleared for the HR room is not thereby cleared for a finance room. This is least-privilege applied to collaboration: exposure to the room is the grant; the outcome bounds it. → aligns with the coworker authority model (EP-31815F97, TAK/GAID) and `least-privilege-deny-by-default`.

---

## 2. The Coordinator — a first-class role (new)

Every room has a **Coordinator**: the participant (human **or** AI) responsible for **keeping the room on-task and focused to its outcome** — admitting/curating participants, sequencing turns, driving the room to a verdict / close / escalation, and preventing drift. Today this is informal ("the active coworker coordinates peers"); it must be explicit.

- **Add `coordinator` to `WorkRoomParticipantRole`** (currently `accountable | contributor | reviewer | observer`). The Coordinator is distinct from the **Accountable** principal: *accountable* owns the outcome; *coordinator* runs the room. They may be the same principal or different (e.g. an accountable human delegates coordination to a facilitator coworker).
- **Maps to DACI "Driver"** and to the orchestrator half of the Orchestrator-Worker kernel pattern — cite as prior art in the AWC role vocabulary.
- **Responsibilities are governed, not cosmetic:** the Coordinator's admit/turn/close actions are `WORK_CASE_ACTION_VERBS` (governed-action, receipted). A Coordinator cannot admit a participant the room's clearance ceiling would exclude — coordination operates *within* the boundary, never around it.
- Exactly one active Coordinator per room at a time (mirrors the single-active-cycle invariant); handoff is a `coworker-handoff` activity.

---

## 3. Room lifecycles — standing rooms and short-lived sub-task rooms

Both existing room modes carry this substrate:
- **Standing rooms** (e.g. the HR planning room): long-lived, membership-governed, cycles of work over time.
- **Finite sub-task rooms** (founder): a room spun up **for a bounded purpose — e.g. to debate a topic** — whose close produces a recorded outcome. Two terminal shapes:
  1. **Decision recorded on the verdict** — the room's `WorkRoomOutcomePacket` seals the decision; the verdict is written to the `DecisionInteraction` ledger (WWMD/WWWD/WSID as scoped). The debate *is* the deliberation, now conducted **in a room** rather than as a discrete vote-gather.
  2. **Escalation trigger** — the room closes by escalating (an attention item / a governed hand-up), when the outcome exceeds the room's authority.

**Debate/deliberation moves onto rooms.** `start_deliberation` today materializes a discrete branch topology and gathers votes; under this design a debate is a **finite sub-task room** whose participants (role branches) are room members posting to the shared feed, and whose consensus/verdict seals the OutcomePacket. This unifies the debate pattern with the collaboration substrate instead of maintaining a parallel orchestration.

---

## 4. Communication mechanics (intra-install, Phase 1)

The unwired path, made real — **reusing the message store and activity vocabulary, not a new chat product:**
- **Agent write:** a governed MCP tool (`post_room_message`) lets an admitted agent principal write a `WorkItemMessage` with `senderType: "agent"` into a room it has `action` rights on. Governed by §1 (must be admitted + cleared) and receipted.
- **Agent read/subscribe:** a room-keyed feed + subscribe/notify for agent members (extend the per-thread `agent-event-bus.ts` to a **room-keyed** bus; deliver room posts to subscribed coworkers via their pull channel — the consumer that `mentionedAgentIds` lacks today).
- **Presence for agents:** extend `WorkItemPresence` / heartbeat to agent principals (today human-`auth()`-only), so "who is in the room" includes live coworkers.
- **Local CLI client joins:** the external CLI session (this Claude Code / Codex / Grok) joins the room for its work as a **participant that can post**, in addition to its `WorkCapsule` carrier role (which stays the durable coding record behind the room per the convergence addendum D3). The capsule is the *work record*; room membership is the *communication act*.
- **Activity kinds already exist:** `message`, `ask`, `coworker-joined`, `coworker-left`, `coworker-handoff` are already in `room-types.ts` — the schema is shaped for this; only the write/read/subscribe paths are missing.

---

## 5. Cross-organizational participants (Phase 2 — GAID-gated)

Cross-org room participation is **the mature use case, unlocked when GAID is in place.** External participants — **agents or people, exactly like an external human guest** — may join a room, but:
- **Never carte-blanche.** Admission is **outcome-specific per room**, GAID-authenticated, and bounded by the room's clearance ceiling — the same §1 model, extended across the sovereignty boundary.
- **Sovereignty preserved:** a foreign participant does not write to your store directly. Their join/posts arrive as **A2A messages the install mirrors into the room** (coordinate-by-proposal / apply-by-proposal). The room is the shared semantic space; A2A is the sovereign wire; GAID is the identity that makes an external principal admissible.
- **Ties to** EP-8B03CB06 (edge reachability / MCP-A2A boundary) and the federated GAID spec. Phase 2 explicitly follows Phase 1 so the intra-install bus is proven before the sovereignty wire is touched.

---

## 6. Standards augmentation (keep an eye on our candidates)

This design is the **runtime of the AWC collaboration-room layer** — it should feed and sharpen **BI-AADFFCAF (AWC standard candidate)**, not diverge from it:
- **Membership/roles → AWC + A2A + RACI/DACI:** the participant model (person/agent/system/external, roles incl. **coordinator**) and outcome-scoped admission become normative AWC content; align `coordinator` to DACI Driver.
- **Room id ⇄ A2A `contextId`:** propose the room as the shared context that groups A2A task messages — the interop hook for cross-install rooms.
- **A2A stays transport; room is the semantic layer** — consistent with the ratified `author-awc-composition` decision (DI-149854BD4A55): compose over A2A, don't fork it.
- Standing review item: revisit as A2A / MCP Tasks / any Linux-Foundation agentic-room work evolves, so AWC augments rather than duplicates.

---

## 7. Decisions (kernel-ratified) + one still open

1. **Phasing → intra-first** (kernel DI-A92A7184020F). Phase 1: intra-install bus. Phase 2: cross-install/GAID. Prove the bus before the sovereignty wire.
2. **Coordinator → first-class role** (kernel DI-1C65C5205848). Add `coordinator` to `WorkRoomParticipantRole`.
3. **Debate substrate** *(open — recommend move-onto-rooms)* — move `start_deliberation`/debate onto finite sub-task rooms whose verdict seals the OutcomePacket + `DecisionInteraction`, vs. keep the discrete orchestration and only project it as a room. Lower-stakes; resolve during Phase 1 planning.

## 8. Non-goals
- Not a new chat product, message store, identity system, or authorization model — reuse `WorkItemMessage`, the room projection, `authorizeWorkRoomAccess`, and GAID.
- Not carte-blanche cross-org access — membership is always outcome-scoped and clearance-bounded.
- Not discarding A2A — it remains the sovereign transport beneath cross-install rooms.
- Not removing the WorkCapsule — it stays the durable coding carrier behind a coding room (convergence addendum D3).

---

## 9. Delivered state (2026-08-27, BI-B986A18B)

Phase 1's §4 mechanics were already in source before this entry: `post_room_message`,
`read_room_messages`, `invite_room_participant` (agents *and* people),
`resolveAgentRoomAccess` (discover/content/action), the `coordinator` role, and
join-on-post presence. The bus was built.

It had never carried traffic, and the reason was one field. Every `McpApiToken`
row on the reference install had `agentId = NULL`, and every room handler
resolves its caller from `context.agentId`. So **no external CLI agent had ever
been able to join, post to, or read a room** — not by policy, by three
hardcoded nulls in `apps/web/lib/actions/mcp-tokens.ts` and a missing control in
`McpTokenManager.tsx`.

Measured before the repair: **6 `WorkItemMessage` rows in total, against 604
`TaskMessage` rows.** A single external thread ran ~58h over two days and sent
**235** of its ~284 coordination messages through its vendor's own task bus —
peer-to-peer injections into other agents' context windows — because the room it
should have used was closed to it. That is the cost of the gap this section
closes, and it is the concrete argument for §0's thesis.

**Delivered:** external-CLI registry identities (`AGT-EXT-CLAUDE`,
`AGT-EXT-CODEX`, `AGT-EXT-GROK`) with `work_room_read` / `work_room_write`;
`agentId` bound on templated issuance and preserved across rotation; an
**Acts as coworker** control on the token form; the binding surfaced on the
token list so an anonymous token is visible rather than silent.

**Unchanged, deliberately:** admission. Binding grants identity, not room
access — §1's outcome-scoped, clearance-bounded membership is untouched, and a
token with no binding is still refused. Nothing here is fail-open.

**Still open:** room-keyed subscribe/push (§4 "agent read/subscribe" is served
by pull today), agent presence beyond join-on-post, the participant relation and
multi-holder occupancy (BI-D4C110BC), and all of Phase 2 (§5).
