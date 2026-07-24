---
title: Reap Sidecars to Upgrade Tools
slug: reap-sidecars-to-upgrade-tools
pageKind: principle
status: published
abstract: A session is a claimed capsule; session end reaps its sidecars (app-server, node_repl, npx MCP children). Upgrading Claude Code / Codex is a first-class operator-triggered quiesce-reap-upgrade routine — orphaned sidecars must never pin a tool against update.
principleTier: contextual
principleDirection: Tie sidecar lifecycle to the session capsule — reap app-server, node_repl, and MCP children at session end; upgrade the interactive tools via an operator-triggered quiesce-reap-upgrade routine, never by leaving orphaned children to pin the installer.
principleDimensionVector: {"long_term_maintainability": 0.7, "capacity_utilization": 0.6, "governance_compliance": 0.5, "operational_independence": 0.5}
principleAppliesTo:
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principleConsumerContexts:
  - engineering-flow
---

## Rule

A surface session **is** a claimed capsule, and **session end is a reap**. When a session ends (or its capsule is released), its sidecars — `app-server`, `node_repl`, and any npx MCP children — are terminated. No three-generation orphan accumulation.

Upgrading the interactive tools (Claude Code, Codex, including the WindowsApps Store package) is a **first-class operator-triggered routine**: a *quiesce-for-tooling-upgrade* procedure that drains/clears active surface sessions, reaps sidecars, allows the update, then resumes. Upgrading the *tools* gets the same treatment as upgrading the *platform* (the governed self-upgrade lifecycle) — it is a routine, sustained operation, not a re-architecture.

## Why

On 2026-06-05 the host carried 69 orphaned processes (13 `claude.exe`, 16 `Codex.exe`, 30 `node.exe`, 6 `node_repl.exe`). Codex is a WindowsApps Store package that **cannot update while running**, and three generations of per-session `app-server` + `node_repl` + npx MCP sidecars were never reaped — so the orphans pinned the installer and tool upgrades silently couldn't happen. Surfaces are thin, swappable adapters behind a stable contract, and Claude Code and Codex ship updates *daily*; the doctrine must keep them **upgradable on demand**. The drain/reap model is the same one Kubernetes pod-termination + connection-draining use, extended from the portal swap to *tooling* sessions.

Authority for the upgrade is **operator-triggered** (spec §7 Q2): it composes [`never-ask-user-to-run-commands`](never-ask-user-to-run-commands.md) (the agent runs the routine) with [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md) (draining live sessions is destructive enough to need an explicit operator go).

## How To Apply

- Bind sidecar lifetime to the session capsule; extend the `SessionEnd` hook to terminate sidecars and release any held lease/capsule.
- Wire the **DPF MCP only**; do not auto-spawn generic npx MCP servers per session — they are the orphan source.
- Run the quiesce-reap-upgrade routine on operator trigger: drain active sessions, reap sidecars, update the tool, resume. Never leave orphaned children to block the next upgrade.
- Treat a tool that "can't update" as a reaping failure to diagnose, not a tolerated state.

## Decision Dimensions

- `long_term_maintainability: 0.7` — tools that upgrade cleanly stay current; orphan-pinned tools rot.
- `capacity_utilization: 0.6` — reaping reclaims dozens of stranded host processes.
- `governance_compliance: 0.5` — session = capsule = reap is the enforceable contract.
- `operational_independence: 0.5` — the operator can upgrade on demand instead of fighting orphans.

## Related

- [`mcp-is-the-coordination-plane`](mcp-is-the-coordination-plane.md) — DPF MCP first; generic servers are the orphan source.
- [`never-ask-user-to-run-commands`](never-ask-user-to-run-commands.md) — the agent runs the upgrade routine.
- [`destructive-actions-require-explicit-go`](destructive-actions-require-explicit-go.md) — draining live sessions needs an explicit go.
- [`worktree-selection-and-reaping`](worktree-selection-and-reaping.md) — the worktree half of the reaping discipline.
- [AGENTS.md §17](../../../../AGENTS.md) — operational summary.
- [Unified Delivery Surfaces spec §4.2, §7 Q2](../../../superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md) — design context and the operator-triggered decision.

## Origin

Unified Delivery Surfaces spec, 2026-06-05 (WWMD-ratified, Q2 — kernel high confidence, margin 0.32).
