# Capability-Driven Runtime Profiles Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make install, upgrade, health, backup, and diagnostics derive service requirements from one capability-aware substrate projection so disabled optional services never make an installation unhealthy.

**Architecture:** Preserve the spec's split authorities: `PlatformSubstrateManifest` owns service topology facts, while `PlatformCapability.manifest` owns product capability identity, dependencies, and live state. A compiler joins those authorities by stable capability key into a versioned service catalog; each install resolves that catalog using persisted enabled keys plus the live PostgreSQL capability state. One lifecycle service owns enable/disable, drain enforcement, persistence, and rollback; install, upgrade, restart, backup, diagnostics, and both health surfaces consume its resolved projection rather than rebuilding service lists.

**Tech Stack:** Node.js ESM, JSON manifests, Docker Compose profiles, Next.js 16/React, TypeScript, Vitest, Node test runner, PowerShell 5.1+, POSIX shell.

---

## Chunk 1: Canonical capability and service projection

### Task 1: Define the runtime capability manifests in the canonical capability model

**Files:**
- Modify: `scripts/platform-substrate-manifest.json`
- Create: `packages/db/data/platform-runtime-capabilities.json`
- Modify: `packages/db/src/sync-capabilities.ts`
- Modify: `packages/db/src/sync-capabilities.test.ts`
- Modify: `docs/architecture/platform-substrate-boundaries.md`
- Test: `scripts/measure-platform-substrate.test.mjs`

- [ ] **Step 1: Add failing sync tests** proving runtime capability rows use stable IDs (`runtime:core`, `runtime:build`, `runtime:browser-automation`, `runtime:durable-automation`, `runtime:local-speech`, `runtime:deep-observability`, `runtime:adp-integration`, `runtime:development`, `runtime:external-ai`), preserve an operator-controlled `state`, and write dependencies/activation policy under `PlatformCapability.manifest.runtime`.
- [ ] **Step 2: Run `pnpm --filter @dpf/db exec vitest run src/sync-capabilities.test.ts`** and expect failure because runtime capability rows are absent.
- [ ] **Step 3: Seed runtime capability manifests through `sync-capabilities.ts`.** The checked-in JSON is deploy seed input; after sync, PostgreSQL `PlatformCapability.manifest` is the live authority. Updates must merge definition metadata without resetting live `state` on existing rows.
- [ ] **Step 4: Upgrade the substrate manifest to version 2** only to replace service-local pseudo-capability names with stable `runtime:*` binding keys. It continues to own ports, volumes, profiles, backup policy, health semantics, host support, and boundary class—never capability dependencies or enabled state.
- [ ] **Step 4: Classify target topology without falsifying current activation.** Only PostgreSQL, portal initialization, and portal are target universal core. Existing always-on build, browser, speech, execution, and telemetry services become `capability-activated`, but `defaultRequired` continues to mirror their current no-profile Compose activation until Task 4 adds capability profiles; no container is deleted in this slice.
- [ ] **Step 5: Add join validation tests**: missing capability row, unknown substrate binding, conflicting duplicate binding, and mismatched stable key must fail with `missing_capability:<key>`, `unknown_service_binding:<service>`, or `duplicate_service_binding:<service>`.
- [ ] **Step 6: Document the split authority and transition semantics** in `platform-substrate-boundaries.md`.
- [ ] **Step 7: Re-run both sync/manifest suites and `pnpm check:substrate`;** expect green join validation and any reduced default-service measurement reported as an improvement, not silently rebased.
- [ ] **Step 8: Commit** with `git commit -s -m "refactor(substrate): bind services to canonical capabilities"`.

### Task 2: Build the deterministic projection compiler

**Sequencing decision:** Task 2's fail-closed cross-capability dependency validation exposed that `portal` still hard-required the optional browser-automation and durable-automation services. The narrow Task 4 prerequisite that removes those two `depends_on` edges from Compose and the substrate manifest is therefore completed with Task 2. No capability profiles or other Task 4 activation behavior are pulled forward.

**Files:**
- Create: `scripts/lib/capability-service-projection.mjs`
- Create: `scripts/lib/capability-service-projection.test.mjs`
- Create: `scripts/compile-capability-service-catalog.mjs`
- Create: `scripts/capability-service-catalog.generated.json`
- Modify: `package.json`

- [ ] **Step 1: Write five failing fixtures** named `core`, `build`, `local-speech`, `deep-observability`, and `external-ai`. Each supplies substrate records, canonical `PlatformCapability.manifest` rows, and enabled states; assert stable dependency closure, Compose profiles, required services, backup services, health requirements, and external runtimes.
- [ ] **Step 2: Add failing cycle, unknown-key, and duplicate-service fixtures.** The compiler must fail closed with a path such as `a -> b -> a`.
- [ ] **Step 3: Implement a pure join/resolver** that accepts substrate records, canonical capability manifests/states, and persisted install keys. It returns a stable resolved projection with catalog version/hash, capability-state version, `requiredServices`, `inactiveOptionalServices`, `externalRuntimes`, `composeProfiles`, `backupServices`, and per-service requirement records. Missing/conflicting authorities fail closed.
- [ ] **Step 4: Implement the compiler CLI** and checked-in *catalog* (all valid bindings, not one install's enabled state). Add `compile:capability-services` and `check:capability-services`; check mode must fail with `stale_capability_service_catalog` when generated bytes differ.
- [ ] **Step 5: Define runtime persistence:** `install-state.json.enabledRuntimeCapabilities` is the restart/rollback snapshot; PostgreSQL `PlatformCapability.state` is the post-bootstrap live authority. Both carry the catalog hash and the deterministic state hash defined in Task 3. Startup recomputes the hash from sorted DB states and returns `capability_state_stale` on mismatch. Only the governed transition saga changes enabled keys; upgrades carry the snapshot unchanged and rollback restores the recovery point's snapshot.
- [ ] **Step 6: Run `pnpm exec node --test scripts/lib/capability-service-projection.test.mjs`** and both compiler modes; expect all five fixtures green, `a -> b -> a` reported for the cycle fixture, and a byte-for-byte clean regeneration.
- [ ] **Step 7: Commit** with `git commit -s -m "feat(substrate): compile capability service catalog"`.

### Task 3: Protect capability deactivation with a drain decision

**Execution checkpoint (2026-07-17):** Steps 1-3 are implemented as the closed guard vocabulary, exact live-work attribution adapter, and pure drain decision. Steps 4-12 remain the durable receipt, coordinator/promoter protocol, atomic host apply/recovery, focused verification, and final Task 3 commit; the portal must not expose capability mutation until those remaining steps land together.

**Files:**
- Modify: `scripts/lib/capability-service-projection.mjs`
- Modify: `scripts/lib/capability-service-projection.test.mjs`
- Create: `apps/web/lib/platform-runtime/capability-transition.ts`
- Create: `apps/web/lib/platform-runtime/capability-transition.test.ts`
- Create: `apps/web/lib/platform-runtime/work-attribution.ts`
- Create: `apps/web/lib/platform-runtime/work-attribution.test.ts`
- Create: `apps/web/lib/actions/runtime-capabilities.ts`
- Create: `apps/web/lib/actions/runtime-capabilities.test.ts`
- Create: `apps/web/lib/platform-runtime/transition-coordinator.ts`
- Create: `apps/web/lib/platform-runtime/transition-coordinator.test.ts`
- Modify: `apps/web/lib/self-upgrade/promoter.ts`
- Modify: `apps/web/lib/self-upgrade/promoter.test.ts`
- Modify: `docker-compose.yml`
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_runtime_capability_transition/migration.sql`
- Create: `scripts/apply-runtime-capability-transition.mjs`
- Create: `scripts/apply-runtime-capability-transition.test.mjs`

- [x] **Step 1: Extend canonical runtime capability manifests with closed `workGuards` keys.** Supported keys are `build-studio-active`, `task-run:<source>`, and `work-capsule:<source>`; arbitrary Prisma filters are forbidden. Add red tests proving unknown guards fail sync and every non-core executable capability declares its guards.
- [x] **Step 2: Write failing attribution tests** for exact live states: TaskRun `submitted|working|input-required|auth-required|quiescing`, non-abandoned FeatureBuild phases before `ship`, and WorkCapsule `claimed|working|review|blocked`. Assert unrelated sources/terminal states do not block and every declared guard is queried.
- [x] **Step 3: Write failing pure transition tests** showing that disabling a capability with attributed queued/running work returns `{ status: "drain_required" }`, names blocking counts, and leaves the current projection active.
- [ ] **Step 4: Add `RuntimeCapabilityTransition` as the durable saga receipt** with previous/desired sorted key sets, previous/desired deterministic state hashes, catalog hash, status, host receipt, failure, timestamps, and one-active-transition partial unique index. `capabilityStateVersion` is precisely `sha256(catalogHash + "\n" + sorted(capabilityId + "=" + state).join("\n"))`; it is derived, never separately incremented.
- [ ] **Step 5: Write saga tests** for serialization, `drain_required`, promoter unavailable, host apply failure, portal restart after host receipt, DB commit failure, and compensation failure. A second transition must return `transition_in_progress`; a blocked transition must not launch a promoter.
- [ ] **Step 6: Extend the existing universal-core promoter boundary, not the optional queue.** `transition-coordinator.ts` runs in the portal core and launches the sibling promoter directly through the already-governed Docker socket using a new `--runtime-capability-transition` mode in `buildPromoterCommand`. Optional queues may request the action but never execute it. The promoter remains alive when Redis/Inngest/browser/speech/telemetry services stop.
- [ ] **Step 7: Define the least-privilege container/host protocol:** mount `${DPF_STATE_DIR}` read-write only at `/dpf-state` in the one-shot promoter (source remains read-only); pass a transition ID, expected catalog/state hashes, desired sorted keys, and HMAC over that envelope via fixed argv/env; reject mismatched/expired/replayed IDs. Use the existing deterministic container name, 10-minute timeout, Docker-socket boundary, and explicit Compose project/files. The promoter writes `/dpf-state/runtime-capability-transitions/<id>.json` atomically as the idempotent receipt.
- [ ] **Step 8: Implement one governed transition saga:** the portal coordinator creates the durable request under a DB advisory lock, rechecks work, launches the promoter, verifies the signed host receipt and required health, then transactionally updates `PlatformCapability.state`, audit, and the transition receipt. On post-host failure it launches the same promoter mode with the stored previous snapshot and records `rolled_back` or `rollback_failed`.
- [ ] **Step 9: Make the host apply script atomic at its boundary:** write a sibling temporary install-state file, validate schema/hash, replace the persisted file, reconcile profiles, and return before/after hashes plus observed services. An idempotent retry returns the existing matching receipt. On failure restore the previous file/profile closure. Portal startup runs `reconcileRuntimeCapabilityTransitions()` before accepting new transitions; a pending row plus successful host receipt completes the DB commit, while absent/failed receipt triggers compensation.
- [ ] **Step 10: Add coordinator/promoter tests** proving a core-only install can enable a capability, disabling `runtime:durable-automation` completes after its services stop, unrelated work does not block, dependent work cannot be missed, replay/tamper is rejected, and crash recovery aligns DB, install state, observed services, and audit receipt.
- [ ] **Step 11: Run `pnpm --filter web exec vitest run lib/platform-runtime/work-attribution.test.ts lib/platform-runtime/capability-transition.test.ts lib/actions/runtime-capabilities.test.ts lib/platform-runtime/transition-coordinator.test.ts lib/self-upgrade/promoter.test.ts` and `pnpm exec node --test scripts/apply-runtime-capability-transition.test.mjs`.**
- [ ] **Step 12: Commit** with `git commit -s -m "feat(substrate): govern capability runtime transitions"`.

## Chunk 2: Operational consumers and Compose activation

### Task 4: Make Compose profiles match capability activation

**Files:**
- Modify: `docker-compose.yml`
- Create: `scripts/check-capability-compose-profiles.mjs`
- Create: `scripts/check-capability-compose-profiles.test.mjs`
- Create: `scripts/fixtures/capability-profiles/core.env`
- Create: `scripts/fixtures/capability-profiles/build.env`
- Create: `scripts/fixtures/capability-profiles/local-speech.env`
- Create: `scripts/fixtures/capability-profiles/deep-observability.env`
- Create: `scripts/fixtures/capability-profiles/external-ai.env`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/install/platform-support-watchlist.md`

- [ ] **Step 1: Write failing topology tests** named `rejects_default_started_optional_service`, `resolves_each_fixture_dependency_closure`, and `preserves_special_profile_semantics`; compare every substrate binding with its Compose profile and reject default-start optional services.
- [ ] **Step 2: Add capability profiles** to build sandbox, browser automation, durable automation, local speech, and deep-observability services. Preserve existing test/development/separate-distribution profiles and dependency conditions.
- [ ] **Step 3: Keep `portal` dependencies core-only.** Optional services must not be `depends_on` requirements for the portal; their clients must tolerate inactive capability state.
- [x] **Narrow prerequisite (completed during Task 2):** remove the portal's hard `browser-use` and `inngest` edges from Compose and the synchronized substrate manifest. Full profile activation remains pending in this task.
- [ ] **Step 4: Add a CI guard** using a filtered, source-only Node command.
- [ ] **Step 5: Add any newly discovered cross-platform profile caveat** to the watchlist, with Windows/macOS/Linux behavior explicit.
- [ ] **Step 6: Run `pnpm exec node --test scripts/check-capability-compose-profiles.test.mjs`** and expect all fixture/compatibility cases green.
- [ ] **Step 7: Render Compose with controlled fixtures:** on Windows run `docker compose --env-file scripts/fixtures/capability-profiles/<fixture>.env config --services`; run the identical command under the macOS/Linux installer harness for `core`, `build`, `local-speech`, `deep-observability`, and `external-ai`. Expected service sets must match the resolver bytes; unavailable optional services must not affect the `core` exit code.
- [ ] **Step 8: Commit** with `git commit -s -m "refactor(compose): activate services by capability"`.

### Task 5: Give install and upgrade one profile-selection adapter

**Files:**
- Create: `scripts/lib/resolve-capability-compose-profiles.mjs`
- Create: `scripts/lib/resolve-capability-compose-profiles.test.mjs`
- Modify: `scripts/installer/install-state.schema.json`
- Modify: `scripts/installer/lib/state.sh`
- Modify: `scripts/installer/lib/state.ps1`
- Modify: `scripts/installer/lib/compose.sh`
- Modify: `scripts/installer/lib/autostart.sh`
- Modify: `scripts/fresh-install.ps1`
- Modify: `scripts/dpf-start.ps1`
- Modify: `scripts/setup.ps1`
- Modify: `scripts/promote.sh`
- Modify: `scripts/dpf-compose.mjs`
- Modify: `docs/operations/install.md`

- [ ] **Step 1: Write failing Windows and POSIX argument fixtures** proving enabled capability keys produce the same ordered profile set, and unknown/stale keys fail with `unknown_runtime_capability:<key>` or `capability_state_stale`.
- [ ] **Step 2: Add install-state schema/migration tests** for `enabledRuntimeCapabilities`, `capabilityServiceCatalogHash`, and `capabilityStateHash`. A previous-release state with no fields must migrate to the documented compatibility set, not to every optional service.
- [ ] **Step 3: Implement one adapter over the generated catalog plus persisted install state** that emits machine-readable profiles and service requirements; shell surfaces consume its output and never maintain service lists.
- [ ] **Step 4: Wire every lifecycle path:** fresh install writes the resolved snapshot; `dpf-start.ps1`, `setup.ps1`, POSIX Compose helpers, and generated autostart commands read it; `promote.sh` copies it into the recovery point, uses it for the promoted stack, restores it on rollback, and refuses a stale catalog/state pair.
- [ ] **Step 5: Preserve existing special profiles deliberately:** `promote`, `dev`, `integration-test`, and `linux-monitoring` remain explicit lifecycle/host overlays; `observability-ui` and `tts` become compatibility aliases to their runtime capabilities for one release and resolve to the same service closure.
- [ ] **Step 6: Verify PowerShell remains PS 5.1-compatible ASCII** and shell files retain LF endings.
- [ ] **Step 7: Run `pnpm exec node --test scripts/lib/resolve-capability-compose-profiles.test.mjs`, installer state tests, autostart tests, promote/rollback contract tests, and existing Compose safety tests.** Expected: clean install, previous-state migration, restart, upgrade, and rollback all preserve identical ordered profiles.
- [ ] **Step 8: Commit** with `git commit -s -m "refactor(install): resolve compose profiles from capabilities"`.

### Task 6: Derive backup inclusion and diagnostics from the projection

**Files:**
- Create: `apps/web/lib/platform-runtime/capability-service-projection.ts`
- Create: `apps/web/lib/platform-runtime/capability-service-projection.test.ts`
- Create: `apps/web/lib/platform-runtime/operational-state.ts`
- Create: `apps/web/lib/platform-runtime/operational-state.test.ts`
- Modify: `apps/web/lib/queue/functions/postgres-daily-backup.ts`
- Modify: `apps/web/lib/queue/functions/postgres-daily-backup.test.ts`
- Modify: `apps/web/lib/operate/backups/readiness.ts`
- Modify: `apps/web/lib/operate/backups/readiness.test.ts`
- Modify: `packages/db/src/seed-platform-backup.ts`
- Modify: `packages/db/src/seed-platform-backup.test.ts`
- Modify: `scripts/measure-platform-substrate-runtime.mjs`
- Modify: `scripts/measure-platform-substrate-runtime.test.mjs`

- [ ] **Step 1: Write failing tests** proving disabled optional services are excluded, enabled stateful services retain their manifest backup policy, and external runtimes never become local backup targets.
- [ ] **Step 2: Add a typed web loader** that joins the generated catalog with live `PlatformCapability.state` and the persisted install snapshot. It returns one `OperationalCapabilityState` boundary containing catalog/state versions, enabled state, service requirements, observed Compose/health input, backup targets, and provider/external state; it must not reimplement dependency resolution.
- [ ] **Step 3: Make backup scheduling explicit:** PostgreSQL core backup remains scheduled; capability-owned backup steps are selected from `projection.backupServices`; disabled targets are skipped with an `optional_inactive` receipt, not failed or independently scheduled. Seed reconciliation deactivates superseded per-engine schedules rather than deleting history.
- [ ] **Step 4: Make backup readiness and runtime diagnostics consume the same boundary.** A disabled target reads `optional_inactive`; an enabled missing target reads `optional_degraded`; no consumer carries a service array.
- [ ] **Step 5: Run `pnpm --filter web exec vitest run lib/platform-runtime/capability-service-projection.test.ts lib/platform-runtime/operational-state.test.ts lib/queue/functions/postgres-daily-backup.test.ts lib/operate/backups/readiness.test.ts`, the DB seed test, and `pnpm exec node --test scripts/measure-platform-substrate-runtime.test.mjs`.**
- [ ] **Step 6: Commit** with `git commit -s -m "refactor(ops): consume capability service projection"`.

## Chunk 3: Requirement-aware health and operator UX

### Task 7: Create the four-state health projection

**Files:**
- Create: `apps/web/lib/platform-runtime/service-health.ts`
- Create: `apps/web/lib/platform-runtime/service-health.test.ts`
- Modify: `apps/web/components/monitoring/health-summary.ts`

- [ ] **Step 1: Write failing table tests** for `required`, `optional_inactive`, `optional_degraded`, and `external`, including aggregate platform-health behavior.
- [ ] **Step 2: Implement the pure health projector over `OperationalCapabilityState`.** A missing required service degrades aggregate health; an inactive disabled service does not; an enabled but unhealthy optional service is explicitly degraded; provider-configured runtimes are external. It accepts observed health keyed by service/runtime only and rejects observations absent from the catalog, preventing a second mapping.
- [ ] **Step 3: Add accessible labels and recommended actions** to every state. No meaning may depend on color alone.
- [ ] **Step 4: Run focused Vitest suites.**
- [ ] **Step 5: Commit** with `git commit -s -m "feat(health): project capability-aware service states"`.

### Task 8: Render requirement-aware health on both operator surfaces

**Files:**
- Create: `apps/web/components/monitoring/CapabilityServiceHealth.tsx`
- Create: `apps/web/components/monitoring/CapabilityServiceHealth.test.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/runtime-health/page.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/runtime-health/page.test.tsx`
- Modify: `apps/web/components/monitoring/ServiceHealthDashboard.tsx`
- Modify: `apps/web/components/monitoring/ServiceHealthDashboard.test.tsx`

- [ ] **Step 1: Write failing render tests** for all four labels, text/icon differentiation, disabled-capability explanation, degraded action, and external-runtime explanation.
- [ ] **Step 2: Build one reusable theme-aware component** using existing DPF tokens and semantic HTML. Its only data prop is the shared operational-state projection; it cannot accept or construct service lists. Keep model-routing details on AI Runtime Health while adding the shared service-requirement section.
- [ ] **Step 3: Integrate the component** into `/platform/ai/runtime-health` and the portal product Health tab, which is the system-health surface behind `/ops/health`.
- [ ] **Step 4: Verify responsive wrapping, keyboard reading order, visible focus, and non-color state cues** at 1440px and 390px. Expected accessible names include `Required — unavailable`, `Optional — inactive`, `Optional — degraded`, and `External — provider managed`.
- [ ] **Step 5: Run both page/component test suites.**
- [ ] **Step 6: Commit** with `git commit -s -m "feat(health): show capability service requirements"`.

## Chunk 4: Verification, publication, and closeout

### Task 9: Publish architecture and migration guidance

**Files:**
- Modify: `docs/architecture/platform-substrate-boundaries.md`
- Create: `docs/architecture/capability-driven-runtime-profiles.md`
- Modify: `docs/README.md`
- Modify: `docs/operations/install.md`

- [ ] **Step 1: Document authority flow** from manifest to generated projection to install/upgrade/health/backup/diagnostics.
- [ ] **Step 2: Document capability enable/disable and drain behavior,** profile names, failure semantics, rollback, and external runtimes.
- [ ] **Step 3: Document migration compatibility:** existing installs preserve enabled capabilities during governed upgrade; optional services are not deleted; rollback restores prior profiles.
- [ ] **Step 4: Run documentation link/reference guards.**
- [ ] **Step 5: Commit** with `git commit -s -m "docs(substrate): publish capability runtime profiles"`.

### Task 10: Verify, review, publish, and close BI-PSC-003

**Files:**
- Modify only if verification reveals defects.

- [ ] **Step 1: Run the exact focused source gates:** `pnpm exec node --test scripts/lib/capability-service-projection.test.mjs scripts/check-capability-compose-profiles.test.mjs scripts/lib/resolve-capability-compose-profiles.test.mjs scripts/apply-runtime-capability-transition.test.mjs scripts/measure-platform-substrate-runtime.test.mjs`; `pnpm --filter @dpf/db exec vitest run src/sync-capabilities.test.ts src/seed-platform-backup.test.ts`; and `pnpm --filter web exec vitest run lib/platform-runtime/work-attribution.test.ts lib/platform-runtime/capability-transition.test.ts lib/actions/runtime-capabilities.test.ts lib/platform-runtime/transition-coordinator.test.ts lib/self-upgrade/promoter.test.ts lib/platform-runtime/capability-service-projection.test.ts lib/platform-runtime/operational-state.test.ts lib/platform-runtime/service-health.test.ts lib/queue/functions/postgres-daily-backup.test.ts lib/operate/backups/readiness.test.ts components/monitoring/CapabilityServiceHealth.test.tsx app/\(shell\)/platform/ai/runtime-health/page.test.tsx components/monitoring/ServiceHealthDashboard.test.tsx`.
- [ ] **Step 2: Run `pnpm check:substrate` and every repo guard.** Record intentional measured improvements; do not weaken ratchets.
- [ ] **Step 3: Run `pnpm --filter web typecheck`.** Fix all errors before publishing.
- [ ] **Step 4: Route the merged-code production build, full affected Vitest suite, and migration check through the leased `local-integration-ci` sandbox.** A worktree-only runtime result is not canonical evidence.
- [ ] **Step 5: Exercise clean-install, previous-release upgrade, restart/autostart, governed promotion, rollback, unknown capability, unavailable optional service, and the five named fixtures in the leased/canonical runtime.** Exercise both health pages at 1440px and 390px and capture the four explicit state labels; core-only health must remain healthy with deep telemetry absent.
- [ ] **Step 6: Request independent spec and quality reviews, resolve every actionable finding, and rerun affected gates.**
- [ ] **Step 7: Push the branch and open a ready-for-review PR only after all gates pass.** All commits require DCO sign-off.
- [ ] **Step 8: Carry the PR through required CI and the merge queue.** Record the final gate, UX, PR, and merge evidence on `BI-PSC-003`.
- [ ] **Step 9: Mark `BI-PSC-003` done only after merge, then run live-install preflight against the merge SHA.** Use governed self-upgrade when the release batch is eligible; never rebuild the live portal directly.
