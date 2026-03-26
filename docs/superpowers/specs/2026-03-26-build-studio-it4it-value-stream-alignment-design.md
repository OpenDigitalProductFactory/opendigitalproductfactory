# Build Studio IT4IT Value Stream Alignment — Multi-User, Release Bundling, Calendar Integration

**Status:** Draft (2026-03-26)
**Predecessor:** EP-SELF-DEV-003 (Sandbox Execution & DB Isolation), EP-CHG-MGMT (Change & Deployment Management), EP-CODEGEN-001 (Robust Sandbox Coding), Promotion Pipeline & Change Window Design (2026-03-25)
**IT4IT Alignment:** §5.3 Integrate, §5.4 Deploy, §5.5 Release Value Streams
**DPPM Reference:** G252 §5 IT4IT Reference Architecture Context

## Problem Statement

The Build Studio operates as an isolated feature-building tool that bypasses the IT4IT value streams established as the platform's foundational architecture. This violates the core design principle documented in the earliest specs (2026-03-10 portfolio route, 2026-03-13 EA reference model assessment) and the DPPM guide (G252).

### Architectural Disconnect

The platform has three IT4IT value stream orchestrators and nine specialist agents defined for the build-to-release flow, but **none of them participate in Build Studio operations**:

| IT4IT Stage | Agent | Role | Currently Used? |
|---|---|---|---|
| §5.3 Integrate | AGT-ORCH-300 (integrate-orchestrator) | Build coordination, release planning, SBOM, release acceptance | No |
| §5.3.2 | AGT-130 (release-planning-agent) | Plans development activities, multi-team scheduling (MUST-0031) | No |
| §5.3.3 | AGT-131 (sbom-management-agent) | SBOM composition, dependency validation (MUST-0022/0023) | No |
| §5.3.5 | AGT-132 (release-acceptance-agent) | Release Gate Package, Tier 0 gate checks (MUST-0033/0034) | No |
| §5.4 Deploy | AGT-ORCH-400 (deploy-orchestrator) | Deployment automation, rollback coordination | No |
| §5.4.2 | AGT-140 (deployment-planning-agent) | Deployment schedule, rollback plan (SHOULD-0028), approval (MUST-0036) | No |
| §5.4.3 | AGT-141 (resource-reservation-agent) | Resource reservation, Orders for dependent services (MUST-0037/0038) | No |
| §5.4.3 | AGT-142 (iac-execution-agent) | IaC pipeline execution, change_event nodes, status updates | No |
| §5.5 Release | AGT-ORCH-500 (release-orchestrator) | Service offer catalog, subscription lifecycle | No |

Instead, the Build Studio's "ship" phase calls `register_digital_product_from_build` and `create_build_epic` directly — a flat function call that skips the Integrate, Deploy, and Release value streams entirely.

### Five Gaps

**Gap 1: Single sandbox, no concurrency**
One persistent container (`dpf-sandbox-1`) with a shared `/workspace` volume. Two simultaneous builds corrupt each other's workspace. No queue, no pool.

**Gap 2: No release bundling**
Each build creates one ChangePromotion. No concept of grouping multiple completed features into a single release for coordinated deployment. This contradicts IT4IT §5.3.5 (Accept & Publish Release) which defines a Release Package as an aggregate of build units.

**Gap 3: AI coworker doesn't schedule deployments**
The coworker has no tools to query deployment windows, schedule promotions, or create release bundles. The ship phase claims the feature is "live" (now corrected to "registered") but doesn't interact with the calendar or change management system.

**Gap 4: Calendar not integrated with builds**
`FeatureBuild` has no `calendarEventId`. Builds don't appear on the common calendar alongside hours of operation and deployment windows. The `ChangeRequest` model has a `calendarEventId` and `deploymentWindowId`, but these are never populated from the Build Studio flow.

**Gap 5: IT4IT agents not orchestrating**
The Integrate, Deploy, and Release orchestrators (AGT-ORCH-300/400/500) exist in the agent registry but are never invoked. The Build Studio uses a single "build-architect" persona for everything, bypassing the value stream agent hierarchy.

### What Already Exists

**IT4IT Foundation (established 2026-03-10 through 2026-03-14):**
- Four portfolios mapped to IT4IT §6.x in `portfolio_registry.json`
- 43 agents mapped to seven IT4IT value streams in `agent_registry.json`
- Neo4j labels `:S2P`, `:R2D`, `:R2F`, `:D2C` on DigitalProduct nodes
- EA reference model assessment framework with IT4IT as first seeded model
- IT4IT Functional Criteria Taxonomy imported from `IT4IT_Functional_Criteria_Taxonomy.xlsx`
- ArchiMate 4 value stream elements (strategy layer)

**Change Management (established 2026-03-21):**
- RFC lifecycle: draft → submitted → assessed → approved → scheduled → in-progress → completed
- DeploymentWindow with day-of-week, time ranges, allowed change types and risk levels
- BlackoutPeriod with exceptions for emergency changes
- BusinessProfile with operating hours feeding low-traffic window derivation
- CalendarEvent integration for RFC scheduling
- StandardChangeCatalog for pre-approved change templates

**Promotion Pipeline (established 2026-03-25):**
- `executePromotion()` end-to-end pipeline with window enforcement
- Destructive operation blocking with acknowledgment gate
- Post-deployment health check with auto-rollback
- Deploy Now button in PromotionsClient UI

---

## Design

### Section 1: Sandbox Pool (EP-SANDBOX-POOL)

Replace the single persistent sandbox with a pool of N workspace-isolated sandbox instances.

**Architecture:**

```
docker-compose.yml defines:
  sandbox-1:  volume: sandbox_ws_1:/workspace, port: 3036
  sandbox-2:  volume: sandbox_ws_2:/workspace, port: 3037
  sandbox-3:  volume: sandbox_ws_3:/workspace, port: 3038
  (configurable via DPF_SANDBOX_POOL_SIZE env, default: 3)
```

**New module: `apps/web/lib/sandbox-pool.ts`**

```typescript
type SandboxSlot = {
  containerId: string;
  port: number;
  status: "available" | "in_use" | "initializing";
  buildId: string | null;
  userId: string | null;
  acquiredAt: Date | null;
};

async function acquireSandbox(buildId: string, userId: string): Promise<SandboxSlot>
async function releaseSandbox(buildId: string): Promise<void>
async function getSlotForBuild(buildId: string): Promise<SandboxSlot | null>
```

- `acquireSandbox()` finds the first available slot, marks it `in_use`, returns connection details
- `releaseSandbox()` marks the slot `available` and cleans the workspace
- `getSlotForBuild()` returns the slot currently assigned to a build (for tools to find the right container)
- Pool state tracked in a `SandboxSlot` Prisma table (not in-memory — survives container restarts)

**Impact on existing code:**
- `build-pipeline.ts` `stepCreateSandbox()` calls `acquireSandbox()` instead of hardcoding `dpf-sandbox-1`
- `mcp-tools.ts` sandbox tools call `getSlotForBuild()` to find the correct container
- `PERSISTENT_SANDBOX` / `PERSISTENT_PORT` constants replaced with pool lookups
- `sandbox-workspace.ts` `copySourceAndBaseline()` copies into the assigned slot's volume

**Schema addition:**
```prisma
model SandboxSlot {
  id          String    @id @default(cuid())
  slotIndex   Int       @unique
  containerId String
  port        Int
  status      String    @default("available")  // available | in_use | initializing
  buildId     String?   @unique                 // one build per slot
  userId      String?
  acquiredAt  DateTime?
  releasedAt  DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([status])
}
```

### Section 2: Release Bundling (IT4IT §5.3.5 Accept & Publish Release)

A Release Bundle groups multiple completed builds for coordinated deployment during a single change window.

**IT4IT mapping:**
- Release Bundle = **Release Package** (IT4IT §5.3.5)
- Individual builds = **Build Units** (IT4IT §5.3.3)
- Release acceptance = **Release Gate** (IT4IT MUST-0033/0034)

**Schema addition:**
```prisma
model ReleaseBundleBundle {
  id            String    @id @default(cuid())
  bundleId      String    @unique         // e.g., "RB-2026-03-26-001"
  title         String
  status        String    @default("assembling")  // assembling | gate_check | approved | scheduled | deployed | rolled_back
  createdBy     String
  builds        FeatureBuild[]            // Many-to-one: builds belong to a bundle
  promotionId   String?   @unique
  promotion     ChangePromotion?
  rfcId         String?
  calendarEventId String?
  deploymentWindowId String?
  scheduledAt   DateTime?
  deployedAt    DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  @@index([status])
}
```

**Add to FeatureBuild:**
```prisma
model FeatureBuild {
  // ... existing fields ...
  releaseBundleId   String?
  releaseBundle     ReleaseBundle? @relation(fields: [releaseBundleId], references: [id])
}
```

**Bundle lifecycle (aligned to IT4IT):**
```
assembling → gate_check → approved → scheduled → deployed
                                                    ↓
                                               rolled_back
```

1. **Assembling** — Users add completed builds to the bundle. Each build must be in `review` or `complete` phase.
2. **Gate check** (§5.3.5) — Release acceptance agent (AGT-132) validates the combined diff: runs tests, scans destructive ops, checks conflicts between builds.
3. **Approved** — All gate checks pass. The bundle gets a combined ChangePromotion + RFC.
4. **Scheduled** — Deployment planning agent (AGT-140) schedules the bundle into a deployment window. CalendarEvent created.
5. **Deployed** — IaC execution agent (AGT-142) or `executePromotion()` applies the combined patch.

### Section 3: Coworker Scheduling Tools

New tools for the AI coworker to manage the build-to-deploy lifecycle conversationally:

| Tool | IT4IT Stage | Purpose |
|---|---|---|
| `check_deployment_windows` | §5.4.2 | Query available windows for a given change type and risk level |
| `schedule_promotion` | §5.4.2 | Schedule a promotion or release bundle into a deployment window |
| `create_release_bundle` | §5.3.5 | Group completed builds into a release bundle |
| `add_build_to_bundle` | §5.3.5 | Add a completed build to an existing bundle |
| `run_release_gate` | §5.3.5 | Trigger gate checks on a release bundle |
| `get_release_status` | §5.3/5.4 | Query the current status of a release bundle or promotion |

**Conversational flow:**
```
User: "We've finished the complaints feature and the booking module. Can we deploy them together?"
Coworker: [calls create_release_bundle with both build IDs]
         → "I've created Release Bundle RB-2026-03-26-001 with both features.
            Running gate checks now..."
         [calls run_release_gate]
         → "Gate checks pass — 47 tests, 0 type errors, no destructive migrations.
            Next deployment window is tonight 10pm-6am. Want me to schedule it?"
User: "Yes, schedule for tonight"
Coworker: [calls schedule_promotion]
         → "Scheduled for tonight at 10pm. I've added it to the operations calendar.
            The ops team will see the Deploy Now button during the window."
```

### Section 4: Calendar Integration

Link builds and releases to the common calendar system that meshes with hours of operation.

**What goes on the calendar:**

| Event Type | Source | Visibility |
|---|---|---|
| Operating hours | BusinessProfile | Team |
| Deployment windows | DeploymentWindow | Team |
| Blackout periods | BlackoutPeriod | Team |
| Scheduled promotions | ChangeRequest.calendarEventId | Team |
| **Build milestones** (new) | FeatureBuild phase transitions | Creator + team |
| **Release bundles** (new) | ReleaseBundle.calendarEventId | Team |

**FeatureBuild additions:**
```prisma
model FeatureBuild {
  // ... existing fields ...
  calendarEventId  String?    // Links to CalendarEvent for milestone visibility
}
```

**Calendar event creation points:**
- When a build enters `build` phase: "Building: {title}" event (estimated duration)
- When a build enters `review` phase: "Review: {title}" event
- When a release bundle is scheduled: "Deployment: {bundle title}" event during the deployment window

### Section 5: Value Stream Agent Orchestration

The Build Studio phases should delegate to the IT4IT value stream agents at the appropriate stages, rather than doing everything with the generic "build-architect" coworker.

**Phase-to-agent mapping:**

| Build Phase | IT4IT Value Stream | Agent(s) Invoked | Purpose |
|---|---|---|---|
| ideate | §5.1 Evaluate | explore-orchestrator (AGT-ORCH-200) | Product lifecycle, backlog |
| plan | §5.2 Explore | explore-orchestrator (AGT-ORCH-200) | Architecture definition |
| build | §5.3 Integrate | integrate-orchestrator (AGT-ORCH-300) | Build coordination |
| review | §5.3.5 Accept | release-acceptance-agent (AGT-132) | Release gate checks |
| ship | §5.4 Deploy + §5.5 Release | deploy-orchestrator (AGT-ORCH-400), release-orchestrator (AGT-ORCH-500) | Deployment planning, catalog publication |

**Implementation approach:**
- The unified coworker remains the user's primary interface
- Behind the scenes, phase transitions invoke the value stream agents as sub-tasks via the agentic loop
- Agent tool grants and capabilities are already defined in `agent_registry.json` — they just need to be wired in
- The `prompt-assembler.ts` injects the appropriate value stream context based on the build phase

This is a longer-term alignment. For the immediate implementation, the coworker tools (Section 3) provide the conversational scheduling capability. The full agent orchestration is a future enhancement.

---

## Implementation Priority

### Phase A: Immediate (unblocks multi-user + scheduling)

| Item | Spec Section | Priority |
|---|---|---|
| Sandbox pool (3 slots) | Section 1 | Critical — current single sandbox blocks all multi-user use |
| Coworker scheduling tools | Section 3 | High — enables AI-driven deployment scheduling |
| Calendar integration for builds | Section 4 | High — meshes builds with hours of operation |

### Phase B: Release management (enables coordinated deployment)

| Item | Spec Section | Priority |
|---|---|---|
| Release bundle model + lifecycle | Section 2 | High — groups features for coordinated deployment |
| Release gate checks | Section 2 | High — validates combined diff before deployment |
| Bundle scheduling via calendar | Section 2 + 4 | Medium — calendar visibility for scheduled releases |

### Phase C: IT4IT agent orchestration (full value stream alignment)

| Item | Spec Section | Priority |
|---|---|---|
| Phase-to-agent delegation | Section 5 | Medium — connects build phases to IT4IT agents |
| Integrate orchestrator (AGT-ORCH-300) | Section 5 | Medium — build coordination |
| Deploy orchestrator (AGT-ORCH-400) | Section 5 | Medium — deployment automation |
| Release orchestrator (AGT-ORCH-500) | Section 5 | Lower — catalog publication |

---

## IT4IT Compliance Mapping

| IT4IT Requirement | Spec Section | Status |
|---|---|---|
| MUST-0031: Multi-team scheduling | Section 1 (pool) + Section 3 (tools) | Designed |
| MUST-0033: Release Gate Package | Section 2 (gate_check) | Designed |
| MUST-0034: Tier 0 gate checks | Section 2 (gate_check) | Designed |
| MUST-0036: Deployment approval package | Promotion Pipeline spec (2026-03-25) | Implemented |
| MUST-0037: Resource reservation | Section 1 (sandbox pool) | Designed |
| SHOULD-0028: Rollback plan | Promotion Pipeline spec (2026-03-25) | Implemented |

---

## Acceptance Criteria

1. Multiple users can build features concurrently without workspace corruption (sandbox pool)
2. Completed builds can be grouped into a release bundle
3. Release bundles go through gate checks (combined tests, destructive scan) before approval
4. AI coworker can query deployment windows and schedule promotions conversationally
5. Builds and scheduled releases appear on the common calendar
6. Calendar meshes with operating hours and deployment windows
7. The ship phase delegates to the change management system, not direct deployment
8. IT4IT value stream agents are referenced in the design (even if Phase C is deferred)

---

## Why This Matters

The platform's foundational architecture (established 2026-03-10 through 2026-03-14) is built on IT4IT v3.0.1 with DPPM alignment. The four portfolios, seven value streams, 43 agents, and EA reference model assessment framework all assume that **work flows through value streams, not bypasses them**. The Build Studio's current shortcut — a flat function call from "ship" directly to "deployed" — undermines the entire governance model. This spec reconnects the Build Studio to the value stream architecture so that the platform practices what it preaches.
