---
title: Multi-client governance parity — implementation plan
date: 2026-07-26
status: ready-for-backlog-coverage
spec: docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md
epics:
  - EP-INSTALL-HARDENING-2026-05-23
  - EP-AGENT-INSTRUCTION-PLANE
---

# Plan: Multi-client governance parity

## Goal

Deliver **outcome parity** for governance (skills, plane-1 hooks, competitive process-spine disable, worktree create→reap, readiness) across every DPF delivery client — starting with **Grok host + Build Studio Grok**, then equalizing Claude/Codex/Antigravity and documenting adapters for OpenCode/Gemini/Cursor.

## Spec

[`docs/superpowers/specs/2026-07-26-multi-client-governance-parity-design.md`](../specs/2026-07-26-multi-client-governance-parity-design.md)

## Deliverables (independently shippable)

| # | Deliverable | Epic | Effort | Depends |
|---|-------------|------|--------|---------|
| 1 | Design + plan + capability-parity governance section (docs) | EP-AGENT-INSTRUCTION-PLANE | small | — |
| 2 | Grok host: SessionStart/Stop plane + competitive disable adapter | EP-INSTALL-HARDENING | medium | 1 |
| 3 | Build Studio sandbox: seed dpf-platform + dpf-guards for Grok (and verify peers) | EP-INSTALL-HARDENING | medium | 2 (can parallel design of seed) |
| 4 | Worktree Tier-A scheduled auto-reap (flag-gated soak) | EP-INSTALL-HARDENING | medium | — (independent) |
| 5 | Claude competitive disable + Antigravity hook proof or matrix “unsupported” | EP-INSTALL-HARDENING | medium | 2 |
| 6 | OpenCode/Gemini/Cursor adapter checklist + optional OpenCode seed | EP-AGENT-INSTRUCTION-PLANE | small–medium | 1 |

## Phase detail

### Phase 1 — Docs & matrix (this branch)

- [x] Design spec
- [x] This plan
- [ ] Update `docs/architecture/agent-client-capability-parity.md` with G1–G9 governance outcomes table
- [ ] File BIs; link epic; record plan backlog coverage receipt when MCP write available

### Phase 2 — Grok host complete

Files (expected):

- `packages/dpf-skill-pack/scripts/update_agent_toolchain.py` — expand `install_grok_hooks`, add `disable_grok_competitive_plugins`
- `packages/dpf-skill-pack/process-spine-replacements.json` — Grok client status → reconciles-safe-config
- `packages/dpf-skill-pack/hooks/grok-skill-exposure-adapter.mjs` — already partial; wire SessionStart
- `~/.grok/hooks/` payload: SessionStart process-spine, SessionEnd reaper (absolute paths)
- Tests in `update_agent_toolchain_test.py` + hook unit tests

Verify:

- `grok plugin list --json` + competitive plugins disabled
- Deny probe for lease-punt still works
- SessionStart injects process-spine status into context (or log)

### Phase 3 — Build Studio seed

Files (expected):

- `Dockerfile.sandbox` and/or `apps/web/lib/integrate/sandbox/*` bootstrap
- `apps/web/lib/integrate/grok-dispatch.ts` — optional preflight
- Shared seed helper used by claude/codex/grok dispatch paths

Verify:

- `docker exec dpf-sandbox-1 grok plugin list` shows dpf-platform
- Hooks file present under sandbox node home
- One specialist task under `--always-approve` still **denied** for a known-unsafe shell pattern

### Phase 4 — Worktree Tier-A reaper

Files (expected):

- `scripts/worktree-janitor.sh` / PS lib (already)
- New Inngest function (pattern from `runtime-artifact-janitor.ts`) with **Tier A apply** behind `DPF_WORKTREE_JANITOR_AUTO_REAP=1`
- Default: dry-run + digest log
- Junction-safe remove only

Verify:

- Dry-run on live install lists PRUNE candidates
- Flag-on removes only Tier A; pinned/dirty/open-PR kept
- Nested `.claude/worktrees` orphans reduced over time

### Phase 5 — Remaining clients

- Claude: competitive disable adapter + document
- Antigravity: live PreToolUse probe or matrix row “hooks unproven — comply by construction”
- OpenCode: if BS continues dispatch, seed skill pack + MCP; hooks if supported
- Gemini/Cursor: adapter checklist in README + parity matrix only until product pull

## Backlog coverage (filed 2026-07-26)

| BI | Title | workType | size | Epic |
|----|-------|----------|------|------|
| **BI-F4A1A0DC** | Multi-client governance parity: design, plan, and capability-matrix G1–G9 | doc | small | EP-AGENT-INSTRUCTION-PLANE |
| **BI-BCA23DBB** | Grok host: SessionStart/Stop governance plane + competitive process-plugin disable | feature | medium | EP-INSTALL-HARDENING-2026-05-23 |
| **BI-C5F9A232** | Build Studio sandbox: seed dpf-platform skills+hooks for Grok (headless parity) | feature | medium | EP-INSTALL-HARDENING-2026-05-23 |
| **BI-42FA7DD8** | Worktree Tier-A scheduled auto-reap (flag-gated, junction-safe) | feature | medium | EP-INSTALL-HARDENING-2026-05-23 |
| **BI-A4BEFE99** | Equalize remaining clients: Claude/Antigravity competitive cleanup + OpenCode/Gemini/Cursor adapter checklist | feature | medium | EP-INSTALL-HARDENING-2026-05-23 |

**Decomposition decision:** five independently shippable BIs (not one xlarge). Wave 1 = BI-BCA23DBB + BI-C5F9A232; Wave 2 = BI-42FA7DD8; Wave 3 = BI-A4BEFE99; docs BI-F4A1A0DC lands with this branch.

## Decomposition decision

Five BIs (not one xlarge) — each shippable alone; Wave 1 Grok BS seed unblocks autonomous safety without waiting for janitor.

## Risks / WWMD

- Auto-reap: `destructive-actions-require-explicit-go` → flag-gated Tier A only.
- Headless: `human-in-the-loop-at-phase-boundaries` → no new tool prompts; portal phase gates stay.
- Sprawl: `remove-avoidable-failure-opportunities` → closed create→reap loop over vigilance.

## Done when

1. Host Grok and BS Grok both expose dpf-platform skills and plane-1 denies.
2. Competitive superpowers-family disabled on Codex + Grok (Claude when adapter lands).
3. Tier-A janitor can run scheduled dry-run (auto-reap optional flag).
4. Capability parity doc lists G1–G9 for all SURFACE_CLIENT_KINDS + suggested clients.
