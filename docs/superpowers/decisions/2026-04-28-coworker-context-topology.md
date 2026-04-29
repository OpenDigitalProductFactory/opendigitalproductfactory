# Decision Record: Coworker Context-Sharing Topology

| Field | Value |
|-------|-------|
| **ID** | DR-2026-04-28-02 |
| **Plan item** | A3 (added to Wave 1, Track A of [2026-04-28 sequencing plan](../plans/2026-04-28-coworker-and-routing-sequencing-plan.md)) |
| **Status** | Proposed |
| **Date** | 2026-04-28 |
| **Author** | Claude Opus 4.7 for Mark Bodman |
| **Format** | Nygard-classic ADR |
| **Companion** | [DR-2026-04-28-01](./2026-04-28-schema-changing-pr-contract.md) (A2 — schema-PR contract). A3 is independent — different concern. |
| **Documents existing system** | This decision **names** the already-implemented memory subsystem ([2026-03-17-shared-memory-vector-db-design.md](../specs/2026-03-17-shared-memory-vector-db-design.md), shipped via PRs around 2026-04-10/12) as DPF's canonical context-sharing topology. It does not redesign — most of this is documenting what's already running. |

---

## Context

PR #322's coworker self-assessment was authored before checking what context-sharing infrastructure DPF already has. That assessment treated each coworker as an isolated entry point and asked "does this role have what it needs?" That framing implies a **peer-agents topology** — every coworker is a root entry, no shared memory.

In conversation on 2026-04-28, Mark clarified: DPF is not a peer-agents system. It is a **shared-workspace, addressable-specialists topology** where the user can address any specialist directly (Marketing for marketing strategy, Sales for sales pipeline, etc.), the **COO is special** as a cross-cutting "shadow" that can be addressed directly *or* listen and pick up cross-route follow-ups, and **all coworkers read from a shared memory** so context follows the user across routes without re-explaining.

The further clarification: this is not a new design. The "brain" was implemented months ago. This decision record's job is to **find what was built, name it as canonical, and surface what is incomplete** so downstream work (C1 persona migration, B1 routing substrate, the Track D enablement batches) targets the right architecture.

## What is already built (evidence)

A code survey on 2026-04-28 against the worktree at HEAD = `origin/main` (`71a2a10d`) found:

### Core infrastructure (running)

- **[`docker-compose.yml`](../../../docker-compose.yml)** — Qdrant vector DB service, port 6333, healthchecked, volume-persisted. Already part of every `docker compose up`.
- **[`packages/db/src/qdrant.ts`](../../../packages/db/src/qdrant.ts)** — Qdrant client with two collections: `agent-memory` (conversation embeddings) and `platform-knowledge` (backlog/epics/specs). Indexes on `userId`, `agentId`, `routeContext`, `threadId`, `routeDomain`. Vectors are 768-dimensional via `nomic-embed-text-v1.5`.
- **[`apps/web/lib/inference/embedding.ts`](../../../apps/web/lib/inference/embedding.ts)** — local embedding pipeline via `model-runner.docker.internal/v1` (OpenAI-compatible endpoint). Graceful degradation: returns null if unavailable, chat continues without recall.

### Recall and store (wired into all coworker paths)

- **[`apps/web/lib/inference/semantic-memory.ts`](../../../apps/web/lib/inference/semantic-memory.ts)**:
  - `storeConversationMemory()` — fire-and-forget after each user message and each assistant response. Writes both halves of the turn to `agent-memory` keyed by `userId`/`agentId`/`routeContext`/`threadId`/`role`.
  - `recallRelevantContext()` — two-pass retrieval: route-scoped first (filtered to current `routeDomain`), global fallback if scoped returns fewer than 3 results, deduplicated against the current chat window. Threshold 0.55, default limit 8.

### Personal-brain layer (separate, complementary)

- **[`apps/web/lib/tak/user-facts.ts`](../../../apps/web/lib/tak/user-facts.ts)** — structured `UserFact` Postgres table with categories `preference | decision | constraint | domain_context`. Loaded by `loadUserFacts(userId, routeDomain?)` with route prioritization. Injected as **L1 context** (highest priority) ahead of the L2 semantic recall.

### Integration points

- **[`apps/web/lib/actions/agent-coworker.ts`](../../../apps/web/lib/actions/agent-coworker.ts)** — every single-message and multi-turn coworker dispatch path:
  1. Loads user facts (route-prioritized)
  2. Recalls semantic context (two-pass)
  3. Injects both into the system prompt
  4. After saving the response, fires the store call (user + assistant content)

### Shipped PRs (verified in git log)

- `8f8b0b5f` — feat(memory): scoped recall, arbitrated context, user facts, handoff compression
- `14c229ea` — fix(memory): bring AI coworker memory system online and optimize context quality
- `4fbeafc9` — docs(spec): TAK/GAID refresh — auth, identity, governed memory (#279)

The original spec is **[2026-03-17-shared-memory-vector-db-design.md](../specs/2026-03-17-shared-memory-vector-db-design.md)** (EP-MEMORY-001). It is up-to-date with the running system.

## Decision

**DPF's canonical context-sharing topology is "shared workspace memory + addressable specialists + COO overlay," already implemented as the brain subsystem above.** This decision record names that pattern, defines the roles, and lists the gaps.

### Topology

```
                ┌────────────────────────────────────────────┐
                │                Workspace                    │
                │       (= one DPF Org install, single-user)  │
                │                                            │
                │   ┌─────────────────────────────────┐      │
                │   │     Shared brain (per user)     │      │
                │   │                                 │      │
                │   │  L1: UserFact (Postgres)        │      │
                │   │      preferences, decisions,    │      │
                │   │      constraints, domain ctx   │      │
                │   │                                 │      │
                │   │  L2: agent-memory (Qdrant)      │      │
                │   │      conversation embeddings    │      │
                │   │      keyed by userId,           │      │
                │   │      routeDomain, agentId,      │      │
                │   │      threadId                   │      │
                │   │                                 │      │
                │   │  L3: platform-knowledge (Qdrant)│      │
                │   │      backlog, epics, specs      │      │
                │   └─────────┬───────────────────────┘      │
                │             │                              │
                │   ┌─────────┴─────────────────────┐        │
                │   ▼                               ▼        │
                │  Specialist (route-scoped)     COO         │
                │  (Marketing, Sales, etc.)     (cross-     │
                │  Reads: route-scoped first,    cutting    │
                │         global fallback        overlay)   │
                │                                Reads:     │
                │                                global     │
                └────────────────────────────────────────────┘
```

### Specialist behavior (most coworkers)

A specialist is **addressed directly** by the user when the user is in that route or explicitly switches to that specialist. The user enters the Marketing route → Marketing specialist is the front door. The Marketing specialist's recall:

1. Loads user facts, prioritizing those with `sourceRoute` matching the current domain.
2. Runs the two-pass semantic recall: **Pass 1 route-scoped** (`routeDomain = 'marketing'`), Pass 2 global if Pass 1 returns < 3 results. Already implemented.
3. Stores its own user/assistant turns into `agent-memory` with the current `routeContext`.

Specialists don't see other routes' transcripts directly — they see them only when the route-scoped pass returns insufficient results and the global fallback fires. This is the right default: a Marketing specialist should not be coloured by every Sales conversation, only by the cross-cutting facts the user has accumulated.

### COO behavior (the overlay)

The COO (AGT-ORCH-000) is special. Three modes:

1. **Addressed directly** — user goes to the COO route or `/coo`. Behaves like a specialist whose `routeDomain` is the empty / cross-cutting set. Recall query has no route-scoped pass; goes straight to global. Implementation: pass `routeContext: undefined` or a global-marker route to `recallRelevantContext()`. **Already supported by the existing two-pass code** — when `routeContext` is omitted, Pass 1 is skipped and Pass 2 runs immediately.
2. **Cross-cutting follow-up** — user finishes a marketing campaign with the Marketing specialist; the COO can pick up "the campaign needs sales-team coordination" without the user re-entering Sales explicitly. Implementation: COO recall is global; when the user resumes COO, prior route-scoped conversations are findable in the same Qdrant collection.
3. **Listening / shadow** — described conceptually as "the COO can be there, listening." Operationally this is **not** a parallel always-running agent (that's the rejected "two agents in the room" pattern from the market survey). It is the COO reading the same shared memory. The user does not see two agents in the room; the user sees the specialist they addressed, and when they return to the COO, the COO recalls what the specialist did because Qdrant is shared.

The COO does **not** have an interrupt / hand-raise primitive in v1. If you want the COO to surface a cross-cutting note while the user is in another route, that's a separate UX decision and a different track of work — not part of this decision.

### Specialist vs. COO — the only architectural difference

The only difference between a specialist's recall path and the COO's recall path is **whether Pass 1 (route-scoped) runs**. Specialists run it; COO skips it. Everything else is identical. **No code change is needed for v1** — `recallRelevantContext()` already supports both modes by virtue of `routeContext` being optional.

### Boundaries (what this topology is NOT)

- **Not "two agents in the room."** The market survey on 2026-04-28 confirmed this pattern is not winning anywhere as a default UI — token cost, speaker-selection failures, persona blurring. Rejected.
- **Not orchestrator+handoff with curated payloads.** OpenAI Agents SDK ships this; DPF does not need it because shared memory means there's nothing to "hand off." When the user moves from Marketing to Sales, both already see the same memory; the user is the router, not an orchestrator agent.
- **Not per-coworker memory silos.** Every coworker reads the same `agent-memory` collection, filtered by `userId` (and optionally `routeDomain`). One brain per user.
- **Not multi-user / multi-tenant.** DPF is single-org per install per memory `project_single_org_per_install.md`. The brain is keyed by `userId` because each install has one primary user; the implementation is naturally compatible with multi-user workspaces if that ever ships, but v1 does not target it.
- **Not LLM-specific.** Embeddings are from `nomic-embed-text-v1.5` regardless of which LLM the coworker uses. Memory is portable across model providers — switching from Claude to GPT to a local Llama doesn't lose context.

## Consequences

### Positive

- The architecture you wanted is already running. C1 (persona schema migration) and Track D (coworker enablement) can target it immediately.
- COO behavior is a code-no-op in v1 — just route the COO entry point through `recallRelevantContext()` with `routeContext: undefined`. Verify this is already happening; if not, it's a tiny patch.
- Specialists are addressable directly by user choice (today's Build Studio model is correct). Doesn't require an orchestrator agent.
- Cross-LLM portability is a property the system already has, not something to design.
- Local-only storage (Qdrant + Postgres in Docker volumes) means no privacy concerns, matching the user's stated preference.

### Negative

- **The L1/L2 layering is invisible to operators.** Today an admin cannot see what UserFacts are loaded vs. what semantic snippets are recalled vs. what was sent to the model. Spec §6 of the original memory spec called for a "Memory UI (view/delete)"; that UI is not built. Acceptable for v1 but eventually needed for trust.
- **Memory consolidation / summarization is not implemented.** Raw conversation turns accumulate forever. Spec called this out as future work. At some point this becomes a context-bloat problem; not a blocker for v1.
- **No "private to this conversation" mode.** Everything goes to the shared store. If the user wants to draft something the COO shouldn't see (e.g., "what if I cancel this campaign"), they'd need to do it outside the platform or use a per-thread privacy flag that doesn't exist yet. v1 accepts this; future work item.
- **The COO's "listening" mode is not a literal listening — it's recall on its turn.** If users describe the system in terms that suggest the COO has continuous awareness, that's a UX expectation mismatch worth managing in the COO persona's prompt content.

### Neutral

- The persona schema from PR #316 already supports this — `# Interfaces With` becomes the route-membership and handoff-target declaration; `# Out Of Scope` becomes the route-scoping declaration. C1's persona migration should populate these sections to match the topology.

## What this decision implies for downstream work

### C1 (persona schema migration) reshapes

Per the topology:
- Each persona's frontmatter `value_stream` field already declares its route (the existing schema covered this).
- The `# Interfaces With` body section should name (a) the COO as a cross-cutting peer, (b) any other specialists this role hands work to / receives work from, (c) the human supervisor role.
- The `# Out Of Scope` section should explicitly say "I do not pick up work outside `<my route>`. The COO handles cross-cutting follow-up." for specialists.
- The COO's persona is the inverse — its `# Interfaces With` lists every other specialist it can pick up from; its `# Out Of Scope` says "I do not author specialist work directly; I delegate."

C1 PRs (one per VS, per the C1 sub-sequencing) should populate these sections accordingly. **The persona schema does not change**; the section *content* is informed by this topology.

### PR #322 self-assessment partially reshapes

The 28 "blocked" verdicts in #322 were assessed assuming each coworker is a peer entry point. Under this topology:

- **For specialists:** "blocked" is still correct if the specialist's *route-scoped* tools are missing (e.g., AGT-131 sbom-management cannot read SBOMs — that's the same blocker regardless of topology).
- **For specialists whose blockers are about *cross-cutting* visibility:** topology answers some of them. AGT-ORCH-100's complaint that it "cannot read its own VS's outputs" is partially addressed if the COO picks up the cross-cutting summarization — though that's a UX assignment, not a tools assignment.
- **For the COO:** still blocked. COO needs `policy_read`, `strategy_read`, `budget_read`, `role_registry_read` — all unhonored. Topology doesn't fix that; T4.1 (governance reads) does.

PR #322's overall tally of 75 blocker findings is still substantively right; the framing softens but the work remains.

### B1 (Routing Phase A) does not depend on this

Routing decides which LLM endpoint serves a coworker call. That's orthogonal to which memory the coworker reads. B1 ships without coupling to memory.

### A2A spec status

The existing `2026-04-23-a2a-aligned-coworker-runtime-design.md` covers A2A as the wire format. This topology says A2A is **not** the cross-coworker context mechanism — Qdrant is. A2A becomes relevant when DPF needs to communicate with non-DPF agents (Salesforce's agent, an external partner's agent), at which point the brain becomes one party in the conversation and the foreign agent is another. That's downstream of v1.

## Alternatives Considered

### A. Peer-agents topology (what PR #322's framing assumed)

Rejected — does not match the implemented system, and Mark explicitly clarified the design.

### B. "Two agents in the room" (COO + specialist visible simultaneously)

Rejected per the market survey on 2026-04-28: AutoGen GroupChat / CrewAI hierarchical. Token cost, speaker-selection failures, persona blurring, and no consumer product ships it as default. Worse: the user described the desired outcome ("COO can pick up follow-ups across routes"), not the desired UI ("two agents talking at once"). Shared memory plus addressable specialists delivers the outcome without the UI cost.

### C. Orchestrator+handoff (OpenAI Agents SDK pattern)

Rejected for v1. The user specifically wants to address specialists directly. An orchestrator agent in front of every conversation adds latency, cost, and a layer of opacity (the orchestrator decides which specialist gets the question — not the user). DPF's current model lets the user be the router, which matches the "addressable specialists" requirement.

The COO can act as an orchestrator-like entity *when addressed*, but it isn't on the critical path of every conversation.

### D. Per-coworker memory silos

Rejected. Already not how the system is implemented (every coworker writes to the same `agent-memory` collection), and would defeat the user's stated goal of cross-route context preservation.

## Open questions for Mark

These do not block adoption of the topology as described, but answers improve subsequent work:

1. **COO entry-point verification.** Is the COO already invoked with `routeContext: undefined` (or equivalent) so it gets the global recall path? If not, it should be — and a one-line fix would make the topology behave correctly with no other changes. (Verifiable by reading the COO's invocation site in `agent-coworker.ts`.)
2. **Memory UI priority.** The "view/delete" UI for L1 user-facts and L2 conversation memory is unbuilt. Is that a near-term priority or a "later" item?
3. **Per-thread privacy.** Do you want a "this conversation does not get stored" toggle (e.g., for sensitive scenarios), or is the current "everything gets stored" acceptable?
4. **Cross-coworker hand-raise (the COO listening mode).** v1 says no — COO is recall-only on its turn. Future feature: COO surfaces a cross-cutting note while the user is in another route. UX-heavy. Confirm "no for v1."
5. **`# Interfaces With` content for C1.** With this topology defined, C1 personas should populate that section systematically. Want the C1 PRs to follow a template (every specialist's `# Interfaces With` says "AGT-ORCH-000 (COO) — cross-cutting peer; …other VS specialists I hand work to/receive from" plus the human supervisor)?

## Status

**Proposed.** Becomes **Accepted** when this PR merges. Becomes **Superseded** only when a meaningfully different context-sharing architecture replaces it (no such replacement is contemplated; this is the long-run shape).
