---
title: Test in the portal build, not just in unit tests
pageKind: principle
status: published
abstract: Unit tests against mocked dependencies prove the code shape; only a portal build exercising migrations, seed, build artifacts, and the rendered route proves the platform works. Don't claim "it works" without the build gate.
principleTier: commandment
principleDirection: Prefer evidence from a portal build over evidence from unit tests with mocked dependencies.
principleDimensionVector: {"evidence_density": 1.0, "blast_radius": -0.7, "long_term_maintainability": 0.5, "speed_to_value": -0.3}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
  - build-studio
principlePublic: false
principlePublicRationale: ""
sources:
  - articles/think-twice-ea-platform-servicenow
---

## Rule

Before claiming a feature works, exercise it through the portal build that operators actually deploy. Unit tests with mocked Prisma clients, mocked inference, or mocked retrieval prove the code's shape — they do not prove that migrations apply, that the seed produces rows, that the Next.js build emits the right routes, or that the rendered HTML carries the user-visible content. Don't conflate the two.

## Applies To

In-platform coworkers and external coding agents. The build gate per AGENTS.md §5 is the platform's defined threshold for "done" — `pnpm --filter web build` plus the seed run plus a real DB query against the result. Agents must clear that gate themselves whenever the sandbox supports it; when it doesn't, they must name exactly what's missing rather than claim verification they did not perform.

## Why

DPF's failure mode for unverified work is silent. The seed walker handles a missing kernel directory as a typed empty-result. The docker entrypoint swallows non-zero seed exits with `|| echo "WARN ..."`. The `/wiki` page renders an empty list when no rows exist. None of these surfaces produce an obvious error — they degrade quietly, and the operator only notices when they open the portal and see nothing. By that point the agent has already shipped multiple PRs claiming success.

Mocked unit tests do not catch this class of bug. They assert what the code does in isolation; they never run the seed, never build the Next.js app, never serve the route. The only signal that flushes silent degradation is the build gate. An agent that skips it accepts the gap.

## How To Apply

Before claiming a feature is complete:

1. **Stand up the dependencies.** Postgres + Qdrant + embedding endpoint as the deployment uses them, or the closest in-sandbox equivalents.
2. **Run the migrations.** `pnpm --filter @dpf/db exec prisma migrate deploy` against a fresh DB and again against one with prior data; both must apply cleanly.
3. **Run the seed.** Confirm row counts match the source-of-truth markdown.
4. **Build the portal.** `pnpm --filter web build`. Inspect the route manifest for the routes the feature ships.
5. **Start the production server.** `node .next/standalone/apps/web/server.js`, mint a session if needed, curl the affected routes, grep the rendered HTML for the content under test.
6. **Report what you saw.** Status code, byte count, presence of the expected slugs / titles in the response.

If a step is impossible (no Docker, no third-party credentials, no production access), name precisely what's missing in the same message that claims partial completion. Never substitute mocked tests for portal evidence and call it done.

## Decision Dimensions

- `evidence_density: 1.0` — the strongest pull. The principle is about real evidence over inferred evidence.
- `blast_radius: -0.7` — pulls toward options that contain blast radius. A feature claimed-done-via-mocks but broken-in-deployment radiates failure through every downstream system that depends on it (the Phase 5 kernel-content PR cascade is exactly that pattern).
- `long_term_maintainability: 0.5` — moderate positive. Portal-build tests catch regressions across the full integration surface, where mocked tests cover only a fraction of it.
- `speed_to_value: -0.3` — modest concession. A portal build is slower than a unit test run. The principle accepts that cost because the alternative (silent degradation, repeated rework, eroded operator trust) is more expensive.

## Examples

- **Positive:** An agent ships a fix to a seed pipeline. Before opening the PR it (a) stands up Postgres in the sandbox, (b) runs the migrations, (c) executes the seed, (d) counts rows in the resulting tables, (e) runs `next build`, (f) starts the standalone server, (g) curls `/wiki` with a minted session cookie, (h) greps the HTML for the slugs it expects, (i) includes that transcript inline in the PR description. Operator merges with high confidence.
- **Counterexample:** An agent ships kernel content as markdown files in git, claims "Phase 5 content shipped" based on a passing seed-walker unit test, and never notices that the container image is missing `COPY docs/founder-kernel/`. The portal sits empty across multiple deployments while the agent ships follow-on PRs that all depend on that broken-but-presumed-working foundation.
- **Counterexample:** An agent runs `vitest` and reports "198 tests pass" as the verification line in a PR, when `next build` was within reach and would have caught a type error in a server component. The mocked tests covered the unit; the portal build would have covered the integration.

## When this does not apply

- Pure-text contributions (documentation, spec edits, prose changes) that don't touch runtime code.
- Sandbox limitations the agent genuinely cannot work around — but those require an explicit "I can't because Y" diagnosis, never a substitution of mocked tests for missing portal evidence.

## See also

- Companion principle: `[[principles/do-the-work-dont-task-the-operator]]` — testing in the portal build is one of the highest-value tasks an agent can absorb rather than punt back.
- Related stance: `[[stances/trust-the-cmdb-or-rebuild-it]]` — same family of failure mode: a system whose output you can't trust is technical debt that compounds.
