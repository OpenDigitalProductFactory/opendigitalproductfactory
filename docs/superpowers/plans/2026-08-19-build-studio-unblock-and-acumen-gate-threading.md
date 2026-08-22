---
status: active
---

# Unblock Build Studio dispatch and make the acumen phase gates actually fire

**Backlog items:** BI-B24D4C84, BI-6CFC5429, BI-70280889
**Status:** implemented
**Date:** 2026-08-19

## Why

A live end-to-end Build Studio exercise on 2026-08-19 (portal bundle `e80c3f2bc`) could not ship a single backlog item. Three independent defects sat in the path, each of which also hid the next:

1. **No small or medium build could dispatch at all.** Last successful auto-dispatch on the install was 2026-07-20.
2. **The ideate agent was blind to the code it was designing against**, and the runtime reported that as a model-capability problem.
3. **The acumen decision layer shipped in PR #4398 was inert** — the gates accepted `plannedFilePaths`, but nothing ever passed any.

Only #3 was a known-unknown going in; #1 and #2 were discovered by driving the portal.

## What was wrong, precisely

### BI-B24D4C84 — dispatch pinned to a tier nothing qualifies for

`ideate-on-approval.ts` called `getModelTier(null, bi.effortSize)` with **no `RightsizingOpts`**, so it fell through to the legacy branch in `build-process-matrix.ts`:

```
s === "large" || s === "xlarge" ? "robust" : "local"
```

Every `small` and `medium` item therefore resolved to tier `local`. `build-engine-selection-runtime.ts` then sets `localOnly = localOnlySetting || opts.modelTier === "local"`, pinning the route contract to `residencyPolicy: "local_only"` and excluding every cloud engine. On this install the only **active** local codegen model (`qwen3.8-27b`) scores `toolFidelity` **82** against a code-gen floor of **85** — every local model that used to clear it is retired. Result: zero eligible endpoints, `ideate_dispatch` skipped, build stuck in `ideate` forever.

The platform's own quality-first rightsizing (`isQualityFirstRightsizingEnabled`, **ON by default**) exists precisely to route substantive work to `robust` and keep only the trivial doc/chore tail local. Two callers — `autonomous-tee-up.ts` and `autonomous-build-phase-runtime.ts` — already pass the opts. `ideate-on-approval.ts` and `plan-on-approval.ts` did not. That asymmetry is the bug.

### BI-6CFC5429 — every agent codebase tool read the wrong tree

`getProjectRoot()` honours `PROJECT_ROOT`. In the live portal that resolved to a docker volume holding commit `c5504514` (**2026-06-08**) on a stray branch **`my-changes`** with 4,444 of the repo's ~10,000 files — missing whole directories (`apps/web/lib/attention`, `a2a`, `__tests__`). The trees that matter (`/sandbox-workspace`, `/host-dpf`) were mounted in the same container.

`search_project_files` and `list_project_directory` returned `success: true` with empty results. `search_code_graph` reported `indexStatus: "ready"`, `warnings: []`. The ideate agent searched correctly, found nothing, looped, and the runtime emitted *"local model spun through 9 tool calls without converging"* → operator copy *"I'm on a local AI that wasn't strong enough — connect a stronger provider."* An environment variable was sold to the operator as a reason to buy inference.

Compounding it, the code-graph trust vector scored `freshness: 1, tier "high"` with rationale *"indexed within the last 24 hours"* — it measures **when the indexer ran**, not **how old the content is**. Re-indexing a 10-week-old branch hourly scores permanently fresh.

### BI-70280889 — the acumen layer could never fire

All four gate call sites omitted `plannedFilePaths`. Both gates short-circuit on an empty list and `deriveImpactedAcumens([])` returns `[]`, so `runAcumenPhaseConsults` always returned no consults, no DI-ledger rows, and no capability nominations. Live ledger confirmed it: 8 `wsid-*` profession rows, all pre-dating the exercise, **every one with `buildId = NULL`**.

The data was never missing. The build's Workroom already holds `verificationState.changeImpactContract.paths` (status `resolved`), and the build drawer already renders it as **EXPECTED FILES**.

## What changed

### 1. Thread the planned paths (BI-70280889)

New `apps/web/lib/decision-perspective/planned-file-paths.ts`:

- `resolvePlannedFilePaths` — Workroom change-impact contract first, plan document second.
- `resolveShippedFilePaths` — the realized diff wins at ship time, since a build may have diverged from its plan.
- `normalizeFilePaths` — repo-relative source paths only; rejects absolute paths, parent escapes and bare names rather than rewriting them, and caps the list.
- **Fail-open by contract:** any resolution error returns `[]`, which restores the gates' prior byte-identical behaviour. A gate must never fail because path resolution failed.

Wired into all four call sites: `advance-phase/route.ts`, `actions/build.ts`, `plan-to-build-transition.ts`, `ship-on-review-approval.ts`.

### 2. Pass the rightsizing opts (BI-B24D4C84)

`ideate-on-approval.ts` and `plan-on-approval.ts` now call `getModelTier` with `{ qualityFirst, sensitivity }`, matching the two autonomous callers. The flag read happens only when tier routing is enabled.

### 3. Make a wrong root loud, and freshness honest (BI-6CFC5429)

- `projectRootLooksValid` / `warnIfProjectRootSuspect` in `build/codebase-tools.ts`, called from `searchProjectFiles` and `listProjectDirectory`. Warns once per process, names the root, and states plainly that **empty results from this root are not evidence the code is absent**.
- The code-graph freshness dimension now receives `lastIndexedBranch` and caps its score when the graph was indexed off a non-default branch, with a rationale that names the branch.

The guard deliberately does **not** auto-correct `PROJECT_ROOT` — only the operator knows which tree is intended, and silently rewriting it would hide the misconfiguration. Repointing the env var remains an operator action.

## Deliberately out of scope

- **Changing the acumen advisory posture.** Consults still never change a gate's `allowed` verdict; blocking on acumen verdicts remains a later, ratified step (trust-ratchet).
- **Re-scoring or replacing the local model.** BI-B24D4C84 lists three levers; this implements the one that looks like the intended design (pass the opts). Whether `qwen3.8-27b`'s `toolFidelity` score is accurate is a separate measurement question.
- **BI-10501365** (shadow Workroom gate has zero observations) — the gate behaves to contract; its consequential-tool coverage is a separate decision.
- **BI-0AA9B679**, the owner-cockpit copy fix that started the exercise. It stays open on purpose: it is the item to re-drive through Build Studio once these land, as the end-to-end proof.

## Verification

- `apps/web` typecheck clean.
- 463 tests green across `lib/decision-perspective/`, `lib/build/`, `lib/explore/`, `lib/trust-vector/adapters/`, plus 25 new assertions:
  - `planned-file-paths.test.ts` — source precedence, path rejection, cap, fail-open.
  - `codebase-tools-project-root.test.ts` — sentinel detection, warn-once, message content.
  - `build-process-matrix.test.ts` — legacy branch unchanged; quality-first routes small/medium to `robust`; doc/chore tail stays `local`; high sensitivity escalates.
  - `code-graph.test.ts` — a minutes-old index of a side branch is not scored fully fresh; default branch and unknown branch are unaffected.

**Not yet proven live.** These changes are verified by test and typecheck only. The live install still has `PROJECT_ROOT` pointing at the stale volume — that is an operator/deployment change this PR cannot make. Re-driving BI-0AA9B679 through the full Build Studio lifecycle on a portal running this code, with `PROJECT_ROOT` corrected, is the functional proof; until then the acumen consults are threaded but unobserved in production.
