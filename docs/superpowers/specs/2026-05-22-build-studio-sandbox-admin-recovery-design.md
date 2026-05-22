# Build Studio Sandbox Administration and Recovery Control Plane

| Field | Value |
| --- | --- |
| Date | 2026-05-22 |
| Status | Draft for implementation |
| Primary epic | `EP-BUILD-STUDIO` |
| Related backlog | `BI-1F0B791A` Build Studio self-recovery for contribution PRs; `BI-BF558CF7` stepGenerateCode tool-scope fix; `BI-860603DA` external contribution governance; `BI-63C11CF7` worktree compose isolation |
| Related docs | `2026-05-19-build-studio-stall-detection.md`; `2026-05-21-sandbox-pool-wiring.md`; `2026-04-20-ship-phase-fork-redesign-design.md`; `2026-04-01-contribution-mode-git-integration-design.md`; `2026-04-30-build-specialist-operator-contract.md`; `2026-05-16-worktree-hygiene-design.md` |
| Triggering incident | `FB-9706671B` / PR #961: detached sandbox, stale diff, DCO mismatch, red GitHub checks, coworker asked user to restart infrastructure |

## 1. Purpose

Build Studio has a mandatory `deploy_feature` gate, but it does not have a governed administrative control plane for the sandbox that gate depends on. When the sandbox is stopped, detached from the build, owned by the wrong worktree, stale against `origin/main`, or mixed across Docker Compose projects, the AI coworker currently cannot recover it through platform tools.

The result is an impasse:

1. The coworker asks the non-technical operator to restart or repair infrastructure.
2. The operator cannot safely do that.
3. The coworker either loops, asks again, or proposes an unsafe override.
4. Build Studio may still submit a PR from a stale or unverified diff.

This spec defines a Build Studio sandbox administration and recovery control plane. The goal is not merely to add a restart button. The goal is to make sandbox ownership, source currency, recovery authority, and PR readiness explicit enough that Build Studio can either fix its own runtime or stop with a precise, actionable platform-admin state.

## 2. Current Repo Truth Checked

The diagnosis that produced this spec was grounded in current code, live database state, Docker labels, and GitHub PR checks.

### 2.1 Runtime incident evidence

- PR #961 was created for `FB-9706671B` and failed the meaningful merge gates: DCO, typecheck, unit tests, production build, schema regression guard, and routing invariants audit.
- The PR commit was authored by `Mark Bodman <markdbodman@gmail.com>` but signed off as `dpf-agent-4196a68e <agent-4196a68e4300da8b@hive.dpf>`, which explains the DCO failure.
- `FeatureBuild.buildExecState` recorded the sandbox source as ahead of its local client branch, but `PlatformDevConfig.upstreamRemoteUrl` was blank, so the sandbox could not prove it was current against `origin/main`.
- Docker labels showed the root portal and `dpf-sandbox-1` were created from different worktrees while sharing the `dpf` Compose project name.
- `RuntimeTarget` had multiple historical `RT-BUILD-SANDBOX-*` rows marked `running` against the same singleton container.
- `taskResults` recorded `filesChanged:0`, `ranTests:false`, and a model/runtime limit, yet the build advanced toward ship.
- `verificationOut` contained failing test output while recording green summary booleans.

### 2.2 Existing code constraints

- `check_sandbox` in `apps/web/lib/mcp-tools.ts` only checks `docker inspect ... .State.Status`; it does not validate build ownership, Compose project, source path, branch, slot, runtime target, source currency, or active diff base.
- `start_sandbox` tells the user to run `docker compose up -d sandbox` when the container is missing. That violates AGENTS.md's "never ask the user to run commands" rule.
- The same violation appears in at least four more places that this spec must address as one cohort, not piecemeal: `start_build` legacy fallback message in `mcp-tools.ts` (`"tell the user to run: docker compose up -d sandbox"`), `run_ux_test` browser-use unreachable path (`"Run 'docker compose up -d browser-use'"`), `evaluate_page` browser-use fallback (same string), and the `start_build` instructions in `build-agent-prompts.ts` STEP 0 ("Please run: docker compose up -d sandbox"). The legacy text is duplicated; the fix must be too.
- `deploy_feature` blocks missing `sandboxId` or missing `buildBranch`, and it has a schema-regression guard, but it trusts the registered sandbox identity too much once those fields exist.
- `contribute_to_hive` requires a non-empty stored diff, but it does not rerun sandbox readiness, schema regression, CI prediction, DCO identity validation, or the Build Studio verification gate before opening a PR.
- `createBranchAndPR` validates only that a `Signed-off-by` trailer exists; it does not ensure the GitHub commit author/committer matches that trailer.
- `contribution-review` reports `merge-ready` from review scans without waiting for required GitHub checks.
- `RuntimeTarget` already has `composeProjectName`, `slotId`, `containerName`, `featureBuildId`, `metadata`, and `lastHeartbeatAt`, but the Build Studio registration path does not populate enough of those fields to detect the incident class.

### 2.3 Live backlog overlap

MCP live backlog lookup found that this belongs under the existing `EP-BUILD-STUDIO` line, not a new detached epic. Read-only DB fallback found open or in-progress related items for sandbox self-recovery, sandbox baseline currency, PR hard-fail behavior, contribution governance, and Compose isolation. This spec is the architectural umbrella that connects those items instead of letting them land as unrelated patches.

## 3. Problem Statement

### 3.1 Mandatory gate without an operator path

`deploy_feature` is a mandatory ship gate. If it cannot extract the diff, ship must stop. But when `deploy_feature` fails because the sandbox is detached, Build Studio has no first-class diagnostic or recovery path. The coworker sees "sandbox not running" or "no sandbox," while Docker may show a running container. The gap is not just status wording; the platform lacks the model needed to answer "is this the correct sandbox for this build?"

### 3.2 Container liveness is not build readiness

A running container is not enough. Build Studio needs to know:

- which Compose project created the container;
- which worktree path created it;
- which service it is;
- which `FeatureBuild` currently owns it;
- which `SandboxSlot` owns it;
- which branch is checked out inside `/workspace`;
- whether that branch is current against `origin/main` or the configured client branch;
- whether the workspace contains dirty/leaked files;
- whether the diff was extracted from the same runtime target being inspected.

Today, `check_sandbox` answers only the first fraction of the first question: "is the named container running?"

### 3.3 Unsafe fallback language

The coworker interaction around `FB-9706671B` exposed two unsafe behaviors:

- asking the user to restart Docker or the sandbox manually;
- suggesting an override that treats the submitted PR as authoritative after GitHub checks are already red.

Both must become impossible. If Build Studio cannot recover the sandbox through governed tools, it must stop and record a platform issue. It must not push responsibility onto the user or continue with an untrusted diff.

### 3.4 PR submission is too far downstream

By the time GitHub CI fails, the platform has already leaked a broken PR into the public contribution channel. Build Studio needs a pre-PR readiness gate that combines sandbox integrity, verification evidence, schema regression, DCO identity, and diff sanity before `createBranchAndPR` runs.

## 4. Research and Benchmarking

The design follows established operational patterns rather than inventing a bespoke sandbox story.

| Reference | Pattern adopted | DPF application |
| --- | --- | --- |
| Docker Compose project naming and labels: [project name](https://docs.docker.com/compose/how-tos/project-name/), [Compose labels](https://docs.docker.com/reference/compose-file/services/) | Compose project names isolate stacks, and Compose labels identify project/service ownership. | Sandbox readiness must inspect `com.docker.compose.project`, service labels, config files, and working directory labels before trusting a container. |
| Kubernetes probes: [liveness, readiness, startup probes](https://kubernetes.io/docs/concepts/workloads/pods/probes/) | Liveness and readiness are distinct. A process can be alive but not ready for traffic. | Build Studio must separate container running from sandbox ready-for-build and ready-for-deploy. |
| AWS Step Functions task heartbeats: [Task state](https://docs.aws.amazon.com/step-functions/latest/dg/state-task.html) | A long-running task fails if heartbeat time is exceeded. | Recovery actions need durable heartbeats and incident rows, not chat-only status. |
| GitHub protected branches and required checks: [required status checks](https://docs.github.com/articles/about-required-status-checks) | Merge requires required status checks to pass. | Build Studio contribution review cannot report merge-ready until required checks are green or explicitly pending. |
| GitHub Git commit API: [Create a commit](https://docs.github.com/v3/git/commits/) | Commit API accepts explicit `author` metadata. | Build Studio must set author/committer consistently with the DCO signoff identity. |

Existing DPF specs already cover adjacent pieces:

- `2026-05-19-build-studio-stall-detection.md` covers long-running task heartbeats and stalled task recovery.
- `2026-05-21-sandbox-pool-wiring.md` covers slot mutexes and queuing.
- `2026-04-20-ship-phase-fork-redesign-design.md` covers the UI distinction between upstream PR and production promotion.
- `2026-04-01-contribution-mode-git-integration-design.md` covers contribution mode and DCO acceptance.

This spec fills the missing operational middle: sandbox administration and recovery.

## 5. Scope

### 5.1 In scope

- A read-only sandbox diagnostic service that returns a structured readiness snapshot.
- Governed MCP tools for diagnosis and recovery.
- Runtime target registration that captures Compose ownership, slot ownership, source path, branch, and source-currency evidence.
- Build Studio UI surfaces for sandbox health, ownership, blockers, and recovery actions.
- Prompt/tool contract changes that forbid asking the user to run Docker or override `deploy_feature`.
- Pre-PR contribution readiness gates that block broken PR creation before GitHub CI catches it.
- DCO author/signoff consistency in GitHub commit creation.
- Regression tests for the `FB-9706671B` failure class.

### 5.2 Out of scope

- Multi-container sandbox pool expansion beyond the existing slot model.
- Full workflow orchestration replacement with Temporal, Argo, or Step Functions.
- Automatic destructive cleanup of unknown worktrees or Docker volumes.
- Making red GitHub CI auto-fix itself. The v1 gate prevents bad PRs; repair still happens through normal development flow.
- Changing the Build Studio phase enum.

## 6. Operating Principles

1. **Never ask the user to operate infrastructure.** The coworker calls tools; the UI exposes governed buttons; the platform records what happened.
2. **Container running is not enough.** Readiness requires ownership, source, branch, and workspace checks.
3. **No PR from an untrusted diff.** If sandbox state is detached, stale, mixed, dirty, or unverifiable, contribution is blocked.
4. **Recovery is governed and auditable.** Every recovery action records `ToolExecution`, `BuildActivity`, and a runtime issue when relevant.
5. **Unsafe recovery stops with a clear status.** When recovery would discard uncommitted user work or operate on an unknown container, the tool returns `blocked` and records the reason.
6. **UI shows the truth directly.** The operator should see the owning build, branch, container, worktree, Compose project, source currency, and available actions without reading logs.
7. **Contribution review is not CI.** The bot review can add security/reusability commentary, but merge readiness must depend on required checks.

## 7. Sandbox Readiness Model

### 7.1 `SandboxReadinessState`

The diagnostic service returns one of these states:

| State | Meaning | Default coworker behavior |
| --- | --- | --- |
| `healthy` | Container, runtime target, slot, branch, source currency, and workspace all match the active build. | Continue. |
| `stopped` | Correct container exists but is not running. | Call governed recovery action `start`. |
| `not_found` | Expected container does not exist. | Offer governed rebuild path if the install has sandbox compose config; otherwise block and record incident. |
| `detached` | Container runs, but it is not registered to the active build or runtime target. | Block deploy; allow `rebind` only when branch and source checks match. |
| `mixed_compose_project` | Docker labels show a container from a different worktree or Compose project. | Block deploy; quarantine target; route to admin recovery. |
| `branch_mismatch` | Container branch is not `build/<buildId>` or the registered branch. | Block deploy; allow `checkout_registered_branch` only if no dirty source changes. |
| `stale_source` | Sandbox cannot prove current `origin/main` or configured base ref. | Block PR contribution; allow `reset_from_main` only when diff preservation policy passes. |
| `dirty_or_leaking` | Workspace has source changes not attributable to this build, generated artifacts in the releasable diff, or a dirty tree before a new build starts. | Block deploy; record issue; require reset or manual review. |
| `verification_red` | Sandbox is structurally healthy but build evidence is red, contradictory, or absent. | Block contribution; return next verification action. |
| `stuck_mid_phase` | Build is registered to a sandbox and a `BuildPhaseRun` is `running` past its heartbeat budget, or last phase finished with `filesChanged:0` and no further activity. | Block deploy; offer governed `reset_build_phase`/`release_stale_slot`; never silently mark complete. |
| `unrecoverable` | Recovery would be destructive or the platform lacks authority. | Stop; record incident; surface admin status. |

The `stuck_mid_phase` state is the umbrella for the current "stuck COST-P1 builds awaiting Reset Build" class: builds wedged at `deps_installed` or builds at `complete` with `filesChanged:0`. This spec's governed `reset_build_phase` action replaces the missing Reset Build UI for sandbox-side stuck states; the broader phase-reset feature can land separately, but sandbox-attributable stuck states must be clearable here.

### 7.2 Readiness checks

`diagnoseSandboxState(buildId)` evaluates these checks in order:

1. **Build row:** `FeatureBuild` exists, belongs to the active user or authorized admin context, and has `buildId`.
2. **Registered sandbox fields:** `FeatureBuild.sandboxId`, `sandboxPort`, and `buildBranch`.
3. **Runtime target:** latest `RuntimeTarget` for the feature build has `kind=build-sandbox`, non-released status, and matching container/port.
4. **Slot ownership:** `SandboxSlot.buildId` and `RuntimeTarget.slotId` match when slot data exists.
5. **Docker liveness:** container exists and state is running.
6. **Docker ownership labels:** Compose project, service, working directory, config files, and container name match expected values.
7. **Workspace git state:** `/workspace` is a git repo, current branch matches `build/<buildId>`, HEAD/base refs exist, and `git status --porcelain` is acceptable for the active phase.
8. **Source currency:** if `upstreamRemoteUrl` is configured, `origin/main` fetch/probe is current; otherwise source currency is explicitly `unverified` and PR contribution is blocked.
9. **Diff sanity:** diff does not remove schema models/fields, does not include generated client artifacts, lockfile churn, `.next`, or broad snapshot deletions unless explicitly allowed by a task-specific gate.
10. **Verification sanity:** `taskResults.filesChanged > 0`, `taskResults.ranTests === true`, verification does not contain contradictory green booleans with failing raw output, and typecheck/build evidence is current enough.

The diagnostic service returns both a coarse state and a detailed checklist. The UI can render the checklist without parsing prose.

## 8. Data Model Stewardship

### 8.1 Reuse existing models in v1

No new database model is required for v1.

| Existing model | v1 use |
| --- | --- |
| `RuntimeTarget` | Canonical registered runtime for each sandbox. Populate `composeProjectName`, `slotId`, `containerName`, `serviceName`, `metadata.workingDir`, `metadata.composeConfigFiles`, `metadata.branchName`, `metadata.sourceCurrency`. |
| `SandboxSlot` | Slot lease and contention source of truth. The recovery service can release stale slots only through governed action. |
| `RuntimeVerification` | Records health/readiness/typecheck/build/CI verification against a runtime target. |
| `BuildActivity` | Human-readable build timeline entries for diagnosis and recovery. |
| `PlatformIssueReport` | Durable incident row for sandbox recovery blockers, coworker process violations, and unrecoverable states. |
| `ToolExecution` | Existing audit trail for every diagnostic and recovery tool call. |

### 8.2 Additive metadata contract

The Build Studio runtime registration must populate existing fields rather than hiding everything in `metadata`:

- `RuntimeTarget.composeProjectName`
- `RuntimeTarget.serviceName = "sandbox"`
- `RuntimeTarget.slotId` when a `SandboxSlot` exists
- `RuntimeTarget.containerName`
- `RuntimeTarget.port`
- `RuntimeTarget.metadata.buildId`
- `RuntimeTarget.metadata.buildBranch`
- `RuntimeTarget.metadata.composeWorkingDir`
- `RuntimeTarget.metadata.composeConfigFiles`
- `RuntimeTarget.metadata.sourceCurrency`
- `RuntimeTarget.metadata.gitHead`

This is intentionally additive. Existing rows remain readable; new diagnostics mark old rows as `unverified` if metadata is absent.

## 9. MCP Tool Contract

### 9.1 `diagnose_sandbox`

Read-only. Available in Build Studio phases `build`, `review`, and `ship`, plus Admin/Operations surfaces.

Input:

```json
{
  "buildId": "FB-..."
}
```

Output:

```json
{
  "success": true,
  "state": "mixed_compose_project",
  "canDeploy": false,
  "canContribute": false,
  "summary": "Sandbox container is running but belongs to compose project dpf from D:\\DPF-clean-main-linux, not the active Build Studio worktree.",
  "checks": [
    { "id": "docker_state", "status": "pass", "detail": "running" },
    { "id": "compose_project", "status": "fail", "expected": "dpf", "actual": "dpf", "detail": "project name matches but working_dir does not" },
    { "id": "compose_working_dir", "status": "fail", "expected": "D:\\DPF", "actual": "D:\\DPF-clean-main-linux" }
  ],
  "recommendedActions": [
    { "action": "quarantine_runtime_target", "requiresApproval": false },
    { "action": "rebuild_sandbox", "requiresApproval": true }
  ]
}
```

The tool never says "run Docker." It names governed actions.

### 9.2 `recover_sandbox`

Side-effecting. Requires admin/build authority. It accepts one explicit action at a time.

Supported v1 actions:

| Action | Allowed when | Effect |
| --- | --- | --- |
| `start` | Correct container exists but stopped. | `docker start` the expected container, then rerun diagnostics. |
| `restart` | Correct container exists and branch/workspace ownership match. | `docker restart`, then rerun diagnostics. |
| `rebind_runtime_target` | Container branch and build id match but `RuntimeTarget` is stale/missing. | Update/register `RuntimeTarget` with correct ownership metadata. |
| `release_stale_slot` | Slot points to a non-active build or terminal build exec state. | Release `SandboxSlot` and record activity. |
| `checkout_registered_branch` | Branch mismatch but no dirty source changes. | Checkout the registered `build/<buildId>` branch and rerun diagnostics. |
| `reset_from_main` | No unpreserved build diff exists, or operator approved discard. | Fetch/reset from `origin/main`, recreate client/build branch, record source currency. |
| `quarantine_runtime_target` | Container belongs to wrong worktree/project or unknown owner. | Mark target `misconfigured`, block deploy/contribution, record issue. |
| `reset_build_phase` | Build is `stuck_mid_phase` past heartbeat budget OR phase finished with `filesChanged:0` and no diff. | Mark phase failed with reason, release sandbox slot if held, surface for re-dispatch. |

`reset_from_main`, `reset_build_phase`, and any action that could discard source changes or in-flight build state require an explicit recovery confirmation captured as structured input, not an implied chat "yes." A build that is merely paused (no heartbeat activity but inside the idle window) must NOT be eligible for slot release — see §13.5 for the staleness threshold.

### 9.3 `record_sandbox_incident`

Writes a `PlatformIssueReport` linked to `FeatureBuild`, `RuntimeTarget`, `TaskRun` when known, and the active agent. Used when diagnostics find a blocker or recovery is denied.

### 9.4 Tool replacement rule

`check_sandbox` and `start_sandbox` remain temporarily for compatibility, but their descriptions and return messages must stop asking the user to run commands. The Build Studio prompt should prefer `diagnose_sandbox` and `recover_sandbox`; legacy tools should internally delegate or return deprecation guidance.

## 10. UI Design

### 10.1 Admin surface

Add `Admin > Build Studio > Sandbox Control` at `/admin/build-studio/sandbox`.

This is an operational console, not a marketing page. It should be dense, scannable, and quiet:

- left column: active sandbox targets, one row per `RuntimeTarget`;
- center detail: selected target readiness checklist;
- right rail: governed recovery actions with disabled states and reasons;
- bottom band: recent `BuildActivity`, `PlatformIssueReport`, and `RuntimeVerification` records.

Each target row shows:

- readiness state;
- build id and title;
- owning branch;
- container name;
- Compose project and working directory;
- slot id/status;
- last heartbeat;
- source currency summary;
- last recovery action.

Theme requirements:

- Use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, `border-[var(--dpf-border)]`, and `text-[var(--dpf-accent)]`.
- Use icons for actions such as refresh, restart, rebind, quarantine, and open PR; include tooltips for icon-only buttons.
- Avoid nested cards. Use full-width bands and compact rows.
- Do not use hardcoded gray/white/black color classes.

### 10.2 Build Studio surface

When a build enters `review` or `ship`, Build Studio should show a "Sandbox Readiness" strip near the workflow graph:

- `Healthy` lets the flow continue.
- `Needs recovery` shows the failed checks and the primary recovery action.
- `Blocked` disables PR/deploy actions and links to the admin console detail.

The coworker chat should echo the same state in plain language, but the UI is the source of operational truth.

### 10.3 AI Operations Map

The AI Operations Map should treat `RuntimeTarget.kind=build-sandbox` as a clickable operational target. Misconfigured and blocked targets should render as actionable tiles, not just counts.

## 11. Coworker Contract

The Build Studio coworker must follow these rules:

1. Never ask the user to run Docker, Git, SQL, `gh`, or shell commands.
2. When `deploy_feature` fails, call `diagnose_sandbox` before proposing any next step.
3. If diagnostics return a governed recovery action, call or present that action through the UI.
4. If diagnostics return `unrecoverable`, stop and record a sandbox incident.
5. Do not ask for an override to skip sandbox diff extraction.
6. Do not treat an already-submitted PR as authoritative when GitHub checks are red.
7. Do not call `contribute_to_hive` unless `deploy_feature` succeeded in the current readiness window and contribution gates pass.
8. If the issue is platform capability rather than user input, say so directly: "Build Studio is blocked because the sandbox recovery tool is missing or denied."

### 11.1 Coworker dialog contract

The rules above describe *what* the coworker may not do. This section specifies *what it must say* — the text the user actually sees in the AI Coworker panel. Every dialog ends with concrete next-step choices (never internal status, never "your call"). The coworker drives the portal UI itself where possible (Claude-in-Chrome → server action → MCP tool → SQL, in that order of preference); chat is the explanation surface, not the operator console.

Required dialog templates per readiness state:

| State | Required coworker dialog (paraphrasable, but must end with choices) |
| --- | --- |
| `stopped` | "Your sandbox container is stopped. I'm starting it now via the platform — no action needed from you. **Options:** (1) Wait for restart and continue (default), (2) Open Sandbox Control to watch progress." |
| `not_found` | "The sandbox container does not exist for this install. I'll request the platform to provision it. **Options:** (1) Provision now (default), (2) Open Sandbox Control to review prerequisites." |
| `detached` / `mixed_compose_project` | "Build Studio's sandbox is owned by a different worktree (`<wrong path>`). I cannot safely deploy from this state, and I will not ask you to run Docker. The platform has quarantined the target and recorded incident `<PIR-id>`. **Options:** (1) Rebuild the sandbox from this worktree (default), (2) Switch the active build to the owning worktree, (3) Open Sandbox Control." |
| `stale_source` | "The sandbox cannot prove it is current against `origin/main` — `PlatformDevConfig.upstreamRemoteUrl` is unset or the fetch probe failed. I will not open a PR from unverified base. **Options:** (1) Configure upstream remote and reprobe (default), (2) Hold this build in review until source currency is verified, (3) Open Platform Development settings." |
| `dirty_or_leaking` | "The sandbox workspace contains changes not attributable to this build (generated artifacts / cross-build leakage). I'm blocking deploy to prevent a contaminated PR. **Options:** (1) Show me the leaking paths (default), (2) Reset workspace from `build/<id>` with structured confirmation, (3) Open Sandbox Control." |
| `verification_red` | "Verification is red: <one-line failure summary from raw output>. The earlier green summary booleans were wrong; I'm trusting the raw test/typecheck output. **Options:** (1) Show me the failing output (default), (2) Re-run verification, (3) Send build back to code generation." |
| `stuck_mid_phase` | "The build is wedged at `<phase>` — last heartbeat `<ago>`, `filesChanged: <n>`, `ranTests: <bool>`. I will not advance it on contradictory evidence. **Options:** (1) Reset this phase and re-dispatch (default), (2) Show me the last task output, (3) Mark the build paused for later." |
| `unrecoverable` | "Build Studio is blocked because the sandbox recovery tool is missing or denied — this is a platform issue, not something you can fix from chat. I've recorded `<PIR-id>`. **Options:** (1) Open the incident, (2) Open Sandbox Control to review state, (3) Switch to a different build." |

Forbidden coworker dialog patterns (all currently observed in the FB-9706671B trace and in surrounding `mcp-tools.ts` strings):

- "Please run `docker compose up -d sandbox`."
- "Tell the user to run …"
- "Run `docker compose up -d browser-use` …"
- "Want me to skip the sandbox check and submit anyway?" / "Should I override deploy_feature?"
- "I've submitted the PR — let me know if CI is red." (treating a red PR as authoritative.)
- "Try restarting Docker Desktop."
- Replies that end with internal status ("Done.", "Continuing.", "Investigating.") rather than user choices.

The dialog test in §10 of the plan must assert at least one negative example per forbidden pattern and one positive example per required template.

### 11.2 Self-upgrade interaction

Per the live `project_self_upgrade_kills_in_session_ux` note: the portal recycles whenever the main bundle hash changes (every merged sibling PR). Sandbox recovery actions must therefore be:

1. **Idempotent** — calling `recover_sandbox` twice with the same `(buildId, action)` after a portal restart must not double-execute. Use `BuildActivity` for the de-dupe lookup.
2. **Resumable from snapshot** — the UI re-derives state from `RuntimeTarget` + `BuildActivity` + `PlatformIssueReport` on cold load; chat-only state does not survive restart.
3. **Non-blocking on portal restart** — if a recovery server action is interrupted mid-flight, the next `diagnose_sandbox` call must distinguish "action was rolled back" from "action partially applied" via the persisted activity row.

## 12. Gate Integration

### 12.1 `deploy_feature`

Before extracting a diff, `deploy_feature` calls the diagnostic service. It proceeds only when:

- readiness state is `healthy`;
- build branch matches the active build;
- source currency is verified against `origin/main` when upstream contribution is enabled;
- workspace diff sanity passes;
- runtime target ownership matches the active build.

If any check fails, `deploy_feature` returns `success:false`, records a `BuildActivity`, and includes structured `recommendedActions`. It does not ask the user to repair the environment.

### 12.2 `stepGenerateCode`

`stepGenerateCode` must use a narrow sandbox-editing toolset and hard-fail if the code agent has no mutating sandbox tool. The task result must fail the pipeline when:

- no source file was changed;
- no test command ran;
- the model/runtime reported a limit;
- the result text says the task should be split smaller;
- tools executed did not include a write/edit command when implementation was expected.

The count must include `write_sandbox_file`, `edit_sandbox_file`, and any future sandbox write command. It must not count planning or sandbox status checks as implementation.

### 12.3 `saveBuildEvidence`

Missing verification booleans are unknown, not passing. Raw failing output wins over contradictory green summary fields. Evidence normalization must mark the build blocked when output contains failed suites, type errors, missing generated Prisma models, or command failure markers.

### 12.4 `contribute_to_hive`

Before creating a `FeaturePack` or PR, `contribute_to_hive` must require:

- successful `deploy_feature` in the current sandbox readiness window;
- schema regression guard pass;
- typecheck pass;
- unit test pass for affected area;
- production build pass or explicit non-UI/non-web exemption;
- DCO acceptance;
- commit author/committer identity matching the DCO signoff;
- no generated artifacts, snapshots, or `next-env.d.ts` churn unless explicitly allowed by a task-specific rule;
- pre-PR gates pass.

If any of those fail, the tool returns `success:false` and records a contribution blocker. It must not create a local `FeaturePack` that implies contribution success before the PR path is viable.

### 12.5 `contribution-review`

Contribution review may post advisory findings, but it cannot set `merge-ready` or a green `contribution-review` status until required GitHub checks are green. Before that, it should be `pending` or `failure` with a message such as "Waiting for required checks."

### 12.6 `createBranchAndPR`

The GitHub commit API call must set explicit `author` and `committer` metadata that match the DCO identity, or the DCO signoff must match the token owner. Pseudonymous AI coworker contribution is valid only when both commit metadata and signoff use the same pseudonymous identity.

## 13. Recovery Flows

### 13.1 Stopped sandbox

1. Coworker calls `diagnose_sandbox`.
2. Diagnostic state is `stopped`.
3. Coworker calls `recover_sandbox({ action:"start" })`.
4. Recovery reruns diagnostics.
5. If healthy, build continues; if not, incident is recorded.

### 13.2 Mixed Compose project

1. Diagnostic detects container labels from a different worktree or config path.
2. `deploy_feature` and `contribute_to_hive` are blocked.
3. Recovery action `quarantine_runtime_target` marks target `misconfigured`.
4. Admin UI offers `rebuild_sandbox` only after operator confirmation and diff-preservation check.
5. The coworker reports the platform-admin status, not user instructions.

### 13.3 Stale source before PR

1. Diagnostic detects `upstreamRemoteUrl` missing or `origin/main` unverified.
2. Local build/review may continue, but upstream contribution is blocked.
3. Admin UI shows the missing Platform Development configuration and source-currency evidence.
4. After configuration, recovery can fetch/reset from `origin/main` only if no unpreserved build diff exists.

### 13.4 Red PR already exists

1. Build Studio marks the PR as untrusted.
2. Contribution review posts/updates a blocking status.
3. Coworker tells the operator the PR should be closed or superseded.
4. Repair happens from a clean branch/worktree; the bad PR is not used as authoritative source.

### 13.5 Stuck mid-phase recovery

Heartbeat budget per phase (initial values; tunable via `PlatformDevConfig`):

| Phase | In-flight heartbeat budget | Idle (no activity) staleness | Notes |
| --- | --- | --- | --- |
| `deps_installed` → next phase dispatch | 30 min | 7 days | Current stuck-build class. |
| `code_generation` (active) | 90 min | 7 days | Long-running agentic runs allowed. |
| `code_generation` (returned `filesChanged:0`) | n/a | immediate-fail (no idle window) | Hard-fail per §12.2. |
| `verification` | 60 min | 7 days | |
| `review` / `ship` (awaiting operator) | n/a | 14 days | Paused work; never auto-released. |

The 7-day idle floor is intentional and derives from the `idle_is_not_abandoned` operating rule: paused work must survive a full week to absorb the operator's travel and weekly rate-limit resets. `release_stale_slot` against a build whose last activity is younger than the idle threshold returns `blocked` even if the operator clicks the button — the UI must disable it with that reason.

Recovery flow:

1. Diagnostic detects `stuck_mid_phase`.
2. Coworker emits the §11.1 dialog and offers `reset_build_phase` (default) plus "show last task output" and "pause for later."
3. On operator confirmation, `recover_sandbox({ action:"reset_build_phase" })` marks the active `BuildPhaseRun` failed with reason `operator_reset_after_stall`, records `BuildActivity`, releases the slot if it was held by this build only, and reruns diagnosis.
4. Re-dispatch is governed by the existing phase dispatcher; this recovery does NOT auto-restart the phase — that is a separate operator choice.

## 14. Acceptance Criteria

### 14.1 Diagnostic correctness

- `diagnose_sandbox` distinguishes `running but detached` from `healthy`.
- It reports Docker Compose project, service, working directory, config files, branch, source-currency, runtime target, and slot ownership.
- It returns structured failed checks and recommended actions.

### 14.2 Recovery safety

- `recover_sandbox` can start/restart/rebind/release safe states without asking the user to run commands.
- It refuses destructive reset when dirty build work is present unless structured confirmation is supplied.
- Every recovery writes `ToolExecution` and `BuildActivity`; blocked recovery writes `PlatformIssueReport`.

### 14.3 Build and contribution gates

- `deploy_feature` fails before diff extraction when sandbox readiness is not `healthy`.
- `contribute_to_hive` cannot open a PR from stale source, missing verification, schema regression, or DCO mismatch.
- `contribution-review` cannot produce a green merge-ready status while required GitHub checks are red or pending.
- `createBranchAndPR` creates commits whose author/committer match the signoff identity.

### 14.4 UI and coworker behavior

- Build Studio shows sandbox readiness and recovery blockers without requiring log reading.
- Admin sandbox console exposes governed recovery actions with disabled reasons.
- Coworker never asks the user to run Docker or skip sandbox diff extraction.
- In the `FB-9706671B` failure class, the platform blocks PR creation and records an incident before any GitHub PR is opened.
- Coworker dialog templates from §11.1 are used verbatim (or paraphrased while preserving structure); every reply ends with concrete options, never internal status.
- An automated test asserts that none of the forbidden dialog patterns from §11.1 appear in any sandbox/build prompt source file or in any sandbox/start_build/run_ux_test/evaluate_page tool return message — caught at the string level, not behaviorally.
- Recovery is idempotent across a portal self-upgrade restart (§11.2): replaying the same recovery action does not double-apply.

### 14.5 Stuck build class

- `stuck_mid_phase` correctly classifies the four builds currently wedged (3 at `deps_installed`, 1 at `complete/no-diff`) without requiring DB inspection by the operator.
- `reset_build_phase` clears them through the governed path; no SQL is required.
- The 7-day idle floor for `release_stale_slot` is enforced and surfaced as a disabled-button reason.

## 15. Implementation Slices

1. **Diagnostic foundation.** Add read-only sandbox readiness service and tests.
2. **MCP tool replacement.** Add `diagnose_sandbox`, update legacy sandbox tool text, and route coworker prompts to the new tool.
3. **Recovery actions.** Add `recover_sandbox` for safe actions plus incident recording.
4. **Deploy/contribution gates.** Wire readiness and evidence checks into `deploy_feature`, `contribute_to_hive`, `createBranchAndPR`, and `contribution-review`.
5. **Admin and Build Studio UI.** Add the sandbox control console and Build Studio readiness strip using theme-aware UI.
6. **Incident regression harness.** Add fixtures for detached sandbox, mixed Compose project, stale source, zero-change build, DCO mismatch, and red CI.

## 16. Open Decisions

These decisions should be resolved at implementation start:

1. Should `reset_from_main` be v1, or should v1 stop at `quarantine_runtime_target` and require a later rebuild workflow?
2. Should contribution PR creation create the `FeaturePack` before or after PR creation? This spec recommends after all pre-PR gates pass, but existing code creates it first.
3. Should generated snapshot churn have a generic denylist or be per-task allowlisted through build-plan metadata?
4. Heartbeat budgets in §13.5 are initial values — should they live in `PlatformDevConfig` (operator-tunable) or in code constants for v1?

(The earlier "should we comment on PR #961 from Build Studio?" decision is *not* architectural and belongs to the followup PR that closes the FB-9706671B incident, not this spec.)
