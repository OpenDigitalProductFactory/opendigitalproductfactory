---
title: Platform-owned client configuration — the platform declares how work is done
status: draft
author: Claude (Opus 5)
reviewers:
  - Mark (operator review pending)
date: 2026-09-02
backlog:
  - BI-99395B29 (the reaper this unblocks)
  - BI-7F775D03 (fresh worktrees cannot run their own gate)
epics:
  - EP-CLIENT-CONFIG
related:
  - docs/founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md
  - docs/founder-kernel/wiki/principles/worktree-selection-and-reaping.md
  - docs/founder-kernel/wiki/principles/no-provider-pinning.md
  - docs/superpowers/specs/2026-05-26-agent-toolchain-bootstrap-design.md
  - docs/superpowers/specs/2026-06-02-dpf-client-hook-plane-design.md
  - packages/dpf-bootstrap/src/agent-toolchain/
  - apps/web/lib/queue/functions/worktree-janitor.ts
---

# Platform-owned client configuration

## Purpose

When any client works on DPF, the platform should configure that client to work the way the
platform needs — starting with where work happens. Today the direction of control is inverted: the
clients decide, and the platform infers. This spec turns it around.

It extends [`2026-05-26-agent-toolchain-bootstrap-design`](2026-05-26-agent-toolchain-bootstrap-design.md),
which established the DPF-owned install step and the per-client planners. That design settled *that*
the platform configures clients. This one settles *what it owns* now that
[`platform-function-never-depends-on-a-client`](../../founder-kernel/wiki/principles/platform-function-never-depends-on-a-client.md)
draws the line.

## The dividing line this inherits

The commandment supplies the test, and it is the whole architecture of this spec:

> **Client configuration may buy ergonomics and speed. It may never carry a guarantee.**

Anything that must be *true* goes server-side. Anything that merely makes an agent faster, cheaper
or less obstructed belongs in client config. Every item below is placed by that test, and the test
is what keeps this epic from becoming "put more of the platform in the client."

It also rules out the tempting wrong answer. The client hook plane is **contributor-only by explicit
design** — its own spec states hooks *"live in the contributor `.claude/settings.json`, never in any
path the customer install touches."* So "ship the hooks everywhere" is not available, and was never
the intended safety net.

## Problem statement — measured, not asserted

### 1. The platform does not know where its own work happens

`CANONICAL_WORKTREE_BASE = "D:\DPF-worktrees"` is a constant in
`packages/dpf-bootstrap/src/agent-toolchain/codex-config.ts` — **client** configuration.
`scripts/lib/local-ci-slot-manifest.mjs` independently derives the same location as
`dirname(rootClone) + "-worktrees"`. The portal has no owned notion of the path at all.

The consequence is not theoretical. The portal's worktree janitor is server-side and correct, and it
is **structurally blind**: the portal binds the install root, and the worktree base is a *sibling* of
it, outside every mount. Verified from inside the container — the directory does not exist there.
Enabling `DPF_WORKTREE_JANITOR_ENABLED` and `DPF_WORKTREE_JANITOR_AUTO_REAP` today would scan
nothing, find nothing, and report success.

Measured on the development install, 2026-09-02: **193 worktrees, 528.4 GB — 45% of all used disk**,
growing **17.6 worktrees/day**. Roughly a **15-day runway** on a 1.9 TB box. A 512 GB machine does not
get a fortnight.

### 2. Bootstrap configures no permissions

No allowlist, no approval posture. Every DPF-shaped tool call risks an approval prompt, which on an
autonomous surface is a stall rather than a nuisance. That a `fewer-permission-prompts` skill exists
is the tell: the pain is real and is being solved per-user instead of shipped once.

`approval_policy`, `sandbox_mode`, `model` and `model_reasoning_effort` are read and round-tripped by
the Codex planner but never set.

### 3. Surface coverage is uneven

| Surface | Planner | Lines | State |
|---|---|---|---|
| Codex | `codex-config.ts` | 392 | plugin enable, competing-plugin disable, MCP disable, project trust |
| Claude | `claude-plugins.ts` | 174 | plugin install, version pinning, stale reconciliation |
| Grok | `grok-config.ts` | **81** | thin |
| Antigravity | — | — | unsupported-until-proven |

### 4. Doctrine routing is repo-local only

`CLAUDE.md`, `CONVENTIONS.md`, `.cursor/rules/000-load-agents.mdc`, `.clinerules/000-load-agents.md`,
`.continue/rules/000-load-agents.md` and `.github/copilot-instructions.md` all point at `AGENTS.md`
— and all live in the **source checkout**. A session rooted at an installed instance receives none
of them, and nothing warns that the canonical contract is absent.

This one sits closest to the line. Knowing the rules is arguably a guarantee, not an ergonomic, and
§6 treats it accordingly.

## Existing substrate — what must NOT be rebuilt

Verified before proposing anything, per `verify-substrate-before-proposing-new`:

- `scripts/lib/worktree-janitor-core.mjs` — `classifyWorktree()` already encodes the full Tier-A /
  Tier-B safety model: SKIP root clone, detached HEAD and `main`; honour `.worktree-pinned`; KEEP an
  open PR; KEEP a live session heartbeat so a worktree is never reaped under a running session.
- `scripts/lib/junction-safe-worktree-remove.mjs` — junction-safe deletion. Load-bearing: a naive
  recursive delete follows pnpm junctions and guts the donor clone.
- `apps/web/lib/queue/functions/worktree-janitor.ts` — already a server-side Inngest job, explicitly
  *"NOT a CLI client cron"*.
- `packages/dpf-bootstrap/src/agent-toolchain/` — per-client planners, MCP config, memory seeding,
  readiness probes, smoke test, evidence queue, upstream version checks.

The classifier, the safety doctrine, the deletion primitive and the server-side host all exist. This
epic supplies what they lack: **a platform-owned location, sight of it, and a bound.**

## Design

### §1 — The platform owns the worktree base (keystone)

The install declares its worktree base as platform configuration, resolved server-side and exposed
through one accessor. Bootstrap **reads it from the platform** and writes it into each client's
config, inverting today's direction. `codex-config.ts` stops being the definition and becomes a
consumer; `local-ci-slot-manifest.mjs` stops deriving and asks.

Resolution order, most specific first: explicit install configuration → an environment override →
the current derived default (`dirname(rootClone) + "-worktrees"`), which keeps every existing install
working unchanged.

**Acceptance:** the portal can name its worktree base without consulting any client artifact, and
`codex-config.ts` contains no hardcoded path.

### §2 — The portal can see it

The platform's own compose mounts the declared base into the portal, the same shape as the two host
binds already present. The mount is shipped by the platform, not added by an operator.

**Acceptance:** with the mount present, the janitor's scan returns real decisions on this install.

### §3 — A blind backstop must fail loudly

Today an unreachable base silently no-ops. That is a `make-silent-failures-observable` violation and
it is how 528 GB accumulated unnoticed. When the janitor cannot see its declared base it must record
an unhealthy result and surface it on an operator surface — never report success.

**Acceptance:** with the mount removed, the job reports unhealthy rather than clean.

### §4 — A bound that holds with nobody watching

The commandment's operative half. A default cap — count and/or bytes — that reaps oldest Tier-A
first, using the existing classifier and junction-safe removal, with no human decision required.

Explicit-go survives exactly where it must: **Tier B, and anything unmerged or unpushed.** That
constraint is load-bearing, not decorative — a sweep of this install found ~137 branches with commits
never pushed, and one abandoned worktree held a finished, signed, tested commit recovered two days
later and shipped as #4875. The sprawl is also where undelivered work hides.

Disk headroom and worktree growth surface **before** exhaustion, not after.

### §5 — Permissions and posture

Bootstrap ships a curated allowlist per surface covering the tool calls DPF work actually requires,
plus a deliberate `approval_policy` / `sandbox_mode` posture rather than whatever the user happened
to pick. Pure ergonomics, squarely on the client side of the line.

**Explicit non-goal: model and provider selection.** [`no-provider-pinning`](../../founder-kernel/wiki/principles/no-provider-pinning.md)
forbids it. `model` and `model_reasoning_effort` stay the client's, and the planner continues to
round-trip them untouched.

### §6 — Doctrine reaches a client working against an install

The pointers exist but are repo-local. An agent rooted at an installed instance must still be able
to obtain the canonical contract — served by the platform rather than assumed present on disk.
Because knowing the rules is closer to a guarantee than an ergonomic, the platform serves it; the
client is told where to look.

### §7 — Surface parity

Bring Grok to the coverage Codex and Claude have, and settle Antigravity: either support it against
the same contract or record it as unsupported with the evidence gate that would change that.

## Phasing

| Slice | Content | Why this order |
|---|---|---|
| **A** | §1 platform-owned base | Keystone. Nothing else is coherent without it |
| **B** | §2 + §3 mount and loud no-op | Makes the existing janitor actually see; cheap once A lands |
| **C** | §4 bounded default + headroom | The half that reclaims disk and stops the support calls |
| **D** | §5 permissions and posture | Independent of A–C; pure ergonomics |
| **E** | §6 doctrine reach | Needs an operator decision on served-vs-shipped |
| **F** | §7 Grok parity, Antigravity ruling | Lowest urgency |

A→B→C is the critical path for `BI-99395B29`. D can run in parallel.

## Research and benchmarking

- **devcontainer / `devcontainer.json`** — the tool reads the *project's* declaration of how to work,
  rather than each editor inventing it. Adopted: the platform declares, clients consume.
- **EditorConfig** — one project-level file many editors honour, ergonomics only, no guarantees.
  Adopted, including its restraint about scope.
- **`git worktree` + `core.worktree`** — git keeps the authoritative location in repository metadata,
  not in each client's settings. Adopted as the direction of ownership.
- **Rejected: per-client bespoke configuration as the source of truth** — the current state, and the
  reason the platform cannot see its own worktrees.
- **Rejected: pushing guarantees into client hooks** — forbidden by the commandment and, per the hook
  plane spec, contributor-only by design regardless.

## Risks

- **A stale or wrong declared base points the reaper at the wrong directory.** Mitigated by keeping
  the derived default, by the existing SKIP rules (root clone, `main`, detached HEAD), and by
  junction-safe removal.
- **The mount widens what the portal can reach on the host.** It is one directory the platform
  already owns the lifecycle of, and the container already holds the docker socket.
- **A bounded default deletes something wanted.** Bounded to Tier A; Tier B and anything
  unmerged/unpushed keep explicit-go; `.worktree-pinned` remains an operator override.

## Acceptance criteria

1. The portal names its worktree base without reading any client artifact.
2. No hardcoded worktree path remains in any client planner.
3. The janitor returns real decisions on this install.
4. With the base unreachable, the job reports unhealthy — not clean.
5. A bound holds with no human input; Tier B and unmerged/unpushed still require explicit go.
6. Headroom and growth are visible before exhaustion.
7. Bootstrap ships a permission allowlist per supported surface; model selection remains unset.
8. Every existing install keeps working with no operator action.

## Open questions for the operator

1. **§6 doctrine reach** — should the platform *serve* the canonical contract to any client working
   against an install, or is that install-time file placement?
2. **§4 bound shape** — cap by worktree count, by total bytes, or by free-space floor? A free-space
   floor most directly targets the failure, but is the least predictable to an operator.
3. **§7 Antigravity** — support against this contract, or record unsupported with a named evidence
   gate?

## What this is NOT

- Not a change to model or provider selection.
- Not a rebuild of the classifier, the deletion primitive, or the Inngest host — all exist.
- Not an expansion of the client hook plane, which stays contributor-only.
- Not a relocation of the canonical worktree base; §1 declares it, it does not move it.
