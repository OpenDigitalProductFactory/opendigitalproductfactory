# Build Dispatch Optimization — Single Agent → Agent Teams

**Date:** 2026-04-08
**Status:** Draft
**Author:** Mark Bodman + Claude

## Problem

Build Studio dispatches 14 individual tasks to separate CLI sessions, each running serially in the same sandbox container. Measured build time: **25 minutes** for a 14-task feature. Each task re-reads the codebase from scratch (~40% waste), artificial phase barriers force sequential execution even when tasks are independent, and the 20-minute orchestrator timeout causes builds to fail and re-trigger from scratch.

### Evidence (from production timing data)

| Phase | Tasks | Serial time | If parallel |
|-------|-------|-------------|-------------|
| Data Architect (3 tasks) | Add models to schema | 143s | 62s (max) |
| Software Engineer (4 tasks) | Types, actions, routes | 428s | 193s (max) |
| Frontend Engineer (5 tasks) | Pages, components | 857s | 234s (max) |
| QA (1 task) | Tests + typecheck | ~60s | 60s |
| **Total** | **14 tasks** | **~1488s (25 min)** | **~549s (9 min)** |

Three tasks produced >800KB of output each (one was 3.9MB) — the agent reading the entire codebase before doing a small edit. Context-building overhead is ~40% of each task's runtime.

## Design — Two Phases

### Phase 1: Single Agent, Full Plan (Immediate)

**Change:** Instead of dispatching 14 separate CLI tasks, dispatch ONE prompt containing the complete build plan. The CLI agent executes all tasks sequentially with retained context.

**Why this works:**
- Agent reads the codebase once, not 14 times (eliminates cold-start waste)
- Agent naturally understands dependencies (schema before API before frontend)
- No artificial phase barriers — the agent sequences work intelligently
- Works with both Codex CLI and Claude Code CLI today
- Zero coordination overhead

**Estimated build time:** ~12-15 min (50% of current)

#### Implementation

**New function in `codex-dispatch.ts` (and `claude-dispatch.ts`):**

```typescript
export async function dispatchFullBuildTask(params: {
  plan: BuildPlanDoc;
  buildId: string;
  buildContext: string;
}): Promise<CodexResult> {
  // Build ONE prompt with the complete plan
  const taskList = plan.tasks.map((t, i) => 
    `${i + 1}. ${t.title}\n   ${t.implement || ""}`
  ).join("\n\n");
  
  const prompt = `
You are building a complete feature for a Next.js/Prisma monorepo.
Execute ALL tasks below in order, maintaining context between them.

PROJECT CONTEXT:
${buildContext.slice(0, 4000)}

EXECUTION ORDER (respect dependencies):
1. Schema changes first (Prisma models, migrations, generate)
2. TypeScript types and server actions
3. API routes
4. Frontend pages and components
5. After all code: run typecheck (pnpm exec tsc --noEmit)

KEY RULES:
- Read an existing similar file before creating new ones
- Every foreign key needs @@index
- Use "use server" for actions, "use client" for interactive components
- Hyphens not underscores for multi-word statuses
- Validate schema after changes: pnpm --filter @dpf/db exec prisma validate

TASKS:
${taskList}

FILES:
${plan.fileStructure?.map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join("\n") || "See task descriptions"}

Execute each task, verify your work compiles, then move to the next.
Report what you did for each task.`;

  // Single dispatch — one CLI session, full context
  return dispatchCodexTask({ ... prompt ... });
}
```

**Orchestrator change in `build-orchestrator.ts`:**

```typescript
// Replace the phase loop with a single dispatch
const DISPATCH_MODE = process.env.BUILD_DISPATCH_MODE ?? "single"; // "single" | "multi" | "agentic"

if (DISPATCH_MODE === "single") {
  // One agent does everything
  const result = await dispatchFullBuildTask({ plan, buildId, buildContext });
  // Parse result to extract per-task outcomes
  // Save evidence, advance phase
} else if (DISPATCH_MODE === "multi") {
  // Existing per-task dispatch (legacy)
  for (const phase of phases) { ... }
}
```

**Build task timeout:** Increase to `1_800_000` (30 min) for single-agent mode since it's doing all tasks in one session.

#### Progress Reporting

The single agent won't emit per-task SSE events. Options:
1. **Simple:** Emit "build_started" at dispatch, "task_complete" when done. The task board shows one entry.
2. **Better:** Parse the agent's streaming output for task completion markers. Add instructions: "After completing each task, output a line: `[TASK DONE] <task title>`". The dispatch function watches stdout for these markers and emits SSE events.
3. **Best (Claude Code only):** Use `--output-format stream-json` to get streaming events including tool calls. Parse these to emit progress.

Recommend option 2 for Codex and option 3 for Claude Code.

### Phase 2: Claude Code Agent Teams (Next Evolution)

**Change:** Use Claude Code's experimental [Agent Teams](https://code.claude.com/docs/en/agent-teams) feature to parallelize with native coordination.

**How it works:**
- One lead agent receives the full build plan
- Lead spawns 2-3 teammates with specific roles
- Teammates work in parallel on a shared task list
- Built-in git conflict resolution
- Teammates communicate directly with each other
- Lead synthesizes results

**Configuration:**
```bash
CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1

claude --bare -p "
Create an agent team with 3 teammates to build this feature:

Teammate 1 (Backend): Handle schema changes, types, server actions, API routes
Teammate 2 (Frontend): Handle all pages and components
Teammate 3 (QA): Run verification after teammates 1 and 2 finish

BUILD PLAN:
$TASK_LIST

Teammate 2 should start scaffolding pages immediately (with placeholder data)
while Teammate 1 works on the backend. Once Teammate 1 finishes schema + types,
Teammate 2 connects to real data.
" --dangerously-skip-permissions --model sonnet
```

**Estimated build time:** ~8-10 min (parallel backend + frontend, then QA)

**Requirements:**
- Claude Code CLI in sandbox (from the claude-dispatch spec)
- `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` environment variable
- May need tmux in the sandbox container for split-pane mode
- Test if agent teams work from `-p` (non-interactive) mode — this is unconfirmed

**Guardrails (critical for unattended execution):**
- `--max-budget-usd 5` — cap per-build spend
- `--max-turns 50` — cap agent iterations (undocumented but functional)
- `--effort medium` — balance speed vs quality

#### Risk: Agent Teams is Experimental

Known limitations from docs:
- No session resumption with in-process teammates
- Task status can lag (teammates forget to mark tasks done)
- One team per session, no nested teams
- Split panes require tmux

**Mitigation:** Keep the single-agent path (Phase 1) as fallback. Toggle between modes with `BUILD_DISPATCH_MODE=teams|single|multi`.

### Comparison

| Aspect | Current (multi) | Phase 1 (single) | Phase 2 (teams) |
|--------|----------------|-------------------|------------------|
| Build time (14 tasks) | ~25 min | ~12-15 min | ~8-10 min |
| Cold starts | 14 (one per task) | 1 | 3-5 (one per teammate) |
| Context waste | ~40% per task | ~0% | ~10% per teammate |
| Progress visibility | Per-task events | Markers in output | Native team coordination |
| Failure blast radius | One task | Entire build | One teammate |
| Works with Codex | Yes | Yes | No (Codex has no equivalent) |
| Works with Claude | Yes | Yes | Yes (experimental) |

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/lib/integrate/codex-dispatch.ts` | Add `dispatchFullBuildTask()` function |
| `apps/web/lib/integrate/claude-dispatch.ts` | Add `dispatchFullBuildTask()` function (once created) |
| `apps/web/lib/integrate/build-orchestrator.ts` | Add `BUILD_DISPATCH_MODE` toggle, single-agent path |
| `Dockerfile.sandbox` | Add tmux (for Phase 2 agent teams) |

## Testing

### Phase 1 Test
```bash
# Manual test: give Codex the full plan in one prompt
docker exec dpf-sandbox-1 sh -c "
cd /workspace && codex exec --dangerously-bypass-approvals-and-sandbox \
  --skip-git-repo-check \
  'You are building a training registration feature. Do these tasks in order:
   1. Add CourseInstance model to schema
   2. Add TrainingRegistration model  
   3. Create server actions
   4. Create API routes
   5. Build dashboard page
   After each task, output: [TASK DONE] <task name>
   Run typecheck after all tasks.' 2>/dev/null"
```

### Phase 2 Test (requires Claude Code CLI)
```bash
docker exec -e CLAUDE_CODE_OAUTH_TOKEN='...' \
  -e CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 \
  dpf-sandbox-1 \
  claude --bare -p "Create an agent team with 2 teammates to build..." \
  --dangerously-skip-permissions --model sonnet
```

## Migration Path

1. **Now:** Implement Phase 1 (single agent). Set `BUILD_DISPATCH_MODE=single`.
2. **After Claude Code dispatch works:** Test Phase 2 with `BUILD_DISPATCH_MODE=teams`.
3. **Once stable:** Default to `teams` for Claude, `single` for Codex.
4. **Eventually:** Remove the `multi` (per-task) dispatch path entirely.

## Reference

- [Claude Code Agent Teams docs](https://code.claude.com/docs/en/agent-teams)
- [Claude Code subagents](https://claude.com/blog/subagents-in-claude-code)
- [Codex parallel session issues](https://github.com/openai/codex/issues/11435)
- Production timing data: portal logs 2026-04-08
- `apps/web/lib/integrate/codex-dispatch.ts` — current dispatch
- `apps/web/lib/integrate/build-orchestrator.ts` — orchestrator
- `apps/web/lib/integrate/task-dependency-graph.ts` — phase grouping
