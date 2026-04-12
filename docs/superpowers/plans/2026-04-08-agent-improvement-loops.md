# Agent Improvement Loops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the feedback loop so every AI coworker learns from its failures — aggressively at first (establishing norms), subtly over time (tuning) — and graduates stable conventions into tool enforcement.

**Architecture:** Signal classifiers detect error patterns from build failures and low evaluation scores → `AgentConvention` records accumulate occurrences → maturity-gated thresholds promote conventions to active → `getConventionsBlock()` injects active conventions into agent system prompts → stable conventions surface as graduation candidates for tool-level enforcement. Follows the three-stage arc: human cognitive load → AI convention → codified tool.

**Tech Stack:** TypeScript, Prisma 7, PostgreSQL, Next.js 16 App Router, Vitest

**Spec:** Designed in conversation 2026-04-08. Key reference files: `apps/web/lib/routing/production-feedback.ts` (two-stage pattern), `apps/web/lib/tak/orchestrator-evaluator.ts` (agent scoring), `apps/web/lib/integrate/specialist-prompts.ts` (prompt injection point), `apps/web/lib/tak/prompt-assembler.ts` (coworker prompt assembly).

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `packages/db/prisma/migrations/20260410210000_add_agent_convention/migration.sql` | Migration for AgentConvention model |
| `packages/db/data/agent_conventions.json` | Seed data: initial conventions from known failure patterns |
| `apps/web/lib/tak/agent-conventions.ts` | `getConventionsBlock()` — queries active conventions, maturity-gated injection |
| `apps/web/lib/integrate/convention-classifier.ts` | Regex-based build error classifier + upsert logic |
| `apps/web/lib/tak/convention-evaluator-bridge.ts` | Evaluator-triggered classifier (lightweight LLM call on low scores) |
| `apps/web/lib/actions/conventions-admin.ts` | Server actions: CRUD, toggle active, graduate |
| `apps/web/app/(shell)/admin/workforce/conventions/page.tsx` | Admin page: server component, data fetching |
| `apps/web/components/admin/ConventionsPanel.tsx` | Client component: table, filters, edit, toggle, graduation tab |
| `apps/web/lib/tak/agent-conventions.test.ts` | Tests for convention query, maturity gating, decay |
| `apps/web/lib/integrate/convention-classifier.test.ts` | Tests for build error classifier |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `AgentConvention` model |
| `packages/db/src/seed.ts` | Add `seedAgentConventions()` call |
| `apps/web/lib/integrate/specialist-prompts.ts` | Inject conventions block (already async) |
| `apps/web/lib/integrate/build-orchestrator.ts` | Add post-build convention classification trigger |
| `apps/web/lib/tak/orchestrator-evaluator.ts` | Add post-evaluation convention classification trigger |
| `apps/web/lib/tak/prompt-assembler.ts` | Add optional `agentConventions` block to `PromptInput` and assembly |
| `apps/web/lib/actions/agent-coworker.ts` | Fetch and pass conventions block when assembling coworker prompts |

---

## Task 1: AgentConvention Prisma Model + Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260410210000_add_agent_convention/migration.sql`

- [ ] **Step 1: Add the AgentConvention model to schema.prisma**

Open `packages/db/prisma/schema.prisma` and add after the `AgentPerformance` model (ends at line 1416, before `FeatureDegradationMapping` at line 1418):

```prisma
/// Learned conventions injected into agent system prompts.
/// Auto-detected from build failures and low evaluation scores,
/// or manually created by admins. Maturity-gated: agents in "learning"
/// phase see more conventions; "innate" agents see fewer.
/// Three-stage arc: human knowledge → agent convention → codified tool.
model AgentConvention {
  id               String    @id @default(cuid())
  agentId          String                      /// Agent ID (e.g. "AGT-BUILD-SE") or "*" for all agents
  category         String                      /// Error pattern category (e.g. "type-only-import", "tool-misuse")
  convention       String                      /// Instruction text injected into prompt
  source           String    @default("auto")  /// "auto" | "evaluator" | "manual"
  active           Boolean   @default(false)
  severity         String    @default("norm")  /// "norm" (foundational) | "tuning" (refinement)
  occurrences      Int       @default(0)
  firstSeenAt      DateTime  @default(now())
  lastSeenAt       DateTime  @default(now())
  originBuildId    String?                     /// Build that first triggered this (build-sourced)
  originThreadId   String?                     /// Thread that first triggered this (evaluator-sourced)
  decayedAt        DateTime?                   /// When convention was auto-demoted as internalized
  graduation       String    @default("pending") /// "pending" | "candidate" | "exempt" | "completed"
  graduationItemId String?                     /// BacklogItem.id if graduated to a backlog item
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  @@index([agentId, active])
  @@index([category])
  @@index([severity])
  @@unique([agentId, category])
  @@index([graduation])
}
```

- [ ] **Step 2: Generate the migration**

Run inside the `portal-init` container or locally:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name add_agent_convention
```

Verify the generated SQL creates the table with all columns and indexes.

- [ ] **Step 3: Run `prisma generate` to update the client**

```bash
pnpm --filter @dpf/db exec prisma generate
```

- [ ] **Step 4: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```
feat(db): add AgentConvention model for agent improvement loops
```

---

## Task 2: Convention Query Utility — `getConventionsBlock()`

**Files:**
- Create: `apps/web/lib/tak/agent-conventions.ts`
- Create: `apps/web/lib/tak/agent-conventions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/tak/agent-conventions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getConventionsBlock,
  getPromotionThreshold,
  getInjectionLimit,
  getSeverityFilter,
  PHASE_THRESHOLDS,
  PHASE_INJECTION_LIMITS,
} from "./agent-conventions";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    agentPerformance: {
      findFirst: vi.fn(),
    },
    agentConvention: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("agent-conventions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getPromotionThreshold", () => {
    it("returns 2 for learning phase", () => {
      expect(getPromotionThreshold("learning")).toBe(2);
    });
    it("returns 4 for practicing phase", () => {
      expect(getPromotionThreshold("practicing")).toBe(4);
    });
    it("returns 8 for innate phase", () => {
      expect(getPromotionThreshold("innate")).toBe(8);
    });
    it("defaults to learning for unknown phase", () => {
      expect(getPromotionThreshold("unknown")).toBe(2);
    });
  });

  describe("getInjectionLimit", () => {
    it("returns 30 for learning", () => {
      expect(getInjectionLimit("learning")).toBe(30);
    });
    it("returns 15 for practicing", () => {
      expect(getInjectionLimit("practicing")).toBe(15);
    });
    it("returns 5 for innate", () => {
      expect(getInjectionLimit("innate")).toBe(5);
    });
  });

  describe("getSeverityFilter", () => {
    it("returns both norm and tuning for learning", () => {
      expect(getSeverityFilter("learning")).toEqual(["norm", "tuning"]);
    });
    it("returns both for practicing", () => {
      expect(getSeverityFilter("practicing")).toEqual(["norm", "tuning"]);
    });
    it("returns only tuning for innate", () => {
      expect(getSeverityFilter("innate")).toEqual(["tuning"]);
    });
  });

  describe("getConventionsBlock", () => {
    it("returns empty string when no conventions exist", async () => {
      vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.agentConvention.findMany).mockResolvedValue([]);

      const result = await getConventionsBlock("AGT-BUILD-SE");
      expect(result).toBe("");
    });

    it("includes conventions header when conventions exist", async () => {
      vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.agentConvention.findMany).mockResolvedValue([
        { id: "1", convention: "Do not use type-only imports as values" } as any,
      ]);

      const result = await getConventionsBlock("AGT-BUILD-SE");
      expect(result).toContain("Learned Conventions");
      expect(result).toContain("Do not use type-only imports as values");
    });

    it("respects innate phase injection limit", async () => {
      vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue({
        instructionPhase: "innate",
      } as any);
      vi.mocked(prisma.agentConvention.findMany).mockResolvedValue([]);

      await getConventionsBlock("AGT-BUILD-SE");

      // Verify the findMany was called with take: 5 (innate limit)
      expect(prisma.agentConvention.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 5 }),
      );
    });

    it("filters to tuning-only for innate agents", async () => {
      vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue({
        instructionPhase: "innate",
      } as any);
      vi.mocked(prisma.agentConvention.findMany).mockResolvedValue([]);

      await getConventionsBlock("AGT-BUILD-SE");

      expect(prisma.agentConvention.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            severity: { in: ["tuning"] },
          }),
        }),
      );
    });

    it("queries both agent-specific and wildcard conventions", async () => {
      vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.agentConvention.findMany).mockResolvedValue([]);

      await getConventionsBlock("AGT-BUILD-SE");

      expect(prisma.agentConvention.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            agentId: { in: ["AGT-BUILD-SE", "*"] },
          }),
        }),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run lib/tak/agent-conventions.test.ts
```

Expected: fails because `agent-conventions.ts` doesn't exist.

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/tak/agent-conventions.ts`:

```typescript
/**
 * Agent Convention injection — maturity-gated prompt enrichment.
 *
 * Queries active AgentConvention records for a given agent,
 * respecting the agent's instruction phase to control:
 * - How many conventions are injected (injection limit)
 * - What severity levels are included (norm vs tuning)
 * - How many occurrences are needed to promote a draft (threshold)
 *
 * Three-stage arc: human knowledge → agent convention → codified tool.
 * Conventions that stabilize long enough become graduation candidates
 * for tool-level enforcement.
 */
import { prisma } from "@dpf/db";

// ── Maturity-Gated Constants ────────────────────────────────────────────────

type InstructionPhase = "learning" | "practicing" | "innate";

/** How many occurrences before a draft convention becomes active. */
export const PHASE_THRESHOLDS: Record<InstructionPhase, number> = {
  learning: 2,
  practicing: 4,
  innate: 8,
};

/** Max conventions injected into the system prompt. */
export const PHASE_INJECTION_LIMITS: Record<InstructionPhase, number> = {
  learning: 30,
  practicing: 15,
  innate: 5,
};

/** Severity levels included per phase. */
const PHASE_SEVERITY_FILTER: Record<InstructionPhase, string[]> = {
  learning: ["norm", "tuning"],
  practicing: ["norm", "tuning"],
  innate: ["tuning"],
};

/** Days without a trigger before a norm convention is considered internalized. */
const DECAY_DAYS = 90;

export function getPromotionThreshold(phase: string): number {
  return PHASE_THRESHOLDS[phase as InstructionPhase] ?? PHASE_THRESHOLDS.learning;
}

export function getInjectionLimit(phase: string): number {
  return PHASE_INJECTION_LIMITS[phase as InstructionPhase] ?? PHASE_INJECTION_LIMITS.learning;
}

export function getSeverityFilter(phase: string): string[] {
  return PHASE_SEVERITY_FILTER[phase as InstructionPhase] ?? PHASE_SEVERITY_FILTER.learning;
}

// ── Convention Query ────────────────────────────────────────────────────────

/**
 * Look up the agent's current instruction phase from AgentPerformance.
 * Falls back to "learning" if no performance record exists.
 */
async function getAgentPhase(agentId: string): Promise<InstructionPhase> {
  const perf = await prisma.agentPerformance.findFirst({
    where: { agent: { agentId } },
    orderBy: { lastEvaluatedAt: "desc" },
    select: { instructionPhase: true },
  });
  return (perf?.instructionPhase as InstructionPhase) ?? "learning";
}

/**
 * Lazy decay check: mark stale norm conventions as internalized.
 * Runs as a side effect during convention queries — no separate cron needed.
 * Only affects conventions for agents in practicing or innate phase.
 */
async function lazyDecayCheck(agentId: string, phase: InstructionPhase): Promise<void> {
  if (phase === "learning") return; // Don't decay while still learning

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - DECAY_DAYS);

  await prisma.agentConvention.updateMany({
    where: {
      agentId: { in: [agentId, "*"] },
      active: true,
      severity: "norm",
      lastSeenAt: { lt: cutoff },
      decayedAt: null,
    },
    data: {
      active: false,
      decayedAt: new Date(),
    },
  });
}

/**
 * Build the conventions block for injection into an agent's system prompt.
 * Returns empty string if no active conventions match.
 *
 * @param agentId - The agent ID (e.g. "AGT-BUILD-SE") to query conventions for.
 *                  Also includes wildcard ("*") conventions that apply to all agents.
 */
export async function getConventionsBlock(agentId: string): Promise<string> {
  const phase = await getAgentPhase(agentId);
  const limit = getInjectionLimit(phase);
  const severities = getSeverityFilter(phase);

  // Decay check — indexed UPDATE, fast enough to await
  try {
    await lazyDecayCheck(agentId, phase);
  } catch (err) {
    console.warn("[agent-conventions] decay check failed:", err);
  }

  const conventions = await prisma.agentConvention.findMany({
    where: {
      active: true,
      agentId: { in: [agentId, "*"] },
      severity: { in: severities },
    },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
    select: { convention: true },
  });

  if (conventions.length === 0) return "";

  return (
    "\n--- Learned Conventions (from prior failures — follow these) ---\n" +
    conventions.map((c) => `- ${c.convention}`).join("\n")
  );
}

// ── Shared Threshold Lookup ─────────────────────────────────────────────────

/**
 * Get the promotion threshold for an agent based on its instruction phase.
 * Exported for use by convention-classifier.ts and convention-evaluator-bridge.ts.
 */
export async function getThresholdForAgent(agentId: string): Promise<number> {
  if (agentId === "*") return getPromotionThreshold("learning");
  const phase = await getAgentPhase(agentId);
  return getPromotionThreshold(phase);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm exec vitest run lib/tak/agent-conventions.test.ts
```

- [ ] **Step 5: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```
feat(tak): add maturity-gated convention query utility
```

---

## Task 3: Build Error Classifier

**Files:**
- Create: `apps/web/lib/integrate/convention-classifier.ts`
- Create: `apps/web/lib/integrate/convention-classifier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/integrate/convention-classifier.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  classifyBuildErrors,
  CONVENTION_TEMPLATES,
  type ClassifiedError,
} from "./convention-classifier";

describe("convention-classifier", () => {
  describe("classifyBuildErrors", () => {
    it("detects type-only-import errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "error TS2693: 'Prisma' only refers to a type, but is being used as a value here.",
        testOutput: "",
        typeCheckPassed: false,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "type-only-import" }),
      );
    });

    it("detects cannot-be-used-as-value errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "error TS2693: 'SomeType' cannot be used as a value because it was exported using 'export type'.",
        testOutput: "",
        typeCheckPassed: false,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "type-only-import" }),
      );
    });

    it("detects enum-mismatch errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "",
        testOutput: 'Invalid value for enum: received "in_progress", expected one of: open, in-progress, done',
        typeCheckPassed: true,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "enum-mismatch" }),
      );
    });

    it("detects import-not-found errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "error TS2307: Cannot find module '@/lib/nonexistent' or its corresponding type declarations.",
        testOutput: "",
        typeCheckPassed: false,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "import-not-found" }),
      );
    });

    it("detects missing-use-client errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "",
        testOutput: "Error: useState is not a function",
        typeCheckPassed: true,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "missing-use-client" }),
      );
    });

    it("detects missing-relation-inverse from Prisma validation", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: 'error: Error validating field `items` in model `Order`: The relation field `items` on model `Order` is missing an opposite relation field on the model `OrderItem`.',
        testOutput: "",
        typeCheckPassed: false,
      });
      expect(results).toContainEqual(
        expect.objectContaining({ category: "missing-relation-inverse" }),
      );
    });

    it("detects decimal-field errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "error TS2693: 'Prisma' only refers to a type, but is being used as a value here.\nnew Prisma.Decimal",
        testOutput: "",
        typeCheckPassed: false,
      });
      // Should detect both type-only-import and decimal-field
      const categories = results.map((r) => r.category);
      expect(categories).toContain("type-only-import");
    });

    it("returns empty array for clean output", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "",
        testOutput: "Tests: 5 passed",
        typeCheckPassed: true,
      });
      expect(results).toEqual([]);
    });

    it("deduplicates categories", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "Cannot find module '@/lib/a'\nCannot find module '@/lib/b'",
        testOutput: "",
        typeCheckPassed: false,
      });
      const importErrors = results.filter((r) => r.category === "import-not-found");
      expect(importErrors).toHaveLength(1);
    });

    it("assigns correct specialist for type errors", () => {
      const results = classifyBuildErrors({
        typeCheckOutput: "error TS2693: 'Prisma' only refers to a type",
        testOutput: "",
        typeCheckPassed: false,
      });
      expect(results[0]!.agentId).toBe("AGT-BUILD-SE");
    });
  });

  describe("CONVENTION_TEMPLATES", () => {
    it("has a template for every classifier category", () => {
      const categories = [
        "type-only-import",
        "enum-mismatch",
        "import-not-found",
        "missing-use-client",
        "missing-relation-inverse",
        "decimal-field",
      ];
      for (const cat of categories) {
        expect(CONVENTION_TEMPLATES[cat]).toBeDefined();
        expect(CONVENTION_TEMPLATES[cat]!.length).toBeGreaterThan(10);
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/convention-classifier.test.ts
```

- [ ] **Step 3: Write the implementation**

Create `apps/web/lib/integrate/convention-classifier.ts`:

```typescript
/**
 * Build error classifier — regex-based pattern detection on typecheck/test output.
 * Returns classified errors that feed into AgentConvention upsert logic.
 * No LLM calls — deterministic, fast, reviewable.
 */
import { prisma } from "@dpf/db";
import { getThresholdForAgent } from "@/lib/tak/agent-conventions";

// ── Error Pattern Registry ──────────────────────────────────────────────────

export type ClassifiedError = {
  category: string;
  agentId: string;       // Which specialist this applies to, or "*"
  severity: "norm";      // Build conventions are always foundational norms
  snippet: string;       // The matched error text (for traceability)
};

type ErrorPattern = {
  category: string;
  agentId: string;
  patterns: RegExp[];
  source: "typecheck" | "test" | "both";
};

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    category: "type-only-import",
    agentId: "AGT-BUILD-SE",
    source: "both",
    patterns: [
      /only refers to a type.*being used as a value/i,
      /cannot be used as a value.*export(?:ed)?\s+(?:using\s+)?['"]?export type/i,
      /cannot be used as a value/i,
    ],
  },
  {
    category: "enum-mismatch",
    agentId: "*",
    source: "both",
    patterns: [
      /invalid.*enum/i,
      /invalid value.*enum/i,
      /expected one of:.*(?:open|in-progress|done|deferred)/i,
      /in_progress/i, // Common mistake: underscore instead of hyphen
    ],
  },
  {
    category: "import-not-found",
    agentId: "AGT-BUILD-SE",
    source: "typecheck",
    patterns: [
      /cannot find module/i,
      /module not found/i,
      /TS2307/,
    ],
  },
  {
    category: "missing-use-client",
    agentId: "AGT-BUILD-FE",
    source: "both",
    patterns: [
      /useState.*not a function/i,
      /useEffect.*not a function/i,
      /use(?:State|Effect|Ref|Memo|Callback|Context).*server component/i,
      /react hook.*server component/i,
    ],
  },
  {
    category: "missing-relation-inverse",
    agentId: "AGT-BUILD-DA",
    source: "typecheck",
    patterns: [
      /missing an opposite relation/i,
      /relation field.*missing.*opposite/i,
      /error validating.*relation/i,
    ],
  },
  {
    category: "decimal-field",
    agentId: "AGT-BUILD-SE",
    source: "both",
    patterns: [
      /new\s+Prisma\.Decimal/i,
      /Prisma\.Decimal.*not a constructor/i,
    ],
  },
];

// ── Convention Templates ────────────────────────────────────────────────────
// Deterministic text — no LLM generation. Reviewable, predictable.

export const CONVENTION_TEMPLATES: Record<string, string> = {
  "type-only-import":
    "Do NOT import type-only exports as runtime values (e.g., `new X()` where X is `export type`). Before using any import as a value, read the source module's exports to confirm it is a value export. Use plain strings/numbers for Decimal fields — no `Prisma.Decimal`.",
  "enum-mismatch":
    "Use EXACT enum values from the Prisma schema. Hyphens not underscores (`in-progress` not `in_progress`). Always read the schema with describe_model or read_sandbox_file before writing enum references.",
  "import-not-found":
    "Verify import paths exist before using them. Use search_sandbox to find the correct module path. Do not guess at `@/lib/` paths — search first.",
  "missing-use-client":
    'Components using React hooks (useState, useEffect, useRef, useMemo, useCallback, useContext) MUST have `"use client"` as the first line of the file. Server components cannot use hooks.',
  "missing-relation-inverse":
    "Every Prisma relation MUST have an inverse relation on the other model. Always define both sides. Run validate_schema before running any migration.",
  "decimal-field":
    "Prisma Decimal fields accept plain strings and numbers. Never use `new Prisma.Decimal()` — the Prisma namespace is a type-only re-export in this project. Validate with Zod, return a string.",
};

// ── Classifier ──────────────────────────────────────────────────────────────

type VerificationOutput = {
  typeCheckOutput: string;
  testOutput: string;
  typeCheckPassed: boolean;
};

/**
 * Classify build errors into convention categories.
 * Returns one entry per category (deduplicated).
 */
export function classifyBuildErrors(verification: VerificationOutput): ClassifiedError[] {
  const seen = new Set<string>();
  const results: ClassifiedError[] = [];

  for (const errorDef of ERROR_PATTERNS) {
    if (seen.has(errorDef.category)) continue;

    const textsToSearch: string[] = [];
    if (errorDef.source === "typecheck" || errorDef.source === "both") {
      textsToSearch.push(verification.typeCheckOutput);
    }
    if (errorDef.source === "test" || errorDef.source === "both") {
      textsToSearch.push(verification.testOutput);
    }

    for (const text of textsToSearch) {
      if (!text) continue;
      for (const pattern of errorDef.patterns) {
        const match = pattern.exec(text);
        if (match) {
          seen.add(errorDef.category);
          results.push({
            category: errorDef.category,
            agentId: errorDef.agentId,
            severity: "norm",
            snippet: match[0].slice(0, 200),
          });
          break;
        }
      }
      if (seen.has(errorDef.category)) break;
    }
  }

  return results;
}

// ── Upsert Logic ────────────────────────────────────────────────────────────

/**
 * Classify build errors and upsert AgentConvention records.
 * Called fire-and-forget after build completion.
 *
 * @param buildId - The FeatureBuild.buildId that triggered this
 * @param verification - The verificationOut JSON from the build
 */
export async function classifyAndUpsertBuildConventions(
  buildId: string,
  verification: VerificationOutput,
): Promise<void> {
  const classified = classifyBuildErrors(verification);
  if (classified.length === 0) return;

  for (const error of classified) {
    const existing = await prisma.agentConvention.findUnique({
      where: { agentId_category: { agentId: error.agentId, category: error.category } },
    });

    if (existing) {
      // Increment occurrences, update lastSeenAt
      const updated = await prisma.agentConvention.update({
        where: { id: existing.id },
        data: {
          occurrences: { increment: 1 },
          lastSeenAt: new Date(),
          // Reactivate if it was decayed and the error recurred
          ...(existing.decayedAt ? { decayedAt: null } : {}),
        },
      });

      // Check promotion threshold if still draft
      if (!updated.active) {
        const threshold = await getThresholdForAgent(error.agentId);
        if (updated.occurrences >= threshold) {
          await prisma.agentConvention.update({
            where: { id: existing.id },
            data: { active: true },
          });
        }
      }
    } else {
      // Create new draft convention
      const template = CONVENTION_TEMPLATES[error.category];
      if (!template) continue; // No template = skip (safety)

      await prisma.agentConvention.create({
        data: {
          agentId: error.agentId,
          category: error.category,
          convention: template,
          source: "auto",
          active: false,
          severity: error.severity,
          occurrences: 1,
          originBuildId: buildId,
        },
      });
    }
  }
}

```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && pnpm exec vitest run lib/integrate/convention-classifier.test.ts
```

- [ ] **Step 5: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```
feat(integrate): add regex-based build error classifier for conventions
```

---

## Task 4: Evaluator-Triggered Classifier

**Files:**
- Create: `apps/web/lib/tak/convention-evaluator-bridge.ts`

- [ ] **Step 1: Write the implementation**

Create `apps/web/lib/tak/convention-evaluator-bridge.ts`:

```typescript
/**
 * Evaluator-triggered convention classifier.
 * When orchestrator-evaluator scores an agent response < 3,
 * this module classifies the failure category via a lightweight
 * LLM call and upserts an AgentConvention record.
 *
 * Uses utility-tier model — not frontier. ~200 tokens per call.
 */
import { prisma } from "@dpf/db";
import { getThresholdForAgent } from "./agent-conventions";

// ── Category Templates ──────────────────────────────────────────────────────
// Deterministic convention text per evaluator-detected category.
// severity: "tuning" — these are behavioral refinements, not foundational norms.

const EVALUATOR_CONVENTION_TEMPLATES: Record<string, string> = {
  "tool-misuse":
    "Before calling a tool, verify it is the right tool for the task. Check available tools and their parameter descriptions. Do not guess at tool names or parameters.",
  "instruction-violation":
    "Re-read system prompt instructions before responding. Follow them exactly, especially constraints, format requirements, and workflow steps.",
  "tone-mismatch":
    "Match your tone to the user's context. Be concise for technical users. Be explanatory for business users. Do not over-narrate or add unnecessary preamble.",
  "hallucination":
    "Only state facts you can verify from available data, tool results, or documents provided. If uncertain, say so explicitly rather than guessing.",
  "incomplete-action":
    "Complete the full requested action before responding. Do not stop partway and describe remaining steps — execute them.",
};

const CLASSIFICATION_PROMPT = `Given this agent response that scored {score}/5, classify the issue into ONE category:
- tool-misuse: called the wrong tool or with wrong parameters
- instruction-violation: ignored an explicit instruction in the system prompt
- tone-mismatch: wrong register for the context (too formal, too casual, too verbose)
- hallucination: stated something not grounded in available data
- incomplete-action: started but didn't finish the requested task
- other: none of the above

User message: {userMessage}
Agent response: {aiResponse}

Output ONLY the category name, nothing else.`;

/**
 * Classify a low-scoring agent response and upsert a convention.
 * Called fire-and-forget from orchestrator-evaluator when score < 3.
 */
export async function classifyAndUpsertEvaluatorConvention(params: {
  agentId: string;
  score: number;
  userMessage: string;
  aiResponse: string;
  threadId: string;
}): Promise<void> {
  const { agentId, score, userMessage, aiResponse, threadId } = params;

  // Classify via lightweight LLM call
  const { routeAndCall } = await import("@/lib/inference/routed-inference");

  const prompt = CLASSIFICATION_PROMPT
    .replace("{score}", String(score))
    .replace("{userMessage}", userMessage.slice(0, 300))
    .replace("{aiResponse}", aiResponse.slice(0, 500));

  let category: string;
  try {
    const result = await routeAndCall(
      [{ role: "user", content: prompt }],
      "Classify the agent failure category. Output only the category name.",
      "internal",
      { taskType: "data_extraction", budgetClass: "cost_optimized" },
    );
    category = result.content.trim().toLowerCase().replace(/[^a-z-]/g, "");
  } catch {
    return; // Classification failed — don't block anything
  }

  // Skip "other" — not actionable
  if (category === "other" || !EVALUATOR_CONVENTION_TEMPLATES[category]) return;

  const template = EVALUATOR_CONVENTION_TEMPLATES[category]!;

  // Upsert convention
  const existing = await prisma.agentConvention.findUnique({
    where: { agentId_category: { agentId, category } },
  });

  if (existing) {
    const updated = await prisma.agentConvention.update({
      where: { id: existing.id },
      data: {
        occurrences: { increment: 1 },
        lastSeenAt: new Date(),
        ...(existing.decayedAt ? { decayedAt: null } : {}),
      },
    });

    if (!updated.active) {
      const threshold = await getThresholdForAgent(agentId);
      if (updated.occurrences >= threshold) {
        await prisma.agentConvention.update({
          where: { id: existing.id },
          data: { active: true },
        });
      }
    }
  } else {
    await prisma.agentConvention.create({
      data: {
        agentId,
        category,
        convention: template,
        source: "evaluator",
        active: false,
        severity: "tuning",
        occurrences: 1,
        originThreadId: threadId,
      },
    });
  }
}

```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(tak): add evaluator-triggered convention classifier for low-scoring responses
```

---

## Task 5: Inject Conventions into Build Specialist Prompts

**Files:**
- Modify: `apps/web/lib/integrate/specialist-prompts.ts` (lines 286-307)

**NOTE:** `buildSpecialistPrompt` is already async (returns `Promise<string>`) and is already `await`ed in `build-orchestrator.ts` at line 367. No changes needed in build-orchestrator for this task.

- [ ] **Step 1: Inject conventions into the existing async function**

In `apps/web/lib/integrate/specialist-prompts.ts`, the current function (lines 286-307) looks like:

```typescript
export async function buildSpecialistPrompt(params: {
  role: SpecialistRole;
  taskDescription: string;
  buildContext: string;
  priorResults?: string;
}): Promise<string> {
  const hardcoded = SPECIALIST_PROMPTS[params.role];
  const specialistPrompt = await loadPrompt("specialist", params.role, hardcoded);
  const parts = [specialistPrompt];

  if (params.buildContext) {
    parts.push(params.buildContext);
  }

  parts.push(`\n--- Your Assigned Task ---\n${params.taskDescription}`);

  if (params.priorResults) {
    parts.push(`\n--- Results from Prior Specialists ---\n${params.priorResults}`);
  }

  return parts.join("\n\n");
}
```

Add the conventions injection after `const parts = [specialistPrompt];`:

```typescript
  // Inject learned conventions (maturity-gated)
  const { getConventionsBlock } = await import("@/lib/tak/agent-conventions");
  const agentId = SPECIALIST_AGENT_IDS[params.role];
  const conventionsBlock = await getConventionsBlock(agentId);
  if (conventionsBlock) {
    parts.push(conventionsBlock);
  }
```

The full function after editing:

```typescript
export async function buildSpecialistPrompt(params: {
  role: SpecialistRole;
  taskDescription: string;
  buildContext: string;
  priorResults?: string;
}): Promise<string> {
  const hardcoded = SPECIALIST_PROMPTS[params.role];
  const specialistPrompt = await loadPrompt("specialist", params.role, hardcoded);
  const parts = [specialistPrompt];

  // Inject learned conventions (maturity-gated)
  const { getConventionsBlock } = await import("@/lib/tak/agent-conventions");
  const agentId = SPECIALIST_AGENT_IDS[params.role];
  const conventionsBlock = await getConventionsBlock(agentId);
  if (conventionsBlock) {
    parts.push(conventionsBlock);
  }

  if (params.buildContext) {
    parts.push(params.buildContext);
  }

  parts.push(`\n--- Your Assigned Task ---\n${params.taskDescription}`);

  if (params.priorResults) {
    parts.push(`\n--- Results from Prior Specialists ---\n${params.priorResults}`);
  }

  return parts.join("\n\n");
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(integrate): inject learned conventions into build specialist prompts
```

---

## Task 6: Inject Conventions into Coworker Agent Prompts

**Files:**
- Modify: `apps/web/lib/tak/prompt-assembler.ts` (re-exported via shim at `apps/web/lib/prompt-assembler.ts`)
- Modify: `apps/web/lib/actions/agent-coworker.ts`

**NOTE:** `apps/web/lib/prompt-assembler.ts` is a shim (`export * from "./tak/prompt-assembler"`). Edit the real file at `apps/web/lib/tak/prompt-assembler.ts`. The shim re-exports everything so callers that import from `@/lib/prompt-assembler` will pick up changes automatically.

- [ ] **Step 1: Add `agentConventions` to PromptInput**

In `apps/web/lib/tak/prompt-assembler.ts`, the current `PromptInput` type (lines 7-17) is:

```typescript
export type PromptInput = {
  hrRole: string;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  mode: "advise" | "act";
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  routeData: string | null;
  attachmentContext: string | null;
};
```

Add the optional conventions field:

```typescript
export type PromptInput = {
  hrRole: string;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  mode: "advise" | "act";
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  routeData: string | null;
  attachmentContext: string | null;
  agentConventions?: string | null;
};
```

- [ ] **Step 2: Inject the conventions block into prompt assembly**

In the `assembleSystemPrompt` function (line 71), the dynamic blocks are built sequentially. Add the conventions block after the domain context block (line 122) and before the route data block (line 124). Insert after line 122 (`dynamicBlocks.push(domainBlock);`):

```typescript
  // Block 5b: Learned conventions (maturity-gated, from AgentConvention table)
  if (input.agentConventions) {
    dynamicBlocks.push(input.agentConventions);
  }
```

- [ ] **Step 3: Pass conventions from agent-coworker.ts**

In `apps/web/lib/actions/agent-coworker.ts`, the `assembleSystemPrompt` call is at lines 397-407. Add the conventions fetch before it and pass the result. Find the existing call:

```typescript
    populatedPrompt = await assembleSystemPrompt({
      hrRole: user.platformRole ?? "none",
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      mode: (input.coworkerMode as "advise" | "act") ?? "advise",
      sensitivity: routeCtx.sensitivity,
      domainContext: finalDomainContext,
      domainTools: [],
      routeData: selectedPageData,
      attachmentContext: selectedAttachments,
    });
```

Add the conventions fetch before it and pass through:

```typescript
    // Fetch learned conventions for this coworker agent
    const { getConventionsBlock } = await import("@/lib/tak/agent-conventions");
    const agentConventions = agentId ? await getConventionsBlock(agentId) : null;

    populatedPrompt = await assembleSystemPrompt({
      hrRole: user.platformRole ?? "none",
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      mode: (input.coworkerMode as "advise" | "act") ?? "advise",
      sensitivity: routeCtx.sensitivity,
      domainContext: finalDomainContext,
      domainTools: [],
      routeData: selectedPageData,
      attachmentContext: selectedAttachments,
      agentConventions: agentConventions || null,
    });
```

The `agentId` variable is already available in scope (it's the coworker's agent ID resolved from the route context).

- [ ] **Step 4: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```
feat(tak): inject learned conventions into coworker agent prompts
```

---

## Task 7: Post-Build Convention Trigger

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts` (end of `runBuildOrchestrator`)

- [ ] **Step 1: Add the post-build classification call**

In `apps/web/lib/integrate/build-orchestrator.ts`, insert this block between the task results save (ends at line 702) and the auto-advance block (starts at line 704). This is after both `verificationOut` and `taskResults` have been persisted:

```typescript
  // ─── Convention Learning: classify build errors and upsert conventions ────
  // Fire-and-forget — never blocks build completion.
  // Only runs when there are failures worth learning from.
  const hasFailures = allResults.some(
    (r) => r.outcome === "BLOCKED" || r.outcome === "DONE_WITH_CONCERNS",
  );
  if (hasFailures && qaResult) {
    import("@/lib/integrate/convention-classifier")
      .then(({ classifyAndUpsertBuildConventions }) => {
        const qaContent = qaResult.result.content;
        const verification = {
          typeCheckOutput: qaContent,
          testOutput: qaContent,
          typeCheckPassed: !qaContent.toLowerCase().includes("typecheck: fail"),
        };
        // Also try to read structured verificationOut if it was saved
        return prisma.featureBuild
          .findUnique({ where: { buildId }, select: { verificationOut: true } })
          .then((build) => {
            const v = build?.verificationOut as Record<string, unknown> | null;
            if (v) {
              verification.typeCheckOutput =
                (v.typeCheckOutput as string) ?? (v.fullOutput as string) ?? qaContent;
              verification.testOutput =
                (v.testOutput as string) ?? (v.fullOutput as string) ?? qaContent;
              verification.typeCheckPassed = (v.typecheckPassed as boolean) ?? false;
            }
            return classifyAndUpsertBuildConventions(buildId, verification);
          });
      })
      .catch((err) =>
        console.warn("[orchestrator] convention classification failed:", err),
      );
  }
```

Insertion point: after the `} catch { console.error("[orchestrator] Failed to save task results:"` block at line 702, before the `// Auto-advance build → review` comment at line 704.

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(integrate): trigger convention learning after build failures
```

---

## Task 8: Post-Evaluation Convention Trigger

**Files:**
- Modify: `apps/web/lib/tak/orchestrator-evaluator.ts`

- [ ] **Step 1: Add the evaluator bridge call on low scores**

In `apps/web/lib/tak/orchestrator-evaluator.ts`, find the `if (input.agentId)` block at line 154 that calls `updateAgentPerformance`. Insert the convention trigger after the closing `}` of that block (after line 158):

```typescript
  // Convention learning: classify low-scoring responses
  if (input.agentId && score < 3) {
    import("./convention-evaluator-bridge")
      .then(({ classifyAndUpsertEvaluatorConvention }) =>
        classifyAndUpsertEvaluatorConvention({
          agentId: input.agentId!,
          score,
          userMessage: input.userMessage,
          aiResponse: input.aiResponse,
          threadId: input.threadId,
        }),
      )
      .catch((err) =>
        console.warn("[orchestrator-evaluator] convention classification failed:", err),
      );
  }
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(tak): trigger convention learning from low evaluation scores
```

---

## Task 9: Seed Initial Conventions

**Files:**
- Create: `packages/db/data/agent_conventions.json`
- Modify: `packages/db/src/seed.ts`

- [ ] **Step 1: Create the seed data file**

Create `packages/db/data/agent_conventions.json`:

```json
{
  "conventions": [
    {
      "agentId": "*",
      "category": "type-only-import",
      "convention": "Do NOT import type-only exports as runtime values (e.g., `new X()` where X is `export type`). Before using any import as a value, read the source module's exports to confirm it is a value export. Use plain strings/numbers for Decimal fields — no `Prisma.Decimal`.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 10
    },
    {
      "agentId": "*",
      "category": "enum-mismatch",
      "convention": "Use EXACT enum values from the Prisma schema. Hyphens not underscores (`in-progress` not `in_progress`). Always read the schema with describe_model or read_sandbox_file before writing enum references.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 8
    },
    {
      "agentId": "AGT-BUILD-SE",
      "category": "import-not-found",
      "convention": "Verify import paths exist before using them. Use search_sandbox to find the correct module path. Do not guess at `@/lib/` paths — search first.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 5
    },
    {
      "agentId": "AGT-BUILD-FE",
      "category": "missing-use-client",
      "convention": "Components using React hooks (useState, useEffect, useRef, useMemo, useCallback, useContext) MUST have `\"use client\"` as the first line of the file. Server components cannot use hooks.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 4
    },
    {
      "agentId": "AGT-BUILD-DA",
      "category": "missing-relation-inverse",
      "convention": "Every Prisma relation MUST have an inverse relation on the other model. Always define both sides. Run validate_schema before running any migration.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 6
    },
    {
      "agentId": "AGT-BUILD-SE",
      "category": "decimal-field",
      "convention": "Prisma Decimal fields accept plain strings and numbers. Never use `new Prisma.Decimal()` — the Prisma namespace is a type-only re-export in this project. Validate with Zod, return a string.",
      "source": "manual",
      "active": true,
      "severity": "norm",
      "occurrences": 3
    }
  ]
}
```

- [ ] **Step 2: Add the seed function**

In `packages/db/src/seed.ts`, the file already has a `readJson<T>()` helper at line 22. Add the seed function anywhere before `main()` (which starts at line 1432). Uses `readJson` + proper `upsert` since `@@unique([agentId, category])` exists:

```typescript
type ConventionSeed = { agentId: string; category: string; convention: string; source: string; active: boolean; severity: string; occurrences: number };

async function seedAgentConventions(): Promise<void> {
  const { conventions } = readJson<{ conventions: ConventionSeed[] }>("agent_conventions.json");
  for (const c of conventions) {
    await prisma.agentConvention.upsert({
      where: { agentId_category: { agentId: c.agentId, category: c.category } },
      update: {
        convention: c.convention,
        active: c.active,
        severity: c.severity,
      },
      create: {
        agentId: c.agentId,
        category: c.category,
        convention: c.convention,
        source: c.source,
        active: c.active,
        severity: c.severity,
        occurrences: c.occurrences,
      },
    });
  }
  console.log(`Seeded ${conventions.length} agent conventions`);
}
```

Add the call in the `main()` function (line 1432) after the existing seed calls (e.g., after `await seedSkills(prisma);` at line 1473):

```typescript
  await seedAgentConventions();
```

- [ ] **Step 3: Verify types compile**

```bash
cd packages/db && pnpm exec tsc --noEmit
```

- [ ] **Step 4: Commit**

```
feat(db): seed initial agent conventions from known failure patterns
```

---

## Task 10: Admin Server Actions

**Files:**
- Create: `apps/web/lib/actions/conventions-admin.ts`

- [ ] **Step 1: Write the server actions**

Create `apps/web/lib/actions/conventions-admin.ts`:

```typescript
"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

export type ConventionActionResult = { ok: boolean; message: string };

// ── Auth helper ─────────────────────────────────────────────────────────────

async function requireAdmin(): Promise<string> {
  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  const user = session.user as { id: string; type?: string };
  if (user.type !== "admin") throw new Error("Unauthorized");
  return user.id;
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function getConventions() {
  await requireAdmin();
  return prisma.agentConvention.findMany({
    orderBy: [{ active: "desc" }, { occurrences: "desc" }, { lastSeenAt: "desc" }],
  });
}

export async function createConvention(data: {
  agentId: string;
  category: string;
  convention: string;
  severity: "norm" | "tuning";
}): Promise<ConventionActionResult> {
  await requireAdmin();
  await prisma.agentConvention.create({
    data: {
      agentId: data.agentId,
      category: data.category,
      convention: data.convention,
      source: "manual",
      active: true, // Manual conventions are active immediately
      severity: data.severity,
      occurrences: 0,
    },
  });
  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: "Convention created" };
}

export async function updateConvention(
  id: string,
  data: { convention?: string; severity?: string; agentId?: string },
): Promise<ConventionActionResult> {
  await requireAdmin();
  const updateData: Record<string, unknown> = {};
  if (data.convention !== undefined) updateData.convention = data.convention;
  if (data.severity !== undefined) updateData.severity = data.severity;
  if (data.agentId !== undefined) updateData.agentId = data.agentId;

  if (Object.keys(updateData).length === 0) {
    return { ok: false, message: "No fields to update" };
  }

  await prisma.agentConvention.update({ where: { id }, data: updateData });
  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: "Convention updated" };
}

export async function toggleConventionActive(id: string): Promise<ConventionActionResult> {
  await requireAdmin();
  const convention = await prisma.agentConvention.findUnique({ where: { id } });
  if (!convention) return { ok: false, message: "Convention not found" };

  await prisma.agentConvention.update({
    where: { id },
    data: {
      active: !convention.active,
      // Clear decay if reactivating
      ...(convention.decayedAt && !convention.active ? { decayedAt: null } : {}),
    },
  });
  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: convention.active ? "Convention deactivated" : "Convention activated" };
}

export async function deleteConvention(id: string): Promise<ConventionActionResult> {
  await requireAdmin();
  await prisma.agentConvention.delete({ where: { id } });
  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: "Convention deleted" };
}

// ── Graduation ──────────────────────────────────────────────────────────────

const GRADUATION_CRITERIA = {
  minAgeDays: 60,
  minAgents: 3,       // Applies to 3+ agents (or "*")
  minOccurrences: 15,
  severity: "norm",   // Only norms graduate — tuning stays as guidance
};

export async function getGraduationCandidates() {
  await requireAdmin();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - GRADUATION_CRITERIA.minAgeDays);

  // Wildcard conventions automatically meet the "3+ agents" criterion
  const candidates = await prisma.agentConvention.findMany({
    where: {
      active: true,
      severity: GRADUATION_CRITERIA.severity,
      graduation: "pending",
      firstSeenAt: { lt: cutoff },
      occurrences: { gte: GRADUATION_CRITERIA.minOccurrences },
    },
    orderBy: { occurrences: "desc" },
  });

  // For agent-specific conventions, check if 3+ agents have the same category
  const result = [];
  for (const c of candidates) {
    if (c.agentId === "*") {
      result.push(c);
      continue;
    }
    const sameCategory = await prisma.agentConvention.count({
      where: { category: c.category, active: true },
    });
    if (sameCategory >= GRADUATION_CRITERIA.minAgents) {
      result.push(c);
    }
  }
  return result;
}

export async function graduateConvention(id: string): Promise<ConventionActionResult> {
  await requireAdmin();
  const convention = await prisma.agentConvention.findUnique({ where: { id } });
  if (!convention) return { ok: false, message: "Convention not found" };

  // Create a backlog item for the tool-level implementation
  const itemId = `GRAD-${Date.now()}`;
  const backlogItem = await prisma.backlogItem.create({
    data: {
      itemId,
      title: `Graduate convention: ${convention.category}`,
      body: [
        `## Convention Graduation`,
        ``,
        `**Category:** ${convention.category}`,
        `**Current convention text:** ${convention.convention}`,
        `**Agent scope:** ${convention.agentId}`,
        `**Occurrences:** ${convention.occurrences}`,
        `**Active since:** ${convention.firstSeenAt.toISOString().split("T")[0]}`,
        ``,
        `### What to build`,
        `Codify this convention into tool-level enforcement so agents no longer need`,
        `it as a prompt instruction. The tool should automatically prevent or catch`,
        `this error pattern.`,
        ``,
        `### Acceptance criteria`,
        `- The error pattern described above is prevented at the tool level`,
        `- The convention can be deactivated without regression`,
        `- Tests verify the tool enforcement works`,
      ].join("\n"),
      status: "open",
      type: "product",
      source: "graduation",
    },
  });

  // Mark convention as graduation candidate with link to backlog item
  await prisma.agentConvention.update({
    where: { id },
    data: {
      graduation: "candidate",
      graduationItemId: backlogItem.id,
    },
  });

  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: `Backlog item ${itemId} created for graduation` };
}

export async function exemptFromGraduation(id: string): Promise<ConventionActionResult> {
  await requireAdmin();
  await prisma.agentConvention.update({
    where: { id },
    data: { graduation: "exempt" },
  });
  revalidatePath("/admin/workforce/conventions");
  return { ok: true, message: "Convention marked exempt from graduation" };
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(actions): add convention admin server actions with graduation support
```

---

## Task 11: Admin UI — Server Page

**Files:**
- Create: `apps/web/app/(shell)/admin/workforce/conventions/page.tsx`

- [ ] **Step 1: Create the server page**

Create `apps/web/app/(shell)/admin/workforce/conventions/page.tsx`:

```tsx
import { prisma } from "@dpf/db";
import { ConventionsPanel } from "@/components/admin/ConventionsPanel";

export const metadata = { title: "Agent Conventions — Admin" };

export default async function ConventionsPage() {
  const [conventions, agents, graduationCandidateCount] = await Promise.all([
    prisma.agentConvention.findMany({
      orderBy: [{ active: "desc" }, { occurrences: "desc" }, { lastSeenAt: "desc" }],
    }),
    prisma.agent.findMany({
      where: { archived: false },
      select: { agentId: true, name: true },
      orderBy: { agentId: "asc" },
    }),
    prisma.agentConvention.count({
      where: {
        active: true,
        severity: "norm",
        graduation: "pending",
        occurrences: { gte: 15 },
        firstSeenAt: { lt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);

  return (
    <main className="p-6 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1
          className="text-2xl font-[var(--dpf-font-heading)] font-semibold"
          style={{ color: "var(--dpf-text)" }}
        >
          Agent Conventions
        </h1>
        <p className="mt-1" style={{ color: "var(--dpf-text-secondary)" }}>
          Learned rules injected into agent prompts. Auto-detected from failures, or manually created.
          Mature conventions graduate to tool-level enforcement.
        </p>
      </header>

      <ConventionsPanel
        conventions={conventions.map((c) => ({
          ...c,
          firstSeenAt: c.firstSeenAt.toISOString(),
          lastSeenAt: c.lastSeenAt.toISOString(),
          decayedAt: c.decayedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        }))}
        agents={agents}
        graduationCandidateCount={graduationCandidateCount}
      />
    </main>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(admin): add conventions server page at /admin/workforce/conventions
```

---

## Task 12: Admin UI — Client Panel

**Files:**
- Create: `apps/web/components/admin/ConventionsPanel.tsx`

- [ ] **Step 1: Create the client component**

Create `apps/web/components/admin/ConventionsPanel.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  toggleConventionActive,
  deleteConvention,
  createConvention,
  updateConvention,
  graduateConvention,
  exemptFromGraduation,
  getGraduationCandidates,
} from "@/lib/actions/conventions-admin";

type Convention = {
  id: string;
  agentId: string;
  category: string;
  convention: string;
  source: string;
  active: boolean;
  severity: string;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  decayedAt: string | null;
  graduation: string;
  graduationItemId: string | null;
  createdAt: string;
  updatedAt: string;
  originBuildId: string | null;
  originThreadId: string | null;
};

type Agent = { agentId: string; name: string };

const SOURCE_COLORS: Record<string, string> = {
  auto: "var(--dpf-info)",
  evaluator: "var(--dpf-warning)",
  manual: "var(--dpf-accent)",
};

const SEVERITY_COLORS: Record<string, string> = {
  norm: "var(--dpf-error)",
  tuning: "var(--dpf-info)",
};

export function ConventionsPanel({
  conventions: initialConventions,
  agents,
  graduationCandidateCount,
}: {
  conventions: Convention[];
  agents: Agent[];
  graduationCandidateCount: number;
}) {
  const [conventions, setConventions] = useState(initialConventions);
  const [filter, setFilter] = useState({ search: "", source: "", active: "", severity: "" });
  const [tab, setTab] = useState<"all" | "graduation">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [isPending, startTransition] = useTransition();

  // Create form state
  const [newConvention, setNewConvention] = useState({
    agentId: "*",
    category: "",
    convention: "",
    severity: "norm" as "norm" | "tuning",
  });

  const filtered = conventions.filter((c) => {
    if (filter.search && !c.convention.toLowerCase().includes(filter.search.toLowerCase()) &&
        !c.category.toLowerCase().includes(filter.search.toLowerCase())) return false;
    if (filter.source && c.source !== filter.source) return false;
    if (filter.active === "active" && !c.active) return false;
    if (filter.active === "draft" && c.active) return false;
    if (filter.active === "decayed" && !c.decayedAt) return false;
    if (filter.severity && c.severity !== filter.severity) return false;
    return true;
  });

  const stats = {
    total: conventions.length,
    active: conventions.filter((c) => c.active).length,
    draft: conventions.filter((c) => !c.active && !c.decayedAt).length,
    decayed: conventions.filter((c) => c.decayedAt).length,
  };

  function handleToggle(id: string) {
    startTransition(async () => {
      const result = await toggleConventionActive(id);
      if (result.ok) {
        setConventions((prev) =>
          prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)),
        );
      }
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this convention? This cannot be undone.")) return;
    startTransition(async () => {
      const result = await deleteConvention(id);
      if (result.ok) {
        setConventions((prev) => prev.filter((c) => c.id !== id));
      }
    });
  }

  function handleSaveEdit(id: string) {
    startTransition(async () => {
      const result = await updateConvention(id, { convention: editText });
      if (result.ok) {
        setConventions((prev) =>
          prev.map((c) => (c.id === id ? { ...c, convention: editText } : c)),
        );
        setEditingId(null);
      }
    });
  }

  function handleCreate() {
    if (!newConvention.category || !newConvention.convention) return;
    startTransition(async () => {
      const result = await createConvention(newConvention);
      if (result.ok) {
        // Refresh — server action calls revalidatePath
        window.location.reload();
      }
    });
  }

  function handleGraduate(id: string) {
    startTransition(async () => {
      const result = await graduateConvention(id);
      if (result.ok) {
        setConventions((prev) =>
          prev.map((c) => (c.id === id ? { ...c, graduation: "candidate" } : c)),
        );
      }
    });
  }

  function handleExempt(id: string) {
    startTransition(async () => {
      const result = await exemptFromGraduation(id);
      if (result.ok) {
        setConventions((prev) =>
          prev.map((c) => (c.id === id ? { ...c, graduation: "exempt" } : c)),
        );
      }
    });
  }

  return (
    <div>
      {/* Stats bar */}
      <div
        className="flex gap-4 mb-4 p-3 rounded-lg"
        style={{ backgroundColor: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
      >
        <span style={{ color: "var(--dpf-text-secondary)" }}>
          Total: <strong style={{ color: "var(--dpf-text)" }}>{stats.total}</strong>
        </span>
        <span style={{ color: "var(--dpf-success)" }}>Active: {stats.active}</span>
        <span style={{ color: "var(--dpf-warning)" }}>Draft: {stats.draft}</span>
        <span style={{ color: "var(--dpf-muted)" }}>Decayed: {stats.decayed}</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "all"}
          onClick={() => setTab("all")}
          className="px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: tab === "all" ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
            color: tab === "all" ? "white" : "var(--dpf-text-secondary)",
          }}
        >
          All Conventions
        </button>
        <button
          role="tab"
          aria-selected={tab === "graduation"}
          onClick={() => setTab("graduation")}
          className="px-4 py-2 rounded-md text-sm font-medium transition-colors cursor-pointer"
          style={{
            backgroundColor: tab === "graduation" ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
            color: tab === "graduation" ? "white" : "var(--dpf-text-secondary)",
          }}
        >
          Graduation Candidates
          {graduationCandidateCount > 0 && (
            <span
              className="ml-2 px-2 py-0.5 rounded-full text-xs"
              style={{ backgroundColor: "var(--dpf-warning)", color: "var(--dpf-bg)" }}
            >
              {graduationCandidateCount}
            </span>
          )}
        </button>
      </div>

      {tab === "all" && (
        <>
          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <input
              type="text"
              placeholder="Search conventions..."
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              className="px-3 py-2 rounded-md text-sm flex-1 min-w-[200px]"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            />
            <select
              value={filter.source}
              onChange={(e) => setFilter((f) => ({ ...f, source: e.target.value }))}
              className="px-3 py-2 rounded-md text-sm cursor-pointer"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              <option value="">All sources</option>
              <option value="auto">Auto-detected</option>
              <option value="evaluator">Evaluator</option>
              <option value="manual">Manual</option>
            </select>
            <select
              value={filter.active}
              onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))}
              className="px-3 py-2 rounded-md text-sm cursor-pointer"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              <option value="">All states</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="decayed">Decayed</option>
            </select>
            <select
              value={filter.severity}
              onChange={(e) => setFilter((f) => ({ ...f, severity: e.target.value }))}
              className="px-3 py-2 rounded-md text-sm cursor-pointer"
              style={{
                backgroundColor: "var(--dpf-surface-2)",
                color: "var(--dpf-text)",
                border: "1px solid var(--dpf-border)",
              }}
            >
              <option value="">All severities</option>
              <option value="norm">Norm</option>
              <option value="tuning">Tuning</option>
            </select>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors"
              style={{ backgroundColor: "var(--dpf-accent)", color: "white" }}
            >
              + Add Convention
            </button>
          </div>

          {/* Create form */}
          {showCreate && (
            <div
              className="mb-4 p-4 rounded-lg animate-slide-up"
              style={{ backgroundColor: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
            >
              <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--dpf-text)" }}>
                New Convention
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <select
                  value={newConvention.agentId}
                  onChange={(e) => setNewConvention((n) => ({ ...n, agentId: e.target.value }))}
                  className="px-3 py-2 rounded-md text-sm"
                  style={{
                    backgroundColor: "var(--dpf-surface-2)",
                    color: "var(--dpf-text)",
                    border: "1px solid var(--dpf-border)",
                  }}
                >
                  <option value="*">All agents (*)</option>
                  {agents.map((a) => (
                    <option key={a.agentId} value={a.agentId}>
                      {a.name} ({a.agentId})
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Category (e.g. enum-mismatch)"
                  value={newConvention.category}
                  onChange={(e) => setNewConvention((n) => ({ ...n, category: e.target.value }))}
                  className="px-3 py-2 rounded-md text-sm"
                  style={{
                    backgroundColor: "var(--dpf-surface-2)",
                    color: "var(--dpf-text)",
                    border: "1px solid var(--dpf-border)",
                  }}
                />
                <select
                  value={newConvention.severity}
                  onChange={(e) =>
                    setNewConvention((n) => ({ ...n, severity: e.target.value as "norm" | "tuning" }))
                  }
                  className="px-3 py-2 rounded-md text-sm"
                  style={{
                    backgroundColor: "var(--dpf-surface-2)",
                    color: "var(--dpf-text)",
                    border: "1px solid var(--dpf-border)",
                  }}
                >
                  <option value="norm">Norm (foundational — can graduate to tool)</option>
                  <option value="tuning">Tuning (behavioral — stays as guidance)</option>
                </select>
              </div>
              <textarea
                placeholder="Convention text — the instruction agents will see in their prompt"
                value={newConvention.convention}
                onChange={(e) => setNewConvention((n) => ({ ...n, convention: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 rounded-md text-sm mb-3"
                style={{
                  backgroundColor: "var(--dpf-surface-2)",
                  color: "var(--dpf-text)",
                  border: "1px solid var(--dpf-border)",
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={!newConvention.category || !newConvention.convention || isPending}
                  className="px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors disabled:opacity-50"
                  style={{ backgroundColor: "var(--dpf-accent)", color: "white" }}
                >
                  {isPending ? "Creating..." : "Create"}
                </button>
                <button
                  onClick={() => setShowCreate(false)}
                  className="px-4 py-2 rounded-md text-sm cursor-pointer transition-colors"
                  style={{
                    backgroundColor: "var(--dpf-surface-2)",
                    color: "var(--dpf-text-secondary)",
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Conventions list */}
          <div className="space-y-2">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm" style={{ color: "var(--dpf-muted)" }}>
                No conventions match your filters.
              </p>
            )}
            {filtered.map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-lg transition-colors animate-fade-in"
                style={{
                  backgroundColor: "var(--dpf-surface-1)",
                  border: `1px solid ${c.active ? "var(--dpf-border)" : "transparent"}`,
                  opacity: c.active ? 1 : 0.7,
                }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Header row: badges */}
                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: c.active ? "var(--dpf-success)" : "var(--dpf-surface-2)",
                          color: c.active ? "white" : "var(--dpf-muted)",
                        }}
                      >
                        {c.active ? "Active" : c.decayedAt ? "Decayed" : "Draft"}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ backgroundColor: "var(--dpf-surface-2)", color: SOURCE_COLORS[c.source] }}
                      >
                        {c.source}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded text-xs"
                        style={{ backgroundColor: "var(--dpf-surface-2)", color: SEVERITY_COLORS[c.severity] }}
                      >
                        {c.severity}
                      </span>
                      <span className="text-xs" style={{ color: "var(--dpf-muted)" }}>
                        {c.agentId === "*" ? "All agents" : c.agentId}
                      </span>
                      <span className="text-xs" style={{ color: "var(--dpf-muted)" }}>
                        {c.category}
                      </span>
                    </div>

                    {/* Convention text */}
                    {editingId === c.id ? (
                      <div className="flex gap-2">
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          rows={3}
                          className="flex-1 px-3 py-2 rounded-md text-sm"
                          style={{
                            backgroundColor: "var(--dpf-surface-2)",
                            color: "var(--dpf-text)",
                            border: "1px solid var(--dpf-accent)",
                          }}
                        />
                        <div className="flex flex-col gap-1">
                          <button
                            onClick={() => handleSaveEdit(c.id)}
                            className="px-3 py-1 rounded text-xs cursor-pointer transition-colors"
                            style={{ backgroundColor: "var(--dpf-accent)", color: "white" }}
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-3 py-1 rounded text-xs cursor-pointer transition-colors"
                            style={{ backgroundColor: "var(--dpf-surface-2)", color: "var(--dpf-text-secondary)" }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm" style={{ color: "var(--dpf-text)" }}>
                        {c.convention}
                      </p>
                    )}

                    {/* Footer: stats */}
                    <div className="flex gap-4 mt-2 text-xs" style={{ color: "var(--dpf-muted)" }}>
                      <span>Occurrences: {c.occurrences}</span>
                      <span>First seen: {c.firstSeenAt.split("T")[0]}</span>
                      <span>Last seen: {c.lastSeenAt.split("T")[0]}</span>
                      {c.graduation !== "pending" && (
                        <span style={{ color: "var(--dpf-warning)" }}>
                          Graduation: {c.graduation}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setEditText(c.convention);
                      }}
                      className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                      style={{ backgroundColor: "var(--dpf-surface-2)", color: "var(--dpf-text-secondary)" }}
                      aria-label={`Edit convention ${c.category}`}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleToggle(c.id)}
                      disabled={isPending}
                      className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                      style={{
                        backgroundColor: c.active ? "var(--dpf-surface-2)" : "var(--dpf-success)",
                        color: c.active ? "var(--dpf-text-secondary)" : "white",
                      }}
                      aria-label={`${c.active ? "Deactivate" : "Activate"} convention ${c.category}`}
                    >
                      {c.active ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="px-2 py-1 rounded text-xs cursor-pointer transition-colors"
                      style={{ backgroundColor: "var(--dpf-surface-2)", color: "var(--dpf-error)" }}
                      aria-label={`Delete convention ${c.category}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "graduation" && (
        <div>
          <p className="mb-4 text-sm" style={{ color: "var(--dpf-text-secondary)" }}>
            Conventions that have been active 60+ days with 15+ occurrences across 3+ agents.
            Graduating a convention creates a backlog item to codify it as tool-level enforcement.
          </p>
          {filtered
            .filter(
              (c) =>
                c.active &&
                c.severity === "norm" &&
                c.graduation === "pending" &&
                c.occurrences >= 15,
            )
            .map((c) => (
              <div
                key={c.id}
                className="p-4 rounded-lg mb-2"
                style={{ backgroundColor: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)" }}
              >
                <p className="text-sm mb-2" style={{ color: "var(--dpf-text)" }}>
                  <strong>{c.category}</strong> — {c.convention}
                </p>
                <div className="flex gap-4 mb-3 text-xs" style={{ color: "var(--dpf-muted)" }}>
                  <span>Agent: {c.agentId}</span>
                  <span>Occurrences: {c.occurrences}</span>
                  <span>Active since: {c.firstSeenAt.split("T")[0]}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleGraduate(c.id)}
                    disabled={isPending}
                    className="px-4 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--dpf-accent)", color: "white" }}
                  >
                    Graduate to Tool
                  </button>
                  <button
                    onClick={() => handleExempt(c.id)}
                    disabled={isPending}
                    className="px-3 py-2 rounded-md text-sm cursor-pointer transition-colors"
                    style={{ backgroundColor: "var(--dpf-surface-2)", color: "var(--dpf-text-secondary)" }}
                  >
                    Not a candidate
                  </button>
                </div>
              </div>
            ))}
          {filtered.filter(
            (c) => c.active && c.severity === "norm" && c.graduation === "pending" && c.occurrences >= 15,
          ).length === 0 && (
            <p className="py-8 text-center text-sm" style={{ color: "var(--dpf-muted)" }}>
              No conventions are ready for graduation yet. Conventions need 60+ days active with 15+ occurrences.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types compile**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(admin): add ConventionsPanel client component with filters, edit, graduation
```

---

## Task 13: Integration Test — End-to-End Flow

**Files:**
- The test validates: classify → upsert → query → inject

- [ ] **Step 1: Write integration test**

Add to `apps/web/lib/integrate/convention-classifier.test.ts`:

```typescript
describe("classifyAndUpsertBuildConventions (integration)", () => {
  // This test requires a mock of prisma that tracks calls.
  // Verify the full flow: classify errors → find/create conventions → check threshold

  it("creates a draft convention on first occurrence", async () => {
    vi.mocked(prisma.agentConvention.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.agentConvention.create).mockResolvedValue({} as any);
    vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue(null);

    const { classifyAndUpsertBuildConventions } = await import("./convention-classifier");

    await classifyAndUpsertBuildConventions("build-1", {
      typeCheckOutput: "'Prisma' only refers to a type, but is being used as a value here.",
      testOutput: "",
      typeCheckPassed: false,
    });

    expect(prisma.agentConvention.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "type-only-import",
          active: false,
          source: "auto",
          occurrences: 1,
        }),
      }),
    );
  });

  it("increments occurrences on subsequent detections", async () => {
    vi.mocked(prisma.agentConvention.findUnique).mockResolvedValue({
      id: "conv-1",
      active: false,
      occurrences: 1,
      decayedAt: null,
    } as any);
    vi.mocked(prisma.agentConvention.update).mockResolvedValue({
      id: "conv-1",
      active: false,
      occurrences: 2,
    } as any);
    vi.mocked(prisma.agentPerformance.findFirst).mockResolvedValue(null);

    const { classifyAndUpsertBuildConventions } = await import("./convention-classifier");

    await classifyAndUpsertBuildConventions("build-2", {
      typeCheckOutput: "'Prisma' only refers to a type, but is being used as a value here.",
      testOutput: "",
      typeCheckPassed: false,
    });

    expect(prisma.agentConvention.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "conv-1" },
        data: expect.objectContaining({
          occurrences: { increment: 1 },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run all convention tests**

```bash
cd apps/web && pnpm exec vitest run lib/tak/agent-conventions.test.ts lib/integrate/convention-classifier.test.ts
```

- [ ] **Step 3: Commit**

```
test: add integration tests for convention classify-upsert flow
```

---

## Task 14: Final Verification

- [ ] **Step 1: Full typecheck**

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Fix any type errors across all modified files.

- [ ] **Step 2: Run all tests**

```bash
cd apps/web && pnpm exec vitest run
```

Ensure no existing tests were broken by the conventions injection changes.

- [ ] **Step 3: Verify the migration applies cleanly**

If running with Docker:
```bash
docker compose up portal-init
```

Check logs for successful migration and seed output: `Seeded 6 agent conventions`.

- [ ] **Step 4: Final commit (if any fixes were needed)**

```
fix: address type/test issues from agent improvement loops integration
```

---

## Summary

| Task | What | Key files |
|---|---|---|
| 1 | Prisma model + migration | `schema.prisma` |
| 2 | Convention query utility | `agent-conventions.ts` |
| 3 | Build error classifier | `convention-classifier.ts` |
| 4 | Evaluator-triggered classifier | `convention-evaluator-bridge.ts` |
| 5 | Inject into specialist prompts | `specialist-prompts.ts` |
| 6 | Inject into coworker prompts | `prompt-assembler.ts`, `agent-coworker.ts` |
| 7 | Post-build trigger | `build-orchestrator.ts` |
| 8 | Post-evaluation trigger | `orchestrator-evaluator.ts` |
| 9 | Seed initial conventions | `seed.ts`, `agent_conventions.json` |
| 10 | Admin server actions | `conventions-admin.ts` |
| 11 | Admin server page | `conventions/page.tsx` |
| 12 | Admin client panel | `ConventionsPanel.tsx` |
| 13 | Integration tests | `convention-classifier.test.ts` |
| 14 | Final verification | All files |
