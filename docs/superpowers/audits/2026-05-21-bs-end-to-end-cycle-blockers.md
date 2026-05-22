# Build Studio End-to-End Cycle Blockers — Investigation & Integrated Fix Program

| Field | Value |
|-------|-------|
| **Author** | Claude (session in worktree `pensive-fermi-6a5560`) |
| **Date** | 2026-05-21 |
| **Trigger** | Operator: *"We haven't been able to get through this process once cleanly in 3 months now. Fix it right."* |
| **Worktree** | `D:\DPF\.claude\worktrees\pensive-fermi-6a5560` |
| **Portal** | `http://localhost:3000` (per [project_portal_address.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_portal_address.md)) |
| **Motivating session goal** | File one Business Idea → Triage → Promote → Ideate → Plan → Build → Verify → Ship, in a single operator session, without manual SQL or terminal intervention |
| **Outcome of attempt** | Failed at *Triage*. Five independent blockers stacked. Three months of similar attempts confirm a meta-pattern, not a one-off. |
| **Document purpose** | Stop the pattern. This audit is the single source of truth for the integrated fix program that replaces the historical "file one BI per blocker, race them through, hit a new blocker each time" cycle. |

---

## 1. Executive summary

**The pattern.** Every attempt to drive a single Business Idea cleanly from filing through ship hits a *new* blocker. Each blocker, in isolation, looks fixable in a normal BS cycle. But each blocker is itself produced by *the same underlying anti-pattern*: silent failure with no operator-visible recovery surface.

This session attempted the cycle one more time, motivated by PR #957 (contribution PR failed CI with 5 of 6 failures cascading from stale sandbox + 1 DCO failure on a GitHub-UI merge commit). The cycle failed at *Triage* after surfacing five blockers, four of which are net-new to the documented list.

**The five blockers from this session, in order encountered:**

| # | Blocker | Class | Already known? |
|---|---------|-------|----------------|
| 1 | PR contribution has no post-merge recovery surface (the original motivator) | Outbound boundary | Yes — partially covered by FB-3CA106CC (sandbox baseline refresh) and FB-9709981A (overlap sweep). Post-PR recovery slice is net-new. |
| 2 | 26 of 29 coworkers lack `backlog_triage`/`build_promote` grants. Scrum Master included. | Grant seeding | Pattern known ([project_agent_grant_seeding_gap.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_agent_grant_seeding_gap.md)); same regression, different tools. |
| 3 | Grant-denied tool calls are silently skipped; the LLM hallucinates "I've submitted/queued" prose | Agent loop | **Net-new finding.** Enables all silent-failure cascades. |
| 4 | No per-agent grant editor UX. Authority Matrix at `/platform/audit/authority` is read-only. | Missing UX | **Net-new finding.** Forces SQL bypass for any grant correction. |
| 5 | Self-upgrade restart mid-session invalidates server actions; concurrent sessions corrupt each other's coworker chats | Portal lifecycle | Pattern known ([project_self_upgrade_kills_in_session_ux.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_self_upgrade_kills_in_session_ux.md)). Now compounded by concurrent-session chat collision. |

**The meta-pattern.** Every blocker is an instance of *silent-failure cascade*. Each layer hides errors instead of surfacing them, the LLM-driven coworker fabricates plausible success prose over the silence, and the operator believes work is progressing until a downstream DB query proves otherwise. This is the same architectural failure mode that [project_hive_contribution_gaps.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_hive_contribution_gaps.md) fixed for `contribute_to_hive` in PR #137 — but applied per-tool rather than at the agent-loop level.

**The integrated fix.** One coordinated program — *not* five racing BIs — that addresses the silent-failure cascade architecturally. Detailed in §5. Acceptance criteria in §6.

---

## 2. Methodology

| Step | Tool / surface used |
|------|---------------------|
| Reproduce the original goal | Live portal at `http://localhost:3000`, coworker chat, DB queries |
| Confirm tool surface exists | [`apps/web/lib/mcp-tools.ts`](../../../apps/web/lib/mcp-tools.ts) lines 388–478 (`triage_backlog_item`, `promote_to_build_studio`, `update_backlog_item`) |
| Compare claimed vs actual tool calls | `select * from "ToolExecution" where ... order by "createdAt" desc` — last 40 minutes |
| Confirm grant gap | `select * from "AgentToolGrant" where "agentId"=<Scrum Master cuid>` |
| Survey blast radius | Cross-join `Agent × AgentToolGrant` filtered to `grantKey in ('backlog_triage','build_promote')` |
| Confirm missing UX | Visited `/platform/audit/authority` — confirmed read-only |
| Confirm self-upgrade impact | `docker logs dpf-portal-1 --tail 30` — observed repeated `Failed to find Server Action "4068de8c..."` |
| Confirm overlap with existing FBs | `select * from "FeatureBuild" order by "createdAt" desc` and read brief descriptions |

All evidence below is reproducible from this session's DB state at the timestamps cited.

---

## 3. Findings with evidence

### Finding 1 — Original motivator: PR contribution has no post-merge recovery surface

**Observation.** PR [#957](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/pull/957) was opened by Build Studio at 2026-05-22 02:58 UTC. It accumulated 6 failing checks: Schema regression guard, Typecheck, Production Build, Unit Tests, Routing Invariants Audit, DCO. The portal's [`Community Sharing`](../../../apps/web/components/build/) card in the Release Decisions panel shows the PR as "Shared upstream" and does not surface or react to the CI failures.

**Risk.** Non-technical operators cannot recover. The recovery path requires reading GitHub Actions logs, rebasing, signing commits, and force-pushing — all CLI work explicitly excluded from the operator profile. This violates [`never-ask-user-to-run-commands`](../founder-kernel/wiki/principles/never-ask-user-to-run-commands.md) at the most exposed surface DPF has.

**Fix scope.** Three slices documented in BI `cmpgcjic20a4001mq1b9axda1` (current title: "Build Studio self-recovery for contribution PRs"). After this audit's overlap discovery, only slices 2+3 remain in scope; slice 1 is delegated to FB-3CA106CC:

- **Slice A — PR Health Watcher (background)**: polls `FeaturePack.prUrl` `statusCheckRollup`, classifies failures into `{dco_missing, sandbox_stale, schema_regression, typecheck, unit_test, production_build, lint, unknown}`, writes to a new `FeaturePack.ciHealth` jsonb field.
- **Slice B — Release Decisions recovery actions (UI)**: per-class one-click recovery on the Community Sharing card. `dco_missing` → coworker rebases+force-pushes with signoffs; `typecheck/unit_test/production_build/lint` → auto-dispatched repair build with CI log as brief; `sandbox_stale/schema_regression` → sandbox rebuild + reship.

**Existing substrate to reuse.** `pre-pr-gates.ts`, `contribution-review.ts`, `sandbox-source-currency.ts`, `build-orchestrator.ts`. No new orchestration framework needed.

### Finding 2 — 26 of 29 coworkers lack backlog_triage/build_promote grants

**Observation.**

```sql
select a.id, a.name,
       count(g.id) filter (where g."grantKey"='backlog_triage') as has_triage,
       count(g.id) filter (where g."grantKey"='build_promote') as has_promote
from "Agent" a
left join "AgentToolGrant" g on g."agentId"=a.id
group by a.id, a.name
order by a.name;
```

Only three agents return `1/1`: `coo-orchestrator`, `explore-orchestrator`, `integrate-orchestrator`. Every named-for-backlog-work coworker returns `0/0`, including:

- Scrum Master (`cmp9a90bo084u73mwt6ln4z5b`) — *the* coworker positioned for backlog triage/promote
- ops-coordinator (`cmp9a907u082l73mwu3awyq2c`) — successfully called `create_backlog_item` but cannot triage or promote
- product-backlog-specialist
- product-backlog-prioritization-agent
- portfolio-backlog-agent

**Wire evidence.** Across the 40-minute window of this session, `ToolExecution` records show:
- 1 × `create_backlog_item` by `ops-coordinator` (the initial filing)
- 1 × `update_backlog_item_status` (status-only, by an `unknown` agent via `external-jsonrpc`)
- **0 × `triage_backlog_item`**
- **0 × `promote_to_build_studio`**
- **0 × `update_backlog_item`**

…despite Scrum Master verbally claiming 4+ triage/promote actions over the same window.

**Pattern.** This is [project_agent_grant_seeding_gap.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_agent_grant_seeding_gap.md) (PR #137 era) regressed. The invariant guard from that fix evidently does not cover these grant keys for these named agents.

**Cross-reference to existing audit.** [`2026-04-27-coworker-tool-grant-audit.md`](./2026-04-27-coworker-tool-grant-audit.md) catalogues 73 aspirational grants. The inverse problem — *named-for-X agents missing the grants for X* — is not represented there. The audit framework needs the symmetric check.

### Finding 3 — Agent loop silently skips grant-denied calls (NET-NEW)

**Observation.** When a coworker's LLM emits a tool call for a tool the agent lacks the grant for, the dispatch layer denies the call but does not return a tool result the LLM is required to surface. The LLM, having "emitted" the call and seen no error in its own context, plausibly generates "I've submitted/queued" prose in the next assistant turn. The operator sees confident success prose with no DB write behind it.

**Why this is the load-bearing bug.** Every silent-failure cascade documented in memory traces back here:
- `contribute_to_hive` returning `success:true / prUrl:null` ([project_hive_contribution_gaps.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_hive_contribution_gaps.md))
- Proposal-mode tools stalling autonomous runs without `autoApproveWhen` ([project_proposal_trap_silent_failure.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_proposal_trap_silent_failure.md))
- Coworker grant-denial hallucination (this finding)
- "Three silent-skip failures" in seed ([project_silent_seed_skips_audit.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_silent_seed_skips_audit.md))

Each was patched per-tool. The class itself was never closed.

**Fix shape.** Agent loop must guarantee one of two outcomes for every tool call the LLM emits:
1. The tool actually runs, and its real return value enters the message stream the LLM sees on its next turn.
2. The dispatch is refused, and a `tool_result` with a typed error (`{ kind: "grant_denied", grant: "backlog_triage", agent: "Scrum Master" }`) enters the message stream — which the LLM is *required* to relay to the operator before issuing any prose about the operation.

Currently neither is guaranteed.

### Finding 4 — No per-agent grant editor UX (NET-NEW)

**Observation.** `/platform/audit/authority` renders an Authority Matrix showing per-agent grant counts. Rows are clickable to reveal specific grants. There is no UI control to *add* a grant.

**Risk.** Per [`feedback_dont_bypass_ux_with_sql.md`](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_dont_bypass_ux_with_sql.md), missing UX must remain visible as dogfooding signal — operators are not authorized to bypass with SQL. This means any grant correction today requires either a seed patch + portal restart, or unauthorized SQL. Neither is in the non-technical operator's path.

**Composite effect with Finding 2.** Grant gaps cannot be observed by operators (no surfaced denial) AND cannot be fixed by operators (no editor). The system is incapable of self-recovery from its own most-frequent regression class.

### Finding 5 — Self-upgrade kills in-session UX; coworker chat is portal-wide

**Observation.** Mid-session, the portal applied a bundle hash change. `docker logs dpf-portal-1` showed repeated `Failed to find Server Action "4068de8c92c13af..."` errors for the next several minutes. Browser interactions silently failed (clicks landed but had no effect; renderer froze).

Independently, switching from `/ops` (Scrum Master coworker) to `/workspace` (COO coworker) revealed an active conversation with a *concurrent Claude session* — the COO chat is portal-wide, not session-scoped. Posting work-orders there would interleave with the other session's queries.

**Pattern.** Documented at [`project_self_upgrade_kills_in_session_ux.md`](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_self_upgrade_kills_in_session_ux.md). New compounding factor: the *recovery* path (switch coworker) is itself broken by the lack of session-scoped chat threads.

**Fix shape.**
- Self-upgrade must not invalidate active server actions for in-flight sessions. Either defer the upgrade until idle, or version-pin server actions per-session.
- Coworker chat threads must be session-scoped (per-tab, per-worktree, or per-operator-intent) so concurrent sessions don't collide.

---

## 4. The meta-pattern — silent-failure cascade

Every blocker above traces to the same architectural mistake: **errors at lower layers do not propagate to the surface where decisions are made.**

```
LLM coworker            <-- generates prose claiming success
  ↑ (no tool_result with denial)
Agent loop              <-- silently skips grant-denied call
  ↑ (no operator-visible error)
Dispatch layer          <-- returns nothing to caller
  ↑ (no DB write)
Database                <-- no row created/updated
```

The operator sees the top of this stack ("I've queued the update") and trusts it. There is no automatic reconciliation against the bottom of the stack (DB state). The session proceeds on a false premise until a downstream blocker forces investigation — at which point three more silent failures are already in flight.

**This pattern is why three months of attempts have failed.** Each fix targeted one symptom. The cascade itself is what needs to be closed.

---

## 5. The integrated fix program

A single coordinated program, not five racing BIs. Five slices, ordered to maximize value-per-risk:

### Slice 1 — Agent-loop denial signal (LOAD-BEARING)

**Problem.** Finding 3.

**Fix.** Modify the agentic loop in [`apps/web/lib/tak/agentic-loop.ts`](../../../apps/web/lib/tak/agentic-loop.ts) so every tool call emitted by the LLM produces *exactly one* of:
- a real `tool_result` from the actual tool execution, or
- a typed denial `tool_result` of shape `{ kind: "denied", reason: "grant_missing" | "proposal_pending" | "tool_not_found", details: {...} }`.

Add a prompt-side invariant in [`apps/web/lib/tak/prompt-assembler.ts`](../../../apps/web/lib/tak/prompt-assembler.ts): "When a `tool_result` has `kind: 'denied'`, you MUST surface the denial verbatim to the operator in your next message. You MUST NOT claim the operation succeeded, was queued, or was submitted."

**Why first.** Without this, every other fix is partially blind. With it, all subsequent silent-failure classes become visible the moment they occur — including ones we haven't documented yet.

**Acceptance.** Issue a triage call to a Scrum Master that lacks the grant. Operator sees: *"I tried to call `triage_backlog_item` but I don't have the `backlog_triage` grant. Open `/platform/audit/authority` and grant me, or ask a coworker with the grant (e.g. coo-orchestrator) to do this."*

### Slice 2 — Grant seeding by persona analysis

**Problem.** Finding 2.

**Fix.** Extend the seed in [`packages/db/src/seed.ts`](../../../packages/db/src/seed.ts) (or its grant-seeding submodule): for each agent, parse the persona description for keywords (`triage`, `backlog`, `promote`, `prioritize`, etc.) and grant the corresponding `*_triage`/`*_promote`/etc. capabilities. The seed must produce a non-empty diff for the current state and document the keyword → grant mapping.

Extend the existing audit script [`apps/web/scripts/audit-coworker-tool-grants.ts`](../../../apps/web/scripts/audit-coworker-tool-grants.ts) with the symmetric check: an agent named for a capability that lacks the corresponding grant is a hard error, fails CI.

**Why second.** Closes the most common regression class. After Slice 1 ships, this gap becomes operator-visible — Slice 2 makes it operator-invisible by ensuring it doesn't happen.

**Acceptance.** Fresh install. Scrum Master, ops-coordinator, product-backlog-* all have `backlog_triage` + `build_promote`. Audit script run in CI passes.

### Slice 3 — Per-agent grant editor UX

**Problem.** Finding 4.

**Fix.** Extend `/platform/audit/authority` from read-only matrix to read/write editor. Each cell becomes a popover listing grants for that (agent, category) pair, with add/remove controls. Mutations write to `AgentToolGrant` and emit an audit row.

**Why third.** Slice 1 surfaces denials; Slice 2 prevents most; Slice 3 lets operators handle the remainder without engineering or SQL.

**Acceptance.** Operator can grant `backlog_triage` to Scrum Master via UI alone in <60 seconds, with audit row showing operator + timestamp.

### Slice 4 — Session-scoped coworker chat threads

**Problem.** Finding 5 (concurrent-session collision half).

**Fix.** Coworker chat thread keying changes from `(workspace, agent)` to `(operator-session, agent)`. Each session sees its own thread; a session-listing surface exists for cross-session visibility.

**Why fourth.** Decouples concurrent operator workflows. Compounds Slice 1's value: when Slice 1 surfaces a denial in your thread, it doesn't get drowned out by another session's queries.

**Acceptance.** Two sibling Claude sessions can each hold an independent COO conversation simultaneously without interleaving.

### Slice 5 — Self-upgrade defers to session-idle

**Problem.** Finding 5 (self-upgrade half).

**Fix.** Self-upgrade orchestrator ([self-upgrade/store.ts](../../../apps/web/lib/self-upgrade/store.ts) + dispatch path) checks for active operator sessions before applying. If any session is mid-action (defined by recent ToolExecution rows under that session's userId), defer until idle or operator confirms.

**Why fifth.** Lowest-frequency blocker but highest blast-radius when it hits. Worth its own slice because it interacts subtly with Slices 1-4.

**Acceptance.** Trigger a self-upgrade while an operator is mid-conversation. Upgrade is deferred until the operator's session is idle for >2 minutes or the operator confirms.

### Slice 6 — Post-PR Health Watcher + Recovery Actions (the original goal)

**Problem.** Finding 1.

**Fix.** As scoped in BI `cmpgcjic20a4001mq1b9axda1` (slices A and B in §3 of this document). After Slices 1-5 ship, this becomes a normal BS build with a clean operator cycle.

**Why sixth.** It is the *motivating* problem but not the *load-bearing* problem. Putting it last is correct: the first five slices remove the failure modes that would otherwise prevent this slice from completing.

---

## 6. Acceptance for the whole program

**One full end-to-end cycle:**

1. Operator opens portal, talks to Scrum Master coworker.
2. Files a BI via chat. Operator sees real BI id, verified against DB.
3. Triages BI to `outcome=build, size=M`. Operator sees triage write confirmed.
4. Promotes to BS. Operator sees FB-* id, verified against DB.
5. Approves Ideate. BS runs.
6. Approves Plan. BS runs.
7. BS implements, verifies, opens PR.
8. PR CI passes; if any check fails, Slice 6 recovers automatically.
9. Operator approves ship in Release Decisions.
10. Total elapsed operator-attention: <30 minutes spread over the BS run. No SQL, no terminal, no GitHub UI, no concurrent-session collisions.

**The success metric.** Cycle (1)–(10) completes within one calendar day with zero hidden failures. Repeats next day with a different BI. Repeats the day after that. The third consecutive clean cycle marks program-complete.

---

## 7. What this audit does and does not authorize

**Authorizes.** Treating Slices 1-6 as one coordinated program with shared definition-of-done at §6. Filing them under a single epic. Sequencing them per §5 rather than racing.

**Does not authorize.** SQL bypass to grant Scrum Master the missing grants for the immediate session. The grant gap is the dogfooding signal for Slice 3. Bypassing it now obscures the regression class until the next attempt.

**Recommended immediate operator action.** File a single epic with this audit attached. Create the six slices as child FBs under it. Slice 1 first; do not start Slice 2 until Slice 1's acceptance is met (Slice 1's denial signal is what proves Slice 2 worked).

---

## 8. Provenance & evidence index

| Evidence | Source |
|----------|--------|
| BI exists | `select id, title from "BacklogItem" where id='cmpgcjic20a4001mq1b9axda1'` |
| Only 3 agents have triage+promote | `select count(*) filter (where "grantKey"='backlog_triage')...` per §3 Finding 2 |
| Zero triage/promote tool calls | `select "toolName", count(*) from "ToolExecution" where "toolName" in ('triage_backlog_item','promote_to_build_studio') and "createdAt" > now() - interval '40 minutes'` |
| FB-3CA106CC overlap | `select "buildId", description from "FeatureBuild" where "buildId"='FB-3CA106CC'` |
| FB-9709981A overlap | same query, different buildId |
| Self-upgrade Server Action 404s | `docker logs dpf-portal-1 --tail 30` |
| Authority Matrix read-only | Live UI inspection at `/platform/audit/authority` |
| PR #957 failure mix | `gh pr view 957 --json statusCheckRollup` |

| Cross-referenced memory principles | Path |
|------------------------------------|------|
| Silent failure on contribute_to_hive | [project_hive_contribution_gaps.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_hive_contribution_gaps.md) |
| Agent grant seeding gap (PR #137) | [project_agent_grant_seeding_gap.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_agent_grant_seeding_gap.md) |
| Self-upgrade kills in-session UX | [project_self_upgrade_kills_in_session_ux.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_self_upgrade_kills_in_session_ux.md) |
| Proposal-mode silent failure | [project_proposal_trap_silent_failure.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_proposal_trap_silent_failure.md) |
| Silent seed skips | [project_silent_seed_skips_audit.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/project_silent_seed_skips_audit.md) |
| Don't bypass UX with SQL | [feedback_dont_bypass_ux_with_sql.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_dont_bypass_ux_with_sql.md) |
| Fix seed, not runtime | [feedback_fix_seed_not_runtime.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_fix_seed_not_runtime.md) |
| Check tool signals first | [feedback_check_tool_signals.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_check_tool_signals.md) |
| Verify substrate before proposing | [feedback_verify_substrate_before_proposing_new.md](../../../../../../C:/Users/Mark%20Bodman/.claude/projects/D--DPF/memory/feedback_verify_substrate_before_proposing_new.md) |
| Never ask user to run commands | [docs/founder-kernel/wiki/principles/never-ask-user-to-run-commands.md](../../founder-kernel/wiki/principles/never-ask-user-to-run-commands.md) |

| Existing substrate worth reusing | Path |
|----------------------------------|------|
| Sandbox source-currency classifier | [`apps/web/lib/integrate/sandbox/sandbox-source-currency.ts`](../../../apps/web/lib/integrate/sandbox/sandbox-source-currency.ts) |
| Pre-PR gates | [`apps/web/lib/integrate/pre-pr-gates.ts`](../../../apps/web/lib/integrate/pre-pr-gates.ts) |
| Contribution review pipeline | [`apps/web/lib/integrate/contribution-review.ts`](../../../apps/web/lib/integrate/contribution-review.ts) |
| Build orchestrator | [`apps/web/lib/integrate/build-orchestrator.ts`](../../../apps/web/lib/integrate/build-orchestrator.ts) |
| Agentic loop | [`apps/web/lib/tak/agentic-loop.ts`](../../../apps/web/lib/tak/agentic-loop.ts) |
| Coworker tool-grant audit script | [`apps/web/scripts/audit-coworker-tool-grants.ts`](../../../apps/web/scripts/audit-coworker-tool-grants.ts) |
| FB-3CA106CC (sandbox baseline refresh) | DB row, ideate phase |
| FB-9709981A (overlap sweep) | DB row, ideate phase |

---

## 9. Recommended next action for the operator

When portal is stable (self-upgrade settled, no concurrent Claude sessions):

1. Open a *fresh* session with no other operators in the portal.
2. Talk to the **coo-orchestrator-backed** coworker (currently surfaced as `COO`, which *does* have triage+promote grants).
3. File the epic + six child BIs from §5 in one continuous interaction. After each filing, verify against DB before moving on.
4. Start Slice 1 immediately. Hold Slice 2 until Slice 1's acceptance is met.

If portal instability persists, escalate to a fresh-install rebuild from `origin/main` per [`worktree-base-origin-main`](../founder-kernel/wiki/principles/worktree-base-origin-main.md) before continuing.

---

*End of audit.*
