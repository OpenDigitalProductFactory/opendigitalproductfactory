# EP-AGENT-CAP-001: Knowledge-Driven Agent Capabilities, User Skills, and Page Automation

**Date:** 2026-03-18
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic:** EP-AGENT-CAP-001

**Prerequisites:**
- EP-LLM-LIVE-001 (live LLM conversations) — complete
- EP-AGENT-EXEC-001 (agent execution with HITL governance) — complete
- Unified MCP Coworker Architecture (2026-03-16) — design complete
- Shared Memory / Vector DB (2026-03-17) — design complete

---

## Problem Statement

The platform's AI coworker has limited, manually-maintained tool awareness. When a new feature is added to a page, the agent doesn't know about it until a developer hardcodes it into the route context map. Users perform repetitive multi-step tasks with no way to save and reuse them. The agent cannot fully automate page actions even when the user enables Act mode. External MCP resources exist but aren't surfaced as discoverable capabilities with upgrade paths.

Specific problems:

1. **Static tool awareness** — agent skills are hardcoded in `route-context-map.ts` and `mcp-tools.ts`. Adding a new page feature requires manual tool registration.
2. **No user-defined skills** — users repeat the same multi-step workflows (e.g., bulk employee imports) with no way to save them as reusable intents.
3. **Incomplete page automation** — in Act mode, the agent can only execute 5 predefined tools. Most page actions (CRUD, bulk operations, navigation) are not exposed.
4. **No reactive UI feedback** — when the agent acts, the user doesn't see it happening in real time on the page.
5. **Invisible external capabilities** — MCP services that could help but aren't enabled/paid are invisible to both agent and user.
6. **Skills dropdown bug** — the dropdown initializes open (`useState(true)`) and stays visible even when focus moves elsewhere.

---

## Terminology

- **Page Action** — a typed server action that performs a specific operation on a page (create, update, delete, import, etc.). Exposed to the agent as a callable tool via conversion to `ToolDefinition`.
- **Action Manifest** — a declarative registry of all page actions for a given route, co-located with the page code.
- **User Skill** — a stored natural language intent that describes a reusable goal with constraints. Not a recorded macro. The agent re-plans from the intent each time. Distinct from platform skills (the existing `AgentSkill` type used for static skill chips in `route-context-map.ts`).
- **Platform Skill** — a static, spec-derived skill chip defined in route context. Uses the existing `AgentSkill` type (`label`, `description`, `capability`, `prompt`).
- **Capability Discovery** — the process by which the agent builds its tool set at conversation start by querying platform knowledge.
- **MCP Resource** — an external service (web search, document parser, etc.) registered in the unified endpoint registry and available to any employee by HR role.

---

## Design Summary

Replace static tool lists with **knowledge-driven capability discovery**. The agent queries the platform knowledge base (Qdrant) to understand what it can do on each page, builds its tool manifest dynamically, and can fully automate any exposed page action. Users can save repeatable patterns as intent-based skills. External MCP resources are discoverable with upgrade paths for services not yet enabled.

### Key Principles

- **Knowledge is the source of truth** — specs describe capabilities, specs are indexed, agents query knowledge (not source code)
- **Intent over sequence** — skills capture goals, not recorded steps. The agent re-plans each time.
- **Server actions, reactive UI** — the agent calls typed server actions; the UI reflects changes in real time
- **HR role governs everything** — page tools, skills, and MCP resources are all gated by the employee's role
- **Surface the possible** — show users what's available but not enabled, so they know what the platform can do

---

## Section 1: Knowledge-Driven Capability Discovery

### How It Works

When a conversation starts on a route, the system:

1. **Queries platform knowledge** (Qdrant) for all specs tagged to that route/domain
2. **Filters by lifecycle status**:
   - `production` — the agent can execute these actions
   - `build` — the agent knows about these but they're not yet callable
   - `planned` — the agent can mention these are coming
3. **Reads the action manifest** for the route (see Section 3) to get executable tool definitions
4. **Merges** knowledge context + executable tools into the dynamic tool manifest
5. **Injects** the manifest into the system prompt (block 5 — domain tools — of the unified coworker's 7-block prompt)

### What Gets Indexed Per Capability

Each spec, when indexed into Qdrant, includes structured payload fields (not embedded in the text content — stored as individual payload fields for filtering):

| Field | Purpose |
|-------|---------|
| `route` | Which page(s) this capability applies to |
| `action_name` | Machine-readable action identifier |
| `description` | Natural language description of what it does |
| `parameter_summary` | What inputs the action needs |
| `required_capability` | HR capability key required |
| `side_effect` | `true` if it creates/modifies/deletes data |
| `lifecycle_status` | `planned` / `build` / `production` |
| `spec_ref` | Link back to the originating spec (e.g., EP-EMP-001) |

### Required Qdrant Payload Indexes

The `platform-knowledge` collection requires new payload indexes for capability discovery queries:

| Index | Type | Purpose |
|-------|------|---------|
| `route` | keyword | Filter capabilities by page route |
| `lifecycle_status` | keyword | Filter by planned/build/production |
| `action_name` | keyword | Look up specific actions |
| `spec_ref` | keyword | Look up capabilities by originating spec |
| `side_effect` | bool | Filter read-only vs mutating actions |

These are added alongside the existing `entityType` and `entityId` indexes.

**Migration strategy:** The current `ensureCollections()` function only creates indexes when the collection doesn't exist (guarded by `if (!names.has(...))`). Since the `platform-knowledge` collection already exists in deployed environments, a new `ensurePayloadIndexes()` function runs idempotently on startup (Qdrant's PUT index ignores duplicates). This function is called after `ensureCollections()` and creates all required indexes regardless of whether the collection is new or existing.

### Knowledge Storage Function

The existing `storePlatformKnowledge()` function stores a 300-character `contentPreview` as text. Capability metadata requires structured payload fields for filtering. A new `storeCapabilityKnowledge()` function extends the base function, accepting the structured fields from the table above as individual Qdrant payload fields rather than embedding them in the content string. This preserves filterability for discovery queries.

**Point ID format:** Each capability entry uses the ID `capability-{spec_ref}-{action_name}` (e.g., `capability-EP-EMP-001-create_employee`). This ensures uniqueness when multiple actions originate from the same spec, and provides a stable key for the commit hook to find and update entries.

### Capability Lookup Function

The commit hook and lifecycle transition logic need to find capabilities by exact field match (e.g., "does an entry with `action_name: create_employee` exist?"), not by semantic similarity. A new `lookupCapabilityByFilter()` function uses Qdrant's scroll endpoint with payload filters — no embedding vector required. This is distinct from `searchPlatformKnowledge()` which performs semantic similarity search and is unsuitable for exact-match lookups.

### When the Platform Changes

The indexing lifecycle:

1. **Spec written** (brainstorming/planning workflow) — indexed into Qdrant with `lifecycle: planned` and route tags. The agent knows about planned capabilities as soon as the spec is written.
2. **Implementation begins** — lifecycle updates to `build`
3. **Server action created** — action registered in the page's action manifest
4. **Deployed / promoted** — lifecycle updates to `production`, action becomes executable
5. **Next conversation** — agent discovers the new capability via knowledge query

### Lifecycle Transition Triggers

| Transition | Triggered By |
|-----------|-------------|
| → `planned` | Spec indexing at write time (brainstorming/planning workflow final step) |
| `planned` → `build` | Developer or platform agent updates the knowledge entry when implementation begins (manual call to `updateCapabilityLifecycle()`) |
| `build` → `production` | Commit hook detects that both a spec and a matching action manifest entry exist for the capability |

The commit hook is the authoritative transition to `production` — an action is only executable when it has both a spec in knowledge and a server action in the manifest. This prevents the agent from attempting to execute actions that are only partially implemented.

### Commit Hook Safety Net

A post-commit hook scans for changes to:
- Spec files (`docs/superpowers/specs/`) — checks Qdrant for an existing entry with matching `spec_ref`; queues re-index if not found
- Action manifests (`app/**/actions/manifest.ts`) — for each action in the manifest, checks if a knowledge entry with matching `action_name` exists at `production` status; if the knowledge entry is at `build`, promotes to `production`; if no knowledge entry exists, logs a warning (every action needs a spec)

The hook queries Qdrant via the `lookupCapabilityByFilter()` function using the `spec_ref` or `action_name` payload filter.

---

## Section 2: Page Automation — Server Actions with Reactive UI

### Action Categories

Every user-facing operation on a page is backed by a typed server action. Categories:

- **CRUD** — create, read, update, delete entities
- **Bulk operations** — import from file, batch update, batch delete
- **Navigation** — open sub-screens, switch tabs, expand detail panels
- **State transitions** — lifecycle changes, status updates, approvals

### Reactive UI Feedback

When the agent executes actions, the user sees the results reflected on the page. The feedback model depends on how the action is executed:

**Single actions (most cases):** The agent calls a server action, the response triggers React query invalidation, and the UI re-renders with the new data. This is the existing pattern — no new infrastructure needed. The agent's chat response describes what was done.

**Bulk operations (e.g., 10 employee imports):** The initial implementation returns results after completion — the agent calls the bulk action, waits for the response, and the UI updates all at once. The agent's chat message provides progress context ("All 10 employees created successfully. Here's the summary...").

**Future enhancement (not in this spec):** Streaming bulk operations via server-sent events or WebSocket push, enabling per-row UI updates during execution. This requires changes to the agentic loop's request-response model and is deferred to a follow-up spec.

**UI indicators for agent-modified data:**

1. **Row-level highlights** — new or modified rows flash briefly with a coworker indicator after query invalidation
2. **Action badges** — items touched by the agent show a subtle "AI" badge for that session
3. **Error surfacing** — if an action fails, the agent reports the error in chat and asks how to proceed

The UI updates via the existing React state / query invalidation patterns. The agent calls server actions; React re-renders reflect the new data. No DOM automation — the agent never drives the browser.

### Advise / Act Integration

- **Advise mode** (default): agent can query/read and describe what it _would_ do. Mutating actions (any tool with `sideEffect: true`) are blocked. Agent can still build and save skills.
- **Act mode**: agent executes. Every mutation goes through `AgentActionProposal` → `AuthorizationDecisionLog` with full audit context (endpoint, mode, sensitivity, route).

### Progressive Instrumentation

Pages do not need to be fully instrumented on day one. The agent queries knowledge and distinguishes:
- Actions with both a spec and a server action → executable
- Actions with a spec but no server action → "I know this page should support X, but that action isn't wired up yet"
- Actions with neither → not discoverable (as designed)

---

## Section 3: Action Manifest

Each page registers its available server actions in a co-located manifest file.

### Format

```typescript
// app/(shell)/employee/actions/manifest.ts
import type { PageActionManifest } from "@/lib/agent-action-types";

export const employeeActions: PageActionManifest = {
  route: "/employee",
  actions: [
    {
      name: "create_employee",
      description: "Create a new employee profile with name, email, department, and role",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name" },
          email: { type: "string", description: "Email address" },
          department: { type: "string", description: "Department name" },
          role: { type: "string", description: "Job title / role" },
        },
        required: ["name", "email"],
      },
      requiredCapability: "manage_employees",
      sideEffect: true,
      specRef: "EP-EMP-001",
    },
    {
      name: "bulk_import_employees",
      description: "Parse an uploaded spreadsheet and create employee records for each row",
      inputSchema: {
        type: "object",
        properties: {
          fileId: { type: "string", description: "ID of the uploaded file" },
          columnMapping: {
            type: "object",
            description: "Map of spreadsheet columns to employee fields",
          },
        },
        required: ["fileId"],
      },
      requiredCapability: "manage_employees",
      sideEffect: true,
      specRef: "EP-EMP-002",
    },
  ],
};
```

### Type Definition

`PageAction` extends the existing `ToolDefinition` with a `specRef` field for traceability:

```typescript
// lib/agent-action-types.ts
import type { ToolDefinition } from "@/lib/mcp-tools";

export type PageAction = ToolDefinition & {
  specRef: string;  // links to originating spec (e.g., EP-EMP-001)
};

export type PageActionManifest = {
  route: string;
  actions: PageAction[];
};
```

This means `PageAction` inherits `name`, `description`, `inputSchema`, `requiredCapability`, `sideEffect`, and `executionMode` from `ToolDefinition`. No adapter function is needed — `PageAction` instances are directly usable as `ToolDefinition` instances (structural subtype).

### Integration with Existing Tool Pipeline

The `sendMessage()` function in `agent-coworker.ts` currently calls `getAvailableTools()` which returns `ToolDefinition[]`. The integration point:

1. `sendMessage()` calls both `getAvailableTools()` (platform tools) and `getActionsForRoute()` (page actions)
2. Page actions are already `ToolDefinition`-compatible — they merge directly into the tool array
3. Advise/Act mode filtering applies to the merged set: in Advise mode, any tool with `sideEffect: true` is excluded
4. The merged, filtered set is passed to `toolsToOpenAIFormat()` and injected into the agentic loop

### Discovery at Runtime

A registry module collects all page manifests and uses longest-prefix matching (consistent with `resolveRouteContext()`):

```typescript
// lib/agent-action-registry.ts
import { employeeActions } from "@/app/(shell)/employee/actions/manifest";
import { portfolioActions } from "@/app/(shell)/portfolio/actions/manifest";
// ... other pages

const manifests: PageActionManifest[] = [
  employeeActions,
  portfolioActions,
  // ...
];

export function getActionsForRoute(route: string, userContext: UserContext): PageAction[] {
  // Longest-prefix match, consistent with resolveRouteContext()
  const match = manifests
    .filter((m) => route.startsWith(m.route))
    .sort((a, b) => b.route.length - a.route.length)[0];
  if (!match) return [];
  return match.actions.filter(
    (a) => a.requiredCapability === null || can(userContext, a.requiredCapability)
  );
}
```

---

## Section 4: User-Created Skills System

### Data Model

New Prisma model. Named `UserSkill` to distinguish from the existing `AgentSkill` TypeScript type (which represents static platform skill chips in `route-context-map.ts`):

```prisma
model UserSkill {
  id          String   @id @default(cuid())
  skillId     String   @unique  // "SK-XXXXX" human-readable
  name        String             // short label, e.g. "Import employees from spreadsheet"
  intent      String   @db.Text  // natural language goal + constraints
  constraints String[] @default([])  // explicit constraints as a list
  tags        String[] @default([])  // searchable tags
  routeHint   String?            // route where it was created (informational, not binding)
  visibility  String   @default("personal")  // personal | team | org
  teamId      String?            // set when visibility = "team"
  team        Team?    @relation(fields: [teamId], references: [id])
  createdById String
  createdBy   User     @relation("UserSkillCreator", fields: [createdById], references: [id])
  usageCount  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([createdById])
  @@index([visibility])
  @@index([routeHint])
}
```

**Reverse relations required:**
- `User` gains `userSkills UserSkill[] @relation("UserSkillCreator")`
- `Team` gains `userSkills UserSkill[]`

The named relation `"UserSkillCreator"` avoids ambiguity if `User` ever gains a second `UserSkill` relation (e.g., for skill editors or favorites).

### Skill Structure

A skill captures:

| Field | Purpose |
|-------|---------|
| `name` | Short label shown in the dropdown |
| `intent` | Natural language description of the goal — what to achieve, how to handle edge cases, what inputs are expected |
| `constraints` | Explicit constraints (e.g., "Requires uploaded file", "Only for active employees") |
| `tags` | Searchable tags for discovery |
| `routeHint` | Where it was created — used for relevance sorting, not access control |
| `visibility` | Who can use it: `personal`, `team`, or `org` |

### How Skills Are Created

**Path 1: Agent-offered** — After completing a multi-step task in Act mode:
1. Agent detects the task involved 2+ tool calls in sequence
2. Agent asks: "Would you like to save this as a reusable skill?"
3. If yes, agent asks: "Who should be able to use it — just you, your team, or everyone in the organization?"
4. If team: agent presents user's teams (from `TeamMembership`) as a picker. If user belongs to only one team, it auto-selects.
5. Agent drafts the intent from the conversation context
6. User reviews/edits the intent and confirms

**Path 2: User-initiated** — From the skills dropdown:
1. User selects "Create a skill..."
2. User describes the goal in natural language
3. Agent helps refine the intent (suggests constraints, clarifies edge cases)
4. User confirms and sets visibility (with team picker if applicable)

### How Skills Are Replayed

When a user selects a skill from the dropdown:
1. Agent reads the intent
2. Queries knowledge for current page capabilities
3. Builds a plan from the intent against available tools
4. In **Advise** mode: presents the plan — "Here's what I'd do: [steps]. Approve?"
5. In **Act** mode: executes the plan, pausing if inputs are needed ("Please upload the spreadsheet")
6. If tools needed by the intent aren't available, agent explains: "I can do steps 1 and 3, but step 2 requires [bulk import] which isn't implemented yet"
7. `usageCount` increments on execution

### Team Scoping Rules

**At creation:** If the user belongs to multiple teams, present a team picker. If the user has a `isPrimary: true` membership, default to that team. If only one team, auto-select.

**At query time:** Show skills for all teams the user belongs to (union of all `TeamMembership` records). A user on teams A and B sees team-scoped skills from both.

**On team departure:** When a user leaves a team, skills they created for that team remain visible to remaining team members. The `createdById` FK preserves authorship but does not gate access — `teamId` and `visibility` govern access.

### Skills Dropdown Redesign

The `AgentSkillsDropdown` component changes:

**Bug fix:** Initialize `isOpen` to `false` (currently `true`). Add click-outside listener for reliable close behavior.

**Sections** (in display order):
1. **Platform Skills** — derived from specs/knowledge, the existing `AgentSkill` type skill chips
2. **Org Skills** — `UserSkill` with `visibility = "org"`, available to everyone
3. **Team Skills** — `UserSkill` with `visibility = "team"`, filtered to user's teams
4. **My Skills** — `UserSkill` with `visibility = "personal"`, filtered to current user
5. **Create a skill...** — action item at the bottom

Each user skill shows:
- Name (bold)
- Short description (truncated intent, first ~60 chars)
- Usage count (subtle, e.g., "used 12 times")

Sections with no items are hidden. Empty state: only "Create a skill..." shows.

---

## Section 5: MCP External Resources

### Governance Model

External MCP resources are **organizational tools**, not page-scoped. Any employee can use them, governed by:

1. **HR role** — does the employee's role authorize this resource?
2. **Task sensitivity** — does the resource's sensitivity clearance match the task's classification?
3. **Availability** — is the resource within concurrency and rate limits?

The `AgentRouter` (from the unified coworker design) handles this evaluation. No changes to the routing algorithm — this design uses the existing endpoint selection logic.

### Resource Discoverability

The existing `ModelProvider.status` field (`active | inactive | unconfigured`) governs operational status — whether the endpoint is functional. This spec adds a separate `catalogVisibility` field that governs discoverability — whether the agent should mention the resource to users:

| `status` (operational) | `catalogVisibility` | Agent Behavior |
|------------------------|-------------------|----------------|
| `active` | `visible` | Agent can use it |
| `unconfigured` / `inactive` | `visible` | Agent mentions it when relevant: "I could do this with [Web Search], but it's not enabled. Want me to flag this to your admin?" |
| any | `hidden` | Agent doesn't surface it |

`restricted` (user's HR role doesn't permit) is not a provider-level state — it's computed at query time by checking `can(userContext, resource.requiredCapability)`. Resources the user can't access are simply not included in the tool manifest.

### Provider Registry Extension

The existing `ModelProvider` schema gains:

```prisma
// Addition to existing ModelProvider fields
catalogVisibility  String   @default("visible")   // visible | hidden
catalogEntry       Json?    // for unconfigured/inactive + visible: what this service does, pricing info, enable URL
```

The `status` field retains its existing values (`active | inactive | unconfigured`). `catalogVisibility` is orthogonal — an `active` resource could be `hidden` (e.g., internal infrastructure not relevant to users), and an `unconfigured` resource could be `visible` (surfacing upgrade opportunities).

### Discovery UX

When the agent builds its tool manifest, it includes two sections:
1. **Active tools** — endpoints with `status: "active"` and matching capability/sensitivity
2. **Available but not enabled** — endpoints with `status: "unconfigured" | "inactive"`, `catalogVisibility: "visible"`, and matching capability (if role permits, they'd be usable once enabled)

The agent uses this to make informed suggestions:

- "I'll create those 10 employee records now." (uses active tools)
- "If you had the Document Parser service enabled, I could extract the data directly from the PDF instead of needing a spreadsheet. Want me to flag this?" (references available resource)

The agent never blocks on unavailable resources — it always proceeds with what's available and informs the user about what could be better.

### Integration with Skills

Skills don't directly declare MCP resource dependencies. Instead, when the agent replans from a skill's intent, it discovers which resources would be useful and uses what's available. If a skill would benefit from an unavailable resource, the agent mentions it during planning.

---

## Section 6: Spec-to-Knowledge Indexing Workflow

### Primary Path: Index at Spec-Write Time

The brainstorming/planning workflow adds a final step after writing a spec:

1. Extract capability metadata from the spec (route, actions, parameters, capabilities, side effects)
2. Index into Qdrant with `lifecycle: planned` using `storeCapabilityKnowledge()` (structured payload fields, not text blob)
3. Tag with route associations and the spec reference ID

This means the agent knows about a capability as soon as it's designed — before implementation begins.

### Lifecycle Transitions

| Event | Lifecycle Update | Trigger | Agent Behavior |
|-------|-----------------|---------|----------------|
| Spec written | `planned` | Spec workflow final step | "This is planned but not built yet" |
| Implementation starts | `build` | Developer/agent calls `updateCapabilityLifecycle()` | "This is being built" |
| Server action + manifest entry exist | `production` | Commit hook detects matching spec + manifest | Tool is executable |

### Commit Hook Safety Net

A post-commit hook (`.git/hooks/post-commit` or CI step):

1. Scans for changed spec files in `docs/superpowers/specs/`
2. Queries Qdrant via `lookupCapabilityByFilter()` using the `spec_ref` payload filter to check if the spec is indexed
3. If not indexed: queues a re-index job
4. Scans for new/changed action manifests (`**/actions/manifest.ts`)
5. For each action in the manifest: checks if a knowledge entry with matching `action_name` exists
   - If knowledge entry is at `build` status and manifest entry exists → promotes to `production`
   - If no knowledge entry exists → logs a warning (every action needs a spec)

This catch-all ensures knowledge stays current even if the primary workflow is bypassed.

### System Prompt Injection

Dynamic capability context is injected into Block 5 (domain tools) of the unified coworker's 7-block system prompt. The ordering within Block 5:

1. Static route context (from `route-context-map.ts` — domain name, sensitivity, description)
2. Dynamic executable tools (from action manifest, filtered by capability and mode)
3. Knowledge-only capabilities (from Qdrant — planned/build items, presented as informational context)
4. Available but not enabled MCP resources (from provider registry, `catalogVisibility: "visible"`)

---

## Section 7: End-to-End Example

**Scenario:** User on `/employee` in Act mode uploads a spreadsheet with 10 employees.

1. **Conversation starts** — system queries Qdrant for `/employee` capabilities, reads the employee action manifest. Agent's tool set includes `create_employee`, `bulk_import_employees`, `update_employee`, etc.

2. **User uploads file** — "Add these employees please."

3. **Agent plans** — reads the file, maps columns to employee fields, determines `bulk_import_employees` is the right tool (or falls back to 10x `create_employee` if bulk isn't available yet).

4. **Agent executes** — calls the server action. Response returns success for all 10. React query invalidation fires, UI re-renders with 10 new rows (highlighted). Each action logged to `AuthorizationDecisionLog`.

5. **Agent offers skill** — "Done! All 10 employees added. Would you like to save this as a reusable skill for next time?"

6. **User accepts** — "Yes, for my team."

7. **Agent asks team** — if user belongs to multiple teams, presents picker. Otherwise auto-selects.

8. **Agent saves skill**:
   - Name: "Import employees from spreadsheet"
   - Intent: "Parse an uploaded spreadsheet containing employee data. Map columns to employee fields (name, email, department, role). Validate required fields are present. Create employee records for each row. Report any rows that failed validation."
   - Visibility: team
   - Team: (selected team)
   - Route hint: /employee

9. **Next time** — a teammate on `/employee` sees "Import employees from spreadsheet" under Team Skills in the dropdown. They select it, upload their own file, and the agent replans from the intent.

---

## What's NOT in This Design

- **No client-side DOM automation** — all agent actions are server-side typed actions
- **No recorded macro playback** — skills are intent-only, replanned each time
- **No auto-cleanup of unused skills** — users manage their own skill library
- **No page-scoping of MCP resources** — external resources are org-wide, role-governed
- **No changes to AgentRouter algorithm** — uses existing sensitivity x capability x cost routing
- **No changes to Advise/Act toggle behavior** — uses existing binary mode from unified coworker design
- **No streaming bulk operations** — initial implementation returns results after completion; per-row streaming deferred to follow-up spec

---

## Affected Components

### New Files
- `lib/agent-action-types.ts` — `PageAction` (extends `ToolDefinition`), `PageActionManifest` types
- `lib/agent-action-registry.ts` — manifest collector + `getActionsForRoute()` with longest-prefix matching
- `app/(shell)/[route]/actions/manifest.ts` — per-page action manifests (one per instrumented page)
- `lib/actions/user-skills.ts` — user skill CRUD server actions
- `lib/semantic-memory.ts` — new `storeCapabilityKnowledge()` function (structured payload fields) + `lookupCapabilityByFilter()` (scroll-based exact-match lookup)
- Prisma migration for `UserSkill` model
- Post-commit hook for spec/manifest change detection and lifecycle promotion

### Modified Files
- `packages/db/prisma/schema.prisma`:
  - Add `UserSkill` model
  - Add reverse relations: `User.userSkills`, `Team.userSkills`
  - Extend `ModelProvider` with `catalogVisibility` + `catalogEntry`
- `apps/web/components/agent/AgentSkillsDropdown.tsx` — bug fix (`isOpen` default), click-outside listener, sectioned layout (platform / org / team / personal / create), user skill display
- `apps/web/lib/route-context-map.ts` — inject dynamic tools from knowledge + manifest instead of static lists
- `apps/web/lib/actions/agent-coworker.ts` — capability discovery at conversation start (call `getActionsForRoute()` + merge with `getAvailableTools()`), Advise/Act mode filtering on merged set, skill replay logic
- `packages/db/src/qdrant.ts` — add `ensurePayloadIndexes()` function + payload indexes for `route`, `lifecycle_status`, `action_name`, `side_effect`
- Spec indexing workflow (brainstorming/planning skill or dedicated indexer)

### Infrastructure
- Qdrant `platform-knowledge` collection: new payload indexes (route, lifecycle_status, action_name, side_effect)
- Commit hook added to repo

---

## Open Questions

None — all design decisions resolved during brainstorming and spec review.
