# Production Install with Consumer/Customizer Modes

**Date:** 2026-03-22
**Epic:** EP-PROD-BUILD-001 — Production Build and Install Path
**Status:** Approved design

## Problem

The current `install-dpf.ps1` clones the full source repository (~4GB build context) and compiles Docker images from source for every installation. This is:

1. **Slow** — first-time builds take 5-10 minutes and transfer 4GB+ of context to Docker
2. **Fragile** — TypeScript errors, dependency mismatches, and build tooling issues surface at install time
3. **Unnecessary for users** — end users don't need source code; they need running software
4. **Conflated** — the same install path serves users who just want to run the platform and developers who want to modify it

Source code should remain available for customization and the platform's self-development sandbox, but the default install path should pull pre-built images.

## Design

### Two install modes, one script

`install-dpf.ps1` presents a choice after Docker is confirmed (Steps 1-3 are identical):

```
"How do you want to use Digital Product Factory?"

  [1] Ready to go    — Pre-built, runs in minutes. No source code needed.
  [2] Customizable   — Full source code. Build and modify to fit your business.
```

If the user chooses **Customizable**, a follow-up:

```
"Would you like to contribute improvements back to the project?"

  [a] Yes — I'll fork on GitHub and submit pull requests
  [b] No  — My changes stay private
```

### Consumer path (mode 1)

The install script writes a `docker-compose.yml` from an embedded template. No git clone, no source, no build step.

**Compose structure (complete — this is what the script embeds):**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-dpf}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: dpf
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-dpf}"]
      interval: 5s
      timeout: 5s
      retries: 5

  neo4j:
    image: neo4j:5-community
    restart: unless-stopped
    environment:
      NEO4J_AUTH: ${NEO4J_AUTH}
      NEO4J_PLUGINS: '["apoc"]'
    volumes:
      - neo4jdata:/data
    healthcheck:
      test: ["CMD-SHELL", "wget -qO /dev/null http://localhost:7474 || exit 1"]
      interval: 10s
      timeout: 10s
      retries: 5
      start_period: 30s

  qdrant:
    image: qdrant/qdrant:latest
    restart: unless-stopped
    volumes:
      - qdrant_data:/qdrant/storage
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/readyz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 10s

  portal-init:
    image: ghcr.io/markdbodman/dpf-portal:${DPF_VERSION:-latest}
    command: ["/docker-entrypoint.sh"]
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-dpf}:${POSTGRES_PASSWORD}@postgres:5432/dpf
      DPF_HOST_PROFILE: ${DPF_HOST_PROFILE:-}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy

  portal:
    image: ghcr.io/markdbodman/dpf-portal:${DPF_VERSION:-latest}
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-dpf}:${POSTGRES_PASSWORD}@postgres:5432/dpf
      AUTH_SECRET: ${AUTH_SECRET}
      CREDENTIAL_ENCRYPTION_KEY: ${CREDENTIAL_ENCRYPTION_KEY}
      NEO4J_URI: bolt://neo4j:7687
      NEO4J_USER: neo4j
      NEO4J_PASSWORD: ${NEO4J_PASSWORD}
      QDRANT_INTERNAL_URL: http://qdrant:6333
      LLM_BASE_URL: ${LLM_BASE_URL:-http://model-runner.docker.internal/v1}
    depends_on:
      portal-init:
        condition: service_completed_successfully
    healthcheck:
      test: ["CMD", "wget", "-qO", "/dev/null", "http://127.0.0.1:3000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

volumes:
  pgdata:
  neo4jdata:
  qdrant_data:
```

**Note:** Consumer mode has no `.git` directory, so the git-based agent tools (`read_source_at_version`, `grep_codebase`, `list_codebase_files`) are unavailable. This is expected — consumer users interact through the UI and AI coworker, not source-level tools. The `DEPLOYED_VERSION` env var is omitted; the portal displays the image tag instead.

**Note:** Sandbox and Playwright services are omitted from the consumer compose. Build Studio sandbox execution is a customizer-only feature — consumers use the platform as-is.

**Install flow:**

1. Write `docker-compose.yml` from embedded template
2. Generate `.env` with random secure credentials (see below)
3. `docker compose pull`
4. `docker compose up -d`
5. Wait for portal health
6. Pull Docker Model Runner model (`docker model pull ai/llama3.2:1B-Q8_0`)

**Generated `.env` variables:**

| Variable | Source |
|----------|--------|
| `POSTGRES_USER` | `dpf` (fixed) |
| `POSTGRES_PASSWORD` | Random 32-char hex |
| `NEO4J_AUTH` | `neo4j/<random 32-char hex>` |
| `NEO4J_PASSWORD` | Same password as above (for portal) |
| `AUTH_SECRET` | Random 32-char hex |
| `CREDENTIAL_ENCRYPTION_KEY` | Random 32-char hex |
| `ADMIN_PASSWORD` | Random 16-char alphanumeric |
| `DPF_HOST_PROFILE` | JSON from hardware detection step |
| `LLM_BASE_URL` | `http://model-runner.docker.internal/v1` |

The `CREDENTIAL_ENCRYPTION_KEY` must always be generated — it is never empty. Without it, AI provider credential storage fails silently.

The `NEO4J_PASSWORD` is derived from `NEO4J_AUTH` to keep them in sync. The portal reads `NEO4J_PASSWORD` directly (not parsed from `NEO4J_AUTH`).

**On-disk footprint:** `docker-compose.yml`, `.env`, `.host-profile.json`, `.install-progress`. ~10KB total (no source).

### Customizer path — Contribute (mode 2a)

For users who want to modify the platform and contribute changes upstream.

**Install flow:**

1. Prompt for GitHub username
2. Check if fork exists at `github.com/<user>/opendigitalproductfactory` (via `gh` CLI or HTTPS probe)
3. If no fork, open browser to `https://github.com/markdbodman/opendigitalproductfactory/fork` and wait for confirmation
4. `git clone https://github.com/<user>/opendigitalproductfactory.git $DPF_DIR`
5. `git remote add upstream https://github.com/markdbodman/opendigitalproductfactory.git`
6. `docker compose build` (builds from source)
7. `docker compose up -d`
8. Pull Docker Model Runner model

### Customizer path — Private (mode 2b)

For users who want to modify the platform but keep changes private.

**Install flow:**

1. `git clone https://github.com/markdbodman/opendigitalproductfactory.git $DPF_DIR`
2. `git remote remove origin` (or rename to `upstream` as read-only reference)
3. `docker compose build` (builds from source)
4. `docker compose up -d`
5. Pull Docker Model Runner model

### Unified Docker image

A single image (`ghcr.io/markdbodman/dpf-portal`) contains both the migration/seed entrypoint and the Next.js standalone output. Compose runs it as two services with different commands:

- `portal-init`: `command: ["/docker-entrypoint.sh"]` — runs migrations, seed, exits
- `portal`: default CMD `node apps/web/server.js` — serves the application

This requires a Dockerfile change: the `runner` stage must also include the entrypoint script, Prisma client, migration files, and seed script.

### Image publishing

GitHub Actions workflow (`.github/workflows/publish-image.yml`) triggered on git tags matching `v*`:

1. Build the unified image from `Dockerfile`
2. Push to GHCR as `ghcr.io/markdbodman/dpf-portal:<tag>` and `:latest`
3. Typecheck gate (`pnpm typecheck`) runs before build to catch errors early

The install script defaults to `latest` but accepts an optional `--Version` parameter for pinning.

### Step flow comparison

| Step | Consumer | Customizer |
|------|----------|------------|
| 1. Windows check | Same | Same |
| 2. WSL2 setup | Same | Same |
| 3. Docker Desktop | Same | Same |
| 4. Choose mode | Writes embedded compose | Clones source (fork or main) |
| 5. Hardware detect | Same | Same |
| 6. Generate .env | Same | Same |
| 7. Start platform | `docker compose pull` + `up -d` | `docker compose build` + `up -d` |
| 8. AI model | `docker model pull` | Same |
| 9. Auto-start + browser | Same | Same |

### Dockerfile changes

Merge the `init` and `runner` stages into a single `runner` stage that can serve both roles. The runner stage must use the `base` stage (not bare `node:20-alpine`) because the init entrypoint calls `pnpm --filter @dpf/db exec prisma migrate deploy` and `pnpm --filter @dpf/db exec tsx`, which require pnpm and the full workspace resolution.

```dockerfile
# ─── Stage 5: runner (unified — serves app AND runs init) ─────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Copy standalone Next.js output
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

# Copy init dependencies: pnpm workspace, migrations, seed, Prisma client, tsx
COPY --from=init /app/packages/db ./packages/db
COPY --from=init /app/node_modules ./node_modules
COPY --from=init /app/pnpm-workspace.yaml /app/pnpm-lock.yaml /app/package.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

When run with `command: ["/docker-entrypoint.sh"]`, it executes migrations and seed. When run with the default CMD, it serves the app.

**Image size trade-off:** The current split architecture keeps the runner image small (~200MB) by excluding init dependencies. The unified image will be larger (~400-500MB) because it includes pnpm, Prisma CLI, tsx, and migration files. This is acceptable: it halves the CI pipeline, eliminates version skew between init and runner, and 500MB is still small by Docker image standards. Consumers pull one image instead of two.

### Prerequisites by mode

**Both modes:**
- Windows 10 2004+ (WSL2 support)
- Docker Desktop 4.40+ (Model Runner support). The installer checks the Docker version via `docker version --format '{{.Server.Version}}'` and shows a clear upgrade message if < 4.40.

**Consumer only:**
- No additional prerequisites. Git is NOT required.

**Customizer only:**
- Git (for clone and PR workflow)
- GitHub account (for contribute sub-path)

### Contribute sub-path: fork detection

The contribute path checks for a fork via HTTPS probe to avoid requiring the `gh` CLI:

```
GET https://api.github.com/repos/<user>/opendigitalproductfactory
```

If 200 → fork exists, proceed with clone. If 404 → open browser to fork page:

```
Start-Process "https://github.com/markdbodman/opendigitalproductfactory/fork"
```

Then poll the same endpoint (5s interval, 2min timeout) until the fork appears. Unauthenticated GitHub API allows 60 requests/hour — sufficient for this single check + poll.

### Future epic: mode switching

**EP-INSTALL-SWITCH-001:** "Allow switching between Consumer and Customizer modes post-install."

Covers:
- Consumer to Customizer: clone source alongside running containers, rebuild from source, preserve database
- Customizer to Consumer: switch compose file to use pre-built images, preserve database
- Database preservation across mode switches (volumes are independent of image source)

This is deferred — not part of the current implementation.

## Research & Benchmarking

**Docker Desktop installers (Portainer, GitLab, Discourse):** All use pre-built images with single-command install. None require source code or build steps for end users. This is the standard pattern.

**GitHub Container Registry:** Used by thousands of open source projects for image distribution. Free for public repositories. Supports multi-arch images if needed later.

**Docker Model Runner:** New in Docker Desktop 4.40 (2025). Replaces the need for a separate inference container. Validated in the previous session — the app already works with it.

## Anti-patterns avoided

- **No build at install time for consumers** — build failures are the #1 install support issue
- **No source code for consumers** — eliminates git dependency, disk usage, and confusion
- **No separate CI/CD for two images** — single unified image simplifies the pipeline
- **No hardcoded versions** — `DPF_VERSION` env var allows pinning without script changes
