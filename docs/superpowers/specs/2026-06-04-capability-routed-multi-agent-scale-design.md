# Capability-Routed Multi-Agent Work at Scale — Evidence-Preserving Handoff Without N×N

| Field | Value |
|-------|-------|
| **Epic** | EP-A2A (A2A — agent-to-agent coworker team orchestration) |
| **IT4IT Alignment** | Cross-cutting (all value streams). Primary anchor: SS5.3 Integrate (work execution) and the IT4IT v3.0.1 "Manage" functional component — work routing across value streams. Identity/evidence anchor: governance overlay. |
| **Status** | Draft for review — reconciled against #1466 on 2026-06-05 (see §0) |
| **Created** | 2026-06-04 (reconciled 2026-06-05) |
| **Author** | Claude Opus 4.8 (Software Architect) + Mark Bodman (CEO) |
| **Related Standards** | `TAK`, `GAID` (§9 authorization classes, §10 chain-of-custody), `A2A` |
| **Related Epics** | EP-ROUTING-11 (routing substrate), EP-CWQ-001 (collaborative work queue), EP-PRINCIPLES (decision vectors), EP-WWMD-MCP, EP-COWORKER-RT, EP-AI-OPSMAP, EP-TAK-3F9A21, EP-REDUCTION-GEAR-ARCH |
| **Related Specs** | **`2026-06-04-multi-agent-collaboration-visibility-design.md` (#1466, the named-peer conversational layer this spec scales)**, `2026-04-23-a2a-aligned-coworker-runtime-design.md`, `2026-04-04-collaborative-work-queue-design.md`, `docs/architecture/GAID.md` |
| **Design Motto** | "Declare the work, not the worker. Preserve the evidence, not every hop." |
| **Scope Constraint** | Single-org-per-install today; hive / cross-company federation is forward design. `GAID-Private` posture for V1; signing and public verification are forward design. |

---

## 0. Reconciliation with #1466 (merged to `main` 2026-06-05)

This spec was first drafted (2026-06-04) against a worktree based one commit behind `origin/main`. After drafting, **[#1466 `feat(a2a): multi-agent collaboration & visibility`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1466)** merged — shipping the named-peer conversational handoff/summon layer (Slice 1) plus its own design spec (`2026-06-04-multi-agent-collaboration-visibility-design.md`). This section corrects the spec against what #1466 actually shipped. **The thesis is unchanged and strengthened**; only the empirical baseline moves.

**What #1466 shipped (verified in code on this branch):**

- **`request_coworker` and `summon_coworker` MCP tools now exist** (`apps/web/lib/mcp-tools.ts:4226-4248`, dispatch at `:5172-5223`) → `requestCoworker()` / `summonCoworker()` in `apps/web/lib/tak/coworker-collaboration.ts`. Both target a **NAMED peer** (`targetAgent` by agentId/slug), reuse `spawnWorkThread` (depth-1, max-5 children), persist provenance to `TaskRun.a2aMetadata.collaboration`, and emit `collaboration:handoff|summon|return` events. Grant: `thread_write`.
- **The named-peer N×N gate is LIVE and fail-closed** — not "declared but unenforced" as this spec's first draft claimed. `requestCoworker` calls `enforceHandoffAuthority` → **`isHandoffPermitted({delegatesTo, escalatesTo, targetIds})`** (`apps/web/lib/tak/collaboration-authority.ts`), which returns `true` only if the target is in the caller's `delegatesTo ∪ escalatesTo`. **An empty `delegatesTo` with no `escalatesTo` denies every handoff** (fail-closed); denials throw `HandoffDeniedError` and record a `status:"blocked"` `DelegationChain` hop. The MCP tool passes `callerAgentId: context.agentId` (`mcp-tools.ts:5192`), so the gate is active in practice for coworker-initiated handoffs.
- **Caveats (precise):** enforcement is skipped when `callerAgentId` is null, and **`summonCoworker` (user-initiated) does not call the gate at all** — it spawns after action-level `auth()` only. The #1466 *design doc prose* still labels `delegatesTo` enforcement "Slice 2 / not yet built" (its tables, lines 52/72/137/207/264) — **the shipped code is ahead of its own spec**; this spec follows the code.
- **#1466 already designs the GAID call-stack** — its "GAID Chain-of-Custody, A2A Traceability & the Collaboration Call-Stack" section and **Slice 2.5** specify trace-context propagation, `parent_receipt`, `authorization_class` mapping, and a collaboration receipt at `GAID-Private` posture. Its **Slice 3** is pattern aggregation. Its bounded-topology controls: `spawnWorkThread` depth-1 + max-5, `MAX_DELEGATION_DEPTH=4` (flagged inconsistent), loop detection, `HandoffDeniedError`.

**How this changes this spec (not the thesis — the urgency):**

1. The N×N problem (§1) is **no longer hypothetical**: a fail-closed named-peer allowlist gate is in production. At 1k–10k agents, "every reachable peer must be explicitly listed in every caller's `delegatesTo` or the handoff is *denied*" is now the live failure mode this spec exists to prevent.
2. This spec is the **scale companion to #1466**, not a competitor. #1466 = the named-peer *conversational* layer (visible handoff/summon, Slices 1A→2→2.5→3). This spec = how that layer **scales without an N×N allowlist**: insert capability resolution *in front of* `isHandoffPermitted`, and let `delegatesTo`/`escalatesTo` survive as optional pins.
3. **Evidence (§5.4, §7) builds on — does not re-invent — #1466 Slice 2.5.** #1466 defines the per-hop trace/receipt/`authorization_class` shape; this spec adds **head/tail sampling + flow-pattern aggregation** so that shape survives at fleet volume (a concern #1466 Slice 3 touches only for pattern mining).
4. **Bounded topology (§5.5)** reconciles with #1466's *real, shipped* caps (depth-1/max-5, `MAX_DELEGATION_DEPTH=4`, the flagged inconsistency, `HandoffDeniedError` + blocked-hop write) rather than proposing them fresh.

Sections below are kept as written for the argument; where a claim says `delegatesTo`/`request_capability` "does not exist" or is "never enforced," read it as **superseded by this §0**: those primitives now exist and the gate is live. The correction makes the case stronger.

---

## 1. Purpose and the N×N Problem

### 1.1 What this spec decides

DPF is building toward a workforce of 1,000–10,000 cooperating AI coworkers per install, plus a cross-company hive. Work must flow freely across that workforce **while preserving full chain-of-custody evidence**. This spec decides the *interaction model* for that flow: how one unit of work reaches the right worker, who is allowed to authorize the hop, and how the evidence is preserved without storing every hop forever.

The thesis under test: **replace named-peer handoff (`agent hands to a peer it names in `delegatesTo`) with capability-routed handoff (`agent declares the *task class* it needs; the platform resolves *who*`).** Five mechanisms must each be reconciled with DPF's *existing* substrate — capability routing, queue/task mediation, policy-based authority, trace-based evidence, and bounded-topology safety. This document grounds each mechanism in code that already exists, names precisely what is genuinely new, then pressure-tests the thesis adversarially before recommending a phased migration.

### 1.2 The N×N problem, stated precisely

A **named-peer** model encodes "who may hand work to whom" as an adjacency relation between agents. For `N` agents, a fully expressive directed adjacency is `N² − N` edges. The blow-up is not one cost but three independent ones:

| Dimension | Named-peer cost at scale | Why it blows up |
|-----------|--------------------------|-----------------|
| **Authorization ACL** | `O(N²)` edges to author, store, review, and keep correct | Every new coworker must be wired into the `delegatesTo`/`escalatesTo` lists of every peer that might route to it, and removed from all of them at retirement. At N=1,000 that is up to ~10⁶ directed edges; at N=10,000, ~10⁸. No human or seed maintains that correctly. |
| **Per-hop routing decision** | `O(N)` per hop, `O(N²)` across a flow | An agent choosing a *named* peer must reason over the full roster to pick one. The decision is re-made from scratch at every hop, embedded in prompt context, and is non-reproducible. |
| **Evidence volume** | `O(hops × flows)` receipts, unbounded retention | If every hop in every flow writes a durable receipt and all are retained forever, evidence storage grows with traffic, not with the questions auditors actually ask. |

The cross-company hive makes all three strictly worse: adjacency would have to span installs (`N` across the federation), authority would cross trust boundaries, and evidence would cross privacy boundaries.

**No serious multi-agent or distributed system uses an arbitrary N×N adjacency.** Section 3 documents what each uses instead. The recommended architecture (Section 5) adopts the convergent answer: **route to a capability, mediate through a hub, authorize by policy over attributes/relationships, and sample + aggregate the evidence.**

> **DPF rule applied — `verify-substrate-before-proposing-new`.** Before proposing anything, Section 2 states what already exists in the codebase versus what is genuinely new. The task brief named several primitives (`request_coworker`, `summon_coworker`, `request_capability`, `coworker-collaboration.ts`, `collaboration-authority.ts`, a `2026-06-04-multi-agent-collaboration-visibility-design.md` spec) that **do not exist in the repository as of this writing**. The real substrate, mapped below, is both denser and differently shaped. Building on the brief's names rather than the real code would have produced a spec for a system DPF does not have.

---

## 2. Substrate Truth — What Exists vs What Is New

This section is the load-bearing honesty pass. Every "exists" claim carries a `file:line` or model reference; every "new" claim is scoped against what it composes from.

### 2.1 Handoff / summon — EXISTS (shipped by #1466); the named-peer N×N gate is now LIVE

> **Corrected post-#1466 (see §0).** The table below records the *original draft's* findings (accurate for the pre-#1466 base) in the left column and the *current* truth in the right. The net change: the named-peer handoff tools now exist **and** the fail-closed N×N gate is live.

| Original draft claim (pre-#1466) | Current truth (post-#1466, this branch) |
|----------------------------------|------------------------------------------|
| `request_coworker`/`summon_coworker` do not exist | **They exist** (`mcp-tools.ts:4226-4248` / dispatch `:5172-5223` → `requestCoworker`/`summonCoworker` in `coworker-collaboration.ts`). Both target a NAMED peer (`targetAgent` by agentId/slug), reuse `spawnWorkThread` (depth-1, max-5), persist provenance to `TaskRun.a2aMetadata.collaboration`, emit `collaboration:handoff|summon|return`. Grant: `thread_write`. `spawn_work_thread` remains the anonymous parent→child decomposition primitive. |
| `delegatesTo`/`escalatesTo` is declared but **never enforced** as a gate | **Now enforced, fail-closed, in the coworker-initiated path.** `requestCoworker` → `enforceHandoffAuthority` → **`isHandoffPermitted({delegatesTo, escalatesTo, targetIds})`** (`collaboration-authority.ts`) permits a handoff only if the target ∈ caller's `delegatesTo ∪ escalatesTo`; **empty lists deny everything.** Denial throws `HandoffDeniedError` + writes a `status:"blocked"` `DelegationChain` hop. MCP passes `callerAgentId: context.agentId` (`mcp-tools.ts:5192`). **Caveat:** skipped when `callerAgentId` is null, and `summonCoworker` (user-initiated) does **not** gate (action-`auth()` only). |

This is now **decisive in the opposite direction from the first draft**: the N×N gate is no longer a dormant field — it is a **live, fail-closed allowlist**. Every peer a coworker may reach must be listed in that coworker's `delegatesTo`/`escalatesTo`, or the handoff is denied. At 1k–10k agents that allowlist is the `O(N²)` maintenance object this spec exists to retire (§1). Migrating to capability routing therefore means **inserting capability resolution in front of `isHandoffPermitted`** and demoting `delegatesTo` to an optional pin — not unwinding deep enforcement, but intercepting a gate that *just* became load-bearing (§10).

**Actual handoff authorization** lives in `apps/web/lib/tak/delegation-authority.ts`:
- `DelegationChain` rows (`schema.prisma:8456-8476`): `chainId`, `depth` (0=origin), `fromAgentId`, `toAgentId`, `skillId?`, `authorityScope: String[]`, `originUserId`, `originAuthority: String[]`, `status`, `parentLinkId?`.
- `startChain(...)` and `extendChain(...)` enforce three real gates: **depth cap** (`MAX_DELEGATION_DEPTH = 4`, line 40), **loop detection** (no agent appears twice in a chain, lines ~120-180), and **authority narrowing** (the child's `authorityScope` is the *intersection* of the parent scope and the required capabilities; delegation is **blocked** if the child needs authority the parent does not hold, lines ~186-212).

That authority-narrowing rule is, in the literature, **object-capability attenuation** (Section 3.3) — DPF already implements the correct primitive. It is keyed on *capabilities*, **not** on a named-peer allowlist.

### 2.2 Routing engine — EXISTS (EP-ROUTING-11), today routes *models* and *work items*

DPF already operates a "no provider pinning" router. Two layers:

- **Task→model router** (`apps/web/lib/routing/task-router.ts:80`): `routeTask(endpoints, taskRequirement, sensitivity, policyRules) → TaskRouteDecision`. Five-stage pipeline: **(0)** policy filter (compliance exclusions via `PolicyRule`), **(0.5)** tier gate (`minimumTier`: `frontier|strong|adequate|basic`), **(1)** hard filter (status, sensitivity clearance, required capabilities: `supportsToolUse`, `supportsStructuredOutput`, `minContextTokens`), **(2)** weighted dimension score (`reasoning, codegen, toolFidelity, instructionFollowing, structuredOutput, conversational, contextRetention` + cost blend), **(3/4)** rank + select with a `fallbackChain`. `TaskRouteDecision` carries `candidates: CandidateTrace[]`, `excludedReasons`, `policyRulesApplied` — i.e. the routing decision is **already a self-describing evidence object**.
- **Unified agent/endpoint router** (`apps/web/lib/tak/agent-router.ts`): `routePrimary` / `routeSubtask` over `EndpointCandidate` (`capabilityTier: basic|routine|analytical|deep-thinker`, `sensitivityClearance`, `costBand`, `taskTags`, `recentFailures`). `routeWithPerformance` supports **pinned overrides and block filters** per task type — the existing escape hatch for "force this endpoint."

**The router already routes by capability tier + task type + sensitivity, with cost blending and policy exclusion, emitting a traceable decision.** It does not yet route a *coworker summon* — only model/endpoint selection. That is the gap Section 5.1 fills by reusing this engine's *philosophy and decision shape* for agent selection.

### 2.3 Work queue — EXISTS (EP-CWQ-001), already does capability-match routing

`apps/web/lib/queue/queue-router.ts:22`: `routeWorkItem(workItemId, workerConstraint, teamId?)` resolves a `ValueStreamTeam`, filters eligible workers by `workerConstraint.requiredCapabilities` (intersection), `requiredRole`, `requiredAgentId`, scores candidates, and assigns — updating `WorkItem.status="assigned"`, `assignedToAgentId`, `routingDecision: Json`. `RoutingPolicy.mode` already includes **`"capability-match"`** (`queue-types.ts`). `WorkItem`/`WorkQueue`/`WorkItemMessage`/`WorkSchedule` models exist (`schema.prisma`). `WorkerConstraint` = `{ workerType, requiredCapabilities, requiredRole, requiredAgentId, excludeWorkers, preferredWorkerIds, sensitivityLevel }`.

**The queue is already a capability-routed mediation hub — for `WorkItem`s.** It is not yet the path a coworker takes to summon help mid-conversation. Section 5.2 makes the queue (and its `TaskRun`/`TaskNode` backing) the mediation hub for capability handoffs, rather than wiring agents to each other directly.

### 2.4 Task substrate — EXISTS, already A2A-shaped

`TaskRun` (`schema.prisma:4988`): `taskRunId`, `contextId?`, `initiatingAgentId?`, `currentAgentId?`, `parentTaskRunId?`, `routeContext?`, `status` (A2A vocabulary: `submitted|working|input-required|auth-required|completed|failed|canceled|rejected|archived`), `authorityScope: Json?`, `a2aMetadata`, `progressPayload`, `lastHeartbeatAt?` (watchdog), `quiescedAt?`. `TaskNode` (`schema.prisma:5199`): `nodeType`, `workerRole`, `routeDecision: Json?`, `authorityEnvelope`, `evidenceContract`, `requestContract`, `influenceLevel`, `dependencyMode`. `TaskNodeEdge`: `edgeType ∈ {depends_on, informs, verifies, blocks, supersedes}`.

`TaskNode.routeDecision` and `TaskRun.a2aMetadata` are **already the right homes** for a capability-route record and chain-of-custody metadata — no new top-level columns required.

### 2.5 Policy / decision substrate — EXISTS (EP-PRINCIPLES, EP-WWMD-MCP)

- **Vector decision engine** (`apps/web/lib/decision/option-scoring.ts`): `decide(options, principles, config) → DecisionResult`. `DecisionPrinciple { tier: commandment|core|contextual, weight, dimensionVector }`, `DecisionOption { features }`, structured (dot-product) or semantic (cosine) alignment, guardrails for tie-margin, semantic-fallback ratio, and **commandment conflict**. Exposed as the `principle_decide` MCP tool. `DecisionInteraction` model (`schema.prisma:9242`) records WWMD interactions (`question`, `options`, `evidenceBundle`, `riskTier`, `outcomeType`, `principleConflict`, `confidenceBefore/After`) bound to `taskRunId`.
- **Grant intersection** (`agent-grants.ts`): tool authority = user capability ∩ agent grant, with `GRANT_IMPLICATIONS` one-way expansion.
- **Authorization decision log** (`AuthorizationDecisionLog`, `schema.prisma:2185`): `actorType`, `actorRef`, `delegationGrantId?`, `actionKey`, `decision (allow|deny)`, `rationale: Json`, `routeContext?`, `sensitivityLevel?`.

DPF's policy layer is **attribute- and principle-driven already** — it does not enumerate principal×resource pairs. Section 5.3 reconciles ABAC/ReBAC framing onto this, rather than importing a second engine.

### 2.6 Capability *demand* side — EXISTS, and is the natural mate to capability routing

`CoworkerCapabilityNeed` (`schema.prisma:2060`) + `CoworkerSelfAssessment` (`schema.prisma:2039`): an agent declares **what it needs** (`kind ∈ {tool, skill, grant, model, memory, data, ui_surface, boundary, prompt, convention, code, other}`, `severity`, `status`). MCP tools `submit_coworker_capability_need`, `list_my_capability_needs`, `list_all_capability_needs`. Today these route to *governance/backlog* (a human or build pipeline fulfills the need). **This is the same shape as a capability request** — "I need capability X" — pointed at the backlog instead of at a live peer. The new `request_capability` is the *runtime, intra-flow* sibling of this *governance, cross-session* primitive. They should share a capability taxonomy.

### 2.7 Evidence & identity substrate — EXISTS (GAID direction)

`GAID.md` §9 (authorization classes: `observe, monitor, analyze, report, create, update, approve, execute, delegate, administer, cross-boundary`) and §10 (receipts: `receipt_id, gaid, principal_ref, authorization_class, execution_mode, target_ref, request_hash, result_hash, trace_context, parent_receipt, evidence_refs, signature`). §10.3: trace context preserved end-to-end; delegated actions retain parent-child receipt links; both delegating and delegated `GAID`s recorded. `GAID-Private` (§13.1): receipts **SHOULD** be issued for consequential actions; public verification material is **not** required. Per-hop precursors already persisted: `AuthorizationDecisionLog`, `TaskNode.routeDecision`, `ToolExecution`.

### 2.8 Bounded-topology & resilience — PARTIAL

- **Depth cap + loop detection**: EXIST (`delegation-authority.ts`, `MAX_DELEGATION_DEPTH=4`).
- **Circuit breaker**: EXISTS for the reviewer path — `bounded-autonomous-review.ts` auto-pauses on `parse_rate` / `unknown_failures` / `degenerate_distribution` over a health window (`ReviewSettings { minParseRate, maxUnknownFailuresInWindow, healthWindowSize }`); failure taxonomy includes `budget_exhausted`, `router_no_route`, `provider_rate_limit`.
- **Rate tracking / recovery / health**: EXIST for *providers* (`routing/rate-tracker.ts`, `rate-recovery.ts`, `provider-health.ts`).
- **Fan-out cap, per-flow token budget, flow-level rate limit, flow-level circuit breaker**: **NEW** — none of the above is scoped to a *capability flow* (a `chainId`/`contextId` spanning many hops).

### 2.9 Visibility — EXISTS (EP-AI-OPSMAP)

`apps/web/lib/ai-operations-map/project-routing-topology.ts`: `projectRoutingTopology(...) → { coworkers, providers, routes, markers, timeline, legend }`. `OperationsMapRoutingRoute.state ∈ {active, secondary, failover, scheduled, historical}`; `OperationsMapRoutingMarker.type ∈ {decision, quota, error, failover, scheduled, governance}`. The map already renders coworker→provider routing decisions; extending it to render **coworker→capability→coworker** flows is a projection change, not a new surface.

### 2.10 Exists-vs-New ledger (summary)

| Mechanism | Exists | Genuinely new |
|-----------|--------|---------------|
| Capability routing | `routeTask`/`routePrimary` (tier+task+sensitivity+cost, traceable decision); `queue-router` capability-match; `AgentSkillAssignment`; `delegatesTo` as *optional* descriptor | `request_capability` MCP tool; a **canonical `taskClass` capability taxonomy** for summons; an **agent-selection** route decision (reuse router shape) vs today's model-selection |
| Queue/task mediation | `TaskRun`/`TaskNode`/`TaskNodeEdge`; `WorkItem`/`WorkQueue`; `spawn_work_thread` | Route the *coworker summon* through the queue/`TaskRun` hub (no direct peer wiring); a `capability-request` `WorkItem` source type |
| Policy authority | vector `principle_decide`; grant intersection; `DelegationChain` authority-narrowing (= capability attenuation); `AuthorizationDecisionLog` | An **ABAC/ReBAC capability-reachability policy** ("may this flow reach capability C at sensitivity S?") expressed over attributes/relationships, evaluated *by* `principle_decide` + TAK gate — not a new engine |
| Trace evidence | GAID §10 receipt shape; `AuthorizationDecisionLog`; `TaskNode.routeDecision`; `a2aMetadata.custody` | **Receipt emission on capability hops**; **head+tail sampling policy**; **flow-pattern aggregation** records; retention tiers |
| Bounded topology | depth cap; loop detection; reviewer circuit breaker; provider rate/health | **Per-flow** fan-out cap, token budget, rate limit, and circuit breaker keyed on `chainId`/`contextId` |

---

## 3. Research and Benchmarking

> **DPF rule applied — AGENTS.md §10.** Compare *data and interaction models*, not feature lists. The question for every system is: **how does it move work between workers without an arbitrary N×N adjacency, how does it authorize the hop, and how does it preserve evidence at scale?** Every system below answers the first question by *not* using N×N. The patterns cluster into four families that map onto DPF's five mechanisms.

### 3.1 Multi-agent frameworks — handoff topology

| System | Handoff/interaction model | What it does *instead of* N×N | Anti-pattern it reveals | Gap DPF fills |
|--------|---------------------------|-------------------------------|-------------------------|---------------|
| **OpenAI Agents SDK** ([handoffs docs](https://openai.github.io/openai-agents-python/handoffs/)) | Handoff = a synthesized tool `transfer_to_<agent>`; the LLM picks one; control + full history transfer to the named peer. Decentralized. | The handoff set is a **small, explicitly curated list per agent** — never the full roster. An agent can only transfer to peers it was *given*. | Curation is still adjacency: it scales by staying small and static. At 1k+ agents you cannot hand-curate every list, and history-transfer leaks context across boundaries. | Capability resolution (declare task class, platform resolves peer) + governance + evidence the SDK has none of. |
| **AutoGen** ([SelectorGroupChat](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/selector-group-chat.html), [GraphFlow](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/graph-flow.html)) | Either a **central LLM selector** picks the next speaker from the team roster, or a **static `DiGraph`** (GraphFlow) defines sequential/parallel/conditional/loop edges. | Star topology (selector mediates) or **declared graph** (edges are authored, not emergent). No agent addresses another directly. | The selector is a single context bottleneck and a single point of failure; the static graph does not adapt to new capabilities at runtime. | Distributed mediation (queue, not one selector) + dynamic capability resolution + per-flow bounds. |
| **CrewAI** (hierarchical process) | A **manager agent** owns delegation; crew members execute and report up. | Star/tree topology centered on the manager. | Manager is the bottleneck and the blast-radius concentrator. | Mediation without a privileged manager agent; authority by policy, not by a manager's discretion. |
| **LangGraph** ([supervisor](https://reference.langchain.com/python/langgraph-supervisor), [handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs)) | Agents are graph nodes; handoff = `Command(goto=..., graph=Command.PARENT)`. **Supervisor** (star) or **swarm** (direct handoff tools within a defined node set). | The topology **is the graph** — an authored, inspectable artifact. Even "swarm" handoffs are confined to declared nodes. | Graph must be authored/compiled; runtime-discovered capabilities don't appear without recompiling the graph. | Runtime capability discovery + the graph emerges from routing decisions (projected by the Ops Map) rather than being hand-authored. |
| **A2A protocol** ([v0.3.0 spec](https://a2a-protocol.org/v0.3.0/specification/), [AgentCard](https://agent2agent.info/docs/concepts/agentcard/)) | `AgentCard` advertises `skills` (id, description, **tags for routing**, input/output modes); clients discover and delegate a `Task` (lifecycle `submitted→working→input-required→completed/failed`). | **Capability discovery, not addressing.** A caller matches a *skill/tag*, not a fixed peer. The Card is "a résumé other agents read to decide fit." | A2A is a *carrier*, not a router — it does not mandate *who* resolves the match or *how* authority is checked. | DPF supplies the router (Section 5.1), the authority model (5.3), and evidence depth (5.4) A2A leaves open. This is the closest external analog to the thesis. |
| **FIPA Contract-Net** ([SC00029](http://www.fipa.org/specs/fipa00029/SC00029H.html)) | **announce (cfp) → bid → award**: initiator broadcasts a task to *capable* participants; they bid; initiator awards the best. | The canonical **capability market** — work routes to whoever *can and will*, with no fixed adjacency. | Naïve broadcast is `O(N)` per task → broadcast storms; classic mitigation is **middle-agents / directories** (match-makers, brokers). | DPF's queue + capability index *is* the middle-agent — capability routing without the broadcast. |
| **Blackboard** (classic) | Knowledge sources read/write a **shared blackboard**; a control component activates the most promising source. | **Indirect coupling via shared state** — zero direct agent→agent edges. | Blackboard becomes a contention/consistency hotspot; control logic is itself a bottleneck. | `TaskRun`/`TaskNode` + work queue are the governed, sharded blackboard with explicit edges and evidence. |
| **BDI** (belief-desire-intention) | Agents coordinate via shared **goals/plans**, not direct addressing. | Coordination through intentions and joint plans. | Hard to audit emergent coordination; weak external accountability. | DPF binds every hop to a `TaskRun` + receipt — auditable by construction. |

**Convergent finding:** every framework either (a) keeps adjacency small/static/declared, (b) inserts a mediator (selector/supervisor/manager/blackboard), or (c) routes by capability discovery (A2A skills, Contract-Net bids). **None permits arbitrary runtime N×N.** The thesis is the (c)-family answer with a (b)-family mediator and (a)-family pins as an escape hatch.

### 3.2 Distributed systems — discovery, orchestration, evidence, resilience

| System | Model | Lesson for DPF |
|--------|-------|----------------|
| **Service mesh** (Istio / Linkerd) | Sidecar proxies; callers address a **logical service name**, the mesh resolves a healthy instance; identity via **SPIFFE/mTLS**; routing & policy in the control plane. | "Call a *capability*, not an instance" is exactly capability routing. **Workload identity** (SPIFFE) ≈ `GAID`. The control plane holds policy so the data plane stays dumb → DPF's router/policy is the control plane; agents stay dumb about *who*. |
| **Service discovery** (Consul) | Central catalog + health checks; caller queries "service X," gets a current healthy endpoint. | A **capability index** with liveness/health is the registry the router queries — decouples caller from callee identity and absorbs churn (agents join/retire) without touching callers. |
| **Distributed tracing** ([Dapper](https://research.google/pubs/pub36356/), [OpenTelemetry sampling](https://opentelemetry.io/docs/concepts/sampling/), [tail sampling](https://opentelemetry.io/blog/2022/tail-sampling/)) | Propagate a **trace context**; **sample** rather than store everything. **Head sampling** decides up front (cheap, can't catch errors); **tail sampling** decides after the trace completes (keeps errors/slow/interesting traces, needs a collector that buffers a full trace and routes by trace-id). Dapper ran at low sample rates and still gave Google fleet-wide visibility. | **You do not store every hop forever.** Keep a cheap head sample for baseline + a tail sample that always keeps anomalous flows (denied, escalated, high-sensitivity, failed). This is the core of "evidence at scale" (5.4). DPF already has `trace_context`/`parent_receipt` in the GAID receipt shape. |
| **Durable orchestration** ([Temporal](https://temporal.io/blog/to-choreograph-or-orchestrate-your-saga-that-is-the-question), Camunda) | Workflow defined **as code**; engine persists an **event history** and replays to resume exactly where it left off. Orchestration centralizes control + visibility. | DPF's `TaskRun` + Inngest (per CWQ spec) is the durable-orchestration layer. The event history is per-flow and **bounded** — a precedent that full per-flow logs are fine *because they are bounded*, while *fleet-wide* evidence must be sampled. |
| **Saga: orchestration vs choreography** | **Orchestration** = central coordinator (visible, controllable). **Choreography** = services react to events (decoupled but emergent, hard to debug, ordering/duplication hazards). | Choreography *is* the N×N hazard in disguise. **DPF chooses orchestration** (queue/`TaskRun`) for the spine, allowing event-driven choreography only inside a bounded `TaskRun`. |
| **Circuit breaker** ([Hystrix](https://github.com/Netflix/Hystrix/wiki)) | Open after a failure threshold, half-open probe, fallback; **bulkhead** isolation per dependency. | DPF has this for reviewers (`bounded-autonomous-review`) and providers (`rate-recovery`); generalize to **per-capability-endpoint** breakers so one failing capability cannot stall the workforce. |
| **Erlang/OTP supervisor trees** | Hierarchical supervisors restart children; **bounded fan-out**; strategies `one_for_one / one_for_all / rest_for_one`; "let it crash" with containment. | The **bounded tree** is the safe alternative to a flat N×N mesh. DPF's delegation chain (depth-capped, parent-linked) is a supervisor tree; make fan-out a first-class bound (5.5). |

### 3.3 Authorization at scale

| Model | Mechanism | Why it beats N×N | DPF reconciliation |
|-------|-----------|------------------|--------------------|
| **NIST ABAC** ([SP 800-162](https://csrc.nist.gov/publications/detail/sp/800-162/final)) | Decide from **subject/object/environment attributes** evaluated against policy. | No principal×resource enumeration — a *rule* covers unbounded pairs. | Express capability reachability as attributes (`value_stream`, `sensitivity`, `authorization_class`, `flow_depth`) and decide with `principle_decide` + TAK gate. |
| **ReBAC — Zanzibar / OpenFGA** ([OpenFGA](https://openfga.dev/docs/fga), [Zanzibar paper](https://research.google/pubs/pub48190/)) | Store sparse **relationship tuples** (`object#relation@user`); check by graph traversal. Scales to **trillions of objects / 1M+ checks/s** — *because the tuple store is sparse*, not a dense matrix. | Replaces the dense `N²` matrix with the *relationships that actually exist*. | DPF's authority graph (user→grant→agent→`DelegationChain`) is already relationship-shaped. Capability reachability = "does a permitting relation/attribute chain exist?" — a sparse check, not a matrix lookup. |
| **Capability-based security** (object-capabilities) | Authority **is** an unforgeable token; possession grants access; **delegation = passing an attenuated capability**. No ACL lookup. | Authority travels *with the work*; you narrow it on each hop, you never consult an N×N ACL. | **`DelegationChain.authorityScope` already implements capability attenuation** (`delegation-authority.ts` authority-narrowing). The capability *is* the scope carried down the chain. This is DPF's strongest existing alignment — make it the spine of the authority model (5.3). |

**Convergent finding:** scalable authorization is **never a dense matrix.** It is policy-over-attributes (ABAC), sparse-relationships (ReBAC), or attenuated-tokens-that-travel-with-work (ocap). DPF already has all three ingredients; the work is to *compose* them for capability reachability, not to add an engine.

---

## 4. The Thesis, Restated Against the Real Substrate

> **Replace `request_coworker(namedPeer)` with `request_capability(taskClass)`** — but the precise DPF form is: **add `request_capability` as the primary intra-flow handoff tool; keep `spawn_work_thread` for parent→child decomposition; demote `delegatesTo`/`escalatesTo` to *optional pins/overrides* that never become a hard adjacency gate.**

An agent that needs help emits:

```
request_capability({
  taskClass: "code.review.security",   // from the canonical capability taxonomy
  objective: "...",                     // the work + question packet (A2A spec §Question Packet)
  sensitivity: "confidential",          // inherited/raised, never lowered silently
  authorityClass: "analyze",            // GAID §9 portable class the work needs
  pin?: { agentId },                    // optional override → the only place delegatesTo survives
  constraints?: { excludeAgents, preferredAgents, minTier }
})
```

The platform — **not the agent** — resolves *who*, by composing existing pieces:

1. **Router** (`routeTask` shape, 5.1) ranks agents that *advertise* `taskClass` by tier/fit/sensitivity/cost/health → a `CapabilityRouteDecision` (same self-describing shape as `TaskRouteDecision`).
2. **Queue/`TaskRun`** (5.2) mediates: the request becomes a `capability-request` `WorkItem`/`TaskNode`; no direct agent→agent call.
3. **Policy** (5.3) gates: ABAC/ReBAC reachability + capability attenuation via `DelegationChain` + `principle_decide` for ambiguous/consequential routes + TAK execution gate.
4. **Trace** (5.4) records: a sampled receipt with `trace_context`, `parent_receipt`, both `GAID`s, `authorization_class`; aggregated into flow patterns.
5. **Bounds** (5.5) protect: depth/fan-out caps, per-flow budget/rate, circuit breakers.

`delegatesTo` becoming an *optional pin* (rather than the routing primitive) is exactly the A2A/mesh lesson: **address the capability; allow an explicit instance pin as an override.**

---

## 5. Recommended Architecture

```
  coworker A (mid-flow)
       │  request_capability({ taskClass, objective, sensitivity, authorityClass, pin? })
       ▼
  ┌─────────────────────────  CAPABILITY MEDIATION HUB  ─────────────────────────┐
  │                                                                              │
  │  (5.1) CAPABILITY ROUTER          (5.3) AUTHORITY POLICY                      │
  │   reuse routeTask shape:           ABAC attrs + ReBAC reachability +          │
  │   advertise→filter→score→rank      ocap attenuation (DelegationChain) +       │
  │   → CapabilityRouteDecision        principle_decide (ambiguous) + TAK gate    │
  │            │                                  │                               │
  │            └──────────────┬───────────────────┘                              │
  │                           ▼                                                   │
  │  (5.2) QUEUE / TaskRun MEDIATION  → capability-request WorkItem / TaskNode    │
  │                           │   (no direct peer wiring; spawn_work_thread for   │
  │                           │    parent→child decomposition)                    │
  │                           ▼                                                   │
  │  (5.5) BOUNDED TOPOLOGY: depth cap · fan-out cap · per-flow budget/rate ·     │
  │        per-capability circuit breaker · loop detection                       │
  └───────────────────────────┬──────────────────────────────────────────────────┘
                              ▼
                       coworker B (resolved by capability)
                              │
  (5.4) TRACE EVIDENCE: receipt(trace_context, parent_receipt, GAID_A, GAID_B,
        authorization_class) → head+tail SAMPLING → flow-pattern AGGREGATION
                              │
                     AI Operations Map (coworker→capability→coworker flows)
```

### 5.1 Capability-based routing — reuse the router philosophy

**Reuse, do not rebuild.** The agent-selection router is the *same decision shape* as `routeTask`, with the candidate set being *agents that advertise the requested `taskClass`* instead of *model endpoints*.

- **Capability advertisement.** Each coworker advertises the task classes it serves. Source of truth = `AgentSkillAssignment` + a new **`taskClass` taxonomy** (Section 5.1.1). An **Agent Capability Card** projection (aligning with the A2A `AgentCard.skills`/tags model and the A2A-runtime spec's `agent-card-service`) exposes `{ taskClasses[], tier, sensitivityClearance, authorizationClasses[], health }`. **No provider/agent pinning** in the advertisement — direction by capability, magnitude by fitness (mirrors `feedback_no_provider_pinning` and the EP-PRINCIPLES vector model).
- **Decision.** `routeCapability(candidates, capabilityRequest, sensitivity, policyRules) → CapabilityRouteDecision`, reusing the five-stage pipeline: policy filter → tier gate → hard filter (advertises `taskClass`, sensitivity clearance, required authorization class) → weighted score (fit dimensions + recent success + load + cost) → rank + select with `fallbackChain`. The decision object is **identical in spirit to `TaskRouteDecision`** (carries `candidates`, `excludedReasons`, `policyRulesApplied`) so it is evidence by construction and renders in the Ops Map unchanged.
- **`delegatesTo`/`escalatesTo` survive only as pins/overrides.** `pin.agentId` short-circuits ranking (subject to policy + bounds). `escalatesTo` becomes the **fallback capability** `escalation.<domain>` when no candidate clears policy or the breaker is open — not a hard edge.

#### 5.1.1 The `taskClass` capability taxonomy (NEW, but bootstrapped from existing vocab)

A canonical, versioned, dotted taxonomy (`domain.action.qualifier`, e.g. `code.review.security`, `finance.reconcile.month-end`, `research.scout.hive`). Bootstrap from existing substrate rather than inventing: `AgentSkillAssignment` skills, `CoworkerCapabilityNeed.kind`, value streams, and the WWMD `domainClass`. Stored as a wiki kind (consistent with EP-PRINCIPLES treating principles as a wiki kind) and seeded as *bootstrap, not running config* (`feedback_seed_is_bootstrap_calibration_is_runtime`) — advertisement fitness is calibrated at runtime from `routeOutcome`/`AgentPerformance`, never frozen in the seed. **This taxonomy is shared with the demand-side `CoworkerCapabilityNeed`** so "I need X at runtime" and "I need X built" speak the same language.

### 5.2 Queue / task mediation — the hub that routes and records

**No direct peer wiring, ever.** A `request_capability` call creates a **`capability-request` `WorkItem`** (new `WORK_ITEM_SOURCE_TYPES` value) backed by a `TaskNode` under the caller's `TaskRun` (`nodeType` extension or a `capability_request` node). The queue's existing `routeWorkItem` (already `capability-match`) invokes `routeCapability` (5.1), assigns the resolved coworker, and writes `routingDecision`. The resolved coworker picks up the node exactly as it picks up any work item — same lifecycle (`queued→assigned→in-progress→awaiting-input→completed`), same SSE/event-bus surface, same A2A `TaskState` mapping the CWQ spec already defines.

This gives, for free: durable execution (Inngest, CWQ §4), back-pressure (queue depth, `maxConcurrentPerWorker`), SLA/escalation timers, and a single mediation point to attach evidence and bounds. `spawn_work_thread` remains the **parent→child decomposition** primitive (an agent splitting *its own* work); `request_capability` is the **lateral capability summon** (an agent asking the workforce). The two compose: a resolved coworker may `spawn_work_thread` internally and/or `request_capability` onward (depth-bounded).

### 5.3 Policy-based authority — ABAC + ReBAC + ocap, evaluated by what exists

Authority answers one question per hop: **"May *this flow*, carrying *this attenuated authority*, reach *capability C* at *sensitivity S*?"** — without an N×N ACL. Layered (mirroring the A2A-runtime spec's TAK/GAID layering):

1. **Attenuated capability (ocap) — the spine.** The flow carries `DelegationChain.authorityScope`. `extendChain` already **narrows** it to the intersection with the hop's required capabilities and **blocks** escalation. A capability hop *cannot acquire authority the originating principal never held.* This is the primary gate and it already exists.
2. **ABAC reachability rule.** A policy over attributes `{ caller.valueStream, taskClass.domain, sensitivity, authorizationClass (GAID §9), flow.depth }` decides whether the *class* of hop is permitted — one rule covers unbounded agent pairs. Evaluated as a `principle_decide` option set (the vector engine already returns `allow/deny`-shaped recommendations with `commandmentConflict` detection) plus the deterministic TAK execution gate. **No new policy engine** — a new *policy vocabulary* over the existing one.
3. **ReBAC sparse check.** "Does a permitting relationship chain exist (user→grant→agent→delegation)?" is a sparse traversal of `DelegationGrant`/`DelegationChain`/`AuthorizationDecisionLog`, not a matrix lookup — the Zanzibar lesson applied to relationships DPF already stores.
4. **Ambiguity → WWMD.** Consequential or ambiguous routes (high sensitivity, `approve`/`execute`/`cross-boundary` authorization classes, low router confidence) escalate to a `DecisionInteraction` (WWMD), which can `recommend / arbitrate / escalate / defer` — the governed path for hard calls, bound to the `taskRunId`. Governance approves on **evidence**, regardless of which agent produced the work (`feedback_governance_approves_evidence_not_provenance`).
5. **Every decision logged.** `AuthorizationDecisionLog` row per gated hop (`actionKey="capability.route"`, `decision`, `rationale`, `routeContext`, `sensitivityLevel`) — the per-hop authority evidence that feeds 5.4.

Single-org today: all of this is intra-install. **`cross-boundary` (hive) is forward design** — the same attribute/relationship model extends to federated reachability, but V1 denies `cross-boundary` capability routes by policy default.

### 5.4 Trace-based evidence — preserve at scale via sampling + aggregation

The goal: **full custody where it matters, bounded storage everywhere.** Three tiers.

1. **Per-hop receipt (GAID §10), always *emitted*, selectively *retained*.** Each capability hop emits a receipt: `receipt_id, gaid (resolved agent), principal_ref, authorization_class, execution_mode, target_ref, request_hash, result_hash, trace_context, parent_receipt, evidence_refs`. `trace_context` propagates across the whole flow (one `chainId`/`contextId`); `parent_receipt` links child→parent (GAID §10.3 — both delegating and delegated GAIDs recorded). **`GAID-Private` posture:** receipts are issued for *consequential* hops (`create/update/approve/execute/delegate/cross-boundary`); raw prompt text is referenced by digest, not copied (§10.5). **Signing is forward design** — V1 receipts are tamper-evident by hash + DB integrity, not cryptographic signature.
2. **Sampling (Dapper/OTel).** Not every hop is retained long-term:
   - **Head sample**: a cheap baseline fraction of *all* flows, decided at flow start (reproducible coverage).
   - **Tail sample**: decided at flow completion, **always retain** flows that are *interesting* — `deny`, `escalated`, `auth-required`, `failed`, `sensitivity ∈ {confidential, restricted}`, `authorizationClass ∈ {approve, execute, cross-boundary}`, breaker-tripped, or budget-exhausted. (Tail sampling requires the full flow to land at one decision point — natural here since the `TaskRun` *is* that point.)
   - Read-only/`observe`/`analyze` hops below sensitivity thresholds collapse to counters, not retained receipts.
3. **Flow-pattern aggregation (the "Slice-3 pattern" generalized).** Recurring `(taskClass, fromValueStream, toValueStream, authorizationClass, outcome)` tuples aggregate into a **flow-pattern record** (counts, success rate, p50/p95 latency, cost) — the evidence that "10,000 `code.review.security` hops happened and 99.4% were allowed+passed" without 10,000 retained receipts. `TaskRun.repeatedPatternKey` already exists as the hook. Aggregates feed the Ops Map and calibrate router fitness.

**Retention tiers:** counters (forever, cheap) → head-sampled receipts (short TTL) → tail-sampled receipts (long TTL / audit hold) → WWMD/decision interactions (retained as governance record). This is "evidence preserved at scale" — the audit question "show me every *consequential* or *anomalous* capability hop touching restricted data" is answerable in full; "replay every observe hop from last quarter" is answered by aggregates, by design and disclosed (`no silent caps` — the sampling policy is logged, not hidden).

### 5.5 Bounded-topology safety

Per-**flow** bounds keyed on `chainId`/`contextId` (not per-agent or per-provider, which is what exists today):

| Control | Mechanism | Reuse / new |
|---------|-----------|-------------|
| **Depth cap** | Reject `request_capability` beyond `MAX_FLOW_DEPTH` (start at the existing `4`; tune per value stream). | Reuse `delegation-authority` depth cap. |
| **Loop detection** | No agent **and no `taskClass`** repeats within a flow (prevents A→B→A and capability ping-pong). | Extend existing chain loop detection to `taskClass`. |
| **Fan-out cap** | Max concurrent `request_capability` children per node; excess queues. | NEW; enforced at the queue. |
| **Per-flow token/cost budget** | Each flow carries a budget; hops debit it; exhaustion → `budget_exhausted` (taxonomy exists) → escalate or stop. | NEW per-flow; failure class exists in `bounded-autonomous-review`. |
| **Per-flow rate limit** | Cap `request_capability`/sec per flow to stop runaway storms. | NEW; reuse `rate-tracker` machinery. |
| **Per-capability circuit breaker** | If capability `C` fails/parses-degenerate over a health window, **open** the breaker: route to fallback capability or pause, half-open probe to recover. | Generalize `bounded-autonomous-review` auto-pause + `rate-recovery` to capability endpoints. |
| **Supervisor containment** | A flow is a bounded supervisor tree (Erlang/OTP): a failing sub-flow is contained, parent decides retry/escalate/abandon (PAR — Propose, Acknowledge, Reassign). | Reuse `TaskRun`/`TaskNode` tree + PAR reassignment. |

---

## 6. Adversarial Pressure-Test (break the thesis, then refine)

Each attack tries to defeat capability routing; each refinement folds back into Section 5.

**A1 — "Capability routing is just N×N with extra steps: the capability *advertisement* index is itself `O(N × C)` and every router decision still scans candidates."**
*Force:* real — an unbounded candidate scan per hop reintroduces `O(N)`.
*Refinement:* the index is `O(N × C̄)` where `C̄` is the small number of classes an agent advertises — **sparse**, like Zanzibar tuples, not the dense `N²`. The router never scans all agents: the tier gate + sensitivity hard-filter + `taskClass` exact-match index reduce candidates to a handful *before* scoring. Critically, the **authoring cost** drops from `O(N²)` (every peer wires every peer) to `O(N × C̄)` (each agent declares its own classes once) — the win is in *who maintains the edges*, and it is now self-declared and local. **Refinement adopted:** `taskClass` is an indexed exact-match key, candidate sets are capped by the fan-out/tier filters.

**A2 — "Indirection destroys context: named handoff transfers full history (OpenAI SDK); capability routing hands a stranger a cold task."**
*Force:* real — a resolved coworker with no context produces the "ungrounded fallback confabulation" failure DPF already hit (`project_mechanism_question_grounding_gap`).
*Refinement:* the request carries an **A2A question-packet artifact** (the A2A-runtime spec already defines `intentCenter, explorationQuestions, hardEdges, contextRefs, successShape, decisionRoute`) — *structured* context, not a raw transcript dump and not nothing. The resolver gets exactly the grounding it needs by reference (digests/pointers, not copies — GAID §10.5). **Refinement adopted:** `request_capability.objective` is a question packet, mandatory for consequential classes.

**A3 — "The mediation hub is a single point of failure / bottleneck — you replaced N×N edges with one chokepoint (the AutoGen-selector anti-pattern)."**
*Force:* real if the hub is one process making LLM decisions.
*Refinement:* the hub is the **queue + `TaskRun`**, which is *durable infrastructure* (Inngest, sharded, restart-safe per CWQ §4), not a privileged LLM agent. Routing is a deterministic ranking function (`routeCapability`), not a model call, except for the *ambiguous* minority that escalate to WWMD. The hub scales horizontally like a service-mesh control plane; it is not a conversational bottleneck. **Refinement adopted:** routing is deterministic by default; LLM/WWMD only on low-confidence/consequential routes.

**A4 — "Capability advertisements lie or go stale — an agent claims `code.review.security` and is bad at it, so routing sends real work to a confabulator."**
*Force:* real, and exactly the months-long "fabricated toolFidelity=100" failure (`feedback_seed_is_bootstrap_calibration_is_runtime`).
*Refinement:* advertisement is **direction, not score**; *fitness* is calibrated at runtime from `routeOutcome`/`AgentPerformance`, never trusted from the seed. A coworker that advertises a class it fails at sees its fitness decay and the circuit breaker (5.5) open. The capability-need/self-assessment loop (2.6) lets agents *withdraw* claims they can't meet. **Refinement adopted:** seed = bootstrap; fitness = runtime; breaker contains liars.

**A5 — "Sampling loses the receipt the auditor needs — you didn't keep the one hop that mattered."**
*Force:* real — head sampling provably can't catch errors (it decides before the error exists).
*Refinement:* that is *precisely* why the design uses **tail** sampling for everything consequential/anomalous — the decision is made *after* the flow completes, at the `TaskRun` (which already buffers the whole flow). Every `deny`, `escalate`, `failure`, restricted-sensitivity, and `approve/execute/cross-boundary` hop is retained in full; only routine read hops collapse to counters. The sampling *policy itself is logged* (no silent caps). **Refinement adopted:** consequential/anomalous = 100% tail-retained; policy disclosed.

**A6 — "Demoting `delegatesTo` breaks deliberate org design — sometimes you *must* route to a specific senior coworker, not 'whoever fits.'"**
*Force:* real — capability routing must not erase intentional authority structure.
*Refinement:* `pin.agentId` (and `escalatesTo` as fallback capability) preserve *exactly* this — an explicit, evidenced override, the service-mesh "route to this instance" affordance. The difference is the pin is now *opt-in per request*, not a standing adjacency every peer must maintain. **Refinement adopted:** pins are first-class, evidenced, and bounded.

**A7 — "Authority attenuation + ABAC can deadlock: the only capable agent needs authority the flow can't grant, so work can't move."**
*Force:* real — over-narrowing starves the flow.
*Refinement:* this is correct *behavior*, not a bug — it surfaces as `auth-required` (an A2A `TaskState` DPF already has) and escalates to a human/WWMD authority decision rather than silently widening scope (which would violate `destructive-actions-require-explicit-go` / least-privilege). The deadlock is a governance prompt, by design. **Refinement adopted:** `auth-required` → WWMD/HITL, never auto-escalate scope.

**A8 — "At the hive boundary, capability routing leaks work and evidence across companies."**
*Force:* real for federation.
*Refinement:* V1 is single-org; **policy denies `cross-boundary` capability routes by default** (5.3). Federation is explicitly forward design with its own boundary mapping (GAID §6.5) and `GAID-Federated`+ signing — out of V1 scope, called out, not hand-waved. **Refinement adopted:** cross-boundary denied in V1.

**Verdict:** the thesis survives, materially refined. The net change versus named-peer: authoring cost `O(N²)→O(N·C̄)` and *self-declared*; context preserved via question packets; the "hub bottleneck" is durable infra, not an agent; advertisement honesty is enforced by runtime calibration + breakers; evidence is complete where it counts and bounded elsewhere; deliberate authority structure survives as pins; and the hard cases (auth deadlock, cross-boundary) route to governance rather than failing silently.

---

## 7. Evidence at Scale — Detailed Posture

- **Posture:** `GAID-Private` (§13.1) for V1. Receipts issued for consequential hops; tamper-evidence by hash + DB integrity. **Signing (§10.4: RFC 9421 / JOSE / COSE / DSSE), transparency logs, and public verifier flows are forward design** (`GAID-Federated`+).
- **Identity:** the resolved coworker's `GAID` (private namespace, install-discriminated per §6.4) is recorded on every receipt; the delegating coworker's `GAID` remains in the chain (§10.3). Agent Capability Card projects from `Agent` + `AgentSkillAssignment` + governance (per the A2A-runtime spec's `agent-card-service`).
- **Custody storage:** receipts/links live in `TaskRun.a2aMetadata.custody` + `parentTaskRunId`/`DelegationChain` + `AuthorizationDecisionLog` — **no new top-level custody table in V1** (reconcile, don't duplicate — consistent with the A2A-runtime spec's "Governance Envelope Storage").
- **Forward — hive federation:** cross-boundary receipts gain `cross-boundary` authorization class, boundary-mapped private↔public `GAID` (§6.5), signatures, and DPoP-style sender constraint (§10.4) — none in V1.

---

## 8. Authority and Governance Model

| Concern | V1 mechanism | Source of truth |
|---------|--------------|-----------------|
| May this hop happen? | ocap attenuation (`DelegationChain`) → ABAC reachability rule → ReBAC sparse check → (ambiguous) WWMD | `delegation-authority.ts`, `principle_decide`, TAK gate |
| Who decides ambiguous routes? | `DecisionInteraction` (WWMD): recommend / arbitrate / escalate / defer, with confidence + audit | `option-scoring.ts`, `DecisionInteraction` |
| What is logged? | one `AuthorizationDecisionLog` per gated hop + sampled GAID receipt | `AuthorizationDecisionLog`, GAID §10 |
| Who owns a handed-off flow? | PAR (Propose, Acknowledge, Reassign): resolver explicitly acknowledges before mutating; reassignment is explicit state | `feedback_propose_acknowledge_reassign` |
| Least privilege | authority never widens on a hop; `auth-required` → HITL | GAID §9.3, ocap attenuation |
| Evidence vs provenance | gates pass on evidence quality regardless of producing agent | `feedback_governance_approves_evidence_not_provenance` |
| Visibility | capability flows render as coworker→capability→coworker routes + markers | `project-routing-topology.ts` |

---

## 9. Open Questions

1. **Taxonomy governance.** Who owns the `taskClass` vocabulary lifecycle (add/deprecate/merge), and at what granularity does it stop helping routing and start fragmenting it? (Ties to GAID §11.3 extension-registry model.)
2. **Confidence threshold for WWMD escalation.** What router-confidence / sensitivity / authorization-class combination should force a `DecisionInteraction` vs. proceed deterministically? Needs calibration data from EP-AI-OPSMAP.
3. **Sampling rates.** Head-sample fraction and tail-retention TTLs per sensitivity tier — start conservative (retain more) and tighten as aggregate confidence grows?
4. **Fan-out and depth defaults per value stream.** Is `MAX_FLOW_DEPTH=4` right for all value streams, or should `operate`/incident flows allow deeper supervisor trees than `consume` flows?
5. **Capability Card vs A2A AgentCard.** Should the internal Capability Card *be* an A2A `AgentCard` projection from day one (forward-compatible with federation), or a leaner internal-only shape until hive work begins?
6. **Relationship to `spawn_work_thread`.** Should `spawn_work_thread` eventually become a *special case* of `request_capability` (self-pinned, same `taskClass` family), unifying the two, or stay distinct? (Decision deferred to after Slice 2.)
7. **Reduction-Gear interplay.** How does capability routing compose with EP-REDUCTION-GEAR-ARCH's `GearInterface` concentric-loop substrate (89-item epic) — is a gear a capability endpoint?

---

## 10. Phased Slice Plan — Named-Peer → Capability, No Flag-Day

Migration principle (from the A2A-runtime spec's option 3): **build the capability path alongside the existing primitives, make it primary, and let named-peer pins survive as overrides — never a cutover.** Post-#1466 (§0), `isHandoffPermitted` is a live fail-closed gate, so the migration is *additive interception*, not a rewrite: capability resolution is inserted **in front of** the existing gate (resolve `taskClass` → candidate target → the existing `isHandoffPermitted`/`DelegationChain` checks still apply to the *resolved* target), and `delegatesTo` is only later demoted to an optional pin. Nothing in `coworker-collaboration.ts` is ripped out; it gains a resolver upstream. Low risk, no flag-day.

### Slice 1 — Capability spine (additive, no behavior change to existing flows)
- Define the `taskClass` taxonomy (wiki kind), bootstrapped from `AgentSkillAssignment` + `CoworkerCapabilityNeed.kind` + value streams.
- Add `routeCapability` reusing the `routeTask` pipeline shape; emit `CapabilityRouteDecision` (renders in Ops Map immediately).
- Agent Capability Card projection (`taskClasses`, tier, sensitivity clearance, authorization classes, health).
- **Exit:** given a `taskClass` + sensitivity, the platform returns a ranked, policy-filtered candidate list with a traceable decision. No coworker calls it yet.

### Slice 2 — `request_capability` through the queue (the primary new path)
- Add the `request_capability` MCP tool (grant: a new `capability_request`, composed from `thread_write`).
- Add `capability-request` `WorkItem` source type + `TaskNode` mediation; `routeWorkItem` invokes `routeCapability`.
- Wire ocap attenuation (`DelegationChain.extendChain`) + ABAC reachability rule + `AuthorizationDecisionLog` per hop.
- Question-packet `objective` (A2A artifact) mandatory for consequential classes.
- **Exit:** a coworker mid-flow summons a capability; the platform resolves, gates, mediates, and the resolved coworker executes — with a per-hop authorization log. `delegatesTo` still untouched.

### Slice 2.5 — Bounds + WWMD on the capability path
- Per-flow depth/fan-out caps, token/cost budget, rate limit; per-capability circuit breaker (generalize `bounded-autonomous-review`/`rate-recovery`).
- Ambiguous/consequential routes escalate to `DecisionInteraction` (WWMD); `auth-required` → HITL.
- **Exit:** capability flows are bounded and governed; runaway/loops/over-scope are contained, not catastrophic.

### Slice 3 — Evidence at scale
- GAID §10 receipt emission on consequential hops (`GAID-Private`, hash tamper-evidence, no signing).
- Head + tail sampling policy; flow-pattern aggregation on `repeatedPatternKey`; retention tiers; sampling policy logged.
- Ops Map renders coworker→capability→coworker flows + governance markers.
- **Exit:** "show every consequential/anomalous capability hop touching restricted data" is answerable in full; routine hops answered by aggregates; storage grows with *questions*, not traffic.

### Slice 4 — Demote named-peer to pin (the actual migration moment)
- `request_capability.pin` honored as override; `escalatesTo` repurposed as fallback capability `escalation.<domain>`.
- Documentation + UX reframe: `delegatesTo` is an *optional pin list*, not a routing requirement; any standing adjacency UI becomes "preferred/pinned peers."
- **Exit:** capability routing is the default; named-peer survives only as evidenced, opt-in pins. No flag-day occurred — pins kept working throughout.

### Forward (post-V1, not scoped here)
- Hive / cross-company capability federation (`cross-boundary` class, boundary mapping, `GAID-Federated`).
- Receipt signing + transparency logs + public verifier flows (`GAID-Federated`/`Public`).
- Unify `spawn_work_thread` under `request_capability` (Open Question 6).

---

## 11. Relationship to Existing Specs and Epics

| Spec / Epic | Relationship |
|-------------|--------------|
| **EP-A2A** (this spec's epic) | This is the design spec EP-A2A lacked (`hasSpec:false`). It defines *how* agent-to-agent coworker orchestration scales without N×N. |
| **`2026-04-23-a2a-aligned-coworker-runtime-design.md`** | That spec makes `TaskRun` the canonical A2A `Task` and defines the question-packet artifact, Agent Card projection, and governance-envelope storage. This spec *consumes* all of those as the mediation/evidence substrate — it does not re-define them. |
| **`2026-04-04-collaborative-work-queue-design.md` (EP-CWQ-001)** | The queue is the mediation hub (5.2). `request_capability` adds a `capability-request` source type; `routeWorkItem`'s `capability-match` mode is the entry point. |
| **EP-ROUTING-11** | `routeCapability` reuses the `routeTask`/`routePrimary` pipeline and "no provider pinning" philosophy for *agent* selection. |
| **EP-PRINCIPLES / EP-WWMD-MCP** | `principle_decide` is the authority/ambiguity decision engine (5.3); `taskClass` is a wiki kind like principles. |
| **GAID.md** | §9 authorization classes label every hop; §10 receipts are the evidence record; `GAID-Private` is the V1 posture. |
| **EP-AI-OPSMAP** | Capability flows project onto the existing routing topology surface. |
| **EP-REDUCTION-GEAR-ARCH** | Open Question 7 — interplay with `GearInterface` concentric loops. |
| **#1466 — `2026-06-04-multi-agent-collaboration-visibility-design.md`** | The named-peer *conversational* layer this spec scales (see §0). #1466 ships `request_coworker`/`summon_coworker` + the live fail-closed `isHandoffPermitted` gate (Slices 1A→2), the GAID call-stack (Slice 2.5: trace/receipt/`authorization_class`), and pattern mining (Slice 3). This spec **composes onto** all of it: `request_capability` resolves a capability to a target *in front of* `isHandoffPermitted`; §5.4/§7 evidence sampling extends #1466 Slice 2.5; §5.5 bounds reconcile its real caps. Not a competitor — the scale layer. |

---

## 12. Recommendation

Adopt capability-routed handoff as the primary multi-agent interaction model, built by **composing existing substrate** — the `routeTask` router, the collaborative work queue, the `DelegationChain` capability-attenuation primitive, the `principle_decide` vector policy engine, the GAID receipt shape, **and #1466's now-shipped named-peer handoff layer** — rather than introducing parallel machinery. Add exactly three genuinely-new pieces: a `request_capability` MCP tool, a canonical `taskClass` taxonomy, and a sampling+aggregation evidence layer. Keep `delegatesTo`/`escalatesTo` as optional, evidenced pins. Migrate in four additive slices with no flag-day. The urgency is now concrete (§0): #1466 just shipped the named-peer allowlist gate **fail-closed and live**, so the `O(N²)` maintenance burden this spec retires is no longer hypothetical — capability resolution should land in front of that gate before the workforce scales past hand-maintainable adjacency.

This is the convergent answer of every serious multi-agent and distributed system surveyed in Section 3: **declare the work, not the worker; mediate through a hub; authorize by attenuated capability over attributes and relationships; and sample + aggregate the evidence.** It scales to 1k–10k coworkers, preserves full custody where it matters, and leaves a clean forward path to the cross-company hive.

---

## Sources

Multi-agent frameworks: [OpenAI Agents SDK — Handoffs](https://openai.github.io/openai-agents-python/handoffs/) · [AutoGen — Selector Group Chat](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/selector-group-chat.html) · [AutoGen — GraphFlow](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/graph-flow.html) · [LangGraph Supervisor](https://reference.langchain.com/python/langgraph-supervisor) · [LangChain — Handoffs](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs) · [A2A Protocol v0.3.0 Specification](https://a2a-protocol.org/v0.3.0/specification/) · [A2A — AgentCard](https://agent2agent.info/docs/concepts/agentcard/) · [FIPA Contract Net Interaction Protocol (SC00029)](http://www.fipa.org/specs/fipa00029/SC00029H.html)

Distributed systems: [Google Dapper](https://research.google/pubs/pub36356/) · [OpenTelemetry — Sampling](https://opentelemetry.io/docs/concepts/sampling/) · [OpenTelemetry — Tail Sampling](https://opentelemetry.io/blog/2022/tail-sampling/) · [Temporal — Orchestrate vs Choreograph your Saga](https://temporal.io/blog/to-choreograph-or-orchestrate-your-saga-that-is-the-question) · [Netflix Hystrix Wiki](https://github.com/Netflix/Hystrix/wiki) · [Istio](https://istio.io/latest/docs/concepts/) · [SPIFFE](https://spiffe.io/docs/latest/spiffe-about/overview/) · [Consul service discovery](https://developer.hashicorp.com/consul/docs/concepts/service-discovery) · Erlang/OTP supervisor principles

Authorization at scale: [NIST SP 800-162 (ABAC)](https://csrc.nist.gov/publications/detail/sp/800-162/final) · [Google Zanzibar (USENIX ATC 2019)](https://research.google/pubs/pub48190/) · [OpenFGA — What is FGA](https://openfga.dev/docs/fga) · [OpenFGA — Authorization Concepts](https://openfga.dev/docs/authorization-concepts) · capability-based / object-capability security (Miller et al.)

DPF substrate (in-repo): `apps/web/lib/routing/task-router.ts` · `apps/web/lib/tak/agent-router.ts` · `apps/web/lib/queue/queue-router.ts` · `apps/web/lib/tak/delegation-authority.ts` · `apps/web/lib/tak/agent-grants.ts` · `apps/web/lib/decision/option-scoring.ts` · `apps/web/lib/tak/bounded-autonomous-review.ts` · `apps/web/lib/ai-operations-map/project-routing-topology.ts` · `apps/web/lib/coworker-self-assessment/*` · `packages/db/prisma/schema.prisma` (Agent, DelegationChain, TaskRun, TaskNode, AuthorizationDecisionLog, CoworkerCapabilityNeed, DecisionInteraction) · `docs/architecture/GAID.md` · `docs/superpowers/specs/2026-04-23-a2a-aligned-coworker-runtime-design.md` · `docs/superpowers/specs/2026-04-04-collaborative-work-queue-design.md`
