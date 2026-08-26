# Contributing to the Open Digital Product Factory

Thanks for wanting to contribute. This project is built to grow through community contributions — humans and AI coworkers working together. The workflow below is the supported path.

## TL;DR

1. Fork the repo, branch from `main`, and keep the change focused on one concern.
2. Run the local verification checklist (below) before opening a PR.
3. Commit with a DCO sign-off, then open a PR against `main` with a clear summary and test plan.
4. CI gates typecheck, unit tests, and a production build. Keep them green.
5. A maintainer reviews and merges once the checks pass.

External contributors always use fork → branch → PR. The maintainer uses the same workflow from topic branches named by intent (`clean/*`, `doc/*`, `feat/*`, `fix/*`, `chore/*`). The required CI checks (`Typecheck` and `Production Build`) must pass before merge; `Unit Tests` runs informationally while the broken-test surface is being cleaned up. GitHub branch protection activates automatically once the repo flips to public — until then, the workflow is maintained by discipline.

If you're contributing from a running DPF install, see [Contributing from a running install](#contributing-from-a-running-install).

## Branch naming

Use a short prefix that names the **intent**, not the issue number:

- `feat/<slug>` — new feature or capability
- `fix/<slug>` — bug fix or regression repair
- `chore/<slug>` — dependency bumps, build tooling, CI wiring
- `doc/<slug>` — documentation-only changes
- `clean/<slug>` — repo hygiene, dead-code removal, config cleanup
- `customer/<id>` — reserved for the future customer-branch contribution model; do not use for solo maintainer work

Scope a PR to what one reviewer can attribute and one revert can cleanly undo. Batch related work — every extra PR costs another serialized gate run. Split when a reviewer could not tell which lines did which job, when a revert would force a choice between two things you want independently revertible, or when one half is risky and the other is not.

## Repo bootstrap (contributors)

Once cloned, enable the in-repo git hooks so the Prisma migration guard runs locally:

```bash
git config core.hooksPath .githooks
```

`scripts/fresh-install.ps1` and `scripts/setup.ps1` / `scripts/setup.sh` configure this automatically when you use them to set the repo up. Run the one-liner above manually if you cloned without those helpers.

The pre-commit hook also scans the staged snapshot for secrets with the same pinned Gitleaks version used by CI. It downloads the pinned binary into Git's local cache when needed, then blocks the commit if the staged content contains secret-shaped material. Use `pnpm security:secrets:staged` to run the staged scan manually or `pnpm security:secrets` for a current-tree scan. `DPF_SKIP_SECRET_SCAN=1` exists only for verified false positives; CI still scans every PR.

### Setup on macOS / Linux

`bash scripts/setup.sh` is the canonical contributor bootstrap on macOS and Linux. It:

1. Verifies prerequisites (Docker, Node 20+, pnpm) and the host platform
2. Configures in-repo git hooks
3. Installs pnpm workspace dependencies
4. Generates `apps/web/.env.local` and root `.env` from examples (with portable in-place `sed` that works on both GNU and BSD `sed`, and `openssl` / `python3` secret generation)
5. Brings up the contributor compose stack (Postgres + Neo4j + Qdrant)
6. Waits for Postgres readiness and runs Prisma migrations + seed
7. Verifies the agent rulebook (AGENTS.md + pointer files) is intact

VS Code tasks under `.vscode/tasks.json` carry `osx` and `linux` overrides for every task that has a Windows form, so `Cmd+Shift+P → Tasks: Run Task → DPF: <X>` works on macOS and Linux out of the box. The release-script tasks now have bash equivalents (`dpf-release.sh`, `dpf-start.sh`, `dpf-stop.sh`, `dpf-reinstall.sh`) so every Windows-side dpf-* task has a macOS / Linux sibling.

What's intentionally NOT in `scripts/setup.sh`:

- **Docker / Node / pnpm installation.** Manual prereqs per the contributor contract. Fully-automated host bootstrap is `install-dpf.sh`'s job — the end-user installer that auto-installs Docker Desktop (macOS) or Docker Engine (Linux), runs preflight, brings up the platform-aware compose stack, and registers the autostart unit. See [docs/install/macos.md](docs/install/macos.md) and [docs/install/linux.md](docs/install/linux.md).
- **LLM provider configuration.** The provider contract (Doctrine [Contract 9](docs/superpowers/specs/2026-05-09-deployment-contracts.md)) is provider-aware: Docker Model Runner on macOS Docker Desktop, Ollama-in-compose on Linux native Docker (`docker-compose.linux.yml`), or any external endpoint via `LLM_BASE_URL`.
- **Auto-start, hardware detection, `install-state.json`, `dpf doctor`.** Those are `install-dpf.sh` territory.

If you'd rather develop entirely inside a container regardless of host OS, the [`.devcontainer/devcontainer.json`](.devcontainer/devcontainer.json) is fully cross-platform — open the repo in VS Code with the Dev Containers extension and choose "Reopen in Container".

## Before you start

- Have an install running. See the repo [README](README.md) Quick Start (Windows / macOS / Linux installers all covered there) or [docs/user-guide/contributing/developer-setup.md](docs/user-guide/contributing/developer-setup.md) for the native pnpm + Docker sidecar setup.
- Read the [architecture overview](docs/architecture/platform-overview.md) and the [Trusted AI Kernel architecture](docs/architecture/trusted-ai-kernel.md) before proposing AI-facing changes.
- Check the issue tracker for open discussions before starting non-trivial work.

## Local verification checklist

Run these before opening a PR:

```bash
pnpm typecheck          # TypeScript across all workspaces
pnpm security:secrets  # Current-tree Gitleaks scan using the pinned local runner
pnpm test               # Vitest unit tests (web + db + mobile)
pnpm --filter web build # Production Next.js build — surfaces errors the dev server hides
```

End-to-end tests are optional for most PRs but expected for user-flow changes:

```bash
pnpm test:e2e           # Playwright against a running portal
pnpm test:e2e:demo      # Sandbox-preview demo profile
```

### Local build capacity precedence

Local model capacity is shared by contributor verification, Build Studio, and AI coworkers. Data-sensitivity constraints are applied first. For routed build phases, a user-configured provider takes precedence over the bundled local provider. While an exact local-CI run holds the on-box capacity lease, local Build Studio and coworker inference defer and retry instead of competing with verification or reporting the provider as broken.

Configure provider choices in **Admin > AI Workforce > Providers & Routing**; do not edit seed data to change routing. See [Connecting AI providers](docs/user-guide/ai-workforce/connecting-providers.md#local-capacity-during-platform-verification) for the operator-facing behavior.

## Pull request expectations

- **Scope:** one clean revert per PR. Batch related work; split when the diff would be unattributable or the revert would force an unwanted choice.
- **Commits:** write them in imperative mood (`add`, `fix`, `move`, `remove`). Conventional-commit prefixes (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`) are used across the existing history. Every commit must include a DCO `Signed-off-by:` trailer; use `git commit -s`.
- **Tests:** new features need Vitest coverage. Bug fixes need a regression test that fails before the fix and passes after.
- **Docs:** if you change behavior, update the doc that describes it. Most user-facing docs live under [docs/user-guide/](docs/user-guide/).
- **Migrations:** new Prisma migrations are committed alongside the schema change. Do not edit migrations that are already on `main`.
- **AI coworker changes:** if the change touches the Trusted AI Kernel — routing, enforcement, audit, or immutable directives — link the relevant architecture section in the PR body.

## Code standards

- TypeScript strict mode, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- Server actions, React cache, and auth gates follow the patterns already in the codebase. Don't invent parallel patterns for the same job.
- Keep new comments to the why, not the what. Remove comments that describe what well-named identifiers already communicate.
- No emojis in source code, commit messages, or comments unless specifically requested.
- Shell scripts use LF line endings (enforced by `.gitattributes`). PowerShell scripts target Windows 10/11 with PowerShell 5.1+ and use plain ASCII.

## Reporting problems

- **Bugs:** open an issue using the bug template. Include the installer mode you used, your OS, the Docker Desktop version, and relevant logs.
- **Security vulnerabilities:** do **not** open a public issue. Follow the process in [SECURITY.md](SECURITY.md).
- **Feature requests:** use the feature template. Start by describing the problem you're trying to solve, not the implementation you have in mind.

## Contributing from a running install

DPF installs can ship features built in Build Studio back to the upstream repo through the platform's own contribution pipeline — fork, branch, commit, and PR all happen automatically once GitHub auth is configured once in Admin > Platform Development. This is distinct from the manual fork → branch → PR flow documented above, which remains the supported path for human contributors who don't run a DPF install.

The setup below applies to anyone whose contributions originate from a running install (Build Studio features, hive contributions, scripted automation). The choice of tier determines only how the install authenticates to GitHub — the resulting PRs look identical from the upstream side.

### Three setup tiers

| Tier | Method | When to choose |
|------|--------|----------------|
| **1** | OAuth Device Flow (recommended) | Default. One-click in Admin > Platform Development. GitHub handles 2FA inline. No token to manage. |
| **2** | Fine-grained PAT (advanced) | Policy-restricted environments; per-repo scope limits required. |
| **3** | Classic PAT (emergency) | Air-gapped installs; legacy machine users; environments where browser-based OAuth isn't possible. |

### Tier 1 — OAuth Device Flow

1. Open Admin > Platform Development in your DPF install.
2. Click **Connect GitHub**.
3. The platform displays a short user code (e.g. `WDJB-MJHT`) and a verification URL (`github.com/login/device`).
4. Open the URL in a browser where you're already signed in to GitHub. Type the user code, click Authorize.
5. If you have 2FA enabled, GitHub handles the challenge inline.
6. The platform polls in the background; when authorization completes, the form shows "Connected as @username".

Notes:

- Token has no expiry. Revocable any time at github.com/settings/applications.
- Scope: `public_repo` only. The platform never requests broader access.
- The token is encrypted at rest in your install's database.

### Tier 2 — Fine-grained PAT

1. Visit github.com/settings/personal-access-tokens.
2. Click **Generate new token (fine-grained)**.
3. Configure:
   - **Expiration:** 90 days or longer (the platform refuses tokens with less than 30 days left)
   - **Repository access:** Only your fork (or the repo you're contributing to)
   - **Permissions → Contents:** Read and Write
4. Generate. Copy the token (starts with `github_pat_`).
5. In Admin > Platform Development, expand the **Advanced** disclosure.
6. Paste into the **Fine-grained PAT** field. Save.

The platform reads the expiry from the GitHub probe response and surfaces an admin banner at 30/14/7 days remaining. Reconnect via Tier 1 or rotate the PAT before it expires.

### Tier 3 — Classic PAT (emergency only)

Classic PATs have no expiry and grant broad scope across every repo the account can reach. Prefer Tier 1 (no token to manage) or Tier 2 (per-repo scope) wherever possible. Use Tier 3 only when neither alternative is available — air-gapped installs without browser access, or legacy machine users that predate fine-grained PAT support.

If you do need it, the steps mirror Tier 2 but at github.com/settings/tokens with `public_repo` scope, and pasted into the **Classic PAT** field in the same Advanced disclosure.

### Pseudonymity tradeoff

Install-based contributions carry two identities, and only one of them is hideable.

- **Commit identity is pseudonymous.** Every commit is authored as `dpf-agent-<shortId>` (a stable per-install pseudonym) and carries a matching DCO `Signed-off-by` trailer. Two installs are distinguishable in commit history without revealing the human behind either.
- **PR author identity is the GitHub account that authorized auth.** The fork owner is necessarily visible on github.com — whichever account authorized the OAuth App or owns the PAT shows up as the PR author. No platform-side mechanism can hide this; it's how GitHub displays PRs from forks.

If your GitHub username can't appear on public PRs, authorize from a pseudonymous GitHub account (a separate account registered under a handle you're comfortable seeing on public PR pages). 2FA is required on that account too once GitHub's June 2026 mandate takes effect.

This is the same tradeoff documented in the spec at `docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md` §Pseudonymity, and the matching admin-UI copy lives in `apps/web/lib/integrate/contribution-copy.ts` (`CONTRIBUTION_COPY.pseudonymityTradeoff`).

### Machine-user pattern

For organizations that want a dedicated identity for their install's contributions — separate from any individual employee's GitHub account — the recommended pattern is a machine user. Create a separate GitHub account (e.g. `acme-dpf-bot`), enable 2FA on it (required by the June 2026 mandate just like any human account), and either authorize Tier 1 from that account or mint a Tier 2/3 PAT under it. To GitHub it's just another user account; the platform doesn't need to know it's a machine user.

The pre-existing **"I am using a dedicated machine-user GitHub account"** checkbox in the admin UI (shipped in PR #225) skips the "token-owner must match fork-owner" check when this pattern is in use, so the machine user can contribute on behalf of an organization-owned fork without tripping ownership validation.

### Troubleshooting

- **"Token revoked" error:** You revoked the OAuth App authorization at github.com/settings/applications, or the token was deleted. Reconnect via Admin > Platform Development.
- **"Token expires in X days" banner:** Tier 2 only. Either reconnect via Tier 1 (Device Flow has no expiry) or generate a fresh fine-grained PAT.
- **"This token can't access the fork repo" error:** Fine-grained PAT doesn't include the target repo or lacks Contents:Read+Write. Regenerate per the Tier 2 steps.
- **"Wrong scope" error on classic PAT:** Token needs `public_repo` (or `repo` for private repos, though DPF only contributes to public). Regenerate with the right scope.

## License

By submitting a pull request you agree your contribution is your original work and accept the [Developer Certificate of Origin](https://developercertificate.org/). All contributions are licensed under the project's [Apache License 2.0](LICENSE).
