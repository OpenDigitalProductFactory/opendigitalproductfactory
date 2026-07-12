# Implementation Plan — BI-5FDBF786: External agent work-start auto-claims a WorkCapsule

**BI:** BI-5FDBF786 (epic EP-WORK-CONVERGENCE) · **Date:** 2026-07-11 · **Status:** Implemented.

## Gap
Capsule-at-start largely existed (`claim_backlog_item_for_work` creates a capsule at claim; `adopt_worktree` adopts one; `captureExternalSessionEvidence` auto-captures on first EVIDENCE). But an external agent that has STARTED without a BI, without a worktree, and before any evidence was invisible — no pure pre-evidence start signal.

## What this delivers
- Extract `ensureExternalSessionCapsule` from `captureExternalSessionEvidence` (the capsule create/adopt part, no evidence append; `summary` optional). Capture now delegates to it — behavior unchanged.
- `start_external_work` MCP tool (pack def + handler + grant + agent-grants) — external Claude/Codex/Grok/opencode register a tracked capsule at start, before any result. Idempotent per session (create) or per repo+branch (adopt). Grant `work_capsule_adopt`; provenance-free description.

## Verification
- 4 tests: create-at-start-without-evidence; adopt path when worktree supplied; existing capture behavior preserved; drift/hygiene green. Typecheck clean (0 errors post-typegen).
- Live-portal validation deferred (per operator: validate the whole epic at completion).
