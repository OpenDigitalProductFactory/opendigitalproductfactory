# Build Studio PR Merge Process — Implementation Prompt

> Copy this into a new Claude Code session to implement the PR merge governance layer.

---

## Context

Build Studio can now complete a full feature lifecycle: ideate → plan → build → review → ship. The ship phase extracts a diff from the sandbox (87KB, 16 files for the first successful build) and registers a digital product. But the final step — creating a PR, running security gates, and merging into the portal codebase — is not wired together yet.

**What already exists (DO NOT rebuild — extend these):**

1. **`apps/web/lib/integrate/github-api-commit.ts`** — Full GitHub REST API for creating branches, blobs, trees, commits, and PRs. Functions: `createBranchAndPR()`, `createCrossForkPR()`. Missing: `mergePR()`, PR status tracking.

2. **`apps/web/lib/integrate/security-scan.ts`** — Homegrown regex-based security scanner (8 categories: SQL injection, XSS, command injection, hardcoded secrets, API token prefixes, destructive schema, eval/Function, new dependencies). Runs on diff added-lines only. Missing: trufflehog/gitleaks integration.

3. **`apps/web/lib/integrate/sandbox/sandbox-promotion.ts`** — 9-step promotion pipeline: validate → check window → extract diff → scan → backup DB → update RFC → apply patch → health check → mark deployed. Auto-rollback on failure.

4. **`scripts/promote.sh` + `Dockerfile.promoter`** — Autonomous Docker promoter (348-line shell script). Builds a new portal image from sandbox changes, swaps containers, health checks, auto-rollback.

5. **`apps/web/lib/mcp-tools.ts`** — `deploy_feature` (extracts diff), `execute_promotion` (starts promoter container), `create_release_bundle`, `contribute_to_hive` (creates upstream PR with DCO + contribution review).

6. **`apps/web/lib/integrate/contribution-pipeline.ts`** — Sanitization scan (org references, hardcoded pricing, customer data), parameterization verification, vertical applicability tagging, posts structured PR comment.

7. **Database models:** `ChangePromotion` (status lifecycle: pending→approved→deployed/rolled_back), `PromotionBackup`, `ChangeRequest` (RFC model).

8. **`e2e/10-promotion-pipeline.spec.ts`** — Full e2e test for ship → approve → deploy → verify.

---

## What needs to be built

### 1. CRITICAL: Branch Name Privacy

**Current problem:** Branches are named `install/DESKTOP-A290QNG` which leaks the customer's machine name to the public GitHub repo. This is a security violation for a product that supports anonymous contribution.

**Requirements:**
- Branch names must use the DPF instance ID or a hash: `dpf/a4f8b2c1/complaint-tracker` not `install/DESKTOP-A290QNG`
- PR titles reference the feature only: `feat(complaint-tracker): internal staff complaint tracking`
- `Signed-off-by` uses the platform identity (`agent-a450c4bc@hive.dpf`) not the user's real name
- Never include hostnames, machine names, IP addresses, or usernames in ANY git metadata that flows to a public repo
- Audit all existing code in `git-utils.ts`, `github-api-commit.ts`, `contribute_to_hive`, `promote.sh` for identity leaks

### 2. PR Creation from Build Studio Ship Phase

**Current state:** `deploy_feature` extracts the diff. `contribute_to_hive` creates a PR upstream. But there's no tool that creates a PR for the LOCAL portal's own codebase.

**Requirements:**
- New tool or extension of `deploy_feature`: after extracting the diff, create a PR on the portal's own GitHub repo
- PR body should include: design doc summary, build plan summary, task results, verification status, acceptance criteria status, security scan results
- Branch name follows privacy rules above
- The PR should be auto-labeled (e.g., `build-studio`, `automated`, risk level)

### 3. Pre-PR Security Gates

**Before the PR is created, run these checks on the diff:**

1. **Secret/credential detection** — extend `security-scan.ts` with stronger patterns or integrate trufflehog/gitleaks. BLOCK PR creation if secrets found.

2. **Backdoor detection** — scan for: obfuscated code, eval() with dynamic input, unexpected network calls to non-platform URLs, crypto mining patterns, data exfiltration.

3. **Architecture compliance** — verify: files are in correct directories per DPF conventions, imports use `@/lib` paths, Prisma is used for DB access (not raw SQL in app code), no direct API calls bypassing the routing pipeline.

4. **Dependency audit** — if `package.json` changed: check for known CVEs, verify packages are from npm, check license compatibility.

5. **Migration safety** — `scanForDestructiveOps()` already exists in `sandbox-promotion.ts`. Integrate it into the pre-PR gate. If destructive ops found, require explicit acknowledgment.

### 4. PR Merge Workflow

**After PR is created:**

1. CI runs the security gates above (redundant with pre-PR but catches manual edits)
2. If all gates pass and the build was fully verified → auto-merge (squash)
3. If any gate fails → request human review, post the failure details as a PR comment
4. After merge → update `FeatureBuild.phase` to `complete`, update `ChangePromotion.status` to `deployed`
5. Trigger the promoter to rebuild the portal from the merged code

### 5. Review Panel UX Improvements (while you're in this area)

From Mark's feedback on the first successful build:

1. **Design doc formatting** — The proposedApproach, dataModel, existingCodeAudit, reusePlan sections are walls of text. Post-process with a cheap LLM (local Gemma via Docker Model Runner) into formatted summaries with bullet points and headers.

2. **Verification explanation** — "Failed" badge with no context. Parse `verificationOut.typeCheckOutput` and `verificationOut.testOutput` into human-readable summaries: "3 TypeScript errors in complaints.ts", "Tests: 2 passed, 1 failed".

3. **Code changes as file list** — Replace the raw diff dump with a file list showing purpose: `complaints/page.tsx — Server component (new)`, `complaints/store.ts — In-memory store (new)`. Add "View full diff" toggle for developers.

4. **Manual test steps** — Generate step-by-step walkthrough from acceptance criteria: "1. Navigate to /complaints, 2. Click New Complaint, 3. Fill form, 4. Verify complaint appears with status 'open'". Display in a collapsible "Test It Yourself" panel alongside the sandbox preview.

---

## Key files to read first

- `apps/web/lib/integrate/github-api-commit.ts` — PR creation API (extend this)
- `apps/web/lib/integrate/security-scan.ts` — Security scanner (extend this)
- `apps/web/lib/integrate/sandbox/sandbox-promotion.ts` — Promotion pipeline (reference)
- `apps/web/lib/mcp-tools.ts` — `deploy_feature` handler around line 3487, `contribute_to_hive` around line 4243
- `apps/web/lib/integrate/contribution-pipeline.ts` — PR body generation + contribution review
- `apps/web/lib/integrate/git-utils.ts` — Branch/commit operations
- `apps/web/components/build/ReviewPanel.tsx` — Review phase UI
- `packages/db/prisma/schema.prisma` — `ChangePromotion` model around line 585

## Current build state

Build `FB-0B55F5CF` is at ship phase with:
- 87KB diff (16 files) extracted and saved to `diffPatch`
- Digital product registered: `DP-AC648093 v1.0.0`
- Promotion created and approved: `CP-D497A0A9`
- Epic: `EP-BUILD-808ADE`
- The promoter container failed to start (Docker config issue) — this is the immediate blocker

## Architecture constraints

- All code changes MUST go through the seed/migration process (CLAUDE.md: "DB fix = seed + migration")
- Never create manual PRs — Build Studio handles that (CLAUDE.md + Mark's explicit feedback)
- The `anthropic-sub` provider uses CLI adapter with NO MCP tool access — coworker tool calls go through `codex/gpt-5.4` via responses adapter
- `docker-entrypoint.sh` has a post-init SQL block that ensures codex is active and build-specialist is pinned — don't remove this
