# EP-AGENT-CAP-001: Knowledge-Driven Agent Capabilities — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static agent tool lists with knowledge-driven capability discovery, add user-created intent-based skills, expose page actions as typed server action tools, and surface MCP external resources with upgrade paths.

**Architecture:** Five layered components: (1) Qdrant capability indexing with payload indexes, exported `scrollPoints()` helper, and scroll-based lookup, (2) `PageAction` type extending existing `ToolDefinition` with co-located per-page action manifests, (3) action registry with longest-prefix matching feeding into the existing `sendMessage()` tool pipeline, (4) `UserSkill` Prisma model with intent-based CRUD and sectioned dropdown UI, (5) `catalogVisibility` field on `ModelProvider` for MCP resource discoverability.

**Tech Stack:** Next.js 14 (App Router, server actions), Prisma (PostgreSQL), Qdrant (vector DB), TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-03-18-knowledge-driven-agent-capabilities-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/agent-action-types.ts` | `PageAction` (extends `ToolDefinition`) and `PageActionManifest` types |
| `apps/web/lib/agent-action-types.test.ts` | Type compatibility tests |
| `apps/web/lib/agent-action-registry.ts` | Manifest collector + `getActionsForRoute()` with longest-prefix matching |
| `apps/web/lib/agent-action-registry.test.ts` | Registry lookup and filtering tests |
| `apps/web/app/(shell)/employee/actions/manifest.ts` | Employee page action manifest (first instrumented page) |
| `apps/web/app/(shell)/employee/actions/manifest.test.ts` | Manifest structure validation |
| `apps/web/lib/actions/user-skills.ts` | User skill CRUD server actions |
| `apps/web/lib/actions/user-skills.test.ts` | Skill CRUD tests |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `UserSkill` model + reverse relations on `User` and `Team` + `catalogVisibility`/`catalogEntry` on `ModelProvider` |
| `packages/db/src/qdrant.ts` | Add `ensurePayloadIndexes()`, export `scrollPoints()` and `hashToNumber()` |
| `apps/web/lib/semantic-memory.ts` | Add `storeCapabilityKnowledge()` and `lookupCapabilityByFilter()` |
| `apps/web/lib/semantic-memory.test.ts` | Tests for new capability functions |
| `apps/web/lib/actions/agent-coworker.ts` | Wire `getActionsForRoute()` into `sendMessage()` tool assembly with unified mode filtering |
| `apps/web/components/agent/AgentSkillsDropdown.tsx` | Bug fix + click-outside + sectioned layout + user skills |
| `apps/web/components/agent/AgentSkillsDropdown.test.tsx` | Sectioned rendering tests |
| `apps/web/components/agent/AgentPanelHeader.tsx` | Pass user skills data to dropdown |

### Test Files

| File | Tests |
|------|-------|
| `apps/web/lib/agent-action-types.test.ts` | PageAction extends ToolDefinition, manifest structure validation |
| `apps/web/lib/agent-action-registry.test.ts` | Longest-prefix matching, capability filtering, empty manifests |
| `apps/web/app/(shell)/employee/actions/manifest.test.ts` | Manifest structure: valid routes, specRef present, correct capabilities |
| `apps/web/lib/actions/user-skills.test.ts` | Skill CRUD, visibility filtering, team scoping, ID generation |
| `apps/web/lib/semantic-memory.test.ts` | storeCapabilityKnowledge payload structure, lookupCapabilityByFilter scroll |
| `apps/web/components/agent/AgentSkillsDropdown.test.tsx` | Sections render correctly, isOpen defaults to false |

---

## Task 1: Qdrant Payload Indexes and Exported Helpers

**Files:**
- Modify: `packages/db/src/qdrant.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/qdrant.test.ts (add to existing or create)
import { describe, expect, it } from "vitest";

describe("qdrant exports", () => {
  it("exports ensurePayloadIndexes", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.ensurePayloadIndexes).toBe("function");
  });

  it("exports scrollPoints for filter-only queries", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.scrollPoints).toBe("function");
  });

  it("exports hashToNumber for point ID generation", async () => {
    const mod = await import("./qdrant");
    expect(typeof mod.hashToNumber).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/db && pnpm test -- --grep "qdrant exports"`
Expected: FAIL — `ensurePayloadIndexes` and `scrollPoints` not exported

- [ ] **Step 3: Export `hashToNumber` (already exists but is not exported)**

In `packages/db/src/qdrant.ts`, find the existing `hashToNumber` function (used internally by `upsertVectors`) and add `export` keyword:

```ts
export function hashToNumber(str: string): number {
  // existing implementation
}
```

- [ ] **Step 4: Implement and export `scrollPoints()`**

Add to `packages/db/src/qdrant.ts`:

```ts
/**
 * Scroll-based point lookup with payload filters. No embedding vector required.
 * Use this for exact-match lookups (e.g., "find all capabilities with action_name X").
 * Distinct from searchSimilar() which requires an embedding vector.
 */
export async function scrollPoints(
  collection: string,
  filter: { must: Array<Record<string, unknown>> },
  limit = 100,
): Promise<Array<{ id: number; payload: Record<string, unknown> }>> {
  const result = await qdrantFetch(
    `/collections/${collection}/points/scroll`,
    {
      method: "POST",
      body: { filter, limit, with_payload: true },
    },
  ) as { result?: { points?: Array<{ id: number; payload: Record<string, unknown> }> } };
  return result.result?.points ?? [];
}
```

- [ ] **Step 5: Implement and export `ensurePayloadIndexes()`**

```ts
/**
 * Idempotently ensures all required payload indexes exist on platform-knowledge.
 * Qdrant PUT index ignores duplicates, so this is safe to call on every startup.
 * Separate from ensureCollections() because indexes need to be added to
 * existing collections, not just new ones.
 */
export async function ensurePayloadIndexes(): Promise<void> {
  const keywordFields = ["route", "lifecycle_status", "action_name", "spec_ref"];
  const boolFields = ["side_effect"];

  for (const field of keywordFields) {
    await qdrantFetch(
      `/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}/index`,
      { method: "PUT", body: { field_name: field, field_schema: "keyword" } },
    ).catch(() => {});
  }

  for (const field of boolFields) {
    await qdrantFetch(
      `/collections/${COLLECTIONS.PLATFORM_KNOWLEDGE}/index`,
      { method: "PUT", body: { field_name: field, field_schema: "bool" } },
    ).catch(() => {});
  }
}
```

- [ ] **Step 6: Verify exports from package index**

Check `packages/db/src/index.ts` and ensure `ensurePayloadIndexes`, `scrollPoints`, and `hashToNumber` are re-exported.

- [ ] **Step 7: Run test to verify it passes**

Run: `cd packages/db && pnpm test -- --grep "qdrant exports"`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/qdrant.ts packages/db/src/qdrant.test.ts packages/db/src/index.ts
git commit -m "feat(db): add ensurePayloadIndexes, scrollPoints, export hashToNumber"
```

---

## Task 2: Capability Knowledge Storage and Lookup Functions

**Files:**
- Modify: `apps/web/lib/semantic-memory.ts`
- Create/Modify: `apps/web/lib/semantic-memory.test.ts`

- [ ] **Step 1: Write failing tests for storeCapabilityKnowledge**

```ts
// apps/web/lib/semantic-memory.test.ts (add to existing or create)
import { describe, expect, it, vi } from "vitest";

// Mock the qdrant and embedding dependencies
vi.mock("@dpf/db", () => ({
  upsertVectors: vi.fn(),
  scrollPoints: vi.fn().mockResolvedValue([]),
  hashToNumber: vi.fn().mockReturnValue(12345),
  QDRANT_COLLECTIONS: { PLATFORM_KNOWLEDGE: "platform-knowledge" },
}));

vi.mock("./embedding", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(768).fill(0.1)),
}));

describe("storeCapabilityKnowledge", () => {
  it("generates point ID as capability-{specRef}-{actionName}", async () => {
    const { upsertVectors } = await import("@dpf/db");
    const { storeCapabilityKnowledge } = await import("./semantic-memory");

    await storeCapabilityKnowledge({
      specRef: "EP-EMP-001",
      actionName: "create_employee",
      route: "/employee",
      description: "Create a new employee",
      parameterSummary: "name, email required",
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      lifecycleStatus: "planned",
    });

    expect(upsertVectors).toHaveBeenCalledWith(
      "platform-knowledge",
      expect.arrayContaining([
        expect.objectContaining({
          id: "capability-EP-EMP-001-create_employee",
          payload: expect.objectContaining({
            entityType: "capability",
            route: "/employee",
            action_name: "create_employee",
            lifecycle_status: "planned",
            side_effect: true,
            spec_ref: "EP-EMP-001",
          }),
        }),
      ]),
    );
  });
});

describe("lookupCapabilityByFilter", () => {
  it("calls scrollPoints with payload filter conditions", async () => {
    const { scrollPoints } = await import("@dpf/db");
    const { lookupCapabilityByFilter } = await import("./semantic-memory");

    await lookupCapabilityByFilter({ route: "/employee", lifecycleStatus: "production" });

    expect(scrollPoints).toHaveBeenCalledWith(
      "platform-knowledge",
      {
        must: [
          { key: "route", match: { value: "/employee" } },
          { key: "lifecycle_status", match: { value: "production" } },
        ],
      },
      100,
    );
  });

  it("returns empty array when no filters provided", async () => {
    const { lookupCapabilityByFilter } = await import("./semantic-memory");
    const result = await lookupCapabilityByFilter({});
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- --grep "storeCapabilityKnowledge|lookupCapabilityByFilter"`
Expected: FAIL — functions not defined

- [ ] **Step 3: Implement storeCapabilityKnowledge**

Add to `apps/web/lib/semantic-memory.ts`:

```ts
export async function storeCapabilityKnowledge(params: {
  specRef: string;
  actionName: string;
  route: string;
  description: string;
  parameterSummary: string;
  requiredCapability: string | null;
  sideEffect: boolean;
  lifecycleStatus: "planned" | "build" | "production";
}): Promise<void> {
  const text = `${params.actionName}: ${params.description}`;
  const embedding = await generateEmbedding(text);
  if (!embedding) return;

  await upsertVectors(QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE, [
    {
      id: `capability-${params.specRef}-${params.actionName}`,
      vector: embedding,
      payload: {
        entityId: params.actionName,
        entityType: "capability",
        title: params.description,
        contentPreview: params.parameterSummary.slice(0, 300),
        route: params.route,
        action_name: params.actionName,
        lifecycle_status: params.lifecycleStatus,
        side_effect: params.sideEffect,
        spec_ref: params.specRef,
        required_capability: params.requiredCapability ?? "",
        parameter_summary: params.parameterSummary,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}
```

- [ ] **Step 4: Implement lookupCapabilityByFilter**

Uses the newly exported `scrollPoints()` from `@dpf/db` — no direct `qdrantFetch` call needed:

```ts
import { scrollPoints, QDRANT_COLLECTIONS } from "@dpf/db";

export async function lookupCapabilityByFilter(filter: {
  specRef?: string;
  actionName?: string;
  route?: string;
  lifecycleStatus?: string;
}): Promise<Array<{ actionName: string; specRef: string; lifecycleStatus: string; route: string }>> {
  const conditions: Array<Record<string, unknown>> = [];
  if (filter.specRef) conditions.push({ key: "spec_ref", match: { value: filter.specRef } });
  if (filter.actionName) conditions.push({ key: "action_name", match: { value: filter.actionName } });
  if (filter.route) conditions.push({ key: "route", match: { value: filter.route } });
  if (filter.lifecycleStatus) conditions.push({ key: "lifecycle_status", match: { value: filter.lifecycleStatus } });

  if (conditions.length === 0) return [];

  const points = await scrollPoints(
    QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE,
    { must: conditions },
    100,
  );

  return points.map((p) => ({
    actionName: String(p.payload["action_name"] ?? ""),
    specRef: String(p.payload["spec_ref"] ?? ""),
    lifecycleStatus: String(p.payload["lifecycle_status"] ?? ""),
    route: String(p.payload["route"] ?? ""),
  }));
}
```

- [ ] **Step 5: Implement updateCapabilityLifecycle**

Uses the newly exported `hashToNumber()` from `@dpf/db` and the existing `upsertVectors` pattern. Since Qdrant's set-payload endpoint requires the numeric point ID:

```ts
import { hashToNumber, QDRANT_COLLECTIONS } from "@dpf/db";

export async function updateCapabilityLifecycle(
  specRef: string,
  actionName: string,
  newStatus: "planned" | "build" | "production",
): Promise<void> {
  // Re-index with updated lifecycle. lookupCapabilityByFilter finds the existing
  // entry, then we re-store with the new status (upsert overwrites by point ID).
  const existing = await lookupCapabilityByFilter({ specRef, actionName });
  if (existing.length === 0) return;

  // The simplest approach: update the payload field via Qdrant's set-payload API.
  // We construct this as a direct fetch since the point ID is known.
  const pointId = `capability-${specRef}-${actionName}`;
  // Note: the actual Qdrant call uses the hashed numeric ID from upsertVectors.
  // The implementer should verify how upsertVectors resolves string IDs to numeric IDs
  // and use the same mechanism here. If upsertVectors uses hashToNumber internally,
  // then: scrollPoints returns the numeric ID directly — use that instead.
}
```

**Implementation note:** The exact Qdrant set-payload call depends on how the existing `upsertVectors()` converts string IDs to numeric IDs. The implementer should trace the `upsertVectors` function (in `packages/db/src/qdrant.ts`) to verify. The safest approach: use `lookupCapabilityByFilter()` to get the numeric point ID from the scroll response, then call the Qdrant set-payload endpoint with that ID.

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- --grep "storeCapabilityKnowledge|lookupCapabilityByFilter"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/semantic-memory.ts apps/web/lib/semantic-memory.test.ts
git commit -m "feat: add capability knowledge storage and scroll-based lookup"
```

---

## Task 3: PageAction Type and Action Manifest Types

**Files:**
- Create: `apps/web/lib/agent-action-types.ts`
- Create: `apps/web/lib/agent-action-types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/agent-action-types.test.ts
import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "./mcp-tools";
import type { PageAction, PageActionManifest } from "./agent-action-types";

describe("PageAction type", () => {
  it("is assignable to ToolDefinition (structural subtype)", () => {
    const action: PageAction = {
      name: "create_employee",
      description: "Create an employee",
      inputSchema: { type: "object", properties: {} },
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-EMP-001",
    };

    // PageAction must be usable as ToolDefinition
    const tool: ToolDefinition = action;
    expect(tool.name).toBe("create_employee");
    expect(tool.inputSchema).toBeDefined();
  });

  it("requires specRef field", () => {
    const manifest: PageActionManifest = {
      route: "/employee",
      actions: [
        {
          name: "test",
          description: "test",
          inputSchema: {},
          requiredCapability: null,
          sideEffect: false,
          specRef: "EP-TEST-001",
        },
      ],
    };
    expect(manifest.actions[0].specRef).toBe("EP-TEST-001");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- --grep "PageAction type"`
Expected: FAIL — module not found

- [ ] **Step 3: Create the types file**

```ts
// apps/web/lib/agent-action-types.ts
import type { ToolDefinition } from "@/lib/mcp-tools";

/**
 * A page-specific action that extends ToolDefinition with spec traceability.
 * PageAction instances are directly usable as ToolDefinition (structural subtype).
 */
export type PageAction = ToolDefinition & {
  /** Links to the originating spec (e.g., EP-EMP-001) */
  specRef: string;
};

export type PageActionManifest = {
  /** Route prefix this manifest applies to (e.g., "/employee") */
  route: string;
  /** Available actions on this page */
  actions: PageAction[];
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- --grep "PageAction type"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-action-types.ts apps/web/lib/agent-action-types.test.ts
git commit -m "feat: add PageAction and PageActionManifest types"
```

---

## Task 4: Action Registry with Longest-Prefix Matching

**Files:**
- Create: `apps/web/lib/agent-action-registry.ts`
- Create: `apps/web/lib/agent-action-registry.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/lib/agent-action-registry.test.ts
import { describe, expect, it } from "vitest";
import { getActionsForRoute } from "./agent-action-registry";

// HR-000 = admin (has all capabilities), HR-500 = ops role (limited capabilities)
const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };
const opsUser = { userId: "u-2", platformRole: "HR-500", isSuperuser: false };

describe("getActionsForRoute", () => {
  it("returns actions for matching route", () => {
    const actions = getActionsForRoute("/employee", adminUser);
    expect(Array.isArray(actions)).toBe(true);
  });

  it("returns empty array for unregistered routes", () => {
    const actions = getActionsForRoute("/nonexistent", adminUser);
    expect(actions).toEqual([]);
  });

  it("matches sub-routes via longest-prefix", () => {
    const actions = getActionsForRoute("/employee/details", adminUser);
    // Should match /employee manifest
    expect(Array.isArray(actions)).toBe(true);
  });

  it("does not match partial route names", () => {
    // /employee-settings should NOT match /employee
    const actions = getActionsForRoute("/employee-settings", adminUser);
    expect(actions).toEqual([]);
  });

  it("filters by user capability", () => {
    const adminActions = getActionsForRoute("/employee", adminUser);
    const opsActions = getActionsForRoute("/employee", opsUser);
    // Ops role (HR-500) has view_employee but not manage_user_lifecycle
    // So ops should see fewer or equal actions
    expect(opsActions.length).toBeLessThanOrEqual(adminActions.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- --grep "getActionsForRoute"`
Expected: FAIL — module not found

- [ ] **Step 3: Create the registry**

```ts
// apps/web/lib/agent-action-registry.ts
import type { PageAction, PageActionManifest } from "@/lib/agent-action-types";
import { can, type UserContext } from "@/lib/permissions";

// Import manifests as they are created — each page adds its manifest here
const manifests: PageActionManifest[] = [
  // Will be populated in Task 5
];

/**
 * Returns page actions available for a route, filtered by user capability.
 * Uses longest-prefix matching consistent with resolveRouteContext().
 * The match requires exact route or route + "/" prefix to prevent
 * "/employee-settings" from matching "/employee".
 */
export function getActionsForRoute(route: string, userContext: UserContext): PageAction[] {
  const match = manifests
    .filter((m) => route === m.route || route.startsWith(m.route + "/"))
    .sort((a, b) => b.route.length - a.route.length)[0];
  if (!match) return [];
  return match.actions.filter(
    (a) => a.requiredCapability === null || can(userContext, a.requiredCapability),
  );
}

/** Register a manifest at import time */
export function registerManifest(manifest: PageActionManifest): void {
  manifests.push(manifest);
}
```

**Note on route matching:** The spec's code example used `route.startsWith(m.route)` which would incorrectly match `/employee-settings` against `/employee`. This implementation adds the `+ "/"` guard, consistent with `resolveRouteContext()` in `route-context-map.ts` (line 350: `pathname === prefix || pathname.startsWith(prefix + "/")`). This is a beneficial deviation from the spec's code example — the spec's *intent* was longest-prefix matching, which this correctly implements.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- --grep "getActionsForRoute"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-action-registry.ts apps/web/lib/agent-action-registry.test.ts
git commit -m "feat: add action registry with longest-prefix matching"
```

---

## Task 5: First Page Action Manifest (Employee)

**Files:**
- Create: `apps/web/app/(shell)/employee/actions/manifest.ts`
- Create: `apps/web/app/(shell)/employee/actions/manifest.test.ts`
- Modify: `apps/web/lib/agent-action-registry.ts` (add import)

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/app/(shell)/employee/actions/manifest.test.ts
import { describe, expect, it } from "vitest";
import { employeeActions } from "./manifest";

describe("employee action manifest", () => {
  it("has route /employee", () => {
    expect(employeeActions.route).toBe("/employee");
  });

  it("has at least one action", () => {
    expect(employeeActions.actions.length).toBeGreaterThan(0);
  });

  it("every action has a specRef", () => {
    for (const action of employeeActions.actions) {
      expect(action.specRef).toBeTruthy();
    }
  });

  it("every action has a valid requiredCapability or null", () => {
    for (const action of employeeActions.actions) {
      expect(
        action.requiredCapability === null || typeof action.requiredCapability === "string"
      ).toBe(true);
    }
  });

  it("side-effect actions use valid capability keys", () => {
    // Use existing CapabilityKey values from permissions.ts
    const validCapabilities = [
      "view_employee", "manage_user_lifecycle", "manage_users",
      "view_operations", "manage_backlog", null,
    ];
    for (const action of employeeActions.actions) {
      if (action.sideEffect) {
        expect(validCapabilities).toContain(action.requiredCapability);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- --grep "employee action manifest"`
Expected: FAIL — module not found

- [ ] **Step 3: Create the employee action manifest**

First, read `apps/web/app/(shell)/employee/page.tsx` and any existing server actions for the employee domain to understand what actions currently exist. Then create the manifest using **existing `CapabilityKey` values only** (`view_employee`, `manage_user_lifecycle`, `manage_users`):

```ts
// apps/web/app/(shell)/employee/actions/manifest.ts
import type { PageActionManifest } from "@/lib/agent-action-types";

export const employeeActions: PageActionManifest = {
  route: "/employee",
  actions: [
    {
      name: "query_employees",
      description: "Search and list employee profiles with optional filters by name, department, or role",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search by name or email" },
          department: { type: "string", description: "Filter by department" },
        },
      },
      requiredCapability: "view_employee",
      sideEffect: false,
      specRef: "EP-AGENT-CAP-001",
    },
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
      requiredCapability: "manage_user_lifecycle",
      sideEffect: true,
      specRef: "EP-AGENT-CAP-001",
    },
  ],
};
```

**Important:** The implementer must read the existing employee page and server actions to determine the actual available operations. The actions above are illustrative — adjust to match what the page actually supports.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm test -- --grep "employee action manifest"`
Expected: PASS

- [ ] **Step 5: Register in the action registry**

Add import to `apps/web/lib/agent-action-registry.ts`:

```ts
import { employeeActions } from "@/app/(shell)/employee/actions/manifest";

const manifests: PageActionManifest[] = [
  employeeActions,
];
```

- [ ] **Step 6: Run registry tests to confirm integration**

Run: `cd apps/web && pnpm test -- --grep "getActionsForRoute"`
Expected: PASS — tests should now return actual employee actions

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/(shell)/employee/actions/manifest.ts apps/web/app/(shell)/employee/actions/manifest.test.ts apps/web/lib/agent-action-registry.ts
git commit -m "feat: add employee page action manifest"
```

---

## Task 6: Wire Page Actions into sendMessage Tool Pipeline

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Write the integration test**

```ts
// Add to apps/web/lib/mcp-tools.test.ts
import { getActionsForRoute } from "./agent-action-registry";

describe("page action integration", () => {
  it("getActionsForRoute returns ToolDefinition-compatible objects", () => {
    const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };
    const actions = getActionsForRoute("/employee", adminUser);

    for (const action of actions) {
      expect(action).toHaveProperty("name");
      expect(action).toHaveProperty("description");
      expect(action).toHaveProperty("inputSchema");
      expect(action).toHaveProperty("requiredCapability");
      expect(action).toHaveProperty("specRef");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (structural compatibility already guaranteed by type system)

Run: `cd apps/web && pnpm test -- --grep "page action integration"`
Expected: PASS — this test validates the runtime shape, not just types

- [ ] **Step 3: Wire into sendMessage with unified mode filtering**

Modify `apps/web/lib/actions/agent-coworker.ts` around the tool assembly section (~line 362-370).

**The key change:** Pass `mode: undefined` to `getAvailableTools()` so it returns all tools without mode filtering. Then merge with page actions and filter the combined set once:

```ts
import { getActionsForRoute } from "@/lib/agent-action-registry";

// Get ALL platform tools (no mode filtering — we filter the merged set below)
const allPlatformTools = getAvailableTools({
  platformRole: user.platformRole,
  isSuperuser: user.isSuperuser,
}, {
  externalAccessEnabled: input.externalAccessEnabled === true,
  mode: undefined,  // Skip mode filtering here — applied to merged set
  unifiedMode: useUnified,
});

// Get page-specific actions
const pageActions = getActionsForRoute(input.routeContext, {
  userId: user.id!,
  platformRole: user.platformRole,
  isSuperuser: user.isSuperuser,
});

// Merge and apply mode filtering once to the combined set
const mergedTools = [...allPlatformTools, ...pageActions];
const availableTools = input.coworkerMode === "advise"
  ? mergedTools.filter((t) => !t.sideEffect)
  : mergedTools;

const toolsForProvider = availableTools.length > 0 ? toolsToOpenAIFormat(availableTools) : undefined;
```

**Note:** Verify that `getAvailableTools()` with `mode: undefined` returns all tools regardless of sideEffect. Check the filtering logic at `mcp-tools.ts:675`: `(options?.mode !== "advise" || !tool.sideEffect)`. When `mode` is `undefined`, `undefined !== "advise"` is `true`, so all tools pass — correct.

- [ ] **Step 4: Update the `availableTools` variable reference in the rest of sendMessage**

The existing code passes `availableTools` to `runAgenticLoop()` at ~line 454. The variable name hasn't changed, so no further edits needed. Verify by searching for `availableTools` references in the function.

- [ ] **Step 5: Run full test suite**

Run: `cd apps/web && pnpm test`
Expected: PASS — no regressions

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/mcp-tools.test.ts
git commit -m "feat: wire page actions into sendMessage tool pipeline"
```

---

## Task 7: Prisma Schema — UserSkill Model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add UserSkill model to schema**

Add at the end of `schema.prisma`:

```prisma
model UserSkill {
  id          String   @id @default(cuid())
  skillId     String   @unique  // "SK-XXXXX" human-readable
  name        String
  intent      String   @db.Text
  constraints String[] @default([])
  tags        String[] @default([])
  routeHint   String?
  visibility  String   @default("personal")  // personal | team | org
  teamId      String?
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

- [ ] **Step 2: Add reverse relations**

On the `User` model, add:
```prisma
  userSkills        UserSkill[]   @relation("UserSkillCreator")
```

On the `Team` model, add:
```prisma
  userSkills        UserSkill[]
```

- [ ] **Step 3: Add catalogVisibility and catalogEntry to ModelProvider**

Find the `ModelProvider` model (~line 704) and add after the existing fields:
```prisma
  catalogVisibility  String   @default("visible")   // visible | hidden
  catalogEntry       Json?    // for unconfigured services: description, pricing, enable URL
```

- [ ] **Step 4: Generate and run migration**

```bash
cd packages/db && pnpm migrate -- --name add_user_skill_and_catalog_visibility
```

- [ ] **Step 5: Verify migration succeeded**

```bash
cd packages/db && pnpm generate
```

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add UserSkill model and catalogVisibility on ModelProvider"
```

---

## Task 8: User Skill CRUD Server Actions

**Files:**
- Create: `apps/web/lib/actions/user-skills.ts`
- Create: `apps/web/lib/actions/user-skills.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/web/lib/actions/user-skills.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    userSkill: {
      create: vi.fn().mockResolvedValue({ skillId: "SK-00001", name: "Test Skill" }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ skillId: "SK-00001", createdById: "user-1" }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([{ teamId: "team-1" }]),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
  }),
}));

describe("user skill CRUD", () => {
  it("generateSkillId returns SK-XXXXXXXX format (8 chars for collision safety)", async () => {
    const { generateSkillId } = await import("./user-skills");
    const id = generateSkillId();
    expect(id).toMatch(/^SK-[A-Z0-9]{8}$/);
  });

  it("generates unique IDs on successive calls", async () => {
    const { generateSkillId } = await import("./user-skills");
    const ids = new Set(Array.from({ length: 100 }, () => generateSkillId()));
    expect(ids.size).toBe(100);
  });

  it("createUserSkill saves intent-based skill", async () => {
    const { createUserSkill } = await import("./user-skills");
    const result = await createUserSkill({
      name: "Import employees",
      intent: "Parse spreadsheet and create employee records",
      visibility: "personal",
    });
    expect(result).toHaveProperty("skillId");
  });

  it("getUserSkillsForDropdown returns array", async () => {
    const { getUserSkillsForDropdown } = await import("./user-skills");
    const skills = await getUserSkillsForDropdown({ routeHint: "/employee" });
    expect(Array.isArray(skills)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm test -- --grep "user skill CRUD"`
Expected: FAIL — module not found

- [ ] **Step 3: Implement user-skills.ts**

```ts
// apps/web/lib/actions/user-skills.ts
"use server";

import * as crypto from "crypto";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";

/** Generate SK-XXXXXXXX (8 hex chars = 32 bits of entropy, collision-safe to ~65k skills) */
export function generateSkillId(): string {
  return `SK-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function createUserSkill(input: {
  name: string;
  intent: string;
  constraints?: string[];
  tags?: string[];
  routeHint?: string;
  visibility: "personal" | "team" | "org";
  teamId?: string;
}) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  return prisma.userSkill.create({
    data: {
      skillId: generateSkillId(),
      name: input.name,
      intent: input.intent,
      constraints: input.constraints ?? [],
      tags: input.tags ?? [],
      routeHint: input.routeHint ?? null,
      visibility: input.visibility,
      teamId: input.visibility === "team" ? input.teamId : null,
      createdById: session.user.id,
    },
  });
}

export async function getUserSkillsForDropdown(params?: { routeHint?: string }) {
  const session = await auth();
  if (!session?.user?.id) return [];

  const userId = session.user.id;

  // Get user's team IDs
  const memberships = await prisma.teamMembership.findMany({
    where: { userId },
    select: { teamId: true },
  });
  const teamIds = memberships.map((m) => m.teamId);

  // Query: personal (mine) + team (my teams) + org (all)
  const skills = await prisma.userSkill.findMany({
    where: {
      OR: [
        { visibility: "personal", createdById: userId },
        { visibility: "team", teamId: { in: teamIds } },
        { visibility: "org" },
      ],
    },
    orderBy: [
      { usageCount: "desc" },
      { updatedAt: "desc" },
    ],
  });

  return skills;
}

export async function incrementSkillUsage(skillId: string) {
  return prisma.userSkill.update({
    where: { skillId },
    data: { usageCount: { increment: 1 } },
  });
}

export async function deleteUserSkill(skillId: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");

  const skill = await prisma.userSkill.findUnique({ where: { skillId } });
  if (!skill || skill.createdById !== session.user.id) {
    throw new Error("Unauthorized");
  }

  return prisma.userSkill.delete({ where: { skillId } });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- --grep "user skill CRUD"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/user-skills.ts apps/web/lib/actions/user-skills.test.ts
git commit -m "feat: add user skill CRUD server actions"
```

---

## Task 9: Skills Dropdown Bug Fix and Sectioned Redesign

**Files:**
- Modify: `apps/web/components/agent/AgentSkillsDropdown.tsx`
- Create: `apps/web/components/agent/AgentSkillsDropdown.test.tsx`
- Modify: `apps/web/components/agent/AgentPanelHeader.tsx`

- [ ] **Step 1: Write the failing test for the redesigned dropdown**

```tsx
// apps/web/components/agent/AgentSkillsDropdown.test.tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentSkillsDropdown } from "./AgentSkillsDropdown";

const adminUser = { userId: "u-1", platformRole: "HR-000", isSuperuser: false };

const platformSkills = [
  { label: "Create item", description: "Add a backlog item", capability: null, prompt: "Help me create" },
];

const userSkills = [
  {
    id: "1", skillId: "SK-00000001", name: "Import employees",
    intent: "Parse spreadsheet and create employee records for each row",
    constraints: [], tags: [], routeHint: "/employee",
    visibility: "personal", teamId: null, createdById: "u-1",
    usageCount: 5, createdAt: new Date(), updatedAt: new Date(),
  },
];

describe("AgentSkillsDropdown", () => {
  it("renders without being open by default", () => {
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown
        skills={platformSkills}
        userSkills={[]}
        userContext={adminUser}
        onSend={() => {}}
        onCreateSkill={() => {}}
      />,
    );
    // Dropdown content should not be in the initial render
    expect(html).toContain("Skills");
    expect(html).not.toContain("Create item"); // dropdown closed = items not rendered
  });

  it("renders Create a skill action when no user skills exist", () => {
    // The create action should always be present in the dropdown
    // (tested when dropdown is open — but we verify the component accepts the prop)
    const html = renderToStaticMarkup(
      <AgentSkillsDropdown
        skills={[]}
        userSkills={[]}
        userContext={adminUser}
        onSend={() => {}}
        onCreateSkill={() => {}}
      />,
    );
    // With no skills at all, component still renders the trigger button
    expect(html).toContain("Skills");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm test -- --grep "AgentSkillsDropdown"`
Expected: FAIL — component doesn't accept `userSkills` or `onCreateSkill` props yet

- [ ] **Step 3: Fix the isOpen bug**

In `apps/web/components/agent/AgentSkillsDropdown.tsx` line 15, change:
```ts
const [isOpen, setIsOpen] = useState(true);
```
to:
```ts
const [isOpen, setIsOpen] = useState(false);
```

- [ ] **Step 4: Add click-outside listener**

```ts
import { useEffect, useRef, useState } from "react";

// Inside the component:
const containerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!isOpen) return;
  function handleClickOutside(e: MouseEvent) {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setIsOpen(false);
    }
  }
  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
}, [isOpen]);
```

Add `ref={containerRef}` to the outer `<div>`.

- [ ] **Step 5: Add UserSkill props and section rendering**

Update Props type:

```ts
import type { UserSkill } from "@prisma/client";

type Props = {
  skills: AgentSkill[];
  userSkills: UserSkill[];
  userContext: UserContext;
  onSend: (prompt: string) => void;
  onCreateSkill: () => void;
};
```

Render sections in the dropdown body: Platform Skills, then user skills grouped by visibility (Org, Team, My), then "Create a skill..." action at bottom. Each section has a small header label. Sections with no items are hidden. The "Create a skill..." item always shows.

- [ ] **Step 6: Update AgentPanelHeader to pass user skills**

In `apps/web/components/agent/AgentPanelHeader.tsx` (~line 81-85), add `userSkills` and `onCreateSkill` props to the `<AgentSkillsDropdown>` mount. The header will need to receive user skills data from its parent or fetch them via a server action.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd apps/web && pnpm test -- --grep "AgentSkillsDropdown|AgentPanelHeader"`
Expected: PASS (update existing test mocks if needed for new props)

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/agent/AgentSkillsDropdown.tsx apps/web/components/agent/AgentSkillsDropdown.test.tsx apps/web/components/agent/AgentPanelHeader.tsx
git commit -m "fix: skills dropdown starts closed, add click-outside + sectioned layout with user skills"
```

---

## Task 10: MCP Resource Discoverability (catalogVisibility)

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`

This task has no dedicated unit test because it modifies system prompt construction — the verification is via the integration smoke test (Task 12). The system prompt is assembled from dynamic data, and testing it in isolation would require mocking the entire Prisma model, which provides little value over the smoke test.

- [ ] **Step 1: Query available-but-not-enabled resources**

In the system prompt assembly section of `sendMessage()`, after building the tool manifest, query for resources with `catalogVisibility: "visible"` and `status` not `"active"`:

```ts
const availableResources = await prisma.modelProvider.findMany({
  where: {
    catalogVisibility: "visible",
    status: { not: "active" },
    endpointType: "service",
  },
  select: { name: true, catalogEntry: true, costPerformanceNotes: true },
});
```

**Note:** `ModelProvider` has no `description` field. Use `catalogEntry` (JSON, contains service description for unconfigured services) and `costPerformanceNotes` (string) as fallbacks.

- [ ] **Step 2: Inject into system prompt Block 5**

Add a section to the domain tools block:

```ts
if (availableResources.length > 0) {
  const resourceHints = availableResources
    .map((r) => {
      const desc = (r.catalogEntry as Record<string, unknown>)?.description ?? r.costPerformanceNotes ?? "External service";
      return `- ${r.name}: ${desc}`;
    })
    .join("\n");
  domainToolsBlock += `\n\nThe following external services are available but not yet enabled for this organization. If a task would benefit from one, mention it to the user:\n${resourceHints}`;
}
```

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `cd apps/web && pnpm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: surface available-but-not-enabled MCP resources in agent context"
```

---

## Task 11: Seed Data — Update Provider Registry with catalogVisibility

**Files:**
- Modify: `packages/db/data/providers-registry.json`
- Modify: `packages/db/src/seed.ts` (if needed)

No dedicated test — verified by running the seed script successfully. Seed data correctness is validated by the integration smoke test (Task 12).

- [ ] **Step 1: Add catalogVisibility to existing provider entries**

All existing active providers get `"catalogVisibility": "visible"`. Add entries for known-but-not-enabled services (e.g., document parser, advanced code analysis) with `"status": "unconfigured"` and `"catalogVisibility": "visible"` plus a `catalogEntry` JSON:

```json
{
  "providerId": "document-parser",
  "name": "Document Parser",
  "status": "unconfigured",
  "endpointType": "service",
  "catalogVisibility": "visible",
  "catalogEntry": {
    "description": "Extract structured data from PDFs, spreadsheets, and documents",
    "pricingInfo": "Usage-based pricing",
    "enableUrl": "/admin/services"
  }
}
```

- [ ] **Step 2: Update seed script if needed**

Check `packages/db/src/seed.ts` to ensure it handles the new `catalogVisibility` and `catalogEntry` fields during upsert.

- [ ] **Step 3: Run seed to verify**

```bash
cd packages/db && pnpm seed
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/data/providers-registry.json packages/db/src/seed.ts
git commit -m "feat(db): add catalogVisibility to provider registry seed data"
```

---

## Task 12: Integration Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Run full test suite**

```bash
cd apps/web && pnpm test
```

Expected: All tests pass.

- [ ] **Step 2: Run Prisma generate**

```bash
cd packages/db && pnpm generate
```

Expected: No errors.

- [ ] **Step 3: Run build**

```bash
cd apps/web && pnpm build
```

Expected: Build succeeds. If there are type errors from the new imports/exports, fix them.

- [ ] **Step 4: Manual verification**

Start the dev server and verify:
1. Skills dropdown starts closed (bug fix)
2. Skills dropdown closes when clicking outside
3. Agent conversation on `/employee` — agent should have access to page-specific tools
4. No regressions on existing agent conversations

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: integration test fixes for EP-AGENT-CAP-001"
```

---

## Deferred to Follow-Up

These items are **not** in this plan — they require their own spec/plan cycle:

1. **Ops page action manifest** — same pattern as employee, done per-page as needed
2. **Remaining page manifests** — each page gets instrumented progressively
3. **Streaming bulk operations** — requires changes to agentic loop's request-response model
4. **Row-level AI highlights** — UI enhancement for agent-modified rows
5. **Commit hook for spec/manifest change detection** — infrastructure task
6. **Spec indexing workflow integration** — ties into brainstorming/planning skill
7. **Skill replay logic in sendMessage** — agent reads UserSkill intent and re-plans
8. **Skill creation flow in chat** — agent detects multi-step task and offers to save
