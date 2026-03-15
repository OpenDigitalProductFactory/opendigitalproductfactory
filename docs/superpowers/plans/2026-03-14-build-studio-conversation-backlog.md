# EP-SELF-DEV-001B: Build Studio Conversation + Backlog Bridge — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the floating co-worker agent to the Build Studio so it guides users through five phases (Ideate → Plan → Build → Review → Ship), then register shipped features as digital products with version tracking and backlog integration.

**Architecture:** Extend the existing `ROUTE_AGENT_MAP` with a `/build` entry for a Build Specialist agent. Phase-specific context is injected into `sendMessage()` as additional prompt sections (same pattern as `formAssistContext`). The client passes `buildId` explicitly. On Ship, a `shipBuild()` server action creates/updates a `DigitalProduct` with version tracking, creates an `Epic` + `BacklogItem` entries, and destroys the sandbox.

**Tech Stack:** Next.js 14 App Router, Prisma 5, TypeScript (strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), Vitest, React `cache()`.

**Spec:** `docs/superpowers/specs/2026-03-14-build-studio-conversation-integration-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/build-agent-prompts.ts` | Phase-specific prompt templates + brief/tool injection helpers |
| `apps/web/lib/build-agent-prompts.test.ts` | Tests for prompt builders and version bumping |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `DigitalProduct.version`, `FeatureBuild.digitalProductId` FK + reverse relation |
| `apps/web/lib/feature-build-types.ts` | Add `bumpVersion()` helper + types |
| `apps/web/lib/agent-routing.ts` | Add `/build` entry to `ROUTE_AGENT_MAP` + canned responses |
| `apps/web/lib/agent-sensitivity.ts` | Add `/build` → `"internal"` to `ROUTE_SENSITIVITY` |
| `apps/web/lib/actions/agent-coworker.ts` | Add `buildId` to `sendMessage` input type + inject build context into prompt |
| `apps/web/lib/actions/build.ts` | Add `shipBuild()` action chain |
| `apps/web/lib/mcp-tools.ts` | Add `update_feature_brief` (`view_platform`), `register_digital_product_from_build` + `create_build_epic` (`manage_capabilities`) tools |
| `apps/web/lib/mcp-tools.test.ts` | Update tool count assertions |
| `apps/web/lib/feature-build-data.ts` | Add `getFeatureBuildForContext()` fetcher |
| `apps/web/components/build/BuildStudio.tsx` | Dispatch `CustomEvent` with active `buildId` + add `digitalProductId: null` to optimistic object |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Listen for `build-studio-active-build` event + forward `buildId` in `sendMessage` calls |
| `apps/web/app/(shell)/build/page.tsx` | Fix layout height clipping |

---

## Chunk 1: Schema Changes + Version Helper

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:132-148` (DigitalProduct model)
- Modify: `packages/db/prisma/schema.prisma:740-762` (FeatureBuild model)

- [ ] **Step 1: Add `version` to DigitalProduct model**

In `packages/db/prisma/schema.prisma`, find the `DigitalProduct` model and add the `version` field after `lifecycleStatus`, plus the reverse relation for `FeatureBuild`:

```prisma
model DigitalProduct {
  id              String        @id @default(cuid())
  productId       String        @unique
  name            String
  lifecycleStage  String        @default("plan")
  lifecycleStatus String        @default("draft")
  version         String        @default("1.0.0")
  portfolioId     String?
  portfolio       Portfolio?    @relation(fields: [portfolioId], references: [id])
  taxonomyNodeId  String?
  taxonomyNode    TaxonomyNode? @relation(fields: [taxonomyNodeId], references: [id])
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  backlogItems    BacklogItem[]
  eaElements      EaElement[]
  inventoryEntities      InventoryEntity[]
  portfolioQualityIssues PortfolioQualityIssue[]
  featureBuilds          FeatureBuild[]
}
```

- [ ] **Step 2: Add `digitalProductId` FK to FeatureBuild model**

In the same file, find the `FeatureBuild` model and add the FK + relation + index:

```prisma
model FeatureBuild {
  id              String   @id @default(cuid())
  buildId         String   @unique
  title           String
  description     String?  @db.Text
  portfolioId     String?
  brief           Json?
  plan            Json?
  phase           String   @default("ideate")
  sandboxId       String?
  sandboxPort     Int?
  diffSummary     String?  @db.Text
  diffPatch       String?  @db.Text
  codingProvider  String?
  threadId        String?
  digitalProductId String?
  digitalProduct  DigitalProduct? @relation(fields: [digitalProductId], references: [id])
  createdById     String
  createdBy       User     @relation(fields: [createdById], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([phase])
  @@index([createdById])
  @@index([digitalProductId])
}
```

- [ ] **Step 3: Run migration**

```bash
cd packages/db && npx prisma migrate dev --name add_version_and_build_product_fk
```

Expected: Migration applies cleanly. Existing `DigitalProduct` rows get `version = "1.0.0"` from default.

- [ ] **Step 4: Regenerate Prisma client**

```bash
cd packages/db && npx prisma generate
```

Expected: Client regenerated with new fields.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(schema): add DigitalProduct.version and FeatureBuild.digitalProductId FK"
```

---

### Task 2: Version Bumping Helper (TDD)

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`
- Create: `apps/web/lib/build-agent-prompts.test.ts`

- [ ] **Step 1: Write failing tests for `bumpVersion`**

Create `apps/web/lib/build-agent-prompts.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { bumpVersion } from "./feature-build-types";

describe("bumpVersion", () => {
  it("bumps patch version", () => {
    expect(bumpVersion("1.0.0", "patch")).toBe("1.0.1");
  });

  it("bumps minor version and resets patch", () => {
    expect(bumpVersion("1.2.3", "minor")).toBe("1.3.0");
  });

  it("bumps major version and resets minor and patch", () => {
    expect(bumpVersion("1.2.3", "major")).toBe("2.0.0");
  });

  it("handles single-digit versions", () => {
    expect(bumpVersion("0.0.1", "patch")).toBe("0.0.2");
  });

  it("defaults to minor for invalid bump type", () => {
    // cast to bypass TS — testing runtime safety
    expect(bumpVersion("1.0.0", "unknown" as "patch")).toBe("1.1.0");
  });

  it("handles malformed version by returning 1.0.0", () => {
    expect(bumpVersion("not-a-version", "patch")).toBe("1.0.0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/build-agent-prompts.test.ts
```

Expected: FAIL — `bumpVersion` is not exported from `./feature-build-types`.

- [ ] **Step 3: Implement `bumpVersion` in feature-build-types.ts**

Add to the bottom of `apps/web/lib/feature-build-types.ts`, before the closing:

```typescript
// ─── Version Bumping ──────────────────────────────────────────────────────

export type VersionBump = "major" | "minor" | "patch";

export function bumpVersion(current: string, bump: VersionBump): string {
  const parts = current.split(".");
  if (parts.length !== 3) return "1.0.0";

  const major = parseInt(parts[0]!, 10);
  const minor = parseInt(parts[1]!, 10);
  const patch = parseInt(parts[2]!, 10);

  if (isNaN(major) || isNaN(minor) || isNaN(patch)) return "1.0.0";

  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    case "minor":
    default:
      return `${major}.${minor + 1}.0`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/build-agent-prompts.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Update FeatureBuildRow type to include digitalProductId**

In `apps/web/lib/feature-build-types.ts`, add the field to `FeatureBuildRow`:

```typescript
export type FeatureBuildRow = {
  id: string;
  buildId: string;
  title: string;
  description: string | null;
  portfolioId: string | null;
  brief: FeatureBrief | null;
  plan: Record<string, unknown> | null;
  phase: BuildPhase;
  sandboxId: string | null;
  sandboxPort: number | null;
  diffSummary: string | null;
  diffPatch: string | null;
  codingProvider: string | null;
  threadId: string | null;
  digitalProductId: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};
```

- [ ] **Step 6: Update data fetchers to include digitalProductId**

In `apps/web/lib/feature-build-data.ts`, add `digitalProductId: true` to both `select` objects in `getFeatureBuilds` and `getFeatureBuildById`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/feature-build-types.ts apps/web/lib/build-agent-prompts.test.ts apps/web/lib/feature-build-data.ts
git commit -m "feat: add bumpVersion helper and digitalProductId to FeatureBuildRow"
```

---

## Chunk 2: Build Agent Prompts + Route Registration

### Task 3: Phase-Specific Prompt Templates (TDD)

**Files:**
- Create: `apps/web/lib/build-agent-prompts.ts`
- Modify: `apps/web/lib/build-agent-prompts.test.ts`

- [ ] **Step 1: Write failing tests for prompt builders**

Append to `apps/web/lib/build-agent-prompts.test.ts`:

```typescript
import { getBuildPhasePrompt, getBuildContextSection } from "./build-agent-prompts";
import type { FeatureBrief } from "./feature-build-types";

describe("getBuildPhasePrompt", () => {
  it("returns ideate prompt for ideate phase", () => {
    const prompt = getBuildPhasePrompt("ideate");
    expect(prompt).toContain("Ideate");
    expect(prompt).toContain("Feature Brief");
  });

  it("returns plan prompt for plan phase", () => {
    const prompt = getBuildPhasePrompt("plan");
    expect(prompt).toContain("Plan");
    expect(prompt).toContain("implementation plan");
  });

  it("returns build prompt for build phase", () => {
    const prompt = getBuildPhasePrompt("build");
    expect(prompt).toContain("Build");
    expect(prompt).toContain("sandbox");
  });

  it("returns review prompt for review phase", () => {
    const prompt = getBuildPhasePrompt("review");
    expect(prompt).toContain("Review");
    expect(prompt).toContain("test");
  });

  it("returns ship prompt for ship phase", () => {
    const prompt = getBuildPhasePrompt("ship");
    expect(prompt).toContain("Ship");
    expect(prompt).toContain("deploy");
  });

  it("returns empty string for terminal phases", () => {
    expect(getBuildPhasePrompt("complete")).toBe("");
    expect(getBuildPhasePrompt("failed")).toBe("");
  });
});

describe("getBuildContextSection", () => {
  it("includes buildId and phase", () => {
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "ideate",
      title: "My Feature",
      brief: null,
      portfolioId: null,
    });
    expect(section).toContain("FB-12345678");
    expect(section).toContain("ideate");
    expect(section).toContain("My Feature");
  });

  it("includes brief summary when present", () => {
    const brief: FeatureBrief = {
      title: "Feedback Form",
      description: "A customer feedback form",
      portfolioContext: "products_and_services_sold",
      targetRoles: ["HR-200"],
      inputs: ["text field"],
      dataNeeds: "feedback table",
      acceptanceCriteria: ["form submits"],
    };
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "plan",
      title: "Feedback Form",
      brief,
      portfolioId: "products_and_services_sold",
    });
    expect(section).toContain("Feedback Form");
    expect(section).toContain("A customer feedback form");
    expect(section).toContain("products_and_services_sold");
  });

  it("omits brief section when null", () => {
    const section = getBuildContextSection({
      buildId: "FB-12345678",
      phase: "ideate",
      title: "Test",
      brief: null,
      portfolioId: null,
    });
    expect(section).not.toContain("Feature Brief:");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/build-agent-prompts.test.ts
```

Expected: FAIL — `getBuildPhasePrompt` and `getBuildContextSection` not found.

- [ ] **Step 3: Implement build-agent-prompts.ts**

Create `apps/web/lib/build-agent-prompts.ts`:

```typescript
// apps/web/lib/build-agent-prompts.ts
// Phase-specific prompt templates for the Build Specialist agent.

import type { BuildPhase, FeatureBrief } from "./feature-build-types";

// ─── Phase Prompts ────────────────────────────────────────────────────────────

const PHASE_PROMPTS: Record<string, string> = {
  ideate: `## Current Phase: Ideate

Your job is to help the user define what they want to build by assembling a Feature Brief.

Ask plain-language questions to fill these fields:
- Title (may already be set)
- Description (what does it do, in the user's words)
- Portfolio context (which portfolio area owns this — suggest based on what they describe)
- Target roles (who will use this feature)
- Data needs (what gets stored — translate to technical terms internally, but ask in plain language)
- Acceptance criteria (what "done" looks like)

Start free-form ("Tell me about your feature idea"), then ask targeted follow-ups for any missing fields. Show a summary of the complete brief and ask for confirmation before advancing.

IMPORTANT: Never ask technical questions. No database schemas, no API design, no framework choices. Translate everything internally.

When the brief is complete and confirmed, call the update_feature_brief tool with the structured brief, then propose advancing to the Plan phase.`,

  plan: `## Current Phase: Plan

The Feature Brief is complete. Generate an internal implementation plan:
- Break down the feature into components, data models, and UI pieces
- Identify which files need to be created or modified
- Determine the build sequence

Present a plain-language summary to the user: "Here's what I'll build..." with bullet points. Do NOT show technical details like file paths or code.

When the user approves the plan, propose advancing to the Build phase.`,

  build: `## Current Phase: Build (Design Target — Sandbox Orchestration Deferred)

This phase will eventually orchestrate code generation in a sandbox with these sub-steps:
1. Generate — write code from the plan
2. Iterate — incorporate user feedback
3. Test — run tests and type checks
4. Verify — user confirms via live preview

For now, explain to the user that automated code generation is coming in a future update. You can discuss the implementation approach and help refine requirements.`,

  review: `## Current Phase: Review

Guide the user through reviewing the built feature:
- Present test results (all tests must pass)
- Walk through the live preview
- Confirm acceptance criteria are met

When the user approves, propose advancing to the Ship phase.`,

  ship: `## Current Phase: Ship

The feature is reviewed and approved. Propose deployment:
1. Deploy the feature (requires HITL approval — this creates an AgentActionProposal)
2. Register as a DigitalProduct in the inventory
3. Create an Epic and backlog items for ongoing tracking
4. Destroy the sandbox

Use the register_digital_product and create_build_epic tools to execute these steps. Each destructive action requires explicit user approval.`,
};

export function getBuildPhasePrompt(phase: BuildPhase): string {
  return PHASE_PROMPTS[phase] ?? "";
}

// ─── Context Section ──────────────────────────────────────────────────────────

export type BuildContext = {
  buildId: string;
  phase: BuildPhase;
  title: string;
  brief: FeatureBrief | null;
  portfolioId: string | null;
};

export function getBuildContextSection(ctx: BuildContext): string {
  const lines: string[] = [
    "",
    "--- Build Studio Context ---",
    `Build ID: ${ctx.buildId}`,
    `Title: ${ctx.title}`,
    `Phase: ${ctx.phase}`,
  ];

  if (ctx.portfolioId) {
    lines.push(`Portfolio: ${ctx.portfolioId}`);
  }

  if (ctx.brief) {
    lines.push("");
    lines.push("Feature Brief:");
    lines.push(`  Title: ${ctx.brief.title}`);
    lines.push(`  Description: ${ctx.brief.description}`);
    lines.push(`  Portfolio: ${ctx.brief.portfolioContext}`);
    lines.push(`  Target roles: ${ctx.brief.targetRoles.join(", ")}`);
    lines.push(`  Acceptance criteria: ${ctx.brief.acceptanceCriteria.join("; ")}`);
  }

  lines.push("");
  lines.push(getBuildPhasePrompt(ctx.phase));

  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/build-agent-prompts.test.ts
```

Expected: All tests PASS (6 bumpVersion + 9 prompt tests = 15 total).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/build-agent-prompts.ts apps/web/lib/build-agent-prompts.test.ts
git commit -m "feat: add phase-specific prompt templates for Build Specialist agent"
```

---

### Task 4: Route Registration + Sensitivity + Canned Responses

**Files:**
- Modify: `apps/web/lib/agent-routing.ts`
- Modify: `apps/web/lib/agent-sensitivity.ts`

- [ ] **Step 1: Add `/build` entry to `ROUTE_AGENT_MAP`**

In `apps/web/lib/agent-routing.ts`, add the following entry to `ROUTE_AGENT_MAP` after the `/platform` entry (before `/admin`):

```typescript
  "/build": {
    agentId: "build-specialist",
    agentName: "Build Specialist",
    agentDescription: "Guides feature development through Ideate, Plan, Build, Review, and Ship phases",
    capability: "view_platform",
    sensitivity: "internal",
    systemPrompt: `You are Build Specialist, an AI assistant in the Digital Product Factory portal.

Role: You guide users through building new features without writing code. You work through five phases: Ideate (define what to build), Plan (design the approach), Build (generate code in a sandbox), Review (verify it works), and Ship (deploy and register).

You translate plain language into technical implementations. You never ask technical questions — the user describes what they want in their own words, and you handle the technical details.

Guidelines:
- Be concise and helpful
- Prefer short paragraphs and flat bullet lists over walls of text
- Guide the user step by step through the current phase
- Never ask about databases, APIs, frameworks, or code
- If you cannot help with something, suggest which area of the portal might
- Do not make up data — if you don't know, say so`,
    skills: [
      { label: "Start a feature", description: "Begin defining a new feature to build", capability: "view_platform", prompt: "I want to build a new feature" },
      { label: "Check build status", description: "Review the current build progress", capability: "view_platform", prompt: "What's the status of my current build?" },
      { label: "Ship feature", description: "Deploy and register the completed feature", capability: "view_platform", prompt: "I'm ready to ship this feature" },
      { label: "Report an issue", description: "Report a bug, suggest an improvement, or ask a question", capability: null, prompt: "I'd like to report an issue or give feedback about this page." },
    ],
  },
```

- [ ] **Step 2: Add canned responses for `build-specialist`**

In the same file, add to the `CANNED_RESPONSES` object:

```typescript
  "build-specialist": {
    default: [
      "I'm your Build Specialist. I can guide you through building new features — from describing what you want to deploying it live. What would you like to build?",
      "Welcome to the Build Studio! Tell me about a feature you'd like to create, and I'll guide you through the process step by step.",
      "Ready to build something? Describe your feature idea and I'll help turn it into reality — no coding required.",
    ],
    restricted: [
      "I can help explain the Build Studio, but creating and deploying features requires platform access permissions.",
    ],
  },
```

- [ ] **Step 3: Add `/build` to `ROUTE_SENSITIVITY`**

In `apps/web/lib/agent-sensitivity.ts`, add the entry to the `ROUTE_SENSITIVITY` array (after the `/ops` entry):

```typescript
  { prefix: "/build", sensitivity: "internal" },
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

```bash
cd apps/web && npx vitest run
```

Expected: All existing tests pass. The agent routing tests (if any) should include the new agent.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-routing.ts apps/web/lib/agent-sensitivity.ts
git commit -m "feat: register Build Specialist agent in route map with canned responses"
```

---

## Chunk 3: Context Injection + MCP Tools

### Task 5: Extend `sendMessage` to Accept `buildId`

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts:85-95`

- [ ] **Step 1: Add `buildId` to `sendMessage` input type**

In `apps/web/lib/actions/agent-coworker.ts`, update the `sendMessage` input type to include `buildId`:

```typescript
export async function sendMessage(input: {
  threadId: string;
  content: string;
  routeContext: string;
  externalAccessEnabled?: boolean;
  elevatedFormFillEnabled?: boolean;
  formAssistContext?: AgentFormAssistContext;
  buildId?: string;
}): Promise<
```

- [ ] **Step 2: Add build context injection import**

Add this import at the top of the file:

```typescript
import { getBuildContextSection } from "@/lib/build-agent-prompts";
import { getFeatureBuildForContext } from "@/lib/feature-build-data";
```

- [ ] **Step 3: Add build context injection logic**

In the `sendMessage` function, after the existing `promptSections` array is built (after line 157 where the current context lines are pushed), add:

```typescript
  // Inject Build Studio context when buildId is provided
  if (input.buildId) {
    const buildCtx = await getFeatureBuildForContext(input.buildId, user.id!);
    if (buildCtx) {
      promptSections.push(getBuildContextSection(buildCtx));
    }
  }
```

- [ ] **Step 4: Add `getFeatureBuildForContext` to feature-build-data.ts**

In `apps/web/lib/feature-build-data.ts`, add this function (NOT cached — must read fresh data each message):

```typescript
import type { BuildContext } from "./build-agent-prompts";

/** Fetch minimal build context for prompt injection. NOT cached — must be fresh per message. */
export async function getFeatureBuildForContext(
  buildId: string,
  userId: string,
): Promise<BuildContext | null> {
  const r = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      buildId: true,
      title: true,
      phase: true,
      brief: true,
      portfolioId: true,
      createdById: true,
    },
  });

  if (!r || r.createdById !== userId) return null;

  return {
    buildId: r.buildId,
    phase: r.phase as BuildPhase,
    title: r.title,
    brief: r.brief as FeatureBrief | null,
    portfolioId: r.portfolioId,
  };
}
```

Note: Import `BuildPhase` and `FeatureBrief` are already imported at the top of `feature-build-data.ts`. Import `BuildContext` from `./build-agent-prompts`.

- [ ] **Step 5: Run tests to verify nothing broke**

```bash
cd apps/web && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts apps/web/lib/feature-build-data.ts
git commit -m "feat: inject build context into sendMessage when buildId is provided"
```

---

### Task 6: Add Build MCP Tools (TDD)

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Write failing test for new tool registration**

In `apps/web/lib/mcp-tools.test.ts`, add these tests:

```typescript
  it("includes build tools for platform users", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("update_feature_brief");
    expect(toolNames).toContain("register_digital_product_from_build");
    expect(toolNames).toContain("create_build_epic");
  });

  it("update_feature_brief requires view_platform capability", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "update_feature_brief");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("view_platform");
  });

  it("register_digital_product_from_build requires manage_capabilities", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const tool = tools.find((t) => t.name === "register_digital_product_from_build");
    expect(tool).toBeDefined();
    expect(tool!.requiredCapability).toBe("manage_capabilities");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-tools.test.ts
```

Expected: FAIL — tools not found.

- [ ] **Step 3: Add tool definitions to PLATFORM_TOOLS**

In `apps/web/lib/mcp-tools.ts`, add these entries to the `PLATFORM_TOOLS` array (before the closing `]`):

```typescript
  // ─── Build Studio Tools ───────────────────────────────────────────────────
  {
    name: "update_feature_brief",
    description: "Update the Feature Brief for an active build with structured fields",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID (e.g., FB-XXXXX)" },
        title: { type: "string", description: "Feature title" },
        description: { type: "string", description: "Plain-language feature description" },
        portfolioContext: { type: "string", description: "Portfolio slug that owns this feature" },
        targetRoles: { type: "array", items: { type: "string" }, description: "Role IDs that will use this feature" },
        inputs: { type: "array", items: { type: "string" }, description: "User inputs the feature accepts" },
        dataNeeds: { type: "string", description: "What data the feature stores" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "What done looks like" },
      },
      required: ["buildId", "title", "description", "portfolioContext", "targetRoles", "dataNeeds", "acceptanceCriteria"],
    },
    requiredCapability: "view_platform",
  },
  {
    name: "register_digital_product_from_build",
    description: "Register or update a DigitalProduct from a shipped feature build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID being shipped" },
        name: { type: "string", description: "Product name" },
        portfolioSlug: { type: "string", description: "Portfolio slug to assign to" },
        versionBump: { type: "string", enum: ["major", "minor", "patch"], description: "How to bump the version" },
      },
      required: ["buildId", "name", "portfolioSlug"],
    },
    requiredCapability: "manage_capabilities",
  },
  {
    name: "create_build_epic",
    description: "Create an Epic and initial backlog items for a shipped feature build",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The build ID" },
        title: { type: "string", description: "Epic title (e.g., Feature Name v1.0.0)" },
        portfolioSlug: { type: "string", description: "Portfolio slug to link the epic to" },
        digitalProductId: { type: "string", description: "Product internal ID for backlog items" },
      },
      required: ["buildId", "title"],
    },
    requiredCapability: "manage_capabilities",
  },
```

- [ ] **Step 4: Add `executeTool` handlers for new tools**

In `apps/web/lib/mcp-tools.ts`, add cases to the `executeTool` switch statement (before the `default` case):

```typescript
    case "update_feature_brief": {
      const { updateFeatureBrief } = await import("@/lib/actions/build");
      const brief = {
        title: String(params["title"] ?? ""),
        description: String(params["description"] ?? ""),
        portfolioContext: String(params["portfolioContext"] ?? ""),
        targetRoles: Array.isArray(params["targetRoles"]) ? params["targetRoles"].map(String) : [],
        inputs: Array.isArray(params["inputs"]) ? params["inputs"].map(String) : [],
        dataNeeds: String(params["dataNeeds"] ?? ""),
        acceptanceCriteria: Array.isArray(params["acceptanceCriteria"]) ? params["acceptanceCriteria"].map(String) : [],
      };
      await updateFeatureBrief(String(params["buildId"]), brief);
      return { success: true, entityId: String(params["buildId"]), message: `Updated Feature Brief for ${String(params["buildId"])}` };
    }

    case "register_digital_product_from_build": {
      const { shipBuild } = await import("@/lib/actions/build");
      const result = await shipBuild({
        buildId: String(params["buildId"]),
        name: String(params["name"]),
        portfolioSlug: String(params["portfolioSlug"]),
        versionBump: (params["versionBump"] as "major" | "minor" | "patch") ?? "minor",
      });
      // Return productInternalId and portfolioInternalId so the agent can chain create_build_epic
      return {
        success: true,
        entityId: result.productId,
        message: result.message,
        data: {
          productInternalId: result.productInternalId,
          portfolioInternalId: result.portfolioInternalId,
        },
      };
    }

    case "create_build_epic": {
      const { createBuildEpic } = await import("@/lib/actions/build");
      const result = await createBuildEpic({
        buildId: String(params["buildId"]),
        title: String(params["title"]),
        portfolioSlug: typeof params["portfolioSlug"] === "string" ? params["portfolioSlug"] : undefined,
        digitalProductId: typeof params["digitalProductId"] === "string" ? params["digitalProductId"] : undefined,
      });
      return { success: true, entityId: result.epicId, message: result.message };
    }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/mcp-tools.test.ts
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools.test.ts
git commit -m "feat: add Build Studio MCP tools (update_feature_brief, register_product, create_epic)"
```

---

## Chunk 4: Ship Action + Backlog Bridge

### Task 7: Implement `shipBuild` and `createBuildEpic` Server Actions

**Files:**
- Modify: `apps/web/lib/actions/build.ts`

- [ ] **Step 1: Add `shipBuild` action**

Add to `apps/web/lib/actions/build.ts`:

```typescript
import { bumpVersion, type VersionBump } from "@/lib/feature-build-types";
import * as crypto from "crypto";

// ─── Ship Build — Register as DigitalProduct ────────────────────────────────

export async function shipBuild(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump?: VersionBump;
}): Promise<{ productId: string; productInternalId: string; portfolioInternalId: string | null; message: string }> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId: input.buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  // Resolve portfolio + root taxonomy node for the product
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: input.portfolioSlug },
    select: { id: true, slug: true },
  });
  let taxonomyNodeId: string | null = null;
  if (portfolio) {
    const rootNode = await prisma.taxonomyNode.findFirst({
      where: { portfolioId: portfolio.id, parentId: null },
      select: { id: true },
    });
    taxonomyNodeId = rootNode?.id ?? null;
  }

  // Use a transaction for product create/update + build link
  const result = await prisma.$transaction(async (tx) => {
    let product: { id: string; productId: string; version: string };

    if (build.digitalProductId) {
      // Subsequent build — bump version on existing product
      const existing = await tx.digitalProduct.findUnique({
        where: { id: build.digitalProductId },
        select: { id: true, productId: true, version: true },
      });
      if (!existing) throw new Error("Linked product not found");

      const newVersion = bumpVersion(existing.version, input.versionBump ?? "minor");
      await tx.digitalProduct.update({
        where: { id: existing.id },
        data: {
          version: newVersion,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
      });
      product = { ...existing, version: newVersion };
    } else {
      // First ship — create new product
      const productId = `DP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.digitalProduct.create({
        data: {
          productId,
          name: input.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          version: "1.0.0",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
        select: { id: true, productId: true, version: true },
      });
      product = created;
    }

    // Link build to product (do NOT set phase "complete" yet — that happens after epic creation)
    await tx.featureBuild.update({
      where: { buildId: input.buildId },
      data: { digitalProductId: product.id },
    });

    return product;
  });

  return {
    productId: result.productId,
    productInternalId: result.id,
    portfolioInternalId: portfolio?.id ?? null,
    message: `Registered ${input.name} as ${result.productId} v${result.version} in the ${input.portfolioSlug} portfolio.`,
  };
}

// ─── Complete Build — mark phase as complete after all ship steps ────────────

export async function completeBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: "complete" },
  });
}

// ─── Create Epic + Backlog Items for a Build ────────────────────────────────

export async function createBuildEpic(input: {
  buildId: string;
  title: string;
  portfolioSlug?: string;
  digitalProductId?: string;
}): Promise<{ epicId: string; message: string }> {
  await requireBuildAccess();

  // Resolve portfolio slug to internal ID
  let portfolioInternalId: string | null = null;
  if (input.portfolioSlug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: input.portfolioSlug },
      select: { id: true },
    });
    portfolioInternalId = portfolio?.id ?? null;
  }

  const epicId = `EP-BUILD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // Wrap epic + backlog items in a transaction for consistency
  const epic = await prisma.$transaction(async (tx) => {
    const created = await tx.epic.create({
      data: {
        epicId,
        title: input.title,
        status: "open",
      },
      select: { id: true, epicId: true },
    });

    // Link epic to portfolio if resolved
    if (portfolioInternalId) {
      await tx.epicPortfolio.create({
        data: { epicId: created.id, portfolioId: portfolioInternalId },
      }).catch((e) => {
        console.warn("[createBuildEpic] portfolio link failed:", e);
      });
    }

    // Create "done" backlog item for the shipped work
    const doneItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: doneItemId,
        title: `Ship: ${input.title}`,
        type: "product",
        status: "done",
        body: `Feature shipped via Build Studio (${input.buildId}).`,
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    // Seed initial feedback-gathering item
    const feedbackItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: feedbackItemId,
        title: `Gather user feedback on ${input.title.replace(/\sv[\d.]+$/, "")}`,
        type: "product",
        status: "open",
        body: "Collect initial user feedback and file follow-up items.",
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    return created;
  });

  return {
    epicId: epic.epicId,
    message: `Created epic ${epic.epicId} with 2 backlog items (1 done, 1 open for feedback).`,
  };
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run all tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/build.ts
git commit -m "feat: add shipBuild and createBuildEpic server actions for backlog bridge"
```

---

## Chunk 5: UI Wiring

### Task 8: Pass `buildId` from BuildStudio to Co-worker Panel via CustomEvent

**Files:**
- Modify: `apps/web/components/build/BuildStudio.tsx`
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx`

**Why not React context?** `AgentCoworkerPanel` is rendered by the shell layout as a **sibling** of the page content (inside `AgentCoworkerShell`), not as a child of `BuildStudio`. React context only flows downward. Instead, use the `CustomEvent` pattern already established in this codebase (see `"open-agent-feedback"` event in `AgentCoworkerShell.tsx`).

- [ ] **Step 1: Dispatch CustomEvent from BuildStudio when active build changes**

In `apps/web/components/build/BuildStudio.tsx`, add a `useEffect` that dispatches a custom event whenever `activeBuild` changes:

```typescript
import { useEffect } from "react";

// Inside the BuildStudio component, after useState declarations:
  useEffect(() => {
    const detail = activeBuild?.buildId ?? null;
    window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail }));
    return () => {
      // Clear on unmount
      window.dispatchEvent(new CustomEvent("build-studio-active-build", { detail: null }));
    };
  }, [activeBuild?.buildId]);
```

- [ ] **Step 2: Add `digitalProductId: null` to optimistic build object in `handleCreate`**

In the same file, update the optimistic `FeatureBuildRow` in `handleCreate` (around line 31) to include the new field:

```typescript
      setActiveBuild({
        id: "",
        buildId,
        title: newTitle.trim(),
        description: null,
        portfolioId: null,
        brief: null,
        plan: null,
        phase: "ideate",
        sandboxId: null,
        sandboxPort: null,
        diffSummary: null,
        diffPatch: null,
        codingProvider: null,
        threadId: null,
        digitalProductId: null,
        createdById: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
```

- [ ] **Step 3: Listen for CustomEvent in AgentCoworkerPanel**

In `apps/web/components/agent/AgentCoworkerPanel.tsx`, add state + event listener:

```typescript
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);

  useEffect(() => {
    function handleBuildChange(e: Event) {
      const buildId = (e as CustomEvent<string | null>).detail;
      setActiveBuildId(buildId);
    }
    window.addEventListener("build-studio-active-build", handleBuildChange);
    return () => window.removeEventListener("build-studio-active-build", handleBuildChange);
  }, []);
```

- [ ] **Step 4: Forward buildId in submitMessage**

In the same file, update the `sendMessage` call inside `submitMessage` (around line 118) to include `buildId`:

```typescript
      const result = await sendMessage({
        threadId,
        content,
        routeContext: pathname,
        externalAccessEnabled,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
        ...(activeBuildId ? { buildId: activeBuildId } : {}),
      });
```

- [ ] **Step 5: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors. `BuildStudio` dispatches a `CustomEvent` with the active `buildId`. `AgentCoworkerPanel` listens and stores it in state. When not on `/build`, no event fires and `activeBuildId` stays `null`.

- [ ] **Step 6: Run all tests**

```bash
pnpm test
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/build/BuildStudio.tsx apps/web/components/agent/AgentCoworkerPanel.tsx
git commit -m "feat: wire active buildId from BuildStudio to AgentCoworkerPanel via CustomEvent"
```

---

### Task 9: Fix Build Page Layout Height

**Files:**
- Modify: `apps/web/app/(shell)/build/page.tsx`

The user reported the page height is clipped at the bottom.

- [ ] **Step 1: Fix the height calculation**

In `apps/web/app/(shell)/build/page.tsx`, update the container div:

```typescript
  return (
    <div className="-m-6 h-[calc(100vh-48px)]">
      <BuildStudio builds={builds} portfolios={portfolios} />
    </div>
  );
```

The shell header is 48px (`h-12`). The previous `100vh-64px` left a 16px gap. Adjust based on actual shell chrome height. Test visually.

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/(shell)/build/page.tsx
git commit -m "fix: adjust Build Studio layout height to prevent bottom clipping"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass (existing + new).

- [ ] **Step 2: Run TypeScript check across the workspace**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Visual smoke test**

Start the dev server and verify:
1. Navigate to `/build` — page renders without clipping
2. Create a new build — appears in sidebar
3. Open co-worker panel — shows "Build Specialist" agent
4. Send a message — agent responds with Ideate phase guidance
5. Check `/ops` — existing backlog items still display correctly

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: final adjustments after EP-SELF-DEV-001B integration testing"
```
