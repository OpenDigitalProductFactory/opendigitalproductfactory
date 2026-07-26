---
title: "Build Studio"
area: build-studio
order: 1
relatedCode:
  - apps/web/lib/integrate/build-orchestrator.ts
---

## Overview

Build Studio is the platform's feature development environment. It guides a new capability from initial idea through to a shipped, tested, documented, and deployed feature using a five-phase pipeline. AI agents assist at each phase, handling research, planning, code generation, documentation impact, verification, and deployment while keeping a human in control of decisions.

Build Studio is not a separate code universe. It works from the install's shared development workspace. In customizable installs, that means Build Studio and VS Code operate on the same source tree while the portal continues to own review, evidence, and governed promotion.

## Current Maturity

Build Studio is real, but it is still being hardened. It should be described as the governed self-development surface and evidence trail, not as a fully autonomous replacement for every developer workflow today.

Recent hardening work includes plan-review trajectory, design-time decomposition for oversized builds, activity quiescence for safer portal upgrades, and voice/follow-up guards in coworker chat. Complex source changes may still need VS Code in customizable installs while Build Studio keeps the design, review, test, and promotion record.

Build Studio also has a governed experimentation substrate for reviewed Living Playbook candidates.
Eligible immutable replay lanes can run autonomously in shadow, compare method and model factors,
and record reproducible evidence without advancing a feature phase, creating a pull request,
joining the merge queue, releasing software, or changing live customer state. Unsupported or
higher-authority cases remain escalations.

## Key Concepts

- **Phases** — The five stages every feature moves through: Ideate (define the problem), Plan (design the solution), Build (generate and test code), Review (quality gates), Ship (deploy to production).
- **Feature Brief** — The structured output of the Ideate phase. It captures the problem, desired outcome, constraints, and acceptance criteria. Everything downstream is built from this.
- **AI Coworker** — The Software Engineer agent that works with you through each phase. It searches the codebase, writes code, runs tests, and deploys features. You guide it with plain language.
- **Build runtime** — The isolated execution environment where the AI Coworker generates and tests code. Has its own database, file system, and network — completely separated from the live platform. The Build Studio canvas surfaces it as **Live preview**; the technical name *sandbox* still appears in diagnostics. See [Build Runtime](sandbox.md) for the full operating model.
- **Shared Workspace** — The durable source workspace for this install. Build Studio reads and writes here, and in customizable installs VS Code uses the same codebase.
- **Live Preview** — During the Build phase, a real-time preview shows the generated UI in an iframe. The preview updates automatically as the AI Coworker writes code.
- **Documentation Specialist** — The cross-cutting coworker that checks whether a change affects the user guide, public site, architecture docs, `AGENTS.md`, prompts, route maps, or other human-readable docs. Docs updates, or a concrete no-docs-needed attestation, are part of done.
- **Quality Gates** — Automated checks between phases. Each gate requires specific evidence before the feature can advance (design review, plan review, documentation impact, test results, typecheck).
- **Promotion** — The governed process for moving a completed feature from the Build runtime into production where the install is configured for it. Includes evidence capture, backup/rebuild/health-check discipline, and rollback planning.

## What You Can Do

- Start a new feature by describing the idea in the conversation panel
- Review and refine the feature brief before moving to planning
- Approve the plan and watch the AI Coworker build and test the feature
- See the live preview of your feature as it is being built
- Review test results and acceptance criteria before shipping
- Prepare the feature for governed promotion with recorded evidence, health checks, and rollback planning
- Track active builds and their current phase from the Build Studio dashboard

## The Five Phases

### Ideate

Describe what you want in plain language. The AI Coworker searches the existing codebase for relevant patterns, then creates a design document covering the problem, approach, and acceptance criteria. You review and approve before moving on.

### Plan

The AI Coworker creates an implementation plan listing the files to create or modify, tasks to complete, tests to write, and documentation impact to handle. You see a plain-language summary. Approve the plan to start building.

### Build

The AI Coworker generates code inside the isolated Build runtime. You can see the live preview update in real time. It runs tests and typecheck after generating code. If tests fail, it attempts to fix them automatically. You can ask for changes at any time.

If a task stops before it finishes, Build Studio distinguishes *why*. When the coding session died on infrastructure — a timeout, a provider outage, a rate limit, the process being killed — that is not a verdict on your feature, so the same task is re-run once automatically and you see a "retrying" note in the activity feed. When the session instead stopped because it needs something only you can supply — an unresolved product question, a contradiction in the spec — it is **not** retried, because re-running will not answer the question. That one surfaces as a blocked task for you to resolve.

### Review

Quality gates verify the feature is ready: documentation evidence is present, all tests pass, typecheck is clean, acceptance criteria are met, and accessibility checks pass. The AI Coworker presents a plain-language summary of the results.

### Ship

The AI Coworker prepares the promotion record and evidence. Where promotion is enabled, the platform backs up the database, builds a new version with the feature, swaps it into production, and verifies health. Where the surface is still hardening, keep the promotion record honest and finish through the supported source workflow. See [Feature Deployment](deployment.md) for the full process.

## Related

- [Feature Deployment](deployment.md) — How the deployment pipeline works, safety guarantees, and rollback
- [Development Workspace](../development-workspace.md) — How Build Studio, VS Code, policy states, and validation environments fit together
- [Market Archetypes And Coworkers](../market-archetypes.md) — Why user-facing docs should lead with business work before Build Studio internals

## Documentation Deliverables

When a feature adds a new route or materially changes how an existing route works, the Build Studio deliverable is not complete until the matching `docs/user-guide` page exists or is updated. The same rule applies beyond routes: changes to setup, operations, architecture, AI coworkers, prompts, public positioning, external-agent workflows, or contributor doctrine must update the correct docs surface or record why no docs changed.

- Route-level docs should explain the actual workflow of that page, not just the parent area.
- Internal shell routes should ship with a contextual docs target so the page-level Docs link lands on the right guide.
- Public, portal, auth, token-action, and customer-auth routes still need an explicit documentation policy decision even when they intentionally do not expose internal docs links.
- Public evaluator copy belongs in `docs/index.html`; day-to-day operator guidance belongs in `docs/user-guide/`; architecture and contributor explanations belong in `docs/architecture/`; durable agent doctrine belongs in `AGENTS.md`; implementation history belongs in `docs/superpowers/`.
