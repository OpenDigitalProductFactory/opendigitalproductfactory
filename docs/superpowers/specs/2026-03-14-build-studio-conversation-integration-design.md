# EP-SELF-DEV-001B: Build Studio Conversation Integration + Backlog Bridge — Design Spec

**Date:** 2026-03-14
**Goal:** Wire the floating co-worker agent to the Build Studio so it guides users through the five phases (Ideate → Plan → Build → Review → Ship), then register shipped features as digital products with version tracking and backlog integration.

**Target user:** Same as EP-SELF-DEV-001A — non-developers who describe features in plain language. The agent handles the process.

---

## 1. Build-Aware Co-worker Agent

When the user is on `/build`, the floating co-worker panel connects to a **Build Specialist** agent.

### Route Registration

Add a `/build` entry to `ROUTE_AGENT_MAP` in `agent-routing.ts`:
- Agent ID: `build-specialist`
- Sensitivity: `internal`
- System prompt: dynamically built based on the active build's phase and brief

### Phase-Aware System Prompt

The agent's behavior changes based on the active build's `phase` field. The system prompt is rebuilt on each message send, injecting:
- Current phase and what the agent should do in that phase
- The Feature Brief (if populated)
- The build's portfolio context
- Available build MCP tools for the current phase

| Phase | Agent Behavior |
|-------|---------------|
| **Ideate** | Asks plain-language questions. Assembles Feature Brief. Validates completeness. Proposes advancing to Plan. Never asks technical questions. |
| **Plan** | Generates internal implementation plan (stored as JSON). Presents plain-language summary to user. Proposes advancing to Build. |
| **Build** | Launches sandbox. Orchestrates code generation. Handles iteration feedback. Enforces test gates. |
| **Review** | Runs tests, presents results. Guides user through preview verification. Proposes advancing to Ship. |
| **Ship** | Proposes deployment (HITL approval). Registers as DigitalProduct. Creates epic + backlog items. Destroys sandbox. |

### Context Injection

When `sendMessage()` detects the route is `/build`, it:
1. Looks up the user's active `FeatureBuild` (most recent non-terminal build)
2. Injects build context into the system prompt: `buildId`, `phase`, `brief`, `title`
3. Filters available MCP tools to those relevant to the current phase

---

## 2. Hybrid Conversation Flow (Ideate Phase)

The agent uses a hybrid approach: starts free-form, then fills gaps with targeted questions.

### Flow

1. User describes what they want (free text, screenshots, URLs)
2. Agent asks follow-up questions to fill Feature Brief fields:
   - Title (may already be set from build creation)
   - Description (what does it do, in plain language)
   - Portfolio context (which portfolio owns this — agent can suggest based on description)
   - Target roles (who will use it — agent can suggest based on description)
   - Data needs (what gets stored — agent translates to technical terms internally)
   - Acceptance criteria (what "done" looks like)
3. Agent summarizes the complete brief and asks for confirmation
4. On confirmation, agent calls `update_feature_brief` MCP tool and proposes advancing to Plan

The agent never asks technical questions (no "what database schema do you need?"). It translates plain language to technical concepts internally.

---

## 3. Build Phase Sub-Steps

The Build phase expands into an internal workflow that mirrors the IT4IT Requirement-to-Deploy value stream:

| Sub-step | What Happens | Gate to Advance |
|----------|-------------|-----------------|
| **Generate** | Agent sends plan to coding model, writes files in sandbox | Files written successfully |
| **Iterate** | User gives feedback ("make button bigger"), agent modifies code | User says "looks good" or no more changes |
| **Test** | Agent runs `pnpm test` + `tsc --noEmit` in sandbox, reports results | All tests pass, no type errors |
| **Verify** | User clicks through live preview to manually confirm behavior | User explicitly approves |

The agent enforces this sequence — it won't propose advancing to Review until all four sub-steps are satisfied. If tests fail, the agent shows the failures and offers to fix them. The user can loop between Iterate and Test as many times as needed.

Sub-step progress is tracked in conversation context (not as schema fields). The `phase` stays `"build"` throughout. The phase indicator can optionally show a secondary hint (e.g., "Build — Testing").

---

## 4. Ship Phase — DigitalProduct Registration + Backlog Creation

When the user approves deployment in the Ship phase, a chain of actions fires (all via HITL-approved AgentActionProposals):

### Step 1: Deploy
- Agent extracts git diff from sandbox, applies to running platform, runs migrations
- Requires `manage_capabilities` (HR-000 only) — proposal pattern with HITL approval

### Step 2: Register as DigitalProduct
- Creates or updates a `DigitalProduct` record:
  - `name` from Feature Brief title
  - `lifecycleStage: "production"`, `lifecycleStatus: "active"`
  - `portfolioId` from the brief's portfolio context
  - `taxonomyNodeId` resolved from portfolio taxonomy
  - `version` bumped appropriately (see Section 5)
- If the build was started from an existing backlog item, links to its existing product instead of creating a new one

### Step 3: Create Epic + Backlog Items
- Creates an `Epic` linked to the portfolio (e.g., "EP-BUILD-001: Customer Feedback Form v1.0.0")
- Creates a "done" backlog item under the epic representing the shipped work
- Seeds an initial "open" backlog item: "Gather user feedback on [feature name]" — so the feedback loop starts immediately

### Step 4: Destroy Sandbox
- Container removed, phase set to `"complete"`

The agent presents a summary: "Deployed. Registered as product DP-XXXXX in the [portfolio] portfolio. Created epic EP-BUILD-001 with 2 backlog items. Sandbox destroyed."

From this point, all future work on that feature flows through the backlog on `/ops` — feedback, bugs, enhancements all become backlog items linked to that `DigitalProduct`.

---

## 5. Version Tracking

Add a `version` field to `DigitalProduct`:

- **First ship** of a new product → `version: "1.0.0"`, `lifecycleStage: "production"`
- **Subsequent builds** against the same product → agent increments the version:
  - Minor feature additions: `1.0.0` → `1.1.0`
  - Bug fixes from backlog: `1.1.0` → `1.1.1`
  - Major rework: `1.1.1` → `2.0.0`
- The agent proposes the version bump based on the scope of changes (user can override)
- The epic title includes the version: "EP-BUILD-003: Feedback Form v1.1.0"
- Each `FeatureBuild.diffSummary` acts as a lightweight changelog entry per version

When someone looks at a product in the inventory, they see the current version. When they look at the backlog, they see epics organized by version — a natural release history. No separate `Release` model needed.

---

## 6. Schema Changes

### DigitalProduct — add version

```prisma
  version         String   @default("0.0.0")  // semver — bumped on each shipped build
```

### FeatureBuild — add digitalProductId

```prisma
  digitalProductId String?
  digitalProduct   DigitalProduct? @relation(fields: [digitalProductId], references: [id])
```

Add to `DigitalProduct` model:
```prisma
  featureBuilds   FeatureBuild[]
```

Add index:
```prisma
  @@index([digitalProductId])
```

---

## 7. Files Affected

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/build-agent-prompts.ts` | Phase-specific system prompt templates for the build specialist agent |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | `DigitalProduct.version`, `FeatureBuild.digitalProductId` FK + reverse relation |
| `apps/web/lib/agent-routing.ts` | Add `/build` entry to `ROUTE_AGENT_MAP` with phase-aware prompt builder |
| `apps/web/lib/actions/build.ts` | Add `shipBuild()` action — deploy + register product + create epic/backlog + destroy sandbox |
| `apps/web/lib/actions/agent-coworker.ts` | Extend `sendMessage()` to inject active build context when on `/build` route |
| `apps/web/lib/mcp-tools.ts` | Add `register_digital_product`, `create_build_epic` tools; update `deploy_feature` handler |
| `apps/web/components/build/BuildStudio.tsx` | Wire co-worker panel awareness — pass active buildId, listen for phase changes via refresh |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Show build phase context when on `/build` route |

---

## 8. Testing Strategy

- **Unit tests for build-agent-prompts**: verify correct prompt for each phase, verify brief injection, verify tool filtering
- **Unit tests for version bumping**: semver increment logic (major/minor/patch)
- **Unit tests for shipBuild action**: mock Prisma calls, verify DigitalProduct + Epic + BacklogItem creation chain
- **MCP tool tests**: verify new tools are registered with correct capabilities
- **Integration**: Ideate → Plan → Build → Review → Ship with mock coding agent, verify full chain produces DigitalProduct + Epic + BacklogItems

---

## 9. Not in Scope

- **Sandbox code generation wiring** — the actual LLM-to-sandbox code writing pipeline (EP-SELF-DEV-001A infrastructure exists, but end-to-end orchestration is a future phase)
- **Hive Mind registry** — community feature marketplace (browse, install, rate packs)
- **Voice input** — describing features verbally
- **Multi-user collaboration** — multiple people working on the same build
- **Governed deployment pipeline** — formal change management / release gates beyond HITL approval
