# Install-State Readiness Migration Design

**Date:** 2026-07-18  
**Status:** Approved direction; pending document review  
**Governing decision:** `DI-C75A78147109` (WWMD, high confidence)  
**Parent design:** [`2026-07-18-install-upgrade-refactor-parity-design.md`](2026-07-18-install-upgrade-refactor-parity-design.md)

## 1. Incident and root cause

After PR #3276 made canonical install-state validation a pre-quiescence promoter-readiness gate, an existing Windows install failed with `promoter-readiness-failed: install_state_invalid`.

Live evidence showed three compatibility defects in `%USERPROFILE%\.dpf\install-state.json`:

1. a UTF-8 byte-order mark caused direct `JSON.parse` to fail;
2. the agent-toolchain bootstrap had recorded `platform: "unsupported"` instead of the canonical `win32` host value;
3. the state predated required `enabledRuntimeCapabilities`, `capabilityCatalogHash`, and `capabilityStateVersion` fields even though `schemaVersion` remained `1`.

The readiness gate behaved safely: it refused promotion before quiescence. The defect is that canonical writers and schema evolution did not provide an upgrade path for state already emitted by supported releases.

## 2. Decision and goals

WWMD decision `DI-C75A78147109` selected **canonical writers plus a versioned migration** over a readiness-only projection or globally loosening the schema.

This change must:

- make every canonical state writer emit BOM-free, schema-valid state;
- advance the install-state schema version when required fields are added;
- project known legacy states read-only and validate migration feasibility before portal quiescence, then persist only after quiescence and the recovery point but before swap;
- derive capability state through the existing canonical capability resolver;
- derive host platform from verified runtime input, never from a stale persisted value;
- atomically persist a successfully validated migration while retaining recovery bytes;
- reject unknown future versions, malformed JSON, unrecognized extra fields, and states that cannot be migrated without guessing;
- keep PowerShell and Bash behavior equivalent.

## 3. Architecture

### 3.1 One migration owner and N-1 execution carrier

A focused Node module under `scripts/installer/` owns parsing, migration planning, validation, and atomic persistence. Shell and PowerShell remain orchestration adapters. The module consumes the existing JSON Schema and the existing capability projection module; it does not duplicate schema fields, capability lists, or hashing rules.

The migration API has two modes embedded in the immutable candidate promoter image:

- **inspect/project**: the candidate promoter readiness entrypoint reads the state through its existing read-only mount, strips one leading UTF-8 BOM, validates the bounded legacy schema, produces a migrated in-memory value, and validates schema 2 without writing. Its signed report binds `migrationRequired`, source-state hash, target schema, projection hash, candidate promoter digest, and verified host platform;
- **migrate/write**: after quiescence, the promotion entrypoint in that exact previously validated candidate digest receives the existing writable lifecycle-state mount, verifies the source-state hash has not changed, acquires the shared state lock, re-projects and validates, then atomically persists schema 2 before source/database swap.

This is the executable bootstrap path for installs at or after the promoter-readiness protocol floor established by PR #3276: that baseline portal knows how to build/resolve the candidate promoter, run its readiness entrypoint read-only, and later launch the same digest for promotion. It does not need candidate host scripts or a host Node installation. The exact floor SHA is recorded in the promoter contract and acceptance fixture rather than inferred from `HEAD^`.

A production portal older than that floor cannot claim or enforce read-only projection and is outside this automatic migration path. Its transition remains visibly classified `legacy-bootstrap` under the parent design and must first use the supported installer/reinstall recovery path to repair lifecycle state; the CI-only compatibility bridge proves candidate behavior but is not presented as a production migration carrier. No baseline-baked migrator may claim candidate behavior.

Readiness remains non-mutating and the parent ordering remains authoritative. State persistence is a distinct, bounded **post-quiescence/pre-swap migration phase**, evidenced separately from readiness. The parent design is amended by this addendum: step 7 (governed recovery point) is followed by lifecycle-state migration, then promotion swap. A migration failure restores/retains the original state, resumes the old portal through governed recovery, and records `stage: state-migration`; it is never reported as a readiness failure. If persistence succeeds but any later swap, database, health, or acceptance step fails, rollback atomically restores the exact pre-migration state under the same lock before the baseline portal resumes.

### 3.2 Versioned schema registry

The schema version advances from `1` to `2`. Version 2 requires the governed capability snapshot fields and canonical platform values already described by the current schema. The repository retains immutable `install-state.v1.schema.json` and `install-state.v2.schema.json` artifacts plus a small version-dispatch registry. `install-state.schema.json` remains a pointer/current-schema artifact, not an independent rule copy.

Parsing dispatches by `schemaVersion`, validates the input against its immutable versioned schema, applies exactly one registered migration edge at a time, then validates the target schema. The v1 schema includes only historically emitted bounded shapes, including the known `unsupported` platform value and optional `agentToolchain`; it does not generally relax additional properties. A guard fails when a new required current-schema field lands without a schema-version increment and registered migration edge.

Migration `v1 -> v2`:

1. normalizes a leading BOM at the byte boundary;
2. replaces `platform: "unsupported"` only when the caller supplies a verified host platform (`win32`, `linux`, or `darwin`);
3. supplies missing capability fields by calling the canonical capability resolver in migration mode. The resolver's exported `PRE_PROFILE_COMPATIBILITY_CAPABILITIES` is the authoritative legacy default; the candidate-embedded capability catalog is the authoritative catalog for the target version. Host vocabulary maps explicitly as `win32 -> windows`, `darwin -> macos`, and `linux -> linux`;
4. preserves recognized optional fields, including `agentToolchain`;
5. sets `schemaVersion: 2` only after the migrated object validates against schema 2.

If a version-1 object contains an invalid non-legacy platform, contradictory capability state, malformed dates, unknown properties, or a platform that cannot be verified, migration refuses with bounded field-level errors. Version greater than 2 refuses as `install_state_newer_than_runtime`.

### 3.3 Writer repair

The PowerShell installer state library uses `UTF8Encoding($false)` for every full-state write, not only initialization. The Bash library writes through atomic temporary files and produces plain UTF-8 JSON. The agent-toolchain bootstrap must update only its owned `agentToolchain` property through the canonical state adapter; it must not initialize or overwrite host identity with an `unsupported` placeholder.

Fresh initialization includes every version-2 required field. Any writer-side regression is caught by a shared contract test that executes representative PowerShell and Bash writes and validates the resulting bytes and schema. Installer and bootstrap adapters must use the same shared lock and compare-and-swap writer described below.

### 3.4 Locking, atomicity, and crash recovery

Every canonical install-state writer coordinates through one lock file adjacent to the state. Lock acquisition uses exclusive creation with owner/run metadata, bounded expiry, and stale-owner recovery; no writer performs read/project/write outside that lock. Immediately before replacement, the migrator compares the canonical byte hash with the readiness-bound source hash. A mismatch aborts as `install_state_changed_after_readiness` and triggers governed resume/rollback rather than discarding concurrent updates.

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

The persisted original is retained as `install-state.v1.pre-migration.json` (or an equivalently deterministic bounded name) until the candidate portal is durably accepted and the self-upgrade lifecycle completes. Every rollback restores that exact original before resuming the baseline, even if the baseline could parse v2, so rollback restores the complete pre-upgrade contract. Repeated migration is idempotent and does not create unbounded backups. Atomic replacement failure leaves the original canonical file intact.

No code edits the reporter's live state as a one-off repair. Existing installs recover through the shipped migration so the same path serves every adopter.

## 4. Data flow

1. Portal preflight resolves the canonical host state path and verified host platform.
2. The immutable candidate promoter readiness entrypoint mounts state read-only and validates v1 or v2.
3. The canonical capability resolver creates a v2 projection and hashes the source/projection into readiness evidence.
4. Only a passing readiness report permits quiescence and recovery-point creation.
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
- canonical capability resolution and hash validation;
- malformed JSON, unknown properties, unverifiable platform, contradictory capabilities, and future-version refusal;
- atomic-write failure preserving the original;
- concurrent writer/CAS refusal and crash injection at every transaction stage;
- readiness ordering proving read-only projection finishes before quiescence and persistence occurs only after recovery-point creation but before swap;
- source-floor execution proving the old portal invokes candidate-digest projection and that the same digest performs persistence;
- post-migration swap/health failure proving rollback restores v1 before the baseline resumes;
- a production-shaped candidate readiness run against migrated state.

The mandatory gates remain targeted Node/Vitest tests, PowerShell 5.1 parsing/behavior checks, Bash syntax/ShellCheck, web typecheck, production build, and self-upgrade compatibility acceptance.

## 6. Acceptance criteria

1. The reported legacy Windows state projects successfully during read-only readiness, then migrates to schema version 2 after quiescence and before swap without manual editing.
2. Fresh and updated PowerShell/Bash/toolchain writers produce BOM-free state that validates immediately.
3. Projection is non-mutating before quiescence; persistence is versioned, idempotent, locked, compare-and-swap guarded, crash recoverable, atomic, bounded in backup creation, and runs after the recovery point but before swap.
4. Capability fields come only from the canonical resolver; schema requirements remain strict.
5. Corrupt, ambiguous, contradictory, and future-version state fails closed while the existing portal remains available.
6. Tests prevent a required schema change from landing without a schema-version migration.
7. The PR and capsule evidence reference WWMD decision `DI-C75A78147109`.
8. Any rollback after successful migration restores the exact pre-upgrade state before the baseline portal resumes; the recovery copy survives until durable candidate acceptance.
