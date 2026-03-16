# EP-ASYNC-001: Asynchronous AI Agent Operations — Design Notes

**Date:** 2026-03-16
**Status:** Design notes — needs full spec before implementation
**Goal:** AI agents can run background tasks while humans switch between areas. Notifications bring humans back when tasks complete.

---

## The Problem

Currently, agent interactions are **synchronous and blocking**:
- User sends message → waits → agent responds → user acts
- If the operation takes 60+ seconds (inference, profiling, tool execution), the user is stuck
- If the user navigates away, the operation may be lost
- No way to know if an agent finished something while the user was elsewhere

Humans naturally work on many tasks and switch frequently. The AI agent model needs to match this.

## Design Concept: Three Notification Layers

### Layer 1: In-Panel (Synchronous)
**When:** User is on the page with the agent panel open
**What:** Thinking dots, tool status text ("Searching codebase..."), timeout messages
**Implementation:** Client-side, uses existing `isPending` state

### Layer 2: Cross-Page Banner (Asynchronous)
**When:** Agent task completes while user is on a DIFFERENT page
**What:** Top banner slides in: "[Software Engineer] finished analyzing your feature brief → Resume"
**Click:** Navigates to the page and opens the agent panel to that conversation
**Persistence:** Banner stays until dismissed or clicked. Uses a server-side notification queue.

### Layer 3: FAB Badge + Workspace Dashboard (Multi-Task Hub)
**When:** User has multiple agent conversations across different areas
**What:**
- FAB shows a badge count (e.g., "2") for unseen completions
- Workspace page shows an "Active Tasks" section with all ongoing/completed agent work
- Each task shows: agent name, area, status, brief summary, "Resume" link

## Architecture Sketch

```
AgentTask (new model)
├── id, taskId
├── userId
├── agentId, routeContext, threadId
├── type: "inference" | "tool_execution" | "profiling" | "background_analysis"
├── status: "running" | "completed" | "failed"
├── summary: string (brief result)
├── startedAt, completedAt
└── seenByUser: boolean (for badge count)

Notification flow:
1. sendMessage detects long-running operation → creates AgentTask (status: running)
2. Operation completes → updates AgentTask (status: completed, summary: "...")
3. Client polls or uses SSE for real-time updates
4. If user is on same page: in-panel update
5. If user is on different page: banner notification
6. FAB badge shows count of unseen completed tasks
7. Workspace dashboard queries all AgentTask for this user
```

## Key Design Questions (for next session)

1. **Polling vs SSE vs WebSocket?** For real-time notifications across pages. SSE is simplest. Polling works but adds latency.

2. **How long do tasks persist?** Clean up after 24h? Keep forever for audit? Configurable per task type?

3. **Should the agent panel support multiple concurrent conversations?** Currently one thread per route. Multi-task might need tabbed conversations or a thread switcher.

4. **How does this interact with the Process Observer?** The observer runs in the background already — it should create AgentTask records for its work too.

5. **Mobile/responsive?** Banner notifications work on mobile. FAB badge is already responsive. Workspace dashboard needs a mobile layout.

## Connection to Other Epics

- **EP-FEEDBACK-001:** Observer creates ImprovementProposals in the background → needs async notification when done
- **EP-PROCESS-001:** Observer runs after every sendMessage → its results should surface via this system
- **EP-SELF-DEV-001A:** Build Studio sandbox operations are inherently long-running → perfect use case for background tasks
- **BI-UX-001:** The synchronous thinking indicator is Layer 1 of this design

## Priority Assessment

This is a **quality-of-life epic** that becomes critical as more agent tools are added. The more capable the agents become (codebase access, builds, provider management), the more operations will be long-running. Without async support, the platform will feel slow and blocking.

**Recommended first slice:** BI-ASYNC-005 (thinking indicator) + BI-ASYNC-001 (task queue) — give immediate visual feedback for sync operations, then add the task queue for async.
