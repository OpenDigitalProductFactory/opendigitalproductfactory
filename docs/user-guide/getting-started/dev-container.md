---
title: "Dev Container Setup"
area: getting-started
order: 5
lastUpdated: 2026-04-18
updatedBy: Claude (COO)
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

- Isolated PostgreSQL, Neo4j, and Qdrant databases (separate from production)
- Sanitized copy of production data (PII obfuscated, credentials replaced)
- Shared LLM inference via Docker Model Runner (no duplication)
- Pre-installed extensions: ESLint, Prisma, Tailwind CSS, Prettier
- Hot-reload Next.js dev server

### Important Notes

- Build Studio and VS Code should be treated as complementary interfaces, not separate source trees
- Production promotion still belongs to the portal's governed workflow
- The sanitized clone runs on first startup — production must be running as the data source

### Related

- [Developer Setup](developer-setup) — native pnpm + Docker sidecars alternative
- [Development Workspace](../development-workspace) — how Build Studio, VS Code, and production promotion fit together
