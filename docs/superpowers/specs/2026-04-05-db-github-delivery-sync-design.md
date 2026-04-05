# DB to GitHub Delivery Sync Design

**Date:** 2026-04-05  
**Status:** Draft  
**Scope:** backlog-to-GitHub synchronization, issue/project/PR linkage, and delivery-state governance  
**Related specs:**  
- [2026-04-05-continuous-improvement-flywheel-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-04-05-continuous-improvement-flywheel-design.md)  
- [2026-04-05-provider-reconciliation-automation-design.md](/h:/opendigitalproductfactory/docs/superpowers/specs/2026-04-05-provider-reconciliation-automation-design.md)

## Overview

The platform needs a more robust way to track work in Git without losing the richer operating context that already lives in the Digital Product Factory. GitHub Issues and Projects are excellent for engineering execution, pull request flow, and release visibility, but they are not a sufficient source of truth for portfolio-aware backlog management, Digital Product traceability, AI coworker signals, or graph-linked impact analysis.

The recommended design is a **layered operating model**:

- the **platform database** remains the source of truth for epics, backlog items, portfolios, Digital Products, signals, and governance state
- **GitHub Issues** become the execution mirror for implementation-ready work in a specific repository
- **GitHub Projects** become the workflow and reporting view over mirrored implementation work
- **Pull Requests** become the authoritative unit of code delivery linked back to both the GitHub issue and the originating platform backlog item
- **Specs, plans, and release evidence** continue to live in git alongside code and are referenced from both systems

This gives the platform one real operating model without forcing GitHub to carry business and portfolio semantics it does not model well.

## Problem Statement

The platform already models backlog and strategy in a richer way than GitHub:

- `Epic`
- `BacklogItem`
- `DigitalProduct`
- `Portfolio`
- `EpicPortfolio`
- `ImprovementProposal`
- `PortfolioQualityIssue`
- Build Studio execution and AI coworker signals

But engineering delivery increasingly needs a repository-native workflow with:

- branches
- pull requests
- code review
- issue discussion
- project views
- release evidence

If GitHub becomes the only work system, the platform loses:

- Digital Product traceability
- portfolio-level rollups
- graph-aware prioritization
- AI-generated signals and proposals
- cross-deployment/local-vs-common platform context

If GitHub is ignored, engineering delivery loses:

- repository-native planning and review
- contributor-friendly execution workflow
- clear PR linkage
- visible implementation status

The right answer is not choosing one over the other. It is defining which system is authoritative for which class of information.

## Goals

1. Keep the platform DB as the source of truth for backlog and governance.
2. Use GitHub Issues and Projects for engineering execution and code-delivery visibility.
3. Mirror only the right work into GitHub, not every backlog record.
4. Link specs, plans, issues, PRs, releases, and backlog items into one traceable chain.
5. Support the new branch-and-PR workflow without fragmenting the platform backlog.
6. Make the sync durable, explainable, and recoverable.

## Non-Goals

1. Replacing the platform backlog with GitHub Issues.
2. Treating GitHub Projects as the enterprise source of truth.
3. Mirroring every record from the platform DB into GitHub.
4. Supporting arbitrary two-way free-form editing without ownership boundaries.
5. Solving cross-repository portfolio management in v1.

## Research & Benchmarking

### What GitHub does well

GitHub excels at:

- issue discussion near code
- branch and PR workflows
- status automation
- code review and merge traceability
- repository-scoped project views

This makes it the right execution surface for work that is actually being implemented in the platform repository.

### What the platform does better

The platform already carries richer semantics that GitHub does not handle naturally:

- Digital Product identity
- IT4IT portfolio alignment
- graph-connected root-cause context
- AI coworker proposals and quality signals
- provider and tool operational context
- local deployment vs common-platform distinction

This makes the platform DB the right source of truth for strategy, prioritization, and non-code operational work.

### Pattern adopted

Adopt a **system-of-record plus execution-mirror** model:

- platform DB = truth
- GitHub = delivery mirror

### Patterns rejected

- GitHub-only backlog
- DB-only implementation tracking with no GitHub issue/PR structure
- equal two-way editing authority for every field

## Design Summary

The recommended model is:

1. manage epics and backlog in the platform DB
2. promote selected backlog items into a delivery-ready state
3. mirror those delivery-ready items into GitHub Issues
4. place mirrored issues into a GitHub Project workflow
5. link PRs and release evidence back to the originating backlog item
6. keep the platform DB updated with repository execution status

This creates a single operational queue with multiple views rather than separate, drifting work systems.

## Authoritative Boundaries

### Platform DB is authoritative for

- epic title, scope, and lifecycle
- backlog item identity
- Digital Product and portfolio linkage
- business priority and objective alignment
- graph context and root-cause attribution
- improvement proposals and normalized signals
- execution-path decisions (`manual`, `build_studio`, `github_delivery`, `upstream_candidate`)
- final business/governance state

### GitHub is authoritative for

- implementation conversation on mirrored engineering work
- branch and PR lifecycle
- code review status
- merge status
- commit and file-level delivery history
- repository project swimlane status

### Shared / synchronized fields

These should stay linked, but with clear sync direction:

- title
- implementation-focused description
- current execution status
- labels
- assignee / owner
- linked PR number(s)
- release/merge outcome

## Which Work Gets Mirrored

Not every backlog item should become a GitHub issue.

### Mirror to GitHub when

- the backlog item is approved for engineering execution
- the work affects the platform repository
- a branch/PR implementation path is expected
- code review or contributor collaboration is needed

### Do not mirror when

- the item is still only `proposed`
- the work is pure governance or analysis
- the work is local operational follow-up with no repository change
- the work is build-studio-only and not yet approved for repository contribution

### Recommended execution-path values

- `platform_db_only`
- `github_delivery`
- `build_studio_local`
- `build_studio_upstream_candidate`
- `external_non_code`

Only `github_delivery` and approved `build_studio_upstream_candidate` items need GitHub issues in v1.

## GitHub Issue Model

Each mirrored issue should correspond to exactly one implementation-ready platform backlog item.

### Required issue content

Issue title:

- human-readable implementation title

Issue body should include:

- originating `backlogItemId`
- originating `epicId`
- `digitalProductId`
- `portfolioId`
- objective / business outcome
- linked spec path
- linked plan path
- acceptance criteria
- implementation notes
- execution path

### Recommended labels

- `area:<domain>`
- `portfolio:<slug>`
- `product:<slug>`
- `type:feature`
- `type:bug`
- `type:improvement`
- `source:dpf`
- `execution:build-studio`
- `execution:manual`

Labels should be generated from platform metadata, not manually improvised each time.

## GitHub Project Model

GitHub Projects should be used as a delivery view over mirrored issues and PRs, not as the original backlog store.

### Recommended columns / states

- `Proposed for Delivery`
- `Ready`
- `In Progress`
- `In Review`
- `Merged`
- `Released`
- `Blocked`

### Recommended custom fields

- `Backlog Item ID`
- `Epic ID`
- `Digital Product`
- `Portfolio`
- `Priority`
- `Execution Path`
- `Spec`
- `Plan`
- `PR`
- `Release`

This makes the project board an execution dashboard over platform-traced work.

## Pull Request Integration

Every mirrored issue should have a clear PR linkage policy.

### PR requirements

- branch name references the backlog item or GitHub issue
- PR body includes:
  - backlog item id
  - spec path
  - plan path
  - acceptance criteria
  - testing evidence

### Sync back to platform

When a PR is opened, updated, merged, or closed:

- update the linked platform backlog item
- store PR number and URL
- update execution status
- attach testing/release evidence if available

## Sync Direction and Conflict Rules

Two-way sync should exist, but not for every field.

### Platform to GitHub

Authoritative push:

- issue creation
- title updates
- execution description updates
- labels from portfolio/product/type
- target workflow state when backlog item moves into delivery

### GitHub to platform

Authoritative pull:

- issue opened/closed state
- assignee changes
- PR links
- review / merge status
- milestone or release information

### Conflict rule

If a field has one clear system owner, the other side should not silently overwrite it.

Example:

- business priority from platform should not be overwritten by GitHub edits
- PR status from GitHub should not be guessed by the platform

## Data Model Extensions

The platform needs explicit linkage objects for GitHub delivery.

### Recommended new model: `GitHubDeliveryLink`

Fields:

- `id`
- `backlogItemId`
- `epicId`
- `repository`
- `issueNumber`
- `issueUrl`
- `projectId`
- `projectItemId`
- `latestPrNumber`
- `latestPrUrl`
- `deliveryStatus`
- `lastSyncedAt`
- `syncState`
- `syncError`
- `createdAt`
- `updatedAt`

Purpose:

- durable join between platform backlog and GitHub execution artifacts
- sync observability and retry support

### Recommended additions to `BacklogItem`

- `executionPath`
- `deliverySystem`
- `deliveryStatus`
- `githubRepository`
- `githubIssueNumber`
- `githubPrNumber`
- `specPath`
- `planPath`

This keeps backlog records directly navigable even without opening the join table.

## Lifecycle

### 1. Backlog creation

Backlog item is created in the platform DB.

### 2. Delivery approval

When an item becomes implementation-ready and is marked `executionPath = github_delivery`, the platform creates or updates a GitHub issue.

### 3. Delivery tracking

The mirrored issue enters the GitHub Project and moves through repository workflow states.

### 4. PR linkage

Opening a PR updates both the issue and the platform backlog item.

### 5. Merge / release

When merged or released, the platform syncs the execution outcome back into the backlog item and related epic/product reporting.

## Build Studio Interaction

Build Studio execution should integrate with the same model rather than bypass it.

### For local-only builds

- keep the record in the platform DB
- do not create a GitHub issue unless approved for repository contribution

### For upstream contribution candidates

- create a backlog item first
- generate spec/plan if needed
- then mirror into GitHub delivery once approved

This keeps Build Studio from becoming a shadow work system.

## Docs and Evidence

The following should remain in git and be linked from both systems:

- specs in `docs/superpowers/specs/`
- plans in `docs/superpowers/plans/`
- test evidence / QA references
- migration notes
- release notes

GitHub issue and PR templates should include placeholders for these links.

## UX

### Platform backlog UI should show

- whether an item is mirrored to GitHub
- linked issue and PR
- current delivery status
- repo/project location
- spec and plan links

### GitHub issue body should show

- that the issue is owned by a DPF backlog item
- the platform identifiers and business context
- clear acceptance criteria

## Automation Strategy

The sync should be event-driven first, scheduled second.

### Event-driven triggers

- backlog item moves to `github_delivery`
- backlog item title/description changes
- PR opened/merged/closed
- issue closed/reopened

### Scheduled reconciliation

Run a periodic sync to repair drift:

- missing issue link
- project status mismatch
- stale PR status
- items closed in one system but not the other

## Risks

- duplicated work if issues are created too early
- field drift if ownership is not explicit
- over-mirroring low-value backlog items into GitHub
- using GitHub Projects as strategy truth instead of execution view
- losing Digital Product / portfolio context if issue templates are too thin

## Success Criteria

This design is successful when:

- platform backlog remains the source of truth
- engineers can work naturally with branches, issues, projects, and PRs
- each code-delivery item is traceable back to backlog, epic, product, and portfolio
- Build Studio and manual engineering flow use the same delivery tracking model
- project boards become accurate execution views without replacing strategic backlog governance

## Recommended Direction

Adopt a **DB-as-truth, GitHub-as-delivery-mirror** model:

- keep backlog and governance in the platform
- mirror only implementation-ready items to GitHub issues
- use GitHub Projects for execution visibility
- sync PR and merge status back into the platform
- keep specs, plans, and release evidence linked throughout the chain
