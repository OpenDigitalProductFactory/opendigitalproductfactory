---
title: Build-Engine Provisioning for Build Studio
date: 2026-06-06
status: draft
epic: EP-ENGINE-PROVISION
relates_to:
  - EP-GROK-001 (PR #1606 — first-class Grok support, the motivating case)
  - BI-032D8959 (macOS/Linux contributor MCP-token + Grok CLI)
principles:
  - bundled-services-active-by-default
  - zero-click-provider-setup
  - verify-substrate-before-proposing-new
  - ai-coworker-as-the-conduit
  - recursive-self-improvement
  - structural-verification-is-not-functional
---

# Build-Engine Provisioning

## 1. Problem

Build Studio dispatches builds to autonomous CLI coding engines — `codex`,
`claude`, `grok` — that run inside the build sandbox container. Today those
engines are baked into [`Dockerfile.sandbox`](../../../Dockerfile.sandbox) at
**image-build time** (`npm install -g @openai/codex`,
`@anthropic-ai/claude-code`, best-effort `@xai/grok-cli`).

The recent build-gate one-click **Enable** button
([`EnableRunnerButton.tsx`](../../../apps/web/components/build/EnableRunnerButton.tsx))
only flips a DB flag — `ModelProvider.status` inactive→active via
`toggleProviderStatus`
([`ai-providers.ts:560`](../../../apps/web/lib/actions/ai-providers.ts)). It
**assumes the binary is already present** and never provisions it. This breaks
down:

- **Minimal / air-gapped installs** can't carry every engine in the image.
- **Adding a new engine** (e.g. Grok) requires a full image rebuild.
- **No readiness signal**: the config page
  ([`BuildStudioConfigForm.tsx`](../../../apps/web/components/platform/BuildStudioConfigForm.tsx))
  shows *credential* status only and black-boxes the sandbox. Nothing tells a
  human operator or the Coworker whether an engine is actually present & healthy.
- **The Coworker (MCP) cannot** inspect engine readiness, enable, or provision
  an engine.

This is precisely why Grok currently "looks wired" (selectable in the dispatch
config) but would fail at runtime with `grok: not found` — **the gate writes a
check the sandbox can't cash.**

## 2. Substrate verification (done before designing)

Confirmed via grep + `git log origin/main` + live backlog query. None of the
provisioning capability below exists yet; the pieces it builds on do:

| Substrate | Location | Reused as |
| --- | --- | --- |
| Engines baked at image-build | `Dockerfile.sandbox:13-20` (`npm install -g …`, grok best-effort `\|\| echo`) | Becomes the **bake-in optimization**, not the only path |
| DB-only Enable | `EnableRunnerButton.tsx` → `toggleProviderStatus` (`ai-providers.ts:560`) | UX + permission pattern to mirror for Provision; flips status, never touches sandbox |
| Capability detection | `probe-claude-cli.ts`, `probe-codex-cli.ts` — `docker exec <sandbox> <cli> --version`, **THROW** on missing, internal to routing capability-profile-cache | Generalized into a non-throwing **readiness probe**; no `grok` probe exists |
| Sandbox lifecycle/diagnostics MCP | `check_sandbox` / `start_sandbox` / `diagnose_sandbox` / `recover_sandbox` / `get_build_sandbox_state` (`mcp-tools.ts`, `sandbox-admin.ts`, `sandbox-recovery.ts`) | Readiness/provision reconcile hooks here; **none install engines** |
| In-sandbox exec | `execInSandbox` (`sandbox.ts`); `run_sandbox_command` MCP (`mcp-tools.ts:2442`, guard `:9486`) | Provision uses `execInSandbox` on a **dedicated governed path** — see §4.3 |
| Engine registry | `providers-registry.json` (`cliEngine` per provider) → `ModelProvider.cliEngine` column (`schema.prisma:1490`), synced by `sync-provider-registry.ts` | Add a **separate engine registry** keyed by engine, since N providers share one engine |
| Config UX | `build-studio/page.tsx` + `BuildStudioConfigForm.tsx` (credential status only) | Add per-engine **readiness badge** |

Backlog query (`build engine provisioning sandbox install runner`) returned **no
engine-provisioning epic or BI**. `EP-GROK-001` merged as #1606; a **parallel
thread owns the tactical Grok `Dockerfile.sandbox` install fix** — this spec does
not duplicate it and instead treats Grok as **recipe #1** of the provisioner,
backfilling codex/claude as recipes too.

### Key constraint discovered in substrate

`run_sandbox_command`'s `BLOCKED_PATTERNS` (`mcp-tools.ts:9486`) deliberately
blocks `curl … | sh`, `docker …`, `--privileged`, etc. — it is the **build-agent**
command surface and must stay locked. Therefore a `curl`-installer recipe
**cannot** be run through `run_sandbox_command`. Provisioning is an
operator/kernel-authorized action and must run its recipe through a **separate,
permission-gated exec path** (`execInSandbox` directly), not the agent surface.
This is a design constraint, not an inconvenience.

## 3. Goal

A simple, governed way — usable by **both a human operator and the AI Coworker**
— to provision, verify, and see the readiness of build-dispatch engines in the
sandbox, so **"select Grok → it's installed, verified, green"** is true without
hand-editing a Dockerfile.

## 4. Design

The **engine** (not the provider) is the unit of provisioning. `anthropic` +
`anthropic-sub` both map to engine `claude`; `codex` + `chatgpt` → `codex`;
`xai` → `grok`. So provisioning is keyed by `cliEngine`, deduplicated across
providers.

### 4.1 Declarative engine registry (data, not Dockerfile)

New `packages/db/data/build-engines.json`, synced to a new `BuildEngine`
catalog the same way `sync-provider-registry.ts` syncs providers. **Adding an
engine = a data PR**, satisfying recursive-self-improvement.

```jsonc
{
  "engineId": "grok",                       // matches ModelProvider.cliEngine
  "displayName": "Grok CLI (xAI)",
  "binary": "grok",
  "verify": { "command": "grok --version", "versionRegex": "(\\d+\\.\\d+\\.\\d+)" },
  "bakeInDefault": false,                    // §4.5 — standard image may pre-bake
  "recipes": [
    { "method": "npm-global", "package": "@vibe-kit/grok-cli",
      "muslSafe": true,  "requiresEgress": true,  "priority": 10 },
    { "method": "prestaged-binary", "stagedPath": "/opt/dpf-engines/grok",
      "muslSafe": true,  "requiresEgress": false, "priority": 20 }
  ]
}
```

- `verify` is **promoted out of** `probe-*-cli.ts` so detection is data-driven and
  uniform across engines (including the currently-probe-less `grok`).
- `recipes[]` is an **ordered strategy list**. Recipe `method`s:
  - `npm-global` — `npm install -g <package>`; **musl-safe** (node CLIs run on
    Alpine/musl), needs egress.
  - `curl-installer` — vendor install script; **may not run on musl** (native
    binaries) → carries `muslSafe:false`; needs egress. Never via
    `run_sandbox_command` (see §2 constraint).
  - `prestaged-binary` — copy from a baked staging dir (`/opt/dpf-engines/<id>`)
    into PATH; **no egress** → the air-gap path.
- The provisioner filters recipes by **musl-compat** and **offline mode**, then
  tries in `priority` order.

The existing `probe-*-cli.ts` **capability profiles** stay — they describe
adapter *capabilities* (streaming, MCP attach, subagents). The engine registry
describes *provisioning + presence*. They link by `engineId` ↔ `adapterKind`.

### 4.2 Readiness surfaced (read path)

- **`probeEngineReadiness(engineId)`** — generalizes the two throwing probes into
  one **non-throwing** function: `docker exec <sandbox> <binary> --version`,
  parse via `verify.versionRegex`, return
  `{ engineId, present, version|null, probedAt, error? }`. (Routing's throwing
  probes can delegate to this core and re-throw, keeping their semantics.)
- **New `BuildEngineState` model** (engineId PK): `present`, `version`,
  `lastProbedAt`, `lastProvisionedAt`, `recipeApplied`, `desired` (persisted
  intent — see §4.4), `provisionedBy`. Lets the badge render without a live
  `docker exec` on every page load and lets the reconciler know what to replay.
- **Read-only MCP tool `get_build_engine_readiness`** (`sideEffect:false`,
  `requiredCapability: view_platform`) — returns the readiness array for the
  Coworker. Sits beside `check_sandbox` in `mcp-tools.ts`.
- **UX badge** per engine on `BuildStudioConfigForm` radio rows:
  `present ✓ v0.x.y` / `not installed ✗`, backed by persisted state with a
  live **Re-check**. Grok would now **honestly** show `not installed ✗` instead
  of a silent dispatch failure.

### 4.3 Governed provision action (the net-new write path)

`provisionBuildEngine(engineId, { offline? })` server fn:

1. **Permission gate** — reuse `requireManageProviders()` (same authz that guards
   `toggleProviderStatus`).
2. **Sandbox precondition** — ensure running (reuse `check_sandbox` /
   `diagnose_sandbox`); if not, surface the existing recovery actions.
3. **Idempotency** — probe first; if present at an acceptable version, **no-op
   success**.
4. **Recipe selection** — filter by `offline` (drop `requiresEgress`) and musl
   (`muslSafe`), order by `priority`, take the first.
5. **Execute** via a **dedicated governed exec path** (`execInSandbox` directly —
   *not* `run_sandbox_command`), auditing each attempt.
6. **Re-probe to verify** — only report success if `verify` now passes. "Ran the
   installer" ≠ "binary present" (structural-verification-is-not-functional).
7. **Persist** `BuildEngineState` (present, version, recipeApplied,
   lastProvisionedAt, `desired=true`, provisionedBy) + write a `BuildActivity` /
   audit entry.

Surfaces:
- **`ProvisionEngineButton`** — mirrors `EnableRunnerButton`; calls the action,
  refreshes the badge.
- **MCP tool `provision_build_engine`** (`sideEffect:true`,
  `requiredCapability: manage_providers`, `executionMode: proposal` with an
  `autoApproveWhen` predicate for pre-authorized operator/kernel flows) — the
  Coworker can provision.

### 4.4 Idempotency across sandbox rebuilds (auto-replay)

Sandboxes are recreated (recovery `start`/`restart`/`reset`, slot reuse). A
provisioned engine that isn't baked **disappears** on rebuild. The `desired` flag
in `BuildEngineState` is **persisted intent**: an engine provisioned once by an
operator or the Coworker is recorded as desired.

A **reconciler** runs after a sandbox (re)becomes ready (hook in the sandbox
lifecycle / `sandbox-recovery.ts` success paths): for every engine where
`desired=true` AND a fresh probe says `present=false`, **re-run its recipe**. This
answers the idempotency-across-rebuilds constraint: provisioning **persists
intent and re-runs**, it isn't a one-shot.

### 4.5 Bake-in becomes an optimization

`Dockerfile.sandbox` keeps `bakeInDefault:true` engines baked for cold-start
speed (claude, codex). On first boot the reconciler probes them, finds them
present, and marks `desired=true` (bundled-services-active-by-default). Engines
with `bakeInDefault:false` (grok today) provision on demand.

**Air-gap**: the image stages binaries/tarballs into `/opt/dpf-engines/<id>` at
build time **without** global install or egress; the `prestaged-binary` recipe is
a `cp`+`chmod` into PATH. Minimal/no-egress installs thus have a real provision
path that never touches the network.

### 4.6 Closing the "gate writes a check it can't cash" gap

Enable (`toggleProviderStatus`) and dispatch-config selection grow a **readiness
precondition**: when an operator enables or selects an engine whose
`BuildEngineState.present=false`, the UX surfaces **"Provision required"** →
Provision → then enable/select. The Coworker path mirrors this via the two MCP
tools. Selecting Grok now leads to install→verify→green, never to a runtime
`grok: not found`.

## 5. Governance & principles

| Principle | How the design honors it |
| --- | --- |
| bundled-services-active-by-default | Baked engines auto-marked desired/present on boot; on-demand engines first-class without admin ceremony |
| zero-click-provider-setup | Select Grok → auto-provision → green; no Dockerfile edit |
| verify-substrate-before-proposing-new | Reuses probes, EnableRunnerButton pattern, sandbox MCP tools, registry sync, `execInSandbox` |
| ai-coworker-as-the-conduit | Read + write MCP tools so the Coworker inspects **and** provisions |
| recursive-self-improvement | New engine = a `build-engines.json` data PR |
| structural-verification-is-not-functional | Provision success requires a **re-probe**, not "installer exited 0" |

Provisioning is side-effecting → **permission-gated** (`requireManageProviders`)
and **audited** (`BuildActivity` + audit entry per attempt). The
remote-code-exec-blocked `run_sandbox_command` surface stays locked; provisioning
uses its own governed exec path.

## 6. Phasing

**Epic `EP-ENGINE-PROVISION`** — Build-Engine Provisioning: declarative recipes,
readiness surfacing, governed in-sandbox install.

- **Phase 1 — Readiness surfacing (read-only, no install).** Fixes the worst gap
  (black-boxed sandbox + dishonest "looks wired") with zero side-effecting risk.
  - BI-1a: `build-engines.json` engine registry + `BuildEngine` sync +
    `BuildEngineState` model + non-throwing `probeEngineReadiness`; backfill
    claude/codex/grok recipes & verify as data.
  - BI-1b: Read-only MCP `get_build_engine_readiness` + per-engine readiness badge
    on `BuildStudioConfigForm` (persisted state + live Re-check).
- **Phase 2 — Governed provision (net-new write path).**
  - BI-2a: `provisionBuildEngine` server fn (gate → recipe-select → governed exec
    → re-probe verify → audit/persist) + `ProvisionEngineButton`.
  - BI-2b: `provision_build_engine` MCP tool (governed, auto-approve under
    manage_providers).
  - BI-2c: Gate Enable / dispatch-select on readiness ("Provision required"),
    closing the gate-can't-cash gap.
- **Phase 3 — Idempotency + air-gap hardening.**
  - BI-3a: Auto-replay reconciler on sandbox (re)ready.
  - BI-3b: `prestaged-binary` recipe + `/opt/dpf-engines` staging + offline mode.
  - BI-3c (optional): musl-compat recipe validation + bake-in toggle.

## 7. Recommended Phase-1 slice

**BI-1a + BI-1b** — the read-only readiness substrate. Contained, no side effects,
immediately replaces the dishonest "looks wired" signal with honest per-engine
presence (Grok → `not installed ✗`), exposes readiness to the Coworker, and lays
the `BuildEngine` / `BuildEngineState` / recipe data foundation that Phases 2–3
build on. Provisioning (the side-effecting work) lands only after readiness is
trustworthy.
