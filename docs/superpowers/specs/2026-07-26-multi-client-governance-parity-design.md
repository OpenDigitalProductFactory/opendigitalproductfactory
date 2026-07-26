---
title: Multi-client governance parity — skills, hooks, competitive process spine, worktree lifecycle
status: draft-for-implementation
date: 2026-07-26
owner: platform
related:
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/specs/2026-07-03-harness-enforced-decision-routing-and-lease-punt-gates-design.md
  - docs/superpowers/specs/2026-07-19-process-spine-skill-exposure-health-design.md
  - docs/architecture/agent-client-capability-parity.md
  - packages/dpf-skill-pack/README.md
  - packages/dpf-skill-pack/process-spine-replacements.json
backlog:
  - BI-F4A1A0DC
  - BI-BCA23DBB
  - BI-C5F9A232
  - BI-42FA7DD8
  - BI-A4BEFE99
kernel_principles:
  - one-common-process-three-surfaces
  - governance-approves-evidence-not-provenance
  - mcp-is-the-coordination-plane
  - worktree-selection-and-reaping
  - remove-avoidable-failure-opportunities
  - human-in-the-loop-at-phase-boundaries
  - destructive-actions-require-explicit-go
  - never-ask-user-to-run-commands
  - do-the-work-dont-task-the-operator
---

# Multi-client governance parity

## Purpose

Close the gap between **doctrine** (one governed process on every delivery surface) and **runtime reality** (skills/hooks/MCP/competitive-plugin/worktree reaping delivered unevenly per client — especially host Grok vs Build Studio Grok, and warn-only cleanup on non-Codex clients).

This design is **client-agnostic first**: one governance contract, thin adapters per client. Grok host + Build Studio Grok are the first implementation wave because live evidence shows the largest autonomous gap there; every other client DPF already names (and several it does not yet bootstrap) must converge to the same outcomes.

## Problem (live evidence, 2026-07-26)

| Observation | Why it hurts |
|-------------|--------------|
| Host Grok has `dpf-platform` + 6 PreToolUse guards; **no SessionStart/Stop plane** | Competing skills and process-spine gaps are not caught at turn zero |
| **Build Studio sandbox Grok: `No plugins installed`** | Autonomous `--always-approve` runs without skills or guards — prompt-only governance |
| Competitive cleanup is **disable** for Codex, **warn-only** for Claude/Grok/Antigravity | Upstream `superpowers` process skills still supersede DPF skills (repeated operator pain) |
| ~78 git worktrees, ~84 nested `.claude/worktrees`, ~108 `D:/DPF-worktrees`, ~1360 local branches | Doctrine requires reaping; janitor is manual/dry-run; runtime-artifact janitor is observe-only |
| Clients have different hook planes, trust models, plugin roots, and settings paths | Ad-hoc per-client fixes drift; new clients repeat the same failure modes |

## Non-goals

- Forcing all development through Build Studio.
- Deleting user-owned skill files/plugin caches (cleanup remains **disable-not-delete**).
- Making every client support every vendor-specific hook event (e.g. Claude `WorktreeCreate` is Claude-native).
- Auto-deleting Docker/portal resources without founder-gated tiers (`destructive-actions-require-explicit-go`).

## Architecture thesis

```
                    ┌─────────────────────────────────────┐
                    │  GOVERNANCE CONTRACT (one)          │
                    │  skills · plane-1 guards · MCP ·     │
                    │  process-spine · capsule · reaping   │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              ▼                       ▼                       ▼
     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
     │ Adapter: host  │     │ Adapter: BS    │     │ Adapter: IDE   │
     │ CLI (per client)│     │ sandbox dispatch│     │ / optional CLI │
     └────────────────┘     └────────────────┘     └────────────────┘
              │                       │                       │
              ▼                       ▼                       ▼
     Same outcomes: DPF skills win · unsafe tools denied ·
     competitive process plugins disabled · worktrees born
     governed and reaped · readiness observable on MCP
```

**Outcome parity, not mechanism parity.** A client may load hooks from a plugin, a global JSON, or a settings file — DPF requires only that the **same guards fire** and the **same skills are the active process spine**.

### Governance contract (must hold on every surface)

| Outcome ID | Requirement |
|------------|-------------|
| **G1 Skills** | All `dpf-platform` skills installable/loadable; process-spine replacements present |
| **G2 Competitive** | Known competitive process plugins **disabled** (not merely warned) where the client API allows; else fail-closed readiness |
| **G3 Plane-1 hooks** | Blocking guards live: lease, lease-punt, root-clone, compose, decision-routing, plan-backlog-coverage |
| **G4 Session plane** | SessionStart: process-spine + competitive + governance-freshness. SessionEnd/Stop: uncommitted durable artifacts + lease/capsule release (where event exists) |
| **G5 MCP** | `DPF_MCP_BEARER_TOKEN` wired; tools reachable when portal not quiescing |
| **G6 Capsule** | Work claims a capsule (host) or FeatureBuild/capsule (BS); orphan worktrees detectable |
| **G7 Worktree lifecycle** | Create only at canonical sibling base; Tier-A auto-reap merged/clean/unpinned; no nested root sprawl as steady state |
| **G8 Headless-safe** | Under always-approve / non-interactive: no operator TUI required; deny + Stop feedback are model-actionable strings + logs |
| **G9 Readiness** | `record_surface_readiness` heartbeat with clientKind; fleet can see not-ready/stale |

### Adapter matrix (substrate today → target)

| Client | Status on this install | Skills path | Hooks execution plane | Competitive cleanup | BS dispatch | Target adapter maturity |
|--------|------------------------|-------------|----------------------|---------------------|-------------|-------------------------|
| **Claude Code** | Host present | Plugin + project marketplace | Plugin `hooks.json` + `.claude/settings.json` dual plane | warn-only → **disable** | Yes (claude-dispatch) | **Reference** for plugin hooks |
| **Codex CLI** | Config present; PATH may vary | Managed `~/.agents/plugins` + config.toml | Plugin + `~/.codex/hooks.json` + hook-trust | **disable** (only verified) | Yes (codex-dispatch) | **Reference** for competitive disable |
| **Grok Build (host)** | Present, plugin 0.2.5 | `grok plugin install` managed copy | **Global only** `~/.grok/hooks/dpf-guards.json` (plugin hooks ignored) | warn-only → **disable** | N/A host | Complete SessionStart/Stop + competitive |
| **Grok (Build Studio)** | CLI in sandbox; **0 plugins** | Must seed at image/bootstrap | Same global hooks under sandbox `$HOME` | Image must not enable competitors | `grok --always-approve` | **P0** seed pack + guards |
| **Antigravity (agy)** | Manifest + MCP descriptor; CLI often absent | `.antigravity-plugin` | Hooks pending functional proof (BI-47A81FEB) | warn-only | No | Adapter + proof or honest “unsupported until proven” |
| **Build Studio (in-portal / agentic)** | Always | Prompt + coworker skills seed | Kernel/runtime gates, not CLI hooks | N/A (no superpowers pack) | Native | Keep evidence/MCP parity |
| **OpenCode** | Tracked in capability matrix; not bootstrap | AGENTS.md + skills TBD | TBD | TBD | opencode-dispatch exists | **Suggested** full adapter when adopted |
| **Gemini CLI** | Tracked in matrix; not bootstrap | GEMINI.md | Limited hooks historically | TBD | No | **Suggested** skills+MCP adapter |
| **Cursor** | IDE present; Grok compat reads `~/.cursor/hooks.json` | Optional skills | Cursor hook names map to Grok plane | Manual | No | **Compat plane** document + optional project hooks |
| **VS Code + Copilot / Continue** | Pointers in AGENTS only | None | None | N/A | No | Instruction-file only unless product asks |
| **Claude Desktop / Cowork web** | Not primary | Via plugin marketplaces if any | Varies | TBD | No | Watchlist |

`SURFACE_CLIENT_KINDS` today: `claude-code | codex | grok | antigravity | build-studio`. Extend when OpenCode/Gemini join bootstrap.

## Design decisions

### D1 — One pack, dual delivery for hooks

- **Canonical definitions** stay in `packages/dpf-skill-pack/hooks/hooks.json` + guard scripts.
- **Executable planes** are client-specific:
  - Claude: plugin + project settings (race-resistant dual plane already ratified).
  - Codex: plugin + user `hooks.json` + trust UX.
  - Grok (host + BS): **always** materialize `~/.grok/hooks/dpf-guards.json` with absolute paths (proven live).
  - Antigravity/OpenCode/Gemini: add adapters only after a live PreToolUse deny probe.

Conformance: extend `GrokCodexGuardSyncTest` / surface manifest tests so **every client adapter’s guard list** cannot silently diverge from `emitDeny(` guards in hooks.json.

### D2 — Competitive process skills: disable-not-delete, all first-class clients

Extend `process-spine-replacements.json` cleanupPolicy:

| Client | Target status |
|--------|---------------|
| codex | `reconciles-safe-config` (already) |
| grok | `reconciles-safe-config` via `grok plugin disable` / config |
| claude | `reconciles-safe-config` via plugin disable API if safe; else documented fail-closed |
| antigravity | verify then upgrade from warn-only |
| build-studio sandbox | **image policy**: competitive plugins never installed/enabled |

SessionStart (where available): if retired generic skill is **exposed** and DPF replacement is not → inject loud context; optional hard stop for `DPF_REQUIRE_PROCESS_SPINE=1` (BS default on).

### D3 — Build Studio Grok/Codex/Claude seed the same governance pack

On sandbox image build and/or first dispatch bootstrap:

1. Copy managed skill-pack (or mount from workspace `packages/dpf-skill-pack`).
2. `grok plugin install <path> --trust` (and peers for claude/codex as already partially done).
3. Write plane-1 hooks for that client’s home.
4. Disable competitive plugins.
5. Record readiness (`clientKind: build-studio` or engine-specific key).

Headless flags (`--always-approve`, Codex `approval_policy=never`) remain; **hooks still deny**. HITL stays at **phase boundaries** in the portal, not tool prompts.

### D4 — Worktree lifecycle closed loop

| Phase | Mechanism |
|-------|-----------|
| Create | Canonical sibling base only; Claude WorktreeCreate hook; Grok/Codex placement via scripts + PreToolUse deny of nested `.claude/worktrees` creates when detectable |
| Register | Capsule claim required; orphan = no capsule / stale heartbeat |
| End | SessionEnd reaper (leases/sidecars); uncommitted durable-artifact warn |
| Reap Tier A (auto) | Merged to main (incl. squash via `gh`) + clean + no open PR + no lease + not `.worktree-pinned` → junction-safe remove + branch delete |
| Reap Tier B (propose) | Stale > grace days → ops digest / backlog, no silent delete |
| Branches | Post-merge local+remote topic branch GC as part of finish skill + janitor |

Scheduled job: promote `scripts/worktree-janitor.sh --live` Tier A behind a flag (default dry-run → opt-in auto after soak), separate from Docker artifact observe-only janitor.

### D5 — Headless Stop gates (optional phase 2)

`Stop` / `SubagentStop` on Grok/Claude: soft-block end_turn when phase requires missing MCP evidence (capsule heartbeat, plan-backlog receipt). Fail-open on timeout with loud log (hooks fail-open by design). Never use native dialogs.

### D6 — Living client registry

Expand `docs/architecture/agent-client-capability-parity.md` with a **Governance outcomes** section (G1–G9 per client, last verified). Monthly refresh ritual already specified; wire readiness heartbeats to feed fleet digest.

## Suggested clients DPF does not fully use yet

Adopt only when product value exists; still **document** the adapter checklist so onboarding is mechanical:

1. **OpenCode** — already in BS dispatch matrix; complete skill-pack + hooks adapter next after Grok BS seed.
2. **Gemini CLI** — large context; skills/MCP when Google’s agent surface stabilizes.
3. **Cursor (as coding agent)** — already a hooks compat source for Grok; optional project-level DPF guards for Cursor-only users.
4. **Aider / Continue / Cline** — instruction-file + MCP if operators use them; no full hook parity expected.
5. **Claude Desktop** — if used for DPF work, treat as Claude-compatible marketplace path.

## Implementation waves

### Wave 0 — Spec + backlog (this PR)

- This design + plan.
- BIs under EP-INSTALL-HARDENING / EP-AGENT-INSTRUCTION-PLANE.
- Update capability-parity tracker governance section.

### Wave 1 — Grok complete + BS seed (P0)

1. Extend host Grok hooks: SessionStart (process-spine + competitive), SessionEnd reaper hooks into `dpf-guards.json` or sibling JSON.
2. Grok competitive plugin **disable** adapter.
3. Sandbox: install `dpf-platform` + `dpf-guards` for Grok (and verify Claude/Codex sandbox already adequate).
4. Pre-dispatch readiness check: refuse or warn build engine if process spine not exposed.
5. Functional deny probe in CI or scheduled smoke where safe.

### Wave 2 — Worktree Tier-A auto-reap (P1)

1. Scheduled janitor Tier A with junction-safe remove.
2. Capsule-orphan detector on `/ops/dev-loop` + digest.
3. Deny/warn non-canonical worktree creation paths on all host CLIs that can match.

### Wave 3 — Client equalizers (P1–P2)

1. Claude competitive disable.
2. Antigravity live hook proof or explicit unsupported matrix row.
3. OpenCode adapter (if BS continues to dispatch it).
4. Gemini / Cursor checklist adapters as optional.

### Wave 4 — Stop/evidence hardening (P2)

- Headless Stop gates + specialist preamble “DPF skills are authority”.

## Verification

| Gate | Evidence |
|------|----------|
| Host Grok | `grok plugin list --json` includes dpf-platform; PreToolUse deny probe; SessionStart exposes process-spine OK |
| BS Grok | `docker exec … grok plugin list` non-empty; deny probe under `--always-approve` |
| Competitive | superpowers-family disabled on Codex + Grok; health check reports no retired generics exposed |
| Worktree | After soak, nested + sibling orphan counts trend down; Tier A dry-run → live log |
| Parity matrix | G1–G9 filled per client with verification date |
| Cross-surface | Same BI completed from host Grok and BS Grok with identical evidence fields |

## Risks

| Risk | Mitigation |
|------|------------|
| Hook fail-open hides broken install | Readiness G9 + process-spine UNKNOWN treated as not-ready for BS |
| Auto-reap deletes wanted worktree | Tier A strict predicates + `.worktree-pinned` + default dry-run soak |
| Client APIs change weekly | Living matrix + monthly refresh; dual delivery for Grok already proven |
| Token scope | Write token for BI/capsule; read for probes |

## Research & benchmarking (short)

- **Claude Code plugins/hooks** — richest hook set; dual-plane pattern is DPF precedent.
- **Codex plugins + hook trust** — official hooks; trust is the fail-open hazard.
- **Grok Build** — skills from plugins; hooks only from global/compat planes (live-proved).
- **Cursor hooks** — event alias map consumed by Grok; useful compat target.
- **OpenCode / Gemini** — weaker standardized hooks; skills + MCP first.

## Docs impact

- `docs/architecture/agent-client-capability-parity.md` — governance outcomes table.
- `packages/dpf-skill-pack/README.md` — multi-client adapter map pointer.
- `AGENTS.md` — short pointer only if operational contract changes (prefer not to grow preamble).
- User-facing: none unless install UX surfaces new readiness states.

## Open questions (resolve in plan execution, not blocking Wave 1)

1. Should BS engine preflight **hard-fail** or **warn + continue** when dpf-platform missing? (Recommend hard-fail after seed lands.)
2. Claude competitive disable: which CLI/API is safe without deleting user packs?
3. Worktree Tier A default-on timeline after soak (1 week? 1 release?).
