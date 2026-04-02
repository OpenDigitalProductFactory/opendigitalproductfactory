# Build Studio Test Routine — Agentic Improvements Validation

| Field | Value |
|-------|-------|
| **Purpose** | Manual test routine to exercise the Claude Code-inspired improvements |
| **Created** | 2026-04-02 |
| **Prereqs** | Docker stack running, at least one AI provider active, admin user logged in |
| **Duration** | ~20-30 minutes |
| **Features Under Test** | Cross-phase handoff, frustration detection, dynamic tool descriptions, contribution mode awareness, phase-aware duration limits |

---

## Pre-Flight Checks

Before starting the test routine, verify the platform is operational:

### Check 1: Platform is running

```
Open: http://localhost:3000
Expected: Login page or dashboard loads
```

### Check 2: AI provider is active

```
Navigate: Admin > AI Workforce > Providers
Expected: At least one provider shows "active" status
Action: If no active provider, activate one (Docker Model Runner for local, or API key provider)
```

### Check 3: Contribution mode is set

```
Navigate: Admin > Platform Development
Expected: One of fork_only / selective / contribute_all is selected
Note: Record which mode is active — we'll verify it appears in prompts
Active mode: _______________
```

### Check 4: No stale builds

```
Navigate: Build Studio
Expected: Either empty (no builds) or all builds are "complete"/"failed"
Action: If there's an in-progress build from a previous session, note its state
```

---

## Test 1: Full Lifecycle — Cross-Phase Handoff

**Goal:** Verify that `save_phase_handoff` is called at phase transitions and that the handoff briefing appears in subsequent phases.

### Step 1.1: Start a new build (Ideate phase)

```
Navigate: Build Studio > New Build
Enter title: "Test Complaints Page"
Send message: "I need a simple complaints page where employees can submit
complaints with a title, description, and priority level (low/medium/high).
The page should show a list of existing complaints."
```

**Expected behavior:**
- Agent searches the codebase (`search_project_files` or `read_project_file`)
- Agent saves a design doc (`saveBuildEvidence` with field `designDoc`)
- Agent reviews the design (`reviewDesignDoc`)
- Agent presents a plain-language summary

**Verify contribution mode awareness:**
- Open browser DevTools > Network tab
- Find the `/api/agent/stream` or agent message request
- Check if the system prompt contains `Platform contribution mode: [your mode]`
- For `selective` mode, should say: "the user will be asked whether to contribute each feature"
- For `fork_only` mode, should say: "code stays local only"

### Step 1.2: Approve and advance to Plan

```
Send message: "Looks good, go ahead"
```

**Expected behavior:**
- Agent calls `save_phase_handoff` with summary of ideate phase
- Phase advances to Plan
- Agent creates a build plan (`saveBuildEvidence` with field `buildPlan`)

**Verify handoff was saved:**
```sql
-- Run in pgAdmin or psql against the platform DB
SELECT "fromPhase", "toPhase", "summary", "decisionsMade", "openIssues"
FROM "PhaseHandoff"
WHERE "buildId" = (SELECT "buildId" FROM "FeatureBuild" ORDER BY "updatedAt" DESC LIMIT 1)
ORDER BY "createdAt" ASC;
```

**Expected:** One row with `fromPhase: "ideate"`, `toPhase: "plan"`, non-empty summary.

### Step 1.3: Verify handoff injection in Plan phase

**Check the system prompt** (via console logs or DevTools):
- Should contain `--- Briefing from Previous Phases ---`
- Should show `[ideate → plan] <summary from ideate>`
- Should list decisions and open issues from ideate

```
Send message: "The plan looks good, build it"
```

**Expected:** Agent calls `save_phase_handoff` for plan→build, then phase advances to Build.

### Step 1.4: Verify cumulative handoffs in Build phase

**Check the system prompt in Build phase:**
- Should contain TWO handoff briefings:
  - `[ideate → plan]` summary
  - `[plan → build]` summary with architecture decisions

**Expected:** Agent begins sandbox operations (launch_sandbox, write_sandbox_file, etc.)

### Step 1.5: Complete Build and Review

Let the build agent work. When it reports completion:

```
Send message: "ok, review it"
```

**Verify in Review phase:**
- Three handoff briefings visible (ideate→plan, plan→build, build→review)
- Agent runs tests and UX checks

### Step 1.6: Ship (if review passes)

```
Send message: "Ship it"
```

**Verify in Ship phase:**
- Four handoff briefings visible
- Contribution mode behavior matches your setting:
  - `fork_only`: No assess_contribution or contribute_to_hive calls
  - `selective`: Assessment shown, user asked to choose
  - `contribute_all`: Assessment shown, contribution is default

---

## Test 2: Frustration Detection

**Goal:** Verify that the frustration detector catches apology loops and provides phase-aware nudges.

### Step 2.1: Trigger a tool failure scenario

The easiest way to trigger frustration is to create a scenario where the agent can't proceed:

```
Navigate: Build Studio > Start new build
Enter title: "Test Frustration Detection"
Send message: "Build a page that integrates with the Xyzzy API at api.xyzzy.invalid"
```

**Expected behavior:**
- Agent will try to search for the API / find documentation
- If tools fail or return no results, the agent may start apologizing
- Watch the Docker logs for frustration detection:

```bash
docker compose logs portal --tail=100 -f | grep "frustration"
```

**Expected log output:**
```
[agentic-loop] frustration detected (1/3): I apologize, I'm unable to...
[agentic-loop] frustration detected (2/3): Unfortunately, I cannot...
[agentic-loop] frustration detected (3/3): I'm sorry, I don't have...
```

**Expected UI behavior:**
- First 2 frustrations: Agent gets nudged with phase-specific tool suggestions
- 3rd frustration: Agent breaks out with "I've been struggling with this. Let me be direct about what's not working..."

### Step 2.2: Verify phase-aware nudge content

In the Docker logs, look for the nudge messages:

- If in ideate phase (search tools used): "Call saveBuildEvidence with field 'designDoc' to save your design."
- If in build phase (sandbox tools used): "Try run_sandbox_tests to verify your work, or read_sandbox_file to check what exists."
- If no tools used yet: "Check your available tools and call the most relevant one now."

---

## Test 3: Dynamic Tool Descriptions

**Goal:** Verify that tool descriptions get warning annotations after failures.

### Step 3.1: Trigger a tool failure in build phase

Start a new build and advance to build phase. Then:

```
Send message: "Use generate_code to update the existing page.tsx file"
```

**Expected:**
- `generate_code` may fail on an existing file (it overwrites)
- On the next iteration, the tool description should include:
  `[WARNING: This tool failed earlier in this session with: "...". Consider a different approach or different arguments.]`

**Verify via Docker logs:**

```bash
docker compose logs portal --tail=200 | grep "WARNING.*tool failed"
```

Or check the console output for the enriched route options being passed to `routeAndCall`.

### Step 3.2: Verify warning clears on success

If the agent switches to `edit_sandbox_file` (correct tool) and it succeeds, verify that `edit_sandbox_file` does NOT have a warning annotation on subsequent iterations.

---

## Test 4: Phase-Aware Duration Limits

**Goal:** Verify that different phases get different time ceilings.

### Step 4.1: Observe duration limit in logs

During any build, watch for duration limit messages:

```bash
docker compose logs portal --tail=500 -f | grep "MAX_DURATION\|durationLimit"
```

**Expected:** If a phase hits its limit, the log shows which limit was hit:
- Conversation: 120000ms
- Ideate/Plan: 300000ms
- Review: 240000ms
- Ship: 300000ms
- Build: 600000ms

### Step 4.2: Verify ideate gets more time than conversation

Compare a regular coworker conversation (non-build route) with an ideate phase:
- Go to any non-build page (e.g., Portfolio), send a complex message
- Start a build and send a complex ideate message
- The build should run longer before timing out (5 min vs 2 min)

This is hard to trigger deliberately (models usually finish well within limits), but the detection can be verified by checking the `durationLimit` variable in logs.

---

## Test 5: Contribution Mode Awareness

**Goal:** Verify that contribution mode appears in ideate/plan prompts, not just ship.

### Step 5.1: Check ideate prompt

```
Navigate: Admin > Platform Development
Set mode to: "contribute_all" (if not already)
Start a new build
Send any message in ideate phase
```

**Verify in system prompt** (via DevTools or logs):
```
Platform contribution mode: contribute_all. contributions are sent upstream by default — flag any proprietary data models or trade secrets in your design.
```

### Step 5.2: Switch mode and verify

```
Navigate: Admin > Platform Development
Switch to: "fork_only"
Start a new build
```

**Verify:** Prompt says "code stays local only — no upstream contribution."

### Step 5.3: Verify build/review phases get simple injection

In build or review phase, the prompt should just say:
```
Platform contribution mode: fork_only.
```
(No extra explanation — the ship prompt has its own detailed STEP 5 logic.)

---

## Results Summary

| Test | Feature | Pass/Fail | Notes |
|------|---------|-----------|-------|
| 1.1 | Ideate phase + contribution mode | | |
| 1.2 | Phase handoff saved (ideate→plan) | | |
| 1.3 | Handoff injected in plan prompt | | |
| 1.4 | Cumulative handoffs in build | | |
| 1.5 | Review with handoffs | | |
| 1.6 | Ship with contribution mode | | |
| 2.1 | Frustration detection triggers | | |
| 2.2 | Phase-aware nudge content | | |
| 3.1 | Tool warning annotation after failure | | |
| 3.2 | Warning clears after success | | |
| 4.1 | Duration limit logged correctly | | |
| 4.2 | Ideate gets longer than conversation | | |
| 5.1 | contribute_all in ideate prompt | | |
| 5.2 | fork_only in ideate prompt | | |
| 5.3 | Simple injection in build/review | | |

---

## Troubleshooting

### Agent doesn't call save_phase_handoff

- Check that the tool is in the available tools list for the phase. Run:
  ```sql
  SELECT name FROM unnest(ARRAY['save_phase_handoff']) AS name
  ```
  In the app, verify with DevTools that `save_phase_handoff` appears in the tools array sent to the model.
- Check the phase prompt — the instruction should be at the end of the phase's RULES section.
- Weaker models (Haiku, local) may not follow the "call this as your LAST action" instruction consistently. If the model skips it, that's a model capability issue, not a code bug.

### Frustration detection doesn't trigger

- The pattern only fires in the **no-tool-calls branch** of the agentic loop. If the agent is calling tools (even failing ones), frustration detection won't fire — that's correct behavior.
- Check that `result.toolsStripped` is false. If routing degradation stripped tools, frustration detection is deliberately disabled.
- The pattern excludes "let me try again" and "there seems to be an issue" — these are legitimate. Only clear apology/hedging phrases trigger it.

### Tool warnings don't appear

- `enrichToolDescriptions` only runs when `routeOptions.tools` is defined. If tools are undefined (conversation mode), no enrichment happens.
- Warnings only appear for tools that LAST failed. If the tool succeeded after failing, the warning is cleared.
- Check Docker logs for the `[agentic-tool] RESULT` lines to confirm which tools failed.

### Handoff briefings don't appear in prompt

- Verify `PhaseHandoff` rows exist in DB (Step 1.2 SQL query)
- Check that `getFeatureBuildForContext` is being called (it's only invoked when `routeContext` starts with `/build`)
- Verify the `phaseHandoffs` include is working — check for Prisma query errors in logs
