# COO Morning Briefing — 2026-03-16

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

### Priority 1: Self-Development Capability (NEW — not yet in backlog)
**Why now:** Mark's core vision. The platform should iterate on itself. The Build Studio has significant partial implementation. The COO agent needs codebase access to be effective.

**First slice:** COO/Build Specialist can read project files, propose changes as diffs, and apply approved changes. No sandbox container yet — just the read + propose + apply loop.

**Dependency:** Needs a capable cloud provider (Gemini or Anthropic) assigned to COO and Build Specialist. Mark needs to enter/re-enter Gemini API key after the encryption key fix.

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
