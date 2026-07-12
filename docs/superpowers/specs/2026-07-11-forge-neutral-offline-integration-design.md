# Forge-Neutral, Offline-Capable Git Integration Design

**Date:** 2026-07-11
**Status:** Proposed — operator reaction required before implementation
**Epic:** EP-5410E8EA
**Kernel decision:** `DI-C6483F614871` — `forge_abstraction_local_first`, composite 11.302, margin 1.785, high confidence, no commandment conflict, structured coverage strong
**Decision population:** `external_coding_agent`
**Related prior art:** `2026-06-18-local-git-and-private-public-segregation-analysis.md`, `2026-06-18-private-public-change-segregation-design.md`, `2026-06-19-hive-contribution-architecture-and-egress-model.md`

## 1. Decision

DPF should make a **forge-neutral local integration record and serialized integration ref** the canonical, offline-capable integration point. GitHub remains the first public forge adapter and the public hive/release distribution surface. A self-hosted Forgejo/Gitea adapter is optional. Remote publication is asynchronous and reconciled; it is not evidence that the change was locally integrated correctly.

This is not authorization to change the live remote. The first implementation phases preserve GitHub behavior behind contracts, then remove unnecessary network dependencies from local verification. Remote cutover, mirroring, or installation of a forge requires a later operator decision and its own migration evidence.

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

## 6. Rollout

1. Contract inventory and GitHub adapter with behavior parity.
2. Decouple local CI from push and record local candidates/evidence by SHA.
3. Add local admission ledger/ref and serialized promotion in shadow mode; compare verdicts with GitHub.
4. Add durable GitHub outbox/reconciliation; tolerate outages without declaring remote completion.
5. Project local admission, contribution, and reconciliation state into the portal Hive Mind work surface.
6. Make local admission authoritative for approved scopes after parity evidence and operator ratification.
7. Adapt self-upgrade source acquisition plus outbound and inbound Hive synchronization.
8. Evaluate Forgejo/Gitea and signed bundle exchange.

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
