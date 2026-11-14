---
status: active
---

# Delivery engine v2: the process runs in code, agents do bounded work

| | |
|---|---|
| Date | 2026-11-12 |
| Founder direction | 2026-11-12, in session: "human cognitive load → AI cognitive load → code". Approved this direction and the five-part sequence below. Approved removal of Failure Readiness from main's required checks the same day |
| Epic | `EP-DELIVERY-ENGINE-V2` |
| Backlog | E1 `BI-D92BBF23` · E2 `BI-A3D63948` · E3 `BI-31C988D5` · E4 `BI-2E63DEC7` · E5 `BI-8FE563CD` · E6 `BI-721B620D`; absorbed: `BI-D47C5CAC`, `BI-DED8742E`, `BI-4DE79C8D`, `BI-8ED87FD9`, `BI-D217484A`, `BI-6E3CEFB4`, `BI-CF5ECBF6` |
| Supersedes | In [2026-09-03 local-first throughput](2026-09-03-local-first-agentic-delivery-throughput-design.md) (DI-2BC1B7E145C0): (a) "do not create a T3-shaped subsystem"; (b) "cloud CI is the safety net; local machines are the chosen capacity investment". The rest of that spec stands: Workroom as the delivery rail, campaign/slice model, review-tail convergence, outcome scorecard |
| Extends | [2026-10-02 workroom flow map and measurement](2026-10-02-workroom-flow-map-and-measurement-design.md) (scorecard reuses its flow telemetry); [bounded delivery control plane](2026-08-30-bounded-delivery-control-plane-design.md) |
| Verified against | `origin/main` 1bdb8528; live install DB and GitHub, 2026-11-12 |

## 1. The problem, measured

| Signal | Value (2026-11-12) |
|---|---|
| Merges per day | 20–78 in late October; 1–13 from 11-07 to 11-13 |
| Build Studio builds, all time | 476: 1 complete, 4 ship, 320 abandoned, 67 failed |
| Failure Readiness (required since #6843) | 33 PR failures; held PRs that were green on every other check; its own fix (BI-D47C5CAC) open 9 days |
| Blocking machinery on a one-line fix | ~87 preflight guards, 14 `gate:local` gates, 15 Claude PreToolUse hooks, ~12 readiness codes, one shared local-CI slot |
| Agent shell activity, one week | 41,241 Bash calls; ~2,000 `sleep`/`until` polling loops; ~3,500 inline `python3` scripts |
| Background inference, 14 days | ~16k `analysis` calls with no agent id and no cost; 862 anthropic-sub and 671 codex rate limits; local model averaged 80 s and went 0/20 on coding dispatches |
| Review loop | 33 builds finalized ~230 times each in a week, all `gauntlet-not-run` (fixed by BI-E3C5C7E4, PR #7004) |
| Decision kernels, 30 days | `principle_decide` 280 calls, WSID 6, WWWD 3, against `get_backlog_item` 27,672 |

## 2. Root causes

1. **Gates only ratchet up.** "Learnings → code + AGENTS.md" turns every incident into a new guard. No gate has a measured catch rate, capacity budget, or retirement date, so friction accumulates and produces the next incident.
2. **Serial AI gates multiply failure.** Ten 90%-reliable gates in series pass a change ~35% of the time. Specialist reviews added as more serial gates lower throughput even when each is individually sound.
3. **The agent runs the process.** Claims, leases, heartbeats, git, attestations, evidence, PR, merge and polling are done by an LLM reading rules. `pnpm land` already chains this in code, but it is optional and AGENTS.md did not name it.
4. **Decisions are routed by the client.** WWMD/WWWD/WSID are consulted only when an agent chooses to; prose questions bypass the hook; client permission posture is not set by the platform.
5. **Doctrine is never compacted.** 1,088 specs and 1,208 plans; 3 marked superseded, 567 with no status. Contradictory decisions coexist (this spec's supersession list is one example), so retrieval returns conflicting prose and choices fall to the owner.

## 3. Design

### 3.1 The workroom is an engine; agents are workers (E1, E4)

The portal runs each workroom as a state machine in code: provision worktree → start an official coding client (Claude Code or Codex, under the owner's subscription) with one bounded task and its acceptance test → on completion run `pnpm land` (gates, push, PR, auto-merge) → follow the PR to merge → close out. The engine renews the lease while a step runs. Agents never hold leases, run git plumbing, record gate evidence, or poll.

Adopted from T3 Code: drive native clients per worktree and orchestrate only. Rejected: a second backlog or session store; the Workroom, TaskRun and evidence records remain the single substrate.

### 3.2 Two lanes sized to the change (E2)

| Lane | Applies to | Requires before merge |
|---|---|---|
| Fast | break-fix, small, and slices of an approved epic | deterministic gates + cloud CI + one combined AI review scored against a bar |
| Design | new capability, once per epic | research (internal and industry), specialist design input, one approved design; then its slices use the fast lane |

Research, design-spec, spec-approval, plan and plan-review readiness codes apply at the epic, not to each fix.

### 3.3 Specialists in parallel, triggered, advisory by default (E2)

The combined review includes a UX section when the diff touches a route or component (using the vector design tools), a data section when it touches schema or migrations, an architecture section when it crosses package boundaries. One pass, one verdict. Only production-integrity surfaces block: data and migrations, install/upgrade convergence, security guards. These run as server-side CI, never as a status published from a local machine.

### 3.4 Cloud CI is the gate of record (E3)

GitHub Actions and the merge queue (5 concurrent groups) are primary. The single local-integration-ci slot is reserved for runtime-bound changes (migrations, compose, install/upgrade, portal runtime). Docs, skill-pack, contract and unit-tested library changes push after `gate:local`.

### 3.5 Decisions and permissions are platform-enforced (E4, E6)

- Clients run sandboxed with bypass permissions, set by the toolchain updater at the user layer. Authority stays server-side: branch protection, MCP grants, production-integrity checks.
- Any agent question goes to `principle_decide` (or WWWD/WSID by scope) first. The owner sees only questions with no applicable decision, batched into a daily digest.
- Coding uses subscriptions through native clients. Background analysis uses API keys with a hard daily budget. Every routed call records agent and cost. The local model is for restricted data only, with its real concurrency and latency in its profile.

### 3.6 Gate contract and throughput scorecard (E5)

Every blocking gate, guard and hook carries: owner, capacity against real volume, catch count, a failure mode that queues work rather than deadlocking it, and a review date. A gate with zero catches in 30 days is removed or made advisory. Removing or demoting a gate is a valid fix (extends BI-CF5ECBF6).

Scorecard: merged PRs per day, task-to-merge lead time, first-pass green rate, cost per merged PR, owner interruptions per day. New platform capability waits while lead time misses its target.

## 4. Design documents and prose at scale (E6)

The spec corpus is not lost: `search_specs_and_plans` indexes it and is called ~770 times a month. It is unreconciled. Prose at scale only produces decisions if retrieval returns one current answer, so:

- **Decision register.** One row per live decision: scope (WWMD/WWWD/WSID), statement, source spec or DI, what it supersedes. Compiled from `binding` and `active` specs and DI records. The kernels read the register first and fall back to prose search.
- **Supersession sweep.** When a decision is recorded, specs it contradicts are marked `superseded` with a pointer. Specs with no status are classified once.
- **New specs are addenda by default.** A spec that changes a prior decision must name it in a Supersedes row, as this one does.

## 5. Sequence

1. **E1 One landing path.** AGENTS.md and the branch runbook name `pnpm land` (done in this branch); then the engine calls it and renews leases; pregate accepts land's non-TTY invocation.
2. **E2 Combined triggered review**, absorbing BI-D47C5CAC and BI-DED8742E; restore blocking only for production-integrity diffs.
3. **E3 Cloud CI primary**, absorbing BI-6E3CEFB4.
4. **E4 Native clients, sandbox + bypass, question routing, budgeted background inference**, absorbing BI-4DE79C8D.
5. **E5 Gate contract audit and scorecard**, absorbing BI-8ED87FD9 and BI-D217484A.
6. **E6 Decision register and supersession sweep.**

E1–E3 are independent. E4 depends on E1. E5 can start any time; its audit informs E2.

## 6. Acceptance

- Lead time from task start to merge for a fast-lane change: under 1 hour median.
- Merged PRs per day back above the late-October range, with first-pass green above 70%.
- Owner permission prompts and routine decision questions: near zero per day; digest items only.
- No unattributed routed inference; background spend under its daily budget.
- No blocking gate without the §3.6 contract.

## 7. Risks

- **Less blocking review could let a defect through.** Mitigation: production-integrity surfaces still block; review is still run on every PR; catch rates make gaps visible.
- **Bypass in a sandbox widens what a client can do locally.** Mitigation: OS sandbox limits on filesystem and network; server-side authority unchanged; destructive git forms stay on ask.
- **Subscription terms.** Native clients are used as their vendors intend; background automation moves to API keys.

## 8. E2 implementation amendment: combined review and qualified cloud evidence

**Status:** proposed design, not implementation admission or a production policy change.
**Carrier:** BI-A3D63948, Large, WC-557937A2, branch `codex/combined-review-evidence`.
**Source inspected:** fc59dc8e6b6937a0cf019836b6f68f6b755aa595; initial executable characterization at 89b09949eb0fb44d67e0070213364f2b29f1ad72 is recorded as cmwgqdra41j4q0eqqvb7hlh2j. Funding ownership remains unresolved; no paid assessment or budget change is authorized by this amendment.

### 8.1 Observed contract drift and scope

PR7105's four quota verification script paths have no runtime-bound surface according to `runtimeBoundFiles` and receive `evaluateLocalCiAdmission`'s cloud-primary exemption. `pr-health.isDocsOnlyFileSet` returns false for the same paths. Separately, `apps/web/lib/change-review/failure-analysis-evidence.ts` resolves only `local_integration_ci` records; external workrooms need a governed lease or the documentation lane. Successful protected cloud verification therefore does not supply the evidence this resolver requires. These are distinct classifier and evidence-contract gaps, not a failed product test or an outage caused by an occupied queue.

E3/BI-31C988D5 and its landing follow-up BI-087B42D5 remain delivered history. BI-E4E9BD73 explicitly preserves external workroom behavior and does not cover the missing cloud lane. This amendment retains all of E2: one combined, triggered review, an explicit score/bar, appropriate specialist perspectives, production-integrity-only blocking, server-side enforcement, and epic-level design prerequisites for fix-lane work. It is not a small exemption for one PR. Existing queued gate98688, original review identities and historical unknown outcomes remain untouched.

### 8.2 Objectives and acceptance baseline

**OBJ-E2-1:** Every current immutable PR change receives one combined review obligation, with bounded specialist contributions selected by actual affected surfaces.
**OBJ-E2-2:** Verification and publication use one current source-classification contract and evidence from the permitted execution lane.
**OBJ-E2-3:** Production-integrity requirements remain enforced by trusted server-side CI; unavailable evidence is never a fabricated pass.
**OBJ-E2-4:** Break-fix delivery reuses the approved epic's research/design/plan boundaries without serially repeating them for each fix.

| Acceptance | Objective | Observable requirement |
|---|---|---|
| AC-E2-1 | OBJ-E2-1 | One immutable review identity yields one combined result. UX, data and architecture sections are included only when their affected-surface predicates apply; unknown classification requests resolution rather than silently omitting review. |
| AC-E2-2 | OBJ-E2-1 | The combined result exposes a versioned rubric, per-applicable-section score, pass bar and accountable findings. Malformed or incomplete reviewer output is explicitly unverified; it cannot become a positive verdict. |
| AC-E2-3 | OBJ-E2-2 | Landing, PR health and server evidence resolution agree on the same file inventory, classification version and required verification lane, including the four-file7105 regression. |
| AC-E2-4 | OBJ-E2-2 | A trusted cloud run for the exact source can resolve evidence within its owning workroom. Foreign repository/workroom, stale head, wrong merge parent, untrusted workflow, failed or missing required job, expired or mismatched artifact, and revoked authority fail closed. |
| AC-E2-5 | OBJ-E2-3 | Data, migrations, install/upgrade convergence and security changes retain blocking checks in server-side CI. Other review findings are advisory under the approved E2 policy; unavailable review is visibly unrun, never approved. Existing repository protection is unchanged until normal rollout qualifies the replacement. |
| AC-E2-6 | OBJ-E2-4 | A fix covered by the current approved epic does not repeat epic research/design/plan gates; changed scope or production-integrity requirements still obtain their applicable admission. |
| AC-E2-7 | OBJ-E2-1 | Restart, duplicate notification, provider failure and interrupted review reuse the existing TaskRun/review identity and bounded recovery; no new assessment is created to escape an unknown execution. |
| AC-E2-8 | OBJ-E2-3 | Served end-to-end evidence covers an ordinary change and each production-integrity class, including rejected tampering and an unavailable provider. Source tests alone do not establish rollout acceptance. |

### 8.3 Contracts and reuse

**CT-E2-CLASSIFICATION:** Reuse `scripts/derived-artifacts-gate.mjs` and the existing convergence/data classifiers as the source of verification-lane policy. PR health must consume the same decision instead of inventing a second docs-only test. Runtime verification need and review-blocking sensitivity are separate fields: a cloud-primary decision cannot by itself waive a security or migration review. Unknown classifiers and stale derived artifacts retain their existing conservative result.

**CT-E2-CLOUD-EVIDENCE:** Extend the existing external evidence store and provider-backed workflow readers, not author-supplied prose or a new receipt database. A server-owned importer must authenticate current workroom access and repository provider authority, fetch the provider run and artifacts, and bind repository, workflow identity and trusted workflow revision, event, run ID/attempt, source head/tree/diff, completion time, required job inventory and artifact digest. PR-head runs bind the exact head; merge-group runs additionally bind the immutable group commit, actual parents and verified membership of the source PR. A later main success is not evidence for an arbitrary earlier head. Missing, cancelled, skipped-required, failed, superseded, oversized or unverifiable artifacts remain unavailable. Recheck source, provenance, authority and freshness at review dispatch and publication. Retain the cloud execution kind: never label it local integration or invent a lease.

**CT-E2-REVIEW:** Extend existing semantic review identity, schema, parser and recovery. The versioned rubric must be independently agreed before implementation; no arbitrary numeric bar is introduced by this draft. Relevant professional experts retain their own bounded tools and corpus retrieval. The combined result assembles their applicable conclusions and citations without loading every profession's corpus into one prompt. Architecture participates when package/interface boundaries require it. Failure of a required contribution stays explicit. Publication policy distinguishes advisory findings from production-integrity blockers; failed or missing evidence never masquerades as an approved review.

**CT-E2-ROLLOUT:** Reconcile the older local-lane-only wording in `docs/architecture/failure-analysis-and-recovery.md` and PR-health documentation with sections3.3–3.4. Publish and qualify the server evidence producer, consumer and CI policy before changing protection. Existing exception/grant mechanisms are not repurposed. No schema migration is proposed until existing evidence records are proven insufficient. Readers preserve old evidence kinds; new kinds are versioned and rejected by older consumers. Roll back through a protected revert that restores conservative admission, retaining all evidence and original tasks.

### 8.4 Ordered delivery and verification

1. **FLOW-E2-DESIGN:** Obtain ordinary research, independent design/architecture and scope-baseline admission for this full Large item. Resolve funding ownership before paid work. Compare the existing shared-change-reviewer design and E2's absorbed items; enumerate current provider readers and reviewer/parser contracts. Agree the rubric and measurable bar. **VERIFY-E2-DESIGN:** independently checked baseline maps every AC above and original E2 outcome; unresolved doctrine is recorded, not silently combined.
2. **FLOW-E2-PLAN:** Produce immutable implementation coverage with source paths, impact obligations and explicit delivery boundaries. Independently shippable pieces require live existing/new BI coverage under the normal decomposition contract; the parent cannot close on classifier-only work. **VERIFY-E2-PLAN:** valid server coverage and plan/architecture admission before implementation.
3. **FLOW-E2-EVIDENCE:** Reproduce classifier disagreement and evidence rejection, then implement shared classification and authenticated cloud evidence resolution using existing stores. **VERIFY-E2-EVIDENCE:** positive exact-head and merge-group cases plus every rejection in AC-E2-4, race between import and publication, artifact retrieval failure, and existing local/documentation/Build Studio regressions.
4. **FLOW-E2-REVIEW:** Implement the combined rubric/triggered contributions, epic-level fix admission and proportional server-CI publication. **VERIFY-E2-REVIEW:** malformed output, missing applicable section, duplicate/restart/provider interruption, advisory versus blocking surfaces, changed baseline and unknown-execution controls.
5. **FLOW-E2-RELEASE:** Affected tests/typechecks, independent exact-source review, normal `pnpm land`, protected merge and canonical release. **VERIFY-E2-LIVE:** actual served workflow for ordinary and sensitive changes; original7105 can consume only evidence genuinely valid for its still-current identity. No old task replay or cancellation is part of this amendment.

The steps are proposed sequencing, not a coverage receipt. No implementation, score approval, independent review, paid allocation, repository-protection change or passing runtime result is claimed by this document.
