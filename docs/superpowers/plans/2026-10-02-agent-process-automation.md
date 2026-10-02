---
status: in-progress
---

# Agent process automation — what the grunt work actually cost, and what remains

One session drove nine PRs through the full landing process. This records what
that cost and why, so the next thread works from evidence rather than from a
narrative it has to be told.

**The thesis, confirmed the hard way:** an obligation an agent must REMEMBER does
not survive context compaction. An obligation a gate HANDS OVER does. Every
finding below is an instance of that.

## 1. Prose did not work, and was already there

`AGENTS.md` §4 prescribes the verification path. `pregate:preflight` printed
`see every constraint that applies to this diff: pnpm gate:context` on **every**
run. Across nine PRs the agent saw that line a dozen-plus times and invoked
`gate:context` **zero** times — discovering every required attestation and every
stale derived artifact by colliding with its refusal instead.

A third restatement in `AGENTS.md` would have been the instrument that had
already failed twice. **Do not fix process gaps with more prose.**

## 2. What existed, unused, and what it would have saved

| tool | answers | used in those 9 PRs |
|---|---|---|
| `gate:context` | required attestations, where each goes, stale derived artifacts | **0 times** |
| `gate:local` | every deterministic gate vs the WORKING TREE, reading the planned commit message | **0 times** |
| `gate:wait` | queue / retry / infra classification as code | **0 times** |
| `pr:ready` | is this branch ready to become a PR | **0 times** |
| `merge-policy:apply` | merge-readiness policy | **0 times** |
| `create_portal_pr` (MCP) | platform-side PR creation | 0 — used raw `gh` |
| `pregate` / `:preflight` / `:status`, `pr:health` | the gate, PR health | used |

Cost of not using them, counted:

- **six** `commit → refusal → fix → amend` cycles that `gate:local` collapses
  into one (convergence trailer, spec/plan/doc gate, raw-error-message guard,
  stale deps, CI test inventory, policy-guard toolchain);
- **~15** hand-written bash polling loops instead of `gate:wait`. Three were
  wrong in ways that mattered: one read an `INCONCLUSIVE` queue state as a
  terminal verdict; one treated `STALE` as non-terminal and span 39 minutes
  emitting nothing; one grepped for a failure pattern `node --test` does not
  emit and **reported a red suite as green**.

`gate-wait.mjs` had already written the lesson in its own header: *"callers used
to write that policy in bash, once per session, and get it wrong… ceremony
belongs in code, not in whoever is driving the gate."*

## 3. The recurring defect class: a window read as the whole

Six times in one session a truncated or wrong-shaped read produced a false
conclusion. Every one was the reader, not the thing read:

- the audit's truncated "most unanswered" list parsed as the full dataset — **twice**;
- an absent test runner (`vitest`/`tsx` missing) read as a clean typecheck — **twice**;
- `grep -c '^not ok'` against `node --test`, which does not emit that — a red suite reported green;
- `grep ... | head -5` over a Dockerfile with **101** script `COPY` lines, concluding two files were not image-copied when they are (lines 165, 186) — nearly filed as a false positive against the convergence gate.

**Mechanical consequence:** prefer `--json` over human-facing summaries; assert a
floor on anything parsed; never conclude from a window.

## 4. Closed-set fields invented three times

Five capability keys (`view_build_studio`, `view_platform_tools`,
`view_workspace`, `view_operate`, `view_ai_platform`) — all 76 preflight guards
passed. Then `finance`/`marketing` categories, caught by the UX ratchet. Then the
**same two categories again** in a second worktree after being reported checked.

Now guarded: `skill-capability-key-guard` (#5905), `skill-pack-category`,
`self-task-cadence-parity` (with parser floors). Vigilance did not fix this;
guards did.

## 5. Landed in this change

- `pregate:preflight` **emits** its obligations on refusal instead of pointing at
  `gate:context` — attestations (flagging the ones the gate reads from the PR
  **body**, not a commit trailer), and each stale derived artifact with its
  regenerate command.
- `gate:context` surfaces `generate`/`check`, which the derived-artifacts
  registry always carried and the context never printed.
- `pnpm land` — preconditions → context → regenerate → `gate:local` → commit →
  `gate:wait` → push → PR → auto-merge (enable **verified**). Overrides nothing,
  invents no attestation, gates before it pushes.

## 6. Remaining worklist

1. **`pnpm land` is unproven end to end.** It has never completed a real landing;
   its first real run is the one that lands its own PR. Drive it; fix what breaks.
2. **Waiting still burns agent context.** `gate:wait` moves the loop into a
   subprocess, but the agent still blocks on it. The room should own the wait and
   notify. This is the largest remaining token win.
3. **PR creation is still `gh` from the agent.** `create_portal_pr` exists in the
   MCP surface; `land` should prefer it so the platform records the PR rather
   than the client.
4. ~~**Drift handling is manual.**~~ `land` now fetches, counts commits behind
   `origin/main`, and merges forward (merge, not rebase — safe on a shallow
   clone) **before** context and regeneration, so the gate sees the merged tree.
   Unknowable drift refuses rather than reading as current.
5. ~~**`pnpm land -- --flag` is a trap.**~~ Measured, the cause was not pnpm:
   pnpm 10 forwards the `--` literally, and `node:util parseArgs` then reads
   every later flag as a positional — silently, under `allowPositionals` or
   `strict: false`. `scripts/lib/script-argv.mjs` drops one leading `--`; the
   landing spine (`land`, `gate:local`, `gate:context`, `gate:wait`) uses it.
   **51** other scripts parse with those options and still drop the flag; they
   need the helper and a guard that requires it.
