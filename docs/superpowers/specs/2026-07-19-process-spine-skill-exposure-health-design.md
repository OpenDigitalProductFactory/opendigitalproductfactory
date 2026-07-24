---
title: Process-spine skill exposure health
status: implemented
date: 2026-07-19
decision-ledger:
  - DI-DEB2623C6DAB
  - DI-84BA6E9B2318
  - DI-15E908812733
  - DI-F548CFA4095C
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

A follow-up lifecycle decision was run after the operator asked how changed DPF
skills and proactive retirement should work across many client types. Ledger:
`DI-84BA6E9B2318`.

Options:

- `docs-only-operator-process`: document manual cleanup.
- `contract-backed-disable-not-delete-reconcile`: extend the shared replacement
  contract with cleanup/update policy, reconcile only through safe client
  adapters, and warn elsewhere.
- `hard-delete-legacy-skills`: remove legacy skill/plugin caches directly.

Recommendation: `contract-backed-disable-not-delete-reconcile`, composite
`6.3536`, margin `3.7568`, high confidence. This keeps the policy portable and
testable while honoring the destructive-action boundary: DPF can disable known
competitive process plugins where a client adapter is proven, but it does not
delete user-owned local skill state.

Design-Grounding-Decision: reviewed this process-spine exposure spec, the
pre-PR gate contract in `docs/testing/pre-pr-gate.md`, and code substrate
`packages/dpf-skill-pack/hooks/process-spine-health-check.mjs` plus
`scripts/sandbox-freshness-preflight.mjs`; this change repairs readiness and
sandbox-evidence behavior without changing UI routes or coworker authority.

UX-Fit-Decision: fits-with-guardrails. No app route or user-facing control
changes; the readiness output reduces operator cognitive load by naming the
plain-language difference between DPF skills installed on disk and DPF-native
replacement skills loaded/exposed in the active session.

## Design

The canonical replacement map is
`packages/dpf-skill-pack/process-spine-replacements.json`. It also owns the
cleanup/update lifecycle policy so future retired equivalents and client adapter
behavior are added in one place. The replacement map currently covers:

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
installed files do not prove the current client loaded the skills. `unknown` is
a readiness warning, not a pass. When active evidence exists and a retired
generic process skill is visible without its DPF replacement, the checker also
warns before work begins.

The dependency-free Python updater reads the same JSON map and prints the same
plain-language installed-vs-exposed readiness summary. The PowerShell and POSIX
bootstrap adapters run the Node checker directly on the normal planner path, so
the fallback and full paths surface the same contract. The plugin `SessionStart`
hook also runs the checker, allowing Claude/Codex/Grok/Antigravity-style hook
consumers to flag verified conflicts at session start.

## Cleanup / Update Lifecycle

The policy mode is `disable-not-delete`. Rerunning bootstrap/updater after a
DPF skill-pack change is the canonical agent-toolchain cleanup path. It:

- replaces the managed `dpf-platform` plugin copy;
- refreshes client marketplaces and MCP descriptors;
- prints process-spine installed, exposed, and cleanup/update readiness
  separately; and
- applies only tested safe client remediations.

Codex currently has a safe config adapter. The Python fallback now rewrites
`~/.codex/config.toml` so `dpf-platform` remains enabled and contract-listed
competitive process plugins (`superpowers`, `superpowers@openai-curated`,
`superpowers@openai-bundled`) are disabled. This is idempotent and preserves
unrelated plugin settings.

Claude, Grok, and Antigravity are deliberately warn-only for cleanup until their
client-specific active-state/remediation APIs are verified. They still consume
the same replacement/cleanup contract and can warn at bootstrap or SessionStart
when exposed skill evidence shows a retired generic process skill without its
DPF replacement.

## Native Client Boundary

The process-spine cleanup/update policy composes with the agent-toolchain
bootstrap spec's native-first rule. DPF must use each client in the way it
supports: plugin manifests/marketplaces for skills/plugins, MCP descriptor
shapes for MCP, and the client's hook plane for hooks. Direct user-config edits
are fallback adapter work, not a back door.

Codex is the current exception because it has no verified non-interactive native
command for every DPF-required user-config state. The fallback is still
schema-aware: the TypeScript planner parses and stringifies TOML with
`smol-toml`, while the dependency-free Python fallback uses a tested table
upsert/collapse helper. Both paths have regression coverage for the known
failure where duplicate `[mcp_servers.dpf]` tables make Codex unable to read its
config. Unknown invalid TOML remains fail-closed instead of guessed.

## Known Limit

Codex Desktop does not currently provide a non-interactive active-skill-list API
to hooks or bootstrap. For those clients the health check reports active
exposure as `unknown`, warns before work begins, and names the restart/repair
action. A future client
adapter should populate one of the `DPF_PROCESS_SPINE_EXPOSED_SKILLS*` inputs so
the check can become fully verified instead of proxy-based.

Follow-up: `BI-BCA162CF` covers client-specific active skill exposure adapters
as each external client exposes a supported API.

## Follow-up Substrate Repair

After PR #3292, the same process-spine objective exposed a second evidence gap:
the shared local-CI sandbox could keep a stale top-level `vitest` package while
the lockfile required a newer runner. That made the unit-test gate fail inside
the runner before the freshness preflight could classify the sandbox as stale.

`principle_decide` was run for the follow-up scope. Ledger:
`DI-F548CFA4095C`.

Options:

- `sandbox-drift-only`: repair only the local-CI freshness detector.
- `active-skill-exposure-only`: repair only active-skill readiness warning
  behavior.
- `bundle-both`: repair both because both are process-spine evidence gaps.

Recommendation: `bundle-both`, high confidence, margin `0.646`. The durable
repair adds `vitest` to the local-CI freshness sentinels and removes stale
resolved package links inside the sandbox before the single governed
`pnpm install --frozen-lockfile` convergence pass. The Vitest sentinel checks
both the locked version and runnable entrypoint imports so a broken runner
package is sandbox drift, not product test evidence. If that re-check still
sees dependency drift, the preflight runs one bounded
`pnpm install --force --frozen-lockfile` retry to refresh the sandbox store/link
graph. If the dedicated `.local-ci-runner` scratch checkout is still stale after
that native retry, the preflight resets that scratch checkout's own
`node_modules` and reinstalls from the lockfile. The convergence lock lives in
git-private state outside `node_modules`, so a reset cannot erase its duplicate
install guard. A red sandbox remains classified as `blocked_sandbox_drift`,
never product evidence.

Follow-up: `BI-4D852EC2` tracks the remaining root-cause repair when the
dedicated local-CI scratch runner recreates a stale or incomplete Vitest package
even after native pnpm convergence and scoped scratch `node_modules` reset.

## Client Exposure Adapters (BI-BCA162CF)

`BI-BCA162CF` asked for per-client adapters that populate
`DPF_PROCESS_SPINE_EXPOSED_SKILLS_JSON`/`_FILE` from each external client's own
active-skill state, closing the proxy gap this spec's "Known Limit" section
described. Fresh research across the four clients this spec names (Codex,
Claude, Grok, Antigravity) found exactly one genuine, already-precedented,
non-interactive command that answers "what does this client's own runtime
currently recognize": Grok's `grok plugin list --json` (already depended on by
`update_agent_toolchain.py`'s `install_grok_plugin` to detect an existing
`dpf-platform` install).

**Shipped:** `packages/dpf-skill-pack/hooks/grok-skill-exposure-adapter.mjs`
(and its Python-fallback mirror, `probe_grok_exposed_skills` in
`update_agent_toolchain.py`) run `grok plugin list --json`, map plugin-level
presence onto the five DPF replacement skill ids (and the three retired
`superpowers`-family ids from `process-spine-replacements.json`'s
`cleanupPolicy`), and feed the result into the shared evidence channel. Both
`scripts/dpf-bootstrap-agent-toolchain.sh` and its PowerShell sibling call the
adapter before invoking the health checker, only when no explicit evidence
channel is already set (never overriding operator/CI-supplied evidence). This
turns Grok's exposure state from `unknown` into `verified` on any host with the
Grok CLI present, and reproduces the exact "retired `brainstorming` skill
visible while its `dpf-brainstorming` replacement is hidden" conflict case
from this spec's Problem statement as a passing regression test.

**Not shipped, by design — documented gap, not a fabricated adapter:**

- **Codex**: no non-interactive command was found that lists actively
  loaded/exposed skills. `codex exec --json` startup events carry no
  plugin/skill field (verified against
  `docs/superpowers/audits/evidence/2026-04-29-codex-cli-jsonl-probe.md`).
  Codex's `~/.codex/config.toml` `[plugins."<id>"].enabled` toggle (already
  read/written by `ensure_codex_config`) is persisted CONFIGURATION, not a
  verified session state — and Codex separately gates every hook behind
  interactive HOOK TRUST (`codex_hook_trust_established`), so `enabled = true`
  is not proof a given session honored it. Feeding that toggle into
  `DPF_PROCESS_SPINE_EXPOSED_SKILLS_*` would flip the health checker's
  `exposed.state` to `"verified"` on evidence that does not actually verify
  the session — worse than the honest `"unknown"` it renders today.
- **Antigravity**: no discoverable non-interactive skill-list mechanism for
  the `agy` CLI; its MCP-config wiring path itself is still evidence-gated
  (`EP-ANTIGRAVITY-001` / `BI-ECAE3494`).
- **Claude Code** (this platform's own first-party client): also has no
  enumerable active-skill-list surface at `SessionStart` — skills are
  triggered by description matching during a turn, not enumerated up front.
  Out of the four clients this spec names as in-scope proxies, but noted here
  for completeness since it is the host running this very check.

A future Codex/Claude/Antigravity client release that ships a genuine
non-interactive active-skill-list command should get the same adapter
treatment as Grok: a small, independently-testable module under
`packages/dpf-skill-pack/hooks/`, wired into the bootstrap scripts ahead of the
shared health checker, never overriding operator/CI-supplied evidence.

Design-Grounding-Decision: reviewed this spec's own "Known Limit"/Follow-up
section (which named `BI-BCA162CF`), `process-spine-health-check.mjs`'s env-
channel contract, and `update_agent_toolchain.py`'s existing
`install_grok_plugin`/`codex_competitive_plugin_ids` substrate before adding
the Grok adapter; extended this spec in place rather than authoring a new
design doc, since the addition is client-adapter scope within the exposure
contract this document already owns.
