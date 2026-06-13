---
title: Agent-client self-provisioning — session-entry re-trigger for the existing toolchain bootstrap
date: 2026-06-11
status: draft (revised after substrate verification — original "new register-agents installer" framing was WRONG)
author: agent (operator-directed)
supersedes_framing: "new scripts/agents/register-agents.{mjs,ps1,sh} installer"
builds_on:
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md   # the existing system
relates_to:
  - BI-4B17051B                     # the existing bootstrap BI
  - EP-INSTALL-HARDENING-2026-05-23 # owns the bootstrap
  - EP-CLIENT-HOOK-PLANE            # likely owns the session-entry hook
  - EP-UPGRADE-LIFECYCLE            # reinstall reconciliation
kernel:
  - verify-substrate-before-proposing-new
  - sweep-main-before-trusting-worktree-specs
  - architecture-over-shortcuts
  - single-source-of-truth
---

# Agent-client self-provisioning

## Course-correction note (read first)

The first draft of this file proposed a NEW `scripts/agents/register-agents` installer. **That was a
duplication error.** Substrate verification on 2026-06-11 found a mature, tested, merged system that
already does detect → plan → apply for the DPF agent toolchain:

- **Spec:** `docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md` (BI-4B17051B,
  EP-INSTALL-HARDENING, PRs #1204/#1205/#1207/#1212).
- **Library:** `packages/dpf-bootstrap/src/agent-toolchain/` — pure data-in/data-out planning
  (`claude-plugins.ts`, `codex-config.ts`, `grok-config.ts`, `mcp-client-config.ts`,
  `install-state.ts`, `readiness-state.ts`, `probes.ts`, `smoke-test.ts`, …) with `__tests__/`.
- **Adapters:** `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` — detect CLIs + token, auto-mint the
  MCP token in the portal container, `claude plugin install`, Codex `config.toml` TOML upsert
  (byte-preserving), kernel-memory seed, read-only MCP probe, smoke test, persist
  `~/.dpf/install-state.json#agentToolchain`, print one six-state readiness banner.
- **Entry points already wired:** `install-dpf.{ps1,sh}`, `scripts/setup.ps1`, worktree-create flow,
  and AGENTS.md §4 line 64 (tells agents to run it after `git worktree add`).

It is idempotent (read → compute desired → write only if different), TOML round-trips a real parser,
and re-running on a converged worktree is a no-op. **Do not rebuild any of this.**

## The actual gap

The existing bootstrap converges on three triggers: **install**, **worktree-create**, and **explicit
re-run**. It does NOT converge on a fourth that the 2026-06-11 incident exposed:

> **Session entry into an already-installed worktree whose client tooling has since been wiped** —
> e.g. Claude Code reinstalled (its `~/.claude/plugins` cache cleared), or a client launched before
> `DPF_MCP_BEARER_TOKEN` existed (the `needs_refresh` readiness state). Nothing re-runs the bootstrap;
> the operator gets a silent, tool-less session.

The readiness model already *names* this state — `readiness-state.ts` returns `needs_refresh`
("A token exists, but the running client has not picked it up yet") and `missing_token` — but no
runtime actor consumes it at session start. AGENTS.md §4 frames the bootstrap as a worktree-create
step, not a general "on entering the project, converge if drifted" contract.

## Proposed work (small; two pieces, both on top of the existing system)

### Piece 1 — session-entry convergence trigger  →  candidate owner: EP-CLIENT-HOOK-PLANE

A lightweight, throttled, non-blocking check on client session start that reads
`~/.dpf/install-state.json#agentToolchain.readinessState` (cheap, no Node spawn) and, only on drift
(`needs_refresh` / `missing_token` / `partial` / state-file absent / plugin cache empty for this repo),
invokes the EXISTING `dpf-bootstrap-agent-toolchain.{ps1,sh} -Headless` (background) and surfaces one
human-safe `readinessCopy()` line. `ready` + recent marker → exit 0 silently (the common path; zero
per-session cost). Exit 0 always (matches the `scripts/hooks/run-hook.mjs` contract).

For **Claude Code** this is a committed `SessionStart` hook routed through the existing
`run-hook.mjs` dispatcher (sibling to the current `PostToolUse`/`SessionEnd`/`WorktreeCreate` hooks).
**This is one of the six lifecycle hooks EP-CLIENT-HOOK-PLANE is chartered to deliver — it must land
under that epic's hook plane, not as a one-off.** Confirm ownership before wiring.

### Piece 2 — generalize the AGENTS.md self-provisioning contract  →  EP-INSTALL-HARDENING / docs

Add a short, top-of-file "Client self-provisioning" note (or generalize §4 line 64): *on entering the
project, if your DPF tools are not present (no `dpf` MCP, no `dpf-platform` skills — e.g. after a
client reinstall), run `scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}` before working.* This is the
client-agnostic fallback for AGENTS-aware clients (Codex, Cursor, Cline, Copilot) that have no
deterministic SessionStart hook — the agent reads it and self-provisions by running the existing
bootstrap. Pointer, not duplicate (single source of truth = the bootstrap script + install.md).

### Durability follow-up (separate, larger — EP-UPGRADE-LIFECYCLE)

The bootstrap installs **user-scope** (`~/.claude/plugins`, `~/.claude.json`) — wiped by a Claude
reinstall, healed only on the next bootstrap run. Optional reinstall-proofing: write the MCP to
`…\ClaudeCode\managed-mcp.json` (probe `Program Files` AND `ProgramData`) so the connector survives a
reinstall without any re-run. Note the documented asymmetry: managed settings can host MCP and can
*constrain* marketplaces (`strictKnownMarketplaces`/`blockedMarketplaces`) but have **no documented
`enabledPlugins` key** — so plugin/skill enablement always needs the re-runnable user-scope step.
Token: set `DPF_MCP_BEARER_TOKEN` at **Machine** scope so it is present at every client launch
(kills the `needs_refresh`/401-at-launch case).

## Acceptance (functional, not structural)

- Reinstall Claude Code (clear `~/.claude/plugins`), then open an already-seeded DPF worktree and
  start a session: within that session the `dpf` MCP reconnects and `dpf-platform` skills load,
  without the operator running anything and without creating a new worktree.
- Launch a client before `DPF_MCP_BEARER_TOKEN` is set, set it, start a new session: the session-entry
  trigger drives the bootstrap and a fresh thread gets HTTP 200 from the MCP endpoint.
- A converged, recently-checked session incurs no bootstrap run (throttle + `ready` short-circuit).

## Triage questions

1. **BI placement.** Should BI-229D3757 fold into BI-4B17051B / EP-INSTALL-HARDENING as a "Phase 8:
   session-entry trigger," or stay separate and split across EP-CLIENT-HOOK-PLANE (Piece 1) +
   EP-INSTALL-HARDENING (Piece 2)?
2. **Hook ownership.** Does EP-CLIENT-HOOK-PLANE already enumerate a SessionStart/converge hook? If so,
   Piece 1 is an existing item, not new.
3. **Durability default.** Ship managed-mcp.json reinstall-proofing now, or keep user-scope + rely on
   the session-entry re-trigger (simpler, no elevation)?
