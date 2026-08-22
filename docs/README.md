# Documentation

> Looking for a pre-install tour you can share with people who don't have the platform yet? See [index.html](index.html) — a single-page overview that links into the rest of this directory.

This directory holds the long-form documentation that accompanies the Open Digital Product Factory source tree. It is split into three practical audiences:

- **Market and operator** docs explain the platform from the business archetype outward: what kind of business this is, which coworkers help, and what daily work improves.
- **User-facing** docs live under [user-guide/](user-guide/) and are also bundled into the portal's in-app help pages at runtime.
- **Architecture and contributor** docs live under [architecture/](architecture/) and (for internal development tracking) [superpowers/](superpowers/).

Documentation freshness is part of the delivery definition of done. Build Studio and external Claude, Codex, and Grok implementation threads update the relevant human-readable docs surface when they change user workflows, AI coworker behavior, public positioning, setup/install, operations, architecture, prompts, route maps, or contributor workflow. If no docs are needed, the build or PR records the concrete reason.

If you're looking for the one-page project overview, start at the repo-root [README.md](../README.md).

## User guide

Entry points for people using the platform day-to-day:

- [Market Archetypes And Coworkers](user-guide/market-archetypes.md) — the canonical user-facing explanation of archetypes, purposed coworkers, voice, and Build Studio's current boundary.
- [Getting Started](user-guide/getting-started/index.md) — what the platform does, how navigation works, and where your AI coworker lives.
- [Developer Setup](user-guide/contributing/developer-setup.md) — running the codebase locally with pnpm + Docker sidecars.
- [Dev Container Setup](user-guide/contributing/dev-container.md) — fully containerized alternative that needs only Docker Desktop and VS Code.
- [Agent Development Environments](user-guide/contributing/agent-dev-environments.md) — set up Claude, Codex, and Grok (desktop apps or CLI) as governed coding agents: MCP, the skill pack, AGENTS.md, local client settings, and running multiple concurrent threads without breaking the portal's processes.
- [Development Workspace](user-guide/development-workspace.md) — how Build Studio, VS Code, policy states, and validation environments fit together.
- [AI Coworker](user-guide/getting-started/ai-coworker.md) — working with the context-aware AI assistant on every screen.
- [Roles & Access](user-guide/getting-started/roles-and-access.md) — platform roles and what each one can do.
- [Customer 0 Pre-Install Readiness](operations/customer-zero-preinstall-readiness.md) — first-install checklist for the `software-platform` archetype, reseller feedback routing, and non-technical operator handoff.

Domain-specific operating guides (admin, AI workforce, build studio, compliance, customers, finance, HR, operations, platform, portfolios, products, storefront, wiki, workspace) live in their own folders under [user-guide/](user-guide/).

## Market proof

- [DPF Market Vision](marketing/dpf-market-vision.md) — public positioning for DPF as an AI-operated company platform: market, competitors, adapter-to-native strategy, and priority roadmap.
- [Persona Library](personas/README.md) — evidence-backed archetype stories that double as marketing substrate and re-runnable dogfood scenarios.
- [Dale HVAC](personas/dale-hvac.md), [Linda Clinic](personas/linda-clinic.md), and [Marisol Retail](personas/marisol-retail.md) are the current proof set for vertical workspace homes.

## Source-of-truth boundaries

- [Repo README](../README.md) is the source-facing project overview and install posture.
- [index.html](index.html) is the public pre-install website and marketing tour.
- [marketing/dpf-market-vision.md](marketing/dpf-market-vision.md) is the product-positioning and competitor-framing narrative for the company operating platform vision.
- [user-guide/market-archetypes.md](user-guide/market-archetypes.md) is the canonical archetype/coworker narrative for user-facing docs.
- [user-guide/](user-guide/) is operational product help and contextual in-app documentation.
- [architecture/](architecture/) is current architecture, standards, and conformance context.
- [superpowers/](superpowers/) is design history, audits, and implementation planning. It can support decisions, but it is not onboarding copy.
- [AGENTS.md](../AGENTS.md) is the canonical operating contract for Build Studio-adjacent and external agent development work.

## Architecture

- [Platform Overview](architecture/platform-overview.md) — runtime core, deployment models, hardware tiers, and Docker Compose breakdown.
- [Platform Substrate Boundaries and Budgets](architecture/platform-substrate-boundaries.md) — the physical-boundary inventory, evidence sources, and complexity ratchets.
- [Capability-Driven Runtime Profiles](architecture/capability-driven-runtime-profiles.md) — how capabilities resolve host-aware services for install, transitions, backup, diagnostics, and four-state health.
- [Unified Connector Kernel](architecture/unified-connector-kernel.md) — the provider-neutral definition, credential, lifecycle, audit, callback, registry, and extension contract for external integrations.
- [External Channel Projection](architecture/external-channel-projection.md) — replay-safe external identity, publication receipts, drift handling, and the boundary between DPF canonical content and customer-owned channels such as WordPress.
- [Unified Development Activity Tracking](architecture/unified-development-tracking.md) — how all development work (Build Studio plus external Claude / Codex / Grok agents) is tracked as one WorkCapsule unit and shown in one cross-surface activity view. Includes an at-a-glance diagram.
- [Autonomy, WWMD, and trusted coworker decisions](architecture/autonomy-and-wwmd.md) — how the founder-kernel wiki, principle vectors, decision profiles, and audit ledgers let coworkers answer ambiguity without silently overreaching.
- [Trustworthy AI Agent Standards Family](architecture/agent-standards-family.md) — the ownership and composition map for TAK, GAID, and TAK-JSI.
- [Trusted AI Kernel (markdown)](architecture/trusted-ai-kernel.md) / [(Word)](architecture/Trusted-AI-Kernel-Architecture.docx) — the layered runtime harness, authority, oversight, autonomy, evidence, and immutable-directive standard.
- [Global AI Agent Identification and Governance](architecture/GAID.md) — enduring identity, operating-profile state, assurance claims, badges, receipts, and lifecycle.
- [Job-Specific Intelligence](architecture/job-specific-intelligence.md) — job- and context-specific qualification, evaluation, surveillance, and revalidation for agent operating profiles.
- [External Standards Alignment](architecture/agent-standards-external-alignment.md) — specific synergy and augmentation boundaries across NIST, ISO/IEC, IEEE, W3C, IETF, OpenID, and 1EdTech work.
- [Standards Contribution Roadmap](architecture/agent-standards-contribution-roadmap.md) — staged incubation, evidence, interoperability, and formal-submission readiness for TAK, GAID, and TAK-JSI.
- [AI Coworker Development Principles](architecture/ai-coworker-development-principles.md) — the contract AI coworkers are expected to honor.
- `ea-diagrams/`, `tak-diagrams/` — Mermaid sources used by the architecture docs.

Regenerate the TAK Word document after edits with `pnpm docs:tak`.

## Other tooling docs

- [Platform Usability Standards](platform-usability-standards.md)
- [Dark Theme Development Guidelines](dark-theme-development-guidelines.md)
- [Reference/](Reference/) — reference material (IT4IT mapping, DPPM taxonomy source material).

## Internal planning notes

[superpowers/](superpowers/) holds in-flight specs and plans that document how the platform was built. They are historical records, not public-facing onboarding material — treat them as read-only context.
