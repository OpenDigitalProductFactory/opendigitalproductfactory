# Brand Design System Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Introduce an org-scoped `BrandDesignSystem` that is extracted once (from codebase + website + optional uploads) and reused by both the Storefront renderer and Build Studio — replacing today's shallow URL-only brand extraction and the manual design-intelligence CSVs.

**Architecture:** Three PRs land substrate-first: (1) a new `Organization.designSystem Json?` field and a shared TypeScript contract with dual-read in existing consumers, (2) a `BrandExtractionService` run as an Inngest background function, exposed through a new MCP tool that the `onboarding-coo` and `admin-assistant` coworkers invoke — the **coworker is the conduit**: it accepts the task, shows busy in the agent panel (mirroring the build-orchestrator SSE pattern), and posts a completion summary when done, (3) Storefront setup wizard's branding step swaps to a three-source form that delegates extraction to the coworker. Existing `BrandingConfig.tokens` runtime theming stays untouched — the new substrate feeds it, doesn't replace it.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, Inngest, Vitest, Server Actions + Route Handlers, shadcn/ui, Tailwind, SSE via `/api/agent/stream`, Opus 4.7 via the AI inference abstraction (`apps/web/lib/ai-inference.ts`).

---

## Explicitly Out of Scope

- **Visual Design phase for Build Studio** — the new coworker-driven phase that generates HTML/React mockups from the substrate. Separate plan after this one lands.
- **Handoff-bundle import** from Anthropic's hosted Claude Design product. Follow-up once the substrate exists.
- **Replacing `BrandingConfig.tokens`** — runtime theme tokens stay where they are. The extractor derives a `BrandingConfig.tokens` update as a side-effect so existing theming keeps working.
- **Deleting the design-intelligence CSVs** at `apps/web/data/design-intelligence/`. They stay in-tree as a seed fallback for "no sources provided" mode. A later cleanup can remove them once the org-scoped path is fully adopted.
- **Creating a new "Storefront Owner" coworker.** Research shows `marketing-specialist` owns `/storefront` and `onboarding-coo` owns `/setup`. The skill is assigned to `onboarding-coo` (setup-time entry) and `admin-assistant` (post-setup re-extraction from Admin > Branding). No new coworker record needed.
- **Figma/Canva ingestion.** Upload slot accepts files but parsing is limited to logos/PDF/PPTX text in this plan.

---

## Architecture Decisions

### AD-1: `Organization.designSystem` is the canonical substrate

Today, `StorefrontConfig.designSystem` is a `Json?` column that stores a free-form markdown blob (wrapped by `typeof === "string"` defensive handling in both consumers) produced by `generateDesignSystem()` from the CSV lookup. It is per-storefront, which is wrong — a brand is an org-level concept. Adding a new `Organization.designSystem Json?` field avoids migrating the existing field and cleanly separates "the brand" from "this one storefront's overrides."

### AD-1a: Pre-existing bug to fix opportunistically in PR 1

Both current consumers — [feature-build-data.ts:266-291](apps/web/lib/explore/feature-build-data.ts#L266) and [build-pipeline.ts:252-263](apps/web/lib/integrate/build-pipeline.ts#L252) — call `prisma.storefrontConfig.findFirst({ select: { designSystem: true } })` with **no `where` clause**. This returns any arbitrary org's storefront. Dual-read threading in PR 1 must pass a real `organizationId` (derivable from `r.portfolioId` via `portfolio.organizationId` in feature-build-data, and from `build.portfolioId` in build-pipeline) so consumers read the correct org's design system. The new helper must also support an arg-less fallback call to preserve the existing "find any" behavior for legacy callers during rollout.

### AD-2: Consumers dual-read during transition

Consumers read `Organization.designSystem` first (when an org ID is resolvable), fall back to `StorefrontConfig.designSystem` (legacy shape), and finally to `generateDesignSystem()` CSV output. This lets PR 1 land without behavior regression — the new field is empty everywhere until PR 2 starts populating it.

### AD-3: Coworker-as-conduit via tool invocation

DPF skills are prompts (markdown), not handler functions. Work happens through **MCP tools** the agent invokes. So the pattern is:

1. User asks the coworker to "refresh our brand" (or clicks a button in the wizard that sends a message to the coworker thread).
2. The skill file `skills/storefront/extract-brand-design-system.skill.md` teaches the coworker to gather sources (URL, codebase ref, uploaded assets) and call the `extract_brand_design_system` tool.
3. The tool handler in `apps/web/lib/mcp-tools.ts` creates a `TaskRun`, fires an Inngest event `brand/extract.run`, returns `{ taskRunId, status: "queued" }` immediately.
4. The Inngest function in `apps/web/lib/queue/functions/brand-extract.ts` does the work, writes progress to `TaskRun.status` + emits SSE events on the agent thread via a new `progress.push()` helper, and on completion writes `Organization.designSystem` and posts a summary message back to the thread.
5. The agent panel's existing `isBusy` + SSE listener renders the progress (mirrors the build-orchestrator pattern).

### AD-4: Storefront renderer stays working

The existing storefront renderer does not directly apply design tokens today — the only consumers read `designSystem` as LLM context (build-pipeline, feature-build-data). So no UI regression risk from switching to the new field. `BrandingConfig.tokens` continues to drive any active theming.

### AD-5: Failure surfaces to the coworker, not the wizard

If extraction fails, the Inngest function writes `TaskRun.status = "failed"` and posts an error message to the agent thread. The coworker tells the user in natural language and offers next steps. The wizard never blocks on extraction — it always lets the user skip and come back.

### AD-6: PR 3 targets `/admin/branding`, not the bootstrap `SetupWizard`

Research clarified that DPF has **two distinct "setup" surfaces** that this plan must not conflate: (a) [SetupWizard.tsx](apps/web/components/storefront-admin/SetupWizard.tsx) is the archetype/preview/financial wizard — three numeric steps, no branding step — rendered once during first-run storefront setup, and (b) `SETUP_STEPS` in [setup-constants.ts](apps/web/lib/actions/setup-constants.ts) is a separate post-bootstrap progress tour whose "branding" entry routes to `/admin/branding`. PR 3 in this plan edits `/admin/branding` (the tour step), which is where the three-source extraction form belongs. Offering extraction during the bootstrap `SetupWizard` is a follow-up (see Follow-ups §7).

### AD-7: Write-once concurrency safeguard

Inngest's `concurrency: [{ key: "event.data.organizationId", limit: 1 }]` config prevents two simultaneous extractions for the same org from race-writing `Organization.designSystem`. The MCP tool handler also checks for an active `TaskRun(title="Extract brand design system", organizationId=...)` before firing a new event — if one is running, it returns "already in progress" rather than queueing a second job.

---

## PR 1 — Substrate

**Scope:** Add `Organization.designSystem Json?` field, define the `BrandDesignSystem` TypeScript contract, update the two LLM-context consumers to dual-read. No behavior change from the user's perspective.

**Risk band:** Low. Additive schema change, additive type file, conservative changes to two consumer functions.

### Task 1.1: Create migration adding `Organization.designSystem`

**Files:**
- Create: `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_add_organization_design_system/migration.sql`
- Modify: `packages/db/prisma/schema.prisma:1759-1777` (the `Organization` model)

**Migration SQL (exact contents):**
```sql
ALTER TABLE "Organization" ADD COLUMN "designSystem" JSONB;
```

**Schema edit — add line between `logoUrl` and `createdAt`:**
```prisma
  logoUrl               String?
  designSystem          Json?
  createdAt             DateTime               @default(now())
```

Timestamp must be greater than the latest existing migration (`20260418174747_add_estate_identity_fields`). Use a timestamp computed at implementation time.

- [ ] **Step 1:** Run `pnpm --filter @dpf/db exec prisma migrate status` and confirm latest migration is `20260418174747_add_estate_identity_fields` (or whatever has landed since this plan was written; update the sequence accordingly).
- [ ] **Step 2:** Generate a fresh timestamp for the new migration directory: `YYYYMMDDHHMMSS` in UTC. Create `packages/db/prisma/migrations/<timestamp>_add_organization_design_system/` with a `migration.sql` file containing exactly the one-line ALTER TABLE above.
- [ ] **Step 3:** Update `packages/db/prisma/schema.prisma` `Organization` model to add the `designSystem Json?` field between `logoUrl` and `createdAt`.
- [ ] **Step 4:** Run `pnpm --filter @dpf/db exec prisma generate` and confirm no errors.
- [ ] **Step 5:** Run `pnpm --filter @dpf/db exec prisma migrate dev --name add_organization_design_system` — or if the migration directory was manually created, run `pnpm --filter @dpf/db exec prisma migrate resolve --applied <migration_name>` then `pnpm --filter @dpf/db exec prisma migrate deploy`. Confirm the column exists via `pnpm --filter @dpf/db exec prisma studio` or `psql`.
- [ ] **Step 6:** Commit: `feat(brand): add Organization.designSystem Json field`

### Task 1.2: Define `BrandDesignSystem` TypeScript contract

**Files:**
- Create: `apps/web/lib/brand/types.ts`
- Test: `apps/web/lib/brand/types.test.ts`

**Full contents of `apps/web/lib/brand/types.ts`:**
```ts
export type BrandDesignSystemVersion = "1.0.0";

export type AssetRef = {
  url: string;
  source: "upload" | "scraped" | "codebase" | "derived";
  mimeType?: string;
  width?: number;
  height?: number;
};

export type ExtractionSource = {
  kind: "codebase" | "url" | "upload";
  ref: string;
  capturedAt: string; // ISO-8601
};

export type NeutralScale = {
  50: string; 100: string; 200: string; 300: string; 400: string;
  500: string; 600: string; 700: string; 800: string; 900: string; 950: string;
};

export type Palette = {
  primary: string;
  secondary: string | null;
  accents: string[];
  semantic: { success: string; warning: string; danger: string; info: string };
  neutrals: NeutralScale;
  surfaces: { background: string; foreground: string; muted: string; card: string; border: string };
};

export type TypographyEntry = {
  size: string;
  lineHeight: string;
  tracking: string;
  weight: number;
};

export type TypographyScale = Record<
  "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl" | "6xl",
  TypographyEntry
>;

export type Typography = {
  families: { sans: string; serif: string | null; mono: string; display: string | null };
  scale: TypographyScale;
  pairings: Array<{ heading: string; body: string }>;
};

export type ComponentCatalogEntry = {
  name: string;
  variants: string[];
  anchorFile: string | null; // e.g. "apps/web/components/ui/button.tsx"
  tokens: Record<string, string>;
};

export type PatternEntry = {
  name: "hero" | "nav" | "card" | "footer" | "form" | string;
  anchorFile: string | null;
};

export type ComponentInventory = {
  library: "shadcn" | "mui" | "custom" | "unknown";
  inventory: ComponentCatalogEntry[];
  patterns: PatternEntry[];
};

export type DesignTokens = {
  radii: Record<string, string>;
  spacing: Record<string, string>;
  shadows: Record<string, string>;
  motion: Record<string, string>;
  breakpoints: Record<string, string>;
};

export type Identity = {
  name: string;
  tagline: string | null;
  description: string | null;
  logo: { darkBg: AssetRef | null; lightBg: AssetRef | null; mark: AssetRef | null };
  voice: { tone: string; sampleCopy: string[] };
};

export type BrandDesignSystem = {
  version: BrandDesignSystemVersion;
  extractedAt: string; // ISO-8601
  sources: ExtractionSource[];
  identity: Identity;
  palette: Palette;
  typography: Typography;
  components: ComponentInventory;
  tokens: DesignTokens;
  confidence: {
    overall: number; // 0..1
    perField: Record<string, number>;
  };
  gaps: string[];
  overrides: Partial<Omit<BrandDesignSystem, "version" | "overrides">>;
};

export function isBrandDesignSystem(value: unknown): value is BrandDesignSystem {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === "1.0.0" &&
    typeof v.extractedAt === "string" &&
    Array.isArray(v.sources) &&
    typeof v.identity === "object" &&
    typeof v.palette === "object" &&
    typeof v.typography === "object" &&
    typeof v.components === "object" &&
    typeof v.tokens === "object" &&
    typeof v.confidence === "object" &&
    Array.isArray(v.gaps)
  );
}
```

**Full contents of `apps/web/lib/brand/types.test.ts`:**
```ts
import { describe, it, expect } from "vitest";
import { isBrandDesignSystem, type BrandDesignSystem } from "./types";

const minimalValid: BrandDesignSystem = {
  version: "1.0.0",
  extractedAt: "2026-04-18T00:00:00.000Z",
  sources: [],
  identity: {
    name: "Acme",
    tagline: null,
    description: null,
    logo: { darkBg: null, lightBg: null, mark: null },
    voice: { tone: "neutral", sampleCopy: [] },
  },
  palette: {
    primary: "#000000",
    secondary: null,
    accents: [],
    semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
    neutrals: { 50: "#fff", 100: "#f9f9f9", 200: "#eee", 300: "#ddd", 400: "#bbb", 500: "#888", 600: "#666", 700: "#444", 800: "#222", 900: "#111", 950: "#000" },
    surfaces: { background: "#fff", foreground: "#000", muted: "#f5f5f5", card: "#fff", border: "#e5e5e5" },
  },
  typography: {
    families: { sans: "Inter", serif: null, mono: "JetBrains Mono", display: null },
    scale: {
      xs: { size: "0.75rem", lineHeight: "1rem", tracking: "0", weight: 400 },
      sm: { size: "0.875rem", lineHeight: "1.25rem", tracking: "0", weight: 400 },
      base: { size: "1rem", lineHeight: "1.5rem", tracking: "0", weight: 400 },
      lg: { size: "1.125rem", lineHeight: "1.75rem", tracking: "0", weight: 400 },
      xl: { size: "1.25rem", lineHeight: "1.75rem", tracking: "0", weight: 500 },
      "2xl": { size: "1.5rem", lineHeight: "2rem", tracking: "0", weight: 600 },
      "3xl": { size: "1.875rem", lineHeight: "2.25rem", tracking: "0", weight: 700 },
      "4xl": { size: "2.25rem", lineHeight: "2.5rem", tracking: "0", weight: 700 },
      "5xl": { size: "3rem", lineHeight: "1", tracking: "0", weight: 700 },
      "6xl": { size: "3.75rem", lineHeight: "1", tracking: "0", weight: 700 },
    },
    pairings: [],
  },
  components: { library: "shadcn", inventory: [], patterns: [] },
  tokens: { radii: {}, spacing: {}, shadows: {}, motion: {}, breakpoints: {} },
  confidence: { overall: 0.5, perField: {} },
  gaps: [],
  overrides: {},
};

describe("isBrandDesignSystem", () => {
  it("accepts a minimal valid BrandDesignSystem", () => {
    expect(isBrandDesignSystem(minimalValid)).toBe(true);
  });

  it("rejects null and primitives", () => {
    expect(isBrandDesignSystem(null)).toBe(false);
    expect(isBrandDesignSystem(undefined)).toBe(false);
    expect(isBrandDesignSystem("string")).toBe(false);
    expect(isBrandDesignSystem(42)).toBe(false);
  });

  it("rejects objects missing required fields", () => {
    const { identity: _identity, ...missingIdentity } = minimalValid;
    expect(isBrandDesignSystem(missingIdentity)).toBe(false);
  });

  it("rejects wrong version", () => {
    expect(isBrandDesignSystem({ ...minimalValid, version: "2.0.0" })).toBe(false);
  });
});
```

- [ ] **Step 1:** Write `apps/web/lib/brand/types.test.ts` with the four `describe`/`it` blocks above. Do NOT create `types.ts` yet.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run lib/brand/types.test.ts` — confirm it fails because the module doesn't exist.
- [ ] **Step 3:** Create `apps/web/lib/brand/types.ts` with the exact contents above.
- [ ] **Step 4:** Run `pnpm --filter web exec vitest run lib/brand/types.test.ts` — confirm all four tests pass.
- [ ] **Step 5:** Run `pnpm --filter web typecheck` — confirm no errors.
- [ ] **Step 6:** Commit: `feat(brand): add BrandDesignSystem TypeScript contract`

### Task 1.3: Add org-scoped read helper with dual-read fallback

**Files:**
- Create: `apps/web/lib/brand/read.ts`
- Test: `apps/web/lib/brand/read.test.ts`

**Full contents of `apps/web/lib/brand/read.ts`:**
```ts
import { prisma } from "@dpf/db";
import { isBrandDesignSystem, type BrandDesignSystem } from "./types";

export type BrandContext = {
  structured: BrandDesignSystem | null;
  legacyMarkdown: string | null;
  source: "organization" | "storefront" | "none";
};

/**
 * Resolve the org-scoped brand design system with a dual-read fallback.
 * Pass `organizationId` when available (preferred); falls back to storefront-by-id
 * lookup, then to an arg-less "find any storefront" match for backward compatibility
 * with legacy callers that have no org context.
 */
export async function readBrandContext(args: {
  organizationId?: string | null;
  storefrontId?: string | null;
}): Promise<BrandContext> {
  if (args.organizationId) {
    const org = await prisma.organization.findUnique({
      where: { id: args.organizationId },
      select: { designSystem: true, storefrontConfig: { select: { id: true, designSystem: true } } },
    });
    if (org?.designSystem && isBrandDesignSystem(org.designSystem)) {
      return { structured: org.designSystem, legacyMarkdown: null, source: "organization" };
    }
    if (org?.storefrontConfig?.designSystem) {
      const raw = org.storefrontConfig.designSystem;
      const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { structured: null, legacyMarkdown: legacy, source: "storefront" };
    }
    return { structured: null, legacyMarkdown: null, source: "none" };
  }

  if (args.storefrontId) {
    const storefront = await prisma.storefrontConfig.findUnique({
      where: { id: args.storefrontId },
      select: { designSystem: true, organizationId: true },
    });
    if (storefront?.organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: storefront.organizationId },
        select: { designSystem: true },
      });
      if (org?.designSystem && isBrandDesignSystem(org.designSystem)) {
        return { structured: org.designSystem, legacyMarkdown: null, source: "organization" };
      }
    }
    if (storefront?.designSystem) {
      const raw = storefront.designSystem;
      const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
      return { structured: null, legacyMarkdown: legacy, source: "storefront" };
    }
    return { structured: null, legacyMarkdown: null, source: "none" };
  }

  // Legacy fallback: preserve today's behavior of picking any storefront so callers
  // that have no org context (existing feature-build-data / build-pipeline paths
  // until they're updated) don't regress.
  const anyStorefront = await prisma.storefrontConfig.findFirst({
    select: { designSystem: true },
  });
  if (anyStorefront?.designSystem) {
    const raw = anyStorefront.designSystem;
    const legacy = typeof raw === "string" ? raw : JSON.stringify(raw);
    return { structured: null, legacyMarkdown: legacy, source: "storefront" };
  }

  return { structured: null, legacyMarkdown: null, source: "none" };
}
```

**Test file `apps/web/lib/brand/read.test.ts`:** mocks `@dpf/db` with `vi.mock`, exercises three paths — org field populated (returns structured), org field empty but storefront has legacy string (returns legacy), both empty (returns none). Mirror the mock style used in existing wizard/setup tests.

- [ ] **Step 1:** Write `apps/web/lib/brand/read.test.ts` with FIVE tests: (a) org has valid `designSystem` JSON → `source: "organization"`; (b) org exists but designSystem is null, related storefront has legacy JSON → `source: "storefront"`; (c) no organizationId passed, `storefrontId` passed, storefront's org has valid JSON → `source: "organization"`; (d) no IDs passed, any storefront has a legacy blob → `source: "storefront"` (legacy fallback); (e) no IDs passed, no storefronts exist → `source: "none"`. Use `vi.mock("@dpf/db", () => ({ prisma: { organization: { findUnique: vi.fn() }, storefrontConfig: { findUnique: vi.fn(), findFirst: vi.fn() } } }))`.
- [ ] **Step 2:** Run `pnpm --filter web exec vitest run lib/brand/read.test.ts` — confirm it fails (module missing).
- [ ] **Step 3:** Create `apps/web/lib/brand/read.ts` with the exact contents above.
- [ ] **Step 4:** Run `pnpm --filter web exec vitest run lib/brand/read.test.ts` — confirm all five tests pass.
- [ ] **Step 5:** Commit: `feat(brand): add readBrandContext with org-first dual-read and legacy fallback`

### Task 1.4: Wire dual-read into `feature-build-data.ts` with org-ID threading

**Files:**
- Modify: `apps/web/lib/explore/feature-build-data.ts:263-291`

The current code calls `prisma.storefrontConfig.findFirst({ select: { designSystem: true } })` with **no `where` clause** — a pre-existing bug that picks any org's storefront. Fix it here by resolving `organizationId` from `r.portfolioId` and passing it into `readBrandContext`.

**Exact change:** Replace the block at lines 266–291 (the existing `let designSystem: string | undefined; try { ... }` through the `generateDesignSystem()` fallback) with:

```ts
// Resolve organization from the portfolio (r.portfolioId) for org-scoped brand lookup.
let organizationId: string | null = null;
if (r.portfolioId) {
  try {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: r.portfolioId },
      select: { organizationId: true },
    });
    organizationId = portfolio?.organizationId ?? null;
  } catch { /* non-fatal */ }
}

let designSystem: string | undefined;
try {
  const { readBrandContext } = await import("@/lib/brand/read");
  const ctx = await readBrandContext({ organizationId });
  if (ctx.structured) {
    const s = ctx.structured;
    designSystem = `Brand: ${s.identity.name}\nPrimary color: ${s.palette.primary}\nBody font: ${s.typography.families.sans}\nConfidence: ${(s.confidence.overall * 100).toFixed(0)}%\n---\n${JSON.stringify(s, null, 2).slice(0, 3000)}`;
  } else if (ctx.legacyMarkdown) {
    designSystem = ctx.legacyMarkdown;
  }
} catch { /* non-fatal */ }

if (!designSystem) {
  try {
    const { generateDesignSystem } = await import("@/lib/design-intelligence");
    const brief = r.brief as { description?: string; title?: string } | null;
    const query = brief?.description ?? brief?.title ?? r.title;
    if (query) {
      designSystem = generateDesignSystem(query, r.title ?? undefined);
    }
  } catch { /* non-fatal */ }
}
```

- [ ] **Step 1:** Read lines 260–291 of `apps/web/lib/explore/feature-build-data.ts` and confirm the current block matches the AD-1a description.
- [ ] **Step 2:** Check for an existing test file next to `feature-build-data.ts`. If absent, create a focused test that covers: (a) org has structured designSystem → formatted string uses identity name; (b) org has only legacy storefront blob → string is the blob; (c) nothing exists → falls back to `generateDesignSystem` CSV output.
- [ ] **Step 3:** Run the test and confirm the structured path fails (no code exists yet for it).
- [ ] **Step 4:** Apply the exact change above. Verify that `prisma.portfolio.findUnique({ where: { slug }, select: { organizationId } })` matches the actual Portfolio model schema (grep `model Portfolio` in `schema.prisma` to confirm the field is named `organizationId`; adjust if the field uses a different name).
- [ ] **Step 5:** Run the test file — confirm all three paths pass.
- [ ] **Step 6:** Run `pnpm --filter web typecheck`.
- [ ] **Step 7:** Commit: `refactor(brand): thread organizationId into feature-build-data design-system lookup`

### Task 1.5: Wire dual-read into `build-pipeline.ts` with org-ID threading

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts:252-263`

Same pattern as 1.4. The existing block calls `findFirst` with no `where`; fix by resolving organization from `build.portfolioId`.

- [ ] **Step 1:** Read lines 245–275 of `apps/web/lib/integrate/build-pipeline.ts` for context. Note that `build` object already contains `portfolioId`.
- [ ] **Step 2:** Check for an existing test file; if present, extend it with an org-scoped test scenario. If absent, add a focused test.
- [ ] **Step 3:** Run test — confirm the structured-designSystem path fails (no code yet).
- [ ] **Step 4:** Apply the same pattern as Task 1.4 Step 4 — resolve `organizationId` from the portfolio, call `readBrandContext({ organizationId })`, format the structured output identically.
- [ ] **Step 5:** Run test — confirm it passes.
- [ ] **Step 6:** Run `pnpm --filter web typecheck`.
- [ ] **Step 7:** Commit: `refactor(brand): thread organizationId into build-pipeline design-system lookup`

### Task 1.6: PR 1 verification

- [ ] **Step 1:** Run `pnpm --filter web typecheck` — passes.
- [ ] **Step 2:** Run `pnpm --filter web test` — all tests pass.
- [ ] **Step 3:** Run `pnpm --filter web build` — succeeds (production build gate per `CLAUDE.md`).
- [ ] **Step 4:** Open PR using `.github/PULL_REQUEST_TEMPLATE.md`. Title: `feat(brand): add Organization.designSystem substrate (PR 1 of 3)`. In Summary, reference this plan at `docs/superpowers/plans/2026-04-18-brand-design-system-substrate.md`. In Test plan, check all four boxes and describe manual verification as "confirmed Prisma migration applied cleanly; feature-build-data and build-pipeline still produce build context when both fields are empty (CSV fallback path)."
- [ ] **Step 5:** Merge only when CI passes on `main`.

---

## PR 2 — Extraction service, MCP tool, coworker skill (background)

**Scope:** Build `BrandExtractionService`, expose it as an Inngest background function, add the MCP tool the coworker invokes, seed the new skill, wire progress events into the existing SSE stream. The coworker becomes the conduit: accept task → show busy → ping back with summary.

**Risk band:** Medium. New service + new tool + new skill + new Inngest function, but no UI changes and no consumer changes beyond PR 1.

**Requires:** PR 1 merged (for `Organization.designSystem` field and `readBrandContext` helper).

### Task 2.1: Create brand extraction module skeleton

**Files:**
- Create: `apps/web/lib/brand/extraction/types.ts`
- Create: `apps/web/lib/brand/extraction/index.ts`
- Test: `apps/web/lib/brand/extraction/index.test.ts`

**`types.ts`:**
```ts
import type { BrandDesignSystem, ExtractionSource } from "../types";

export type ExtractionInput = {
  organizationId: string;
  taskRunId: string;
  userId: string;
  threadId: string | null;
  sources: {
    url?: string;
    codebasePath?: string; // filesystem path on the portal container
    uploads?: Array<{ name: string; mimeType: string; data: Buffer }>;
  };
};

export type ExtractionProgress = {
  stage: "scraping" | "reading-codebase" | "parsing-uploads" | "merging" | "synthesizing" | "writing";
  message: string;
  percent: number;
};

export type ExtractionResult = {
  designSystem: BrandDesignSystem;
  sourcesUsed: ExtractionSource[];
  durationMs: number;
};

export type PartialDesignSystem = Partial<BrandDesignSystem> & {
  confidence?: { overall?: number; perField?: Record<string, number> };
};

export type ProgressEmitter = (p: ExtractionProgress) => Promise<void>;
```

**`index.ts`:** single `extractBrandDesignSystem(input, emit)` function — skeleton returns a static minimal `BrandDesignSystem` so tests can pass. Concrete adapters are filled in by Tasks 2.2–2.5.

- [ ] **Step 1:** Write a failing test in `index.test.ts` that calls `extractBrandDesignSystem()` with zero sources and asserts the result has `version: "1.0.0"` and `confidence.overall === 0`.
- [ ] **Step 2:** Run — fails (module missing).
- [ ] **Step 3:** Write skeleton returning the minimal valid `BrandDesignSystem` shape (copy from Task 1.2's test fixture) with `confidence.overall: 0` and `gaps: ["no sources provided"]`.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Commit: `feat(brand): scaffold BrandExtractionService module`

### Task 2.2: URL source adapter

**Files:**
- Create: `apps/web/lib/brand/extraction/url-adapter.ts`
- Test: `apps/web/lib/brand/extraction/url-adapter.test.ts`

Reuses `fetchPublicWebsiteEvidence` and `analyzePublicWebsiteBranding` from `apps/web/lib/public-web-tools.ts` (already imported by `branding.ts`). Produces a `PartialDesignSystem` with identity + palette + limited typography.

- [ ] **Step 1:** Read `apps/web/lib/public-web-tools.ts` to confirm the shape of `fetchPublicWebsiteEvidence` and `analyzePublicWebsiteBranding`. Copy their signatures into the plan-execution scratchpad.
- [ ] **Step 2:** Write failing tests: (a) valid URL → returns `identity.name`, `palette.primary`, at least one logo AssetRef; (b) URL fetch error → returns partial with `gaps` noting the failure; (c) empty body → returns partial with low confidence.
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Implement `urlAdapter(url: string): Promise<PartialDesignSystem>` calling the existing public-web-tools helpers. Map their output to `PartialDesignSystem` shape. When fetch fails, catch and return a partial with an informative `gaps` entry instead of throwing.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): url adapter for extraction (palette, identity, logos)`

### Task 2.3: Codebase source adapter

**Files:**
- Create: `apps/web/lib/brand/extraction/codebase-adapter.ts`
- Test: `apps/web/lib/brand/extraction/codebase-adapter.test.ts`

Reads Tailwind config + CSS `:root` vars + shadcn component registry from a repo checkout path.

**Critical scoping rule:** The DPF portal container's code (`/app/...`) is NOT every org's codebase — it is the platform's own code. If a non-platform org triggers extraction with `includeCodebase: true`, reading `/app` would cross-contaminate their design system with DPF's Tailwind config. The adapter therefore:
- Accepts a `rootPath` argument; callers must pass the org's connected-repo path.
- When called with no valid path or a path that does not exist, returns `{ components: { library: "unknown", inventory: [], patterns: [] } }` with a `gaps` entry `"no connected codebase"` — it does NOT fall back to scanning `/app`.
- The MCP tool handler (Task 2.9) decides whether to pass a codebase path: for the DPF platform org itself (identified by a dedicated `Organization.isPlatformOrg` flag or equivalent — check schema; if absent, skip codebase scanning by default and open a follow-up) it passes `/app`; for all other orgs it passes the configured connected-repo path or nothing.

Strategy for reading a valid path:
1. Read `tailwind.config.ts`/`.js` if present — extract `theme.extend.colors`, `fontFamily`, `borderRadius`, `boxShadow`.
2. Read any `globals.css` or `app.css` and parse `:root { --color-...: ... }` declarations.
3. Glob `components/ui/*.tsx` and record component names into the inventory.
4. If no config files found, return a near-empty partial with gaps populated.

- [ ] **Step 1:** Write failing tests using `memfs` or temp dirs to stage a fake codebase with a Tailwind config + one CSS root-vars file + two shadcn-style component files. Assert palette, tokens, and component inventory are populated.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement `codebaseAdapter(rootPath: string): Promise<PartialDesignSystem>`. Use Node `fs/promises` + the existing glob dependency. Do NOT evaluate the Tailwind config as code — parse as text with regex, or require() it inside a try/catch since it may have TS-only syntax. For the plan, start with regex parsing of `theme: { extend: { colors: { ... } } }` — simple and safe.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Commit: `feat(brand): codebase adapter reading tailwind+css+shadcn`

### Task 2.4: Upload source adapter

**Files:**
- Create: `apps/web/lib/brand/extraction/upload-adapter.ts`
- Test: `apps/web/lib/brand/extraction/upload-adapter.test.ts`

Handles image uploads (PNG/SVG logos) and PDF/PPTX files (extract dominant colors from embedded images, extract text for tagline/voice).

For this PR, scope is:
- Images: record as `AssetRef` on `identity.logo.mark` (image), extract dominant color for palette hint.
- PDFs/PPTX: extract raw text with `pdf-parse` / `mammoth` or equivalent; pass the first 2000 chars through to the synthesizer as context, not directly into fields.

- [ ] **Step 1:** Check `apps/web/package.json` for existing PDF/image libraries (may already have `sharp`, `pdf-parse`). Use what exists before adding deps.
- [ ] **Step 2:** Write failing tests: (a) PNG upload → dominant color extracted, logo AssetRef recorded; (b) PDF with text → text captured into `partial.identity.description` with low confidence; (c) unsupported MIME → skipped with a `gaps` entry.
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Implement `uploadAdapter(uploads: ExtractionInput["sources"]["uploads"]): Promise<PartialDesignSystem>`.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): upload adapter (images, PDF, PPTX text)`

### Task 2.5: Merger + synthesizer

**Files:**
- Create: `apps/web/lib/brand/extraction/merge.ts`
- Create: `apps/web/lib/brand/extraction/synthesize.ts`
- Tests alongside.

Merger resolves conflicts: codebase > uploads > URL for tokens; uploads > URL > codebase for identity/logos; URL fills gaps. Assigns per-field `confidence` based on source agreement (two sources agree → 0.9, one source → 0.6, no source → 0).

Synthesizer uses `callAIInference()` (`apps/web/lib/ai-inference.ts`) with Opus 4.7 to fill `gaps[]`. It is a prompt-only step — input is the merged `PartialDesignSystem`, output is the same shape with low-confidence synthetic values for missing fields. Every synthetic value gets a matching low `confidence.perField` entry.

- [ ] **Step 1:** Write failing tests for `merge()`: (a) three partials with different primary colors → codebase wins, confidence 0.6; (b) two partials agree on primary → confidence 0.9; (c) only URL has data → confidence 0.4.
- [ ] **Step 2:** Run — fails. Implement `merge()`. Run — passes.
- [ ] **Step 3:** Commit: `feat(brand): merger with confidence weighting`
- [ ] **Step 4:** Write failing test for `synthesize()`: given a partial with missing `typography.scale`, LLM is mocked to return a Tailwind-default-like scale; result has `gaps: []` and the new fields have `confidence.perField["typography.scale"] <= 0.5`.
- [ ] **Step 5:** Run — fails. Implement `synthesize()` calling `callAIInference()` with a system prompt that instructs Opus 4.7 to fill missing fields and return strict JSON matching the schema. Mock `callAIInference` in tests. Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): synthesizer fills gaps via Opus 4.7`

### Task 2.6: Wire adapters into the top-level `extractBrandDesignSystem`

**Files:**
- Modify: `apps/web/lib/brand/extraction/index.ts`
- Modify: `apps/web/lib/brand/extraction/index.test.ts`

Calls adapters in parallel (where possible), merges, synthesizes, returns full `BrandDesignSystem`. Emits progress at each stage via the provided emitter.

- [ ] **Step 1:** Extend the existing `index.test.ts` with an integration-style test that stages a fake codebase, passes a URL, passes an uploaded PNG, mocks `callAIInference`, and asserts all six progress stages are emitted in order and the final result has `version: "1.0.0"`, populated identity, palette, and components.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Update `index.ts` to call the three adapters (via `Promise.allSettled`), merge with the merger, synthesize gaps, emit progress at each stage, return the result with `durationMs` and `sourcesUsed`.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Commit: `feat(brand): compose extraction pipeline end-to-end`

### Task 2.7: Progress-over-SSE helper tied to thread

**Files:**
- Create: `apps/web/lib/tak/thread-progress.ts`
- Test: `apps/web/lib/tak/thread-progress.test.ts`

The existing `agentEventBus` is in-memory (per Node process). An Inngest function runs in a worker context — it may or may not share memory with the HTTP server. We write progress to `TaskRun.status` + a new `TaskRun.progressPayload Json?` field AND emit to the bus when we're in the same process. The SSE route at `/api/agent/stream` reads both the bus (hot path) and `TaskRun.progressPayload` (recovery path).

**Schema addition** to `packages/db/prisma/schema.prisma` (add to `TaskRun` at lines 2427–2453):
```prisma
  progressPayload    Json?
```

(New field, nullable — no migration risk.)

- [ ] **Step 1:** Add `progressPayload Json?` to `TaskRun`. Create migration `<timestamp>_add_taskrun_progress_payload/migration.sql` with `ALTER TABLE "TaskRun" ADD COLUMN "progressPayload" JSONB;`.
- [ ] **Step 2:** Run `pnpm --filter @dpf/db exec prisma generate` and `prisma migrate deploy`.
- [ ] **Step 3:** Write failing test for `pushThreadProgress(threadId, taskRunId, progress)`: it writes to `TaskRun.progressPayload` and (when in-process) calls `agentEventBus.emit`.
- [ ] **Step 4:** Implement in `thread-progress.ts`. Import `agentEventBus` from `apps/web/lib/tak/agent-event-bus.ts`. Write the emit+persist function. Run — passes.
- [ ] **Step 5:** Extend the SSE route `apps/web/app/api/agent/stream/route.ts` to also replay the latest `TaskRun.progressPayload` for any active `TaskRun` linked to the thread on subscriber connect — handles reconnection / cross-process. Add a focused test.
- [ ] **Step 6:** Commit: `feat(brand): TaskRun.progressPayload + SSE replay for cross-process progress`

### Task 2.8: Inngest function `brand/extract.run`

**Depends on:** Task 2.7 (`pushThreadProgress`).

**Files:**
- Create: `apps/web/lib/queue/functions/brand-extract.ts`
- Modify: `apps/web/lib/queue/inngest-client.ts` (add event type)
- Modify: `apps/web/lib/queue/functions/index.ts` (add to `allFunctions`)
- Test: `apps/web/lib/queue/functions/brand-extract.test.ts`

Event: `brand/extract.run` with data `{ organizationId, taskRunId, userId, threadId, sources }`. Note: the `inngest` client at `inngest-client.ts:3` is constructed as `new Inngest({ id: "dpf-platform" })` with no event schema registration — event types are interfaces used by callers as a convention, not enforced at `inngest.send()` call-sites today. Adding `BrandExtractRunEvent` matches the existing pattern; do not attempt to register schemas unless it is already done elsewhere in the file.

The function:
1. Marks `TaskRun.status = "active"`.
2. Calls `extractBrandDesignSystem()` with an emitter that goes **through `pushThreadProgress`** — the Inngest worker may run in a different process from the HTTP server, so all progress must persist to `TaskRun.progressPayload`. The SSE route reads that payload on subscribe (Task 2.7). No direct SSE emission from worker context.
3. Writes the result to `Organization.designSystem`.
4. **As a same-transaction side-effect**, derives an updated `BrandingConfig.tokens` shape from the new `BrandDesignSystem` (palette → tokens.palette, typography.families.sans → tokens.typography.fontFamily, etc.) and upserts `BrandingConfig` with `scope = "organization:<orgId>"`. This is what AD-1 promised — the runtime theme stays working. Covered by the applyBrandDesignSystem mapper (shared helper — see Task 2.8b below).
5. Marks `TaskRun.status = "completed"`, sets `completedAt`.
6. Posts an `AgentMessage` to the thread: assistant role, content = a short summary ("Extracted your brand from N sources. Primary color #XXXX, body font X. Confidence: XX%. Open Branding to review.").
7. Writes a final entry to `TaskRun.progressPayload`: `{ stage: "done", message: "Extraction complete", percent: 100 }` — the panel reads this via the SSE route.

On failure: set `TaskRun.status = "failed"`, populate an error field (e.g., write `TaskRun.progressPayload = { stage: "failed", message: <human-readable error>, percent: 0 }`), post an `AgentMessage` explaining the failure + next steps.

**Inngest config:** retries `1`, concurrency `[{ key: "event.data.organizationId", limit: 1 }]` — per-org write-once per AD-7.

- [ ] **Step 1:** Add `BrandExtractRunEvent` interface to `inngest-client.ts` matching the `AiEvalRunEvent` pattern. Name: `"brand/extract.run"`, data: `{ organizationId: string; taskRunId: string; userId: string; threadId: string | null; sources: { url?: string; codebasePath?: string; uploadIds?: string[] } }`.
- [ ] **Step 2:** Write failing test for the function: mock `extractBrandDesignSystem` to return a static result, mock `prisma` (including `organization.update` and `brandingConfig.upsert`) and `pushThreadProgress`, fire the function, assert (a) `Organization.designSystem` is written, (b) `BrandingConfig` is upserted with matching tokens, (c) `TaskRun` flipped to completed, (d) summary message posted to thread.
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Implement `brand-extract.ts`. Register it in `functions/index.ts`'s `allFunctions` array. Use the concurrency key configuration shown above.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): inngest function brand/extract.run (with BrandingConfig side-effect)`

### Task 2.8b: Shared `designSystemToThemeTokens` mapper

**Files:**
- Create: `apps/web/lib/brand/apply.ts`
- Test: `apps/web/lib/brand/apply.test.ts`

Pure function `designSystemToThemeTokens(system: BrandDesignSystem): ThemeTokens` used by (a) Task 2.8 (writes `BrandingConfig.tokens` as a side-effect of extraction) and (b) PR 3's preview-apply action (rewrites `BrandingConfig.tokens` after user-approved overrides). Centralizing the mapping avoids drift between the two callers.

- [ ] **Step 1:** Read `apps/web/lib/branding-presets.ts` to see the current `ThemeTokens` type and `buildThemeTokens` / `deriveThemeTokens` behavior. Reuse its accent-derived fields to avoid duplicating contrast-correction logic.
- [ ] **Step 2:** Write failing test mapping a minimal valid `BrandDesignSystem` to expected `ThemeTokens` — check palette.primary → tokens.palette.accent, typography.families.sans → tokens.typography.fontFamily, at least one semantic color propagation.
- [ ] **Step 3:** Run — fails. Implement `designSystemToThemeTokens`. Run — passes.
- [ ] **Step 4:** Commit: `feat(brand): designSystemToThemeTokens mapper shared by extractor and apply`

### Task 2.9a: Probe — document the MCP tool handler context shape

**This is a research-only step, no code change. Produces a short note used by Task 2.9.**

- [ ] **Step 1:** In `apps/web/lib/mcp-tools.ts`, find the function that dispatches tools by name (grep for `switch (toolName)` or equivalent). Identify its signature — what arguments does each `case` block receive? Which parameter carries the `userId`, and is there an `organizationId` or session-like context?
- [ ] **Step 2:** Find an existing tool that writes org-scoped data (grep for `prisma.organization` or `organizationId:` inside any `case`). Document how that tool resolves the current user's organization. If it does `prisma.user.findUnique({ where: { id: userId }, include: { organization: ... } })` or similar, that's the pattern to mirror.
- [ ] **Step 3:** If NO existing tool resolves an organization on the server side, check whether the caller (the route or action that invokes `executeTool`) pre-resolves and passes it. Look at `apps/web/app/api/agent/send/route.ts` and `apps/web/lib/actions/agent-coworker.ts`.
- [ ] **Step 4:** Write a 5–10 line note at the top of Task 2.9 (as an HTML comment in the plan document or in a scratch file) stating: (a) the exact argument shape the new tool handler will receive, (b) the exact call chain that resolves `organizationId`, (c) any new context field that must be threaded through if the existing plumbing is insufficient.
- [ ] **Step 5:** Commit (research note only if stored in the repo): `docs(brand): probe MCP tool context shape for extract_brand_design_system`. If the note is kept in the plan document, no separate commit — just update the plan and continue.

### Task 2.9: MCP tool `extract_brand_design_system`

**Depends on:** Task 2.9a (for the exact context-resolution pattern).

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (add tool definition + handler)
- Test: `apps/web/lib/mcp-tools.test.ts` (extend existing test file)

Tool definition:
```ts
{
  name: "extract_brand_design_system",
  description: "Kick off a background brand extraction for the current organization. Returns a taskRunId immediately; progress is streamed through the agent panel. Use when the user asks to refresh the brand, build a design system, or analyze an existing site.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "Public website URL to extract from" },
      includeCodebase: { type: "boolean", description: "Also read the org's connected codebase (default: false; only true if the org has a connected repository)" },
      uploadIds: { type: "array", items: { type: "string" }, description: "IDs of AgentAttachment records to include" }
    },
    required: []
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}
```

Handler:
1. Resolve `organizationId` per the pattern documented by Task 2.9a. If it cannot be resolved, return a structured error `{ success: false, error: "Could not resolve current organization" }` — do NOT silently fall back.
2. **Concurrency guard (per AD-7):** query `prisma.taskRun.findFirst({ where: { title: "Extract brand design system", userId, status: "active" } })` — if an active run exists for this user on this org, return `{ success: true, taskRunId: existing.id, status: "already-in-progress", message: "An extraction is already running for your organization — I'll ping you when it finishes." }`.
3. Resolve the codebase path. For the platform org (determined by whatever mechanism Task 2.9a surfaces — e.g., a known slug like `"platform"` or an explicit flag) and only when `includeCodebase: true`, pass `codebasePath: "/app"`. For all other orgs, omit the codebase path unless a connected-repo path is stored somewhere queryable.
4. Create a `TaskRun` row with `source: "coworker"`, `title: "Extract brand design system"`, `objective` from the user's recent message, `status: "active"`.
5. Fire Inngest event `brand/extract.run` with `{ organizationId, taskRunId, userId, threadId, sources: { url, codebasePath, uploadIds } }`.
6. Return `{ success: true, taskRunId, status: "queued", message: "Working on it — I'll ping you when the brand is ready." }`.

- [ ] **Step 1:** Apply the note produced in Task 2.9a.
- [ ] **Step 2:** Write failing tests in `mcp-tools.test.ts`: (a) happy path — call the tool with `{ url: "https://example.com" }`, assert `TaskRun` is created, `inngest.send` is called with the correct event, tool returns `status: "queued"`; (b) concurrency guard — an active TaskRun with the same title exists, tool returns `status: "already-in-progress"` and does NOT fire a new event; (c) failure to resolve org — returns `success: false`.
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Add the tool definition and handler to `mcp-tools.ts`. Resolve uploads via `prisma.agentAttachment.findMany` (if uploads are referenced). Import `inngest` from `@/lib/queue/inngest-client`.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): extract_brand_design_system MCP tool (with concurrency guard)`

### Task 2.10: Skill file and seed

**Files:**
- Create: `skills/storefront/extract-brand-design-system.skill.md`
- Modify: `packages/db/src/seed-skills.ts` (if it enumerates skill files it needs to be re-run; if it globs the `skills/` directory, no code change needed — just re-run the seed).

**Full contents of the skill file:**
```markdown
---
name: extract-brand-design-system
description: "Extract a complete brand design system (palette, typography, components, tokens) from the org's website, codebase, and uploaded assets. Runs in the background and pings the user with a summary when done."
category: storefront
assignTo: ["onboarding-coo", "admin-assistant"]
capability: "manage_branding"
taskType: "conversation"
triggerPattern: "brand|design system|extract brand|theme|refresh brand|analyze site"
userInvocable: true
agentInvocable: true
allowedTools: ["extract_brand_design_system", "analyze_public_website_branding", "analyze_brand_document"]
composesFrom: []
contextRequirements: ["organizationId"]
riskBand: low
---

# Extract Brand Design System

The user wants to build or refresh their organization's design system — the canonical palette, typography, component inventory, and tokens that will drive the storefront, marketing materials, and product UI.

## What you should do

1. **Confirm the sources available.** Ask the user which of the following they can provide, and reassure them that any combination works:
   - A public website URL (their existing site or a site they want to match).
   - A connected codebase (if they're using DPF's own portal, this is already available).
   - Uploaded brand assets: logos (PNG, SVG), brand guideline PDFs, style decks (PPTX).

2. **Invoke the `extract_brand_design_system` tool** with the sources they've given you. You do not need to wait for the result — the tool returns immediately with a `taskRunId` and the extraction continues in the background.

3. **Acknowledge and step back.** Tell the user something like: "I'm pulling your brand together now — this usually takes 30 to 120 seconds. You can keep working or close this panel; I'll ping you here when I have a result." Do NOT simulate the work or make up a result. The agent panel will show progress.

4. **When the background job completes**, you'll receive a system event `brand:extract.complete`. Post a short summary and offer the user three next steps:
   - Review the extracted system at Admin > Branding.
   - Apply it to the storefront (pre-selected).
   - Re-extract with different sources.

5. **If extraction fails** (`brand:extract.failed`), acknowledge the failure in plain language, name the stage that failed (URL fetch, codebase read, synthesis), and offer to retry with different sources or skip for now.

## What you should NOT do

- Do not attempt to extract the design system by describing the website from memory or general knowledge — you are not a scraper. Always invoke the tool.
- Do not block the conversation waiting for the result.
- Do not write `Organization.designSystem` yourself. The background job does.
- Do not promise a timeline shorter than 30 seconds.

## End state

The user either has a newly extracted design system written to `Organization.designSystem` and an actionable next step offered, or a clear failure explanation and recovery options. Either way, the conversation ends with the user knowing exactly what is next.
```

- [ ] **Step 1:** Create the skill file at the exact path above.
- [ ] **Step 2:** Confirm that `packages/db/src/seed-skills.ts` globs `skills/**/*.skill.md` at `SKILLS_DIR = join(__dirname, "..", "..", "..", "skills")` — research confirmed this. No code change needed; the new file is picked up automatically.
- [ ] **Step 3:** Find the exact command that runs the skill seed on container start by grepping `packages/db/package.json` scripts and the portal-init `Dockerfile`/`docker-entrypoint.sh` for `seed-skills`. If the seed runs automatically during `portal-init`, a redeploy (or `docker compose up -d portal-init`) is enough. If it must be invoked manually, document the exact `pnpm --filter @dpf/db exec ...` command here and include it in the PR description.
- [ ] **Step 4:** Run the seed and confirm via `prisma studio` (or a focused query) that one new `SkillDefinition` with `skillId: "extract-brand-design-system"` exists and TWO `SkillAssignment` rows exist (one per coworker: `onboarding-coo`, `admin-assistant`).
- [ ] **Step 5:** Spot-check in Admin > Prompts or Admin > Skills UI that the new skill is listed and assigned to both coworkers. If the UI renders the `riskBand`, `capability`, and `allowedTools` correctly, the seeding worked.
- [ ] **Step 6:** Commit: `feat(brand): extract-brand-design-system skill for onboarding-coo + admin-assistant`

### Task 2.10b: Verify agent grants for `manage_branding` capability

Per memory `project_agent_grant_seeding_gap`: hardcoded coworkers historically had zero grants, so every tool call was silently denied. The skill file declares `capability: "manage_branding"` — both assigned coworkers must have that capability granted in seed data, otherwise the `extract_brand_design_system` tool will fail silently when the coworker tries to invoke it.

- [ ] **Step 1:** Grep `packages/db/src` and `apps/web/lib/tak/agent-grants.ts` for `manage_branding`. Confirm it exists as a capability and that `onboarding-coo` and `admin-assistant` are in its grant list.
- [ ] **Step 2:** If either coworker lacks the grant, add it in the seed file AND add an invariant guard per the pattern in memory `feedback_fix_seed_not_runtime` — a runtime check that throws (or logs a loud warning) if these specific coworker/capability combinations are missing.
- [ ] **Step 3:** Re-run seed; confirm grants are present. Run an end-to-end test that has `admin-assistant` invoke the new tool and assert no permission-denied error surfaces.
- [ ] **Step 4:** Commit (if grants were added): `fix(agent-grants): grant manage_branding to onboarding-coo and admin-assistant`

### Task 2.11: Agent panel renders brand-extraction progress

**Files:**
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx:156-194`

The panel already handles `orchestrator:*` events. Extend the switch to handle `brand:extract.progress` (push a generic status line into a new `jobStatus` state slot) and `brand:extract.complete` / `brand:extract.failed` (flip `isBusy` back to false and optionally show a one-line toast inside the panel).

- [ ] **Step 1:** Add failing component-level test if the panel has tests; otherwise extend the existing SSE handler unit test. Assert that on receiving `{ type: "brand:extract.progress", stage: "scraping", message: "Reading example.com", percent: 20 }`, the panel's `jobStatus` state becomes `"Reading example.com (20%)"`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Add the three case handlers to the switch in `AgentCoworkerPanel.tsx`. Render `jobStatus` below the existing "working (Ns)" line when present.
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Manual test: fire a dummy brand-extraction event via a test harness or by running the full flow locally. Confirm the panel reflects progress in real time.
- [ ] **Step 6:** Commit: `feat(brand): agent panel renders extraction progress events`

### Task 2.12: PR 2 verification

- [ ] **Step 1:** Run `pnpm --filter web typecheck` — passes.
- [ ] **Step 2:** Run `pnpm --filter web test` — all tests pass.
- [ ] **Step 3:** Run `pnpm --filter web build` — succeeds.
- [ ] **Step 4:** Manual E2E in the running portal: log in, open the coworker panel on `/admin`, send the message "Refresh our brand from acme.example.com". Confirm the coworker acknowledges, the panel shows progress stages, and after completion (a) `Organization.designSystem` is populated in Prisma studio, (b) a summary message appears in the thread, (c) no errors in browser console or server logs.
- [ ] **Step 5:** Manual fail-path test: send a message with a nonexistent URL. Confirm the coworker returns a plain-language failure explanation within ~30 seconds.
- [ ] **Step 6:** Open PR, title `feat(brand): extraction service + coworker skill (PR 2 of 3)`, fill template. In Test plan include all three `pnpm` checks plus the two manual scenarios above.

---

## PR 3 — Admin Branding UX + first-run coworker hand-off

**Scope:** Replace `/admin/branding` page content with a three-source extraction form + a preview-and-apply view. The form delegates extraction to the `admin-assistant` coworker via a thread message; the preview renders `Organization.designSystem` once populated; "Approve & apply" persists user-approved overrides and refreshes `BrandingConfig.tokens` via the shared mapper from Task 2.8b. **Additionally** (Task 3.4): when the bootstrap `SetupWizard` completes, the `onboarding-coo` proactively offers to extract the brand in the background — if the user accepts, extraction runs while they explore the tour, and a "brand is ready" notification with a deep link to `/admin/branding` fires on completion. This showcases the platform's core thesis (agent-as-work-conduit) on first run without blocking the wizard itself.

**Risk band:** Medium. UI change on the admin route that shows the current brand. Must preserve a "skip for now" escape so users who don't want to extract can still use the existing manual theme-preset path that `branding.ts` already supports.

**Requires:** PR 2 merged (for `extract_brand_design_system` tool, the Inngest function that writes `Organization.designSystem`, and `designSystemToThemeTokens`).

### Task 3.1: Three-source form component

**Files:**
- Create: `apps/web/components/storefront-admin/BrandExtractionForm.tsx`
- Test: `apps/web/components/storefront-admin/BrandExtractionForm.test.tsx`

Form with three optional source inputs (URL text, "Use connected codebase" checkbox defaulting to true when DPF repo is present, drag-drop upload zone), a "Let Claude fill gaps" toggle (defaulting to on), and a primary "Extract design system" button. Secondary "Skip for now" link. When submitted, the form does NOT call any API itself — it returns the collected sources via an `onExtract` callback.

- [ ] **Step 1:** Write failing render test: form shows three inputs, button is disabled when none provided, calling "Extract" with a URL invokes `onExtract({ url: "...", includeCodebase: true, uploads: [] })`.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement the component using existing shadcn primitives in `apps/web/components/ui/` (or the closest equivalent already in the repo — check `apps/web/components/storefront-admin/` for patterns).
- [ ] **Step 4:** Run — passes.
- [ ] **Step 5:** Commit: `feat(brand): three-source BrandExtractionForm component`

### Task 3.2: `/admin/branding` integrates the extraction form

**Files:**
- Modify: `apps/web/app/(shell)/admin/branding/page.tsx` (embed the new form at the top of the page, above the existing manual theme-preset controls)

When the user submits `BrandExtractionForm`, the page:
1. Ensures a coworker thread exists for the `admin-assistant` on the `/admin` contextKey.
2. Posts a synthetic user message to the thread: `"Extract our brand design system from: ${sourceSummary}."` via the existing `/api/agent/send` entry point.
3. Shows a live status strip above the form reflecting the coworker's progress (read from the thread's SSE stream). The strip subscribes for the duration of the active extraction and unmounts when `brand:extract.complete` or `brand:extract.failed` fires.
4. The existing manual theme-preset controls remain below the extraction form as the explicit "skip for now / do it by hand" escape hatch. No behavior change to that path.

- [ ] **Step 1:** Read `apps/web/app/(shell)/admin/branding/page.tsx` in full to map its current server-component structure, the data it loads, and how it composes client components.
- [ ] **Step 2:** Write a failing component test for the new integration: when user submits the BrandExtractionForm, `/api/agent/send` is called once with the correct threadId / content; the existing manual theme-preset form still renders and its save action still works.
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Implement. The coworker-thread resolution can reuse `getOrCreateThreadSnapshot` (cited in research as existing in `apps/web/lib/actions/agent-coworker.ts`). The contextKey for `admin-assistant` is whatever the existing `/admin` route currently uses — confirm by reading `agent-routing.ts` for the route's `contextKey` value and mirror it.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Commit: `feat(brand): admin/branding delegates extraction to admin-assistant`

### Task 3.3: Preview-and-approve screen

**Files:**
- Create: `apps/web/components/storefront-admin/BrandPreview.tsx`
- Create: `apps/web/lib/actions/apply-brand-design-system.ts` (server action)
- Test: `apps/web/lib/actions/apply-brand-design-system.test.ts`
- Modify: `apps/web/app/(shell)/admin/branding/page.tsx` to embed it

`BrandPreview.tsx` renders the current `Organization.designSystem` as palette swatches, type specimens, and logo preview. Shows per-field confidence indicators. Read-only in this PR (override UI is a follow-up).

`applyBrandDesignSystem(organizationId, overrides?)` server action re-reads `Organization.designSystem`, merges user-supplied overrides onto it (writing the result back to `Organization.designSystem.overrides`), and **re-runs `designSystemToThemeTokens` from Task 2.8b** to refresh `BrandingConfig.tokens`. Note that Task 2.8 already wrote `BrandingConfig.tokens` once at extraction time — this action re-does it when the user applies overrides, so the mapping stays in lockstep.

- [ ] **Step 1:** Write failing test for `BrandPreview.tsx`: component receives a `BrandDesignSystem` prop, renders color swatches with hex labels, renders typography scale entries, shows confidence percentages.
- [ ] **Step 2:** Run — fails.
- [ ] **Step 3:** Implement `BrandPreview.tsx`. Run — passes.
- [ ] **Step 4:** Commit: `feat(brand): BrandPreview component (read-only first cut)`
- [ ] **Step 5:** Write failing test for `applyBrandDesignSystem`: call with an org id + a minimal override (e.g., change `palette.primary`), assert `Organization.designSystem.overrides` is written, assert `BrandingConfig.tokens` is refreshed via the shared mapper, assert the mapping produces the expected token values.
- [ ] **Step 6:** Run — fails.
- [ ] **Step 7:** Implement `apply-brand-design-system.ts`. Reuse `designSystemToThemeTokens` from Task 2.8b — do not reimplement the mapping.
- [ ] **Step 8:** Run — passes.
- [ ] **Step 9:** Embed `BrandPreview` in `/admin/branding/page.tsx` with an "Approve & apply overrides" button that calls `applyBrandDesignSystem`.
- [ ] **Step 10:** Commit: `feat(brand): preview + apply overrides for extracted design system`

### Task 3.4: First-run coworker hand-off

**Goal:** After the user completes the bootstrap `SetupWizard`, the `onboarding-coo` posts the opening message of the admin tour, proactively offering to extract the brand. This is the platform's first demonstration that coworkers do real work in the background — the wow moment. No changes to the wizard's existing state machine; we only add a post-completion side-effect.

**Files:**
- Modify: `apps/web/components/storefront-admin/SetupWizard.tsx` — one call in `FinancialSetupStep`'s `onComplete` callback (or equivalent wizard-completion seam) that fires a "seed message" into the `onboarding-coo` thread.
- Create: `apps/web/lib/actions/seed-onboarding-brand-offer.ts` — server action that (a) ensures an `AgentThread` exists for `onboarding-coo` + current user, (b) inserts an initial assistant message offering extraction, (c) returns the threadId so the wizard can mark completion.
- Modify: `apps/web/components/agent/AgentCoworkerPanel.tsx` — when the SSE handler sees `brand:extract.complete` for this user, render a "View your new brand →" action button that deep-links to `/admin/branding`.

**Behavioral spec:**

The seed message is posted as an assistant-role `AgentMessage` with content like:

> Nice — your storefront is set up. Want me to build a full design system for you in the background? I'll pull colors, typography, and components from your website (and any logos you want to upload), and you can keep exploring while I work. Takes about a minute.
>
> Reply **"yes, do it"** with a URL, or **"skip"** if you'd rather set this up later.

When the user replies "yes, do it" (or equivalent), the normal skill-routing path should trigger the `extract-brand-design-system` skill — no new routing code required because the skill's `triggerPattern` already includes `brand|design system|extract brand|theme|refresh brand|analyze site`.

When extraction completes, the existing `brand:extract.complete` SSE event fires as it does from any other entry point. The `AgentCoworkerPanel` renders a contextual action button below the completion summary — this is the one bit of new UI.

- [ ] **Step 1:** Find the wizard-completion seam. `SetupWizard.tsx:482` has `FinancialSetupStep` with `onComplete={() => { window.location.href = "/storefront"; }}`. The natural hook is either in that callback (server-trigger before redirect) or in a `useEffect` on `/storefront` first paint. Choose the server-side path to avoid a race where the user lands on the tour before the thread is seeded.
- [ ] **Step 2:** Write failing test for `seed-onboarding-brand-offer.ts`: given a userId, asserts (a) `AgentThread` is created/updated with `contextKey` matching the `onboarding-coo` route, (b) an assistant-role `AgentMessage` is inserted with the offer copy, (c) duplicate invocations do NOT re-seed (idempotency check — use `@@unique([userId, contextKey])` on `AgentThread` per schema research).
- [ ] **Step 3:** Run — fails.
- [ ] **Step 4:** Implement the server action. Invoke it from the `FinancialSetupStep` completion callback as a fire-and-forget `await` before `window.location.href` — failures log but don't block the redirect.
- [ ] **Step 5:** Run — passes.
- [ ] **Step 6:** Write failing test for the `AgentCoworkerPanel` SSE handler: on `brand:extract.complete`, the panel renders a button with text "View your new brand →" and an href of `/admin/branding`.
- [ ] **Step 7:** Run — fails.
- [ ] **Step 8:** Extend the existing switch (Task 2.11) to surface the action button. Render it as part of the completion summary, not as a toast — it should persist in the conversation so a user who leaves the panel can come back and still click through.
- [ ] **Step 9:** Run — passes.
- [ ] **Step 10:** Manual E2E: fresh-install portal, run the bootstrap wizard to completion. Confirm (a) landing on `/storefront` after wizard shows the onboarding-coo with the offer message as the first thread message; (b) replying with a URL triggers extraction; (c) progress renders in the panel; (d) on completion the "View your new brand →" button appears and deep-links correctly.
- [ ] **Step 11:** Commit: `feat(brand): onboarding-coo offers brand extraction on wizard completion`

### Task 3.5: PR 3 verification

- [ ] **Step 1:** `pnpm --filter web typecheck` + `pnpm --filter web test` + `pnpm --filter web build` all pass.
- [ ] **Step 2:** Manual E2E: fresh-install the portal, run through setup. At the brand extraction step, provide `https://anthropic.com` as the URL, leave "Use connected codebase" on. Confirm:
   - Extraction starts without blocking the wizard.
   - The status strip shows at least three progress stages.
   - Within 2 minutes, a success message appears in the coworker panel.
   - `/admin/branding` shows the extracted palette, typography, and components.
   - Clicking "Approve & apply" updates `BrandingConfig.tokens`.
   - The storefront homepage reflects the applied brand.
- [ ] **Step 3:** Manual edge case: provide an invalid URL. Wizard proceeds, coworker reports the failure, `/admin/branding` offers a retry.
- [ ] **Step 4:** Open PR, title `feat(brand): wizard + preview (PR 3 of 3)`. Test plan includes both manual scenarios.

---

## Follow-Ups (explicitly out of scope for this plan)

1. **Retire the design-intelligence CSVs.** Once PR 3 is in production and at least one real org has used the extractor, remove the CSV fallback path from `generateDesignSystem` and delete the data files.
2. **Handoff-bundle import from hosted Claude Design.** New route `/api/brand/import-handoff` accepting the zip format Anthropic's Claude Design produces.
3. **Visual Design phase for Build Studio.** New phase between Ideate and Plan that uses the substrate to generate HTML/React mockups per feature. Covered under a separate plan after this lands.
4. **Override UI in BrandPreview.** Per-field edits that write to `Organization.designSystem.overrides` and survive re-extraction.
5. **Design tokens → Tailwind config automation.** Optionally emit a `tailwind.config.ts` fragment from the substrate so a customer fork of DPF can drop it in verbatim.
6. **Figma/Sketch ingestion.** Richer upload adapter for design-file formats.
7. **Inline extraction step inside the bootstrap `SetupWizard`.** PR 3 Task 3.4 delivers the first-run wow moment via a post-wizard coworker hand-off (agent does the work in the background while the user explores). A more integrated variant — an actual brand-extraction step rendered inside the wizard state machine between preview and financial setup — would let the user see partial results before the tour starts. Larger UX change, warrants its own plan once the hand-off pattern is proven.
8. **Non-platform-org codebase paths.** When DPF supports orgs with their own connected repos (beyond the platform itself), thread their repo checkout path into the MCP tool's codebase source. Requires org-connected-repo infrastructure that is not in place today.

---

## Verification Summary

Per-PR verification is in each PR's final task. Global gates (all must pass before merging any PR):

- `pnpm --filter web typecheck`
- `pnpm --filter web test` (all tests, including the new ones)
- `pnpm --filter web build` (production build gate — catches TypeScript errors that only surface in the Next.js production compile, per `CLAUDE.md`)
- Manual E2E against a running portal per the scenarios in each PR's verification task

## Known Risks

1. **Cross-process progress events.** Inngest workers may not share memory with the HTTP server. Mitigated by Task 2.7 (persist to `TaskRun.progressPayload` + SSE replay on reconnect). If that doesn't hold up under load, the fallback is polling — the panel can poll `TaskRun.progressPayload` every 2 seconds as a last resort.
2. **Codebase adapter parsing fragility.** Tailwind configs have diverse shapes. The regex-based parser will miss non-standard configs — mitigated by the synthesizer filling gaps and flagging low confidence. Not a blocker for PR 2 merging.
3. **Codebase adapter cross-contamination for non-platform orgs.** If an org without a connected repo triggers `includeCodebase: true`, naively reading `/app` would inject DPF's own Tailwind config into their extraction. Mitigated in Task 2.3 and 2.9: the adapter returns empty + a gap when no valid path is supplied, and the MCP tool only passes `codebasePath: "/app"` for the platform org itself.
4. **Opus 4.7 synthesis cost.** Every extraction invokes Opus 4.7 for gap-filling. Mitigated by running sync only when `gaps.length > 0`. Heavy usage will show up in the existing AI usage dashboard.
5. **Agent-grants gap.** Per memory `project_agent_grant_seeding_gap`, hardcoded coworkers have historically had zero capability grants, causing silent tool-call denials. Mitigated by Task 2.10b (grep for `manage_branding` grants on both coworkers, add them + an invariant guard if missing) before shipping PR 2.
6. **Concurrent extraction race.** Two extraction jobs for the same org racing to write `Organization.designSystem`. Mitigated by AD-7: Inngest concurrency key on `organizationId` (limit 1) plus the MCP tool handler's active-TaskRun pre-check.
7. **Seed trigger opacity.** The skill seed is globbed from `skills/**/*.skill.md` but the exact invocation (auto on portal-init vs manual command) must be pinned in Task 2.10 Step 3 before shipping; otherwise new skills could go live in code but absent from the DB.
