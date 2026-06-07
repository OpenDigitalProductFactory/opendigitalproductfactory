# Plan: EP-GROK-001 Phase 0 — Grok Executor Kind, MCP Enums, Token Snippet (BI-GROK-001/002/003)

**Epic:** EP-GROK-001: First-class Grok support  
**BIs:** BI-GROK-001 (executor kind), BI-GROK-002 (MCP provider enums), BI-GROK-003 (--format grok)  
**Design:** [2026-05-31-grok-first-class-support-design.md](../specs/2026-05-31-grok-first-class-support-design.md)  
**Status:** Ready for implementation (substrate verified)  
**Worktree:** `feat/grok-first-class-support` at `~/dpf-worktrees/DPF-grok-first-class-support` (branched from origin/main, MCP seeded, COMPOSE_PROJECT_NAME=dpf-grok-first-class-support)  

**Verification discipline (per AGENTS.md §4/§5/§6 + kernel principle `worktree-is-source-control-not-runtime` as of commit 077c9db8 / PR #1399):**  
- Cheap/source-local checks (targeted vitest, `pnpm --filter web typecheck`, lint) may run inside this worktree.  
- All runtime-bound gates (`next build` against the production bundle, full UX verification against the served portal, migration apply against live Postgres, MCP-touching integration that requires a running platform) **must** run against the canonical local install (root Docker stack) **or** (for concurrent threads) the shared local-CI convergence sandbox by leasing `claim_nonprod_environment_lease(environmentKey="local-integration-ci")`.  
- A worktree-only "green" on a runtime gate is only a source-control checkpoint, **not** canonical execution evidence. Re-run via the leased sandbox and record the result (via `record_local_integration_result` / `record_execution_evidence` MCP or the `dpf-local-merge-ci-before-push` skill). Harness friction in the worktree (pnpm, symlinks, Prisma client, etc.) is a harness limitation, not a product defect.  
- Before push or opening a PR, the `dpf-local-merge-ci-before-push` discipline (or direct `node scripts/local-integration-ci.mjs --candidate feat/grok-first-class-support`) + lease is required. See the updated AGENTS.md §5 "Where each gate runs" and the linked commandment-tier principle.

## Context & Substrate Verification Summary (dpf-verify-substrate-first + live MCP)

- **Executor coordination (BI-GROK-001):** Single source of truth is `WORK_CAPSULE_EXECUTOR_KINDS` const + `isWorkCapsuleExecutorKind` + `isExternalLeaseExecutor` (apps/web/lib/work-capsules.ts:27, work-capsule-store.ts:102, mcp-handlers.ts). Used by:
  - create/adopt WorkCapsule (store + MCP handlers)
  - lease logic (external desktop agents get time-bounded leases)
  - MCP tool schemas (via workCapsuleToolEnums → WORK_CAPSULE_TOOL_ENUMS in mcp-tools.ts)
  - Tests (exact array assertions in work-capsules.test.ts, work-capsule-enum-parity.test.ts, mcp-tools-work-capsules.test.ts, presenters, portal-context tests)
  - No other "grok" or third desktop agent exists (grep + live DB sweep via MCP confirmed only the design spec references the gap).

- **MCP provider/ownerProvider (BI-GROK-002 overlap):** Hardcoded string enums in `apps/web/lib/mcp-tools.ts` for:
  - `claim_nonprod_environment_lease` → `ownerProvider`: ["build-studio", "claude", "codex", "coworker"]
  - `record_external_development_evidence` (and related) → `provider`: similar short forms ("claude", "codex")
  - Descriptions mention "codex or claude".
  - These feed the governed MCP surface (adopt_worktree already uses the executor enum, which will auto-include once KINDS updated).

- **Token issuance (BI-GROK-003):** 
  - Type + emitters: `apps/web/lib/auth/mcp-setup-snippets.ts` (McpSnippetFormat union + buildSetupSnippets producing claudeCode/codex/vscode blocks; Codex is the TOML env-var pattern).
  - CLI: `apps/web/scripts/issue-mcp-token.ts` (default "claude-code", validation, switch, help text, examples).
  - Server action: `apps/web/lib/actions/mcp-tokens.ts` (calls buildSetupSnippets for Admin UI responses; returns the snippets object).
  - Host writer + UI components consume the returned snippets (tabs/select for formats).
  - Current user env already demonstrates the target state (`~/.grok/config.toml` with `${DPF_MCP_BEARER_TOKEN}` + working `grok mcp list` showing dpf).

- **Live state (MCP as of filing 2026-05-31):** EP-GROK-001 + 9 BI-GROK-00x created and linked. No prior Grok executor/provider entries. Design spec is the SSoT.

**Risks / blast radius (low for Phase 0):**
- Adding to const + Set is additive and type-safe.
- Test assertions on the full array will need update (or they will fail the parity test).
- UI for token formats will be incomplete until frontend updated (CLI/script is primary for contributors; mark as follow-up in BI-003 or 009).
- No DB migration (pure TS const + runtime strings).
- No behavior change for existing agents.

**Dependencies between these BIs:** 001 (KINDS) enables correct executorKind in MCP for Grok; 002 extends the parallel short provider strings used in evidence/leases; 003 is mostly independent (token wiring) but completes the "onboarding" story for the session.

## Implementation Phases (ordered by dependency + risk)

### Phase 0.1: Executor Kind Substrate (primarily BI-GROK-001, enables parts of 002)
1. Edit `apps/web/lib/work-capsules.ts`:
   - Add `"grok-desktop"` to `WORK_CAPSULE_EXECUTOR_KINDS` (place after "claude-desktop" for logical grouping with other desktop agents).
   - Confirm `isWorkCapsuleExecutorKind` (uses Set from the const) and any other helpers continue to work (no changes needed).
2. Edit `apps/web/lib/work-capsules/work-capsule-store.ts:102`:
   - Extend `isExternalLeaseExecutor` to `|| executorKind === "grok-desktop"`.
3. Update call sites / validation that surface the list or error messages (they already delegate to the imported array / is* functions):
   - `apps/web/lib/work-capsules/mcp-handlers.ts` (error messages use the array; will auto-include).
4. Update tests that hard-assert the exact array or specific contains (minimal, targeted):
   - `apps/web/lib/work-capsules.test.ts`
   - `apps/web/lib/work-capsules-enum-parity.test.ts` (the MCP enum parity test)
   - `apps/web/lib/work-capsules/work-capsule-store.test.ts` (example data; add grok-desktop test case?)
   - `apps/web/lib/mcp-tools-work-capsules.test.ts`
   - Any presenter/portal-context tests that snapshot executor lists (prefer adding the value rather than changing expectations).
5. Spot-check other references (presenters, portal-context, build-studio-attachment) — most are example values or "unknown" fallbacks; no exhaustive lists outside the parity test.
6. **Verification for this phase (per updated AGENTS.md doctrine):**  
   - Cheap checks (`pnpm --filter web typecheck`, targeted vitest on the touched files) may run inside this worktree.  
   - Any runtime-bound verification (full `next build`, integration that exercises the live MCP/work-capsule flows) must be executed against the leased `local-integration-ci` sandbox via `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` (or root canonical stack) and the result recorded as canonical-runtime evidence.  
   - Confirm via `grep` that "grok-desktop" appears exactly where expected. Run the parity test and specific unit tests. Before any push/PR, invoke `dpf-local-merge-ci-before-push` (or equivalent lease + merge script) and record the outcome on BI-GROK-001.

### Phase 0.2: MCP Tool Provider / OwnerProvider Enums (BI-GROK-002)
1. In `apps/web/lib/mcp-tools.ts`:
   - Locate the two (or more) inline enums for `ownerProvider` and `provider` in the claim_nonprod_environment_lease, record_external_development_evidence (and any sibling tools like release_).
   - Add `"grok"` (short form, matching "claude" / "codex" convention used by these tools; distinct from the full "grok-desktop" executorKind).
   - Update the free-text descriptions that say "codex or claude" → "claude, codex, or grok".
2. If any runtime validation or mapping exists for these provider strings (e.g. in nonprod lease code or evidence handoff), extend symmetrically (search for the current list).
3. Update any tests that assert exact provider enum values (mcp-tools-*.test.ts, governed-backlog-tee-up, etc.).
4. **Verification (per updated AGENTS.md doctrine):**  
   Typecheck + run MCP-related unit tests (cheap checks OK in worktree).  
   For any runtime-bound confirmation of the MCP tool schemas or lease behavior, execute via the leased `local-integration-ci` sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) and record canonical evidence. Re-inspect live MCP schemas (via the dpf MCP surface) after the portal in the isolated compose project has picked up the code. Before push/PR: run the full local-merge-ci discipline.

### Phase 0.3: `--format grok` Token Snippet (BI-GROK-003)
1. `apps/web/lib/auth/mcp-setup-snippets.ts`:
   - Extend `McpSnippetFormat` union with `"grok"`.
   - Add `grok: string;` to the `McpSetupSnippets` return type.
   - In `buildSetupSnippets`, produce a `grok` entry. Recommended: identical TOML to the existing `codex` emitter (Grok's config.toml uses the same `[mcp_servers.dpf]` + `bearer_token_env_var` pattern). Add a comment block explaining the target file (`~/.grok/config.toml` or project-local `.grok/config.toml`).
   - Export / include in the returned object.
2. `apps/web/scripts/issue-mcp-token.ts`:
   - Update the validation in `--format` handling to accept "grok".
   - Extend the switch / ternary that selects the snippet.
   - Update help text, usage examples, and the "Output (stdout)" section (add "grok        ~/.grok/config.toml snippet (same TOML shape as codex)").
   - Default remains claude-code; document Grok usage.
3. `apps/web/lib/actions/mcp-tokens.ts` (and any DTOs):
   - The returned `setupSnippets` object will automatically include the new `grok` field once the helper is updated (TypeScript will surface the type change).
   - Update any inline types that duplicate the shape (claudeCode | codex | vscode).
4. Frontend (Admin token issuance UI):
   - Locate the component(s) rendering format tabs / select / copy buttons (search for claudeCode / setupSnippets in .tsx files under apps/web/app or components).
   - Add a "Grok" tab or option that surfaces the new snippet (with guidance: "Add to ~/.grok/config.toml under [mcp_servers]").
   - This can be a follow-up commit under the same BI or BI-GROK-009 if it grows; CLI parity is the priority for contributors.
5. Update the test file `apps/web/lib/auth/mcp-setup-snippets.test.ts` (add case for "grok" format).
6. **Verification (critical for this BI, per updated AGENTS.md doctrine):**  
   - Cheap checks (Typecheck + the snippets unit test) may run in the worktree.  
   - The manual `--format grok` (and other formats) CLI test can be executed from the worktree (it is a pure script).  
   - Any end-to-end validation that exercises the running Admin UI, token issuance flow against a live portal, or MCP token handling must be performed against the leased `local-integration-ci` sandbox.  
   - Before push or PR: execute the `dpf-local-merge-ci-before-push` flow (or `node scripts/local-integration-ci.mjs --candidate feat/grok-first-class-support`) and record the merged-code gate result as canonical evidence on BI-GROK-003.

### Cross-cutting / Documentation in Phase 0
- Add a short note in the design spec (or a new section in the plan) confirming the chosen strings ("grok-desktop" for WorkCapsuleExecutorKind / leases; "grok" for the evidence/lease provider fields).
- If any seed data, agent registry, or static matrices mention the provider list, note them for BI-GROK-007 (do not block Phase 0).
- Record evidence in the BI(s) via MCP (`record_external_development_evidence`, `record_local_integration_result`, or activity on the capsule) — **all runtime-bound evidence must come from the canonical local install or the leased `local-integration-ci` sandbox per the updated AGENTS.md doctrine**.
- Update the copied design spec frontmatter if needed (status → "Phase 0 in progress").

### Verification Discipline — Updated AGENTS.md Doctrine (Mandatory for This Work)
This plan was refreshed after re-reading AGENTS.md in the worktree (post-commit 077c9db8 / PR #1399).

Key rules now in force (commandment tier):
- Worktree = source-control isolation only (`worktree-is-source-control-not-runtime` principle).
- Runtime-bound gates (next build, UX against served portal, live MCP behavior, migrations) → **shared local-CI convergence sandbox** via `claim_nonprod_environment_lease(environmentKey="local-integration-ci")` (one runtime leased sequentially by all worktrees).
- Harness friction inside the worktree is classified as a harness limitation, not a product defect. Reproduce on the leased sandbox instead.
- Execution evidence recorded for PRs/BIs must be canonical-runtime evidence from the leased sandbox (or root canonical stack), not worktree-only runs.
- Pre-push / pre-PR: Use the `dpf-local-merge-ci-before-push` skill (or direct `node scripts/local-integration-ci.mjs --candidate feat/grok-first-class-support`) + lease. Record the result via MCP before pushing.

All Phase 0 verification steps above have been adjusted to comply. The `dpf-local-merge-ci-before-push` flow is the next required action before any push or PR for this branch.

## Risks, Rollback, and Definition of Done per Phase
- **Risk:** Test breakage on array parity or snapshot tests. Rollback: revert the const addition; the parity test is the canary.
- **Risk:** MCP schema drift until portal in the worktree's compose project is restarted (`docker compose` with the isolated project name). Mitigation: document the restart step; use the worktree's .env.
- **Rollback per file:** Standard git revert of the 3-5 core files; no data impact.
- **DoD for Phase 0 (all three BIs) — updated per AGENTS.md doctrine:**
  - Cheap checks (typecheck + relevant unit tests including parity test) green when run from the worktree.
  - All runtime-bound gates (`next build`, any full integration/UX/MCP runtime behavior) executed and green via the leased `local-integration-ci` sandbox (`claim_nonprod_environment_lease(environmentKey="local-integration-ci")`) or root canonical stack.
  - CLI `--format grok` produces usable snippet (script run is acceptable from worktree).
  - Live MCP schemas (inspected via dpf MCP after isolated portal restart in the worktree's compose project) reflect the new values.
  - No behavior change for existing Claude/Codex paths.
  - Full pre-push merged-code gate executed via `dpf-local-merge-ci-before-push` (or equivalent lease + `local-integration-ci.mjs`) with result recorded as canonical evidence on the BIs.
  - Plan + changes explicitly reference the updated AGENTS.md §4/§5/§6, the `worktree-is-source-control-not-runtime` principle, and the live BI ids.
  - All execution evidence for runtime gates is from the canonical leased sandbox, not worktree-only runs.
  - Uncommitted changes in root clone untouched (voice work + original .grok symlinks remain isolated).

## Next After Phase 0 Green
- Commit on the topic branch (DCO -s), push, open PR (one concern: Phase 0 foundations).
- Update BI statuses via MCP (in-progress → done as evidence accumulates).
- Move to Phase 1 (BI-004 packaging in dpf-skill-pack + BI-005 bootstrap detection for Grok CLI).
- Use `dpf-pr-with-dco` + `dpf-finishing-a-development-branch` for the handoff.
- Full E2E / platform QA (BI-008) and docs (BI-009) later.

**Authoring note:** This plan was produced in the isolated worktree after live MCP filing of the BIs, full grep/read verification of the narrow waists, and adherence to AGENTS.md (worktree-per-session, verify-substrate, live-state, build-gate, etc.). All edits will target only this worktree.

See also: dpf-writing-plans, dpf-verify-substrate-first, dpf-architecture-review (recommended before merge), kernel principles invoked during this work (single-source-of-truth, architecture-over-shortcuts, worktree-per-session).

---

**Status after writing:** Ready to execute Phase 0.1 edits via search_replace on the worktree paths.