# Build Studio Component Namespace

Status: standard (BI-ARCH-BUILDSTUDIO-NS, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.4

There is **one production Build Studio component namespace: `apps/web/components/build`.**
Build plans, the build agent's generated file paths, tests, and docs all point there.

`apps/web/components/build-studio` was a chat-first "V2" prototype shell
(HeaderBar / ConversationPane / ArtifactPane / cards) reachable via the `/build?v=2` query
param and rendering largely demo data. It is **RETIRED** as of BI-101C107C: the directory,
the `?v=2` route branch, and `lib/build-studio-demo.ts` are deleted. The disposition the
spec flagged as an open operator decision — graduate or retire — is now settled as retire,
sequenced by kernel consult `DI-BCC92F9AFC08`.

The prototype survived roughly four months past the 2026-07-31 owner-change-convergence
plan that scheduled its removal (Phase C). The freeze guard below is why it could: it
capped the prototype's footprint but had no mechanism to require its removal, so a
quarantine with no expiry read as permanent tolerance.

## Why this matters

The `/build` route importing two production-adjacent shells was, per the spec, a
"high-risk area for new WIP divergence": new work could land in either namespace, build
plans could target either, and the two could drift. The risk is neutralized by making the
production namespace singular and enforcing it.

## Enforcement

- **Plan-path convergence.** `apps/web/lib/build/build-plan-paths.ts` rewrites any
  agent-generated `components/build-studio/*` path onto `components/build/*` (a folder
  fallback plus three legacy exact aliases). `build-plan-paths.test.ts` asserts arbitrary
  build-studio paths converge — so a model that picks the wrong namespace is corrected
  before the build runs.
- **Retirement.** [`scripts/check-build-namespace.mjs`](../../scripts/check-build-namespace.mjs)
  (CI job `Build Studio Namespace Guard`) fails if `components/build-studio` reappears at
  all, or if any production file imports it. The allowed-importer set is empty and must
  stay empty. New Build Studio UI must land in `components/build`.
- **Surface ratchet.** [`scripts/check-build-studio-surface-budget.mjs`](../../scripts/check-build-studio-surface-budget.mjs)
  (CI job `Build Studio Surface Guard`, BI-101C107C) holds `components/build` to a
  shrink-only component-count and non-test-LOC budget against an owned, expiring baseline.
  Between 2026-04 and 2026-08 that surface grew 8 -> 74 components across 39 specs and 28
  plans with exactly one deletion, because every UX gate was a presence check. A
  "simplification" that adds net lines now fails.

## Legacy plan-path aliases — intentionally retained

`LEGACY_BUILD_STUDIO_PATH_ALIASES` / `LEGACY_BUILD_STUDIO_TEXT_ALIASES` in
`build-plan-paths.ts` map three pre-refactor component names
(`BuildWorkspace`/`WorkflowGraphPanel`/`DetailsPreviewPanel`) onto current
`components/build` files. Modern plan generation never emits these (the build agent prompt
only references `components/build`), but **historical build plans persisted in the DB
still can**, so the aliases stay as defensive normalization. They can be removed once a
sweep confirms no stored plan references the old names.

## Recommended follow-up (operator decision)

Retire the `components/build-studio` prototype (and its `/build?v=2` access) or graduate
its chat-first ideas into `components/build`. Either way the production namespace is
already singular and enforced; this is a cleanup of dead/quarantined code, not a
divergence risk.
