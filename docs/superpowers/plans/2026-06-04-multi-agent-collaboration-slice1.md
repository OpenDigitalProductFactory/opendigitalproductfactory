# Plan — Multi-Agent Collaboration & Visibility, Slice 1

| Field | Value |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-06-04-multi-agent-collaboration-visibility-design.md` |
| Epic | `EP-A2A` |
| Scope | Slice 1 only — conversational multi-agent (G1 + G2). **No migration.** |
| Build gate | vitest + `pnpm --filter web typecheck` + `cd apps/web && npx next build` + UX verification on canonical install |

## Outcome

A coworker can request a named peer/sub-agent and the user **sees the handoff inline** with a question-packet summary; the user can **summon a specific coworker** as a tier-2 participant from the chat. Every handoff resolves to a real `AgentEvent` + `TaskRun` (trace integrity). Pure projection + two governed tools + bus discriminants + UI — no schema migration.

## Phase 1 — Canonical event discriminants (foundation seam)

Everything else projects from these. Land first.

1. **`apps/web/lib/tak/agent-event-bus.ts`** — extend the `AgentEvent` union with `collaboration:handoff`, `collaboration:summon`, `collaboration:return`. Payloads carry `{ threadId, parentParticipantId, fromAgentId, toAgentId, taskRunId, tier, questionPacketSummary?, enteredVia }`. Follow the strongly-typed-enum rule (AGENTS.md §3): update the canonical union + any `as const` discriminant list in the same commit.
2. **Vitest** — add discriminant-coverage test (exhaustiveness) mirroring the existing bus tests so a new discriminant without a handler fails the build.

Gate: `pnpm --filter web typecheck` + targeted vitest.

## Phase 2 — `ConversationParticipant` projection (read-model, no table)

3. **`apps/web/lib/tak/conversation-participants.ts`** (new) — `projectParticipants(rootThreadId)` computing the roster from `AgentThread` (`parentThreadId`/`childCount`), `TaskRun` (`parentTaskRunId`, `status`→`TaskState` via `task-states.ts`), and `AgentMessage.agentId`. Resolve actor identity via `PrincipalAlias` (AGENTS.md §11) — never `Agent.id`. Returns `ConversationParticipant[]` per the spec's type. Roles: route-resolved owner = `owner`; summoned = `peer`; spawned = `sub-agent`.
4. **Vitest** — fixtures: single-coworker (owner only), owner+one spawned sub-agent, owner+summoned peer+nested sub-agent (tier depth).

Gate: typecheck + vitest.

## Phase 3 — Governed handoff & summon tools

5. **`apps/web/lib/mcp-tools.ts`** — add `request_coworker` (coworker-initiated) and `summon_coworker` (user/UI-initiated). Both reuse `spawnWorkThread()` (`agent-threads.ts`) for thread/TaskRun creation and route through `mcp-governed-execute.ts`. `request_coworker` carries the question-packet payload shape (`intentCenter`, `explorationQuestions`, `hardEdges`, `contextRefs`, `successShape`, `expectedArtifact`) per the A2A spec; emit `collaboration:handoff` on success.
6. **`apps/web/lib/tak/agent-grants.ts`** — add `TOOL_TO_GRANTS` entries for both tools (new grant keys, e.g. `coworker_collaborate`); update the MCP tool `enum`/grant declarations in the same commit (§3).
7. **Slice-1 authority posture**: `request_coworker` to a target outside the caller's `delegatesTo`/`escalatesTo` runs `executionMode: "proposal"` (PAR acknowledge). *Hard enforcement (denial + DelegationChain hop write) is Slice 2* — Slice 1 makes it visible and proposal-gated, not yet denied.
8. **Vitest** — tool-definition tests (schema, grant mapping, enum coverage) following existing mcp-tools test patterns.

Gate: typecheck + vitest.

## Phase 4 — `AgentCoworkerPanel` UI

9. **`apps/web/components/agent/ConversationParticipantRail.tsx`** (new) — compact roster: owner + active peers/sub-agents, per-participant `state` chip via report-kit `StatusBadge` + `statusColors` (no hand-rolled badge, AGENTS.md §12). Tier shown as depth indicator. Reduced-motion + ARIA roles/labels first-class.
10. **`apps/web/components/agent/HandoffCard.tsx`** (new) — inline message-stream card rendering `collaboration:handoff` ("🤝 *A* asked *B* to …") with expandable question-packet summary + link into the sub-task. Theme tokens only.
11. **`apps/web/components/agent/CoworkerSummonPicker.tsx`** (new) — coworker picker backed by the agent registry / AgentCard projection, gated by the viewer's capabilities; `@mention` affordance in the input. Wire to a `summonCoworker` server action calling `summon_coworker`.
12. **`apps/web/components/agent/AgentCoworkerPanel.tsx`** — consume the existing `/api/agent/stream` SSE; merge `collaboration:*` events into participant state + render the rail, handoff cards, and picker. **No parallel WebSocket.**
13. **Vitest/component tests** — rail renders roster from projection; reduced-motion renders static state chips with labels (axe-core pass); handoff card has no dead link (trace-integrity).

Gate: typecheck + vitest.

## Phase 5 — Build gate + UX verification (final)

14. `cd apps/web && npx next build` (zero errors) routed through the canonical local install or shared local-CI convergence sandbox (AGENTS.md §5) — not the worktree harness.
15. **UX verification** on the running portal: drive a conversation where a coworker calls a peer; confirm the handoff renders inline with the question-packet summary and the participant rail updates; summon a second coworker as tier-2 and confirm it joins. Capture as dynamic-analysis evidence (drove X / observed Y / signed off Z), per founder feedback — not screenshots.
16. `record_execution_evidence` for build + UX gates, naming the substrate.

## PR hygiene (AGENTS.md §4)

- Branch already a topic branch; one concern. DCO `Signed-off-by:` on every commit (`git commit -s`). Squash-and-delete on merge. Branch guard before commit. Sweep recent main + open PRs for overlap before pushing (concurrent-session discipline).

## Explicitly out of scope (later slices)

- Hard `delegatesTo`/`escalatesTo` denial + `DelegationChain` hop writes → Slice 2.
- Operations Map `Transfer` overlay + collaboration-graph inspector → Slice 2.
- `CollaborationPattern` aggregation + Process Observer feed + codification candidates → Slice 3.
- `TaskMessage`/`TaskArtifact` persistence → owned by the A2A-aligned runtime cutover (this slice projects from `TaskRun`/`AgentThread`; re-points later).
