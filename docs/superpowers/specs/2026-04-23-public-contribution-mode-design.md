# Public Contribution Mode — Fork-Based PR Flow

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-HANDOFF-002 (Phase 2e extension, public-repo follow-on) |
| **IT4IT Alignment** | §5.4 Deploy — contribution pipeline governs how built artifacts flow from sandbox to upstream when the upstream repo is world-visible |
| **Depends On** | [Contribution Mode & Git Integration Design (2026-04-01)](2026-04-01-contribution-mode-git-integration-design.md), [Pseudonymous Identity & Issue Bridge (2026-04-18)](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md), repo transfer to `OpenDigitalProductFactory` org (2026-04-22) |
| **Status** | Proposed |
| **Created** | 2026-04-23 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

## Problem Statement

The existing contribution mode ([2026-04-01 spec](2026-04-01-contribution-mode-git-integration-design.md)) assumes every install has a Personal Access Token with **write access to the upstream repository**. The code path at [`apps/web/lib/mcp-tools.ts:5243`](../../../apps/web/lib/mcp-tools.ts#L5243) pushes a `dpf/<hash>/<slug>` branch directly to the upstream repo and comments: *"No customer fork needed — the hive token provides write access."*

That model was defensible while the upstream repo was private and limited to a small number of trusted installs. With the repository transferred to the `OpenDigitalProductFactory` organization and imminent public flip:

1. **Upstream-write tokens don't scale publicly.** Every install the platform is distributed to is a potential token leak. A leaked PAT plus the `upstreamRemoteUrl` in `PlatformDevConfig` equals direct push access to the public repo. The cost of a single leak is catastrophic.
2. **Branch protection conflicts with direct-push.** The public flip enables branch protection on `main` at the Free tier. Required reviewers and required status checks on incoming branches are configurable per-actor, but the right answer is to remove the actor-push dependency entirely.
3. **The fork-based PR flow is the industry-standard open-source contribution pattern.** Contributors push to their own forks (a namespace they already control), then open cross-repo PRs. The upstream never grants write access to non-maintainers.
4. **`allow_forking` is currently `false` on the upstream repo.** Even if the code supported fork-based contribution today, the repo would reject fork creation. This must be flipped (pending the public flip — org policy blocks `allow_forking` on private repos).
5. **Pseudonymity has a new dimension.** In the current direct-push model, the install's `authorName` (`dpf-agent-<shortId>`) appears in commits and is the only identity surfaced publicly. In a fork-based model, the GitHub account that owns the fork is also publicly visible on every PR — that account's real identity is not hidden by any pseudonym the platform generates. This tradeoff needs a documented stance.

## Goals and Non-Goals

**Goals**

- Support contribution from installs that do not have (and should not have) upstream write access.
- Keep the existing direct-push path available for maintainer-owned installs, behind an explicit opt-in.
- Honor every silent-failure gate added in PR #137 — `contribute_to_hive` never returns `success:true` with a null PR URL when the PR flow fails.
- Surface the pseudonymity tradeoff honestly in the admin UI so contributors choose their GitHub account with full information.
- Ship behind a feature flag so existing installs are not broken mid-transition.

**Non-Goals**

- Changing the `fork_only` contribution mode (local-only installs that never push anywhere) — that mode is unchanged.
- Building a DPF-owned GitHub App that forks and opens PRs on behalf of users. This is a viable future path (single-click install, bot-identity PRs) but requires hosting webhook infrastructure and is out of scope for this spec.
- Migrating existing contribution-mode config data. A schema migration adds new columns; existing installs are flagged in the admin UI and prompted to re-run setup before their next contribution attempt.
- Enforcing a specific GitHub account type (personal vs. organization, real-name vs. pseudonymous). The admin surface documents the tradeoff; the choice is the contributor's.

## Design

### Two contribution models

The `PlatformDevConfig.contributionModel` field is added (String, defaults to `"fork-pr"`). Two values are supported:

| Model | Who uses it | How it pushes | Upstream access required |
|-------|-------------|---------------|--------------------------|
| `maintainer-direct` | Maintainer-owned installs only (legacy path, explicit opt-in) | Branch pushed directly to upstream; PR opened within upstream | **Yes** — token must have `contents:write` on upstream |
| `fork-pr` | Every other install (new default) | Branch pushed to contributor-owned fork; PR opened across repos | **No** — token needs `public_repo` on contributor's account; fork is created automatically if missing |

These models are orthogonal to the existing three-mode axis (`fork_only` / `selective` / `contribute_all`). A `fork_only` install ignores `contributionModel` entirely since it never pushes upstream. `selective` and `contribute_all` installs honor it on every contribution attempt.

### Schema changes (`PlatformDevConfig`)

```prisma
model PlatformDevConfig {
  // … existing fields …

  // Which push model to use when contributionMode is selective | contribute_all
  contributionModel      String?  // "maintainer-direct" | "fork-pr" — null means "needs configuration"

  // Fork metadata for fork-pr model. Null while contributionModel != "fork-pr".
  contributorForkOwner   String?  // GitHub username/org that owns the fork (e.g. "jane-dev")
  contributorForkRepo    String?  // Usually equals upstream repo name; stored to support renamed forks

  // When the fork was last verified to exist. Used to skip the existence check
  // on every contribution call; re-verified after 24h.
  forkVerifiedAt         DateTime?
}
```

Migration: additive only, no backfill. Installs with existing `selective` / `contribute_all` configs will have `contributionModel = null` after migration and are surfaced in the admin UI as "Contribution model needs configuration before next contribution."

### Fork creation and verification

When an admin first chooses `fork-pr`, the setup flow:

1. Prompts for the contributor's GitHub username (may differ from the username tied to the PAT if the PAT grants access to multiple accounts; normally the token owner).
2. Validates the token has `public_repo` scope and can read the contributor's account.
3. Checks whether `<contributorForkOwner>/<upstreamRepoName>` exists and is a fork of the upstream repo:
   - If it exists and is a fork: record it in `PlatformDevConfig`.
   - If it exists but is not a fork of upstream: fail with actionable error ("A repo by this name already exists under your account but is not a fork of the upstream. Rename it or delete it, then retry.").
   - If it does not exist: call `POST /repos/{upstreamOwner}/{upstreamRepo}/forks`, poll `GET /repos/{contributorForkOwner}/{repo}` until returned (typical 1–5s, documented upper bound 5 minutes), record in `PlatformDevConfig`.
4. Writes `forkVerifiedAt = now()`.

On every subsequent `contribute_to_hive` call:

- If `forkVerifiedAt` is within 24h, skip re-verification.
- Otherwise, re-check the fork exists and update `forkVerifiedAt`. If the fork has been deleted, surface an actionable error and require the admin to re-run setup.

### `github-api-commit.ts` — parameter split

Current `createBranchAndPR(...)` takes a single `owner` / `repo` pair and pushes + opens PR within that repo. The change splits these into **head** (where the branch lives) and **base** (where the PR opens against):

```typescript
interface CreateBranchAndPRParams {
  // Where the branch is pushed. For maintainer-direct, this equals base.
  // For fork-pr, this is the contributor's fork.
  headOwner: string;
  headRepo: string;

  // Where the PR is opened against. Always the upstream org/repo.
  baseOwner: string;
  baseRepo: string;
  baseBranch: string;  // typically "main"

  branchName: string;
  commitMessage: string;
  diff: string;
  prTitle: string;
  prBody: string;
  labels: string[];
  token: string;
}
```

PR creation body uses `head: "${headOwner}:${branchName}"` when `headOwner !== baseOwner` (cross-repo PR), otherwise bare `branchName`.

All existing callers pass `headOwner === baseOwner`; they continue to work without per-call changes beyond the new param names. The fork-pr caller passes distinct owners.

### `contribute_to_hive` — model dispatch

In [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) at the `contribute_to_hive` case, after the existing DCO + token + upstream URL resolution:

```typescript
const model = devConfig?.contributionModel ?? null;
if (model == null) {
  return { success: false, error: "Contribution model is not configured. …", message: "…" };
}

const { headOwner, headRepo } = (model === "fork-pr")
  ? { headOwner: devConfig.contributorForkOwner!, headRepo: devConfig.contributorForkRepo! }
  : { headOwner: upstreamMatch[1], headRepo: upstreamMatch[2] };

await createBranchAndPR({
  headOwner, headRepo,
  baseOwner: upstreamMatch[1], baseRepo: upstreamMatch[2], baseBranch: "main",
  branchName, commitMessage, diff, prTitle, prBody, labels,
  token: hiveToken,
});
```

All silent-failure hardening from PR #137 remains: missing DCO, missing token, fork-not-found, API error responses, and PR creation returning no URL each produce `success: false` with a specific `error` message.

### Token scope guidance

The admin UI (`PlatformDevelopmentForm.tsx`) updates its token help text per model:

- **`maintainer-direct`**: "This token needs `contents:write` on the upstream repo. Only maintainers of the OpenDigitalProductFactory org should use this mode."
- **`fork-pr`**: "This token needs the `public_repo` scope on your own GitHub account. It does **not** need access to the upstream repo — the platform will create a fork under your account the first time you contribute."

`validateGitHubToken` is extended to validate scope and ownership per model. For fork-pr mode it verifies the token owner's GitHub username matches `contributorForkOwner` (or allows explicit opt-out if using a machine user).

### Pseudonymity and the fork-account visibility tradeoff

In `maintainer-direct` the only public author identity is the commit/author line (`dpf-agent-<shortId>` plus the DCO `Signed-off-by`) and the PR title/body. The GitHub actor surfaced as the PR author is the upstream PAT owner — typically the maintainer — so that surface is already pseudonymous-to-the-maintainer's-choice.

In `fork-pr` the GitHub account owning the fork is publicly visible as the PR's head owner and as the PR author in the GitHub UI. No platform-side pseudonym can hide that. This spec takes the following position:

- The platform-generated author/committer identity (pseudonym) still applies to commit metadata.
- The contributor's GitHub **account** is necessarily visible. Contributors who want full anonymity must use a pseudonymous GitHub account (an account registered under a handle they are comfortable having on public PRs).
- The admin setup UI surfaces this explicitly: "Your GitHub username will be visible on every PR you contribute. If that is not acceptable, use a pseudonymous GitHub account for this install."

This is documented in [CONTRIBUTING.md](../../../CONTRIBUTING.md) under a new "Anonymous contribution" subsection.

### GitHub repo settings required

These are set on `OpenDigitalProductFactory/opendigitalproductfactory` and are prerequisites for this spec's runtime flow, not code changes:

| Setting | Value | Reason | Dependency |
|---------|-------|--------|------------|
| `allow_forking` | `true` | Fork flow requires the upstream to permit forks. Org policy blocks this on private repos. | Public flip |
| Secret scanning | enabled | Catches credentials that slip through `scanDiffForSecurityIssues` in outbound PR branches and in incoming human PRs. | Public flip (free only on public) |
| Push protection | enabled | Blocks known-provider secret pushes at the platform layer. | Public flip (free only on public) |
| Dependabot vulnerability alerts | enabled | Free on private and public. | Already enabled 2026-04-23 |
| Dependabot automated security fixes | enabled | Free on private and public. | Already enabled 2026-04-23 |
| `delete_branch_on_merge` | `true` | Contribution PRs create short-lived branches; auto-delete on merge keeps the fork tidy. | Already enabled 2026-04-23 |
| Branch protection on `main` | `Typecheck` + `Production Build` required; require PR; no force push; linear history | Enforces the PR workflow from [AGENTS.md](../../../AGENTS.md). | Public flip |
| DCO GitHub App | installed on the repo | Blocks incoming PRs that are missing `Signed-off-by`. Platform-originated PRs already include it; this enforces the same rule on human PRs. | Public flip + manual install via GitHub web UI |

### Migration path for existing installs

Existing installs that were set up before this spec will have:

- `contributionMode` set to `fork_only` / `selective` / `contribute_all` (as before).
- `contributionModel` = `null` (new column, unset).
- `upstreamRemoteUrl` pointing at the new org URL (already corrected 2026-04-23).

On platform deploy:

1. An admin-UI banner appears on `/admin/platform-development` when `contributionMode` is `selective` or `contribute_all` AND `contributionModel` is null. Copy: "A platform update requires re-configuring contribution mode before your next contribution. [Open setup]"
2. The setup flow prompts for `contributionModel`. Default selection is `fork-pr`. `maintainer-direct` is available behind a "Show advanced options" disclosure; choosing it requires re-entering the token (to validate the new scope requirements for that model).
3. `contribute_to_hive` refuses to run until `contributionModel` is set; it returns the same actionable error the banner describes.

Installs in `fork_only` mode are unaffected — they never call `contribute_to_hive` in a way that reaches the git layer.

### CONTRIBUTING.md additions

A new section documents the install-originated contribution flow for non-maintainer installs:

- How fork-pr mode works (fork created for you, branch pushed to your fork, PR opens to upstream).
- What token scope to use (`public_repo` on your account).
- The GitHub-account-visibility tradeoff and how to use a pseudonymous account if desired.
- The existing human-contributor fork→branch→PR flow is unchanged and still documented as the primary path.

## Implementation Phases

Phase boundaries map to PR boundaries per the PR-based workflow in [AGENTS.md](../../../AGENTS.md):

1. **Schema + migration** — add `contributionModel`, `contributorForkOwner`, `contributorForkRepo`, `forkVerifiedAt` to `PlatformDevConfig`. One PR.
2. **Fork setup flow** — admin UI: GitHub account prompt, fork existence check, fork creation, persistence. One PR.
3. **`github-api-commit.ts` param split** — head/base split; all existing callers updated; unit tests for cross-repo PR body shape. One PR.
4. **`contribute_to_hive` model dispatch** — model branching; silent-failure gates; integration tests with mocked GitHub API. One PR.
5. **Token validation per model + admin UI guidance copy** — scope validation, help text, tradeoff disclosure. One PR.
6. **Migration banner + re-setup guard** — existing-install banner, `contribute_to_hive` refusal on unset model. One PR.
7. **CONTRIBUTING.md + docs pass** — install-flow doc, pseudonymity-tradeoff doc. One PR.
8. **GitHub repo settings (post-public-flip)** — `allow_forking`, secret scanning + push protection, DCO app install, branch protection on `main`. Not a code PR; operational checklist.

## Open Questions

1. **Machine-user option**. Should the admin UI support a "use a separate machine user for the fork" flow — where the contributor creates a second GitHub account whose sole purpose is to host the install's fork? This improves pseudonymity at the cost of additional setup. Proposed default: no, document as an advanced pattern in CONTRIBUTING.md, revisit if usage grows.
2. **Fork staleness**. A fork left idle for months falls behind upstream. Should the platform auto-sync the fork's `main` to upstream's `main` before creating a contribution branch? Proposed default: yes, via `POST /repos/{fork}/merge-upstream` before each contribution; fail loudly if merge-upstream fails.
3. **Rate limits across many installs**. Each install's PAT has its own 5000/hr budget, so scaling is natural. Do we need an in-app rate-limit guard to avoid cascading retries hitting the same budget? Proposed default: no; GitHub returns `X-RateLimit-Remaining` on every response, and `createBranchAndPR` surfaces the limit in the error message when exceeded.
4. **`gh` CLI fallback**. The platform today uses the REST API directly (no `gh` dependency in the runtime image). Should fork-creation use `gh`? Proposed default: no — REST keeps the dependency surface small and is already how `createBranchAndPR` works.
