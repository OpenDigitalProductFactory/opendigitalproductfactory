# Feedback Resolution Closure Contract Design

| Field | Value |
| ----- | ----- |
| Status | Draft for architecture review |
| Date | 2026-05-26 |
| Author | Codex |
| Backlog item | To be filed after spec review. Live MCP lookup on 2026-05-26 found no exact existing spec/plan for feedback resolution closure, update notification, PR provenance, and archetype applicability as one contract. |
| Epic recommendation | Start as a focused BI under `EP-9FC5D2FD` while the work is tied to Dale/Build Studio feedback escalation. Create a dedicated epic only if the scope expands into cross-install hive/release-channel infrastructure beyond feedback closure. |
| Related substrate | `PlatformIssueReport`; `Notification`; `PlatformNotification`; `ProductVersion`; `ChangePromotion`; `SelfUpgradeRun`; `PlatformDevConfig.updatePending`; `FeatureBuild`; `FeaturePack`; `StorefrontConfig.archetypeId`; `Principal`; `PrincipalAlias`; `ToolExecution`; `WorkCapsule`; `issue-bridge.ts`; `identity-privacy.ts` |
| Related specs | [Capacity-aware feedback escalation](2026-05-24-capacity-aware-feedback-escalation-design.md); [Pseudonymous identity and backlog issue bridge](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md); [Build Studio source lifecycle](2026-03-27-build-studio-source-lifecycle-design.md); [Canonical deployment contracts](2026-05-09-deployment-contracts.md); [Quality feedback](2026-03-14-quality-feedback-design.md); [Platform feedback loop](2026-03-16-platform-feedback-loop-design.md) |
| Scope | The contract that proves a submitted issue, feature request, or feedback item has become a fix or reusable feature, is applicable to a specific install/archetype/project scope, is available in a release/update path, and has been communicated back to the local submitter. |
| Out of scope | Replacing GitHub Issues, replacing Build Studio, making upstream public identity non-pseudonymous, creating a customer CRM, adding screenshots/replays to upstream issues by default, or bypassing contribution-mode/privacy policy. |

---

## Architect Verdict

The capacity-aware feedback design gets Dale out of the first dead end: he can ask for help and the platform can route the report locally or upstream. That is necessary, but not sufficient. The system still needs a closure contract that answers four harder questions:

1. **What artifact fixed this report?** The fix may be a local support answer, a `BacklogItem`, a Build Studio `FeatureBuild`, a Claude/Codex-maintained PR, a Build Studio PR, another customer's contributed feature, a `ProductVersion`, or a self-upgrade run.
2. **Who can safely receive it?** A fix may apply only to this install, to the same archetype/industry pattern, or to the whole DPF platform.
3. **What may be shared?** The public upstream path must preserve pseudonymous identity and never leak user identity, secrets, hostnames, private route context, or raw transcripts.
4. **How does the submitter know?** "Merged upstream" is not the same as "available to this install" or "installed here." Dale needs a local, plain-language signal when action is needed and when the fix is actually present.

This spec therefore adds a **Feedback Resolution Closure Contract**. It should be treated as an amendment to the Phase 2/3/5 work in the capacity-aware feedback plan. Do not implement routing, bridge wiring, or reverse-channel notifications without capturing the closure fields required here.

## 1. Problem

Today, DPF can collect a report and sometimes create local or upstream work:

- feedback/support creates a `PlatformIssueReport`;
- issue-report triage can create local `BI-PIR-*` backlog items;
- `issue-bridge.ts` can file upstream GitHub Issues for backlog, epic, and issue-report records;
- Build Studio can produce local changes and contribution PRs;
- platform update and self-upgrade surfaces can show whether source/runtime updates exist.

Those pieces do not form an end-to-end proof. A submitter cannot reliably tell whether:

- the report was understood;
- the work was routed locally or upstream;
- a PR or release actually fixed it;
- the fix applies to this specific install;
- an HVAC-specific feature submitted by another customer is reusable here;
- a local refresh, source merge, or self-upgrade is needed;
- the local install has already applied the fix.

The risk is subtle: the platform can look responsive while still failing the "full circle" promise. Dale may receive no closure, receive closure too early, or receive a feature that should not apply to his install.

## 2. Current Substrate Truth

This spec is grounded in current `origin/main` as of 2026-05-26.

| Area | Current truth | Gap |
| ---- | ------------- | --- |
| Issue report | `PlatformIssueReport` stores report ID, route, trigger kind, support session, user, thread/task/build links, source, status, and upstream issue URL/number. | No fixed-in version, resolution artifact, applicability scope, notification state, local applied state, or release/update state. |
| Submitter notification | `Notification` has `userId`, `type`, `title`, `body`, `deepLink`, and `read`. `PlatformNotification` is global/admin health. | No feedback-resolution notification type or idempotency contract. |
| Upstream bridge | `issue-bridge.ts` files GitHub Issues using pseudonymous identity, redaction, contribution-mode gates, and existing upstream issue fields. | It does not ingest upstream closure, PR merge, release availability, or local install application. |
| Identity privacy | `identity-privacy.ts` provides stable install pseudonym identity, hostname redaction, privacy-safe branch names, and token resolution. | It is not yet a full pre-send disclosure/secret policy for feedback reports or contributed features. |
| Build/release | `ProductVersion` links version and commit hash, optionally to `FeatureBuild`. `ChangePromotion` records deployment state. | Report-to-version and report-to-promotion links are absent. |
| Self-upgrade | `SelfUpgradeRun` records current/target/deployed SHA and completion evidence. `/ops/self-upgrade` shows configured source, running image, target head, and recent runs. | It is not connected to issue resolution notifications. |
| Shared workspace update | `PlatformDevConfig.updatePending` and `pendingVersion` drive the update banner and apply panel. | The banner says an update exists, not which reports/features it resolves. |
| Archetype | `StorefrontConfig.archetypeId` is the selected portal archetype source of truth. `FeaturePack` has `applicableVerticals`, `sourceVertical`, and `reusabilityScope`. | Issue reports do not snapshot source archetype or record applicability decisions. |
| Principal identity | New identity-bearing entities should converge on `Principal` + `PrincipalAlias`. | A future install/source-contributor identity must not become another parallel identity table. |

## 3. Research And Benchmarking

This contract borrows patterns from current support, issue, and product-feedback systems while preserving DPF's local-first privacy model.

| Reference | Pattern to adopt | Pattern to avoid |
| --------- | ---------------- | ---------------- |
| [GitHub linked issues and PRs](https://docs.github.com/articles/closing-issues-using-keywords) | Use durable references in PR bodies/commit messages so merges can be reconciled back to source issues. | Do not treat GitHub email/UI as the Dale-facing closure channel. |
| [Sentry Issue Details](https://docs.sentry.dev/product/issues/issue-details/) | Co-locate feedback, error context, linked tracker items, activity, and impact in one issue timeline. | Do not ship raw replays, hostnames, stack details, or user identity upstream by default. |
| [GitLab Service Desk](https://docs.gitlab.com/user/project/service_desk/using_service_desk/) | Let non-technical users enter through a support surface while maintainers work in a normal issue workflow. | Do not force Dale to choose issue types, PR links, or project labels. |
| [Linear Customer Requests](https://linear.app/docs/customer-requests) | Treat feedback as source-linked demand that can attach multiple customers to one issue/project. | Do not sync customer identity, revenue, domain, or private tenant details to the public project. |

DPF's differentiator is the local install boundary. A SaaS product can usually say "fixed" once production deploys. DPF must distinguish **fixed in source**, **available to this install**, and **installed on this local runtime**.

## 4. Design Principles

1. **Closure is evidence, not optimism.** A report is not closed for Dale until the relevant local state is known.
2. **Provenance is audit metadata, not the join key.** Claude, Codex, Build Studio, a maintainer, or another customer may produce the fix. DPF joins through durable artifact IDs and PR markers.
3. **One local source record.** `PlatformIssueReport` remains the local source for submitted feedback. New tables project resolution state around it; they do not replace it.
4. **Identity stays local by default.** `reportedById` and local organization identity never leave the install. Upstream work uses the stable install pseudonym.
5. **Secrets block sharing.** Public upstream bodies and reusable-feature packages must pass pre-send privacy and secret checks.
6. **Applicability is explicit.** A fix or feature must declare instance, archetype, or project scope before it is offered as closure.
7. **Release and apply are separate.** Merged PR, released version, update pending, and installed locally are distinct states.
8. **Notification is local and user-specific.** Dale-facing closure uses `Notification`; global/admin summaries use `PlatformNotification`.
9. **20% refactoring reserve.** Each implementation phase reserves at least 20% capacity for reducing existing feedback/release/provenance fragmentation before adding new UI or new tables.

## 5. Core Terms

| Term | Meaning |
| ---- | ------- |
| **Report** | The local `PlatformIssueReport` created by support mode, fallback form, crash boundary, MCP tool, or another sanctioned writer. |
| **Resolution** | A durable local record that says what is expected to close one or more reports. |
| **Artifact** | A work object linked to a resolution: local answer, backlog item, feature build, work capsule, GitHub issue, PR, merge commit, product version, promotion, update event, or self-upgrade run. |
| **Applicability** | The decision describing where the resolution is safe and useful: this install, an archetype/industry group, or the whole platform. |
| **Availability** | The fix exists in a release/update channel that this install can consume. |
| **Application** | The local install has actually applied the fix, source merge, promotion, or runtime upgrade. |
| **Verification** | The affected route/workflow was exercised locally after application. |

## 6. Scope Taxonomy

Every resolution must carry one primary scope.

| Scope | Applies to | Example | Required proof |
| ----- | ---------- | ------- | -------------- |
| `instance` | One local install only. | Dale's local provider token expired; admin fixed the credential. | Local action/evidence and a Dale notification. |
| `archetype` | Installs sharing a selected archetype/category or explicit archetype IDs. | Another HVAC dispatcher contributes a reusable dispatch board improvement. | Source archetype snapshot, applicability review, parameterization review, release artifact. |
| `project` | The core DPF platform. | `/build` crashes for all installs due to a platform bug. | Upstream issue/PR/version and local update/apply reconciliation. |

Secondary fields can refine the scope:

- `sourceArchetypeId` - stable `StorefrontArchetype.archetypeId` snapshot when submitted.
- `sourceArchetypeCategory` - broader category such as field service or professional services.
- `targetArchetypeIds` - explicit allow-list when not every category member should receive it.
- `excludedArchetypeIds` - explicit deny-list with reason.
- `requiresCapabilityFlags` - local capabilities that must be present before offering the fix.
- `requiresAdminAction` - whether an admin must merge, approve, redeploy, or resolve conflicts.

## 7. Applicability Rules

Applicability must be a governed decision, not an inference from labels alone.

### 7.1 Instance Fixes

Use `instance` when:

- the issue is local configuration, credential, model capacity, or installation state;
- the fix uses private business data;
- the fix changes a local workflow that has not been generalized;
- upstream contribution mode is `fork_only` and no exception was approved.

Instance fixes may still produce upstream docs or product feedback later, but that is a separate resolution.

### 7.2 Archetype Features And Fixes

Use `archetype` when:

- the problem or opportunity is tied to the selected operating model;
- the source install's archetype is known;
- the improvement is parameterizable or already generic;
- the receiving install's archetype and required capabilities match.

Another HVAC dispatcher may submit a feature Dale wants, but DPF must not auto-apply it from source customer context. The path is:

1. Source install submits/contributes.
2. Public/shared package is sanitized and pseudonymous.
3. Applicability review classifies it as `archetype`.
4. The review records source archetype, target archetypes, required capability flags, private-data exclusions, and parameterization needs.
5. Dale's install sees it only if his selected archetype/capabilities match and the release channel permits it.

### 7.3 Project Fixes

Use `project` when:

- the issue is in DPF core code or release packaging;
- multiple routes/installs can be affected;
- a reusable fix should ship through the normal platform release/update channel.

Project fixes are not closed locally when the PR merges. They become locally actionable only after a `ProductVersion`, platform update, or self-upgrade target includes the fix.

## 8. Identity Contract

### 8.1 Local Identity

Local records keep local identity for local use:

- `reportedById` remains the submitter link for `Notification`.
- `agentId`, `threadId`, `taskRunId`, `featureBuildId`, `ToolExecution`, and `WorkCapsule` preserve operational provenance.
- New identity-bearing surfaces must use `Principal` + `PrincipalAlias` rather than parallel identity tables.

### 8.2 Public/Upstream Identity

Public upstream artifacts use the install's stable pseudonym:

- issue/PR author display fields use `dpf-agent-<shortId>`;
- public branch names use privacy-safe branch helpers;
- DCO sign-off uses pseudonymous install identity;
- upstream body text must not include real user name, organization name, hostname, email, token, local URL, or private customer data.

### 8.3 Producer Provenance

The system must record who or what produced the artifact without relying on that producer for lifecycle joins.

Recommended `producerKind` values:

- `build_studio`
- `codex`
- `claude`
- `maintainer`
- `local_coworker`
- `customer_contribution`
- `system_reconciler`

Recommended producer references:

- `agentId`
- `toolExecutionId`
- `workCapsuleId`
- `featureBuildId`
- `gitBranch`
- `gitCommitSha`
- `prNumber`
- `upstreamIssueNumber`

The closure engine must treat these as audit facts. It must reconcile through artifact IDs, PR markers, release manifests, and local deployment state.

## 9. Secrets And Sensitive Data Contract

### 9.1 Data Classification

Every report/resolution artifact should separate:

- **local private evidence** - raw report text, local logs, stack traces, support transcript, user identity, route context with tenant/customer identifiers;
- **sanitized shareable summary** - coworker-produced description safe for GitHub Issue/PR body;
- **public metadata** - pseudonym, artifact IDs, broad archetype/category, version/commit links.

### 9.2 Pre-Send Gates

Before anything leaves the install or becomes a reusable feature package:

1. Run hostname/path redaction using the existing identity privacy helpers.
2. Run secret scanning over title, body, stack excerpt, transcript excerpts, attachments, generated patch, and PR body.
3. Block send if any high-confidence secret/token/private key/customer credential is detected.
4. Require explicit operator acknowledgement for `fork_only` exceptions.
5. Store the privacy decision and scanner result locally.
6. Send only the sanitized summary and public metadata upstream.

### 9.3 Forbidden Public Payloads

Never send these upstream by default:

- raw support transcript;
- raw error stack with local paths/hostnames;
- local `.env`, token, bearer credential, OAuth secret, private key, or credential hint;
- customer name, contact, domain, address, or invoice/order data;
- screenshots or replays unless a future spec defines consent, redaction, retention, and storage.

## 10. Data Model Proposal

Names are proposed; implementation may refine them, but the responsibilities should remain separated.

### 10.1 `PlatformIssueResolution`

One resolution can close one or more reports, and one report can have multiple resolution attempts over time. The first implementation may start with one active resolution per report if that keeps the slice smaller, but the model should not prevent many-to-many grouping.

```prisma
model PlatformIssueResolution {
  id                  String   @id @default(cuid())
  resolutionId        String   @unique // PIRR-*
  title               String
  summary             String?  @db.Text
  status              String   // proposed enum below
  scope               String   // instance | archetype | project
  source              String   // support | triage | build_studio | upstream | system
  producerKind        String?
  producerAgentId     String?
  producerToolExecId  String?
  sourcePseudonym     String?
  sourceArchetypeId   String?
  sourceArchetypeCategory String?
  targetArchetypeIds  String[] @default([])
  excludedArchetypeIds String[] @default([])
  requiresCapabilityFlags String[] @default([])
  privacyDecision     Json     @default("{}")
  applicabilityDecision Json   @default("{}")
  fixedInVersion      String?
  fixedInGitSha       String?
  releaseChannel      String?
  availableAt         DateTime?
  appliedAt           DateTime?
  verifiedAt          DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

Proposed `status` values:

| Status | Meaning |
| ------ | ------- |
| `routing` | The report has been accepted but no closure path is selected. |
| `local_answered` | Support answered the submitter without code/release work. |
| `local_work_needed` | A local BI/build is needed. |
| `upstream_needed` | Upstream issue/PR/release work is needed. |
| `fix_in_progress` | An artifact is actively being produced. |
| `fix_merged` | Source-level fix exists, but release availability is not known. |
| `fix_available` | A release/update channel can deliver the fix to eligible installs. |
| `update_required` | This install is eligible but must refresh, merge, or self-upgrade. |
| `applied_here` | This install has applied the fix. |
| `verified_here` | The affected route/workflow passed local verification after application. |
| `not_applicable` | The fix/feature does not apply to this install. |
| `blocked` | Privacy, conflict, missing capability, or release-channel issue blocks closure. |
| `superseded` | Another resolution replaced this one. |

### 10.2 `PlatformIssueResolutionReport`

Join table between reports and resolutions.

```prisma
model PlatformIssueResolutionReport {
  id            String @id @default(cuid())
  resolutionId String
  reportId     String
  role          String @default("primary") // primary | duplicate | related
  createdAt     DateTime @default(now())

  @@unique([resolutionId, reportId])
  @@index([reportId])
}
```

### 10.3 `PlatformIssueResolutionArtifact`

Append-only ledger of artifacts linked to a resolution.

```prisma
model PlatformIssueResolutionArtifact {
  id            String   @id @default(cuid())
  artifactId    String   @unique // PIRA-*
  resolutionId  String
  kind          String   // backlog_item | feature_build | work_capsule | github_issue | github_pr | merge_commit | product_version | change_promotion | self_upgrade_run | platform_update | notification | verification
  localId       String?
  semanticId    String?
  url           String?
  gitSha        String?
  version       String?
  status        String?
  producerKind  String?
  evidence      Json     @default("{}")
  createdAt     DateTime @default(now())

  @@index([resolutionId, kind])
  @@index([semanticId])
  @@index([gitSha])
}
```

### 10.4 `PlatformIssueResolutionInstallState`

This projection answers "what is true for this install right now?" In the current single-install product it can be a singleton local row. In future cloud or hive contexts it can include an install principal alias.

```prisma
model PlatformIssueResolutionInstallState {
  id              String   @id @default(cuid())
  resolutionId    String
  installPrincipalId String?
  applicability   String // applicable | not_applicable | unknown | blocked
  availability    String // unavailable | available | update_pending | conflict | blocked
  application     String // not_applied | applied | verified | failed
  localVersion    String?
  localGitSha     String?
  targetVersion   String?
  targetGitSha    String?
  blockingReason  String?
  lastCheckedAt   DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([resolutionId])
  @@index([applicability, availability, application])
}
```

Do not introduce a separate identity table for `installPrincipalId`. If the install needs a durable identity, model it as `Principal(kind="install")` with one or more `PrincipalAlias` rows.

### 10.5 Notification Idempotency

The current `Notification` model lacks a source key. The plan should either:

- add `sourceType` and `sourceId` to `Notification`, or
- create a small `PlatformIssueResolutionNotification` ledger that links resolution/report/install state to a notification row.

Recommended first-class fields:

- `resolutionId`
- `reportId`
- `userId`
- `notificationKind`: `fix_available`, `update_required`, `installed_here`, `blocked`, `not_applicable`
- `notificationId`
- `createdAt`

## 11. PR, Issue, And Release Linking

### 11.1 Required Artifact Markers

Every upstream issue, PR body, and generated release note that claims to resolve feedback must include a machine-readable footer.

```text
DPF-Resolution: PIRR-XXXXXXXX
DPF-Reports: PIR-XXXXXXXX[, PIR-YYYYYYYY]
DPF-Backlog: BI-XXXXXXXX
DPF-FeatureBuild: FB-XXXXXXXX
DPF-Source-Pseudonym: dpf-agent-XXXXXXXX
DPF-Scope: instance|archetype|project
DPF-Source-Archetype: hvac-field-service
DPF-Target-Archetypes: hvac-field-service,field-service-trades
```

Rules:

- At least `DPF-Resolution` or `DPF-Reports` is required for automatic closure.
- Closing keywords may be used for GitHub issue behavior, but DPF must parse its own markers.
- PR author, branch prefix, or tool name must not be the primary join key.
- If a PR lacks markers, an admin can manually link it, but the link must be auditable.

### 11.2 Artifact Reconciler

A local reconciler should:

1. Read open/upstream-linked resolutions.
2. Fetch linked GitHub issue/PR state when policy and credentials allow.
3. Parse DPF markers from PR body, issue body, and release notes.
4. Record `github_issue`, `github_pr`, `merge_commit`, and `product_version` artifacts.
5. Move resolution state from `fix_in_progress` to `fix_merged` only when merge/closure evidence is real.
6. Move to `fix_available` only when a release/update path includes the fixed SHA/version.

### 11.3 Producer-Agnostic Flow

Claude, Codex, Build Studio, maintainers, and customer contributors all use the same closure markers and artifact ledger. The producer may change across the lifecycle:

- Claude creates the first issue.
- Codex repairs the PR.
- Build Studio validates the fix.
- A maintainer squashes and merges.
- The self-upgrade runner applies the release locally.

The resolution remains one story because each artifact is linked to the same `resolutionId`.

## 12. Release, Update, And Local Apply Reconciliation

### 12.1 Source-Level Fix

`fix_merged` means:

- a linked PR merged, or
- a linked commit reached the default branch, or
- an upstream issue was closed with sufficient linked commit/PR evidence.

It does not mean Dale's install has the fix.

### 12.2 Release Availability

`fix_available` means:

- a `ProductVersion` or release manifest includes `fixedInGitSha`, or
- the platform update channel has a newer image/source version that includes it, or
- a Build Studio/local promotion produced a product version that includes it.

### 12.3 Local Update Required

`update_required` means this install is eligible but not yet applied. The local CTA depends on install mode:

| Install/update mode | CTA |
| ------------------- | --- |
| Governed self-upgrade | Deep link to `/ops/self-upgrade` with target version/SHA. |
| Shared workspace update | Deep link to `/admin/platform-development` apply panel. |
| Local Build Studio promotion | Deep link to the relevant `FeatureBuild`/Ship gate. |
| Manual maintainer update | Deep link to a report detail page with admin instructions. |

### 12.4 Applied Here

`applied_here` requires local evidence:

- `SelfUpgradeRun.deployedSha` contains or equals the fixed SHA, or
- `.dpf-version` / platform source state matches the fixed version, or
- `ChangePromotion.deployedAt` exists for a product version containing the fix, or
- a local build/promotion attached to the resolution deployed successfully.

### 12.5 Verified Here

`verified_here` requires a route/workflow verification event, not only a successful deployment. For UI/support paths, this should be browser or portal verification on the live portal when feasible. Structural checks alone do not close the loop.

## 13. User Experience Contract

### 13.1 Dale-Facing Timeline

Dale should see a simple timeline, not tracker internals:

1. Report received.
2. We are checking whether this is local or a platform fix.
3. A fix is being worked on / this is being handled locally.
4. A fix is ready for this install / no action needed / admin action needed.
5. This install has the fix.

The UI may be a lightweight report detail route or a support-thread panel. It must not require a GitHub account.

### 13.2 Notifications

Use `Notification` for submitter-facing updates:

| Notification | Trigger | Example copy |
| ------------ | ------- | ------------ |
| `feedback_fix_available` | `fix_available` and install eligible, not applied. | "A fix for your Build feedback is ready. Your DPF needs an update before you will see it." |
| `feedback_update_required` | Update exists but admin action is needed. | "A platform update can fix your report, but an admin needs to apply it." |
| `feedback_installed_here` | `applied_here` or `verified_here`. | "The fix for your Feedback report is now installed here. You can refresh and try again." |
| `feedback_blocked` | privacy, conflict, credential, or capability block. | "We found the likely fix, but this install needs admin attention before it can be applied." |

Use `PlatformNotification` only for aggregate/admin health, such as "8 feedback fixes are available but not applied."

### 13.3 Admin View

The issue report admin surface should show:

- report ID and source;
- resolution ID;
- scope;
- source and target archetypes;
- artifact links;
- fixed-in version/SHA;
- update/apply state;
- notification state;
- privacy/applicability decision summary;
- manual link/override controls with audit trail.

## 14. Failure Modes

| Failure mode | Required behavior |
| ------------ | ----------------- |
| Secret detected before upstream send | Block send, store local privacy decision, ask for a sanitized summary or operator acknowledgement only if safe. |
| `fork_only` install asks for upstream filing | Keep local by default. Offer one-shot exception only with explicit acknowledgement and audit fields. |
| PR merged without DPF markers | Do not auto-close. Allow audited manual link. |
| GitHub issue closed without a merged PR/release | Mark upstream state observed, but do not mark `fix_available` unless release evidence exists. |
| Release exists but this install has local conflicts | Mark `update_required` or `blocked`; notify admin/submitter with precise language. |
| Archetype feature comes from another customer but contains private assumptions | Mark `not_applicable` or `blocked`; require parameterization before offering. |
| Submitter no longer exists | Keep resolution ledger; skip user notification; emit admin health notification if needed. |
| Local verification fails after update | Keep state `applied_here` but not `verified_here`; reopen or create linked follow-up report. |

## 15. Security And Privacy Requirements

1. Upstream/reusable summaries must be generated from sanitized inputs, not raw transcripts.
2. Public issue/PR bodies must use pseudonym identity only.
3. Secret scanning must run before upstream issue creation, PR creation, release notes, and reusable feature packaging.
4. Scanner results must be stored locally, but secret values must never be stored in new resolution tables.
5. Local user identity stays local.
6. Install identity uses `Principal` + `PrincipalAlias` if a durable install identity is needed.
7. Public artifact markers may include semantic IDs (`PIR-*`, `BI-*`, `FB-*`, `PIRR-*`) and pseudonym, but not database CUIDs.
8. Route context sent upstream must be generalized unless the route itself is public and non-identifying.
9. Admin manual overrides must write `ToolExecution` or an equivalent audit event.

## 16. Phase Amendments To Capacity-Aware Feedback

This spec does not replace the capacity-aware feedback phases. It tightens them.

| Existing phase | Amendment |
| -------------- | --------- |
| Phase 1 - support mode | No change to UI shell scope. Ensure the report ID/support session can be displayed later in a timeline. |
| Phase 2 - `assessFeedbackRouting()` | Add scope, applicability seed, privacy decision seed, and expected closure path to the routing result. |
| Phase 3 - bridge wiring | Add resolution/artifact creation before upstream issue filing. Require DPF artifact markers in issue body. |
| Phase 4 - implicit triggers | Attach implicit reports to resolution grouping/coalescing, not just one-off PIR rows. |
| Phase 5 - reverse channel | Expand from "GitHub closed -> Notification" to "artifact -> release -> local apply -> user Notification." |
| Phase 6 - STT | Voice reports follow the same privacy, secret, and resolution contract; raw audio/transcript is local-only unless a future consent spec says otherwise. |

Recommended insertion: add **Phase 2a - Resolution Closure Ledger** before bridge wiring. Without it, Phase 3 can file upstream issues that cannot reliably notify Dale later.

## 17. Implementation Slices

This is not a task plan, but it suggests reviewable slices.

### Slice 0 - Spec And Backlog Alignment

- Review this spec against the capacity-aware feedback design.
- File or link the backlog item under `EP-9FC5D2FD` unless scope expands into a dedicated feedback platform epic.
- Update the capacity-aware feedback plan so Phase 2 captures closure fields.

### Slice 1 - Resolution Ledger Substrate

- Add resolution, report join, artifact ledger, install-state projection, and notification-idempotency support.
- Add typed constants for status/scope/kind strings.
- Add tests for many reports to one resolution and one report to superseded resolutions.
- Reserve 20% effort for consolidating existing issue-report status/update helpers.

### Slice 2 - Routing Scope And Privacy Seeds

- Extend `assessFeedbackRouting()` output with `scope`, `sourceArchetype`, `expectedClosurePath`, and privacy/secret gate seed.
- Snapshot `StorefrontConfig.archetypeId` and category when available.
- Do not send anything upstream in this slice.

### Slice 3 - Artifact Markers And Reconciler

- Add DPF marker generation to issue/PR bodies.
- Parse markers from upstream artifacts.
- Link PR/merge/version artifacts to resolutions.
- Add manual audited link path for markerless PRs.

### Slice 4 - Applicability Review

- Use `FeaturePack.applicableVerticals`, `sourceVertical`, and `reusabilityScope` where already present.
- Add explicit applicability decisions for another customer's feature/fix.
- Block non-parameterized or private-data-dependent features from archetype/project distribution.

### Slice 5 - Release And Local Apply Projection

- Reconcile `ProductVersion`, `ChangePromotion`, `SelfUpgradeRun`, and `PlatformDevConfig.updatePending`.
- Distinguish `fix_merged`, `fix_available`, `update_required`, `applied_here`, and `verified_here`.
- Add tests for self-upgrade and shared-workspace update modes.

### Slice 6 - Dale/Admin UX

- Add timeline/detail UX and notifications.
- Add admin resolution columns and manual override controls.
- Verify the live portal click/update flow, not just structural tests.

## 18. Acceptance Criteria

### Instance Closure

- Dale submits Feedback on `/build`.
- The report creates or links to a resolution with `scope="instance"`.
- A local action resolves it without upstream sharing.
- Dale receives a local notification or timeline update.
- No upstream identity, transcript, or secret is sent.

### Project Closure

- Dale submits a platform bug.
- The report links to an upstream issue and a later PR using DPF markers.
- Merge creates `fix_merged`.
- Release/update availability creates `fix_available` or `update_required`.
- Self-upgrade or platform update application creates `applied_here`.
- Local browser verification creates `verified_here`.
- Dale receives precise local notifications at availability and installation.

### Archetype Reuse

- Another customer contributes an HVAC/field-service improvement.
- The contribution is sanitized and pseudonymous.
- Applicability review approves `scope="archetype"` with target archetypes/capabilities.
- Dale's install sees the update only if his selected archetype/capabilities match.
- Dale is told whether the feature is available, requires update/admin action, or is not applicable.

### Security

- A report containing a token, hostname, email, or customer private data is blocked from public send until sanitized.
- The public issue/PR contains only pseudonym, semantic IDs, generalized route/context, and sanitized summary.
- Scanner/audit evidence is local and does not store secret values.

## 19. Open Questions

1. Should the first user-facing detail surface be `/feedback/reports/[reportId]`, a coworker support timeline drawer, or a section inside the notification center?
2. Should `Notification` gain `sourceType/sourceId` directly, or should notification idempotency live in a feedback-specific join table?
3. What is the canonical install identity today: existing platform dev pseudonym only, or a new `Principal(kind="install")` alias created during setup?
4. Should `FeaturePack.applicableVerticals` stay category-based, or should archetype-specific applicability use explicit `StorefrontArchetype.archetypeId` values first?
5. What release manifest is canonical for mapping merged PRs to `ProductVersion` in image-based installs?
6. Should update-required notifications go only to submitter, only to admins, or to both with different copy?

## 20. Non-Goals

- Do not build a public customer portal for issue tracking in this slice.
- Do not expose GitHub mechanics to Dale.
- Do not let external PR author identity decide local applicability.
- Do not auto-install another customer's feature without applicability and release checks.
- Do not create a second GitHub API client for feedback.
- Do not use `PlatformNotification` for submitter-specific closure.
- Do not weaken contribution-mode policy to make closure easier.
