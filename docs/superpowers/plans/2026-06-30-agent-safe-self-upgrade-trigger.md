# Agent-Safe Self-Upgrade Trigger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MCP-accessible self-upgrade trigger that uses the existing governed self-upgrade pipeline and requires human override outside allowed maintenance windows.

**Architecture:** Extract the current UI action's run creation and Inngest dispatch into a shared request service. Add an agent request mode that evaluates the same effective maintenance window as scheduled self-upgrade before any run is created. Wire MCP to the shared service and keep `force` unavailable to agents.

**Tech Stack:** Next.js server actions, Vitest, DPF MCP tool packs composed by `apps/web/lib/mcp-tools.ts`, existing self-upgrade config/window helpers.

---

## File Map

- Modify: `apps/web/lib/actions/self-upgrade.ts`
  - Keep auth/revalidate behavior.
  - Delegate request mechanics to a shared service.
- Create: `apps/web/lib/self-upgrade/request.ts`
  - Implement UI and agent request orchestration.
  - Implement effective-window check for agent requests.
- Create: `apps/web/lib/self-upgrade/request.test.ts`
  - TDD coverage for queueing, duplicate suppression, dispatch failure, and human-override-required window outcomes.
- Modify: `apps/web/lib/actions/self-upgrade.test.ts`
  - Confirm UI action delegates and preserves current behavior.
- Create: `apps/web/lib/mcp/packs/self-upgrade-pack.ts`
  - Add `request_self_upgrade` tool definition and handler.
- Modify: `apps/web/lib/mcp-tools.ts`
  - Compose the self-upgrade tool pack into the platform registry.
- Create: `apps/web/lib/mcp-tools-self-upgrade.test.ts`
  - Confirm tool metadata and handler behavior.
- Modify: `apps/web/lib/tak/agent-grants.ts` and `apps/web/lib/mcp/tool-registry.test.ts`
  - Keep agent-grant and tool-pack parity explicit.
- Modify: `docs/operations/dpf-production-runtime.md`
  - Add the post-merge agent verification loop using `request_self_upgrade`.

## Task 1: Shared Request Service

- [x] Write failing tests in `apps/web/lib/self-upgrade/request.test.ts`:
  - UI/manual mode creates a run and sends `ops/self-upgrade.run`.
  - Active latest run returns `already_active` and does not dispatch.
  - Dispatch failure marks the queued run failed and returns `dispatch_failed`.
  - Agent mode outside effective window returns `human_override_required` and does not create a run.
  - Agent mode inside effective window creates and dispatches a run with `triggeredBy` prefixed by `mcp:`.
  - Agent mode with `needs-timezone` returns `human_override_required`.
- [x] Run: `pnpm --filter web exec vitest run lib/self-upgrade/request.test.ts`
  - Expected: fail because the module does not exist.
- [x] Implement `apps/web/lib/self-upgrade/request.ts`.
- [x] Re-run the test until green.
- [x] Commit: `feat: add governed self-upgrade request service`.

## Task 2: UI Action Delegation

- [x] Update `apps/web/lib/actions/self-upgrade.test.ts` to assert the action calls the shared service and preserves `revalidatePath`.
- [x] Run: `pnpm --filter web exec vitest run lib/actions/self-upgrade.test.ts`
  - Expected: fail until action delegates.
- [x] Update `apps/web/lib/actions/self-upgrade.ts`.
- [x] Re-run action tests plus request tests.
- [x] Commit: `refactor: share self-upgrade request path`.

## Task 3: MCP Tool

- [x] Add failing MCP tests for `request_self_upgrade`:
  - Definition is side-effecting and requires `manage_provider_connections`.
  - Schema has no `force` property.
  - Handler returns `queued` when the service queues.
  - Handler returns `human_override_required` without treating it as a transport failure.
- [x] Run the focused MCP test.
- [x] Add the tool definition and handler in `apps/web/lib/mcp/packs/self-upgrade-pack.ts`.
- [x] Compose the pack in `apps/web/lib/mcp-tools.ts` and map `request_self_upgrade` to `admin_write`.
- [x] Re-run MCP tests.
- [ ] Commit: `feat: expose governed self-upgrade trigger to agents`.

## Task 4: Docs And Verification

- [x] Update `docs/operations/dpf-production-runtime.md` with the new post-merge loop.
- [x] Run focused tests:
  - `pnpm --filter web exec vitest run lib/self-upgrade/request.test.ts lib/actions/self-upgrade.test.ts <mcp-test-path>`
- [ ] Run `pnpm --filter web typecheck`.
- [ ] Run `pnpm --filter web build` if source-local time allows; otherwise record why it was not run.
- [ ] Commit docs and final fixes.
- [ ] Push branch.
