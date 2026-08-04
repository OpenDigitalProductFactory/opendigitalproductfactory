# Inter-coworker collaboration contract inventory (A2A-aligned) — BI-D5348705

| Field | Value |
|-------|-------|
| **Status** | Research + inventory (Phase 0–2 of BI-D5348705) |
| **Date** | 2026-08-04 |
| **Epic** | EP-COWORKER-INTERACTIVITY |
| **Related** | BI-A08EBAEC (MCP efficiency twin), BI-65B0D697 / EP-AI-OPSMAP (ops-map A2A visibility), BI-9DB7C332 / EP-A2A (capture/runtime), GAID §11.5, TAK §3.1 |
| **Operator surface** | `/platform/ai/operations-map` — unified coworker/provider/A2A canvas |

## 1. A2A vs MCP (framing for operators)

| | **MCP** | **A2A (Agent2Agent)** |
|--|---------|----------------------|
| **Who talks** | Agent ↔ **tools / data / platform APIs** | Agent ↔ **agent** (coworker ↔ coworker) |
| **Typical question** | Call a tool, list resources | Hand off work, share task state, fan-out deliberation |
| **Wire world** | MCP JSON-RPC (e.g. DPF `/api/mcp/v1`) | Open A2A: agent cards, tasks, artifacts (Google A2A / AAIF) |
| **In DPF today** | First-class governed tool plane + ToolExecution ledger | **Internal coordination** projected as A2A *edges* on the ops map — not a full reimplementation of A2A wire |
| **Doctrine** | Profile onto tools + grants | Profile onto handoffs / task lineage / delegation under TAK/GAID; **not** a substitute for runtime governance |

**Analogy:** MCP is the phone book for *tools*. A2A is how *coworkers hand work to each other* with authority and evidence.

**Adopt / reject (standards):**

| Choice | Verdict | Why |
|--------|---------|-----|
| Map DPF coworker coordination onto A2A *vocabulary* (cards, tasks, artifacts, chain-of-custody) | **Adopt as profile** | Matches GAID §11.5 and TAK: profiles, not parallel kernels |
| Reimplement A2A wire protocol as the internal coworker bus | **Reject for now** | WorkCapsule, TaskRun, PhaseHandoff, DelegationChain, tool grants already carry governance; a second bus would fork authority |
| Use MCP as the coworker↔coworker plane | **Reject** | MCP is tool/data plane; peer handoffs need task/artifact lifecycle, not tool calls alone |
| Peer multi-agent frameworks (LangGraph handoffs, AutoGen, crew patterns) as wire replacements | **Adopt patterns only** | Explicit handoff packages, coordinator/worker roles, evidence on transition — map onto existing models |

## 2. Operations-map A2A edge mapping (what you can see)

Route: **`/platform/ai/operations-map`**  
User guide: `docs/user-guide/platform/ai-operations.md`  
Projector: `apps/web/lib/ai-operations-map/project-a2a-interactions.ts`  
Loader: `apps/web/lib/ai-operations-map/load-map-data.ts`

| Edge kind | Substrate | Loader | Operator meaning |
|-----------|-----------|--------|------------------|
| `a2a-delegation` | `DelegationChain` (`fromAgentId` → `toAgentId`, authorityScope, status) | Wired | Explicit coworker delegated authority-bearing work |
| `a2a-handoff` | `PhaseHandoff` (phase + agents + gateResult) | Wired | Build Studio phase passed from one coworker to the next |
| `a2a-task-lineage` | `TaskRun` initiating/current/parent agents | Wired | Task spawned or moved across coworkers |
| `a2a-deliberation` | `DeliberationRun` + branch `TaskNode` | **Projector exists; loader passes `deliberations: []` for A2A edges** | Coordinator fan-out to personas — **not yet agent-to-agent edges** because branch nodes lack durable branch `agentId` |

Separate **deliberation lens** on the same map recovers coordinator + branch model/provider from `routeDecision` (Option B in loader) — useful for model topology, not full A2A identity edges.

UI: `A2aInteractionsPanel` + unified canvas under the owner subway map; filter/replay rail preserves A2A preferences (see BI-65B0D697 design).

## 3. Inter-coworker interface inventory

| Interface | Trigger | Payload / durable state | Auth / HITL | Observability | Failure modes |
|-----------|---------|-------------------------|-------------|---------------|---------------|
| **DelegationChain** | Coworker delegates skill/work to another | chainId, depth, from/to agents, skillId, authorityScope, status | Origin user + authority envelopes | Ops-map `a2a-delegation`; DB rows | Incomplete chain, authority over-grant, stuck status |
| **PhaseHandoff** | Build Studio phase transition | from/to phase + agent, summary, gateResult, tokenBudget | Build orchestration + gate results | Ops-map `a2a-handoff` | Gate fail → blocked edge; missing from/to agent |
| **TaskRun lineage** | Scheduled/proactive/remote task creation or reassignment | initiating/current/parent TaskRun, a2aMetadata | Owner userId, agent grants | Ops-map `a2a-task-lineage`; ToolExecution.taskRunId | Orphan parent, null currentAgent, metadata drift |
| **submitRemoteCoworkerTask / remote coworker** | Cross-agent task submit | TaskRun + messages | Grants + proactivity boundaries | Task lineage + threads | Silent drop, double dispatch |
| **WorkCapsule claim / evidence** | External or multi-surface work unit | Capsule + evidence activities | Claim ownership | Capsule activity; not always A2A edge | Claim thrash without lineage edge |
| **Agent thread dispatcher** | Resume autonomous work | Thread + a2aMetadata provenance | Collaboration provenance read | Partial | Lost provenance if metadata empty |
| **DeliberationRun** | Multi-persona decision | Pattern, consensus, branch nodes | Coordinator TaskRun | Deliberation lens; **not** A2A agent edges yet | No branch agentId → cannot draw coworker–coworker |
| **Work rooms / handoff activity** | Room activity types | Room messages / handoff payloads | Room membership | Rooms UI; not full ops-map A2A | Parallel narrative without map edge |
| **MCP tool plane (peer)** | External or coworker tools | ToolExecution | Token grants + agent grants | BI-A08EBAEC efficiency ledger | Thrash; wrong plane for peer handoff |

## 4. Verdict

**Partially sufficient.**

**Sufficient today for:**

- Observing **delegation**, **phase handoff**, and **task lineage** coworker–coworker edges without a migration.
- Operator topology on `/platform/ai/operations-map` with typed edges and evidence-safe inspectors.
- Governance path for tools via MCP + grants (orthogonal to A2A).

**Insufficient / partial for:**

1. **Deliberation as A2A edges** — branch persona lacks durable agent identity in loader.  
2. **Capture completeness** — not every summon/handoff UX path is guaranteed to write DelegationChain / PhaseHandoff / lineage fields (EP-A2A / BI-9DB7C332).  
3. **External A2A interop** — no signed agent-card export/import aligned to A2A v1.2 for outside peers.  
4. **Shared metrics vocabulary with MCP efficiency** — ToolExecution vs A2A edges use related but not unified session/task/success dimensions.  
5. **WorkCapsule multi-coworker claim thrash** — not first-class on the A2A edge model.

## 5. Prioritized gaps (implementation backlog candidates)

| Priority | Gap | Suggested owner | Notes |
|----------|-----|-----------------|-------|
| P0 | Wire deliberation A2A edges only when branch `agentId` exists; otherwise keep lens-only | EP-AI-OPSMAP / EP-A2A | Do not fabricate identity |
| P1 | Capture enrichment: ensure handoff/summon paths populate from/to agents + a2aMetadata | BI-9DB7C332 | Visibility without capture is incomplete |
| P2 | Shared efficiency metrics: session/task/agent/success/duration across MCP tools and A2A edges | BI-A08EBAEC sibling | Vocabulary only first |
| P3 | GAID agent-card projection for optional external A2A peers | GAID / identity | Profile, not rewrite bus |
| P4 | WorkCapsule multi-claimer edge or explicit anti-thrash rule | Work capsules epic | After inventory review |

## 6. Relationship to MCP efficiency (BI-A08EBAEC)

| Dimension | MCP efficiency | A2A collaboration |
|-----------|----------------|-------------------|
| Unit | ToolExecution call | Coworker–coworker edge / TaskRun |
| Waste pattern | Thrash, retries, high volume | Failed handoffs, orphan lineage, claim thrash |
| Optimization | Skills, tool merge, webhooks | Capture completeness, identity on branches, authority on delegation |
| Shared | agentId, taskRunId, success/status, duration windows | Prefer shared window labels on ops map |

## 7. Explicit non-goals (this artifact)

- Implementing Google A2A wire as the internal coworker bus.  
- Replacing MCP.  
- Completing BI-65B0D697 UI re-architecture (three-band layout) — cite existing design; do not reopen unless inventory gap requires it.

## 8. How to see interactions (operator)

1. Open live portal `/platform/ai/operations-map` (login required).  
2. Use **Compare** or **Observed** for evidence window.  
3. On the unified canvas, filter coworker interactions / A2A; open **List and evidence table** for every edge.  
4. Empty canvas usually means no recent multi-coworker activity in the window — run a multi-phase Build Studio path or a delegation-producing workflow, then refresh.

## 9. Acceptance mapping (BI-D5348705)

| Criterion | This document |
|-----------|----------------|
| Research note A2A + peers; wire vs profile | §1 |
| Inventory of interfaces + observability | §2–3 |
| Verdict sufficient / partial / insufficient + gaps | §4–5 |
| Link EP-COWORKER-INTERACTIVITY / EP-A2A / EP-AI-OPSMAP | Header + gaps |
| Cross-link BI-A08EBAEC metrics | §6 |
