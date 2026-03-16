# COO Morning Briefing — 2026-03-16

## CRITICAL DISCOVERY: Build Studio is 95% Complete

An overnight audit reveals the Build Studio (`/build`) is nearly production-ready:
- Three-panel layout (conversation + preview + phase bar) — COMPLETE
- All 5 phases (Ideate → Plan → Build → Review → Ship) — COMPLETE
- 8 MCP tools (update_feature_brief, register_product, create_epic, etc.) — COMPLETE
- Sandbox lifecycle management (Docker create/start/exec/destroy) — COMPLETE
- Coding agent orchestration (readiness check, prompt builder, test runner) — COMPLETE
- Preview proxy, Dockerfile.sandbox, server actions, data layer — ALL COMPLETE

**The only missing piece:** The actual LLM execution loop in the Build phase — calling the coding model and writing files into the sandbox. Everything else is wired up.

**Revised recommendation:** Instead of building codebase access tools from scratch (the first-slice plan), we should **connect the existing Build Studio to a capable coding provider** (Codex/Anthropic). The infrastructure is already there — it just needs the execution bridge.

The codebase access tools (read_project_file, search_project_files, propose_file_change) are still valuable for the COO's day-to-day oversight, but the Build Studio is the faster path to self-development capability.

---

## Platform Health Summary

**Completed epics (2):**
- EP-LLM-LIVE-001 — Live LLM Conversations (5/5 items done)
- EP-AGENT-EXEC-001 — Agent Task Execution with HITL Governance (6/6 items done)

**Open epics (3):**
- EP-DEPLOY-001 — Docker Deployment (4/6 done, 2 remaining)
- EP-UI-A11Y-001 — Accessibility (3/5 done, 2 remaining)
- EP-UI-THEME-001 — Theme & Branding (0/5 done)

**Total backlog:** 10 open items across 3 epics + 1 orphaned observation item

---

## Yesterday's Session Accomplishments (25+ commits)

### Installation & Docker
- Fixed postgres password issue (root .env file)
- Separated User vs Developer install paths
- Added docker-compose.dev.yml for port exposure
- Added pnpm install to fresh-install.ps1
- Fixed credential encryption key generation

### AI Workforce
- Fixed qwen3 thinking mode in profiling (empty content fallback)
- Conservative VRAM model sizing (70% rule)
- Switched default from qwen3 to llama3.1:8b
- Removed auto-profiling for cloud providers (was blocking UI)
- Fixed provider stepper not reaching Ready state
- Added provider:model display in co-worker panel header
- Codex provider base URL fixed

### Platform Architecture
- Created Agent Action History page (/platform/ai/history)
- Moved AI agents to /platform/ai (Workforce tab is now default)
- Added tab navigation: Workforce | Providers | Action History
- Configurable preferred provider per agent via Workforce UI
- Seeded 10 co-worker agents into Agent table for UI configurability
- Added platform identity preamble to all agent system prompts

### COO Agent
- Created COO agent on /workspace with cross-cutting authority
- COO toggle available on every page (pill badge in agent panel)
- System prompt grounded in Mark's vision

### Git Hygiene
- Merged 2 unmerged branches (HR workforce core, EA reference model)
- Deleted 30 stale remote branches
- Simplified AGENTS.md to work-on-main (no worktrees)
- Updated backlog statuses to match codebase reality

---

## Open Backlog — Prioritized Recommendations

### Priority 1A: Activate the Build Studio (FASTEST PATH)
**Why now:** The Build Studio is 95% built. Only the LLM execution bridge is missing. Connecting a capable provider (Codex/Anthropic) to the existing `coding-agent.ts` infrastructure gets self-development working faster than building new tools.

**What's needed:** Implement the `generateCode()` function in `coding-agent.ts` that calls the LLM with the build prompt, parses file outputs, and writes them into the sandbox via `execInSandbox`. Then wire it into the Build phase of the agent conversation.

**Dependency:** Codex provider must be active and assigned to Build Specialist.

### Priority 1B: COO Codebase Access (COMPLEMENTARY)
**Why also:** The COO needs to read and modify files for oversight tasks that don't go through the Build Studio (quick fixes, config changes, prompt updates). The codebase access tools (read_project_file, search_project_files, propose_file_change) serve this purpose.

**Spec:** `docs/superpowers/specs/2026-03-16-self-dev-codebase-access-design.md`
**Plan:** `docs/superpowers/plans/2026-03-16-self-dev-codebase-access.md`

**Dependency:** Needs a capable cloud provider assigned to COO. Mark needs to enter/re-enter Gemini API key after the encryption key fix.

### Priority 2: BI-DEPLOY-003 — Ollama Management UI
**Why now:** Mark experienced the pain of CLI-only model management during the session. Pull/delete models from the UI would make the platform self-service for AI model management.

**Effort:** Small. Hardware info card already exists. Need model list with pull/delete actions.

### Priority 3: BI-DEPLOY-006 — Health Check Dashboard
**Why now:** Completes the deployment epic. Health endpoint exists. Need a visual dashboard.

**Effort:** Small. Similar to the proposal history page pattern.

### Priority 4: BI-PROD-012 — Dark-Theme Development Guidelines
**Why now:** Low effort documentation task. Captures existing decisions (WCAG AA, 10px floor, CSS custom properties) into a reference doc.

**Effort:** Minimal. Write a markdown doc, possibly enforce via linting.

### Priority 5: BI-PROD-013 — UX Accessibility Agent (AGT-903)
**Why now:** Pairs with guidelines. The agent would review UI work for WCAG compliance.

**Effort:** Small. Add to agent routing with appropriate system prompt.

### Deferred: EP-UI-THEME-001 — Theme & Branding (5 items)
**Why defer:** Cosmetic. No blocking functionality. The dark theme works. Runtime switching and branding presets are nice-to-have.

---

## Designed But Not Backlogged

These have full specs/plans in docs/superpowers/ but no Epic or BacklogItem records:

| Spec | What it is | Priority |
|------|-----------|----------|
| `process-observer` | Silent AI that watches conversations, detects friction, auto-files backlog items | High — feeds the self-improvement loop |
| `calendar-infrastructure` | Calendar and scheduling for the platform | Medium |
| `file-upload-document-parsing` | Upload and parse documents in conversations | Medium — enables richer agent context |
| `portfolio-aware-intake` | Portfolio-aware intake workflow | Medium |
| `employee-tool-intake` | Employee self-service tool intake | Low |
| `codex-provider-integration` | Deeper Codex MCP integration | Low — basic provider works |

**Recommendation:** Create epics for process-observer and file-upload next. Both directly support the self-evolving vision.

---

## Immediate Actions for Mark (When He Wakes Up)

1. **Restart dev server** to pick up all changes
2. **Re-enter Gemini API key** at /platform/ai/providers/gemini (encryption key was regenerated)
3. **Assign COO to Gemini** at /platform/ai (Workforce tab, COO card)
4. **Assign Build Specialist to Codex** (should already be set)
5. **Test COO toggle** from any page — click the COO pill badge in the agent panel
6. **Review self-dev first-slice design** (being written now)
