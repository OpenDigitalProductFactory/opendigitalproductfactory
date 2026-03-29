---
title: "Build Studio"
area: build-studio
order: 1
lastUpdated: 2026-03-29
updatedBy: Claude (Software Engineer)
---

## Overview

Build Studio is the platform's feature development environment. It guides a new capability from initial idea through to a shipped, tested, and deployed feature using a five-phase pipeline. AI agents assist at each phase, handling research, planning, code generation, and deployment while keeping a human in control of decisions.

## Key Concepts

- **Phases** — The five stages every feature moves through: Ideate (define the problem), Plan (design the solution), Build (generate and test code), Review (quality gates), Ship (deploy to production).
- **Feature Brief** — The structured output of the Ideate phase. It captures the problem, desired outcome, constraints, and acceptance criteria. Everything downstream is built from this.
- **AI Coworker** — The Software Engineer agent that works with you through each phase. It searches the codebase, writes code, runs tests, and deploys features. You guide it with plain language.
- **Sandbox** — An isolated execution environment where generated code runs safely without affecting the production platform. Each sandbox has its own database, file system, and network.
- **Live Preview** — During the Build phase, a real-time preview shows the generated UI in an iframe. The preview updates automatically as the AI Coworker writes code.
- **Quality Gates** — Automated checks between phases. Each gate requires specific evidence before the feature can advance (design review, plan review, test results, typecheck).
- **Promotion** — The process of moving a completed feature from the sandbox into production. Includes database backup, image rebuild, health check, and automatic rollback on failure.

## What You Can Do

- Start a new feature by describing the idea in the conversation panel
- Review and refine the feature brief before moving to planning
- Approve the plan and watch the AI Coworker build and test the feature
- See the live preview of your feature as it is being built
- Review test results and acceptance criteria before shipping
- Ship the feature to production with automatic deployment and rollback protection
- Track active builds and their current phase from the Build Studio dashboard

## The Five Phases

### Ideate

Describe what you want in plain language. The AI Coworker searches the existing codebase for relevant patterns, then creates a design document covering the problem, approach, and acceptance criteria. You review and approve before moving on.

### Plan

The AI Coworker creates an implementation plan listing the files to create or modify, tasks to complete, and tests to write. You see a plain-language summary. Approve the plan to start building.

### Build

The AI Coworker generates code inside an isolated sandbox. You can see the live preview update in real time. It runs tests and typecheck after generating code. If tests fail, it attempts to fix them automatically. You can ask for changes at any time.

### Review

Quality gates verify the feature is ready: all tests pass, typecheck is clean, acceptance criteria are met, and accessibility checks pass. The AI Coworker presents a plain-language summary of the results.

### Ship

The AI Coworker registers the feature as a digital product, creates a promotion record, and triggers the autonomous deployment pipeline. The platform backs up the database, builds a new version with the feature, swaps it into production, and verifies health. See [Feature Deployment](deployment) for the full process.

## Related

- [Feature Deployment](deployment) — How the deployment pipeline works, safety guarantees, and rollback
