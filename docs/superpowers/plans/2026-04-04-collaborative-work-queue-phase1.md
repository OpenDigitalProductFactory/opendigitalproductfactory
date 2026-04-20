# EP-CWQ-001 Phase 1: Inngest Foundation + Queue Schema — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up Inngest as durable execution infrastructure, migrate existing background jobs to it, add the collaborative work queue Prisma schema, implement capability-match routing, and create a personal queue UI.

**Architecture:** Inngest (self-hosted Docker container + Redis) provides durable step functions beneath all queue operations. The existing AgentEventBus remains for real-time SSE; an Inngest bridge forwards durable events. WorkQueue/WorkItem/WorkItemMessage/WorkSchedule Prisma models form the queue data layer. A queue router matches WorkItems to workers via capability-match against ValueStreamTeamRole.

**Tech Stack:** Inngest SDK (MIT), Redis 7, Prisma 7.x migration, Next.js 16 App Router API routes, TypeScript, existing AgentEventBus SSE.

**Spec:** `docs/superpowers/specs/2026-04-04-collaborative-work-queue-design.md`

---

## Task 1: Add Inngest + Redis to Docker Compose

**Files:**
- Modify: `docker-compose.yml` (add `inngest` and `redis` services after existing services)
- Modify: `.env.example` (add new env vars)
- Modify: `.env` (add new env vars for local dev)

- [ ] **Step 1: Add redis service to docker-compose.yml**
  Add after the last existing service (before `volumes:` section):
  ```yaml
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
  ```
  Add `redis_data:` to the `volumes:` section.
  **NOTE:** Do NOT add `networks:` — existing services use Docker Compose default bridge. New services must join the same default network.

- [ ] **Step 2: Create Inngest init SQL script**
  Create `scripts/init-inngest-db.sql`:
  ```sql
  SELECT 'CREATE DATABASE inngest' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'inngest')\gexec
  ```
  Mount it in the postgres service:
  ```yaml
  volumes:
    - ./scripts/init-inngest-db.sql:/docker-entrypoint-initdb.d/20-create-inngest-db.sql:ro
  ```
  This creates the `inngest` database on first boot (Inngest manages its own schema within it).

- [ ] **Step 3: Add inngest service to docker-compose.yml**
  Add after `redis`:
  ```yaml
  inngest:
    image: inngest/inngest:latest
    command: "inngest start"
    ports:
      - "8288:8288"
      - "8289:8289"
    environment:
      - INNGEST_EVENT_KEY=${INNGEST_EVENT_KEY:-deadbeefcafebabe}
      - INNGEST_SIGNING_KEY=${INNGEST_SIGNING_KEY:-abcdef0123456789}
      - INNGEST_POSTGRES_URI=postgres://${POSTGRES_USER:-dpf}:${POSTGRES_PASSWORD:-dpf_dev}@postgres:5432/inngest
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
  ```
  **NOTE:** No `networks:` — joins default bridge like all other services. Password default matches existing `POSTGRES_PASSWORD:-dpf_dev`.

- [ ] **Step 3: Add env vars to .env.example**
  ```
  # Inngest (durable execution engine)
  INNGEST_EVENT_KEY=deadbeefcafebabe
  INNGEST_SIGNING_KEY=abcdef0123456789
  INNGEST_BASE_URL=http://localhost:8288
  ```

- [ ] **Step 4: Add env vars to .env**
  Same values as .env.example for local dev. Add `INNGEST_DEV=1` for dev mode (disables signature verification).

- [ ] **Step 5: Add portal dependency on inngest**
  In `docker-compose.yml`, add to the `portal` service `depends_on`:
  ```yaml
  inngest:
    condition: service_healthy
  ```
  Add to `portal` environment:
  ```yaml
  - INNGEST_BASE_URL=http://inngest:8288
  - INNGEST_EVENT_KEY=${INNGEST_EVENT_KEY:-deadbeefcafebabe}
  - INNGEST_SIGNING_KEY=${INNGEST_SIGNING_KEY:-abcdef0123456789}
  - INNGEST_DEV=${INNGEST_DEV:-0}
  ```

- [ ] **Step 6: Commit**
  Message: `feat(infra): add Inngest + Redis services to docker-compose`

---

## Task 2: Install Inngest SDK + Create Client

**Files:**
- Modify: `apps/web/package.json` (add inngest dependency)
- Create: `apps/web/lib/queue/inngest-client.ts`
- Create: `apps/web/lib/queue/functions/index.ts`
- Create: `apps/web/app/api/inngest/route.ts`

- [ ] **Step 1: Install inngest**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter web add inngest
  ```

- [ ] **Step 2: Create Inngest client with typed events**
  Create `apps/web/lib/queue/inngest-client.ts`:
  ```typescript
  import { EventSchemas, Inngest } from "inngest";

  type Events = {
    // Work queue lifecycle
    "cwq/item.created": { data: { workItemId: string; sourceType: string; urgency: string } };
    "cwq/item.completed": { data: { workItemId: string; outcome: "success" | "failed" | "cancelled"; evidence?: unknown } };
    "cwq/item.cancelled": { data: { workItemId: string; reason: string } };
    "cwq/approval.requested": { data: { workItemId: string; escalationTimeoutMinutes: number; escalationLevel?: number } };
    "cwq/approval.response": { data: { workItemId: string; decision: "approve" | "reject" | "delegate"; decidedBy: string } };

    // Migrated background jobs
    "ops/rate.recover": { data: { providerId: string; modelId: string } };
    "ops/mcp-catalog.sync": { data: { syncId: string } };
  };

  export const inngest = new Inngest({
    id: "dpf-platform",
    schemas: new EventSchemas().fromRecord<Events>(),
  });
  ```

- [ ] **Step 3: Create empty function registry**
  Create `apps/web/lib/queue/functions/index.ts`:
  ```typescript
  // Inngest function registry — all durable functions registered here
  // Functions will be added in subsequent tasks

  export const allFunctions: Parameters<typeof import("inngest/next").serve>[0]["functions"] = [];
  ```

- [ ] **Step 4: Create Inngest API route**
  Create `apps/web/app/api/inngest/route.ts`:
  ```typescript
  import { serve } from "inngest/next";
  import { inngest } from "@/lib/queue/inngest-client";
  import { allFunctions } from "@/lib/queue/functions";

  export const { GET, POST, PUT } = serve({
    client: inngest,
    functions: allFunctions,
  });
  ```

- [ ] **Step 5: Verify build compiles**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter web build
  ```
  Expected: Build succeeds with no type errors.

- [ ] **Step 6: Commit**
  Message: `feat(queue): add Inngest SDK client, API route, and function registry`

---

## Task 3: Migrate Discovery Scheduler to Inngest

**Files:**
- Create: `apps/web/lib/queue/functions/discovery-poll.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register new functions)
- Modify: `apps/web/lib/operate/discovery-scheduler.ts` (extract core logic, remove setInterval)
- Modify: `apps/web/instrumentation.ts` (remove startDiscoveryScheduler, will be Inngest cron)

- [ ] **Step 1: Extract core discovery logic**
  In `apps/web/lib/operate/discovery-scheduler.ts`, ensure `runPrometheusTargetCheck()` and `runFullDiscoverySweep()` are exported standalone functions that do not depend on timers or in-memory state. The `sweepInProgress` guard is replaced by Inngest `concurrency: { limit: 1 }`. The `knownTargetKeys` Set should be moved to database state or removed (Inngest replays don't preserve in-memory state between cron runs).

- [ ] **Step 2: Create Inngest cron functions**
  Create `apps/web/lib/queue/functions/discovery-poll.ts`:
  ```typescript
  import { inngest } from "../inngest-client";
  import { runPrometheusTargetCheck, runFullDiscoverySweep, recordJobRun } from "@/lib/operate/discovery-scheduler";

  export const prometheusPoll = inngest.createFunction(
    { id: "ops/prometheus-poll", retries: 2 },
    { cron: "* * * * *" },
    async ({ step }) => {
      await step.run("poll-targets", async () => {
        await runPrometheusTargetCheck();
      });
      await step.run("record-job", async () => {
        await recordJobRun("discovery-prometheus-poll", "ok");
      });
    }
  );

  export const fullDiscoverySweep = inngest.createFunction(
    {
      id: "ops/full-discovery-sweep",
      retries: 2,
      concurrency: { limit: 1, scope: "fn" },
    },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
      await step.run("run-sweep", async () => {
        await runFullDiscoverySweep();
      });
      await step.run("record-job", async () => {
        await recordJobRun("discovery-full-sweep", "ok");
      });
    }
  );
  ```

- [ ] **Step 3: Register functions**
  Update `apps/web/lib/queue/functions/index.ts`:
  ```typescript
  import { prometheusPoll, fullDiscoverySweep } from "./discovery-poll";

  export const allFunctions = [prometheusPoll, fullDiscoverySweep];
  ```

- [ ] **Step 4: Remove setInterval from discovery-scheduler.ts**
  Remove `startDiscoveryScheduler()` timer logic (the `setInterval` calls and `prometheusTimer`/`sweepTimer` variables). Keep the exported functions (`runPrometheusTargetCheck`, `runFullDiscoverySweep`, `recordJobRun`) as library functions. Remove `stopDiscoveryScheduler()`.

- [ ] **Step 5: Update instrumentation.ts**
  Remove `startDiscoveryScheduler()` call. The `register()` function can remain minimal — Inngest cron functions are registered via the API route, not via instrumentation.

- [ ] **Step 6: Verify build compiles**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter web build
  ```

- [ ] **Step 7: Commit**
  Message: `refactor(ops): migrate discovery scheduler from setInterval to Inngest cron`

---

## Task 4: Migrate Infra Prune + Rate Recovery to Inngest

**Files:**
- Create: `apps/web/lib/queue/functions/infra-prune.ts`
- Create: `apps/web/lib/queue/functions/rate-recovery.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register)
- Modify: `apps/web/lib/actions/infra-prune.ts` (remove fire-and-forget void pattern)
- Modify: `apps/web/lib/routing/rate-recovery.ts` (replace setTimeout with inngest.send)

- [ ] **Step 1: Create Inngest infra-prune function**
  Create `apps/web/lib/queue/functions/infra-prune.ts`:
  ```typescript
  import { inngest } from "../inngest-client";
  import { pruneStaleInfraCIs } from "@/lib/actions/infra-prune";

  export const infraPrune = inngest.createFunction(
    { id: "ops/infra-prune", retries: 2 },
    { cron: "0 3 * * 0" },
    async ({ step }) => {
      const results = await step.run("prune-stale", async () => {
        return pruneStaleInfraCIs();
      });
      await step.run("record-job", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.scheduledJob.update({
          where: { jobId: "infra-ci-prune" },
          data: { lastRunAt: new Date(), lastStatus: "ok", lastError: null, nextRunAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        });
      });
    }
  );
  ```

- [ ] **Step 2: Create Inngest rate-recovery function**
  Create `apps/web/lib/queue/functions/rate-recovery.ts`:
  ```typescript
  import { inngest } from "../inngest-client";

  export const rateRecovery = inngest.createFunction(
    {
      id: "ops/rate-recovery",
      retries: 1,
      idempotency: "event.data.providerId + '-' + event.data.modelId",
    },
    { event: "ops/rate.recover" },
    async ({ event, step }) => {
      await step.sleep("recovery-delay", "60s");
      await step.run("restore-provider", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.modelProfile.updateMany({
          where: { providerId: event.data.providerId, modelId: event.data.modelId, modelStatus: "degraded" },
          data: { modelStatus: "active" },
        });
      });
    }
  );
  ```

- [ ] **Step 3: Update rate-recovery.ts to use inngest.send()**
  In `apps/web/lib/routing/rate-recovery.ts`, replace `setTimeout` + in-memory `Map<string, NodeJS.Timeout>` with:
  ```typescript
  import { inngest } from "@/lib/queue/inngest-client";

  export function scheduleRecovery(providerId: string, modelId: string): void {
    void inngest.send({
      name: "ops/rate.recover",
      data: { providerId, modelId },
    });
  }
  ```
  Remove the `recoveryTimers` Map and `clearTimeout` logic.

- [ ] **Step 4: Update infra-prune.ts to remove fire-and-forget**
  In `apps/web/lib/actions/infra-prune.ts`, remove the `void pruneStaleInfraCIs(...).then(...).catch(...)` pattern from `runInfraPruneIfDue()`. The Inngest cron now handles scheduling. Keep `pruneStaleInfraCIs()` as the exported core function. `runInfraPruneNow()` (manual trigger) can send an Inngest event instead.

- [ ] **Step 5: Register functions**
  Update `apps/web/lib/queue/functions/index.ts` to include `infraPrune` and `rateRecovery`.

- [ ] **Step 6: Verify build compiles**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter web build
  ```

- [ ] **Step 7: Update existing test files**
  Update `apps/web/lib/routing/rate-recovery.test.ts` (if exists) to test the new `scheduleRecovery()` that calls `inngest.send()` instead of `setTimeout`. Mock `inngest.send` and verify the event payload.

- [ ] **Step 8: Commit**
  Message: `refactor(ops): migrate infra-prune and rate-recovery to Inngest durable functions`

---

## Task 5: Migrate MCP Catalog Sync to Inngest

**Files:**
- Create: `apps/web/lib/queue/functions/mcp-catalog-sync.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register)
- Modify: `apps/web/lib/actions/mcp-catalog.ts` (replace fire-and-forget with inngest.send)

- [ ] **Step 1: Create Inngest mcp-catalog-sync function**
  Create `apps/web/lib/queue/functions/mcp-catalog-sync.ts`:
  ```typescript
  import { inngest } from "../inngest-client";

  export const mcpCatalogSync = inngest.createFunction(
    {
      id: "ops/mcp-catalog-sync",
      retries: 2,
      concurrency: { limit: 1, scope: "fn" },
    },
    { event: "ops/mcp-catalog.sync" },
    async ({ event, step }) => {
      await step.run("run-sync", async () => {
        const { runMcpCatalogSync } = await import("@/lib/tak/mcp-catalog-sync");
        await runMcpCatalogSync(event.data.syncId);
      });
      await step.run("record-job", async () => {
        const { prisma } = await import("@dpf/db");
        await prisma.scheduledJob.update({
          where: { jobId: "mcp-catalog-sync" },
          data: { lastRunAt: new Date(), lastStatus: "ok", lastError: null },
        });
      });
    }
  );
  ```

- [ ] **Step 2: Update mcp-catalog.ts**
  In `apps/web/lib/actions/mcp-catalog.ts`, replace the fire-and-forget `void runMcpCatalogSync(sync.id).then(...).catch(...)` with:
  ```typescript
  import { inngest } from "@/lib/queue/inngest-client";
  await inngest.send({ name: "ops/mcp-catalog.sync", data: { syncId: sync.id } });
  ```

- [ ] **Step 3: Register in function index**
  Add `mcpCatalogSync` to `apps/web/lib/queue/functions/index.ts`.

- [ ] **Step 4: Commit**
  Message: `refactor(ops): migrate MCP catalog sync to Inngest durable function`

---

## Task 6: Add AgentEventBus Queue Event Types + Inngest Bridge

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts` (add queue event types to AgentEvent union)
- Create: `apps/web/lib/queue/inngest-bridge.ts`
- Modify: `apps/web/instrumentation.ts` (start bridge on boot)

- [ ] **Step 1: Add queue event types to AgentEvent union**
  In `apps/web/lib/tak/agent-event-bus.ts`, add to the `AgentEvent` type union (after the last existing `|` entry):
  ```typescript
  | { type: "queue:item_created"; workItemId: string; sourceType: string; urgency: string }
  | { type: "queue:item_assigned"; workItemId: string; workerType: string; workerId: string }
  | { type: "queue:item_claimed"; workItemId: string; workerType: string; workerId: string }
  | { type: "queue:item_status_changed"; workItemId: string; fromStatus: string; toStatus: string }
  | { type: "queue:item_completed"; workItemId: string; outcome: "success" | "failed" | "cancelled" }
  | { type: "queue:escalation"; workItemId: string; fromWorker: string; toWorker: string; reason: string }
  | { type: "queue:sla_warning"; workItemId: string; minutesRemaining: number }
  | { type: "queue:message"; workItemId: string; messageType: string; senderId: string }
  ```

- [ ] **Step 2: Create Inngest bridge**
  Create `apps/web/lib/queue/inngest-bridge.ts`:
  ```typescript
  import { agentEventBus, type AgentEvent } from "@/lib/tak/agent-event-bus";
  import { inngest } from "./inngest-client";

  export function startInngestBridge(): void {
    // Forward durable queue events from event bus to Inngest
    // This is a global subscriber (threadId = "__inngest_bridge__")
    // It listens to all threads and forwards queue-relevant events
  }

  export function emitQueueProgress(threadId: string, event: AgentEvent): void {
    agentEventBus.emit(threadId, event);
  }
  ```
  Note: The bridge subscribes using a sentinel threadId. The actual implementation depends on whether the event bus supports wildcard subscriptions. If not, the bridge is called directly from queue server actions (not via event bus subscription).

- [ ] **Step 3: Update instrumentation.ts**
  Add bridge startup:
  ```typescript
  export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
      const { startInngestBridge } = await import("@/lib/queue/inngest-bridge");
      startInngestBridge();
    }
  }
  ```

- [ ] **Step 4: Verify build compiles**

- [ ] **Step 5: Commit**
  Message: `feat(queue): add queue event types to AgentEventBus and create Inngest bridge`

---

## Task 7: Add Queue Prisma Schema + Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add WorkQueue, WorkItem, WorkItemMessage, WorkSchedule)
- Create: new migration via `prisma migrate dev`

- [ ] **Step 1: Add WorkQueue model**
  Add after the existing ValueStreamHitlGate model (around line 4910):
  ```prisma
  // ---- Collaborative Work Queue (EP-CWQ-001) ----

  model WorkQueue {
    id                String          @id @default(cuid())
    queueId           String          @unique @default(cuid())
    name              String
    queueType         String          // team | personal | triage | escalation
    teamId            String?
    team              ValueStreamTeam? @relation(fields: [teamId], references: [id])
    routingPolicy     Json
    slaMinutes        Json?
    isActive          Boolean         @default(true)
    portfolioId       String?
    portfolio         Portfolio?      @relation(fields: [portfolioId], references: [id])
    digitalProductId  String?
    digitalProduct    DigitalProduct? @relation(fields: [digitalProductId], references: [id])
    items             WorkItem[]
    createdAt         DateTime        @default(now())
    updatedAt         DateTime        @updatedAt

    @@index([teamId])
    @@index([portfolioId])
    @@index([queueType, isActive])
  }
  ```

- [ ] **Step 2: Add WorkItem model**
  ```prisma
  model WorkItem {
    id                String          @id @default(cuid())
    itemId            String          @unique @default(cuid())
    sourceType        String
    sourceId          String?
    title             String
    description       String          @db.Text
    urgency           String          @default("routine")
    effortClass       String          @default("medium")
    workerConstraint  Json
    teamId            String?
    team              ValueStreamTeam? @relation(fields: [teamId], references: [id])
    queueId           String
    queue             WorkQueue       @relation(fields: [queueId], references: [id])
    status            String          @default("queued")
    assignedToType    String?
    assignedToUserId  String?
    assignedToUser    User?           @relation("WorkItemAssignee", fields: [assignedToUserId], references: [id])
    assignedToAgentId String?
    assignedToAgent   Agent?          @relation("WorkItemAgent", fields: [assignedToAgentId], references: [id])
    assignedThreadId  String?
    claimedAt         DateTime?
    dueAt             DateTime?
    calendarEventId   String?
    calendarEvent     CalendarEvent?  @relation(fields: [calendarEventId], references: [id])
    evidence          Json?
    parentItemId      String?
    parentItem        WorkItem?       @relation("WorkItemHierarchy", fields: [parentItemId], references: [id])
    childItems        WorkItem[]      @relation("WorkItemHierarchy")
    a2aTaskId         String?
    messages          WorkItemMessage[]
    routingDecision   Json?
    completedAt       DateTime?
    createdAt         DateTime        @default(now())
    updatedAt         DateTime        @updatedAt

    @@index([queueId, status])
    @@index([assignedToUserId, status])
    @@index([assignedToAgentId, status])
    @@index([teamId, status])
    @@index([parentItemId])
    @@index([sourceType, sourceId])
    @@index([urgency, status])
    @@index([dueAt])
  }
  ```

  **IMPORTANT:** The relation name on Agent must be `"WorkItemAgent"` (not `"WorkItemAssignee"`) to avoid collision with the User relation name. Verify that User model does not already have a relation named `"WorkItemAssignee"` — it should not since this is a new model. Add the reverse relation to User and Agent models:
  - On User: `workItemAssignments WorkItem[] @relation("WorkItemAssignee")`
  - On Agent: `workItemAssignments WorkItem[] @relation("WorkItemAgent")`

- [ ] **Step 3: Add WorkItemMessage model**
  ```prisma
  model WorkItemMessage {
    id                String     @id @default(cuid())
    messageId         String     @unique @default(cuid())
    workItemId        String
    workItem          WorkItem   @relation(fields: [workItemId], references: [id], onDelete: Cascade)
    senderType        String
    senderUserId      String?
    senderAgentId     String?
    messageType       String
    body              String     @db.Text
    structuredPayload Json?
    channel           String     @default("in-app")
    deliveredAt       DateTime?
    readAt            DateTime?
    respondedAt       DateTime?
    response          Json?
    createdAt         DateTime   @default(now())

    @@index([workItemId, createdAt])
    @@index([senderUserId])
  }
  ```

- [ ] **Step 4: Add WorkSchedule model**
  ```prisma
  model WorkSchedule {
    id                String     @id @default(cuid())
    workerType        String
    userId            String?    @unique
    user              User?      @relation(fields: [userId], references: [id])
    agentId           String?    @unique
    agent             Agent?     @relation("WorkScheduleAgent", fields: [agentId], references: [id])
    timezone          String     @default("UTC")
    workingHours      Json
    maxConcurrent     Int        @default(5)
    autoAccept        Boolean    @default(false)
    notificationPrefs Json?
    createdAt         DateTime   @default(now())
    updatedAt         DateTime   @updatedAt
  }
  ```

  Add reverse relations:
  - On User: `workSchedule WorkSchedule?`
  - On Agent: `workSchedule WorkSchedule? @relation("WorkScheduleAgent")`

- [ ] **Step 5: Add reverse relations to ValueStreamTeam**
  ValueStreamTeam now has two new relations (WorkQueue and WorkItem). Add:
  ```prisma
  queues WorkQueue[]
  workItems WorkItem[]
  ```

- [ ] **Step 6: Add reverse relation to CalendarEvent**
  CalendarEvent gets a new optional relation:
  ```prisma
  workItems WorkItem[]
  ```

- [ ] **Step 7: Add ALL reverse relations to existing models (REQUIRED before migration)**
  These must be added before running the migration or Prisma will error on unpaired relations:
  - **User model**: Add `workItemAssignments WorkItem[] @relation("WorkItemAssignee")` and `workSchedule WorkSchedule?`
  - **Agent model**: Add `workItemAssignments WorkItem[] @relation("WorkItemAgent")` and `workSchedule WorkSchedule? @relation("WorkScheduleAgent")`
  - **ValueStreamTeam model**: Add `queues WorkQueue[]` and `workItems WorkItem[]`
  - **CalendarEvent model**: Add `workItems WorkItem[]`
  - **Portfolio model**: Add `workQueues WorkQueue[]`
  - **DigitalProduct model**: Add `workQueues WorkQueue[]`

- [ ] **Step 8: Run migration**
  ```bash
  cd h:\opendigitalproductfactory
  pnpm --filter @dpf/db exec prisma migrate dev --name add-collaborative-work-queue
  ```

- [ ] **Step 8: Verify migration succeeds and Prisma client generates**

- [ ] **Step 9: Commit**
  Message: `feat(db): add WorkQueue, WorkItem, WorkItemMessage, WorkSchedule schema (EP-CWQ-001)`

---

## Task 8: Queue Types + Constants

**Files:**
- Create: `apps/web/lib/queue/queue-types.ts`

- [ ] **Step 1: Create canonical types and constants**
  Create `apps/web/lib/queue/queue-types.ts`:
  ```typescript
  // EP-CWQ-001: Canonical string enums (CLAUDE.md compliance)

  export const QUEUE_TYPES = ["team", "personal", "triage", "escalation"] as const;
  export type QueueType = (typeof QUEUE_TYPES)[number];

  export const WORK_ITEM_SOURCE_TYPES = ["task-node", "backlog-item", "approval", "manual-task", "scheduled"] as const;
  export type WorkItemSourceType = (typeof WORK_ITEM_SOURCE_TYPES)[number];

  export const WORK_ITEM_URGENCIES = ["routine", "priority", "urgent", "emergency"] as const;
  export type WorkItemUrgency = (typeof WORK_ITEM_URGENCIES)[number];

  export const WORK_ITEM_EFFORT_CLASSES = ["instant", "short", "medium", "long", "physical"] as const;
  export type WorkItemEffortClass = (typeof WORK_ITEM_EFFORT_CLASSES)[number];

  export const WORK_ITEM_STATUSES = [
    "queued", "assigned", "in-progress", "awaiting-input", "awaiting-approval",
    "completed", "failed", "cancelled", "escalated", "deferred",
  ] as const;
  export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

  export const WORK_ITEM_MESSAGE_TYPES = ["comment", "question", "approval-request", "status-update", "escalation", "handoff"] as const;
  export type WorkItemMessageType = (typeof WORK_ITEM_MESSAGE_TYPES)[number];

  export const NOTIFICATION_CHANNELS = ["in-app", "email", "slack", "sms", "push"] as const;
  export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

  export const WORKER_TYPES = ["human", "ai-agent"] as const;
  export type WorkerType = (typeof WORKER_TYPES)[number];

  export interface WorkerConstraint {
    workerType: "human" | "ai-agent" | "either" | "team";
    requiredCapabilities?: string[];
    requiredRole?: string;
    requiredAgentId?: string;
    excludeWorkers?: string[];
    preferredWorkerIds?: string[];
    sensitivityLevel?: "public" | "internal" | "confidential" | "restricted";
  }

  export interface RoutingPolicy {
    mode: "auto" | "manual" | "round-robin" | "capability-match" | "load-balanced";
    considerAvailability: boolean;
    considerPerformance: boolean;
    maxConcurrentPerWorker: number;
    autoEscalateAfterMinutes?: number;
    escalationQueueId?: string;
  }

  export interface RoutingDecision {
    teamId?: string;
    candidateCount: number;
    selectedWorkerId: string;
    selectedWorkerType: WorkerType;
    score: number;
    reason: string;
    timestamp: string;
  }
  ```

- [ ] **Step 2: Commit**
  Message: `feat(queue): add canonical queue types and constants (CLAUDE.md enum compliance)`

---

## Task 9: Queue Router (Capability-Match)

**Files:**
- Create: `apps/web/lib/queue/queue-router.ts`

- [ ] **Step 1: Create queue router**
  Create `apps/web/lib/queue/queue-router.ts`:
  ```typescript
  import { prisma } from "@dpf/db";
  import type { WorkerConstraint, RoutingDecision } from "./queue-types";

  interface RouteResult {
    assigned: boolean;
    workerId?: string;
    workerType?: "human" | "ai-agent";
    decision: RoutingDecision;
  }

  export async function routeWorkItem(
    workItemId: string,
    workerConstraint: WorkerConstraint,
    teamId?: string,
  ): Promise<RouteResult> {
    // 1. Resolve team
    const team = teamId
      ? await prisma.valueStreamTeam.findUnique({
          where: { id: teamId },
          include: { roles: { include: { agent: true } } },
        })
      : null;

    if (!team) {
      return {
        assigned: false,
        decision: { candidateCount: 0, selectedWorkerId: "", selectedWorkerType: "human", score: 0, reason: "no-team-found", timestamp: new Date().toISOString() },
      };
    }

    // 2. Filter eligible workers by capability match
    const eligible = team.roles.filter((role) => {
      if (workerConstraint.workerType !== "either" && workerConstraint.workerType !== "team") {
        if (role.workerType !== workerConstraint.workerType && role.workerType !== "either") return false;
      }
      if (workerConstraint.requiredCapabilities?.length) {
        const hasAll = workerConstraint.requiredCapabilities.every((cap) => role.grantScope.includes(cap));
        if (!hasAll) return false;
      }
      if (workerConstraint.requiredRole && role.humanRoleId !== workerConstraint.requiredRole) return false;
      if (workerConstraint.requiredAgentId && role.agentId !== workerConstraint.requiredAgentId) return false;
      return true;
    });

    if (eligible.length === 0) {
      return {
        assigned: false,
        decision: { candidateCount: 0, selectedWorkerId: "", selectedWorkerType: "human", score: 0, reason: "no-eligible-workers", timestamp: new Date().toISOString() },
      };
    }

    // 3. Score candidates (capability-match mode)
    const scored = eligible.map((role) => {
      let score = 0;
      const capMatch = workerConstraint.requiredCapabilities?.filter((c) => role.grantScope.includes(c)).length ?? 0;
      score += capMatch * 3;
      if (workerConstraint.preferredWorkerIds?.includes(role.agentId ?? role.humanRoleId ?? "")) score += 10;
      score += (100 - role.priority); // lower priority number = higher score
      return { role, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];

    // 4. Assign
    const workerType = best.role.workerType === "either"
      ? (best.role.agentId ? "ai-agent" : "human")
      : best.role.workerType as "human" | "ai-agent";

    const workerId = workerType === "ai-agent" ? best.role.agentId! : best.role.humanRoleId!;

    await prisma.workItem.update({
      where: { itemId: workItemId },
      data: {
        status: "assigned",
        assignedToType: workerType,
        assignedToAgentId: workerType === "ai-agent" ? best.role.agentId : null,
        claimedAt: new Date(),
        routingDecision: {
          teamId: team.id,
          candidateCount: eligible.length,
          selectedWorkerId: workerId,
          selectedWorkerType: workerType,
          score: best.score,
          reason: "capability-match",
          timestamp: new Date().toISOString(),
        },
      },
    });

    return {
      assigned: true,
      workerId,
      workerType,
      decision: {
        teamId: team.id,
        candidateCount: eligible.length,
        selectedWorkerId: workerId,
        selectedWorkerType: workerType,
        score: best.score,
        reason: "capability-match",
        timestamp: new Date().toISOString(),
      },
    };
  }
  ```

- [ ] **Step 2: Commit**
  Message: `feat(queue): implement capability-match queue router`

---

## Task 10: Queue Server Actions (CRUD)

**Files:**
- Create: `apps/web/lib/actions/work-queue.ts`

- [ ] **Step 1: Create queue server actions**
  Create `apps/web/lib/actions/work-queue.ts` with:
  - `createWorkQueue(data)` — creates a WorkQueue
  - `createWorkItem(data)` — creates a WorkItem and sends `cwq/item.created` Inngest event
  - `claimWorkItem(itemId, userId)` — human claims an item from queue
  - `completeWorkItem(itemId, evidence)` — marks complete, sends `cwq/item.completed` event
  - `getMyQueue(userId)` — returns user's assigned and claimable items
  - `getTriageQueue()` — returns unassigned items

  All functions follow the `"use server"` + auth check pattern from existing actions (see `apps/web/lib/actions/backlog.ts`).

- [ ] **Step 2: Commit**
  Message: `feat(queue): add work queue server actions (create, claim, complete, list)`

---

## Task 11: Wire Inngest Route Function to Router

**Files:**
- Create: `apps/web/lib/queue/functions/route-work-item.ts`
- Modify: `apps/web/lib/queue/functions/index.ts` (register)

- [ ] **Step 1: Create route-work-item Inngest function**
  Create `apps/web/lib/queue/functions/route-work-item.ts` that:
  - Triggers on `cwq/item.created`
  - Step 1: reads WorkItem from DB
  - Step 2: calls `routeWorkItem()` from queue-router.ts
  - Step 3: if assigned, emits `queue:item_assigned` to event bus for SSE
  - Step 4: waits for `cwq/item.completed` with SLA timeout
  - Step 5: on timeout, updates status to `escalated`

- [ ] **Step 2: Register in function index**

- [ ] **Step 3: Verify build**

- [ ] **Step 4: Commit**
  Message: `feat(queue): wire Inngest route-work-item function to capability-match router`

---

## Task 12: TaskNode -> WorkItem Bridge

**Files:**
- Create: `apps/web/lib/queue/bridges/task-node-bridge.ts`

- [ ] **Step 1: Create bridge function**
  When a TaskNode transitions to `awaiting_human`, create a WorkItem:
  ```typescript
  export async function bridgeTaskNodeToWorkItem(taskNodeId: string): Promise<string> {
    const node = await prisma.taskNode.findUniqueOrThrow({ where: { taskNodeId }, include: { taskRun: true } });

    // Find or create triage queue
    const triageQueue = await prisma.workQueue.upsert({
      where: { queueId: "triage-default" },
      create: { queueId: "triage-default", name: "Triage", queueType: "triage", routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 } },
      update: {},
    });

    const item = await prisma.workItem.create({
      data: {
        sourceType: "task-node",
        sourceId: taskNodeId,
        title: node.title,
        description: node.objective,
        urgency: "routine",
        effortClass: "short",
        workerConstraint: { workerType: "human" },
        queueId: triageQueue.id,
        status: "queued",
      },
    });

    // Fire Inngest event
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({ name: "cwq/item.created", data: { workItemId: item.itemId, sourceType: "task-node", urgency: "routine" } });

    return item.itemId;
  }
  ```

- [ ] **Step 2: Commit**
  Message: `feat(queue): add TaskNode -> WorkItem bridge for awaiting_human transitions`

---

## Task 13: BacklogItem -> WorkItem Bridge

**Files:**
- Create: `apps/web/lib/queue/bridges/backlog-bridge.ts`

- [ ] **Step 1: Create bridge function**
  When a BacklogItem is claimed (claimedById or claimedByAgentId set), optionally create a WorkItem for tracking:
  ```typescript
  export async function bridgeBacklogItemToWorkItem(backlogItemId: string, urgency: string = "routine"): Promise<string> {
    const item = await prisma.backlogItem.findUniqueOrThrow({ where: { itemId: backlogItemId } });

    const triageQueue = await prisma.workQueue.upsert({
      where: { queueId: "triage-default" },
      create: { queueId: "triage-default", name: "Triage", queueType: "triage", routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 } },
      update: {},
    });

    const workItem = await prisma.workItem.create({
      data: {
        sourceType: "backlog-item",
        sourceId: backlogItemId,
        title: item.title,
        description: item.body ?? item.title,
        urgency,
        effortClass: "medium",
        workerConstraint: { workerType: "either" },
        queueId: triageQueue.id,
        status: "queued",
      },
    });

    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({ name: "cwq/item.created", data: { workItemId: workItem.itemId, sourceType: "backlog-item", urgency } });

    return workItem.itemId;
  }
  ```

- [ ] **Step 2: Commit**
  Message: `feat(queue): add BacklogItem -> WorkItem bridge`

---

## Task 14: Extend Notifications for Queue Events

**Files:**
- Create: `apps/web/lib/queue/notification-adapter.ts`
- Modify: `apps/web/lib/actions/work-queue.ts` (add notification calls)

- [ ] **Step 1: Create notification adapter interface and in-app implementation**
  Create `apps/web/lib/queue/notification-adapter.ts`:
  ```typescript
  import { prisma } from "@dpf/db";

  export interface QueueNotification {
    recipientUserId: string;
    workItemId: string;
    title: string;
    body: string;
    urgency: string;
    deepLink?: string;
  }

  export interface NotificationAdapter {
    channel: string;
    send(notification: QueueNotification): Promise<void>;
  }

  // Built-in in-app adapter — uses existing Notification model
  export const inAppAdapter: NotificationAdapter = {
    channel: "in-app",
    async send(notification) {
      await prisma.notification.create({
        data: {
          userId: notification.recipientUserId,
          type: "work_queue",
          title: notification.title,
          body: notification.body,
          deepLink: notification.deepLink ?? `/workspace/my-queue`,
          read: false,
        },
      });
    },
  };

  // Registry of all active adapters
  const adapters: NotificationAdapter[] = [inAppAdapter];

  export function registerAdapter(adapter: NotificationAdapter): void {
    adapters.push(adapter);
  }

  export async function sendQueueNotification(notification: QueueNotification): Promise<void> {
    await Promise.allSettled(adapters.map((a) => a.send(notification)));
  }
  ```

- [ ] **Step 2: Commit**
  Message: `feat(queue): add pluggable notification adapter with in-app implementation`

---

## Task 15: Personal Queue API Routes

**Files:**
- Create: `apps/web/app/api/v1/work-queue/route.ts` (list queues)
- Create: `apps/web/app/api/v1/work-queue/my-items/route.ts` (personal queue)
- Create: `apps/web/app/api/v1/work-queue/[itemId]/claim/route.ts` (claim item)
- Create: `apps/web/app/api/v1/work-queue/[itemId]/complete/route.ts` (complete item)

- [ ] **Step 1: Create personal queue endpoint**
  `GET /api/v1/work-queue/my-items` — returns items assigned to the authenticated user, grouped by urgency.

- [ ] **Step 2: Create claim endpoint**
  `POST /api/v1/work-queue/[itemId]/claim` — claims an unassigned item for the authenticated user.

- [ ] **Step 3: Create complete endpoint**
  `POST /api/v1/work-queue/[itemId]/complete` — marks item as completed with optional evidence JSON body.

- [ ] **Step 4: Commit**
  Message: `feat(queue): add personal queue API routes (list, claim, complete)`

---

## Task 16: Personal Queue UI Page

**Files:**
- Create: `apps/web/app/(shell)/workspace/my-queue/page.tsx`

- [ ] **Step 1: Create personal queue page**
  Server component that:
  - Fetches user's assigned work items via `getMyQueue()` server action
  - Groups by urgency (emergency at top)
  - Shows: title, effort class badge, due date, source context link
  - Action buttons: Claim (for unassigned), Complete, Defer
  - Uses existing Tailwind patterns from the codebase

  This is Level 0-1 progressive disclosure — simple list, not Kanban. Kanban comes in Phase 3.

- [ ] **Step 2: Add navigation link**
  Add "My Queue" to the workspace sidebar navigation (find the existing nav config).

- [ ] **Step 3: Commit**
  Message: `feat(queue): add personal queue UI page (Level 0-1 progressive disclosure)`

---

## Task 17: Seed Data for Default Queues

**Files:**
- Modify: `packages/db/prisma/seed.ts` or equivalent seed script

- [ ] **Step 1: Add default queue seed data**
  Create the triage queue and a sample team queue:
  ```typescript
  await prisma.workQueue.upsert({
    where: { queueId: "triage-default" },
    create: {
      queueId: "triage-default",
      name: "Triage",
      queueType: "triage",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });

  await prisma.workQueue.upsert({
    where: { queueId: "escalation-default" },
    create: {
      queueId: "escalation-default",
      name: "Escalation",
      queueType: "escalation",
      routingPolicy: { mode: "manual", considerAvailability: false, considerPerformance: false, maxConcurrentPerWorker: 10 },
      isActive: true,
    },
    update: {},
  });
  ```

- [ ] **Step 2: Commit**
  Message: `feat(db): add default triage and escalation queue seed data`

---

## Task 18: Build Verification + Integration Smoke Test

- [ ] **Step 1: Full build**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter web build
  ```
  Expected: No type errors, no missing imports.

- [ ] **Step 2: Prisma generate**
  ```bash
  cd h:\opendigitalproductfactory && pnpm --filter @dpf/db exec prisma generate
  ```
  Expected: Client generates with new models.

- [ ] **Step 3: Verify Inngest function count**
  Start dev server, navigate to `http://localhost:8288` (Inngest dashboard). Verify all registered functions appear:
  - `ops/prometheus-poll` (cron)
  - `ops/full-discovery-sweep` (cron)
  - `ops/infra-prune` (cron)
  - `ops/rate-recovery` (event)
  - `cwq/route-work-item` (event)

- [ ] **Step 4: Final commit**
  Message: `chore: verify EP-CWQ-001 Phase 1 build and integration`
