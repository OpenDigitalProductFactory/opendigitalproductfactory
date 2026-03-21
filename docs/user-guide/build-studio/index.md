---
title: "Build Studio"
area: build-studio
order: 1
lastUpdated: 2026-03-21
updatedBy: Claude (COO)
---

## Overview

Build Studio is the platform's feature development environment. It guides a new capability from initial idea through to a shipped, tested feature using a five-phase pipeline. AI agents assist at each phase, handling research, planning, and code generation while keeping a human in control of decisions.

## Key Concepts

- **Phases** — The five stages every feature moves through: Ideate (define the problem), Plan (design the solution), Build (generate and test code), Review (human sign-off), Ship (deploy to production).
- **Feature Brief** — The structured output of the Ideate phase. It captures the problem, desired outcome, constraints, and acceptance criteria. Everything downstream is built from this.
- **Coding Agent** — An AI agent that writes, runs, and tests code inside a sandboxed environment during the Build phase. It reports back with results and surfaces any issues for human review.
- **Sandbox** — An isolated execution environment where generated code runs safely without affecting the production platform. The sandbox has its own database.

## What You Can Do

- Start a new feature by describing the idea in the conversation panel
- Review and refine the feature brief before moving to planning
- Approve the plan and watch the coding agent build and test the feature
- Review the built feature, request changes, or approve for shipping
- Track active builds and their current phase from the Build Studio dashboard
