# Open Digital Product Factory

**The platform that builds itself.**

An open-source, AI-native digital product management platform that gives any organization — from a 5-person startup to a regulated enterprise — the same capabilities that only the largest tech companies have today. Built-in AI agents don't just answer questions: they manage your portfolio, model your architecture, execute your backlog, and eventually write the features you need — all with human approval at every step.

No vendor lock-in. No consultants. No million-dollar license. One installer to run. Your AI workforce starts working immediately.

---

## AI Agent Standards

This repository now includes a draft standards family for trustworthy AI agent operation and identity, using `DPF` as the first implementation and conformance case.

- [Trusted AI Kernel (TAK) - Markdown](docs/architecture/trusted-ai-kernel.md)
- [Trusted AI Kernel (TAK) - Word](docs/architecture/Trusted-AI-Kernel-Architecture.docx)
- [Global AI Agent Identification and Governance (GAID) - Markdown](docs/architecture/GAID.md)
- [Global AI Agent Identification and Governance (GAID) - Word](docs/architecture/GAID.docx)
- [Trusted AI Agent Governance White Paper](docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md)
- [White Paper - Word](docs/architecture/Trusted-AI-Agent-Governance-White-Paper.docx)
- [DPF Standards Conformance Assessment](docs/architecture/agent-standards-dpf-conformance.md)

These documents are intended to be read together:

- `TAK` defines the runtime kernel and control model for trustworthy agent execution
- `GAID` defines identity, badging, issuer, traceability, and governance claims for agents
- the white paper explains the need, market context, and policy relevance
- the conformance assessment shows how the platform maps to the proposed standards today

---

## Why It Exists

Enterprise software — portfolio management, enterprise architecture, backlog tracking, lifecycle governance — has traditionally been locked behind expensive platforms that require specialized teams to operate. The advent of capable AI agents changes the economics: the know-how of the professionals can be commoditized into a limitless workforce, as long as the governance keeps humans in the loop.

**What if the platform could operate itself?**

The Open Digital Product Factory is built on a premise: **AI agents should be first-class participants in the work**, not bolt-on assistants. Every screen has a context-aware AI coworker. Every action an agent proposes goes through human-in-the-loop governance. Every decision is audit-logged. The platform knows what hardware it's running on, what models are available, and how to optimize its own AI workforce.

Because it's open source and self-contained — runs entirely on your hardware, with a built-in local AI engine — there are **no data privacy concerns, no cloud dependency, and no subscription fees** unless you choose to use external providers.

### The Vision: A Self-Evolving Platform

Today the platform manages your digital products. Tomorrow it writes new features you need — in a governed, reviewable way, no developer required on the hot path. A sandbox holds each change. Humans review the design and user experience. Approved changes deploy automatically. The platform grows from within, on your hardware, on your terms.

> **Hive Mind (opt-in):** Each installation is a node. You can share what you develop with the community, pull in what other installations have built, and let the platform grow through humans and agents working together. Sharing is always opt-in.

---

## Who This Is For

- **Small business owners** who need enterprise-grade digital product management without enterprise-grade budgets or teams
- **Regulated industries** (healthcare, finance, insurance) that need audit trails, human approval chains, and compliance evidence — built in, not bolted on
- **IT leaders** who want to model their architecture, manage their portfolio, and track their backlog in one governed platform
- **Developers and architects** who want to extend and contribute to an open platform that treats AI as a core capability, not a chatbot sidebar

---

## Installation

The installer asks one question: **Ready to go** or **Customizable**.

| Mode | Who it's for | What happens |
| ---- | ------------ | ------------ |
| **Ready to go** | Business users, anyone who wants to run it | Pulls pre-built images. Build Studio is the guided interface for extending the platform. |
| **Customizable** | Developers, power users who want to modify the platform | Clones the full source and builds locally. Build Studio and VS Code use the same shared workspace. |

Both modes include the full platform with AI coworkers, Build Studio sandbox, and all features. The difference is whether direct VS Code access is part of the supported workflow.

### Quick Start (Windows)

Open PowerShell and paste:

```powershell
gh api repos/OpenDigitalProductFactory/opendigitalproductfactory/contents/install-dpf.ps1 -H "Accept: application/vnd.github.raw" > install-dpf.ps1
powershell -ExecutionPolicy Bypass -File install-dpf.ps1
```

Choose your mode when prompted. The installer handles Docker Desktop, WSL2, hardware detection, AI model selection, credential generation, and auto-start. Expect 5–10 minutes for the platform itself, plus additional time for the initial AI model download (varies by model size and connection speed).

**Login credentials** are shown at the end of installation and saved to `.admin-credentials` in your install directory. The email is always `admin@dpf.local`; the password is randomly generated and unique to your install. Change it after first login.

**After installation:**

- **Start:** `dpf-start`
- **Stop:** `dpf-stop`
- **Uninstall:** `powershell -ExecutionPolicy Bypass -File uninstall-dpf.ps1` from your install directory

### What each mode installs

| | Ready to go | Customizable |
| --- | --- | --- |
| **Shared workspace** | Yes, used through Build Studio | Yes, used through Build Studio and VS Code |
| **Source code checkout** | No local checkout required | Yes (full git clone) |
| **Docker build** | No (`docker compose pull`) | Yes (`docker compose build`) |
| **Git required** | No | Yes |
| **Modify the platform** | Via Build Studio (in-app) | Build Studio + direct code changes in the same workspace |
| **Install time** | ~5 minutes (mostly download) | ~10 minutes (includes build) |
| **Disk footprint** | ~2 GB (images only) | ~5 GB (source + images) |

### Shared Workspace Model

Self-developing installs use one shared workspace per install:

- Build Studio always works from that workspace
- In customizable installs, VS Code works from that same workspace too
- Production promotion remains governed through the portal
- Contribution policy is configured later in the portal for both modes

See [docs/user-guide/development-workspace.md](docs/user-guide/development-workspace.md) for the full operating model.

### Working on the platform itself

If you want to contribute to the codebase rather than just run it:

- [Developer Setup](docs/user-guide/getting-started/developer-setup.md) — native pnpm + Docker sidecars, IDE debugging, hot reload.
- [Dev Container Setup](docs/user-guide/getting-started/dev-container.md) — fully containerized, only Docker Desktop and VS Code required.

---

## What's Inside

### Core Platform

| Area | What It Does |
| ---- | ------------ |
| **Portfolio Management** | 4-portfolio hierarchy with a 481-node DPPM taxonomy, health metrics, budget tracking, agent assignments |
| **EA Modeler** | Enterprise architecture canvas with ArchiMate 4 notation — implementable models, not whiteboards |
| **Inventory** | Digital product lifecycle management (plan → design → build → production → retirement) with portfolio attribution |
| **Backlog & Ops** | Epic grouping, portfolio and product backlog items, priority management — the platform manages its own backlog too |
| **Employees & Roles** | 6 IT4IT human roles (HR-000 through HR-500) with HITL tier assignments, SLA tracking, and delegation grants |
| **Platform Admin** | Branding, user management, credential encryption, governance controls |

### AI Workforce

This isn't a chatbot bolted onto a dashboard. AI is a core architectural layer.

| Capability | Description |
| ---------- | ----------- |
| **AI Coworker Panel** | Floating, semi-transparent assistant on every screen. Context-aware. |
| **9 Specialist Agents** | Portfolio Advisor, EA Architect, Ops Coordinator, Platform Engineer, and more — each with domain expertise and role-specific skills |
| **Skills Dropdown** | Each agent offers context-relevant actions filtered by your role. |
| **20+ Provider Registry** | Anthropic, OpenAI, Azure, Gemini, Groq, Together, DeepSeek, xAI, Mistral, and more |
| **Automatic Failover** | Priority-ranked providers. Local AI is always the safety net. |
| **Weekly Optimization** | Scheduled job ranks providers by capability tier and cost. |
| **Token Spend Tracking** | Per-provider, per-agent cost monitoring. |
| **Local-First AI** | Runs via Docker Model Runner out of the box. No API keys needed. No data leaves your machine. |

### Governance & Compliance

Built for regulated industries from day one — not retrofitted.

- **Human-in-the-Loop (HITL)** — AI agents propose actions; humans approve before execution. Non-negotiable.
- **Audit Trail** — every governance decision records who approved, when, and what. Queryable. Exportable.
- **Role-Based Access** — 18 capabilities across 6 roles.
- **Credential Encryption** — AES-256-GCM for all provider secrets at rest.
- **EA Governance** — architecture models go through draft → submitted → approved workflows.

---

## Architecture

The platform has two deployment models and one shared architectural core:

- **Customer mode** — the full platform runs inside Docker with one exposed web port.
- **Native developer mode** — the databases and local AI run in Docker, while the app runs locally via `pnpm dev`.
- **Sandbox build loop** — isolated, on-demand containers support governed feature generation, preview, and testing.

For the full runtime picture — deployment diagrams, hardware tiers, the Docker Compose breakdown, and the monitoring stack — see [docs/architecture/platform-overview.md](docs/architecture/platform-overview.md).

The platform's AI governance layer is now documented as a standards family:

- [Trusted AI Kernel (TAK)](docs/architecture/trusted-ai-kernel.md) — runtime governance, authority mediation, HITL, delegation, audit, provider backpressure, queueing, and failover expectations
- [Global AI Agent Identification and Governance (GAID)](docs/architecture/GAID.md) — identity, issuer/accreditation, badging, assurance, authorization classes, and chain-of-custody requirements
- [Trusted AI Agent Governance White Paper](docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md) — the market, policy, and implementation case for the standards family
- [DPF Standards Conformance Assessment](docs/architecture/agent-standards-dpf-conformance.md) — how the current platform maps to the proposed controls

Publication outputs are generated from the Markdown sources of truth:

- `pnpm docs:tak`
- `node docs/architecture/generate-gaid-docx.mjs`
- `node docs/architecture/generate-agent-standards-white-paper-docx.mjs`

---

## Roadmap

### What's working now

| Epic | Description |
| ---- | ----------- |
| Portal Foundation | Shell, 8 route areas, workspace tiles, portfolio tree with health and budget metrics |
| Backlog & Epics | Backlog CRUD, epic grouping, ops panel, DPF self-registration |
| EA Modeling | ArchiMate 4 canvas, viewpoints, relationship rules, structured value streams |
| AI Provider Registry | 17 providers, credential management, model discovery, profiling, cost tracking |
| AI Coworker | Live LLM conversations, automatic failover, context-aware skills dropdown |
| Docker Deployment | Zero-prerequisites Windows installer, hardware detection, Docker Model Runner auto-setup |

### What's coming

| Epic | Description |
| ---- | ----------- |
| **Agent Task Execution** | Agents propose real actions (create backlog items, modify products, update EA models). Humans approve. Every action audit-logged. |
| **Platform Self-Development** | Agents write new features in a sandboxed environment. Humans review diffs and approve. The platform extends itself. |
| **AI-Guided Setup Wizard** | On first install, the AI coworker walks you through company setup conversationally — no forms, just a conversation. |
| **In-App PR Workflow** | Submit customizations back to the community directly from the platform UI. |
| **Web-Hosted SaaS** | Cloud deployment option for organizations that prefer managed hosting. |
| **Mac & Linux Installers** | Extend the one-click install experience to all platforms. |

---

## Docs

- [docs/README.md](docs/README.md) — the documentation index.
- [docs/user-guide/](docs/user-guide/) — end-user operating guides bundled into the portal's in-app help.
- [docs/architecture/](docs/architecture/) — runtime, deployment, standards, and governance documentation.
- [docs/architecture/trusted-ai-kernel.md](docs/architecture/trusted-ai-kernel.md) — the `TAK` runtime standard.
- [docs/architecture/GAID.md](docs/architecture/GAID.md) — the `GAID` identity and governance standard.
- [docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md](docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md) — the companion white paper.
- [docs/architecture/agent-standards-dpf-conformance.md](docs/architecture/agent-standards-dpf-conformance.md) — the `DPF` conformance assessment.

---

## Contributing

Everyone is welcome. This is a platform built by its community — humans and AI working together.

**The Hive Mind model:**

1. Install and run your own instance.
2. Add capabilities for your context.
3. Share back what's useful to others.

Every extension — a new role, a new route, a new agent skill — follows the same pattern. No special access needed. Fork, build, contribute.

**Code standards:**

- TypeScript strict mode (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- `pnpm typecheck && pnpm test` must pass before any PR
- All new features need Vitest tests
- Follow existing patterns (server actions, React cache, auth gates)

Longer-form contributor guidance (branch model, PR checklist, local verification) lives in `CONTRIBUTING.md` (arriving with the PR-based workflow switch).

---

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Contributions are accepted under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/). By submitting a pull request, you certify that your contribution is your original work and you grant an irrevocable license under the project's Apache-2.0 license.

Required attributions for bundled open-source dependencies are listed in [NOTICE](NOTICE). Credit to the standards bodies, frameworks, and authors whose ideas shaped DPF is in [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md).
