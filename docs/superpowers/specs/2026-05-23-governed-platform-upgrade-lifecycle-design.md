# Governed Platform Upgrade Lifecycle

| Field | Value |
| --- | --- |
| Date | 2026-05-23 |
| Status | Draft for review - repo-grounded revision |
| Primary epic | None linked yet. Live backlog item `BI-5B3FA415` is in `triaging`; live open-epic scan found no existing platform-upgrade epic to extend. |
| Related backlog | `BI-5B3FA415` Governed platform upgrade lifecycle |
| Related docs | `docs/superpowers/specs/2026-05-09-deployment-contracts.md`; `docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`; `docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md`; `docs/triage/2026-05-22-overnight-session-summary.md`; `2026-04-20-ship-phase-fork-redesign-design.md` |
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

## 2. Current Repo Truth Checked

### 2.1 Platform versioning gap

- Root `package.json` has **no `version` field** (`"private": true`, no version declared).
- Sub-package versions (`apps/web`, `packages/db`, `packages/storefront-templates`, etc.) are stuck at `0.1.0` or `0.0.1` — nobody bumps them; no automation drives bumps from merges.
- The running install has no concept of "platform version" — `PlatformConfig` carries upgrade configuration but no version field.
- `SelfUpgradeRun` tracks `currentSha`, `targetSha`, `deployedSha` (git SHA-based), not semantic versions. Every commit looks like a candidate upgrade event.
- The current `/ops/self-upgrade` UI exposes `deployedSha` and `targetSha`, not a platform release train or channel manifest.
- Consequence: when target resolution is wired, every merge to `main` can look like an upgrade target unless a release/channel layer sits between git history and install behavior.

### 2.2 Self-upgrade machinery (partial foundation exists)

- `apps/web/lib/queue/functions/portal-self-upgrade.ts` defines the legacy daily 8am scheduled function, manual request, and 15-minute completion sweep. Its `runSelfUpgradeCycle` and `completePendingSelfUpgradeRuns` targets are now compatibility stubs in `apps/web/lib/self-upgrade/index.ts` and `apps/web/lib/self-upgrade/completion.ts`.
- `apps/web/lib/queue/functions/self-upgrade.ts` is the newer active path: hourly cron, manual event `ops/self-upgrade.run`, maintenance-window gating, one-run concurrency, active-portal deferral, `runPromoter`, and run status updates.
- `apps/web/lib/self-upgrade/version.ts` still returns `null` from `resolveTargetSha(_channel)`, so the newer path currently skips with `no-target` until target-channel resolution is implemented.
- `apps/web/lib/self-upgrade/activity.ts` defers upgrades when non-edge `ToolExecution` activity occurred inside the last five minutes. This is a useful stopgap, but it is not a graceful drain protocol and it has no per-session client handshake.
- `apps/web/lib/self-upgrade/notifications.ts` exposes `emitUpgradeEvent`, but it is a no-op until the event bus is wired.
- `scripts/promote.sh` validates environment, backs up the source directory, builds a Docker image, force-recreates Compose services, checks health, and verifies SHA. It does **not** fetch/checkout the target SHA, run migrations, apply seed deltas, drain clients, or automatically roll back on failure.
- `SelfUpgradeRun` schema uses `trigger`, `currentSha`, `targetSha`, `deployedSha`, and `failureLog`; `apps/web/lib/actions/promotions.ts` and `SelfUpgradeClient.tsx` use DTO names like `triggeredBy`, `fromVersion`, `toVersion`, and `error`. That schema/API naming drift must be resolved before this lifecycle can rely on the current run history surface.
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

### 4.1 Platform version is a first-class concept

A single canonical platform version, written to one place and reflected throughout:

- **Source of truth**: `version.json` at repo root, updated only by release CI and committed/tagged as part of the release event.
- **Runtime mirror**: `PlatformConfig` row keyed as `platform.version`, written at boot from the bundled `version.json`. Use the existing key/value model rather than adding a parallel `platform_version` column.
- **Manifest exposure**: every release publishes its version to the channel manifest (§4.4).
- **Image exposure**: installed-runtime images carry OCI labels for `org.opencontainers.image.version`, `org.opencontainers.image.revision`, and `org.opencontainers.image.created`.
- **UI exposure**: visible in `/ops/self-upgrade` and the platform about/settings surface.
- **API exposure**: a public `/api/platform/version` endpoint returns `{ version, gitSha, builtAt }`.

The answer to "what version am I running?" must be identical regardless of how it's asked.

### 4.2 SemVer with conventional commits / PR labels

`MAJOR.MINOR.PATCH`. Bump determined automatically from PR metadata at merge time:

- `fix:` → patch
- `feat:` → minor
- `BREAKING CHANGE:` footer, or any migration declared `destructive`, or any seed-delta declared `archetype-shape-breaking` → major

Release CI runs a lint that requires every merged PR to declare its bump category through the squash commit prefix or a release-impact PR label. Missing release-impact metadata fails for runtime/schema/seed changes; docs-only changes may declare `release: none` and skip artifact publication. Ambiguous categories fail the lint.

**Baseline event:** one-time switch declaring current `main` as `v1.0.0`. Sub-package versions are decoupled from platform version (they remain internal coordination tools); `v1.0.0` is platform-level.

**Pre-1.0 sidestepped** by baselining directly to `1.0.0`, avoiding the "minor = breaking" pre-1.0 semver convention.

### 4.3 Release CI is the cut-and-publish automation

On every merge to `main`, a release CI workflow runs:

1. Determine bump from PR metadata.
2. Write new version to `version.json`.
3. Tag `v<version>` and push the tag.
4. Build and publish versioned multi-arch installed-runtime images to GHCR, matching the deployment-contract doctrine.
5. Build the **migration manifest** — list pending Prisma migrations between previous tag and this one, with each migration classified (additive / modifying / destructive) by parsing the SQL.
6. Build the **seed-delta manifest** — diff the shipped seed content (prompts, skills, principles, archetype, IT4IT taxonomy, MCP service definitions) against the previous tag, produce a structured delta document keyed by `seedKey`.
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

A new entity `PreflightRun` is the pre-commit audit artifact, distinct from `SelfUpgradeRun` (which becomes the apply-phase audit):

```prisma
model PreflightRun {
  id                String   @id
  fromVersion       String
  targetVersion     String
  channel           String
  bumpType          String   // patch | minor | major
  status            String   // gathering | awaiting_operator | approved | rejected | applied | failed
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
  backupSnapshotId  String?  // DB dump taken before apply
}
```

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
  "fingerprintMode": "CONTENT_HASH",
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
| `inFlightContributions` | FeaturePack rows in `contributing` status |
| `pendingContributionsNeedingRebase` | local FeaturePack drafts cut from now-historical main |
| `parDecisions` per capsule | one of `rebase` / `preserve` / `abandon` / `promote-first` (PAR pattern from internal memory signal `feedback_propose_acknowledge_reassign.md`) |

No hard blocks at this layer — all four are surfaced as decisions because PAR says the owner decides reassignment, never the system.

Default suggestions per capsule (operator can override):

- Phase < ship and no scope collision → `rebase`
- Phase ≥ ship → `promote-first`
- Capsule idle past staleness threshold → `abandon` candidate (with confirmation)

#### 5.2.5 Cross-cutting evidence

| Field | Purpose |
|---|---|
| `backupSnapshotId` | DB dump taken before any apply (mandatory) |
| `rollbackFeasibility` per layer | L1: always; L2: conditional; L3: always; L4: manual |
| `estimatedApplyTime` | rough budget for the recycle window |
| `windowGate` | active session count, BS phase mid-gate count |

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

After operator approval:

1. Operator approves preflight → `SelfUpgradeRun` row inserted and linked to `PreflightRun.id`. Phase 0 expands the status vocabulary beyond today's `pending` / `running` / `succeeded` / `failed` / `cancelled` to include layer states.
2. Pull and verify the signed target images, but do not route traffic to them yet.
3. Take the mandatory backup snapshot recorded on `PreflightRun.backupSnapshotId`.
4. Server enters drain mode:
   - New long-running requests rejected with `503 Upgrade In Progress, Retry-After: 30`.
   - Short reads keep working.
   - SSE streams emit `platform.upgrading` event then close cleanly.
5. UI receives `platform.upgrading` → banner shown, executor flows pause locally (Inngest jobs already enqueued keep running, but UI does not issue new ones).
6. Inngest workers stop dequeuing new steps; finish current step then idle.
7. Drain wait: shorter of (a) bounded requests done AND Inngest workers idle, or (b) hard timeout (default 30s).
8. **L2 (migrations) applies here** using the target release's migration runner — point of no return. Status `migrating`.
9. **L3 (seed deltas) applies** — per operator decisions, with `SeedSnapshot` rows recorded for the new version. Status `seeding`.
10. **L1 (runtime image) swaps container.** Status `swapping`.
11. Health check on new container (DB connectivity, migration state, route table sanity, version endpoint, MCP tool-list sanity).
12. **L4 (sandbox reconciliation) applies** — capsule PAR decisions executed. Status `reconciling`.
13. New container emits `platform.upgraded` over SSE on first client reconnect.
14. UI receives `platform.upgraded` → soft reload triggered by `X-Platform-Version` / `X-Bundle-Hash` mismatch on next request; Inngest functions resume from last checkpoint.
15. **Smoke window** runs for K minutes (default 5min) — synthetic checks per release manifest criteria.
16. If smoke passes → `SelfUpgradeRun.status = succeeded`.
17. If smoke fails → trigger rollback per §5.6.

**Stale-bundle signal:** every response carries `X-Platform-Version: <version>` and `X-Bundle-Hash: <hash>`. Client compares both to its boot values; mismatch → soft reload before the next server action. This does not merely recover after "server actions 404"; it avoids issuing a stale action in the first place.

**Work-type survival:**

| Work type | Survival mechanism |
|---|---|
| Inngest functions (BS phases, executor backbone) | Native checkpointing between steps; resume after swap |
| Short HTTP / server actions | 503 during drain; client retries on new runtime |
| SSE streams | Closed cleanly with `platform.upgrading` event; client reconnects to resumed Inngest function |
| MCP tool calls | Drain window covers them |
| DB transactions | Commit/rollback at swap; new container reconnects |
| Build Studio phase mid-gate | Resumes via Inngest |
| Active capsules | State in DB; recycle is a no-op |

### 5.6 Rollback per layer

The key constraint: **L2 (schema migration) is the point of no return.** Past L2 success, the upgrade is committed. Everything before L2 is freely reversible; everything after L2 is roll-forward only.

| Layer | Auto-rollback? | Mechanism |
|---|---|---|
| **L1 — Runtime image** | ✅ Always | Keep the previous image digest and Compose state; swap back to the prior digest automatically when no post-L2 constraint prevents it. Current `scripts/promote.sh` must grow this behavior. |
| **L2 — Schema migration** | ⚠️ Conditional | Additive (paired reverse migration ran in release CI) → automatic. Modifying/destructive → **backup restore only**, requires operator confirmation (data loss = writes since backup). |
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
  → If modifying/destructive → operator must approve DB restore from preflight backup
    → status = rolled-back-with-backup-restore
    → data loss = writes since backup (typically <5min)
  → If operator declines restore → status = halted-for-manual

Failed at L3 (seed deltas)
  → schema fine; reapply previous version SeedSnapshot
  → swap back container
  → status = rolled-back, no data loss
  → fully automatic

Failed at L4 (sandbox reconciliation)
  → not a hard fail — surface as warning, keep new version
  → operator handles capsule decisions manually

Smoke window fails post-apply
  → if L2 was only additive AND release CI verified expand-then-contract → L1 rollback safe; auto-trigger
  → otherwise must roll forward via patch release; operator alert
```

**Roll-forward by default past L2 success.** Problems are fixed via the next patch release, not by reversing. The backup snapshot is for catastrophe (corruption, partial-apply mid-L2), not for routine "the new feature has a bug."

## 6. Customization Fingerprint Primitive

### 6.1 The merge-base gap is the load-bearing problem

§2.3 established: the codebase has `isOverridden` markers but no `seedContentHash` / `shippedContent` anywhere. Without storing the upstream base, 3-way merge is impossible — the system can never present `{base, ours, theirs}` to the operator. This is what reduces today's behavior to "skip if customized," which is why installs silently freeze on old archetypes / old prompts forever.

### 6.2 Five new fields on every customizable model

```prisma
// Mixin pattern applied to each customizable model
seedKey            String?  // e.g. "prompt:builder.architect-review"
seedVersionAtBoot  String?  // platform version at last seed apply
seedContentHash    String?  // SHA-256 of content as shipped
isOverridden       Boolean  @default(false)  // operator edit marker (existing)
seedAppliedAt      DateTime?
```

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
  { model: "PromptTemplate",      keyField: "slug",       mode: "CONTENT_HASH",   auditTable: "PromptRevision" },
  { model: "SkillDefinition",     keyField: "skillId",    mode: "CONTENT_HASH",   auditTable: "SkillRevision" },
  { model: "WikiPage",            keyField: "pageId",     mode: "OVERLAY",        auditTable: "WikiPageRevision" },
  { model: "StorefrontArchetype", keyField: "archetypeId",mode: "EXCLUDED_FIELDS",excludedFields: ["isActive"] },
  { model: "AgentToolGrant",      keyField: "grantId",    mode: "AUDIT_TRACE",    auditTable: "BuildActivity" },
  // remaining registry entries cover the inventory in §2.4
];
```

Four fingerprint modes (formalizing the three ad-hoc patterns plus one additive):

- **CONTENT_HASH** — the new pattern (§6.2). Default. Used for prompts, skills, principles, IT4IT taxonomy, MCP service definitions.
- **OVERLAY** — keep wiki kernel's existing pattern (`kernelPageId` + `derivedFromKernelVersion`). Used where rich org-overlay relationships exist.
- **EXCLUDED_FIELDS** — formalize the archetype "exclude `isActive` on upsert" pattern. Registry declares operator-customizable columns; upgrade preserves those, replaces the rest. Used for archetype, MCP service definitions.
- **AUDIT_TRACE** — for append-only or fully-audited tables (capsules, grants, build artifacts), customization is provable via revision walk. Used where upgrade never overwrites (only ADDS new rows).

The seed apply path reads from the registry; the preflight evidence path reads from the registry; the operator surface reads from the registry. One source of truth, no drift possible.

### 6.5 Backfill story

Existing installs have no `seedSnapshot` populated. First upgrade under the new system:

1. Determine the operator's last-known platform version (from `PlatformConfig["platform.version"]`; baselined to `1.0.0` at first install of the new version).
2. For each row in the registry: synthesize a `SeedSnapshot` row from the content currently in the file system at the corresponding shipped version. Best-effort recovery.
3. For rows with `isOverridden=true` and no recoverable base: surface as **"customized, no base — please confirm intent"** rather than silently choosing.

One-time event per install. Awkward but bounded.

## 7. Migration Path From Today

The full lifecycle is not shippable as a single release. Phased rollout:

0. **Phase 0 — Stabilize current self-upgrade substrate.** Pick one Inngest path (`apps/web/lib/queue/functions/self-upgrade.ts`), retire or redirect `portal-self-upgrade.ts`, implement `resolveTargetSha` against the existing SHA target until manifests land, align `SelfUpgradeRun` schema/DTO names, make `emitUpgradeEvent` real or remove it from claims, and ensure `/ops/self-upgrade` can list runs without schema drift. Ship as a fix release before adding new lifecycle features.

1. **Phase 1 — Versioning baseline.** Establish `version.json`, baseline to `v1.0.0`, write `PlatformConfig["platform.version"]` at boot, add `/api/platform/version`, and expose the same value in `/ops/self-upgrade`. No CI automation yet. Existing self-upgrade keeps working through the Phase 0 SHA path. Ship as patch release.

2. **Phase 2 — Release CI.** Add the release-impact lint, automatic bump on merge, tag-and-publish, GHCR image publishing, GitHub Releases metadata, cosign signing, SBOM/provenance pointers, and channel manifest (initially `edge` only). Existing self-upgrade still uses SHA-based path; new feed is parallel. Ship as minor release.

3. **Phase 3 — SeedSnapshot + registry.** Add the schema fields, `SeedSnapshot` table, `seed-registry.ts`, update seed apply paths to populate snapshots. Backfill from current shipped content. No preflight surface yet — registry is dormant infrastructure. Ship as minor release (additive migration).

4. **Phase 4 — PreflightRun and operator surface.** Add `PreflightRun` entity, evidence collectors per layer, `/ops/self-upgrade` Upgrade Center, and three-pane diff resolver. Self-upgrade detection switches from SHA target to signed channel manifest. Apply still uses the Phase 0 promoter path. Ship as minor release.

5. **Phase 5 — Graceful recycle + rollback.** Implement drain protocol, stale-bundle signal, layer-aware apply ordering, automated L1 rollback, smoke-window evaluator, and target-image swap. Reverse-migration release-CI obligation begins. Ship as minor release.

6. **Phase 6 — Channel promotion automation.** Add the `edge` → `beta` → `stable` promotion scheduler. Operator-facing channel switcher. Ship as patch release.

Each phase is a Build Studio brief, each ships independently, each is reversible. The full lifecycle is operational after Phase 5; Phase 6 is the cadence layer on top.

## 8. Backlog Decomposition

Proposed breakdown (each a Build Studio brief once spec is approved):

- `BI-UPGRADE-000` — Self-upgrade substrate stabilization: one Inngest path, target SHA resolver, schema/DTO alignment, `/ops/self-upgrade` run listing, event-bus claim cleanup (Phase 0)
- `BI-UPGRADE-001` — Platform version baseline + `version.json` + `PlatformConfig["platform.version"]` + `/api/platform/version` (Phase 1)
- `BI-UPGRADE-002` — Release-impact lint + release CI tag/build/GHCR publish/GitHub Releases metadata (Phase 2)
- `BI-UPGRADE-003` — Channel manifest publication + signing + DPF release feed host (Phase 2)
- `BI-UPGRADE-004` — `SeedSnapshot` table + schema mixin + seed-registry.ts + backfill (Phase 3)
- `BI-UPGRADE-005` — Customizable-model migrations: add five fields to PromptTemplate, SkillDefinition, etc. per registry (Phase 3)
- `BI-UPGRADE-006` — Migration kind classifier + reverse-migration CI obligation (Phase 5, but lint can land in Phase 2)
- `BI-UPGRADE-007` — `PreflightRun` entity + four layer evidence collectors (Phase 4)
- `BI-UPGRADE-008` — Shadow-DB dry-run runner for Layer 2 (Phase 4)
- `BI-UPGRADE-009` — `/ops/self-upgrade` Upgrade Center: overview + evidence tabs + 3-pane diff + run timeline (Phase 4)
- `BI-UPGRADE-010` — Self-upgrade detection switch from SHA to channel manifest (Phase 4)
- `BI-UPGRADE-011` — Drain protocol + stale-bundle signal + `platform.upgrading` event (Phase 5)
- `BI-UPGRADE-012` — Layer-aware apply ordering + smoke-window evaluator + automated L1 rollback (Phase 5)
- `BI-UPGRADE-013` — Channel promotion scheduler (`edge` → `beta` → `stable`) (Phase 6)

## 9. Acceptance Criteria

The system is complete when:

1. `/ops/self-upgrade` uses one canonical self-upgrade path; run history can be listed from `SelfUpgradeRun` without schema/DTO drift, and target resolution returns a real candidate instead of `no-target`.
2. The answer to "what platform version is this install on?" is identical from the UI, the API, `PlatformConfig["platform.version"]`, the manifest, the image labels, and the git tag.
3. A `feat:` PR merged to main automatically produces a new minor release, signs the images and manifest, publishes GHCR image digests plus GitHub Release metadata, and the `edge` channel install detects it within one configured check interval.
4. An operator on `stable` who has customized `prompt:builder.architect-review` sees a three-pane diff (base / ours / theirs) at preflight time when upstream changes that prompt — and their decision is recorded against the `PreflightRun`.
5. A Prisma migration that adds a column to a 50M-row table is detected as `modifying` at release time, dry-runs against a shadow DB at preflight time, and surfaces lock-time estimate to the operator.
6. A `destructive` migration is rejected by release CI if it appears in a non-major bump.
7. Recycle during an active executor session: the session is paused, the user sees a banner, the swap happens, the session resumes from the same Inngest checkpoint without operator-visible work loss.
8. A health-check failure post-swap automatically rolls back the L1 image when expand-then-contract was respected; surfaces operator alert otherwise.
9. An archetype customization that was soft-deleted survives an upgrade where upstream renamed that archetype.
10. A `FeaturePack` in `contributing` status whose upstream PR merges between cron cycles is auto-marked `accepted` after the next pull of the new version (because the train carrying it became the install's running version).
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

- [`docs/superpowers/specs/2026-05-09-deployment-contracts.md`](2026-05-09-deployment-contracts.md) — canonical release artifact, lifecycle, backup, restore, and rollback doctrine.
- [`docs/superpowers/audits/2026-05-21-bs-end-to-end-cycle-blockers.md`](../audits/2026-05-21-bs-end-to-end-cycle-blockers.md) — self-upgrade invalidated server actions mid-session.
- [`docs/triage/2026-05-22-overnight-session-summary.md`](../../triage/2026-05-22-overnight-session-summary.md) — self-upgrade recycling broke MCP/server actions and left stale promotion state.
- [`docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`](2026-05-22-build-studio-sandbox-admin-recovery-design.md) — adjacent sandbox/admin recovery design.
- [`docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md`](../../../docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md)
- [`docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md`](../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md)

**External standards and benchmarks**

- [Semantic Versioning 2.0.0](https://semver.org/)
- [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)
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
