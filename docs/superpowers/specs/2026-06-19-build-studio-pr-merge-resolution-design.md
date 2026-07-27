# Build Studio PR Merge Resolution — Design

- **Status:** Ratified through the approved 2026-07-27 implementation plan; implementation in progress under BI-7C4FDBF5, EP-BUILD-STUDIO.
- **Date:** 2026-06-19
- **Operator prompt (Mark):** "Build Studio submits PRs that may not merge correctly (e.g. #2122, stuck on conflicts). Research how to best resolve this when the user is non-technical. Is there a precedent?"
- **Method:** read-only audit of the BS PR path + GitHub-API commit/merge code, cross-checked against the live merge-race observed all of 2026-06-19, plus external precedent research.

---

## 2026-07-27 current-state correction

The repository now has a protected GitHub merge queue. Build Studio therefore
does not create a per-portal queue and does not directly merge. The ratified
implementation uses exact-head readiness, GitHub's compare-and-swap
`update-branch` operation for a stale head, repository auto-merge/queue
enrollment for evidence-cleared PRs, and a restart-safe Work Capsule reconciler.
True textual conflicts escalate with evidence; automatic AI conflict editing is
outside this prerequisite and requires a separate governed decision.

PR merge is also distinct from deployment. A merged PR waits for governed
self-upgrade and live-version evidence before the build can become complete.
The detailed file-level contract and 20% bounded refactoring allocation are in
`docs/superpowers/plans/2026-07-27-build-studio-pr-readiness-merge-recovery.md`.

## 1. The failure mode (non-technical customer, dead-ended)

Build Studio branches a build off `main` **once, at build start** (`refreshCurrentBranchFromTarget`, `build-branch.ts:489-528`), then runs a multi-phase build (often 30+ min). At `ship` it attempts an **unconditional** auto-merge — it **never reads `mergeable`**. By then `main` has usually moved, so the merge fails BEHIND or CONFLICTING. BS catches the error, posts a PR comment *"Auto-merge failed. This PR requires manual review and merge."* (`mcp-tools.ts:10629-10637`), and the build **stays at `ship` forever** — `ChangePromotion` never reaches `deployed`, no watcher retries, and the portal shows only a flat `BuildActivityLog` line. A non-technical customer (Dale) is dead-ended at a GitHub conflict they can neither understand nor resolve. This is the *same* race a technical operator hits under strict branch protection + a fast-moving `main`; the customer just has no `git rebase` escape.

### Current-state gaps (file:line)
- `getPRStatus()` reads `pr.mergeable` but is **never called** — `github-api-commit.ts:474-511`.
- Auto-merge is **unconditional** — `github-api-commit.ts:534-550`; decision `mcp-tools.ts:10593-10654`.
- No re-sync of the build branch to latest `main` between build start and merge.
- No cron/Inngest watcher of BS PR mergeable state; no rebase; no merge queue.
- No portal surface beyond the activity log; no plain-language "stuck / syncing / live" state.

---

## 2. Precedent — a solved problem class

| Mechanism | What it solves | Examples |
|---|---|---|
| **Merge queue** | the require-up-to-date race: speculative-merge each PR against `main` + queued PRs, CI *there*, fast-forward on green — author never rebases | GitHub native merge queue, GitLab merge trains, Mergify, bors/homu, Kodiak |
| **Auto-rebase / update bot** | a stale (BEHIND) PR branch | Mergify auto-rebase, Kodiak (merge main→PR), Dependabot `@dependabot rebase` |
| **AI conflict resolution** | true textual conflicts, keeping an agent's task moving | Graphite "AI Sync" (agents get rebase/merge-with-auto-resolve tools), Reconcile-AI, GitLens Resolve, Copilot/Cursor/Claude; "regenerate generated files from source to incorporate both branches" |

The race is **not** a DPF-unique problem; the fix is well-trodden. What *is* DPF-unique: the PR author is an **AI build system**, and the consumer is **non-technical**.

---

## 3. Design principle

> **A non-technical customer must never see, or be asked to resolve, a git conflict.** Build Studio is the AI that wrote the change, so it resolves its own merge problems autonomously, then reports plain-language status. The only escalation a human ever sees is "this needs a person" — never "merge conflict".

This is the same shape as two fixes already shipped in the 2026-06-19 reliability series and should reuse them:
- **verification→fix loop** (`build/verification-repair.ts`, BI-99B06AD1 / PR #2116) — re-verify after re-applying a change.
- **escalate-to-human** (`build/escalate-build-to-human.ts`, BI-3E0EE3BA / PR #2093) — `PlatformIssueReport(type=build-stall-escalation, selfFixClass=needs-human)`, surfaced via intake; never silent.

---

## 4. The layered solution (cheapest-first)

1. **Read mergeable before merging.** Wire the dead `getPRStatus()` into the ship/merge path; branch on `MERGEABLE+CLEAN` → merge; `BEHIND` → step 2; `CONFLICTING` → step 4. Stops the silent unconditional-merge failure immediately.
2. **Auto-rebase on BEHIND (the ~90% case).** Update the build branch from latest `main` (GitHub "update branch" / rebase), let CI re-run, merge when green. Also dissolves the operator-side livelock.
3. **Serialize BS merges (lightweight merge queue).** BS is the only auto-merger on its own portal, so it should never race itself: one BS PR merges at a time, each rebased on the prior. A per-portal queue (DB-backed or the GitHub merge queue where available) removes the race at the source.
4. **AI-resolve true CONFLICTS.** Re-apply the build's diff onto latest `main` — regenerate via the build's *implement* step against the updated base — then **re-verify with the BI-99B06AD1 loop**, and re-push. The AI that wrote the code resolves the conflict; generated files are regenerated, not hand-merged.
5. **Escalate after N rounds.** If steps 2/4 can't land it in a bounded number of rounds, `escalateBuildToHuman(... selfFixClass: "needs-human")`. The work is captured, surfaced, and the WIP slot freed — never a silent stuck PR.
6. **Watcher.** An Inngest cron (mirroring the taskrun-watchdog pattern) polls open BS PRs, drives steps 1–5, and **advances the build lifecycle** so `ship` no longer dead-ends.
7. **Plain-language UI.** The build's ship card shows `Finalizing against the latest platform…` / `Your change is live` / `Flagged for the team` — never "merge conflict", never a rebase button. Reuse the needs-human surface from BI-3E0EE3BA.

---

## 5. Phasing (suggested at triage)

- **P1 (cheapest, highest ROW):** steps 1 + 2 + 5 — read mergeable, auto-rebase on BEHIND, escalate-on-stuck. Unblocks the common case and removes the silent dead-end. Files: `github-api-commit.ts` (use `getPRStatus`), `mcp-tools.ts` ship/merge path, reuse `escalate-build-to-human.ts`.
- **P2:** steps 3 + 6 — per-portal merge queue + watcher cron. Removes the race at the source and guarantees forward motion.
- **P3:** steps 4 + 7 — AI conflict re-apply/re-verify + plain-language UI. Closes the true-conflict case and the non-technical surfacing.

---

## 6. Verification

- BEHIND: open a BS PR, advance `main` past it, assert BS auto-rebases + merges with **zero human action** and the build reaches `complete`.
- CONFLICTING: inject a real textual conflict on the build's surface, assert BS re-applies + re-verifies (or, if unfixable in N rounds, escalates `needs-human`) — and the lifecycle leaves `ship` either way.
- UX: assert the portal shows only plain-language status (no "merge conflict", no git affordance) and that a needs-human escalation is surfaced via intake.

---

## 7. Notes / open questions

- **#2122** (BI-98B723C0 Phase 2b) is the live exemplar — currently `BEHIND` (the resolvable case P1 handles). It races the *other* phases of the same worktree epic on the same hot file (`build-branch.ts`), which is why it oscillates BEHIND. P3 (AI re-apply) would also handle the harder conflicting moments.
- **Reuse, don't rebuild:** P1 reuses `getPRStatus` + `escalate-build-to-human`; P3 reuses `verification-repair`. The only genuinely new substrate is the per-portal merge queue (P2) and the ship-card UI (P3).
- **Sovereignty:** all of this runs on the customer's own portal against their own `dpf/install` / upstream — no new external dependency; the AI resolution is local-model-capable (it is the same build engine).
- **Relation to the operator livelock:** the same design (queue + auto-rebase) also fixes the manual merge-race that slowed the 2026-06-19 reliability PRs; the merge queue is the durable answer to "strict require-up-to-date + fast main".
