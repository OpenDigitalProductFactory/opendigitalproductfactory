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
