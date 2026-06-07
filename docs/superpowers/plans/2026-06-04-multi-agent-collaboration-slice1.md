# Plan — Multi-Agent Collaboration & Visibility, Slice 1

| Field | Value |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-06-04-multi-agent-collaboration-visibility-design.md` |
| Epic | `EP-A2A` |
| Scope | Slice 1 only — conversational multi-agent (G1 + G2). **No migration.** |
| Build gate | vitest + `pnpm --filter web typecheck` + `cd apps/web && npx next build` + UX verification on canonical install |

## Outcome

The active coworker can request or summon a named peer/sub-agent and the user **sees that activity inline** with a one-line summary of what each peer is tasked with. Choosing and tasking peers is the active coworker's job; the user-facing surface is **visibility only** (no picker, dropdown, or objective entry — corrected 2026-06-06). Every handoff/summon resolves to a real `AgentEvent` + `TaskRun` (trace integrity). Pure projection + two coworker-initiated governed tools + bus discriminants + read-only UI — no schema migration.

## Phase 1 — Canonical event discriminants (foundation seam)

Everything else projects from these. Land first.

1. **`apps/web/lib/tak/agent-event-bus.ts`** — extend the `AgentEvent` union with `collaboration:handoff`, `collaboration:summon`, `collaboration:return`. Payloads carry `{ threadId, parentParticipantId, fromAgentId, toAgentId, taskRunId, tier, questionPacketSummary?, enteredVia }`. Follow the strongly-typed-enum rule (AGENTS.md §3): update the canonical union + any `as const` discriminant list in the same commit.
2. **Vitest** — add discriminant-coverage test (exhaustiveness) mirroring the existing bus tests so a new discriminant without a handler fails the build.

Gate: `pnpm --filter web typecheck` + targeted vitest.

## Phase 2 — `ConversationParticipant` projection (read-model, no table)

3. **`apps/web/lib/actions/agent-threads.ts`** — `spawnWorkThread()` currently hardcodes `parentTaskRunId: null` on the child `TaskRun` (verified). Populate it with the parent thread's `TaskRun` id so the task graph is complete. Low-risk one-field change; add a regression test asserting the child `TaskRun.parentTaskRunId` is set. (Lineage today rides `AgentThread.parentThreadId`; this makes the `TaskRun` graph match.)
4. **`apps/web/lib/tak/conversation-participants.ts`** (new) — `projectParticipants(rootThreadId)` computing the roster from **`AgentThread.parentThreadId`** (the load-bearing edge) + `TaskRun.status`→`TaskState` (via `task-states.ts`) + `AgentMessage.agentId`. Resolve actor identity via `PrincipalAlias` (AGENTS.md §11) — never `Agent.id`. Returns `ConversationParticipant[]` per the spec's type. Roles: route-resolved owner = `owner`; summoned = `peer`; spawned = `sub-agent`.
5. **Vitest** — fixtures: single-coworker (owner only), owner+one spawned sub-agent, owner+summoned peer+nested sub-agent (tier depth).

Gate: typecheck + vitest.

## Phase 3 — Governed handoff & summon tools

5. **`apps/web/lib/mcp-tools.ts`** — add `request_coworker` (coworker-initiated) and `summon_coworker` (user/UI-initiated). Both reuse `spawnWorkThread()` (`agent-threads.ts`) for thread/TaskRun creation and route through `mcp-governed-execute.ts`. `request_coworker` carries the question-packet payload shape (`intentCenter`, `explorationQuestions`, `hardEdges`, `contextRefs`, `successShape`, `expectedArtifact`) per the A2A spec; emit `collaboration:handoff` on success.
6. **`apps/web/lib/tak/agent-grants.ts`** — add `TOOL_TO_GRANTS` entries for both tools (new grant keys, e.g. `coworker_collaborate`); update the MCP tool `enum`/grant declarations in the same commit (§3).
7. **Slice-1 authority posture**: declare `request_coworker` with `executionMode: "proposal"` so the **agentic-loop proposal break** (`apps/web/lib/tak/agentic-loop.ts`, `toolDef.executionMode === "proposal"` + `autoApproveWhen`) — *not* the `mcp-governed-execute.ts` capability×grant gate — surfaces a PAR-acknowledge card when the target exceeds the owner's delegation scope. *Hard enforcement (denial + DelegationChain hop write, building on the existing `delegation-authority.ts` chain enforcement) is Slice 2* — Slice 1 makes it visible and proposal-gated, not yet denied.
8. **Vitest** — tool-definition tests (schema, grant mapping, enum coverage) following existing mcp-tools test patterns.

Gate: typecheck + vitest.

## Phase 4 — `AgentCoworkerPanel` UI

9. **`apps/web/components/agent/ConversationParticipantRail.tsx`** (new) — compact roster: owner + active peers/sub-agents, per-participant `state` chip via report-kit `StatusBadge` + `statusColors` (no hand-rolled badge, AGENTS.md §12). Tier shown as depth indicator. Reduced-motion + ARIA roles/labels first-class.
10. **`apps/web/components/agent/HandoffCard.tsx`** (new) — inline message-stream card rendering `collaboration:handoff` ("*A* asked *B* to …") with the question-packet summary + link into the sub-task. Theme tokens + lucide icons only.
11. **~~`CoworkerSummonPicker.tsx`~~ (removed 2026-06-06).** The original plan built a human picker (coworker dropdown + objective field) wired to a user-facing summon action. Per Mark's correction, choosing/tasking peers is the active coworker's responsibility, not the human's — so there is no picker. Summon is a coworker-initiated MCP tool (`summon_coworker`); the user-facing surface is the read-only `CollaborationActivityPanel`.
12. **`apps/web/components/agent/AgentCoworkerPanel.tsx`** — consume the existing `/api/agent/stream` SSE; merge `collaboration:*` events into participant state + render the read-only collaboration disclosure (roster + handoff/summon/return cards), each attributed to the active coworker as source. **No parallel WebSocket. No human entry controls.**
13. **Vitest/component tests** — rail renders roster from projection; reduced-motion renders static state chips with labels (axe-core pass); handoff card has no dead link (trace-integrity).

Gate: typecheck + vitest.

## Phase 5 — Build gate + UX verification (final)

14. `cd apps/web && npx next build` (zero errors) routed through the canonical local install or shared local-CI convergence sandbox (AGENTS.md §5) — not the worktree harness.
15. **UX verification** on the running portal: drive a conversation where the active coworker calls a peer and brings in a second coworker as tier-2; confirm both render inline with their one-line task summaries, attributed to the active coworker (not "You"), and that the roster updates. Confirm there is no human picker/dropdown/objective control on the panel. Capture as dynamic-analysis evidence (drove X / observed Y / signed off Z), per founder feedback — not screenshots.
16. `record_execution_evidence` for build + UX gates, naming the substrate.

## PR hygiene (AGENTS.md §4)

- Branch already a topic branch; one concern. DCO `Signed-off-by:` on every commit (`git commit -s`). Squash-and-delete on merge. Branch guard before commit. Sweep recent main + open PRs for overlap before pushing (concurrent-session discipline).

## Explicitly out of scope (later slices)

- Hard `delegatesTo`/`escalatesTo` denial + `DelegationChain` hop writes → Slice 2.
- Operations Map `Transfer` overlay + collaboration-graph inspector → Slice 2.
- `CollaborationPattern` aggregation + Process Observer feed + codification candidates → Slice 3.
- `TaskMessage`/`TaskArtifact` persistence → owned by the A2A-aligned runtime cutover (this slice projects from `TaskRun`/`AgentThread`; re-points later).
