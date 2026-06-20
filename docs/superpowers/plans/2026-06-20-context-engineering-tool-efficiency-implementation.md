# Implementation Plan — Context Engineering & Tool Efficiency Tuning

**Design of record:** `docs/superpowers/specs/2026-06-20-context-engineering-tool-efficiency-design.md`
**Standard produced:** `docs/architecture/context-engineering-standards.md`
**Date:** 2026-06-20
**Scope of this PR:** the P0 trio (as permanent guards) + the "keep-fresh / apply-criteria" mechanism. Larger bets (R3/R4/R7) are staged as follow-ups against the same standard.

## Goal

Follow through on the validated research: make DPF's model-facing surfaces (MCP tool registry, Build Studio native loop, AI coworkers) cheaper and more reliable on the binding ~24,576-token local window, and make the design criteria **apply automatically to subsequent changes** rather than relying on memory.

## Phase 1 — Tool I/O economics guards (in this PR)

1. **Result-size cap (R1/G1/P6).**
   - New module `apps/web/lib/tak/tool-result-budget.ts`: `resolveToolResultCharCap` (window-proportional, floored 4,000 chars, ceiled 100,000) + `clampToolResultForModel` (truncation with notice). Unit test alongside.
   - Wire the native loop (`agentic-loop.ts`, tier-aware via `resolvedMaxContextTokens`), replacing the silent `slice(0, 3000)`.
   - Wire the MCP route (`app/api/mcp/v1/route.ts`): bound `data`, stop double-dumping it into both `text` and `structuredContent`, keep valid JSON via a preview marker.
2. **Description hygiene (R2/G4/P5).**
   - CI guard `apps/web/lib/tool-description-hygiene.test.ts` — fails on `Phase N` / `(BI-…)` / source-path provenance in any tool's model-facing `description` (scans `tool.description` only).
   - Clean the 14 offending descriptions in `mcp-tools.ts` (provenance moved to / left in code comments).

## Phase 2 — Keep-fresh / apply-criteria mechanism (in this PR)

3. **Canonical standard** `docs/architecture/context-engineering-standards.md` (P1–P13 + local-window contract + enforcement map).
4. **AGENTS.md §8 pointer** — cross-client discoverable (Codex/Grok read AGENTS.md).
5. **Conformance tie-in** — Context Economy section in `docs/architecture/agent-standards-dpf-conformance.md` so reviews check it.
6. **Parity tracker** `docs/architecture/agent-client-capability-parity.md` — seeded matrix + monthly refresh ritual reusing the `agent-task-scheduler.ts` substrate (no new cron); projects into the living-architecture-graph when R-graph wiring lands.
7. **Shift-left precheck** `packages/dpf-skill-pack/hooks/tool-economy-precheck.mjs` (+ test, wired in `hooks.json`, covered by `plugin-hooks-wired.test.mjs`) — re-asserts the criteria when the registry/route/loop/budget files are edited, on every surface.

## Phase 3 — Staged follow-ups (separate PRs, design against the standard)

- **R3** deferred tool loading on `/api/mcp/v1` (Tool Search pattern) — external CLI token tax.
- **R4** code-execution / programmatic tool calling in the native loop — flagged spike (sandbox security boundary; kernel-gate-in-code review required).
- **R6** verify + exploit local prefix-KV caching.
- **R7** registry convergence (faceted `search`, consolidated `record_evidence`) under EP-ARCH-CONVERGENCE.
- **R8** context/tool eval harness (tokens-per-task, selection-accuracy vs the 15-tool cliff).
- **R9** memory-fact re-injection across compaction.

## Verification

- `apps/web/lib/tak/tool-result-budget.test.ts` and `apps/web/lib/tool-description-hygiene.test.ts` (vitest) — run in CI (local worktree deps degraded; logic validated by hand + scan).
- `packages/dpf-skill-pack/hooks/tool-economy-precheck.test.mjs` + `plugin-hooks-wired.test.mjs` (`node --test`) — **passing locally** (17/17).
- Provenance scan: 14 → 0 offenders in `mcp-tools.ts`.

## Out of scope / non-goals

- No cloud-model proposals (local-first founder strategy stands).
- No change to the kernel runtime gate, grant model, or phase-scoping logic.
- No aggressive description length-trimming (soft budget only; revisit with R8).
