# Governed Platform Upgrade Lifecycle

| Field | Value |
| --- | --- |
| Date | 2026-05-23 |
| Status | **Repo-grounded + Chief Architect reconciled (versioning reality, quiescence extraction, partial Phase 0 substrate)** — see §1.1 below. Not yet binding for Phases 2+. |
| Primary epic | None linked yet. Live backlog item `BI-5B3FA415` is in `triaging`; live open-epic scan found no existing platform-upgrade epic to extend. |
| Related backlog | `BI-5B3FA415` Governed platform upgrade lifecycle; child `BI-40F05BAC` Activity Quiescence Protocol (extracted and CA-reviewed 2026-05-24) |
| Related docs | `docs/superpowers/specs/2026-05-09-deployment-contracts.md`; `docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`; `docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md` (replaces former §5.5 drain detail); `docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md`; `docs/triage/2026-05-22-overnight-session-summary.md`; `2026-04-20-ship-phase-fork-redesign-design.md`; `apps/web/lib/platform/version.ts` + `image-version.ts` (realized versioning substrate, see §2.1 / §4.1) |
| Triggering signals | `project_self_upgrade_kills_in_session_ux.md` (bundle-hash recycle during sibling merges); `project_archetype_is_bootstrap.md` (write-once seed problem); `feedback_db_seed_migration_sync.md` (manual patches lost on fresh install); `project_silent_seed_skips_audit.md` (three silent-skip failures, 2026-04-17). These are memory signals; repo-local anchors are listed in References. |

## 1. Purpose

DPF has no governed process for keeping a running install current as upstream `main` evolves. Today's self-upgrade substrate is partially implemented and split across legacy and newer paths: `apps/web/lib/queue/functions/portal-self-upgrade.ts` still exposes daily/manual legacy events that now call stubs, while `apps/web/lib/queue/functions/self-upgrade.ts` is the newer hourly/manual path behind `/ops/self-upgrade`. Both paths remain SHA-oriented and neither understands release versions, database migration risk, archetype/seed deltas, sandbox work in flight, or pending hive contributions. Operators experience server actions 404'ing mid-flow, executor flows dropping, customizations silently overwritten, or stale installs frozen at an old archetype forever.

This spec defines a **governed upgrade lifecycle** with six concerns separated:

1. **Release-side**: how `main` becomes a published, versioned, signed artifact that installs can consume.
2. **Detection**: how an install learns a new release exists and decides whether to act.
3. **Preflight**: how the install gathers evidence about what an upgrade would touch — across four layers (code, schema, seed deltas, sandbox/contribution) — and surfaces that evidence to the operator for explicit approval.
4. **Apply**: how the install transitions cleanly without dropping in-flight executor work or stranding UI clients on stale bundles.
5. **Rollback**: how the install recovers when any phase fails, layer-by-layer, with the realistic constraint that schema migrations are the point of no return.
6. **Substrate cleanup**: how the currently split self-upgrade code path is stabilized before new architecture is layered on top.

The goal is not zero-touch auto-update. The goal is for the operator to be able to keep their install current **often and reliably** — receiving upstream evolution (including their own hive contributions flowing back) without losing customizations, in-flight work, or system integrity, and with a single concept (versioned releases gated by evidence) covering all sources of divergence.

## 1.1 Chief Architect Reconciliation (2026-06-xx)

**Scope of this review:** Re-grounded the spec against live codebase (self-upgrade/*, platform/version.ts + image-version.ts, prisma schema, absence of SeedSnapshot/SEED_REGISTRY, Sandbox model presence, quiescence extraction, current promoter behavior). Cross-checked against AGENTS.md (esp. §1 principles, §4 worktree rules, §5 verification), deployment-contracts doctrine (Contracts 1/3/6), founder-kernel principles (never-ask-user-to-run-commands, worktree-is-source-control-not-runtime, fix-the-seed-not-the-runtime), and sibling specs (quiescence 2026-05-24 which already carries "Chief architect review applied").

**Key findings & ratified decisions:**

1. **Platform versioning reality diverged from §4.1 / Phase 1 vision (accepted).**
   - Spec envisioned: `version.json` at root as source-of-truth, updated by release CI, committed + tagged, mirrored to `PlatformConfig["platform.version"]` at boot, `/api/platform/version` etc.
   - Reality (grounded in `apps/web/lib/platform/version.ts:56` and `image-version.ts`): `version.json` is **explicitly DEV FALLBACK ONLY** ("0.0.0" with note "The real platform version is sourced from git release tags (git describe) and baked into built images at /app/.dpf-platform-version"). Actual mechanism: release tags (already shipping in v5.x range per baked markers) + build-time `DPF_PLATFORM_VERSION` / `.dpf-platform-version`, `.dpf-image-version`, `.dpf-source-content-hash`, `.dpf-image-built-at` files. `loadPlatformVersion()` prefers the baked tag, falls back to version.json only for non-git/dev. `sourceContentHash` exists precisely to detect label-vs-bytes divergence (the BI-C8E90A79 class of failure the spec worried about).
   - **Chief Architect decision:** Ratify the pragmatic baked-git-describe + image-marker path as canonical. It solves the "chronically stale hand-edited version.json" problem the implementers observed. Update §2.1, §3.2, §4.1, Phase 1, and acceptance criteria to describe the **actual** substrate rather than the original proposal. Release CI obligations for manifests, signing, seed-deltas, migration classification, and channel feed remain fully valid and even more important now that the version identity is honest. `PlatformConfig` mirror is optional convenience, not required. The "single answer to what version am I running" invariant is already approximately satisfied via `loadPlatformVersion()`.

2. **Phase 0 substrate stabilization — partial but real progress.**
   - One canonical Inngest path (`self-upgrade.ts`) is active; legacy `portal-self-upgrade.ts` stubs acknowledged.
   - Promoter, prepare-source, version helpers, and activity deferral exist.
   - **Major extraction win:** Detailed drain protocol moved to its own CA-reviewed spec (`2026-05-24-activity-quiescence-protocol-design.md`, BI-40F05BAC) with per-surface inventory (30 surfaces), coordinator, and client contract. Parent spec §5.5 correctly now delegates to it. This is the right factoring.
   - Remaining Phase 0 gaps per current code: still SHA-oriented target resolution (no channel manifest), `resolveTargetSha` returns null in some paths, DTO/schema alignment incomplete, no durable per-install branch + merge yet (§5.0 / BI-UPGRADE-000a/000b — critical for "lost on rebuild" and non-technical operators).
   - Sandbox model (exact proposed shape) landed at schema:4796 independently — good, but L4 preflight must now consume it + FeatureBuild relations.

3. **Customization fingerprint / 3-way merge (core of §6, the 13-mode problem) — zero implementation progress (highest remaining risk).**
   - Still only `isOverridden` on three models; no `seedContentHash`, `SeedSnapshot`, `SEED_REGISTRY`, no 5-field mixin, no backfill story executed. 13 reconciliation modes remain ad-hoc. This is the exact "skip or clobber / silent freeze" hazard the spec was written to close. Without it, Phases 3–4 deliver little operator value. **Priority recommendation:** Elevate BI-UPGRADE-004/005/009 to earliest possible slice after Phase 0/1 stabilization. The seed-registry.ts + Snapshot table is the fix-the-seed-not-the-runtime invariant guard the kernel principles demand.

4. **L4 worker worktree + contribution reconciliation + architecture capture:** Cross-reference to `2026-05-09-build-execution-provider-design.md` (Grok as dpf-native or peer runner, PAR decisions, and the new "Mandatory Architecture Capture for All Future AI Agents..." section) is correct and consistent with worktree principle. Self-upgrade (and any future upgrade-related AI or Build Studio work) must never treat worker worktrees as canonical runtime and must not propose changes that bypass the provider/runner model or the orchestrator. The architecture capture section in the sibling spec is now explicitly part of the governed lifecycle invariants.

5. **Overall assessment:** The spec's problem statement, four-layer evidence model, bump-type gates, recovery-point discipline, rollback decision tree, and acceptance criteria remain excellent and mostly un-changed by the versioning divergence. The architecture is sound; the main work is now **reconciliation of the doc with the realized substrate + aggressive execution on the seed-fingerprint primitive**. This doc + the quiescence child + the build-execution sibling together form the governed lifecycle backbone.

**Action items for next revision of this spec (before Phase 2 CI work):**
- Rewrite §2.1, §3.2, §4.1, and Phase 1/2 descriptions to match the baked-tag + image-marker reality (with pointers to the two lib/platform/*.ts files as the implementation anchors).
- Add explicit "version identity sources" table (git tag, sourceContentHash, image labels, loadPlatformVersion()).
- Note that release CI must still produce the channel manifest, signed deltas, SBOM, etc., even if it no longer mutates a committed version.json.
- Confirm with release-engineering whether the current tag + bake scripts already satisfy the "no human ritual" and "every merge → edge candidate" requirements.
- Ensure any implementation work (especially AI-assisted or Build Studio-generated) that touches self-upgrade, promotion, or L4 reconciliation cites and respects the "Mandatory Architecture Capture" section in the 2026-05-09 build-execution-provider sibling spec.

This reconciliation keeps the doc as the single source of truth while honoring the "never fabricate / ground in code" and "architecture over shortcuts" principles.

## 1.2 Chief Architect Pass-2 (2026-06-02)

A second architect review folded into this spec after the PR #1414 substrate-topology pass. None of the 9 findings overlap with §1.1 or PR #1414's edits.

**Corrections folded into this revision:**

1. **Enum value convention normalized to hyphens** (AGENTS.md §11). `PreflightRun.status` value `awaiting_operator` → `awaiting-operator`. `fingerprintMode` values `CONTENT_HASH | OVERLAY | EXCLUDED_FIELDS | AUDIT_TRACE` → `content-hash | overlay | excluded-fields | audit-trace`. All spec-introduced string enums use hyphens; underscores and SCREAMING_SNAKE are not DPF convention.
2. **`PreflightRun` vs `SelfUpgradeRun` two-table split justified.** §5.2 now states why a single `SelfUpgradeRun` with a phase discriminator was rejected (N preflights can fan out to M apply attempts; operator timeline needs independent lifecycle queries; pre-commit advisory state has no place on the apply audit row). (`schema-audit-before-features`, `verify-substrate-before-proposing-new`.)
3. **`PlatformConfig` version mirror removed.** §4.1's "may carry a convenience mirror" was a single-source-of-truth landmine — a mirror that exists in code WILL be read by some code path eventually, and any stale read reintroduces the BI-C8E90A79 class of identity drift the spec is built to close. The mirror is now explicitly rejected; all callers consume `loadPlatformVersion()` directly. (`single-source-of-truth`, `architecture-over-shortcuts`.) AC 2 updated to match.
4. **`seedContentHash` semantics per fingerprint mode documented.** §6.4 now names what gets hashed in each of the four modes: `content-hash` → full canonical content body; `overlay` → kernel-version reference (`kernelPageId@derivedFromKernelVersion`), NOT a content hash; `excluded-fields` → hash over the complement of `excludedFields[]`; `audit-trace` → `seedContentHash` remains null, revision walk is the merge base. Implementers had no way to apply the 5-field mixin uniformly without this clarification.
5. **5-field mixin blast radius enumerated.** §6.2 now lists each model receiving the mixin (5 ad-hoc patterns today, ~10 needed via the registry) and confirms each addition is `additive` under §4.5 rule 3 so the migration does not force a major bump under the spec's own gates.
6. **§5.6 L4 rebase-failure gap closed.** Rollback decision tree now covers the case where a capsule's PAR `rebase` or `promote-first` decision fails after the upgrade succeeds.
7. **§9 AC 3 fallback wording added.** `releases.dpf.dev` unreachable → GitHub Releases API fallback (stable-channel-only) per §5.1.
8. **§9 AC 10 detection path named.** `FeaturePack` auto-acceptance now references the seed-delta-manifest PR-list join, not a magic match.
9. **BI-C26F7EE1 no-fabrication regression-test AC added.** Unit-test bullet locks in the "LLM never adds/drops/reorders items" contract in §5.0.1.

**Reference-doc follow-up (not folded here; proposed as separate work):** capture the **"version identity is baked, not committed"** pattern from §1.1 / §4.1 as either an AGENTS.md §2 deployment-doctrine paragraph or a kernel principle slug `version-identity-baked-not-committed`, citing `apps/web/lib/platform/{version,image-version}.ts` as the canonical implementation and `version.json` as DEV-FALLBACK-ONLY. This is a generalizable architectural choice that should be captured at kernel level so future installer/release/distribution specs reach for it by default.

## 2. Current Repo Truth Checked

> Updated 2026-05-31 after operator concern about seed clobbering, schema
> migration safety, rollback, and BC/DR. This section documents how the system
> behaves **today**, before the full governed lifecycle in §§4-7 exists.

### 2.1 Platform versioning gap (partially closed by pragmatic substrate; spec vision diverged)

**Post-CA-reconciliation note (2026-06-xx):** The original §4.1 vision (committed `version.json` as source of truth + `PlatformConfig["platform.version"]` mirror) was not followed. A more robust baked mechanism landed instead (see §1.1 and §4.1 update below). The gaps that remain are real but narrower than originally written.

Current observed state (code-grounded):
- Root `package.json` has **no `version` field** (unchanged).
- Sub-package versions remain internal 0.x; platform identity is separate.
- **Real platform version source (ratified):** `apps/web/lib/platform/version.ts:loadPlatformVersion()` + `image-version.ts`. Prefers baked `/app/.dpf-platform-version` (from `git describe --tags` at build time, e.g. "5.6.0" or "5.6.0-35-g..."), falls back to `version.json` (now explicitly documented as DEV FALLBACK ONLY, currently "0.0.0"). Additional honest markers always present in images: `.dpf-source-content-hash` (sha256 of exactly what was bundled — detects label/bytes drift), `.dpf-image-built-at`, `.dpf-image-version`.
- `SelfUpgradeRun` and current self-upgrade path (`self-upgrade.ts`, `promoter.ts`) remain SHA / bundle-hash oriented. No semver, no channel manifest, no `minimumFromVersion` enforcement yet.
- `/ops/self-upgrade` still shows SHAs primarily; `loadPlatformVersion()` is the emerging single source for "what am I running?" (UI, health, MCP surfaces should converge on it).
- Consequence (updated): The "every merge looks like an upgrade" problem is mitigated for *identity* (tags + content hash give real signal), but the full governed detection / preflight / risk-grading still requires the release CI + channel manifest + bump-type machinery in §§4–5. The pragmatic versioning win means Phase 1 baseline is **partially delivered** in a better form than originally specified; the remaining work is wiring the honest version into the upgrade decision surfaces and the manifest feed.

**Recommendation:** Treat the current baked-tag + content-hash + `loadPlatformVersion()` as the canonical "Contract 1 release artifact identity" implementation. Release CI must produce the additional artifacts (manifest, deltas, signatures) around those tags.

### 2.2 Self-upgrade machinery (partial foundation exists)

- `apps/web/lib/queue/functions/portal-self-upgrade.ts` defines the legacy daily 8am scheduled function, manual request, and 15-minute completion sweep. Its `runSelfUpgradeCycle` and `completePendingSelfUpgradeRuns` targets are now compatibility stubs in `apps/web/lib/self-upgrade/index.ts` and `apps/web/lib/self-upgrade/completion.ts`.
- `apps/web/lib/queue/functions/self-upgrade.ts` is the newer active path: hourly cron, manual event `ops/self-upgrade.run`, maintenance-window gating, one-run concurrency, active-portal deferral, `runPromoter`, and run status updates.
- `apps/web/lib/self-upgrade/version.ts` still returns `null` from `resolveTargetSha(_channel)`, so the newer path currently skips with `no-target` until target-channel resolution is implemented.
- `apps/web/lib/self-upgrade/activity.ts` defers upgrades when non-edge `ToolExecution` activity occurred inside the last five minutes. This is a useful stopgap, but it is not a graceful drain protocol and it has no per-session client handshake.
- `apps/web/lib/self-upgrade/notifications.ts` exposes `emitUpgradeEvent`, but it is a no-op until the event bus is wired.
- `scripts/promote.sh` validates environment, backs up the source directory, builds a Docker image, force-recreates Compose services, checks health, and verifies SHA. It does **not** fetch/checkout the target SHA, run migrations, apply seed deltas, drain clients, or automatically roll back on failure.
- `SelfUpgradeRun` schema fields: `trigger`, `currentSha`, `targetSha`, `deployedSha`, `failureLog` (Text), `completionEvidence` (Json), `reason`, `promoterContainerName`. The DTO drift noted in the original spec (actions using `triggeredBy/fromVersion/toVersion/error`) has been resolved — `run-store.ts` uses the schema field names directly. Three additional signals are now live: (a) `status` includes `'deferred-conflict'`, written by the orchestrator when `prepareUpgradeSource` returns `reason: 'merge-conflict'`; (b) `failureLog` is used as a structured conflict-file carrier, formatted as `'merge-conflict: <file1>, <file2>'` — the Upgrade Center must parse this prefix to display which files conflict; (c) `completionEvidence` carries a `recoveryPoint` JSON object via `recordRunRecoveryPoint` in `run-store.ts`, which the rollback path reads to determine restore feasibility. The schema/DTO vocabulary is now consistent and the 'must be resolved' blocker is closed.
- Ship-phase `FeatureBuild`s are auto-completed only if their head SHA is an ancestor of the deployed SHA (via `git merge-base --is-ancestor`). Diverged branches never complete.

**Phase 0 implication:** the first implementation slice is not versioning. It is stabilizing the self-upgrade substrate so there is exactly one runnable path, one DTO vocabulary, one status vocabulary, and one operator surface.

### 2.3 Customization fingerprint — three ad-hoc patterns, no merge base

Grep against `packages/db/prisma/schema.prisma` confirms:

- `isOverridden Boolean @default(false)` — appears on **three models**:
  - `PromptTemplate` (line 8329) — "true when admin has edited from seed default"
  - Two additional models at lines 8383 and 8403 (comment: "admin edited at runtime — seeder will skip")
- `derivedFromKernelVersion String?` — only on `WikiPage` (line 7988); paired with `kernelPageId` for kernel-overlay pattern.
- `StorefrontArchetype` upsert excludes `isActive` from the update clause (implicit pattern; no schema marker).

Revision tables exist for `BuildArtifactRevision`, `SkillRevision`, `KnowledgeArticleRevision`, `WikiPageRevision`, `PromptRevision` — so audit-trace history is partially in place for 5 models.

**Critical gap:** there is no `seedContentHash`, `shippedContent`, `seededAt`, or `seedVersion` column **anywhere in the schema**. The boolean `isOverridden` records *that* the operator changed something, but the **upstream merge base is not stored anywhere** — so true 3-way merge is impossible today. Current behavior is "skip on overridden," which is the only safe option without a base.

### 2.4 Thirteen distinct contribution / customization modes (Q1 inventory)

The Q1 research identified 13 modes where a running install diverges from a fresh upstream pull, each with its own reconciliation behavior today:

| # | Mode | Direction | Reconciliation today |
|---|---|---|---|
| 1 | Prompts in DB | ↔ | Skip on `isOverridden`, silent divergence |
| 2 | Skills (disk-sourced) | ← | SkillAssignment FK fails silently; assignments orphan |
| 3 | Principle kernel | ← | Overlays stale; `wiki_lint` detectors flag but no auto-rebase |
| 4 | Storefront archetype | ← | Excludes `isActive`; new marketing rules applied without warning |
| 5 | Coworker grants / skill assignments | ← | Grants not reconciled; orphans on upstream removal |
| 6 | Hive contribution (`FeaturePack`) | → | No auto-sync after upstream merge; manual `accepted` flag |
| 7 | Self-upgrade run audit | ← | SHA-based; diverged branches never complete |
| 8 | Database migrations | ← | Forward-only; no rollback; partial application on failure |
| 9 | Master seed (`packages/db/src/seed.ts`) | ← | Documented silent-skip modes: FK fail, missing manifest, catalog timeout, IT4IT path miss |
| 10 | Brand & org config | (local) | Local-only; upstream changes to defaults not merged |
| 11 | MCP service definitions | ← | Operator edits respected on upsert; endpoint changes need manual approval |
| 12 | IT4IT taxonomy | ← | Append-only; reparenting orphans assignments |
| 13 | Work capsules | (local) | Session-local; orphan on branch delete; advisory scope claims |

The 13 modes have no shared abstraction, no shared registry, and no shared evidence surface.

### 2.5 Spec directory and conventions

Specs live at `docs/superpowers/specs/YYYY-MM-DD-<name>-design.md`. Recent comparables: `2026-05-22-build-studio-sandbox-admin-recovery-design.md`. This spec follows the same format and grounds its design in the same kind of code-truth-first analysis.

### 2.6 Research & Benchmarking

This design follows the repo rule that new feature specs compare real standards and comparable products before finalization.

**Standards adopted**

| Standard | What it contributes | DPF decision |
|---|---|---|
| [Semantic Versioning 2.0.0](https://semver.org/) | `MAJOR.MINOR.PATCH` communicates incompatible changes, backward-compatible features, and bug fixes. Once released, a version must not be modified. | Use SemVer for platform releases. The DPF public API is the installed-runtime contract: routes, MCP surface, DB migration contract, seed registry, config/env schema, and release artifacts. |
| [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/) | `fix` maps to patch, `feat` maps to minor, and `BREAKING CHANGE` or `!` maps to major. | Use PR labels/merge commit metadata as the source for release bump calculation. Direct commit history is advisory because DPF squashes PRs. |
| [Sigstore/cosign keyless signing](https://docs.sigstore.dev/cosign/signing/overview/) | Keyless signing binds signatures to OIDC identities and logs signing events in a transparency log. | Use GitHub Actions OIDC + cosign for image and manifest signatures. Avoid long-lived signing keys in the first implementation. |
| [GitHub Releases API](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#get-the-latest-release) | The latest-release endpoint returns the most recent non-draft, non-prerelease release. | GitHub Releases can host immutable release notes/assets, but cannot be the only channel model because `edge`/`beta` need prerelease/channel semantics. DPF needs its own signed channel manifest. |

**Comparable products**

| Product | Pattern | Adopt | Reject |
|---|---|---|---|
| [GitLab self-managed](https://docs.gitlab.com/policy/maintenance/) | SemVer, predictable monthly minor releases, scheduled patch releases, and major releases for backward-incompatible changes. | Major/minor/patch meaning and explicit upgrade paths. | A fixed monthly cadence is too slow for DPF's dogfood/hive loop; DPF needs `edge` for every accepted release. |
| [Chrome release channels](https://developer.chrome.com/docs/web-platform/chrome-release-channels) | Canary/Dev/Beta/Stable channels, staged rollout, metrics-backed pause/respin. | Channel promotion and staged adoption from `edge` to `stable`. | DPF should not silently roll a release to all installs or phone home with identifiable telemetry by default. |
| [WordPress automatic background updates](https://developer.wordpress.org/advanced-administration/upgrade/upgrading/#configuring-automatic-background-updates) | Automatic updates split by core/plugin/theme/translation, with major/minor controls. | Layered update classes and operator-configurable automation. | DPF cannot treat seeded content like normal code; prompts, archetypes, principles, and operator edits require 3-way merge evidence. |

**Project-specific benchmark**

`docs/superpowers/specs/2026-05-09-deployment-contracts.md` is the controlling DPF doctrine. It says release runtimes consume versioned multi-arch GHCR images and that lifecycle operations include update, backup, restore, and rollback. Therefore this spec must not invent a GitHub-release-only bundle path. GitHub Releases can publish release notes, manifests, checksums, and downloadable metadata; GHCR image digests are the installed-runtime artifact references.

### 2.7 Current install/update behavior, in plain sequence

The current production path is split between **install/startup initialization**
and **self-upgrade apply**.

**Install/startup initialization (`portal-init`).**

`docker-compose.yml` starts `portal-init` before `portal`. `portal-init` runs
`docker-entrypoint.sh`, which currently does:

1. `pnpm --filter @dpf/db exec prisma migrate deploy` with retry.
2. Provider registry sync.
3. `pnpm --filter @dpf/db exec tsx src/seed.ts`.
4. Model capability reconciliation.
5. Credential health check.
6. Optional hardware detection.
7. Source-volume bootstrap.

Only after `portal-init` exits successfully does Compose start `portal`.
Migrations are therefore the first database mutation in the boot path. Seeds
run after migrations, and seed errors are currently logged as warnings in the
entrypoint (`|| echo "WARN Seed had warnings (non-fatal)"`).

**Current seed safety varies by seed family.**

| Seed family | Current behavior | Customization risk |
|---|---|---|
| `PromptTemplate` from `prompts/*.prompt.md` | Looks up by `category + slug`; updates when `isOverridden=false`; skips when `isOverridden=true`. | Low clobber risk if every runtime edit flips `isOverridden`; stale prompt risk when skipped forever. |
| Deliberation patterns / roles | Mirrors prompt behavior; `isOverridden=true` is skipped. | Low clobber risk; stale skipped row risk. |
| `SkillDefinition` from skill files | Updates existing rows unconditionally and reconciles assignments. | High clobber risk for any admin-edited skill content because no `isOverridden` field exists today. Treat as platform-owned until §6 lands. |
| Platform roles / agents / model providers / provider registry | Upserts and updates canonical fields from seed/registry. | Expected for platform-owned defaults; risky if operators are allowed to edit same fields directly. |
| Organization / credentials / selected config rows | Many use `update: {}` or narrow updates to preserve local values. | Safer, but safety is per-row implementation, not centrally declared. |
| Storefront/archetype/reference data | Mixed: some fields are intentionally excluded, others updated. | Requires registry formalization; today it is easy to miss which columns are operator-owned. |

**Current self-upgrade apply.**

The newer self-upgrade path (`apps/web/lib/queue/functions/self-upgrade.ts`)
prepares source, starts quiescence, then invokes `runPromoter`. The promoter
currently:

1. Records the previously deployed SHA in
   `/backups/self-upgrade/<runId>/previous-sha.txt`.
2. Builds the portal image from the prepared source.
3. Recreates the `portal` container only.
4. Checks `/api/health`, `/api/health/sha`, and the baked source-content hash.

Implementation note (2026-06-01): `runSelfUpgrade` now creates a
`pre-upgrade-recovery` point after quiescence has drained active work and
before promoter execution. It reuses the existing Postgres, Neo4j, and Qdrant
backup runners, records the resulting `BackupRun` ids under
`SelfUpgradeRun.completionEvidence.recoveryPoint`, and fails the upgrade before
the swap boundary if any data-store backup fails.
The promoter's own `/backups/self-upgrade/<runId>/previous-sha.txt` remains
**not a data backup**; it is only a rollback hint for the previous runtime
identity. Daily platform-managed backups still exist separately for Postgres,
Neo4j, and Qdrant under `/backups/<target>/...`, with `BackupRun` rows and
retention. Restore runners exist for all three targets, and Postgres also has
trial-restore verification.

Implementation note (2026-06-02): `/ops/self-upgrade` now exposes a
first-class recovery-point restore action for completed non-running runs with a
complete `SelfUpgradeRun.completionEvidence.recoveryPoint`. The action acquires
the shared restore lock once, restores Postgres, Neo4j, then Qdrant from the
matched `BackupRun` rows, writes `self-upgrade-rollback` into
`BackupRestore.trigger` for each member, and records
`SelfUpgradeRun.completionEvidence.rollback` with per-member restore results.
The remaining gap is layer-aware automatic rollback; this action is an operator
confirmed restore from the pre-upgrade data recovery point.

### 2.8 What can go wrong today

| Failure mode | Today impact | Current mitigation | Gap this spec closes |
|---|---|---|---|
| Seed overwrites production-tuned parameters | Any seed path that updates unconditionally can clobber local changes. Historical pattern: runtime tuning lost on next seed. | Some families use `isOverridden`; some upserts preserve local fields. | `SEED_REGISTRY`, `SeedSnapshot`, content hashes, and three-way merge make overwrite policy explicit per model/field. |
| Seed skips customized rows forever | `isOverridden=true` prevents clobbering but also prevents upstream fixes from reaching that row. | Safe skip. | Preflight shows base/ours/theirs and lets the operator merge. |
| Seed warning is non-fatal | Portal can start with partial reference-data drift if a seed module catches/logs and continues. | Logs. Some modules fail loudly internally. | Preflight turns seed deltas into evidence; apply records per-delta outcome and blocks on mandatory failures. |
| Migration fails during boot | `portal-init` fails and `portal` does not start. Existing version may already be stopped/recreated depending on how apply was invoked. | Compose dependency prevents starting an incompatible portal after init failure. | Shadow-DB dry run before apply; layer-aware rollback / restore decision. |
| Migration partially applies | Prisma migrations are transactional when the database and SQL allow it, but not every operational failure is reversible in practice. | Manual restore from backup. | Migration kind classification, reverse migration only for additive changes, and pre-upgrade recovery point. |
| New code expects new seed rows that failed to load | Runtime can fail in paths that assume reference rows exist. | Ad hoc guards. | Seed apply becomes part of L3 evidence and smoke-window checks include route/tool sanity. |
| Portal image swap fails health check | Current script exits failed; prior container may have been replaced. | Run marked failed; previous SHA recorded. | Automatic L1 image rollback when no post-L2 constraint prevents it. |
| Upgrade happens during in-flight work | Requests/SSE/tool calls can drop or resume poorly. | Activity Quiescence Protocol is partially implemented and called by current self-upgrade. | §5.5 binds apply to quiescence before migrations/swap. |
| New Build Studio worker runs in a separate worktree | Worker output can be stranded, overwritten, or misclassified as runtime evidence if the worktree is invisible to upgrade preflight. | Worktree-per-session and worktree-is-source-control-not-runtime principles now exist; contributor inventory can observe worktrees. | Layer 4 preflight treats worker worktrees as first-class collisions and forces PAR decisions before apply. |
| Backup exists but is stale/corrupt | Restore point may be too old or unusable. | Nightly backups + Postgres trial restore. | Pre-upgrade recovery point with integrity checks and links to `BackupRun` evidence. |
| Catastrophic host/volume loss | Docker volumes are not recoverable by Docker. | Host-bound `/backups`; DR runbook. | Upgrade Center links rollback/restore decisions to the same BC/DR substrate. |

### 2.9 Interim operating rules until the governed lifecycle lands

These rules bind self-upgrade, manual promotion, Build Studio workers, and
external agents until the full preflight/apply/rollback implementation exists.

1. **Treat seed changes as production data changes.** Seeds are not
   fresh-install-only today; `portal-init` runs `seed.ts` after migrations.
   Any change to prompts, skills, provider registry, archetypes, grants, or
   reference rows must be reviewed as an update-time mutation.
2. **Never claim seed safety without a declared owner.** Platform-owned fields
   may be overwritten by seed. Operator-owned fields must either be preserved
   by explicit code today or routed through the future `SEED_REGISTRY` /
   `SeedSnapshot` three-way merge path. Silent skip is safer than clobber, but
   it is still drift and must be visible.
3. **Do not apply schema-changing updates without a recovery point.** Until
   migration classification and shadow-DB dry runs are implemented, any update
   that introduces Prisma migrations needs a verified Postgres backup before
   apply. Neo4j/Qdrant backup requirements follow whether the release touches
   graph/vector data.
4. **Rollback is layer-specific, not magical.** Code/image failures before
   schema migration can roll back by returning to the previous runtime identity.
   After L2 migration succeeds, rollback is roll-forward or restore-from-backup
   unless the migration is additive and a reverse path was verified.
5. **Worker worktrees are evidence subjects, not runtimes.** Grok, Codex,
   Claude, and Build Studio workers may use separate worktrees for source
   isolation. Their `.dpf-worktree-readiness.json` classification determines
   whether cheap local gates are meaningful. Runtime-bound evidence still comes
   from the canonical install or shared local-CI sandbox.
6. **Dirty active worker output blocks apply.** An upgrade may proceed past L4
   only after dirty worktree output is committed, captured, intentionally
   abandoned, or reassigned through PAR. A `source-only` worktree is not a
   failure; pretending it passed local gates is.

## 3. Problem Statement

### 3.1 Three distinct kinds of upstream change conflated

Today the install has no durable boundary between "a commit exists upstream" and "this install should apply a release." When target resolution is wired directly to git SHAs, every merge to `main` becomes one undifferentiated event: "code changed, recycle." But in reality there are three orthogonal kinds of change, each needing different handling:

- **Code-only change** (a route added, a component updated) — recycle is appropriate, no data implications.
- **Schema change** (Prisma migration added) — must run migrations before recycle; partial application is the worst possible failure.
- **Seeded-content change** (prompt edited upstream, archetype refined, principle kernel page updated, new MCP service definition) — operator may have customized; naive re-seed clobbers customizations; skip-if-overridden freezes the install at the original version forever.

Self-upgrade today only has partial mechanics for the first kind. The current promoter does not run migrations, does not preflight live schema shape, and does not reconcile seeded content. The third kind is handled inconsistently across 13 modes with no merge base stored.

### 3.2 No platform version means no risk grading

Without a persisted platform version (`PlatformConfig["platform.version"]`) and a semver-aware release process, every upgrade looks the same: "bundle hash differs, recycle." Operators cannot tell whether they're about to apply a bug fix, a feature, or a breaking change. The preflight cannot grade its rigor by upgrade impact. The system cannot enforce "destructive migration only in major bumps." Hotfixes cannot be expedited past feature changes.

### 3.3 No merge base means no true 3-way merge

With `isOverridden` as the only customization marker and no `SeedSnapshot` of what was originally shipped, the install can never reconstruct the three corners of a 3-way merge (`base`, `ours`, `theirs`). The only safe behaviors are extreme: clobber operator edits, or freeze the install. There is no path to "show the operator what they changed, what upstream changed, and let them resolve."

### 3.4 Container swap drops in-flight state

Per the repo audit `docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md` and the triage summary `docs/triage/2026-05-22-overnight-session-summary.md`: server actions 404, executor flows drop, UX driving becomes unreliable during recycle. The cause is a hard container swap with no client-server handshake — UI clients hold references to a bundle that no longer exists, and SSE streams die mid-token without a "platform upgrading, please reconnect" event.

### 3.5 Failure recovery is manual

The current implementation can mark a run failed, but rollback feasibility is not modeled by layer and `scripts/promote.sh` does not execute an automatic rollback path. This violates the [`never-ask-user-to-run-commands`](../../../docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md) kernel principle when the operator is non-technical. The system must either recover itself or present an operator decision inside the portal.

### 3.6 Sandbox + contribution reconciliation invisible

A capsule in flight when upstream changes the files it touches has no defined handling. A `FeaturePack` in `contributing` status when its upstream PR merges has no auto-reconciliation back to `accepted`. Build Studio drafts cut from an old `main` are silently stale. None of this is visible to the operator at upgrade time.

## 4. Design — Release Side

### 4.1 Platform version is a first-class concept (ratified pragmatic implementation)

**Chief Architect update (2026-06-xx):** The design as originally written (CI-mutated committed `version.json` + `PlatformConfig` mirror as source) was superseded by a more honest baked mechanism during early implementation. The new mechanism **better satisfies** the "single canonical answer" and "detect label/bytes divergence" requirements. It is hereby ratified as the canonical realization of this section.

**Ratified mechanism (grounded in `apps/web/lib/platform/{version,image-version}.ts`):**

- **Build-time identity (the real source):** Release / build scripts run `git describe --tags` (or equivalent) and bake:
  - `/app/.dpf-platform-version` — the tag value (e.g. "5.6.0" or "5.6.0-35-gbcaa30a8", leading "v" stripped). This is the authoritative platform version for the image.
  - `/app/.dpf-image-version` — either the git SHA or a content hash of the exact bundled source tree.
  - `/app/.dpf-source-content-hash` — **always-computed sha256 over the precise bytes that went into the image** (independent of any label). This is the load-bearing anti-drift signal (see BI-C8E90A79 and promoter sha-verify).
  - `/app/.dpf-image-built-at` — ISO timestamp.
- **Runtime loader:** `loadPlatformVersion()` (memoized) returns the unified `PlatformVersion` type preferring the baked platform tag, falling back to `version.json` only for pure-dev/non-image cases. It also surfaces `gitSha`, `sourceContentHash`, `imageVersion`, `buildDate`. All call sites (health, UI, MCP, self-upgrade preflight) should converge on this one function.
- **`version.json` role:** Explicitly reduced to **DEV FALLBACK ONLY**. Current content documents its own deprecation for production identity. Release CI must **not** treat it as the mutable source of truth.
- **Manifest / channel / release notes:** Still required exactly as written. The channel manifest (§4.4) carries the semver `version` (sourced from the tag that was baked), previousVersion, bumpType, minimumFromVersion, image digests (now with honest sourceContentHash for verification), seedDeltas, migrations, signatures, etc. GitHub Release + GHCR artifacts remain the distribution vehicles per deployment-contracts Contract 1.
- **Image labels:** OCI labels remain valuable (and should be set from the same bake data).
- **UI / API / config:** `/api/platform/version` (or equivalent health surface) and the Upgrade Center must surface the `loadPlatformVersion()` tuple. **No `PlatformConfig` mirror.** Pass-2 architect review (§1.2) rejected the previously-allowed "convenience mirror" — a mirror that exists WILL be read by some path eventually, and any stale read reintroduces the BI-C8E90A79 class of identity drift this spec is built to close. All callers consume `loadPlatformVersion()` directly. A CI assertion (Phase 1, `BI-UPGRADE-001`) MUST verify no code reads `PlatformConfig["platform.version"]` for runtime identity decisions.

**Why this is better than the original proposal:** Eliminates the chronic staleness of a committed version.json (observed: it claimed 1.0.0 while real tags were v5.x). The content hash gives an objective "what was actually built" that no label can lie about. The git-describe approach naturally gives us the semver + distance-from-tag that the release train needs.

**Release CI obligations (unchanged in spirit):** On merge to main, determine bump (from Conventional Commits / PR labels / destructive-migration markers / archetype-breaking seed deltas), ensure the tag is created, trigger multi-arch GHCR builds that bake the describe value + content hash + timestamps, produce the signed channel manifest entry, seed-delta manifest, migration manifest (with kinds + reverse pairs), SBOM, etc. The "every merge produces an edge candidate" invariant holds.

The answer to "what version am I running?" is now `loadPlatformVersion().version` (with full provenance tuple for diagnostics). All upgrade preflight, detection, and operator surfaces must use this as the `fromVersion` / current identity.

### 4.2 SemVer with conventional commits / PR labels

`MAJOR.MINOR.PATCH`. Bump determined automatically from PR metadata at merge time:

- `fix:` → patch
- `feat:` → minor
- `BREAKING CHANGE:` footer, or any migration declared `destructive`, or any seed-delta declared `archetype-shape-breaking` → major

Release CI runs a lint that requires every merged PR to declare its bump category through the squash commit prefix or a release-impact PR label. Missing release-impact metadata fails for runtime/schema/seed changes; docs-only changes may declare `release: none` and skip artifact publication. Ambiguous categories fail the lint. PRs that touch seeded-content paths also require a seed-fit decision from §5.2.4; missing or contradictory seed-fit metadata fails before the release artifact is cut.

**Baseline event:** one-time switch declaring current `main` as `v1.0.0`. Sub-package versions are decoupled from platform version (they remain internal coordination tools); `v1.0.0` is platform-level.

**Pre-1.0 sidestepped** by baselining directly to `1.0.0`, avoiding the "minor = breaking" pre-1.0 semver convention.

### 4.3 Release CI is the cut-and-publish automation

On every merge to `main`, a release CI workflow runs:

1. Determine bump from PR metadata.
2. Write new version to `version.json`.
3. Tag `v<version>` and push the tag.
4. Build and publish versioned multi-arch installed-runtime images to GHCR, matching the deployment-contract doctrine.
5. Build the **migration manifest** — list pending Prisma migrations between previous tag and this one, with each migration classified (additive / modifying / destructive) by parsing the SQL.
6. Build the **seed-delta manifest** — diff the shipped seed content (prompts, skills, principles, archetype, IT4IT taxonomy, MCP service definitions) against the previous tag, produce a structured delta document keyed by `seedKey`, and include distribution scope / source-contribution metadata for any hive-originated seed row.
7. Generate release notes from PRs since previous tag.
8. Sign GHCR images and release manifests with Sigstore / cosign.
9. Publish a GitHub Release containing release notes, manifest JSON, checksums, SBOM/provenance pointers, and links to the signed image digests.
10. Update **DPF-hosted channel manifest** (`releases.dpf.dev/<channel>.json`) — initially `edge` only; `beta` and `stable` are promoted by a separate scheduled job.

Mark's "published automatically by the process" requirement maps onto this CI workflow. No human ritual.

### 4.4 Channel manifest schema

Three channels: `edge` (every release), `beta` (after N-hour soak on `edge`), `stable` (after M-day soak on `beta` with no rollback signal).

```json
{
  "version": "4.7.3",
  "channel": "stable",
  "publishedAt": "2026-05-23T08:00:00Z",
  "previousVersion": "4.7.2",
  "bumpType": "patch",
  "minimumFromVersion": "4.0.0",
  "images": {
    "portal": { "ref": "ghcr.io/opendigitalproductfactory/dpf-portal@sha256:1111111111111111111111111111111111111111111111111111111111111111", "signature": "sigstore-bundle://v4.7.3/portal.json" },
    "portalInit": { "ref": "ghcr.io/opendigitalproductfactory/dpf-portal-init@sha256:2222222222222222222222222222222222222222222222222222222222222222", "signature": "sigstore-bundle://v4.7.3/portal-init.json" },
    "sandbox": { "ref": "ghcr.io/opendigitalproductfactory/dpf-sandbox@sha256:3333333333333333333333333333333333333333333333333333333333333333", "signature": "sigstore-bundle://v4.7.3/sandbox.json" }
  },
  "migrations": { "pending": ["20260520_add_release_table"], "manifestUrl": "https://releases.dpf.dev/manifests/v4.7.3/migrations.json" },
  "seedDeltas": { "manifestUrl": "https://releases.dpf.dev/manifests/v4.7.3/seed-deltas.json", "hasArchetypeDelta": false, "hasPromptDelta": true, "hasPrincipleKernelDelta": false },
  "sbom": { "url": "https://releases.dpf.dev/manifests/v4.7.3/sbom.spdx.json", "sha256": "4444444444444444444444444444444444444444444444444444444444444444" },
  "releaseNotesUrl": "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/releases/tag/v4.7.3"
}
```

Two fields are load-bearing:

- `minimumFromVersion` — install on a version below this must step through an intermediate version first. Prevents skip-induced corruption.
- `bumpType` — drives preflight gate intensity (§5.4).

The channel manifest itself is signed with a detached signature; install verifies the manifest and every image digest before preflight can be approved.

### 4.5 Release CI obligations (the discipline that makes rollback survive)

These are enforced by the release CI as hard rules:

1. **Every migration declares its kind** (`additive` / `modifying` / `destructive`) in a header comment. CI parses and fails the release if missing.
2. **Every additive migration ships a paired reverse migration.** Stored under `packages/db/prisma/migrations/reverse/`. CI verifies the pair exists.
3. **`destructive` migrations may not appear in `minor` or `patch` bumps.** CI fails the release; forces the change into a `major` bump.
4. **Expand-then-contract lint**: a single release may not introduce a replacement AND remove its predecessor (no `DROP COLUMN` for a column whose replacement was added in the same release). Forces two-step releases — version N adds the new shape, version N+1 removes the old. This is what makes L1 rollback safe in the common case.
5. **Every seeded content file under `prompts/`, `skills/`, `docs/founder-kernel/wiki/`, archetype seed data, etc., is hashed at release time** and its hash recorded in the seed-delta manifest. This is the upstream side of the customization fingerprint (§6).
6. **Smoke window criteria** are declared per release in the channel manifest (acceptable error rate, required health endpoints) so the install knows what "healthy after apply" looks like.

## 5. Design — Install Side

### 5.0 Upgrade source resolution — two explicit modes

> Added 2026-05-29 to resolve the source/label conflation found in the
> current machinery. This section is the canonical decision; §2.2 and
> Phase 0 (`BI-UPGRADE-000a`) implement it.

**The defect being closed.** Today the *label* and the *bytes* of an upgrade
come from two different places, and nothing reconciles them:

- `version.ts:95-99` resolves `targetSha = git rev-parse <remote>/<branch>`
  (default `origin/main`) — but nothing runs `git fetch` first, so the ref
  may be stale.
- `scripts/promote.sh:85-89` builds the portal image from `PROMOTE_SOURCE` —
  the bind-mounted **host install working tree** (`promoter.ts:90`) — and
  stamps it `DPF_VERSION=$PROMOTE_TARGET_SHA`. It never checks out the target
  SHA (confirmed: no `git fetch`/`checkout`/`clone` anywhere in the
  self-upgrade path).
- `promote.sh:117-132` "sha-verify" reads `/api/health/sha`, which echoes
  `DEPLOYED_SHA=DPF_VERSION` (`docker-compose.yml:145`) — i.e. it confirms the
  stamp it just set, not that the built bytes equal the resolved ref. The
  verification is **circular**.

Consequence: the image is built from *whatever is checked out in the host
tree* (a feature branch, a worktree, local commits, dirty edits) while being
labeled and "verified" as `origin/main`. On managed installs the tree is
usually clean at `origin/main` and the two coincide; on self-hosted /
contributor / dev installs they routinely diverge, producing a build whose
reported SHA is a lie. This is the misinformation symptom recorded against the
first macOS self-upgrade run.

**The local delta is real, and it has two trees and no durable home.** Build
Studio builds on `client/<id>`→`build/<id>` branches inside a *separate*
sandbox container's `/workspace` (the `sandbox_workspace` volume), while the
portal builds from `dpf-source-code`. But the sandbox output does **not** only
travel the long way (contribute → PR → `main` → pull): `sandbox-promotion.ts`
extracts the build's diff and `git apply`s it **directly into the running
portal** ("apply patch → health check → mark deployed", lines 130/495). In
`fork_only` with no git remote those applied patches are committed to no
durable branch — `mcp-tools.ts:8891` warns the operator outright that the
features "could be lost in a container rebuild, Docker update, or system
recovery." So a non-technical, private operator's customizations exist only as
mutations of the running container's source.

**This makes the naive fix actively dangerous.** A "build from a clean
checkout of `origin/main`" upgrade would *wipe* exactly the customizations a
non-technical user cannot recreate. The dominant real population — private
installs that never contribute upstream but still need upstream bug fixes and
new archetypes — needs **both** their local delta preserved **and** upstream
evolution merged in. "Upstream-only" and "local-only" are the degenerate ends;
the general case is a **merge**.

**Decision: the upgrade source is `upstream-lineage ⊕ local-delta`, reconciled
by a system-driven merge onto one durable per-install branch. The deployed
stamp always describes the merged bytes that were actually built.**

1. **Durable install branch (prerequisite).** Promotions are committed as real
   commits onto a persistent per-install branch *in the tree the portal builds
   from* — not left as uncommitted container mutations. This closes the
   "lost on rebuild" hazard regardless of contribution mode, and gives the
   merge a real `ours` side.

   **Five-role workspace layout (canonical, as of PR #1399).** Before following the canonical-tree decision, the full topology:

| Role | Path | Owner | Notes |
|---|---|---|---|
| Production install | `~/.dpf/install/` | Portal runtime | Root clone. Read-only for human edits; self-upgrade owns `dpf/install` branch here. |
| Upgrade workspace | `~/.dpf/install/.upgrade-workspace/` | Self-upgrade process | Dedicated sub-clone. Merge runs here; never touches operator's working tree. (BI-A8A7CCFD) |
| Dev workspace | `~/dpf-dev/` | Developer / agent sessions | Active editing. New-dev-worktree.sh bases topics off this. |
| Topic worktrees | `~/dpf-worktrees/<slug>/` | Per-session agent | Source-control isolation ONLY — not a runtime. Leases the convergence sandbox for runtime gates. |
| Convergence sandbox | `~/.dpf/local-ci-sandbox/` | Sequential lease (BI-166C59F3) | One shared runtime; every worktree leases sequentially before PR. Designed, not yet built. |

Self-upgrade owns roles 1 and 2. Roles 3–5 govern developer and agent workflows. The `worktree-is-source-control-not-runtime` principle ([kernel doc](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md)) prohibits a topic worktree (role 4) from being used as a runtime for upgrade verification; that role belongs exclusively to the convergence sandbox (role 5). See `docs/dev/collision-free-dev-workflow.md` for the operational companion.

   **Canonical tree = the host clone (`DPF_HOST_INSTALL_PATH`)** (resolved
   2026-05-29). Today three trees split the responsibilities with nothing
   syncing them — the promoter builds from the host clone (`/host-source:ro`),
   `sandbox-promotion` git-applies customizations into the `dpf-source-code`
   volume (`/workspace`), and Build Studio's `client/<clientId>` branches live
   in `sandbox_workspace`. Because the build source ≠ the customization-apply
   target, an upgrade rebuild never contains the customizations — the root of
   the "lost on rebuild" hazard. The host clone is chosen as the single
   canonical install tree because it is already the promoter's build source, is
   a real git repo with the `origin` remote wired (native `fetch`/`merge`), is
   host-persistent and operator-backup-able (a folder, not a Docker volume),
   and is already writable by the portal at `/host-dpf`. The fix converges all
   three responsibilities here: promotion commits land on the install branch in
   the host clone (replacing ephemeral `/workspace` mutation), upstream merges
   into it, the promoter builds it. The sandbox `client/<clientId>` branch
   remains the build-staging area; promotion is the bridge into the canonical
   tree. *Implementation shape (landed: PR #1389 / BI-A8A7CCFD; canonical-SHA correction: BI-C6C92EE4):* the isolation is a dedicated **`.upgrade-workspace/`** sub-clone at `${hostInstallPath}/.upgrade-workspace/`, owned entirely by the upgrade process. `SelfUpgradeConfig.useIsolatedWorkspace` defaults to `true`; managed installs (the target population) use it automatically. Each upgrade run: (i) initialises or re-uses the workspace clone (hardlinked objects, no extra disk); (ii) configures a distinct `upgrade-upstream` remote pointing at the same URL as the install clone's `origin`; (iii) fetches both the upstream branch and the install clone's `dpf/install` ref; (iv) checks out the install branch from the install clone's ref (`reset --hard HEAD` + `clean -fdx`); (v) compares the install tree with its merge base; when there is no local content delta, advances to the exact `upgrade-upstream/<branch>` commit, otherwise merges it with `--no-ff`; on conflict — aborts the merge, returns `conflictFiles`, and defers (operator resolves in the Upgrade Center; the current build keeps running); (vi) on success — pushes the new `dpf/install` tip back to the install clone **ref-only** (the operator's checked-out working tree is never touched). The promoter then mounts the workspace path as `/host-source:ro` instead of the install clone, so the image is built from those bytes. An upstream-only install is stamped with the canonical upstream SHA that peers can fetch; an install with real local content is stamped with its honest merge-commit SHA. See `apps/web/lib/self-upgrade/prepare-source.ts` (`prepareUpgradeSourceInWorkspace`) and `config.ts` (`upgradeWorkspaceHostPath`/`upgradeWorkspaceMountPath`) for the authoritative implementation.
2. **Advance when canonical; merge when local.** On upgrade: `git fetch` the
   upstream target, then compare the install tree with its merge base. With no
   local content delta, advance to and stamp the exact upstream commit so the
   running identity remains globally fetchable. With a real local delta, merge
   upstream into the install branch; disjoint changes merge automatically and
   the result is stamped with the honest **merge-commit SHA**. Track *upstream
   lineage* separately so "are we current with upstream?" stays answerable for
   customized installs whose running SHA intentionally differs from upstream.
3. **Conflicts are an in-portal decision, never a CLI ask.** When upstream and
   local edit the same code, attempt a 3-way merge; genuine conflicts surface
   in the Upgrade Center (§5.2.4 / §6) as an operator card — *keep mine / take
   upstream / show diff* — honoring `never-ask-user-to-run-commands`. If
   unresolved, **defer** that upgrade and keep running the current
   install-branch build: the operator is never broken, only not-yet-updated.
4. **Degenerate postures fall out for free.** No local delta → the install ref
   becomes the exact upstream commit (the simple managed-install case). Contributed
   delta (`selective`/`contribute_all`) → once it lands upstream the merge is
   trivial because `ours` and `theirs` converge. Contribution mode therefore
   governs only whether local commits *also* flow outward; it never gates
   whether upstream flows in.

This extends the spec's existing customization-fingerprint / 3-way-merge
machinery (§3.3, §6 — currently scoped to *seeded DB content*) to the
**git/code** delta, under the same `base`/`ours`/`theirs` model.

**Scope boundary.** This section governs *which bytes get built and how they
are identified*. It is deliberately upstream of the channel-manifest detection
in §5.1: until manifests ship (Phase 4 / `BI-UPGRADE-010`), `upstream` mode
resolves a git ref as described here; afterwards the resolved artifact is the
manifest's signed image and the same "stamp describes the built bytes"
invariant carries over unchanged.

The contributor-machine nuance noted above is one instance of the broader source-control-isolation-vs-runtime-validation rule (canonical at [`worktree-is-source-control-not-runtime`](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md); design context in the tiered-dev-loop spec §2.1). The upgrade lifecycle commits to that model: thread worktrees do not impersonate the canonical install for upgrade verification. Runtime-bound checks route through the ONE shared **convergence sandbox** (`~/.dpf/local-ci-sandbox/`, BI-166C59F3), leased sequentially via `claim_nonprod_environment_lease(environmentKey="local-integration-ci")`. At DPF's expected 1k–10k concurrent worktrees, per-worktree runtimes are structurally untenable (disk/RAM/CPU/port exhaustion, state drift); the convergence sandbox is the single correct gate for any runtime evidence a worker worktree needs to produce before promoting changes that the upgrade lifecycle will later reconcile in L4 preflight.

### 5.0.1 Upgrade impact summary — on demand, install-tailored

> Added 2026-05-31 to make "what's in this update?" answerable from the
> operator surface without a CLI ask. Lands as `BI-C26F7EE1`
> (PR [#1364](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1364)).

**The decision being closed.** Apply-vs-defer needs more than two SHAs. An
operator looking at the `/ops/self-upgrade` panel today sees `currentSha →
targetSha` and a "Update available" badge — both true, neither useful for
deciding whether *this* upgrade is worth taking *now*. The §5.0 lineage
marker makes the *bytes* honest; this section makes the *meaning* of those
bytes legible.

**Pipeline (deterministic classification + LLM phrasing, no fabrication).**
The summary is produced on demand — operator click in the Upgrade Center, or
MCP call — and is cacheable per (`currentLineageSha`, `targetSha`) so a
follow-up read is free.

1. **Change set.** `git log <currentLineageSha>..<targetSha>` over the host
   clone. `currentLineageSha` = the latest succeeded
   `SelfUpgradeRun.targetSha` (the §5.0 upstream lineage marker — *not*
   `deployedSha`, which is the canonical upstream identity for an upstream-only
   install and the merge-commit identity when the install carries local content).
   `targetSha` = the resolved upstream HEAD from `version.ts:resolveTargetSha`.
   Reuses the no-auth dep-injected `execFile` pattern from `version.ts` and
   the host-clone read pattern from `operating-hours-read.ts`. No `git
   fetch` here — the caller is expected to have already freshened the ref
   via `buildFetchCommand`.
2. **Classify by Conventional Commits.** DPF squashes PRs with Conventional
   subjects, so the subject is the load-bearing signal. Parse `type(scope)!:
   description (#NNNN)`, bucket as
   `breaking | feature | fix | performance | other`. Counts drive the
   headline. Non-Conventional subjects bucket as `other` rather than drop —
   nothing is silently invisible to the operator.
3. **Enrich (best effort).** When reachable, fetch each commit's PR title,
   labels, and a truncated body from the GitHub API. Offline or unauthorized
   → fall through to commit subjects + changed-path stats only. Never
   invents enrichment.
4. **Score relevance to THIS install.** `score = baseWeight(type, breaking)
   × relevanceMultiplier(install signals)`. Base weight encodes the
   "what kind of change" axis (breaking > feature > perf > fix > other);
   relevance multiplier amplifies commits whose scope, files, or PR labels
   match install state. Signals are sourced from live DB:
   - `StorefrontConfig.archetypeId` (single source of truth for portal
     industry — see §2 portal archetype rule),
   - `Organization.industry` (derived from archetype; kept for legacy
     match),
   - `FeaturePack.manifest` paths and `applicableVerticals` (the only
     DB-visible record of install customization today; absorbs the durable
     install-branch signal from §5.0 once it lands without changing the
     public type),
   - open `PortfolioQualityIssue` summaries → keyword themes.

   Path overlap between a commit and a `FeaturePack`-touched file is
   **both** a relevance signal **and** a §5.0 merge-conflict early
   warning — surfaced via a `touchesCustomizations` flag and a
   whole-summary callout so the operator hears about it before
   `prepare-source` does.
5. **Phrase via the LLM.** A strict-JSON call through
   `apps/web/lib/llm-call.ts` (`callLLM`, the internal-sensitivity
   `minimize_cost` routed utility helper) produces the headline + per-item
   one-line description + per-item "why relevant to you" + customizations
   callout. Hard validators reject malformed JSON, length mismatches, and
   reordering; on any failure the orchestrator returns the deterministic
   shape with `phrased: null` and the UI falls back to raw commit
   descriptions rather than fabricate. The LLM **never** adds, drops, or
   reorders items — those are decided deterministically upstream.
6. **Cacheable.** A process-local map keyed by
   (`currentLineageSha`, `targetSha`) — a given pair is immutable until a
   successful self-upgrade flips the lineage marker. The cache exists to
   make a repeat operator click and a follow-up MCP read free.

**Surfaces.** The same summary is rendered in two places, both read-only and
advisory — neither queues nor applies the upgrade:

- **`/ops/self-upgrade` Upgrade Center action** — the "What's in this
  update?" panel. Operator clicks **Summarize update**; sees headline,
  counts ribbon, top-N items (each with a one-line description and a
  one-line "why relevant to you"), the customizations callout when
  present, a foldable full list, and a provenance line ("GitHub
  reachable / served from cache"). **Default view never shows SHAs or
  file paths** — those are intentionally absent from the operator-facing
  text, with the full list and SHA-bearing detail available on demand.
- **MCP tool `summarize_upgrade_impact`** — `view_operations` scope,
  read-only. Params: `refresh`, `topN`, `skipPhrasing`. Returns the same
  `SummaryResult` discriminated union the server action exposes.

**No-fabrication contract.** Every layer prefers to say "unavailable" over
inventing data. Concretely:

- `no-lineage` (no succeeded self-upgrade on record), `no-target`
  (couldn't resolve upstream HEAD), `lineage-equals-target` (already
  current), and `git-log-failed` are typed `SummaryResult` cases the UI
  renders plainly.
- Path-overlap is calculated, not guessed; if FeaturePack manifests carry
  no paths, no overlap is claimed.
- GitHub enrichment failures degrade silently to commit-subject mode and
  the UI says so ("GitHub unreachable — summary built from commit
  subjects only.").
- LLM failures degrade to the raw deterministic shape; the operator never
  sees a fluent headline that wasn't grounded in the change set.

**Scope boundary.** This section governs the *summary the operator reads*,
not the *gates the upgrade passes*. The four-layer preflight (§5.2) and the
bump-type gate (§5.4) remain authoritative for go/no-go; the impact summary
informs the operator's decision when they look — it does not itself defer,
block, or apply.

### 5.1 Detection

The newer `apps/web/lib/queue/functions/self-upgrade.ts` path becomes the canonical detector after Phase 0 cleans up the legacy stubs:

- Polls `https://releases.dpf.dev/<channel>.json` on the configured interval. Default: hourly check, but apply remains maintenance-window gated. This keeps detection fresh without turning every detection into an immediate recycle.
- Verifies channel manifest signature.
- Compares `manifest.version` to `PlatformConfig["platform.version"]`.
- If newer and `minimumFromVersion` satisfied: proceeds to preflight.
- If newer but `minimumFromVersion` not satisfied: surfaces "must upgrade to intermediate version X first" to operator; does not proceed.
- Operator also has "Check for updates now" on `/ops/self-upgrade`.
- **No phone-home, no install identity sent.** Public feed, anonymous poll.
- **Outbound HTTPS only**: `releases.dpf.dev` + GitHub release artifact URLs. No inbound network requirement.

If the DPF-hosted manifest host is unreachable, install may fall back to GitHub Releases API for a recovery-only `latest stable` check. It must not use GitHub latest as `edge` or `beta`, because GitHub's latest release endpoint excludes prereleases and does not model DPF's channel promotions.

### 5.2 Preflight gathers evidence across four layers

A new entity `PreflightRun` is the pre-commit audit artifact, distinct from `SelfUpgradeRun` (which is the apply-phase audit).

**Why a separate model (pass-2 architect justification):** the closest existing fit is `SelfUpgradeRun` with a `phase: preflight | apply` discriminator and `preflightEvidence: Json` + `applyEvidence: Json` columns. That shape was rejected for three reasons. (a) **Lifecycle fan-out**: one approved preflight can produce multiple apply attempts (initial apply fails at L1, operator retries after fixing the integration) — N preflights to M applies is a real cardinality, not 1:1. (b) **Operator timeline queries**: the Upgrade Center shows preflight runs and apply runs as separate rows in the timeline (different statuses, different evidence panels); folding into one table would force every list query to filter by phase. (c) **Pre-commit advisory state**: preflight rows in `gathering`/`awaiting-operator` carry operator decisions that may never lead to an apply — those rows have no place on the apply audit table where every row represents a real attempt at the swap. The trade-off — two tables instead of one — is worth it; the alternative leaks preflight noise into the apply audit log.

```prisma
model PreflightRun {
  id                String   @id
  fromVersion       String
  targetVersion     String
  channel           String
  bumpType          String   // patch | minor | major
  status            String   // gathering | awaiting-operator | approved | rejected | applied | failed
  startedAt         DateTime
  completedAt       DateTime?

  layer1Evidence    Json     // release artifact / runtime image
  layer2Evidence    Json     // schema migrations
  layer3Evidence    Json     // seed / archetype / prompt / principle deltas
  layer4Evidence    Json     // sandbox + contribution reconciliation

  operatorDecisions Json     // per-conflict choices keyed by seedKey
  signedOffBy       String?
  signedOffAt       DateTime?

  selfUpgradeRunId  String?  // links forward to the apply phase
  recoveryPoint     Json?    // full pre-upgrade recovery point (§5.2.6)
  backupSnapshotId  String?  // legacy alias: Postgres backup id only
}
```

All status values use the hyphenated DPF enum convention (AGENTS.md §11); underscores in earlier drafts (`awaiting_operator`) were normalized in §1.2.

The four layer evidence schemas:

#### 5.2.1 Layer 1 — Release artifact / runtime image

| Field | Content |
|---|---|
| `imageDigests` | signed GHCR image digests for portal, portal-init, sandbox, and any installed-runtime service changed by this release |
| `manifestHash` | sha256 of the signed channel manifest |
| `signatureVerified` | sigstore/cosign verification result |
| `sbomUrl` / `provenanceUrl` | release SBOM and provenance attestations when present |
| `dependencyDiff` | added / removed / bumped packages with per-dep semver level |
| `breakingMarkers` | parsed from `BREAKING CHANGE:` footers in commits since prior version |
| `surfacesChanged` | routes / server actions / MCP tools / coworker prompts touched (derived from changed files mapped through a route manifest) |
| `activeSessionBlockers` | in-flight executor runs, BS phases mid-gate, capsules in working state |

Block conditions: signature fails, hash mismatches, required image missing. Warn conditions: active sessions present (operator can defer or finish-then-apply).

#### 5.2.2 Layer 2 — Schema migrations

| Field | Content |
|---|---|
| `pendingMigrations` | ordered list with extracted comment summaries |
| `migrationKind` per migration | `additive` / `modifying` / `destructive` (from release CI; verified locally by SQL re-parse) |
| `affectedTables` | with current row count from live DB |
| `dryRunResult` | **apply against a shadow DB cloned from live; capture any failure** |
| `lockTimeEstimate` | for ALTERs on tables above row-count threshold |
| `forwardOnlyVerified` | reject any down-migration attempts |

The shadow-DB dry run is the load-bearing piece. It is the difference between "the migration's SQL parses" and "the migration will succeed against your actual data shape." Without it, Layer 2 is the same blind apply the system does today.

Block conditions: shadow-DB dry run fails. Mandatory operator gate: any `destructive` kind regardless of bump level.

#### 5.2.3 Layer 3 — Seed / archetype / prompt / principle deltas

Driven by the `SEED_REGISTRY` (§6.2). For each registered model:

```json
{
  "model": "PromptTemplate",
  "fingerprintMode": "content-hash",
  "rowDeltas": {
    "noChange": 47,
    "safeAutoApply": 8,
    "safeNoApply": 3,
    "conflict": 2,
    "addedUpstream": 5,
    "removedUpstream": 1
  },
  "conflicts": [
    {
      "seedKey": "prompt:builder.architect-review",
      "base":   { "hash": "sha256:abc123", "version": "4.6.0" },
      "ours":   { "preview": "You are MY architect", "lastEditedAt": "2026-05-20T14:00:00Z" },
      "theirs": { "preview": "You are an architect reviewing DPF work" },
      "diffSummary": "Both changed opening line + IT4IT instruction"
    }
  ]
}
```

Auto-resolve (no operator prompt):
- `safeAutoApply` (`ours == base AND theirs != base`) → take theirs
- `safeNoApply` (`theirs == base AND ours != base`) → keep ours
- `noChange` → omit from operator view
- `addedUpstream` → take theirs (list in summary)

Mandatory operator decision:
- Every `conflict` (all three corners differ) → three-pane diff + choice (keep ours / take theirs / merge manually)
- Every `removedUpstream` → confirm operator wants to drop it

Archetype-specific extras: list of soft-deleted archetypes whose definitions changed upstream — operator chooses restore vs. remain soft-deleted.

Principle-kernel extras: list of org overlays whose `derivedFromKernelVersion` is now stale, with kernel diff link.

#### 5.2.4 Layer 4 — Sandbox + contribution reconciliation

| Field | Content |
|---|---|
| `activeCapsules` | WorkCapsule rows in working / dispatched / reviewing |
| `capsuleScopeCollisions` | capsules whose scope claims touch files changed in this version |
| `activeWorkerWorktrees` | Build Studio worker worktrees by build id, branch, worker id (`codex`, `claude`, `grok`, `dpf-native` when applicable), base SHA, dirty state, and last heartbeat |
| `workerWorktreeCollisions` | worker branches/worktrees whose touched files overlap the target release or install-branch merge |
| `workerVerificationReadiness` | per-worker provisioning state: `compile-ready` when source-local gates can run in the worktree, `source-only` when the worktree only provides Git/MCP/Compose isolation and verification must come from canonical runtime / local-CI sandbox |
| `inFlightContributions` | FeaturePack rows in `contributing` status |
| `pendingContributionsNeedingRebase` | local FeaturePack drafts cut from now-historical main |
| `seedContributionFit` | For any contribution touching seeded content, the contribution review's seed-scope decision: `global-default`, `archetype-scoped`, `vertical-scoped`, `parameterize-first`, `install-local-only`, or `reject-as-seed` |
| `parDecisions` per capsule | one of `rebase` / `preserve` / `abandon` / `promote-first` (PAR pattern from internal memory signal `feedback_propose_acknowledge_reassign.md`) |

No hard blocks at this layer by default — all four are surfaced as decisions because PAR says the owner decides reassignment, never the system. The exception is a dirty active worker worktree whose branch has not been captured as a commit or patch artifact: upgrade must defer rather than risk losing uncommitted worker output.

Default suggestions per capsule (operator can override):

- Phase < ship and no scope collision → `rebase`
- Phase ≥ ship → `promote-first`
- Capsule idle past staleness threshold → `abandon` candidate (with confirmation)

Build Studio worker-specific rules:

- **Architecture capture (binding on all future work).** Any Build Studio worker (Grok, future specialist models, new agentic loops, or code generated by Build Studio itself) is governed by the full mandatory architecture in [`2026-05-09-build-execution-provider-design.md` — "Mandatory Architecture Capture for All Future AI Agents..."](2026-05-09-build-execution-provider-design.md). It is either routed as a `ModelProvider` behind `dpf-native` or implements the `BuildAgentRunner` contract as a peer. No new direct sandbox execution paths, no bypassing the orchestrator at `build-orchestrator.ts`, and no worktrees invisible to L4 preflight are permitted. This rule applies to any AI agent (including this one) performing build-related tasks.
- A worker such as Grok is not a special upgrade actor. It is either a model
  behind `dpf-native` or a `BuildAgentRunner` peer of Codex/Claude per
  the build-execution-provider spec linked above.
- Worker worktrees are source-control isolation only. They must not be treated
  as independent runtimes during preflight. Runtime evidence comes from the
  canonical install or shared local-CI convergence sandbox.
- Worker worktrees must be classified before dispatch and before upgrade
  apply:
  - `compile-ready` worktrees have a package manager and dependency substrate
    sufficient for cheap source-local gates such as targeted Vitest or
    TypeScript checks.
  - `source-only` worktrees have valid Git/MCP/Compose isolation but cannot run
    local compile/test gates. They may hold edits, but their verification line
    must point to canonical runtime / local-CI evidence.
  - A source-only worktree is not a failure by itself. It becomes a blocker
    only when the worker or upgrade record claims unrun worktree-local gates as
    passed, or when no canonical-runtime evidence is available for promoted
    changes.
- Each worker worktree must carry enough metadata for preflight to reason about
  it: build id, worker id, branch, base SHA, touched paths, dirty/clean state,
  verification provisioning state, and latest heartbeat.
- Upgrade decisions for worker worktrees use the same PAR vocabulary:
  `rebase`, `preserve`, `abandon`, or `promote-first`. If the target release
  touches the same files as a Grok worktree, the default is `preserve` and defer
  apply until the operator chooses rebase/promote/abandon.
- A self-upgrade may not merge, delete, or reset a worker branch implicitly.
  It can only surface the collision and execute the operator-recorded decision.

Contribution seed-fit rules:

- This install is the origin of canonical seed detail, so external hive PRs
  that add or change seeded content are not merged just because they are useful
  to the contributing install. The contribution review must classify the seed
  delta's product fit before the PR is mergeable.
- Use the existing `FeaturePack` review substrate for the first slice:
  `sourceVertical`, `applicableVerticals`, `reusabilityScope`,
  `mergeReadiness`, and `reviewReport` carry the seed-fit evidence. Do not add
  a parallel seed-intake model unless that substrate proves insufficient.
- `global-default` means the change belongs in canonical seed for every
  install: platform principles, bug-fix prompts, safety defaults, or reference
  data whose semantics are not tied to one operator, geography, or market.
- `archetype-scoped` / `vertical-scoped` means the change may be valuable but
  must be attached to the relevant archetype category or vertical-market
  scope. It must not be loaded as a universal default and must be visible in
  the seed-delta manifest as scoped content.
- `parameterize-first` means the contribution contains a reusable pattern but
  its literal values are site-specific. The reviewer should split or revise the
  PR so the general template enters seed and the local example stays out.
- `install-local-only` means the work should remain a private FeaturePack,
  recipe, prompt override, or operator customization. It can be a good idea and
  still be wrong for canonical seed.
- `reject-as-seed` means the seed delta is unsafe or inappropriate for
  distribution as submitted: customer/private data, local credentials,
  one-off vendor assumptions, non-general policy text, or market claims without
  enough evidence.
- "Do not throw the baby out with the bathwater" is binding review posture:
  reject or scope the unsuitable seed delta while preserving reusable code,
  patterns, tests, docs, or parameterized templates where they genuinely help
  the broader hive.
- Release CI must fail any PR that touches seeded-content paths without a
  seed-fit decision and release-impact metadata. The merge queue cannot infer
  userbase applicability from path changes alone.

#### 5.2.5 Cross-cutting evidence

| Field | Purpose |
|---|---|
| `recoveryPointId` | Full pre-upgrade recovery point taken before any apply (mandatory) |
| `backupSnapshotId` | Backward-compatible alias for the Postgres member of `recoveryPointId`; do not use for new work |
| `rollbackFeasibility` per layer | L1: always; L2: conditional; L3: always; L4: manual |
| `estimatedApplyTime` | rough budget for the recycle window |
| `windowGate` | active session count, BS phase mid-gate count |

#### 5.2.6 Pre-upgrade recovery point

Every non-dry-run upgrade apply must create a **recovery point** before any
schema migration, seed delta, or image swap touches production state. This is
not the current promoter's `previous-sha.txt`; that file is useful runtime
identity evidence, but it cannot restore business data.

Recovery point members:

| Member | Existing substrate | Required for apply? | Notes |
|---|---|---|---|
| Postgres | `runPostgresBackup(...)` existing runner, with `BackupTrigger` extended to include `"pre-upgrade"` | Yes | Authoritative business/operator state. Must pass checksum validation before L2 can start. |
| Neo4j | `runNeo4jBackup(...)` existing runner, with `BackupTrigger` extended to include `"pre-upgrade"` | Yes by default; operator may accept degraded only if graph is declared regenerable for this install | Neo4j backup stops the container briefly; quiescence must already be preventing new graph writes. |
| Qdrant | `runQdrantBackup(...)` existing runner, with `BackupTrigger` extended to include `"pre-upgrade"` | Yes by default; operator may accept degraded only if embeddings are declared regenerable | Online snapshot. |
| Runtime/source identity | Previous image digest, previous deployed SHA, prepared-source commit, channel manifest hash | Yes | The prepared-source commit is the canonical upstream SHA when there is no local content delta, otherwise the honest local merge SHA. Enables L1 rollback and audit reconstruction. |
| Restore drill evidence | Latest successful Postgres trial restore for the selected dump, or an explicit "not yet verified" warning | Warn/block by policy | Patch auto-apply may block if no recent verified Postgres backup exists. |

`RecoveryPoint` can be either a new model or a structured JSON field on
`PreflightRun` in the first slice. It must at minimum record:

```json
{
  "id": "rp_<id>",
  "createdAt": "2026-05-31T15:00:00Z",
  "members": {
    "postgresBackupRunId": "c...",
    "neo4jBackupRunId": "c...",
    "qdrantBackupRunId": "c...",
    "previousImageDigest": "sha256:...",
    "previousDeployedSha": "..."
  },
  "integrity": {
    "postgresChecksumVerified": true,
    "neo4jChecksumVerified": true,
    "qdrantChecksumVerified": true,
    "latestPostgresTrialRestore": "ok"
  }
}
```

Apply blocks if the Postgres member fails. Apply warns and requires an explicit
operator decision if Neo4j or Qdrant fail, because those are expensive but
usually regenerable stores. A `major` upgrade cannot proceed degraded.

The Upgrade Center must render the recovery point before the Apply button
becomes active: backup time, targets covered, integrity status, and retention
risk. This makes BC/DR part of the upgrade workflow, not a separate document
the operator is expected to remember under stress.

#### 5.2.7 Sandbox-assisted recovery rehearsal

Research addendum (2026-06-02): the sandbox should become the place where a
recovery point is rehearsed before production state is touched. NIST SP 800-34
frames contingency planning around recovery strategies, alternate processing
capacity, and testing/training/exercises; the same principle applies here:
DPF should prove a recovery point on an alternate target, then use that
evidence to reduce the risk of the production restore.

Current substrate:

| Surface | Current shape | Recovery use | Constraint |
|---|---|---|---|
| Build Studio `sandbox` | `sandbox` service on `3035` with isolated `sandbox-postgres` and shared `sandbox_workspace` | Good for source-local development, seed/migration rehearsal, and Postgres restore rehearsal against a non-production DB | Base compose still points `NEO4J_URI` and `QDRANT_INTERNAL_URL` at the shared `neo4j`/`qdrant` services, so it is not yet safe for destructive graph/vector restore drills. |
| Shared `local-integration-ci` | Lease-governed `local-ci-portal` on `3010`, with configurable Postgres/Neo4j/Qdrant endpoints | Best v1 target for canonical runtime-bound upgrade verification and future full recovery rehearsal | Requires provisioned isolated DB endpoints and a live lease before recording evidence. |
| `docker-compose.dev-against-live-db.yml` | Opt-in dev portal connected to live databases | Excluded | It can write to live state and must never be used for recovery drills. |
| Existing Postgres trial restore | `scripts/postgres-trial-restore.sh` restores a dump into a temporary DB and asserts critical row counts | Shipped proof pattern for rehearsal | Postgres-only today; does not prove Neo4j/Qdrant members. |

The v1 recovery rehearsal should be a governed operation, not an operator
runbook command:

1. Claim `local-integration-ci` with a purpose such as
   `self-upgrade-recovery-rehearsal`.
2. Prepare isolated targets: empty Postgres DB, isolated Neo4j container, and
   isolated Qdrant endpoint. If graph/vector endpoints are not isolated, mark
   those members `not-run` instead of touching shared services.
3. Restore the selected recovery point members into those targets:
   Postgres via `pg_restore`, Neo4j via `neo4j-admin database load` against an
   offline isolated DBMS, and Qdrant via snapshot recovery against the isolated
   Qdrant node.
4. Start the portal against the rehearsal targets and run `/api/health`,
   migration/schema checks, seed-delta smoke, and a small operator-state smoke
   set such as users, backlog items, model providers, and Build Studio records.
5. Persist evidence on the upgrade run, for example
   `SelfUpgradeRun.completionEvidence.recoveryPointVerification`, including
   lease id, environment key, member restore outcomes, log paths, smoke
   results, source/image identity, and expiry time.

Upgrade Center behavior:

- Show recovery-point verification beside the restore button:
  `verified`, `partially-verified`, `stale`, `not-run`, or `failed`.
- Block unattended auto-apply for schema-changing upgrades when Postgres
  verification is stale or failed.
- Allow an operator-confirmed production restore without full graph/vector
  rehearsal only when the UI states which members were not rehearsed and why.
- Never treat sandbox evidence as the durable backup. Backups remain the
  host-retained `BackupRun` artifacts; the sandbox is the disposable proof
  target.

Follow-up provision: add a dedicated `recovery-drill` nonproduction environment
key once the lease substrate supports multiple named runtime purposes. That
keeps routine Build Studio verification from blocking long restore rehearsals
and gives BC/DR an explicit capacity lane.

### 5.3 Operator surface

Extend the existing `/ops/self-upgrade` route into the Upgrade Center. Do not create a parallel `/admin/platform/upgrade` workflow; the current product already routes operational change controls through `/ops`, and the triage docs call out that update banners should link to the real trigger surface. Admin/platform pages may deep-link here.

The UI has four dense, operator-first views:

1. **Overview** — current version, target version, channel, bump type, signed-manifest status, latest preflight/run status, top blockers, and one primary action (`Run preflight`, `Review conflicts`, `Apply`, or `Rollback`). This is a constrained status band, not a marketing card.
2. **Evidence** — a tabbed layer inspector for L1/L2/L3/L4. Tables show the actual artifact digest, migration row counts, shadow-DB output excerpt, seed-delta counts, and capsule collisions. Status indicators use DPF theme tokens only.
3. **Conflict resolver** — three fixed panes (`base`, `ours`, `theirs`) with synchronized scrolling, diff highlighting, a persistent decision rail, and bulk actions scoped only to explicitly similar conflicts. The operator should never need to infer a conflict from prose.
4. **Run history** — preflight and apply runs in one timeline, with links to evidence, operator decisions, smoke-window output, rollback feasibility, and final state.

Design rules:

- Use the existing ops tab navigation and page density; no nested cards, no hero layout, no decorative gradients.
- Use theme-aware CSS custom properties (`var(--dpf-text)`, `var(--dpf-muted)`, `var(--dpf-surface-1)`, `var(--dpf-border)`, `var(--dpf-accent)`) per AGENTS.md.
- Use icons for refresh/check/apply/rollback/details actions, with tooltips. Text buttons are reserved for destructive or high-commitment commands where words reduce risk.
- Prefer progressive disclosure: the overview shows the decision, the evidence tabs show why, and the resolver appears only when conflicts exist.
- Surface concrete artifacts, not claims that artifacts exist: actual diffs, row counts, shadow-DB output, signatures, and smoke checks.

### 5.4 Bump-type drives gate intensity

| Bump | Gate behavior |
|---|---|
| `patch` | Auto-apply allowed IF: no destructive migrations, no L3 conflicts, no L4 active capsules. Operator can opt-out into "always prompt." |
| `minor` | Always operator-gated. L3 conflicts shown if any. Backup mandatory. |
| `major` | Mandatory full review of every layer. Cannot skip. Operator must explicitly approve each section. Multiple confirmation prompts on destructive items. |

Hard override regardless of bump: any L2 destructive migration → mandatory gate. Any L3 conflict → mandatory operator decision.

### 5.5 Apply — graceful recycle protocol

> **Replaced by the Activity Quiescence Protocol.** The detailed drain
> mechanics that used to live here (17-step protocol, drain mode, SSE
> close, work-type survival) are now specified in
> [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](2026-05-24-activity-quiescence-protocol-design.md).
> That spec inventories 30 concurrent active surfaces, gives each its own
> detection / stop-accept / wait / fail-safe contract, and is implemented
> across BI-QUIESCE-001..010.
>
> This section retains only the apply-side (post-quiescence) steps —
> the L2/L3/L1/L4 ordering, smoke window, and the integration shape the
> caller (`runSelfUpgrade`) uses.

After operator approval:

1. Operator approves preflight → `SelfUpgradeRun` row inserted and linked to `PreflightRun.id`.
2. Pull and verify the signed target images, but do not route traffic to them yet.
3. Create or verify the mandatory recovery point recorded on `PreflightRun.recoveryPointId` (§5.2.6). This includes Postgres, Neo4j, Qdrant, and previous runtime/source identity.
4. **Quiescence drain** — caller invokes `startQuiescence({ trigger: "self-upgrade", triggerRefId: SelfUpgradeRun.runId, ... })` and awaits the coordinator's `ready-to-swap` signal. The coordinator (per the quiescence spec) gates the request layer (Proxy 503 + version headers), Inngest functions (cron skip + event-driven suspend), TaskRuns (cooperative cancel via `quiescing` status flip), BuildPhaseRuns (refuse new starts; in-flight phases continue), and surface-specific entry points. Defer / abort / fail outcomes return without proceeding to migrations.
5. **`signalSwapStarting`** — coordinator records the swap-window opening.
6. **L2 (migrations) applies** using the target release's migration runner — point of no return. Status `migrating`.
7. **L3 (seed deltas) applies** — per operator decisions, with `SeedSnapshot` rows recorded for the new version. Status `seeding`.
8. **L1 (runtime image) swaps container.** Status `swapping`. The promoter (`scripts/promote.sh`) rebuilds + recreates BOTH the `portal` and the `dpf-sandbox` images from the target source — the sandbox `sandbox-refresh` step (after the portal is content-verified, before cleanup) mirrors the portal's unconditional-rebuild contract so Dockerfile.sandbox improvements (the opencode coding agent, host TTS env wiring, provisioned build engines) actually reach installed sandboxes. It is fail-loud-but-not-fail-abort: a sandbox rebuild failure after a verified portal swap emits `step=sandbox-refresh-failed` and still reaches `step=done` rather than reverting a promoted portal (BI-A8686CFC).
9. Health check on new container (DB connectivity, migration state, route table sanity, version endpoint, MCP tool-list sanity).
9a. **Active-candidate gate (planned: BI-6701C6BF — not yet built).** Before routing production traffic to the new container, the same merged SHA must be verified on the dev-portal at `:3001` (the active-candidate tier). The production self-upgrade blocks promotion to `:3000` until the active-candidate reports the expected SHA and passes its own health check. Until BI-6701C6BF lands, this gate is absent and the promoter proceeds directly to production; Phase 5 implementers must not wire a permanent production-direct path that bypasses the future gate.
10. **L4 (sandbox reconciliation) applies** — capsule PAR decisions executed. Status `reconciling`.
11. **`signalSwapComplete`** — coordinator transitions swapping → completed, flips level back to normal, emits `platform.quiescence-cleared` (wakes suspended Inngest functions + dismisses client banner).
12. UI receives `system:quiescence` (level=cleared) → bundle-hash mismatch detection triggers soft reload on next response.
13. **Smoke window** runs for K minutes (default 5min) — synthetic checks per release manifest criteria.
14. If smoke passes → `SelfUpgradeRun.status = succeeded`.
15. If smoke fails → trigger rollback per §5.6 + `failQuiescenceSwap` to record the negative outcome on `QuiescenceRun`.

**Caller integration shape:**

```ts
// In runSelfUpgrade (apps/web/lib/queue/functions/self-upgrade.ts):
const { runId: qId, awaitReady } = await startQuiescence({
  trigger: "self-upgrade",
  triggerRefId: run.runId,
  budgetMs: params.budgetMs,
  shipForce: params.force,
});
const outcome = await awaitReady();
if (!outcome.ok) { /* deferred / aborted / failed — bail */ }

await signalSwapStarting(qId);
const result = await runPromoter({ ... });
if (result.exitCode === 0) {
  await signalSwapComplete(qId);
  // ... success path
} else {
  await failQuiescenceSwap(qId, result.stderr);
  // ... failure path
}
```

**Work-type survival** (now specified per-surface in the quiescence spec §6):

| Surface group | Spec section |
|---|---|
| Inngest cron + event-driven functions | quiescence §6.1 — gateAtEntry / gateBetweenSteps |
| Coworker TaskRuns | quiescence §6.2 — cooperative-cancel via heartbeat |
| SSE streams | quiescence §6.3 + §7.1 — system:quiescence broadcast + EventSource reconnect |
| Request layer / server actions | quiescence §6.4 — Proxy 503 + version headers |
| BuildPhaseRun + sandbox | quiescence §6.5 — entry-point gate + phase budgets |
| MCP tool calls + Postgres txns | quiescence §6.6 — TOOL_WAIT_BUDGETS + upstream gate |
| Unobservable surfaces (G-class) | quiescence §6.7 — transparency via unobservableSurfaces |

### 5.6 Rollback per layer

The key constraint: **L2 (schema migration) is the point of no return.** Past L2 success, the upgrade is committed. Everything before L2 is freely reversible; everything after L2 is roll-forward only.

| Layer | Auto-rollback? | Mechanism |
|---|---|---|
| **L1 — Runtime image** | ✅ Always | Keep the previous image digest and Compose state; swap back to the prior digest automatically when no post-L2 constraint prevents it. Current `scripts/promote.sh` must grow this behavior. |
| **L2 — Schema migration** | ⚠️ Conditional | Additive (paired reverse migration ran in release CI) → automatic. Modifying/destructive → **recovery-point restore only**, requires operator confirmation (data loss = writes since recovery point). |
| **L3 — Seed deltas** | ✅ Always | `SeedSnapshot` from §6 has prior shipped state; reapply previous version's snapshot. Operator customizations untouched. |
| **L4 — Sandbox reconciliation** | ✅ Always | PAR decisions are advisory; capsule branches still exist; reset is a row update. |

Rollback decision tree:

```
Failed at L1 (runtime image)
  → swap back container; no data touched
  → SelfUpgradeRun.status = rolled-back
  → fully automatic

Failed at L2 (migration)
  → SCHEMA PARTIALLY APPLIED — critical state
  → If additive AND reverse migration present → apply reverse, swap back, status = rolled-back
  → If modifying/destructive → operator must approve restore from preflight recovery point
    → status = rolled-back-with-backup-restore
    → data loss = writes since recovery point (typically <5min)
  → If operator declines restore → status = halted-for-manual

Failed at L3 (seed deltas)
  → schema fine; reapply previous version SeedSnapshot
  → swap back container
  → status = rolled-back, no data loss
  → fully automatic

Failed at L4 (sandbox reconciliation)
  → not a hard fail — surface as warning, keep new version
  → operator handles capsule decisions manually

L4 capsule rebase / promote-first fails AFTER the upgrade succeeds
  → upgrade itself stays `succeeded` — the new version is live
  → affected capsule remains on its original base SHA; PAR card re-surfaces in the Upgrade Center
  → operator may switch the decision to `preserve` or `abandon`, or fix-then-retry the rebase
  → not counted as a rollback; the L4 reconciliation is unfinished work, not a failed upgrade

Smoke window fails post-apply
  → if L2 was only additive AND release CI verified expand-then-contract → L1 rollback safe; auto-trigger
  → otherwise must roll forward via patch release; operator alert
```

**Roll-forward by default past L2 success.** Problems are fixed via the next patch release, not by reversing. The recovery point is for catastrophe (corruption, partial-apply mid-L2), not for routine "the new feature has a bug."

## 6. Customization Fingerprint Primitive

### 6.1 The merge-base gap is the load-bearing problem

§2.3 established: the codebase has `isOverridden` markers but no `seedContentHash` / `shippedContent` anywhere. Without storing the upstream base, 3-way merge is impossible — the system can never present `{base, ours, theirs}` to the operator. This is what reduces today's behavior to "skip if customized," which is why installs silently freeze on old archetypes / old prompts forever.

### 6.2 Five new fields on every customizable model

```prisma
// Mixin pattern applied to each customizable model
seedKey            String?  // e.g. "prompt:builder.architect-review"
seedVersionAtBoot  String?  // platform version at last seed apply
seedContentHash    String?  // hash of shipped content; semantics vary by fingerprintMode — see §6.4
isOverridden       Boolean  @default(false)  // operator edit marker (existing on 3 models; additive on the rest)
seedAppliedAt      DateTime?
```

**Migration blast radius (pass-2 architect enumeration).** The mixin lands on every model declared in `SEED_REGISTRY` (§6.4). As of 2026-05-31, `isOverridden` exists on 3 models (`PromptTemplate`, two reference-data models at schema lines 8383/8403); `seedKey` / `seedVersionAtBoot` / `seedContentHash` / `seedAppliedAt` exist on zero. Models expected to receive the full mixin (covering the 13 reconciliation modes in §2.4): `PromptTemplate`, `SkillDefinition`, `WikiPage` (uses overlay mode — `seedContentHash` stays null), `StorefrontArchetype`, `AgentToolGrant`, `Capability` / `ServiceOffering` (MCP service definitions), IT4IT taxonomy rows, principle kernel pages, and provider-registry rows that operators are allowed to override. Per §4.5 rule 3, every column addition MUST be `additive` (nullable, no `NOT NULL` without default, no rewriting existing rows) so the mixin can ship in a Phase 3 `minor` release without forcing a `major` bump. `SeedSnapshot.contentBody` is `String` (Prisma `Text`) — confirm Postgres `text` for unbounded length so large prompt files (10KB+) and archetype JSON payloads don't truncate. `BI-UPGRADE-005` MUST publish the per-model migration list before Phase 3 ships, with each migration's CI-asserted `additive` kind classification visible in the release manifest.

### 6.3 SeedSnapshot table holds the merge base

```prisma
model SeedSnapshot {
  id              String   @id
  seedKey         String
  platformVersion String
  contentHash     String
  contentBody     String   // JSON or text, depending on model
  shippedAt       DateTime

  @@unique([seedKey, platformVersion])
  @@index([seedKey])
}
```

Append-only. Every release CI populates rows for every shipped customizable entity. At preflight, the install fetches the snapshot for `seedKey + fromVersion` (base) and `seedKey + targetVersion` (theirs), reads the current row (ours), and computes the 3-way merge.

Normalized rather than inline (Option B from research) because the same shipped content can be referenced from N customized rows once tenant scoping arrives, and append-only makes it a clean audit substrate.

### 6.4 Seed registry — one source of truth for all 13 modes

A new `packages/db/src/seed-registry.ts` declares every customizable model and its fingerprint mode:

```ts
export const SEED_REGISTRY: SeedRegistryEntry[] = [
  { model: "PromptTemplate",      keyField: "slug",       mode: "content-hash",    auditTable: "PromptRevision" },
  { model: "SkillDefinition",     keyField: "skillId",    mode: "content-hash",    auditTable: "SkillRevision" },
  { model: "WikiPage",            keyField: "pageId",     mode: "overlay",         auditTable: "WikiPageRevision" },
  { model: "StorefrontArchetype", keyField: "archetypeId",mode: "excluded-fields", excludedFields: ["isActive"] },
  { model: "AgentToolGrant",      keyField: "grantId",    mode: "audit-trace",     auditTable: "BuildActivity" },
  // remaining registry entries cover the inventory in §2.4
];
```

Four fingerprint modes (formalizing the three ad-hoc patterns plus one additive). All values are hyphenated per AGENTS.md §11 enum convention — pass-2 architect normalization (§1.2).

- **`content-hash`** — the new pattern (§6.2). Default. Used for prompts, skills, principles, IT4IT taxonomy, MCP service definitions.
- **`overlay`** — keep wiki kernel's existing pattern (`kernelPageId` + `derivedFromKernelVersion`). Used where rich org-overlay relationships exist.
- **`excluded-fields`** — formalize the archetype "exclude `isActive` on upsert" pattern. Registry declares operator-customizable columns; upgrade preserves those, replaces the rest. Used for archetype, MCP service definitions.
- **`audit-trace`** — for append-only or fully-audited tables (capsules, grants, build artifacts), customization is provable via revision walk. Used where upgrade never overwrites (only ADDS new rows).

**Hash semantics per fingerprint mode (pass-2 architect clarification).** The §6.2 mixin's `seedContentHash` column carries different meanings across the four modes; implementers must not collapse them to one shape:

| Mode | What `seedContentHash` stores | What gets hashed |
|---|---|---|
| `content-hash` | sha256 hex string | The full canonical content body as shipped (prompt text, skill manifest JSON, principle markdown body). The 3-way merge compares `base.contentHash` vs `ours.contentHash` vs `theirs.contentHash`. |
| `overlay` | kernel version reference (e.g. `kernelPageId@derivedFromKernelVersion`) — NOT a content hash | The merge base is the kernel page referenced; the overlay row's content is intentionally divergent. `seedContentHash` carries the reference identity, not a body hash, because comparing overlay body bytes to kernel body bytes is a category error in the overlay model. |
| `excluded-fields` | sha256 hex string over the hashed projection | The complement of `excludedFields[]` from the seed-shipped row, canonicalized (key-sorted JSON) and hashed. Operator-owned fields are excluded from the hash so an operator's `isActive=false` doesn't show as a phantom "ours vs theirs" diff. |
| `audit-trace` | `null` | No hash; the merge base is reconstructed from the audit-table revision walk (`auditTable: "PromptRevision"` etc.). Upgrade never overwrites these rows — it only ADDs new ones — so a hash would be meaningless. |

The seed apply path reads from the registry; the preflight evidence path reads from the registry; the operator surface reads from the registry. One source of truth, no drift possible.

Seed registry entries must also carry contribution-fit metadata once a seed row
originates from a hive PR rather than the DPF-maintained baseline:

- `distributionScope`: `global-default`, `archetype-scoped`, or
  `vertical-scoped`.
- `applicableArchetypeCategories` / `applicableVerticals`: empty only when the
  scope is `global-default`.
- `sourceContribution`: PR number, FeaturePack id, source install vertical,
  reviewer id, and review timestamp.
- `seedFitDecision`: the final decision from §5.2.4. Rows classified
  `parameterize-first`, `install-local-only`, or `reject-as-seed` are not
  eligible for the canonical seed registry until revised or re-scoped.

This makes seed publication a hive curation act, not a mechanical PR merge.
Release CI can then generate scoped seed-delta manifests, and installed portals
can apply only the global rows plus rows matching their archetype/vertical or
explicit operator opt-in. A contribution may therefore still be accepted as
valuable code, documentation, or a private FeaturePack while its literal seed
payload is rejected or narrowed.

### 6.5 Backfill story

Existing installs have no `seedSnapshot` populated. First upgrade under the new system:

1. Determine the operator's last-known platform version (from `PlatformConfig["platform.version"]`; baselined to `1.0.0` at first install of the new version).
2. For each row in the registry: synthesize a `SeedSnapshot` row from the content currently in the file system at the corresponding shipped version. Best-effort recovery.
3. For rows with `isOverridden=true` and no recoverable base: surface as **"customized, no base — please confirm intent"** rather than silently choosing.

One-time event per install. Awkward but bounded.

## 7. Migration Path From Today

The full lifecycle is not shippable as a single release. Phased rollout:

0. **Phase 0 — Stabilize current self-upgrade substrate.** Pick one Inngest path (`apps/web/lib/queue/functions/self-upgrade.ts`), retire or redirect `portal-self-upgrade.ts`, implement `resolveTargetSha` against the existing SHA target until manifests land, align `SelfUpgradeRun` schema/DTO names, make `emitUpgradeEvent` real or remove it from claims, and ensure `/ops/self-upgrade` can list runs without schema drift. Ship as a fix release before adding new lifecycle features.

1. **Phase 1 — Versioning baseline (partially delivered via ratified pragmatic path).** The baked git-describe + `.dpf-platform-version` / content-hash markers + `loadPlatformVersion()` (see §1.1 and updated §4.1) already provide the single canonical identity and the honest "what was actually built" signal. Remaining Phase 1 work: converge all surfaces (Upgrade Center, health endpoints, MCP tools, SelfUpgradeRun) on `loadPlatformVersion()` as the fromVersion; wire the honest version into preflight evidence (L1); ensure release CI bakes the tag + hashes consistently. Baseline "current" to the real tag lineage (already v5.x range in practice) rather than forcing a v1.0.0 fiction. Ship the convergence + CI bake discipline as patch. Existing SHA path remains the apply substrate until later phases.

2. **Phase 2 — Release CI.** Add the release-impact lint, automatic bump on merge, tag-and-publish, GHCR image publishing, GitHub Releases metadata, cosign signing, SBOM/provenance pointers, and channel manifest (initially `edge` only). Existing self-upgrade still uses SHA-based path; new feed is parallel. Ship as minor release.

3. **Phase 3 — SeedSnapshot + registry.** Add the schema fields, `SeedSnapshot` table, `seed-registry.ts`, update seed apply paths to populate snapshots. Backfill from current shipped content. No preflight surface yet — registry is dormant infrastructure. Ship as minor release (additive migration).

4. **Phase 4 — PreflightRun, recovery point, and operator surface.** Add `PreflightRun` entity, evidence collectors per layer, the pre-upgrade recovery point composer, `/ops/self-upgrade` Upgrade Center, and three-pane diff resolver. Self-upgrade detection switches from SHA target to signed channel manifest. Apply still uses the Phase 0 promoter path. Ship as minor release.

5. **Phase 5 — Graceful recycle + rollback.** Implement drain protocol, stale-bundle signal, layer-aware apply ordering, automated L1 rollback, smoke-window evaluator, and target-image swap. Reverse-migration release-CI obligation begins. Ship as minor release.

6. **Phase 6 — Channel promotion automation.** Add the `edge` → `beta` → `stable` promotion scheduler. Operator-facing channel switcher. Ship as patch release.

Each phase is a Build Studio brief, each ships independently, each is reversible. The full lifecycle is operational after Phase 5; Phase 6 is the cadence layer on top.

## 8. Backlog Decomposition

Proposed breakdown (each a Build Studio brief once spec is approved):

- `BI-UPGRADE-000` — Self-upgrade substrate stabilization: one Inngest path, target SHA resolver, schema/DTO alignment, `/ops/self-upgrade` run listing, event-bus claim cleanup (Phase 0)
- `BI-UPGRADE-000a` — Durable per-install branch (§5.0 prerequisite): commit Build-Studio promotions as real commits on a persistent install branch in the portal's build tree, so customizations survive container rebuild / Docker update / upgrade. Closes the `mcp-tools.ts:8891` "lost on rebuild" hazard. Independent of contribution mode (Phase 0)
- `BI-UPGRADE-000b` — Content-preserving upgrade source (§5.0): `git fetch` the upstream target; advance to its exact canonical SHA when the install has no local content delta, otherwise **merge** into the install branch (never clean-checkout-replace local content); build the prepared result; stamp its true commit SHA (non-circular sha-verify); track upstream lineage separately; clean auto-merge on disjoint files; genuine code conflicts surface in the Upgrade Center as keep-mine/take-upstream/show-diff (never a CLI ask), unresolved → defer and stay on current build. Extends §3.3/§6 3-way merge from seeded content to git/code (Phase 0/4)
- `BI-C26F7EE1` — Upgrade impact summary (§5.0.1): on-demand, install-tailored "what's in this update?" digest in the `/ops/self-upgrade` Upgrade Center and as the `summarize_upgrade_impact` MCP tool. Pipeline: `git log <currentLineageSha>..<targetSha>` → Conventional-Commits classify → relevance score against install signals (archetype / industry / FeaturePack-touched paths and verticals / open `PortfolioQualityIssue` keyword themes) → best-effort GitHub PR enrichment → strict-JSON LLM phrasing. Advisory only; never queues or applies. Path overlap with FeaturePack-touched files doubles as the §5.0 merge-conflict early warning. Cacheable per (`currentLineageSha`, `targetSha`). **Acceptance (pass-2):** unit tests confirm the orchestrator returns `phrased: null` plus the deterministic shape when the LLM returns (a) malformed JSON, (b) item-count mismatch vs the deterministic upstream list, (c) reordered items, or (d) when GitHub enrichment is unreachable. The UI displays raw commit subjects in those cases. No code path lets a fabricated headline, fabricated item, or reordered relevance score reach the operator.
- `BI-UPGRADE-001` — Platform version baseline + `version.json` + `PlatformConfig["platform.version"]` + `/api/platform/version` (Phase 1)
- `BI-UPGRADE-002` — Release-impact lint + release CI tag/build/GHCR publish/GitHub Releases metadata (Phase 2)
- `BI-UPGRADE-003` — Channel manifest publication + signing + DPF release feed host (Phase 2)
- `BI-UPGRADE-004` — `SeedSnapshot` table + schema mixin + seed-registry.ts + backfill (Phase 3)
- `BI-UPGRADE-005` — Customizable-model migrations: add five fields to PromptTemplate, SkillDefinition, etc. per registry (Phase 3)
- `BI-UPGRADE-006` — Migration kind classifier + reverse-migration CI obligation (Phase 5, but lint can land in Phase 2)
- `BI-UPGRADE-007` — `PreflightRun` entity + four layer evidence collectors (Phase 4)
- `BI-UPGRADE-007a` — Pre-upgrade recovery point composer: extend `BackupTrigger` with `"pre-upgrade"`, invoke Postgres/Neo4j/Qdrant backup runners, verify checksums, capture previous image/source identity, and block apply when Postgres protection is missing (Phase 4)
- `BI-UPGRADE-007b` — Worker worktree inventory + verification-readiness evidence: collect active worker branches/worktrees, dirty state, touched paths, base SHA, heartbeat, and `compile-ready` vs `source-only`; block only on dirty uncaptured output or promoted changes lacking canonical-runtime evidence (Phase 4)
- `BI-UPGRADE-008` — Shadow-DB dry-run runner for Layer 2 (Phase 4)
- `BI-UPGRADE-009` — `/ops/self-upgrade` Upgrade Center: overview + evidence tabs + 3-pane diff + run timeline (Phase 4)
- `BI-UPGRADE-010` — Self-upgrade detection switch from SHA to channel manifest (Phase 4)
- `BI-UPGRADE-011` — Drain protocol + stale-bundle signal + `platform.upgrading` event (Phase 5)
- `BI-UPGRADE-012` — Layer-aware apply ordering + smoke-window evaluator + automated L1 rollback (Phase 5)
- `BI-UPGRADE-013` — Channel promotion scheduler (`edge` → `beta` → `stable`) (Phase 6)

## 9. Acceptance Criteria

The system is complete when:

1. `/ops/self-upgrade` uses one canonical self-upgrade path; run history can be listed from `SelfUpgradeRun` without schema/DTO drift, and target resolution returns a real candidate instead of `no-target`.
2. The answer to "what platform version is this install on?" is identical from the UI, the API (`/api/platform/version`), the channel manifest, the image labels, the git tag, and `loadPlatformVersion()` programmatic callers. **No `PlatformConfig` mirror exists** — a CI assertion confirms no code reads `PlatformConfig["platform.version"]` for runtime identity (pass-2 §1.2 / §4.1 correction; closes BI-C8E90A79 drift class).
3. A `feat:` PR merged to main automatically produces a new minor release, signs the images and manifest, publishes GHCR image digests plus GitHub Release metadata, and the `edge` channel install detects it within one configured check interval. When `releases.dpf.dev` is unreachable, the install falls back to the GitHub Releases API for `stable`-channel-only recovery detection per §5.1; `edge` and `beta` remain manifest-only (no GitHub-latest fallback for prerelease channels).
4. An operator on `stable` who has customized `prompt:builder.architect-review` sees a three-pane diff (base / ours / theirs) at preflight time when upstream changes that prompt — and their decision is recorded against the `PreflightRun`.
5. A Prisma migration that adds a column to a 50M-row table is detected as `modifying` at release time, dry-runs against a shadow DB at preflight time, and surfaces lock-time estimate to the operator.
6. A `destructive` migration is rejected by release CI if it appears in a non-major bump.
7. Recycle during an active executor session: the session is paused, the user sees a banner, the swap happens, the session resumes from the same Inngest checkpoint without operator-visible work loss.
8. A health-check failure post-swap automatically rolls back the L1 image when expand-then-contract was respected; surfaces operator alert otherwise.
9. An archetype customization that was soft-deleted survives an upgrade where upstream renamed that archetype.
10. A `FeaturePack` in `contributing` status whose upstream PR merges between cron cycles is auto-marked `accepted` after the next pull of the new version. **Detection path (pass-2 §1.2):** the release-CI seed-delta manifest (§4.3 step 6) lists the PR numbers included in the release; the install's seed-delta apply joins `FeaturePack.upstreamPRNumber` (new field; existing on the model — confirm in BI-UPGRADE-005) against that PR list and flips status to `accepted` for any matching `contributing` row. No structural file-content match required.
11. The operator has never run a shell command, a SQL query, or a `docker` command during any successful upgrade.

## 10. Out of Scope

- **Airgapped / offline installs.** Needs a sneakernet variant (USB-portable signed manifest + images). Worth a separate spec; deferring.
- **Multi-tenant upgrade.** DPF is single-org-per-install per internal memory signal `project_single_org_per_install.md`.
- **Cross-major-version data migrations** (e.g. operator-generated content that needs structural updates beyond what `prisma migrate` covers). Separate concern; treat as per-major-version playbook for now.
- **Auto-apply mode for `major` bumps.** Never. Major upgrades require explicit operator review by design.
- **Operator-hosted internal mirror** of `releases.dpf.dev` for large customers. Same shape; easy to add later.
- **Upgrade scheduling beyond "now / defer to next idle / maintenance-window apply"**. A full upgrade-window calendar is out of scope; configured interval checks plus operator-triggered preflight are sufficient for v1.

## 11. Open Questions for Operator Decision

These do not block spec approval, but should be settled before Phase 2 ships:

1. **Where does `releases.dpf.dev` host?** Proposed: GitHub Pages from the gh-pages branch of the main repo, populated by release CI. Free, zero-ops, hosted alongside source. Alternative: Cloudflare Worker for routing flexibility.
2. **Signing key rotation policy.** Proposed: Sigstore "keyless" with GitHub OIDC binding (no key management). Alternative: dedicated cosign key stored in 1Password.
3. **`edge` → `beta` soak time.** Proposed: 24 hours with no rollback signal from any `edge` install. Telemetry source remains an operator decision; the default should be an anonymous, opt-in rollback signal in the cron poll.
4. **`beta` → `stable` soak time.** Proposed: 7 days clean.
5. **Hotfix lane.** Confirmed in design but flow unspecified: does a security patch jump straight to `stable`, or still soak briefly in `beta` with reduced timer?
6. **Smoke-window criteria default.** What error-rate threshold and which health endpoints constitute "healthy" out of the box?
7. **First-install version derivation for backfill** (§6.5). For installs that predate `PlatformConfig["platform.version"]`, what's the rule for synthesizing their "current version"? Proposed: nearest tag ancestor of their current git SHA at the time of first new-system boot.

## 12. References

**Live backlog**

- BI: [BI-5B3FA415](http://localhost:3000/admin/backlog/BI-5B3FA415) — Governed platform upgrade lifecycle. Live state checked 2026-05-24: status `triaging`, no linked epic.

**Repo-local anchors**

- [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](2026-05-09-deployment-contracts.md) — canonical release artifact, lifecycle, backup, restore, and rollback doctrine (Contract 1/3/6 in scope for this spec).
- [`docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`](2026-05-09-build-execution-provider-design.md) — L4 worker worktree + Build Studio agent substrate (cross-referenced for Grok and PAR decisions).
- [`docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md`](2026-05-24-activity-quiescence-protocol-design.md) — extracted drain protocol (replaces former §5.5; already carries prior chief-architect review).
- [`docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md`](../audits/2026-05-21-bs-end-to-end-cycle-blockers.md) — self-upgrade invalidated server actions mid-session.
- [`docs/triage/2026-05-22-overnight-session-summary.md`](../../triage/2026-05-22-overnight-session-summary.md) — self-upgrade recycling broke MCP/server actions and left stale promotion state.
- [`docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`](2026-05-22-build-studio-sandbox-admin-recovery-design.md) — adjacent sandbox/admin recovery design.
- `apps/web/lib/platform/version.ts` + `image-version.ts` — the ratified pragmatic versioning substrate (see §1.1, §2.1, §4.1).
- [`docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md`](../../../docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- [`docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md`](../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md)
- [`docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md`](../../../docs/founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md) — binding for L4 and §5.0 merge strategy.

**External standards and benchmarks**

- [Semantic Versioning 2.0.0](https://semver.org/)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
- [NIST SP 800-34 Rev. 1, Contingency Planning Guide for Federal Information Systems](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final) — recovery strategies, alternate processing, and exercising contingency plans.
- [PostgreSQL `pg_restore`](https://www.postgresql.org/docs/17/app-pgrestore.html) — custom/archive restore behavior used by Postgres recovery and trial restore.
- [Docker volumes: back up, restore, or migrate data volumes](https://docs.docker.com/engine/storage/volumes/#back-up-restore-or-migrate-data-volumes) — reminder that volume persistence is not a backup by itself; restore testing needs an explicit target.
- [Neo4j Operations Manual: restore a database dump](https://neo4j.com/docs/operations-manual/current/backup-restore/restore-dump/) — isolated graph restore rehearsal requirements, including offline load constraints for Community edition.
- [Qdrant snapshots](https://qdrant.tech/documentation/operations/snapshots/) — full-storage and collection snapshot recovery constraints for the vector member.
- [Sigstore/cosign signing overview](https://docs.sigstore.dev/cosign/signing/overview/)
- [GitHub Releases API — latest release](https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#get-the-latest-release)
- [GitLab release and maintenance policy](https://docs.gitlab.com/policy/maintenance/)
- [Chrome release channels](https://developer.chrome.com/docs/web-platform/chrome-release-channels)
- [WordPress upgrading / automatic background updates](https://developer.wordpress.org/advanced-administration/upgrade/upgrading/#configuring-automatic-background-updates)

**Internal memory signals used as source prompts, not repo-local links**

- `project_self_upgrade_kills_in_session_ux.md`
- `project_archetype_is_bootstrap.md`
- `project_silent_seed_skips_audit.md`
- `feedback_db_seed_migration_sync.md`
- `feedback_governance_approves_evidence_not_provenance.md`
- `feedback_propose_acknowledge_reassign.md`
- `project_single_org_per_install.md`
