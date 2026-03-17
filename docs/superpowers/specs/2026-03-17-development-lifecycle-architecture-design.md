# Development Lifecycle Architecture

**Date:** 2026-03-17
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:**
- `docs/superpowers/specs/2026-03-16-unified-mcp-coworker-design.md` (Phases 1-2)
- `docs/superpowers/specs/2026-03-16-orchestrated-task-routing-design.md` (Phase 3)

## Problem Statement

The platform is designed to self-develop — AI agents propose and build features through the Build Studio and agent coworker tools. However, the current code change pipeline has critical gaps:

1. **No git integration** — `propose_file_change` writes directly to the filesystem after human approval. There is no commit, no tag, no audit trail in version control. Approved changes can be lost on container restart or overwritten by the next change.
2. **Version is a disconnected string** — `DigitalProduct.version` is bumped by `shipBuild()` but doesn't map to any git ref. There's no way to answer "what code is version 1.2.0?" or "what changed between 1.1.0 and 1.2.0?"
3. **Production has no codebase understanding** — `isDevInstance()` blocks all codebase tools in production, correctly so (no source code). But the production agent has zero awareness of what code it's running or how it relates to what's being developed.
4. **No promotion pipeline** — there is no controlled path from "code was written in dev" to "code is running in production." The sandbox (`sandbox.ts`) isolates code generation but `shipBuild()` updates the product inventory without actually deploying anything.
5. **No codebase context for agents** — agents must `list_project_directory` and `read_project_file` iteratively to understand the codebase. There is no structured "map" that gives an agent immediate orientation.

The platform targets regulated industries where evidence of decisions is required. The current architecture lacks the change management evidence chain: who proposed what, who approved it, what was the state before and after, and how does it trace through to production.

## Design Summary

Connect five systems into a coherent self-development pipeline:

```
Dev Instance ──propose──▶ Git Repository ──promote──▶ Production Instance
     │                        │                              │
     │                   (source of truth)                   │
     ▼                        │                              ▼
Codebase Tools           Git Tags ◄──── Digital Product    Read-Only Git
(read/write)                │           Version Mapping     (git show/log/diff)
                            ▼                                    │
                     Codebase Manifest ◄─────────────────────────┘
                     (SBOM — AI context                     Agent reads
                      + compliance)                         manifest for
                                                            orientation
```

### Key Principles

- **Git is the single source of truth** — every approved code change becomes a git commit. No filesystem-only mutations. Production reads from git, not the working tree.
- **Version = git tag** — each `DigitalProduct` version maps to exactly one git tag. You can always reconstruct what was deployed at any version.
- **Three approval gates** — propose (per-change HITL), ship (per-build HITL), deploy (per-promotion HITL). Each gate produces audit evidence.
- **SBOM serves two masters** — compliance (standard format for dependency/vulnerability tracking) AND AI context (structured codebase map so agents don't need to explore iteratively).
- **Production is read-only, not blind** — the production agent can understand the codebase through the manifest and git history, but cannot modify it. `isDevInstance()` continues to gate write access.
- **Trust gates complexity, not access** — the Trusted AI Kernel determines what complexity of code work an endpoint receives (simple fix vs. architectural change), not whether it can access the codebase.

---

## Section 1: System Topology

### Three Environments

| Environment | Source Code | Git Access | Agent Tools | Purpose |
|---|---|---|---|---|
| **Dev Instance** | Full working tree (read/write) | Full repo (read/write) | `read_project_file`, `search_project_files`, `list_project_directory`, `propose_file_change` | AI agents develop features |
| **Git Repository** | N/A (is the source) | The source of truth | N/A (accessed through dev/prod) | All changes converge here; tags = versions |
| **Production Instance** | None (built artifacts only) | `.git` mounted read-only | `read_codebase_manifest`, `query_version_history` (universal); `read_source_at_version`, `search_source_at_version`, `list_source_directory`, `compare_versions` (git-dependent) | Running platform; agent understands but doesn't modify |

### Dev Instance

The dev instance is the existing development environment. Docker Compose defines `portal` with `INSTANCE_TYPE=dev`. The codebase tools (`codebase-tools.ts`) already gate all file operations behind `isDevInstance()`.

**What changes:** After human approval of `propose_file_change`, the write is followed by an automatic git commit. The commit message includes structured metadata (build ID, approver, change description). This is the only new behavior in the dev instance — everything else continues to work as today.

### Git Repository

The project root is already a git repository. Today, git is used manually (developer commits). Under this design, git is also used programmatically:

- `propose_file_change` approval → auto-commit
- `shipBuild()` → git tag (`v{version}`)
- The tag is the authoritative record of what code constitutes a version

### Production Instance

The production Docker image is built from the `runner` stage (see `docker-compose.yml` line 66). It contains only built artifacts — no source code in the working tree.

**What changes:** The `.git` directory is mounted read-only into the production container. This enables:

- `git show <tag>:<path>` — read any file at any version
- `git log --oneline` — version history
- `git diff <tag1> <tag2>` — what changed between versions
- `git tag --list 'v*'` — list all versions

The `.git` mount adds ~50-100MB to the container's visible filesystem but requires no changes to the build process.

**Deployment scope:** The read-only `.git` mount is designed for self-hosted single-machine deployments where the production container runs on the same host as the git repository. In CI/CD-deployed environments (container registries, cloud hosts), the `.git` directory is not automatically available. For these scenarios: (a) the DB-based tools (`read_codebase_manifest`, `query_version_history`) work without git, providing the primary codebase orientation; (b) git-dependent tools gracefully degrade via the `isGitAvailable()` check (see Section 5); (c) a future CI/CD enhancement could bake a `git clone --bare` into the production image build step. The self-hosted path is prioritized because it matches the current deployment model.

**Docker Compose change:**

```yaml
services:
  portal:
    volumes:
      - ./.git:/app/.git:ro  # read-only git history for production agent
    environment:
      INSTANCE_TYPE: production
      DEPLOYED_VERSION: ${DEPLOYED_VERSION:-}  # set by CI/CD on deploy
```

The `DEPLOYED_VERSION` env var tells the production agent what version tag it's running. This is set by CI/CD or the promotion pipeline.

---

## Section 2: Change Flow Pipeline

### Current Flow (No Git)

```
Agent calls propose_file_change(path, description, newContent)
  → Human sees diff card, clicks "Approve & Apply"
    → writeProjectFile() writes to disk
      → Done (no version control)
```

### New Flow (Git-Integrated)

```
1. PROPOSE — Agent calls propose_file_change(path, description, newContent)
     ↓ Creates AgentActionProposal with diff preview
2. APPROVE — Human reviews diff card, clicks "Approve & Apply"
     ↓ writeProjectFile() writes to disk (existing behavior)
3. COMMIT — Auto git-add + git-commit with structured message
     ↓ Commit metadata: build ID, approver, change description
4. [Build continues — more changes accumulate as commits]
     ↓
5. SHIP — shipBuild() creates/updates DigitalProduct
     ↓ Git tag created: v{version}
     ↓ CodebaseManifest (SBOM) generated for this version
     ↓ ChangePromotion record created (status: "pending")
6. PROMOTE — Human reviews aggregate changes, approves deployment
     ↓ ChangePromotion status → "approved"
7. DEPLOY — CI/CD rebuilds production image from tagged commit
     ↓ Production container updated with new image
     ↓ DEPLOYED_VERSION env var set to new tag
8. VERIFY — Production agent confirms deployment matches expected version
     ↓ ChangePromotion status → "deployed"
```

### Auto-Commit on Approval

When `propose_file_change` is approved, the execution handler in `mcp-tools.ts` is extended:

```typescript
case "propose_file_change": {
  // ... existing file write logic ...

  // NEW: auto-commit the change
  const commitResult = await commitApprovedChange({
    filePath: path,
    description: String(params.description),
    buildId: context?.buildId,     // from FeatureBuild, if applicable
    approvedBy: userId,
  });

  return {
    success: true,
    entityId: path,
    message: `Applied and committed: ${path}`,
    data: { path, diff, description, commitHash: commitResult.hash },
  };
}
```

**Commit message format:**

```
<type>(<module>): <description>

Build: <buildId or "standalone">
Approved-By: <userId>
Change-Type: ai-proposed
```

The `<type>` prefix follows conventional commits: `feat` for new functionality, `fix` for bug fixes, `refactor` for restructuring, `docs` for documentation, `chore` for maintenance. The type is inferred from the agent's `description` parameter — keywords like "fix", "refactor", "update docs" map to the appropriate prefix. Default is `feat` when the type cannot be determined.

Module is inferred from the file path (e.g., `apps/web/lib/` → `web-lib`, `packages/db/` → `db`).

**Graceful degradation:** If the git commit fails (git not configured, permissions, merge conflict), the file write still succeeds (current behavior preserved). The failure is logged and surfaced to the agent:

> "File updated but git commit failed: {reason}. The change is on disk but not versioned."

### Git Tag on Ship

`shipBuild()` is extended to create a git tag after updating the DigitalProduct:

```typescript
// After product version update in the transaction:
const tagName = `v${newVersion}`;
const tagMessage = `${input.name} v${newVersion}\n\nBuild: ${input.buildId}\nShipped-By: ${userId}`;
await createGitTag(tagName, tagMessage);
```

If the working tree has uncommitted changes at ship time (changes made outside the build workflow), they are NOT included in the tag. The tag points to the latest commit, which should be the last approved change from the build.

### Build ID Association

The auto-commit handler needs to know whether a `propose_file_change` is part of a FeatureBuild. The `buildId` is NOT a parameter of the tool — it is resolved from context:

1. The `executeTool()` function already receives `context?: { routeContext?, agentId?, threadId? }`.
2. When the agent is operating within a Build Studio session, the `threadId` links to a `FeatureBuild` (via `FeatureBuild.threadId`).
3. The auto-commit handler queries: `SELECT buildId FROM FeatureBuild WHERE threadId = ? AND phase IN ('build', 'review')`.
4. If a build is found, the commit is associated with it and the build's `gitCommitHashes` array is updated.
5. If no build is found, the commit is standalone.

This lookup adds one DB query per approved change — negligible overhead. The association is best-effort: if the query fails, the commit proceeds as standalone.

### Standalone Changes

Not all `propose_file_change` calls happen within a FeatureBuild. An agent might propose a change on any page (e.g., fixing a typo from the operations page). These standalone changes:

- Still get auto-committed with `Build: standalone` in the commit message
- Are NOT tagged (no version bump)
- Can be included in a future build's scope
- Are tracked in git history for auditability

---

## Section 3: Digital Product Version ↔ Git Integration

### Current State

`DigitalProduct.version` is a string (`"1.2.0"`) bumped by `bumpVersion()` in `shipBuild()`. It has no connection to git. You cannot answer "what commit is version 1.2.0?" or "show me everything that changed in 1.2.0."

### New Model: ProductVersion

A new model links each version to its git ref and SBOM. Deployment lifecycle status is owned by `ChangePromotion` (one-to-many: one version can have multiple promotions in a multi-environment future). `ProductVersion` does not track its own status — query the latest `ChangePromotion` to determine where a version is in the deployment pipeline.

```prisma
model ProductVersion {
  id                String   @id @default(cuid())
  digitalProductId  String
  digitalProduct    DigitalProduct @relation(fields: [digitalProductId], references: [id])
  version           String          // "1.2.0" — matches DigitalProduct.version at time of creation
  gitTag            String          // "v1.2.0"
  gitCommitHash     String          // full SHA
  featureBuildId    String?         // which build shipped this version
  featureBuild      FeatureBuild?   @relation(fields: [featureBuildId], references: [id])

  // Manifest
  manifestId        String?  @unique
  manifest          CodebaseManifest? @relation(fields: [manifestId], references: [id])

  // Shipping metadata
  shippedBy         String          // userId (bare string, not FK — see "User Reference Convention" below)
  shippedAt         DateTime @default(now())

  // Change summary
  changeCount       Int      @default(0)    // number of commits between this and previous version
  changeSummary     String?  @db.Text       // human-readable summary of changes

  // Promotions (lifecycle status is derived from the latest ChangePromotion)
  promotions        ChangePromotion[]

  @@unique([digitalProductId, version])
  @@index([gitTag])
}
```

**User Reference Convention:** `shippedBy` and similar user-referencing fields across the new models use bare `String` (userId) rather than Prisma FK relations to `User`. This is intentional: these are audit/attribution fields, not structural relationships. Adding FK relations would require cascading logic on user deletion (which should never delete audit records) and adds schema complexity without benefit. The pattern is consistent with how `ChangePromotion.requestedBy`, `approvedBy`, `rejectedBy`, and `rolledBackBy` store user IDs.

### How shipBuild() Evolves

Current `shipBuild()` in `build.ts`:
1. Resolve portfolio and taxonomy node
2. Create or update DigitalProduct (bump version)
3. Link build to product

Extended `shipBuild()`:
1. Resolve portfolio and taxonomy node
2. Create or update DigitalProduct (bump version) — **unchanged**
3. Link build to product — **unchanged**
4. **NEW:** Create git tag `v{version}` with structured message
5. **NEW:** Generate CodebaseManifest for this version
6. **NEW:** Create `ProductVersion` record linking version → git tag → manifest
7. **NEW:** Create `ChangePromotion` record (status: "pending")

Steps 4-7 are additive — they don't change the existing transaction logic. If any new step fails, the product update still succeeds (the version is in the DB even without a tag). A background job can reconcile missing tags.

### Version History Query

The production agent (or any agent) can query version history. Since `ProductVersion` does not own lifecycle status, the query joins to the latest `ChangePromotion` to derive it:

```sql
SELECT pv.version, pv.gitTag, cp.status AS promotionStatus,
       pv.shippedAt, pv.changeSummary
FROM ProductVersion pv
LEFT JOIN LATERAL (
  SELECT status FROM ChangePromotion
  WHERE productVersionId = pv.id
  ORDER BY createdAt DESC LIMIT 1
) cp ON true
WHERE pv.digitalProductId = ?
ORDER BY pv.shippedAt DESC
```

In Prisma, this is a `findMany` on `ProductVersion` with `include: { promotions: { orderBy: { createdAt: 'desc' }, take: 1 } }`.

This powers the `query_version_history` tool.

---

## Section 4: Codebase Manifest (SBOM)

### Dual Purpose

The CodebaseManifest serves two audiences:

1. **AI agents** — structured codebase map for orientation. Instead of iteratively listing directories and reading files to understand the project, the agent reads the manifest and immediately knows: what modules exist, what they do, how they relate, what capabilities they implement.

2. **Compliance** — standard-format software bill of materials for regulated industries. Tracks external dependencies, licenses, and component provenance. Can be exported as CycloneDX or SPDX.

### Manifest Structure

```json
{
  "version": "1.2.0",
  "gitRef": "abc123def456",
  "generatedAt": "2026-03-17T04:30:00Z",

  "platform": {
    "name": "Open Digital Product Factory",
    "description": "A digital product management platform with AI coworker capabilities",
    "techStack": {
      "framework": "Next.js 16",
      "language": "TypeScript (strict)",
      "database": "PostgreSQL via Prisma ORM",
      "graph": "Neo4j (enterprise architecture)",
      "ai": "Ollama (local) + MCP endpoint routing",
      "containerization": "Docker Compose"
    }
  },

  "modules": [
    {
      "id": "web-app",
      "name": "Web Application",
      "path": "apps/web/",
      "description": "Main Next.js application — agent coworker, portfolio management, build studio, operational dashboards",
      "entryPoints": ["apps/web/app/layout.tsx"],
      "keyFiles": [
        "apps/web/lib/actions/agent-coworker.ts",
        "apps/web/lib/mcp-tools.ts",
        "apps/web/lib/codebase-tools.ts",
        "apps/web/lib/agent-router.ts",
        "apps/web/lib/actions/build.ts"
      ],
      "capabilities": ["agent-coworker", "portfolio-management", "build-studio", "ops-management"],
      "internalDependencies": ["database", "shared-config"]
    },
    {
      "id": "database",
      "name": "Database Package",
      "path": "packages/db/",
      "description": "Prisma schema, migrations, seed data, and database client",
      "entryPoints": ["packages/db/prisma/schema.prisma"],
      "keyFiles": ["packages/db/prisma/schema.prisma"],
      "capabilities": ["data-model"],
      "internalDependencies": []
    }
  ],

  "capabilityMap": {
    "agent-coworker": {
      "description": "AI coworker chat interface with MCP tool execution, advise/act modes, and sub-task delegation",
      "taxonomyNodeId": "tn-agent",
      "implementedBy": [
        "apps/web/lib/actions/agent-coworker.ts",
        "apps/web/lib/mcp-tools.ts",
        "apps/web/lib/prompt-assembler.ts",
        "apps/web/lib/agent-router.ts"
      ],
      "dataModels": ["AgentMessage", "AgentThread", "AgentActionProposal"]
    },
    "self-development": {
      "description": "Platform self-development via AI agents — codebase access, sandbox isolation, build workflow, change promotion",
      "taxonomyNodeId": "tn-self-dev",
      "implementedBy": [
        "apps/web/lib/codebase-tools.ts",
        "apps/web/lib/sandbox.ts",
        "apps/web/lib/actions/build.ts",
        "apps/web/lib/feature-build-types.ts"
      ],
      "dataModels": ["FeatureBuild", "FeaturePack", "DigitalProduct", "ProductVersion", "ChangePromotion"]
    }
  },

  "externalDependencies": [
    { "name": "next", "version": "16.x", "license": "MIT", "purpose": "Web framework" },
    { "name": "@prisma/client", "version": "6.x", "license": "Apache-2.0", "purpose": "Database ORM" },
    { "name": "ai", "version": "4.x", "license": "Apache-2.0", "purpose": "AI SDK for streaming" }
  ],

  "boundaries": {
    "securitySensitive": [
      "apps/web/lib/codebase-tools.ts",
      "packages/db/prisma/schema.prisma",
      "apps/web/lib/permissions.ts",
      "apps/web/lib/governance-resolver.ts"
    ],
    "configFiles": [
      "docker-compose.yml",
      "package.json",
      "tsconfig.json"
    ]
  },

  "statistics": {
    "totalFiles": 142,
    "totalLines": 28500,
    "moduleCount": 2,
    "externalDependencyCount": 47,
    "dataModelCount": 31
  }
}
```

### What Each Section Gives the Agent

| Section | Agent Use |
|---|---|
| `platform` | Immediate grounding — "I'm looking at a Next.js/TypeScript platform with Prisma and Ollama" |
| `modules` | Navigation — "the build system is in `apps/web/lib/actions/build.ts`" |
| `capabilityMap` | Intent mapping — "to change the agent coworker, I need these files and models" |
| `externalDependencies` | Constraint awareness — "this uses Prisma 6, I should use its API conventions" |
| `boundaries` | Caution zones — "this file is security-sensitive, changes need extra care" |
| `statistics` | Scale awareness — "this is a medium-sized codebase with N models" |

### Generation

The manifest is generated at two times:

1. **On `shipBuild()`** — mandatory, stored as a `ProductVersion` artifact
2. **On demand** — via a `generate_codebase_manifest` tool (dev-only)

Generation is hybrid:

- **Auto-generated:** External dependencies (parsed from `package.json` files), directory structure, file counts, data models (parsed from `schema.prisma`), technology detection
- **Human-maintained:** Module descriptions, capability mappings, security boundaries. These are stored in a `codebase-manifest.base.json` file at the project root. The generator reads this base file and overlays auto-generated data.
- **AI-proposed:** The agent can propose updates to the base manifest via `propose_file_change` on `codebase-manifest.base.json`. Over time, the manifest becomes richer as agents discover and document the codebase.

### Data Model

```prisma
model CodebaseManifest {
  id                String   @id @default(cuid())
  version           String          // matches DigitalProduct version
  gitRef            String          // commit hash this was generated from
  manifest          Json            // the full manifest JSON (structure above)
  digitalProductId  String?
  digitalProduct    DigitalProduct? @relation(fields: [digitalProductId], references: [id])
  generatedAt       DateTime @default(now())

  // Backlink from ProductVersion
  productVersion    ProductVersion?

  @@unique([version, digitalProductId])
  @@index([digitalProductId])
}
```

**Nullable unique constraint:** `digitalProductId` is nullable because the `generate_codebase_manifest` dev tool can create standalone manifests not tied to a product version (e.g., for agent orientation during development). PostgreSQL treats each NULL as distinct in unique constraints, so multiple standalone manifests with the same `version` string can coexist. This is acceptable — standalone manifests are ephemeral dev aids, not versioned artifacts. Product-linked manifests (where `digitalProductId` is non-null) are properly deduplicated by the constraint.

### File Storage

In addition to the DB record, the generated manifest is written to `codebase-manifest.json` at the project root. This file is:

- Committed to git (so it's available at every tag)
- Readable by the production agent via `git show <tag>:codebase-manifest.json`
- Readable by the dev agent via `read_project_file("codebase-manifest.json")`

The base manifest (`codebase-manifest.base.json`) is the human/AI-maintained template. The generated manifest (`codebase-manifest.json`) is the computed output. Both are version-controlled.

---

## Section 5: Production Agent Access

### Problem

The production agent today has zero codebase awareness. `isDevInstance()` returns false, so all four codebase tools return `"Codebase access is only available on dev instances."` This is correct — there's no source code to read. But the agent should still understand what it's running.

### New Tools for Production

Two categories of tools give the production agent codebase awareness. See Section 9 for the canonical tool list.

**Universal tools (DB-based, work in any environment):**

| Tool | Description | Implementation |
|---|---|---|
| `read_codebase_manifest` | Read the SBOM/manifest for a version (default: deployed version) | DB query on `CodebaseManifest` or `git show <tag>:codebase-manifest.json` |
| `query_version_history` | List product versions with dates, change counts, promotion status | DB query on `ProductVersion` + `ChangePromotion` |

**Production-only tools (git-based, require `.git` mount):**

| Tool | Description | Implementation |
|---|---|---|
| `read_source_at_version` | Read a specific file at a specific version | `git show <tag>:<path>` with path security |
| `search_source_at_version` | Search codebase at a specific version | `git grep <query> <tag>` with path security |
| `list_source_directory` | List directory contents at a specific version | `git ls-tree <tag> <path>` with path security |
| `compare_versions` | Show what changed between two versions | `git diff <tag1> <tag2> --stat` + `git log <tag1>..<tag2>` |

### Tool Registration

These tools are registered in `mcp-tools.ts` with:
- `requiredCapability: "view_platform"` — any authenticated user can query
- `executionMode: "immediate"` — read-only, no side effects
- `sideEffect: false` — available in Advise mode

### Path Security for Git Tools

The `read_source_at_version` and `search_source_at_version` tools reuse `isPathAllowed()` from `codebase-tools.ts` to filter results. Even though files are read from git (not filesystem), the same security rules apply — no `.env`, no credentials, no `node_modules`.

### Deployed Version Awareness

The production agent knows what version it's running via `process.env.DEPLOYED_VERSION`. Tools default to this version when no version parameter is provided:

```typescript
const version = params.version ?? process.env.DEPLOYED_VERSION ?? "HEAD";
```

### Comparing Dev vs Production

The `compare_versions` tool enables the production agent to answer questions like:

- "What's different between what's deployed and what's in dev?"
- "Are there pending changes that haven't been promoted yet?"
- "What was the last change to the agent router?"

```typescript
// Example: compare deployed version to latest dev
compare_versions({ from: process.env.DEPLOYED_VERSION, to: "HEAD" })
// Returns: { filesChanged: 12, summary: "...", commits: [...] }
```

### Git Availability Check

Production tools check for `.git` directory availability before executing:

```typescript
function isGitAvailable(): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: PROJECT_ROOT, timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}
```

If git is not available (`.git` not mounted), the tools fall back to DB-only mode. `read_codebase_manifest` and `query_version_history` work from the database. File-level tools (`read_source_at_version`, etc.) return:

> "Git history is not available in this deployment. Use read_codebase_manifest for codebase orientation."

---

## Section 6: Trust-Gated Code Complexity (Trusted AI Kernel Extension)

### How Trust Connects to Code Changes

The Trusted AI Kernel (from the orchestrated task routing spec) defines three trust phases per endpoint per task type: **Learning → Practicing → Innate**. The `code-gen` task type is already defined in the task type registry.

For self-development, trust determines **what complexity of code work an endpoint receives**, not whether it can access the codebase. Authority separation is preserved:

- **Trust** → what work the endpoint GETS (routing decision)
- **HR role** → what the endpoint can DO (permission check)
- **Advise/Act toggle** → whether side effects execute (mode check)

### Trust-Gated Code Complexity

| Trust Phase | Code Work Received | Instruction Intensity | Example |
|---|---|---|---|
| **Learning** | Simple, isolated changes. Single-file edits with clear scope. | Heavy — detailed coding guidelines, style rules, file conventions | "Add a new field to this form component" |
| **Practicing** | Multi-file changes within one module. Moderate complexity. | Moderate — key constraints only | "Implement a new MCP tool with handler" |
| **Innate** | Cross-module changes, architectural modifications, schema changes. | Minimal — the endpoint has proven it understands the codebase | "Refactor the observer pipeline to add a new branch" |

### How This Works in Practice

The task classifier identifies a `code-gen` task. The router checks `EndpointTaskPerformance` for the `code-gen` task type:

1. **If Learning:** Route only if the change is scoped to a single file (detected by build brief or agent request). Inject detailed instructions about the target module (from the codebase manifest).
2. **If Practicing:** Route for multi-file changes within a single module. Inject module-level context from the manifest.
3. **If Innate:** Route for any code change. Inject minimal context — the endpoint knows the codebase.

### Instruction Injection for Code Tasks

The orchestrator injects codebase context from the manifest into the sub-agent's prompt:

**Learning phase instruction example:**

```
You are modifying a file in the web application's agent system.

Module: apps/web/lib/ (AI coworker tools and routing)
Framework: Next.js 16, TypeScript strict mode
Key conventions:
- Server actions use "use server" directive
- All database access through Prisma client (@dpf/db)
- Tool definitions follow the ToolDefinition type in mcp-tools.ts
- File operations must use isDevInstance() guard
- Path security via isPathAllowed() for any file access

Related files you should understand:
- apps/web/lib/mcp-tools.ts (tool registry)
- apps/web/lib/codebase-tools.ts (file access)

Do NOT:
- Import from node_modules directly (use package aliases)
- Modify files outside the specified scope
- Skip TypeScript strict mode checks
```

**Innate phase instruction example:**

```
Codebase: Next.js 16, TypeScript, Prisma. See codebase-manifest.json for full context.
```

### Evaluation of Code Changes

The orchestrator evaluator (from the task routing spec) grades code-gen responses with additional criteria:

- Does the proposed change compile? (type-check pass)
- Does it follow existing conventions? (style consistency)
- Is the scope appropriate? (no unnecessary changes)
- Are security boundaries respected? (no sensitive file modifications without justification)

These criteria augment the standard quality score. Poor code-gen evaluations trigger regression to Learning, same as any other task type.

---

## Section 7: Change Management & Approval Gates

### Three Gates

The platform targets regulated industries. Every code change flows through three approval gates, each producing auditable evidence:

```
Gate 1: PROPOSE          Gate 2: SHIP              Gate 3: DEPLOY
─────────────────        ─────────────────         ─────────────────
Individual change        Aggregate changes          Production deployment
Agent → Human            Build → Human              Promotion → Human
Per-file approval        Per-build approval         Per-version approval
Evidence: proposal       Evidence: version tag      Evidence: promotion record
  card + diff              + manifest + changelog     + deployment log
```

### Gate 1: Propose (Per-Change HITL)

**Already exists.** The `propose_file_change` tool creates an `AgentActionProposal` with diff preview. Human clicks "Approve & Apply" or "Reject." The proposal record, including the diff, is persisted in the database.

**Extension:** On approval, the auto-commit adds git-level evidence. The commit message references the proposal ID.

### Gate 2: Ship (Per-Build HITL)

**Already exists** in the UI flow. `shipBuild()` requires the human to click "Ship" in the Build Studio.

**Extension:** Shipping now also:
- Creates a git tag (evidence of what code constitutes this version)
- Generates a CodebaseManifest (evidence of codebase state at this version)
- Creates a `ProductVersion` record (evidence of version history)
- Creates a `ChangePromotion` record (initiates the deployment approval)

The human sees an aggregate view of all changes in this build before clicking Ship — the diff summary (`FeatureBuild.diffSummary`) and the commit log since the last tag.

### Gate 3: Deploy (Per-Promotion HITL)

**New.** A `ChangePromotion` record tracks the lifecycle of a version from "shipped" to "deployed":

```
pending → approved → deploying → deployed
    ↘ rejected       ↘ failed
                        ↘ rolled_back
```

The promotion approval UI shows:
- Version being promoted (e.g., "v1.3.0")
- Changes included (commit log between previous deployed version and this version)
- SBOM diff (new dependencies, removed dependencies, changed modules)
- Who shipped it and when
- Risk assessment (which modules were touched, are any security-sensitive?)

The human reviews and approves or rejects. Approval triggers CI/CD.

### Audit Evidence Chain

For any production change, the full evidence chain is:

1. `AgentActionProposal` — what was proposed, who approved, diff
2. Git commit — what was committed, when, by whom (commit message metadata)
3. `ProductVersion` — what version, what git tag, what manifest
4. `ChangePromotion` — who approved deployment, when, rationale
5. `AuthorizationDecisionLog` — every tool execution along the way

This satisfies evidence requirements for regulated environments: every change is traceable from proposal through production.

---

## Section 8: Data Model Changes

### New Models

#### ChangePromotion

```prisma
model ChangePromotion {
  id                String    @id @default(cuid())
  promotionId       String    @unique  // "CP-XXXXX"

  // What's being promoted
  productVersionId  String
  productVersion    ProductVersion @relation(fields: [productVersionId], references: [id])

  // Status
  status            String    @default("pending")  // pending | approved | rejected | deploying | deployed | failed | rolled_back

  // Approval
  requestedBy       String          // userId who shipped the build
  approvedBy        String?         // userId who approved the promotion (human)
  approvedAt        DateTime?
  rejectedBy        String?
  rejectedAt        DateTime?
  rationale         String?  @db.Text  // human's approval/rejection reason

  // Deployment
  deployedAt        DateTime?
  deploymentLog     String?  @db.Text  // CI/CD output or deployment notes
  rolledBackAt      DateTime?
  rolledBackBy      String?
  rollbackReason    String?  @db.Text

  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([status])
  @@index([productVersionId])
}
```

#### ProductVersion

(Defined in Section 3 — see above for full schema.)

#### CodebaseManifest

(Defined in Section 4 — see above for full schema.)

### Extended Models

#### FeatureBuild — New Fields

```prisma
model FeatureBuild {
  // ... existing fields ...
  gitCommitHashes   String[]  @default([])  // commits made during this build
  productVersions   ProductVersion[]        // versions shipped from this build
}
```

#### DigitalProduct — New Relation

```prisma
model DigitalProduct {
  // ... existing fields ...
  versions          ProductVersion[]
  manifests         CodebaseManifest[]
}
```

#### AgentActionProposal — New Field

```prisma
model AgentActionProposal {
  // ... existing fields ...
  gitCommitHash     String?   // set after auto-commit on approval
}
```

### No Schema Changes Needed

The following existing models are sufficient without modification:
- `AgentMessage` — already extended with `taskType` and `routedEndpointId` in the task routing spec
- `AuthorizationDecisionLog` — already extended with `endpointUsed`, `mode`, `routeContext`, `sensitivityLevel` in the unified coworker spec
- `TaxonomyNode` — already links to DigitalProduct; the capability map in the manifest references taxonomy nodes by ID

---

## Section 9: New MCP Tools

### Dev-Only Tools (Already Existing)

No changes to `read_project_file`, `search_project_files`, `list_project_directory`. The `propose_file_change` handler gains auto-commit behavior (Section 2) but its tool definition is unchanged.

### New Dev-Only Tool

| Tool | Description |
|---|---|
| `generate_codebase_manifest` | Generate/refresh the codebase manifest. Reads package.json, schema.prisma, directory structure, and base manifest to produce a current snapshot. |

### New Universal Tools (Dev + Production)

| Tool | Description |
|---|---|
| `read_codebase_manifest` | Read the codebase manifest for a given version (default: current/deployed). Returns the structured JSON. |
| `query_version_history` | List product versions with status, dates, and change summaries. Supports filtering by product and status. |

### New Production-Only Tools

| Tool | Description |
|---|---|
| `read_source_at_version` | Read a file from git at a specific version tag. Uses `git show`. |
| `search_source_at_version` | Search codebase at a specific version. Uses `git grep`. |
| `list_source_directory` | List directory contents at a version. Uses `git ls-tree`. |
| `compare_versions` | Diff between two versions. Uses `git diff --stat` + `git log`. |

All new tools use `requiredCapability: "view_platform"` and `sideEffect: false`.

**Gating conditions:**
- Dev-only tools: gated by `isDevInstance()` (existing pattern)
- Universal tools: no instance-type gate — DB queries work in both environments
- Production-only tools (git-based): gated by `!isDevInstance() && isGitAvailable()`. On dev instances, the existing filesystem tools (`read_project_file`, etc.) are preferred. On production without git mount, these tools return a graceful degradation message.

---

## Section 10: Git Utilities Module

A new `git-utils.ts` module handles all git operations. It is used by `mcp-tools.ts` (for auto-commit and tool execution) and `build.ts` (for tagging on ship).

```typescript
// apps/web/lib/git-utils.ts

export async function commitFile(opts: {
  filePath: string;
  message: string;
  buildId?: string;
  approvedBy: string;
}): Promise<{ hash: string } | { error: string }>

export async function createTag(opts: {
  tag: string;
  message: string;
}): Promise<{ ok: true } | { error: string }>

export async function gitShow(opts: {
  ref: string;
  path: string;
}): Promise<{ content: string } | { error: string }>

export async function gitLog(opts: {
  from?: string;
  to?: string;
  maxCount?: number;
}): Promise<{ commits: Array<{ hash: string; message: string; date: string }> }>

export async function gitDiffStat(opts: {
  from: string;
  to: string;
}): Promise<{ filesChanged: number; summary: string }>

export async function gitGrep(opts: {
  query: string;
  ref: string;
  glob?: string;
  maxResults?: number;
}): Promise<{ results: Array<{ path: string; line: number; text: string }> }>

export async function gitLsTree(opts: {
  ref: string;
  path: string;
}): Promise<{ entries: Array<{ name: string; type: "file" | "dir"; path: string }> }>

export function isGitAvailable(): boolean
```

All async functions use `promisify(exec)` from `child_process` (not `execSync`) to avoid blocking the Node.js event loop during git operations. The one exception is `isGitAvailable()`, which uses `execSync` because it is a fast, synchronous availability check. Path security is enforced by applying `isPathAllowed()` to any path-based operations. Git commands have a 10-second timeout to prevent hanging.

---

## Section 11: Migration Strategy

Phases 1-2 (unified coworker identity, MCP routing) are defined in `2026-03-16-unified-mcp-coworker-design.md`. Phases 3a-3d (orchestrated task routing, Trusted AI Kernel) and Phase 4 (workforce admin dashboard) are defined in `2026-03-16-orchestrated-task-routing-design.md`. This spec defines Phases 5a-5e.

### Phase 5a: Git Integration Foundation

- Create `git-utils.ts` module with commit, tag, show, log, diff, grep, ls-tree functions
- Extend `propose_file_change` handler to auto-commit on approval
- Extend `shipBuild()` to create git tags
- Add `gitCommitHashes` field to `FeatureBuild`
- Add `gitCommitHash` field to `AgentActionProposal`

### Phase 5b: Version Tracking

- Add `ProductVersion` model to Prisma schema
- Add `ChangePromotion` model to Prisma schema
- Extend `shipBuild()` to create `ProductVersion` records
- Create `ChangePromotion` on ship (status: "pending")
- Add `query_version_history` tool

### Phase 5c: Codebase Manifest

- Define manifest JSON schema
- Create `CodebaseManifest` model in Prisma schema
- Implement manifest generator (reads package.json, schema.prisma, directory structure)
- Create `codebase-manifest.base.json` template
- Add `generate_codebase_manifest` tool (dev-only)
- Add `read_codebase_manifest` tool (universal)
- Generate manifest on `shipBuild()` → commit + tag includes the manifest

### Phase 5d: Production Agent Access

- Mount `.git` read-only in production Docker Compose
- Implement production-only tools: `read_source_at_version`, `search_source_at_version`, `list_source_directory`, `compare_versions`
- Add `DEPLOYED_VERSION` env var to production config
- Register production tools in `mcp-tools.ts` (gated by `!isDevInstance() && isGitAvailable()`)

### Phase 5e: Promotion Pipeline UI

- Change promotion list view (pending promotions requiring approval)
- Promotion detail view (changes, manifest diff, risk assessment)
- Approve/reject flow with rationale capture
- Deployment trigger integration (initially manual; CI/CD hook later)

---

## Alternatives Considered

### A: Git Tags + DB Manifest Only (Minimal)

Add git tagging to `shipBuild()` and store SBOM in DB. No git mount in production, no auto-commit, no promotion model.

**Rejected because:** Without auto-commit, approved changes remain filesystem-only and can be lost. Without the promotion model, there's no deployment approval gate for regulated industries. Without production git access, the production agent has no way to understand the codebase.

### B: Platform-Centric (No Git Exposure)

All versioning, manifests, and promotions live in the database. Git is an implementation detail never exposed to agents.

**Rejected because:** Git provides capabilities the database can't replicate: efficient diffing, file-at-version retrieval, blame history, merge tracking. Reimplementing these in the platform would be enormous effort for inferior results. Git is the right tool for source control — the platform should govern the process, not replace the tool.

### C: Full Git Workflow (Branches + PRs)

Each FeatureBuild creates a git branch. Ship creates a PR. Promotion merges the PR. Standard GitHub-flow.

**Rejected because:** Mark's explicit preference is to work on main (no worktrees/feature branches — prior workflow caused lost work). The serial, trunk-based model (commit to main, tag versions) is simpler and fits a single-developer + AI-agents workflow. Multi-developer scenarios can adopt branching later if needed.

---

## Rollback Strategy

Each phase is independently revertable:

- **Phase 5a (Git Integration):** Auto-commit is additive — if git fails, file write still succeeds (current behavior). Remove auto-commit code to revert.
- **Phase 5b (Version Tracking):** New tables are additive. `shipBuild()` extension is wrapped in try/catch — tag/version failures don't block shipping. Revert by removing the extension.
- **Phase 5c (Manifest):** Manifest generation is optional. If it fails, shipping continues. The manifest file is just another file in the repo.
- **Phase 5d (Production Tools):** Tools are additive registrations. Remove from tool registry to revert. Git mount is a Docker volume — remove from compose to revert.
- **Phase 5e (Promotion UI):** UI-only. Revert by deploying previous UI.

---

## Files Affected

| File | Change |
|------|--------|
| `apps/web/lib/git-utils.ts` | NEW — git operations module (commit, tag, show, log, diff, grep, ls-tree) |
| `apps/web/lib/codebase-tools.ts` | Minor — export `isPathAllowed` for use by git-utils (already exported) |
| `apps/web/lib/mcp-tools.ts` | Extend `propose_file_change` handler with auto-commit; register 7 new tools |
| `apps/web/lib/actions/build.ts` | Extend `shipBuild()` with git tag, ProductVersion, ChangePromotion, manifest generation |
| `apps/web/lib/manifest-generator.ts` | NEW — codebase manifest generation from package.json, schema, directory structure, base template |
| `packages/db/prisma/schema.prisma` | Add ProductVersion, ChangePromotion, CodebaseManifest models; extend FeatureBuild and AgentActionProposal |
| `docker-compose.yml` | Add `.git` read-only volume mount to portal service; add `DEPLOYED_VERSION` env var |
| `codebase-manifest.base.json` | NEW — human/AI-maintained base manifest template at project root |
| `apps/web/app/(protected)/platform/ops/` | Promotion approval UI (Phase 5e) |

---

## Future Connections

### CI/CD Integration

The `ChangePromotion` model is designed to trigger CI/CD pipelines. Initially, promotion approval is a manual gate with manual deployment. Future: approval triggers a webhook/action that rebuilds the production image from the tagged commit and deploys it. The `deploymentLog` field captures CI/CD output.

### Multi-Instance Promotion

The current design assumes one dev + one production. Future: multiple environments (dev → staging → production) with promotion flowing through each. The `ChangePromotion` model supports this by chaining promotions — each environment gets its own promotion record.

### Corporate Knowledge Memory

Version history and change summaries are raw material for the future knowledge memory system. The `changeSummary` on `ProductVersion` and the commit messages provide a narrative of how the platform evolved — searchable, queryable, and attributable to specific builds and agents.

### Automated Rollback

The `rolled_back` status on `ChangePromotion` and `rolledBackBy` / `rollbackReason` fields prepare for automated rollback. If the production agent detects a regression (via the observer pipeline), it could propose a rollback to the previous version — still requiring human approval through the promotion gate.

### SBOM Vulnerability Scanning

The `externalDependencies` section of the codebase manifest can be fed into vulnerability scanners (e.g., Snyk, Trivy, OSV). The manifest is regenerated on each version, so vulnerability status is always current. Findings could flow into the existing backlog as `source: "security_scan"` items.
