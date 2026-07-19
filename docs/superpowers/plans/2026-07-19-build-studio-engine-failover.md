# Build Studio Dynamic Engine Failover Implementation Plan

**Backlog item:** BI-92048C32

**Epic:** EP-BS-UX-HARDENING
**Design authority:** `docs/superpowers/specs/2026-06-28-ai-readiness-console-design.md` section 7.2

## Goal

Make Build Studio engine policy automatic by default, select only healthy/capable/policy-allowed engines through the canonical routing and capacity substrate, retry one safe pre-dispatch failure on the next eligible engine, and expose identical selection evidence to dispatch, `resolve_model_selection`, BuildActivity, progress, and the configuration UI.

## Architecture

Add one Build Studio engine selector beside the existing dispatch configuration. The selector performs engine-specific readiness/auth/retry-window qualification, then constrains and invokes the existing V2 endpoint router for capability, residency, sensitivity, context, tool, cost, health, and capacity decisions. The router's ordered endpoint result becomes the engine fallback chain. Stored configuration carries only Auto versus deliberate hard-pin policy and per-engine credential/model preferences; selected engine and rationale are derived live.

## Delivery phases

1. **Regression-first selector contract**
   - Add failing tests for expired Claude selecting Codex, capacity exclusion, local-only, hard pin, no candidates, and route-decision evidence.
   - Extend routed-inference preview options with typed provider allow/deny/residency constraints so preview and live routing share the same contract.

2. **Dynamic configuration and dispatch**
   - Implement the DB-backed selector over `BuildEngineState`, provider credentials, provider health/capacity, and CLI retry windows.
   - Make Auto the default; retain Advanced hard pin with explicit no-fallback failure copy.
   - Reuse the selector in Ideate and build dispatch. Allow one classified pre-side-effect retry for Ideate, guarded by the existing design-evidence idempotency boundary.

3. **Evidence and operator visibility**
   - Record selection, rejections, and fallback chain in BuildActivity.
   - Project the latest selection through Build progress visibility.
   - Show Auto, selected engine, rationale, and advanced pin controls in Build Studio configuration.
   - Make `resolve_model_selection` consume the same live selection object.

4. **Verification and delivery**
   - Run focused Vitest suites and web typecheck in the worktree.
   - Lease `local-integration-ci` for production build and authenticated UX verification of `/platform/ai/build-studio` plus Build progress evidence.
   - Run merged-code CI, DCO-check, overlap sweep, push, open a ready PR, run `pnpm pr:health`, queue via merge queue, and record evidence on BI-92048C32.

## Risks and rollback

- **Risk:** stale readiness could exclude a usable engine. **Mitigation:** unknown health may remain eligible only when structural readiness and credentials are valid; explicit unhealthy/retry/auth states fail closed.
- **Risk:** a retry duplicates work. **Mitigation:** retry only failures classified before dispatch side effects and only before design evidence is saved.
- **Risk:** policy crossing during fallback. **Mitigation:** every fallback is produced inside the same hard routing contract; pinned mode has no fallback.
- **Rollback:** restore the prior static config resolver and radio UI; no schema migration is required because policy lives in the existing PlatformConfig JSON.
