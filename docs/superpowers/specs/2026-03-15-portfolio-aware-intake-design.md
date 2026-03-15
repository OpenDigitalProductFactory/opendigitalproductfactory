# EP-INTAKE-001: Portfolio-Aware Feature Intake — Design Spec

**Date:** 2026-03-15
**Goal:** When a user describes what they want to build, the platform searches existing portfolio context for related items, assesses complexity automatically, and either proceeds with a simple build or decomposes into a product + feature set with cost/debt trade-offs surfaced. For simple features, the agent drives all the way to a working prototype with screenshots.

**Target user:** Non-technical product owners describing features in plain language. The platform handles all technical decisions.

---

## 1. Context-Aware Search

When the user describes an idea during Ideate, the agent calls `search_portfolio_context` which queries:

- **Taxonomy nodes** — find the closest match in the 481-node hierarchy. Returns the node + ancestry (breadcrumb), telling the agent where this idea lives in the portfolio.
- **Existing products** — `DigitalProduct` records with matching names/descriptions + lifecycle stage. If something similar exists in `production`, the agent suggests extending it rather than building new.
- **Active builds** — other `FeatureBuild` records in progress. If someone else is building something similar, flag it (hook point for EP-DEDUP-001).
- **Backlog items** — open items that overlap. If there's already a backlog item for this, the agent says "this is already planned under epic X" and offers to start a build from it.

Search uses keyword matching against names/descriptions. The agent's current portfolio context (from route or build's `portfolioId`) weights results toward the relevant portfolio. Returns a `PortfolioContext` object with matches ranked by relevance.

The agent never shows raw search results — it weaves findings into the conversation: "This sounds like it belongs in the Products & Services portfolio, near the existing Customer Portal. There's also an open backlog item for 'customer feedback collection' — want to start from that?"

---

## 2. Automatic Complexity Assessment

After the agent has enough context from the conversation, it calls `assess_complexity` which scores the idea across 7 dimensions:

| Dimension | Score 1 (Simple) | Score 2 (Moderate) | Score 3 (Complex) |
|-----------|------------------|--------------------|-------------------|
| **Taxonomy span** | Single node | 2-3 nodes, same portfolio | Cross-portfolio |
| **Data entities** | 0-2 fields/models | 3-5 models | 6+ or relational |
| **Integrations** | Standalone | Reads from 1 existing product | Multi-product or external API |
| **Novelty** | Extending existing product | New feature in known area | Net-new product domain |
| **Regulatory** | No compliance needs | Audit trail needed | HITL approval chains required |
| **Cost estimate** | < 1 build | 2-4 builds | 5+ builds or third-party license |
| **Tech debt** | None | Known shortcut, payoff planned | Major dependency introduced |

The agent fills these scores from the conversation + portfolio search results. Total score determines the path:

- **7-10**: Simple — single FeatureBuild, agent proceeds autonomously to prototype
- **11-16**: Moderate — single FeatureBuild, agent presents plan for human review before building
- **17+**: Complex — decomposition required, agent calls `propose_decomposition`

The score and reasoning are stored on `FeatureBuild.plan` (Json field, already exists) for audit trail. The user never sees the score — they see the agent's plain-language recommendation.

---

## 3. Smart Decomposition

When complexity scores 17+, the agent calls `propose_decomposition` which generates:

**Output structure:**
- A proposed `Epic` with title and description
- A list of feature sets, each containing:
  - Title and plain-language description
  - Whether it becomes a `FeatureBuild` (simple) or pre-registered `DigitalProduct` (needs lifecycle)
  - Estimated build count
  - Dependencies on other features (build order)
  - Buy/build/integrate recommendation with rationale
  - Tech debt notes if shortcuts are recommended

**On user approval:**
1. Epic created via existing `createBuildEpic` pattern
2. DigitalProducts pre-registered at `lifecycleStage: "plan"`, `lifecycleStatus: "draft"`
3. FeatureBuilds created for items with no dependencies (can start immediately)
4. Tech debt items logged as `BI-REFACTOR-*` under EP-REFACTOR-001
5. Dependency order recorded so the platform unlocks next builds when predecessors ship

Adjustments to the decomposition are handled through continued conversation — the user says "merge those two" or "let's do the integration first" and the agent updates the plan.

---

## 4. Prototype Generation (Simple Path)

When complexity scores simple (7-10), the agent drives through to a working prototype:

1. **Ideate** — conversation fills the brief with portfolio context
2. **Plan** — agent generates approach (with complexity score stored)
3. **Build** — agent generates code in sandbox via `generate_sandbox_code`, launches dev server
4. **Preview** — agent uses `capture_sandbox_screenshot` (Playwright) to navigate the prototype and present screenshots in conversation
5. **Iterate** — user gives feedback ("make the button bigger"), agent calls `modify_sandbox_code` and re-screenshots
6. **Review** — agent runs `run_sandbox_command` for tests, presents results + final screenshots
7. **Ship** — existing flow (register product, create epic/backlog)

For moderate/complex paths, the same tools exist but more human checkpoints are enforced. The tools are identical — only the autonomy level differs (formalized later in EP-AUTONOMY-001).

---

## 5. New MCP Tools

All tools execute immediately (no approval dialog) except `propose_decomposition` which creates artifacts and needs user approval.

### Context + Assessment Tools

| Tool | Description | Execution |
|------|-------------|-----------|
| `search_portfolio_context` | Query taxonomy, products, builds, backlog for matches against a description | immediate |
| `assess_complexity` | Score idea on 7 dimensions, return path recommendation | immediate |
| `propose_decomposition` | Generate epic + feature sets for complex ideas | proposal (needs approval) |
| `register_tech_debt` | Log a known shortcut as a backlog item under EP-REFACTOR-001 | immediate |

### Sandbox Tools

| Tool | Description | Execution |
|------|-------------|-----------|
| `generate_sandbox_code` | Send plan to coding model, write files in sandbox container | immediate |
| `run_sandbox_command` | Execute a command (test, build, lint) in the sandbox | immediate |
| `capture_sandbox_screenshot` | Playwright navigates sandbox preview, returns screenshot | immediate |

`modify_sandbox_code` is handled by calling `generate_sandbox_code` with the existing code context + the modification request — no separate tool needed.

---

## 6. Files Affected

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/portfolio-search.ts` | `searchPortfolioContext()` — query + rank matches |
| `apps/web/lib/portfolio-search.test.ts` | Tests for search scoring and ranking |
| `apps/web/lib/complexity-assessment.ts` | `assessComplexity()` — 7-dimension scoring |
| `apps/web/lib/complexity-assessment.test.ts` | Tests for scoring logic and thresholds |
| `apps/web/lib/decomposition.ts` | `proposeDecomposition()` — generate epic + feature sets |
| `apps/web/lib/decomposition.test.ts` | Tests for decomposition output structure |
| `apps/web/lib/sandbox-codegen.ts` | `generateSandboxCode()`, `runSandboxCommand()` |
| `apps/web/lib/sandbox-playwright.ts` | `captureSandboxScreenshot()` — Playwright automation |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/mcp-tools.ts` | Add 7 new tool definitions + executeTool handlers |
| `apps/web/lib/build-agent-prompts.ts` | Update Ideate prompt to search context first; update Build prompt to generate + screenshot |
| `apps/web/lib/feature-build-types.ts` | Add `ComplexityScore`, `DecompositionPlan`, `PortfolioSearchResult` types |

---

## 7. Testing Strategy

- **Unit tests for portfolio search**: keyword matching, taxonomy traversal, ranking with portfolio weighting, empty results handling
- **Unit tests for complexity scoring**: each dimension independently, threshold boundaries (10/11, 16/17), overall path routing
- **Unit tests for decomposition**: output structure validation, dependency ordering, buy/build/integrate flags, tech debt item generation
- **Integration test**: full intake flow — describe idea → context search → complexity assessment → route to simple or decompose → verify correct artifacts created
- **MCP tool tests**: verify all 7 new tools registered with correct capabilities and execution modes

Sandbox codegen and Playwright screenshot tools: manual smoke tests during development.

---

## 8. Related Epics (Not in Scope)

- **EP-PARALLEL-001** — Parallel Feature Execution Engine (concurrent builds with orchestrator)
- **EP-AUTONOMY-001** — Agent Autonomy Controls (dial for human involvement level)
- **EP-DEDUP-001** — Duplicate Detection + Cross-Team Collaboration (enterprise-wide overlap detection)
- **EP-CODEGEN-001** — Full Code Generation Pipeline (advanced sandbox tooling)
- **EP-DEPLOY-002** — Build Studio Deployment Pipeline (governed deployment with rollback)
- **EP-REFACTOR-001** — Platform Refactoring (tech debt items created by `register_tech_debt` tool land here)
