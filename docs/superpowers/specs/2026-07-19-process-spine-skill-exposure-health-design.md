---
title: Process-spine skill exposure health
status: implemented
date: 2026-07-19
decision-ledger:
  - DI-DEB2623C6DAB
related:
  - packages/dpf-skill-pack/process-spine-replacements.json
  - packages/dpf-skill-pack/hooks/process-spine-health-check.mjs
  - packages/dpf-skill-pack/README.md
  - docs/superpowers/specs/2026-05-30-dpf-native-skill-equivalents-design.md
backlog:
  - BI-BCA162CF
---

# Process-spine skill exposure health

## Problem

External clients can install `dpf-platform` files while the active session still
exposes a retired or generic process skill first. The confirmed Codex Desktop
case exposed retired upstream brainstorming while `dpf-brainstorming` was absent
from the active skill list. That is not a missing source file; it is a
session/client/plugin exposure gap.

Existing guards covered repo references and hook liveness, but no health check
answered the operator question: are the DPF-native replacements active, or only
installed on disk?

## WWMD Decision

`principle_decide` was run from Codex Desktop for the architecture choice.
Ledger: `DI-DEB2623C6DAB`.

Options:

- `docs-only`: restate precedence in AGENTS/README.
- `bootstrap-runtime-health`: add a shared health checker used by bootstrap and
  SessionStart, separating installed files from active exposed skills.
- `hard-suppress-generic`: remove/disable generic upstream packs everywhere.

Recommendation: `bootstrap-runtime-health`, composite `10.0567`, margin
`1.9155`, high confidence. This won because it verifies the condition directly,
keeps blast radius low, travels across clients, and does not destructively edit a
user's local generic tools.

## Design

The canonical replacement map is
`packages/dpf-skill-pack/process-spine-replacements.json`. It currently covers:

- `dpf-brainstorming` replaces retired upstream brainstorming.
- `dpf-writing-plans` replaces retired upstream writing-plans.
- `dpf-tdd` replaces retired upstream test-driven-development.
- `dpf-systematic-debugging` replaces retired upstream systematic-debugging.
- `dpf-finishing-a-development-branch` replaces
  retired upstream finishing-a-development-branch.

`packages/dpf-skill-pack/hooks/process-spine-health-check.mjs` reads the map,
checks installed `SKILL.md` files, and optionally evaluates active skill
evidence supplied by a client through:

- `DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON`
- `DPF_PROCESS_SPINE_EXPOSED_SKILLS_FILE`
- `DPF_PROCESS_SPINE_EXPOSED_SKILLS`

If no active evidence exists, the exposed state is `unknown`. That is deliberate:
installed files do not prove the current client loaded the skills. When active
evidence exists and a retired generic process skill is visible without its DPF
replacement, the checker warns before work begins.

The dependency-free Python updater reads the same JSON map and prints the same
plain-language installed-vs-exposed readiness summary. The PowerShell and POSIX
bootstrap adapters run the Node checker directly on the normal planner path, so
the fallback and full paths surface the same contract. The plugin `SessionStart`
hook also runs the checker, allowing Claude/Codex/Grok/Antigravity-style hook
consumers to flag verified conflicts at session start.

## Known Limit

Codex Desktop does not currently provide a non-interactive active-skill-list API
to hooks or bootstrap. For those clients the health check reports active
exposure as `unknown` and names the restart/repair action. A future client
adapter should populate one of the `DPF_PROCESS_SPINE_EXPOSED_SKILLS*` inputs so
the check can become fully verified instead of proxy-based.

Follow-up: `BI-BCA162CF` covers client-specific active skill exposure adapters
as each external client exposes a supported API.
