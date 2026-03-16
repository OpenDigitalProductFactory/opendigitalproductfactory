# EP-FEEDBACK-001 + EP-PROCESS-001 + EP-HIVEMIND-001 — Implementation Notes

**Date:** 2026-03-16
**Context:** Captured from live testing session where agent limitations were observed firsthand.

---

## Key Observation: The AI Ops Engineer Dialog

A real conversation demonstrated both the success and gap in the current system:

**What worked:**
- Route context injection (PAGE DATA) gave the AI Ops Engineer real provider data
- The diversity framework produced a genuinely useful, page-specific analysis
- The agent's perspective (cost optimization, failover, capability matching) was distinct and valuable
- Recommendations were well-reasoned and actionable

**What failed:**
- When user said "make those changes", the agent hallucinated taking actions it couldn't take
- It said "I've initiated configuration" and "sent out requests" — none of which happened
- The agent lacked tools to enable/disable providers, trigger discovery, or configure credentials
- The Hands On mode exists but the Providers page doesn't register a form assist adapter

**What the observer should have captured:**
- Signal: agent claimed to take actions without tools (hallucination pattern)
- Signal: user expected agent to act on provider configuration (missing capability)
- Auto-generated improvement proposal: "Add provider management tools (enable/disable, trigger discovery) so AI Ops Engineer can execute recommendations with Hands On permission"

---

## Implementation Sequence

### Phase 1: Feedback Loop Foundation (EP-FEEDBACK-001)
1. **ImprovementProposal schema** — migration with attribution, evidence, governance pipeline
2. **propose_improvement MCP tool** — available to all agents, auto-attributes from conversation
3. **Improvement mindset in preamble** — already added (commit 44e652d)
4. **Proposals review page** — `/ops/improvements` with governance stage transitions

### Phase 2: Observer Integration (EP-PROCESS-001)
1. **Connect observer to feedback loop** — observer auto-creates ImprovementProposal records
2. **Signal detection for agent limitations** — detect when agent claims actions without tools
3. **Friction detection** — user repeats themselves, agent can't fulfill request
4. **Surfacing** — how to show the user that the observer noticed something (subtle indicator? badge? dashboard?)

### Phase 3: Page-Specific Agent Tools
Priority based on today's session:
1. **Providers page** — register form assist with provider enable/disable, trigger discovery/sync
2. **Ops page** — already has backlog form assist, add epic management
3. **Portfolio page** — read-only context already works, add budget update actions
4. **Workforce page** — agent-to-provider assignment (already works via AgentProviderSelect)

### Phase 4: Hive Mind Pipeline (EP-HIVEMIND-001)
1. Feature Pack packaging from FeatureBuild diffs
2. Contribution proposal UX with diff review
3. GitHub PR creation (needs GitHub MCP or API integration)
4. Community registry (browse + install)

---

## Backlog State After This Session

### Completed Epics (4)
- EP-LLM-LIVE-001 — Live LLM Conversations (5/5)
- EP-AGENT-EXEC-001 — Agent Task Execution with HITL (6/6)
- EP-SELF-DEV-001B — COO Codebase Access (4/4)

### Open Epics (5)
- EP-DEPLOY-001 — Docker Deployment (2 remaining: Ollama mgmt UI, health dashboard)
- EP-UI-A11Y-001 — Accessibility (2 remaining: dev guidelines, AGT-903)
- EP-UI-THEME-001 — Theme & Branding (5 items, all open)
- **EP-FEEDBACK-001 — Platform Improvement Feedback Loop (4 items, NEW)**
- **EP-HIVEMIND-001 — Hive Mind Contribution Pipeline (4 items, NEW)**

### Designed But Not Yet In Backlog
- EP-PROCESS-001 — Process Observer (has full spec + plan in docs/)
- Calendar infrastructure (has spec)
- File upload / document parsing (has spec)
- Portfolio-aware intake (has spec)

---

## Today's Session Accomplishments (Summary)

### Morning: Stabilization & Fix Pass
- Fixed Docker postgres, port exposure, pnpm install, credential encryption
- Fixed qwen3 thinking mode, VRAM sizing, model selection (qwen3 → llama3.1)
- Fixed provider stepper, auto-profiling, grid layout
- Merged 2 stale branches, deleted 30 stale remote branches
- Synced backlog to match codebase reality

### Afternoon: Architecture & Features
- Agent Action History page (`/platform/ai/history`)
- AI Workforce tabs (Workforce | Providers | History)
- Configurable preferred provider per agent via UI
- COO agent with cross-cutting authority + toggle on every page
- Provider/model display in agent panel header

### Evening: Cognitive Diversity & Self-Development
- Scott Page's Diversity of Thought framework extracted and applied
- All 10 agents refactored with distinct perspectives, heuristics, interpretive models
- COO codebase access tools (read, search, propose changes with HITL)
- Route-specific page data context injection
- Platform preamble: honesty rules + improvement mindset
- Feedback loop and Hive Mind epics created with specs

### Key Files Created/Modified
- `apps/web/lib/agent-routing.ts` — complete agent workforce rewrite
- `apps/web/lib/codebase-tools.ts` — path-secure file operations
- `apps/web/lib/route-context.ts` — page data injection
- `apps/web/lib/proposal-data.ts` — action history queries
- `apps/web/components/platform/ProposalHistoryClient.tsx` — history UI
- `apps/web/components/platform/AgentProviderSelect.tsx` — provider assignment
- `apps/web/components/platform/AiTabNav.tsx` — workforce navigation
- `docs/Reference/diversity-of-thought-framework.md` — living framework
- Multiple specs and plans in docs/superpowers/
