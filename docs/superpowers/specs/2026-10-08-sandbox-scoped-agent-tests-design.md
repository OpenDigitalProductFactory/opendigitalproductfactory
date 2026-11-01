---
status: active
---

# Build Studio agents run scoped tests only (BI-F5D4FA50)

**Status:** delivered on `fix/sandbox-scoped-tests`. Work shape `delivery-medium@1.0.0`, fix profile; this document carries the ordered deliverables (no separate plan).

## Problem

Observed 2026-10-08 ~03:40Z on a development install. `dpf-sandbox-1` ran at ~920% CPU. Inside build FB-86FAED68, a `claude -p` coding agent ran `pnpm exec vitest run --reporter=dot`, which is the whole web suite with no file filter. Three other CLI sessions ran beside it. The local-CI pool closed with `host-cpu-high`, which parked every queued pregate on the host.

## Cause (confirmed on `origin/main` 3a1a8003a7e)

The platform's own verification was already scoped. `runSandboxTests` in `apps/web/lib/build/coding-agent.ts` derives the test files for the build's changed files (`deriveScopedTestFiles`) and runs only those, using each package's own runner (`scopedTestRunnerCommand`). Agents were not held to that rule:

1. `apps/web/lib/build/build-agent-prompts.ts:262` and `prompts/build-phase/build.prompt.md:39` described `run_sandbox_tests` as "RUN the full test suite + typecheck". `:281`/`:340` asked for "full verification", and `prompts/specialist/qa-engineer.prompt.md:68` said "full test suite".
2. `apps/web/lib/build/sandbox/agent-cli-runtime.ts:74` gave every CLI QA agent the instruction `Run tests: pnpm exec vitest run --reporter=verbose`. That is the unscoped command, almost exactly the one observed.
3. A CLI agent's shell runs inside the container through `docker exec`, so it never passes through `run_sandbox_command` and its blocklist. Nothing refused an unscoped run on either path.
4. The sandbox service had no CPU ceiling, and vitest had no worker cap, so one run fanned out one worker per core.
5. When the changed files were unknown, `runSandboxTests` itself fell back to `pnpm test`, which is the whole suite.

Ruled out: the platform's scoped path (`coding-agent.test.ts` proves it runs only derived files), and the local-CI gate's own suite (BI-2227C37C, separate). The observed process tree (`docker top`) belonged to the agent CLI, not the platform verifier.

## Design

One rule, stated once in `apps/web/lib/build/sandbox/test-scope-guard.ts`: a test run is **scoped** when it names test files, uses `vitest related`, or passes a changed/related flag (`--changed`, `--findRelatedTests`, `--onlyChanged`, …). Anything else is **unscoped**. The full suite belongs to cloud CI and the merge queue (AGENTS.md §4: "the heavy build runs once, in the cloud").

The rule is enforced at the two places every route passes:

- **`run_sandbox_command`** refuses an unscoped test run before it reaches the sandbox. Its existing safety blocklist moved unchanged out of `apps/web/lib/mcp/packs/sandbox-pack.ts` (a module at its size baseline) into `apps/web/lib/build/sandbox/sandbox-command-guard.ts`, beside the new test-scope check. The refusal names `run_sandbox_tests` and the scoped command, and is logged as build activity.
- **The runner config inside the sandbox.** `apps/web/vitest.config.ts` and `apps/mobile/jest.config.js` call the guard when the sandbox env sets `DPF_SANDBOX_TEST_SCOPE=enforce`. This covers CLI agents (claude / codex / grok / opencode) whose shell bypasses the MCP tool. Outside the sandbox the guard does nothing, so CI, local-CI and developer runs are unchanged. Mobile is its own pnpm workspace and cannot import the web module, so its config mirrors the argv rule and points at the canonical file.

We chose refusal over rewriting. A rewrite would need the build's changed files inside a runner config. `run_sandbox_tests` already derives the scoped set, and the refusal points the agent at it.

**Recording.** Every guarded decision inside the sandbox, allowed or refused, is appended as one JSON line to `$DPF_SANDBOX_TEST_SCOPE_LOG` (default `/tmp/dpf-test-scope-guard.jsonl`), with runner, decision, cwd and args. An unwritable log never lets an unscoped run through. A `run_sandbox_command` refusal is also written to the build's activity log and returned as `data.testScopeGuard`.

**Recording only what ran (BI-CEE688D6).** `runSandboxTests` no longer runs `pnpm test` when the changed files are unknown. It reports `scope: "none"` with "no tests ran", and the gauntlet evidence says the changed files were unknown. `"full"` stays in the type only so that older records still type-check.

**Resource envelope.** This is a convergence surface: the sandbox service in `docker-compose.yml` gains `cpus: "4.0"`, plus `DPF_SANDBOX_TEST_SCOPE=enforce`, `VITEST_MAX_WORKERS=2` (read by Vitest itself) and `DPF_JEST_MAX_WORKERS=2`. The service-level `cpus` key is used because compose refuses a `deploy.resources.limits` block beside the existing `pids_limit`. The budget is declared in `config/install-resource-budgets.json` under `optionalProfileServices.sandbox`. No memory ceiling is set yet, because `next build` and `tsc` in the sandbox have not been sized.

## Deliverables, in order

1. Guard module plus tests: `test-scope-guard.ts`, `test-scope-guard.test.ts`.
2. `run_sandbox_command` refusal (`sandbox-command-guard.ts` plus test) and the scoped `run_sandbox_tests` / `run_sandbox_command` descriptions (`sandbox-pack.ts`).
3. Runner-config enforcement: `apps/web/vitest.config.ts`, `apps/mobile/jest.config.js`.
4. Prompt rewrite: `build-agent-prompts.ts`, `prompts/build-phase/build.prompt.md`, `prompts/specialist/qa-engineer.prompt.md`, the QA role instruction in `agent-cli-runtime.ts`, and the synthetic QA task title in `task-dependency-graph.ts` ("Scoped verification: changed-file tests + typecheck").
5. Retire the whole-suite fallback in `runSandboxTests`, and make the gauntlet evidence wording truthful (`run-and-record-gauntlet.ts`).
6. Sandbox resource envelope (`docker-compose.yml`, `config/install-resource-budgets.json`).

## Acceptance

- A Build Studio build's agent-initiated test runs are scoped to its changed and related files. An unscoped full-suite command in the sandbox is refused, and the refusal is recorded (build activity for `run_sandbox_command`; the JSONL record for the runner-config guard).
- The sandbox container is CPU-bounded (`cpus: "4.0"`), and vitest/jest workers are capped at 2 in its env, so one verifying build cannot close the local-CI pool for `host-cpu-high` on its own.
- The prompts and the `run_sandbox_tests` description no longer say "full test suite".
- A scoped run still catches a failing test related to a changed file (regression test in `coding-agent.test.ts`).

## Not in scope

BI-2227C37C (the local gate runs the exhaustive suite unsharded), BI-2B8D67A9 (TS 7 / tsgo), BI-6F67D5FA (runner choice, already delivered), BI-F3422349 (bound hung exhaustive Vitest stages).
