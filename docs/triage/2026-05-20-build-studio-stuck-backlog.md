# Build Studio backlog triage — 2026-05-20

Driving review of 13 in-flight FeatureBuilds. Snapshot taken after portal restart at 04:27 UTC.

## TL;DR

- **13 FeatureBuilds** in DB. **Every one** has a WorkCapsule in `working` status, but **none of the capsules have heartbeats or activity records** — they are zombies.
- **5 FBs have already shipped on main** under different PR branches; their BS state is orphaned.
- **4 FBs (COST P1 cluster)** sit in `plan` phase with no sandbox — plan-review gate hasn't run.
- **2 FBs** have sandboxes + `build` phase but no executor claim (no `claimedByAgentId`).
- **1 FB (Ollama)** is in `build` phase with **no WorkCapsule at all**.
- **1 FB (TopologyGraph)** is correctly `complete` with verif+accept evidence.

## State table

| Build | Phase | Title | Capsule | has verif | has accept | sandbox | Maps to shipped PR? |
|-------|-------|-------|---------|-----------|------------|---------|---------------------|
| FB-AD454C98 | build | Extend DPF Edge Node SNMP | WC-2A6E36D2 working | n | n | y | — open work |
| FB-7A21E1F6 | build | Portal self-upgrade | WC-86B47B0E working | n | n | y | **PR #830 MERGED** |
| FB-F50C65D2 | complete | TopologyGraph wire | WC-A52F24B6 working | y | y | y | **PR #820 MERGED** ✅ |
| FB-F0476EF3 | plan | AdapterResult.usage cache fields (P1-01) | WC-BA0D39C2 working | n | n | n | spec only (PR #807) |
| FB-A8D46002 | plan | Prometheus cache counters (P1-03) | WC-D0068F89 working | n | n | n | spec only |
| FB-5222FED1 | plan | AgentBudgetEvent table (P1-04) | WC-8E7D69AF working | y | n | n | spec only |
| FB-DDCB33C4 | plan | cacheCreationInputTokens (P1-02) | WC-D518017E working | n | n | n | spec only |
| FB-C26D5B50 | ideate | WWMD MCP Sprint 1 | WC-D5E4DF43 working | n | n | n | spec PR #813, UX hotfix PR #819 |
| FB-3320BCC3 | ideate | BS Phase Stall Detection | WC-CB2F510F working | n | n | n | **PR #828 + #812 MERGED** |
| FB-63E4F3CE | ideate | Persona Voice Layer TTS | WC-64B155DE working | n | n | n | spec/plan PR #791, #798 |
| FB-1A465165 | ideate | Verify BI-6588414f slices 1+2 fix | WC-3EA9D604 working | n | n | n | **PR #815 MERGED** |
| FB-FB8B2EAA | ideate | Portal hang scout-dispatch | WC-BE178C8C working | n | n | n | **PR #815 MERGED (same root)** |
| FB-71FB3A53 | build | Ollama primary local AI | **NONE** | n | n | y | — open work, **no capsule** |

## Category A — orphaned, already shipped (5)

Code is on main; BS phase is stale. Cannot advance via `/api/agent/build/advance-phase` because `verificationOut`/`acceptanceMet` are empty — the gate requires evidence that was never recorded inside BS.

- **FB-7A21E1F6** Portal self-upgrade → shipped PR #830
- **FB-3320BCC3** Build Studio Stall Detection → shipped PR #828
- **FB-1A465165** Live verification BI-6588414f → shipped PR #815
- **FB-FB8B2EAA** Portal hang from scout-dispatch → covered by PR #815
- **FB-F50C65D2** TopologyGraph wire → shipped PR #820, phase=complete (correct)

**Blocker:** No "mark shipped externally" UX. Need either:
1. Auto-detect when work shipped via a different branch/PR (canonical backlog item id match)
2. Admin override to record external verification + close

## Category B — in-progress, sandbox + build phase, no executor (2)

Sandbox exists, branch exists, but no `claimedByAgentId` and no capsule activity. Executor never picked these up.

- **FB-AD454C98** Extend DPF Edge Node SNMP — branch `build/FB-AD454C98`, capsule WC-2A6E36D2 idle
- **FB-7A21E1F6** Portal self-upgrade — also in this state (the upstream shipped via different path)

**Blocker:** Build dispatch is not draining the work queue. WorkCapsules sit in `working` forever. Needs the dispatch worker to claim+execute.

## Category C — plan phase, no sandbox (4) — COST P1 cluster

Plan exists, plan-review hasn't run, no sandbox provisioned.

- FB-F0476EF3 BI-COST-P1-01 AdapterResult.usage cache fields
- FB-DDCB33C4 BI-COST-P1-02 cacheCreationInputTokens
- FB-A8D46002 BI-COST-P1-03 Prometheus cache counters + ToolExecution inference cost
- FB-5222FED1 BI-COST-P1-04 AgentBudgetEvent table (has verif=true — partially done?)

**Blocker:** Plan review deliberation needs to run and approve before plan→build. The COST cluster appears to have stale deliberation runs from yesterday (active+no heartbeat).

## Category D — ideate phase, work not started (2)

- FB-C26D5B50 WWMD MCP Sprint 1 — Mark drove UX fixes manually (#819); main implementation pending
- FB-63E4F3CE Persona Voice Layer — plan merged (#798); not yet promoted to build

## Category E — build phase, no capsule (1)

- **FB-71FB3A53** Ollama primary local AI — has sandbox + branch but **no WorkCapsule row**. Pre-capsule era? Or capsule was deleted?

## Systemic blockers identified

1. **Zombie WorkCapsules** — Every capsule is `working` with NULL heartbeats. The capsule lifecycle has no timeout / no executor claiming them.
2. **Stale Deliberation runs** — Every deliberation row is `active` with NULL heartbeats. Same root.
3. **Server Action ID drift on portal restart** — Clicking UI buttons after portal recompile throws `Failed to find Server Action` because the page has stale action hashes. Affects every BS button click after a restart.
4. **No "shipped externally" reconciliation** — When work merges to main via a non-BS branch, BS state has no path to close cleanly.
5. **Build dispatch worker** — Capsules created in `working` status never get an executor. The dispatch loop appears non-running or not draining.

## Concurrent activity

PR #832 (fix: allow advance to Plan when BusinessBuildBrief is absent) merged at 04:20 UTC, ~7 min before this triage started — another session is also working in this surface. **Sweep main before pushing any PRs from this session.**

## Actions attempted this session

1. **FB-7A21E1F6** "Run Verification Review" — first click triggered server-action 404 (stale post-restart bundle). Hard-reload caused chrome host-permission drop. Phase gate would have failed anyway (no `verificationOut`/`acceptanceMet`).
2. **FB-71FB3A53** "Resume Implementation" — button went to pending state ("Reopening implementation…") then portal restarted mid-flow (PR #832 merged on main → bundle hash changed → self-upgrade detected → portal-init re-ran). After portal came back, retried — same pending state, no WorkCapsule created, no executor claim. Action appears to be no-oping for builds without existing capsule + no diffPatch.
3. **Portal+postgres recreated 3 times** during this session — each time triggered by a new bundle landing on main (PR #832 was the proximate cause of one cycle). The self-upgrade feature (FB-7A21E1F6 / PR #830) detects bundle changes and bootstraps a fresh source volume, which functionally restarts the portal.
4. Switched to DB-direct triage to enumerate state without depending on UI.

### Root cause of UX-driving instability

**The self-upgrade feature itself is the blocker for driving the rest of the backlog through UX.** Every time a sibling Claude session merges a PR to main, the bundle hash changes; portal-init detects "Platform update detected: dev -> &lt;newhash&gt;" and recycles the runtime. Any in-flight server action or executor work is dropped on the floor mid-flow.

The banner "Platform update vXXX is ready. Your customisations are preserved. Review in Admin → Platform Development" implies the update is staged and not auto-applied. In practice the portal IS restarting on each detection. Either:
- the detection step alone is heavyweight enough to cause restart (the `[5/5] Bootstrapping source volume` step is taking minutes), or
- there's an auto-apply path that the banner copy doesn't reflect.

Either way, this needs to be tamed before any meaningful UX-driven BS work can be done in a session that overlaps with other PR activity.

## Proposed end-of-session work for next agent / next pass

1. **Build a "shipped externally" reconciliation** (now a known need — was done by hand here) — match `originatingBacklogItemId` against merged PRs and auto-close.
2. **Capsule heartbeat/timeout** — capsules in `working` >X minutes without heartbeat should auto-stall.
3. **Fix the dispatch worker** so new capsules get claimed.
4. **Add an admin "mark complete with external evidence (PR link)" action** in BS UI to clear category A.
5. **Throttle self-upgrade detection** so it doesn't recycle the portal on every PR-to-main during active sessions.

## FB-7F8C7368 — meta BI filed through UX (2026-05-20 ~05:00 UTC)

Filed via Build Studio "Describe a new feature → New" intake. Title: **"Build Studio sync with externally-developed work + per-deliverable assignment/ownership"**. Scope: (1) reconcile externally-shipped features; (2) single-owner lease semantics for active BI/FB to prevent concurrent thread overlap.

Drove through 5 design refinement cycles via "Refine the design" + targeted reviewer-feedback messages. Cycle outcomes:

| Cycle | designDoc size | Review verdict |
|-------|----------------|----------------|
| 1 | 6386 | needs-more-evidence — 3 critical (auth, regex matching, evidence shape) |
| 2 | 14189 | consensus — 4 critical (claim race, perms scope, transition skip, input validation) |
| 3 | (in-flight) | no-consensus — 2 critical (BI premature closure, author/merger inconsistency) + 5 important |
| 4 | 20223 | consensus — 2 critical (idempotency schema shape) + 5 important |
| 5 | (in-flight, SE stalled w/ 5 heartbeat timeouts) | — |

After cycle 4 the SE explicitly summarized: *"Core two-capability design is sound, the build plan can resolve remaining schema-refinement concerns without rearchitecting. Should we move to Plan?"* I approved and asked for the four documented residual fixes (separate FeatureBuildExternalSync table, single trusted-collaborators policy, composite cursor, superuser force-release) — SE stalled mid-revision (heartbeat timeouts, then another portal restart from a concurrent PR merge).

**Blockers discovered during this drive:**

1. **Reviewer infinite-loop tendency.** Each cycle finds *different* "important" issues. There is no clean convergence path when the design surface is large.
2. **`draftApprovedAt` gate is hard.** Even when the SE verbally confirms the design is good enough, the ideate→plan transition requires `draftApprovedAt` IS NOT NULL plus a passing `reviewDesignDoc`. There's no "operator override" path.
3. **Coworker context bleeds across FBs on long sessions.** After 5 cycles, the SE's last response was about edge-node files (FB-AD454C98), not the current build.
4. **Self-upgrade restart cycles kill SE mid-tool-call.** Tool calls (`saveBuildEvidence`, `reviewDesignDoc`) take long enough that the portal can restart while one is in flight, and the SE never recovers cleanly.

**Net of this drive:** the BI is filed and visible in the backlog. Design is 20k+ chars with substantive content. But it cannot reach `plan` through the existing UX without either (a) build-plan-level operator override, or (b) the systemic blockers being fixed first (which is exactly what this BI is partially about).

## Cleanup pass performed 2026-05-20 ~04:40 UTC

After operator approval ("ok, so clean up what you can"):

### Zombie TaskRuns

- Cancelled **80** deliberation TaskRuns that were `active` with NULL `lastHeartbeatAt` and `updatedAt` >2h old. Now `failed` with `completedAt=NOW()`. Span: 2026-05-17 → 2026-05-20.

### Category A — reconciled to `complete` with synthetic shipped-externally evidence

| Build | Now | Evidence recorded |
|-------|-----|-------------------|
| FB-7A21E1F6 | `complete` | PR #830 commit `43e7faef` |
| FB-3320BCC3 | `complete` | PR #828 commit `f1164274` (+ spec PR #812) |
| FB-1A465165 | `complete` | PR #815 commit `05bc1a7a` |
| FB-FB8B2EAA | `complete` | PR #815 commit `05bc1a7a` (covered by root fix) |
| FB-F50C65D2 | already `complete` | (was healthy; capsule status corrected) |

`verificationOut` and `acceptanceMet` populated on each. Associated WorkCapsules moved from `working` to `completed`. BI-CAPSULE-SELFUPGRADE-001 closed `done`.

### Local artifact

Removed stray `dev/null/` directory (git-lfs hook templates from a literal `/dev/null` redirect on Windows).

### Remaining FBs after cleanup (8 active)

| Build | Phase | Notes |
|-------|-------|-------|
| FB-71FB3A53 | build | Ollama — 7/9 tasks, no capsule, hit usage-limit. **Real work** |
| FB-AD454C98 | build | Edge Node SNMP — has sandbox + branch, executor never claimed. **Real work** |
| FB-F0476EF3 | plan | COST-P1-01 AdapterResult.usage cache fields. **Real work** |
| FB-A8D46002 | plan | COST-P1-03 Prometheus cache counters. **Real work** |
| FB-5222FED1 | plan | COST-P1-04 AgentBudgetEvent table. **Real work** (partial — has verif) |
| FB-DDCB33C4 | plan | COST-P1-02 cacheCreationInputTokens. **Real work** |
| FB-C26D5B50 | ideate | WWMD MCP Sprint 1 umbrella. **Real work** |
| FB-63E4F3CE | ideate | Persona Voice Layer & WWTD TTS. **Real work** |
