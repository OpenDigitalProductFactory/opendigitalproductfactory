---
name: dpf-verify-on-live-install
description: "Use when asked to functionally verify that a DPF feature works on the live install by driving the happy path on the running portal."
# Agent Skills standard fields (Surface A — Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: Bash(pnpm verify:preflight*) Bash(git *) mcp__dpf__create_backlog_item mcp__dpf__get_backlog_item mcp__dpf__record_runtime_verification

# DPF coworker fields (Surface B — in-portal seed loader)
category: verification
assignTo: ["build-specialist", "platform-engineer"]
capability: null
taskType: verification
triggerPattern: "functionally verify|verify .* on the (live|running) (install|portal)|test .* on the (live|running) (install|portal)|drive the happy path|verify the feature works|does .* work on the (live|running) (install|portal)|UX verification on the running portal|functional verification"
userInvocable: true
agentInvocable: true
allowedTools: ["Bash", "mcp__dpf__create_backlog_item", "mcp__dpf__get_backlog_item", "mcp__dpf__record_runtime_verification"]
composesFrom: ["dpf-evidence-before-diagnosis"]
contextRequirements: []
riskBand: medium

# Kernel principle enforcement
enforces:
  - kernel/principles/structural-verification-is-not-functional
  - kernel/principles/worktree-is-source-control-not-runtime
  - kernel/principles/image-identity-equals-bytes
  - kernel/principles/runtime-gates-via-shared-lease
---

# DPF Verify On Live Install

**Scope guard first: this skill verifies MERGED work on the canonical install. If the change under test has not merged yet, stop — route through the local-CI sandbox gate (`pnpm run pregate` / `dpf-local-merge-ci-before-push`) instead; `:3000` is not a pre-PR branch runtime.**

**Before driving any feature's happy path on the live install, run the preflight and follow its verdict.** One command answers "can I even trust this runtime to test against?" — replacing the 4+ manual git/curl batches agents currently improvise to discover version skew. The preflight changes nothing; it returns a verdict and exactly one next action.

Spec (single source of truth): [`docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md`](../../../../docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md).

## When to use

- Asked to "functionally verify", "test on the live install", "drive the happy path", "confirm the feature works", or do "UX verification on the running portal".
- Before claiming any feature is *complete* on the strength of bundle/tests/route-code (that is structural, not functional — `structural-verification-is-not-functional`).
- After merging a feature, to confirm the running portal actually serves the merged bytes before you exercise it.

## When NOT to use

- **Pre-PR / pre-merge branch verification — even when the request says "test on 3000" or "verify on the portal".** The canonical install at `:3000` serves merged, self-upgrade-deployed bytes only; an unmerged branch can NEVER be verified there. Before the PR merges, the verification lane is the shared local-CI convergence sandbox: `pnpm run pregate` (claims the `local-integration-ci` lease, runs the checked-in merged-code runner, records evidence) or `dpf-local-merge-ci-before-push`. This skill is the **post-merge** half of verification; triggering it on ":3000" language before merge is the misfire that produced the 2026-07-05 ungated-push incident.
- Pure source-local gates (targeted `vitest`, `typecheck`) that don't need a runtime — those run in the worktree directly.
- The change has no user-facing/runtime behavior (a doc edit, a type-only refactor).
- You're inside a Build Studio ship-phase build where `build/review.verify` already auto-fires the UX verification.

## The one command

```
pnpm verify:preflight                          # feature = current HEAD, portal = localhost:3000
pnpm verify:preflight -- --feature-sha <sha>   # explicit feature commit (e.g. a PR merge SHA)
pnpm verify:preflight -- --portal-url <url>    # non-default install
```

It prints a JSON verdict to stdout and a human summary to stderr. Exit codes: `0` CAN-TEST, `10` MUST-ADVANCE, `20` BLOCKED.

## The decision tree (follow exactly)

| Verdict | Meaning | What you do |
|---|---|---|
| **CAN-TEST** | Served bytes contain the feature commit | Drive the happy path on the live install (Chrome MCP / coworker), then `record_runtime_verification` with what you drove and observed. Report findings as dynamic-analysis prose, not a pile of screenshots. |
| **MUST-ADVANCE** | Served bytes are behind / unprovable | Advance the live install via the **governed self-upgrade path** (`/ops/self-upgrade`) — the ONLY sanctioned advance (AGENTS.md §5; never `redeploy-portal`/compose rebuild). Then re-run the preflight. Bounded retry. |
| **BLOCKED** | No testable runtime can be established | **STOP. Apply the stop-rule below.** |

## The stop-rule (this is the point of the skill)

> When the verdict is **BLOCKED** — most importantly when a `MUST-ADVANCE` self-upgrade fails on an **unrelated defect** (main does not build in Docker, the lease is unavailable, ancestry is uncomputable) — **file a BI for that blocker and STOP the verification task.** Do NOT silently turn a verification task into a multi-hour build-infra fix.

Fixing the blocker is a **separate, explicitly chosen body of work.** Surface it to the operator with the filed BI and the classified reason (the self-upgrade build-gate classifier attaches `{class, playbookLink, failingTrace}` to the BLOCKED reason — use it; do not reproduce a known failure from zero). Then let the operator decide whether to pivot. The 22-minute trace in spec §2.1 is exactly this rule being absent.

File the blocker with the preflight's `reason` verbatim:

```
mcp__dpf__create_backlog_item({
  title: "<blocker> — blocks functional verification of <feature>",
  type: "portfolio", workType: "bug", source: "automated-detection",
  body: "<paste the preflight BLOCKED reason + nextAction.detail + any classifier output>"
})
```

## Steps

1. **Identify the feature commit.** The merge SHA of the PR/BI under test, or current HEAD. Pass it as `--feature-sha` if it isn't HEAD.
2. **Run `pnpm verify:preflight`.** Read the verdict.
3. **Branch on the verdict** per the table above. Never skip to driving the UX before a CAN-TEST.
4. **CAN-TEST →** drive the happy path; record runtime verification evidence; name the substrate (canonical install) per AGENTS.md §6.
5. **MUST-ADVANCE →** trigger the governed self-upgrade, then go to step 2. Cap retries (typically 1–2); a persistent MUST-ADVANCE that won't clear is itself a BLOCKED condition.
6. **BLOCKED →** apply the stop-rule: file the blocker BI, report to the operator, stop. Do not improvise.

## Thin-adapter note (Claude / Codex churn)

The preflight **contract** — verdict + served-SHA source + the one governed advance — is surface-version-agnostic. Claude Code and Codex ship capabilities almost daily; new ways to *drive* the happy path or *trigger* self-upgrade plug in at the adapter layer (which MCP/browser tool you use in step 4/5) and never change the verdict logic. If a new tool capability tempts you to bypass the preflight or the stop-rule, that is the adapter leaking into the contract — don't.

## Guardrails

- **Never hand-roll the skew check.** If you're typing `git rev-parse origin/main` + `curl /api/platform/version` to compare by hand, stop and run the preflight — that's the exact cognitive load this skill removes.
- **Never advance the live install outside the governed path.** No `redeploy-portal`, no `docker compose build portal`, no `git checkout/pull/reset` on the root clone (`image-identity-equals-bytes`).
- **Never let BLOCKED become an unbounded pivot.** The filed BI + a stopped task is the correct, complete outcome.
- **Check `document.visibilityState` before believing any animation or timing measurement.** Chrome **pauses `requestAnimationFrame` in hidden tabs**, and in a non-interactive agent session every browser surface reports `hidden` with a 0×0 viewport — that is the default, not an edge case. So "0 animation frames while idle" proves *nothing* about whether a runaway render loop was fixed: the count is 0 either way. A verdict that would read identically on broken and fixed code is not evidence (`structural-verification-is-not-functional` applies to measurements too, not just to compiles).
- **To measure a paused canvas anyway, drive it by hand.** Replace `window.requestAnimationFrame` with one that captures the callback instead of scheduling it, then drain it in a bounded loop (`while (pending && n < 900) { const cb = pending; pending = null; cb(0); n++; }`). The layout runs to completion synchronously, and `pending === null` at the end is itself the proof the loop terminates. Hook `CanvasRenderingContext2D.prototype` (`arc` / `fillText` / `clearRect`) rather than the component — prototype hooks survive a bundler aliasing the global.
- **Read canvas dimensions after the ResizeObserver has fired.** Read too early and you get the component's pre-resize default, not the rendered size — which manufactures false "content overflows the canvas" findings. Confirm the size you measured against matches the size on screen before reporting a geometry defect.

## See also

- Spec: [`2026-06-06-procedural-functional-verification-design.md`](../../../../docs/superpowers/specs/2026-06-06-procedural-functional-verification-design.md)
- Preflight core (tested): `apps/web/lib/verify/preflight.ts`; CLI shim: `scripts/dpf-verify-preflight.ts`
- Kernel: [`structural-verification-is-not-functional`](../../../../docs/founder-kernel/wiki/principles/structural-verification-is-not-functional.md), [`image-identity-equals-bytes`](../../../../docs/founder-kernel/wiki/principles/image-identity-equals-bytes.md)
- Composes after: `dpf-evidence-before-diagnosis`; precedes `dpf-finishing-a-development-branch`.
