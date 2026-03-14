# Open Digital Product Factory

**The platform that builds itself.**

An open-source, AI-native digital product management platform that gives any organization — from a 5-person startup to a regulated enterprise — the same capabilities that only the largest tech companies have today. Built-in AI agents don't just answer questions: they manage your portfolio, model your architecture, execute your backlog, and eventually write the features you need — all with human approval at every step.

No vendor lock-in. No consultants. No million-dollar license. One click to install. Your AI workforce starts working immediately.

---

## Why This Exists

Enterprise software has a fundamental problem: the tools that manage digital products are harder to use than the products themselves. Portfolio management, enterprise architecture, backlog tracking, lifecycle governance — these are locked behind expensive platforms that require specialized teams to operate.

**What if the platform could operate itself?**

The Open Digital Product Factory is built on a radical premise: **AI agents should be first-class participants in the work**, not bolt-on assistants. Every screen has a context-aware AI co-worker. Every action an agent proposes goes through human-in-the-loop governance. Every decision is audit-logged. The platform knows what hardware it's running on, what models are available, and how to optimize its own AI workforce.

And because it's open source and self-contained (runs entirely on your machine with local AI), there are **no data privacy concerns, no cloud dependency, and no subscription fees**.

### The Vision: A Self-Evolving Platform

Today, the platform manages your digital products. Tomorrow, it writes new features for itself — in a governed sandbox, reviewed by humans, deployed when approved. A small business owner describes what they need in plain language. The AI builds it. A human reviews and approves. The platform grows from within.

> **Hive Mind:** Each installation is a node. Extend locally. Contribute extensions back. The community grows the platform from within — humans and AI agents working together.

---

## Who This Is For

- **Small business owners** who need enterprise-grade digital product management without enterprise-grade budgets or teams
- **Regulated industries** (healthcare, finance, insurance) that need audit trails, human approval chains, and compliance evidence — built in, not bolted on
- **IT leaders** who want to model their architecture, manage their portfolio, and track their backlog in one governed platform
- **Developers and architects** who want to extend and contribute to an open platform that treats AI as a core capability, not a chatbot sidebar

---

## Quick Install (Windows)

No technical experience needed. The installer handles everything automatically.

1. Download [`install-dpf.ps1`](https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/install-dpf.ps1) (right-click the link → "Save link as...")
2. Right-click the downloaded file → **Run with PowerShell**
3. Follow the guided steps (5-10 minutes)

The installer will:
- Set up Docker Desktop and WSL2 (if not already installed)
- Download and build the platform
- Detect your hardware and select an appropriate local AI model
- Start everything and open your browser — ready to use

**After installation:**
- **Start the platform:** `dpf-start`
- **Stop the platform:** `dpf-stop`
- **Uninstall everything:** Right-click [`uninstall-dpf.ps1`](https://raw.githubusercontent.com/markdbodman/opendigitalproductfactory/main/uninstall-dpf.ps1) → Run with PowerShell

---

## What's Inside

### Core Platform

| Area | What It Does |
|------|-------------|
| **Portfolio Management** | 4-portfolio hierarchy with 481-node DPPM taxonomy, health metrics, budget tracking, agent assignments |
| **EA Modeler** | Enterprise architecture canvas with ArchiMate 4 notation — models that are implementable, not whiteboards. Viewpoints enforce discipline. Governance keeps humans accountable. |
| **Inventory** | Digital product lifecycle management (plan → design → build → production → retirement) with portfolio attribution |
| **Backlog & Ops** | Epic grouping, portfolio and product backlog items, priority management — the platform manages its own backlog too |
| **Employee & Roles** | 6 IT4IT human roles (HR-000 through HR-500) with HITL tier assignments, SLA tracking, and delegation grants |
| **Platform Admin** | Branding, user management, credential encryption, governance controls |

### AI Workforce

This isn't a chatbot bolted onto a dashboard. AI is a core architectural layer.

| Capability | Description |
|-----------|-------------|
| **AI Co-worker Panel** | Floating, semi-transparent assistant on every screen. Context-aware — knows which page you're on and what you can do. |
| **9 Specialist Agents** | Portfolio Advisor, EA Architect, Ops Coordinator, Platform Engineer, and more — each with domain expertise and role-specific skills |
| **Skills Dropdown** | Each agent offers context-relevant actions filtered by your role. Higher authority = more capabilities. |
| **17 Provider Registry** | Anthropic, OpenAI, Azure, Gemini, Ollama, Groq, Together, and 10 more — cloud or local, your choice |
| **Automatic Failover** | Priority-ranked providers. If one fails, the next takes over. Local AI is always the safety net. |
| **Weekly Optimization** | Scheduled job ranks providers by capability tier and cost. The platform optimizes its own AI spending. |
| **Token Spend Tracking** | Per-provider, per-agent cost monitoring. Know exactly what your AI workforce costs. |
| **Local-First AI** | Runs Ollama out of the box. No API keys needed. No data leaves your machine. |

### Governance & Compliance

Built for regulated industries from day one — not retrofitted.

- **Human-in-the-Loop (HITL)** — AI agents propose actions; humans approve before execution. Non-negotiable.
- **Audit Trail** — every governance decision records WHO approved, WHEN, and WHAT. Queryable. Exportable. Evidence for regulators.
- **Role-Based Access** — 18 capabilities across 6 roles. Each user sees only what their role permits.
- **Credential Encryption** — AES-256-GCM for all provider secrets at rest.
- **EA Governance** — architecture models go through draft → submitted → approved workflows. Models drive decisions; governance ensures accountability.

---

## Architecture

```
┌──────────────────────────────────────────────────┐
│                    Browser                        │
│  ┌──────────┐ ┌───────────┐ ┌──────────────────┐│
│  │Workspace │ │ 8 Route   │ │ AI Coworker      ││
│  │  Tiles   │ │  Areas    │ │ Panel + Skills   ││
│  └──────────┘ └───────────┘ └──────────────────┘│
└────────────────────┬─────────────────────────────┘
                     │
┌────────────────────┴─────────────────────────────┐
│             Next.js 14 App Router                 │
│   Server Components · Server Actions · Auth.js    │
│   Typed Permission Registry · AI Inference Engine │
└────┬───────────┬───────────────┬─────────────────┘
     │           │               │
┌────┴────┐ ┌───┴─────┐ ┌──────┴───────┐
│ Prisma  │ │  Neo4j  │ │   Ollama     │
│    +    │ │    5    │ │ (local AI)   │
│Postgres │ │ (graph) │ │  or Cloud    │
│   16    │ │         │ │  Providers   │
└─────────┘ └─────────┘ └──────────────┘
```

The entire stack runs on your machine in Docker. No cloud required. No data leaves your network.

---

## Docker Deployment

4-service Docker Compose stack:

| Service | Purpose |
|---------|---------|
| `portal` | Next.js standalone app (port 3000) |
| `postgres` | PostgreSQL 16 (internal only — no external access) |
| `neo4j` | Neo4j 5 Community (internal only) |
| `ollama` | Local AI inference (internal only) |

```bash
docker compose up -d       # Start everything
docker compose ps          # Check health
docker compose logs -f     # View logs
docker compose down        # Stop
```

---

## Roadmap

### What's Working Now

| Epic | Description |
|------|-------------|
| Portal Foundation | Shell, 8 route areas, workspace tiles, portfolio tree with health/budget metrics |
| Backlog & Epics | Backlog CRUD, epic grouping, ops panel, DPF self-registration |
| EA Modeling | ArchiMate 4 canvas, viewpoints, relationship rules, structured value streams |
| AI Provider Registry | 17 providers, credential management, model discovery, profiling, cost tracking |
| AI Co-worker | Live LLM conversations, automatic failover, context-aware skills dropdown |
| Docker Deployment | Zero-prerequisites Windows installer, hardware detection, Ollama auto-setup |

### What's Coming

| Epic | Description |
|------|-------------|
| **Agent Task Execution** | Agents propose real actions (create backlog items, modify products, update EA models). Humans approve. Every action audit-logged. |
| **Platform Self-Development** | Agents write new features in a sandboxed environment. Humans review diffs and approve. The platform extends itself. |
| **AI-Guided Setup Wizard** | On first install, the AI Co-worker walks you through company setup conversationally — no forms, just a conversation. |
| **Ollama Management UI** | Pull models, manage containers, detect hardware — all from the platform, no terminal needed. |
| **Web-Hosted SaaS** | Cloud deployment option for organizations that prefer managed hosting. |
| **Theme & Branding** | Configurable visual presets. AI-assisted branding from a URL or description. |
| **Mac & Linux Installers** | Extend the one-click install experience to all platforms. |

---

## For Developers

### Prerequisites

| Tool | Version |
|------|---------|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | Latest |
| [Node.js](https://nodejs.org/) | 20+ |
| [pnpm](https://pnpm.io/) | 9+ |

### Setup

```bash
git clone https://github.com/markdbodman/opendigitalproductfactory.git
cd opendigitalproductfactory
pnpm install

docker compose up -d postgres neo4j    # Start databases
pnpm db:generate && pnpm db:migrate && pnpm db:seed
pnpm dev                                # http://localhost:3000
```

Login: `admin@dpf.local` / `changeme123`

### Project Structure

```
opendigitalproductfactory/
├── apps/web/                    # Next.js 14 App Router
│   ├── app/(shell)/             # 8 authenticated route areas
│   ├── components/agent/        # AI Coworker panel + skills
│   ├── lib/                     # Auth, permissions, inference, routing
│   └── lib/actions/             # Server actions
├── packages/db/                 # Prisma schema (42 models) + seed data
├── scripts/                     # Convenience + hardware detection
├── install-dpf.ps1              # Windows installer
├── uninstall-dpf.ps1            # Windows uninstaller
├── Dockerfile                   # Multi-stage (init + runner)
└── docker-compose.yml           # Full stack (4 services)
```

### Extension Points

| What | Where |
|------|-------|
| New workspace tile | `lib/permissions.ts` → `ALL_TILES` |
| New role | `PERMISSIONS` in `lib/permissions.ts` |
| New route | Page under `app/(shell)/` + register capability |
| New data model | `packages/db/prisma/schema.prisma` + migration |
| New AI agent | `ROUTE_AGENT_MAP` in `lib/agent-routing.ts` |
| New agent skill | Agent's `skills` array in the route map |

---

## Contributing

Everyone is welcome. This is a platform built by its community — humans and AI working together.

### The Hive Mind Model

1. Install and run your own instance
2. Add capabilities for your context
3. Share back what's useful to others

The platform is designed so that every extension — a new role, a new route, a new agent skill — follows the same pattern. No special access needed. Fork, build, contribute.

### Code Standards

- TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- `pnpm typecheck && pnpm test` must pass before any PR
- All new features need Vitest tests
- Follow existing patterns (server actions, React cache, auth gates)

---

## License

[MIT](LICENSE)

---

*Built with the belief that every organization deserves enterprise-grade tools — and that AI should work for you, not the other way around.*
