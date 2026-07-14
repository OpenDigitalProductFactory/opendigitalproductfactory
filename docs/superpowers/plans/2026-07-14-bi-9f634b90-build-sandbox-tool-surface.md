# BI-9F634B90 — Build Studio specialist CLI sandbox tool-surface recovery plan

Backlog item: `BI-9F634B90` — Build Studio specialist CLI session lacks the sandbox tool set and stalls after engine dispatch.

## Grounding

- Live backlog: `BI-9F634B90` is a medium, triaged-for-build bug with no existing spec/plan.
- Current substrate:
  - `apps/web/lib/integrate/build-pipeline.ts` has an older agentic-loop path that attaches build-phase platform tools.
  - `apps/web/lib/integrate/build-orchestrator.ts` has the current CLI specialist dispatch path for Codex, Claude, Grok, and OpenCode.
  - `apps/web/lib/integrate/sandbox/agents/*-agent-runner.ts` executes vendor CLIs inside the sandbox; those runners do not receive the platform `toolsForProvider` list.
  - `apps/web/lib/integrate/specialist-prompts.ts` and `prompts/build-phase/build.prompt.md` still describe platform sandbox tool names such as `read_sandbox_file`, `edit_sandbox_file`, and `run_sandbox_tests`.

## Plan

1. Add a detector for the BI failure text: CLI output that says the sandbox tool set is missing or not exposed while naming required sandbox tools.
2. In `dispatchSpecialist`, when a CLI runner returns that detector, emit a retry event and fall through to the existing agentic-loop path instead of returning a blocked specialist result.
3. Preserve the native CLI path for normal task output and ordinary test/typecheck failures.
4. Add focused unit coverage so the exact BI text is classified as blocked/tool-surface mismatch, while ordinary `run_sandbox_tests` failures remain `DONE_WITH_CONCERNS`.

## Verification

- Focused: `pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts`
- Typecheck: `pnpm --filter web typecheck`
- PR/CI: required before marking the BI done.

## Rollback

Revert the detector/fallback wiring in `build-orchestrator.ts` and its corresponding tests. The change is isolated to dispatch classification and does not alter sandbox tool implementations or provider credentials.
