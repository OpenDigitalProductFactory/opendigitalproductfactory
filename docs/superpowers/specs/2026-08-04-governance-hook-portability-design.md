# Governance hook portability across external coding surfaces — design

| Field | Value |
|-------|-------|
| **Status** | Analysis + recommendation. No code in this document. |
| **Date** | 2026-08-04 |
| **Author** | Claude (external_coding_agent) |
| **Epic / BI** | Gates [EP-ANTIGRAVITY-001](2026-07-17-antigravity-first-class-support-design.md); precedent [EP-GROK-001](2026-05-31-grok-first-class-support-design.md) |
| **Related** | BI-0020D511 §13f (the doctrine defect that surfaced this), BI-A08EBAEC (MCP efficiency twin) |

## 1. Why this exists

EP-ANTIGRAVITY-001 names one unknown as the thing its evidence gate must resolve:

> Grok reads Claude-format hooks natively and Codex aliases `CLAUDE_PLUGIN_ROOT`, but Antigravity is VS Code / Windsurf-derived with its own AI-Rules / MCP-config model, so governance-hook enforcement (`lease-guard`, `worktree-create`, `decision-routing`) may **not** transfer for free.

That unknown is larger than it looks, and it already produced a live doctrine defect. `AGENTS.md` §1 asserted that `PreToolUse` hooks "refuse rather than warn" — unconditionally — so an agent on a host without the hook plane believed it was protected by refusals that never fire (BI-0020D511 §13f, fixed with a `⟦situational:⟧` marker). The marker makes the doctrine honest; it does not answer the architecture question.

**The question this note answers:** what actually has to port to onboard a new surface, and what is already covered elsewhere?

## 2. The surface is larger than three hooks

`packages/dpf-skill-pack/hooks/hooks.json` registers **19 hooks across 5 event types**, 15 distinct scripts:

| Event | Matcher | Guards |
|---|---|---|
| `PreToolUse` | `Bash` | `lease-guard`, `root-clone-guard`, `compose-guard`, `lease-punt-guard`, `pregate-evidence-guard` |
| `PreToolUse` | `AskUserQuestion` | `decision-routing-guard` |
| `PreToolUse` | `Write\|Edit\|MultiEdit` | `plan-backlog-coverage-guard`, `ux-fit-precheck`, `spec-plan-doc-precheck`, `design-grounding-precheck`, `tool-economy-precheck` |
| `WorktreeCreate` | `*` | `worktree-create` |
| `SessionStart` | `*` | `process-spine-health-check`, `governance-freshness-check`, `worktree-session-hygiene` |
| `SessionEnd` / `Stop` | `*` | `uncommitted-work-guard`, `worktree-session-hygiene` |

**Portability is worse than "does the host support hooks".** The matchers are Claude Code's *tool names* (`Bash`, `AskUserQuestion`, `MultiEdit`) and the events are its *session lifecycle*. A host would need not merely a hook plane but the same tool vocabulary and session model. Full parity is not a realistic onboarding gate for any surface that is not Claude-derived.

## 3. The reframe: classify by where the consequence lands

Porting 15 guards to N hosts is intractable. But the guards are not equivalent in what they protect, and most of them are not the only thing standing between an agent and the harm.

### Tier 1 — consequence lands server-side, already enforced there

`pregate-evidence-guard` (refuses `git push` / PR without SHA-bound local-CI evidence), `plan-backlog-coverage-guard` (backlog lives in Postgres and has its own gates).

The **safety** purpose is server-enforced: CI runs on every PR regardless of host, and the merge queue refuses to merge a red tree. Observed directly — PR #3872 was evicted from the queue three times in one day for CI failures, twice for a hung production build. Nothing a host skips locally can land broken code on `main`.

The **efficiency** purpose is *not* enforced: nothing in `.github/workflows/` reads the pregate receipt, and `Local-CI-Override` in the PR body is honour-system prose. A host without the hook wastes CI cycles; it does not endanger the repository.

**Verdict: safe on any host.** The hook is fail-fast convenience. Do not gate onboarding on it.

### Tier 2 — server can detect and remediate, but not prevent

`lease-guard`, `lease-punt-guard` (refuse an ungoverned `pnpm dev` / `next dev` on the shared nonprod instance).

The server issues leases and runs a reaper, so an unleased server is detectable and reclaimable — but the *bind itself* happens on the host and cannot be prevented remotely. `lease-guard` exists because ~50 rogue background servers once starved the machine.

**Verdict: degraded but recoverable.** A new host raises the load on the reaper. Acceptable with monitoring; worth re-expressing where the host allows it.

### Tier 3 — local-only, no server recourse whatsoever

`root-clone-guard`, `compose-guard`, `worktree-create`, `uncommitted-work-guard`.

These guard the filesystem, git and Docker. The DPF server never observes the action and cannot undo it. `root-clone-guard` exists because a recursive-force delete followed a junction into the shared root clone and **wiped 730 tracked files on 2026-06-19**.

**Verdict: this is the onboarding blocker.** A host without these reintroduces a failure that has already happened once, with no recovery path.

## 4. Recommendation

**Gate new-surface onboarding on Tier 3, not on hook parity.** Four destructive-action guards, not fifteen. That is tractable in a foreign rules format — and where a host cannot express even those, the honest options are to run it in a disposable workspace where the destructive action has no shared blast radius, or to accept the risk explicitly rather than by omission.

Corollaries:

- **Do not attempt to move Tier 3 server-side.** It is not a design gap; the server structurally cannot see a local `rm -rf`. "Move governance server-side" is already true for the classes where it is possible, which is why Tier 1 is safe.
- **Do not port Tier 1 at all.** Porting it would imply the safety depends on it, which is false, and would make the onboarding gate look four times harder than it is.
- **`governance-approves-evidence-not-provenance` is the reason this decomposition works.** Because gates read required evidence fields and never ask which surface produced them, a host that lacks local prevention is still held to the same admission standard at the boundary. Tier 1 is safe *because* that principle is already load-bearing.

## 5. What this does not settle

- **Whether Antigravity's AI-Rules format can express the Tier 3 four.** That is EP-ANTIGRAVITY-001's evidence gate. This note argues about what *should* port; the gate determines what *can*.
- **Tier 1's server-side equivalents were confirmed by reading workflow definitions and by direct observation of the merge queue, not by a deliberate negative test.** Before anyone relies on "safe on any host", push a branch with knowingly failing tests from a host with no hooks and confirm the queue refuses it.
- **Tier 2's reaper coverage under a multi-host load** is untested. More hosts binding without leases is a quantitative change that could become qualitative.

## 6. Decision routing

This is a platform work-scope decision and should be routed through `principle_decide` before a menu is put to the operator (`AGENTS.md` §11). **It was not routed here**: this analysis was produced in a container with no MCP connectivity and no live install (no `DATABASE_URL`, no Docker socket), so the kernel could not be consulted. Route it before acting on §4.
