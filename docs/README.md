# Documentation

This directory holds the long-form documentation that accompanies the Open Digital Product Factory source tree. It's split into two audiences:

- **User-facing** docs live under [user-guide/](user-guide/) and are also bundled into the portal's in-app help pages at runtime.
- **Architecture and contributor** docs live under [architecture/](architecture/) and (for internal development tracking) [superpowers/](superpowers/).

If you're looking for the one-page project overview, start at the repo-root [README.md](../README.md).

## User guide

Entry points for people using the platform day-to-day:

- [Getting Started](user-guide/getting-started/index.md) — what the platform does, how navigation works, and where your AI coworker lives.
- [Developer Setup](user-guide/getting-started/developer-setup.md) — running the codebase locally with pnpm + Docker sidecars.
- [Dev Container Setup](user-guide/getting-started/dev-container.md) — fully containerized alternative that needs only Docker Desktop and VS Code.
- [Development Workspace](user-guide/development-workspace.md) — how Build Studio, VS Code, policy states, and validation environments fit together.
- [AI Coworker](user-guide/getting-started/ai-coworker.md) — working with the context-aware AI assistant on every screen.
- [Roles & Access](user-guide/getting-started/roles-and-access.md) — platform roles and what each one can do.

Domain-specific operating guides (admin, AI workforce, build studio, compliance, customers, finance, HR, operations, portfolios, products, storefront, workspace) live in their own folders under [user-guide/](user-guide/).

## Architecture

- [Platform Overview](architecture/platform-overview.md) — runtime core, deployment models, hardware tiers, and Docker Compose breakdown.
- [Trusted AI Kernel (markdown)](architecture/trusted-ai-kernel.md) / [(Word)](architecture/Trusted-AI-Kernel-Architecture.docx) — the layered enforcement, routing, audit, and immutable-directive architecture for agentic work.
- [AI Coworker Development Principles](architecture/ai-coworker-development-principles.md) — the contract AI coworkers are expected to honor.
- `ea-diagrams/`, `tak-diagrams/`, `monitoring-diagrams/` — Mermaid sources used by the architecture docs.

Regenerate the TAK Word document after edits with `pnpm docs:tak`.

## Other tooling docs

- [Platform Usability Standards](platform-usability-standards.md)
- [Dark Theme Development Guidelines](dark-theme-development-guidelines.md)
- [Reference/](Reference/) — reference material (IT4IT mapping, DPPM taxonomy source material).

## Internal planning notes

[superpowers/](superpowers/) holds in-flight specs and plans that document how the platform was built. They are historical records, not public-facing onboarding material — treat them as read-only context.
