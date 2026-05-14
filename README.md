# Open Digital Product Factory

**The platform that builds itself.**

An open-source, AI-native digital product management platform that gives any organization — from a 5-person startup to a regulated enterprise — the same capabilities that only the largest tech companies have today. Built-in AI agents don't just answer questions: they manage your portfolio, model your architecture, execute your backlog, and draft platform changes in a governed sandbox — all with human approval at every step.

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

Today the platform manages your digital products and gives you Build Studio for governed platform extension. A sandbox holds each change. Humans review the design, code impact, and user experience. Approved changes move through the portal's promotion and contribution paths. The platform grows from within, on your hardware, on your terms.

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

### Quick Start

| Platform | Install command | Full guide | Status |
|----------|-----------------|------------|--------|
| **Windows 10/11** | `powershell -ExecutionPolicy Bypass -File install-dpf.ps1` | (see below) | **GA** — production usage by real users |
| **macOS Apple Silicon** | `bash install-dpf.sh` | [docs/install/macos.md](docs/install/macos.md) | **Early access — try it!** |
| **Linux (native Docker)** | `bash install-dpf.sh` | [docs/install/linux.md](docs/install/linux.md) | **Early access — try it!** |

#### Calling all macOS / Linux early adopters

The macOS and Linux installers are **code-complete and merged on `main`**. Static CI gates (`shellcheck`, `docker compose config`, `install-dpf.sh --dry-run`) are green, and an on-demand end-to-end install gate runs the full stack on `ubuntu-latest` ([`.github/workflows/install-verification.yml`](.github/workflows/install-verification.yml)).

What we **haven't** done — and what you can help with — is run the full install on real hardware in the wild. If you have:

- **An Apple Silicon Mac (M1 / M2 / M3 / M4)** running macOS 14+
- **A real Linux box** (Ubuntu 22.04+ / Debian 12+ / Fedora 39+ — bonus points for non-Ubuntu distros)
- **A TAPPaaS environment** you'd like to pilot DPF into
- **A cloud VM** (EC2 / Compute Engine / Azure VM) to run the headless install

…please try it and tell us how it went. Both happy-path success stories and "the installer hit a wall at step X" failures are equally useful — the wall-hits are how we close the gap between "we believe it works" and "we know it works."

**How to report:** open a GitHub issue using the [Install verification report template](.github/ISSUE_TEMPLATE/install_verification.md) (titled `Install verification — <platform> <version>`) and attach the diagnostic bundle produced by `bash install-dpf.sh doctor` (it lives at `~/.dpf/doctor-<timestamp>.tar.gz` and redacts secrets automatically). The [verification runbook](docs/install/verification-runbook.md) lists what to check and what artifacts to capture.

The Windows installer remains the only GA path — production stable, used by real customers. The macOS / Linux paths graduate from "Early access" to "GA" once we have a handful of community verification reports per platform.

Choose your mode when prompted. The installer handles Docker (Desktop on Windows / Mac, distro pkg manager on Linux), hardware detection, AI model selection, credential generation, and auto-start. Expect 5–10 minutes for the platform itself, plus additional time for the initial AI model download.

**Login credentials** are shown at the end of installation and saved to `.env` (or `.admin-credentials` on Windows) in your install directory. The email is always `admin@dpf.local`; the password is randomly generated and unique to your install. Change it after first login.

#### Windows

Open PowerShell and paste:

```powershell
gh api repos/OpenDigitalProductFactory/opendigitalproductfactory/contents/install-dpf.ps1 -H "Accept: application/vnd.github.raw" > install-dpf.ps1
powershell -ExecutionPolicy Bypass -File install-dpf.ps1
```

The Windows installer auto-installs Docker Desktop and WSL2.

After installation:

- **Start:** `dpf-start`
- **Stop:** `dpf-stop`
- **Uninstall:** `powershell -ExecutionPolicy Bypass -File uninstall-dpf.ps1` from your install directory

#### macOS / Linux

```bash
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh
```

The bash installer auto-installs Docker (Docker Desktop `.dmg` on macOS, Docker Engine via `apt`/`dnf` on Linux), runs preflight against the supported-host matrix, and registers a LaunchAgent (macOS) or systemd-user unit (Linux) for autostart. Pass `--no-autostart` to skip the autostart unit.

After installation:

- **Start:** `bash dpf-start.sh`
- **Stop:** `bash dpf-stop.sh`
- **Diagnostic bundle:** `bash install-dpf.sh doctor`
- **Soft uninstall (keep data):** `bash uninstall-dpf.sh`
- **Full uninstall (wipe data):** `bash uninstall-dpf.sh --purge`

See [docs/install/macos.md](docs/install/macos.md) and [docs/install/linux.md](docs/install/linux.md) for prerequisites, troubleshooting, and provider configuration (Docker Model Runner on macOS, Ollama on Linux, or any external `LLM_BASE_URL`).

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
| **Portfolio, Product, and EA Operations** | Portfolio hierarchy, digital-product lifecycle, architecture modeling, inventory, health signals, and backlog execution. |
| **Build Studio** | Five-phase feature development pipeline with sandbox builds, code intelligence, impact reports, review evidence, and governed promotion. |
| **AI Workforce Operations** | Context-aware coworker panel, specialist agents, model routing, provider cost/authority posture, operations map, capacity continuity, and capability-needs review. |
| **Wiki and Managed Documents** | Platform wiki, founder-kernel knowledge, principles, linting, managed document lifecycle, versions, references, and publication state. |
| **Compliance and Finance** | Regulations, controls, evidence, licensing readiness, tax/remittance settings, payment controls, and audit trails. |
| **Storefront, Customers, and Integrations** | Storefront setup, customer context, marketing surfaces, native Google integrations, connector posture, and MCP-accessible workflows. |
| **Edge Node and Discovery** | Host-resident Edge Node enrollment, trust review, heartbeat freshness, local discovery intake, and multi-host/air-gapped runbooks. |
| **Platform Admin** | Branding, identity, roles, tool grants, provider credentials, governance controls, prompts, and operational audit surfaces. |

### AI Workforce

This isn't a chatbot bolted onto a dashboard. AI is a core architectural layer.

| Capability | Description |
| ---------- | ----------- |
| **Context-Aware Coworker Panel** | The assistant understands the current route and works through route-specific tools, prompts, and permissions. |
| **Specialist Agents and Skills** | Coworkers carry domain-specific skills for portfolio, architecture, operations, compliance, storefront, documentation, Build Studio, and platform engineering work. |
| **Governed Tools and MCP** | In-product coworkers and external MCP clients call the same governed tool surface with grants, audit logging, and side-effect controls. |
| **Provider Registry and Routing** | Local-first inference, external provider configuration, model discovery, routing lifecycle, sensitivity clearance, cost posture, and failover. |
| **Operations Map and Capacity Continuity** | Operator views for workforce posture plus scheduled or capacity-backed work that must leave durable evidence. |
| **Capability Needs Review** | Coworkers can surface missing tools, prompts, permissions, or product gaps so improvements enter a governed backlog path. |
| **Build Studio Coworkers** | The build-specialist flow drafts designs, plans, code changes, verification output, review summaries, and promotion evidence. |

### Governance & Compliance

Built for regulated industries from day one — not retrofitted.

- **Human-in-the-Loop (HITL)** — AI agents propose actions; humans approve before execution.
- **Audit Trail** — every governance decision records who approved, when, and what. Queryable. Exportable.
- **Role-Based Access and Tool Grants** — route access, platform roles, coworker grants, and tool execution authority are enforced together.
- **Credential Encryption** — AES-256-GCM for provider secrets and sensitive integration credentials at rest.
- **EA Governance and Evidence** — architecture models, Build Studio phase artifacts, compliance evidence, and licensing readiness stay reviewable.

---

## Architecture

The platform has two deployment models and one shared architectural core:

- **Customer mode** — the full platform runs inside Docker with one exposed web port.
- **Native developer mode** — the databases and local AI run in Docker, while the app runs locally via `pnpm dev`.
- **Sandbox build loop** — isolated, on-demand containers support governed feature generation, preview, and testing.

For the full runtime picture — deployment diagrams, hardware tiers, the Docker Compose breakdown, and the monitoring stack — see [docs/architecture/platform-overview.md](docs/architecture/platform-overview.md).

### Deployment architecture

The deployment architecture keeps Windows, macOS, native Linux, customer-cloud, and TAPPaaS aligned to the same canonical contracts while each target carries its own maturity level. The current ownership map is in `docs/superpowers/specs/`:

- [Deployment Contracts](docs/superpowers/specs/2026-05-09-deployment-contracts.md) — 10 canonical contracts every deployment target wraps (release artifacts, runtime config, lifecycle, identity, edge, build execution, observability, secrets, LLM/agent routing, client/API surfaces).
- [Cloud Deployment Design](docs/superpowers/specs/2026-05-09-cloud-deployment-design.md) — substrates (Single VM, Managed container service, Managed Kubernetes) and packaging targets (TAPPaaS module, marketplace image, Helm chart, Terraform modules).
- [DPF Edge Node](docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md) — host-resident trust + connectivity component for discovery, MCP/A2A gateway, and identity brokering.
- [Build Execution Provider](docs/superpowers/specs/2026-05-09-build-execution-provider-design.md) — sandbox lifecycle abstraction so Build Studio runs on substrates beyond local Docker.
- [Mac/Linux Installer-Parity Roadmap](docs/superpowers/plans/2026-05-09-macos-linux-native-support.md) — 10-phase implementation plan for native macOS (Apple Silicon) + native Linux installs.
- [Branch Plan: Architecture + Documentation Rollout](docs/superpowers/plans/2026-05-09-deployment-architecture-and-rollout.md) — umbrella plan tracking the implementation epics and public-doc updates that follow these specs.

Windows remains the GA install surface today. macOS Apple Silicon and native Linux installers are code-complete on `main` and in early access pending more community verification reports. Cloud and TAPPaaS packaging remain design tracks.

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

## Current Capability Posture

### Working now

| Area | Description |
| ---- | ----------- |
| Product operations | Portfolios, digital products, architecture, inventory, backlog, operations, and storefront management. |
| AI workforce | Context-aware coworker panel, specialist skills, model routing, provider registry, operations map, capacity continuity, and capability-needs review. |
| Build Studio | Governed five-phase build flow, sandbox execution, code intelligence, review evidence, and promotion/contribution workflow. |
| Governance | TAK/GAID standards family, HITL, audit trail, tool grants, credential encryption, and route-aware authority checks. |
| Knowledge and documents | Platform wiki, principles/founder-kernel knowledge, wiki linting, managed documents, versions, references, and lifecycle state. |
| Compliance and finance | Regulations, controls, evidence, licensing readiness, tax/remittance setup, payment controls, and reporting. |
| Edge Node | Single-host bundled Edge Node, admin trust/freshness surface, collector runbooks, and multi-host/air-gapped verification guides. |
| Windows installer | Zero-prerequisites Windows installer with production usage, Docker Desktop/WSL2 setup, lifecycle commands, and generated credentials. |

### Early access

| Area | Description |
| ---- | ----------- |
| macOS Apple Silicon installer | Code-complete and merged on `main`; static CI gates are green. Community verification reports are needed before GA. See [docs/install/macos.md](docs/install/macos.md). |
| Native Linux installer | Code-complete and merged on `main`; Ubuntu CI exercises the full stack. More distro and hardware reports are needed before GA. See [docs/install/linux.md](docs/install/linux.md). |
| Edge Node beyond single-host | Multi-host LAN and air-gapped runbooks exist, with verification templates and operator approval ceremonies. Native host binaries and mTLS hardening remain follow-on work. |

### In design

| Area | Description |
| ---- | ----------- |
| Customer-cloud deployment | Single-tenant customer-hosted deployment on cloud compute, not multi-tenant SaaS. See the [cloud deployment spec](docs/superpowers/specs/2026-05-09-cloud-deployment-design.md). |
| TAPPaaS module | Self-hosted private-platform packaging via [TAPPaaS](https://tappaas.org/), tracked by the cloud deployment design. |
| Zero-click provider and MCP onboarding polish | Reduces manual setup friction for provider and external-tool registration while preserving the same governance gates. |
| Conversational setup depth | The AI-guided setup path continues to move toward more context-aware onboarding and fewer rigid setup forms. |

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
