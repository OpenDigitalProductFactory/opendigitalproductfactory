---
title: "User Guide"
description: "Day-to-day operating guide for the Open Digital Product Factory platform — getting started, AI coworkers, Build Studio, compliance, finance, HR, customers, and more."
lastUpdated: 2026-04-26
---

The User Guide is the day-to-day operating manual for everyone who works in the platform. The same pages are bundled into the portal's in-app help at runtime, so what you see here matches what you see when you press the help button inside the product.

If you're brand new, start at [Getting Started](getting-started/). The other sections are organized by the work you do, not by the screens you click.

## Start here

- [Getting Started](getting-started/) — what the platform does, how navigation works, and where your AI coworker lives.
- [Roles & Access](getting-started/roles-and-access) — the platform roles and what each one can do.
- [AI Coworker](getting-started/ai-coworker) — working with the context-aware assistant on every screen.
- [Development Workspace](development-workspace) — how Build Studio, VS Code, policy states, and validation environments fit together.

## Domain guides

Each of these is the operating manual for one part of the platform. The pages are written for the people doing the work — admins for admin-only screens, finance leads for finance, and so on.

| Section | What it covers |
|---------|----------------|
| [AI Workforce](ai-workforce/) | Provider configuration, model routing lifecycle, per-provider notes (Anthropic, Codex, Ollama). |
| [Build Studio](build-studio/) | The guided five-phase pipeline (intake, design, build, review, ship), sandbox, and deployment. |
| [Compliance](compliance/) | Regulations, controls, evidence, audits, incidents, regulatory submissions. |
| [Customers](customers/) | Customer accounts, sales pipeline, marketing. |
| [Finance](finance/) | Invoicing, AP/AR, banking and reconciliation, AI spend, controls and automation, reporting. |
| [HR](hr/) | Employees, roles, lifecycle scaffolding. |
| [Operations](operations/) | Delivery backlog, infrastructure discovery, value-stream operations. |
| [Platform](platform/) | AI operations, identity & access, authority & audit, tools & integrations. |
| [Portfolios](portfolios/) | Portfolio management, health metrics, investment tracking. |
| [Products](products/) | Product inventory, lifecycle stages, business-model roles. |
| [Storefront](storefront/) | Public-facing storefront — setup, catalog, inbox, fulfilment, business and operations settings. |
| [Workspace](workspace/) | The personal workspace — your daily view. |
| [Admin](admin/) | Admin-only configuration screens. |

## Architecture and standards

The runtime architecture, the Trusted AI Kernel (TAK), the Global AI Agent Identification & Governance (GAID) standard, and the platform's conformance assessment live under the [Architecture section](../architecture/platform-overview/).

## Specifications and plans

Long-form design specs and implementation plans are kept in the source repository under [`docs/superpowers/`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/tree/main/docs/superpowers). They are historical records of how each capability was built, not onboarding material — useful if you want to understand a design decision but not necessary to use the platform.
