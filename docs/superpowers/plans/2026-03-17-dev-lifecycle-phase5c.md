# Development Lifecycle — Phase 5c: Codebase Manifest (SBOM)

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a structured codebase manifest (SBOM) that serves as both AI agent context and compliance artifact. Stored in DB and as a committed file.

**Architecture:** `manifest-generator.ts` reads `package.json`, `schema.prisma`, and a human-maintained `codebase-manifest.base.json` to produce a `codebase-manifest.json`. The `CodebaseManifest` Prisma model stores versioned snapshots. Two MCP tools: `generate_codebase_manifest` (dev-only) and `read_codebase_manifest` (universal). `shipBuild()` generates manifest on ship.

**Tech Stack:** Next.js 16, TypeScript strict, Prisma 6, vitest.

**Spec:** `docs/superpowers/specs/2026-03-17-development-lifecycle-architecture-design.md` (Section 4)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/lib/manifest-generator.ts` | Reads base manifest + auto-generates dependencies, models, file stats |
| `apps/web/lib/manifest-generator.test.ts` | Tests for manifest generation helpers |
| `codebase-manifest.base.json` | Human/AI-maintained base template (modules, capabilities, boundaries) |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add CodebaseManifest model; add manifestId to ProductVersion; add manifests relation to DigitalProduct |
| `apps/web/lib/mcp-tools.ts` | Add generate_codebase_manifest + read_codebase_manifest tools |
| `apps/web/lib/actions/build.ts` | Call manifest generator in shipBuild after version tracking |

---

## Chunk 1: Prisma Schema — CodebaseManifest Model

### Task 1: Add CodebaseManifest model and extend ProductVersion

- [ ] **Step 1:** Add CodebaseManifest model after the ChangePromotion model in schema.prisma:

```prisma
model CodebaseManifest {
  id               String          @id @default(cuid())
  version          String
  gitRef           String
  manifest         Json
  digitalProductId String?
  digitalProduct   DigitalProduct? @relation(fields: [digitalProductId], references: [id])
  generatedAt      DateTime        @default(now())
  productVersion   ProductVersion?

  @@unique([version, digitalProductId])
  @@index([digitalProductId])
}
```

- [ ] **Step 2:** Add `manifestId` and `manifest` to ProductVersion (after shippedAt):

```prisma
  manifestId       String?          @unique
  manifest         CodebaseManifest? @relation(fields: [manifestId], references: [id])
```

- [ ] **Step 3:** Add `manifests` relation to DigitalProduct (after `versions`):

```prisma
  manifests              CodebaseManifest[]
```

- [ ] **Step 4:** Run `npx prisma validate` and `npx prisma generate`
- [ ] **Step 5:** Commit

---

## Chunk 2: Base Manifest Template

### Task 2: Create codebase-manifest.base.json

- [ ] **Step 1:** Create `codebase-manifest.base.json` at project root with the human-maintained sections (modules, capabilities, boundaries). Auto-generated sections (dependencies, statistics) are omitted — the generator fills those in.

- [ ] **Step 2:** Commit

---

## Chunk 3: Manifest Generator Module

### Task 3: Create manifest-generator.ts + tests

- [ ] **Step 1:** Write test file with tests for `parseDependencies`, `countModels`, `generateManifest`
- [ ] **Step 2:** Write manifest-generator.ts that:
  - Reads `codebase-manifest.base.json` for modules, capabilities, boundaries
  - Reads all `package.json` files for external dependencies
  - Reads `schema.prisma` for data model count
  - Counts files and lines in each module directory
  - Merges everything into the full manifest JSON
  - Optionally writes to `codebase-manifest.json` and/or DB
- [ ] **Step 3:** Run tests, verify pass
- [ ] **Step 4:** Commit

---

## Chunk 4: MCP Tools — generate + read manifest

### Task 4: Register tools and add handlers

- [ ] **Step 1:** Add `generate_codebase_manifest` tool (dev-only, sideEffect: true)
- [ ] **Step 2:** Add `read_codebase_manifest` tool (universal, sideEffect: false)
- [ ] **Step 3:** Add execution handlers for both
- [ ] **Step 4:** Type check
- [ ] **Step 5:** Commit

---

## Chunk 5: shipBuild Integration

### Task 5: Generate manifest on ship

- [ ] **Step 1:** In shipBuild(), after createProductVersion, call manifest generator and link to ProductVersion
- [ ] **Step 2:** Type check
- [ ] **Step 3:** Commit

---

## Chunk 6: Verification

- [ ] **Step 1:** Run all tests
- [ ] **Step 2:** Type check
- [ ] **Step 3:** Verify `generate_codebase_manifest` produces valid output
