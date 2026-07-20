---
title: "Dev Container Setup"
area: getting-started
order: 5
---

## Dev Container Setup (VS Code)

For developers who want a fully containerized development environment. Everything runs inside Docker — no local Node.js or pnpm required.

### Prerequisites

| Tool | Version |
| ---- | ------- |
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 4.40+ |
| [VS Code](https://code.visualstudio.com/) | Latest |
| [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) | Latest |

### First-Time Setup

1. Clone the repo and ensure the production stack is running (`docker compose up -d`)
2. Open the repo folder in VS Code
3. Press `F1` and select **Dev Containers: Reopen in Container**
4. Wait for the dev databases to start, migrations to run, and sanitized data to populate

The dev server starts automatically on port 3001. Open `http://localhost:3001` in your browser. Production remains on port 3000.

Login: `admin@dpf.local` / `changeme123`

### What the Dev Container Provides

- An isolated PostgreSQL database (separate from production), including vector and graph storage
- Sanitized copy of production data (PII obfuscated, credentials replaced)
- Shared LLM inference via Docker Model Runner (no duplication)
- Pre-installed extensions: ESLint, Prisma, Tailwind CSS, Prettier
- Hot-reload Next.js dev server

### Important Notes

- Build Studio and VS Code should be treated as complementary interfaces, not separate source trees
- Production promotion still belongs to the portal's governed workflow
- The sanitized clone runs on first startup — production must be running as the data source
- Contributor database readiness verifies both PostgreSQL connectivity and pgvector availability before migrations start. If `dev-postgres` remains unhealthy, inspect its health output and recreate that contributor-only service from the checked-in `pgvector/pgvector:pg16` image; do not bypass `dev-init` or edit an applied migration.
- The clone resets the disposable development application tables before copying. Restricted provider, credential, token, and connection records are not copied; production-derived search/vector values are omitted rather than carrying source terms or embeddings into the preview.
- Additive source-schema differences are expected during concurrent development. Source-only columns or tables are left out of the preview, destination-only columns use their migrated defaults, and a shared column with an incompatible type stops the clone with a precise error instead of risking a corrupt preview.
- Clone publication is fail-safe: if any table cannot be copied or sanitized, the development application tables are cleared again while Prisma migration history is retained. The Contributor preview will not start against a partially copied relational dataset. Correct the reported source/tooling error and restart the development initialization step to retry.

### Related

- [Developer Setup](developer-setup.md) — native pnpm + Docker sidecars alternative
- [Development Workspace](../development-workspace.md) — how Build Studio, VS Code, and production promotion fit together
