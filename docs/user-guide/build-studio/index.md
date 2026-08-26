---
title: "Build Studio"
area: build-studio
order: 1
relatedCode:
  - apps/web/lib/build/build-orchestrator.ts
---

## Overview

Build Studio is the platform's guided way to turn a plain-language outcome into a tested, documented, and deployable platform change. You do not need to manage its internal delivery process. The main workspace stays focused on four questions: what you asked for, what is happening now, whether Build Studio needs a decision, and what evidence has accumulated.

Build Studio is not a separate code universe. It works from the install's shared development workspace. In customizable installs, that means Build Studio and VS Code operate on the same source tree while the portal continues to own review, evidence, and governed promotion.

### Development Workrooms

Open `/build/work` when you need the engineering context behind Build Studio: live development Workrooms, adoptable worktrees, branches, and the governed work-planning form. Its live count only includes rooms with current execution evidence. Use **Operations > Workrooms** for every live room plus retained history, and **Architecture > Workrooms** for reusable definitions, participants, queues, and human triggers.

## The operator workspace

Open **Build Studio** under **Delivery**, then:

1. Choose **Start a new outcome** and describe what should be different, who it helps, and any constraint that matters.
2. Choose **Continue**, review the captured outcome, and explicitly start the governed build.
3. Follow the plain-language status. Build Studio continues routine research, planning, implementation, and checking without asking you to operate each internal stage.
4. Respond when the workspace says **Needs you**. Human attention is reserved for consequence, unresolved product judgment, elevated risk, or a blocked prerequisite.
5. Open **Technical details** when you need the process graph, source branch, work warrant, canonical documents, review evidence, queue diagnostics, or build-runtime information.

The compact activity story is evidence, not a wizard. It shows what Build Studio has understood, shaped, built, and checked; it does not turn each internal phase into another button the operator must click.

## Current Maturity

Build Studio is real and can now run fully autonomously for explicitly enabled, evidence-cleared
lower-risk lanes. It remains a governed self-development surface rather than blanket developer
authority: high-risk, regulatory, ambiguous, or evidence-incomplete work still pauses for a
decision, and complex unsupported source workflows may still use an external development surface.

Recent hardening work includes plan-review trajectory, design-time decomposition for oversized builds, activity quiescence for safer portal upgrades, and voice/follow-up guards in coworker chat. Complex source changes may still need VS Code in customizable installs while Build Studio keeps the design, review, test, and promotion record.

Build Studio also has a governed experimentation substrate for reviewed Living Playbook candidates.
Eligible immutable replay lanes can run autonomously in shadow to compare method and model
factors. A separately enabled active Living Playbook binding can then govern a contained
lower-risk Build Studio lane through phase transitions, bounded recovery, exact-head PR checks,
the merge queue, and deployed completion. Unsupported or higher-authority cases remain
escalations.

## Key Concepts

- **Activity story** — The operator-facing evidence trail: outcome understood, approach shaped, solution built, quality checked, and ready to use. It compresses routine internal work into a readable history.
- **Technical phases** — Ideate, Plan, Build, Review, and Ship remain the canonical governed states. They appear in technical details and audit evidence rather than dominating the operator workspace.
- **Feature Brief** — The structured output of the Ideate phase. It captures the problem, desired outcome, constraints, and acceptance criteria. Everything downstream is built from this.
- **AI Coworker** — The Software Engineer agent that works with you through each phase. It searches the codebase, writes code, runs tests, and deploys features. You guide it with plain language.
- **Change Reviewer** — An independent, read-only coworker for governed Workrooms. It inspects committed source, tests, architecture, and evidence, but cannot edit the change, advance the build, waive findings, or publish a release. The Software Engineer remains the authoring coworker on the main Build Studio surface.
- **Build runtime** — The isolated execution environment where the AI Coworker generates and tests code. Has its own database, file system, and network — completely separated from the live platform. The Build Studio canvas surfaces it as **Live preview**; the technical name *sandbox* still appears in diagnostics. See [Build Runtime](sandbox.md) for the full operating model.
- **Shared Workspace** — The durable source workspace for this install. Build Studio reads and writes here, and in customizable installs VS Code uses the same codebase.
- **Live Preview** — During the Build phase, a real-time preview shows the generated UI in an iframe. The preview updates automatically as the AI Coworker writes code.
- **Documentation Specialist** — The cross-cutting coworker that checks whether a change affects the user guide, public site, architecture docs, `AGENTS.md`, prompts, route maps, or other human-readable docs. Docs updates, or a concrete no-docs-needed attestation, are part of done.

New coworkers enter the roster as drafts. They are not available for normal
work until their definition has landed, a read-only golden journey has passed
through the real execution path, and the coworker factory explicitly promotes
them. A normal seed or upgrade preserves that lifecycle state; deployment alone
does not certify or activate a coworker.
- **Quality Gates** — Automated checks between phases. Each gate requires specific evidence before the feature can advance (design review, plan review, documentation impact, test results, typecheck). After Build Studio assembles the task outputs, Change Reviewer independently checks that committed change before UX verification or promotion. Its receipt appears in the same Workroom activity story; no separate review workspace is added.
  A review may be **inconclusive** when reviewer capacity or transport is unavailable. That state asks the system to retry; it is not displayed or counted as a code defect. Once calibrated enforcement is enabled, publication requires a fresh exact-change receipt or an explicit policy-versioned exemption. The publication check is local and deterministic, so it never waits for another AI call.
- **Promotion** — The governed process for moving a completed feature from the Build runtime into production where the install is configured for it. Includes evidence capture, backup/rebuild/health-check discipline, and rollback planning.

## What You Can Do

- Start a new outcome in plain language
- See one current status and the next meaningful action
- Respond to product, risk, or consequence decisions when Build Studio needs you
- Follow a compact story of completed and current work
- Open technical details for the full design, source, test, review, runtime, and promotion evidence
- Prepare the outcome for governed promotion with recorded evidence, health checks, and rollback planning

## What happens behind the activity story

### Ideate

Build Studio turns the requested outcome into an evidence-backed problem statement and acceptance criteria. It searches the existing codebase and platform guidance before proposing change.

### Plan

The AI Coworker creates or refines the implementation plan, including affected files, tests, documentation impact, dependencies, and risk controls. Routine plan progression can remain under coworker custody; unresolved product judgment or elevated consequence returns to you as a clear decision.

### Build

The AI Coworker generates code inside the isolated Build runtime. It runs tests and typecheck, gathers concrete evidence, and can use bounded disposable spikes to answer uncertain UX or implementation questions. A spike is evidence, not production code: the normal design, review, and release gates still decide what may ship.

If a task stops before it finishes, Build Studio distinguishes *why*. When the coding session died on infrastructure — a timeout, a provider outage, a rate limit, the process being killed — that is not a verdict on your feature, so the same task is re-run once automatically and you see a "retrying" note in the activity feed. When the session instead stopped because it needs something only you can supply — an unresolved product question, a contradiction in the spec — it is **not** retried, because re-running will not answer the question. That one surfaces as a blocked task for you to resolve.

### Review

Quality gates verify the feature is ready: documentation evidence is present, all tests pass, typecheck is clean, acceptance criteria are met, and accessibility checks pass. The AI Coworker presents a plain-language summary of the results.

### Ship

The AI Coworker prepares the promotion record and evidence. Where promotion is enabled, the platform backs up the database, builds a new version with the feature, swaps it into production, and verifies health. Where the surface is still hardening, keep the promotion record honest and finish through the supported source workflow. See [Feature Deployment](deployment.md) for the full process.

## Related

- [Feature Deployment](deployment.md) — How the deployment pipeline works, safety guarantees, and rollback
- [Autonomous Build Studio lanes](autonomous-builds.md) — Eligibility, visible custody states, bounded recovery, and attention boundaries
- [Development Workspace](../development-workspace.md) — How Build Studio, VS Code, policy states, and validation environments fit together
- [Market Archetypes And Coworkers](../market-archetypes.md) — Why user-facing docs should lead with business work before Build Studio internals

## Documentation Deliverables

When a feature adds a new route or materially changes how an existing route works, the Build Studio deliverable is not complete until the matching `docs/user-guide` page exists or is updated. The same rule applies beyond routes: changes to setup, operations, architecture, AI coworkers, prompts, public positioning, external-agent workflows, or contributor doctrine must update the correct docs surface or record why no docs changed.

- Route-level docs should explain the actual workflow of that page, not just the parent area.
- Internal shell routes should ship with a contextual docs target so the page-level Docs link lands on the right guide.
- Public, portal, auth, token-action, and customer-auth routes still need an explicit documentation policy decision even when they intentionally do not expose internal docs links.
- Public evaluator copy belongs in `docs/index.html`; day-to-day operator guidance belongs in `docs/user-guide/`; architecture and contributor explanations belong in `docs/architecture/`; durable agent doctrine belongs in `AGENTS.md`; implementation history belongs in `docs/superpowers/`.
