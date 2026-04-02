# Agentic Architecture Patterns — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-TAK-PATTERNS (Trusted AI Kernel — Architectural Patterns) |
| **IT4IT Alignment** | Cross-cutting: applies to all value streams (Explore, Integrate, Deploy, Release) |
| **Status** | Active Reference |
| **Created** | 2026-04-02 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |
| **Provenance** | Patterns derived from analysis of the Claude Code source leak (March 31, 2026 — 512K lines of TypeScript, ~1,900 files, exposed via npm sourcemap in v2.1.88) and validated against DPF's production experience with multi-model agentic workflows. |

## Purpose

This is a **foundational design reference** for all future agentic features on the platform. When designing new agent behaviors, tool systems, prompt structures, or multi-phase workflows, implementers MUST consult this spec. It captures hard-won patterns — both from Anthropic's own production agent system and from DPF's operational experience — that prevent known failure modes.

This spec does NOT describe a single feature. It describes **how to build features** that involve AI agents.

---

## 1. Model Routing Per Task Type

### Pattern

Different tasks require different model capabilities. Planning requires reasoning depth. Code generation requires coding fluency. Simple tool orchestration (deploy, ship) can use cheaper models. A single model for all tasks wastes money on simple tasks and underperforms on hard ones.

### How Claude Code Does It

- **ULTRAPLAN**: Offloads planning to Opus running in a cloud container for up to 30 minutes
- **opusplan mode**: Opus for planning/architecture, Sonnet for code generation
- **COORDINATOR_MODE**: Multi-agent swarm with research agents (lighter), synthesis agents (reasoning-heavy), and implementation agents (coding-heavy)
- **Fast mode**: Same Opus model with faster output — does NOT downgrade to a weaker model

### How DPF Implements This

Quality tier system in `apps/web/lib/routing/quality-tiers.ts`:

| Tier | Models | Use Case |
|------|--------|----------|
| `frontier` | Opus 4, Sonnet 4, GPT-5, o1/o3/o4 | Build Studio code generation, complex reasoning |
| `strong` | Haiku 4, GPT-4o, Gemini 2.5 Pro | Admin, platform management, most tool orchestration |
| `adequate` | GPT-4o-mini, Gemini Flash, Claude 3 Haiku | Basic conversation, simple tasks |
| `basic` | Llama, Phi, Qwen, Mistral, DeepSeek | Local-only, no cloud cost |

Agent-to-tier mapping in `apps/web/lib/tak/agent-routing.ts`:

| Route | Agent | Tier | Budget |
|-------|-------|------|--------|
| `/build` | Software Engineer | `frontier` | `quality_first` |
| `/platform` | AI Ops Engineer | `strong` | `balanced` |
| `/admin` | System Admin | `strong` | `balanced` |
| `/setup` | Setup COO | `basic` | `minimize_cost` |
| All others | Domain specialist | `strong` | `balanced` |

### Rules for Future Development

1. **Never use frontier tier for tasks that don't require it.** Ship, deploy, and simple CRUD operations work fine with `strong` or `adequate`.
2. **Never use basic tier for tasks that require tool orchestration.** Local models struggle with multi-step tool calling sequences.
3. **Admin-configurable overrides take precedence.** The `AgentModelConfig` DB table lets admins pin specific models per agent. Code defaults are fallbacks, not mandates.
4. **When adding a new agent or route**, explicitly set `modelRequirements` with `defaultMinimumTier` and `defaultBudgetClass`. Never rely on implicit defaults.
5. **Fast mode is NOT a model downgrade.** If implementing a fast/slow toggle, adjust inference parameters (temperature, max_tokens), not the model selection.

---

## 2. Phase-Aware Duration Limits

### Pattern

Different phases of work have fundamentally different time profiles. Code generation involves waiting for sandbox operations. Planning involves iterative search-and-compose cycles. Deploy involves sequential pipeline steps. A single time limit either starves slow phases or permits runaway loops on fast phases.

### How Claude Code Does It

- ULTRAPLAN: 30 minutes for planning
- Standard conversation: short timeout
- Background agents (KAIROS): no hard timeout — daemon runs indefinitely with periodic check-ins

### How DPF Implements This

Phase-aware duration limits in `apps/web/lib/tak/agentic-loop.ts`:

| Phase | Duration | Detection Method |
|-------|----------|-----------------|
| Conversation | 2 min | No build/phase tools detected |
| Ideate | 5 min | `search_project_files`, `saveBuildEvidence`, `save_build_notes` detected |
| Plan | 5 min | `reviewBuildPlan`, `saveBuildEvidence(buildPlan)` detected |
| Build | 10 min | Sandbox tools detected (`launch_sandbox`, `generate_code`, etc.) |
| Review | 4 min | `generate_ux_test`, `run_ux_test`, `check_deployment_windows` detected |
| Ship | 5 min | `deploy_feature`, `execute_promotion`, etc. detected |

### Rules for Future Development

1. **Duration is detected from tool usage, not declared.** The loop infers the phase from which tools have been called. This means new tools must be added to the detection lists in `agentic-loop.ts` if they belong to a specific phase.
2. **Weaker models need more time, not more iterations.** A Haiku model making 15 iterations in 5 minutes is fine. Capping at 100 iterations is a safety net, not a behavioral limit.
3. **If adding a new phase or workflow type**, add a corresponding `MAX_DURATION_*_MS` constant and add its tool names to the detection logic. Follow the existing cascade: `hasBuildTools ? BUILD : hasShipTools ? SHIP : ...`
4. **Never increase `MAX_ITERATIONS` above 100.** If a workflow needs more iterations, the model is stuck or the task needs decomposition. Tune duration limits instead.

---

## 3. Cross-Phase Memory (Handoff Briefings)

### Pattern

When work transitions between phases (or between agents), raw conversation history is a terrible context transfer mechanism. It's too long, too noisy, and contains abandoned ideas alongside final decisions. Structured handoff summaries preserve the *why* behind decisions while discarding the noise.

### How Claude Code Does It

- **MEMORY.md**: Lightweight index (~150 chars/line) always loaded into context. Points to topic files.
- **Topic files**: Detailed knowledge fetched on-demand via grep. Never fully loaded.
- **autoDream**: Background memory consolidation — merges observations, removes contradictions, converts vague insights into verified facts.
- **Memory as hint**: Agents are instructed to treat memory as a hint and verify facts against the actual codebase before acting.

### How DPF Implements This

Two-layer system:

**Layer 1: Running Spec** (`save_build_notes` tool)
- Writes to `FeatureBuild.plan` JSON field
- Append-only arrays: processes, requirements, decisions, integrations, dataModel, openQuestions
- Available in ideate and plan phases
- Injected as "--- Running Spec ---" in the system prompt

**Layer 2: Phase Handoff** (`save_phase_handoff` tool)
- Writes to `PhaseHandoff` relational model
- Structured: summary, decisionsMade, openIssues, userPreferences, evidenceFields, evidenceDigest
- Available in ideate, plan, build, and review phases
- Injected as "--- Briefing from Previous Phases ---" in the system prompt
- Each phase prompt instructs the agent to call this as their LAST action before transition

### Rules for Future Development

1. **Every multi-phase workflow MUST have a handoff mechanism.** If you add a new multi-step process (e.g., incident response, compliance audit), design the handoff structure before implementing the phases.
2. **Handoffs are structured, not free-text.** Define specific fields (decisions, risks, preferences) so downstream agents can parse and act on them programmatically.
3. **Handoffs include rejected alternatives.** The downstream agent must know what was considered and dropped, not just what was chosen — otherwise it may re-propose rejected ideas.
4. **The Running Spec accumulates; the Handoff summarizes.** `save_build_notes` captures everything as it happens. `save_phase_handoff` distills it into what the next phase needs to know. Both are necessary.
5. **Memory is a hint, not truth.** Always instruct agents to verify handoff claims against actual state (DB records, file contents) before acting on them. Stale handoffs from abandoned builds should not drive new work.
6. **When adding a new evidence field to FeatureBuild**, update the `PhaseHandoff.evidenceFields` and `evidenceDigest` to track which fields were populated and why.

---

## 4. Fabrication and Frustration Detection

### Pattern

LLMs have two primary failure modes in agentic loops: (a) claiming they did something without calling tools (fabrication), and (b) apologizing and hedging instead of trying a different approach (frustration). Both waste the user's time and erode trust.

### How Claude Code Does It

- **~20 frustration regexes** matching apology/hedging patterns
- **Fake tool injection** (anti-distillation) to detect and confuse training data extraction
- **Nudge system** that injects "you have tools, use them" when the model stalls
- **Fabrication detection** checking completion claims against tool execution history

### How DPF Implements This

Three detection layers in `apps/web/lib/tak/agentic-loop.ts`:

**Layer 1: Fabrication Detection** (`detectFabrication()`)
- `COMPLETION_CLAIM_PATTERN`: 14 completion verbs (built, deployed, shipped, etc.)
- `NARRATION_PATTERN`: 7 code-narration phrases (here's the code, add this, copy-paste)
- Checks whether BUILD tools were actually called — read-only tools don't count
- Single retry with a forceful "STOP. Call a tool NOW." message

**Layer 2: Frustration Detection** (`FRUSTRATION_PATTERN`)
- Matches apology/hedging phrases: "I apologize", "I'm unable to", "beyond my capabilities"
- 3-strike system: first 2 get phase-aware nudges, 3rd triggers honest breakout
- Only fires when fabrication detection did NOT already handle the response
- Only fires when tools were NOT stripped by routing degradation (prevents nudging a model that correctly can't use tools)

**Layer 3: Nudge System** (`shouldNudge()` + `getPhaseSpecificNudge()`)
- Generic nudge: "You have tools — use them. Your tools include: [top 5]"
- Phase-aware nudge: suggests specific tools based on which tools have been used so far
- Preserves best pre-nudge response in case the nudge produces an empty response
- Clarifying questions and substantive conversational replies are exempt from nudging

### Rules for Future Development

1. **New completion verbs must be added to `COMPLETION_CLAIM_PATTERN`.** If you add a tool that "provisions", "migrates", "archives", or similar, add the verb to the pattern.
2. **Frustration patterns must be narrow.** Only match clear apology/hedging. "Let me try again" and "there seems to be an issue" are legitimate status updates during iterative fix cycles — do NOT add them to `FRUSTRATION_PATTERN`.
3. **Phase-specific nudges must be updated when adding new tools.** The `getPhaseSpecificNudge()` function infers the phase from tool usage. New tools need to be added to the right branch.
4. **Never nudge when tools were stripped.** If routing degradation removed tools from the model, it correctly responded with text only. Nudging it to use tools causes hallucinated tool calls.
5. **The 3-strike rule is non-negotiable.** After 3 frustration detections, break the loop and tell the user honestly. Do not increase this limit — 3 rounds of apology is already too many.
6. **Fabrication detection runs before frustration detection.** This ordering matters because fabrication is a harder failure (the model lied about its actions) while frustration is softer (the model is stuck but honest about it).

---

## 5. Dynamic Tool Descriptions

### Pattern

Static tool descriptions don't account for session history. If a tool failed with a specific error, the model has no signal in the tool description to try a different approach. It may repeat the same failing call.

### How Claude Code Does It

- Tool descriptions are adjusted based on what the agent has already tried in the current session
- Warnings are appended to descriptions for tools that previously failed
- The adjustment is per-session, not persistent

### How DPF Implements This

`enrichToolDescriptions()` in `apps/web/lib/tak/agentic-loop.ts`:

- Runs before every `routeAndCall` invocation inside the loop
- Builds a failure map from `executedTools` — tracks the last error per tool name
- If a tool failed, appends `[WARNING: This tool failed earlier with: "..."]` to its description
- If a tool later succeeds, the warning is cleared (the tool recovered)
- Mutates nothing — returns a new array

### Rules for Future Development

1. **Enrichment is read-only.** Never modify the original tool definitions. Always return a new array.
2. **Warnings must be concise.** Errors are truncated to 150 characters. The warning is for the model's decision-making, not for debugging.
3. **Success clears warnings.** If a tool fails then succeeds on retry, remove the warning. The model should not be discouraged from using a tool that's now working.
4. **Do NOT add persistent tool reputation.** Session-aware enrichment is correct. Cross-session tool reputation would create stale warnings that prevent the model from using tools that were fixed in a deployment.
5. **When adding tools with known failure modes**, consider adding specific recovery hints to the tool description itself (e.g., "If this fails with 'file exists', use edit_sandbox_file instead"). This is complementary to dynamic enrichment.

---

## 6. Modular Prompt Composition

### Pattern

System prompts for agentic workflows must be assembled from composable blocks, not monolithic strings. Different users have different roles, permissions, and data access levels. Different pages show different data. The agent's identity, authority, mode, and context must be independently configurable.

### How Claude Code Does It

- 7-block prompt composition (identity, authority, mode, sensitivity, domain, page data, attachments)
- Plugin architecture where each tool registers its own prompt contribution
- Context-dependent tool availability (not all tools available everywhere)

### How DPF Implements This

`assembleSystemPrompt()` in `apps/web/lib/tak/prompt-assembler.ts`:

| Block | Content | Dynamic? |
|-------|---------|----------|
| 1. Identity | 18 critical rules, platform context, current date | Static |
| 2. Authority | Role, granted/denied capabilities | Per-user |
| 3. Mode | Advise (read-only) vs Act (execute) | Per-session |
| 4. Sensitivity | Data classification level | Per-route |
| 5. Domain Context | Agent persona, behavior, available tools | Per-route |
| 6. Page Data | What the user currently sees | Per-page |
| 7. Attachments | Uploaded file content | Per-message |

Build Studio adds additional blocks via `getBuildContextSection()`:

| Block | Content |
|-------|---------|
| Feature Brief | Title, description, acceptance criteria |
| Running Spec | Accumulated build notes from conversation |
| Phase Handoffs | Briefings from previous phases |
| Phase Prompt | Phase-specific instructions and workflow |
| Contribution Mode | fork_only / selective / contribute_all awareness |
| IT4IT Context | Value stream, stage, responsible agents, requirements |
| Build Execution State | Pipeline step, sandbox ID, test results (live) |

### Rules for Future Development

1. **Never add information to the Identity block.** It's already 18 rules. New rules go in the Domain Context block for the relevant route.
2. **New routes MUST define a domain context** in `apps/web/lib/tak/route-context-map.ts` with sensitivity level, domain context string, and domain tools list.
3. **Tool availability is per-route AND per-phase.** Build Studio tools have a `buildPhases` array. Other routes filter by `requiredCapability`. When adding tools, set BOTH filters.
4. **Page data should be raw facts, not instructions.** The Page Data block shows what the user sees. The Domain Context block tells the agent how to interpret it. Don't mix the two.
5. **Prompt size matters.** Every token in the system prompt consumes context window and increases cost. Be concise. The Running Spec is capped at 4,000 characters. Phase handoffs should be kept under 500 characters per handoff. If a block is growing unbounded, add truncation.
6. **Contribution mode is a design signal, not just a ship-phase gate.** It's injected in all phases so the agent can flag proprietary concerns during ideate/plan, not just at ship time.

---

## 7. Tool Architecture

### Pattern

Each agent capability should be a discrete, permission-gated tool with explicit execution mode (immediate vs. proposal), side-effect declarations, and phase availability. The tool registry is the single source of truth for what the agent can do.

### How Claude Code Does It

- ~40 built-in tools + ~20 additional via feature flags = ~60 total
- Base `Tool.ts` definition: 29,000 lines
- Each tool is a standalone module with permission requirements
- Sub-agents are spawned as tool calls (no special orchestration layer)
- Anti-distillation: fake tools injected to poison training data extraction

### How DPF Implements This

Tool registry in `apps/web/lib/mcp-tools.ts`:

| Field | Purpose |
|-------|---------|
| `name` | Tool identifier (snake_case) |
| `description` | What the tool does (shown to the model) |
| `inputSchema` | JSON Schema for parameters |
| `requiredCapability` | Permission gate (e.g., `manage_platform`) |
| `executionMode` | `immediate` (auto-execute) or `proposal` (user approval card) |
| `sideEffect` | Whether the tool modifies state |
| `buildPhases` | Which build phases the tool is available in |

### Rules for Future Development

1. **Every new tool MUST have all fields.** No implicit defaults for `executionMode`, `sideEffect`, or `requiredCapability`.
2. **Side-effecting tools in advise mode are stripped.** If `sideEffect: true` and mode is "advise", the tool is not shown to the model. Design accordingly.
3. **Tool descriptions are the model's instruction manual.** Write them for the LLM, not for humans. Include what the tool does, when to use it, and what NOT to use it for.
4. **`buildPhases` acts as a phase filter.** If a tool should only appear during build phase, set `buildPhases: ["build"]`. If it should appear everywhere, omit the field.
5. **Proposal tools break the agentic loop.** When a tool has `executionMode: "proposal"`, calling it returns an approval card and exits the loop. The user must approve before execution. Use this for destructive or expensive operations.
6. **Tool names must be stable.** The agentic loop's fabrication detection, phase detection, and repetition detection all reference tool names by string. Renaming a tool requires updating these references.
7. **When tool count grows beyond 50**, consider splitting `mcp-tools.ts` into per-domain modules that register into a central registry. Claude Code uses this plugin pattern at scale.

---

## 8. Sub-Agent Patterns (Future Reference)

### Pattern

Complex tasks benefit from parallel execution by specialized sub-agents. The orchestrator decomposes work, assigns sub-tasks, and synthesizes results.

### How Claude Code Does It

Three execution models:

| Model | How It Works | Isolation |
|-------|-------------|-----------|
| **Fork** | Byte-identical copy of parent context. Hits prompt cache (fast, cheap). | Shared git state |
| **Teammate** | File-based mailbox across terminal panes. Async collaboration. | Shared git state |
| **Worktree** | Each agent gets its own isolated git branch. | Full isolation |

### How DPF Should Approach This

DPF does not currently implement sub-agent parallelism. The agentic loop is single-threaded and serial. If sub-agent patterns are needed in the future:

1. **The contribution mode determines isolation level.** `fork_only` users don't need git worktrees. `contribute_all` users may need branch isolation to prevent incomplete features from being contributed.
2. **Start with the Fork model.** It's the simplest — clone the parent context and run a second agentic loop in parallel. No git complexity.
3. **The event bus already supports it.** `apps/web/lib/tak/agent-event-bus.ts` emits `async:started/progress/complete` events keyed by threadId. Multiple sub-agents can emit to the same thread.
4. **Sandbox operations are the natural parallelism boundary.** Writing file A and writing file B can happen in parallel. Writing file A and then reading file A cannot. Use the build plan's task structure to identify independent operations.
5. **Do NOT build a general-purpose orchestrator.** Build Studio's 5-phase lifecycle is the orchestrator. Sub-agents, if added, would operate within a single phase (e.g., parallel file generation in the build phase).

---

## 9. Safety and Trust Patterns

### Pattern

Agent systems must be honest about their limitations, never claim actions they didn't take, and break out of failure loops with transparency rather than retrying silently.

### Key Principles

1. **Evidence before assertions.** Never claim "tests pass" without running tests. Never claim "deployed" without calling deploy_feature. The fabrication detector enforces this.
2. **Honest failure.** After 3 failed attempts, tell the user what's not working and ask for help. Do not silently retry. Do not apologize in circles.
3. **Tool signals over model blame.** When the agent behaves badly, check tool return values first. A tool returning misleading success/failure signals caused more "AI failures" than model limitations.
4. **Audit trail.** Every tool execution is written to `ToolExecution` table with parameters, result, duration, and context. This is fire-and-forget (non-blocking) but non-negotiable.
5. **Proposal mode for destructive actions.** Database migrations, deployments, and data deletions go through approval cards. The user sees what will happen before it happens.
6. **Sensitivity levels gate data flow.** A confidential page's data must not leak into sub-tasks routed to lower-clearance endpoints. The prompt assembler enforces this.

---

## 10. Checklist for New Agentic Features

When building any new feature that involves AI agent behavior, verify against this checklist:

- [ ] **Model routing**: Does the agent have `modelRequirements` with explicit `defaultMinimumTier` and `defaultBudgetClass`?
- [ ] **Duration limit**: If the workflow uses tools, are those tools included in the phase detection logic in `agentic-loop.ts`?
- [ ] **Handoff**: If the workflow has multiple phases, is there a handoff mechanism between phases?
- [ ] **Tool definitions**: Do all tools have `requiredCapability`, `executionMode`, `sideEffect`, and (if applicable) `buildPhases`?
- [ ] **Fabrication detection**: Are the tool's completion verbs in `COMPLETION_CLAIM_PATTERN`?
- [ ] **Phase nudge**: Is the tool included in `getPhaseSpecificNudge()` for the right phase?
- [ ] **Prompt composition**: Does the route have a domain context in `route-context-map.ts`?
- [ ] **Contribution mode**: If the feature produces artifacts that could be contributed, is it aware of the platform's contribution mode?
- [ ] **Safety**: Are destructive operations gated behind `executionMode: "proposal"`?
- [ ] **Audit**: Are tool executions written to the `ToolExecution` table?

---

## Sources

- [Fortune — Anthropic leaks its own AI coding tool's source code](https://fortune.com/2026/03/31/anthropic-source-code-claude-code-data-leak-second-security-lapse-days-after-ultimately-revealing-mythos/)
- [The New Stack — Inside Claude Code's leaked source: swarms, daemons, and 44 features](https://thenewstack.io/claude-code-source-leak/)
- [Engineer's Codex — Diving into Claude Code's Source Code Leak](https://read.engineerscodex.com/p/diving-into-claude-codes-source-code)
- [Latent.Space — The Claude Code Source Leak](https://www.latent.space/p/ainews-the-claude-code-source-leak)
- [Layer5 — The Claude Code Source Leak: 512,000 Lines](https://layer5.io/blog/engineering/the-claude-code-source-leak-512000-lines-a-missing-npmignore-and-the-fastest-growing-repo-in-github-history/)
- [Alex Kim — The Claude Code Source Leak: fake tools, frustration regexes, undercover mode](https://alex000kim.com/posts/2026-03-31-claude-code-source-leak/)
- [MindStudio — Claude Code Source Code Leak: 8 Hidden Features](https://www.mindstudio.ai/blog/claude-code-source-code-leak-8-hidden-features)
- [Coding Beauty — Claude Code's massive source code got leaked](https://codingbeautydev.com/blog/claude-code-source-code-leak/)
