# Plan backlog coverage enforcement

**Backlog item:** `BI-C24C83FA`
**Epic:** `EP-5560770F` — Development Process Spine
**Decision:** `DI-150BA6EB980F` — MCP-backed coverage receipt
**Plan size:** large

## Outcome

Prevent a plan from being treated as complete when independently shippable future work exists only in Markdown. The canonical coverage decision lives on the umbrella `BacklogItem` as a structured activity; repository plans record the returned receipt and mappings, plugin hooks stop source implementation when required coverage is absent or unverifiable, and Build Studio decomposition produces the same live BacklogItem coverage.

## Backlog coverage

- Decision: atomic
- Parent: `BI-C24C83FA`
- Rationale: The MCP receipt contract, plugin guard, Build Studio materialization, skill/AGENTS pointers, and CI backstop are one cross-surface invariant. Shipping any layer independently would leave at least one delivery surface able to bypass the rule, so the phases below are implementation sequencing rather than independently shippable product slices.
- Dependencies: none
- Receipt: `cmrsnvwuv01n501pga4ag60w2`

This receipt was written through the pre-existing governed `record_execution_evidence` MCP path as a structured `manual_check`, because the dedicated recorder cannot exist before its own landing PR. `check_plan_backlog_coverage` recognizes this one bootstrap envelope and applies the same live validation; all subsequent plans use `record_plan_backlog_coverage` directly.

## Phase 1 — Define and test the canonical coverage decision

Create a pure planning/backlog coverage validator over the existing `BacklogItem` and `BacklogItemActivity` substrate. Test first:

- an xlarge umbrella with five independently shippable future deliverables fails until every deliverable maps to a live BI;
- an atomic phased plan with a substantive rationale passes;
- mapped existing BIs pass without creating duplicates;
- dependency references must resolve inside the declared deliverable set.

Verification: targeted Vitest red/green run for the new validator.

## Phase 2 — Expose the governed MCP receipt

Add `record_plan_backlog_coverage` to the decomposition tool pack. It validates the umbrella and mapped BI rows, records one structured `plan_backlog_coverage` activity, and returns a receipt ID. Missing rows return a decomposition-required verdict; a write-scope failure remains an MCP `insufficient_token_scope` result and is never bypassed.

Verification: tool-pack contract tests plus service tests for audit payloads and non-mutation on failure.

## Phase 3 — Enforce external-agent planning before source edits

Add a fail-closed plugin `PreToolUse` guard for source mutations. For a changed DPF plan anchored to an xlarge BI, the guard calls the MCP read path and permits implementation only when the plan records a matching live coverage receipt. MCP unreachable, invalid receipt, or missing scope produces a visible denial. Update `dpf-writing-plans` and `dpf-file-backlog-item` to point to the receipt contract rather than duplicating it.

Verification: hook fixtures cover five missing slices, atomic rationale, existing mappings, MCP failure, and insufficient scope; plugin-wiring and fresh-bootstrap tests prove distribution to Claude, Codex, Grok, and Antigravity manifests.

## Phase 4 — Bring Build Studio and in-portal coworkers to parity

Extend `approve_decomposition` so each selected child scope owns a live child BacklogItem (or explicitly supplied existing mapping) and the originating umbrella records the same coverage receipt plus dependency mapping. Extend `record_decomposition_override` to record the atomic rationale on the originating BI. Return BI IDs alongside child FeatureBuild IDs so the plan/timeline can show the mapping.

Verification: existing decomposition tests assert atomic rollback, one child BI per child build, dependency mapping, existing-mapping reuse, and atomic override activity.

## Phase 5 — Add repository backstop and durable guidance

Extend the process-spine CI checker to reject changed xlarge plans that lack the canonical backlog-coverage block/receipt. Update the Development Process Spine spec and add a concise AGENTS.md pointer. Do not duplicate validation rules in prose; docs name the MCP receipt and hook as the authority.

Verification: process-spine fixtures cover rejected Markdown-only slices and accepted atomic/mapped plans; documentation gate passes.

## Phase 6 — Governed verification and delivery

Run targeted tests and web typecheck in the compile-ready worktree. Lease `local-integration-ci` for merged-code Vitest, typecheck, production build, migration convergence, and runtime MCP verification. Refresh the DPF plugin/toolchain into a clean fixture and prove the new guard is present for the next task. Record evidence on `BI-C24C83FA`, open a ready non-draft DCO-signed PR, run `pnpm pr:health`, enter the merge queue, and verify the merge.

## Risks and rollback

- **False positive on ordinary phased plans:** only xlarge work is hard-gated; atomic rationale is explicit and auditable.
- **Duplicate child BIs:** existing mappings are resolved before creation and the Build Studio transaction is atomic.
- **Plugin/runtime version skew:** the guard reports an actionable MCP-unavailable/tool-missing denial; bootstrap conformance tests keep plugin and runtime definitions aligned.
- **Build Studio regression:** child BI creation is additive and transaction-bound; rollback is the PR revert, which restores prior FeatureBuild-only decomposition without a schema rollback.

## Architecture review

The DPF architecture-review pass is aligned. The correction reuses `BacklogItem`, `BacklogItemActivity`, Work Capsule branch claims, the existing decomposition transaction, MCP tool packs, and the versioned plugin installer; it adds no table, lifecycle enum, or competing plan registry. The review identified two atomicity/distribution risks that were folded into implementation: the Build Studio atomic override now writes its design update and coverage activity in one transaction, and the standalone updater explicitly installs the write guard into Codex and Grok hook planes rather than assuming bundled plugin hooks are live. The one-time bootstrap receipt uses governed manual evidence because the dedicated recorder cannot precede its own landing; the read tool validates that envelope with the same live invariant.

## Post-merge acceptance correction

The first real 0.2.3 refresh proved that copying the managed plugin and invoking each CLI's `install` command was insufficient: Claude retained an older cached plugin, while Grok rejected the duplicate install and retained 0.2.2. The updater must therefore exercise each client's replacement path, not merely report that the marketplace and managed copy converged.

- Claude runs `plugin update` after marketplace registration and installation so an existing cache advances to the manifest version.
- Grok detects an installed DPF plugin, preserves its data, uninstalls the stale cache, and reinstalls from the refreshed managed copy.
- Plugin manifests advance to 0.2.4 and the process-spine version advances to 2026.07.20.1 so new sessions have explicit refresh boundaries.
- Fixture tests cover both a fresh Grok install and stale-cache replacement, plus the Claude update command.
