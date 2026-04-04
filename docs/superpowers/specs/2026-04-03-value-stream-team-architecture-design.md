# Value Stream Team Architecture — Design Spec

| Field | Value |
|-------|-------|
| **Epic** | EP-VST-001 |
| **IT4IT Alignment** | Cross-cutting: all value streams (SS5.1 Evaluate through SS5.7 Operate) |
| **Status** | Draft |
| **Created** | 2026-04-03 |
| **Author** | Claude (Software Architect) + Mark Bodman (CEO) |
| **Dependencies** | EP-BUILD-ORCHESTRATOR (build process orchestrator), EP-TAK-PATTERNS (agentic architecture patterns), EP-BUILD-HANDOFF-002 (phase handoff & human authority), EP-WORKFORCE-CONSOLIDATION (AI workforce consolidation), CSDM 6 Digital Product Meta-Model, HR Workforce Core, Build Studio IT4IT Value Stream Alignment |
| **Design Motto** | "Model it, then run it" |

---

## 1. Problem Statement

The Digital Product Factory has organically grown several powerful but disconnected capabilities:

1. **Build Studio teams** — A specialist dispatch pattern (data-architect, software-engineer, frontend-engineer, qa-engineer) that works well but is hard-coded to one value stream (Integrate) and one phase (build).
2. **IT4IT value stream alignment** — `BUILD_PHASE_IT4IT` maps build phases to IT4IT sections, but only as metadata injected into agent prompts. The mapping doesn't drive behavior.
3. **Enterprise Architecture** — ArchiMate 4 notation with 49 element types (including 6 DPF extensions), canvas rendering, and Neo4j projection. But EA diagrams are drawn *after* the platform acts — they describe, they don't prescribe.
4. **Workforce management** — EmployeeProfile, Agent, Team, and BusinessModelRoleAssignment exist but aren't connected to value stream execution.
5. **Task graph orchestration** — TaskRun/TaskNode provides a DAG execution model, but it's not tied to EA-modeled processes.

The result: the platform *has* teams, *has* processes, *has* an EA model, and *has* human-in-the-loop gates — but these are implemented as separate systems rather than facets of one cohesive architecture.

### What We Want

A unified model where:
- **Value streams are modeled** in the EA tool using ArchiMate (structure) and BPMN 2.0 (process)
- **Teams are configured** from those models — which agents, which humans, what coordination pattern
- **Runtime execution** follows the modeled process — the model is the source of truth
- **The EA model self-updates** from runtime telemetry — actual execution feeds back into the model
- **Humans and AI coworkers** are visible in the same process diagrams, with clear handoff points

This is the path from **retroactive documentation** → **reflective visibility** → **Model-Based Systems Engineering (MBSE)** where the model drives the runtime.

---

## 2. Notation Architecture

### 2.1 Why We Need More Than ArchiMate

ArchiMate excels at **structural modeling** — what exists, what depends on what, which capabilities serve which goals. But it deliberately omits **behavioral detail**: it shows that a BusinessProcess exists, not how it flows step-by-step with decisions, parallelism, and exception paths.

For team dynamics and process orchestration, we need:

| Concern | ArchiMate | BPMN 2.0 | Together |
|---------|-----------|-----------|----------|
| "What teams exist?" | BusinessCollaboration, BusinessRole | Pool, Lane | ArchiMate defines the team; BPMN shows who does what |
| "What's the workflow?" | BusinessProcess (black box) | Process with Activities, Gateways, Events | ArchiMate names it; BPMN details it |
| "Where are the decisions?" | Not modeled | ExclusiveGateway, InclusiveGateway | BPMN makes decision logic explicit |
| "Where do humans intervene?" | BusinessActor | UserTask, ManualTask | BPMN distinguishes automated vs human tasks |
| "What runs in parallel?" | Not modeled | ParallelGateway, subprocess | BPMN shows fork/join patterns |
| "What triggers the process?" | BusinessEvent (abstract) | StartEvent, IntermediateEvent, EndEvent | BPMN types events precisely |

### 2.2 BPMN 2.0 as a First-Class Notation

The platform's EA notation system is already multi-notation by design. `EaNotation`, `EaElementType`, `EaRelationshipType`, and `EaRelationshipRule` are all scoped by `notationId`. Adding BPMN 2.0 requires **zero schema changes** — only seed data and renderers.

**New notation: `bpmn20`**

#### Element Types (organized by BPMN category)

**Flow Objects (core behavioral elements):**

| Slug | Domain | Neo Label | BPMN Semantic | DPF Runtime Mapping |
|------|--------|-----------|---------------|---------------------|
| `bpmn_process` | process | `BPMN__Process` | Top-level process container | ValueStreamTeam configuration |
| `bpmn_sub_process` | process | `BPMN__SubProcess` | Collapsible sub-process | Nested orchestrator scope |
| `bpmn_task` | process | `BPMN__Task` | Generic task (abstract) | TaskNode (execute) |
| `bpmn_user_task` | process | `BPMN__UserTask` | Human-performed task | TaskNode (awaiting_human) |
| `bpmn_service_task` | process | `BPMN__ServiceTask` | Automated/system task | Specialist agent dispatch |
| `bpmn_send_task` | process | `BPMN__SendTask` | Send message | Event bus emission |
| `bpmn_receive_task` | process | `BPMN__ReceiveTask` | Wait for message | Event bus subscription |
| `bpmn_script_task` | process | `BPMN__ScriptTask` | Inline script execution | run_sandbox_command |
| `bpmn_business_rule_task` | process | `BPMN__BusinessRuleTask` | Decision table evaluation | Gate check / DQ rule evaluation |
| `bpmn_manual_task` | process | `BPMN__ManualTask` | Off-platform human action | Approval request with notification |
| `bpmn_call_activity` | process | `BPMN__CallActivity` | Invokes another process | Cross-value-stream delegation |

**Events:**

| Slug | Domain | Neo Label | BPMN Semantic | DPF Runtime Mapping |
|------|--------|-----------|---------------|---------------------|
| `bpmn_start_event` | event | `BPMN__StartEvent` | Process initiation | TaskRun creation |
| `bpmn_end_event` | event | `BPMN__EndEvent` | Process completion | TaskRun completion |
| `bpmn_intermediate_throw_event` | event | `BPMN__IntermediateThrowEvent` | Emit signal mid-process | Agent event bus emit |
| `bpmn_intermediate_catch_event` | event | `BPMN__IntermediateCatchEvent` | Wait for signal mid-process | Event bus subscription with timeout |
| `bpmn_boundary_event` | event | `BPMN__BoundaryEvent` | Attached to task — error/timer/signal | Specialist retry / timeout handler |
| `bpmn_timer_event` | event | `BPMN__TimerEvent` | Time-based trigger | Deployment window / calendar check |
| `bpmn_error_event` | event | `BPMN__ErrorEvent` | Error handling | Escalation path activation |
| `bpmn_signal_event` | event | `BPMN__SignalEvent` | Broadcast signal | Cross-build event (e.g., dependency ready) |
| `bpmn_message_event` | event | `BPMN__MessageEvent` | Point-to-point message | PhaseHandoff document delivery |

**Gateways:**

| Slug | Domain | Neo Label | BPMN Semantic | DPF Runtime Mapping |
|------|--------|-----------|---------------|---------------------|
| `bpmn_exclusive_gateway` | gateway | `BPMN__ExclusiveGateway` | XOR — one path chosen | Conditional phase routing |
| `bpmn_parallel_gateway` | gateway | `BPMN__ParallelGateway` | AND — all paths execute | Specialist parallel dispatch |
| `bpmn_inclusive_gateway` | gateway | `BPMN__InclusiveGateway` | OR — one or more paths | Optional specialist inclusion |
| `bpmn_event_based_gateway` | gateway | `BPMN__EventBasedGateway` | Wait for first event | Race condition (timeout vs approval) |
| `bpmn_complex_gateway` | gateway | `BPMN__ComplexGateway` | Custom merge condition | Review board consensus |

**Participants & Swimlanes:**

| Slug | Domain | Neo Label | BPMN Semantic | DPF Runtime Mapping |
|------|--------|-----------|---------------|---------------------|
| `bpmn_pool` | participant | `BPMN__Pool` | Participant (org/system) | Value stream boundary |
| `bpmn_lane` | participant | `BPMN__Lane` | Role within participant | Agent role or human role |

> **Note:** BPMN message flow is a connecting object (edge), not a flow object (node). It is modeled as the `message_flow` relationship type in the Relationship Types table below, not as an element type.

**Data:**

| Slug | Domain | Neo Label | BPMN Semantic | DPF Runtime Mapping |
|------|--------|-----------|---------------|---------------------|
| `bpmn_data_object` | data | `BPMN__DataObject` | Data input/output | PhaseHandoff / evidence artifact |
| `bpmn_data_store` | data | `BPMN__DataStore` | Persistent data reference | Prisma model / Qdrant collection |
| `bpmn_data_input` | data | `BPMN__DataInput` | Process input | Build brief / user request |
| `bpmn_data_output` | data | `BPMN__DataOutput` | Process output | Build artifact / release bundle |

#### Relationship Types

| Slug | BPMN Semantic | Directionality |
|------|---------------|----------------|
| `sequence_flow` | Ordered execution flow between flow objects | Source → Target |
| `message_flow` | Communication between pools | Source → Target |
| `association` | Link between artifact and flow object | Bidirectional |
| `data_association` | Data flow to/from activity | Source → Target |
| `default_flow` | Default path from gateway | Source → Target |
| `conditional_flow` | Condition-guarded path from gateway | Source → Target |

#### Renderer Hints (new React components)

| Hint | Applies To | Visual Treatment |
|------|-----------|-----------------|
| `bpmn_horizontal_flow` | bpmn_process | Left-to-right flow layout with swimlanes |
| `bpmn_swimlane` | bpmn_pool, bpmn_lane | Horizontal band container with label |
| `bpmn_rounded_rect` | bpmn_*_task | Rounded rectangle with task-type icon |
| `bpmn_diamond` | bpmn_*_gateway | Diamond with gateway-type marker (X, +, O) |
| `bpmn_circle` | bpmn_*_event | Circle (thin=start, double=intermediate, thick=end) |
| `bpmn_subprocess_container` | bpmn_sub_process | Rounded rect with [+] collapse indicator |
| `bpmn_data_page` | bpmn_data_object | Folded-corner page icon |

### 2.3 On BPEL: Execution Semantics Without a BPEL Engine

BPEL (Business Process Execution Language) provided XML-based executable process definitions. BPMN 2.0 absorbed BPEL's execution semantics while keeping visual modeling. Rather than implementing a separate BPEL engine, DPF takes this approach:

| BPEL Concept | BPMN 2.0 Equivalent | DPF Implementation |
|---|---|---|
| `<sequence>` | Sequence flow between tasks | TaskNode dependency chain |
| `<flow>` | Parallel gateway fork/join | `Promise.all()` specialist dispatch |
| `<switch>/<case>` | Exclusive gateway with conditions | Phase gate conditional routing |
| `<pick>/<onMessage>` | Event-based gateway | Agent event bus subscription race |
| `<invoke>` | Service task | Agent specialist dispatch |
| `<receive>/<reply>` | Receive/Send tasks | PhaseHandoff document exchange |
| `<assign>/<copy>` | Data association | Build context accumulation (priorResultsSummary) |
| `<throw>/<catch>` | Error boundary event | Specialist retry / escalation handler |
| `<compensate>` | Compensation event | Rollback strategy execution |
| `<while>/<repeatUntil>` | Loop marker on task/subprocess | Agentic loop iteration with repetition limits |
| `<wait>` | Timer intermediate event | Deployment window scheduling |

The platform's orchestrator + agentic loop + event bus collectively serve as the process execution engine. The BPMN model defines *what* to execute; the orchestrator determines *how*.

### 2.4 Cross-Notation Linking: ArchiMate <-> BPMN

A single concept often appears in both notations. ArchiMate provides the structural context; BPMN provides the behavioral detail. These must be linked, not duplicated.

**Mechanism: `EaRelationship` with cross-notation `relationshipTypeId`**

New cross-notation relationship types. Since `EaRelationshipType` requires a `notationId` (`@@unique([notationId, slug])`), cross-notation types are registered under a dedicated `dpf-cross-notation` pseudo-notation that exists solely to own relationships spanning multiple notations:

| Slug | Semantic | Example |
|------|----------|---------|
| `details` | BPMN element provides behavioral detail for ArchiMate element | `bpmn_process` details `business_process` |
| `performs` | BPMN lane identifies the performer of an ArchiMate function | `bpmn_lane` performs `business_function` |
| `realizes_process` | ArchiMate application component realizes a BPMN service task | `application_component` realizes_process `bpmn_service_task` |

**Canonical cross-notation mappings:**

| ArchiMate Element | BPMN Element | Relationship | Semantic |
|---|---|---|---|
| `business_process` | `bpmn_process` | details | BPMN process is the behavioral specification of the ArchiMate process |
| `business_function` | `bpmn_service_task` / `bpmn_user_task` | details | BPMN task is how the function executes |
| `business_actor` | `bpmn_lane` | performs | The actor works within this lane |
| `business_role` | `bpmn_lane` | performs | The role is assigned to this lane |
| `business_event` | `bpmn_start_event` / `bpmn_end_event` | details | BPMN event is the typed version |
| `business_collaboration` | `bpmn_pool` | details | The collaboration manifests as this pool |
| `ai_coworker` (extension) | `bpmn_lane` | performs | AI coworker operates in this swimlane |
| `application_component` | `bpmn_service_task` | realizes_process | Component implements the automated task |

**Viewpoint: "Process Architecture"** — A new viewpoint that shows both ArchiMate structural elements and their linked BPMN behavioral details side by side.

---

## 3. Value Stream Team Model

### 3.1 Core Abstraction: ValueStreamTeam

The `ValueStreamTeam` generalizes what Build Studio does today for the build phase into a reusable pattern for any value stream.

```
ValueStreamTeam
├── teamId: string (unique)
├── name: string
├── valueStream: IT4IT value stream (evaluate | explore | integrate | deploy | release | consume | operate)
├── teamPattern: TeamPattern
│   ├── "specialist-dispatch"  — Orchestrator assigns tasks to specialists by role (current Build Studio)
│   ├── "review-board"         — All roles evaluate, consensus or majority required
│   ├── "pair"                 — One AI + one human collaborate on same task
│   ├── "swarm"                — Multiple agents work same problem from different perspectives (Diversity of Thought)
│   └── "pipeline"             — Sequential handoff, each role transforms output for next
├── roles: TeamRole[]
├── coordinationPattern: CoordinationPattern
├── hitlGates: HitlGateConfig[]
├── eaProcessId?: string — Link to BPMN process element that defines this team's workflow
└── eaViewId?: string — Link to EA view that visualizes this team's process
```

### 3.2 TeamRole

```
TeamRole
├── roleId: string (unique within team)
├── roleName: string (e.g., "data-architect", "security-reviewer", "product-owner")
├── workerType: "ai-agent" | "human" | "either"
│   — "either" means the role can be filled by human or AI depending on availability/preference
├── agentId?: string — Reference to Agent record (when workerType is "ai-agent" or "either")
├── humanRoleId?: string — Reference to PlatformRole (when workerType is "human" or "either")
├── perspective?: string — Diversity of Thought: how this role frames problems (optional for human roles)
├── heuristics?: string — Diversity of Thought: strategies for finding solutions
├── interpretiveModel?: string — Diversity of Thought: what "good" means to this role
├── priority: number — Execution order (lower = earlier, same = parallel)
├── grantScope: string[] — Which AgentToolGrant keys this role receives (resolved to tool names at dispatch)
├── modelTier: "frontier" | "strong" | "adequate" | "basic" — AI model tier requirement
├── bpmnLaneId?: string — Link to BPMN lane element representing this role
└── maxRetries: number — How many times to retry before escalation (default: 2)
```

### 3.3 CoordinationPattern

```
CoordinationPattern
├── phaseSequential: boolean — Roles execute in priority order (true for specialist-dispatch)
├── parallelWithinPhase: boolean — Same-priority roles run concurrently
├── fileOverlapSplitting: boolean — Split conflicting tasks into sequential sub-phases
├── contextAccumulation: "append" | "merge" | "replace"
│   — "append": each phase's results added to priorResultsSummary (current behavior)
│   — "merge": results combined by topic/area
│   — "replace": each phase only sees its immediate predecessor's output
├── consensusMode?: "majority" | "unanimous" | "any" — For review-board pattern
├── diversityMode?: "independent" | "debate" | "build-on"
│   — "independent": each role works alone, results compared (current swarm behavior)
│   — "debate": roles see each other's output and critique
│   — "build-on": each role refines the previous role's output
└── failurePolicy: "halt-phase" | "skip-and-continue" | "escalate-immediately"
```

### 3.4 HitlGateConfig

```
HitlGateConfig
├── gateId: string
├── triggerPoint: "phase-transition" | "before-tool" | "after-evaluation" | "on-error"
├── condition?: string — JSON expression evaluating context (e.g., "riskLevel == 'high'")
├── requiredRole: string — PlatformRole that must approve (e.g., "HR-500", "HR-000")
├── escalationTimeoutMinutes: number
├── escalationPath: string[] — Ordered list of roles to try if primary doesn't respond
├── channels: ("in-app" | "slack" | "email" | "sms")[]
├── emergencyBypass: boolean — If true, all channels fire simultaneously
└── bpmnGatewayId?: string — Link to BPMN gateway element representing this gate
```

### 3.5 Team Patterns Applied Across Value Streams

| Value Stream | Team Pattern | AI Roles | Human Roles | Coordination |
|---|---|---|---|---|
| **Explore** (ideate/plan) | pair | Design coworker (AGT-ORCH-200) | Product owner | Sequential: AI proposes → human reviews |
| **Integrate** (build) | specialist-dispatch | Data Architect, Software Engineer, Frontend Engineer, QA Engineer | Reviewer (gate) | Phase-sequential with parallel within phase |
| **Integrate** (review) | review-board | QA agent, Security agent | Technical lead | Independent evaluation, majority consensus |
| **Deploy** | pipeline | Deploy planner (AGT-140), Security scanner | Deployment authority (HR-500) | Sequential: plan → scan → approve → execute |
| **Release** | pair | Release coordinator (AGT-ORCH-500) | Business owner | AI prepares → human approves offer |
| **Operate** | swarm | Monitoring agent, Incident classifier, Root-cause analyzer | On-call engineer | Independent analysis → human decides |
| **Consume** | pair | Knowledge writer, Documentation specialist | SME reviewer | AI drafts → human validates accuracy |

---

## 4. Three-Stage Evolution

### Stage 1: Reflective — "The Portal Knows What It's Doing"

**Goal**: Make existing runtime behavior automatically visible in the EA model.

**Mechanism**: The agent event bus already emits structured events (`orchestrator:task_dispatched`, `orchestrator:task_complete`, `phase:change`, etc.). A new **runtime-to-EA projector** listens and creates EaElement + EaRelationship records.

**Event-to-EA mapping:**

| Agent Event | EaElement Created | Properties |
|---|---|---|
| `orchestrator:build_started` (existing) | `bpmn_process` (instance) | buildId, taskCount, specialists |
| `orchestrator:task_dispatched` (existing) | `bpmn_service_task` (instance) | specialist role, task title |
| `orchestrator:task_complete` (existing) | Update task element status | outcome, retries |
| `phase:change` (existing) | `bpmn_intermediate_throw_event` | fromPhase, toPhase |
| `approval:granted` (**new** — must add to AgentEvent union) | `bpmn_user_task` (instance) | approver, decision, timestamp |
| `orchestrator:specialist_retry` (existing) | `bpmn_boundary_event` (error) | reason, attempt number |

**How it works:**
1. Event bus emits event (existing, no change)
2. New listener `runtime-ea-projector.ts` catches the event
3. Creates/updates EaElement and EaRelationship records linked to a runtime EA view
4. Existing Neo4j sync picks up new records (existing pipeline)
5. EA canvas shows runtime execution as a BPMN-style process diagram

**What changes in the codebase:**
- New file: `apps/web/lib/ea/runtime-ea-projector.ts`
- Modified: `apps/web/lib/tak/agent-event-bus.ts` — add `approval:granted` event type to `AgentEvent` union; register projector as listener
- New EA view type: `layoutType: "runtime-process"` (auto-generated, not manually drawn)

**Value**: Architects and operators can see *what actually happened* in EA notation. No manual drawing. The model stays current because it's generated from runtime telemetry.

### Stage 2: Configurable — "Teams Are Modeled, Not Hard-Coded"

**Goal**: Replace hard-coded specialist lists with `ValueStreamTeam` configurations stored in the database.

**Schema additions:**

```prisma
model ValueStreamTeam {
  id                  String    @id @default(cuid())
  name                String
  valueStream         String    // IT4IT value stream slug
  teamPattern         String    // specialist-dispatch | review-board | pair | swarm | pipeline
  coordinationPattern Json      // CoordinationPattern structure
  eaProcessId         String?   // Link to EaElement (bpmn_process)
  eaViewId            String?   // Link to EaView
  portfolioId         String?
  portfolio           Portfolio? @relation(fields: [portfolioId], references: [id])
  roles               ValueStreamTeamRole[]
  hitlGates           ValueStreamHitlGate[]
  isActive            Boolean   @default(true)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt

  @@index([portfolioId])
  @@index([valueStream])
}

model ValueStreamTeamRole {
  id               String    @id @default(cuid())
  teamId           String
  team             ValueStreamTeam @relation(fields: [teamId], references: [id])
  roleName         String
  workerType       String    // ai-agent | human | either
  agentId          String?   // References Agent.id (cuid PK), not Agent.agentId (business key)
  agent            Agent?    @relation(fields: [agentId], references: [id])
  humanRoleId      String?   // PlatformRole reference
  perspective      String?   // Diversity of Thought
  heuristics       String?
  interpretiveModel String?
  priority         Int       @default(0)
  grantScope       String[]  @default([]) // AgentToolGrant keys (e.g., "sandbox_execute", "schema_validate")
  modelTier        String?   // frontier | strong | adequate | basic
  bpmnLaneId       String?   // Link to EaElement (bpmn_lane)
  maxRetries       Int       @default(2)
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([teamId])
  @@index([agentId])
}

model ValueStreamHitlGate {
  id                        String    @id @default(cuid())
  teamId                    String
  team                      ValueStreamTeam @relation(fields: [teamId], references: [id])
  triggerPoint              String    // phase-transition | before-tool | after-evaluation | on-error
  condition                 Json?     // JSON expression
  requiredRole              String    // PlatformRole code
  escalationTimeoutMinutes  Int       @default(30)
  escalationPath            String[]  @default([])
  channels                  String[]  @default([])
  emergencyBypass           Boolean   @default(false)
  bpmnGatewayId             String?   // Link to EaElement (bpmn_gateway)
  createdAt                 DateTime  @default(now())
  updatedAt                 DateTime  @updatedAt

  @@index([teamId])
}
```

> **Convention notes:** PK fields use `id` (matching all 100+ existing models). FK relations reference `.id` (cuid PK). `String[]` fields include `@default([])`. All models include `createdAt`/`updatedAt`. FK fields are indexed. The field formerly named `toolScope` is now `grantScope` to clarify it stores `AgentToolGrant` keys, not tool names — the orchestrator resolves grant keys to actual tool name arrays at dispatch time.

**Migration path from Build Studio:**

The current hard-coded `SPECIALIST_AGENT_IDS`, `SPECIALIST_MODEL_REQS`, `SPECIALIST_TOOLS`, and `ROLE_PRIORITY` in `specialist-prompts.ts` and `task-dependency-graph.ts` become seed data for the Integrate value stream team:

```json
{
  "name": "Build Specialist Team",
  "valueStream": "integrate",
  "teamPattern": "specialist-dispatch",
  "coordinationPattern": {
    "phaseSequential": true,
    "parallelWithinPhase": true,
    "fileOverlapSplitting": true,
    "contextAccumulation": "append",
    "failurePolicy": "halt-phase"
  },
  "roles": [
    { "roleName": "data-architect", "workerType": "ai-agent", "agentId": "AGT-BUILD-DA", "priority": 0, "modelTier": "frontier", "grantScope": ["sandbox_execute", "schema_validate"] },
    { "roleName": "software-engineer", "workerType": "ai-agent", "agentId": "AGT-BUILD-SE", "priority": 1, "modelTier": "frontier", "grantScope": ["sandbox_execute", "code_generate"] },
    { "roleName": "frontend-engineer", "workerType": "ai-agent", "agentId": "AGT-BUILD-FE", "priority": 2, "modelTier": "frontier", "grantScope": ["sandbox_execute", "code_generate"] },
    { "roleName": "qa-engineer", "workerType": "ai-agent", "agentId": "AGT-BUILD-QA", "priority": 3, "modelTier": "strong", "grantScope": ["sandbox_execute", "test_run"] }
  ],
  "hitlGates": [
    { "triggerPoint": "phase-transition", "requiredRole": "HR-000", "escalationTimeoutMinutes": 30, "channels": ["in-app"] }
  ]
}
```

**What changes in the codebase:**
- Modified: `build-orchestrator.ts` — read team configuration from DB instead of constants
- Modified: `task-dependency-graph.ts` — role priority from `ValueStreamTeamRole.priority` instead of `ROLE_PRIORITY`
- Modified: `specialist-prompts.ts` — tool scope from `ValueStreamTeamRole.grantScope` instead of `SPECIALIST_TOOLS`
- New: `apps/web/lib/integrate/team-executor.ts` — generalized team execution engine
- New: Seed migration for initial ValueStreamTeam records

### Stage 3: MBSE — "The Model Drives The Runtime"

**Goal**: EA model (ArchiMate + BPMN) becomes the source of truth. Changes to the model propagate to runtime team configurations.

**The model-to-config compiler:**

```
EA View (BPMN process diagram)
         │
         ▼
┌─────────────────────┐
│  Model Synthesizer   │  Reads approved EA view
│                     │  Extracts: pools, lanes, tasks, gateways, events
│                     │  Maps: lane → TeamRole, gateway → HitlGate
│                     │  Resolves: agent assignments, human roles
└─────────────────────┘
         │
         ▼
ValueStreamTeam config (proposed)
         │
         ▼
┌─────────────────────┐
│  Human Review Gate   │  Approval authority reviews proposed config
│                     │  Diff shown: what changed from current config
└─────────────────────┘
         │
         ▼
ValueStreamTeam config (active)
         │
         ▼
Runtime orchestrator reads config
```

**BPMN element → Team config mapping rules:**

| BPMN Element | Team Config Target | Mapping Rule |
|---|---|---|
| `bpmn_pool` | ValueStreamTeam | One team per pool; pool name → team name |
| `bpmn_lane` | ValueStreamTeamRole | One role per lane; lane → agent or human based on linked ArchiMate element |
| `bpmn_service_task` | Specialist dispatch step | Task in a lane → assigned to that role; linked `application_component` → agent resolution |
| `bpmn_user_task` | Human task | Forces `workerType: "human"`; linked `business_actor` → PlatformRole |
| `bpmn_manual_task` | Off-platform task | Creates approval request with notification channels |
| `bpmn_parallel_gateway` | `parallelWithinPhase: true` | Fork: all outgoing paths run concurrently |
| `bpmn_exclusive_gateway` | Conditional routing | Guard conditions map to phase gate expressions |
| `bpmn_inclusive_gateway` | Optional specialist inclusion | Some paths may activate based on context |
| `bpmn_boundary_event` (error) | Retry / escalation config | Maps to `maxRetries` and `failurePolicy` |
| `bpmn_boundary_event` (timer) | Timeout config | Maps to `escalationTimeoutMinutes` |
| `bpmn_data_object` | PhaseHandoff / evidence | Input data objects → required evidence; output → produced artifacts |
| `sequence_flow` | Priority ordering | Topological sort of tasks → role priority values |
| `bpmn_sub_process` | Nested team scope | Sub-process → child ValueStreamTeam with delegated authority |

**Bidirectional sync:**
- **Model → Runtime**: Synthesizer compiles approved BPMN view → ValueStreamTeam config
- **Runtime → Model**: Runtime projector (Stage 1) creates instance-level elements showing actual execution
- **Drift detection**: Compare modeled process (type-level BPMN) vs actual execution (instance-level). Flag deviations as process improvement opportunities.

---

## 5. Unified Process Dashboard

### 5.1 Progressive Disclosure (US 8,635,592)

The same value stream is visible at three levels of detail, matching the user's role and need:

**Level 1 — EA View (for architects):**
ArchiMate boxes and arrows showing structural relationships. BusinessProcesses, BusinessFunctions, ApplicationComponents, TechnologyNodes. Viewpoint-filtered. This is what exists today.

**Level 2 — Process View (for operators and managers):**
BPMN swimlane diagram showing the live execution state. Tasks are colored by status (running=blue, complete=green, failed=red, waiting=amber). Human gates show who must approve and whether they've been notified. Progress percentage and active agent visible.

**Level 3 — Team View (for workforce managers):**
Dashboard showing team composition, role assignments, agent performance scores, human availability, workload distribution, and Diversity of Thought coverage. Links to agent governance profiles and performance histories.

### 5.2 Process View Layout

```
┌─ Value Stream: Integrate ──────────────────────────────────────────────┐
│                                                                        │
│  ┌─ Lane: Data Architect (AGT-BUILD-DA) ─────────────────────────────┐ │
│  │  (●)──→ [Read Schema] ──→ [Design Models] ──→ [Migrate] ──→ (●)  │ │
│  │  start    ████ done        ████ done          ███░ 80%     end    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                          │                                             │
│                          ▼                                             │
│  ┌─ Lane: Software Engineer (AGT-BUILD-SE) ──────────────────────────┐ │
│  │  (●)──→ [Read Patterns] ──→ [Generate API] ──→ [Wire Routes] ──→ │ │
│  │          ████ done           ███░ running       ○ pending         │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                          │                                             │
│                          ▼                                             │
│  ┌─ Lane: Frontend Engineer (AGT-BUILD-FE) ──────────────────────────┐ │
│  │  (●)──→ [Read Structure] ──→ [Build Components] ──→ [Style] ──→  │ │
│  │          ○ pending            ○ pending              ○ pending    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                          │                                             │
│                          ▼                                             │
│  ┌─ Lane: QA Engineer (AGT-BUILD-QA) ───────────────────────────────┐ │
│  │  (●)──→ [Typecheck] ──→ [Run Tests] ──→ [Report] ──→ (●)       │ │
│  │          ○ pending       ○ pending       ○ pending    end        │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                          │                                             │
│                    ◇ HUMAN GATE ◇                                      │
│                 Mark B. (HR-000)                                        │
│              ◐ awaiting completion                                      │
│                                                                        │
│  Build #47 "Add invoice export" │ Phase: build │ 6/16 tasks │ 37%     │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Cross-Value-Stream View

When products span multiple value streams, a top-level view shows the end-to-end flow:

```
Explore          Integrate         Deploy           Release          Operate
┌──────┐        ┌──────────┐      ┌──────┐        ┌──────┐        ┌──────┐
│Ideate│──→     │  Build   │──→   │Plan &│──→     │Catalog│──→    │Monitor│
│ Plan │   ◇    │  Review  │  ◇   │Approve│  ◇    │Publish│  ◇   │Respond│
└──────┘  gate  └──────────┘ gate └──────┘  gate  └──────┘ gate  └──────┘
  pair          specialist-      pipeline          pair            swarm
                dispatch
  AI+Human      4 AI + 1 Human   2 AI + 1 Human   AI + Human     3 AI + Human
```

Each box is a clickable region that expands to the BPMN process view for that value stream's team.

---

## 6. Neo4j Graph Extensions

### 6.1 New Node Labels

| Node Label | Authority | Purpose |
|---|---|---|
| `TeamInstance` | Prisma (ValueStreamTeam) | Runtime team configuration projected to graph |
| `RoleInstance` | Prisma (ValueStreamTeamRole) | Role within a team |
| `ProcessExecution` | Runtime (from event projector) | Instance of a BPMN process execution |

### 6.2 New Relationship Types

| Relationship | From → To | Properties | Purpose |
|---|---|---|---|
| `PARTICIPATES_IN` | Agent/EmployeeProfile → TeamInstance | role, since | Who's on the team |
| `OPERATES_IN` | TeamInstance → ValueStream (EaElement) | valueStream | Which stream the team serves |
| `EXECUTES` | TeamInstance → ProcessExecution | buildId, startedAt | Links team to its process runs |
| `PERFORMED_BY` | ProcessExecution step → Agent/EmployeeProfile | outcome, duration | Who did each step |

### 6.3 New Query Patterns

**Team impact analysis** — "If agent AGT-BUILD-DA goes down, which value streams are affected?"
```cypher
MATCH (a:Agent {agentId: $agentId})-[:PARTICIPATES_IN]->(t:TeamInstance)-[:OPERATES_IN]->(vs:EaElement)
RETURN vs.name AS valueStream, t.name AS team, 
       size((t)<-[:PARTICIPATES_IN]-()) AS teamSize
```

**Human workload** — "How many teams is Mark currently a gate approver for?"
```cypher
MATCH (e:EmployeeProfile {employeeId: $empId})-[:PARTICIPATES_IN {role: 'approver'}]->(t:TeamInstance)
WHERE t.isActive = true
RETURN t.name, t.valueStream, t.teamPattern
```

**Process conformance** — "Show me executions that deviated from the modeled process"
```cypher
MATCH (pe:ProcessExecution)-[:INSTANCE_OF]->(bp:BPMN__Process)
WHERE pe.deviationCount > 0
RETURN pe, bp.name, pe.deviationCount, pe.deviationDetails
```

---

## 7. BPMN Import/Export

### 7.1 BPMN 2.0 XML Import

Parallel to `archimate-xml.ts`, a new `bpmn-xml.ts` handles BPMN 2.0 XML interchange:

```
Input: BPMN 2.0 XML (from Camunda, Bizagi, Signavio, or any BPMN-compliant tool)
         │
         ▼
Parse: Extract definitions, processes, flowElements, participants, messageFlows
         │
         ▼
Map: BPMN element types → DPF EaElementType slugs (bpmn_task → bpmn_service_task, etc.)
         │
         ▼
Create: EaElement + EaRelationship records under bpmn20 notation
         │
         ▼
Link: If ArchiMate elements with matching names exist, create cross-notation relationships
         │
         ▼
Project: EaView with BPMN layout, synced to Neo4j
```

### 7.2 BPMN 2.0 XML Export

For round-tripping back to EA tools:
- DPF BPMN elements → standard BPMN 2.0 XML
- Extension elements (DPF-specific properties like agentId, modelTier) stored as `<bpmn:extensionElements>` with `dpf:` namespace
- Cross-notation links preserved as extension attributes

### 7.3 Integration with EA Tool

The user mentioned having an EA solution that does value stream modeling. The integration path:

1. **Export** value stream model from EA tool as ArchiMate XML (already supported)
2. **Import** into DPF (existing `archimate-xml.ts`)
3. **Create BPMN detail** for each value stream in DPF's canvas
4. **Link** ArchiMate structural elements to BPMN behavioral elements via cross-notation relationships
5. **Synthesize** team configurations from the linked model (Stage 3)
6. **Export** combined model back to EA tool for governance review

---

## 8. Implementation Plan

### Phase 1: BPMN Notation Seed (Low Risk)

| Task | Files |
|------|-------|
| Create BPMN 2.0 notation seed data | `packages/db/src/seed-ea-bpmn20.ts` (new) |
| Add 32 element types, 6 relationship types, relationship rules | Same file |
| Add DQ rules for BPMN process validation | Same file |
| Add structure rules (process contains tasks, lanes contain tasks) | Same file |
| Register BPMN notation in main seed | `packages/db/src/seed.ts` (modified) |
| Create `dpf-cross-notation` pseudo-notation for cross-notation relationship types | `packages/db/src/seed-ea-cross-notation.ts` (new) |
| Add cross-notation relationship types (`details`, `performs`, `realizes_process`) | Same file |

### Phase 2: BPMN Canvas Rendering (Medium Risk)

| Task | Files |
|------|-------|
| BPMN task node component (rounded rect + icon) | `apps/web/components/ea/BpmnTaskNode.tsx` (new) |
| BPMN gateway node component (diamond) | `apps/web/components/ea/BpmnGatewayNode.tsx` (new) |
| BPMN event node component (circles) | `apps/web/components/ea/BpmnEventNode.tsx` (new) |
| BPMN swimlane container component | `apps/web/components/ea/BpmnLaneNode.tsx` (new) |
| BPMN sequence flow edge component | `apps/web/components/ea/BpmnSequenceFlowEdge.tsx` (new) |
| Register BPMN node/edge types in canvas | `apps/web/components/ea/EaCanvas.tsx` (modified) |
| BPMN horizontal flow layout algorithm | `apps/web/components/ea/bpmn-layout.ts` (new) |
| "Process Architecture" viewpoint definition | `packages/db/src/seed.ts` (modified) |

### Phase 3: ValueStreamTeam Schema & Migration (Medium Risk)

| Task | Files |
|------|-------|
| Add ValueStreamTeam, ValueStreamTeamRole, ValueStreamHitlGate models | `packages/db/prisma/schema.prisma` (modified) |
| Create migration | `packages/db/prisma/migrations/` (new) |
| Seed initial team configs from current Build Studio constants | `packages/db/src/seed-value-stream-teams.ts` (new) |
| Team configuration CRUD actions | `apps/web/lib/actions/value-stream-team.ts` (new) |

### Phase 4a: Extract Team Executor from Build Studio (High Risk)

| Task | Files |
|------|-------|
| Extract team execution engine from build-orchestrator | `apps/web/lib/integrate/team-executor.ts` (new) |
| Refactor build-orchestrator to use team-executor | `apps/web/lib/integrate/build-orchestrator.ts` (modified) |
| Refactor task-dependency-graph to read from team config | `apps/web/lib/integrate/task-dependency-graph.ts` (modified) |
| Refactor specialist-prompts to read grant scope from team config | `apps/web/lib/integrate/specialist-prompts.ts` (modified) |
| Verify: Build Studio works identically after refactor (existing tests must pass) | — |

### Phase 4b: Add New Team Patterns (Medium Risk)

| Task | Files |
|------|-------|
| Review-board pattern executor (parallel eval + consensus) | `apps/web/lib/integrate/team-patterns/review-board.ts` (new) |
| Pair pattern executor (AI + human sequential) | `apps/web/lib/integrate/team-patterns/pair.ts` (new) |
| Swarm pattern executor (independent + compare) | `apps/web/lib/integrate/team-patterns/swarm.ts` (new) |
| Pipeline pattern executor (sequential transform) | `apps/web/lib/integrate/team-patterns/pipeline.ts` (new) |
| Pattern registry and dispatcher | `apps/web/lib/integrate/team-patterns/index.ts` (new) |

### Phase 5: Runtime-to-EA Projection (Medium Risk)

| Task | Files |
|------|-------|
| Runtime EA projector (event listener → EaElement creation) | `apps/web/lib/ea/runtime-ea-projector.ts` (new) |
| Register projector in event bus | `apps/web/lib/tak/agent-event-bus.ts` (modified) |
| Runtime process EA view type | `apps/web/lib/explore/ea-types.ts` (modified) |
| Process execution status overlay for canvas | `apps/web/components/ea/ProcessExecutionOverlay.tsx` (new) |

### Phase 6: BPMN Import/Export (Medium Risk)

| Task | Files |
|------|-------|
| BPMN 2.0 XML parser and generator | `apps/web/lib/ea/bpmn-xml.ts` (new) |
| Cross-notation auto-linking logic | `apps/web/lib/ea/cross-notation-linker.ts` (new) |
| Import/export UI actions | `apps/web/lib/actions/ea.ts` (modified) |

### Phase 7: Model Synthesizer — MBSE Bridge (High Risk)

| Task | Files |
|------|-------|
| BPMN-to-TeamConfig synthesizer | `apps/web/lib/ea/model-synthesizer.ts` (new) |
| Config diff generator (current vs proposed) | `apps/web/lib/ea/config-diff.ts` (new) |
| Approval workflow for model-driven config changes | `apps/web/lib/govern/model-change-approval.ts` (new) |
| Drift detection (modeled vs actual execution) | `apps/web/lib/ea/drift-detector.ts` (new) |

### Phase 8: Process Dashboard UI (Medium Risk)

| Task | Files |
|------|-------|
| Process View component (BPMN with live status) | `apps/web/components/process/ProcessView.tsx` (new) |
| Team View component (composition + performance) | `apps/web/components/process/TeamView.tsx` (new) |
| Cross-Value-Stream overview | `apps/web/components/process/ValueStreamOverview.tsx` (new) |
| Progressive disclosure navigation (EA → Process → Team) | `apps/web/components/process/ProcessDisclosure.tsx` (new) |

---

## 9. TAK Compliance

| TAK Mechanism | How This Design Complies |
|---|---|
| **Instruction Integrity** | Team configurations are stored as governed records with audit trail. Model-driven changes require human approval before activation. BPMN models define the authority envelope — agents cannot exceed what the model grants. |
| **Authority Separation** | ValueStreamTeamRole explicitly separates AI agent roles from human roles. `workerType: "either"` still requires the role to be filled — never both simultaneously. HITL gates enforce that humans approve consequential transitions. |
| **Layered Delegation** | ValueStreamTeam → ValueStreamTeamRole follows narrowing delegation. Sub-processes create child teams with narrower authority than parent. Cross-value-stream delegation via `bpmn_call_activity` requires explicit grant. |
| **Dual Evaluation** | Team pattern "review-board" enables multiple perspectives (AI + human) evaluating the same work. Diversity of Thought fields (perspective, heuristics, interpretiveModel) ensure agents don't converge on identical evaluations. |
| **Audit Trail** | Runtime-to-EA projection creates a permanent record of who did what, when, in which role. Process executions link to EaElements. Drift detection flags deviations from the modeled process. All model-to-config changes flow through approval gates. |

---

## 10. Design Decisions

1. **BPMN 2.0 over BPEL**: BPMN 2.0 subsumes BPEL's execution semantics while providing visual modeling. Rather than running a separate BPEL engine, the platform's orchestrator + event bus serve as the execution runtime. BPMN models define *what*; the orchestrator determines *how*.

2. **Cross-notation linking over notation merging**: ArchiMate and BPMN serve different purposes (structure vs behavior). Rather than creating a hybrid notation, we link elements across notations via `details`/`performs`/`realizes_process` relationships. This preserves each notation's integrity and allows import/export with standard-compliant EA tools.

3. **Three-stage evolution over big-bang MBSE**: Going directly to model-driven would require all models to be correct before the platform works. The three-stage approach (reflective → configurable → MBSE) delivers value at each stage and allows the model to be validated against actual runtime behavior before it becomes prescriptive.

4. **Team patterns as enum over process interpreter**: Rather than building a full BPMN process interpreter (which is essentially an entire workflow engine), we define five canonical team patterns (specialist-dispatch, review-board, pair, swarm, pipeline) that cover the observed collaboration modes. The BPMN model selects and configures a pattern rather than being interpreted instruction-by-instruction. This is pragmatic for v1; a full interpreter is a Phase 7+ consideration.

5. **`workerType: "either"` over separate human/AI role hierarchies**: Some roles (reviewer, approver) can be performed by either humans or AI depending on context and trust level. The `either` type allows gradual AI adoption — start with humans, let AI earn trust through performance profiles, transition when ready.

6. **Drift detection over strict enforcement**: In Stage 3, runtime execution may deviate from the modeled process (specialist skipped, human overrode a gate, emergency bypass). Rather than hard-failing, we detect and report drift. This respects operational reality while maintaining process visibility.

---

## 11. Out of Scope (v1)

- **Full BPMN process interpreter**: v1 uses team patterns, not instruction-level BPMN execution. A full interpreter (event subprocess handling, compensation, complex merge semantics) is a future phase.
- **BPMN simulation**: Running what-if scenarios against a BPMN model before activating it.
- **DMN (Decision Model and Notation)**: Would complement BPMN for complex business rules, but DQ rules and gate expressions handle current needs.
- **CMMN (Case Management Model and Notation)**: For unstructured, knowledge-worker processes. Not needed while value streams are well-defined.
- **Multi-organization pools**: Current scope assumes single-organization teams. Cross-org collaboration (customer/supplier) is a future extension.
- **Real-time BPMN token animation**: Showing execution tokens moving through the diagram in real-time (vs. status coloring, which is in scope).

---

## 12. Success Criteria

1. BPMN 2.0 notation is bootstrapped with element types, relationship types, and rules that pass DQ validation.
2. BPMN diagrams can be created, edited, and rendered on the EA canvas with swimlanes, task nodes, gateways, and events.
3. ArchiMate elements can be linked to BPMN elements via cross-notation relationships, and both appear in a "Process Architecture" viewpoint.
4. BPMN 2.0 XML can be imported from and exported to standard EA tools (round-trip without data loss for standard elements).
5. The Build Studio's specialist team is seeded as a ValueStreamTeam record and the orchestrator reads from it instead of hard-coded constants.
6. At least one additional value stream (Deploy or Release) has a team configuration defined and operational.
7. Runtime execution events produce EA elements visible on the canvas (Stage 1 reflective projection working).
8. The process dashboard shows live execution state with progressive disclosure (EA view → Process view → Team view).

---

## 13. Sources

- [AI Coworker Development Principles](../../architecture/ai-coworker-development-principles.md) — Foundational spec; Principle 2 (Orchestrator-Worker), Principle 4 (Diversity of Thought), Principle 7 (HITL at Phase Boundaries)
- [Build Process Orchestrator Design](2026-04-02-build-process-orchestrator-design.md) — Current specialist dispatch implementation
- [Agentic Architecture Patterns](2026-04-02-agentic-architecture-patterns-design.md) — Sub-agent patterns, model tiering, phase-aware limits
- [Phase Handoff & Human Authority Engagement](2026-04-01-phase-handoff-and-human-authority-engagement-design.md) — PhaseHandoff documents, authority resolution, approval flow
- [AI Workforce Consolidation](2026-04-02-ai-workforce-consolidation-design.md) — Unified agent model, governance profiles, performance tracking
- [Build Studio IT4IT Value Stream Alignment](2026-03-26-build-studio-it4it-value-stream-alignment-design.md) — Sandbox pool, release bundling, value stream agent orchestration
- [CSDM 6 Digital Product Meta-Model](2026-03-21-csdm6-digital-product-metamodel-and-ontology-design.md) — Digital Product as first-class entity, four-portfolio taxonomy
- [Task Graph Orchestration](2026-03-23-task-graph-orchestration-design.md) — TaskRun/TaskNode DAG, authority envelopes, evidence contracts
- [HR Workforce Core](2026-03-13-hr-workforce-core-design.md) — EmployeeProfile, org structure, employment lifecycle
- [Multi-Layer Topology Graph](2026-04-02-multi-layer-topology-graph-design.md) — Neo4j dependency modeling, impact analysis patterns
- IT4IT Reference Architecture v3.0.1 — Value stream definitions (SS5.2-SS5.7)
- OMG BPMN 2.0 Specification — Business Process Model and Notation standard
- OMG ArchiMate 3.2 / 4.0 Specification — Enterprise Architecture modeling language
- US Patent 8,635,592 — Progressive disclosure of software complexity (Bodman)
- Page, Scott E. — *The Diversity Bonus* / *The Difference* — Diversity of cognitive approaches in problem-solving
