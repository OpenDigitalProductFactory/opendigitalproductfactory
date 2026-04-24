# Public Contribution Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce a fork-based PR contribution model on `PlatformDevConfig` so installs without upstream write access can still contribute, keep the existing direct-push path as an explicit maintainer opt-in, ship behind a feature flag, and wire up the migration banner for existing installs.

**Architecture:** A new `contributionModel` field on `PlatformDevConfig` dispatches `contribute_to_hive` to either `maintainer-direct` (push branch directly to upstream; current behavior) or `fork-pr` (push branch to a contributor-owned fork; open cross-repo PR). Fork creation and verification are handled in the admin setup flow. `github-api-commit.ts#createBranchAndPR` is refactored to accept head/base owner+repo separately so the same function handles both models. A single feature flag `CONTRIBUTION_MODEL_ENABLED` gates every new code path for a safe rollout.

**Tech Stack:** Next.js 16 pnpm monorepo (`apps/web` + `packages/db`). Prisma 7.x. Vitest for unit tests. Postgres 16. All inference calls use OpenAI-compatible endpoints; this plan does not touch inference. All workflow rules in `AGENTS.md` apply: PR-based workflow, one concern per PR, short-lived topic branches, `pnpm --filter <pkg> exec <tool>` (never `npx`), CI gates are `Typecheck` + `Production Build`, worktrees for concurrent sessions.

**Spec:** [docs/superpowers/specs/2026-04-23-public-contribution-mode-design.md](../specs/2026-04-23-public-contribution-mode-design.md) — approved by spec-document-reviewer 2026-04-23.

---

## Ground rules for every phase

- **One PR per phase.** Branch naming: `feat/ccm-phase-<n>-<slug>` (ccm = contribution-mode) from `main`. Squash-and-delete on merge via `gh pr merge <n> --squash --delete-branch`.
- **TDD.** Red test → green implementation → commit. Every unit of behavior gets a test first.
- **Feature-flag gate.** `CONTRIBUTION_MODEL_ENABLED` defaults `false`. Every new behavior branches on the flag. When the flag is off, the runtime is byte-identical to pre-plan main. Phases 1–7 can all land + merge with the flag off, without touching production behavior.
- **Invariant — `contributionModel=null` means "unconfigured".** Never write a default value anywhere except explicit admin-UI setup. A guard test in Phase 1 fails if any code path (server action, seed, migration backfill) writes a non-null default.
- **Verification gate per PR.** Before opening a PR: `pnpm typecheck` and `pnpm --filter web build` must succeed. `pnpm --filter web test -- <changed-files>` must pass for touched test files.
- **Worktree.** This plan is authored in `d:\DPF-plan` on branch `doc/public-contribution-mode-plan`. Implementers should spin up their own worktree per phase: `git worktree add d:\DPF-ccm-<n> feat/ccm-phase-<n>-<slug>` from `d:\DPF`.

---

## Phase 1 — Schema, migration, feature flag

**Branch:** `feat/ccm-phase-1-schema`

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add fields to `PlatformDevConfig`)
- Create: `packages/db/prisma/migrations/<timestamp>_add_contribution_model/migration.sql`
- Create: `apps/web/lib/flags/contribution-model.ts`
- Create: `apps/web/lib/flags/contribution-model.test.ts`
- Create: `packages/db/src/platform-dev-config-invariants.test.ts`

**Context:** Current `PlatformDevConfig` at [packages/db/prisma/schema.prisma:2738](../../../packages/db/prisma/schema.prisma#L2738) has no contributionModel / fork-owner / fork-repo / fork-verified fields. Migrations live at `packages/db/prisma/migrations/` with timestamped directories.

### Task 1.1: Add schema fields

- [ ] **Step 1: Edit schema.** Append to `PlatformDevConfig` in `packages/db/prisma/schema.prisma`:
  ```prisma
    // Which push model to use when contributionMode is selective | contribute_all.
    // null = unconfigured; explicit value required before contribute_to_hive runs.
    // "maintainer-direct" — push directly to upstream (legacy path, requires upstream write)
    // "fork-pr"          — push to contributor-owned fork, open cross-repo PR (public-repo default)
    contributionModel      String?
    contributorForkOwner   String?
    contributorForkRepo    String?
    forkVerifiedAt         DateTime?
  ```
- [ ] **Step 2: Generate migration.**
  ```bash
  pnpm --filter @dpf/db exec prisma migrate dev --name add_contribution_model --create-only
  ```
  Verify the new `migration.sql` only adds four nullable columns; no backfill, no defaults, no dropped columns.
- [ ] **Step 3: Apply + regenerate client.** `pnpm --filter @dpf/db exec prisma migrate dev` (applies + regenerates).
- [ ] **Step 4: Commit.** `feat(db): add contributionModel + fork fields to PlatformDevConfig`

### Task 1.2: Invariant test — `contributionModel=null` for fresh installs

- [ ] **Step 1: Write failing test** at `packages/db/src/platform-dev-config-invariants.test.ts`:
  ```typescript
  import { describe, it, expect } from "vitest";
  import { readFileSync } from "node:fs";
  import { resolve } from "node:path";

  describe("PlatformDevConfig invariants", () => {
    it("contributionModel has no default in schema — fresh rows must be null", () => {
      const schema = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf8");
      const block = schema.match(/model PlatformDevConfig \{[\s\S]*?\n\}/)?.[0] ?? "";
      const line = block.split("\n").find((l) => l.trim().startsWith("contributionModel"));
      expect(line, "contributionModel field must exist").toBeDefined();
      expect(line, "contributionModel must NOT have @default(...)").not.toMatch(/@default/);
      expect(line, "contributionModel must be optional (String?)").toMatch(/String\?/);
    });

    it("seed.ts does not write contributionModel", () => {
      const seed = readFileSync(resolve(__dirname, "./seed.ts"), "utf8");
      expect(seed, "seed must not write contributionModel — first-time setup must go through admin UI").not.toMatch(/contributionModel/);
    });
  });
  ```
- [ ] **Step 2: Run test.** `pnpm --filter @dpf/db test -- platform-dev-config-invariants` — should fail if the schema still has a default or seed writes the field.
- [ ] **Step 3: Confirm green.** Schema from Task 1.1 satisfies both checks. If red, adjust schema (not test).
- [ ] **Step 4: Commit.** `test(db): add invariant that contributionModel defaults to null`

### Task 1.3: Feature flag module

- [ ] **Step 1: Write failing test** at `apps/web/lib/flags/contribution-model.test.ts`:
  ```typescript
  import { describe, it, expect, beforeEach, afterEach } from "vitest";
  import { isContributionModelEnabled } from "./contribution-model";

  describe("CONTRIBUTION_MODEL_ENABLED", () => {
    const orig = process.env.CONTRIBUTION_MODEL_ENABLED;
    beforeEach(() => { delete process.env.CONTRIBUTION_MODEL_ENABLED; });
    afterEach(() => { process.env.CONTRIBUTION_MODEL_ENABLED = orig; });

    it("defaults to false when unset", () => {
      expect(isContributionModelEnabled()).toBe(false);
    });
    it("is false for anything except 'true'", () => {
      process.env.CONTRIBUTION_MODEL_ENABLED = "1";
      expect(isContributionModelEnabled()).toBe(false);
      process.env.CONTRIBUTION_MODEL_ENABLED = "yes";
      expect(isContributionModelEnabled()).toBe(false);
    });
    it("is true only when exactly 'true'", () => {
      process.env.CONTRIBUTION_MODEL_ENABLED = "true";
      expect(isContributionModelEnabled()).toBe(true);
    });
  });
  ```
- [ ] **Step 2: Run test, expect failure** (module doesn't exist yet).
- [ ] **Step 3: Create module** `apps/web/lib/flags/contribution-model.ts`:
  ```typescript
  /**
   * Feature flag gating the fork-based PR contribution mode rollout.
   * Default: disabled. Set CONTRIBUTION_MODEL_ENABLED=true to enable.
   *
   * When disabled: contribute_to_hive uses the pre-existing direct-push flow
   * regardless of PlatformDevConfig.contributionModel value.
   */
  export function isContributionModelEnabled(): boolean {
    return process.env.CONTRIBUTION_MODEL_ENABLED === "true";
  }
  ```
- [ ] **Step 4: Run test, expect pass.**
- [ ] **Step 5: Commit.** `feat(flags): add CONTRIBUTION_MODEL_ENABLED feature flag (default off)`

### Task 1.4: Open PR

- [ ] `gh pr create --base main --title "feat(ccm): phase 1 — schema + feature flag" --body "Schema additions + feature flag plumbing for the public contribution mode. See docs/superpowers/plans/2026-04-23-public-contribution-mode.md phase 1. Flag defaults off; no behavior change."`
- [ ] Wait for green CI, merge with squash-and-delete.

---

## Phase 2 — Fork setup flow (admin UI + fork creation API)

**Branch:** `feat/ccm-phase-2-fork-setup`

**Files:**
- Create: `apps/web/lib/integrate/github-fork.ts` (fork creation + verification helpers)
- Create: `apps/web/lib/integrate/github-fork.test.ts`
- Modify: `apps/web/lib/actions/platform-dev-config.ts` (add `configureForkSetup` server action)
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx` (add fork-setup fields, gated on flag)

**Context:** Fork creation is async on GitHub (typical 1–5s, upper bound 5 min). Polling strategy per spec §"Fork creation and verification" + reviewer recommendation: **1-second interval, 60 attempts = 60 s active polling**, then return a deferred-verification state (with UI messaging) if the fork is still not ready; the background re-check in `contribute_to_hive` (within 24 h) confirms eventual readiness. Reference GitHub docs: `POST /repos/{owner}/{repo}/forks` and `GET /repos/{owner}/{repo}`.

### Task 2.1: Fork detection helper

- [ ] **Step 1: Write failing test** for `forkExistsAndIsFork(owner, repo, upstreamOwner, upstreamRepo, token)`:
  ```typescript
  it("returns {exists: true, isFork: true} when GitHub returns the fork with matching upstream", async () => { /* mocked 200 with parent owner/name matching upstream */ });
  it("returns {exists: true, isFork: false} when repo exists but isn't a fork", async () => { /* mocked 200 with no parent */ });
  it("returns {exists: true, isFork: false} when it IS a fork but of a different upstream", async () => { /* mocked 200 with mismatched parent */ });
  it("returns {exists: false} on 404", async () => { /* mocked 404 */ });
  it("throws on 401/403", async () => { /* mocked 401 */ });
  ```
- [ ] **Step 2: Run test, expect failure.**
- [ ] **Step 3: Implement** `apps/web/lib/integrate/github-fork.ts`:
  ```typescript
  export interface ForkCheckResult {
    exists: boolean;
    isFork: boolean;  // only meaningful if exists === true
    parentFullName?: string;  // only set if isFork === true
  }

  export async function forkExistsAndIsFork(params: {
    owner: string; repo: string;
    upstreamOwner: string; upstreamRepo: string;
    token: string;
  }): Promise<ForkCheckResult> {
    const { owner, repo, upstreamOwner, upstreamRepo, token } = params;
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (res.status === 404) return { exists: false, isFork: false };
    if (!res.ok) throw new Error(`GitHub API GET ${url}: ${res.status} ${await res.text()}`);
    const body = await res.json() as { fork: boolean; parent?: { full_name: string } };
    if (!body.fork || !body.parent) return { exists: true, isFork: false };
    const expected = `${upstreamOwner}/${upstreamRepo}`.toLowerCase();
    const actual = body.parent.full_name.toLowerCase();
    return {
      exists: true,
      isFork: actual === expected,
      parentFullName: body.parent.full_name,
    };
  }
  ```
- [ ] **Step 4: Run test, expect pass.**
- [ ] **Step 5: Commit.** `feat(github-fork): add fork detection helper`

### Task 2.2: Fork creation helper with polling

- [ ] **Step 1: Write failing test** for `createForkAndWait({ upstreamOwner, upstreamRepo, token, pollIntervalMs, maxAttempts })`:
  ```typescript
  it("returns { status: 'ready', forkOwner } when fork is available within polling window", async () => { /* mock POST forks → 202, then GET returns 200 on attempt 3 */ });
  it("returns { status: 'deferred' } when fork not ready after maxAttempts", async () => { /* mock POST forks → 202, GET returns 404 every time */ });
  it("throws actionable error on POST forks 403 ('This organization does not allow private repository forking' or similar)", async () => { /* mocked 403 */ });
  it("throws actionable error on POST forks 401 (bad token)", async () => { /* mocked 401 */ });
  ```
- [ ] **Step 2: Run test, expect failure.**
- [ ] **Step 3: Implement** in the same `github-fork.ts`:
  ```typescript
  export type ForkCreationResult =
    | { status: "ready"; forkOwner: string; forkRepo: string }
    | { status: "deferred"; forkOwner: string; forkRepo: string };

  export async function createForkAndWait(params: {
    upstreamOwner: string; upstreamRepo: string; token: string;
    pollIntervalMs?: number; maxAttempts?: number;
  }): Promise<ForkCreationResult> {
    const { upstreamOwner, upstreamRepo, token } = params;
    const pollIntervalMs = params.pollIntervalMs ?? 1000;
    const maxAttempts = params.maxAttempts ?? 60;

    // POST /repos/{upstream}/forks — returns 202 with the fork's repo info on success.
    const postRes = await fetch(`https://api.github.com/repos/${upstreamOwner}/${upstreamRepo}/forks`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (postRes.status === 401) throw new Error("Token rejected by GitHub (401). Check scope and validity.");
    if (postRes.status === 403) {
      const body = await postRes.text();
      throw new Error(`Fork creation forbidden (403). ${body.slice(0, 200)}`);
    }
    if (!postRes.ok && postRes.status !== 202) {
      throw new Error(`POST /forks: ${postRes.status} ${await postRes.text()}`);
    }
    const forkInfo = await postRes.json() as { owner: { login: string }; name: string };
    const forkOwner = forkInfo.owner.login;
    const forkRepo = forkInfo.name;

    // Poll GET /repos/{fork} until 200 or maxAttempts exhausted.
    for (let i = 0; i < maxAttempts; i++) {
      const check = await forkExistsAndIsFork({
        owner: forkOwner, repo: forkRepo, upstreamOwner, upstreamRepo, token,
      });
      if (check.exists && check.isFork) return { status: "ready", forkOwner, forkRepo };
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
    return { status: "deferred", forkOwner, forkRepo };
  }
  ```
- [ ] **Step 4: Run test, expect pass.**
- [ ] **Step 5: Commit.** `feat(github-fork): add fork creation with polling`

### Task 2.3: `configureForkSetup` server action

- [ ] **Step 1: Write failing test** `apps/web/lib/actions/platform-dev-config.test.ts` (extend existing) for `configureForkSetup({ contributorForkOwner, token })`:
  - returns `{ success: false, error: "…token…" }` when token fails validation
  - returns `{ success: false, error: "…not a fork…" }` when repo exists but isn't a fork
  - returns `{ success: true, status: "ready" }` when fork is created and ready
  - returns `{ success: true, status: "deferred" }` when fork is created but polling times out
  - writes `contributorForkOwner`, `contributorForkRepo`, `forkVerifiedAt` to PlatformDevConfig on success
  - does NOT write `contributionModel` (that's set in a separate step)
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Implement** in `apps/web/lib/actions/platform-dev-config.ts`:
  ```typescript
  export async function configureForkSetup(input: {
    contributorForkOwner: string;
    token: string;
  }): Promise<{ success: true; status: "ready" | "deferred"; forkOwner: string; forkRepo: string } | { success: false; error: string }> {
    // Validate token (delegates to existing validateGitHubToken)
    const v = await validateGitHubToken(input.token);
    if (!v.valid) return { success: false, error: v.error };

    // Parse upstream from PlatformDevConfig.upstreamRemoteUrl.
    const cfg = await prisma.platformDevConfig.findUnique({ where: { id: "singleton" }, select: { upstreamRemoteUrl: true } });
    const upstreamUrl = cfg?.upstreamRemoteUrl ?? "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";
    const m = upstreamUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (!m) return { success: false, error: `Upstream URL not recognized: ${upstreamUrl}` };
    const [, upstreamOwner, upstreamRepo] = m;

    // Check whether contributor's fork already exists.
    const existing = await forkExistsAndIsFork({
      owner: input.contributorForkOwner, repo: upstreamRepo,
      upstreamOwner, upstreamRepo, token: input.token,
    });
    if (existing.exists && !existing.isFork) {
      return { success: false, error: `A repo ${input.contributorForkOwner}/${upstreamRepo} exists but is not a fork of ${upstreamOwner}/${upstreamRepo}. Rename it or delete it, then retry.` };
    }

    let result: ForkCreationResult;
    if (existing.exists && existing.isFork) {
      result = { status: "ready", forkOwner: input.contributorForkOwner, forkRepo: upstreamRepo };
    } else {
      result = await createForkAndWait({ upstreamOwner, upstreamRepo, token: input.token });
    }

    await prisma.platformDevConfig.update({
      where: { id: "singleton" },
      data: {
        contributorForkOwner: result.forkOwner,
        contributorForkRepo: result.forkRepo,
        forkVerifiedAt: result.status === "ready" ? new Date() : null,
      },
    });

    return { success: true, status: result.status, forkOwner: result.forkOwner, forkRepo: result.forkRepo };
  }
  ```
- [ ] **Step 4: Run test, expect pass.**
- [ ] **Step 5: Commit.** `feat(dev-config): add configureForkSetup server action`

### Task 2.4: Admin UI — fork setup fields (flag-gated)

- [ ] **Step 1: Write failing test** for `PlatformDevelopmentForm` rendering:
  - When `CONTRIBUTION_MODEL_ENABLED=false`: no fork-setup section is rendered (current behavior).
  - When `CONTRIBUTION_MODEL_ENABLED=true` and `contributionModel === null`: a "Contribution model setup" banner renders with a "Configure fork-based contribution" button.
  - When the button is clicked and a GitHub username is entered, the `configureForkSetup` action is called.
  - On `success: true, status: "ready"`: UI shows "Fork verified" with the fork URL.
  - On `success: true, status: "deferred"`: UI shows "Fork is being created, this usually takes a few seconds. If your first contribution fails, re-check here."
- [ ] **Step 2: Run test, expect failure** (UI section doesn't exist).
- [ ] **Step 3: Add the fork-setup panel** to `apps/web/components/admin/PlatformDevelopmentForm.tsx`. Keep it under a conditional `{isContributionModelEnabled() && …}` wrapper.
- [ ] **Step 4: Run test, expect pass.**
- [ ] **Step 5: Commit.** `feat(admin-ui): add fork setup panel (flag-gated)`

### Task 2.5: Verify + PR

- [ ] `pnpm typecheck && pnpm --filter web build && pnpm --filter web test -- platform-dev-config github-fork PlatformDevelopmentForm`
- [ ] Push, open PR `feat(ccm): phase 2 — fork setup flow`. Body links plan and states: flag off → no behavior change.

---

## Phase 3 — `github-api-commit.ts` head/base param split

**Branch:** `feat/ccm-phase-3-commit-split`

**Files:**
- Modify: `apps/web/lib/integrate/github-api-commit.ts` (split `createBranchAndPR` params)
- Modify: `apps/web/lib/integrate/github-api-commit.test.ts` (new/updated tests)
- Modify: `apps/web/lib/mcp-tools.ts` (caller — pass head+base the new way)
- Modify: `apps/web/lib/integrate/contribution-pipeline.ts` (caller — pass head+base the new way)

**Context:** Existing `createBranchAndPR` takes a single `owner`/`repo`. All three existing call sites pass identical head and base. The split keeps behavior identical for every existing caller (they pass `headOwner === baseOwner`) and enables phase 4 to add a caller where they differ.

### Task 3.1: Add new param names while keeping behavior identical

- [ ] **Step 1: Update existing tests** for `createBranchAndPR` to use the new shape (`headOwner`/`headRepo`/`baseOwner`/`baseRepo`/`baseBranch`). Existing "same-owner" assertions should still pass when head and base match.
- [ ] **Step 2: Add a NEW test** for cross-repo PR body shape:
  ```typescript
  it("PR body uses 'headOwner:branchName' when headOwner differs from baseOwner (cross-repo PR)", async () => {
    // mock fetch; capture the PR-creation POST body
    // assert parsed body.head === "jane-dev:dpf/abc/feat-xyz"
    // assert parsed body.base === "main"
  });
  it("PR body uses bare 'branchName' when headOwner === baseOwner (same-repo PR)", async () => {
    // assert body.head === "dpf/abc/feat-xyz"
  });
  ```
- [ ] **Step 3: Run tests, expect failure** (function still takes old owner/repo).
- [ ] **Step 4: Refactor** `createBranchAndPR` signature:
  ```typescript
  export interface CreateBranchAndPRParams {
    headOwner: string;
    headRepo: string;
    baseOwner: string;
    baseRepo: string;
    baseBranch: string;
    branchName: string;
    commitMessage: string;
    diff: string;
    prTitle: string;
    prBody: string;
    labels: string[];
    token: string;
  }

  export async function createBranchAndPR(p: CreateBranchAndPRParams): Promise<GitHubCommitResult> {
    // Blob/tree/commit/ref creation happens against p.headOwner/p.headRepo.
    // Base sha is read from p.baseOwner/p.baseRepo@p.baseBranch.
    // If head and base are different repos, sync the fork's baseBranch from upstream before creating the new branch
    // (this is where the Phase 4 "merge-upstream" addition hooks; leave a clear comment pointing to it).
    // PR POST target: https://api.github.com/repos/{p.baseOwner}/{p.baseRepo}/pulls
    // PR body.head: p.headOwner === p.baseOwner ? p.branchName : `${p.headOwner}:${p.branchName}`
    // PR body.base: p.baseBranch
    // Labels POST to PR's issue number at {baseOwner}/{baseRepo}.
  }
  ```
- [ ] **Step 4.5: Preserve all existing behavior.** The existing `createBranchAndPR` body is long and has side effects in specific order. Keep these invariants unchanged during refactor: (1) base-sha lookup → blob creation → tree creation → commit creation → ref creation → PR POST → labels POST, in that order; (2) `X-RateLimit-Remaining` is propagated into error messages; (3) `explainBaseRefFailure` wraps 401/403/404 on the base-ref lookup; (4) the label POST writes to the base repo's issue, not the head repo's.
- [ ] **Step 5: Update all 3 call sites** to pass the new shape with `headOwner === baseOwner` and `headRepo === baseRepo`:
  - [apps/web/lib/mcp-tools.ts:5294](../../apps/web/lib/mcp-tools.ts#L5294) (`contribute_to_hive`)
  - `apps/web/lib/integrate/contribution-pipeline.ts` (search for `createBranchAndPR(`)
  - any other hit from `grep -r "createBranchAndPR(" apps/web/lib`
- [ ] **Step 6: Run tests, expect pass.**
- [ ] **Step 7: Commit.** `refactor(github-api-commit): split head/base params on createBranchAndPR`

### Task 3.2: Verify + PR

- [ ] `pnpm typecheck && pnpm --filter web build && pnpm --filter web test -- github-api-commit mcp-tools contribution-pipeline`
- [ ] Push, open PR `feat(ccm): phase 3 — head/base param split`. Note in the body: no runtime behavior change; cross-repo test covered.

---

## Phase 4 — `contribute_to_hive` model dispatch + fork staleness handling

**Branch:** `feat/ccm-phase-4-dispatch`

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (contribute_to_hive case)
- Modify: `apps/web/lib/integrate/github-api-commit.ts` (add `syncForkFromUpstream` helper)
- Modify: `apps/web/lib/integrate/github-api-commit.test.ts`

**Context:** Spec Open Question #2 (fork staleness) is **scheduled here**, not deferred. Before each fork-pr contribution, call `POST /repos/{fork}/merge-upstream` with `{ branch: "main" }` to sync the fork's main from upstream. Fail loudly if merge-upstream errors — caller returns actionable error, does not open a PR from a stale/divergent fork.

### Task 4.1: `syncForkFromUpstream` helper

- [ ] **Step 1: Failing test** for `syncForkFromUpstream({ forkOwner, forkRepo, branch, token })`:
  - success: 200 → resolves
  - conflict: 409 → throws with "merge-upstream conflict" message
  - other non-ok: throws with status + body
- [ ] **Step 2: Implement.**
  ```typescript
  export async function syncForkFromUpstream(p: {
    forkOwner: string; forkRepo: string; branch: string; token: string;
  }): Promise<void> {
    const res = await fetch(`https://api.github.com/repos/${p.forkOwner}/${p.forkRepo}/merge-upstream`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${p.token}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
      body: JSON.stringify({ branch: p.branch }),
    });
    if (res.ok) return;
    const body = await res.text();
    if (res.status === 409) throw new Error(`Fork merge-upstream conflict on ${p.forkOwner}/${p.forkRepo}@${p.branch}: ${body.slice(0, 200)}`);
    throw new Error(`POST merge-upstream: ${res.status} ${body.slice(0, 200)}`);
  }
  ```
- [ ] **Step 3: Run test, expect pass.**
- [ ] **Step 4: Commit.** `feat(github-api-commit): add syncForkFromUpstream helper`

### Task 4.2: Model dispatch inside `contribute_to_hive`

- [ ] **Step 1: Extend mcp-tools.ts test suite** with these scenarios:
  - Flag OFF: runtime is byte-identical to pre-phase-4 behavior (direct push, no model check).
  - Flag ON + `contributionModel === null`: returns `success: false` with "Contribution model is not configured" — does NOT call `createBranchAndPR`.
  - Flag ON + `contributionModel === "maintainer-direct"`: `createBranchAndPR` called with `headOwner === baseOwner === upstreamOwner`. No `syncForkFromUpstream` called.
  - Flag ON + `contributionModel === "fork-pr"` + `forkVerifiedAt` within 24 h: skip fork existence check; call `syncForkFromUpstream` then `createBranchAndPR` with `headOwner === contributorForkOwner`, `baseOwner === upstreamOwner`.
  - Flag ON + `contributionModel === "fork-pr"` + `forkVerifiedAt` older than 24 h: re-check fork via `forkExistsAndIsFork`; on exists+isFork `prisma.platformDevConfig.update({ where: { id: "singleton" }, data: { forkVerifiedAt: new Date() } })` before proceeding; on missing fork return `success: false` with "Fork not found — re-run setup."
  - Flag ON + `fork-pr` + merge-upstream conflict: return `success: false` with the conflict message. No PR opened.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** Wrap the new logic in `if (isContributionModelEnabled()) { … } else { <existing behavior> }`. Inside the flag branch, dispatch on `contributionModel`.
- [ ] **Step 4: Run, expect all green.**
- [ ] **Step 5: Commit.** `feat(contribute-to-hive): dispatch on contributionModel, gated on flag`

### Task 4.3: Verify + PR

- [ ] Full typecheck + build + affected tests.
- [ ] Push, open PR `feat(ccm): phase 4 — model dispatch + fork staleness`.

---

## Phase 5 — Token validation per model + admin UI copy

**Branch:** `feat/ccm-phase-5-token-ui-copy`

**Files:**
- Modify: `apps/web/lib/actions/platform-dev-config.ts` (`validateGitHubToken` extended)
- Create: `apps/web/lib/integrate/contribution-copy.ts` (single source of truth for pseudonymity + token-scope copy — referenced by both admin UI and CONTRIBUTING.md)
- Create: `apps/web/lib/integrate/contribution-copy.test.ts` (snapshot / structure test)
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx` (consume shared copy module)

**Context:** Reviewer recommendation #7 — the pseudonymity + token-scope explanations must not drift between the admin UI (shown to portal admins) and CONTRIBUTING.md (shown to human contributors). One exported object; both surfaces import from it.

### Task 5.1: Shared copy module

- [ ] **Step 1: Failing test:** snapshot + shape assertion for `CONTRIBUTION_COPY` object.
  ```typescript
  it("exports token-scope copy for both models", () => {
    expect(CONTRIBUTION_COPY.tokenScope.maintainerDirect).toContain("contents:write");
    expect(CONTRIBUTION_COPY.tokenScope.forkPr).toContain("public_repo");
  });
  it("exports pseudonymity tradeoff copy", () => {
    expect(CONTRIBUTION_COPY.pseudonymityTradeoff).toMatch(/GitHub username will be visible/i);
  });
  ```
- [ ] **Step 2: Implement** `apps/web/lib/integrate/contribution-copy.ts`:
  ```typescript
  export const CONTRIBUTION_COPY = {
    tokenScope: {
      maintainerDirect: "This token needs `contents:write` on the upstream repo. Only maintainers of the OpenDigitalProductFactory org should use this mode.",
      forkPr: "This token needs the `public_repo` scope on your own GitHub account. It does NOT need access to the upstream repo — the platform will create a fork under your account the first time you contribute.",
    },
    pseudonymityTradeoff:
      "Your GitHub username will be visible on every PR you contribute. The platform-generated commit identity (dpf-agent-<shortId>) still applies to commit metadata, but the fork owner is necessarily visible on GitHub. If that is not acceptable, use a pseudonymous GitHub account for this install.",
    machineUserOptIn: {
      label: "I am using a dedicated machine-user GitHub account",
      description: "Check this if the PAT belongs to an account that is NOT your primary identity. The platform will skip the 'token owner must match fork owner' check.",
    },
    banner: {
      needsConfiguration: "A platform update requires re-configuring contribution mode before your next contribution. Open setup below.",
      openSetupLinkLabel: "Open setup",
    },
  } as const;
  ```
- [ ] **Step 3: Run test, expect pass.**
- [ ] **Step 4: Commit.** `feat(contribution-copy): shared source for admin-UI + CONTRIBUTING.md copy`

### Task 5.2: `validateGitHubToken` per model + machine-user opt-out

- [ ] **Step 1: Extend test suite.** For the new signature `validateGitHubToken(input: { token: string; model: "maintainer-direct" | "fork-pr"; expectedOwner?: string; machineUser?: boolean })`:
  - maintainer-direct: token valid, has `contents:write` on upstream → valid
  - maintainer-direct: token valid, missing `contents:write` → invalid with scope message
  - fork-pr: token valid, has `public_repo`, owner === expectedOwner → valid
  - fork-pr: owner mismatch + machineUser=false → invalid with "Token owner … does not match fork owner …"
  - fork-pr: owner mismatch + machineUser=true → valid (opt-out honored)
- [ ] **Step 2: Extend `validateGitHubToken`** signature and implementation accordingly. Persist `machineUser` as a `Boolean?` column on `PlatformDevConfig`:
  - [ ] Add `machineUserOptIn  Boolean   @default(false)` to schema.prisma
  - [ ] New migration `<ts>_add_machine_user_opt_in`
  - [ ] Keep `contributionModel` invariant test green — adding a boolean with default is fine.
- [ ] **Step 3: Admin UI consumes copy.** Replace the existing inline token help text with `CONTRIBUTION_COPY.tokenScope[model]`. Add a checkbox + field for `machineUserOptIn` per reviewer rec #4. Show `CONTRIBUTION_COPY.pseudonymityTradeoff` near the fork-owner input.
- [ ] **Step 4: Run tests, typecheck, build.**
- [ ] **Step 5: Commit.** `feat(token-validate): per-model scope + machine-user opt-out`

### Task 5.3: Verify + PR

- [ ] Push, open PR `feat(ccm): phase 5 — token validation + admin UI copy`.

---

## Phase 6 — Migration banner + re-setup guard

**Branch:** `feat/ccm-phase-6-migration-banner`

**Files:**
- Create: `apps/web/components/admin/ContributionModelBanner.tsx`
- Create: `apps/web/components/admin/ContributionModelBanner.test.tsx`
- Modify: `apps/web/app/(shell)/admin/platform-development/page.tsx` to render the banner
- Modify: `apps/web/lib/mcp-tools.ts` (refuse-unset-model guard — already in phase 4; this phase only asserts its user-visible copy matches the banner)

**Context:** Banner renders when flag ON AND `contributionMode` is `selective | contribute_all` AND `contributionModel` is null. Clicking "Open setup" scrolls to / opens the Platform Development form.

### Task 6.1: Banner component

- [ ] **Step 1: Failing tests.** `ContributionModelBanner.test.tsx`:
  - renders nothing when flag is off
  - renders nothing when flag on but contributionModel is set
  - renders nothing when flag on but contributionMode is fork_only
  - renders banner when flag on AND contributionMode in {selective, contribute_all} AND contributionModel is null
  - banner copy matches `ContributionModelBannerCopy.needsConfiguration` (extract to `contribution-copy.ts`)
  - "Open setup" link points to `/admin/platform-development#contribution-setup`
- [ ] **Step 2: Implement.** Banner is a Server Component receiving the config prop. No client JS needed except the link.
- [ ] **Step 3: Tests green.**
- [ ] **Step 4: Commit.** `feat(admin-banner): contribution-model re-setup banner`

### Task 6.2: Wire banner into platform-development page

- [ ] **Step 1: Update page.** Fetch config, pass to banner, render above the existing form.
- [ ] **Step 2: Snapshot test** of the page rendering with a "needs re-setup" config. Assert banner appears once; form renders below.
- [ ] **Step 3: Commit.** `feat(admin-page): wire contribution-model banner`

### Task 6.3: Verify + PR

- [ ] Push, open PR `feat(ccm): phase 6 — migration banner + re-setup guard`.

---

## Phase 7 — CONTRIBUTING.md + docs

**Branch:** `doc/ccm-phase-7-contrib-docs`

**Files:**
- Modify: `CONTRIBUTING.md` (import copy from the source module conceptually — but since CONTRIBUTING.md is static MD, the shared source is referenced in-text and a build-time check asserts the strings match)
- Create: `apps/web/lib/integrate/contribution-copy-docs.test.ts` (asserts CONTRIBUTING.md contains the token-scope + pseudonymity sentences verbatim from `CONTRIBUTION_COPY`)
- Modify: `docs/user-guide/getting-started/developer-setup.md` (link to new "Contributing from a running install" section)

**Context:** Per reviewer recommendation #7, the CONTRIBUTING.md additions and the admin-UI copy must stay synchronized. We enforce with a test: if `CONTRIBUTION_COPY.tokenScope.forkPr` or `CONTRIBUTION_COPY.pseudonymityTradeoff` ever change without CONTRIBUTING.md updating, CI fails. The test reads `CONTRIBUTING.md` from disk and asserts `includes(...)` for each string.

### Task 7.1: Add "Contributing from a running install" section

- [ ] **Step 1: Draft section** covering:
  - When to use it (you built something in Build Studio and want to share it)
  - Contribution-mode recap (fork_only / selective / contribute_all) — link to 2026-04-01 spec
  - Fork-pr vs maintainer-direct (link to this plan + spec)
  - How to set up fork-pr (Admin > Platform Development, GitHub account field, fork created automatically)
  - Token scope note — copy-paste from `CONTRIBUTION_COPY.tokenScope.forkPr`
  - Pseudonymity tradeoff — copy-paste from `CONTRIBUTION_COPY.pseudonymityTradeoff`
  - Machine-user option — link to the opt-out
- [ ] **Step 2: Write the doc-sync test** that asserts the literal strings are present.
- [ ] **Step 3: Run typecheck + tests.** The sync test passes because section contains the strings verbatim.
- [ ] **Step 4: Commit.** `doc(contributing): add install-based contribution section`

### Task 7.2: Developer-setup cross-link

- [ ] Add a one-line link from `developer-setup.md` to the new CONTRIBUTING.md section.
- [ ] Commit. `doc: link dev setup to install-contribution section`

### Task 7.3: Verify + PR

- [ ] Push, open PR `doc(ccm): phase 7 — CONTRIBUTING.md + developer setup`.

---

## Phase 8 — Post-public-flip settings (operational; not a code PR)

**Blocker status:** Phase 8 does NOT block phases 1–7. All code can merge with the flag off while the repo is still private. Phase 8 runs after the public-flip playbook from the earlier prompt (uuid alert → flip → settings). Once those settings are in place and the codebase has been manually smoke-tested against a real fork, the flag flips to `true` for new installs via a separate "enable CONTRIBUTION_MODEL_ENABLED" PR.

**Checklist (maintainer runs this, not an agent):**

- [ ] `allow_forking: true` on upstream
- [ ] Secret scanning + push protection enabled
- [ ] DCO GitHub App installed (https://github.com/apps/dco)
- [ ] Branch protection on `main` with `Typecheck` + `Production Build` required, no force push, linear history, admins included
- [ ] Create a test fork as the maintainer using the new admin flow; contribute a trivial change end-to-end; confirm the PR opens across repos and merges
- [ ] Flip `CONTRIBUTION_MODEL_ENABLED=true` in the default environment config. The runtime read is `process.env.CONTRIBUTION_MODEL_ENABLED` in `apps/web/lib/flags/contribution-model.ts`, so the value must reach the portal container at runtime. Update ALL of: `.env.example`, `.env.docker.example`, `docker-compose.yml` (portal + portal-init env sections), and any deploy manifest (Helm values, systemd unit, etc.) the project ships. Verify in a running container with `docker compose exec portal printenv | grep CONTRIBUTION_MODEL_ENABLED` before claiming the flip landed.
- [ ] Announce to existing installs (release notes, in-app banner already present from phase 6)

---

## Open questions resolved in this plan

| Spec Open Question | Resolution |
|--------------------|------------|
| #1 Machine-user option | Implemented as a checkbox (`machineUserOptIn`) in Phase 5 Task 5.2. Enables opt-out of the fork-owner=token-owner check. |
| #2 Fork staleness / merge-upstream | Scheduled in Phase 4 Tasks 4.1–4.2 (`syncForkFromUpstream` before every fork-pr contribution; fail loud on conflict). |
| #3 Rate-limit guard | Deferred. `createBranchAndPR` already surfaces `X-RateLimit-Remaining` in error messages; no in-app guard until usage justifies. |
| #4 `gh` CLI fallback | Deferred. REST-only, consistent with existing code. |

## Execution handoff

- **Recommended:** `superpowers:subagent-driven-development` — dispatch one implementer subagent per phase, review between phases, each subagent opens its own PR.
- **Alternate:** `superpowers:executing-plans` — batch execution in this session with checkpoints after each phase's PR is merged.
- **Worktrees:** each phase in `d:\DPF-ccm-<n>`; remove after merge.
