# Install-State Readiness Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use `dpf-tdd` and `dpf-local-merge-ci-before-push`, including the per-BI completion gate, to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make supported legacy install state safely projectable during read-only promoter readiness and atomically migratable after the governed recovery point, while fixing every canonical writer that can recreate invalid state.

**Architecture:** A version-aware Node migrator is the single owner of schema dispatch and v1-to-v2 projection. Candidate readiness signs a source/projection envelope using the existing runtime-transition secret; after quiescence and the existing recovery copy, the same promoter digest verifies that envelope and persists through a cross-runtime filesystem lock/CAS protocol. Bash and PowerShell remain adapters and delegate migration to Node.

**Tech Stack:** Node.js ESM and `node:test`, Bash 3.2, PowerShell 5.1, Next.js/TypeScript/Vitest, JSON Schema, Docker promoter image.

**Design:** `docs/superpowers/specs/2026-07-18-install-state-readiness-migration-design.md`  
**WWMD:** `DI-C75A78147109`, `DI-6D6D452E46D5`  
**Capsule:** `WC-E6433BAD`

**Mount-reachability prerequisite:** BI-91DAA63D / decision `DI-B0A41878742E` renames the promoter-internal state path to `DPF_PROMOTER_STATE_DIR`. It must land in this branch before the persistence phase: promoter-owned portal/sandbox recreates must leave `DPF_STATE_DIR` unset so Compose resolves the canonical host path from the install `.env`. Window-parked `[#3266,#3272)` installs remain on the explicit installer/reinstall route and are not auto-migrated.

---

## Chunk 1: Canonical schemas and migration projection

### Task 1: Freeze schema versions and make validation version-aware

**Files:**
- Create: `scripts/installer/install-state.v1.schema.json`
- Create: `scripts/installer/install-state.v2.schema.json`
- Create: `scripts/installer/install-state-schema-registry.mjs`
- Modify: `scripts/installer/install-state.schema.json`
- Modify: `scripts/installer/validate-install-state.mjs`
- Modify: `scripts/installer/validate-install-state.test.mjs`

- [ ] **Step 1: Write failing schema-dispatch tests** for the exact BOM-bearing observed v1 shape, a strict v2 state, unsupported future versions, unknown v1 properties, and a required-field change without a registered migration edge.
- [ ] **Step 2: Run** `node --test scripts/installer/validate-install-state.test.mjs`; expect the legacy/BOM and dispatch cases to fail for the current direct `JSON.parse`/single-schema implementation.
- [ ] **Step 3: Add immutable v1/v2 schemas and registry.** Author v1 from historically emitted state: capability snapshot optional, `platform` permits the bounded `unsupported` legacy value, `arch` is permissive only for v1, and known `agentToolchain` remains optional. Make the current strict schema v2 and keep `install-state.schema.json` as a generated/pointer-equivalent current artifact with a drift test.
- [ ] **Step 4: Implement version-aware parsing/validation.** Strip one leading BOM at the byte boundary, dispatch on `schemaVersion`, and return bounded field errors; do not migrate in the validator.
- [ ] **Step 5: Re-run** `node --test scripts/installer/validate-install-state.test.mjs`; expect all schema and CLI cases green.
- [ ] **Step 6: Commit** with `git commit -s -m "feat: version the install-state schema contract"`.

### Task 2: Implement pure v1-to-v2 projection

**Files:**
- Create: `scripts/installer/migrate-install-state.mjs`
- Create: `scripts/installer/migrate-install-state.test.mjs`
- Create: `scripts/lib/capability-state-hash.mjs`
- Create: `scripts/lib/capability-state-hash.test.mjs`
- Create: `scripts/installer/resolve-host-identity.mjs`
- Create: `scripts/installer/resolve-host-identity.test.mjs`
- Modify: `scripts/lib/resolve-capability-compose-profiles.mjs`
- Modify: `scripts/lib/resolve-capability-compose-profiles.test.mjs`
- Modify: `apps/web/lib/platform-runtime/transition-coordinator.ts`
- Modify: `apps/web/lib/platform-runtime/transition-coordinator.test.ts`

- [ ] **Step 1: Write failing pure-projection and host-identity tests** for the observed BOM + `unsupported` platform + raw architecture + missing capabilities state, explicit `win32/windows`, `darwin/macos`, and `linux/linux` mappings, already-valid v2 idempotency, contradictory capability refusal, unverifiable host refusal, and future-version refusal. Define identity precedence: explicit installer-owned `DPF_HOST_PLATFORM`/`DPF_HOST_ARCH`; for supported legacy Windows only, require mutually consistent drive-letter `DPF_HOST_INSTALL_PATH` and `DPF_STATE_DIR_HOST` evidence and an already-canonical legacy architecture; never infer a non-Windows host from container `process.platform`/Docker daemon OS. Missing or contradictory evidence fails closed.
- [ ] **Step 2: Write the failing hash parity fixture** before implementation, proving the resolver, transition coordinator, migrated state, and fresh candidate state must produce byte-identical hashes.
- [ ] **Step 3: Run** `node --test scripts/installer/migrate-install-state.test.mjs scripts/installer/resolve-host-identity.test.mjs scripts/lib/capability-state-hash.test.mjs scripts/lib/resolve-capability-compose-profiles.test.mjs` and `pnpm --filter web exec vitest run apps/web/lib/platform-runtime/transition-coordinator.test.ts`; expect the new projection/identity/hash APIs and delegation to fail.
- [ ] **Step 4: Extract one canonical capability state-hash helper** to `scripts/lib/capability-state-hash.mjs`; make both `resolve-capability-compose-profiles.mjs` and `transition-coordinator.ts` delegate to it. Preserve `PRE_PROFILE_COMPATIBILITY_CAPABILITIES` as the sole legacy default.
- [ ] **Step 5: Implement the host-identity resolver and `projectInstallState`.** Accept parsed v1 bytes plus verified resolver output and candidate catalog; validate v1, project canonical identity/capabilities, set version 2, validate v2, and return `{sourceHash, projectionHash, migrationRequired, projectedState}` without writing.
- [ ] **Step 6: Re-run the exact Step 3 commands** and confirm identity provenance, hash parity, projection determinism, and non-mutation are green.
- [ ] **Step 7: Commit** with `git commit -s -m "feat: project legacy install state to v2"`.

## Chunk 2: Signed handoff and durable persistence

### Task 3: Bind readiness projection to promotion using existing signing

**Files:**
- Create: `scripts/lib/transition-signing.mjs`
- Create: `scripts/lib/transition-signing.test.mjs`
- Modify: `apps/web/lib/platform-runtime/transition-protocol.ts`
- Modify: `apps/web/lib/platform-runtime/transition-protocol.test.ts`
- Modify: `apps/web/lib/self-upgrade/promoter.ts`
- Modify: `apps/web/lib/self-upgrade/promoter.test.ts`
- Modify: `apps/web/lib/self-upgrade/preflight.ts`
- Modify: `apps/web/lib/self-upgrade/preflight.test.ts`
- Modify: `apps/web/lib/self-upgrade/config.ts`
- Modify: `apps/web/lib/self-upgrade/config.test.ts`
- Modify: `apps/web/lib/queue/functions/self-upgrade.ts`
- Modify: `apps/web/lib/queue/functions/self-upgrade.test.ts`
- Modify: `scripts/promote.sh`
- Modify: `apps/web/lib/self-upgrade/promote-script-contract.test.ts`
- Modify: `Dockerfile.promoter`
- Modify: `promoter-contract.json`
- Modify: `promoter-contract.schema.json`

- [ ] **Step 1: Write failing shared-signing tests** for canonical serialization/HMAC compatibility with existing transition signatures, plus install-state envelope source hash, projection hash, schema versions, verified host identity, promoter digest, expiry/run identity, tampering, wrong digest, and changed state between readiness and persistence.
- [ ] **Step 2: Write failing orchestration-carrier and provenance tests.** `runCandidatePreflight` must resolve authoritative host identity from explicit installer-owned environment or the bounded legacy-Windows path contract, pass it to candidate readiness, and return the resolved digest plus signed migration envelope/signature; the queue function must retain that exact object across readiness evidence and quiescence and pass it unchanged to the later `runPromoter`. Missing, contradictory, expired, wrong-run, or wrong-digest evidence must stop before quiescence.
- [ ] **Step 3: Write failing promoter contract tests** proving all versioned schemas, migrator, catalog, and the executable shared signing verifier are embedded and the state mount is read-only in readiness but writable only in promotion.
- [ ] **Step 4: Run** `node --test scripts/lib/transition-signing.test.mjs` and `pnpm --filter web exec vitest run apps/web/lib/platform-runtime/transition-protocol.test.ts apps/web/lib/self-upgrade/config.test.ts apps/web/lib/self-upgrade/promoter.test.ts apps/web/lib/self-upgrade/preflight.test.ts apps/web/lib/queue/functions/self-upgrade.test.ts apps/web/lib/self-upgrade/promote-script-contract.test.ts`; expect failures for the absent shared primitive, host provenance, and carrier.
- [ ] **Step 5: Extract the existing signing algorithm** into runtime-neutral `scripts/lib/transition-signing.mjs` with JSDoc/TypeScript-compatible exports. Make `transition-protocol.ts` delegate to it and package the same `.mjs` in `Dockerfile.promoter`; no second canonical serialization or HMAC implementation is permitted.
- [ ] **Step 6: Add the typed install-state migration envelope** using the existing `runtime-transition.secret`. Portal signs the readiness result; promoter verification receives only the envelope/signature and existing read-only secret mount.
- [ ] **Step 7: Implement authoritative host-identity wiring and the orchestration carrier** in `config.ts`, `preflight.ts`, and queue `self-upgrade.ts`: resolve/validate identity before readiness, return and persist it in bounded signed evidence, retain it across quiescence, and pass the exact digest-bound envelope/signature into promotion.
- [ ] **Step 8: Extend promoter command/contract wiring** so readiness emits the bounded projection report and promotion receives/verifies the exact signed envelope before migration.
- [ ] **Step 9: Re-run the exact Step 4 Node/Vitest/contract commands and web typecheck** and confirm host provenance, tampering, missing-carrier, and changed-state cases fail before persistence.
- [ ] **Step 10: Commit** with `git commit -s -m "feat: sign install-state readiness handoff"`.

### Task 4: Add one cross-runtime filesystem lock and atomic CAS writer

**Files:**
- Create: `scripts/installer/install-state-lock-contract.json`
- Create: `scripts/installer/install-state-transaction.mjs`
- Create: `scripts/installer/install-state-transaction.test.mjs`
- Modify: `scripts/installer/lib/state.sh`
- Modify: `scripts/installer/lib/state.ps1`
- Create: `tests/install/install-state-writer-conformance.test.mjs`

- [ ] **Step 1: Write failing Node transaction tests** for exclusive acquisition, owner metadata, bounded expiry/stale recovery, CAS mismatch, same-directory temp creation, atomic replacement, no canonical-path gap, and idempotent recovery after interruption at every transaction stage.
- [ ] **Step 2: Write failing cross-runtime conformance tests** that race representative Node, Bash, and PowerShell updates and assert no owned property is lost, no BOM is emitted, and lock metadata is interoperable.
- [ ] **Step 3: Run** `node --test scripts/installer/install-state-transaction.test.mjs tests/install/install-state-writer-conformance.test.mjs`; expect missing protocol/atomic-writer failures.
- [ ] **Step 4: Implement the versioned lock/CAS contract and Node transaction.** Use adjacent exclusive lock creation, source-byte hash CAS, same-directory temp, flush, atomic replace, post-write validation, and deterministic orphan recovery.
- [ ] **Step 5: Convert Bash writers** from default-`$TMPDIR` `mktemp` to same-directory locked CAS writes and fail closed on unsupported platform/architecture.
- [ ] **Step 6: Convert PowerShell initialization and `Set-DpfStateValue`** to the same lock/CAS protocol and `File.Replace`-compatible atomic write while retaining `UTF8Encoding($false)`. Concurrent initializers must converge without truncation or an unlocked creation path.
- [ ] **Step 7: Re-run Node and cross-runtime tests, plus** `bash -n scripts/installer/lib/state.sh scripts/installer/lib/platform.sh` and a PowerShell parser check; expect green.
- [ ] **Step 8: Commit** with `git commit -s -m "fix: coordinate install-state writers atomically"`.

## Chunk 3: Lifecycle integration and rollback

### Task 5: Delegate every migration entrypoint to the canonical migrator

**Files:**
- Modify: `scripts/installer/lib/state.sh`
- Modify: `scripts/installer/lib/state.ps1`
- Modify: `scripts/installer/lib/platform.sh`
- Modify: `scripts/dpf-bootstrap-agent-toolchain.sh`
- Modify: `scripts/dpf-bootstrap-agent-toolchain.ps1`
- Modify: `install-dpf.sh`
- Modify: `install-dpf.ps1`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `tests/install/lifecycle-parity.test.mjs`

- [ ] **Step 1: Add failing delegation and provenance tests** proving `dpf_state_migrate` and the PowerShell older-version path call the Node migrator rather than stamping `schemaVersion`, bootstrap updates only `agentToolchain`, MSYS/Git-Bash host detection never persists `unsupported` or a raw non-enum architecture, both installers write canonical `DPF_HOST_PLATFORM`/`DPF_HOST_ARCH` values to `.env`, Compose passes them to the portal, and those values equal freshly initialized state.
- [ ] **Step 2: Run** `node --test tests/install/lifecycle-parity.test.mjs tests/install/install-state-writer-conformance.test.mjs`; expect the delegation, host classification, installer-to-env, and Compose provenance cases to fail before implementation.
- [ ] **Step 3: Set both adapters to schema version 2** and delegate inspect/write behavior to `migrate-install-state.mjs`; remove independent version stamping.
- [ ] **Step 4: Repair platform detection** with explicit Windows/MSYS classification and canonical architecture mapping; unknown hosts fail before state creation.
- [ ] **Step 5: Persist the explicit host-identity contract** from canonical Windows/Bash installers into `.env` and pass it through Compose to the portal. Existing supported Windows installs may use only the bounded dual-drive-path fallback defined in Task 2.
- [ ] **Step 6: Route bootstrap property updates through the canonical state writer** without reinitializing host identity.
- [ ] **Step 7: Re-run the exact Step 2 lifecycle and conformance command** and confirm every delegation/provenance case is green.
- [ ] **Step 8: Commit** with `git commit -s -m "fix: converge install-state lifecycle adapters"`.

### Task 6: Insert migration after recovery and before swap

**Files:**
- Modify: `scripts/promote.sh`
- Modify: `apps/web/lib/self-upgrade/promote-script-functional.test.ts`
- Modify: `apps/web/lib/self-upgrade/promote-script-contract.test.ts`
- Modify: `.github/workflows/self-upgrade-acceptance.yml`
- Modify: `scripts/test-n-minus-one-upgrade.mjs`
- Modify: `scripts/test-n-minus-one-upgrade.test.mjs`

- [ ] **Step 1: Write failing orchestration tests** proving readiness only projects, quiescence and the existing `$PROMOTE_BACKUP_PATH/install-state.json` copy occur before persistence, persistence precedes swap, and the same candidate digest verifies the signed envelope.
- [ ] **Step 2: Add rollback tests** where migration succeeds but swap or health later fails; assert the existing EXIT trap restores the exact v1 bytes before baseline resume and no second recovery artifact exists.
- [ ] **Step 3: Add protocol-floor acceptance fixtures** for PR #3276-or-later automatic projection/migration and honest pre-floor `legacy-bootstrap` refusal/remediation.
- [ ] **Step 4: Run the focused functional/acceptance tests** and observe ordering/rollback failures before implementation.
- [ ] **Step 5: Add the post-recovery/pre-swap migration phase** to `promote.sh`, verify envelope/CAS, retain recovery until durable acceptance, and restore on every nonzero downstream exit.
- [ ] **Step 6: Re-run focused tests and production-shaped candidate readiness** with the observed legacy fixture; require `quiescenceBegan:false` during projection failure and exact rollback on injected post-migration failure.
- [ ] **Step 7: Commit** with `git commit -s -m "fix: migrate install state inside governed promotion"`.

## Chunk 4: Full verification and delivery

### Task 7: Verify, review, and publish

**Files:**
- Modify: `docs/operations/install.md` only if operator-visible schema/recovery behavior is not already covered by the design

- [ ] **Step 1: Run source gates:** `git diff --check`, `pnpm security:secrets`, all new Node tests, existing installer validator/resolver tests, lifecycle parity, promoter contract/functional tests, and N-1 acceptance unit tests.
- [ ] **Step 2: Run shell gates:** `bash -n` on changed shell files and repository ShellCheck installer lane; run PowerShell 5.1 parser and behavior fixtures.
- [ ] **Step 3: Run web gates:** `pnpm --filter web typecheck` and affected Vitest suites.
- [ ] **Step 4: Lease `local-integration-ci`** and run production build plus production-shaped promoter readiness/migration/rollback acceptance. Record canonical evidence to capsule `WC-E6433BAD`; an unavailable lease is unrun, never green.
- [ ] **Step 5: Run independent code review, fix all Critical/Important findings, and repeat affected gates.**
- [ ] **Step 6: Update the design status and capsule evidence** with both WWMD decision IDs, exact test outputs, and migration/rollback artifacts.
- [ ] **Step 7: Push all signed commits, open a non-draft ready PR, monitor every check and merge-group run, resolve automated review threads, and merge only when fully green.**

## Stop conditions

- Never edit the reporter's live `install-state.json` as a one-off repair.
- Never persist migration before quiescence and the governed recovery copy.
- Never resume a baseline after rollback until exact pre-migration bytes are restored.
- Never accept an unsigned, expired, wrong-digest, or CAS-mismatched migration envelope.
- Never let Bash, PowerShell, or Node write state outside the shared lock/CAS contract.
- Never claim pre-floor production readiness; keep it visibly `legacy-bootstrap`.
