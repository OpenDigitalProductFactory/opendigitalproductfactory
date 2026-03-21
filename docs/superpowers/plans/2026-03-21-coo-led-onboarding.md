# COO-Led Platform Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an AI Coworker-led onboarding experience where the COO persona guides non-technical users through initial platform setup, starting with Ollama auto-bootstrap.

**Architecture:** Two-phase onboarding: Steps 1-2 (business identity, account creation) use static COO guidance text pre-auth; Steps 3-8 use the live `AgentCoworkerPanel` post-auth. A `bootstrapFirstRun()` wrapper auto-pulls an Ollama model, seeds the onboarding agent, and creates a `PlatformSetupProgress` record. Each setup step renders the real admin page alongside the COO chat panel.

**Tech Stack:** Next.js 16 (App Router), Prisma, React, Ollama API, existing agent coworker infrastructure

**Spec:** `docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `packages/db/prisma/migrations/TIMESTAMP_add_platform_setup_progress/migration.sql` | Schema migration |
| `apps/web/lib/actions/setup-progress.ts` | Server actions for setup state CRUD |
| `apps/web/lib/bootstrap-first-run.ts` | First-run detection + Ollama auto-pull + agent seed |
| `apps/web/app/(setup)/layout.tsx` | Setup route group layout (no shell chrome) |
| `apps/web/app/(setup)/setup/page.tsx` | Setup orchestrator page — routes to current step |
| `apps/web/app/(setup)/setup/SetupOrchestrator.tsx` | Client component — step rendering and navigation state |
| `apps/web/lib/actions/setup-entities.ts` | Server actions for creating Organization + User + auto-login |
| `apps/web/app/(setup)/setup/steps/business-identity.tsx` | Step 1 form |
| `apps/web/app/(setup)/setup/steps/owner-account.tsx` | Step 2 form |
| `apps/web/app/(setup)/setup/steps/ai-capabilities.tsx` | Step 3 form |
| `apps/web/app/(setup)/setup/steps/branding.tsx` | Step 4 form |
| `apps/web/app/(setup)/setup/steps/financial-basics.tsx` | Step 5 form |
| `apps/web/app/(setup)/setup/steps/first-workspace.tsx` | Step 6 form |
| `apps/web/app/(setup)/setup/steps/extensibility-preview.tsx` | Step 7 info card |
| `apps/web/app/(setup)/setup/steps/whats-next.tsx` | Step 8 summary |
| `apps/web/components/setup/SetupLayout.tsx` | Two-panel layout (content + COO panel) |
| `apps/web/components/setup/SetupProgressBar.tsx` | Top progress indicator |
| `apps/web/components/setup/SetupStepNav.tsx` | Continue / Skip / Pause buttons |
| `apps/web/components/setup/StaticCOOPanel.tsx` | Pre-auth COO guidance text (Steps 1-2) |
| `apps/web/components/setup/SetupEventQueue.ts` | Client-side event debounce for page-chat coordination |
| `apps/web/lib/actions/setup-progress.test.ts` | Tests for setup state actions |
| `apps/web/lib/bootstrap-first-run.test.ts` | Tests for bootstrap logic |
| `packages/db/scripts/seed-onboarding-epic.ts` | Seed EP-ONBOARD-001 and EP-ONBOARD-002 epics |

### Modified Files
| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `PlatformSetupProgress` model, `userFacingDescription` on `ModelProvider`, reverse relations on `User` and `Organization` |
| `apps/web/lib/agent-sensitivity.ts` | Add `/setup` to `ROUTE_SENSITIVITY` |
| `apps/web/lib/agent-routing.ts` | Add `/setup` to `ROUTE_AGENT_MAP` |
| `apps/web/lib/route-context-map.ts` | Add `/setup` to `ROUTE_CONTEXT_MAP` |
| `apps/web/lib/task-types.ts` | Add `"onboarding"` task type definition |
| `apps/web/lib/routing/request-contract.ts` | Add `"onboarding": "minimal"` to `DEFAULT_REASONING_DEPTH` |
| `packages/db/data/providers-registry.json` | Add `userFacing` blocks to each provider |
| `apps/web/lib/ollama.ts` | Minor: export `getOllamaBaseUrl` if not already exported |
| `apps/web/app/(shell)/layout.tsx` | Add first-run redirect check |
| `apps/web/middleware.ts` | Allow `/setup` routes without auth for Steps 1-2 |

---

## Task 1: Database Schema — PlatformSetupProgress + ModelProvider Extension

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Generated: migration SQL (via `prisma migrate dev`)

- [ ] **Step 1: Add PlatformSetupProgress model to schema.prisma**

Add after the `Organization` model (around line 1399):

```prisma
model PlatformSetupProgress {
  id             String        @id @default(cuid())
  userId         String?
  organizationId String?
  currentStep    String        @default("business-identity")
  steps          Json          @default("{}")
  context        Json          @default("{}")
  pausedAt       DateTime?
  completedAt    DateTime?
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  user         User?         @relation("UserSetupProgress", fields: [userId], references: [id])
  organization Organization? @relation("OrgSetupProgress", fields: [organizationId], references: [id])
}
```

- [ ] **Step 2: Add reverse relations on User and Organization**

On the `User` model (around line 10), add:
```prisma
platformSetupProgress PlatformSetupProgress? @relation("UserSetupProgress")
```

On the `Organization` model (around line 1383), add:
```prisma
platformSetupProgress PlatformSetupProgress? @relation("OrgSetupProgress")
```

- [ ] **Step 3: Add userFacingDescription to ModelProvider**

On the `ModelProvider` model (around line 793), add:
```prisma
userFacingDescription Json?
```

- [ ] **Step 4: Run migration**

Run: `cd packages/db && npx prisma migrate dev --name add_platform_setup_progress`
Expected: Migration created and applied successfully.

- [ ] **Step 5: Verify Prisma client generation**

Run: `cd packages/db && npx prisma generate`
Expected: Client generated with new types.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add PlatformSetupProgress table and ModelProvider.userFacingDescription"
```

---

## Task 2: Task Type + Routing Registration

**Files:**
- Modify: `apps/web/lib/task-types.ts`
- Modify: `apps/web/lib/routing/request-contract.ts`
- Modify: `apps/web/lib/agent-sensitivity.ts`
- Modify: `apps/web/lib/agent-routing.ts`
- Modify: `apps/web/lib/route-context-map.ts`

- [ ] **Step 1: Add "onboarding" task type to task-types.ts**

Add to the `TASK_TYPES` array (after the last entry, around line 130):

```typescript
{
  id: "onboarding",
  description: "Platform onboarding guided conversation",
  heuristicPatterns: [/setup/i, /onboarding/i, /getting started/i, /configure/i],
  minCapabilityTier: "basic",
  defaultInstructions: "Guide the user through platform setup. Be professional and understanding.",
  evaluationTokenLimit: 500,
},
```

- [ ] **Step 2: Add "onboarding" to DEFAULT_REASONING_DEPTH in request-contract.ts**

Add to the `DEFAULT_REASONING_DEPTH` map (around line 59):

```typescript
"onboarding": "minimal",
```

- [ ] **Step 3: Add /setup to ROUTE_SENSITIVITY in agent-sensitivity.ts**

Add to the `ROUTE_SENSITIVITY` array (around line 11):

```typescript
{ prefix: "/setup", sensitivity: "internal" },
```

- [ ] **Step 4: Add /setup to ROUTE_AGENT_MAP in agent-routing.ts**

Add a new entry to `ROUTE_AGENT_MAP`. Follow the existing pattern — each entry has `agentId`, `agentName`, `agentDescription`, `capability`, `sensitivity`, `systemPrompt`, `skills`, and optional `modelRequirements`. The system prompt will be dynamically assembled at runtime, so use a placeholder here:

```typescript
"/setup": {
  agentId: "onboarding-coo",
  agentName: "Onboarding COO",
  agentDescription: "Guides new platform owners through initial setup.",
  capability: null,
  sensitivity: "internal",
  systemPrompt: "You are the platform's Chief Operating Officer guiding initial setup. This is a CONVERSATION request. You have no tools.",
  skills: [],
  modelRequirements: {
    preferredProviderId: "ollama",
  },
},
```

- [ ] **Step 5: Add /setup to ROUTE_CONTEXT_MAP in route-context-map.ts**

Add a new entry following the existing pattern:

```typescript
"/setup": {
  routePrefix: "/setup",
  domain: "Platform Onboarding",
  sensitivity: "internal",
  domainContext: "The user is going through initial platform setup. Guide them through each step: business identity, account creation, AI capabilities, branding, financials, and workspace creation. Be professional, understanding, and transparent about the local AI model's limitations.",
  domainTools: [],
  skills: [],
},
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/task-types.ts apps/web/lib/routing/request-contract.ts apps/web/lib/agent-sensitivity.ts apps/web/lib/agent-routing.ts apps/web/lib/route-context-map.ts
git commit -m "feat(routing): register onboarding task type and /setup route entries"
```

---

## Task 3: Provider userFacing Data

**Files:**
- Modify: `packages/db/data/providers-registry.json`

- [ ] **Step 1: Add userFacing blocks to providers-registry.json**

Add a `"userFacing"` object to each provider entry. The key providers to populate:

```json
{
  "providerId": "ollama",
  "userFacing": {
    "plainDescription": "AI running entirely on your own hardware. No data leaves your system.",
    "authExplained": "None needed — it's already running on your machine.",
    "costTier": "free",
    "costExplained": "Costs only the electricity to run your computer. No per-use charges.",
    "capabilitySummary": "Handles conversation, simple summaries, guided tasks, and basic analysis. Limited by your hardware.",
    "limitations": "Cannot match cloud models for complex reasoning, large document processing, or specialized tasks.",
    "dataResidency": "Your machine. Nothing leaves.",
    "setupDifficulty": "automatic",
    "regulatoryNotes": "Maximum privacy. Suitable for all sensitivity levels including restricted/regulated data."
  }
}
```

Do the same for: `anthropic`, `openai`, `azure-openai`, `gemini`, `bedrock`, `xai`, `mistral`, `cohere`, `deepseek`, `groq`, `together`, `fireworks`, `openrouter`. For providers unlikely to be used early (`litellm`, `portkey`, `martian`, `codex`), add minimal `userFacing` blocks.

For service-type providers (`document-parser`, `advanced-code-analysis`, `data-enrichment`), omit `userFacing` — these are not user-facing LLM providers.

- [ ] **Step 2: Verify JSON is valid**

Run: `cd packages/db && node -e "JSON.parse(require('fs').readFileSync('data/providers-registry.json','utf8')); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(providers): add userFacing descriptions for onboarding education"
```

---

## Task 4: Setup Progress Server Actions

**Files:**
- Create: `apps/web/lib/actions/setup-progress.ts`
- Create: `apps/web/lib/actions/setup-progress.test.ts`

- [ ] **Step 1: Write tests for setup progress actions**

```typescript
// apps/web/lib/actions/setup-progress.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    platformSetupProgress: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    organization: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import {
  isFirstRun,
  getSetupProgress,
  createSetupProgress,
  advanceStep,
  skipStep,
  pauseSetup,
  completeSetup,
  SETUP_STEPS,
} from "./setup-progress";

describe("setup-progress", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isFirstRun", () => {
    it("returns true when no org and no completed setup exist", async () => {
      (prisma.organization.count as any).mockResolvedValue(0);
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue(null);
      expect(await isFirstRun()).toBe(true);
    });

    it("returns false when an org exists", async () => {
      (prisma.organization.count as any).mockResolvedValue(1);
      expect(await isFirstRun()).toBe(false);
    });

    it("returns false when a completed setup exists", async () => {
      (prisma.organization.count as any).mockResolvedValue(0);
      (prisma.platformSetupProgress.findFirst as any).mockResolvedValue({
        completedAt: new Date(),
      });
      expect(await isFirstRun()).toBe(false);
    });
  });

  describe("createSetupProgress", () => {
    it("creates record with all steps pending", async () => {
      (prisma.platformSetupProgress.create as any).mockResolvedValue({
        id: "test-id",
        currentStep: "business-identity",
      });
      const result = await createSetupProgress();
      expect(prisma.platformSetupProgress.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currentStep: "business-identity",
          steps: expect.any(Object),
          context: {},
        }),
      });
      expect(result.id).toBe("test-id");
    });
  });

  describe("advanceStep", () => {
    it("marks current step completed and moves to next", async () => {
      const mockProgress = {
        id: "test-id",
        currentStep: "business-identity",
        steps: Object.fromEntries(SETUP_STEPS.map((s) => [s, "pending"])),
        context: {},
      };
      (prisma.platformSetupProgress.findUniqueOrThrow as any).mockResolvedValue(mockProgress);
      (prisma.platformSetupProgress.update as any).mockResolvedValue({
        ...mockProgress,
        currentStep: "owner-account",
      });

      await advanceStep("test-id", { orgName: "Test Co" });

      expect(prisma.platformSetupProgress.update).toHaveBeenCalledWith({
        where: { id: "test-id" },
        data: expect.objectContaining({
          currentStep: "owner-account",
        }),
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/actions/setup-progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement setup progress actions**

```typescript
// apps/web/lib/actions/setup-progress.ts
"use server";

import { prisma } from "@dpf/db";

export const SETUP_STEPS = [
  "business-identity",
  "owner-account",
  "ai-capabilities",
  "branding",
  "financial-basics",
  "first-workspace",
  "extensibility-preview",
  "whats-next",
] as const;

export type SetupStep = (typeof SETUP_STEPS)[number];
export type StepStatus = "pending" | "completed" | "skipped";

export type SetupContext = {
  orgName?: string;
  industry?: string;
  hasCloudProvider?: boolean;
  skippedSteps?: string[];
};

/** Check if this is a first-run scenario (no org + no completed setup). */
export async function isFirstRun(): Promise<boolean> {
  const orgCount = await prisma.organization.count();
  if (orgCount > 0) return false;

  const completedSetup = await prisma.platformSetupProgress.findFirst({
    where: { completedAt: { not: null } },
  });
  return completedSetup === null;
}

/** Get the current (or most recent) setup progress record. */
export async function getSetupProgress() {
  return prisma.platformSetupProgress.findFirst({
    where: { completedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

/** Create a new setup progress record with all steps pending. */
export async function createSetupProgress() {
  const steps: Record<string, StepStatus> = {};
  for (const step of SETUP_STEPS) {
    steps[step] = "pending";
  }

  return prisma.platformSetupProgress.create({
    data: {
      currentStep: SETUP_STEPS[0],
      steps,
      context: {},
    },
  });
}

/** Mark current step completed and advance to the next. */
export async function advanceStep(
  progressId: string,
  contextUpdate?: Partial<SetupContext>,
) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
  });

  const steps = progress.steps as Record<string, StepStatus>;
  const context = { ...(progress.context as SetupContext), ...contextUpdate };
  const currentIdx = SETUP_STEPS.indexOf(progress.currentStep as SetupStep);

  steps[progress.currentStep] = "completed";

  const nextIdx = currentIdx + 1;
  const nextStep = nextIdx < SETUP_STEPS.length ? SETUP_STEPS[nextIdx] : null;

  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
    },
  });
}

/** Mark current step skipped and advance. */
export async function skipStep(progressId: string) {
  const progress = await prisma.platformSetupProgress.findUniqueOrThrow({
    where: { id: progressId },
  });

  const steps = progress.steps as Record<string, StepStatus>;
  const context = progress.context as SetupContext;
  const currentIdx = SETUP_STEPS.indexOf(progress.currentStep as SetupStep);

  steps[progress.currentStep] = "skipped";
  context.skippedSteps = [
    ...(context.skippedSteps ?? []),
    progress.currentStep,
  ];

  const nextIdx = currentIdx + 1;
  const nextStep = nextIdx < SETUP_STEPS.length ? SETUP_STEPS[nextIdx] : null;

  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: {
      currentStep: nextStep ?? progress.currentStep,
      steps,
      context,
      ...(nextStep === null ? { completedAt: new Date() } : {}),
    },
  });
}

/** Pause the setup for later resumption. */
export async function pauseSetup(progressId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { pausedAt: new Date() },
  });
}

/** Mark setup as complete. */
export async function completeSetup(progressId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { completedAt: new Date() },
  });
}

/** Link setup progress to a user after account creation (Step 2). */
export async function linkSetupToUser(progressId: string, userId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { userId },
  });
}

/** Link setup progress to an organization after org creation (Step 1). */
export async function linkSetupToOrg(progressId: string, orgId: string) {
  return prisma.platformSetupProgress.update({
    where: { id: progressId },
    data: { organizationId: orgId },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/setup-progress.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/setup-progress.ts apps/web/lib/actions/setup-progress.test.ts
git commit -m "feat(setup): add setup progress server actions with tests"
```

---

## Task 5: Bootstrap First Run

**Files:**
- Create: `apps/web/lib/bootstrap-first-run.ts`
- Create: `apps/web/lib/bootstrap-first-run.test.ts`
- Modify: `apps/web/lib/ollama.ts` (ensure `getOllamaBaseUrl` is exported)

- [ ] **Step 1: Write tests for bootstrap logic**

```typescript
// apps/web/lib/bootstrap-first-run.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    agent: {
      upsert: vi.fn(),
    },
    platformSetupProgress: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    organization: {
      count: vi.fn(),
    },
  },
}));

vi.mock("./ollama", () => ({
  checkBundledProviders: vi.fn(),
  getOllamaBaseUrl: vi.fn(() => "http://localhost:11434"),
}));

vi.mock("./actions/setup-progress", () => ({
  isFirstRun: vi.fn(),
  createSetupProgress: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { checkBootstrapNeeded, seedOnboardingAgent } from "./bootstrap-first-run";
import { isFirstRun } from "./actions/setup-progress";

describe("bootstrap-first-run", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("checkBootstrapNeeded", () => {
    it("returns true when isFirstRun is true", async () => {
      (isFirstRun as any).mockResolvedValue(true);
      expect(await checkBootstrapNeeded()).toBe(true);
    });

    it("returns false when isFirstRun is false", async () => {
      (isFirstRun as any).mockResolvedValue(false);
      expect(await checkBootstrapNeeded()).toBe(false);
    });
  });

  describe("seedOnboardingAgent", () => {
    it("upserts the onboarding-coo agent", async () => {
      (prisma.agent.upsert as any).mockResolvedValue({
        agentId: "onboarding-coo",
      });
      await seedOnboardingAgent();
      expect(prisma.agent.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { agentId: "onboarding-coo" },
          create: expect.objectContaining({
            agentId: "onboarding-coo",
            name: "Onboarding COO",
            type: "onboarding",
            tier: 1,
            preferredProviderId: "ollama",
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/bootstrap-first-run.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement bootstrap logic**

```typescript
// apps/web/lib/bootstrap-first-run.ts
import { prisma } from "@dpf/db";
import { checkBundledProviders } from "./ollama";
import { isFirstRun, createSetupProgress } from "./actions/setup-progress";

/** Check if first-run bootstrap is needed. */
export async function checkBootstrapNeeded(): Promise<boolean> {
  return isFirstRun();
}

/** Seed the onboarding-coo agent definition. */
export async function seedOnboardingAgent(): Promise<void> {
  await prisma.agent.upsert({
    where: { agentId: "onboarding-coo" },
    create: {
      agentId: "onboarding-coo",
      name: "Onboarding COO",
      tier: 1,
      type: "onboarding",
      description: "Guides new platform owners through initial setup.",
      status: "active",
      preferredProviderId: "ollama",
    },
    update: {
      status: "active",
      preferredProviderId: "ollama",
    },
  });
}

export type BootstrapStatus =
  | { phase: "checking" }
  | { phase: "pulling_model"; progress: number; total: number; status: string }
  | { phase: "ready" }
  | { phase: "failed"; error: string };

/**
 * Execute the full first-run bootstrap sequence.
 *
 * 1. Run checkBundledProviders() to activate Ollama
 * 2. Verify at least one model is available (or trigger pull)
 * 3. Set sensitivity clearance on Ollama provider
 * 4. Seed the onboarding agent
 * 5. Create a PlatformSetupProgress record
 *
 * Returns the setup progress ID for redirect.
 */
export async function executeFirstRunBootstrap(
  onStatus?: (status: BootstrapStatus) => void,
): Promise<{ setupId: string } | { error: string }> {
  try {
    onStatus?.({ phase: "checking" });

    // 1. Activate Ollama via existing health check
    await checkBundledProviders();

    // 2. Check if Ollama is now active with models
    const ollamaProvider = await prisma.modelProvider.findFirst({
      where: { providerId: "ollama" },
    });

    if (!ollamaProvider || ollamaProvider.status !== "active") {
      return { error: "Ollama is not reachable. Please ensure it is running." };
    }

    // 3. Set sensitivity clearance
    await prisma.modelProvider.update({
      where: { providerId: "ollama" },
      data: {
        sensitivityClearance: ["public", "internal", "confidential", "restricted"],
      },
    });

    // 4. Seed onboarding agent
    await seedOnboardingAgent();

    // 5. Create setup progress
    const progress = await createSetupProgress();

    onStatus?.({ phase: "ready" });
    return { setupId: progress.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onStatus?.({ phase: "failed", error: msg });
    return { error: msg };
  }
}
```

- [ ] **Step 4: Ensure getOllamaBaseUrl is exported from ollama.ts**

Check `apps/web/lib/ollama.ts` — if `getOllamaBaseUrl` is not exported, add `export` to its declaration.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/bootstrap-first-run.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/bootstrap-first-run.ts apps/web/lib/bootstrap-first-run.test.ts apps/web/lib/ollama.ts
git commit -m "feat(setup): add first-run bootstrap with Ollama activation and agent seeding"
```

---

## Task 6: Setup UI Components

**Files:**
- Create: `apps/web/components/setup/SetupProgressBar.tsx`
- Create: `apps/web/components/setup/SetupStepNav.tsx`
- Create: `apps/web/components/setup/StaticCOOPanel.tsx`
- Create: `apps/web/components/setup/SetupLayout.tsx`
- Create: `apps/web/components/setup/SetupEventQueue.ts`

- [ ] **Step 1: Create SetupProgressBar component**

```tsx
// apps/web/components/setup/SetupProgressBar.tsx
"use client";

import { SETUP_STEPS, type SetupStep, type StepStatus } from "@/lib/actions/setup-progress";

const STEP_LABELS: Record<SetupStep, string> = {
  "business-identity": "Business",
  "owner-account": "Account",
  "ai-capabilities": "AI Setup",
  "branding": "Branding",
  "financial-basics": "Financials",
  "first-workspace": "Workspace",
  "extensibility-preview": "Extend",
  "whats-next": "Summary",
};

type Props = {
  currentStep: string;
  steps: Record<string, StepStatus>;
  onStepClick?: (step: SetupStep) => void;
};

export function SetupProgressBar({ currentStep, steps, onStepClick }: Props) {
  return (
    <nav className="flex items-center gap-1 px-6 py-3 border-b bg-white">
      {SETUP_STEPS.map((step, idx) => {
        const status = steps[step] ?? "pending";
        const isCurrent = step === currentStep;
        return (
          <button
            key={step}
            onClick={() => onStepClick?.(step)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${isCurrent ? "bg-blue-100 text-blue-800" : ""}
              ${status === "completed" ? "text-green-700" : ""}
              ${status === "skipped" ? "text-gray-400" : ""}
              ${status === "pending" && !isCurrent ? "text-gray-500" : ""}
            `}
          >
            <span className="w-5 h-5 flex items-center justify-center rounded-full text-xs border">
              {status === "completed" ? "\u2713" : status === "skipped" ? "\u2014" : idx + 1}
            </span>
            {STEP_LABELS[step]}
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Create SetupStepNav component**

```tsx
// apps/web/components/setup/SetupStepNav.tsx
"use client";

type Props = {
  onContinue: () => void;
  onSkip: () => void;
  onPause: () => void;
  isLastStep?: boolean;
  continueDisabled?: boolean;
  continueLabel?: string;
};

export function SetupStepNav({
  onContinue,
  onSkip,
  onPause,
  isLastStep = false,
  continueDisabled = false,
  continueLabel,
}: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t bg-gray-50">
      <button
        onClick={onPause}
        className="text-sm text-gray-500 hover:text-gray-700"
      >
        Pause and come back later
      </button>
      <div className="flex gap-3">
        <button
          onClick={onSkip}
          className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
        >
          Skip for now
        </button>
        <button
          onClick={onContinue}
          disabled={continueDisabled}
          className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {continueLabel ?? (isLastStep ? "Finish Setup" : "Continue")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create StaticCOOPanel for pre-auth steps**

```tsx
// apps/web/components/setup/StaticCOOPanel.tsx
"use client";

type Props = {
  messages: Array<{ text: string }>;
};

export function StaticCOOPanel({ messages }: Props) {
  return (
    <div className="flex flex-col h-full bg-gray-50 border-l">
      <div className="px-4 py-3 border-b bg-white">
        <h3 className="text-sm font-semibold text-gray-900">Onboarding COO</h3>
        <p className="text-xs text-gray-500">Your AI operations officer</p>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="bg-white rounded-lg p-3 shadow-sm border text-sm text-gray-700 leading-relaxed">
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create SetupEventQueue for page-chat coordination**

```typescript
// apps/web/components/setup/SetupEventQueue.ts

export type SetupEvent = {
  event: "field_updated" | "step_completed" | "step_skipped" | "error" | "provider_test_success" | "provider_test_failure";
  field?: string;
  value?: string;
  message?: string;
};

type EventHandler = (events: SetupEvent[]) => void;

/**
 * Client-side event queue that debounces setup page events
 * before sending them to the COO chat panel.
 *
 * Events are batched on 500ms idle. If the handler signals
 * it's busy (e.g., LLM is generating), events queue until
 * the handler calls `resume()`.
 */
export class SetupEventQueue {
  private queue: SetupEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  private handler: EventHandler;
  private debounceMs: number;

  constructor(handler: EventHandler, debounceMs = 500) {
    this.handler = handler;
    this.debounceMs = debounceMs;
  }

  push(event: SetupEvent) {
    this.queue.push(event);
    if (this.busy) return; // Hold events while handler is processing
    this.resetTimer();
  }

  /** Signal that the handler is done processing — flush any queued events. */
  resume() {
    this.busy = false;
    if (this.queue.length > 0) {
      this.flush();
    }
  }

  private resetTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
  }

  private flush() {
    if (this.queue.length === 0) return;
    const batch = [...this.queue];
    this.queue = [];
    this.busy = true;
    this.handler(batch);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }
}
```

- [ ] **Step 5: Create SetupLayout wrapper**

```tsx
// apps/web/components/setup/SetupLayout.tsx
"use client";

import { type ReactNode } from "react";

type Props = {
  leftPanel: ReactNode;
  rightPanel: ReactNode;
};

export function SetupLayout({ leftPanel, rightPanel }: Props) {
  return (
    <div className="flex h-[calc(100vh-52px)]">
      <div className="flex-1 overflow-y-auto min-w-0">
        {leftPanel}
      </div>
      <div className="w-[350px] flex-shrink-0">
        {rightPanel}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/setup/
git commit -m "feat(setup): add setup UI components — progress bar, nav, static COO panel, event queue, layout"
```

---

## Task 7: Setup Route Group + Orchestrator Page

**Files:**
- Create: `apps/web/app/(setup)/layout.tsx`
- Create: `apps/web/app/(setup)/setup/page.tsx`
- Modify: `apps/web/middleware.ts` (allow `/setup` unauthenticated for Steps 1-2)
- Modify: `apps/web/app/(shell)/layout.tsx` (add first-run redirect)

- [ ] **Step 1: Create (setup) route group layout**

```tsx
// apps/web/app/(setup)/layout.tsx
import { type ReactNode } from "react";

export default function SetupRouteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-100">
      {children}
    </div>
  );
}
```

Note: This is a separate route group from `(shell)` — no navigation chrome, no sidebar. Do NOT render `<html>` or `<body>` tags here — the root `app/layout.tsx` already provides those. Route group layouts are nested inside the root layout.

- [ ] **Step 2: Create setup orchestrator page**

```tsx
// apps/web/app/(setup)/setup/page.tsx
import { redirect } from "next/navigation";
import { getSetupProgress } from "@/lib/actions/setup-progress";
import { checkBootstrapNeeded, executeFirstRunBootstrap } from "@/lib/bootstrap-first-run";
import { SetupOrchestrator } from "./SetupOrchestrator";

export default async function SetupPage() {
  // If not first run and no active setup, redirect to main app
  const needsBootstrap = await checkBootstrapNeeded();
  let progress = await getSetupProgress();

  if (!needsBootstrap && !progress) {
    redirect("/workspace");
  }

  // First run: execute bootstrap if no progress exists
  if (needsBootstrap && !progress) {
    const result = await executeFirstRunBootstrap();
    if ("error" in result) {
      // Render static fallback page with error
      return (
        <div className="flex items-center justify-center min-h-screen">
          <div className="max-w-md text-center space-y-4">
            <h1 className="text-2xl font-bold">Welcome</h1>
            <p className="text-gray-600">
              We couldn&apos;t start the AI assistant automatically: {result.error}
            </p>
            <p className="text-sm text-gray-500">
              Please ensure Ollama is running and try refreshing this page.
            </p>
          </div>
        </div>
      );
    }
    progress = await getSetupProgress();
  }

  if (!progress) {
    redirect("/workspace");
  }

  return <SetupOrchestrator progress={progress} />;
}
```

- [ ] **Step 3: Create SetupOrchestrator client component**

```tsx
// apps/web/app/(setup)/setup/SetupOrchestrator.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SetupProgressBar } from "@/components/setup/SetupProgressBar";
import { type SetupStep, type StepStatus } from "@/lib/actions/setup-progress";
import { advanceStep, skipStep, pauseSetup } from "@/lib/actions/setup-progress";

// Step components will be imported here as they are built
// import { BusinessIdentityStep } from "./steps/business-identity";
// ... etc

type Props = {
  progress: {
    id: string;
    currentStep: string;
    steps: Record<string, StepStatus>;
    context: Record<string, unknown>;
  };
};

export function SetupOrchestrator({ progress: initialProgress }: Props) {
  const [progress, setProgress] = useState(initialProgress);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleContinue = (contextUpdate?: Record<string, unknown>) => {
    startTransition(async () => {
      const updated = await advanceStep(progress.id, contextUpdate);
      if (updated.completedAt) {
        router.push("/workspace");
      } else {
        setProgress({
          id: updated.id,
          currentStep: updated.currentStep,
          steps: updated.steps as Record<string, StepStatus>,
          context: updated.context as Record<string, unknown>,
        });
      }
    });
  };

  const handleSkip = () => {
    startTransition(async () => {
      const updated = await skipStep(progress.id);
      if (updated.completedAt) {
        router.push("/workspace");
      } else {
        setProgress({
          id: updated.id,
          currentStep: updated.currentStep,
          steps: updated.steps as Record<string, StepStatus>,
          context: updated.context as Record<string, unknown>,
        });
      }
    });
  };

  const handlePause = () => {
    startTransition(async () => {
      await pauseSetup(progress.id);
      router.push("/");
    });
  };

  const handleStepClick = (step: SetupStep) => {
    // Allow jumping to any step (COO will acknowledge)
    setProgress((prev) => ({ ...prev, currentStep: step }));
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SetupProgressBar
        currentStep={progress.currentStep}
        steps={progress.steps}
        onStepClick={handleStepClick}
      />
      <div className="flex-1">
        {/* Step content rendered here based on progress.currentStep */}
        {/* Each step component receives onContinue, onSkip, onPause, and progress.context */}
        <div className="flex items-center justify-center h-full text-gray-400">
          Step: {progress.currentStep} (component placeholder)
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add first-run redirect to shell layout**

In `apps/web/app/(shell)/layout.tsx`, add at the top of the component (before the existing discovery check):

```typescript
// First-run check — redirect to setup if no org exists
const { isFirstRun } = await import("@/lib/actions/setup-progress");
if (await isFirstRun()) {
  redirect("/setup");
}
```

Add `redirect` import from `next/navigation` if not already present.

- [ ] **Step 5: Verify /setup bypasses auth**

No `middleware.ts` exists in this project — auth is enforced by the `(shell)` route group layout which calls `auth()` and redirects unauthenticated users. Since `(setup)` is a separate route group with its own layout that does NOT call `auth()`, routes under `/setup` are naturally accessible without authentication. Verify this by checking that `apps/web/app/(setup)/layout.tsx` has no auth guard. No changes needed.

- [ ] **Step 6: Verify the app compiles and runs**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/\(setup\)/ apps/web/app/\(shell\)/layout.tsx apps/web/middleware.ts
git commit -m "feat(setup): add setup route group with orchestrator and first-run redirect"
```

---

## Task 8: Step Components — Phase 1 (Business Identity + Owner Account)

**Files:**
- Create: `apps/web/app/(setup)/setup/steps/business-identity.tsx`
- Create: `apps/web/app/(setup)/setup/steps/owner-account.tsx`

These are Phase 1 steps — static COO guidance text, no live chat.

- [ ] **Step 1: Create BusinessIdentityStep component**

```tsx
// apps/web/app/(setup)/setup/steps/business-identity.tsx
"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  {
    text: "Welcome. I'm your AI operations officer \u2014 think of me as your second-in-command for running this platform.",
  },
  {
    text: "I should be upfront: I'm running on a local AI model right now. That means I can handle this walkthrough and day-to-day conversations, but for complex tasks like regulatory analysis, document processing, or deep research, we'll want to connect a more capable AI service. I'll help you with that in a few steps.",
  },
  {
    text: "Let's start with the basics \u2014 tell me about your business.",
  },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function BusinessIdentityStep({ onContinue, onSkip, onPause }: Props) {
  const [orgName, setOrgName] = useState("");
  const [industry, setIndustry] = useState("");
  const [location, setLocation] = useState("");
  const [timezone, setTimezone] = useState("");

  const canContinue = orgName.trim().length > 0;

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Business Identity</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Organization Name *
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="e.g., Riverside Medical Group"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Industry / Sector
                </label>
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select an industry...</option>
                  <option value="healthcare">Healthcare</option>
                  <option value="financial-services">Financial Services</option>
                  <option value="legal">Legal</option>
                  <option value="manufacturing">Manufacturing</option>
                  <option value="retail">Retail</option>
                  <option value="technology">Technology</option>
                  <option value="consulting">Consulting / Professional Services</option>
                  <option value="education">Education</option>
                  <option value="government">Government</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Primary Location
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g., Portland, Oregon"
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select timezone...</option>
                  <option value="America/New_York">Eastern (US)</option>
                  <option value="America/Chicago">Central (US)</option>
                  <option value="America/Denver">Mountain (US)</option>
                  <option value="America/Los_Angeles">Pacific (US)</option>
                  <option value="Europe/London">London (GMT)</option>
                  <option value="Europe/Berlin">Central Europe</option>
                  <option value="Asia/Tokyo">Tokyo</option>
                  <option value="Australia/Sydney">Sydney</option>
                </select>
              </div>
            </div>
          </div>
          <SetupStepNav
            onContinue={() => onContinue({ orgName, industry, location, timezone })}
            onSkip={onSkip}
            onPause={onPause}
            continueDisabled={!canContinue}
          />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
```

- [ ] **Step 2: Create OwnerAccountStep component**

```tsx
// apps/web/app/(setup)/setup/steps/owner-account.tsx
"use client";

import { useState } from "react";
import { SetupLayout } from "@/components/setup/SetupLayout";
import { StaticCOOPanel } from "@/components/setup/StaticCOOPanel";
import { SetupStepNav } from "@/components/setup/SetupStepNav";

const COO_MESSAGES = [
  {
    text: "Now let's set up your account. You'll be the platform owner \u2014 full access to everything.",
  },
  {
    text: "You can add team members later and control what each person can see and do.",
  },
];

type Props = {
  onContinue: (context: Record<string, unknown>) => void;
  onSkip: () => void;
  onPause: () => void;
};

export function OwnerAccountStep({ onContinue, onSkip, onPause }: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const canContinue =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8;

  return (
    <SetupLayout
      leftPanel={
        <div className="flex flex-col h-full">
          <div className="flex-1 p-8 max-w-xl">
            <h2 className="text-xl font-semibold mb-6">Owner Account</h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password * (8+ characters)
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
          <SetupStepNav
            onContinue={() => onContinue({ ownerName: name, ownerEmail: email })}
            onSkip={onSkip}
            onPause={onPause}
            continueDisabled={!canContinue}
          />
        </div>
      }
      rightPanel={<StaticCOOPanel messages={COO_MESSAGES} />}
    />
  );
}
```

- [ ] **Step 3: Wire steps into SetupOrchestrator**

Update `apps/web/app/(setup)/setup/SetupOrchestrator.tsx` to import and render the step components based on `progress.currentStep`. Replace the placeholder `<div>` with a switch on step name.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(setup\)/setup/steps/ apps/web/app/\(setup\)/setup/SetupOrchestrator.tsx
git commit -m "feat(setup): add Phase 1 step components — business identity and owner account"
```

---

## Task 9: Entity Creation Server Actions (Organization + User + Auto-Login)

**Files:**
- Create: `apps/web/lib/actions/setup-entities.ts`

The Phase 1 step components (Task 8) collect org and user data but need server actions to actually create the database records and establish a session.

- [ ] **Step 1: Create entity creation actions**

```typescript
// apps/web/lib/actions/setup-entities.ts
"use server";

import { prisma } from "@dpf/db";
import bcrypt from "bcryptjs";
import { signIn } from "@/lib/auth";
import { linkSetupToOrg, linkSetupToUser } from "./setup-progress";

/**
 * Create the Organization record from Step 1 data.
 * Called when the user clicks Continue on the Business Identity step.
 */
export async function createOrganization(
  setupId: string,
  data: { orgName: string; industry?: string; location?: string; timezone?: string },
) {
  const slug = data.orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const org = await prisma.organization.create({
    data: {
      orgId: `ORG-${Date.now()}`,
      name: data.orgName,
      slug,
      industry: data.industry || null,
      address: data.location ? { location: data.location, timezone: data.timezone } : null,
    },
  });

  await linkSetupToOrg(setupId, org.id);
  return org;
}

/**
 * Create the User (owner) record from Step 2 data and auto-login.
 * Called when the user clicks Continue on the Owner Account step.
 */
export async function createOwnerAccount(
  setupId: string,
  data: { name: string; email: string; password: string },
) {
  const passwordHash = await bcrypt.hash(data.password, 12);

  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      isSuperuser: true,
      isActive: true,
    },
  });

  await linkSetupToUser(setupId, user.id);

  // Auto-login via NextAuth credentials provider
  await signIn("credentials", {
    email: data.email,
    password: data.password,
    redirect: false,
  });

  return { userId: user.id };
}
```

Note: The exact `signIn` import and call pattern depends on the project's NextAuth configuration. Check `apps/web/lib/auth.ts` for the correct export and adapt the import. If `signIn` is a client-side function, the auto-login will need to happen via a client-side call from the `OwnerAccountStep` component after the server action creates the user.

- [ ] **Step 2: Wire entity creation into step components**

Update `BusinessIdentityStep` (Task 8) `onContinue` handler to call `createOrganization()` before advancing.
Update `OwnerAccountStep` (Task 8) `onContinue` handler to call `createOwnerAccount()` before advancing. After successful account creation, the page should refresh or redirect to re-render with the authenticated session for Phase 2.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/setup-entities.ts
git commit -m "feat(setup): add Organization and User creation server actions with auto-login"
```

---

## Task 10: Step Components — Phase 2 (AI Capabilities + Remaining Steps)

**Files:**
- Create: `apps/web/app/(setup)/setup/steps/ai-capabilities.tsx`
- Create: `apps/web/app/(setup)/setup/steps/branding.tsx`
- Create: `apps/web/app/(setup)/setup/steps/financial-basics.tsx`
- Create: `apps/web/app/(setup)/setup/steps/first-workspace.tsx`
- Create: `apps/web/app/(setup)/setup/steps/extensibility-preview.tsx`
- Create: `apps/web/app/(setup)/setup/steps/whats-next.tsx`

These are Phase 2 steps — they use the live COO chat panel via `AgentCoworkerPanel`. The AI Capabilities step is the most complex (provider education + API key entry + test). The remaining steps are simpler forms.

- [ ] **Step 1: Create AiCapabilitiesStep**

This is the key educational step. It shows the three tiers (local, cloud, enterprise) and optionally walks through adding a cloud provider API key.

The left panel shows:
- Three tier cards explaining local / cloud / enterprise
- An "Add Cloud Provider" section with API key input and test button
- Provider test result feedback

The right panel is the live `AgentCoworkerPanel` (since user is now authenticated after Step 2).

Implementation note: the COO chat panel integration requires passing `threadId`, `initialMessages`, and `userContext` from the server component. The step component should accept these as props from the `SetupOrchestrator`, which fetches them via `getOrCreateThreadSnapshot({ routeContext: "/setup" })`.

- [ ] **Step 2: Create remaining step components**

Create `branding.tsx`, `financial-basics.tsx`, `first-workspace.tsx`, `extensibility-preview.tsx`, and `whats-next.tsx` as simpler components following the same pattern. Each uses `SetupLayout` with the live COO panel on the right.

The `whats-next` step shows a summary of completed/skipped steps and next-steps guidance. Its "Continue" button calls `completeSetup()` and redirects to `/workspace`.

- [ ] **Step 3: Wire all steps into SetupOrchestrator**

Update the orchestrator to import all step components and render them based on `currentStep`. For Phase 2 steps, pass the thread snapshot and user context.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(setup\)/setup/steps/ apps/web/app/\(setup\)/setup/SetupOrchestrator.tsx
git commit -m "feat(setup): add Phase 2 step components — AI capabilities, branding, financials, workspace, extensibility, summary"
```

---

## Task 10: COO System Prompt Assembly

**Files:**
- Create: `apps/web/lib/onboarding-prompt.ts`

- [ ] **Step 1: Create dynamic system prompt builder**

```typescript
// apps/web/lib/onboarding-prompt.ts
import type { SetupContext, SetupStep, StepStatus } from "./actions/setup-progress";
import { SETUP_STEPS } from "./actions/setup-progress";
import { prisma } from "@dpf/db";

const COO_BASE_PROMPT = `You are the platform's Chief Operating Officer — the user's second-in-command.
You are guiding a new platform owner through initial setup.

This is a CONVERSATION request. You have no tools. Do not attempt to call functions, execute actions, or generate structured output.

IMPORTANT CONSTRAINTS:
- You are running on a local AI model (Ollama). Be honest about this.
- Do not attempt complex reasoning, multi-step analysis, or tool orchestration.
- Your job is guided conversation: explain, recommend, and acknowledge.
- If the user asks something beyond your capability, say so clearly and note that a cloud AI provider would handle it better.

TONE:
- Professional and understanding. Not cute, not robotic.
- Frame yourself as their operational partner, not a setup wizard.
- Use "we" when describing platform capabilities.
- Be direct about trade-offs — don't oversell.

AT EVERY STEP BOUNDARY, offer three options:
1. Continue to the next step
2. Skip this step for now
3. Pause and come back later`;

/**
 * Assemble the full COO system prompt for the onboarding agent,
 * injecting current setup state and provider pricing data.
 */
export async function buildOnboardingPrompt(
  currentStep: SetupStep,
  steps: Record<string, StepStatus>,
  context: SetupContext,
): Promise<string> {
  const completedSteps = SETUP_STEPS.filter((s) => steps[s] === "completed");
  const skippedSteps = SETUP_STEPS.filter((s) => steps[s] === "skipped");

  // Load provider pricing for cost explanations
  let costSummary = "";
  if (currentStep === "ai-capabilities") {
    const providers = await prisma.modelProvider.findMany({
      where: { endpointType: "llm", status: { not: "unconfigured" } },
      select: {
        providerId: true,
        name: true,
        inputPricePerMToken: true,
        outputPricePerMToken: true,
        costModel: true,
        userFacingDescription: true,
      },
    });
    if (providers.length > 0) {
      costSummary = providers
        .filter((p) => p.costModel === "token" && p.inputPricePerMToken)
        .map(
          (p) =>
            `${p.name}: ~$${((p.inputPricePerMToken! * 2000 + (p.outputPricePerMToken ?? 0) * 500) / 1_000_000).toFixed(4)} per typical conversation`,
        )
        .join("; ");
    }
  }

  return `${COO_BASE_PROMPT}

CURRENT STATE:
- Step: ${currentStep}
- Completed: ${completedSteps.join(", ") || "none"}
- Skipped: ${skippedSteps.join(", ") || "none"}
- Industry: ${context.industry ?? "not set"}
- Has cloud provider: ${context.hasCloudProvider ? "yes" : "no"}
${costSummary ? `\nTYPICAL PROVIDER PRICING (quote as "typical pricing", not "your pricing"):\n${costSummary}` : ""}`;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/onboarding-prompt.ts
git commit -m "feat(setup): add dynamic COO system prompt builder with provider pricing"
```

---

## Task 11: Epic Seed Script

**Files:**
- Create: `packages/db/scripts/seed-onboarding-epic.ts`

- [ ] **Step 1: Create seed script**

Follow the pattern from existing seed scripts (e.g., `seed-oauth-epic.ts`):

```typescript
// packages/db/scripts/seed-onboarding-epic.ts
// Run from repo root: pnpm --filter @dpf/db exec tsx scripts/seed-onboarding-epic.ts
import { prisma } from "../src/client";

async function main() {
  const foundational = await prisma.portfolio.findUnique({ where: { slug: "foundational" } });
  if (!foundational) throw new Error("foundational portfolio not seeded");

  // EP-ONBOARD-001
  const epic1 = await prisma.epic.upsert({
    where: { epicId: "EP-ONBOARD-001" },
    update: {
      title: "COO-Led Platform Onboarding",
      description:
        "AI Coworker-led setup experience where the COO persona guides non-technical users " +
        "through initial platform configuration. Ollama auto-bootstraps on first launch. " +
        "Spec: docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md",
    },
    create: {
      epicId: "EP-ONBOARD-001",
      title: "COO-Led Platform Onboarding",
      description:
        "AI Coworker-led setup experience where the COO persona guides non-technical users " +
        "through initial platform configuration. Ollama auto-bootstraps on first launch. " +
        "Spec: docs/superpowers/specs/2026-03-21-coo-led-onboarding-design.md",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic1.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic1.id, portfolioId: foundational.id },
  });

  // EP-ONBOARD-002
  const epic2 = await prisma.epic.upsert({
    where: { epicId: "EP-ONBOARD-002" },
    update: {
      title: "Platform Extensibility Demo (Onboarding)",
      description:
        "Guided walkthrough of Build Studio self-development during onboarding. " +
        "Parked until the self-dev pipeline is production-ready.",
    },
    create: {
      epicId: "EP-ONBOARD-002",
      title: "Platform Extensibility Demo (Onboarding)",
      description:
        "Guided walkthrough of Build Studio self-development during onboarding. " +
        "Parked until the self-dev pipeline is production-ready.",
      status: "open",
    },
  });

  await prisma.epicPortfolio.upsert({
    where: { epicId_portfolioId: { epicId: epic2.id, portfolioId: foundational.id } },
    update: {},
    create: { epicId: epic2.id, portfolioId: foundational.id },
  });

  console.log(`Seeded ${epic1.epicId}: "${epic1.title}" → foundational portfolio`);
  console.log(`Seeded ${epic2.epicId}: "${epic2.title}" → foundational portfolio`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run the seed script**

Run: `cd packages/db && npx tsx scripts/seed-onboarding-epic.ts`
Expected: `Seeded EP-ONBOARD-001 and EP-ONBOARD-002`

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-onboarding-epic.ts
git commit -m "chore(db): seed EP-ONBOARD-001 and EP-ONBOARD-002 epics"
```

---

## Task 12: Integration Test — Full Setup Flow

**Files:**
- Create: `apps/web/lib/actions/setup-integration.test.ts`

- [ ] **Step 1: Write integration test for the full setup flow**

```typescript
// apps/web/lib/actions/setup-integration.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dpf/db", () => {
  const records: Record<string, any> = {};
  return {
    prisma: {
      organization: { count: vi.fn(() => 0) },
      platformSetupProgress: {
        findFirst: vi.fn(() => null),
        findUniqueOrThrow: vi.fn((args: any) => records[args.where.id]),
        create: vi.fn((args: any) => {
          const record = { id: "setup-1", ...args.data, completedAt: null };
          records["setup-1"] = record;
          return record;
        }),
        update: vi.fn((args: any) => {
          const record = { ...records[args.where.id], ...args.data };
          records[args.where.id] = record;
          return record;
        }),
      },
    },
  };
});

import {
  isFirstRun,
  createSetupProgress,
  advanceStep,
  skipStep,
  SETUP_STEPS,
} from "./setup-progress";

describe("setup flow integration", () => {
  it("walks through the full step sequence", async () => {
    // First run detected
    expect(await isFirstRun()).toBe(true);

    // Create setup progress
    const progress = await createSetupProgress();
    expect(progress.currentStep).toBe("business-identity");

    // Advance through step 1
    const step2 = await advanceStep(progress.id, { orgName: "Test Co" });
    expect(step2.currentStep).toBe("owner-account");

    // Skip step 2
    const step3 = await skipStep(progress.id);
    expect(step3.currentStep).toBe("ai-capabilities");

    // Advance remaining steps
    let current = step3;
    for (let i = 2; i < SETUP_STEPS.length - 1; i++) {
      current = await advanceStep(progress.id);
    }

    // Final advance should complete
    const final = await advanceStep(progress.id);
    expect(final.completedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `cd apps/web && npx vitest run lib/actions/setup-integration.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Run full type check**

Run: `cd apps/web && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/setup-integration.test.ts
git commit -m "test(setup): add integration test for full setup step flow"
```

---

## Deferred Items (Not In This Plan)

The following spec requirements are intentionally deferred to follow-up work:

- **Post-onboarding integration:** Provider Page Help, Setup Resume banner, Skipped Step Reminders (spec sections under "Post-Onboarding Integration"). These require the onboarding core to be working first.
- **Ollama model auto-pull with streaming progress:** The `BootstrapStatus` type is defined but the streaming pull UI is deferred. For now, bootstrap assumes a model is already pulled (Docker image can pre-bundle one) or `checkBundledProviders()` discovers it. Streaming pull can be added as a fast-follow.
- **Registry sync job for `userFacingDescription`:** Task 3 adds `userFacing` data to the registry JSON and Task 1 adds the DB column. The sync job that populates the column from the registry at startup needs to be updated — this should be done as part of the existing registry sync job enhancement, not as a standalone task.
- **Dynamic prompt wiring:** Task 11 creates `buildOnboardingPrompt()` but the integration into the `sendMessage` flow (checking for `onboarding-coo` agent and using the dynamic prompt instead of the static route map prompt) should be done when wiring Phase 2 steps. The implementer should modify the `sendMessage` path to call `buildOnboardingPrompt()` when `agentId === "onboarding-coo"`.
- **Universal skills suppression:** The `ROUTE_CONTEXT_MAP` entry for `/setup` uses `skills: []` but `UNIVERSAL_SKILLS` are still merged in by `resolveRouteContext()`. Some universal skills ("Do this for me") conflict with the no-tools constraint. The implementer should either add a `suppressUniversal: true` flag or filter them out for the `/setup` route.

---

## Task 13: Cleanup Diagnostic Scripts

**Files:**
- Delete: `packages/db/scripts/debug-sensitivity.ts`
- Delete: `packages/db/scripts/fix-sensitivity-clearance.ts`

- [ ] **Step 1: Remove temporary diagnostic scripts from earlier bugfix**

These were created during the sensitivity clearance debugging session and are no longer needed.

- [ ] **Step 2: Commit**

```bash
git rm packages/db/scripts/debug-sensitivity.ts packages/db/scripts/fix-sensitivity-clearance.ts
git commit -m "chore: remove temporary diagnostic scripts"
```
