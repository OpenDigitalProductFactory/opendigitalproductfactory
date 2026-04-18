# Contributing to the Open Digital Product Factory

Thanks for wanting to contribute. This project is built to grow through community contributions — humans and AI coworkers working together. The workflow below is the supported path.

## TL;DR

1. Fork the repo, branch from `main`, and keep the change focused on one concern.
2. Run the local verification checklist (below) before opening a PR.
3. Open a PR against `main` with a clear summary and test plan.
4. CI gates typecheck, unit tests, and a production build. Keep them green.
5. A maintainer reviews and merges once the checks pass.

External contributors always use fork → branch → PR. The maintainer uses the same workflow from topic branches named by intent (`clean/*`, `doc/*`, `feat/*`, `fix/*`).

## Before you start

- Have an install running. See the repo [README](README.md) Quick Start for the Windows installer, or [docs/user-guide/getting-started/developer-setup.md](docs/user-guide/getting-started/developer-setup.md) for the native pnpm + Docker sidecar setup.
- Read the [architecture overview](docs/architecture/platform-overview.md) and the [Trusted AI Kernel architecture](docs/architecture/trusted-ai-kernel.md) before proposing AI-facing changes.
- Check the issue tracker for open discussions before starting non-trivial work.

## Local verification checklist

Run these before opening a PR:

```bash
pnpm typecheck          # TypeScript across all workspaces
pnpm test               # Vitest unit tests (web + db + mobile)
pnpm --filter web build # Production Next.js build — surfaces errors the dev server hides
```

End-to-end tests are optional for most PRs but expected for user-flow changes:

```bash
pnpm test:e2e           # Playwright against a running portal
pnpm test:e2e:demo      # Sandbox-preview demo profile
```

## Pull request expectations

- **Scope:** one concern per PR. Refactors that ride along with a feature change are fine only if they're genuinely entangled.
- **Commits:** write them in imperative mood (`add`, `fix`, `move`, `remove`). Conventional-commit prefixes (`feat(...)`, `fix(...)`, `docs(...)`, `chore(...)`) are used across the existing history.
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

## License

By submitting a pull request you agree your contribution is your original work and accept the [Developer Certificate of Origin](https://developercertificate.org/). All contributions are licensed under the project's [Apache License 2.0](LICENSE).
