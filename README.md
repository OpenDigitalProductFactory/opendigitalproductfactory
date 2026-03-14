# Open Digital Product Factory

An open, AI-powered digital product management platform built on IT4IT v3 governance principles. Every user sees only the workspace capabilities their role permits. In-platform AI agents help teams manage their digital product portfolio collaboratively — with a goal of the platform maintaining and extending itself.

> **Vision — Hive Mind:** Each installation is a node. Extend locally. Contribute extensions back to the shared repo. The community grows the platform from within.

---

## Quick Install (Windows)

No technical experience needed. The installer handles everything automatically.

1. Download [`install-dpf.ps1`](https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/install-dpf.ps1) (right-click the link → "Save link as...")
2. Right-click the downloaded file → **Run with PowerShell**
3. Follow the guided steps (5-10 minutes)

The installer will:
- Set up Docker Desktop and WSL2 (if not already installed)
- Download and build the platform
- Detect your hardware and select an appropriate AI model
- Start everything and open your browser

**After installation:**
- **Start the platform:** Open PowerShell and run `dpf-start`
- **Stop the platform:** Open PowerShell and run `dpf-stop`
- **Uninstall everything:** Right-click [`uninstall-dpf.ps1`](https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/uninstall-dpf.ps1) → Run with PowerShell

---

## What's Inside

### Platform Features

| Area | What It Does |
|------|-------------|
| **Portfolio Management** | 4-portfolio hierarchy with 481-node DPPM taxonomy, health metrics, budget tracking, agent assignments |
| **EA Modeler** | Enterprise architecture canvas with ArchiMate 4 notation, viewpoints, relationship rules, structured value streams |
| **Inventory** | Digital product lifecycle management (plan → design → build → production → retirement) |
| **Backlog & Ops** | Epic grouping, portfolio and product backlog items, priority management |
| **AI Workforce** | Provider registry (17 cloud + local), model discovery, profiling, token spend tracking, priority-based failover |
| **AI Co-worker** | Route-aware chat assistant with context-specific skills, real LLM inference via Ollama or cloud providers |
| **Employee & Roles** | 6 IT4IT human roles (HR-000 through HR-500) with HITL tier assignments and SLA tracking |
| **Platform Admin** | Branding, user management, credential encryption, governance controls |

### AI Capabilities

- **Live LLM conversations** — real AI responses from Ollama (local) or cloud providers (Anthropic, OpenAI, Azure, Gemini, etc.)
- **Automatic failover** — if one provider fails, the next in priority takes over
- **Context-aware agents** — 9 specialist agents that know about their domain (portfolio, EA, operations, etc.)
- **Skills dropdown** — each agent offers context-relevant actions filtered by your role
- **Token usage tracking** — cost monitoring by provider and by agent
- **Weekly optimization** — scheduled job ranks providers by capability and cost

### Security & Governance

- Role-based access control with 18 capabilities across 6 roles
- AES-256-GCM credential encryption at rest
- Human-in-the-loop (HITL) governance designed for regulated industries (healthcare, finance, insurance)
- Audit trail via AuthorizationDecisionLog

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│  ┌─────────┐ ┌──────────┐ ┌──────────────┐ │
│  │Workspace│ │ Routes   │ │ AI Coworker  │ │
│  │ Tiles   │ │(8 areas) │ │   Panel      │ │
│  └─────────┘ └──────────┘ └──────────────┘ │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│           Next.js 14 App Router              │
│  Server Components + Server Actions          │
│  Auth.js v5 (JWT sessions)                   │
│  Typed permission registry (can(user, cap))  │
└───┬──────────┬──────────────┬───────────────┘
    │          │              │
┌───┴───┐ ┌───┴────┐ ┌──────┴──────┐
│Prisma │ │ Neo4j  │ │   Ollama    │
│  +    │ │  5     │ │  (local AI) │
│Postgres│ │(graph) │ │  or Cloud   │
│  16   │ │        │ │  Providers  │
└───────┘ └────────┘ └─────────────┘
```

| Component | Purpose |
|-----------|---------|
| **Next.js 14** | App Router — React Server Components, Server Actions |
| **Prisma 5 + PostgreSQL 16** | Structured data (42 models) |
| **Neo4j 5** | Graph traversal for EA modeling |
| **Ollama** | Local AI inference (no cloud dependency needed) |
| **Auth.js v5** | JWT sessions, role-based access |
| **Vitest** | Fast TypeScript-native tests |
| **pnpm workspaces** | Monorepo: `apps/web` + `packages/db` |

---

## Docker Deployment

The platform runs as a 4-service Docker Compose stack:

| Service | Purpose |
|---------|---------|
| `portal` | Next.js standalone app (port 3000) |
| `postgres` | PostgreSQL 16 (internal only) |
| `neo4j` | Neo4j 5 Community (internal only) |
| `ollama` | Local AI inference (internal only) |

```bash
# Start everything
docker compose up -d

# Check health
docker compose ps

# View logs
docker compose logs portal -f

# Stop
docker compose down
```

---

## For Developers

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest | Runs the databases |
| [Node.js](https://nodejs.org/) | 20+ | Runtime |
| [pnpm](https://pnpm.io/) | 9+ | `npm install -g pnpm` |

### Setup

```bash
git clone https://github.com/markdbodman/opendigitalproductfactory.git
cd opendigitalproductfactory
pnpm install

# Start databases
docker compose up -d postgres neo4j

# Setup database
pnpm db:generate
pnpm db:migrate
pnpm db:seed

# Start dev server
pnpm dev
```

Open http://localhost:3000 — log in with `admin@dpf.local` / `changeme123`

### Common Commands

```bash
pnpm dev           # Dev server
pnpm test          # Run all tests
pnpm typecheck     # TypeScript check (must pass before PRs)
pnpm build         # Production build
pnpm db:migrate    # Run Prisma migrations
pnpm db:seed       # Seed database (idempotent)
pnpm db:studio     # Prisma Studio — visual database browser
```

### Project Structure

```
opendigitalproductfactory/
├── apps/web/                    # Next.js 14 App Router
│   ├── app/(shell)/             # Authenticated routes (8 areas)
│   ├── components/agent/        # AI Coworker panel + skills
│   ├── components/shell/        # Header, NavBar
│   ├── lib/                     # Auth, permissions, inference, routing
│   └── lib/actions/             # Server actions
├── packages/db/                 # Prisma schema + seed data
│   ├── prisma/schema.prisma     # 42 models
│   ├── data/                    # Seed JSON files
│   └── src/                     # Seed scripts, helpers
├── scripts/                     # Convenience + hardware detection
├── install-dpf.ps1              # Windows installer
├── uninstall-dpf.ps1            # Windows uninstaller
├── Dockerfile                   # Multi-stage (init + runner)
└── docker-compose.yml           # Full stack (4 services)
```

### TypeScript Conventions

- Strict mode: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- `moduleResolution: "bundler"` — no `.js` extensions on local imports
- `@/` path alias maps to `apps/web/`
- Server actions: `"use server"`, return `{ error: string }` union
- Tests: Vitest with `environment: "node"` (no jsdom)

---

## Contributing

Everyone is welcome. The goal is a platform that anyone can extend and give back to the community.

### The Hive Mind Model

1. Run your own installation
2. Add capabilities, roles, or domain routes for your context
3. If it's useful to others, open a pull request and share it back

### Extension Points

| What | Where |
|------|-------|
| New workspace tile | Add capability to `lib/permissions.ts` → add tile to `ALL_TILES` |
| New role | Extend `PERMISSIONS` in `lib/permissions.ts` |
| New route | Add page under `app/(shell)/` and register the capability |
| New data model | Add to `packages/db/prisma/schema.prisma` + migration |
| New AI agent | Add entry to `ROUTE_AGENT_MAP` in `lib/agent-routing.ts` |
| New agent skill | Add to the agent's `skills` array in the route map |

### Code Standards

- `pnpm typecheck && pnpm test` must pass before any PR
- All new features need Vitest tests
- Follow existing patterns (server actions, React cache, auth gates)

---

## Roadmap

| Epic | Status | Description |
|------|--------|-------------|
| Portal Foundation | Done | Shell, routes, workspace, portfolio, inventory |
| Backlog & Epics | Done | Backlog CRUD, epic grouping, ops panel |
| EA Modeling | In Progress | ArchiMate canvas, viewpoints, structured notation |
| AI Provider Registry | Done | 17 providers, cost tracking, model profiling |
| AI Co-worker | Done | Live LLM chat, failover, skills dropdown |
| Governance Foundation | In Progress | Identity, delegation, agent governance |
| Infrastructure Discovery | In Progress | Bootstrap discovery, inventory quality |
| Docker Deployment | Done | One-click installer, Ollama management |
| Agent Task Execution | Open | HITL-governed actions proposed by agents |
| Platform Self-Development | Open | Agents write and deploy new features |
| Theme & Branding | Open | Configurable presets, AI-assisted branding |
| Web-Hosted SaaS | Open | Cloud deployment option |

---

## License

[MIT](LICENSE)
