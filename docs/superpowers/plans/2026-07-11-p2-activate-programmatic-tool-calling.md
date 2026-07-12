# P2 — Activate the dark token savings (programmatic tool calling)

- **BI:** BI-9893614D · **Epic:** EP-27FD96BC
- **Scope spec:** `docs/superpowers/specs/2026-07-11-coworker-reasoning-economy-scope.md`
- **Kernel:** approach routed via `principle_decide` 2026-07-11 (guard off). **flag-on-select-grant** (reachable by default, granted only to read-heavy specialists) over broad-grant or operator-toggle-only — composite 9.03, high confidence.

## Problem (from the audit)

`run_tool_script` (`apps/web/lib/tak/tool-script.ts`) is fully built and governed — model-written code runs in the resource-limited Docker sandbox with a short-lived **read-only-scoped** JWT, every `callTool` re-enters the kernel gate + agent-grant checks and is audited as a `ToolExecution` row (Anthropic measures 37–98% token cuts for read-heavy filtering). But it shipped **dark** behind two default-off kill-switches, so nothing ever exercised it: the `programmatic_tool_calling` PlatformConfig flag and the per-agent `tool_script_exec` grant.

## Approach — reachable by default, granted narrowly

Substrate-verify-first: the mechanism, governance, and grant already exist; this only activates them.

1. **Flag on by default** — `PROGRAMMATIC_TOOL_CALLING_DEFAULTS.enabled = true`, so the feature is reachable. An operator can still force it off per install via the PlatformConfig row (`getProgrammaticToolCallingConfig` honours an explicit `{enabled:false}`).
2. **Grant `tool_script_exec` to read-heavy specialists only** in `HARDCODED_COWORKER_GRANTS`: `build-specialist` and `data-architect` (already sandbox-native), `ea-architect` (graph/architecture reads), `data-steward` (dedup sweeps over records), `platform-engineer` (telemetry/admin reads). The grant is safe regardless of an agent's other grants — the script's JWT strips every side-effecting scope, so a granted agent's script can still only *read*.

## Why this is safe
- The per-agent grant is the real gate; the flag being on changes nothing for un-granted agents.
- The sandbox is the trust boundary (command-blocklisted, path-guarded, resource-limited); the JWT is read-only; every inner tool call is re-gated by the kernel.

## Verification
- Unit: `tool-script.test.ts` — default now enabled; an explicit `{enabled:false}` row still forces off; caps still clamp. `seed.test.ts` + conformance — grant additions valid, existing regression guards intact (19 + 14 green).
- Live (this install, sandbox `dpf-sandbox-1` running): exercise `run_tool_script` end-to-end and confirm the sandbox executes the script and returns only the small filtered result. Recorded in the PR.

## Non-goals
- Write-capable scripts (the JWT is deliberately read-only).
- Broad rollout to every coworker (deferred until the read-heavy set proves the savings live).
