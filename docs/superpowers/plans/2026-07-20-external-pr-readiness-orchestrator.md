# External-Agent PR Readiness Orchestrator Implementation Plan

> **For agentic workers:** Follow the repository `AGENTS.md` contract: one worktree and PR per independently shippable slice, tests before implementation, DCO-signed commits, governed runtime verification, and ready-only pull requests. Steps use checkbox (`- [ ]`) syntax for tracking.

**Backlog item:** `BI-E0D662DD`

**Goal:** Add a source-local pre-PR readiness orchestrator that catches DPF governance and evidence issues before GitHub Actions is the first reporter.

**Architecture:** A new `scripts/pr-readiness.mjs` CLI gathers Git state, computes the exact branch diff against fresh `origin/main`, validates PR-body trailers, runs existing local gate scripts, and prints a plain-language verdict. Pure decision logic lives in `scripts/pr-readiness/core.mjs` so Node tests can cover the policy without shelling out.

**Tech Stack:** Node.js ESM, `node:test`, existing DPF gate scripts under `scripts/check-*.mjs`, and the existing shared-safe Git fetch helper.

---

## Backlog coverage

- Decision: atomic
- Parent: `BI-E0D662DD`
- Receipt: `WC-6D2D82B8`
- Dependencies: none
- Rationale: The BI describes one independently shippable tool surface: a pre-PR readiness orchestrator for external agents. The gate coverage, trailer validation, diff hygiene, and operator output are all part of the same executable contract, so splitting them would create a partial tool that cannot satisfy the backlog outcome.

## Design grounding

- Existing specs/plans reviewed:
  - `docs/superpowers/specs/2026-05-30-development-process-spine-design.md`
  - `docs/superpowers/plans/2026-07-12-design-grounding-gate.md`
  - `docs/superpowers/plans/2026-07-11-seed-contribution-fit-gate.md`
  - `docs/testing/pr-health.md`
- Current code substrate reviewed:
  - `scripts/pr-health.mjs`
  - `.github/workflows/ci.yml`
  - `scripts/check-spec-plan-doc.mjs`
  - `scripts/check-plan-backlog-coverage.mjs`
  - `scripts/check-seed-fit-decision.mjs`
  - `scripts/check-ux-fit-decision.mjs`
  - `scripts/check-design-grounding-decision.mjs`
  - `scripts/check-data-impact.mjs`
  - `scripts/check-docs-impact.mjs`
  - `scripts/check-doc-reference-integrity.mjs`
  - `scripts/check-no-retired-superpowers-skills.mjs`
  - `scripts/lib/git-fetch-shared-safe.mjs`
- Source of truth: Existing CI gate scripts remain authoritative; the orchestrator composes them and adds pre-PR Git/trailer checks.
- Decision: Add a separate `pr-readiness` preflight instead of broadening `pr-health`, because `pr-health` is intentionally post-PR and GitHub-state based.

## Tasks

### Task 1: Pure readiness policy

**Files:**
- Create: `scripts/pr-readiness/core.mjs`
- Create: `scripts/pr-readiness.test.mjs`

- [ ] Write failing tests for shallow history, ambiguous merge-base, dirty/unpushed work, missing DCO, trailer validation, and gate definition coverage.
- [ ] Implement the smallest pure policy functions that make those tests pass.
- [ ] Refactor the result model until every blocker/warning has a stable operator-facing message.

### Task 2: CLI runner

**Files:**
- Create: `scripts/pr-readiness.mjs`
- Modify: `package.json`

- [ ] Add a CLI that fetches `origin/main` using the shared-safe helper.
- [ ] Gather branch, merge-base, diff, working tree, ahead/behind, and commit trailer state with `git`.
- [ ] Run the local gate script plan with `BASE_SHA=origin/main`, `PR_BODY`, `PR_LABELS_JSON=[]`, and `GITHUB_EVENT_NAME=pull_request`.
- [ ] Add `pnpm pr:ready` as the operator entry point.

### Task 3: Verification and delivery

**Files:**
- Test: `scripts/pr-readiness.test.mjs`
- Test: affected existing gate scripts through the orchestrator

- [ ] Run the new tests and the orchestrator against this branch.
- [ ] Run relevant existing script tests for gates composed by the orchestrator.
- [ ] Run source-local type/check gates that do not require the runtime sandbox.
- [ ] Commit with DCO sign-off, push, and record evidence on `WC-6D2D82B8`.
