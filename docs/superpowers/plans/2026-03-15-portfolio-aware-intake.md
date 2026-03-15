# EP-INTAKE-001: Portfolio-Aware Feature Intake — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portfolio-aware context search, automatic complexity assessment, and smart decomposition to the Build Studio so the agent can find related items, assess scope, and break large ideas into feature sets — all through conversation.

**Architecture:** Four new pure-function modules (portfolio-search, complexity-assessment, decomposition, types) exposed as MCP tools. The agent calls these during Ideate phase. Schema migration adds `description` to `DigitalProduct` and `TaxonomyNode` for searchability. Agent prompts updated to use context search before asking questions.

**Tech Stack:** TypeScript, Prisma 5, Vitest, Next.js 14 App Router. Strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`.

**Spec:** `docs/superpowers/specs/2026-03-15-portfolio-aware-intake-design.md`

**Scope note:** This plan covers context search + complexity + decomposition + MCP tools (Sections 1-3, 5 context tools from the spec). Sandbox codegen + Playwright tools (Section 4, 5 sandbox tools) are deferred to EP-CODEGEN-001.

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/portfolio-search.ts` | `searchPortfolioContext()` — query taxonomy, products, builds, backlog for keyword matches |
| `apps/web/lib/portfolio-search.test.ts` | Tests for search and ranking |
| `apps/web/lib/complexity-assessment.ts` | `assessComplexity()` — pure routing function from 7 dimension scores |
| `apps/web/lib/complexity-assessment.test.ts` | Tests for scoring thresholds and path routing |
| `apps/web/lib/decomposition.ts` | `proposeDecomposition()` — generate epic + feature set structure |
| `apps/web/lib/decomposition.test.ts` | Tests for decomposition output |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `description String? @db.Text` to `DigitalProduct` and `TaxonomyNode` |
| `apps/web/lib/feature-build-types.ts` | Add `ComplexityScore`, `ComplexityPath`, `DecompositionPlan`, `FeatureSetEntry`, `PortfolioSearchResult` types |
| `apps/web/lib/mcp-tools.ts` | Add 4 tool definitions + `executeTool` handlers |
| `apps/web/lib/build-agent-prompts.ts` | Update Ideate prompt to call `search_portfolio_context` first |

---

## Chunk 1: Schema + Types

### Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add `description` to DigitalProduct**

In `packages/db/prisma/schema.prisma`, find the `DigitalProduct` model (around line 132). Add `description` after `name`:

```prisma
model DigitalProduct {
  id              String        @id @default(cuid())
  productId       String        @unique
  name            String
  description     String?       @db.Text
  lifecycleStage  String        @default("plan")
  ...
```

- [ ] **Step 2: Add `description` to TaxonomyNode**

In the same file, find the `TaxonomyNode` model (around line 154). Add `description` after `name`:

```prisma
model TaxonomyNode {
  id          String           @id @default(cuid())
  nodeId      String           @unique
  name        String
  description String?          @db.Text
  portfolioId String?
  ...
```

- [ ] **Step 3: Create and apply migration**

```bash
mkdir -p packages/db/prisma/migrations/20260315180000_add_descriptions
cat > packages/db/prisma/migrations/20260315180000_add_descriptions/migration.sql << 'SQLEOF'
-- AlterTable
ALTER TABLE "DigitalProduct" ADD COLUMN "description" TEXT;

-- AlterTable
ALTER TABLE "TaxonomyNode" ADD COLUMN "description" TEXT;
SQLEOF
cd packages/db && npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(schema): add description to DigitalProduct and TaxonomyNode"
```

---

### Task 2: Add Types to feature-build-types.ts

**Files:**
- Modify: `apps/web/lib/feature-build-types.ts`

- [ ] **Step 1: Add types**

Add at the bottom of `apps/web/lib/feature-build-types.ts`:

```typescript
// ─── Portfolio Search Types ──────────────────────────────────────────────────

export type SearchMatch = {
  id: string;
  name: string;
  slug?: string;
  description: string | null;
  relevanceScore: number;
  context?: string; // e.g., "production", "plan", "in-progress"
};

export type PortfolioSearchResult = {
  taxonomyMatches: SearchMatch[];
  productMatches: SearchMatch[];
  buildMatches: SearchMatch[];
  backlogMatches: SearchMatch[];
};

// ─── Complexity Assessment Types ─────────────────────────────────────────────

export type ComplexityDimension =
  | "taxonomySpan"
  | "dataEntities"
  | "integrations"
  | "novelty"
  | "regulatory"
  | "costEstimate"
  | "techDebt";

export type ComplexityScores = Record<ComplexityDimension, 1 | 2 | 3>;

export type ComplexityPath = "simple" | "moderate" | "complex";

export type ComplexityResult = {
  total: number;
  path: ComplexityPath;
  scores: ComplexityScores;
};

// ─── Decomposition Types ─────────────────────────────────────────────────────

export type BuildOrBuyRecommendation = "build" | "buy" | "integrate";

export type FeatureSetEntry = {
  title: string;
  description: string;
  type: "feature_build" | "digital_product";
  estimatedBuilds: number;
  recommendation: BuildOrBuyRecommendation;
  rationale: string;
  techDebtNote: string | null;
};

export type DecompositionPlan = {
  epicTitle: string;
  epicDescription: string;
  featureSets: FeatureSetEntry[];
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/feature-build-types.ts
git commit -m "feat: add portfolio search, complexity, and decomposition types"
```

---

## Chunk 2: Portfolio Search (TDD)

### Task 3: Portfolio Search Module

**Files:**
- Create: `apps/web/lib/portfolio-search.ts`
- Create: `apps/web/lib/portfolio-search.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/portfolio-search.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { rankMatches, scoreKeywordMatch } from "./portfolio-search";

describe("scoreKeywordMatch", () => {
  it("returns 0 for no match", () => {
    expect(scoreKeywordMatch("finance", "customer portal", null)).toBe(0);
  });

  it("scores name match higher than description match", () => {
    const nameScore = scoreKeywordMatch("finance", "Finance Hub", null);
    const descScore = scoreKeywordMatch("finance", "Portal", "handles finance operations");
    expect(nameScore).toBeGreaterThan(descScore);
  });

  it("scores exact name match highest", () => {
    const exact = scoreKeywordMatch("finance", "Finance", null);
    const partial = scoreKeywordMatch("finance", "Financial Management", null);
    expect(exact).toBeGreaterThan(partial);
  });

  it("is case-insensitive", () => {
    expect(scoreKeywordMatch("FINANCE", "finance hub", null)).toBeGreaterThan(0);
  });

  it("matches multiple keywords independently", () => {
    const single = scoreKeywordMatch("finance", "Finance Hub", null);
    const multi = scoreKeywordMatch("finance management", "Finance Management Hub", null);
    expect(multi).toBeGreaterThan(single);
  });
});

describe("rankMatches", () => {
  it("sorts by relevanceScore descending", () => {
    const matches = [
      { id: "a", name: "Low", description: null, relevanceScore: 1 },
      { id: "b", name: "High", description: null, relevanceScore: 5 },
      { id: "c", name: "Mid", description: null, relevanceScore: 3 },
    ];
    const ranked = rankMatches(matches);
    expect(ranked[0]!.id).toBe("b");
    expect(ranked[1]!.id).toBe("c");
    expect(ranked[2]!.id).toBe("a");
  });

  it("limits results to maxResults", () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), name: `Item ${i}`, description: null, relevanceScore: i,
    }));
    expect(rankMatches(matches, 3)).toHaveLength(3);
  });

  it("filters out zero-score matches", () => {
    const matches = [
      { id: "a", name: "Match", description: null, relevanceScore: 5 },
      { id: "b", name: "None", description: null, relevanceScore: 0 },
    ];
    expect(rankMatches(matches)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/portfolio-search.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement portfolio-search.ts**

Create `apps/web/lib/portfolio-search.ts`:

```typescript
// apps/web/lib/portfolio-search.ts
// Keyword search across portfolio taxonomy, products, builds, and backlog.

import { prisma } from "@dpf/db";
import type { SearchMatch, PortfolioSearchResult } from "./feature-build-types";

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function scoreKeywordMatch(
  query: string,
  name: string,
  description: string | null,
): number {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) return 0;

  const nameLower = name.toLowerCase();
  const descLower = (description ?? "").toLowerCase();
  let score = 0;

  for (const kw of keywords) {
    if (nameLower === kw) {
      score += 10; // exact name match
    } else if (nameLower.includes(kw)) {
      score += 5; // partial name match
    } else if (descLower.includes(kw)) {
      score += 2; // description match
    }
  }

  return score;
}

export function rankMatches<T extends { relevanceScore: number }>(
  matches: T[],
  maxResults = 5,
): T[] {
  return matches
    .filter((m) => m.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, maxResults);
}

// ─── Search ───────────────────────────────────────────────────────────────────

export async function searchPortfolioContext(
  query: string,
  portfolioId?: string | null,
): Promise<PortfolioSearchResult> {
  const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (keywords.length === 0) {
    return { taxonomyMatches: [], productMatches: [], buildMatches: [], backlogMatches: [] };
  }

  // Build Prisma OR conditions for case-insensitive substring matching
  const textConditions = (fields: string[]) =>
    keywords.flatMap((kw) =>
      fields.map((field) => ({ [field]: { contains: kw, mode: "insensitive" as const } })),
    );

  // Query all four entity types in parallel
  const [taxonomyRows, productRows, buildRows, backlogRows] = await Promise.all([
    prisma.taxonomyNode.findMany({
      where: { OR: textConditions(["name", "description"]) },
      select: { id: true, nodeId: true, name: true, description: true, portfolioId: true },
      take: 20,
    }),
    prisma.digitalProduct.findMany({
      where: { OR: textConditions(["name", "description"]) },
      select: { id: true, productId: true, name: true, description: true, lifecycleStage: true, portfolioId: true },
      take: 20,
    }),
    prisma.featureBuild.findMany({
      where: {
        phase: { notIn: ["complete", "failed"] },
        OR: textConditions(["title", "description"]),
      },
      select: { id: true, buildId: true, title: true, description: true, phase: true, portfolioId: true },
      take: 10,
    }),
    prisma.backlogItem.findMany({
      where: {
        status: { in: ["open", "in-progress"] },
        OR: textConditions(["title", "body"]),
      },
      select: { id: true, itemId: true, title: true, body: true, status: true, epicId: true },
      take: 10,
    }),
  ]);

  // Score and rank results, boosting matches in the current portfolio
  const boostPortfolio = (score: number, rowPortfolioId: string | null) =>
    portfolioId && rowPortfolioId === portfolioId ? score * 1.5 : score;

  const taxonomyMatches: SearchMatch[] = rankMatches(
    taxonomyRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.nodeId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.name, r.description), r.portfolioId),
    })),
  );

  const productMatches: SearchMatch[] = rankMatches(
    productRows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.productId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.name, r.description), r.portfolioId),
      context: r.lifecycleStage,
    })),
  );

  const buildMatches: SearchMatch[] = rankMatches(
    buildRows.map((r) => ({
      id: r.id,
      name: r.title,
      slug: r.buildId,
      description: r.description,
      relevanceScore: boostPortfolio(scoreKeywordMatch(query, r.title, r.description), r.portfolioId),
      context: r.phase,
    })),
  );

  const backlogMatches: SearchMatch[] = rankMatches(
    backlogRows.map((r) => ({
      id: r.id,
      name: r.title,
      slug: r.itemId,
      description: r.body,
      relevanceScore: scoreKeywordMatch(query, r.title, r.body),
      context: r.status,
    })),
  );

  return { taxonomyMatches, productMatches, buildMatches, backlogMatches };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/portfolio-search.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/portfolio-search.ts apps/web/lib/portfolio-search.test.ts
git commit -m "feat: portfolio context search with keyword matching and ranking"
```

---

## Chunk 3: Complexity Assessment (TDD)

### Task 4: Complexity Assessment Module

**Files:**
- Create: `apps/web/lib/complexity-assessment.ts`
- Create: `apps/web/lib/complexity-assessment.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/complexity-assessment.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assessComplexity } from "./complexity-assessment";
import type { ComplexityScores } from "./feature-build-types";

const allOnes: ComplexityScores = {
  taxonomySpan: 1, dataEntities: 1, integrations: 1,
  novelty: 1, regulatory: 1, costEstimate: 1, techDebt: 1,
};

const allThrees: ComplexityScores = {
  taxonomySpan: 3, dataEntities: 3, integrations: 3,
  novelty: 3, regulatory: 3, costEstimate: 3, techDebt: 3,
};

describe("assessComplexity", () => {
  it("routes all-1s (total 7) to simple", () => {
    const result = assessComplexity(allOnes);
    expect(result.total).toBe(7);
    expect(result.path).toBe("simple");
  });

  it("routes total 10 to simple", () => {
    const scores: ComplexityScores = { ...allOnes, dataEntities: 2, integrations: 2, novelty: 2 };
    const result = assessComplexity(scores);
    expect(result.total).toBe(10);
    expect(result.path).toBe("simple");
  });

  it("routes total 11 to moderate", () => {
    const scores: ComplexityScores = { ...allOnes, dataEntities: 2, integrations: 2, novelty: 2, regulatory: 2 };
    const result = assessComplexity(scores);
    expect(result.total).toBe(11);
    expect(result.path).toBe("moderate");
  });

  it("routes total 16 to moderate", () => {
    const scores: ComplexityScores = { ...allOnes, taxonomySpan: 2, dataEntities: 3, integrations: 3, novelty: 2, regulatory: 2, costEstimate: 2 };
    const result = assessComplexity(scores);
    expect(result.total).toBe(16);
    expect(result.path).toBe("moderate");
  });

  it("routes total 17 to complex", () => {
    const scores: ComplexityScores = { ...allOnes, taxonomySpan: 2, dataEntities: 3, integrations: 3, novelty: 2, regulatory: 2, costEstimate: 2, techDebt: 2 };
    const result = assessComplexity(scores);
    expect(result.total).toBe(17);
    expect(result.path).toBe("complex");
  });

  it("routes all-3s (total 21) to complex", () => {
    const result = assessComplexity(allThrees);
    expect(result.total).toBe(21);
    expect(result.path).toBe("complex");
  });

  it("returns scores in the result", () => {
    const result = assessComplexity(allOnes);
    expect(result.scores).toEqual(allOnes);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/complexity-assessment.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement complexity-assessment.ts**

Create `apps/web/lib/complexity-assessment.ts`:

```typescript
// apps/web/lib/complexity-assessment.ts
// Pure function: takes 7 pre-filled dimension scores, returns total + path.
// The LLM decides the per-dimension scores; this function validates and routes.

import type { ComplexityScores, ComplexityPath, ComplexityResult } from "./feature-build-types";

const SIMPLE_MAX = 10;
const MODERATE_MAX = 16;

export function assessComplexity(scores: ComplexityScores): ComplexityResult {
  const total = Object.values(scores).reduce((sum, s) => sum + s, 0);

  let path: ComplexityPath;
  if (total <= SIMPLE_MAX) {
    path = "simple";
  } else if (total <= MODERATE_MAX) {
    path = "moderate";
  } else {
    path = "complex";
  }

  return { total, path, scores };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/complexity-assessment.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/complexity-assessment.ts apps/web/lib/complexity-assessment.test.ts
git commit -m "feat: complexity assessment — pure scoring function with threshold routing"
```

---

## Chunk 4: Decomposition + Tech Debt (TDD)

### Task 5: Decomposition Module

**Files:**
- Create: `apps/web/lib/decomposition.ts`
- Create: `apps/web/lib/decomposition.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/decomposition.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { validateDecompositionPlan, createTechDebtItem } from "./decomposition";
import type { DecompositionPlan } from "./feature-build-types";

describe("validateDecompositionPlan", () => {
  it("accepts a valid plan", () => {
    const plan: DecompositionPlan = {
      epicTitle: "Financial Management",
      epicDescription: "End-to-end financial management for the platform",
      featureSets: [
        {
          title: "Internal Ledger",
          description: "Double-entry bookkeeping",
          type: "digital_product",
          estimatedBuilds: 3,
          recommendation: "build",
          rationale: "Core capability, must be native",
          techDebtNote: null,
        },
      ],
    };
    const result = validateDecompositionPlan(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects plan with empty epicTitle", () => {
    const plan: DecompositionPlan = {
      epicTitle: "",
      epicDescription: "desc",
      featureSets: [{ title: "X", description: "Y", type: "feature_build", estimatedBuilds: 1, recommendation: "build", rationale: "R", techDebtNote: null }],
    };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });

  it("rejects plan with no feature sets", () => {
    const plan: DecompositionPlan = {
      epicTitle: "Epic",
      epicDescription: "desc",
      featureSets: [],
    };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });

  it("rejects feature set with empty title", () => {
    const plan: DecompositionPlan = {
      epicTitle: "Epic",
      epicDescription: "desc",
      featureSets: [{ title: "", description: "Y", type: "feature_build", estimatedBuilds: 1, recommendation: "build", rationale: "R", techDebtNote: null }],
    };
    expect(validateDecompositionPlan(plan).valid).toBe(false);
  });
});

describe("createTechDebtItem", () => {
  it("returns a backlog item shape", () => {
    const item = createTechDebtItem({
      title: "Replace Invoice Ninja with native ledger",
      description: "External dependency introduced for speed. Plan native replacement in 12 months.",
      severity: "medium",
    });
    expect(item.title).toBe("Replace Invoice Ninja with native ledger");
    expect(item.type).toBe("product");
    expect(item.status).toBe("open");
    expect(item.itemId).toMatch(/^BI-REFACTOR-/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/decomposition.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement decomposition.ts**

Create `apps/web/lib/decomposition.ts`:

```typescript
// apps/web/lib/decomposition.ts
// Validates decomposition plans and creates tech debt backlog items.

import * as crypto from "crypto";
import type { DecompositionPlan, ValidationResult } from "./feature-build-types";

export function validateDecompositionPlan(plan: DecompositionPlan): ValidationResult {
  const errors: string[] = [];

  if (!plan.epicTitle.trim()) errors.push("epicTitle is required");
  if (plan.featureSets.length === 0) errors.push("at least one feature set is required");

  for (const fs of plan.featureSets) {
    if (!fs.title.trim()) errors.push("feature set title is required");
  }

  return { valid: errors.length === 0, errors };
}

export function createTechDebtItem(input: {
  title: string;
  description: string;
  severity: string;
}): {
  itemId: string;
  title: string;
  type: string;
  status: string;
  body: string;
  priority: number;
} {
  const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 };

  return {
    itemId: `BI-REFACTOR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    title: input.title,
    type: "product",
    status: "open",
    body: `[Tech Debt] ${input.description}\nSeverity: ${input.severity}`,
    priority: priorityMap[input.severity] ?? 3,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/decomposition.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/decomposition.ts apps/web/lib/decomposition.test.ts
git commit -m "feat: decomposition plan validation and tech debt item creation"
```

---

## Chunk 5: MCP Tools + Agent Prompts

### Task 6: Register MCP Tools

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools.test.ts`

- [ ] **Step 1: Write failing tests**

Append to the existing `describe("mcp tools", ...)` block in `apps/web/lib/mcp-tools.test.ts`:

```typescript
  it("includes intake tools for platform users", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("search_portfolio_context");
    expect(toolNames).toContain("assess_complexity");
    expect(toolNames).toContain("propose_decomposition");
    expect(toolNames).toContain("register_tech_debt");
  });

  it("intake tools execute immediately", () => {
    const tools = getAvailableTools(adminUser, { externalAccessEnabled: false });
    for (const name of ["search_portfolio_context", "assess_complexity", "propose_decomposition", "register_tech_debt"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect(tool!.executionMode).toBe("immediate");
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/mcp-tools.test.ts
```

- [ ] **Step 3: Add tool definitions to PLATFORM_TOOLS**

In `apps/web/lib/mcp-tools.ts`, add these entries before the closing `]` of `PLATFORM_TOOLS`:

```typescript
  // ─── Intake Tools ─────────────────────────────────────────────────────────
  {
    name: "search_portfolio_context",
    description: "Search taxonomy, products, builds, and backlog for items related to a feature description. All IDs auto-resolved.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Plain-language feature description to search for" },
      },
      required: ["query"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
  {
    name: "assess_complexity",
    description: "Score a feature idea on 7 dimensions and get a path recommendation (simple/moderate/complex).",
    inputSchema: {
      type: "object",
      properties: {
        taxonomySpan: { type: "number", enum: [1, 2, 3], description: "1=single node, 2=2-3 nodes same portfolio, 3=cross-portfolio" },
        dataEntities: { type: "number", enum: [1, 2, 3], description: "1=0-2 fields, 2=3-5 models, 3=6+ or relational" },
        integrations: { type: "number", enum: [1, 2, 3], description: "1=standalone, 2=reads 1 product, 3=multi-product or external" },
        novelty: { type: "number", enum: [1, 2, 3], description: "1=extending existing, 2=new in known area, 3=net-new domain" },
        regulatory: { type: "number", enum: [1, 2, 3], description: "1=no compliance, 2=audit trail, 3=HITL approval chains" },
        costEstimate: { type: "number", enum: [1, 2, 3], description: "1=<1 build, 2=2-4 builds, 3=5+ or third-party" },
        techDebt: { type: "number", enum: [1, 2, 3], description: "1=none, 2=known shortcut, 3=major dependency" },
      },
      required: ["taxonomySpan", "dataEntities", "integrations", "novelty", "regulatory", "costEstimate", "techDebt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
  {
    name: "propose_decomposition",
    description: "Generate an epic + feature set breakdown for a complex idea. Returns a plan for conversational review.",
    inputSchema: {
      type: "object",
      properties: {
        epicTitle: { type: "string", description: "Proposed epic title" },
        epicDescription: { type: "string", description: "What the epic covers" },
        featureSets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              type: { type: "string", enum: ["feature_build", "digital_product"] },
              estimatedBuilds: { type: "number" },
              recommendation: { type: "string", enum: ["build", "buy", "integrate"] },
              rationale: { type: "string" },
              techDebtNote: { type: "string" },
            },
            required: ["title", "description", "type", "estimatedBuilds", "recommendation", "rationale"],
          },
        },
      },
      required: ["epicTitle", "epicDescription", "featureSets"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
  {
    name: "register_tech_debt",
    description: "Log a known technical shortcut as a refactoring backlog item for future payoff.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What needs to be refactored" },
        description: { type: "string", description: "Why and what the payoff plan is" },
        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      },
      required: ["title", "description"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
  },
```

- [ ] **Step 4: Add executeTool handlers**

Add these cases to the `executeTool` switch statement in `apps/web/lib/mcp-tools.ts` (before the `default:` case):

```typescript
    case "search_portfolio_context": {
      const { searchPortfolioContext } = await import("@/lib/portfolio-search");
      // Auto-resolve portfolioId from active build
      let portfolioId: string | null = null;
      const latestBuild = await prisma.featureBuild.findFirst({
        where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
        orderBy: { updatedAt: "desc" },
        select: { portfolioId: true },
      });
      portfolioId = latestBuild?.portfolioId ?? null;
      const results = await searchPortfolioContext(String(params["query"] ?? ""), portfolioId);
      const totalMatches = results.taxonomyMatches.length + results.productMatches.length + results.buildMatches.length + results.backlogMatches.length;
      return {
        success: true,
        message: `Found ${totalMatches} related item${totalMatches !== 1 ? "s" : ""} across the portfolio.`,
        data: results as unknown as Record<string, unknown>,
      };
    }

    case "assess_complexity": {
      const { assessComplexity } = await import("@/lib/complexity-assessment");
      const scores = {
        taxonomySpan: Number(params["taxonomySpan"] ?? 1) as 1 | 2 | 3,
        dataEntities: Number(params["dataEntities"] ?? 1) as 1 | 2 | 3,
        integrations: Number(params["integrations"] ?? 1) as 1 | 2 | 3,
        novelty: Number(params["novelty"] ?? 1) as 1 | 2 | 3,
        regulatory: Number(params["regulatory"] ?? 1) as 1 | 2 | 3,
        costEstimate: Number(params["costEstimate"] ?? 1) as 1 | 2 | 3,
        techDebt: Number(params["techDebt"] ?? 1) as 1 | 2 | 3,
      };
      const result = assessComplexity(scores);
      return {
        success: true,
        message: `Complexity: ${result.total}/21 — ${result.path} path.`,
        data: result as unknown as Record<string, unknown>,
      };
    }

    case "propose_decomposition": {
      const { validateDecompositionPlan } = await import("@/lib/decomposition");
      const plan = {
        epicTitle: String(params["epicTitle"] ?? ""),
        epicDescription: String(params["epicDescription"] ?? ""),
        featureSets: Array.isArray(params["featureSets"]) ? params["featureSets"] as import("@/lib/feature-build-types").FeatureSetEntry[] : [],
      };
      const validation = validateDecompositionPlan(plan);
      if (!validation.valid) {
        return { success: false, error: validation.errors.join(", "), message: `Invalid plan: ${validation.errors.join(", ")}` };
      }
      return {
        success: true,
        message: `Decomposition plan: ${plan.epicTitle} — ${plan.featureSets.length} feature set${plan.featureSets.length !== 1 ? "s" : ""}.`,
        data: plan as unknown as Record<string, unknown>,
      };
    }

    case "register_tech_debt": {
      const { createTechDebtItem } = await import("@/lib/decomposition");
      const item = createTechDebtItem({
        title: String(params["title"] ?? ""),
        description: String(params["description"] ?? ""),
        severity: String(params["severity"] ?? "medium"),
      });
      // Find the refactoring epic
      const refactorEpic = await prisma.epic.findUnique({ where: { epicId: "EP-REFACTOR-001" } });
      await prisma.backlogItem.create({
        data: {
          itemId: item.itemId,
          title: item.title,
          type: item.type,
          status: item.status,
          body: item.body,
          priority: item.priority,
          ...(refactorEpic ? { epicId: refactorEpic.id } : {}),
        },
      });
      return { success: true, entityId: item.itemId, message: `Tech debt logged: ${item.itemId}` };
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
git commit -m "feat: register intake MCP tools (search, complexity, decomposition, tech debt)"
```

---

### Task 7: Update Agent Prompts

**Files:**
- Modify: `apps/web/lib/build-agent-prompts.ts`

- [ ] **Step 1: Update Ideate phase prompt to use context search**

In `apps/web/lib/build-agent-prompts.ts`, replace the `ideate` entry:

```typescript
  ideate: `First, silently call search_portfolio_context with the feature title to find related items. If matches are found, weave them into your first question: "This relates to [product X] in [portfolio Y]" or "There's an open backlog item for this."

Then ask one short question at a time. When you have enough, silently call assess_complexity with your scores. If the path is "complex", call propose_decomposition and present the breakdown conversationally. If "simple" or "moderate", summarize in 2-3 bullets and ask "Does this capture it?" On yes, silently call update_feature_brief.`,
```

- [ ] **Step 2: Run all tests**

```bash
cd apps/web && npx vitest run
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/build-agent-prompts.ts
git commit -m "feat: update Ideate prompt to search portfolio context and assess complexity"
```

---

### Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
pnpm test
```

Expected: All tests pass (existing + new).

- [ ] **Step 2: Run TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Visual smoke test**

1. Navigate to `/build`, create a new build
2. Open co-worker panel, describe a feature
3. Agent should mention related products/backlog items if any match
4. For a simple idea, agent proceeds normally
5. For a complex idea ("build a financial management system"), agent should propose a decomposition

- [ ] **Step 4: Commit if needed**

```bash
git add -A && git commit -m "chore: final adjustments for EP-INTAKE-001"
```
