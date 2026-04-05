# Collaborative Work Queue & Task Routing — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-CWQ-001 (Collaborative Work Queues) |
| **IT4IT Alignment** | Cross-cutting: all value streams. Primary: SS5.3 Integrate (work execution), SS5.7 Operate (incident queues). Anchored in IT4IT v3.0.1 "Manage" functional component — work management across value streams. |
| **Status** | Draft |
| **Created** | 2026-04-04 |
| **Author** | Claude (Software Architect) + Mark Bodman (CEO) |
| **Dependencies** | EP-VST-001 (Value Stream Teams), EP-TAK-PATTERNS (Agentic Architecture), EP-BUILD-ORCHESTRATOR (Build Process), EP-BUILD-HANDOFF-002 (Phase Handoff & Authority), EP-ASYNC-COWORKER-001 (Async Messaging), Task Graph Orchestration (TaskRun/TaskNode) |
| **Design Motto** | "One queue, many workers — human or machine" |
| **Progressive Disclosure** | US Patent 8,635,592 — queues reveal complexity as operational scale demands it |

---

## 1. Problem Statement

The platform has powerful building blocks that don't yet compose into a unified work management layer:

1. **TaskRun/TaskNode** provides a DAG execution model — but tasks are only visible inside the agent conversation thread. There is no shared queue where multiple workers (human or AI) can see, claim, and collaborate on pending work.

2. **BacklogItem** has claim semantics (`claimedById`, `claimedByAgentId`) — but claiming is manual assignment, not queue-driven. There is no routing policy that matches work to the right worker based on capability, availability, and team composition.

3. **ValueStreamTeam** defines team patterns (specialist-dispatch, review-board, pair, swarm, pipeline) — but these are schema-only. No runtime dispatches work through team configurations.

4. **Notifications** are basic (in-app + push device registration) — but there is no way to alert a human that work is waiting for them, request a simple approval, or escalate when a timeout expires.

5. **CalendarEvent** tracks scheduling — but work queues and calendar events live in separate worlds. A human's availability (in a meeting, on leave, working hours) is not considered when routing work.

6. **Approval workflows** exist (AgentActionProposal, approval-authority.ts) — but only for agent action proposals. There is no general-purpose mechanism for task-time approvals, physical task sign-offs, or multi-step human workflows.

### What We Want

A **Collaborative Work Queue** that:
- Surfaces TaskNodes and BacklogItems as claimable work in a unified queue
- Routes work to humans, AI agents, or mixed teams based on ValueStreamTeam configuration
- Integrates with CalendarEvents for availability-aware scheduling
- Supports three interaction patterns: **H2H** (human-to-human), **A2A** (AI-to-AI), **H2A** (human-to-AI, bidirectional)
- Provides messaging/alerting for queue events (assignment, escalation, completion)
- Handles both quick approvals (tap-to-approve) and physical/manual tasks (with evidence collection)
- Follows A2A protocol semantics for agent interoperability
- Uses Inngest-style durable step functions for reliable execution

---

## 2. Architecture

### 2.1 The Work Item Abstraction

Everything in the queue is a **WorkItem** — a unified view over heterogeneous sources.

```
WorkItem (unified queue entry)
+-- itemId: string (cuid)
+-- sourceType: "task-node" | "backlog-item" | "approval" | "manual-task" | "scheduled"
+-- sourceId: string (FK to source record)
+-- title: string
+-- description: string
+-- urgency: "routine" | "priority" | "urgent" | "emergency"
+-- effortClass: "instant" | "short" | "medium" | "long" | "physical"
|   -- "instant": tap-to-approve, yes/no decision (<30s)
|   -- "short": review a document, write a comment (5-30 min)
|   -- "medium": build a feature, investigate an issue (1-4 hours)
|   -- "long": multi-day project work
|   -- "physical": manual/labor task requiring human presence (inspect, install, deliver)
+-- workerConstraint: WorkerConstraint
+-- teamId: string? (FK to ValueStreamTeam — which team owns this)
+-- queueId: string (FK to WorkQueue — which queue it sits in)
+-- status: WorkItemStatus
+-- assignedTo: WorkerRef? (who currently owns it)
+-- claimedAt: DateTime?
+-- dueAt: DateTime? (deadline, if any)
+-- calendarEventId: string? (linked calendar event for scheduled work)
+-- evidence: Json? (completion evidence — photos, sign-offs, test results)
+-- parentItemId: string? (for sub-tasks)
+-- a2aTaskId: string? (external A2A protocol task ID for federation)
+-- createdAt: DateTime
+-- updatedAt: DateTime
+-- completedAt: DateTime?
```

```
WorkerConstraint
+-- workerType: "human" | "ai-agent" | "either" | "team"
|   -- "team" means the item goes to a ValueStreamTeam for coordinated execution
+-- requiredCapabilities: string[] (e.g., ["schema_validate", "code_review"])
+-- requiredRole: string? (PlatformRole code, e.g., "HR-500")
+-- requiredAgentId: string? (specific agent, when pre-assigned)
+-- excludeWorkers: string[] (workers who already attempted and failed)
+-- preferredWorkerIds: string[] (soft preference, not hard constraint)
+-- sensitivityLevel: "public" | "internal" | "confidential" | "restricted"
```

```
WorkerRef
+-- workerType: "human" | "ai-agent"
+-- userId: string? (when human)
+-- agentId: string? (when AI)
+-- employeeId: string? (for HR/authority resolution)
+-- threadId: string? (agent execution thread)
```

```
WorkItemStatus
  "queued"           -- in queue, not yet assigned
  "assigned"         -- worker identified, not yet started
  "in-progress"      -- worker actively engaged
  "awaiting-input"   -- blocked on another worker's input (A2A: input-required)
  "awaiting-approval"-- needs approval gate sign-off
  "completed"        -- done, evidence collected
  "failed"           -- attempted and failed
  "cancelled"        -- withdrawn
  "escalated"        -- timeout expired, moved to escalation path
  "deferred"         -- explicitly postponed (with reschedule date)
```

### 2.2 Work Queues

Queues are organizational containers. Every WorkItem belongs to exactly one queue.

```
WorkQueue
+-- queueId: string (cuid)
+-- name: string (e.g., "Build Tasks", "Deployment Approvals", "Facilities Requests")
+-- queueType: "team" | "personal" | "triage" | "escalation"
|   -- "team": shared queue for a ValueStreamTeam
|   -- "personal": individual worker's assigned items
|   -- "triage": unassigned items awaiting routing
|   -- "escalation": items that timed out and need attention
+-- teamId: string? (FK to ValueStreamTeam, for team queues)
+-- routingPolicy: RoutingPolicy
+-- slaMinutes: Json? (per-urgency SLA targets)
+-- isActive: Boolean
+-- portfolioId: string? (scoped to a portfolio/business model)
+-- digitalProductId: string? (scoped to a specific product)
```

```
RoutingPolicy
+-- mode: "auto" | "manual" | "round-robin" | "capability-match" | "load-balanced"
|   -- "auto": system matches best worker using capability + availability + performance
|   -- "manual": items wait in queue for self-service claiming
|   -- "round-robin": distributed evenly across eligible workers
|   -- "capability-match": match requiredCapabilities to worker skills
|   -- "load-balanced": factor in current workload per worker
+-- considerAvailability: boolean (check CalendarEvent for conflicts)
+-- considerPerformance: boolean (use AgentPerformance / TaskEvaluation scores)
+-- maxConcurrentPerWorker: number (prevent overload)
+-- autoEscalateAfterMinutes: number? (null = no auto-escalation)
+-- escalationQueueId: string? (where escalated items go)
```

### 2.3 The Three Interaction Patterns

#### Pattern 1: Human-to-Human (H2H)

Traditional task management. One human assigns work to another. The queue serves as a shared backlog with visibility.

**Flow:**
```
Manager creates WorkItem (sourceType: "manual-task", effortClass: "physical")
  --> Router checks workerConstraint (workerType: "human", requiredRole: "facilities-tech")
  --> Matches to available employee via CalendarSync + PlatformRole
  --> Notification sent (in-app + email/SMS based on urgency)
  --> Worker claims item in queue UI
  --> Worker completes task, uploads evidence (photo, sign-off)
  --> Item marked completed, evidence stored
  --> Originator notified of completion
```

**Physical task evidence types:**
- Photo/document upload (before/after)
- GPS check-in (for field work)
- Digital signature (for sign-offs)
- Checklist completion (structured verification)
- Time log (actual hours for labor tracking)

#### Pattern 2: AI-to-AI (A2A)

Agent orchestration through queues instead of direct dispatch. Enables loose coupling and cross-value-stream delegation.

**Flow:**
```
Build Orchestrator creates WorkItem (sourceType: "task-node", workerConstraint: { workerType: "ai-agent" })
  --> Router matches to specialist agent via ValueStreamTeamRole
  --> Agent thread created, item assigned
  --> Agent executes (emitting events to AgentEventBus)
  --> On "awaiting-input": item status changes, dependency item created
  --> On completion: evidence captured in TaskNode, item marked completed
  --> Orchestrator notified via event bus, next item dispatched
```

**A2A Protocol alignment (Google A2A):**

| A2A Concept | DPF Mapping |
|-------------|-------------|
| Agent Card | Agent record + AgentSkillAssignment + ValueStreamTeamRole |
| Task (submitted) | WorkItem (status: "queued") |
| Task (working) | WorkItem (status: "in-progress") |
| Task (input-required) | WorkItem (status: "awaiting-input") |
| Task (completed) | WorkItem (status: "completed") |
| Task (failed) | WorkItem (status: "failed") |
| Artifact | TaskNode.outputSnapshot / WorkItem.evidence |
| Message (agent-to-agent) | AgentEventBus event + WorkItemMessage |

#### Pattern 3: Human-to-AI and AI-to-Human (H2A / A2H)

The most complex and most valuable pattern. Bidirectional handoff between humans and AI agents.

**H2A Flow (human delegates to AI):**
```
Human creates work item or BacklogItem is promoted from queue
  --> Router identifies ValueStreamTeam with workerType: "either"
  --> Checks if AI agent can handle (capability match + model tier)
  --> If yes: assigns to agent, human stays as "observer" on item
  --> Agent executes, human receives progress notifications
  --> At HITL gate: item transitions to "awaiting-approval"
  --> Human receives approval notification (tap-to-approve for simple, full review for complex)
  --> Human approves/rejects, item continues or loops back
```

**A2H Flow (AI needs human action):**
```
Agent reaches a step requiring human judgment or physical action
  --> Creates child WorkItem (effortClass: "instant" for approval, "physical" for manual task)
  --> Router resolves approval authority (approval-authority.ts)
  --> Checks authority's availability via CalendarSync
  --> Multi-channel notification based on urgency:
      routine: in-app notification
      priority: in-app + email
      urgent: in-app + email + Slack/Teams
      emergency: all channels simultaneously (emergencyBypass)
  --> Parent WorkItem status: "awaiting-input"
  --> Human responds (approve/reject/delegate/defer)
  --> Agent resumes with human's decision
```

### 2.4 Queue-Calendar Integration

Work items exist in the context of time. The queue must know when workers are available.

```
WorkSchedule (per worker)
+-- workerId: WorkerRef
+-- timezone: string
+-- workingHours: { start: string, end: string }[] (per day of week)
+-- exceptions: string[] (CalendarEvent IDs that override availability)
```

**Integration points:**

1. **Routing considers availability**: When `routingPolicy.considerAvailability = true`, the router checks:
   - Is the worker within working hours?
   - Do they have a conflicting CalendarEvent (meeting, leave)?
   - What is their current queue depth vs `maxConcurrentPerWorker`?

2. **Due dates create CalendarEvents**: When a WorkItem has `dueAt`, the system optionally creates a CalendarEvent for the assigned worker as a reminder.

3. **Calendar blocks create deferrals**: If a worker goes on leave, their in-progress items can be automatically reassigned or deferred.

4. **Scheduled work items**: WorkItems with `calendarEventId` are time-bound. They appear in both the queue view and the calendar view. Example: "Deploy release v2.3 during change window Friday 2am-4am."

### 2.5 Messaging & Notification Layer

Every queue transition can trigger a notification. The notification system expands from basic in-app to multi-channel.

```
WorkItemMessage
+-- messageId: string
+-- workItemId: string (FK to WorkItem)
+-- senderRef: WorkerRef (human or agent)
+-- messageType: "comment" | "question" | "approval-request" | "status-update" | "escalation" | "handoff"
+-- body: string
+-- structuredPayload: Json? (for approval_request: { options: ["approve", "reject", "delegate"] })
+-- channel: "in-app" | "email" | "slack" | "sms" | "push"
+-- deliveredAt: DateTime?
+-- readAt: DateTime?
+-- respondedAt: DateTime?
+-- response: Json? (the human's structured response)
+-- createdAt: DateTime
```

**Quick-response approvals (tap-to-approve):**

For `effortClass: "instant"` items, the notification includes action buttons directly:

- **In-app**: Notification card with Approve/Reject buttons (no navigation required)
- **Email**: HTML email with one-click action links (tokenized URLs)
- **Slack/Teams**: Interactive message with button attachments
- **SMS**: Reply "1" to approve, "2" to reject (for emergency escalation)
- **Push**: Rich notification with action buttons (iOS/Android)

**Escalation chain:**

```
Worker doesn't respond within SLA
  --> Notify worker again (same channel)
  --> Wait escalationTimeoutMinutes / 2
  --> Escalate to next in escalationPath (from ValueStreamHitlGate)
  --> If still no response: escalate to next
  --> Final escalation: move to escalation queue + notify platform admin
  --> If emergencyBypass: fire all channels simultaneously from the start
```

---

## 3. The Queue Router

The router is the brain of the system. It takes a WorkItem and decides: who does this?

### 3.1 Routing Decision Flow

```
1. IDENTIFY TEAM
   WorkItem.teamId? --> use that team
   WorkItem.sourceType == "task-node"? --> find team by TaskRun.routeContext + value stream
   WorkItem.sourceType == "backlog-item"? --> find team by digitalProductId + value stream
   No team found? --> route to triage queue

2. RESOLVE ELIGIBLE WORKERS
   Read ValueStreamTeamRole[] for the team
   Filter by workerConstraint:
     - workerType matches role.workerType (or role is "either")
     - requiredCapabilities subset of role.grantScope
     - requiredRole matches role.humanRoleId (if specified)
     - requiredAgentId matches role.agentId (if specified)
     - worker not in excludeWorkers

3. RANK CANDIDATES (when multiple eligible)
   For each candidate, compute score:
     +10 if preferredWorkerIds includes candidate
     +5  if AgentPerformance score > 4.0 for this task type (AI agents)
     +3  if worker has capacity (currentLoad < maxConcurrentPerWorker)
     +2  if worker is currently available (within working hours, no calendar conflict)
     +1  if worker is currently online (recent AgentThread activity for humans)
     -5  if worker previously failed this item type (excludeWorkers adjacency)

4. APPLY ROUTING POLICY
   "auto": assign to highest-scoring candidate
   "round-robin": assign to least-recently-assigned eligible candidate
   "capability-match": assign to candidate with most matching capabilities
   "load-balanced": assign to candidate with lowest current queue depth
   "manual": place in team queue, notify all eligible workers, first to claim wins

5. DISPATCH
   If human: create WorkItemMessage (assignment notification), respect channel preferences
   If AI agent: create AgentThread, dispatch via event bus, link to WorkItem
   If team (teamPattern): invoke team coordination pattern:
     "specialist-dispatch": create child WorkItems per role, dispatch individually
     "review-board": create same WorkItem for all roles, collect votes
     "pair": assign to one human + one AI, create shared context
     "swarm": dispatch to all roles independently, synthesize results
     "pipeline": create sequential chain of child WorkItems
```

### 3.2 Team Pattern Execution

Each `teamPattern` from ValueStreamTeam maps to a specific queue orchestration:

**specialist-dispatch:**
```
Parent WorkItem (teamId: T, effortClass: "medium")
  |
  +-- Child WorkItem 1 (assigned to data-architect, priority: 0)
  +-- Child WorkItem 2 (assigned to software-engineer, priority: 1)
  +-- Child WorkItem 3 (assigned to frontend-engineer, priority: 2)  [parallel with 2 if no overlap]
  +-- Child WorkItem 4 (assigned to qa-engineer, priority: 3)
  
  CoordinationPattern.parallelWithinPhase = true
  --> Items with same priority dispatch concurrently
  CoordinationPattern.fileOverlapSplitting = true  
  --> If 2 and 3 touch same files, 3 waits for 2
```

**review-board:**
```
Parent WorkItem (teamId: T, effortClass: "short")
  |
  +-- Review Item A (assigned to qa-agent, same content)
  +-- Review Item B (assigned to security-agent, same content)
  +-- Review Item C (assigned to tech-lead [human], same content)
  
  CoordinationPattern.consensusMode = "majority"
  --> 2 of 3 must approve
  --> If all reject, parent item marked "failed" with consolidated feedback
```

**pair:**
```
Parent WorkItem (teamId: T)
  |
  +-- AI Sub-item (assigned to AI agent — does initial work)
  +-- Human Sub-item (assigned to human — reviews/refines)
  
  Sequential: AI completes --> Human receives for review
  Human can: approve, reject (loop back to AI), or take over
```

**swarm:**
```
Parent WorkItem (teamId: T)
  |
  +-- Perspective A (role: monitoring-agent, perspective: "availability-first")
  +-- Perspective B (role: incident-classifier, perspective: "pattern-recognition")
  +-- Perspective C (role: root-cause-analyzer, perspective: "causal-chain")
  
  CoordinationPattern.diversityMode:
    "independent": all work separately, results compared
    "debate": each sees others' output and critiques
    "build-on": sequential refinement through different lenses
  
  Final synthesis: human (on-call engineer) reviews all perspectives, decides action
```

**pipeline:**
```
Parent WorkItem (teamId: T)
  |
  +-- Stage 1: Plan (deploy-planner agent)
       |
       +-- Stage 2: Scan (security-scanner agent)
            |
            +-- Stage 3: Approve (HR-500 human, effortClass: "instant")
                 |
                 +-- Stage 4: Execute (deploy-executor agent)
  
  Each stage's output becomes next stage's input
  Failure at any stage halts the pipeline
```

---

## 4. Durable Execution with Inngest (Phase 1 Foundation)

**Decision: Inngest is foundational infrastructure, not deferred.** Durable execution underpins correct queue behavior from day one. Deferring it creates technical debt — every background job, timer, and escalation written without durability must later be rewritten. The right architecture costs the same to build now as later, but avoids the rewrite.

### 4.1 Why Inngest (not raw setInterval/setTimeout)

DPF currently has 6 background job patterns that lose state on container restart:

| Current Pattern | File | Problem |
|-----------------|------|---------|
| Discovery Prometheus poll (60s `setInterval`) | `lib/operate/discovery-scheduler.ts` | Timer lost on restart; in-progress sweep abandoned |
| Discovery full sweep (15m `setInterval`) | `lib/operate/discovery-scheduler.ts` | Overlapping sweep guard is in-memory only |
| Infra prune (fire-and-forget `void`) | `lib/actions/infra-prune.ts` | Failure silently swallowed; no retry |
| MCP catalog sync (fire-and-forget `void`) | `lib/actions/mcp-catalog.ts` | Failure silently swallowed; no retry |
| Rate recovery (`setTimeout` per provider) | `lib/routing/rate-recovery.ts` | All timers lost on restart; providers stay degraded |
| Async inference polling (caller-driven loop) | `lib/inference/async-inference.ts` | 15m expiry; caller crash = orphaned operation |

| Concern | Current (setInterval) | With Inngest |
|---------|----------------------|--------------|
| Process restart | Lost — timers cleared | Durable — resumes from last step |
| Retry on failure | Manual try/catch | Automatic with configurable backoff |
| Concurrency control | None | Built-in per-function limits |
| Observability | Console logs | Dashboard at `:8288` with step-level visibility |
| Timeout handling | Manual Promise.race | Native `step.waitForEvent` with timeout |
| Deployment | Restart loses state | Zero-downtime — steps checkpoint |
| Escalation chains | Not possible (no durable sleep) | `step.sleep("30m")` survives restarts |

### 4.2 Infrastructure: Docker Compose Addition

Inngest runs as a single Docker container alongside existing services. Licensed SSPL v1 — self-hosting for internal use is explicitly permitted. SDK is MIT.

```yaml
# Add to docker-compose.yml
services:
  inngest:
    image: inngest/inngest:latest
    command: "inngest start"
    ports:
      - "8288:8288"   # API + Dashboard UI
      - "8289:8289"   # Connect WebSocket gateway
    environment:
      - INNGEST_EVENT_KEY=${INNGEST_EVENT_KEY}
      - INNGEST_SIGNING_KEY=${INNGEST_SIGNING_KEY}
      - INNGEST_POSTGRES_URI=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/inngest
      - INNGEST_REDIS_URI=redis://redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8288/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
    networks:
      - dpf-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
    networks:
      - dpf-network

volumes:
  redis_data:
```

**Backing store notes:**
- Inngest manages its own Postgres schema in a separate `inngest` database — no Prisma migration needed for it
- Redis provides queue and ephemeral state; required for production (in-memory fallback loses state on restart)
- Dev mode: `INNGEST_DEV=1` uses SQLite, no external dependencies needed

### 4.3 SDK Integration

**Package installation:**
```bash
pnpm --filter @dpf/web add inngest
```

**Three files form the integration:**

**File 1 — Client** (`apps/web/lib/queue/inngest-client.ts`):
```typescript
import { Inngest } from "inngest";

// Type-safe event catalog
type Events = {
  // Work queue lifecycle
  "cwq/item.created": { data: { workItemId: string; sourceType: string; urgency: string } };
  "cwq/item.completed": { data: { workItemId: string; outcome: "success" | "failed" | "cancelled"; evidence?: unknown } };
  "cwq/item.cancelled": { data: { workItemId: string; reason: string } };
  "cwq/approval.response": { data: { workItemId: string; decision: "approve" | "reject" | "delegate"; decidedBy: string } };
  "cwq/sla.warning": { data: { workItemId: string; minutesRemaining: number } };
  "cwq/availability.changed": { data: { workerId: string; calendarEventId: string } };

  // Migrated background jobs
  "ops/discovery.poll": { data: { jobType: "prometheus" | "full-sweep" } };
  "ops/infra.prune": { data: { triggeredBy: string } };
  "ops/mcp-catalog.sync": { data: { syncId: string } };
  "ops/rate.recover": { data: { providerId: string; modelId: string } };
};

export const inngest = new Inngest({
  id: "dpf-platform",
  schemas: new EventSchemas().fromRecord<Events>(),
});
```

**File 2 — API Route** (`apps/web/app/api/inngest/route.ts`):
```typescript
import { serve } from "inngest/next";
import { inngest } from "@/lib/queue/inngest-client";
import { allFunctions } from "@/lib/queue/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: allFunctions,
});
```

**File 3 — Function registry** (`apps/web/lib/queue/functions/index.ts`):
```typescript
export { routeWorkItem } from "./route-work-item";
export { teamDispatch } from "./team-dispatch";
export { escalationHandler } from "./escalation-handler";
export { discoveryPoll } from "./discovery-poll";
export { infraPrune } from "./infra-prune";
export { mcpCatalogSync } from "./mcp-catalog-sync";
export { rateRecovery } from "./rate-recovery";

import * as fns from ".";
export const allFunctions = Object.values(fns);
```

### 4.4 Core Queue Functions

**Work item routing — the main queue brain:**
```typescript
// apps/web/lib/queue/functions/route-work-item.ts
import { inngest } from "../inngest-client";

export const routeWorkItem = inngest.createFunction(
  {
    id: "cwq/route-work-item",
    retries: 3,
    concurrency: { limit: 20, scope: "fn" },
    priority: {
      // Emergency items execute first
      run: "event.data.urgency == 'emergency' ? 600 : event.data.urgency == 'urgent' ? 300 : event.data.urgency == 'priority' ? 100 : 0",
    },
    cancelOn: [{
      event: "cwq/item.cancelled",
      match: "data.workItemId",
    }],
  },
  { event: "cwq/item.created" },
  async ({ event, step }) => {
    // Step 1: Resolve team and eligible workers
    const routing = await step.run("resolve-and-rank", async () => {
      // DB query: find ValueStreamTeam, rank candidates
      // Returns: { teamId, candidates: WorkerRef[], routingDecision: Json }
    });

    // Step 2: Dispatch to best worker
    const assignment = await step.run("dispatch-to-worker", async () => {
      // Assign WorkItem, create notification, emit event bus event for SSE
      // For AI agent: create AgentThread, dispatch via event bus
      // For human: send notification via adapter
    });

    // Step 3: Wait for completion or SLA timeout
    const slaMinutes = await step.run("get-sla", async () => {
      // Read SLA from WorkQueue.slaMinutes based on urgency
    });

    const completion = await step.waitForEvent("wait-for-completion", {
      event: "cwq/item.completed",
      if: `async.data.workItemId == "${event.data.workItemId}"`,
      timeout: `${slaMinutes}m`,
    });

    if (!completion) {
      // SLA expired — escalate
      await step.run("escalate", async () => {
        // Move to escalation queue, notify next in escalation path
        // Send escalation notification via adapter
      });

      // Wait again with escalation timeout
      const escalation = await step.waitForEvent("wait-for-escalation", {
        event: "cwq/item.completed",
        if: `async.data.workItemId == "${event.data.workItemId}"`,
        timeout: "2h",
      });

      if (!escalation) {
        await step.run("final-escalation", async () => {
          // Platform admin notification, mark item as escalated
        });
      }
    }

    // Step 4: Handle completion — check if parent item is done
    await step.run("check-parent", async () => {
      // If this item has a parentItemId, check if all siblings are done
      // If yes, mark parent as completed and send completion event
    });
  }
);
```

**Approval workflow — tap-to-approve with durable timeout:**
```typescript
// apps/web/lib/queue/functions/approval-handler.ts
export const approvalHandler = inngest.createFunction(
  {
    id: "cwq/approval-handler",
    retries: 2,
    cancelOn: [{ event: "cwq/item.cancelled", match: "data.workItemId" }],
  },
  { event: "cwq/approval.requested" },
  async ({ event, step }) => {
    // Send multi-channel notification with action buttons
    await step.run("send-approval-request", async () => {
      // Resolve authority via approval-authority.ts
      // Send via notification adapter (in-app + email for priority, all for emergency)
    });

    // Wait for human response — this sleep survives container restarts
    const response = await step.waitForEvent("wait-for-decision", {
      event: "cwq/approval.response",
      if: `async.data.workItemId == "${event.data.workItemId}"`,
      timeout: `${event.data.escalationTimeoutMinutes}m`,
    });

    if (!response) {
      // Timeout — escalate to next in chain
      await step.run("escalate-approval", async () => {
        // Try next person in escalationPath[]
      });

      // Recursive: send another approval request to next authority
      await step.sendEvent("re-request", {
        name: "cwq/approval.requested",
        data: { ...event.data, escalationLevel: (event.data.escalationLevel || 0) + 1 },
      });
    } else {
      // Human responded — update WorkItem and resume parent
      await step.run("apply-decision", async () => {
        // Update WorkItem status based on decision
        // Send completion event to unblock parent
      });
    }
  }
);
```

### 4.5 Migrated Background Jobs

Existing `setInterval`/fire-and-forget patterns become Inngest cron functions:

```typescript
// apps/web/lib/queue/functions/discovery-poll.ts
// Replaces: discovery-scheduler.ts setInterval(60000) and setInterval(900000)

export const prometheusPoll = inngest.createFunction(
  { id: "ops/prometheus-poll", retries: 2 },
  { cron: "* * * * *" },  // Every minute
  async ({ step }) => {
    await step.run("poll-targets", async () => {
      // Existing runPrometheusTargetCheck() logic
    });
  }
);

export const fullDiscoverySweep = inngest.createFunction(
  {
    id: "ops/full-discovery-sweep",
    retries: 2,
    concurrency: { limit: 1, scope: "fn" }, // Replaces sweepInProgress flag
  },
  { cron: "*/15 * * * *" },  // Every 15 minutes
  async ({ step }) => {
    await step.run("run-sweep", async () => {
      // Existing runFullDiscoverySweep() logic
    });
    await step.run("record-job", async () => {
      // Update ScheduledJob record for calendar projection
    });
  }
);
```

```typescript
// apps/web/lib/queue/functions/infra-prune.ts
// Replaces: infra-prune.ts fire-and-forget void pattern

export const infraPrune = inngest.createFunction(
  { id: "ops/infra-prune", retries: 2 },
  { cron: "0 3 * * 0" },  // Weekly, Sunday 3am
  async ({ step }) => {
    const results = await step.run("prune-stale", async () => {
      // Existing pruneStaleInfraCIs() logic
      // Returns: { decommissioned: number, deleted: number }
    });
    await step.run("record-job", async () => {
      // Update ScheduledJob record with results
    });
  }
);
```

```typescript
// apps/web/lib/queue/functions/rate-recovery.ts
// Replaces: rate-recovery.ts setTimeout per provider (lost on restart)

export const rateRecovery = inngest.createFunction(
  {
    id: "ops/rate-recovery",
    retries: 1,
    idempotency: "event.data.providerId + '-' + event.data.modelId",
  },
  { event: "ops/rate.recover" },
  async ({ event, step }) => {
    // Durable sleep — survives container restarts
    await step.sleep("recovery-delay", "60s");

    await step.run("restore-provider", async () => {
      // Existing: update ModelProfile status from "degraded" to "active"
    });
  }
);
```

### 4.6 Bridge: Agent Event Bus <-> Inngest

The in-memory AgentEventBus remains for real-time SSE streaming (low latency, no durability needed). Inngest handles durable operations. A bridge connects them:

```typescript
// apps/web/lib/queue/inngest-bridge.ts

import { agentEventBus } from "@/lib/tak/agent-event-bus";
import { inngest } from "./inngest-client";

/**
 * Forward queue-relevant agent events to Inngest for durable processing.
 * Called once at server startup (instrumentation.ts).
 */
export function startInngestBridge(): void {
  // When an agent event indicates a work item needs queue attention,
  // forward to Inngest for durable processing
  agentEventBus.subscribe("__queue_bridge__", (threadId, event) => {
    switch (event.type) {
      case "queue:item_created":
        void inngest.send({
          name: "cwq/item.created",
          data: { workItemId: event.workItemId, sourceType: event.sourceType, urgency: event.urgency },
        });
        break;
      case "queue:item_completed":
        void inngest.send({
          name: "cwq/item.completed",
          data: { workItemId: event.workItemId, outcome: event.outcome },
        });
        break;
    }
  });
}

/**
 * Emit real-time events from inside Inngest step functions.
 * Used for SSE progress updates to the browser.
 */
export function emitQueueProgress(threadId: string, event: AgentEvent): void {
  agentEventBus.emit(threadId, event);
}
```

### 4.7 Event Catalog

All Inngest events for the platform:

| Event | Trigger | Function(s) |
|-------|---------|-------------|
| `cwq/item.created` | Work item enters queue | `routeWorkItem` |
| `cwq/item.completed` | Worker finishes item | Resumes `routeWorkItem` waitForEvent |
| `cwq/item.cancelled` | Item withdrawn | Cancels running `routeWorkItem` |
| `cwq/approval.requested` | Item needs human decision | `approvalHandler` |
| `cwq/approval.response` | Human approves/rejects | Resumes `approvalHandler` waitForEvent |
| `cwq/team.dispatch` | Item requires team coordination | `teamDispatch` |
| `cwq/sla.warning` | SLA threshold approaching | `slaWarningNotifier` |
| `cwq/availability.changed` | Calendar event created/moved | `availabilityRecheck` |
| `ops/discovery.poll` | Manual discovery trigger | `prometheusPoll` (also cron) |
| `ops/infra.prune` | Manual prune trigger | `infraPrune` (also cron) |
| `ops/mcp-catalog.sync` | Manual sync trigger | `mcpCatalogSync` |
| `ops/rate.recover` | Provider rate-limited | `rateRecovery` |

### 4.8 Execution Model: Critical Rule

**All non-deterministic code MUST be inside `step.run()` calls.** Inngest replays the function from the top on each step, using memoized results for completed steps. Code outside steps runs on every replay.

```typescript
// WRONG — Date.now() returns different value on replay
const now = Date.now();
await step.run("use-time", async () => doSomething(now));

// CORRECT — timestamp captured inside step
const now = await step.run("get-time", () => Date.now());
await step.run("use-time", async () => doSomething(now));
```

### 4.9 Known Limits

| Limit | Value | Impact on DPF |
|-------|-------|---------------|
| Max steps per function | 1,000 | Sufficient — deepest team dispatch is ~50 steps |
| Max step return data | 4 MB | Sufficient — routing decisions are small JSON |
| Max function run state | 32 MB | Watch for large evidence payloads |
| Max sleep duration | 1 year (self-hosted) | Sufficient for any SLA |
| Max retries | 20 | Sufficient — DPF uses 2-3 |
| Max events per send() | 5,000 | Sufficient for fan-out dispatch |

---

## 5. Schema Design

### 5.1 New Prisma Models

```prisma
// ---- Collaborative Work Queue Models ----

model WorkQueue {
  id                String     @id @default(cuid())
  queueId           String     @unique @default(cuid())
  name              String
  queueType         String     // team | personal | triage | escalation
  teamId            String?
  team              ValueStreamTeam? @relation(fields: [teamId], references: [id])
  routingPolicy     Json       // RoutingPolicy structure
  slaMinutes        Json?      // { routine: 480, priority: 120, urgent: 30, emergency: 5 }
  isActive          Boolean    @default(true)
  portfolioId       String?
  portfolio         Portfolio? @relation(fields: [portfolioId], references: [id])
  digitalProductId  String?
  digitalProduct    DigitalProduct? @relation(fields: [digitalProductId], references: [id])
  items             WorkItem[]
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  @@index([teamId])
  @@index([portfolioId])
  @@index([queueType, isActive])
}

model WorkItem {
  id                String     @id @default(cuid())
  itemId            String     @unique @default(cuid())
  sourceType        String     // task_node | backlog_item | approval | manual_task | scheduled
  sourceId          String?    // FK to source record (polymorphic)
  title             String
  description       String     @db.Text
  urgency           String     @default("routine") // routine | priority | urgent | emergency
  effortClass       String     @default("medium")  // instant | short | medium | long | physical
  workerConstraint  Json       // WorkerConstraint structure
  teamId            String?
  team              ValueStreamTeam? @relation(fields: [teamId], references: [id])
  queueId           String
  queue             WorkQueue  @relation(fields: [queueId], references: [id])
  status            String     @default("queued")
  assignedToType    String?    // human | ai-agent
  assignedToUserId  String?
  assignedToUser    User?      @relation("WorkItemAssignee", fields: [assignedToUserId], references: [id])
  assignedToAgentId String?
  assignedToAgent   Agent?     @relation("WorkItemAssignee", fields: [assignedToAgentId], references: [id])
  assignedThreadId  String?    // Agent execution thread
  claimedAt         DateTime?
  dueAt             DateTime?
  calendarEventId   String?
  calendarEvent     CalendarEvent? @relation(fields: [calendarEventId], references: [id])
  evidence          Json?      // completion evidence
  parentItemId      String?
  parentItem        WorkItem?  @relation("WorkItemHierarchy", fields: [parentItemId], references: [id])
  childItems        WorkItem[] @relation("WorkItemHierarchy")
  a2aTaskId         String?    // external A2A protocol task ID
  messages          WorkItemMessage[]
  routingDecision   Json?      // captured routing rationale
  completedAt       DateTime?
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt

  @@index([queueId, status])
  @@index([assignedToUserId, status])
  @@index([assignedToAgentId, status])
  @@index([teamId, status])
  @@index([parentItemId])
  @@index([sourceType, sourceId])
  @@index([urgency, status])
  @@index([dueAt])
}

model WorkItemMessage {
  id                String     @id @default(cuid())
  messageId         String     @unique @default(cuid())
  workItemId        String
  workItem          WorkItem   @relation(fields: [workItemId], references: [id], onDelete: Cascade)
  senderType        String     // human | ai-agent | system
  senderUserId      String?
  senderAgentId     String?
  messageType       String     // comment | question | approval_request | status_update | escalation | handoff
  body              String     @db.Text
  structuredPayload Json?      // for approval_request: { options: [...] }
  channel           String     @default("in-app") // in_app | email | slack | sms | push
  deliveredAt       DateTime?
  readAt            DateTime?
  respondedAt       DateTime?
  response          Json?      // structured response from recipient
  createdAt         DateTime   @default(now())

  @@index([workItemId, createdAt])
  @@index([senderUserId])
}

model WorkSchedule {
  id                String     @id @default(cuid())
  workerType        String     // human | ai-agent
  userId            String?    @unique
  user              User?      @relation(fields: [userId], references: [id])
  agentId           String?    @unique
  agent             Agent?     @relation(fields: [agentId], references: [id])
  timezone          String     @default("UTC")
  workingHours      Json       // [{ day: 0-6, start: "09:00", end: "17:00" }]
  maxConcurrent     Int        @default(5)  // max items in_progress simultaneously
  autoAccept        Boolean    @default(false) // skip claim step for assigned items
  notificationPrefs Json?      // { routine: ["in-app"], urgent: ["in-app", "email"], emergency: ["all"] }
  createdAt         DateTime   @default(now())
  updatedAt         DateTime   @updatedAt
}
```

### 5.2 Canonical String Enums

Following CLAUDE.md mandatory compliance rules:

| Model | Field | Valid values |
|-------|-------|-------------|
| `WorkQueue` | `queueType` | `"team"` `"personal"` `"triage"` `"escalation"` |
| `WorkItem` | `sourceType` | `"task-node"` `"backlog-item"` `"approval"` `"manual-task"` `"scheduled"` |
| `WorkItem` | `urgency` | `"routine"` `"priority"` `"urgent"` `"emergency"` |
| `WorkItem` | `effortClass` | `"instant"` `"short"` `"medium"` `"long"` `"physical"` |
| `WorkItem` | `status` | `"queued"` `"assigned"` `"in-progress"` `"awaiting-input"` `"awaiting-approval"` `"completed"` `"failed"` `"cancelled"` `"escalated"` `"deferred"` |
| `WorkItemMessage` | `messageType` | `"comment"` `"question"` `"approval-request"` `"status-update"` `"escalation"` `"handoff"` |
| `WorkItemMessage` | `channel` | `"in-app"` `"email"` `"slack"` `"sms"` `"push"` |
| `WorkSchedule` | `workerType` | `"human"` `"ai-agent"` |

---

## 6. Event Bus Integration

### 6.1 New Agent Event Types

Add to the `AgentEvent` union in `agent-event-bus.ts`:

```typescript
// Queue lifecycle events
| { type: "queue:item_created"; workItemId: string; sourceType: string; urgency: string }
| { type: "queue:item_assigned"; workItemId: string; workerType: string; workerId: string }
| { type: "queue:item_claimed"; workItemId: string; workerType: string; workerId: string }
| { type: "queue:item_status_changed"; workItemId: string; fromStatus: string; toStatus: string }
| { type: "queue:item_completed"; workItemId: string; outcome: "success" | "failed" | "cancelled" }
| { type: "queue:escalation"; workItemId: string; fromWorker: string; toWorker: string; reason: string }
| { type: "queue:sla_warning"; workItemId: string; minutesRemaining: number }
| { type: "queue:message"; workItemId: string; messageType: string; senderId: string }
```

### 6.2 Runtime-to-EA Projection (extends EP-VST-001 Stage 1)

Queue events project to BPMN elements in the EA model:

| Queue Event | BPMN Element Created |
|-------------|---------------------|
| `queue:item_created` | `bpmn_task` or `bpmn_user_task` (based on workerConstraint) |
| `queue:item_assigned` | Update task element with lane assignment |
| `queue:escalation` | `bpmn_boundary_event` (timer) |
| `queue:item_completed` | `bpmn_end_event` (normal or error) |
| Team dispatch (specialist-dispatch) | `bpmn_parallel_gateway` fork |
| Team synthesis (all children done) | `bpmn_parallel_gateway` join |
| Approval gate | `bpmn_user_task` + `bpmn_exclusive_gateway` |

---

## 7. UI Design

### 7.1 Progressive Disclosure (US Patent 8,635,592)

Queue UI reveals complexity based on operational scale:

**Level 0 — Solo operator (1 human, AI coworkers):**
- No visible "queue" — work appears as AI Coworker conversation tasks
- Approvals appear as in-chat prompts ("I need your approval to deploy. [Approve] [Reject]")
- Calendar integration shows "upcoming work" on dashboard

**Level 1 — Small team (2-5 humans + AI):**
- Personal queue view: "My Tasks" list with status indicators
- Simple assignment: drag-and-drop or @mention to reassign
- Notification preferences (in-app + email)

**Level 2 — Department (6-20 humans + AI teams):**
- Team queue boards (Kanban columns per status)
- SLA indicators (green/yellow/red time-to-resolution)
- Calendar overlay showing team availability
- Routing policy configuration

**Level 3 — Enterprise (20+ humans, multiple value streams):**
- Cross-team queue analytics
- Value stream throughput metrics
- Escalation chain visualization
- A2A federation with external agent platforms
- BPMN process overlay showing queue items in process context

### 7.2 Queue Views

**Personal Queue** (`/workspace/my-queue`):
- Grouped by urgency (emergency at top, routine at bottom)
- Each item shows: title, effort class icon, due date, source context
- Quick actions: Claim, Approve/Reject (for instant items), Defer, Delegate
- Filters: by effort class, by source, by team

**Team Queue** (`/workspace/team/:teamId/queue`):
- Kanban board: Queued | Assigned | In Progress | Awaiting Input | Done
- Swimlanes by worker (showing both humans and AI agents)
- Capacity indicators per worker
- Drag-and-drop reassignment

**Calendar-Queue Overlay** (`/workspace/calendar`):
- Existing CalendarEvent view
- WorkItems with `dueAt` shown as calendar blocks
- Scheduled work items (deployments, reviews) shown in timeline
- Worker availability heat map

---

## 8. Implementation Phases

### Phase 1: Inngest Foundation + Queue Schema
Inngest is infrastructure, not a feature. It goes in first so everything built on top is durable from day one.

- **Inngest infrastructure**: Add `inngest`, `redis` services to `docker-compose.yml`; install `inngest` npm package; create client, API route (`/api/inngest`), function registry
- **Migrate existing background jobs**: Convert discovery-scheduler.ts (`setInterval`), infra-prune.ts (fire-and-forget), rate-recovery.ts (`setTimeout`), mcp-catalog-sync.ts (fire-and-forget) to Inngest cron/event functions. Remove `setInterval`/`setTimeout` patterns from `instrumentation.ts`
- **Inngest-EventBus bridge**: `inngest-bridge.ts` forwards durable queue events to Inngest, emits real-time SSE events from Inngest steps
- **Queue schema**: Add WorkQueue, WorkItem, WorkItemMessage, WorkSchedule to Prisma schema
- **Queue router** (capability-match mode): Route WorkItems to workers based on workerConstraint
- **Bridge TaskNode --> WorkItem**: TaskRun creates WorkItems for `awaiting_human` nodes
- **Bridge BacklogItem --> WorkItem**: Claimed items surface as WorkItems
- **In-app notifications**: Extend existing Notification model for queue events
- **Personal queue UI** (Level 0-1 progressive disclosure)

### Phase 2: Team Patterns + Notification Adapters
- Connect WorkQueue to ValueStreamTeam
- Implement specialist-dispatch and pair team patterns as Inngest functions (`cwq/team.dispatch`)
- **Notification adapter interface**: Pluggable `NotificationAdapter` with `in_app` built-in
- **Email adapter**: Tokenized approval links for tap-to-approve
- Quick-response approvals via `cwq/approval-handler` Inngest function (durable timeout + escalation)
- WorkItemMessage for in-queue communication
- SLA tracking via Inngest `step.waitForEvent` with timeout --> auto-escalation

### Phase 3: Full Routing + Calendar + Value Stream Metrics
- All five routing policies (auto, manual, round-robin, capability-match, load-balanced)
- Calendar-aware routing (WorkSchedule + CalendarSync integration)
- Review-board and swarm team patterns as Inngest functions
- Pipeline team pattern with sequential Inngest step handoff
- **Value stream queue analytics**: Per-agent throughput, queue depth, latency, bottleneck detection
- Team queue UI (Level 2 progressive disclosure)
- **Slack/Teams notification adapters**

### Phase 4: Federation + Physical Evidence + Enterprise
- MCP tools for queue operations (`submit_work_item`, `claim_work_item`, `complete_work_item`)
- A2A-compatible Agent Card endpoints (`/.well-known/agent.json`) for external discovery
- A2A `/tasks` adapter endpoint for external agent interoperability
- Physical task evidence APIs (photo upload, checklist, digital signature via web)
- Enterprise queue analytics (Level 3 progressive disclosure)
- BPMN process overlay for queue visualization

### Phase 5: MBSE Loop Closure + Mobile
- EA model drives queue creation (BPMN process --> WorkQueue + routing policy)
- Runtime queue telemetry feeds back to EA model (queue events --> BPMN elements)
- Self-optimizing routing (performance data adjusts routing weights automatically)
- Cross-value-stream queue delegation
- Mobile app evidence collection (native camera, GPS check-in, push notifications with actions)

---

## 9. Relationship to Existing Specs

| Spec | Relationship |
|------|-------------|
| **EP-VST-001** (Value Stream Teams) | CWQ is the runtime execution layer for VST's team configurations. VST defines the team; CWQ routes work through it. |
| **EP-TAK-PATTERNS** (Agentic Architecture) | CWQ follows Pattern 1 (model routing per task type), Pattern 7 (tool architecture), and Pattern 8 (sub-agent patterns). Queue routing respects quality tiers and sensitivity levels. |
| **EP-BUILD-ORCHESTRATOR** | Current build specialist dispatch becomes Phase 2's specialist-dispatch team pattern executed via CWQ. Build orchestrator delegates to queue router instead of direct dispatch. |
| **EP-BUILD-HANDOFF-002** | PhaseHandoff documents travel via WorkItemMessage (messageType: "handoff"). Authority engagement uses queue escalation chains instead of ad-hoc notification. |
| **EP-ASYNC-COWORKER-001** | Async messaging provides the SSE substrate. Queue status changes emit to the same event bus. The AI Coworker panel surfaces queue items relevant to the current conversation context. |
| **Task Graph Orchestration** | TaskNode is a source for WorkItems. When a TaskNode reaches `awaiting_human` or requires team coordination, a WorkItem is created. When the WorkItem completes, the TaskNode status updates. |
| **EP-CTX-001** (Context Budget) | Queue routing metadata (team, urgency, effort class) becomes L1 context for agent prompts. Worker history on an item becomes L2 situational context. |

---

## 10. Competitive Positioning

### 10.1 What No One Else Has

No surveyed platform (Notion, Linear, Asana, Temporal, CrewAI, AutoGen, LangGraph) provides all of:

1. **Unified human+AI queues** with the same routing, SLA, and escalation semantics
2. **Business-model-specific workflow patterns** (specialist-dispatch for builds, review-board for compliance, swarm for incident response)
3. **Calendar-aware work routing** that respects human availability
4. **Progressive disclosure** from solo operator to enterprise scale
5. **BPMN-modeled processes** that drive queue behavior (MBSE loop)
6. **A2A protocol compliance** for agent federation
7. **Physical task support** alongside digital work (evidence collection, GPS, signatures)

### 10.2 The Recursive Value Proposition

This feature is itself marketable. As DPF uses collaborative work queues to manage its own development:
- The queue system improves through dogfooding
- Improvements become features for DPF customers
- Customers' usage patterns generate feedback
- Feedback drives further improvement

The platform's unique value proposition: **every improvement to the factory is a product the factory can sell.**

---

## 11. Design Decisions (Resolved)

### 11.1 Durable Execution: Inngest from Phase 1

**Decision:** Inngest adopted as foundational infrastructure in Phase 1. All queue operations, background jobs, and escalation chains are built on Inngest from day one.

**Rationale:** Deferring durable execution creates compounding technical debt. Every `setInterval`, fire-and-forget `void`, and `setTimeout` pattern written without durability must later be rewritten. The correct architecture costs the same to build now as later — but avoids the rewrite and the bugs that come from non-durable timers (lost escalations, orphaned recovery timers, abandoned sweeps on container restart). Inngest adds one Docker container (+ Redis) to the stack, deploys as a single Next.js API route, and the SDK is MIT-licensed. The server is SSPL — self-hosting for internal use and customer-installed deployments is explicitly permitted.

### 11.2 Notification Providers: Pluggable Adapter Pattern

**Decision:** Pluggable. Notification delivery uses an adapter interface. DPF ships with `in_app` built-in; additional channels (email, Slack, Teams, SMS, push) are adapter implementations.

**Rationale:** "Platform as product" — different customers use different messaging platforms. A pluggable model means:
- DPF core doesn't depend on any specific provider
- Customers configure their preferred channels
- Mark tests using his own accounts during development
- New adapters (Discord, WhatsApp, webhook) added without touching core queue logic

```typescript
interface NotificationAdapter {
  channel: string;                    // "email" | "slack" | "sms" | etc.
  send(notification: QueueNotification): Promise<DeliveryReceipt>;
  supportsQuickResponse: boolean;     // can include action buttons?
  supportsRichContent: boolean;       // can include formatting?
}

interface QueueNotification {
  recipientId: string;
  workItemId: string;
  messageType: string;
  title: string;
  body: string;
  actions?: NotificationAction[];     // for quick-response approvals
  urgency: string;
}

interface NotificationAction {
  label: string;                      // "Approve", "Reject", "Delegate"
  actionId: string;                   // maps to API endpoint
  style: "primary" | "danger" | "default";
}
```

### 11.3 Inter-Agent Protocol: MCP-First, A2A-Ready

**Decision:** Use MCP as the formal internal interaction protocol. Design work item lifecycle states to be A2A-compatible so an adapter layer can be added later for external federation.

**Rationale:** MCP and A2A are complementary, not competing:

| Concern | MCP (what DPF uses) | A2A (future adapter) |
|---------|---------------------|---------------------|
| Tool/data access | Yes — already implemented | Not its purpose |
| Internal agent task routing | Yes — expose as MCP tools | Not needed internally |
| Agent discovery | No — DPF has agent registry | Yes — Agent Cards |
| External federation | No — walled garden | Yes — standard protocol |
| Task lifecycle states | Application-level | Protocol-level |

**Implementation approach:**
- **Phase 1-3:** New MCP tools for queue operations (`submit_work_item`, `claim_work_item`, `update_work_item_status`, `complete_work_item`). Internal agents use these tools directly. All task lifecycle states align with A2A's state machine (`queued`=submitted, `in_progress`=working, `awaiting_input`=input-required, `completed`/`failed`/`cancelled` match directly).
- **Phase 4 (when external interop needed):** Add A2A Agent Card endpoints (`/.well-known/agent.json`) and A2A-compliant `/tasks` API routes as a thin adapter over the existing MCP-backed queue. External agents use A2A; internal agents continue using MCP tools. Zero changes to core queue logic.

**Why not A2A now:** The spec is pre-1.0 (v0.2.x), breaking changes are possible, and DPF's agents are all internal today. MCP is already the platform's lingua franca. Adding A2A later is a translation layer, not a rewrite.

### 11.4 Queue Scoping: Per-Agent + Per-Value-Stream Metrics

**Decision:** Queues are per-team (ValueStreamTeam), with each agent treated as a measurable processing queue. Metrics surface at the value stream level for throughput analysis and bottleneck detection.

**Rationale:** Treating agents as processing queues enables:

1. **Request rate measurement** — items entering an agent's personal queue per unit time
2. **Throughput measurement** — items completed per unit time
3. **Queue depth** — items waiting (leading indicator of bottlenecks)
4. **Latency** — time from queued to completed (SLA adherence)
5. **Value stream roll-up** — aggregate agent metrics by value stream for end-to-end analysis

**Queue hierarchy:**

```
Portfolio (business model)
  └── Value Stream (evaluate | explore | integrate | deploy | release | consume | operate)
       └── Team Queue (WorkQueue, scoped to ValueStreamTeam)
            └── Agent/Worker Queue (personal queue per worker, auto-created)
                 └── WorkItems (individual tasks being processed)
```

**Value stream analytics (new — add to Phase 3 UI):**

| Metric | Scope | Purpose |
|--------|-------|---------|
| Queue depth by agent | Agent | Identify overloaded agents / workers |
| Throughput by value stream | Value stream | End-to-end flow rate |
| Avg latency by effort class | Queue | SLA adherence per work type |
| Bottleneck detection | Cross-queue | Which agent/team is the constraint? |
| Routing efficiency | Router | Are items going to the right worker? (re-assignment rate) |
| Diversity utilization | Team | Are all perspectives being engaged in swarm/review-board? |

**Theory of Constraints application:** The queue system naturally exposes the constraint (bottleneck) in each value stream. When one agent's queue depth grows while others are idle, the routing policy can:
- Shift work to `workerType: "either"` roles
- Suggest team reconfiguration
- Trigger proactive scaling (spawn additional agent threads)
- Surface the bottleneck in the value stream dashboard for human decision-making

### 11.5 Physical Task Evidence: API-Ready, Mobile App Deferred

**Decision:** Design and implement the API layer for evidence collection now. Mobile app (Android/iOS) is deferred but the APIs are ready when it arrives.

**Rationale:** DPF already has API routes (`/api/v1/`) and push device registration (PushDeviceRegistration model). The evidence collection APIs can be built now and tested via web upload or API calls:

**Phase 1-2 (now):**
- Photo/document upload via existing file upload APIs
- Checklist completion via structured JSON in WorkItem.evidence
- Digital signature as base64 canvas capture (works in mobile browser)
- Time log as structured JSON

**Phase 4+ (when mobile app exists):**
- Native camera integration for photo evidence
- GPS check-in via device location APIs
- Push notification with native action buttons
- Offline queue with sync-when-connected

The API contract is the same regardless of whether the client is a web browser or a native app. Design the APIs now; the mobile app becomes a client when it's built.

---

## 12. Remaining Open Questions

1. **Notification adapter priority**: Which adapters to build first after `in_app`? Email is most universal, Slack is most common for dev teams. Suggested order: email > Slack > Teams > SMS > push.

2. **Value stream optimization automation**: How aggressive should auto-optimization be? Options range from "surface bottleneck data for humans" to "automatically rebalance routing weights." Suggested: start with visibility (dashboards), add optimization suggestions, defer auto-rebalancing until confidence is high.

3. **Inngest Connect vs HTTP Serve**: Two deployment modes for the SDK. HTTP Serve is simpler (single API route, Inngest calls your app). Connect mode uses outbound WebSocket (lower latency, no inbound HTTP needed). Connect requires Node 22.4+. Suggested: start with HTTP Serve for simplicity, evaluate Connect if latency matters.
