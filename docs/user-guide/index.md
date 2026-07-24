---
title: "User Guide"
description: "Day-to-day operating guide for the Open Digital Product Factory platform - market archetypes, AI coworkers, Build Studio, compliance, finance, HR, customers, wiki, workspace, and more."
---

The User Guide is the day-to-day operating manual for everyone who works in the platform. The same pages are bundled into the portal's in-app help at runtime, so what you see here matches what you see when you press the help button inside the product.

If you're brand new, start with [Getting Started](getting-started/index.md). The other sections are organized by the work you do, not by the screens you click.

## Start here

- [Getting Started](getting-started/index.md) — what the platform does for your business, choosing your business type, your first hour, and where your AI coworker lives.
- [Market Archetypes And Coworkers](market-archetypes.md) — how the selected business type shapes the portal, workspace, vocabulary, coworkers, voice, and marketing posture.
- [Setup And First Login](getting-started/setup-and-first-login.md) — the first-run walkthrough.
- [AI Coworker](getting-started/ai-coworker.md) — working with the context-aware assistant on every screen.
- [Roles & Access](getting-started/roles-and-access.md) — the platform roles and what each one can do.

Changing the platform's own source code is a separate job with a separate setup — see [Contributing & Dev Setup](contributing/index.md) and [Development Workspace](development-workspace.md).

## Domain guides

Each of these is the operating manual for one part of the platform. The pages are written for the people doing the work — admins for admin-only screens, finance leads for finance, and so on.

| Section | What it covers |
|---------|----------------|
| [AI Workforce](ai-workforce/index.md) | Provider configuration, model routing lifecycle, decision perspective, cost governance, and per-provider notes (Anthropic, Codex/OpenAI, xAI/Grok, local models). |
| [Build Studio](build-studio/index.md) | The guided five-phase pipeline (intake, design, build, review, ship), Build runtime, documentation impact, and deployment. |
| [Compliance](compliance/index.md) | Regulations, controls, evidence, audits, incidents, regulatory submissions. |
| [Customers](customers/index.md) | Customer accounts, sales pipeline, marketing. |
| [Finance](finance/index.md) | Invoicing, AP/AR, banking and reconciliation, AI spend, controls and automation, reporting. |
| [HR](hr/index.md) | Employees, roles, lifecycle scaffolding. |
| [Operations](operations/index.md) | Delivery backlog, infrastructure discovery, value-stream operations. |
| [Platform](platform/index.md) | AI operations, Edge Nodes, identity & access, authority & audit, tools & integrations. |
| [Portfolios](portfolios/index.md) | Portfolio management, health metrics, investment tracking. |
| [Products](products/index.md) | Product inventory, lifecycle stages, business-model roles. |
| [Security Operations](security/index.md) | The built-in AI SOC — sources, detections, cases, governed response, compliance, and MSP federation. |
| [Storefront](storefront/index.md) | Public-facing storefront — setup, catalog, inbox, fulfilment, business and operations settings. |
| [Wiki](wiki/index.md) | Governed platform knowledge, founder-kernel pages, principles, and citations. |
| [Workspace](workspace/index.md) | The personal workspace, managed documents, and cross-domain activity. |
| [Admin](admin/index.md) | Admin-only configuration screens. |

## Architecture and standards

The runtime architecture, the Trusted AI Kernel (TAK), the Global AI Agent Identification & Governance (GAID) standard, and the platform's conformance assessment live under the [Architecture section](../architecture/platform-overview.md).

## Specifications and plans

Long-form design specs, audits, and implementation plans are kept in the source repository under [`docs/superpowers/`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/docs/superpowers). They are historical records of how each capability was built, not onboarding material - useful if you want to understand a design decision but not necessary to use the platform.

## Documentation freshness

Documentation is part of DPF's delivery definition of done. Build Studio and external Claude, Codex, and Grok implementation threads update the user guide, public site, architecture docs, `AGENTS.md`, or implementation history when a change affects those audiences. If a change does not need docs, the build or PR records a concrete no-docs-needed reason.
