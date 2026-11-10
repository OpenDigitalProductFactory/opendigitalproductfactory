---
status: active
---

# Unproven process spine carries the operating contract: implementation plan

Implements BI-545943EE against
[the design](../specs/2026-09-25-unproven-process-spine-carries-contract-design.md).
AC-PS-01 to AC-PS-04 are the definition of done.

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Phase 1: generator and derived artifact

- New `packages/dpf-skill-pack/scripts/generate-operating-contract.mjs`:
  - It reads the `principleDirection` frontmatter of the three kernel pages
    (design §3.2) and the AGENTS.md bullet anchored on
    `**Kernel principles (Surface C) are the durable doctrine store.**`.
  - It fails loudly if any source is missing or empty. It never emits a
    partial contract.
  - It writes `packages/dpf-skill-pack/hooks/operating-contract.generated.mjs`.
- Register the artifact with the derived-artifact gate (`scripts/derived-artifacts-gate.mjs`
  registry, following the `doc-index` entry). Sources: the three page files
  plus `AGENTS.md`.
- Test: `generate-operating-contract.test.mjs` checks that the generated file
  equals a fresh generation, and that a missing source throws.

## Phase 2: the hook disposition

- `hooks/process-spine-health-check.mjs`:
  - `renderProcessSpineSummary` leads with
    `Process spine: VERIFIED | UNPROVEN | BROKEN`.
  - The restart advice appears only for BROKEN.
  - The contract lines are appended for UNPROVEN and BROKEN.
  - `main()` is refactored to return `{ exitCode, stdout }` through a thin
    `run(args)`, so tests can drive the `--hook` path without spawning a
    process.
- Tests in `process-spine-health.test.mjs`, red first:
  - `--hook` UNPROVEN output is valid JSON, its first line is UNPROVEN, it
    carries all four contract lines, and it has no restart advice;
  - BROKEN carries the restart advice and the contract;
  - VERIFIED emits nothing;
  - the existing 7 tests are updated for the new first line.
- `grok-session-start.mjs` merges the same `additionalContext`, so check that
  its test still passes.

## Phase 3: release

- Bump `.claude-plugin`, `.grok-plugin`, `.antigravity-plugin` and
  `.codex-plugin` manifests plus `PROCESS_SPINE_VERSION`, as commit
  5c305027048 did, and correct the stale marketplace version.
- Update `docs/architecture/skill-surfaces-runbook.md:7`: an UNPROVEN spine
  carries the generated contract. This is a pointer to the mechanism, not a
  restated rule.

## Completion gate

- `node --test packages/dpf-skill-pack/hooks/*.test.mjs packages/dpf-skill-pack/scripts/*.test.mjs`
- `node scripts/derived-artifacts-gate.mjs --check`
- `pnpm run pregate`
- Live (AC-PS-04): after the plugin updates on this host, a fresh Claude
  Code session's SessionStart context shows UNPROVEN and the contract.

## Risks and rollback

- **A hook crash would drop all SessionStart context.** The hook keeps its
  exit-0 contract, and the generated module is a static import with no
  runtime file reads.
- **Contract drift.** The derived-artifact gate fails CI on it.
- The change is one PR and reverts cleanly. The version bump is the only
  client-visible effect.

## Traceability

| Deliverable | Requirements | Contracts | Flows | Verification |
|---|---|---|---|---|
| D1 unproven spine carries the generated operating contract | OBJ-PS-1, OBJ-PS-2 | `hooks/operating-contract.generated.mjs`; `renderProcessSpineSummary` | SessionStart hook additionalContext | AC-PS-01, AC-PS-02, AC-PS-03, AC-PS-04 |

## Backlog coverage

Umbrella: BI-545943EE. Decision: `atomic`. The generator has no consumer
without the hook change, and the hook change has no content without the
generator. Coverage receipt: recorded after spec approval mints the baseline.
