# MVP Backlog Cleanup & Epic Seeding — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up duplicate/stale backlog items in the live database, fix statuses, assign orphans to epics, and seed 3 new MVP-critical epics with 17 backlog items.

**Architecture:** Two-part approach: (1) a one-time cleanup script that mutates the live database to fix duplicates, statuses, and orphans, then (2) updates to `seed.ts` that add the 3 new MVP epics and fix status values so future re-seeds are correct.

**Tech Stack:** Prisma 5, PostgreSQL, TypeScript, `tsx` runner for seed scripts.

**Spec:** `docs/superpowers/specs/2026-03-14-mvp-epic-backlog-cleanup-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/src/cleanup-backlog.ts` | One-time script: delete duplicates, fix statuses, assign orphans, mark subsumed, update epic statuses |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/src/seed.ts:289-291` | Fix BI-PROD-001/002/003 statuses from `in-progress`/`open` to `done` |
| `packages/db/src/seed.ts` (new function + main call) | Add `seedMvpEpics()` function seeding EP-LLM-LIVE-001, EP-DEPLOY-001, EP-AGENT-EXEC-001 with 17 backlog items |

---

## Chunk 1: Database Cleanup Script

### Task 1: Create and Run the Cleanup Script

**Files:**
- Create: `packages/db/src/cleanup-backlog.ts`

- [ ] **Step 1: Create the cleanup script**

Create `packages/db/src/cleanup-backlog.ts`:

```typescript
import { prisma } from "./client.js";

async function main() {
  console.log("Starting backlog cleanup...");

  // 1.1 Delete 4 duplicate items
  const dupes = ["BI-REST-080", "BI-REST-081", "BI-REST-010", "BI-REST-012"];
  for (const itemId of dupes) {
    const deleted = await prisma.backlogItem.deleteMany({ where: { itemId } });
    console.log(`  Delete ${itemId}: ${deleted.count > 0 ? "removed" : "not found"}`);
  }

  // 1.2 Fix 3 statuses
  const statusFixes: Array<{ itemId: string; status: string }> = [
    { itemId: "BI-PROD-001", status: "done" },
    { itemId: "BI-PROD-002", status: "done" },
    { itemId: "BI-PROD-003", status: "done" },
  ];
  for (const fix of statusFixes) {
    const updated = await prisma.backlogItem.updateMany({
      where: { itemId: fix.itemId },
      data: { status: fix.status },
    });
    console.log(`  Fix ${fix.itemId} → ${fix.status}: ${updated.count > 0 ? "updated" : "not found"}`);
  }

  // 1.3 Assign 7 orphans to existing epics
  const portalEpic = await prisma.epic.findUnique({ where: { epicId: "EP-PORTAL-FOUND-001" } });
  const backlogEpic = await prisma.epic.findUnique({ where: { epicId: "EP-BACKLOG-FOUND-001" } });

  if (portalEpic) {
    for (const itemId of ["BI-PORT-001", "BI-PORT-002", "BI-PORT-003"]) {
      const updated = await prisma.backlogItem.updateMany({
        where: { itemId, epicId: null },
        data: { epicId: portalEpic.id },
      });
      console.log(`  Assign ${itemId} → EP-PORTAL-FOUND-001: ${updated.count > 0 ? "assigned" : "already assigned or not found"}`);
    }
  } else {
    console.log("  WARN: EP-PORTAL-FOUND-001 not found — skipping portal orphan assignment");
  }

  if (backlogEpic) {
    for (const itemId of ["BI-PORT-004", "BI-PROD-001", "BI-PROD-002", "BI-PROD-003"]) {
      const updated = await prisma.backlogItem.updateMany({
        where: { itemId, epicId: null },
        data: { epicId: backlogEpic.id },
      });
      console.log(`  Assign ${itemId} → EP-BACKLOG-FOUND-001: ${updated.count > 0 ? "assigned" : "already assigned or not found"}`);
    }
  } else {
    console.log("  WARN: EP-BACKLOG-FOUND-001 not found — skipping backlog orphan assignment");
  }

  // 1.4 Mark 2 subsumed items as done
  for (const itemId of ["BI-REST-042", "BI-REST-052"]) {
    const updated = await prisma.backlogItem.updateMany({
      where: { itemId },
      data: { status: "done" },
    });
    console.log(`  Subsume ${itemId} → done: ${updated.count > 0 ? "updated" : "not found"}`);
  }

  // 1.5 Update 2 parent epic statuses
  for (const epicId of ["EP-AI-PROVIDERS-001", "EP-AI-COWORKER-001"]) {
    const updated = await prisma.epic.updateMany({
      where: { epicId },
      data: { status: "done" },
    });
    console.log(`  Close ${epicId} → done: ${updated.count > 0 ? "updated" : "not found"}`);
  }

  // Summary
  const totalEpics = await prisma.epic.count();
  const totalItems = await prisma.backlogItem.count();
  const doneEpics = await prisma.epic.count({ where: { status: "done" } });
  const orphanItems = await prisma.backlogItem.count({ where: { epicId: null } });
  console.log(`\nCleanup complete. ${totalEpics} epics (${doneEpics} done), ${totalItems} items (${orphanItems} orphans).`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the cleanup script**

Run:
```bash
cd d:/OpenDigitalProductFactory/packages/db && npx tsx src/cleanup-backlog.ts
```

Expected output (all operations succeed or report "not found" gracefully):
```
Starting backlog cleanup...
  Delete BI-REST-080: removed
  Delete BI-REST-081: removed
  Delete BI-REST-010: removed
  Delete BI-REST-012: removed
  Fix BI-PROD-001 → done: updated
  Fix BI-PROD-002 → done: updated
  Fix BI-PROD-003 → done: updated
  Assign BI-PORT-001 → EP-PORTAL-FOUND-001: assigned
  ...
Cleanup complete. 10 epics (4 done), 39 items (0 orphans).
```

- [ ] **Step 3: Verify cleanup results**

Run:
```bash
cd d:/OpenDigitalProductFactory && node -e "
const { PrismaClient } = require('./packages/db/generated/client');
const p = new PrismaClient();
(async () => {
  const orphans = await p.backlogItem.count({ where: { epicId: null } });
  const dupes = await p.backlogItem.findMany({ where: { itemId: { in: ['BI-REST-080','BI-REST-081','BI-REST-010','BI-REST-012'] } } });
  const fixed = await p.backlogItem.findMany({ where: { itemId: { in: ['BI-PROD-001','BI-PROD-002','BI-PROD-003'] } }, select: { itemId: true, status: true } });
  const closedEpics = await p.epic.findMany({ where: { epicId: { in: ['EP-AI-PROVIDERS-001','EP-AI-COWORKER-001'] } }, select: { epicId: true, status: true } });
  console.log('Orphans:', orphans, '(expect 0)');
  console.log('Dupes remaining:', dupes.length, '(expect 0)');
  console.log('Status fixes:', JSON.stringify(fixed));
  console.log('Closed epics:', JSON.stringify(closedEpics));
  await p.\$disconnect();
})();
"
```

Expected: 0 orphans, 0 dupes, all three PROD items `done`, both epics `done`.

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/src/cleanup-backlog.ts && git commit -m "chore(db): add one-time backlog cleanup script"
```

---

## Chunk 2: Fix seed.ts Statuses

### Task 2: Update BI-PROD Statuses in seed.ts

**Files:**
- Modify: `packages/db/src/seed.ts:289-291`

- [ ] **Step 1: Fix BI-PROD-001 status**

In `packages/db/src/seed.ts`, line 289, change:
```typescript
    { itemId: "BI-PROD-001", title: "Phase 5A — Backlog CRUD in /ops",                                    status: "in-progress", priority: 1 },
```
to:
```typescript
    { itemId: "BI-PROD-001", title: "Phase 5A — Backlog CRUD in /ops",                                    status: "done",        priority: 1 },
```

- [ ] **Step 2: Fix BI-PROD-002 status**

In `packages/db/src/seed.ts`, line 290, change:
```typescript
    { itemId: "BI-PROD-002", title: "Phase 5B — DPF self-registration as managed digital product",        status: "in-progress", priority: 2 },
```
to:
```typescript
    { itemId: "BI-PROD-002", title: "Phase 5B — DPF self-registration as managed digital product",        status: "done",        priority: 2 },
```

- [ ] **Step 3: Fix BI-PROD-003 status**

In `packages/db/src/seed.ts`, line 291, change:
```typescript
    { itemId: "BI-PROD-003", title: "Phase 2B — Live Agent counts and Health metrics in portfolio panels", status: "open",        priority: 3 },
```
to:
```typescript
    { itemId: "BI-PROD-003", title: "Phase 2B — Live Agent counts and Health metrics in portfolio panels", status: "done",        priority: 3 },
```

- [ ] **Step 4: Verify no syntax errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec tsc --noEmit
```
Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 5: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/src/seed.ts && git commit -m "fix(db): update BI-PROD-001/002/003 seed statuses to done"
```

---

## Chunk 3: Seed New MVP Epics

### Task 3: Add seedMvpEpics Function to seed.ts

**Files:**
- Modify: `packages/db/src/seed.ts` (add new function before `seedDefaultAdminUser`, add call in `main`)

- [ ] **Step 1: Add the seedMvpEpics function**

In `packages/db/src/seed.ts`, add the following function before the `seedDefaultAdminUser` function (before line 560):

```typescript
async function seedMvpEpics(): Promise<void> {
  const mfgPortfolio = await prisma.portfolio.findUnique({ where: { slug: "manufacturing_and_delivery" } });
  const foundPortfolio = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!mfgPortfolio || !foundPortfolio) throw new Error("Required portfolios not seeded");

  const dpfPortal = await prisma.digitalProduct.findUnique({ where: { productId: "dpf-portal" } });
  if (!dpfPortal) throw new Error("dpf-portal digital product not seeded");

  const taxNode = await prisma.taxonomyNode.findUnique({ where: { nodeId: "manufacturing_and_delivery" } });
  if (!taxNode) throw new Error("manufacturing_and_delivery taxonomy node not seeded");

  // ── EP-LLM-LIVE-001 ──────────────────────────────────────────────────────
  const llmEpic = await prisma.epic.upsert({
    where: { epicId: "EP-LLM-LIVE-001" },
    update: {
      title: "Live LLM Conversations",
      description: "Replace canned responses in the co-worker panel with real AI inference via configured providers. Generalizes the existing profiling call infrastructure into a chat-capable inference pipeline.",
      status: "open",
    },
    create: {
      epicId: "EP-LLM-LIVE-001",
      title: "Live LLM Conversations",
      description: "Replace canned responses in the co-worker panel with real AI inference via configured providers. Generalizes the existing profiling call infrastructure into a chat-capable inference pipeline.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: llmEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: llmEpic.id, portfolioId: mfgPortfolio.id },
  });

  const llmItems = [
    { itemId: "BI-LLM-001", title: "Build callProvider generalized inference function", priority: 1, body: "Extract the private callProviderForProfiling from lib/actions/ai-providers.ts into a shared lib/ai-inference.ts module. Generalize into callProvider(providerId, modelId, messages[], systemPrompt) supporting multi-turn chat. Return { content, inputTokens, outputTokens, inferenceMs }." },
    { itemId: "BI-LLM-002", title: "Define agent system prompts for all 9 route agents", priority: 2, body: "Extend RouteAgentEntry and AgentInfo types with systemPrompt field. Add prompts to ROUTE_AGENT_MAP for each of the 9 route agents describing role, capabilities, and context awareness." },
    { itemId: "BI-LLM-003", title: "Add platform default provider and model selection", priority: 3, body: "Add platform-level default provider+model config for agent conversations. Selection UI in /platform/ai with dropdown of active providers and discovered models. rankProvidersByCost (lib/ai-profiling.ts) provides auto-selection fallback." },
    { itemId: "BI-LLM-004", title: "Replace canned responses with live inference in sendMessage", priority: 4, body: "In sendMessage server action: check for active default provider, build messages array (system prompt + last 20 thread messages + user message), call callProvider, persist response. Fall back to generateCannedResponse when no provider active. Token counts logged via TokenUsage, not stored on AgentMessage." },
    { itemId: "BI-LLM-005", title: "Wire token usage logging into inference calls", priority: 5, body: "Extract private logTokenUsage from lib/actions/ai-providers.ts to shared module. Call after every successful inference with agentId, providerId, contextKey=coworker, token counts, and computed cost." },
  ];

  for (const item of llmItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: llmEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: llmEpic.id },
    });
  }

  // ── EP-DEPLOY-001 ─────────────────────────────────────────────────────────
  const deployEpic = await prisma.epic.upsert({
    where: { epicId: "EP-DEPLOY-001" },
    update: {
      title: "Standalone Docker Deployment with Managed Ollama",
      description: "Single docker compose up brings portal + Postgres + Ollama online. Platform UI manages Docker/Ollama directly with auto-detection of host GPU/RAM and zero-config model selection.",
      status: "open",
    },
    create: {
      epicId: "EP-DEPLOY-001",
      title: "Standalone Docker Deployment with Managed Ollama",
      description: "Single docker compose up brings portal + Postgres + Ollama online. Platform UI manages Docker/Ollama directly with auto-detection of host GPU/RAM and zero-config model selection.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: deployEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: deployEpic.id, portfolioId: foundPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: deployEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: deployEpic.id, portfolioId: mfgPortfolio.id },
  });

  const deployItems = [
    { itemId: "BI-DEPLOY-001", title: "Create portal Dockerfile and Docker Compose stack", priority: 1, body: "Multi-stage Dockerfile for Next.js standalone. Compose: portal (port 3000), db (Postgres 16, volume), ollama (GPU passthrough). Auto-run Prisma migrations on startup." },
    { itemId: "BI-DEPLOY-002", title: "Build Docker API client for container management", priority: 2, body: "Server-side module talking to Docker Engine API via /var/run/docker.sock. Scoped to Ollama container: status, start/stop/restart, pull image. Auth: manage_provider_connections." },
    { itemId: "BI-DEPLOY-003", title: "Add Ollama management UI in platform", priority: 3, body: "New section in /platform/ai: Ollama container status, start/stop/restart buttons, model list, pull new model by name, delete model, real-time pull progress." },
    { itemId: "BI-DEPLOY-004", title: "Implement host capability detection and auto-model selection", priority: 4, body: "Detect GPU (NVIDIA runtime), RAM. Selection: CPU <8GB -> phi3:mini, CPU 16GB+ -> llama3:8b, GPU 8GB -> llama3:8b, GPU 16GB+ -> llama3:70b-q4. Store as platform config." },
    { itemId: "BI-DEPLOY-005", title: "Auto-pull default model and auto-configure provider on first startup", priority: 5, body: "Startup: check Ollama reachable -> check models pulled -> if none, pull auto-selected -> set Ollama provider active -> set as default for agent conversations. Zero manual config." },
    { itemId: "BI-DEPLOY-006", title: "Add health check monitoring and status indicators", priority: 6, body: "Compose health checks on all services. Portal banner when Ollama unreachable. /api/health endpoint for external monitoring." },
  ];

  for (const item of deployItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: deployEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: deployEpic.id },
    });
  }

  // ── EP-AGENT-EXEC-001 ────────────────────────────────────────────────────
  const execEpic = await prisma.epic.upsert({
    where: { epicId: "EP-AGENT-EXEC-001" },
    update: {
      title: "Agent Task Execution with HITL Governance",
      description: "Agents propose real actions (create backlog items, modify products, update EA). Humans approve before execution. Audit-logged via AuthorizationDecisionLog for regulated industry compliance.",
      status: "open",
    },
    create: {
      epicId: "EP-AGENT-EXEC-001",
      title: "Agent Task Execution with HITL Governance",
      description: "Agents propose real actions (create backlog items, modify products, update EA). Humans approve before execution. Audit-logged via AuthorizationDecisionLog for regulated industry compliance.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: execEpic.id, portfolioId: mfgPortfolio.id } },
    update: {},
    create: { epicId: execEpic.id, portfolioId: mfgPortfolio.id },
  });
  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: execEpic.id, portfolioId: foundPortfolio.id } },
    update: {},
    create: { epicId: execEpic.id, portfolioId: foundPortfolio.id },
  });

  const execItems = [
    { itemId: "BI-EXEC-001", title: "Design AgentActionProposal schema", priority: 1, body: "New Prisma migration. Model: proposalId (unique), threadId FK AgentThread, messageId FK AgentMessage, agentId, actionType enum, parameters Json, status (proposed|approved|rejected|executed|failed), proposedAt, decidedAt, decidedBy userId FK, executedAt, resultEntityId, resultError." },
    { itemId: "BI-EXEC-002", title: "Build proposal creation from agent inference", priority: 2, body: "Parse LLM tool-use responses into AgentActionProposal records. Define tool schemas: create_backlog_item, update_lifecycle, create_ea_element, etc. System prompts include available tools based on user capabilities." },
    { itemId: "BI-EXEC-003", title: "Create proposal card rendering in chat UX", priority: 3, body: "Structured content in AgentMessageBubble for messages with proposals. Card: action type label, key parameters, affected entity. Inline Approve/Reject/Edit buttons. Visual states for approved/rejected." },
    { itemId: "BI-EXEC-004", title: "Implement proposal execution engine", priority: 4, body: "On approval: map actionType + parameters to existing server actions (createBacklogItem, etc.). Execute with approving user auth context. Record executedAt, resultEntityId or resultError. Post confirmation in thread." },
    { itemId: "BI-EXEC-005", title: "Wire approval events into AuthorizationDecisionLog", priority: 5, body: "Every proposal approval/rejection writes to AuthorizationDecisionLog: actorRef (who), actionKey (what), objectRef (entity), decision, rationale. Satisfies regulated industry audit trail requirement." },
    { itemId: "BI-EXEC-006", title: "Add agent action history view in platform", priority: 6, body: "Table of AgentActionProposal records in /platform or /admin. Filter by status, agent, action type, date range. Detail view with full parameters, approval chain, execution result. Export for compliance audits." },
  ];

  for (const item of execItems) {
    await prisma.backlogItem.upsert({
      where: { itemId: item.itemId },
      update: { title: item.title, priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: execEpic.id },
      create: { itemId: item.itemId, title: item.title, status: "open", priority: item.priority, body: item.body, type: "product", digitalProductId: dpfPortal.id, taxonomyNodeId: taxNode.id, epicId: execEpic.id },
    });
  }

  console.log(`Seeded 3 MVP epics: ${llmEpic.epicId} (${llmItems.length} items), ${deployEpic.epicId} (${deployItems.length} items), ${execEpic.epicId} (${execItems.length} items)`);
}
```

- [ ] **Step 2: Add seedMvpEpics call to main function**

In `packages/db/src/seed.ts`, in the `main` function, add the call after `seedDarkThemeUsabilityEpic()` and before `seedDefaultAdminUser()`. Change from:

```typescript
  await seedDarkThemeUsabilityEpic();
  await seedDefaultAdminUser();
```

to:

```typescript
  await seedDarkThemeUsabilityEpic();
  await seedMvpEpics();
  await seedDefaultAdminUser();
```

- [ ] **Step 3: Verify no syntax errors**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm --filter @dpf/db exec tsc --noEmit
```
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
cd d:/OpenDigitalProductFactory && git add packages/db/src/seed.ts && git commit -m "feat(db): seed 3 MVP epics with 17 backlog items (LLM, Deploy, Agent Exec)"
```

---

### Task 4: Run Seed to Populate New Epics

- [ ] **Step 1: Create a standalone seed script for the new epics**

Since `seed.ts` runs the full pipeline (including steps that may fail on missing xlsx files), create a standalone script that runs only `seedMvpEpics`. Copy the `seedMvpEpics` function body from the code added in Task 3 Step 1 into a new file `packages/db/src/seed-mvp-epics.ts`:

```typescript
import { prisma } from "./client.js";

async function main() {
  // Paste the full seedMvpEpics function body here (the code from Task 3 Step 1,
  // starting from `const mfgPortfolio = ...` through the final console.log).
  // All operations are upserts — safe to run multiple times.

  // [Full function body from Task 3 Step 1 goes here — not repeated to keep DRY]

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Run it:
```bash
cd d:/OpenDigitalProductFactory/packages/db && npx tsx src/seed-mvp-epics.ts
```

Expected output:
```
Seeded 3 MVP epics: EP-LLM-LIVE-001 (5 items), EP-DEPLOY-001 (6 items), EP-AGENT-EXEC-001 (6 items)
```

- [ ] **Step 2: Verify new epics exist**

Run:
```bash
cd d:/OpenDigitalProductFactory && node -e "
const { PrismaClient } = require('./packages/db/generated/client');
const p = new PrismaClient();
(async () => {
  for (const eid of ['EP-LLM-LIVE-001', 'EP-DEPLOY-001', 'EP-AGENT-EXEC-001']) {
    const e = await p.epic.findUnique({ where: { epicId: eid }, include: { items: { select: { itemId: true } } } });
    console.log(eid + ':', e ? e.items.length + ' items' : 'NOT FOUND');
  }
  const total = await p.epic.count();
  const totalItems = await p.backlogItem.count();
  console.log('Total:', total, 'epics,', totalItems, 'items');
  await p.\$disconnect();
})();
"
```

Expected: EP-LLM-LIVE-001 (5 items), EP-DEPLOY-001 (6 items), EP-AGENT-EXEC-001 (6 items). Total: 13 epics, 56 items.

- [ ] **Step 3: Run tests to verify nothing broke**

Run:
```bash
cd d:/OpenDigitalProductFactory && pnpm test
```
Expected: All existing tests pass (seed changes are additive upserts).

---

## Chunk 4: Verification & Final Commit

### Task 5: Final Verification

- [ ] **Step 1: Verify complete epic landscape**

Run:
```bash
cd d:/OpenDigitalProductFactory && node -e "
const { PrismaClient } = require('./packages/db/generated/client');
const p = new PrismaClient();
(async () => {
  const epics = await p.epic.findMany({
    select: { epicId: true, title: true, status: true, _count: { select: { items: true } } },
    orderBy: { epicId: 'asc' }
  });
  for (const e of epics) {
    console.log(e.status.padEnd(12), e.epicId.padEnd(25), e._count.items + ' items', e.title);
  }
  const orphans = await p.backlogItem.count({ where: { epicId: null } });
  console.log('\nOrphan items:', orphans);
  await p.\$disconnect();
})();
"
```

Expected:
- 13 epics total
- 4 done (PORTAL-FOUND, BACKLOG-FOUND, AI-PROVIDERS, AI-COWORKER)
- 4 in-progress (EA-MODEL, EA-REF, GOV-FOUND, DISCOVERY)
- 3 open (LLM-LIVE, DEPLOY, AGENT-EXEC)
- 2 deferred-equivalent (UI-THEME open, UI-A11Y in-progress)
- 0 orphan items

- [ ] **Step 2: Delete one-time scripts**

```bash
cd d:/OpenDigitalProductFactory && rm packages/db/src/cleanup-backlog.ts packages/db/src/seed-mvp-epics.ts && git add -u packages/db/src/ && git commit -m "chore(db): remove one-time cleanup and seed scripts after execution"
```
