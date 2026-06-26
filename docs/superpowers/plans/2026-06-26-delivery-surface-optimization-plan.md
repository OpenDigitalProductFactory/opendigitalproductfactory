---
title: Delivery-Surface Optimization - implementation plan
status: ready
date: 2026-06-26
owner: platform
reviewed_by: codex-desktop
work_capsule: WC-9E77B289
design: docs/superpowers/specs/2026-06-26-delivery-surface-optimization-study-design.md
backlog:
  - BI-79A5C00F
  - BI-0FD9E685
  - BI-3047C122
  - BI-14E9F7CE
  - BI-4B8EABF8
---

# Delivery-Surface Optimization - implementation plan

This plan sequences the five routed backlog items from the study. Each item should ship independently through its owning epic. The common theme is to make the four delivery surfaces equivalent in governed outcomes while reducing repeated session friction and token waste.

The plan is intentionally verification-heavy. Structural presence is not enough: if a hook is declared, prove it fires; if a worktree says `compile-ready`, prove a cheap local gate runs; if a prompt-cache boundary is emitted, prove cache-read tokens appear.

## Preconditions for every BI

1. Claim or reuse a Work Capsule before editing.
2. Check branch guard: do not implement on `main` or detached HEAD.
3. Query live backlog for overlap before creating new items.
4. Call `get_code_graph_freshness`. If ready, use `search_code_graph` or `trace_code_surface` before broad text search, then confirm exact source with file reads.
5. Keep changes to one concern per branch and PR.
6. Use source-local tests only when the worktree is `compile-ready`; otherwise use the shared local-CI convergence sandbox or canonical runtime for runtime-bound gates.
7. Record evidence in the Work Capsule and PR body.

## Phase order

| Phase | BI | Purpose | Dependency |
|---|---|---|---|
| 0 | BI-4B8EABF8 | Normalize the living capability tracker and refresh loop baseline | none |
| 1 | BI-79A5C00F | Reduce repeated Anthropic stable-prefix cost | Phase 0 source facts |
| 1 | BI-0FD9E685 | Make direct external sessions use code graph by default | none |
| 2 | BI-14E9F7CE | Prove and repair hook behavior across Codex and Grok | Phase 0 matrix |
| 2 | BI-3047C122 | Make worktrees compile-ready through managed dependency bootstrap | hook/worktree source review |

Phase 0 comes first because the capability tracker is the durable source of truth. Phase 1 ships the fastest leverage. Phase 2 closes correctness seams with client-specific functional verification.

## Phase 0 - capability tracker and refresh loop baseline

Backlog: `BI-4B8EABF8`.

Goal: extend the existing living record instead of creating a duplicate matrix.

Files to inspect or update:

- `docs/architecture/agent-client-capability-parity.md`
- `docs/architecture/context-engineering-standards.md`
- `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md`
- scheduled task substrate from the landed scheduling work
- backlog tooling for material drift items

Implementation steps:

1. Update `docs/architecture/agent-client-capability-parity.md` with the corrected 2026-06-26 findings:
   - Codex hooks are official and plugin-bundled hooks are documented.
   - DPF has structural hook wiring for Claude, Codex, and Grok.
   - Functional hook proof remains pending for Codex and Grok.
   - Active MCP token env var is `DPF_MCP_BEARER_TOKEN`.
   - Anthropic explicit cache-control emission is a DPF gap; OpenAI and xAI caching are automatic but still need hit-rate observability.
2. Add or refine the refresh ritual so a monthly scheduled agent:
   - reads official vendor docs;
   - diffs the tracker;
   - files a backlog item for material drift;
   - records sources and verification age.
3. Keep the tracker as docs-first unless a UI consumer already exists. Do not create a dashboard in this BI.

Tests and verification:

- Markdown/lint checks if available for docs.
- Source search proving the updated tracker is the only durable matrix for these client facts.
- Dry-run or unit-test the scheduled steward if implemented in this BI.
- Work Capsule evidence with source URLs and local files inspected.

Acceptance criteria:

- The tracker carries a `Last verified` value for the 2026-06-26 refresh.
- Each material gap links to an owning BI or explicitly says deferred.
- The refresh process is runnable by an agent without asking the operator to research manually.

Rollback:

- Revert tracker edits and disable any scheduled task. No runtime data migration should be required.

## Phase 1A - Anthropic prompt-cache boundary emission

Backlog: `BI-79A5C00F`.

**Status (2026-06-26): implemented** on `feat/anthropic-prompt-cache-breakpoint-bi-79a5c00f` (capsule WC-68ABAA4C). New `apps/web/lib/routing/anthropic-cache.ts` `buildAnthropicSystem()` splits the assembled system prompt on the boundary and attaches `cache_control:{type:"ephemeral"}` to the stable prefix in the Anthropic branch of `chat-adapter.ts`; the boundary constant was extracted to a dependency-free `apps/web/lib/tak/prompt-boundary.ts` (so the routing path/tests do not import the DB-coupled assembler). The 5-minute TTL (GA, no beta header) shipped; the 1-hour TTL is a tracked follow-up pending confirmation of the extended-cache beta header. Unit tests in `anthropic-cache.test.ts`; the live cache-read check (turn-2 `cache_read_input_tokens > 0`) remains as functional verification.

Goal: make DPF exploit the stable/dynamic prompt split it already builds.

Files to inspect or update:

- `apps/web/lib/tak/prompt-assembler.ts`
- `apps/web/lib/inference/routed-inference.ts`
- `apps/web/lib/routing/chat-adapter.ts`
- Anthropic adapter/request assembly under `apps/web/lib/routing/`
- usage telemetry and tests around cache token fields
- MCP route/tool-tier files only if the BI also includes external tool-surface slimming

Implementation steps:

1. Add focused tests first:
   - request assembly preserves the existing prompt text;
   - stable and dynamic blocks split on `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`;
   - Anthropic request includes cache-control only for stable cacheable content;
   - dynamic user/task content is never included in the cached block;
   - non-Anthropic providers are unchanged.
2. Locate the exact Anthropic request assembly seam. Do not assume the shim path; `apps/web/lib/routed-inference.ts` re-exports the implementation under `apps/web/lib/inference/routed-inference.ts`.
3. Implement the smallest provider-specific cache-control addition:
   - prefer Anthropic automatic cache-control if it safely caches the stable prefix;
   - use explicit block-level breakpoints if exact placement is required;
   - keep provider-specific request shape out of general prompt assembly where possible.
4. Ensure cache telemetry remains visible:
   - `cache_creation_input_tokens` should appear on the first qualifying turn;
   - `cache_read_input_tokens` should be greater than zero on a repeated-prefix second turn.
5. If including the companion MCP tool-surface lever, make external discovery prefer a core tier only through an explicit compatibility path. Do not silently remove tools from existing clients that expect the full surface.

Tests and verification:

- Targeted unit tests for Anthropic request assembly and telemetry parsing.
- Existing routing/chat-adapter tests.
- A live or controlled Anthropic verification call when credentials and policy allow it; otherwise record that live provider verification is blocked and keep the unit evidence explicit.
- Confirm OpenAI/xAI request paths are unchanged because their cache mechanisms are automatic.

Acceptance criteria:

- Anthropic-routed long sessions can show a cache write followed by a cache read for the stable prefix.
- No dynamic task content is cached by mistake.
- Non-Anthropic providers have no behavior regression.

Rollback:

- Feature-flag or remove the provider-specific cache-control emission. The prompt boundary itself remains.

## Phase 1B - code graph standing rule for external sessions

Backlog: `BI-0FD9E685`.

Goal: direct Claude/Codex/Grok sessions should use the same graph intelligence Build Studio already uses.

Files to inspect or update:

- `AGENTS.md`
- `apps/web/lib/integrate/build-agent-prompts.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/actions/coworker-tool-budget.ts`
- optional hook nudge in `packages/dpf-skill-pack/hooks/tool-economy-precheck.mjs`

Implementation steps:

1. Add a concise rule to `AGENTS.md`:
   - call `get_code_graph_freshness` before broad code discovery when blast radius matters;
   - if ready, use `search_code_graph` or `trace_code_surface`;
   - confirm with exact source reads;
   - use `find_related_tests` for changed files.
2. Avoid long procedural duplication. Point to the capability tracker and code graph docs where detail already exists.
3. If a hook nudge is added, keep it advisory and low-token.

Tests and verification:

- Documentation link/path checks.
- If a hook nudge changes, run the hook unit tests.
- Start or simulate a fresh external session and verify the rule leads to a code graph call before broad source search.

Acceptance criteria:

- External agents have an operational, concise standing rule.
- Build Studio prompt behavior remains unchanged.
- The rule does not expand every session prompt with long tool documentation.

Rollback:

- Revert the `AGENTS.md` addition or disable the advisory hook.

## Phase 2A - Codex and Grok hook functional verification

Backlog: `BI-14E9F7CE`.

Goal: prove guard hooks actually execute and block where required on Codex and Grok, then fix only the proven portability defects.

Files to inspect or update:

- `packages/dpf-skill-pack/hooks/hooks.json`
- `packages/dpf-skill-pack/hooks/run-hook.mjs`
- `packages/dpf-skill-pack/hooks/*.mjs`
- `packages/dpf-skill-pack/hooks/plugin-hooks-wired.test.mjs`
- `packages/dpf-skill-pack/.codex-plugin/plugin.json`
- `packages/dpf-skill-pack/.grok-plugin/plugin.json`
- `packages/dpf-skill-pack/codex.mcp.json`
- `packages/dpf-skill-pack/grok.mcp.json`
- any bootstrap or installer code that materializes plugins

Implementation steps:

1. Add or update structural tests first:
   - manifest hook path stays inside each plugin root;
   - hook commands resolve with the right root variable for each client;
   - MCP descriptors use `DPF_MCP_BEARER_TOKEN`.
2. Build a functional matrix:
   - Claude Code: known-good baseline.
   - Codex: run a safe command that should be denied by the lease/root/compose guard and capture hook output.
   - Grok: same denial proof, or record a concrete blocker if the client cannot be exercised locally.
3. Fix only what the matrix proves:
   - root-variable fallback;
   - hook trust/setup instructions;
   - wrapper script path;
   - event schema mismatch.
4. Remove or update stale docs that imply `DPF_MCP_TOKEN` is active for current setup.

Tests and verification:

- `pnpm --filter` targeted tests for hook wiring if package scripts support it.
- Direct node-based tests for hook scripts where available.
- Functional client evidence per surface, recorded in the Work Capsule.
- Secret scan for any touched setup snippets.

Acceptance criteria:

- Codex and Grok have recorded pass/fail functional evidence for each critical guard.
- Any remaining failure is a named backlog item with reproduction steps and expected vs actual behavior.
- Active config and docs agree on `DPF_MCP_BEARER_TOKEN`.

Rollback:

- Revert client-specific hook fallback changes. Preserve Claude baseline.

## Phase 2B - managed worktree compile-readiness

Backlog: `BI-3047C122`.

**Status (2026-06-26): bootstrap helper shipped** — `scripts/lib/bootstrap-worktree-deps.mjs` provides the idempotent, fail-safe managed dependency bootstrap (shared pnpm store, `--frozen-lockfile`, never mutates the root clone, never junctions). `classifyReadiness()` marks `compile-ready` only after deps resolve AND a cheap gate passes; any failure -> `source-only`. Pure logic unit-tested (`node --test scripts/lib/bootstrap-worktree-deps.test.mjs`, 2/2). Follow-up slice: invoke it from `seed-worktree-mcp` / a `dpf worktree --bootstrap` CLI (NOT the blocking WorktreeCreate hook), wire the real cheap gate, and update `.dpf-worktree-readiness.json`.

Goal: reduce manual setup friction without coupling worktrees unsafely to the root clone.

Files to inspect or update:

- `scripts/dpf-bootstrap-agent-toolchain.ps1`
- `scripts/dpf-bootstrap-agent-toolchain.sh`
- `scripts/seed-worktree-mcp.ps1`
- `scripts/seed-worktree-mcp.sh`
- `scripts/sync-mcp-worktrees.ps1`
- `scripts/sync-mcp-worktrees.sh`
- `packages/dpf-skill-pack/hooks/worktree-create.mjs`
- `scripts/lib/junction-safe-worktree-remove.mjs`
- any package-manager readiness helpers

Implementation steps:

1. Spike options in order:
   - managed `pnpm install` or equivalent using the shared pnpm store;
   - lockfile-compatible dependency bootstrap;
   - junction/symlink only if deletion, janitor, and root safety are proven.
2. Add tests around readiness classification:
   - no dependencies -> `source-only`;
   - dependencies resolved and cheap gate passes -> `compile-ready`;
   - failed dependency bootstrap -> `source-only` plus clear evidence, not a broken worktree.
3. Implement idempotent bootstrap behavior:
   - never mutate the root clone;
   - never run destructive cleanup through a junction;
   - do not run `npx`; use pinned workspace tooling;
   - keep Windows PowerShell scripts ASCII.
4. Update readiness evidence and docs so agents know which gates are valid locally.

Tests and verification:

- Script unit tests if present; otherwise safe dry-runs in a temporary worktree path.
- Create or adopt a test worktree and prove a cheap local command can run only after readiness is marked `compile-ready`.
- Verify source-only fallback still works.
- Verify junction-safe removal behavior if any link strategy is adopted.

Acceptance criteria:

- A new worktree can become `compile-ready` through a managed, repeatable path.
- Worktree creation does not fail if dependency bootstrap fails.
- No root clone dependency directory is placed at risk.
- Runtime-bound gates still route through canonical runtime or the shared local-CI sandbox.

Rollback:

- Disable dependency convergence and fall back to current readiness classification.

## Cross-cutting verification checklist

Before each PR is called ready:

- Targeted unit tests for touched code.
- Production build if the change touches app code or shared runtime behavior.
- UX or functional surface verification where the BI affects an agent/client workflow.
- Migration apply only if a migration is added.
- Work Capsule evidence for commands, client versions, and any blocked gates.
- Update `docs/architecture/agent-client-capability-parity.md` when a client capability fact changes.

For docs-only changes:

- ASCII and trailing-whitespace scan.
- Link/path sanity check for local references.
- Source URLs included for vendor claims.
- Live backlog/capsule evidence recorded.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Vendor docs change again before implementation | Treat the capability tracker as living; refresh before each client-specific BI. |
| Hook structural tests pass but client ignores hooks | Require functional denial evidence per client. |
| Prompt cache controls accidentally cache volatile content | Test stable/dynamic split; explicitly assert dynamic content is outside cacheable blocks. |
| Worktree bootstrap slows creation too much | Make dependency convergence optional and idempotent; preserve source-only fallback. |
| Root clone or dependency directory is damaged by links | Avoid root `node_modules` junction by default; require junction-safety proof before any link strategy. |
| Tool-surface slimming hides needed MCP tools | Use explicit tiers and compatibility paths; do not silently remove full-surface access. |

## Open follow-ups

- WWMD/kernel decision consolidation should be handled under its own epic or BI after live backlog confirmation.
- Outbound webhooks should wait for a concrete consuming workflow.
- Gemini CLI, OpenCode, and Aider should remain benchmark comparators unless the tool evaluation pipeline approves broader DPF support.
