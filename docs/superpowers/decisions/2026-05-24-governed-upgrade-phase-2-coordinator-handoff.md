# Governed Upgrade Phase 2 — Coordinator Handoff Brief

| Field | Value |
| --- | --- |
| Date | 2026-05-24 |
| Status | Open — handed off to coordinating thread for Phase 2 plan-writing |
| Authored by | Session: worktree `relaxed-roentgen-5b366d`, thread coordinating governed-upgrade Phase 0+1 |
| Parent spec | `docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md` |
| Parent BI | `BI-5B3FA415` |
| Reason for handoff | Concurrent work on adjacent surface area is in motion via another coordinating thread. This session has the §11 design decisions captured but does not have full context on the in-flight work. Handing off so Phase 2 plan-writing slots into the existing sequence rather than re-deriving it. |

## 1. State of governed-upgrade work as of this handoff

### 1.1 Already shipped

| PR | Phase | Content |
|---|---|---|
| [#1074](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1074) | Phase 0 + early Phase 1 | Substrate cleanup (one Inngest family, DTO-aligned, vestigial `store.ts` removed, observable null-target, ADR) + `version.json` baseline + Dockerfile copy + `loadPlatformVersion` loader |
| [#1076](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1076) | Phase 1 finale | `PlatformConfig["platform.version"]` mirror on boot, `GET /api/platform/version` route, `/ops/self-upgrade` UI surface |

**Phase 0 ADR:** [`docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md`](../decisions/2026-05-23-self-upgrade-substrate-consolidation.md)

### 1.2 Design decisions captured for Phase 2

**ADR committed at `e4d6e13a`:** [`docs/superpowers/decisions/2026-05-24-governed-upgrade-phase-2-channel-decisions.md`](../decisions/2026-05-24-governed-upgrade-phase-2-channel-decisions.md). Four §11 questions resolved via WWMD `principle_decide`:

| §11 question | Resolution | Confidence |
|---|---|---|
| Channel manifest host | **GitHub Pages (gh-pages branch)** | HIGH (margin 1.327) |
| Release artifact signing | **Sigstore keyless via GitHub OIDC** | HIGH (margin 1.376) |
| edge → beta soak | **Operator-configurable, default 24h** | LOW kernel margin 0.196; operator-confirmed |
| beta → stable soak | **Operator-configurable, default 7d** | HIGH (margin 0.250) |

Three §11 questions still open (tactical, intended to be resolved in Phase 2 plan body):
- §11.5 Hotfix lane flow
- §11.6 Smoke-window default criteria
- §11.7 First-install version backfill rule (proposed N/A: v1.0.0 baseline already established by #1074)

**Methodology note for the coordinating thread:** `principle_decide` returns LOW confidence (composite 0.0 across all options) when `features` dimension scores are not provided. The second run with structured 0..1 scores per option on dimensions surfaced via `missingDimensions` (`blast_radius`, `evidence_density`, `governance_compliance`, `speed_to_value`, `schema_grounding`, `long_term_maintainability`, `public_safety`, `human_cognitive_load`) produced HIGH confidence on 3/4. Use this pattern for §11.5–7 if running through WWMD.

### 1.3 Quiescence research handed to separate thread

`BI-40F05BAC` — Activity Quiescence Protocol — research filed and handed to a separate session. Replaces the naive drain protocol in spec §5.5. Sits as a prerequisite for Phase 4 (`PreflightRun.activeSessionBlockers` evidence) and Phase 5 (apply/drain/rollback). The full self-contained handoff prompt is in this session's transcript.

## 2. Concurrent in-flight work that affects Phase 2

Re-sweep against `origin/main` on 2026-05-24 surfaced significant adjacent work that landed during or after Phase 0+1 execution:

### 2.1 Merged

| PR | Title | Relevance |
|---|---|---|
| [#1080](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1080) | feat(admin): in-portal Apply Update control on Platform Development page (BI-9B77E247) | **Direct overlap with Phase 4 apply UX.** See §3.1 below. |
| [#1082](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1082) | feat(gear-interface): Reduction Gear Phase 0 — Ring 1→2 pilot foundation (BI-85CB31F0) | **GearInterface model now live in schema.** See §3.2 below. |
| [#1079](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1079) | feat(backup): nightly postgres trial-restore verification (BI-31C9FBDF) | Phase 5 rollback-adjacent — backup substrate exists. |
| [#1085](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1085) | chore(gear-interface): Phase 0 UX verification ADR | Pattern for Phase 5 UX gates. |
| [#1081](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1081) / [#1087](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1087) / [#1090](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1090) | Founder-kernel evolution + `principleRingScope` axis | New governance vocabulary; WWMD will use `ringScope` filter going forward. |

### 2.2 Open and blocking

| PR | Title | Blocking? |
|---|---|---|
| [#1091](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/1091) | fix(deps): declare @opentelemetry/api in apps/web — restores portal rebuild (BI-09A48EAD) | **YES.** Portal rebuild is currently broken on customer hosts since #1082 merged. Phase 2 plan execution must wait for this merge. |

## 3. Three structural reconciliation conflicts Phase 2 plan-writing must address

### 3.1 Two parallel "Apply Update" flows now exist

PR #1080 wired an in-portal Apply control onto the **legacy `PlatformDevConfig.updatePending` mechanism**:
- `apps/web/lib/actions/platform-dev-config.ts` exports `applyPlatformUpdate()` server action returning `clean-merge | conflicts | no-update-pending | invalid-version | error`
- `apps/web/components/admin/PlatformUpdateApplyPanel.tsx` renders the control on `/admin/platform-development`
- Conflicts redirect to Build Studio for sandbox-tested resolution
- Live-tested 2026-05-23 against v#2e89dd8a

Spec §5 designs a **different apply flow**:
- `PreflightRun` entity with four-layer evidence (code / schema / seed deltas / sandbox)
- Operator approval gates at preflight time, not apply time
- Channel manifest-driven, not `PlatformDevConfig.updatePending`-driven
- Three-pane diff resolver UX for seed conflicts (not redirect-to-Build-Studio)

**Conflict:** if Phase 4 ships without retiring the legacy `updatePending` flow, the install has two parallel apply paths — exactly the substrate fragmentation Phase 0 just cleaned up. Phase 2 (release-CI side) does not touch this directly, but **Phase 4 plan must explicitly retire `PlatformDevConfig.updatePending` and `applyPlatformUpdate()`** by routing them through `PreflightRun`. Phase 2 plan should call this out as a Phase 4 dependency, not silently let the conflict accumulate.

**Question for coordinator:** is the team that shipped #1080 aware of the spec §5 design? Should Phase 4 plan absorb #1080's surface and rewire it, or should #1080's flow be deprecated outright?

### 3.2 GearInterface emission is now consumable

The Reduction Gear spec's §9.9 cross-reference was forward-looking when written. With #1082 merged, it is now actionable:

- `GearInterface` Prisma model exists in schema
- Writer service with deterministic idempotency exists
- Source adapters per `shaftSourceType` exist
- Ring 1→2 already dual-emits from `completeBuildPhaseRun`

`shaftSourceType` enum already includes our work explicitly:
- `'platform-upgrade-run'`
- `'release-manifest'`
- `'channel-manifest'`
- `'migration-classifier'`
- `'seed-delta-manifest'`

`slipReason` enum already includes our failure modes:
- `'migration-destructive'`
- `'manifest-invalid'`
- `'signature-invalid'`
- `'seed-delta-conflict'`
- `'source-unindexed'`

**Implication for Phase 2 plan:** each Phase 2 artifact (migration classifier, seed-delta manifest, channel manifest publication, `resolveTargetSha` wire-up) should emit a GearInterface record using the writer service, with the source-type and slip-reason vocabulary above. **Direction matters:** outward for publish-side (`shaftSourceType: 'channel-manifest'`), inward for install-side fetch+verify (`shaftSourceType: 'release-manifest'`, `transmissionDirection: 'inward'`).

**Privacy boundary** from Reduction Gear §9.9 (load-bearing): **channel manifests may reference a `CalibratedCapabilityPack` by digest but MUST NOT include raw torque histograms.** Trust data flows ONLY through `contribute_to_hive`, never through upgrade manifests. Phase 2 channel manifest schema must declare this as a hard invariant.

### 3.3 Coordinating thread is delivering work in this surface area

Multiple BIs landed concurrently in the last 6 hours touching adjacent surface (BI-9B77E247, BI-85CB31F0, BI-31C9FBDF, BI-09A48EAD, BI-4AA1074B, BI-746268A1, BI-E5002629, BI-F4A30FCB). I do not have visibility into how the coordinating thread sequenced these, nor what's queued next.

**Implication:** Phase 2 plan-writing must consult the coordinator before sequencing, not after. The coordinator may already have Phase 2 work scoped, slotted, or in flight that this brief does not know about.

## 4. Phase 2 task scope sketch (from parent spec §8 / plan headlines)

For reference, the headlines from the parent plan ([`docs/superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md`](../plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md), end of file):

| Task | Surface | Status |
|---|---|---|
| 12 | Conventional-commit lint + PR-label fallback (`.github/workflows/commit-lint.yml`) | Not built |
| 13 | Release CI on push-to-main: version bump + tag (`.github/workflows/release.yml`) | Not built |
| 14 | Tag + push tag | Not built |
| 15 | Bundle artifact builder + sha256 | Not built |
| 16 | Migration kind classifier (additive / modifying / destructive from SQL parse) → emits `shaftSourceType: 'migration-classifier'` | Not built |
| 17 | Seed-delta manifest generator (hash shipped content per spec §6 fingerprint patterns) → emits `shaftSourceType: 'seed-delta-manifest'` | Not built |
| 18 | Sigstore keyless signing of bundle + detached signature on channel manifest | Not built |
| 19 | GitHub Release publication (bundle + sig + manifests + autogenerated notes) | Not built |
| 20 | Channel manifest schema + `edge.json` publisher to gh-pages branch → emits `shaftSourceType: 'channel-manifest'` (outward) | Not built |
| 21 | Wire `resolveTargetSha` to fetch + verify channel manifest → emits `shaftSourceType: 'release-manifest'` (inward) | Not built (stub returns null) |
| 22 | Manifest verification: signature, hash, semver, `minimumFromVersion` | Not built |
| 23 | Phase 2 ADR — substrate state + §11.5/6/7 resolutions | Not built |

`beta.json` / `stable.json` channel promotion is **Phase 6**, not Phase 2. Phase 2 publishes only `edge.json`.

## 5. What the coordinating thread should decide

In rough priority order:

1. **Sequencing for Phase 2 against the coordinator's existing work queue.** Does Phase 2 land before, alongside, or after currently in-flight work?
2. **PR #1091 merge timing.** Phase 2 execution is gated on portal-rebuild being functional. Confirm #1091 is on the immediate path.
3. **Reconciliation of the two apply flows.** Is the team that shipped #1080 aware of spec §5? Should Phase 4 absorb/replace `applyPlatformUpdate()`, or is #1080's flow being deprecated separately?
4. **Epic alignment.** Reduction Gear §9.8 says "do not create a parallel mega-epic." Phase 2 should land under either an extended `EP-BUILD-9DB5B0`, a thin `EP-REDUCTION-GEAR-ARCH` umbrella, or a new `EP-UPGRADE` that the coordinator explicitly chooses. The current spec leaves `Primary epic` as "None linked yet."
5. **GearInterface emission in Phase 2 tasks.** Confirm Phase 2 plan should include the dual-emit at task time, OR confirm it's a Phase 2.5 follow-up.
6. **§11.5–7 resolution.** Either run them through `principle_decide` with structured features (recommended pattern; see §1.2 above) or decide directly. Phase 2 plan-writing needs these answered to scope Task 15 (bundle), Task 18 (signing), Task 22 (verification).

## 6. References

- Parent spec: [`docs/superpowers/specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md`](../specs/2026-05-23-governed-platform-upgrade-lifecycle-design.md)
- Parent plan (Phase 0+1, done): [`docs/superpowers/plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md`](../plans/2026-05-23-governed-platform-upgrade-phase-0-and-1.md)
- Phase 0 ADR: [`docs/superpowers/decisions/2026-05-23-self-upgrade-substrate-consolidation.md`](2026-05-23-self-upgrade-substrate-consolidation.md)
- Phase 2 channel-decisions ADR: [`docs/superpowers/decisions/2026-05-24-governed-upgrade-phase-2-channel-decisions.md`](2026-05-24-governed-upgrade-phase-2-channel-decisions.md)
- Reduction Gear spec (§9.9 is the Ring 4↔5 cross-reference): [`docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md`](../specs/2026-05-24-reduction-gear-architecture-design.md)
- Quiescence research BI: `BI-40F05BAC`
- Parent BI: `BI-5B3FA415`

## 7. Operator constraints the coordinating thread should honor

These are non-negotiables that were enforced throughout Phase 0+1 and produced clean PRs. The coordinating thread should hold the same line:

- **Never ask the operator to run commands.** Run everything yourself; report output. Kernel: `never-ask-user-to-run-commands`.
- **DCO sign-off on every commit** (`git commit -s`). Memory: `feedback_dco_signoff_required.md`.
- **Positional path args on commits** (`git commit -s <path1> <path2> -m`) — concurrent-session safety. Memory: `feedback_git_commit_only_for_concurrent_sessions.md`.
- **PR overlap sweep before pushing** — re-fetch origin/main and re-check open PRs. Memory: `feedback_pr_overlap_check_before_pushing.md`, `feedback_continuous_overlap_check.md`.
- **Evidence before diagnosis** — query live state, not memory. Kernel: `evidence-before-diagnosis`.
- **Spec → commit → plan** as one process, no asking between steps. Memory: `feedback_spec_commit_plan_process.md`.
- **Verification before completion** — run typecheck + scoped tests + build + manual smoke before claiming done. Skill: `verification-before-completion`.

## 8. Recommended next steps for the coordinating thread

1. Read §1–§3 of this brief and the Phase 2 channel-decisions ADR (`e4d6e13a`) in full.
2. Sequence the six decisions in §5 above.
3. Resolve §11.5–7 via WWMD `principle_decide` with structured features (pattern in §1.2).
4. Write Phase 2 plan to `docs/superpowers/plans/2026-05-25-governed-platform-upgrade-phase-2.md` using the same TDD + bite-sized-step pattern as Phase 0+1 plan. Aim for 11-12 tasks (per §4 above).
5. Dispatch `plan-document-reviewer` against the plan; iterate up to 3 rounds.
6. Commit the plan and proceed to execution via `subagent-driven-development` per the standing process.
7. File new BIs as discovered (e.g. legacy-`updatePending`-retirement is likely a new BI under Phase 4).
