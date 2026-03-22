# EP-DEVCONTAINER-001: VS Code Dev Container for Platform Development

**Date:** 2026-03-22
**Epic:** EP-DEVCONTAINER-001
**Status:** Approved

---

## Problem

Developers and AI-assisted workflows need an isolated development environment that mirrors production without risking production data. Today, native developer mode runs Next.js on the host and connects to Docker-hosted databases directly. There is no separation between production and development data, no sanitization pipeline, and no way for the production portal's Build Studio to target an isolated dev instance for non-technical users.

The dev container is the human developer's workshop (via VS Code) and the AI co-worker's target environment (via Build Studio). It is not a sandbox -- sandboxes are ephemeral, single-feature containers managed by Build Studio. The dev container is persistent, long-lived, and holds a sanitized copy of production data for realistic testing.

## Architecture

### Two Access Paths, One Dev Environment

```
Production Portal (Build Studio, AI co-worker)
        |
        v
+-------------------+      +-------------------+
| dev-portal        |<---->| VS Code Dev       |
| Next.js dev server|      | Container attach  |
| DPF_ENVIRONMENT=  |      | (technical users) |
| dev               |      +-------------------+
+-------------------+
        |
   +----+----+----+
   |    |    |    |
   v    v    v    v
dev-   dev-  dev-  Docker Model
pg     neo4j qdrant Runner (shared)
```

- **Non-technical users** work through the production portal's Build Studio, which targets the dev environment
- **Technical users** attach VS Code directly to the dev-portal container via the Dev Containers extension
- Both operate against the same isolated dev databases with sanitized production data
- LLM inference is shared with production via Docker Model Runner on the compose network

### Recursion Guard

The dev environment must NOT allow Build Studio to launch sandboxes. Without this guard, a dev instance could spawn another dev instance recursively.

Environment variable `DPF_ENVIRONMENT` controls this:
- `production` (default) -- full Build Studio, sandbox launch, promotion pipeline
- `dev` -- Build Studio is read-only (view builds, no launch). Sandbox creation throws an error.

Check points:
- `lib/sandbox.ts` -> `createSandbox()` -- reject if `DPF_ENVIRONMENT === 'dev'`
- `lib/sandbox-db.ts` -> same guard on sandbox DB stack creation
- `components/build/BuildStudio.tsx` -- show read-only banner, disable launch actions

What still works in dev: full portal navigation, all routes, AI co-worker conversations (shared LLM), all CRUD against dev databases, viewing existing builds, running tests and typecheck.

## Compose Services

All dev services are gated behind `profiles: ["dev"]` so `docker compose up -d` never starts them. Start with `docker compose --profile dev up -d`.

### New Services

| Service | Image/Target | Purpose | Host Port |
|---------|-------------|---------|-----------|
| `dev-postgres` | `postgres:16-alpine` | Isolated dev database | 5433 |
| `dev-neo4j` | `neo4j:5-community` | Isolated dev graph DB | 7475 (browser), 7688 (bolt) |
| `dev-qdrant` | `qdrant/qdrant:latest` | Isolated dev vector store | 6334 |
| `dev-portal` | Dockerfile `dev` target | Next.js dev server, source bind-mounted | 3001 |
| `dev-init` | Dockerfile `dev` target | One-shot: migrations + sanitized clone | -- |

### Volumes (isolated from production)

- `dev-pgdata` -- dev PostgreSQL data
- `dev-neo4jdata` -- dev Neo4j data
- `dev-qdrant-data` -- dev Qdrant storage

### Network

All dev services join the default compose network. This means:
- `dev-portal` can reach `model-runner.docker.internal` for LLM inference (shared)
- Dev services use distinct hostnames (`dev-postgres` vs `postgres`) so no collision
- The production portal can reach `dev-portal` for Build Studio integration

### Environment Variables (dev-portal)

```
DATABASE_URL=postgresql://dpf:dpf_dev@dev-postgres:5432/dpf
NEO4J_URI=bolt://dev-neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=dpf_dev_password
QDRANT_INTERNAL_URL=http://dev-qdrant:6333
LLM_BASE_URL=http://model-runner.docker.internal/v1
DPF_ENVIRONMENT=dev
AUTH_SECRET=dev_secret_change_me
AUTH_TRUST_HOST=true
CREDENTIAL_ENCRYPTION_KEY=dev_only_key_not_for_production_0000
```

`AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY` are fixed dev-only values. This is acceptable because the dev environment is not externally exposed -- auth tokens and encrypted credentials do not need production-grade secrets.

### Environment Variables (dev-init)

```
DATABASE_URL=postgresql://dpf:dpf_dev@dev-postgres:5432/dpf
PRODUCTION_DATABASE_URL=postgresql://dpf:dpf_dev@postgres:5432/dpf
NEO4J_URI=bolt://dev-neo4j:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=dpf_dev_password
PRODUCTION_NEO4J_URI=bolt://neo4j:7687
DPF_ENVIRONMENT=dev
```

`PRODUCTION_DATABASE_URL` and `PRODUCTION_NEO4J_URI` point to the production services on the shared compose network. The dev-init container can reach them because all services share the default network.

### Production Portal Environment Addition

Add `DPF_ENVIRONMENT=production` explicitly to the production `portal` service in `docker-compose.yml`. While the recursion guard defaults correctly when unset, being explicit is better practice for a regulated-industry platform where implicit defaults are risky.

## Dockerfile Changes

New `dev` stage branching from `base` (parallel to the production `deps` chain, not inserted into it):

```dockerfile
FROM base AS dev
WORKDIR /workspace
RUN apk add --no-cache git
CMD ["sh", "-c", "pnpm install && pnpm --filter @dpf/db exec prisma generate && pnpm --filter web dev"]
```

- Lightweight: Node 20 + pnpm (from `base`) + git
- Source is bind-mounted from host repo root to `/workspace` at runtime (compose: `.:/workspace`), not baked in. `.dockerignore` does not affect this since it uses bind mounts, not COPY.
- CMD installs deps, generates Prisma client, starts Next.js with hot-reload
- `dev-init` overrides CMD to run migrations + sanitized clone

Production stages (`deps`, `build`, `init`, `runner`) are untouched.

### Health Checks

Dev database services mirror production health check configurations:
- `dev-postgres`: `pg_isready -U dpf` (interval 5s, timeout 5s, retries 5)
- `dev-neo4j`: `wget -qO /dev/null http://localhost:7474` (interval 10s, timeout 10s, retries 5, start_period 30s)
- `dev-qdrant`: `curl -f http://localhost:6333/readyz` (interval 10s, timeout 5s, retries 3, start_period 10s)

### Service Dependencies

`dev-init` depends on:
- `dev-postgres`: condition `service_healthy`
- `dev-neo4j`: condition `service_healthy`
- `dev-qdrant`: condition `service_healthy`
- `postgres`: condition `service_healthy` (production DB, source for sanitized clone)

`dev-portal` depends on:
- `dev-init`: condition `service_completed_successfully`

## Sanitized Clone Pipeline

### Trigger

The `dev-init` service runs the clone as part of startup:
1. Run Prisma migrations against dev-postgres (schema only)
2. Connect to production postgres via `PRODUCTION_DATABASE_URL`
3. Execute the sanitization pipeline
4. Clone Neo4j graph structure with obfuscation
5. Qdrant is seeded empty (embeddings regenerate from usage)

### Classification-Driven Sanitization

The sanitization script uses a manually-maintained table-to-sensitivity mapping, informed by the platform's route sensitivity classifications in `lib/agent-sensitivity.ts`. Route sensitivity classifies URL paths; the clone script must map those classifications to the 194 Prisma models that serve each route.

This mapping is a configuration object in `sanitized-clone.ts`. Every Prisma model must be explicitly classified. **Unmapped tables default to `confidential`** -- the safe default ensures new models added without classification are obfuscated rather than copied verbatim. The follow-on audit epic (EP-DEVDATA-AUDIT-001) catches these gaps.

Sanitization rules per sensitivity level:

| Sensitivity | Example Tables | Clone Strategy |
|-------------|---------------|----------------|
| **public** | TaxonomyNode, EaElementType, EaRelationshipType, StorefrontArchetype | Copy verbatim |
| **internal** | Portfolio, DigitalProduct, EaElement, EaView, FeatureBuild, Epic, BacklogItem | Copy verbatim -- operator's own work, valuable for realistic testing |
| **confidential** | User, EmployeeProfile, Team, Customer, Agent governance profiles | Obfuscate PII: names -> "Dev User NNN", emails -> `devNNN@dpf.test`, phone -> `555-0NNN`. Preserve relationships and role assignments. |
| **restricted** | ModelProvider credentials, CREDENTIAL_ENCRYPTION_KEY, API keys, AuthorizationDecisionLog | Never copy. Generate fresh dev-only credentials. Provider registry structure copied but secrets replaced with empty/placeholder values. |

### Audit Trail Handling

Copy the last 50 records from governance/audit tables with user references pointing to the obfuscated identities. Enough to test the audit UI without leaking production history.

### Neo4j Clone

Clone graph structure (nodes and relationships) using APOC export/import procedures (already enabled via the `NEO4J_PLUGINS: '["apoc"]'` configuration). The script connects to production Neo4j via Bolt, exports nodes and relationships as JSON via `apoc.export.json.all`, applies obfuscation rules to person-identifying properties, then imports into dev-neo4j via `apoc.import.json`. Graph topology is preserved -- valuable for testing EA views and relationship queries.

### Implementation

New script: `packages/db/src/sanitized-clone.ts`

- Runnable by `dev-init` or manually: `pnpm --filter @dpf/db exec tsx src/sanitized-clone.ts`
- Classification-to-table mapping defined as a configuration object within the script
- Derived from route sensitivity mappings in `lib/agent-sensitivity.ts`
- Obfuscation is deterministic (same production user always maps to same dev identity) for referential integrity

## VS Code Dev Container Configuration

### .devcontainer/devcontainer.json

References `docker-compose.yml` with the `dev` profile, targeting the `dev-portal` service as the workspace container.

### Pre-installed Extensions

- `dbaeumer.vscode-eslint` -- linting
- `Prisma.prisma` -- schema highlighting, formatting
- `bradlc.vscode-tailwindcss` -- Tailwind IntelliSense
- `esbenp.prettier-vscode` -- formatting

### Post-Create Command

`pnpm install && pnpm --filter @dpf/db exec prisma generate`

Ensures dependencies and Prisma client are ready when the container starts.

### Port Forwarding

Port 3001 (dev-portal's host mapping) forwarded so the developer opens `localhost:3001` in their native browser. Production portal remains on `localhost:3000`.

## README Update

New section "Dev Container Setup" added between "Developer Setup (IDE + Hot-Reload)" and "What's Inside". Covers:

1. **Prerequisites** -- Docker Desktop 4.40+, VS Code with Dev Containers extension
2. **First-time setup** -- Clone repo, ensure production stack is running (sanitized clone source), open in VS Code, "Reopen in Container"
3. **What happens on launch** -- Dev databases start, migrations run, sanitized clone populates dev data, dev server starts on port 3001
4. **Non-technical users** -- Dev environment is also accessible from production portal's Build Studio for AI co-worker-led development without VS Code
5. **Relationship to production** -- Isolated databases, sanitized data, shared LLM. Changes promoted through a separate governed process (future epic).
6. **Recursion note** -- Build Studio is read-only in dev by design

## File Encoding Constraints

All new files in this epic run inside Linux containers or are platform-neutral JSON. Specifically:

- No new PowerShell scripts
- No Unicode, BOM markers, smart quotes, em-dashes, or non-ASCII characters in any file
- Any `.sh` files use `#!/bin/sh`, LF line endings (covered by existing `.gitattributes` rule)
- `sanitized-clone.ts` runs inside a Linux container -- no Windows path issues
- `devcontainer.json` is pure JSON -- no encoding risks
- README updates use plain ASCII markdown

## Follow-On Epics (Not In Scope)

### Dev-to-Production Promotion Pipeline

Governed process to promote changes from dev to production. Must coordinate with business schedules (e.g., a hair salon deploys on Sunday when no clients are booked). Builds on existing `lib/sandbox-promotion.ts` patterns (backup, destructive SQL scanning, diff categorization). Requires calendar integration for scheduling promotion windows.

### EP-DEVDATA-AUDIT-001: Data Classification Accuracy Audit

Recurring audit to ensure the sanitization pipeline correctly classifies all tables. Covers:
- Periodic review of table-to-sensitivity mappings
- Flagging new tables added without classification
- Validating that sanitized clone output contains no restricted/confidential data in cleartext
- Regression testing when new Prisma models are added

This epic must be created in the backlog alongside EP-DEVCONTAINER-001. The sanitization is only as good as its classification accuracy -- this audit ensures drift and gaps are caught before they become compliance issues.

## Decisions

| Decision | Rationale |
|----------|-----------|
| Compose profile (not separate file) | Single file, profile-gated. Follows existing pattern. Dev services never start accidentally. |
| `FROM base` stage (not `runner`) | Lightweight dev image. No production build artifacts to conflict with live source mount. |
| Route-informed table classification | Route sensitivity informs the manual table-to-sensitivity mapping. Unmapped tables default to `confidential` (safe default). 194 models must be explicitly classified. |
| Qdrant seeded empty | Embeddings are derived data. Regenerate from usage. Avoids cloning large collections. |
| Neo4j structure cloned with obfuscation | Graph topology is valuable for EA testing. PII in node properties obfuscated like postgres. |
| Deterministic obfuscation | Same production user always maps to same dev identity. Preserves referential integrity across tables. |
| Build Studio read-only in dev | Prevents recursive sandbox creation. Single env var check at entry points. |
| Shared LLM via Docker Model Runner | Dev and production on same compose network. No duplication of model storage. |
