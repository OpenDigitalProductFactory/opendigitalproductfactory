# Multi-Agent (A2A) Verification Scenarios Across Archetypes

- **Date:** 2026-06-14
- **Status:** Research thread / verification design (not a feature build)
- **Purpose:** Anticipate the multi-agent collaboration scenarios the platform must handle
  across its ~16 business archetypes, and define a verification matrix that proves the A2A
  interactions AND the multi-agent visuals hold in each situation — before/while Build Studio
  is refactored.
- **Related specs:**
  - `2026-06-04-multi-agent-collaboration-visibility-design.md` — conversational handoff/summon/return visibility
  - `2026-06-04-ai-operations-map-a2a-interaction-visibility-design.md` — ops-map A2A band (typed edges)
  - `2026-06-05-deliberation-branch-identity-for-a2a-ops-map-design.md` — why deliberation edges are deferred (PAR)
  - `2026-04-21-deliberation-pattern-framework-design.md` — deliberation/debate pattern
  - `2026-04-23-a2a-aligned-coworker-runtime-design.md` — TaskRun/TaskMessage/TaskArtifact A2A runtime
  - `2026-05-10-ai-coworker-visual-control-surface-design.md` — operations map + per-archetype templates

---

## 1. Why this thread

The platform's value proposition is an AI *workforce*, not isolated agents — so the
collaboration between coworkers (A2A) is a first-class product surface. Today that surface is
exercised mostly by one scenario (Build Studio's orchestrator→specialist dispatch on the
`software-platform` archetype). As Build Studio is refactored and more archetypes ship, the
same A2A substrate and visuals must hold under collaboration shapes they have never been driven
through. This thread enumerates those shapes, maps each to an archetype that naturally produces
it, and defines what must be observable (and correct) on the conversational layer and the
operations-map A2A band.

## 2. Substrate truth (verified 2026-06-14)

**Two visual surfaces project the same canonical events — no parallel grammar:**

| Surface | Components | Sources |
|---|---|---|
| Conversational (in-chat) | `CollaborationActivityPanel`, `HandoffCard`, `ConversationParticipantRail`, `AgentCoworkerPanel` | SSE `collaboration:handoff\|summon\|return`; `TaskRun.a2aMetadata` |
| Operations-map A2A band | `A2aInteractionsPanel`, `project-a2a-interactions.ts`, `load-map-data.ts` | `DelegationChain`→delegation, `PhaseHandoff`→handoff, `TaskRun` lineage→task-lineage, `DeliberationRun`+`TaskNode`→deliberation |

Edge visual grammar: delegation = solid, handoff = long-dash, task-lineage = short-dash,
deliberation = dotted/fan. State→token: active=accent, completed=success, failed=error,
blocked=warning (color never sole channel).

**Known gaps this thread must treat as first-class (not silently "pass"):**

- **G1 — Archetype blindness.** Only `software-platform` and `it-managed-services` (MSP) have
  dedicated ops-map templates (`templates.ts`); ~14 archetypes fall back to
  `GENERIC_VALUE_CHAIN_TEMPLATE`. A2A visuals are therefore archetype-generic for most.
- **G2 — Deliberation not rendered.** `a2a-deliberation` edges are projected but the loader
  skips them — no `agentId` on `TaskNode` (deferred per the 2026-06-05 PAR spec). Debate/review
  fan-out is invisible on the ops map today.
- **G3 — Untested collaboration flow.** `coworker-collaboration.ts` request/summon/return
  (authority gate, depth-1/max-5-children limits, hop recording, event emit) and the SSE
  event→card→panel path have no E2E coverage.

## 3. The eight multi-agent interaction shapes

Collaboration reduces to a small set of *shapes*. Each archetype emphasizes a different subset;
verifying the shapes (not every archetype permutation) is the efficient coverage strategy.

| # | Shape | Canonical events / edges | Visual that must hold |
|---|---|---|---|
| S1 | **Sequential chain** (A→B→C) | `collaboration:handoff` ×N; `PhaseHandoff` | ordered handoff cards; chained handoff edges; participant rail grows |
| S2 | **Fan-out dispatch** (orchestrator→N specialists) | `orchestrator:task_dispatched`; `DelegationChain` | N delegation edges from one node; concurrent participant states |
| S3 | **Escalation** (worker→higher tier) | `queue:escalation` | escalation marker; severity bump (warning/critical) |
| S4 | **Deliberation / debate** (coordinator→branches→merge) | `deliberation:branch_dispatched\|degraded_diversity\|completed`; `DeliberationRun` | **G2** — fan edges + branch states; today only Decision Canvas provenance |
| S5 | **Approval-gated handoff** (work waits on human/owner) | `task:status=input-required`; gate | "WAITING" state; blocked edge; gate inspector |
| S6 | **Return / completion** (sub-agent→parent) | `collaboration:return`; `orchestrator:task_complete` | return card with outcome; participant marked done; edge→completed |
| S7 | **Cross-value-stream delegation** (consume→deploy→operate) | `DelegationChain` across stations | edges spanning stations/lines on the map |
| S8 | **Multi-tenant isolation** (MSP: per-customer estates) | scoped projections | **no cross-org edges**; per-customer projection mode |

## 4. Archetype → shape emphasis (where to drive each)

Drive each shape on the archetype that produces it most naturally; Marketing is the lead case
for the approval-gated cross-domain fan-out the user flagged.

| Archetype | Lead scenario | Shapes exercised | Collaborating coworkers |
|---|---|---|---|
| **software-platform** | Build Studio build | S2, S4, S6 | build-specialist → build-da/se/fe/qa; ux-accessibility, security-auditor (review); deliberation branches |
| **(any) Marketing campaign** | Campaign launch | **S1, S2, S5** | marketing-specialist + documentation-specialist (content) + licensing-specialist (jurisdiction/compliance) + finance-agent (budget) + consume-orchestrator (approval) |
| **software-platform / MSP** | Incident response | **S1, S3, S6** | monitoring → incident-detection → incident-resolution → service-support; P1 escalation to operate-orchestrator |
| **retail-goods / asset-rental** | Order→fulfillment (and reserve→use→return) | **S7, S6** | consume-orchestrator → order-fulfillment → deploy-orchestrator → iac-execution; (rental: resource-reservation) |
| **it-managed-services (MSP)** | Multi-tenant service ops | **S8, S3** | customer-intake → triage → agreements → service-operations across customer estates |
| **banking / public-sector / healthcare** | Compliance-gated onboarding | **S1, S5** | consumer-onboarding + licensing-specialist + data-governance + security-auditor + policy gates (KYC/consent) |
| **nonprofit-community** | Fundraising campaign | **S1, S5** | marketing-specialist (community/fundraising label) + customer-advisor + approval gate |
| **(cross-cutting) governance/EA** | Architecture review | **S4, S2** | governance-orchestrator + ea-architect + architecture-definition + constraint-validation + data-governance |

Marketing's archetype-adaptive role label (HOA community manager, healthcare patient recall,
retail promotion, nonprofit fundraising) means **one collaboration shape must render correctly
under several archetype skins** — a strong test of the visuals' archetype-parameterization.

## 5. Visual acceptance — what "works" means per surface

For every scenario above, both surfaces are checked:

**Conversational layer**
1. Quiet when 1:1; discloses to a roster + cards only on real multi-agent activity.
2. Each `handoff`/`summon`/`return` renders a card with from→to, tier, outcome; icon + text (no color-only).
3. Participant rail shows correct role (owner/peer/sub-agent), `enteredVia`, and per-participant task state.
4. Survives reload (provenance from `TaskRun.a2aMetadata`).
5. Depth-1 / max-5-children limits enforced and shown honestly (no fabricated branches).

**Operations-map A2A band**
6. Correct typed edge per shape (delegation/handoff/task-lineage/deliberation) with correct state color + label.
7. Inspector resolves from/to `Principal` (via `PrincipalAlias`), authority scope, build/gate context, source refs.
8. Filters (edge kind, state, role) behave; reduced-motion + keyboard/a11y hold.
9. **No cross-org edges** (S8); single-org invariant enforced defensively.
10. Deferred features render as *deferred*, not fabricated (G2: deliberation edges absent, not faked).

## 6. Proposed verification phases

- **P0 — Substrate fixtures.** Seed/synthesize each shape (S1–S8) as deterministic fixtures
  (events + rows) so scenarios are repeatable without driving full archetype installs. Extends
  the existing `project-a2a-interactions.test.ts` / `conversation-participants.test.ts` fixtures.
- **P1 — Shape coverage (unit/component).** Assert each shape projects the right edges/cards/states
  on both surfaces from its fixture. Closes G3's projection half.
- **P2 — Archetype skins.** Drive the Marketing campaign shape under ≥3 archetype skins
  (retail, healthcare/recall, nonprofit/fundraising, HOA/community) and assert the visuals
  parameterize correctly; confirm the generic-template fallback (G1) still renders A2A edges.
- **P3 — Live A2A E2E.** On a redeployed archetype install, drive request/summon/return and an
  incident escalation end-to-end (SSE → card → panel; ops-map band) — the dynamic-analysis
  sign-off (per `structural-verification-is-not-functional`).
- **P4 — Gap decisions.** From findings, decide: which archetypes need dedicated ops-map
  templates (G1), and whether to unblock deliberation rendering (G2) by capturing `TaskNode.agentId`
  (the 2026-06-05 PAR open item).

## 7. Open questions

- **OQ1:** Which archetypes warrant a dedicated ops-map template vs. an improved generic
  value-chain that still reads A2A edges? (G1 — decide in P4 on measured need.)
- **OQ2:** Do we unblock S4 deliberation rendering now (capture branch identity) or keep it
  deferred and verify only the Decision Canvas provenance path? (G2 — PAR decision.)
- **OQ3:** Approval-gated multi-agent (S5) — is the "waiting on owner" state a first-class
  visual on both surfaces, or only in chat today?
- **OQ4:** Does the Build Studio refactor change the dispatch/deliberation event shapes (S2/S4)
  the visuals depend on? (Coordinate fixtures with the refactor.)
