# Forge-Neutral, Offline-Capable Git Integration Design

**Date:** 2026-07-11
**Status:** Ratified — early phases underway (Phase 2 local-verification substrate landed; boundary ratification partial)
**Epic:** EP-5410E8EA
**Plan:** `docs/superpowers/plans/2026-07-11-forge-neutral-offline-integration-plan.md`
**Kernel decision:** `DI-C6483F614871` — `forge_abstraction_local_first`, composite 11.302, margin 1.785, high confidence, no commandment conflict, structured coverage strong
**Boundary decision:** `DI-14811CE8E7ED` — bundle a bare local Git/ref-store core; keep full forges as external adapters
**Decision population:** `external_coding_agent`
**Related prior art:** `2026-06-18-local-git-and-private-public-segregation-analysis.md`, `2026-06-18-private-public-change-segregation-design.md`, `2026-06-19-hive-contribution-architecture-and-egress-model.md`

## 1. Decision

DPF should make a **forge-neutral local integration record and serialized integration ref** the canonical, offline-capable integration point. GitHub remains the first public forge adapter and the public hive/release distribution surface. A self-hosted Forgejo/Gitea adapter is optional. Remote publication is asynchronous and reconciled; it is not evidence that the change was locally integrated correctly.

This is not authorization to change the live remote. The first implementation phases preserve GitHub behavior behind contracts, then remove unnecessary network dependencies from local verification. Remote cutover, mirroring, or installation of a forge requires a later operator decision and its own migration evidence.

Ratification update (2026-07-14): the operator selected in-session implementation for Phase 1. `DI-14811CE8E7ED` resolves the bundled-vs-external boundary: DPF bundles an invisible bare local Git/ref-store core as the source-byte substrate, while GitHub, GitLab, Forgejo, and Gitea remain external forge adapters. Portal/Postgres remains authoritative for review, approval, evidence, Hive/contribution classification, and merge-admission policy.

The key distinction is:

- **integration authority:** local, governed, content-addressed evidence over a candidate and latest accepted base;
- **forge collaboration:** reviews, discussion, visibility, and remote branch protections supplied by an adapter;
- **public egress:** explicit, privacy-gated hive contribution and release publication;
- **distribution:** GitHub/GHCR initially, replaceable through deployment contracts later.

Two existing Hive meanings are both in scope and must remain distinct:

- **Hive Mind collaboration inside one install:** the portal context overlay selects coworkers around a shared Work Capsule/build/change context and persists their work through `TaskRun`, artifacts, evidence, and activities;
- **Hive commons across installs:** governed WWMD/WWWD/WSID/code learnings and Feature Packs leave one install through public-hive egress and are later discovered/ingested by other installs.

Forge resilience must strengthen both. It must not reduce “Hive” to GitHub PR transport.

## 2. Current coupling map

### 2.1 What is already local

| Capability | Current local substrate | Remaining remote dependency |
|---|---|---|
| Commit history and work isolation | Git clone plus one branch/worktree per session (`AGENTS.md` §4) | Branches are normally based on and pushed to `origin/main`. |
| Pre-commit controls | `.githooks/pre-commit` runs secrets, type, migration, and policy guards | None for execution; GitHub repeats/enforces many checks at PR time. |
| Pre-push admission | `.githooks/lib/pre-push-chained.sh` chains Git LFS and `.githooks/pre-push-gate` | Git LFS may transfer to the remote; the gate compares against `origin/main`. |
| CI-equivalent merge verification | `scripts/local-ci-runner.sh` uses a scratch worktree and runs Vitest, typecheck, and production build | It fetches `origin/main`; its caller currently pushes before leasing. |
| Gate orchestration/evidence | `scripts/gate-worktree.sh` claims `local-integration-ci`, runs the local runner, records MCP evidence, and writes `.git/dpf-local-ci-gate.json` | Default `PUSH_BRANCH=1`; it executes `git push origin <branch>` before the lease, so an outage blocks the otherwise-local gate. MCP evidence also requires the local portal, but not github.com. |
| Runtime validation | canonical local install or leased local-CI convergence sandbox (`AGENTS.md` §5) | No GitHub dependency once the source SHA is available locally. |
| Per-install customization/update | `apps/web/lib/self-upgrade/prepare-source.ts` maintains `dpf/install`, merges upstream into an isolated upgrade workspace, and defers on conflicts | Acquiring the upstream ref/release and release artifacts is GitHub/GHCR-shaped. |
| Private/public boundary | `FeatureBuild` disposition, `apps/web/lib/integrate/contribution-egress.ts`, and the private-home design | Public change requests and issue escalation use GitHub-specific transports. |

The present system is therefore not “remote CI only.” Most expensive verification is already local. The avoidable coupling is orchestration: remote publication precedes local evidence, and merge readiness is represented only by GitHub PR/check/review state.

_Update (2026-07-14): Phase 2 has since landed. `scripts/gate-worktree.sh` now defaults to `--no-push` and records SHA-bound, offline-capable evidence (`publicationMode`, `acceptedBaseMode`, `networkTolerance`), closing the gate-orchestration coupling described in the row above. The table remains as the authoring-time baseline the design addresses._

### 2.2 GitHub-specific integration authority

| Operation | Grounded dependency |
|---|---|
| Open/list/view change requests | `gh pr create`, `gh pr list`, and `gh pr view` are prescribed in `AGENTS.md` §4 and the `dpf-pr-with-dco` skill. |
| Aggregate readiness | `scripts/pr-health.mjs` shells through `gh pr checks` and GitHub GraphQL because unresolved review threads are not present in the checks response; `docs/testing/pr-health.md` makes this the mechanical merge-readiness verdict. |
| Serialized merge | `gh pr merge <n> --squash --auto` enters GitHub's merge queue (`AGENTS.md` §4). `.github/workflows/ci.yml` listens to `merge_group`. |
| Required checks | `.github/workflows/ci.yml` supplies Typecheck, Production Build, Unit Tests and policy jobs; `.github/workflows/codeql.yml`, module-size/UX/spec gates, and other workflows add blocking contexts. |
| DCO | Commit trailers are local Git data, but the blocking status is posted by the GitHub DCO app. `.github/workflows/dco-merge-group.yml` republishes a queue-only `DCO` context because the app does not run on `merge_group`. |
| Conversation resolution | GitHub branch protection plus GraphQL review-thread state; `scripts/pr-health.mjs` treats unresolved threads as blockers. |
| Branch/rules authority | GitHub rulesets protect `main`, require checks and the merge queue, and prevent direct integration. |
| Remote transport | `origin` is `https://github.com/OpenDigitalProductFactory/opendigitalproductfactory`; normal completion requires `git push`. |
| CI and release automation | `.github/workflows/`; images are published to GHCR per deployment Contract 1 in `2026-05-09-deployment-contracts.md`. |

### 2.3 Self-upgrade and contribution coupling

The governed upgrade design is locally sound: `dpf/install` is durable, upstream is merged rather than overwriting local changes, conflicts defer, backups and rollback remain mandatory, and image identity equals built bytes. The coupling lies at the source boundary: “upstream” is acquired from GitHub and release images from GHCR. Offline operation can continue on the installed version, but cannot truthfully discover or acquire a newer version.

The hive flow must remain separate from local integration. `apps/web/lib/integrate/contribution-egress.ts` states that the private/public boundary applies at public-hive egress. Prior analysis at `2026-06-18-local-git-and-private-public-segregation-analysis.md` found `GitProvider = "github"`, duplicated GitHub URL parsing, hard-coded GitHub REST endpoints, GitHub OAuth, and GitHub-shaped status readers. Private-mode changes already have a local lane; shareable public changes require DCO identity and an explicit contribution disposition. A mirror must never collapse these lanes.

### 2.4 Hive Mind and contribution-mode substrate

The current canonical contribution policy is two-level, not a single “push?” flag:

1. `PlatformDevConfig.contributionMode` is the install posture: `private | contributing` (`apps/web/lib/actions/platform-dev-config.ts`; legacy values are tolerated during convergence).
2. `FeatureBuild.disposition` is the per-change authority: `private | shareable`, defaulting fail-closed to `private` (`apps/web/lib/integrate/disposition.ts`, `packages/db/prisma/schema.prisma`). An AI suggestion may be cached, but the human makes the final call through `set_change_disposition`.

Public egress also depends on `hiveContributionsPaused`, DCO acceptance/identity, explicit consent where applicable, secret/identity scanning, and `.dpf/private-paths` plus `PrivatePathRule`. `contribute_to_hive` is always a `public-hive` target. A customer/private forge is `own-repo` and receives the full private-inclusive change. These rules are owned by `2026-06-19-hive-contribution-architecture-and-egress-model.md`; this design wraps them and must not redefine them.

The Hive commons already has canonical records: `FeaturePack`, `ImprovementProposal.contributionStatus`, and `HiveContributionLedger`. The learning lanes already exist:

- WWMD: kernel principles/decisions;
- WWWD: org overlays and durable platform/org facts;
- WSID: profession skills and techniques;
- code contracts: repository plus `AGENTS.md`.

`2026-06-16-learning-propagation-commons-design.md` routes confirmed learning into those lanes, then through `contribute_to_hive`; other installs ingest through Hive Scout. Same-install retrieval uses the local Postgres/wiki/vector/skill substrate and must remain available when every forge is offline.

The portal Hive Mind is also not a forge feature. `2026-05-17-portal-context-overlay-hive-mind-work-surface-design.md` and `apps/web/lib/portal-context/hive-mind-resolver.ts` select builders, reviewers, architects, testers, operators, and specialists from shared route/work/attention context. Forge-neutral integration state therefore belongs in the existing `PortalContextEnvelope` and task/evidence projection, not in a new PR-only dashboard.

### 2.5 Contribution provenance reporting confusion

A parallel investigation found a user-facing confusion this design must not reproduce: contribution reporting can describe a feature as "local" even when the artifact has already been contributed to the public GitHub project, leaving non-technical users unsure what stayed on their install and what left it.

The current substrate shows why the ambiguity is easy to create:

- `FeaturePack.status` defaults to `local` (`packages/db/prisma/schema.prisma`), but `contribute_to_hive` creates/updates the row with `status: "contributed"` before the upstream PR outcome is fully resolved (`apps/web/lib/mcp/packs/contribution-hive-pack.ts`).
- `ImprovementProposal.contributionStatus` defaults from `"local"` to `"contributed"` and is updated after the contribution attempt, independent of the user's plain-language mental model (`packages/db/prisma/schema.prisma`, `apps/web/lib/mcp/packs/contribution-hive-pack.ts`).
- The contribution architecture spec intentionally frames these as ledger markers, not a complete user report: `2026-06-19-hive-contribution-architecture-and-egress-model.md` lists `FeaturePack`, `ImprovementProposal.contributionStatus`, and `HiveContributionLedger` as the existing ledger.

The forge-neutral design must therefore treat contribution provenance as a product contract, not only a backend state machine. A non-technical report must answer two separate questions without Git vocabulary:

1. **What is kept on this install?** Private/local source, local-only Feature Packs, and imported upstream features currently active here.
2. **What left this install, and where did it go?** Private own-repo backups versus public community contributions, including queued, sent, accepted, rejected, withdrawn, or policy-blocked payloads, with the exact feature/learning summary and public/private sanitization result.

The UI must not collapse those questions into one badge. A feature can be active locally and contributed upstream. A private implementation can stay local while a sanitized generic learning derived from it is shared. A contribution can be queued locally but not sent because GitHub/Forgejo is offline. Those are distinct states.

## 3. Required invariants

Any design must preserve:

1. **No direct unverified advance of the integration ref.** A compare-and-swap update accepts only a candidate based on the recorded base and verified against the latest accepted ref.
2. **Equivalent merge-queue safety.** The candidate is re-materialized with current integration head, all required gates run on that exact tree, and only then may one serialized writer advance the ref.
3. **DCO is forge-independent.** Validate `Signed-off-by` trailers over every candidate commit locally; forge checks are projections of that result.
4. **Human review remains binding.** At least one authorized approval, no unresolved blocking discussion, and no post-approval content change without reapproval.
5. **Checks are content-addressed.** Evidence binds candidate SHA, base SHA, merged-tree SHA, command/profile versions, and expiry. Cached success for a different tree is invalid.
6. **One source of integration truth.** The local integration ledger/ref is canonical for offline integration; forge states are synchronized projections with explicit lag/conflict state.
7. **Public egress remains explicit.** Private changes do not reach a public mirror. Shareable changes retain the current DCO/pseudonymous-real-identity model and contribution ledger.
8. **Self-upgrade never fabricates freshness.** During outage it may use a verified cached last-known-good release, but must report “offline/stale” and never claim a newer upstream exists.
9. **Release artifact provenance remains verifiable.** Moving integration authority local does not make an untrusted local image a public release.
10. **Contribution policy is evaluated at send time.** An outbox entry created while contributing/shareable cannot be sent after the install becomes private, contributions are paused, consent is withdrawn, disposition changes, or the payload newly intersects a private path.
11. **Private integration is never publicly mirrored.** Local/own-repo refs may contain proprietary bytes. Public refs are constructed from the approved, stripped, shareable payload only.
12. **Learning can be abstracted without leaking implementation.** A private code change may yield a separately reviewed public principle, fact, technique, or generic fix, but privacy classification applies independently to each derived artifact.
13. **Hive Mind remains useful offline.** Local coworkers, context, knowledge retrieval, reviews, and task artifacts do not depend on a forge. Only cross-install synchronization becomes pending/stale.
14. **Contribution provenance is axis-separated and plain-language.** Reports must distinguish local availability, public/own-repo publication state, contribution acceptance state, and privacy/disposition state. "Local" must never mean "not contributed" unless backed by a contribution/outbox/ledger query that proves no public payload was queued, sent, or accepted.

## 4. Options evaluated

| Option | Required checks and serialization | Migration cost | Offline behavior | Self-upgrade and contribution fit |
|---|---|---:|---|---|
| Self-hosted Forgejo/Gitea primary; GitHub mirror | Protected branches, approvals, Actions checks, plus a DPF serialized integration worker because Forgejo protection is not itself proof of GitHub-style merge-group testing | High: service lifecycle, backup, auth, runner security, workflow translation, migration | Strong on LAN; still depends on the local forge service | Good private home; public PR identity/mirror reconciliation becomes complex. Push mirroring can force-update the destination and therefore cannot be the authority. |
| Bare repo + `git bundle` | Must build review, discussion, required-check, and queue semantics in DPF; bare refs alone provide none | Medium-high product work, low infrastructure | Excellent; Git bundles are designed for offline object/ref transfer and can be verified incrementally | Excellent recovery/air-gap transport; weak collaboration UX. Best as exchange/fallback, not the whole integration product. |
| GitHub resilience wrapper | GitHub remains the authority; retry/outbox makes `gh` and push eventually complete; local merged-code evidence reduces wasted work | Low-medium | Development can proceed, but integration cannot complete until GitHub returns | Minimal self-upgrade/contribution change; vendor and outage coupling remains. Useful transitional phase, insufficient target architecture. |
| Forge abstraction + local-first integration (selected) | DPF validates DCO/reviews/checks and serializes integration locally; adapters project and reconcile GitHub/Forgejo state | Medium-high, phased | Full local review/integration where policy allows; publication queues durably | Fits the existing `dpf/install` and egress boundary. GitHub stays public hive/release adapter; self-hosted forge is optional. |

### Kernel result

`principle_decide` selected `forge_abstraction_local_first` with high confidence (11.302, margin 1.785), no commandment conflict, and zero semantic fallback. DCO Sign-Off Required was the strongest relevant positive contributor. The raw ledger is `DI-C6483F614871`. Some retrieved commandments were unrelated to this decision; the audit record retains them, while this spec relies on the applicable invariants above.

## 5. Target architecture

### 5.0 Source-of-truth split

There are two complementary authorities, not duplicate source stores:

- the **Git integration ref** is authoritative for accepted source bytes and ancestry;
- the **portal integration ledger** is authoritative for admission policy, reviews, check evidence, promotion attempts, and projection status.

The ledger always references immutable Git object IDs and must be reconstructable/auditable against the repository. It does not store a second copy of the source tree. A forge PR, check run, or mirror is a projection of those authorities, never a third authority.

### 5.1 Contracts

```ts
interface IntegrationStore {
  createChange(input: ChangeInput): Promise<ChangeRecord>;
  recordReview(input: ReviewInput): Promise<ReviewRecord>;
  recordCheck(input: CheckInput): Promise<CheckRecord>;
  evaluateAdmission(changeId: string): Promise<AdmissionVerdict>;
  promote(changeId: string, expectedHead: string): Promise<PromotionResult>;
}

interface ForgeAdapter {
  capabilities(): Promise<ForgeCapabilities>;
  publishBranch(input: BranchPublication): Promise<RemoteRef>;
  upsertChangeRequest(input: ChangeProjection): Promise<RemoteChange>;
  readReviewsAndChecks(input: RemoteChangeRef): Promise<RemoteState>;
  projectAdmission(input: AdmissionProjection): Promise<void>;
  reconcile(input: ReconcileCursor): Promise<ReconcileResult>;
}
```

The contract is capability-scoped: a plain Git remote supports refs but not reviews; GitHub supports change requests, checks, releases, issues, and merge queues; Forgejo support is discovered rather than assumed. Unsupported capabilities fail explicitly.

The core input must carry an egress class (`local-integration | own-repo | public-hive | release-distribution`). Adapter selection happens only after that class and its policy have been resolved. A generic `publishBranch` call is not allowed to infer public versus private from the remote URL.

### 5.2 Local change and admission record

A durable record (exact persistence shape decided during implementation after schema audit) must carry:

- candidate ref/SHA, base ref/SHA, synthesized integration-tree SHA;
- author/committer identity and DCO validation for every commit;
- required-check policy version and per-check evidence digest;
- approvals with reviewer principal, reviewed tree SHA, and revocation/staleness;
- discussion threads and resolution state;
- admission verdict, reason ledger, and expiry;
- serialized promotion attempt with expected head and resulting head;
- remote projections per adapter: queued, syncing, current, lagging, conflicted, terminal-failed.

This does not imply a new table without a schema audit. Existing evidence, Work Capsule, build, and contribution ledgers must be evaluated first.

### 5.3 Offline merge-queue equivalent

1. Freeze candidate SHA and expected integration head.
2. Validate DCO and review policy locally.
3. Materialize `integration-head + candidate` in the convergence workspace.
4. Run the required profile on the exact synthesized tree.
5. Record content-addressed evidence.
6. Acquire the single integration lease.
7. Confirm head still equals expected head; otherwise discard the synthesized verdict and repeat.
8. Atomically advance the integration ref and ledger.
9. Queue forge projections/publication. A remote outage changes projection state, not the local verdict.

This preserves the safety property documented by GitHub: queued changes are tested with the latest base and changes ahead of them before the protected branch advances.

### 5.4 Network operation outbox

Every remote mutation uses an idempotency key derived from operation type, adapter, repo identity, local change id, and content SHA. Retry uses bounded exponential backoff with jitter. Authentication/authorization, rejected policy, and non-fast-forward divergence are terminal or human-attention states; TLS EOF/timeouts, DNS failures, rate limits, and 5xx responses are retryable. Reconciliation reads remote truth before replay so an operation that succeeded before the response was lost is not duplicated.

Read operations expose freshness: `current`, `cached(age)`, `unavailable`, or `conflicted`. Cached state cannot authorize promotion unless the relevant approval/check is already recorded locally and bound to the same tree.

Public-hive outbox entries store a payload digest and policy snapshot for audit, but the dispatcher must re-evaluate live `contributionMode`, `hiveContributionsPaused`, consent, DCO, disposition, and private-path rules immediately before sending. A now-disallowed entry becomes `policy-blocked` and retains no reusable authorization. Own-repo publication follows the private-home policy and must not apply public-path stripping.

### 5.5 Self-upgrade

Preserve the existing per-install merge and governed promoter. Introduce an upstream-source adapter that yields a verified source ref/release manifest from GitHub initially, a self-hosted forge later, or a signed bundle for air-gap transfer. Cache the last verified manifest and source objects. Offline behavior is continue-current-version or explicitly install a verified cached/imported release; never “check succeeded, no update” when the check could not run.

### 5.6 Forgejo/Gitea role

Forgejo/Gitea is a supported optional adapter after contract conformance, not the default integration authority. Its branch protection and PR workflow can project DPF policy and provide collaboration UX. Its Actions runner security and workflow compatibility require a threat model. Repository push mirrors are distribution aids only: Forgejo documents that push mirroring uses `git push --mirror` and may force-push/overwrite destination state, which is incompatible with treating both sides as independent writable authorities.

The threat model must cover runner registration scope, untrusted fork workflows, action-source pinning, credential reachability, webhook replay, and an attacker creating an unprotected branch with a privileged workflow. No self-hosted runner receives production or contribution credentials by default.

### 5.7 Git bundle role

`git bundle` is the standard offline exchange and recovery format. Export bundles include named refs and an accompanying signed DPF manifest/evidence digest. Import runs `git bundle verify`, validates prerequisites and policy metadata, then stages refs under an import namespace. Bundles never directly advance the integration ref.

### 5.8 Portal Hive Mind integration

Forge-neutral change state is projected into the existing portal context envelope:

- Work Capsule/build/change identity and local integration head;
- admission verdict and missing/stale evidence;
- contribution mode, per-change disposition, and whether a final human decision is still required;
- public/own-repo projection state and last successful reconciliation age;
- attention signals such as `remote_projection_delayed`, `contribution_policy_blocked`, `hive_ingress_stale`, and `integration_head_advanced`.

Those signals drive the existing hive-mind coworker resolver. Reviewers/testers are required before local admission; an architect is suggested for policy/segregation conflict; an operator handles stalled reconciliation. Their work creates or extends `TaskRun`, `TaskArtifact`, Work Capsule activity, and canonical evidence. A GitHub comment may be synchronized later, but it is not the only durable copy of the review.

No new generic “HiveReview” or “HiveTask” store is introduced. The schema-audit requirement applies before extending existing records.

### 5.9 Cross-install commons and inbound synchronization

Public contribution is a derived artifact pipeline:

```text
private-inclusive local change
  -> local integration and evidence
  -> classify derived artifact (code | WWMD | WWWD | WSID)
  -> install mode must be contributing
  -> human confirms artifact disposition=shareable
  -> strip private paths/content + scan + DCO/consent
  -> FeaturePack / ImprovementProposal / HiveContributionLedger
  -> durable public-hive outbox
  -> forge adapter PR/publication when online
```

A single local change may remain private while a generalized learning derived from it is shareable. Conversely, an org-overlay fact, customer workflow, credential, private-path content, or install-specific configuration remains local even when the install is in contributing mode.

Inbound Hive Scout/FeaturePack discovery is also adapter-backed and asynchronous. The install continues to use its last locally ingested, provenance-recorded commons while offline. Freshness is visible. On reconnect, the scout resumes from a durable cursor, deduplicates by upstream identity/content digest, and routes findings through the existing review/backlog path; it never auto-merges new knowledge or code merely because connectivity returned.

### 5.10 Contribution provenance report model

The portal must expose contribution provenance as a small read model over existing ledgers and any new outbox/admission records introduced by this program. The read model is allowed to denormalize for display, but its facts must trace back to canonical records.

It carries four independent axes:

| Axis | Canonical question | Example plain-language states |
|---|---|---|
| Local availability | "Is this active or saved on this install?" | "Active on this system", "Saved locally", "Imported from the community", "Removed locally" |
| Privacy/disposition | "Is the payload allowed to leave?" | "Kept on this system", "Approved to share", "Private parts removed", "Blocked by private-path rule" |
| Publication/outbox | "Has anything been sent outside this install?" | "Not queued", "Waiting to send when online", "Backed up to your private repo", "Sent to community project", "Needs attention", "Send blocked by policy" |
| Upstream acceptance | "Did the community project accept it?" | "Under review", "Accepted by community", "Needs changes", "Rejected", "Withdrawn" |

Default screens use those plain-language states and short consequence text. Technical details such as PR URL, forge provider, branch, commit SHA, DCO trailer, payload hash, and retry attempts are available behind "Details" for operators and support, not in the first sentence shown to normal users.

The report must include at least three default filters:

- **Kept here:** features, changes, and learnings present on this install, including private changes and imported/community-origin items.
- **Private backups:** own-repo publication attempts that leave the install but remain in the operator's private home, including queued, sent, failed, and policy-blocked payloads.
- **Shared with community:** public-hive publication attempts, including queued, sent, accepted, failed, withdrawn, and policy-blocked payloads.

That split is load-bearing for the current confusion: a row can appear in both "Kept here" and "Shared with community" when a locally active feature was also contributed upstream. In that case the default copy should say, for example, "Active on this system; contribution sent to the community project and currently under review." It must not say only "local" or only "contributed." If a row appears in "Private backups" only, the copy must say it was backed up to the operator's private repo, not shared with the community.

Offline behavior is explicit:

- queued-but-unsent: "Waiting to send when online";
- sent-but-unconfirmed: "Sent; confirmation is pending";
- accepted from cached state: "Last confirmed accepted at <time>; cannot refresh while offline";
- unknown/legacy rows: "Needs provenance review" rather than guessing.

For hive/common learning, the report distinguishes the source artifact from derived artifacts. A private source change can show "Kept on this system" while a derived principle/skill/fact shows "Shared outward" after its own review, redaction, DCO/consent, and contribution ledger entry. No derived artifact inherits shareability from the source change.

## 6. Rollout

The phases below are the ratified sequence. The implementation plan (`docs/superpowers/plans/2026-07-11-forge-neutral-offline-integration-plan.md`) carries the per-phase BIs, exit criteria, and verification matrix; phase numbers here match the plan.

0. **Ratify boundaries.** Local-admission target, bundled-vs-adapter Forgejo scope, and bundle/release provenance authority. (`DI-14811CE8E7ED` resolves the bundled bare-core boundary; the remaining two are decisions gated before Phase 3/6 cutover work.)
1. **Forge contracts + GitHub parity.** Capability-scoped contracts; move GitHub call sites behind an adapter with behavior parity.
2. **Local verification without publication.** Decouple local CI from push; record candidate/base/synthesized-tree SHA evidence with toolchain fingerprint and expiry.
3. **Local admission + serialized integration.** Add the admission ledger/ref and compare-and-swap promotion in shadow mode; compare verdicts with GitHub; never auto-advance public `main`.
4. **Durable remote outbox.** Idempotent retry and reconciliation; an outage changes projection state, not the local verdict.
5. **Portal Hive Mind projection.** Project local admission, contribution, and reconciliation state — including the four-axis provenance model — into the existing context envelope.
6. **Self-upgrade source neutrality.** Forge-neutral upstream refs and verified cached/imported release provenance.
7. **Hive/public egress preservation.** Preserve disposition, DCO identity, private-path stripping, and derived-learning independence across adapters.
8. **Network-tolerant commons ingress/propagation.** Durable inbound/outbound cursors; offline retrieval stays local; no auto-activation on reconnect.
9. **Optional Forgejo/Gitea + air-gap bundle exchange.** Adapter conformance and threat model; `git bundle` staging under an import namespace.
10. **Authority cutover (separate operator approval).** Make local admission authoritative only for an approved scope, with one-command rollback to GitHub-authoritative operation.

Rollback keeps GitHub authoritative until the separately approved authority cutover in Phase 10. Each phase must be independently reversible. No bidirectional mirroring is enabled during shadow mode.

## 7. Acceptance criteria

- A TLS/EOF outage cannot prevent local CI, review capture, DCO validation, or creation of a complete admission verdict.
- Two concurrent candidates cannot both promote against the same stale base.
- A candidate changed after approval or verification is rejected until reapproved/reverified.
- `pr:health` evolves into a forge-neutral admission verdict with GitHub details as adapter evidence.
- Public hive contribution retains explicit disposition, DCO identity, and audit records.
- Private changes never enter a public mirror/outbox.
- Changing the install to private, pausing Hive contributions, withdrawing consent, or changing disposition before dispatch prevents a queued public send.
- A private local change can produce a separately reviewed generic learning without exposing its private source payload.
- Portal Hive Mind coworkers can review, verify, and diagnose a change during a forge outage using the same Work Capsule/task/evidence substrate.
- Same-install WWMD/WWWD/WSID retrieval remains available offline; inbound Hive freshness and queued outbound propagation are visible and reconcile idempotently.
- Contribution reports answer "kept here", "private backup", and "shared with community" separately, use plain-language states by default, and never infer non-contribution from a `local` status string alone.
- A locally active feature that has also been contributed upstream is rendered as both local/active and shared/sent-or-accepted, not as a mutually exclusive local-vs-contributed choice.
- Queued, failed, and policy-blocked contribution attempts are visible without requiring the user to understand GitHub, PRs, branches, or remotes.
- Self-upgrade reports offline/stale truthfully and accepts only verified cached/imported artifacts.
- GitHub and optional Forgejo outages are covered by deterministic contract tests.

## 8. Research sources

- Git offline object/ref exchange and prerequisite verification: [git-bundle documentation](https://git-scm.com/docs/git-bundle).
- GitHub merge queue safety and `merge_group` checks: [Managing a merge queue](https://docs.github.com/en/enterprise-cloud%40latest/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue).
- GitHub protected-branch checks, reviews, conversation resolution, and merge queue: [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
- Forgejo protected branches and approvals: [Branch and tag protection](https://forgejo.org/docs/latest/user/protection/).
- Forgejo repository mirroring semantics and overwrite warning: [Repository mirrors](https://forgejo.org/docs/latest/user/repo-mirror/).
- Forgejo fork-PR workflow trust: [Actions security for pull requests](https://forgejo.org/docs/latest/user/actions/security-pull-request/).

## 9. Open operator reactions

The direction is kernel-selected, not an unranked menu. Before production work, the operator should react to three boundaries:

1. whether local admission may ultimately advance DPF's canonical `main`, or only an install/organization integration branch that later publishes to public `main`;
2. whether a bundled Forgejo service is desired after the adapter exists, or the optional adapter should target externally managed instances only;
3. which release-signing/provenance mechanism should authorize air-gap bundles and cached releases.

Contribution mode, per-change disposition, private-path stripping, Hive pause/consent, and the WWMD/WWWD/WSID lane model are not open choices here; they are existing canonical contracts this design must preserve.
