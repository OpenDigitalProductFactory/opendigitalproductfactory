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

- **Page Action** — a typed server action that performs a specific operation on a page (create, update, delete, import, etc.). Exposed to the agent as a callable tool.
- **Action Manifest** — a declarative registry of all page actions for a given route, co-located with the page code.
- **Skill** — a stored natural language intent that describes a reusable goal with constraints. Not a recorded macro. The agent re-plans from the intent each time.
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

Each spec, when indexed into Qdrant, includes:

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

### When the Platform Changes

The indexing lifecycle:

1. **Spec written** (brainstorming/planning workflow) — indexed into Qdrant with `lifecycle: planned` and route tags. The agent knows about planned capabilities as soon as the spec is written.
2. **Implementation begins** — lifecycle updates to `build`
3. **Server action created** — action registered in the page's action manifest
4. **Deployed / promoted** — lifecycle updates to `production`, action becomes executable
5. **Next conversation** — agent discovers the new capability via knowledge query

### Commit Hook Safety Net

A post-commit hook scans for changes to:
- Spec files (`docs/superpowers/specs/`) — queues re-index if not already indexed
- Action manifests (`app/**/actions/manifest.ts`) — warns if new actions lack a corresponding spec

This catches anything the primary workflow missed.

---

## Section 2: Page Automation — Server Actions with Reactive UI

### Action Categories

Every user-facing operation on a page is backed by a typed server action. Categories:

- **CRUD** — create, read, update, delete entities
- **Bulk operations** — import from file, batch update, batch delete
- **Navigation** — open sub-screens, switch tabs, expand detail panels
- **State transitions** — lifecycle changes, status updates, approvals

### Reactive UI Feedback

When the agent executes actions, the user watches in real time:

1. **Row-level highlights** — new or modified rows flash briefly with a coworker indicator
2. **Running status** — "Adding employee 3 of 10..." in the chat panel or as a toast notification
3. **Action badges** — items touched by the agent show a subtle "AI" badge for that session
4. **Error surfacing** — if an action fails mid-sequence, the agent pauses, shows what failed, and asks how to proceed

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
// app/(app)/employees/actions/manifest.ts
import type { PageActionManifest } from "@/lib/agent-action-types";

export const employeeActions: PageActionManifest = {
  route: "/employees",
  actions: [
    {
      name: "create_employee",
      description: "Create a new employee profile with name, email, department, and role",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name" },
          email: { type: "string", description: "Email address" },
          department: { type: "string", description: "Department name" },
          role: { type: "string", description: "Job title / role" },
        },
        required: ["name", "email"],
      },
      capability: "manage_employees",
      sideEffect: true,
      specRef: "EP-EMP-001",
    },
    {
      name: "bulk_import_employees",
      description: "Parse an uploaded spreadsheet and create employee records for each row",
      parameters: {
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
      capability: "manage_employees",
      sideEffect: true,
      specRef: "EP-EMP-002",
    },
  ],
};
```

### Type Definition

```typescript
// lib/agent-action-types.ts

export type PageAction = {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  capability: string | null;           // null = ungated
  sideEffect: boolean;
  specRef: string;                     // links to originating spec
};

export type PageActionManifest = {
  route: string;
  actions: PageAction[];
};
```

### Discovery at Runtime

A registry module collects all page manifests:

```typescript
// lib/agent-action-registry.ts
import { employeeActions } from "@/app/(app)/employees/actions/manifest";
import { portfolioActions } from "@/app/(app)/portfolio/actions/manifest";
// ... other pages

const manifests: PageActionManifest[] = [
  employeeActions,
  portfolioActions,
  // ...
];

export function getActionsForRoute(route: string, userContext: UserContext): PageAction[] {
  const manifest = manifests.find((m) => route.startsWith(m.route));
  if (!manifest) return [];
  return manifest.actions.filter(
    (a) => a.capability === null || can(userContext, a.capability)
  );
}
```

---

## Section 4: User-Created Skills System

### Data Model

New Prisma model:

```prisma
model AgentSkill {
  id          String   @id @default(cuid())
  skillId     String   @unique  // "SK-XXXXX" human-readable
  name        String             // short label, e.g. "Import employees from spreadsheet"
  intent      String   @db.Text  // natural language goal + constraints
  constraints String[] @default([])  // explicit constraints as a list
  tags        String[] @default([])  // searchable tags
  routeHint   String?            // route where it was created (informational, not binding)
  visibility  String   @default("personal")  // personal | team | org
  teamId      String?            // set when visibility = "team"
  team        Team?    @relation(fields: [teamId], references: [teamId])
  createdById String
  createdBy   User     @relation(fields: [createdById], references: [id])
  usageCount  Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([createdById])
  @@index([visibility])
  @@index([routeHint])
}
```

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
4. Agent drafts the intent from the conversation context
5. User reviews/edits the intent and confirms

**Path 2: User-initiated** — From the skills dropdown:
1. User selects "Create a skill..."
2. User describes the goal in natural language
3. Agent helps refine the intent (suggests constraints, clarifies edge cases)
4. User confirms and sets visibility

### How Skills Are Replayed

When a user selects a skill from the dropdown:
1. Agent reads the intent
2. Queries knowledge for current page capabilities
3. Builds a plan from the intent against available tools
4. In **Advise** mode: presents the plan — "Here's what I'd do: [steps]. Approve?"
5. In **Act** mode: executes the plan, pausing if inputs are needed ("Please upload the spreadsheet")
6. If tools needed by the intent aren't available, agent explains: "I can do steps 1 and 3, but step 2 requires [bulk import] which isn't implemented yet"
7. `usageCount` increments on execution

### Skills Dropdown Redesign

The `AgentSkillsDropdown` component changes:

**Bug fix:** Initialize `isOpen` to `false` (currently `true`). Add click-outside listener for reliable close behavior.

**Sections** (in display order):
1. **Platform Skills** — derived from specs/knowledge, the current skill chips
2. **Org Skills** — visibility = `org`, available to everyone
3. **Team Skills** — visibility = `team`, filtered to user's team
4. **My Skills** — visibility = `personal`, filtered to current user
5. **Create a skill...** — action item at the bottom

Each skill shows:
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

### Resource Status Categories

Each MCP resource in the registry has a status:

| Status | Meaning | Agent Behavior |
|--------|---------|----------------|
| `active` | Registered, enabled, usable | Agent can use it |
| `available` | Exists in catalog, not yet enabled/paid | Agent mentions it when relevant: "I could do this with [Web Search], but it's not enabled. Want me to flag this to your admin?" |
| `restricted` | Active, but user's HR role doesn't permit | Agent doesn't surface it |

### Provider Registry Extension

The existing `ModelProvider` schema gains:

```prisma
// Addition to existing ModelProvider fields
resourceStatus  String   @default("active")  // active | available | restricted
catalogEntry    Json?    // for "available" status: what this service does, pricing info, enable URL
```

### Discovery UX

When the agent builds its tool manifest, it includes a separate "available but not enabled" section in its context. The agent uses this to make informed suggestions:

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
2. Index into Qdrant with `lifecycle: planned`
3. Tag with route associations and the spec reference ID

This means the agent knows about a capability as soon as it's designed — before implementation begins.

### Lifecycle Transitions

| Event | Lifecycle Update | Agent Behavior |
|-------|-----------------|----------------|
| Spec written | `planned` | "This is planned but not built yet" |
| Implementation starts | `build` | "This is being built" |
| Server action created + manifest updated | `production` | Tool is executable |

### Commit Hook Safety Net

A post-commit hook (`.git/hooks/post-commit` or CI step):

1. Scans for changed spec files in `docs/superpowers/specs/`
2. Checks if the spec is indexed in Qdrant
3. If not indexed: queues a re-index job
4. Scans for new/changed action manifests (`**/actions/manifest.ts`)
5. If a manifest action has no corresponding spec: logs a warning

This catch-all ensures knowledge stays current even if the primary workflow is bypassed.

---

## Section 7: End-to-End Example

**Scenario:** User on `/employees` in Act mode uploads a spreadsheet with 10 employees.

1. **Conversation starts** — system queries Qdrant for `/employees` capabilities, reads the employee action manifest. Agent's tool set includes `create_employee`, `bulk_import_employees`, `update_employee`, etc.

2. **User uploads file** — "Add these employees please."

3. **Agent plans** — reads the file, maps columns to employee fields, determines `bulk_import_employees` is the right tool (or falls back to 10x `create_employee` if bulk isn't available yet).

4. **Agent executes** — calls the server action. UI shows: row 1 appears (highlighted), "Adding employee 1 of 10...", row 2 appears, etc. Each action logged to `AuthorizationDecisionLog`.

5. **Agent offers skill** — "Done! All 10 employees added. Would you like to save this as a reusable skill for next time?"

6. **User accepts** — "Yes, for my team."

7. **Agent saves skill**:
   - Name: "Import employees from spreadsheet"
   - Intent: "Parse an uploaded spreadsheet containing employee data. Map columns to employee fields (name, email, department, role). Validate required fields are present. Create employee records for each row. Report any rows that failed validation."
   - Visibility: team
   - Route hint: /employees

8. **Next time** — a teammate on `/employees` sees "Import employees from spreadsheet" under Team Skills in the dropdown. They select it, upload their own file, and the agent replans from the intent.

---

## What's NOT in This Design

- **No client-side DOM automation** — all agent actions are server-side typed actions
- **No recorded macro playback** — skills are intent-only, replanned each time
- **No auto-cleanup of unused skills** — users manage their own skill library
- **No page-scoping of MCP resources** — external resources are org-wide, role-governed
- **No changes to AgentRouter algorithm** — uses existing sensitivity x capability x cost routing
- **No changes to Advise/Act toggle behavior** — uses existing binary mode from unified coworker design

---

## Affected Components

### New Files
- `lib/agent-action-types.ts` — `PageAction`, `PageActionManifest` types
- `lib/agent-action-registry.ts` — manifest collector + `getActionsForRoute()`
- `app/(app)/[route]/actions/manifest.ts` — per-page action manifests (one per instrumented page)
- `lib/actions/agent-skills.ts` — skill CRUD server actions
- Prisma migration for `AgentSkill` model
- Post-commit hook for spec/manifest change detection

### Modified Files
- `packages/db/prisma/schema.prisma` — add `AgentSkill` model, extend `ModelProvider` with `resourceStatus` + `catalogEntry`
- `apps/web/components/agent/AgentSkillsDropdown.tsx` — bug fix (`isOpen` default), sections, click-outside, user skills
- `apps/web/lib/route-context-map.ts` — inject dynamic tools from knowledge + manifest instead of static lists
- `apps/web/lib/agent-coworker-types.ts` — extend `AgentSkill` type for user skills
- `apps/web/lib/actions/agent-coworker.ts` — capability discovery at conversation start, skill replay logic
- Spec indexing workflow (brainstorming/planning skill or dedicated indexer)

### Infrastructure
- Qdrant collection schema extended for capability metadata fields
- Commit hook added to repo

---

## Open Questions

None — all design decisions resolved during brainstorming.
