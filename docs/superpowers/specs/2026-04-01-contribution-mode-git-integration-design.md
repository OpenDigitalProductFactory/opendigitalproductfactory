# Contribution Mode & Git Integration Design

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-HANDOFF-002 (Phase 2e extension) |
| **IT4IT Alignment** | §5.4 Deploy — contribution pipeline governs how built artifacts flow from sandbox to production and optionally to upstream |
| **Depends On** | EP-BUILD-HANDOFF-002 Phase 2e (PR contribution pipeline — implemented), PlatformDevConfig Step 7 (implemented), `assess_contribution` + `contribute_to_hive` tools (implemented) |
| **Status** | Implemented |
| **Created** | 2026-04-01 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

> **Amendment 2026-04-18:** The default contribution identity changed from "anonymous" (every install pushes as the same `dpf-agent`) to "pseudonymous" (every install pushes as `dpf-agent-<shortId>`, where `<shortId>` is the first 8 chars of the hash already in `gitAgentEmail`). The mode names `fork_only` / `selective` / `contribute_all` and their semantics in this spec are unchanged — only the public author identity carried by `selective` / `contribute_all` was corrected so the community can recognize repeat contributors. See [docs/superpowers/specs/2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md) for the rationale and the same-spec backlog-to-issue bridge for non-Build-Studio users.

## Problem Statement

The platform has three contribution modes (`fork_only`, `selective`, `contribute_all`) configured during onboarding Step 7, and a mode-aware ship phase prompt that directs the AI Coworker to call `assess_contribution` and `contribute_to_hive` tools. However, several gaps remain:

1. **`deploy_feature` ignores contribution mode** — it unconditionally runs the PR pipeline (`submitBuildAsPR`) regardless of mode
2. **`contribute_to_hive` creates local FeaturePacks, not upstream PRs** — there is no code path that pushes contributions to a git remote
3. **`fork_only` users have no data loss warning** — non-technical users don't understand that Docker container rebuilds will lose their customizations
4. **DCO acceptance is inline only** — `contribute_to_hive` generates a `Signed-off-by` from the user's email, but there is no formal one-time acceptance stored on the platform
5. **`gitRemoteUrl` is unused** — the field exists on `PlatformDevConfig` but nothing reads or writes to it
6. **Git credential storage is undefined** — pushing to remotes requires authentication, but there is no mechanism to store tokens
7. **`isDevInstance()` guard blocks consumer git operations** — git write operations in `git-utils.ts` are gated behind `isDevInstance()`, preventing consumer-mode backup pushes

## Design

### Concept: Two Orthogonal Axes

The **install mode** (PowerShell installer) and **contribution mode** (portal setup wizard) are separate concerns:

- **Install mode** determines the development environment: whether the user works through VS Code with local source code, or exclusively through the Build Studio UI which uses the sandbox as its development environment.
- **Contribution mode** determines how AI-built features flow after promotion: stay local, selectively contributed, or contributed by default.

This spec covers contribution mode only. Install mode is unchanged.

### Existing Infrastructure (What's Already Built)

The following is already implemented and this spec builds on it:

| Component | Location | What it does |
|-----------|----------|-------------|
| `PlatformDevConfig` | Schema singleton | Stores `contributionMode`, `gitRemoteUrl` (unused), `configuredAt`, `configuredById` |
| Step 7 UI | `PlatformDevelopmentForm.tsx` | Radio buttons for `fork_only` / `selective` / `contribute_all` |
| Ship phase prompt | `build-agent-prompts.ts:275-294` | Mode-specific STEP 5 directing AI to call `assess_contribution` + `contribute_to_hive` |
| `assess_contribution` tool | `mcp-tools.ts:3127-3234` | 4-criteria scoring: vision alignment, community value, augmentation level, proprietary sensitivity |
| `contribute_to_hive` tool | `mcp-tools.ts:3237-3305` | Creates `FeaturePack` with manifest, DCO attestation, and diff metadata |
| `submitBuildAsPR()` | `contribution-pipeline.ts` | Creates git branches, runs security scan, opens GitHub PRs (or local fallback) |
| `scanDiffForSecurityIssues()` | `security-scan.ts` | Static analysis for injection, secrets, destructive ops |

### What This Spec Adds

```
Existing flow:
  deploy_feature → submitBuildAsPR (always) → assess_contribution → contribute_to_hive (FeaturePack)

New flow:
  deploy_feature → (mode-aware: skip PR for fork_only) →
    assess_contribution (existing) →
    contribute_to_hive (extended: FeaturePack + upstream PR when contributing) →
    fork_only backup (new: commit + push to gitRemoteUrl)
```

### Contribution Mode Behaviors

#### `fork_only` — The Closed System

Features stay on this install. No code is pushed to any remote by default.

| Aspect | Behavior |
|--------|----------|
| Ship phase | `deploy_feature` extracts diff and runs impact analysis. `submitBuildAsPR` is **skipped** (no PR pipeline). |
| Contribution tools | `assess_contribution` and `contribute_to_hive` are **not called** (existing prompt logic). |
| Optional git backup | User can paste a repo URL + access token in Admin > Platform Development. When configured, each promotion commits the diff and pushes to that repo. |
| Untracked code warning | Escalating warnings when no git repo is configured (see below). |
| DCO | Not required. |

##### Escalating Untracked Code Warnings

When `fork_only` is selected and `gitRemoteUrl` is null, the AI Coworker warns about data loss risk at ship time. The warning text is injected into the ship phase system prompt context and scales with the number of shipped features that have no git commit hash.

| Shipped features (no backup) | Warning level | AI Coworker message |
|---|---|---|
| 1 | Gentle mention | "Your feature has been deployed. Note: since no git repository is configured, this customization exists only in your production container. You can set up a repository in Admin > Platform Development to protect your work." |
| 2-4 | Clear warning | "You now have {N} custom features deployed without version control. If your Docker containers are rebuilt, these changes could be lost. I'd recommend setting up a git repository -- see Admin > Platform Development." |
| 5+ | Strong recommendation | "You have {N} custom features with no backup. This represents significant business value that could be lost in a container rebuild, Docker update, or system recovery. Setting up a git repository takes about 10 minutes and protects all your customizations. Would you like me to walk you through it?" |

The count is derived from `FeatureBuild` records with `phase = "complete"` that have an empty `gitCommitHashes` array.

##### Optional Git Repository Setup

The user configures their own git repository externally (GitHub, GitLab, self-hosted, etc.) and pastes the remote URL and access token into Admin > Platform Development settings.

- The platform does **not** create repositories on behalf of the user
- Documentation is provided to help non-technical users through the setup
- When configured, each promotion commits the diff and pushes to the configured remote
- Branch strategy: `main` branch tracks production state
- Commit messages include build ID, product ID, and promotion metadata
- No PR created -- direct push (this is the user's private repo)

#### `selective` — The Advisory Path

The AI Coworker advises on each feature via the existing `assess_contribution` tool and the user decides whether to contribute.

| Aspect | Behavior |
|--------|----------|
| Ship phase | `deploy_feature` runs impact analysis. `submitBuildAsPR` is **skipped** at this stage. |
| AI advisory | `assess_contribution` runs its 4-criteria scoring. AI presents the recommendation. Default: keep local. |
| "Keep local" | `contribute_to_hive` is **not called**. Feature promoted to production. Committed to backup repo if configured. |
| "Contribute" | `contribute_to_hive` creates FeaturePack **and** creates an upstream PR via `submitBuildAsPR` targeting `upstreamRemoteUrl`. |
| DCO | Required. One-time acceptance at mode selection, stored on PlatformDevConfig. `Signed-off-by` on contribution commits. |

#### `contribute_all` — The Open Path

Same as `selective`, but the default answer is "contribute."

| Aspect | Behavior |
|--------|----------|
| Ship phase | Same as selective |
| AI advisory | `assess_contribution` runs. AI frames it as "I'll contribute this unless you'd prefer to keep it local." |
| Override | User can say "keep local" on any individual feature |
| DCO | Required. Same as selective. |

### Extending `contribute_to_hive` for Upstream PRs

The existing `contribute_to_hive` tool creates a local `FeaturePack` record. This spec extends it to **also** create an upstream PR when the user chooses to contribute:

```
contribute_to_hive (extended flow):
  1. Create FeaturePack record (existing)
  2. If upstreamRemoteUrl is configured and DCO accepted:
     a. Call submitBuildAsPR() targeting upstreamRemoteUrl
     b. Store PR URL on the FeaturePack record
     c. Include FeaturePack ID in the PR body for traceability
  3. If no upstream configured:
     a. FeaturePack created locally (existing behavior)
     b. Log that no upstream is configured
```

The `submitBuildAsPR` function needs a new parameter to specify the target remote URL, rather than always using `origin`.

### DCO (Developer Certificate of Origin)

#### One-Time Acceptance

When the user selects `selective` or `contribute_all` during setup (or changes to either mode later), the platform presents a DCO acceptance dialog:

```
By enabling community contributions, you confirm that:

1. You have the right to submit the code generated on this platform
2. You assert that AI-generated code created on your platform instance
   is your contribution under your direction
3. You agree to license contributions under Apache-2.0
4. AI-generated code from your Build Studio sessions may be shared publicly
5. You can opt out of contributing any individual feature at ship time

This applies to all future contributions from this platform instance.
```

The acceptance is stored on `PlatformDevConfig`:
- `dcoAcceptedAt: DateTime?`
- `dcoAcceptedById: String?` (FK to User)

If the user switches from `fork_only` to `selective` or `contribute_all` after initial setup, the DCO dialog appears at that time.

#### Per-Commit Attribution

Contribution commits and FeaturePack records include:

```
feat(web-app): Customer Complaint Tracker

Build: FB-A1B2C3D4
Product: DP-E5F6G7H8
Author: AI Coworker (build-specialist)
Platform: DPF v1.2.0

Signed-off-by: Jane Smith <jane@example.com>
DCO-Accepted: 2026-04-01T10:30:00Z
```

The `Signed-off-by` uses the employee profile's display name and work email of the user who accepted the DCO. The existing `contribute_to_hive` already generates a `Signed-off-by` from `build.createdBy.email` -- this spec formalizes it with the stored DCO acceptance timestamp.

#### Mode Downgrade

Switching from `contribute_all` or `selective` back to `fork_only` stops future contributions but does not affect previously created PRs or FeaturePacks. The DCO acceptance record is retained (it covers already-contributed code) but no new contributions are made.

### Git Credential Storage

Pushing to remotes requires authentication. Two credential paths:

#### For backup repos (`gitRemoteUrl`)

A new `CredentialEntry` record (existing model, used for AI provider credentials) with:
- `providerId`: `"git-backup"` (synthetic provider ID)
- `secretRef`: the access token, encrypted at rest via the existing `CREDENTIAL_ENCRYPTION_KEY`
- `status`: `"active"`

The token is entered alongside the repo URL in Admin > Platform Development. It is stored using the same encrypted credential infrastructure that protects AI provider API keys.

#### For upstream contributions (`upstreamRemoteUrl`)

Fork-based workflow: the user's `gitRemoteUrl` is their fork of the DPF repo. The PR targets `upstreamRemoteUrl` as the base repository. The same credential (`git-backup` CredentialEntry) is used to push to the fork and create the PR.

Users who want to contribute without a backup repo can configure just a `GITHUB_TOKEN` environment variable (existing mechanism used by `submitBuildAsPR`).

### `isDevInstance()` Guard Relaxation

The existing git write operations in `git-utils.ts` are gated behind `isDevInstance()`. Consumer-mode installs need to commit and push for the backup feature.

A new function `isGitBackupAllowed()` is added that returns `true` when:
- `PlatformDevConfig.gitRemoteUrl` is configured, AND
- A valid credential exists for `git-backup`

Git write operations used by the backup flow check `isDevInstance() || isGitBackupAllowed()` instead of `isDevInstance()` alone. This preserves the safety guard for all other git operations while enabling the backup path.

### `deploy_feature` Mode Awareness

The `deploy_feature` handler in `mcp-tools.ts` is updated to read `PlatformDevConfig.contributionMode` and conditionally skip the `submitBuildAsPR` call:

```
case "deploy_feature":
  // ... existing diff extraction, impact analysis, security scan ...

  // Read contribution mode
  const devConfig = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" } });
  const mode = devConfig?.contributionMode ?? "fork_only";

  // Skip PR pipeline for fork_only and selective (PR happens later via contribute_to_hive)
  // For contribute_all, also skip here — the PR is created by contribute_to_hive after assessment
  if (mode === "fork_only") {
    // Inject escalating warning if no gitRemoteUrl
    // ... warning logic ...
  }

  // Do NOT call submitBuildAsPR here — contribution decisions happen in STEP 5
  // of the ship phase prompt via assess_contribution + contribute_to_hive
```

The `submitBuildAsPR` call is removed from `deploy_feature` and moved into `contribute_to_hive` (called only when the user explicitly chooses to contribute).

### Schema Changes

#### PlatformDevConfig Extensions

```sql
ALTER TABLE "PlatformDevConfig"
  ADD COLUMN "dcoAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "dcoAcceptedById" TEXT REFERENCES "User"("id"),
  ADD COLUMN "upstreamRemoteUrl" TEXT;
```

- `dcoAcceptedAt` -- when the DCO was accepted (null = not accepted)
- `dcoAcceptedById` -- who accepted the DCO
- `upstreamRemoteUrl` -- the target for contribution PRs. Application-level default: `https://github.com/markdbodman/opendigitalproductfactory.git` (not hardcoded in schema to allow updates via code deployments)

The existing `gitRemoteUrl` field is used for the user's own backup/tracking repo. `upstreamRemoteUrl` is the canonical DPF project for contributions.

### Admin UI Changes

#### Platform Development Settings Page

The existing `PlatformDevelopmentForm.tsx` is extended with:

1. **Git Repository URL field** -- text input for `gitRemoteUrl`, with helper text: "Optional. Paste the URL of your git repository to back up customizations. See documentation for setup instructions."

2. **Git Access Token field** -- password input, stored as encrypted `CredentialEntry`. Shown only when `gitRemoteUrl` is non-empty.

3. **DCO acceptance status** -- shown when mode is `selective` or `contribute_all`:
   - If accepted: "DCO accepted by {name} on {date}"
   - If not accepted: DCO acceptance dialog with confirm button

4. **Untracked feature count** -- shown when mode is `fork_only` and no repo configured: "{N} features deployed without version control"

### Documentation

A help section is provided for `fork_only` users who want to set up a git repository. Content covers:

1. Why version control matters for platform customizations
2. Creating a GitHub/GitLab repository (step-by-step)
3. Generating a personal access token with repo scope
4. Pasting the repository URL and token into platform settings
5. Verifying the connection works

This documentation is linked from the escalating warning messages and the Platform Development settings page.

## Implementation Plan

### Step 1: Schema Migration (Low Risk)

| Task | Files |
|------|-------|
| Add `dcoAcceptedAt`, `dcoAcceptedById`, `upstreamRemoteUrl` to PlatformDevConfig | `packages/db/prisma/schema.prisma` |
| Create migration | `packages/db/prisma/migrations/` |

### Step 2: Mode-Aware deploy_feature (Medium Risk)

| Task | Files |
|------|-------|
| Read `PlatformDevConfig` in `deploy_feature`, skip `submitBuildAsPR` | `apps/web/lib/mcp-tools.ts` |
| Add untracked feature count query | `apps/web/lib/actions/platform-dev-config.ts` |
| Inject escalating warning into ship phase system prompt for `fork_only` | `apps/web/lib/actions/agent-coworker.ts` |

### Step 3: DCO Flow (Low Risk)

| Task | Files |
|------|-------|
| Add DCO acceptance action | `apps/web/lib/actions/platform-dev-config.ts` |
| Add DCO dialog component | `apps/web/components/admin/DcoAcceptanceDialog.tsx` (new) |
| Trigger DCO dialog on mode change to `selective`/`contribute_all` | `apps/web/components/admin/PlatformDevelopmentForm.tsx` |
| Verify DCO acceptance in `contribute_to_hive` before upstream PR | `apps/web/lib/mcp-tools.ts` |

### Step 4: Extend contribute_to_hive for Upstream PRs (Medium Risk)

| Task | Files |
|------|-------|
| Add `targetRemoteUrl` parameter to `submitBuildAsPR` | `apps/web/lib/contribution-pipeline.ts` |
| Call `submitBuildAsPR` from `contribute_to_hive` when user contributes | `apps/web/lib/mcp-tools.ts` |
| Store PR URL on FeaturePack record | `apps/web/lib/mcp-tools.ts` |
| Include DCO `Signed-off-by` with stored acceptance timestamp | `apps/web/lib/contribution-pipeline.ts` |

### Step 5: Git Backup for fork_only (Medium Risk)

| Task | Files |
|------|-------|
| Add `isGitBackupAllowed()` check | `apps/web/lib/git-utils.ts` |
| Relax `isDevInstance()` guard for backup operations | `apps/web/lib/git-utils.ts` |
| Add git credential storage via CredentialEntry | `apps/web/lib/actions/platform-dev-config.ts` |
| Commit + push to `gitRemoteUrl` on promotion | `apps/web/lib/contribution-pipeline.ts` |

### Step 6: Admin UI Extensions (Low Risk)

| Task | Files |
|------|-------|
| Add git repo URL + token fields to PlatformDevelopmentForm | `apps/web/components/admin/PlatformDevelopmentForm.tsx` |
| Add DCO status display and acceptance trigger | Same file |
| Add untracked feature count display | Same file |
| Wire save action for new fields | `apps/web/lib/actions/platform-dev-config.ts` |

### Step 7: Documentation (Low Risk)

| Task | Files |
|------|-------|
| Git repository setup guide for non-technical users | Help system or in-app documentation |

## Success Criteria

1. `deploy_feature` respects `contributionMode` and does not call `submitBuildAsPR` unconditionally
2. `fork_only` users receive escalating warnings proportional to untracked feature count
3. `fork_only` users can paste a repo URL + token and subsequent promotions are committed + pushed
4. `selective` users see `assess_contribution` results with keep-local as default
5. `contribute_all` users see `assess_contribution` results with contribute as default
6. `contribute_to_hive` creates FeaturePack AND upstream PR when user chooses to contribute
7. DCO accepted once at mode selection, stored on PlatformDevConfig, enforced before upstream PRs
8. `Signed-off-by` trailer on all contribution commits with stored DCO timestamp
9. Git credentials stored encrypted via existing CredentialEntry infrastructure
10. Consumer-mode installs can use git backup without `isDevInstance()` blocking

## Design Decisions

1. **Install mode and contribution mode are orthogonal.** Install mode determines dev tooling (VS Code vs Build Studio). Contribution mode determines code flow after promotion. They do not depend on each other.
2. **Builds on existing tool flow.** The `assess_contribution` and `contribute_to_hive` tools, plus the mode-aware ship phase prompt, are already implemented. This spec extends `contribute_to_hive` to also create upstream PRs rather than introducing a parallel mechanism.
3. **`deploy_feature` no longer calls `submitBuildAsPR`.** The PR pipeline is moved to `contribute_to_hive` where it belongs -- after the user has made their contribution decision.
4. **DCO is one-time acceptance, per-feature confirmation.** The one-time acceptance sets the legal precedent. The per-feature question is the natural advisory conversation at ship time via `assess_contribution`.
5. **`fork_only` repo setup is manual.** The platform does not create repositories. The user sets up their own repo externally and pastes the URL + token. Documentation is provided.
6. **`selective` defaults to keep local, `contribute_all` defaults to contribute.** The difference between the two modes is the default answer to the contribution question.
7. **Escalating warnings are proportional to value at risk.** One feature gets a gentle mention. Five features get a strong recommendation. The warning intensity tracks the business value of untracked code.
8. **`gitRemoteUrl` is the user's backup repo, `upstreamRemoteUrl` is the contribution target.** These are separate remotes serving different purposes: one is private backup, the other is community contribution. Fork-based workflow: the user pushes to their fork (`gitRemoteUrl`), and the PR targets the upstream (`upstreamRemoteUrl`).
9. **Upstream URL is an application-level default, not a schema default.** This allows the upstream URL to be updated via code deployments without requiring a database migration.
10. **Git credentials use existing CredentialEntry infrastructure.** The same encrypted storage that protects AI provider API keys is reused for git access tokens.
11. **Mode downgrade is safe.** Switching back to `fork_only` stops future contributions but does not affect existing PRs or FeaturePacks.

## Addendum: 2026-04-03 — Critical Fixes for End-to-End Contribution Flow

Testing the full contribution lifecycle revealed four blocking issues that prevented PRs from being created. All four have been fixed.

### Issue 1: `extractDiff` missed new files

**Root cause:** `extractDiff` ran `git diff --name-only` which only sees *modified tracked* files. New files created by `write_sandbox_file` in the sandbox are untracked and invisible to `git diff`.

**Fix:** `extractDiff` now runs `git add -A` (with exclusions for node_modules, .next, etc.) before diffing, then uses `git diff --cached` to capture both new and modified files.

**File:** `apps/web/lib/integrate/sandbox/sandbox.ts`

### Issue 2: No `.git` inside the portal container

**Root cause:** `.dockerignore` excludes `.git`, so the portal container has no git repository. The contribution pipeline's local git operations (`createBranch`, `commitAll`, `pushBranch`) all fail silently, falling back to local mode (no PR).

**Fix:** New module `github-api-commit.ts` creates branches, blobs, trees, commits, and PRs entirely via the GitHub REST API (Git Data API). No local `.git` directory needed. `submitBuildAsPR` now prefers this path when `GITHUB_TOKEN` is available.

**Files:**

- `apps/web/lib/integrate/github-api-commit.ts` (new)
- `apps/web/lib/integrate/contribution-pipeline.ts` (refactored)

### Issue 3: Ship phase ordering — contribution after deployment

**Root cause:** The ship phase prompt had contribution as STEP 5 and deployment as STEP 4. `execute_promotion` restarts the portal container (image rebuild + container swap), which kills the AI Coworker conversation *before* the contribution step can run.

**Fix:** Reordered: contribution is now STEP 4 (while sandbox is still alive), deployment is STEP 5 (portal restart is the last action).

**File:** `apps/web/lib/integrate/build-agent-prompts.ts`

### Issue 4: Stored token not read by contribution pipeline

**Root cause:** `contribute_to_hive` only checked `process.env.GITHUB_TOKEN`. Portal users configure their token through the admin UI, which stores it in `CredentialEntry` — the env var is never set.

**Fix:** `contribute_to_hive` now falls back to `getStoredGitHubToken()` which reads and decrypts the stored credential. `GITHUB_TOKEN` env var is also passed through in `docker-compose.yml` for admin-level override.

**Files:**

- `apps/web/lib/actions/platform-dev-config.ts` (new: `getStoredGitHubToken`, `validateGitHubToken`, `saveContributionSetup`)
- `apps/web/lib/mcp-tools.ts` (updated `contribute_to_hive` handler)
- `docker-compose.yml` (added `GITHUB_TOKEN` pass-through)

### Issue 5: Admin UI assumed developer knowledge

**Root cause:** The Platform Development settings page showed raw input fields for git URLs, access tokens, and DCO legal text. Non-technical users selecting "Share selectively" would not know what to do.

**Fix:** Replaced raw form fields with a guided 4-step wizard:

1. **How sharing works** — plain-language explanation
2. **GitHub account** — instructions for creating an account if needed
3. **Create and paste token** — step-by-step instructions for generating a personal access token with `repo` scope, with token validation via GitHub API before proceeding
4. **Contributor agreement** — simplified DCO in 3 plain-language points

Token validation calls `GET /user` on the GitHub API to confirm the token works before saving.

**Files:**

- `apps/web/components/admin/PlatformDevelopmentForm.tsx` (rewritten)
- `apps/web/app/(shell)/admin/platform-development/page.tsx` (updated props)
