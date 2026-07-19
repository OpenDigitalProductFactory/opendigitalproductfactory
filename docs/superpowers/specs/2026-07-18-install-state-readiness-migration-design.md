# Install-State Readiness Migration Design

**Date:** 2026-07-18
**Status:** Approved; document reviewed 2026-07-18 (architecture-review advisory folded in)
**Governing decision:** `DI-C75A78147109` (WWMD, high confidence)
**Substrate decision:** `DI-6D6D452E46D5` (WWMD, high confidence)
**Parent design:** [`2026-07-18-install-upgrade-refactor-parity-design.md`](2026-07-18-install-upgrade-refactor-parity-design.md)

## 1. Incident and root cause

After PR #3276 made canonical install-state validation a pre-quiescence promoter-readiness gate, an existing Windows install failed with `promoter-readiness-failed: install_state_invalid`.

Live evidence showed three compatibility defects in `%USERPROFILE%\.dpf\install-state.json`:

1. a UTF-8 byte-order mark caused direct `JSON.parse` to fail;
2. the persisted `platform` was `"unsupported"` instead of the canonical `win32` host value. This value does **not** come from the agent-toolchain materializer (`packages/dpf-bootstrap/src/agent-toolchain/install-state.ts` writes only the `agentToolchain` block). It originates in `scripts/installer/lib/platform.sh`, whose `dpf_platform` classify-fallback emits `"unsupported"` when `uname -s` is neither `Darwin` nor `Linux` (e.g. a Windows Git-Bash/MSYS host running the Bash agent-toolchain bootstrap), and `dpf_state_init` in `scripts/installer/lib/state.sh` then persists it. `dpf_arch` has the identical fallback (`*) DPF_ARCH="$(uname -m)"`), so `arch` can likewise be written outside its schema enum;
3. the state predated required `enabledRuntimeCapabilities`, `capabilityCatalogHash`, and `capabilityStateVersion` fields even though `schemaVersion` remained `1`.

The readiness gate behaved safely: it refused promotion before quiescence. The defect is that canonical writers and schema evolution did not provide an upgrade path for state already emitted by supported releases.

## 2. Decision and goals

WWMD decision `DI-C75A78147109` selected **canonical writers plus a versioned migration** over a readiness-only projection or globally loosening the schema.

This change must:

- make every canonical state writer emit BOM-free, schema-valid state;
- advance the install-state schema version when required fields are added;
- replace the existing `dpf_state_migrate()` / `Test-DpfStateSchema` version-dispatch stubs with delegation to the one canonical migrator, so no shell/PowerShell path stamps `schemaVersion` on its own;
- project known legacy states read-only and validate migration feasibility before portal quiescence, then persist only after quiescence and the recovery point but before swap;
- derive capability state through the existing canonical capability resolver;
- derive host platform **and architecture** from verified runtime input, never from a stale persisted value or an unclassified `uname` fallback;
- atomically persist a successfully validated migration while retaining recovery bytes;
- reject unknown future versions, malformed JSON, unrecognized extra fields, and states that cannot be migrated without guessing;
- keep PowerShell and Bash behavior equivalent.

## 3. Architecture

### 3.1 One migration owner and N-1 execution carrier

A focused Node module under `scripts/installer/` owns parsing, migration planning, validation, and atomic persistence. Shell and PowerShell remain orchestration adapters. The module consumes the existing JSON Schema and the existing capability projection module; it does not duplicate schema fields, capability lists, or hashing rules.

The migration API has two modes embedded in the immutable candidate promoter image:

- **inspect/project**: the candidate promoter readiness entrypoint — the existing `scripts/promote.sh --readiness` path, which already validates `install-state.json` via `scripts/installer/validate-install-state.mjs`, exits `78`, and reports `quiescenceBegan:false` — reads the state through its existing read-only mount, strips one leading UTF-8 BOM, validates the bounded legacy schema, produces a migrated in-memory value, and validates schema 2 without writing. Its report binds `migrationRequired`, source-state hash, target schema, projection hash, candidate promoter digest, and verified host platform/arch. The current readiness report is plain **unsigned** JSON; if the source-state-hash binding must be tamper-evident across the readiness→persist boundary, reuse the existing signed-envelope substrate (`signTransitionPayload` in `apps/web/lib/platform-runtime/transition-protocol.ts`) rather than introducing a second signing scheme — this is the open decision in §3.6;
- **migrate/write**: after quiescence, the promotion entrypoint in that exact previously validated candidate digest receives the existing writable lifecycle-state mount, verifies the source-state hash has not changed, acquires the shared state lock, re-projects and validates, then atomically persists schema 2 before source/database swap.

This is the executable bootstrap path for installs at or after the promoter-readiness protocol floor established by PR #3276: that baseline portal knows how to build/resolve the candidate promoter, run its readiness entrypoint read-only, and later launch the same digest for promotion. It does not need candidate host scripts or a host Node installation. The exact floor SHA is recorded in the promoter contract and acceptance fixture rather than inferred from `HEAD^`.

A production portal older than that floor cannot claim or enforce read-only projection and is outside this automatic migration path. Its transition remains visibly classified `legacy-bootstrap` under the parent design and must first use the supported installer/reinstall recovery path to repair lifecycle state; the CI-only compatibility bridge proves candidate behavior but is not presented as a production migration carrier. No baseline-baked migrator may claim candidate behavior.

Readiness remains non-mutating and the parent ordering remains authoritative. State persistence is a distinct, bounded **post-quiescence/pre-swap migration phase**, evidenced separately from readiness. The parent design is amended by this addendum: step 7 (governed recovery point) is followed by lifecycle-state migration, then promotion swap. A migration failure restores/retains the original state, resumes the old portal through governed recovery, and records `stage: state-migration`; it is never reported as a readiness failure. If persistence succeeds but any later swap, database, health, or acceptance step fails, rollback atomically restores the exact pre-migration state under the same lock before the baseline portal resumes.

Concretely, the governed recovery point for lifecycle state already exists: `scripts/promote.sh` copies `install-state.json` to `$PROMOTE_BACKUP_PATH/install-state.json` (`_capability_recovery`) and arms an `EXIT`-trap (`_restore_capability_snapshot`) that atomically restores it on any non-zero exit. The migration phase is **inserted into that existing sequence** — after the recovery copy (`promote.sh` step following the `cp "$_install_state" "$_capability_recovery"` at line ~119) and before the Step 4 portal swap — and rollback reuses that trap. It does not add a second recovery artifact (see §3.5).

### 3.2 Versioned schema registry

The schema version advances from `1` to `2`. Version 2 requires the governed capability snapshot fields and canonical platform values already described by the current schema. The repository retains immutable `install-state.v1.schema.json` and `install-state.v2.schema.json` artifacts plus a small version-dispatch registry. `install-state.schema.json` remains a pointer/current-schema artifact, not an independent rule copy.

**Authoring note (the trap):** the current `install-state.schema.json` is *already* the strict shape — it requires `enabledRuntimeCapabilities`, `capabilityCatalogHash`, `capabilityStateVersion`, and `arch`, and its `platform` enum excludes `"unsupported"` — even though state emitted at `schemaVersion: 1` predates those requirements. That mislabeling (fields tightened without a version bump) is the root defect this design closes. The current file therefore becomes **schema 2**; `install-state.v1.schema.json` must be authored to the genuinely-emitted legacy shape (optional capability fields, optional `agentToolchain`, `platform` including `"unsupported"`, permissive `arch`) rather than copied from the current file. The existing hand-rolled validator `scripts/installer/validate-install-state.mjs` — which the readiness gate shells out to — must become version-aware so it dispatches to the correct schema.

Parsing dispatches by `schemaVersion`, validates the input against its immutable versioned schema, applies exactly one registered migration edge at a time, then validates the target schema. The v1 schema includes only historically emitted bounded shapes, including the known `unsupported` platform value and optional `agentToolchain`; it does not generally relax additional properties. A guard fails when a new required current-schema field lands without a schema-version increment and registered migration edge.

Migration `v1 -> v2`:

1. normalizes a leading BOM at the byte boundary;
2. replaces `platform: "unsupported"` only when the caller supplies a verified host platform (`win32`, `linux`, or `darwin`);
3. supplies missing capability fields by calling the canonical capability resolver in migration mode — `scripts/lib/resolve-capability-compose-profiles.mjs`, invoked with `--migrate`; it already falls back to `PRE_PROFILE_COMPATIBILITY_CAPABILITIES` for a legacy/unversioned state and otherwise throws `capability_state_stale`. Its exported `PRE_PROFILE_COMPATIBILITY_CAPABILITIES` is the authoritative legacy default; the candidate-embedded catalog (`scripts/capability-service-catalog.generated.json`) is the authoritative catalog for the target version. Host vocabulary maps explicitly as `win32 -> windows`, `darwin -> macos`, and `linux -> linux` (the resolver's `HOSTS` set already uses `windows|macos|linux`, and the shell adapters already map `darwin -> macos`);
4. preserves recognized optional fields, including `agentToolchain`;
5. sets `schemaVersion: 2` only after the migrated object validates against schema 2.

If a version-1 object contains an invalid non-legacy platform, contradictory capability state, malformed dates, unknown properties, or a platform that cannot be verified, migration refuses with bounded field-level errors. Version greater than 2 refuses as `install_state_newer_than_runtime`.

### 3.3 Writer repair

The PowerShell installer state library **already** writes UTF-8 without a BOM on both write paths (`state.ps1` uses `New-Object System.Text.UTF8Encoding($false)` at both initialization and `Set-DpfStateValue`); the observed BOM is a legacy artifact from state emitted by an earlier release, so the writer-side requirement here is to **lock that behavior with a regression test**, not to change current behavior. The Bash library must write plain BOM-free UTF-8 through a **same-directory** temporary file — today `dpf_state_write`/`dpf_state_write_json` use `mktemp` (default `$TMPDIR`) plus `mv`, a cross-filesystem, non-atomic rename that must move to the same-directory temp+rename pattern in §3.4.

Host identity is the real writer defect. `scripts/installer/lib/platform.sh` (`dpf_platform`/`dpf_arch`) must never let an unclassified host persist: `dpf_state_init` in `state.sh` must fail closed (or resolve the true host) rather than write `platform: "unsupported"` or a non-enum `arch`. The agent-toolchain bootstrap must update only its owned `agentToolchain` property through the canonical state adapter, and must not call `dpf_state_init` in a way that stamps host identity from an unclassified `uname`.

Fresh initialization includes every version-2 required field. Any writer-side regression is caught by a shared contract test that executes representative PowerShell and Bash writes and validates the resulting bytes and schema. Installer and bootstrap adapters must honor the same shared lock and compare-and-swap **protocol** described below. Because that protocol spans three runtimes (Node, PowerShell 5.1, Bash 3.2) it cannot be shared *code*; it is a shared *contract* — lock filename, owner/metadata format, expiry, and CAS hash rule — verified by a cross-runtime conformance test that races a representative write from each runtime.

### 3.4 Locking, atomicity, and crash recovery

No lock file guards install-state writes today — the current concurrency strategy is POSIX-atomic temp+rename on the Bash/Node paths and a direct in-place `WriteAllText` overwrite on the PowerShell `Set-DpfStateValue` path (not atomic; it must be converted to a temp-file + `File.Replace` write). This design adds coordination: every canonical install-state writer coordinates through one lock file adjacent to the state. Lock acquisition uses exclusive creation with owner/run metadata, bounded expiry, and stale-owner recovery; no writer performs read/project/write outside that lock. Reclaim tickets are immutable generation tombstones keyed by the unique stale lock-owner identity: writers never delete or reuse an authoritative ticket path, ignore tickets whose target is not the current lock generation, and may finish recovery through an expired tombstone. Tombstones are retained for the install lifetime. Stale-owner recovery is exceptional, so this accepts rare metadata growth rather than introducing unsafe concurrent garbage collection; directory scanning remains limited to the adjacent reclaim prefix. Immediately before replacement, the migrator compares the canonical byte hash with the readiness-bound source hash. A mismatch aborts as `install_state_changed_after_readiness` and triggers governed resume/rollback rather than discarding concurrent updates.

Write ordering is:

1. acquire lock and recover any incomplete prior transaction;
2. re-read, hash, project, and validate;
3. write and flush a same-directory temporary file without BOM;
4. create/replace one deterministic pre-migration recovery copy and flush it;
5. atomically replace the canonical path without a canonical-path gap (`File.Replace` semantics on Windows adapters; same-filesystem rename on POSIX/container adapters);
6. flush the containing directory where the substrate supports it, verify the canonical bytes/hash/schema, then release the lock.

Windows bind-mount or antivirus sharing violations fail before replacement and retain the original. A crash-recovery probe treats a valid canonical v2 file as committed, otherwise restores the validated recovery copy; orphan temporary files are bounded and removed only after reconciliation. Tests inject interruption after each write stage.

### 3.5 Failure and recovery behavior

Read-only projection completes before drain. Persistence occurs only after quiescence and the governed recovery point, before source/database swap. A projection failure leaves the portal serving. A persistence failure invokes governed recovery/resume with the old portal and original state.

The pre-migration original is the governed recovery copy that `scripts/promote.sh` already writes at `$PROMOTE_BACKUP_PATH/install-state.json` before any swap step; this design does **not** add a second `install-state.v1.pre-migration.json` artifact. That copy is retained until the candidate portal is durably accepted and the self-upgrade lifecycle completes, and the existing `EXIT`-trap restore (`_restore_capability_snapshot`) is extended so every rollback restores that exact original — even if the baseline could parse v2 — so rollback restores the complete pre-upgrade contract. Repeated migration is idempotent and does not create unbounded backups (the recovery path is one deterministic copy, not per-attempt files). Atomic replacement failure leaves the original canonical file intact.

No code edits the reporter's live state as a one-off repair. Existing installs recover through the shipped migration so the same path serves every adopter.

### 3.6 Substrate grounding and governed reuse decision

This addendum sits on existing substrate; implementers must extend it, not rebuild it:

- **Migrator delegation.** `dpf_state_migrate()` (`state.sh`) and the `Test-DpfStateSchema` "older-version" return path (`state.ps1`) are today stubs that merely stamp `schemaVersion`. They must delegate to the one canonical migrator; neither may carry migration logic of its own (`single-source-of-truth`).
- **Capability hash convergence.** The target `capabilityStateVersion`/`capabilityCatalogHash` must be produced by the canonical resolver and must equal what a *fresh* candidate install of the same host would emit, so migrated and fresh installs converge. Note there are currently two implementations of the same hash — `computeCapabilityStateVersion` (`apps/web/lib/platform-runtime/transition-coordinator.ts`) and `stateHash` (`resolve-capability-compose-profiles.mjs`); they must stay byte-identical (ideally one shared function).
- **Adjacent saga (do not confuse).** A DB-backed capability-transition saga already exists (`transition-coordinator.ts`: signed envelopes via `transition-protocol.ts`, advisory-lock CAS, host receipts, `inspectHostInstallState`, startup reconciliation, rollback/compensation). It governs runtime-capability *toggles*, not file-schema *upgrades*, so it is not a drop-in owner for this migration — but its signing and host-state-inspection primitives are reusable.

WWMD decision `DI-6D6D452E46D5` selected **hybrid reuse and file coordination** with high confidence (composite `12.092`, margin `3.233`). The implementation therefore reuses `transition-protocol.ts` signed envelopes for readiness-to-persist evidence and the existing `promote.sh` recovery/rollback artifact, while adding one bounded, versioned filesystem lock/CAS protocol for offline Bash, PowerShell, and Node writers. It does not duplicate signing or recovery schemes, and it does not misuse a database advisory lock that cannot coordinate offline writers.

### 3.7 Prerequisite: state-directory mount reachability (BI-91DAA63D)

**This design assumes `/dpf-state` maps to the operator's real host state directory; on Windows/Docker-Desktop installs that assumption is currently violated at swap time, which defeats both the read-only projection and the migrate/write phase.** This addendum migrates the *content* of `install-state.json`; it does not own the host→Compose→promoter *wiring* that makes the file reachable. The wiring is asserted at install time by the parent design (§5.1 policy invariant "required state-directory wiring from host, through Compose, into the promoter launch"; §5.2 line: "the portal receives the same host path it will later pass to the promoter") — but that invariant is **not preserved across a self-upgrade swap**:

- `apps/web/lib/self-upgrade/promoter.ts` launches the promoter with `-e DPF_STATE_DIR=/dpf-state` (a *container* path — correct so `promote.sh` reads `/dpf-state/install-state.json` through the `stateDirHostPath:/dpf-state` mount);
- `scripts/promote.sh` then recreates the portal (`docker compose --env-file <install .env> up -d --no-deps --force-recreate portal`) with that value still exported. Compose variable precedence makes the **shell** `DPF_STATE_DIR=/dpf-state` override the install `.env`, so the new portal's `${DPF_STATE_DIR:-…}` volume and `DPF_STATE_DIR_HOST` both resolve to `/dpf-state` — an empty host path on Windows — silently reverting the operator's pin.

Live evidence: a Windows install whose `.env` contains `DPF_STATE_DIR=C:\Users\<user>\.dpf`, after a **successful** self-upgrade, came up with `DPF_STATE_DIR_HOST=/dpf-state` and `/dpf-state` mounting empty (no `install-state.json`). Consequence for this design: the readiness projection reads an empty mount → `install_state_invalid`, and the post-quiescence migrate/write operates on the wrong location while the real `~/.dpf` state stays legacy. Each swap succeeds (readiness runs on the *pre*-swap portal) but leaves the *new* portal mis-mounted, so the **next** upgrade re-fails — content migration is durable, reachability is not. The design's §1 incident is a peer install where the mount *was* correct (it read the real file and found the content defects), so this failure mode was outside its evidence.

**Requirement (hard dependency implemented under the same upgrade concern):** governed decision `DI-B0A41878742E` selected `rename-promoter-container-var`. The portal launches the sibling with `DPF_PROMOTER_STATE_DIR=/dpf-state`; every promoter-internal state access uses that name; and `DPF_STATE_DIR` is absent from the promoter environment so Compose resolves its host interpolation from the install `.env` at portal and sandbox recreate boundaries. The parent §5.1 invariant and a dependency-free contract test cover both boundaries. Canonical runtime acceptance still verifies a pinned install `.env` by inspecting the post-swap portal's `DPF_STATE_DIR_HOST` and `/dpf-state` mount. Window-parked `[#3266,#3272)` installs remain explicitly routed to installer/reinstall rather than this automatic migration.

## 4. Data flow

1. Portal preflight resolves the canonical host state path and verified host platform.
2. The immutable candidate promoter readiness entrypoint mounts state read-only and validates v1 or v2.
3. The canonical capability resolver creates a v2 projection and hashes the source/projection into readiness evidence.
4. Only a passing readiness report permits quiescence and governed recovery-point creation (`scripts/promote.sh` copies `install-state.json` to `$PROMOTE_BACKUP_PATH/install-state.json` and arms its `EXIT`-trap restore).
5. The same promoter digest acquires the state lock, verifies compare-and-swap hashes, and atomically persists BOM-free v2 state.
6. The promoter revalidates persisted bytes and only then continues source/database swap.
7. Any persistence error restores/resumes the old portal and state through governed recovery.
8. Any later rollback restores the pre-migration state under lock before the baseline portal resumes; successful acceptance retires the bounded recovery copy.

## 5. Verification

Regression fixtures cover:

- the exact observed BOM + `unsupported` + missing-capability legacy state;
- BOM-only normalization;
- already-valid version-2 idempotency;
- PowerShell and Bash BOM-free writer parity;
- agent-toolchain property updates preserving canonical host identity;
- unclassified-host fail-closed: `platform.sh`/`dpf_state_init` refuse to persist `"unsupported"` platform or a non-enum `arch`;
- migrator delegation: `dpf_state_migrate()` / `Test-DpfStateSchema` invoke the canonical migrator rather than stamping `schemaVersion` locally, and `validate-install-state.mjs` dispatches by version;
- canonical capability resolution and hash validation, including that a migrated state's capability fields equal a fresh candidate install's;
- malformed JSON, unknown properties, unverifiable platform, contradictory capabilities, and future-version refusal;
- atomic-write failure preserving the original;
- concurrent writer/CAS refusal and crash injection at every transaction stage;
- readiness ordering proving read-only projection finishes before quiescence and persistence occurs only after recovery-point creation but before swap;
- source-floor execution proving the old portal invokes candidate-digest projection and that the same digest performs persistence;
- post-migration swap/health failure proving rollback restores v1 before the baseline resumes;
- a production-shaped candidate readiness run against migrated state.

The mandatory gates remain targeted Node/Vitest tests, PowerShell 5.1 parsing/behavior checks, Bash syntax/ShellCheck, web typecheck, production build, and self-upgrade compatibility acceptance.

The compatibility acceptance harness uses a hybrid N-1 baseline: exact schema-v1 install-state bytes and real Postgres run beside a Compose-labelled health sentinel that occupies the baseline portal identity until the governed promoter replaces it with the fully built candidate portal. The gate therefore still proves pre-promotion health, non-mutating readiness, signed state migration, exact recovery bytes, database migration, candidate image provenance, and post-swap health without compiling an old portal whose application behavior is outside this migration's evidence claim. This bounded design was selected by the structured WWMD refinement `DI-2C0CB7C2CACC` (high confidence, 1.084 margin); the preceding unstructured consultation `DI-6F1E9F9E5B94` was retained in the ledger but rejected as insufficiently discriminating (low confidence, 0.019 margin).

## 6. Acceptance criteria

1. The reported legacy Windows state projects successfully during read-only readiness, then migrates to schema version 2 after quiescence and before swap without manual editing.
2. Fresh and updated PowerShell/Bash/toolchain writers produce BOM-free state that validates immediately, and no writer persists an unclassified `platform` (`"unsupported"`) or a non-enum `arch`; `platform.sh`/`dpf_state_init` fail closed instead.
3. Projection is non-mutating before quiescence; persistence is versioned, idempotent, locked, compare-and-swap guarded, crash recoverable, atomic, bounded in backup creation, and runs after the recovery point but before swap.
4. Capability fields come only from the canonical resolver; schema requirements remain strict.
5. Corrupt, ambiguous, contradictory, and future-version state fails closed while the existing portal remains available.
6. Tests prevent a required schema change from landing without a schema-version migration.
7. The PR and capsule evidence reference WWMD decision `DI-C75A78147109`.
8. Any rollback after successful migration restores the exact pre-upgrade state before the baseline portal resumes; the recovery copy survives until durable candidate acceptance.
9. The existing `dpf_state_migrate()` (`state.sh`) and `Test-DpfStateSchema` older-version path (`state.ps1`) delegate to the one canonical migrator; no shell/PowerShell path stamps `schemaVersion` independently, and `validate-install-state.mjs` dispatches by version.
10. Rollback reuses the governed `$PROMOTE_BACKUP_PATH/install-state.json` recovery copy and its existing `EXIT`-trap restore; no second `pre-migration` artifact is introduced.
11. Install-state signing/locking follows governed substrate decision `DI-6D6D452E46D5`: reuse transition-protocol signing and promote.sh recovery; use one cross-runtime filesystem lock/CAS protocol for offline writers.
