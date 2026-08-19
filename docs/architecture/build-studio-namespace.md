# Build Studio Component Namespace

Status: standard (BI-ARCH-BUILDSTUDIO-NS, EP-PLATFORM-CONSOLIDATION)
Spec: [`docs/superpowers/specs/2026-06-25-platform-consolidation-spine-design.md`](../superpowers/specs/2026-06-25-platform-consolidation-spine-design.md) §6.4

There is **one production Build Studio component namespace: `apps/web/components/build`.**
Build plans, the build agent's generated file paths, tests, and docs all point there.

`apps/web/components/build-studio` is a **quarantined prototype** — a chat-first "V2"
shell (HeaderBar / ConversationPane / ArtifactPane / cards) last touched 2026-05-10. It is
reachable only via the dev-only `/build?v=2` query param and renders largely demo data. It
is **not** a build target and **not** the production surface. Its disposition (graduate
into `components/build`, or retire) is an open operator decision the spec flagged; until
then it is frozen, not grown.

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
- **Footprint freeze.** [`scripts/check-build-namespace.mjs`](../../scripts/check-build-namespace.mjs)
  (CI job `Build Studio Namespace Guard`) fails if any NEW production file imports
  `@/components/build-studio` beyond the two known, frozen importers
  (`app/(shell)/build/page.tsx`'s `?v=2` branch and `lib/build-studio-demo.ts`). New Build
  Studio UI must land in `components/build`.

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
