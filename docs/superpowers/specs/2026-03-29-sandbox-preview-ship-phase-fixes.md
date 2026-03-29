# EP-SANDBOX-PREVIEW-001 + EP-SHIP-DEPLOY-001: Sandbox Preview Fix & Ship Phase Unblock

**Date:** 2026-03-29
**Status:** Implemented
**Author:** Mark Bodman (CEO) + Claude (implementation)
**Epic IDs:** EP-SANDBOX-PREVIEW-001, EP-SHIP-DEPLOY-001
**IT4IT Alignment:** SS5.3 Integrate (Build & Preview), SS5.4 Deploy (Ship Phase)

**Predecessor specs:**

- `2026-03-14-self-dev-sandbox-design.md` -- original Build Studio design (live preview concept)
- `2026-03-19-sandbox-execution-db-isolation-design.md` -- sandbox pool, workspace init (Implemented)
- `2026-03-25-robust-sandbox-coding-mcp-security-design.md` -- agentic loop, tool calling (Implemented)
- `2026-03-25-promotion-pipeline-change-window-design.md` -- ship phase tools, deployment windows (Draft)
- `2026-03-27-build-studio-source-lifecycle-design.md` -- container naming, source volume (Draft)

---

## Context

These fixes resolve the two critical blockers from consumer testing session on 2026-03-28 (commit 804b5f9). Build Studio tool calling and sandbox code generation were fixed in that session. Two gaps remained:

1. **Sandbox preview was blind** -- the Live Preview iframe showed nothing during the build phase
2. **Builds never reached ship** -- a silent bug blocked all builds at the build-to-review gate

Both issues were systemic and had been blocking progress for approximately two weeks.

---

## Issue 1: Sandbox Preview (EP-SANDBOX-PREVIEW-001)

### Root Causes Found

**1. Proxy route hardcoded to first sandbox container**

`/api/sandbox/preview/route.ts` used `SANDBOX_PREVIEW_URL` (set to `http://sandbox:3000` in docker-compose.yml), which always proxied to the first sandbox container (`dpf-sandbox-1`). When builds used slot 1 or 2 (`dpf-sandbox-2-1`, `dpf-sandbox-3-1`), the proxy missed the right container.

The route already queried `build.sandboxId` from the database but ignored it for routing.

**2. Client never received sandbox port allocation**

`BuildStudio.tsx` SSE handler only refetched build data on three specific event types (`brief:update`, `phase:change`, `evidence:update`). When the sandbox was acquired (setting `sandboxPort` in the DB), no matching event was emitted. The client kept stale data with `sandboxPort: null`.

**3. Preview server not started on auto-init**

When sandbox tools (`edit_sandbox_file`, `read_sandbox_file`, etc.) auto-initialized the sandbox via pool, the preview server was not started. Only `generate_code` started it.

### Fixes Applied

| File | Change |
|------|--------|
| `apps/web/app/api/sandbox/preview/route.ts` | Added `resolveSandboxUrl()` -- maps `sandboxId` to Docker Compose service name (internal) or host port (local dev). Fallback HTML now auto-refreshes every 5s with spinner. |
| `apps/web/components/build/BuildStudio.tsx` | SSE handler refetches on ANY event (debounced 2s). New `useEffect` polls every 3s when phase=build but `sandboxPort` is null. |
| `apps/web/lib/mcp-tools.ts` | After sandbox auto-init, calls `startSandboxDevServer()` so preview is available immediately. |
| `apps/web/lib/sandbox.ts` | Preview server fallback "Building..." page auto-refreshes every 5s. |
| `apps/web/lib/agent-event-bus.ts` | Added `sandbox:ready` event type for future SSE notifications. |

### Verification

Playwright test `e2e/10-sandbox-preview.spec.ts` passes:

- Live Preview header visible: **true**
- Preview iframe visible: **true**
- iframe src: `/api/sandbox/preview?buildId=FB-F98EF8DB&path=/`
- iframe body: rendered HTML content (TOGAF training catalog with tabs, cards, registration form)
- Proxy route API: **200**, `text/html`, 5205 bytes

Screenshot confirms rendered content in the Live Preview pane during build phase.

---

## Issue 2: Ship Phase Unblock (EP-SHIP-DEPLOY-001)

### Root Cause Found

**Property name casing mismatch silently blocked ALL builds at the build-to-review gate.**

The gate in `feature-build-types.ts` checks:
```typescript
if (!verification.typecheckPassed) return { allowed: false, reason: "Typecheck must pass before review." };
```

But the build pipeline in `build-pipeline.ts` saved:
```typescript
typeCheckPassed: results.typeCheckPassed  // capital C -- doesn't match gate
```

Result: `verification.typecheckPassed` was always `undefined` (falsy), so the gate rejected every build regardless of actual typecheck results.

The MCP tool handler (`run_sandbox_tests` in `mcp-tools.ts` line 2207) used the correct lowercase `typecheckPassed`, so interactive coworker runs could pass the gate. Only the automated pipeline path was broken.

Additionally, `build-pipeline.ts` saved `testsPassed: results.passed` (a boolean) but the gate checked `testsFailed` (expected a number). This happened to work by accident (`undefined ?? 0 > 0` is false), but was incorrect.

### Additional Fixes

`npx tsc --noEmit` in `coding-agent.ts` violated CLAUDE.md rules ("`npx` ignores the workspace-pinned version and downloads latest from npm"). Same for `npx prisma migrate deploy` in `build-pipeline.ts`.

### Fixes Applied

| File | Change |
|------|--------|
| `apps/web/lib/build-pipeline.ts` | Fixed `typeCheckPassed` -> `typecheckPassed` (matches gate). Added `testsFailed` field. Fixed `npx prisma` -> `pnpm --filter @dpf/db exec prisma`. |
| `apps/web/lib/coding-agent.ts` | Fixed `npx tsc --noEmit` -> `pnpm exec tsc --noEmit`. |
| `apps/web/lib/build-agent-prompts.ts` | Fixed `pnpm tsc` -> `pnpm exec tsc` in build phase prompt instructions. |

### Ship Phase Tool Chain Verified

All 5 tools in the ship phase chain exist and have complete implementations:

| Tool | Purpose | Status |
|------|---------|--------|
| `deploy_feature` | Extract sandbox diff, scan destructive ops, check deployment window | Implemented |
| `register_digital_product_from_build` | Create ProductVersion + ChangePromotion + RFC | Implemented |
| `create_build_epic` | Set up backlog tracking for the build | Implemented |
| `schedule_promotion` | Schedule deployment for next available window | Implemented |
| `assess_contribution` | Evaluate whether feature should be contributed to Hive Mind | Implemented |

The promotion pipeline in `sandbox-promotion.ts` (491 lines) implements the full 10-step `executePromotion()` flow: validate -> window check -> backup -> scan -> apply -> health check -> verify -> rollback on failure.

---

## E2E Test Infrastructure Hardening

### Problem

The `sendAndWait()` test helper used placeholder text matching (`"co-worker"` and not `"sending"`) to detect when the coworker was idle. This was unreliable because:

1. After `approveAllProposals()`, the coworker starts processing again (textarea disabled), but the next `sendAndWait` call tried to fill the textarea before it re-enabled
2. The placeholder text check didn't account for the disabled state transition
3. Each test file had its own copy of the helper functions with slightly different behavior

### Fix

Created shared `e2e/helpers.ts` module with hardened async-aware helpers:

- **`waitForCoworkerIdle()`** -- Uses `textarea.disabled` property as the single source of truth for "coworker is ready for input". No placeholder text matching.
- **`sendAndWait()`** -- 5-step flow: (1) wait for idle, (2) fill and send, (3) confirm message accepted (textarea disabled), (4) wait for response complete (textarea enabled), (5) extract response.
- **`approveAllProposals()`** -- After each approval click, waits for the coworker to finish processing before clicking the next one.
- **`extractLastResponse()`** -- Shared response extraction logic.

All test files updated to import from `e2e/helpers.ts`: `07-build-studio.spec.ts`, `08-build-pipeline.spec.ts`, `09-build-lifecycle-demo.spec.ts`, `10-sandbox-preview.spec.ts`.

---

## Spec Status Updates

This section documents which predecessor specs are affected by these fixes:

| Spec | Status Before | Status After | Notes |
|------|--------------|-------------|-------|
| `2026-03-14-self-dev-sandbox-design.md` | No status | **Implemented** (preview section) | Live preview concept is now working end-to-end. Three-panel layout with iframe preview renders sandbox content. |
| `2026-03-19-sandbox-execution-db-isolation-design.md` | Implemented | Implemented | No changes needed. Pool, workspace init, DB isolation all working. |
| `2026-03-25-robust-sandbox-coding-mcp-security-design.md` | Implemented | Implemented | Agentic loop + tool calling confirmed working. Pipeline step casing bug was in `build-pipeline.ts`, not in the agentic loop path. |
| `2026-03-25-promotion-pipeline-change-window-design.md` | Draft | **In Progress** | Ship phase tools verified complete. Pipeline unblocked. End-to-end promotion not yet exercised (requires a build to pass typecheck first). |
| `2026-03-27-build-studio-source-lifecycle-design.md` | Draft | Draft | Container naming (SS1.4) and pool reduction (SS1.5) are future work. Current fixes use existing container IDs with a mapping table. |

---

## What Remains

1. **End-to-end ship phase verification** -- With the gate bug fixed, builds that pass typecheck can now reach review/ship. Need to exercise the full `deploy_feature -> register_digital_product -> create_build_epic -> schedule_promotion -> assess_contribution` chain with a passing build.

2. **Gemini provider configuration** -- The DPF instance's preferred provider (gemini-2.5-pro) is not configured, causing fallback to Claude Haiku. Haiku works but is less reliable at multi-step tool orchestration.

3. **Promotion pipeline execution** -- `executePromotion()` in `sandbox-promotion.ts` has never been called end-to-end. The functions exist but the trigger path (operator approval -> automated deployment) is not wired per the gaps documented in `2026-03-25-promotion-pipeline-change-window-design.md`.

4. **Container naming migration** -- Per `2026-03-27-build-studio-source-lifecycle-design.md` SS1.4, container names should change to human-readable format (`"DPF - Build Studio"`). The `resolveSandboxUrl()` mapping table makes this a config change, not a code change.
