# Assurance Ledger Phase 1A BOM Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a CycloneDX-compatible BOM for the DPF web workspace, expose read-only Build Studio and Product Registry supply-chain state, and keep vulnerability scanning blocked until a scanner has passed Tool Evaluation.

**Architecture:** This slice implements `BI-ASSURANCE-P1-01` only. It adds queryable BOM and assurance-run rows, a first-party lockfile-based CycloneDX generator, a background Inngest job, and read-only UI surfaces. It does not add `AssuranceFinding` or any vulnerability scanner adapter; `BI-ASSURANCE-P1-02` starts after a scanner is evaluated and approved.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, PostgreSQL, Inngest, Vitest, existing `apps/web/lib/assurance/*` contracts from Phase 0, DPF theme variables.

---

## 1. Live Records

| Record | Status at plan time | Role |
|--------|---------------------|------|
| `EP-ASSURANCE-LEDGER` | open | Parent epic for the Assurance Ledger spec. |
| `BI-ASSURANCE-P1-01` | open | This plan's implementation target: CycloneDX BOM persistence for Build Studio web workspace. |
| `BI-ASSURANCE-P1-02` | open | Future read-only vulnerability adapter and Build Studio Assurance Gate. Blocked until Tool Evaluation approves one scanner. |
| `BI-REFACTOR-CC46703A` | open | Phase 2 hard gate for finding-substrate unification. |

Verified current repo state:

- Phase 0 docs PR #933 is merged.
- Phase 0 implementation PR #940 is merged.
- `packages/db/data/approved_tools_registry.json` currently has `"tools": []`.
- No existing `apps/web/lib/assurance/bom-*` implementation exists.
- Existing `apps/web/lib/integrate/manifest-generator.ts` is a codebase manifest helper, not a standards-compatible persisted BOM ledger.

## 2. Scope Decision

Phase 1 from the spec has two backlog items. Execute them as two separate PRs.

This PR:

- Adds `AssuranceRun`, `BomDocument`, `BomComponent`, and `BomComponentOccurrence`.
- Generates CycloneDX JSON from pinned workspace dependencies and active AI model profiles.
- Persists raw CycloneDX JSON plus normalized component/occurrence rows.
- Shows honest read-only state in Build Studio and Product Registry.
- Exports the latest CycloneDX JSON.

Not this PR:

- No `AssuranceFinding` model.
- No Grype, OSV, Syft, Trivy, Black Duck, or other external scanner.
- No automatic remediation.
- No release-blocking vulnerability policy.

Reason: external scanner adoption is governed by AGENTS.md section 9 and the Tool Evaluation Pipeline. The approved registry is empty, so a scanner-backed gate would be a false capability claim.

## 3. File Structure

| File | Responsibility |
|------|----------------|
| Modify `packages/db/prisma/schema.prisma` | Add BOM and assurance-run models plus relations to `FeatureBuild`, `DigitalProduct`, `ToolExecution`, and `ToolExecutionReceipt`. |
| Add `packages/db/prisma/migrations/<timestamp>_assurance_bom_persistence/migration.sql` | Create queryable ledger tables and indexes. |
| Add `packages/db/src/assurance-schema-contract.test.ts` | Guard schema shape, especially "no AssuranceFinding in Phase 1A". |
| Add `apps/web/lib/assurance/bom-types.ts` | CycloneDX-facing and normalized BOM TypeScript types. |
| Add `apps/web/lib/assurance/component-key.ts` | Stable component key and purl helpers. |
| Add `apps/web/lib/assurance/pnpm-lock-parser.ts` | Small first-party parser for the lockfile importers needed by this repo. |
| Add `apps/web/lib/assurance/cyclonedx-generator.ts` | Generate CycloneDX 1.6 JSON and normalized components from package metadata, lockfile text, and model profiles. |
| Add `apps/web/lib/assurance/bom-persistence.ts` | Persist document, components, occurrences, run state, and receipt linkage. |
| Add `apps/web/lib/assurance/bom-read.ts` | Read latest BOM summary and component rows for Build Studio/Product UI. |
| Add `apps/web/lib/assurance/bom-export.ts` | Return the latest raw CycloneDX JSON for download/API response. |
| Add `apps/web/lib/assurance/bom-job.ts` | Orchestrate generation and persistence from a build context. |
| Add `apps/web/lib/queue/functions/assurance-bom.ts` | Background Inngest worker for `assurance/bom.generate`. |
| Modify `apps/web/lib/queue/functions/index.ts` | Register the worker. |
| Modify `apps/web/lib/queue/inngest-client.ts` | Add typed event payload. |
| Add `apps/web/lib/assurance/bom-trigger.ts` | Queue the background job from server actions. |
| Add `apps/web/lib/actions/assurance.ts` | Server action for manually requesting BOM generation. |
| Add `apps/web/components/build/BuildAssuranceGateCard.tsx` | Read-only Build Studio gate card. |
| Add `apps/web/components/build/BuildAssuranceGateCard.test.tsx` | Theme-safe UI contract tests for card states. |
| Modify `apps/web/components/build/BuildStudio.tsx` | Load and render the gate card without blocking the page. |
| Modify `apps/web/components/product/ProductTabNav.tsx` | Add `Supply Chain` under Operate. |
| Modify `apps/web/components/product/ProductTabNav.test.tsx` | Verify the new sub-route is grouped under Operate. |
| Add `apps/web/components/product/ProductSupplyChainPanel.tsx` | Dense component table and latest BOM summary. |
| Add `apps/web/components/product/ProductSupplyChainPanel.test.tsx` | Empty, stale, and populated rendering tests. |
| Add `apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx` | Product supply-chain route. |
| Add `apps/web/app/api/portfolio/product/[id]/supply-chain/bom/route.ts` | CycloneDX export endpoint. |

## 4. Data Model

Add these models after `ArtifactReceiptUsage` and before `Sandbox`.

```prisma
model AssuranceRun {
  id                     String                @id @default(cuid())
  runId                  String                @unique
  scopeType              String
  scopeId                String
  policyKey              String?
  adapterKey             String
  adapterVersion         String
  status                 String                @default("running")
  summary                Json                  @default("{}")
  startedAt              DateTime              @default(now())
  completedAt            DateTime?
  buildId                String?
  digitalProductId       String?
  releaseBundleId        String?
  toolExecutionId        String?               @unique
  toolExecutionReceiptId String?               @unique
  createdAt              DateTime              @default(now())
  updatedAt              DateTime              @updatedAt
  build                  FeatureBuild?         @relation(fields: [buildId], references: [buildId], onDelete: SetNull)
  digitalProduct         DigitalProduct?       @relation(fields: [digitalProductId], references: [id], onDelete: SetNull)
  releaseBundle          ReleaseBundle?        @relation(fields: [releaseBundleId], references: [id], onDelete: SetNull)
  toolExecution          ToolExecution?        @relation(fields: [toolExecutionId], references: [id], onDelete: SetNull)
  toolExecutionReceipt   ToolExecutionReceipt? @relation(fields: [toolExecutionReceiptId], references: [id], onDelete: SetNull)
  bomDocuments           BomDocument[]

  @@index([scopeType, scopeId, startedAt(sort: Desc)])
  @@index([buildId, startedAt(sort: Desc)])
  @@index([digitalProductId, startedAt(sort: Desc)])
  @@index([adapterKey, status])
}

model BomDocument {
  id               String                   @id @default(cuid())
  documentId       String                   @unique
  format           String
  formatVersion    String
  serialNumber     String?
  version          Int
  digest           String
  sourceKind       String
  sourceDigest     String
  componentCount   Int
  raw              Json
  status           String                   @default("current")
  generatedAt      DateTime                 @default(now())
  createdAt        DateTime                 @default(now())
  updatedAt        DateTime                 @updatedAt
  buildId          String?
  digitalProductId String?
  assuranceRunId   String?
  artifactRevisionId String?
  build            FeatureBuild?            @relation(fields: [buildId], references: [buildId], onDelete: SetNull)
  digitalProduct   DigitalProduct?          @relation(fields: [digitalProductId], references: [id], onDelete: SetNull)
  assuranceRun     AssuranceRun?            @relation(fields: [assuranceRunId], references: [id], onDelete: SetNull)
  artifactRevision BuildArtifactRevision?   @relation(fields: [artifactRevisionId], references: [id], onDelete: SetNull)
  occurrences      BomComponentOccurrence[]

  @@index([buildId, generatedAt(sort: Desc)])
  @@index([digitalProductId, generatedAt(sort: Desc)])
  @@index([digest])
  @@index([status])
}

model BomComponent {
  id                String                   @id @default(cuid())
  componentKey      String                   @unique
  componentType     String
  name              String
  version           String?
  packageUrl        String?
  supplierName      String?
  licenseExpression String?
  ecosystem         String?
  scope             String?
  metadata          Json                     @default("{}")
  firstSeenAt       DateTime                 @default(now())
  lastSeenAt        DateTime                 @default(now())
  occurrences       BomComponentOccurrence[]

  @@index([componentType, name])
  @@index([packageUrl])
  @@index([ecosystem])
}

model BomComponentOccurrence {
  id            String       @id @default(cuid())
  occurrenceKey String       @unique
  bomDocumentId String
  componentId   String
  workspaceName String?
  workspacePath String?
  dependencyKind String?
  direct        Boolean      @default(false)
  evidence      Json         @default("{}")
  createdAt     DateTime     @default(now())
  bomDocument   BomDocument  @relation(fields: [bomDocumentId], references: [id], onDelete: Cascade)
  component     BomComponent @relation(fields: [componentId], references: [id], onDelete: Cascade)

  @@index([bomDocumentId])
  @@index([componentId])
  @@index([workspacePath])
  @@index([dependencyKind])
}
```

Also add reverse relation fields:

```prisma
model DigitalProduct {
  assuranceRuns AssuranceRun[]
  bomDocuments  BomDocument[]
}

model FeatureBuild {
  assuranceRuns AssuranceRun[]
  bomDocuments  BomDocument[]
}

model ToolExecution {
  assuranceRun AssuranceRun?
}

model ToolExecutionReceipt {
  assuranceRun AssuranceRun?
}

model BuildArtifactRevision {
  bomDocuments BomDocument[]
}

model ReleaseBundle {
  assuranceRuns AssuranceRun[]
}
```

Do not add `AssuranceFinding` in this slice. That belongs to `BI-ASSURANCE-P1-02` and must carry the finding-substrate decision forward.

## 5. Implementation Tasks

### Task 1: Branch Guard, Live Overlap, and Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md`
- Read: `docs/superpowers/plans/2026-05-22-assurance-ledger-phase-1a-bom-persistence.md`
- Read: `apps/web/lib/assurance/*`
- Read: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Create implementation worktree**

Run from `D:\DPF`:

```powershell
git fetch origin
git worktree add D:\DPF\.worktrees\assurance-ledger-phase-1a -b feat/assurance-ledger-phase-1a origin/main
Set-Location D:\DPF\.worktrees\assurance-ledger-phase-1a
.\scripts\sync-mcp-worktrees.ps1
```

Expected: worktree is on `feat/assurance-ledger-phase-1a`, not `main`.

- [ ] **Step 2: Confirm branch guard**

Run:

```powershell
git status --short --branch
git branch --show-current
```

Expected:

```text
## feat/assurance-ledger-phase-1a...origin/main
feat/assurance-ledger-phase-1a
```

- [ ] **Step 3: Live backlog and docs sweep**

Use MCP first:

```text
list_backlog_items: epicId=EP-ASSURANCE-LEDGER
get_backlog_item: BI-ASSURANCE-P1-01
get_backlog_item: BI-ASSURANCE-P1-02
get_backlog_item: BI-REFACTOR-CC46703A
search_specs_and_plans: query="Assurance Ledger" epicId=EP-ASSURANCE-LEDGER
```

Expected:

- `BI-ASSURANCE-P1-01` is open and is the implementation target.
- `BI-ASSURANCE-P1-02` remains open and is not implemented in this branch.
- `BI-REFACTOR-CC46703A` remains open.

- [ ] **Step 4: Source overlap sweep**

Run:

```powershell
git log --oneline origin/main --since=2026-05-21 -- packages/db/prisma/schema.prisma apps/web/lib/assurance apps/web/components/build apps/web/components/product "apps/web/app/(shell)/portfolio/product"
rg -n "model (AssuranceRun|BomDocument|BomComponent|BomComponentOccurrence|AssuranceFinding)" packages/db/prisma/schema.prisma
rg -n "BuildAssurance|Supply Chain|BomDocument|CycloneDX" apps/web packages/db docs -S
```

Expected:

- Phase 0 assurance library exists.
- No BOM persistence models exist yet.
- No `AssuranceFinding` model exists yet.

- [ ] **Step 5: Baseline tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/finding-key.test.ts lib/assurance/diff-security-adapter.test.ts lib/assurance/readiness.test.ts
pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
```

Expected: all pass before writing code.

### Task 2: Add Schema Contract Test and Prisma Models

**Files:**
- Create: `packages/db/src/assurance-schema-contract.test.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_assurance_bom_persistence/migration.sql`

- [ ] **Step 1: Write failing schema contract**

Create `packages/db/src/assurance-schema-contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const currentFile = fileURLToPath(import.meta.url);
const schema = readFileSync(join(dirname(currentFile), "../prisma/schema.prisma"), "utf8");

function modelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\\\{[\\\\s\\\\S]*?\\\\n\\\\}`, "m"));
  return match?.[0] ?? "";
}

describe("Assurance BOM schema", () => {
  it("adds assurance run and BOM persistence models", () => {
    expect(modelBlock("AssuranceRun")).toContain("toolExecutionId");
    expect(modelBlock("BomDocument")).toContain("raw");
    expect(modelBlock("BomComponent")).toContain("componentKey");
    expect(modelBlock("BomComponentOccurrence")).toContain("occurrenceKey");
  });

  it("does not add AssuranceFinding in Phase 1A", () => {
    expect(modelBlock("AssuranceFinding")).toBe("");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/assurance-schema-contract.test.ts
```

Expected: fails because the four models do not exist.

- [ ] **Step 3: Add the Prisma models**

Edit `packages/db/prisma/schema.prisma` using the data model in section 4. Add reverse relation fields to `DigitalProduct`, `FeatureBuild`, `ToolExecution`, `ToolExecutionReceipt`, `BuildArtifactRevision`, and `ReleaseBundle`.

- [ ] **Step 4: Create migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name assurance_bom_persistence --schema prisma/schema.prisma
```

Expected: a new migration folder is created and Prisma Client regenerates.

- [ ] **Step 5: Verify schema contract and validation pass**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/assurance-schema-contract.test.ts
pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma
```

Expected: both pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/assurance-schema-contract.test.ts
git commit -s -m "feat(assurance): add bom persistence schema"
```

### Task 3: Add Component Identity and CycloneDX Types

**Files:**
- Create: `apps/web/lib/assurance/bom-types.ts`
- Create: `apps/web/lib/assurance/component-key.ts`
- Create: `apps/web/lib/assurance/component-key.test.ts`

- [ ] **Step 1: Write failing component key tests**

Create `apps/web/lib/assurance/component-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createComponentKey, createNpmPackageUrl } from "./component-key";

describe("createComponentKey", () => {
  it("creates stable keys for package components", () => {
    const input = {
      componentType: "library",
      ecosystem: "npm",
      name: "@dpf/db",
      version: "0.1.0",
      packageUrl: "pkg:npm/%40dpf/db@0.1.0",
    } as const;

    expect(createComponentKey(input)).toBe(createComponentKey(input));
    expect(createComponentKey(input)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("creates different keys for model components", () => {
    const left = createComponentKey({
      componentType: "model",
      ecosystem: "ai-model",
      name: "gpt-5.4",
      version: "2026-05",
      packageUrl: null,
    });
    const right = createComponentKey({
      componentType: "library",
      ecosystem: "npm",
      name: "gpt-5.4",
      version: "2026-05",
      packageUrl: null,
    });

    expect(left).not.toBe(right);
  });
});

describe("createNpmPackageUrl", () => {
  it("encodes scoped npm package names", () => {
    expect(createNpmPackageUrl("@dpf/db", "0.1.0")).toBe("pkg:npm/%40dpf/db@0.1.0");
  });

  it("encodes unscoped npm package names", () => {
    expect(createNpmPackageUrl("next", "16.2.6")).toBe("pkg:npm/next@16.2.6");
  });
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/component-key.test.ts
```

Expected: fails because `component-key.ts` does not exist.

- [ ] **Step 3: Add BOM types**

Create `apps/web/lib/assurance/bom-types.ts`:

```ts
export const BOM_COMPONENT_TYPES = ["library", "framework", "application", "container", "model"] as const;
export type BomComponentType = (typeof BOM_COMPONENT_TYPES)[number];

export interface NormalizedBomComponent {
  componentKey: string;
  componentType: BomComponentType;
  name: string;
  version: string | null;
  packageUrl: string | null;
  supplierName: string | null;
  licenseExpression: string | null;
  ecosystem: string | null;
  scope: string | null;
  metadata: Record<string, unknown>;
}

export interface NormalizedBomOccurrence {
  occurrenceKey: string;
  componentKey: string;
  workspaceName: string | null;
  workspacePath: string | null;
  dependencyKind: string | null;
  direct: boolean;
  evidence: Record<string, unknown>;
}

export interface CycloneDxDocument {
  bomFormat: "CycloneDX";
  specVersion: "1.6";
  serialNumber: string;
  version: number;
  metadata: Record<string, unknown>;
  components: Array<Record<string, unknown>>;
  dependencies: Array<Record<string, unknown>>;
}

export interface GeneratedBom {
  cyclonedx: CycloneDxDocument;
  components: NormalizedBomComponent[];
  occurrences: NormalizedBomOccurrence[];
  sourceDigest: string;
  documentDigest: string;
}
```

- [ ] **Step 4: Implement component key helpers**

Create `apps/web/lib/assurance/component-key.ts`:

```ts
import { createHash } from "node:crypto";
import type { BomComponentType } from "./bom-types";

export interface ComponentKeyInput {
  componentType: BomComponentType;
  ecosystem: string | null;
  name: string;
  version: string | null;
  packageUrl: string | null;
}

export function createComponentKey(input: ComponentKeyInput): string {
  return createHash("sha256")
    .update([
      input.componentType,
      input.ecosystem ?? "",
      input.name.trim().toLowerCase(),
      input.version ?? "",
      input.packageUrl ?? "",
    ].join("::"))
    .digest("hex")
    .slice(0, 24);
}

export function createNpmPackageUrl(name: string, version: string): string {
  const encodedName = name.startsWith("@") ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${version}`;
}
```

- [ ] **Step 5: Verify tests pass**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/component-key.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/assurance/bom-types.ts apps/web/lib/assurance/component-key.ts apps/web/lib/assurance/component-key.test.ts
git commit -s -m "feat(assurance): add bom component identity"
```

### Task 4: Generate a CycloneDX BOM from Repo Inputs

**Files:**
- Create: `apps/web/lib/assurance/pnpm-lock-parser.ts`
- Create: `apps/web/lib/assurance/pnpm-lock-parser.test.ts`
- Create: `apps/web/lib/assurance/cyclonedx-generator.ts`
- Create: `apps/web/lib/assurance/cyclonedx-generator.test.ts`

- [ ] **Step 1: Write failing lock parser tests**

Create `apps/web/lib/assurance/pnpm-lock-parser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseImporterDependencies } from "./pnpm-lock-parser";

const lockText = `
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      next:
        specifier: ^16.2.6
        version: 16.2.6(react@19.2.6)
      '@dpf/db':
        specifier: workspace:*
        version: link:../../packages/db
    devDependencies:
      vitest:
        specifier: ^4.1.5
        version: 4.1.5
`;

describe("parseImporterDependencies", () => {
  it("extracts production dependencies for a workspace importer", () => {
    expect(parseImporterDependencies(lockText, "apps/web")).toEqual([
      {
        name: "next",
        specifier: "^16.2.6",
        resolvedVersion: "16.2.6",
        dependencyKind: "dependencies",
      },
      {
        name: "@dpf/db",
        specifier: "workspace:*",
        resolvedVersion: "workspace:*",
        dependencyKind: "dependencies",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the failing parser test**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/pnpm-lock-parser.test.ts
```

Expected: fails because `pnpm-lock-parser.ts` does not exist.

- [ ] **Step 3: Implement the parser**

Create `apps/web/lib/assurance/pnpm-lock-parser.ts`:

```ts
export interface PnpmImporterDependency {
  name: string;
  specifier: string;
  resolvedVersion: string;
  dependencyKind: "dependencies" | "devDependencies" | "optionalDependencies";
}

function normalizeVersion(raw: string, specifier: string): string {
  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed.startsWith("link:") || trimmed.startsWith("workspace:")) return specifier;
  return trimmed.split("(")[0] ?? trimmed;
}

export function parseImporterDependencies(lockText: string, importerPath: string): PnpmImporterDependency[] {
  const lines = lockText.replace(/\r\n/g, "\n").split("\n");
  const importerHeader = `  ${importerPath}:`;
  const start = lines.findIndex((line) => line === importerHeader);
  if (start < 0) return [];

  const result: PnpmImporterDependency[] = [];
  let currentKind: PnpmImporterDependency["dependencyKind"] | null = null;
  let currentName: string | null = null;
  let currentSpecifier: string | null = null;

  for (let index = start + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (/^  \S/.test(line)) break;
    const kindMatch = line.match(/^    (dependencies|devDependencies|optionalDependencies):$/);
    if (kindMatch) {
      currentKind = kindMatch[1] as PnpmImporterDependency["dependencyKind"];
      currentName = null;
      currentSpecifier = null;
      continue;
    }
    if (!currentKind) continue;

    const nameMatch = line.match(/^      (.+):$/);
    if (nameMatch) {
      currentName = nameMatch[1]!.replace(/^['"]|['"]$/g, "");
      currentSpecifier = null;
      continue;
    }

    const specifierMatch = line.match(/^        specifier: (.+)$/);
    if (specifierMatch) {
      currentSpecifier = specifierMatch[1]!.trim().replace(/^['"]|['"]$/g, "");
      continue;
    }

    const versionMatch = line.match(/^        version: (.+)$/);
    if (versionMatch && currentName && currentSpecifier && currentKind === "dependencies") {
      result.push({
        name: currentName,
        specifier: currentSpecifier,
        resolvedVersion: normalizeVersion(versionMatch[1]!, currentSpecifier),
        dependencyKind: currentKind,
      });
    }
  }

  return result;
}
```

- [ ] **Step 4: Verify parser test passes**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/pnpm-lock-parser.test.ts
```

Expected: pass.

- [ ] **Step 5: Write failing CycloneDX generator tests**

Create `apps/web/lib/assurance/cyclonedx-generator.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateCycloneDxBom } from "./cyclonedx-generator";

const packageJson = JSON.stringify({
  name: "web",
  version: "0.1.0",
});

const lockText = `
lockfileVersion: '9.0'
importers:
  apps/web:
    dependencies:
      next:
        specifier: ^16.2.6
        version: 16.2.6(react@19.2.6)
      '@dpf/db':
        specifier: workspace:*
        version: link:../../packages/db
`;

describe("generateCycloneDxBom", () => {
  it("creates CycloneDX JSON plus normalized package and model components", () => {
    const result = generateCycloneDxBom({
      workspacePath: "apps/web",
      packageJson,
      lockText,
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      gitRef: "abc123",
      modelProfiles: [
        { providerId: "openai", modelId: "gpt-5.4", modelStatus: "active" },
      ],
    });

    expect(result.cyclonedx.bomFormat).toBe("CycloneDX");
    expect(result.cyclonedx.specVersion).toBe("1.6");
    expect(result.components.map((component) => component.name)).toEqual([
      "next",
      "@dpf/db",
      "gpt-5.4",
    ]);
    expect(result.components.find((component) => component.name === "gpt-5.4")).toMatchObject({
      componentType: "model",
      ecosystem: "ai-model",
      supplierName: "openai",
    });
    expect(result.documentDigest).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 6: Run the failing generator test**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/cyclonedx-generator.test.ts
```

Expected: fails because `cyclonedx-generator.ts` does not exist.

- [ ] **Step 7: Implement the generator**

Create `apps/web/lib/assurance/cyclonedx-generator.ts`:

```ts
import { createHash, randomUUID } from "node:crypto";
import type { CycloneDxDocument, GeneratedBom, NormalizedBomComponent, NormalizedBomOccurrence } from "./bom-types";
import { createComponentKey, createNpmPackageUrl } from "./component-key";
import { parseImporterDependencies } from "./pnpm-lock-parser";

export interface BomModelProfileInput {
  providerId: string;
  modelId: string;
  modelStatus?: string | null;
}

export interface GenerateCycloneDxBomInput {
  workspacePath: string;
  packageJson: string;
  lockText: string;
  generatedAt: Date;
  gitRef: string;
  modelProfiles: BomModelProfileInput[];
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function packageComponent(name: string, version: string): NormalizedBomComponent {
  const packageUrl = version.startsWith("workspace:") ? null : createNpmPackageUrl(name, version);
  const componentType = name === "next" || name.startsWith("@dpf/") ? "framework" : "library";
  return {
    componentKey: createComponentKey({ componentType, ecosystem: "npm", name, version, packageUrl }),
    componentType,
    name,
    version,
    packageUrl,
    supplierName: null,
    licenseExpression: null,
    ecosystem: "npm",
    scope: "required",
    metadata: {},
  };
}

function modelComponent(profile: BomModelProfileInput): NormalizedBomComponent {
  return {
    componentKey: createComponentKey({
      componentType: "model",
      ecosystem: "ai-model",
      name: profile.modelId,
      version: profile.modelStatus ?? null,
      packageUrl: null,
    }),
    componentType: "model",
    name: profile.modelId,
    version: profile.modelStatus ?? null,
    packageUrl: null,
    supplierName: profile.providerId,
    licenseExpression: null,
    ecosystem: "ai-model",
    scope: "runtime",
    metadata: { providerId: profile.providerId },
  };
}

export function generateCycloneDxBom(input: GenerateCycloneDxBomInput): GeneratedBom {
  const pkg = JSON.parse(input.packageJson) as { name?: string; version?: string };
  const deps = parseImporterDependencies(input.lockText, input.workspacePath);
  const components = [
    ...deps.map((dep) => packageComponent(dep.name, dep.resolvedVersion)),
    ...input.modelProfiles.map(modelComponent),
  ];
  const occurrences: NormalizedBomOccurrence[] = components.map((component) => ({
    occurrenceKey: createHash("sha256")
      .update([component.componentKey, input.workspacePath, component.scope ?? ""].join("::"))
      .digest("hex")
      .slice(0, 24),
    componentKey: component.componentKey,
    workspaceName: pkg.name ?? "web",
    workspacePath: input.workspacePath,
    dependencyKind: component.ecosystem === "npm" ? "dependencies" : "runtime-model",
    direct: true,
    evidence: { gitRef: input.gitRef },
  }));
  const cyclonedx: CycloneDxDocument = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: input.generatedAt.toISOString(),
      component: { type: "application", name: pkg.name ?? "web", version: pkg.version ?? "0.0.0" },
      properties: [{ name: "dpf:gitRef", value: input.gitRef }],
    },
    components: components.map((component) => ({
      type: component.componentType === "model" ? "machine-learning-model" : "library",
      name: component.name,
      version: component.version ?? undefined,
      purl: component.packageUrl ?? undefined,
      supplier: component.supplierName ? { name: component.supplierName } : undefined,
    })),
    dependencies: components.map((component) => ({ ref: component.packageUrl ?? component.componentKey })),
  };

  return {
    cyclonedx,
    components,
    occurrences,
    sourceDigest: sha256({ lockText: input.lockText, packageJson: input.packageJson, modelProfiles: input.modelProfiles }),
    documentDigest: sha256(cyclonedx),
  };
}
```

- [ ] **Step 8: Verify generator tests pass**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/pnpm-lock-parser.test.ts lib/assurance/cyclonedx-generator.test.ts
```

Expected: pass.

- [ ] **Step 9: Commit**

Run:

```powershell
git add apps/web/lib/assurance/pnpm-lock-parser.ts apps/web/lib/assurance/pnpm-lock-parser.test.ts apps/web/lib/assurance/cyclonedx-generator.ts apps/web/lib/assurance/cyclonedx-generator.test.ts
git commit -s -m "feat(assurance): generate cyclonedx bom"
```

### Task 5: Persist BOM Documents and Assurance Runs

**Files:**
- Create: `apps/web/lib/assurance/bom-persistence.ts`
- Create: `apps/web/lib/assurance/bom-persistence.test.ts`

- [ ] **Step 1: Write failing persistence test**

Create `apps/web/lib/assurance/bom-persistence.test.ts` using a fake DB that captures method calls. The important behavior is that components are upserted by `componentKey`, the document stores raw CycloneDX JSON and digest, and no finding rows are touched.

```ts
import { describe, expect, it, vi } from "vitest";
import { persistGeneratedBom } from "./bom-persistence";
import type { GeneratedBom } from "./bom-types";

const generatedBom: GeneratedBom = {
  cyclonedx: {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:test",
    version: 1,
    metadata: {},
    components: [],
    dependencies: [],
  },
  components: [
    {
      componentKey: "component-1",
      componentType: "library",
      name: "next",
      version: "16.2.6",
      packageUrl: "pkg:npm/next@16.2.6",
      supplierName: null,
      licenseExpression: null,
      ecosystem: "npm",
      scope: "required",
      metadata: {},
    },
  ],
  occurrences: [
    {
      occurrenceKey: "occurrence-1",
      componentKey: "component-1",
      workspaceName: "web",
      workspacePath: "apps/web",
      dependencyKind: "dependencies",
      direct: true,
      evidence: {},
    },
  ],
  sourceDigest: "source-digest",
  documentDigest: "document-digest",
};

describe("persistGeneratedBom", () => {
  it("persists document, components, and occurrences through stable keys", async () => {
    const db = {
      bomComponent: {
        upsert: vi.fn(async () => ({ id: "db-component-1", componentKey: "component-1" })),
      },
      bomDocument: {
        create: vi.fn(async () => ({ id: "db-document-1", documentId: "bom_document-digest" })),
      },
      bomComponentOccurrence: {
        createMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    const result = await persistGeneratedBom(db, {
      buildId: "BUILD-1",
      digitalProductId: "product-1",
      assuranceRunId: "run-1",
      generatedBom,
    });

    expect(result.documentId).toBe("bom_document-digest");
    expect(db.bomComponent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { componentKey: "component-1" },
    }));
    expect(db.bomDocument.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        digest: "document-digest",
        raw: generatedBom.cyclonedx,
      }),
    }));
    expect(db.bomComponentOccurrence.createMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ occurrenceKey: "occurrence-1" })],
      skipDuplicates: true,
    }));
  });
});
```

- [ ] **Step 2: Run failing test**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-persistence.test.ts
```

Expected: fails because `bom-persistence.ts` does not exist.

- [ ] **Step 3: Implement persistence helper**

Create `apps/web/lib/assurance/bom-persistence.ts` with this API:

```ts
import type { Prisma } from "@dpf/db";
import type { GeneratedBom, NormalizedBomComponent } from "./bom-types";

type BomPersistenceDb = {
  bomComponent: {
    upsert(args: unknown): Promise<{ id: string; componentKey: string }>;
  };
  bomDocument: {
    create(args: unknown): Promise<{ id: string; documentId: string }>;
  };
  bomComponentOccurrence: {
    createMany(args: unknown): Promise<{ count: number }>;
  };
};

function componentCreateData(component: NormalizedBomComponent) {
  return {
    componentKey: component.componentKey,
    componentType: component.componentType,
    name: component.name,
    version: component.version,
    packageUrl: component.packageUrl,
    supplierName: component.supplierName,
    licenseExpression: component.licenseExpression,
    ecosystem: component.ecosystem,
    scope: component.scope,
    metadata: component.metadata as Prisma.InputJsonValue,
  };
}

export async function persistGeneratedBom(
  db: BomPersistenceDb,
  input: {
    buildId: string | null;
    digitalProductId: string | null;
    assuranceRunId: string | null;
    artifactRevisionId?: string | null;
    generatedBom: GeneratedBom;
  },
): Promise<{ documentDbId: string; documentId: string; componentCount: number; occurrenceCount: number }> {
  const componentRows = new Map<string, { id: string; componentKey: string }>();

  for (const component of input.generatedBom.components) {
    const data = componentCreateData(component);
    const row = await db.bomComponent.upsert({
      where: { componentKey: component.componentKey },
      create: data,
      update: {
        ...data,
        lastSeenAt: new Date(),
      },
    });
    componentRows.set(component.componentKey, row);
  }

  const documentId = `bom_${input.generatedBom.documentDigest.slice(0, 24)}`;
  const document = await db.bomDocument.create({
    data: {
      documentId,
      format: "cyclonedx-json",
      formatVersion: input.generatedBom.cyclonedx.specVersion,
      serialNumber: input.generatedBom.cyclonedx.serialNumber,
      version: input.generatedBom.cyclonedx.version,
      digest: input.generatedBom.documentDigest,
      sourceKind: "pnpm-lock",
      sourceDigest: input.generatedBom.sourceDigest,
      componentCount: input.generatedBom.components.length,
      raw: input.generatedBom.cyclonedx as Prisma.InputJsonValue,
      buildId: input.buildId,
      digitalProductId: input.digitalProductId,
      assuranceRunId: input.assuranceRunId,
      artifactRevisionId: input.artifactRevisionId ?? null,
    },
  });

  const occurrenceRows = input.generatedBom.occurrences.flatMap((occurrence) => {
    const component = componentRows.get(occurrence.componentKey);
    if (!component) return [];
    return [{
      occurrenceKey: occurrence.occurrenceKey,
      bomDocumentId: document.id,
      componentId: component.id,
      workspaceName: occurrence.workspaceName,
      workspacePath: occurrence.workspacePath,
      dependencyKind: occurrence.dependencyKind,
      direct: occurrence.direct,
      evidence: occurrence.evidence as Prisma.InputJsonValue,
    }];
  });

  const createdOccurrences = await db.bomComponentOccurrence.createMany({
    data: occurrenceRows,
    skipDuplicates: true,
  });

  return {
    documentDbId: document.id,
    documentId: document.documentId,
    componentCount: input.generatedBom.components.length,
    occurrenceCount: createdOccurrences.count,
  };
}
```

- [ ] **Step 4: Verify persistence test passes**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-persistence.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/assurance/bom-persistence.ts apps/web/lib/assurance/bom-persistence.test.ts
git commit -s -m "feat(assurance): persist generated bom"
```

### Task 6: Add Background BOM Job

**Files:**
- Create: `apps/web/lib/assurance/bom-job.ts`
- Create: `apps/web/lib/assurance/bom-job.test.ts`
- Create: `apps/web/lib/queue/functions/assurance-bom.ts`
- Modify: `apps/web/lib/queue/functions/index.ts`
- Modify: `apps/web/lib/queue/inngest-client.ts`

- [ ] **Step 1: Write failing job test**

Create `apps/web/lib/assurance/bom-job.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { generateAndPersistBuildBom } from "./bom-job";

describe("generateAndPersistBuildBom", () => {
  it("returns skipped when the build does not exist", async () => {
    const db = {
      featureBuild: { findUnique: vi.fn(async () => null) },
    };

    await expect(generateAndPersistBuildBom({
      db,
      buildId: "missing",
      requestedByUserId: "user-1",
      projectRoot: "D:/DPF",
      now: new Date("2026-05-22T00:00:00.000Z"),
    })).resolves.toEqual({ skipped: true, reason: "build not found" });
  });
});
```

- [ ] **Step 2: Run failing job test**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-job.test.ts
```

Expected: fails because `bom-job.ts` does not exist.

- [ ] **Step 3: Implement job orchestration**

Create `apps/web/lib/assurance/bom-job.ts` with a testable `generateAndPersistBuildBom` that:

- loads `FeatureBuild` by `buildId`, selecting `buildId`, `title`, `threadId`, `createdById`, and `digitalProductId`;
- reads `apps/web/package.json` and `pnpm-lock.yaml` from `projectRoot`;
- loads active `ModelProfile` rows using `modelProfile.findMany({ where: { modelStatus: "active" } })`;
- calls `generateCycloneDxBom`;
- creates a `ToolExecution` row with `toolName: "generate_cyclonedx_bom"`;
- creates a `ToolExecutionReceipt` row with `receiptKind: "assurance-bom"`;
- creates an `AssuranceRun` row with terminal `status: "passed"` and both tool execution IDs;
- calls `persistGeneratedBom`;
- writes a `BuildActivity` summary;
- emits `agentEventBus` events only when `threadId` exists.

Use this return shape:

```ts
export type GenerateAndPersistBuildBomResult =
  | { skipped: true; reason: string }
  | { skipped: false; documentId: string; componentCount: number; occurrenceCount: number; runId: string };
```

- [ ] **Step 4: Add Inngest event type**

In `apps/web/lib/queue/inngest-client.ts`, add:

```ts
export interface AssuranceBomGenerateEvent {
  name: "assurance/bom.generate";
  data: {
    buildId: string;
    requestedByUserId: string;
  };
}
```

- [ ] **Step 5: Add Inngest worker**

Create `apps/web/lib/queue/functions/assurance-bom.ts`:

```ts
import { inngest } from "../inngest-client";

export const assuranceBomGenerate = inngest.createFunction(
  {
    id: "assurance/bom-generate",
    retries: 1,
    concurrency: [{ limit: 2 }],
    triggers: [{ event: "assurance/bom.generate" }],
  },
  async ({ event, step }) => {
    const { buildId, requestedByUserId } = event.data as { buildId: string; requestedByUserId: string };

    return step.run("generate-and-persist-bom", async () => {
      const { prisma } = await import("@dpf/db");
      const { generateAndPersistBuildBom } = await import("@/lib/assurance/bom-job");
      return generateAndPersistBuildBom({
        db: prisma,
        buildId,
        requestedByUserId,
        projectRoot: process.env.PROJECT_ROOT ?? process.cwd(),
        now: new Date(),
      });
    });
  },
);
```

- [ ] **Step 6: Register worker**

Modify `apps/web/lib/queue/functions/index.ts`:

```ts
import { assuranceBomGenerate } from "./assurance-bom";

export const allFunctions = [
  assuranceBomGenerate,
  // existing functions...
];
```

- [ ] **Step 7: Verify focused tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-job.test.ts lib/queue/functions/index.test.ts
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/web/lib/assurance/bom-job.ts apps/web/lib/assurance/bom-job.test.ts apps/web/lib/queue/functions/assurance-bom.ts apps/web/lib/queue/functions/index.ts apps/web/lib/queue/inngest-client.ts
git commit -s -m "feat(assurance): generate bom in background"
```

### Task 7: Add Read APIs and Manual Trigger Action

**Files:**
- Create: `apps/web/lib/assurance/bom-read.ts`
- Create: `apps/web/lib/assurance/bom-read.test.ts`
- Create: `apps/web/lib/assurance/bom-export.ts`
- Create: `apps/web/lib/assurance/bom-trigger.ts`
- Create: `apps/web/lib/actions/assurance.ts`

- [ ] **Step 1: Write failing read tests**

Create `apps/web/lib/assurance/bom-read.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getLatestBomSummaryForBuild } from "./bom-read";

describe("getLatestBomSummaryForBuild", () => {
  it("returns an unavailable state when no BOM exists", async () => {
    const db = { bomDocument: { findFirst: vi.fn(async () => null) } };

    await expect(getLatestBomSummaryForBuild(db, "BUILD-1")).resolves.toEqual({
      state: "missing",
      document: null,
      counts: { components: 0, models: 0 },
    });
  });
});
```

- [ ] **Step 2: Run failing read test**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-read.test.ts
```

Expected: fails because `bom-read.ts` does not exist.

- [ ] **Step 3: Implement read helper**

Create `apps/web/lib/assurance/bom-read.ts` with:

```ts
export interface BomSummary {
  state: "missing" | "current" | "stale";
  document: null | {
    documentId: string;
    digest: string;
    generatedAt: Date;
    componentCount: number;
    sourceKind: string;
  };
  counts: {
    components: number;
    models: number;
  };
}

export async function getLatestBomSummaryForBuild(
  db: {
    bomDocument: {
      findFirst(args: unknown): Promise<null | {
        documentId: string;
        digest: string;
        generatedAt: Date;
        componentCount: number;
        sourceKind: string;
        occurrences?: Array<{ component?: { componentType?: string } }>;
      }>;
    };
  },
  buildId: string,
): Promise<BomSummary> {
  const document = await db.bomDocument.findFirst({
    where: { buildId },
    orderBy: { generatedAt: "desc" },
    include: { occurrences: { include: { component: true } } },
  });
  if (!document) return { state: "missing", document: null, counts: { components: 0, models: 0 } };
  const modelCount = (document.occurrences ?? []).filter((entry) => entry.component?.componentType === "model").length;
  return {
    state: "current",
    document: {
      documentId: document.documentId,
      digest: document.digest,
      generatedAt: document.generatedAt,
      componentCount: document.componentCount,
      sourceKind: document.sourceKind,
    },
    counts: { components: document.componentCount, models: modelCount },
  };
}
```

- [ ] **Step 4: Add export helper and trigger**

Create `apps/web/lib/assurance/bom-export.ts`:

```ts
export async function getLatestCycloneDxForProduct(
  db: { bomDocument: { findFirst(args: unknown): Promise<null | { raw: unknown; documentId: string }> } },
  digitalProductId: string,
): Promise<null | { documentId: string; raw: unknown }> {
  return db.bomDocument.findFirst({
    where: { digitalProductId },
    orderBy: { generatedAt: "desc" },
    select: { documentId: true, raw: true },
  });
}
```

Create `apps/web/lib/assurance/bom-trigger.ts`:

```ts
import { inngest } from "@/lib/queue/inngest-client";

export async function queueBuildBomGeneration(input: { buildId: string; requestedByUserId: string }) {
  return inngest.send({
    name: "assurance/bom.generate",
    data: input,
  });
}
```

Create `apps/web/lib/actions/assurance.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { queueBuildBomGeneration } from "@/lib/assurance/bom-trigger";

export async function requestBuildBomGeneration(buildId: string): Promise<{ queued: true }> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_platform")) {
    throw new Error("Unauthorized");
  }
  await queueBuildBomGeneration({ buildId, requestedByUserId: user.id });
  return { queued: true };
}
```

- [ ] **Step 5: Verify focused tests and typecheck**

Run:

```powershell
pnpm --filter web exec vitest run lib/assurance/bom-read.test.ts
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/assurance/bom-read.ts apps/web/lib/assurance/bom-read.test.ts apps/web/lib/assurance/bom-export.ts apps/web/lib/assurance/bom-trigger.ts apps/web/lib/actions/assurance.ts
git commit -s -m "feat(assurance): expose bom read and trigger helpers"
```

### Task 8: Add Build Studio Assurance Gate Card

**Files:**
- Create: `apps/web/components/build/BuildAssuranceGateCard.tsx`
- Create: `apps/web/components/build/BuildAssuranceGateCard.test.tsx`
- Modify: `apps/web/components/build/BuildStudio.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `apps/web/components/build/BuildAssuranceGateCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuildAssuranceGateCard } from "./BuildAssuranceGateCard";

vi.mock("@/lib/actions/assurance", () => ({
  requestBuildBomGeneration: vi.fn(async () => ({ queued: true })),
}));

describe("BuildAssuranceGateCard", () => {
  it("shows an honest missing-BOM state", () => {
    render(<BuildAssuranceGateCard buildId="BUILD-1" summary={{ state: "missing", document: null, counts: { components: 0, models: 0 } }} />);

    expect(screen.getByText("Assurance Gate")).toBeInTheDocument();
    expect(screen.getByText("No BOM generated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Generate BOM/i })).toBeInTheDocument();
  });

  it("shows component and model counts when a BOM exists", () => {
    render(<BuildAssuranceGateCard buildId="BUILD-1" summary={{
      state: "current",
      document: {
        documentId: "bom_abc",
        digest: "abc123",
        generatedAt: new Date("2026-05-22T00:00:00.000Z"),
        componentCount: 12,
        sourceKind: "pnpm-lock",
      },
      counts: { components: 12, models: 2 },
    }} />);

    expect(screen.getByText("BOM current")).toBeInTheDocument();
    expect(screen.getByText("12 components")).toBeInTheDocument();
    expect(screen.getByText("2 AI models")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run failing UI tests**

Run:

```powershell
pnpm --filter web exec vitest run components/build/BuildAssuranceGateCard.test.tsx
```

Expected: fails because the component does not exist.

- [ ] **Step 3: Implement the card**

Create `apps/web/components/build/BuildAssuranceGateCard.tsx`:

```tsx
"use client";

import { RefreshCw, ShieldCheck } from "lucide-react";
import { useTransition } from "react";
import { requestBuildBomGeneration } from "@/lib/actions/assurance";
import type { BomSummary } from "@/lib/assurance/bom-read";

export function BuildAssuranceGateCard({ buildId, summary }: { buildId: string; summary: BomSummary }) {
  const [pending, startTransition] = useTransition();
  const hasBom = summary.state !== "missing" && summary.document;
  const modelLabel = `${summary.counts.models} AI model${summary.counts.models === 1 ? "" : "s"}`;

  return (
    <section className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[var(--dpf-accent)]" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Assurance Gate</h2>
          </div>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {hasBom ? "BOM current" : "No BOM generated"}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-60"
          disabled={pending}
          onClick={() => startTransition(() => { void requestBuildBomGeneration(buildId); })}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {pending ? "Queued" : "Generate BOM"}
        </button>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[var(--dpf-muted)]">Components</p>
          <p className="mt-1 font-semibold text-[var(--dpf-text)]">{summary.counts.components} components</p>
        </div>
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[var(--dpf-muted)]">Models</p>
          <p className="mt-1 font-semibold text-[var(--dpf-text)]">{modelLabel}</p>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Wire Build Studio**

In `apps/web/components/build/BuildStudio.tsx`:

- import `BuildAssuranceGateCard`;
- add `getBuildBomSummary(buildId: string)` to `apps/web/lib/actions/assurance.ts`; it should wrap `getLatestBomSummaryForBuild(prisma, buildId)` and normalize errors to the missing-summary state;
- keep `BuildStudio.tsx` client-side by loading the summary through that server action in the existing active-build `useEffect` flow, alongside build detail and code-graph state refreshes;
- render the card near the existing evidence/verification area.

Keep the card read-only except for queuing the background job. It must not block render while the job runs.

- [ ] **Step 5: Verify UI tests**

Run:

```powershell
pnpm --filter web exec vitest run components/build/BuildAssuranceGateCard.test.tsx components/build/BuildStudio.test.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/components/build/BuildAssuranceGateCard.tsx apps/web/components/build/BuildAssuranceGateCard.test.tsx apps/web/components/build/BuildStudio.tsx
git commit -s -m "feat(assurance): show build studio bom gate"
```

### Task 9: Add Product Supply Chain Tab and Export

**Files:**
- Modify: `apps/web/components/product/ProductTabNav.tsx`
- Modify: `apps/web/components/product/ProductTabNav.test.tsx`
- Create: `apps/web/components/product/ProductSupplyChainPanel.tsx`
- Create: `apps/web/components/product/ProductSupplyChainPanel.test.tsx`
- Create: `apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx`
- Create: `apps/web/app/api/portfolio/product/[id]/supply-chain/bom/route.ts`

- [ ] **Step 1: Update failing nav test**

Modify `apps/web/components/product/ProductTabNav.test.tsx`:

```tsx
it("includes supply chain under the operate family", () => {
  pathname = "/portfolio/product/prod-1/supply-chain";
  const html = renderToStaticMarkup(<ProductTabNav productId="prod-1" />);

  expect(html).toContain('href="/portfolio/product/prod-1/supply-chain"');
  expect(html).toContain(">Supply Chain<");
  expect(html).toContain(">Dependencies &amp; Estate<");
});
```

- [ ] **Step 2: Run failing nav test**

Run:

```powershell
pnpm --filter web exec vitest run components/product/ProductTabNav.test.tsx
```

Expected: fails because the nav does not include Supply Chain yet.

- [ ] **Step 3: Add nav item**

Modify the Operate family in `apps/web/components/product/ProductTabNav.tsx`:

```tsx
subItems: [
  { label: "Health", href: `${base}/health` },
  { label: "Dependencies & Estate", href: `${base}/inventory` },
  { label: "Supply Chain", href: `${base}/supply-chain` },
],
```

- [ ] **Step 4: Write failing panel tests**

Create `apps/web/components/product/ProductSupplyChainPanel.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProductSupplyChainPanel } from "./ProductSupplyChainPanel";

describe("ProductSupplyChainPanel", () => {
  it("shows an empty state when there is no BOM", () => {
    render(<ProductSupplyChainPanel productId="prod-1" latestBom={null} components={[]} />);

    expect(screen.getByText("Supply Chain")).toBeInTheDocument();
    expect(screen.getByText("No BOM has been generated for this product yet.")).toBeInTheDocument();
  });

  it("renders component rows and export link", () => {
    render(<ProductSupplyChainPanel productId="prod-1" latestBom={{
      documentId: "bom_abc",
      generatedAt: new Date("2026-05-22T00:00:00.000Z"),
      digest: "abc",
      componentCount: 1,
    }} components={[{
      name: "next",
      version: "16.2.6",
      componentType: "framework",
      ecosystem: "npm",
      packageUrl: "pkg:npm/next@16.2.6",
    }]} />);

    expect(screen.getByText("next")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Export CycloneDX/i })).toHaveAttribute("href", "/api/portfolio/product/prod-1/supply-chain/bom");
  });
});
```

- [ ] **Step 5: Run failing panel tests**

Run:

```powershell
pnpm --filter web exec vitest run components/product/ProductSupplyChainPanel.test.tsx
```

Expected: fails because the component does not exist.

- [ ] **Step 6: Implement panel**

Create `apps/web/components/product/ProductSupplyChainPanel.tsx` with theme variables only. Use a compact header, KPI row, component table, and no decorative cards inside cards.

```tsx
import Link from "next/link";

export interface ProductSupplyChainComponent {
  name: string;
  version: string | null;
  componentType: string;
  ecosystem: string | null;
  packageUrl: string | null;
}

export interface ProductSupplyChainLatestBom {
  documentId: string;
  generatedAt: Date;
  digest: string;
  componentCount: number;
}

export function ProductSupplyChainPanel({
  productId,
  latestBom,
  components,
}: {
  productId: string;
  latestBom: ProductSupplyChainLatestBom | null;
  components: ProductSupplyChainComponent[];
}) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Supply Chain</h1>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">BOM components, AI model dependencies, and exportable evidence.</p>
        </div>
        {latestBom ? (
          <Link className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white" href={`/api/portfolio/product/${productId}/supply-chain/bom`}>
            Export CycloneDX
          </Link>
        ) : null}
      </div>

      {!latestBom ? (
        <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5 text-sm text-[var(--dpf-muted)]">
          No BOM has been generated for this product yet.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-xs text-[var(--dpf-muted)]">Components</p>
              <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{latestBom.componentCount}</p>
            </div>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-xs text-[var(--dpf-muted)]">Generated</p>
              <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{latestBom.generatedAt.toLocaleString()}</p>
            </div>
            <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-xs text-[var(--dpf-muted)]">Digest</p>
              <p className="mt-1 break-all text-xs font-semibold text-[var(--dpf-text)]">{latestBom.digest.slice(0, 16)}</p>
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-[var(--dpf-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[var(--dpf-surface-2)] text-xs text-[var(--dpf-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Component</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Ecosystem</th>
                  <th className="px-3 py-2 font-medium">Package URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]">
                {components.map((component) => (
                  <tr key={`${component.name}:${component.version ?? ""}:${component.componentType}`}>
                    <td className="px-3 py-2 font-medium">{component.name}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.version ?? "unknown"}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.componentType}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.ecosystem ?? "unknown"}</td>
                    <td className="max-w-xs break-all px-3 py-2 text-xs text-[var(--dpf-muted)]">{component.packageUrl ?? "not applicable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Add product route**

Create `apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { ProductSupplyChainPanel } from "@/components/product/ProductSupplyChainPanel";

export default async function ProductSupplyChainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await prisma.digitalProduct.findUnique({ where: { id }, select: { id: true } });
  if (!product) notFound();

  const latestBom = await prisma.bomDocument.findFirst({
    where: { digitalProductId: id },
    orderBy: { generatedAt: "desc" },
    select: {
      documentId: true,
      generatedAt: true,
      digest: true,
      componentCount: true,
      occurrences: {
        select: {
          component: {
            select: {
              name: true,
              version: true,
              componentType: true,
              ecosystem: true,
              packageUrl: true,
            },
          },
        },
        take: 200,
      },
    },
  });

  return (
    <ProductSupplyChainPanel
      productId={id}
      latestBom={latestBom ? {
        documentId: latestBom.documentId,
        generatedAt: latestBom.generatedAt,
        digest: latestBom.digest,
        componentCount: latestBom.componentCount,
      } : null}
      components={(latestBom?.occurrences ?? []).map((occurrence) => occurrence.component)}
    />
  );
}
```

- [ ] **Step 8: Add export route**

Create `apps/web/app/api/portfolio/product/[id]/supply-chain/bom/route.ts`:

```ts
import { NextResponse } from "next/server";
import { prisma } from "@dpf/db";
import { getLatestCycloneDxForProduct } from "@/lib/assurance/bom-export";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bom = await getLatestCycloneDxForProduct(prisma, id);
  if (!bom) return NextResponse.json({ error: "No BOM found" }, { status: 404 });

  return new NextResponse(JSON.stringify(bom.raw, null, 2), {
    headers: {
      "content-type": "application/vnd.cyclonedx+json; charset=utf-8",
      "content-disposition": `attachment; filename="${bom.documentId}.json"`,
    },
  });
}
```

- [ ] **Step 9: Verify UI tests**

Run:

```powershell
pnpm --filter web exec vitest run components/product/ProductTabNav.test.tsx components/product/ProductSupplyChainPanel.test.tsx
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 10: Commit**

Run:

```powershell
git add apps/web/components/product/ProductTabNav.tsx apps/web/components/product/ProductTabNav.test.tsx apps/web/components/product/ProductSupplyChainPanel.tsx apps/web/components/product/ProductSupplyChainPanel.test.tsx "apps/web/app/(shell)/portfolio/product/[id]/supply-chain/page.tsx" "apps/web/app/api/portfolio/product/[id]/supply-chain/bom/route.ts"
git commit -s -m "feat(assurance): add product supply chain tab"
```

### Task 10: Final Verification, UX, and Evidence

**Files:**
- Update: none unless verification requires narrow repair.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter @dpf/db exec vitest run src/assurance-schema-contract.test.ts
pnpm --filter web exec vitest run lib/assurance/component-key.test.ts lib/assurance/pnpm-lock-parser.test.ts lib/assurance/cyclonedx-generator.test.ts lib/assurance/bom-persistence.test.ts lib/assurance/bom-job.test.ts lib/assurance/bom-read.test.ts components/build/BuildAssuranceGateCard.test.tsx components/product/ProductTabNav.test.tsx components/product/ProductSupplyChainPanel.test.tsx
```

Expected: all pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter @dpf/db typecheck
pnpm --filter web typecheck
```

Expected: both pass.

- [ ] **Step 3: Apply migration cleanly**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --schema prisma/schema.prisma
```

Expected: no drift; generated client is current.

- [ ] **Step 4: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: build exits 0. Existing unrelated warnings must be reported with file paths.

- [ ] **Step 5: UX verification against Docker-served app**

Rebuild and start the Docker-served portal only from the implementation worktree after confirming its `.env` has a unique `COMPOSE_PROJECT_NAME`:

```powershell
Get-Content .env | Select-String COMPOSE_PROJECT_NAME
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Then sign in with `admin@dpf.local` and `ADMIN_PASSWORD` from repo-root `.env`, exercise:

- `/build`: Build Assurance Gate card renders with "No BOM generated" or latest BOM state.
- Trigger "Generate BOM"; UI does not block while job runs.
- Product detail Operate -> Supply Chain tab renders.
- Export CycloneDX returns JSON when a BOM exists and 404 when missing.

Record screenshots or Playwright traces in the final evidence if the browser tool is used.

- [ ] **Step 6: Backlog evidence**

Use MCP `record_execution_evidence` on `BI-ASSURANCE-P1-01`:

```text
Phase 1A persisted CycloneDX-compatible BOM documents, normalized components, component occurrences, and assurance runs. Verification: focused tests, @dpf/db typecheck, web typecheck, migration apply, production build, and Docker-served UX checks passed. Vulnerability scanning remains deferred to BI-ASSURANCE-P1-02 because the approved tools registry is empty and scanner adoption requires Tool Evaluation.
```

Use MCP `record_execution_evidence` on `BI-ASSURANCE-P1-02`:

```text
Phase 1A intentionally did not add scanner findings or release blocking. Approved tools registry is empty, so Grype/OSV/Syft/Black Duck adapter work remains gated by Tool Evaluation before implementation.
```

- [ ] **Step 7: Mark status**

If all Phase 1A checks pass, move `BI-ASSURANCE-P1-01` to `done`. Do not move `BI-ASSURANCE-P1-02`.

- [ ] **Step 8: Push and PR**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -8
git push -u origin feat/assurance-ledger-phase-1a
```

Open a PR only after every verification command above has passed and evidence is recorded.

## 6. Self-Review

### Spec coverage

| Spec requirement | Phase 1A coverage |
|------------------|-------------------|
| Generate CycloneDX BOM for web workspace | Implemented by generator and background job tasks. |
| Persist normalized components | Implemented by `BomComponent` and `BomComponentOccurrence`. |
| AI model components first-class | Implemented by model-profile input and `componentType = "model"`. |
| Queryable ledger rows, not JSON blobs | BOM raw JSON is retained, but component and occurrence rows are queryable. |
| Build Studio Assurance Gate | Implemented as read-only BOM state; scanner state is explicitly unavailable. |
| Product Supply Chain tab | Implemented as a product route and nav item. |
| Export CycloneDX JSON | Implemented by API route. |
| Tool Evaluation gating | Scanner work is deferred because approved registry is empty. |
| No auto-remediation | No remediation actions are introduced. |
| AssuranceRun to ToolExecution coupling | BOM job creates ToolExecution, ToolExecutionReceipt, and AssuranceRun for terminal runs. |
| Finding-substrate guard | No `AssuranceFinding` model is added in Phase 1A. |

### Placeholder scan

The placeholder scan is clean.

### Type consistency

Names used consistently across tasks:

- `AssuranceRun`
- `BomDocument`
- `BomComponent`
- `BomComponentOccurrence`
- `GeneratedBom`
- `generateCycloneDxBom`
- `persistGeneratedBom`
- `generateAndPersistBuildBom`
- `BuildAssuranceGateCard`
- `ProductSupplyChainPanel`

## 7. Execution Handoff

Execute this plan in a new implementation worktree. The implementation branch should target `BI-ASSURANCE-P1-01` only.

Carry-forward for the next branch:

- `BI-ASSURANCE-P1-02` should begin with Tool Evaluation for the selected scanner. Do not implement a vulnerability scanner adapter until the registry or `ToolEvaluation` row says it is approved.
- `AssuranceFinding` may be introduced in `BI-ASSURANCE-P1-02` under Option B, but the Phase 2 hard gate in `BI-REFACTOR-CC46703A` remains.
- Build Studio must continue to phrase scanner posture as "not configured" or "not approved" until an evaluated scanner exists.
