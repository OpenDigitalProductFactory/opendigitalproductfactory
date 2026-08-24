---
title: Consumer registry-channel self-upgrade
status: active
backlog_item: BI-C3B0B2EA
decision_interaction: DI-1483263456A9
supersedes_target_contract_in: docs/superpowers/specs/2026-08-22-consumer-self-upgrade-design.md
---

# Consumer registry-channel self-upgrade

## Problem

The consumer self-upgrade lifecycle can promote immutable release images, but it discovers them from successful GitHub tag-push workflow runs. The delivery pipeline has a different contract: verification-gated GHCR `latest` is the customer upgrade channel. A successful manual image publication can therefore move `latest` without creating a GitHub Release or tag-push run. Consumer installs then report “up to date” and queue an upgrade that later skips even though newer verified image bytes exist.

Observed on the development consumer install on 2026-08-24:

- the running portal was `v2026.08.23-cycle4.1`, source `d104cd37…`, local image ID `sha256:e62ad4…`;
- `ghcr.io/opendigitalproductfactory/dpf-portal:latest` resolved to index digest `sha256:a94d98…`, amd64 revision `04f1cfd4…`, after a fully green publish and release-install verification run;
- `get_self_upgrade_queue_status` still returned `up-to-date: v2026.08.23-cycle4.1` because `resolveReleaseUpgradeCandidate` read `readLatestReleaseStamp` rather than GHCR;
- `.github/workflows/publish-image.yml` says `latest` is what customer installs self-upgrade against and advances it only after E2E verification;
- the same workflow stamped `DPF_PLATFORM_VERSION` and `org.opencontainers.image.version` from `github.ref_name`, which is `main` for manual dispatch even though the immutable published tag was `v2026.08.24`.

This is one contract split with two visible symptoms: the resolver consults the wrong authority, and the page offers “Upgrade now” while declaring the install current, then reports “Upgrade queued” for work that deterministically no-ops.

## Prior substrate retained

The 2026-08-22 consumer release-artifact design remains authoritative for install classification, complete installer state, candidate-owned readiness, quiescence, recovery points, migrations, health verification, release-asset installation, rollback, and contributor/source upgrades. This design replaces only its release target contract and tightens the operator projection.

No new database model, queue, deploy mechanism, channel selector, or lifecycle branch is introduced.

## Design grounding

- Existing specs/plans reviewed: `docs/superpowers/specs/2026-08-22-consumer-self-upgrade-design.md`, `docs/superpowers/plans/2026-08-22-consumer-self-upgrade.md`, and the governed-upgrade lifecycle contracts they cite.
- Current code substrate reviewed: `apps/web/lib/self-upgrade/release-target.ts`, `apps/web/lib/queue/functions/self-upgrade.ts`, `apps/web/lib/actions/promotions.ts`, `scripts/promote.sh`, `.github/workflows/publish-image.yml`, and the `/ops/self-upgrade` page/card/control projection.
- Source of truth: verification-gated GHCR channel manifest/config bytes for the candidate, Docker container config digest for the running bytes, and canonical install state for topology and immutable rollback identity.
- Decision: kernel record `DI-1483263456A9` selected `channel-to-immutable-candidate`; the implementation reuses the existing promotion lifecycle and rejects mutable-tag deployment and GitHub release-run discovery authority.

Standards reviewed:

- The [OCI Distribution Specification](https://github.com/opencontainers/distribution-spec/blob/main/spec.md) defines a tag as a human-readable pointer to a manifest and a digest as the content identifier. Manifest `GET`/`HEAD` returns `Docker-Content-Digest`; clients using it verify the returned bytes.
- The [OCI Image annotations contract](https://github.com/opencontainers/image-spec/blob/main/annotations.md) defines `org.opencontainers.image.version` as the packaged software version and `org.opencontainers.image.revision` as the source revision.
- DPF's `image-identity-equals-bytes` kernel principle requires a pre-swap equality proof and forbids trusting a version label without the bytes.
- Kernel decision `DI-1483263456A9` selected `channel-to-immutable-candidate` with high confidence and autonomy eligible. Direct mutable-`latest` deployment and keeping GitHub Releases authoritative were rejected.

## Objectives and requirements

- **R1 — Correct authority:** consumer/customer discovery reads the configured GHCR channel tag (`DPF_IMAGE_CHANNEL_TAG`, default `latest`), not the installed immutable tag or GitHub release-run history. The discovery channel remains stable when promotion persists a new immutable `imageTag` for rollback identity.
- **R2 — Metadata-only polling:** normal checks fetch manifests and config metadata only; they do not pull image layers or mutate the daemon.
- **R3 — Frozen candidate:** the channel index digest, platform manifest/config digest, release tag, and source SHA are resolved once and validated before any drain.
- **R4 — Immutable acquisition:** promotion uses the immutable release tag whose manifest digest equals the channel digest; it never deploys mutable `latest`.
- **R5 — Byte freshness:** the current container image/config digest is the primary freshness comparison. Source SHA and recorded tag remain corroborating identity, not a substitute for bytes.
- **R6 — Publication identity:** image builds stamp the workflow's validated immutable tag and source SHA in OCI labels and the in-image platform version.
- **R7 — Legacy recovery:** an already-published channel image stamped with a non-release version may use a bounded tag-to-digest lookup. It proceeds only when exactly one valid immutable release tag points to the channel digest.
- **R8 — Fail closed:** missing, malformed, unverifiable, inconsistent, ambiguous, or unreachable registry metadata produces an explicit unavailable/check-failed state before quiescence.
- **R9 — Truthful action:** “Upgrade now” is available only when a newer immutable candidate is resolved. Current/unavailable states do not render a mutation control or claim that an upgrade was queued.
- **R10 — Existing safety envelope:** the same candidate promoter digest, quiescence, recovery, migration, health, asset transaction, and rollback evidence remain mandatory.
- **R11 — No Git regression:** contributor upstream/local discovery remains unchanged; release installs never invoke Git.
- **R12 — Measured fit:** the exact `/ops/self-upgrade` diff is verified at desktop and narrow widths in light and dark themes with a UX-fit artifact.

## Architecture

### Sources of truth

| Concern | Authority | Projection |
|---|---|---|
| Configured update channel | consumer install state `imageTag` and `ghcrOwner` | registry channel reference |
| Available verified bytes | GHCR channel manifest after the publish workflow's verification gate | immutable candidate |
| Candidate source/version identity | verified OCI config labels | target SHA and release tag |
| Current bytes | Docker container `.Image` config digest | freshness comparison |
| Installed release topology | install state `composeFiles`, path, owner | promoter inputs |
| Upgrade lifecycle | existing self-upgrade orchestrator/promoter | run and recovery evidence |

GitHub release-health remains the release-observability source for tag-push releases; it is no longer consumer update discovery authority.

### Registry candidate read

A server-only registry reader receives the owner, portal repository, channel tag, and runtime platform. It:

1. requests the channel manifest using OCI/Docker manifest media types and follows the registry's Bearer challenge;
2. verifies the response body against `Docker-Content-Digest` and parses a bounded manifest/index;
3. selects exactly one supported runtime-platform manifest and verifies its body/digest;
4. fetches and verifies the referenced image config blob, then reads version and revision labels;
5. requires a 40-character source SHA and a valid DPF release tag;
6. resolves that immutable tag and requires its manifest digest to equal the channel digest;
7. returns the immutable tag, source SHA, channel/index digest, platform manifest digest, and config digest.

The reader bounds response bytes, redirect/auth hosts, timeouts, tag pages, and legacy concurrency. GHCR config-blob redirects are followed without forwarding registry authorization and only to GitHub's package-content host; the downloaded bytes must hash to the config digest from the verified platform manifest. Registry errors are short stable reasons; response bodies and tokens never reach operator copy.

### Legacy tag recovery

Images published before R6 may have a valid source revision but `version=main`. For that shape only, the reader lists at most 200 tags, filters the existing release-tag grammar, and compares their manifest digests to the already-verified channel digest. One match becomes the immutable candidate. Zero or multiple matches are unavailable; lexical or date guessing is forbidden. Once a correctly stamped image is installed, this branch is not used.

### Freshness and orchestration

`resolveReleaseUpgradeCandidate` accepts the registry candidate plus the current container config digest:

- equal config digest -> `up-to-date`;
- different config digest with valid frozen candidate -> `target`;
- no verifiable candidate/current digest -> `no-published-target` with a specific registry reason.

The actions page and queue call the same resolver. The queue stores the candidate tag/SHA in the existing run plan, resolves the candidate promoter by immutable digest, and passes the immutable tag plus expected portal config digest to release-mode `promote.sh`. The shell path verifies both the pulled portal bytes and revision before extracting assets or swapping services. Rollback continues to restore the prior recorded tag and recovery state.

### Publication contract

The build job uses `needs.gate.outputs.tag`, not `github.ref_name`, for `DPF_PLATFORM_VERSION` and `org.opencontainers.image.version`; `github.sha` remains the revision. Contract tests lock the relationship between the gate output, build args, labels, immutable merge tag, and verification-gated `latest` promotion.

### UX fit review — consumer registry self-upgrade

- Decision: fits.
- Owning area: Platform operations; existing `/ops/self-upgrade` route remains canonical.
- Persona: the DPF operator maintaining a source-free consumer install.
- Navigation: contextual action only; no navigation or strategy selector is added.
- Reuse: `OwnerReleaseCard` and `SelfUpgradeTriggerControl` remain; the trigger receives a closed action state derived from the same target result as the summary.
- Source truth: the server-only registry candidate resolver plus the running container config digest.
- Current: show automatic updates enabled and the resolved current version, without an Upgrade button.
- Update available: show current and target immutable versions plus “Upgrade now”.
- Checking/unavailable: name that update availability could not be verified and preserve the last run evidence; never say “latest” or show a mutation control without a target.
- In flight: show the existing progress state. A failed attempt retains retry only while a newer resolved candidate remains.
- AI boundary: none.
- Required plan/spec edits: incorporated registry/current/unavailable state semantics and immutable target copy here and in the implementation plan.
- Evidence before merge: route/component/summary tests, theme and UX gates, live registry proof, and a governed browser viewport/failure-state exercise.
- Captured in: this section and `docs/ux-fit/2026-08-24-consumer-registry-self-upgrade.ux-fit.json`.

## Scale ceiling

Normal polling is constant-request metadata work. The compatibility scan is capped at 200 release tags and bounded concurrency; reaching the cap fails unavailable and requires a correctly stamped publication rather than an unbounded registry crawl. No image layer is downloaded until the operator/scheduler has a validated target and candidate readiness begins.

## Verification

- Registry-reader tests cover auth challenge, digest verification, multi-arch selection, correct labels, immutable-tag equality, response limits, malformed inputs, and legacy unique/zero/ambiguous matches.
- Target tests prove byte-digest current/newer semantics and explicit registry failure reasons.
- Action and queue tests prove both surfaces consume the same registry target, release mode never invokes Git, and immutable tag/SHA reach preflight/promotion.
- Workflow contract tests prove validated tag stamping and verification-gated `latest` promotion.
- UI tests cover current, available, unavailable, queued/in-flight, and failed states; no current state exposes “Upgrade now” or “Upgrade queued.”
- Promoter functional tests retain pull, revision check, recovery, health, asset transaction, and rollback coverage.
- Exact-tree gates and governed shared-nonproduction verification exercise the actual route. A real end-to-end consumer self-swap requires two publications: the first containing this resolver and the second presenting newer verified bytes.

## Non-goals

- Deploying mutable `latest` directly.
- Turning consumer installs into source checkouts or local builders.
- Replacing the existing self-upgrade lifecycle, recovery model, or release-health screen.
- Adding operator-managed registry credentials or channel selection in this slice.
- Mutating the live install outside `/ops/self-upgrade`.
