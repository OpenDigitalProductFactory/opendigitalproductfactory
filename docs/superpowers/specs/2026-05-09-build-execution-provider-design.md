# Build Execution Provider + Agent Runner Architecture (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs full "Research & Benchmarking" before finalization. 2026-06-xx
> chief-architect reconciliation added (see top matter); interfaces still
> unextracted, Sandbox model landed independently, Grok layering ratified.
>
> **Doctrine reference:** this spec is the canonical implementation
> of contract 6 (build execution) from
> `docs/superpowers/specs/2026-05-09-deployment-contracts.md`. Where
> doctrine owns shared rules (Contract 9 envvars, per-deployment
> defaults), this spec **references** rather than restates.
>
> Purpose: stop scattering Build Studio caveats across every
> deployment spec by isolating the two hardest shared concerns —
> sandbox lifecycle and agent execution — behind two orthogonal
> abstractions.
>
> **2026-05-10 revision (chief-architect review):** the prior draft
> conflated substrate (where the sandbox runs) with agent (what runs
> inside the sandbox) into one `BuildExecutionProviderImpl`. This
> revision splits them into `BuildExecutionProvider` (substrate) and
> `BuildAgentRunner` (agent), and introduces a first-class
> `dpf-native` agent so Build Studio can ship on every substrate
> without depending on bundled vendor CLIs (Codex, Claude Code) or
> their port 1455 OAuth callbacks. See "What changed in 2026-05-10
> revision" below for the rationale and migration sketch.
>
> **2026-06-xx Chief Architect Reconciliation (post-implementation scan):**
> - **Implementation status:** Zero extraction landed. No `BuildExecutionProvider` / `BuildAgentRunner` interfaces, no `build-orchestrator.ts`, no `providers/` or `agents/` directories, no contract tests. Current sandbox logic remains in `sandbox.ts` + MCP tools + codex/claude-dispatch.ts (the "reference behavior" this spec intended to encapsulate). `Sandbox` Prisma model (exact shape proposed at schema impact §) **has** landed independently at `packages/db/prisma/schema.prisma:4796` (with FeatureBuild relation) and appears in generated client — this is positive incremental formalization of build-phase state, but it happened outside the provider abstraction. dpf-native agent runner, image variants, and cross-axis matrix remain design-only.
> - **Research & Benchmarking (AGENTS.md §10):** Still TBD. No comparisons executed against GitHub Actions self-hosted, GitLab Runner, Buildkite, Drone, Firecracker/gVisor/Kata, AWS CodeBuild, etc. The executor/orchestrator split analogy is unvalidated in the record.
> - **Ratified elements:** The 2026-05-31 "Near-term Grok worker layering" and "Worker worktree boundary" sections are sound and consistent with `worktree-is-source-control-not-runtime` kernel principle (AGENTS §4) and the contribution-dispatch pattern. dpf-native remains the highest-leverage path for Contract 9 mode-1 compliance, air-gapped support, and substrate unlock (every cloud substrate becomes Build-Studio-capable without privileged pods or port 1455).
> - **Risk / sequencing note:** Sandbox model existing without the surrounding provider contract increases the chance of ad-hoc usage drifting from the intended `exec` / lifecycle abstraction. Recommend treating interface extraction (sequencing step 1) as a **refactoring priority** before new provider or agent work — it is now a "no-op" only if we move quickly. Security review checklist remains fully applicable (heavy weight).
> - **Recommendation:** Promote this from research stub to "binding pending Research & Benchmarking completion + interface extraction PR" once the benchmarking notes are added and the first extraction lands behind the existing feature flags / disabled default. This spec still owns the shape of Contract 6.

## Why this exists

Build Studio's current sandbox lifecycle uses Docker socket / sibling
container semantics. The portal container shells out to `docker
create / start / exec` against the host's `/var/run/docker.sock`
(`apps/web/lib/integrate/sandbox/sandbox.ts`,
`apps/web/lib/mcp-tools.ts:1025-1162`,
`docker-compose.yml:81`). That works fine on a single VM with Docker
Engine. It fails or is restricted on:

- **ECS Fargate, Cloud Run, Azure Container Apps** — no Docker
  socket access at all.
- **Managed Kubernetes (EKS / GKE / AKS)** — Docker-in-Docker
  requires privileged pods, which most customer security postures
  forbid.
- **TAPPaaS NixOS / Podman service pattern** — different runtime;
  the OpenWebUI module precedent uses Podman, not Docker socket.

The cloud-deployment spec
(`docs/superpowers/specs/2026-05-09-cloud-deployment-design.md`)
flags this as the bottleneck for the Managed container service and
Managed Kubernetes substrates, and as the gating decision for
TAPPaaS native (NixOS/Podman) packaging. Continuing to special-case
Build Studio per substrate would scatter the same logic across five+
deployment specs and guarantee drift.

In parallel, today's agent dispatchers
(`apps/web/lib/integrate/codex-dispatch.ts`,
`apps/web/lib/integrate/claude-dispatch.ts`) shell out to `docker
exec ${SANDBOX_CONTAINER}` to invoke vendor CLIs (`@openai/codex`,
`@anthropic-ai/claude-code`) bundled in `Dockerfile.sandbox:6,9`.
These calls **bypass DPF's `LLM_BASE_URL` audit envelope** (Contract
9 mode 4) and rely on port 1455 for Codex's OAuth callback —
constraints that scatter further per substrate.

The fix is two orthogonal abstractions:

1. **`BuildExecutionProvider`** — substrate primitive. Each
   substrate (local Docker, k8s, ECS, Cloud Run Service, Azure
   Container Apps, TAPPaaS VM) implements one provider. The
   provider owns sandbox lifecycle and a generic `exec` primitive.
2. **`BuildAgentRunner`** — agent above the substrate. Each agent
   (Codex CLI, Claude Code CLI, dpf-native) implements one runner.
   The runner orchestrates a build task using the provider's `exec`
   primitive plus its own credential / loop / IO discipline.

The substrate × agent matrix becomes orthogonal: ship one new
provider for a new substrate; ship one new agent for a new build
strategy. No N×M reimplementation. This is the GitHub Actions /
GitLab Runner / Buildkite separation: executor (substrate) vs
work definition (orchestrator).

## What changed in 2026-05-10 revision

The prior draft fused substrate and agent into one interface, with
the rationale that "without this in the provider interface, every
non-`local-docker` provider would have to reimplement the dispatch
logic." That argument is backwards: the agent dispatch logic varies
by **agent** (Codex's `~/.codex/auth.json` shape, Claude Code's
OAuth mount, dpf-native's in-process loop), not by **substrate**.
Every substrate already needs a generic `exec(handle, command[]) →
ExecResult` primitive — that's all Codex and Claude need. Agent
runners live one layer above.

Splitting matters because of the install-mode unlock. The prior
draft marked Build Studio **Unsupported** on Managed Container
Service substrates (ECS Fargate, Cloud Run, Azure Container Apps)
because port 1455 (Codex OAuth callback) can't be exposed there.
Add a `dpf-native` agent that uses Contract 9 mode 1 (`LLM_BASE_URL`
inference) instead of bundled vendor CLIs, and every substrate
becomes Build-Studio-capable with no port 1455 lock-in, no in-
sandbox refresh tokens, no mode-4 audit gap. That's the largest
strategic payoff of doing this abstraction right.

The `dpf-native` agent is also the path to closing Contract 9's
mode-4 compliance gap (line 245–259 of the doctrine spec): air-
gapped, regulated, and FedRAMP customers can run Build Studio
without bundled vendor CLIs and without vendor egress.

## Current implementation as the `local-docker` provider × CLI runners

The existing code in
`apps/web/lib/integrate/sandbox/sandbox.ts` (444 LOC),
`apps/web/lib/mcp-tools.ts:1025-1162`,
`apps/web/lib/integrate/codex-dispatch.ts` (316 LOC), and
`apps/web/lib/integrate/claude-dispatch.ts` (368 LOC) is the
reference behavior. In this taxonomy:

- `sandbox.ts` + the sandbox MCP tools become the `local-docker`
  provider implementation.
- `codex-dispatch.ts` becomes the `codex` agent runner.
- `claude-dispatch.ts` becomes the `claude` agent runner.

The refactor extracts the existing logic behind two stable
interfaces without behavior change for current Windows / macOS /
Linux installs. Today's behavior == `local-docker` × {`codex`,
`claude`}.

## The two interfaces (proposed)

### `BuildExecutionProvider` — substrate primitive

```typescript
type BuildExecutionProviderId =
  | "local-docker"
  | "tappaas-vm"
  | "kubernetes-job"
  | "ecs-task"          // batch; no preview URL
  | "ecs-service"       // long-running; preview URL via ALB
  | "cloud-run-job"     // batch; no preview URL
  | "cloud-run-service" // long-running; preview URL via Cloud Run frontend
  | "azure-containerapp-job"
  | "edge-node-local-docker"   // see Open Questions
  | "disabled";

interface BuildExecutionProvider {
  readonly id: BuildExecutionProviderId;

  // Sandbox lifecycle
  createSandbox(spec: SandboxSpec): Promise<SandboxHandle>;
  startSandbox(handle: SandboxHandle): Promise<void>;
  destroySandbox(handle: SandboxHandle): Promise<void>;

  // The substrate primitive every agent runner uses
  exec(handle: SandboxHandle, command: string[], opts?: ExecOpts): Promise<ExecResult>;

  // File IO — required for build artifact transport
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  writeFile(handle: SandboxHandle, path: string, content: string): Promise<void>;
  copyAppsWebInto(handle: SandboxHandle, source: string): Promise<void>;

  // Optional preview surface — null when substrate can't host a
  // long-running HTTP server (cloud-run-job, ecs-task, etc.)
  getPreviewUrl(handle: SandboxHandle): Promise<string | null>;
  launchNextDev(handle: SandboxHandle): Promise<void>;

  capabilities(): BuildExecutionProviderCapabilities;
}

type BuildExecutionProviderCapabilities = {
  // Isolation class — host boundary protecting against untrusted code.
  isolation: "none" | "container" | "pod" | "vm" | "managed-job";

  // Trust level — what code the Authority Core may route here.
  trustLevel: "trusted-code-only" | "customer-trusted" | "untrusted-ok";

  // Workspace persistence between exec calls.
  workspacePersistence: "ephemeral" | "ttl" | "durable";

  // Log destination contract.
  logSink: "authority-core" | "external-required" | "provider-native";

  // Network model.
  networkPolicy: "host" | "namespaced" | "isolated";

  // Cleanup model. See "Cleanup mechanism" below.
  cleanupModel: "explicit" | "ttl" | "label-sweep";

  // Surface support.
  supportsPreviewUrl: boolean;          // false ⇒ getPreviewUrl returns null
  supportsPortCallbacks: boolean;       // arbitrary host-reachable port mappings (e.g. 1455)
  supportsFileCopy: boolean;            // copyAppsWebInto + readFile + writeFile
  supportsSnapshot: boolean;            // capture sandbox snapshot for resume / replay
  dockerInsideSandbox: boolean;         // can the sandbox run docker (most can't)

  // Concurrency advertisement.
  maxConcurrentSandboxes?: number;
};
```

### `BuildAgentRunner` — agent above the substrate

```typescript
type BuildAgentId = "codex" | "claude" | "grok" | "dpf-native";

interface BuildAgentRunner {
  readonly id: BuildAgentId;

  // Idempotent setup — inject auth.json, mount OAuth state, no-op
  // for dpf-native (which uses portal-side credentials).
  prepare(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    credential: AgentCredential | null,
  ): Promise<void>;

  // Run a single build task to completion.
  run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult>;

  capabilities(): BuildAgentRunnerCapabilities;
}

type BuildAgentRunnerCapabilities = {
  // Tier of work this agent reliably handles. Build Studio's
  // task router picks an agent whose tier matches the task class.
  // Promotion between tiers is gated by eval pass rate vs the
  // current default — see "dpf-native cutover gates" below.
  tier: "single-file-edit" | "multi-file-refactor" | "full-spec-implement";

  // True if the agent is an interactive REPL that requires the
  // sandbox to persist between exec calls. Codex CLI and Claude
  // Code CLI today are true. dpf-native is false (portal-side loop;
  // sandbox calls are stateless).
  requiresPersistentSession: boolean;

  // If the agent needs a callback port (Codex needs 1455 for OAuth),
  // declare it here so the orchestrator can reject incompatible
  // substrates at install time, not at first use.
  requiresCallbackPort?: number;

  // Whether this agent consumes credentials at all (dpf-native does
  // not — it routes through the portal's existing inference layer
  // and the credentials live in DPF's encrypted credentials store).
  requiresCredential: boolean;

  // Honors LLM_BASE_URL contract (Contract 9 mode 1). True for
  // dpf-native; false for codex/claude (mode 4). Authority Core
  // uses this to enforce air-gapped / regulated install policy.
  honorsLlmBaseUrl: boolean;
};

type AgentRunSpec = {
  prompt?: string;
  workspaceSubdir?: string;
  timeoutMs?: number;
  approvalPolicy?: "never" | "ask";   // default "never" for autonomous
  toolGrants?: string[];               // for dpf-native: which MCP tools the loop may call
  envOverrides?: Record<string, string>;
};

type AgentRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  toolExecutionId: string;             // linkage to ToolExecution audit row
  agentId: BuildAgentId;               // for routeContext attribution
  providerId: BuildExecutionProviderId;
};

type AgentCredential = {
  agent: BuildAgentId;
  type: "oauth" | "api-key" | "none";
  payload: Record<string, string>;     // never logged; written via prepare()
};
```

### Near-term Grok worker layering

> Added 2026-05-31 because Grok is being considered as an additional
> Build Studio worker while concurrent worktree and self-upgrade hardening are
> active. This section prevents "add a provider" from accidentally becoming a
> third execution architecture.

Grok must enter Build Studio through one of two explicit layers:

1. **Preferred: Grok as a `ModelProvider` behind `dpf-native`.** If Grok is
   consumed through the platform's normal inference/routing surface, no new
   `BuildAgentRunner` is needed. The active Build Studio worker remains
   `dpf-native`; Grok is one model/provider option selected by route policy,
   scored by model metadata/evals, and audited through the existing inference
   envelope. This is the safest path for self-update and BC/DR because no new
   filesystem writer, OAuth callback, sandbox credential mount, or CLI session
   is introduced.
2. **Allowed only when necessary: Grok as a `BuildAgentRunner`.** If Grok uses
   a distinct coding-agent loop or CLI that reads/writes the workspace itself,
   it is a peer of `codex` and `claude`, not a special case. It must implement
   `prepare()`, `run()`, `capabilities()`, emit `ToolExecution` with
   `routeContext.build.agentId="grok"`, pass the agent-runner contract test,
   and declare whether it requires credentials, persistent session state,
   callback ports, direct vendor egress, or `LLM_BASE_URL` compliance.

Grok is **not** allowed to:

- write directly into the root clone;
- run in a shared worktree with another Build Studio worker;
- mutate the canonical install branch outside the promotion path;
- create a separate "Grok sandbox" lifecycle outside
  `BuildExecutionProvider`;
- skip `ToolExecution` / build evidence attribution; or
- bypass provider activation, token-spend logging, model capability metadata,
  or route policy.

The Build Studio task router should treat Grok as an opt-in worker until it has
eval evidence for the same task tiers used by `dpf-native`: single-file edit,
multi-file refactor, and full-spec implementation. Provider activation alone
only proves credentials work; it does not prove Grok can safely act as a coding
worker.

First-class Grok support requires a **provider-onboarding gate**, not only a
new enum value:

- The seed path must persist every routing field it advertises. If
  `providers-registry.json` declares `cliEngine: "grok"`, the provider seeder
  must write `ModelProvider.cliEngine` on both create and update, with a
  regression test that proves reseed/fresh install auto-detection works.
- The sandbox image or selected execution provider must prove the Grok
  executable exists and supports the non-interactive invocation being used.
  Official CLI flags are part of the contract. If the CLI is missing or the
  invocation probe fails, Grok is `unavailable`, not a selectable default.
- A Grok `BuildAgentRunner` must use the passed `BuildExecutionProvider` and
  `SandboxHandle` for every exec/read/write action. Direct `docker exec
  ${SANDBOX_CONTAINER}` calls are a local-docker shortcut and are not permitted
  in runner code.
- Credential and prompt material must be task-unique and short-lived. Use a
  provider/runner-managed per-task directory or `mktemp` equivalent, restrictive
  permissions, and `finally` cleanup. Filenames derived only from task title or
  provider id are not concurrency-safe.
- Returned `toolExecutionId` values must point to real audit rows, not static
  strings. Build evidence must identify `routeContext.build.providerId` and
  `routeContext.build.agentId`.
- Grok starts at a preview/contract-gated tier until the same verification
  matrix used for Codex/Claude/dpf-native proves the higher tier. Credentials,
  model availability, and successful chat completions do not promote a coding
  worker by themselves.

See the immediately following section ("Mandatory Architecture Capture for All Future AI Agents...") for the full, binding rules that apply to Grok and every subsequent model or agent. The Grok layering rules above are a specific application of those general invariants.

### Worker worktree boundary

Build Studio workers that need source-control isolation get a **worker
worktree**, not a runtime clone. The worktree is a branch/index container for
that worker's proposed edits. Runtime-bound verification still runs in the
canonical local install or the shared local-CI convergence sandbox described by
[`worktree-is-source-control-not-runtime`](../../founder-kernel/wiki/principles/worktree-is-source-control-not-runtime.md).

Required invariants for any worker worktree, including Grok:

- Worktree is created from `origin/main` or the approved build base, never from
  a dirty root clone.
- Branch name includes build id and worker id, e.g.
  `build/<buildId>/grok/<slug>` or the existing branch convention if Build
  Studio already assigned one.
- `.mcp.json`, `.vscode/mcp.json`, and `COMPOSE_PROJECT_NAME` are seeded by
  the same worktree bootstrap scripts used for Codex/Claude contributor
  sessions; no copied plaintext tokens.
- The worker worktree records a **verification provisioning state**:
  `compile-ready` or `source-only`.
  - `compile-ready` means the package manager is available, dependencies are
    installed or shared through a supported mechanism, and cheap source-local
    checks can run in that worktree.
  - `source-only` means Git/MCP/Compose isolation exists but local compile/test
    gates cannot run there. Source-only worktrees may still hold edits, but any
    claimed verification must come from the canonical local install or the
    shared local-CI convergence sandbox.
- The worker may run cheap source-local checks only when the worktree is
  `compile-ready`. `next build`, migration apply, UX verification, and
  MCP-touching tests are canonical-runtime evidence only in all cases.
- Promotion from worker worktree to install branch goes through the existing
  Build Studio promotion / verification path. No worker commits are applied to
  the running install by ad hoc patching.
- Self-upgrade preflight layer 4 must see active worker worktrees as capsule /
  contribution collisions. An upgrade either rebases them, preserves them,
  promotes first, or defers; it never ignores them.

Missing `node_modules`, missing `pnpm` / `corepack`, or an unbootstrapped
worktree is therefore not a product red gate by itself; it is a provisioning
state. What is forbidden is treating that worktree as verified. This keeps
"Grok worker" as a new occupant of the existing runner/worktree substrate
instead of a new substrate.

### Orchestrator

```typescript
// Top-level entrypoint. Lives at apps/web/lib/integrate/build-orchestrator.ts
// (see "Authority Core enforcement point" below).
async function runAgentCommand(
  provider: BuildExecutionProvider,
  agent: BuildAgentRunner,
  handle: SandboxHandle,
  spec: AgentRunSpec,
): Promise<AgentRunResult>;
```

The orchestrator:

1. Validates **cross-axis invariants** (substrate × agent) before
   creating the sandbox; rejects incompatible combinations at
   install time.
2. Calls `agent.prepare(provider, handle, credential)`.
3. Calls `agent.run(provider, handle, spec)`.
4. Emits the unified audit envelope (`ToolExecution` row with
   `routeContext.providerId` and `routeContext.agentId`).

`SandboxSpec`, `SandboxHandle`, `ExecResult`, `ExecOpts` shapes
inherit from the current implementation. Selection is configured at
install time (Contract 2: runtime configuration) via
`DPF_BUILD_PROVIDER=<provider>` and `DPF_BUILD_AGENT_DEFAULT=<agent>`
plus provider/agent-specific config.

`getPreviewUrl(handle)` returns the URL where the sandbox's Next.js
dev server is reachable, **or `null`** for substrates that can't
host one (`cloud-run-job`, `ecs-task`, `azure-containerapp-job`).
The portal's Build Studio UI hides the preview button when null.

## The `dpf-native` agent

`dpf-native` is the strategic default once parity gates clear. It is
DPF's own coding agent driving the existing inference layer
(`apps/web/lib/ai-inference.ts`) instead of a bundled vendor CLI.

Architecture:

- The agent loop runs **in the portal process** (Authority Core
  domain), not inside the sandbox.
- The sandbox is a **thin tool target**: `provider.exec`,
  `provider.readFile`, `provider.writeFile` are the tools the agent
  calls. Plus the portal's existing MCP tool surface gated by
  `toolGrants` (per the `mcp-tools.ts` grant model).
- All inference flows through `LLM_BASE_URL` (Contract 9 mode 1).
  No vendor CLI binaries in the sandbox image; no in-sandbox refresh
  token; no port 1455 callback; no mode-4 audit gap.
- The infrastructure is already in place: `contribution-dispatch.ts`
  runs a portal-side agentic loop and the sandbox already exposes
  file IO. `dpf-native` is the contribution-dispatch loop pointed
  at the sandbox as its tool target.

Strategic payoffs:

- **Substrate unlock.** Every substrate becomes Build-Studio-capable
  because the inference path is the same `LLM_BASE_URL` contract
  that already works on every substrate. ECS Fargate, Cloud Run,
  Azure Container Apps move from **Unsupported** to **GA** for
  Build Studio.
- **Compliance.** Air-gapped / FedRAMP / regulated installs can run
  Build Studio with the local-LLM variant of Contract 9 mode 1
  (Ollama / Docker Model Runner), with no vendor egress and no
  bundled vendor CLI binaries.
- **Audit envelope.** All inference calls flow through the existing
  `LLM_BASE_URL` audit envelope. `ToolExecution` records the full
  prompt + response per call, not just the dispatch invocation.
- **Smaller image.** `dpf-sandbox:dpf-native` ships without
  `@openai/codex` (~50 MB) and `@anthropic-ai/claude-code` (~40 MB)
  — relevant for cold-start latency on cloud-native job substrates.

Risks (offsets, not blockers):

- **Portal blast radius.** A `dpf-native` bug runs in-process with
  the portal, so could leak portal credentials. Counterbalanced by
  no long-lived OpenAI refresh token in sandbox memory and no port
  1455 OAuth surface. Both go on the security-review checklist.
- **Capability tier gap.** dpf-native must reach Codex/Claude
  parity per task class before becoming default. Cutover is
  gated, not flipped (see below).

## dpf-native cutover gates

The "works well enough" decision must not be vibes-based. Each tier
is gated by an objective eval pass rate vs the current default
(Codex on tier 1–2; Claude Code on tier 3 where applicable):

| Tier | Definition | Promotion gate |
|---|---|---|
| 1 — single-file edit | bounded edits inside one file | dpf-native pass rate ≥ Codex on `apps/web/__tests__/build-eval/single-file/*` AND p95 cost ≤ Codex |
| 2 — multi-file refactor | cross-file refactors with import graph awareness | dpf-native pass rate ≥ Codex on `multi-file/*` AND p95 cost ≤ Codex |
| 3 — full-spec implement | full ideate→design→build→ship cycles | dpf-native pass rate ≥ best-of-{Codex,Claude} on `full-spec/*` AND p95 cost ≤ best-of-{Codex,Claude} |

Build Studio's task router (`apps/web/lib/integrate/build-orchestrator.ts`)
picks the agent per-task by tier match, with explicit fallback. When
dpf-native ≥ default on a tier's gate, dpf-native becomes the new
default for that tier; the other agents stay shippable for customers
who prefer them. Same machinery as the platform's existing AI routing
applied to agents instead of models — per the "Dynamic model
discovery" principle and Contract 9.

The eval suites are the gating artifact. Their structure and
seeding are specified in the implementation plan that wraps this
spec; the spec only fixes the **shape of the gate**, not the eval
catalog.

## Cleanup mechanism (every provider)

Sandboxes orphaned by portal crash, network partition, or a `kill -9`
during shutdown must be reaped. Mechanism:

- **Labels.** Every sandbox is labeled at creation:
  `dpf.build.id=<buildId>`, `dpf.build.startedAt=<iso>`,
  `dpf.build.providerId=<providerId>`, `dpf.build.portalInstance=<instanceId>`.
- **Startup sweep.** On portal startup, the orchestrator queries the
  provider for sandboxes with this portal's `dpf.build.portalInstance`
  label and reconciles against the `Sandbox` table; any sandbox not
  in the active set is destroyed.
- **Periodic reconciler.** A scheduled task sweeps for sandboxes
  older than `SANDBOX_TIMEOUT_MS` regardless of `Sandbox` table
  state, in case both portal and DB agreed something was alive but
  the substrate disagrees.
- **Provider responsibility.** `cleanupModel` capability advertises
  which mechanism the substrate enforces: `explicit` (caller
  guaranteed to call `destroySandbox`), `ttl` (substrate destroys
  on its own clock, e.g. k8s pod TTL), or `label-sweep` (orchestrator
  reconciles by label, mandatory fallback for `local-docker`).

This is the same invariant-guard pattern as the seed-fix work; pre-
empts the chaos-test gate in the maturity-gates checklist.

## Image variants (compile-time exclusion)

For deployments that require CLI binaries to be physically absent —
air-gapped customers, supply-chain-restricted environments, or
compliance regimes that forbid bundled vendor tooling — ship
multiple sandbox image tags built around the **agent axis**:

| Tag | Bundled agents | Use case |
|---|---|---|
| `dpf-sandbox:base` | none | substrate runtime + workspace only; smallest image; minimal supply chain surface |
| `dpf-sandbox:dpf-native` | dpf-native runtime helpers | default for cloud / regulated / air-gapped installs once dpf-native is GA |
| `dpf-sandbox:cli-bundled` | Codex CLI + Claude Code CLI | today's default; transitional |

Endpoint-redirected variants (Codex with `OPENAI_BASE_URL` pointed
at a local OpenAI-compatible endpoint; Claude Code analogously) are
**runtime envvars** on `cli-bundled`, not separate image tags. See
Contract 9 sub-contract for the envvar names — restated nowhere else.

The `Dockerfile.sandbox` refactor that supports this lands as part
of this provider epic; the image-publish workflow
(`.github/workflows/publish-image.yml`) adds matrix tags accordingly.

## Runtime envvars (Contract 9 reference)

CLI agent enable/disable, endpoint redirection, and OAuth callback
port pinning are owned by Contract 9 in the doctrine spec
(`docs/superpowers/specs/2026-05-09-deployment-contracts.md:340-353`).
This spec **does not restate them**. Provider implementations read
those envvars; agent runners read them; both reject configurations
that violate cross-axis invariants (see contract test below).

New envvars introduced by this spec:

```
DPF_BUILD_PROVIDER=local-docker|tappaas-vm|kubernetes-job|...|disabled
DPF_BUILD_AGENT_DEFAULT=codex|claude|grok|dpf-native
DPF_BUILD_AGENT_FALLBACK=codex|claude|grok|dpf-native    # optional; orchestrator falls back when default fails
```

Per-provider config (cluster name, namespace, IAM role, etc.) is
provider-specific and lives in the provider's own envvar namespace
(`DPF_PROVIDER_K8S_*`, `DPF_PROVIDER_ECS_*`, etc.).

## Contract tests

Two contract tests, one per interface, plus the cross-axis
invariant set.

### Substrate contract — `apps/web/__tests__/sandbox-provider-contract.test.ts`

Asserts substrate **semantics**, not just method-callable:

- `trustLevel: "untrusted-ok"` ⇒ `isolation` ∈ {`vm`, `managed-job`}.
  Container isolation is not strong enough for arbitrary external code.
- `logSink: "authority-core"` ⇒ provider must emit log events to
  `ToolExecution`; the test asserts a known log line appears.
- `workspacePersistence: "ephemeral"` ⇒ `cleanupModel` ∈ {`ttl`,
  `label-sweep`} (orchestrator can't rely on explicit destroy when
  the substrate may evict mid-run).
- `supportsPreviewUrl: false` ⇒ `getPreviewUrl()` returns null and
  the Build Studio UI hides the preview button.

### Agent runner contract — `apps/web/__tests__/build-agent-runner-contract.test.ts`

- `requiresCredential: true` ⇒ `prepare()` errors when called with
  `credential: null`.
- `requiresCredential: false` ⇒ `prepare()` succeeds with
  `credential: null` (dpf-native).
- `honorsLlmBaseUrl: true` ⇒ all outbound LLM calls observed during
  `run()` resolve to `LLM_BASE_URL`'s host (test mocks the inference
  layer and asserts no direct vendor egress).
- `requiresPersistentSession: true` ⇒ provider must declare
  `workspacePersistence !== "ephemeral"` before the runner accepts
  the call.

### Cross-axis invariants (orchestrator-enforced)

These run inside `runAgentCommand` and are also asserted by an
integration test that pairs every provider with every agent:

- `agent.requiresPersistentSession && provider.workspacePersistence === "ephemeral"` ⇒ reject at install time, not at first use.
- `agent.requiresCallbackPort && !provider.supportsPortCallbacks` ⇒ reject at install time. (Codex × `cloud-run-job` is the canonical example.)
- `agent.requiresCredential && credential == null` ⇒ reject before sandbox creation (no wasted resource provisioning).
- `provider.id === "disabled"` ⇒ all calls return 503 from the Build Studio UI; the orchestrator never reaches `prepare()`.

These are the runner-playbook lessons made enforceable so a future
provider or agent can't quietly weaken trust, log, or isolation
guarantees by setting booleans.

## Per-deployment-target defaults (two-axis matrix)

The matrix has two axes: **substrate** (rows) × **agent** (columns).
A cell value tells you the Build Studio status for that combination
on that deployment target.

| Deployment | Default substrate | × `codex` | × `claude` | × `grok` | × `dpf-native` |
|---|---|---|---|---|---|
| Windows local | `local-docker` | GA | GA | preview, runner-contract gated | preview → GA per cutover gates |
| macOS local | `local-docker` | GA (Docker Desktop) | GA | preview, runner-contract gated | preview → GA |
| Linux local | `local-docker` | GA | GA | preview, runner-contract gated | preview → GA |
| Single VM (cloud) | `local-docker` | GA | GA | preview, runner-contract gated | preview → GA |
| Marketplace image | `local-docker` | inherits Single VM | inherits | inherits | inherits |
| TAPPaaS — VM mode | `local-docker` (in VM) | GA | GA | preview, runner-contract gated | preview → GA |
| TAPPaaS — native NixOS/Podman | `tappaas-vm` (planned) | preview when port 1455 reachable via Caddy | preview | preview only if runner requires no unsupported callback/session feature | preview → GA |
| Managed Kubernetes | `kubernetes-job` | preview, requires 1455 Ingress + privileged node pool | preview | preview only if runner supports job-style workspace lifecycle | **preview → GA, no privileged pod required** |
| Managed container — AWS (long-running) | `ecs-service` | unsupported (port 1455 lock-in on Fargate) | preview | preview only if runner supports service-style lifecycle | **preview → GA** |
| Managed container — AWS (batch) | `ecs-task` | unsupported | unsupported (no preview surface) | unsupported unless runner is stateless/batch-safe | **preview → GA, batch only** |
| Managed container — GCP (long-running) | `cloud-run-service` | unsupported | preview | preview only if runner supports service-style lifecycle | **preview → GA** |
| Managed container — GCP (batch) | `cloud-run-job` | unsupported | unsupported | unsupported unless runner is stateless/batch-safe | **preview → GA, batch only** |
| Managed container — Azure | `azure-containerapp-job` | unsupported | preview | preview only if runner is stateless/batch-safe | **preview → GA** |
| Air-gapped / regulated | `local-docker` or `kubernetes-job` | unsupported (vendor egress) | unsupported | unsupported unless routed through local `LLM_BASE_URL` / approved offline endpoint | **preview → GA with local LLM (Contract 9 mode 1 local)** |
| Operator-disabled | `disabled` | n/a | n/a | n/a | n/a |

Reading the matrix:

- **GA** means the cell passes its maturity gates and is the
  documented default.
- **preview → GA** means the combination is architecturally
  supported and ships behind a feature flag; promotion to GA is
  gated on the dpf-native cutover gates above (for dpf-native cells)
  or the per-substrate provider's own readiness gates (for
  Codex/Claude cells on new substrates).
- **Grok preview** means either "Grok as model behind dpf-native" has
  provider/model eval evidence, or a distinct `grok` runner has passed
  the same agent-runner and cross-axis invariant tests as Codex/Claude.
  It is never enabled solely because provider credentials are active.
- **unsupported** means the combination has a structural blocker
  the spec is not committing to solve (port 1455 lock-in on Fargate-
  class substrates; no preview HTTP on batch substrates).
- **`disabled`** is a first-class option: customers in regulated
  environments can opt out of Build Studio entirely without DPF
  shipping a degraded version.

The bold cells are the **dpf-native unlock**: combinations that
move from unsupported / not-shippable to GA-capable purely by
introducing the dpf-native agent — no new substrate engineering
required beyond the provider extraction.

## Deployment guidance per substrate

- **Single VM substrate / TAPPaaS module v1 / Marketplace image:**
  ship `local-docker` provider. Same code path as Windows / macOS /
  Linux installs. No new work beyond extracting the interface.
- **Managed Kubernetes substrate:** ship `kubernetes-job` provider.
  Sandbox runs as an ephemeral pod with TTL; Helm chart values
  expose namespace, service account, image pull secrets, optional
  taint/toleration for a privileged sandbox node pool. **With
  dpf-native default, the privileged node pool is no longer
  required** — pods can run unprivileged because no vendor CLI
  needs port 1455.
- **Managed container service substrate:** ship per cloud, with
  the long-running vs batch distinction explicit. Long-running
  variants (`ecs-service`, `cloud-run-service`) host the dev
  server preview; batch variants (`ecs-task`, `cloud-run-job`,
  `azure-containerapp-job`) run a build to completion and exit,
  no preview. Cells that pair batch substrates with persistent-
  session agents (Codex CLI's REPL) are rejected by the cross-axis
  invariant.
- **TAPPaaS native mode:** ship `tappaas-vm` provider only after
  TAPPaaS NixOS/Podman precedent is validated and the Edge Node
  spec's deployment-target neutrality is preserved. Until then,
  TAPPaaS module ships with `local-docker` inside the provisioned
  VM.
- **`disabled`:** any deployment where Build Studio is policy-
  forbidden. With dpf-native available, the air-gapped /
  regulated case for `disabled` shrinks substantially — most
  regulated customers can run dpf-native against a local LLM
  instead.

## Provider responsibilities

Each provider is responsible for:

- **Sandbox image acquisition.** Pull `dpf-sandbox:<variant>` from
  GHCR (multi-arch, per Phase 1 of the installer-parity roadmap).
  Default variant is `dpf-native` once GA; transitional default
  is `cli-bundled`.
- **Resource isolation.** Memory / CPU caps consistent with the
  current `--cpus=2 --memory=4096m` defaults
  (`apps/web/lib/integrate/sandbox/sandbox.ts:13-17`).
- **Network model.** Outbound HTTPS for inference and (when
  `cli-bundled`) for vendor CLI egress; ingress for the Next.js
  dev server's port mapping (when `supportsPreviewUrl`); respect
  the substrate's network policy.
- **Lifecycle attribution.** Sandbox creation / destruction emits
  audit events into `ToolExecution` so Authority Core can
  reconstruct what was built and when, with `routeContext.providerId`
  populated.
- **Cleanup.** Per the cleanup mechanism above; declare which model
  via `capabilities().cleanupModel`. Label-based reconciliation is
  the mandatory fallback.

## Authority Core enforcement point

The orchestrator that picks substrate × agent and enforces cross-
axis invariants lives at `apps/web/lib/integrate/build-orchestrator.ts`.
Build Studio's per-task agent selection (tier matching, fallback,
eval-gate routing) is implemented there. The Build Studio MCP
tools (`apps/web/lib/mcp-tools.ts:1025-1162, 9420-9499`) call into
the orchestrator, not directly into providers or runners.

UI gating: the storefront/admin Build Studio surface reads
`provider.capabilities()` and `agent.capabilities()` to disable
features the active combination can't deliver (preview button when
`supportsPreviewUrl: false`; agent picker entries when an agent is
unavailable on the active substrate).

### Mandatory Architecture Capture for All Future AI Agents, Build Studio Workers, and Automated Coding Paths

> **This section is load-bearing for any subsequent work.** It exists
> so that future AI agents (including Grok, Claude Code, Codex, new
> specialist models, or any Build Studio-generated coding agent),
> human contributors, and automated processes cannot accidentally
> (or "pragmatically") create a third, fourth, or Nth execution
> architecture, bypass audit, violate worktree boundaries, or
> weaken the Contract 9 / substrate isolation guarantees.
>
> **Single source of truth:** This spec (especially the two
> interfaces, the cross-axis invariant rules, the capabilities
> advertisement, the cleanup/labeling contract, the image variant
> taxonomy, and the Grok layering rules) + the implementation of
> `build-orchestrator.ts` (the enforcement point) + the eventual
> extracted provider and runner contracts.

**Every future Build Studio worker or AI coding agent MUST:**

1. Enter the system through one of the two documented paths only:
   - Preferred: As a `ModelProvider` (or routing policy choice) behind the `dpf-native` `BuildAgentRunner`. No new filesystem writer, no new sandbox credential surface, no new OAuth callback, no direct vendor egress outside the `LLM_BASE_URL` envelope.
   - Allowed (only when a distinct loop/CLI is genuinely required): As a first-class `BuildAgentRunner` peer of `codex` / `claude` / `grok`. It **must** implement the full `prepare()` / `run()` / `capabilities()` contract, emit correctly attributed `ToolExecution` rows with `routeContext.build.{providerId, agentId}`, pass the agent-runner contract test, and declare its requirements (persistent session, callback port, credential, honorsLlmBaseUrl, etc.) so the orchestrator can enforce cross-axis invariants at install time.

2. Respect the substrate × agent matrix and the cross-axis invariants (documented above). A new agent that requires a persistent REPL session may **not** be paired with an ephemeral `managed-job` substrate. A new agent that needs port 1455 may **not** be used on Fargate-class substrates until a provider that supports callbacks exists.

3. Never write directly into the canonical install tree or root clone except through the documented promotion / `git apply` path that lands on the durable per-install branch (see governed-platform-upgrade-lifecycle-design.md §5.0 and the worktree-is-source-control-not-runtime kernel principle).

4. Never create ad-hoc "special" sandboxes, sidecar volumes, or direct `docker exec` / `kubectl exec` / cloud SDK calls that bypass `BuildExecutionProvider.exec` + the orchestrator.

5. Participate in the labeled cleanup / startup-sweep / periodic-reconciler mechanism. Every sandbox must carry the `dpf.build.*` labels; orphaned sandboxes must be reaped by the provider's declared `cleanupModel`.

6. Honor the three image variants (`base`, `dpf-native`, `cli-bundled`) and the Contract 9 envvar discipline. New agents that need binaries must be added via a new variant or documented runtime redirection — never by mutating the default image for all deployments.

7. Surface capability tier evidence (single-file / multi-file / full-spec) and go through the same eval-gate cutover process before becoming a default for any tier. Provider/model activation alone is never sufficient.

**Forbidden patterns (any AI agent, Build Studio brief, or automated process that touches build execution must treat these as architecture violations):**
- Direct shelling out to `docker` / `podman` / `kubectl` / cloud SDKs from MCP tools, server actions, or agent loops without going through the registered provider.
- New "Grok-only", "specialist-X-only", or "model-Y sandbox" lifecycles.
- Bypassing `ToolExecution` attribution or `routeContext.build` fields.
- Assuming a particular substrate (e.g., "we have Docker socket here") in agent or build-plan code.
- Mutating the running portal's source tree from inside a worker without going through the documented promotion path.
- Creating worktrees or branches that the L4 preflight in the governed upgrade lifecycle cannot observe.

**How this is enforced today and in the future:**
- The orchestrator at `build-orchestrator.ts` (already wired from MCP tools and agent-coworker paths) is the choke point. All new Build Studio or agentic coding dispatch must route through it.
- Once the full provider/runner extraction lands, the contract tests + cross-axis invariant checks become compile- and install-time gates.
- Any Build Studio-generated code or specialist agent that proposes changes to sandbox execution, new dispatchers, or new image contents must cite this section of the spec and explain conformance (or request an explicit exception via the normal architecture review process).

This architecture capture is now part of the DPF kernel. It is as binding as the worktree-per-session rule or the "never ask the user to run commands" principle. Future agents reading this spec (via `doc_load`, `search_specs_and_plans`, or direct filesystem access) are hereby instructed: if your task involves build execution, coding in a sandbox, or dispatching an agentic loop against a workspace, you must start by reading this document in full and routing through the defined abstractions. Shortcuts here create permanent debt for every deployment target and every regulated/air-gapped customer.

## Refactoring scope (when this lands)

The refactor touches:

- `apps/web/lib/integrate/sandbox/sandbox.ts` — extract current
  Docker-cli logic into the `LocalDockerProvider`.
- `apps/web/lib/integrate/codex-dispatch.ts` — repackage as the
  `CodexAgentRunner`.
- `apps/web/lib/integrate/claude-dispatch.ts` — repackage as the
  `ClaudeCodeAgentRunner`.
- `apps/web/lib/integrate/build-orchestrator.ts` — host the new
  orchestrator, cross-axis invariant checks, agent tier routing.
- `apps/web/lib/mcp-tools.ts:1025-1162, 9420-9499` — sandbox MCP
  tools call through the orchestrator, not directly through
  Docker CLI.
- A new `apps/web/lib/integrate/sandbox/providers/` directory with
  one file per `BuildExecutionProvider` implementation.
- A new `apps/web/lib/integrate/sandbox/agents/` directory with
  one file per `BuildAgentRunner` implementation, including
  `dpf-native-agent-runner.ts` (initial Tier-1 implementation).
- `Dockerfile` (portal) — drop the Docker socket mount in
  deployments that don't need `local-docker`.
- `docker-compose.yml` — make the `/var/run/docker.sock` mount
  conditional on `DPF_BUILD_PROVIDER=local-docker`.
- `Dockerfile.sandbox` — split into the three image variants
  (`base`, `dpf-native`, `cli-bundled`).
- `apps/web/__tests__/sandbox-provider-contract.test.ts` (new) —
  substrate contract.
- `apps/web/__tests__/build-agent-runner-contract.test.ts` (new) —
  agent contract.
- `apps/web/__tests__/build-substrate-agent-matrix.test.ts` (new) —
  cross-axis invariant integration test.

## Schema impact

Resolved (was open in prior draft):

- **`Sandbox` model** — does not exist as a Prisma model today;
  sandbox state lives in `apps/web/lib/integrate/sandbox/sandbox-db.ts`
  as a derived view over `ToolExecution` and process state. The
  refactor introduces a first-class `Sandbox` model so labeling,
  cleanup reconciliation, and per-sandbox audit join become
  tractable. Fields:

  ```prisma
  model Sandbox {
    id                String    @id @default(cuid())
    buildId           String
    providerId        String    // BuildExecutionProviderId
    agentId           String?   // BuildAgentId, null until first run
    portalInstanceId  String    // for label-sweep reconciliation
    state             String    // creating | running | destroyed | orphaned
    startedAt         DateTime  @default(now())
    destroyedAt       DateTime?
    previewUrl        String?
    capabilitiesSnapshot Json   // provider.capabilities() at creation
    @@index([buildId])
    @@index([state, startedAt])
  }
  ```

- **`ToolExecution.routeContext`** — adds `providerId` and `agentId`
  fields under a `build` object: `routeContext.build.providerId`,
  `routeContext.build.agentId`. Existing fields untouched.

- **`EdgeNode.capabilities`** — unchanged unless the
  `edge-node-local-docker` provider lands; see Open Questions.

Migration: additive only. The `Sandbox` table replaces ad-hoc state
in `sandbox-db.ts` over a transition where both write paths run; the
old path is removed once reconciliation is verified.

## Open questions

These need answers before this stub becomes a finalized spec:

### Resolved in 2026-05-10 revision (moved out of Open Questions)

- ~~**Long-lived vs ephemeral sandbox.**~~ Each provider declares
  `workspacePersistence`; cross-axis invariant rejects incompatible
  pairs.
- ~~**File system access.**~~ `readFile` / `writeFile` /
  `copyAppsWebInto` are required `BuildExecutionProvider` methods.
  Substrate-specific transport (sidecar volume / S3 staging) is
  the provider's internal concern.
- ~~**Networking — preview URL or tunnel.**~~ `getPreviewUrl`
  returns `string | null`. Null is a first-class answer.
- ~~**Refactor without behavior change first.**~~ Promoted to a
  binding sequencing rule in the Sequencing section.

### Still open

- **`edge-node-local-docker` provider.** With customer Edge Nodes
  running on customer hardware, an `edge-node-local-docker`
  provider is plausible: build runs on the customer's own infra
  via the Edge Node, no portal-side sandbox cost, no port 1455
  lock-in on the cloud Authority Core, customer code never leaves
  the customer's network. Worth exploring after the local-docker
  extraction lands and the dpf-native agent reaches Tier 2.
  Requires Edge Node policy to grant the `BuildExecutionProvider`
  capability tier — not free.

- **Cost model for cloud-native providers.** k8s Jobs and ECS
  tasks bill by execution time; long-running interactive sessions
  could surprise customers. Configurable max-lifetime per provider?
  Likely answer: `SANDBOX_TIMEOUT_MS` already enforces a cap;
  cloud providers should advertise a `recommendedMaxLifetimeMs`
  capability and the orchestrator warns if exceeded.

- **Agent eval catalog ownership.** The cutover gates depend on
  three eval suites (`single-file/*`, `multi-file/*`, `full-spec/*`).
  Where do these live, who owns them, what's the seeding policy,
  do they version with the agent or with the platform? Probably
  belongs to a sibling spec on Build Studio evaluation. Named
  open question, deferred to that spec.

- **Sequencing — k8s vs TAPPaaS first.** Spec proposes k8s as the
  highest-value second provider (largest enterprise audience). If
  TAPPaaS native NixOS/Podman validates faster (smaller surface,
  internal team), it could leapfrog. Decided per the cloud-
  deployment-design spec's substrate priority.

## Maturity gates before implementation

This spec moves from research to binding when all of these are
complete. **Security review is weighted heavier than other specs
because the Build Execution Provider + Agent Runner combination
owns sandbox execution and inherits all of Build Studio's
privileged-runtime concerns — arbitrary code execution, credentials,
network egress, file system access, and (for dpf-native) in-process
agent loops in the portal.**

- [ ] Research & Benchmarking section complete (per AGENTS.md §10)
      — patterns from GitHub Actions self-hosted runners, GitLab
      Runner, Buildkite Agent, Drone CI agent, plus the Firecracker
      / gVisor / Kata Containers isolation primitives. Specifically
      compare their **executor vs orchestrator** split (how they
      separate substrate from work definition).
- [ ] Open questions resolved or explicitly deferred (edge-node-
      local-docker provider; cost model for cloud-native providers;
      agent eval catalog ownership; k8s-vs-TAPPaaS sequencing).
- [ ] Schema impact reviewed — `Sandbox` table introduction;
      `ToolExecution.routeContext.build.{providerId,agentId}`.
      Migration story confirmed additive.
- [ ] Canonical contracts updated if this spec changes shared
      behavior (Contract 6 of the doctrine references this spec;
      Contract 9 mode-4 envvars stay in the doctrine).
- [ ] **Security review complete (heavy):**
      - Sandbox image acquisition path per provider (registry auth,
        signed image verification)
      - Resource isolation enforcement (memory / CPU caps; preventing
        sandbox-to-host escape)
      - Network policy per provider (sandbox can reach what; Codex
        / Claude CLI agents in mode 4 still bypass `LLM_BASE_URL`
        audit envelope — documented and accepted, not silently
        allowed; dpf-native closes this gap when used)
      - Credentials propagation into sandbox (no host secrets leak;
        per-task credentials; dpf-native stores credentials in the
        portal, not the sandbox)
      - **dpf-native portal-process blast radius** — the agent loop
        runs in the portal so a dpf-native bug could leak portal
        credentials. Counterbalance: no long-lived OpenAI refresh
        token in sandbox memory, no port 1455 OAuth surface. Net
        risk profile must be reviewed and signed off explicitly.
      - Cleanup guarantees (`destroySandbox` actually runs; TTL
        enforcement on provider that uses it; label-sweep reconciler
        runs on every portal startup and on schedule)
      - Audit envelope (`ToolExecution` records emitted by every
        provider AND every agent runner; provider + agent attribution
        in `routeContext.build` is accurate; dpf-native records the
        full prompt + response per inference call)
- [ ] Release / rollback story defined — interface extraction is a
      no-op refactor first; subsequent provider implementations and
      `dpf-native` agent runner ship behind feature flags so a bad
      provider or agent can be disabled per deployment without
      touching the others.
- [ ] **Architecture capture for future agents complete** — the
      "Mandatory Architecture Capture..." section (above) has been
      reviewed and explicitly cited by any new Build Studio worker,
      specialist agent, or AI coding path before it lands. New
      dispatch logic must not bypass the orchestrator.
- [ ] Test / verification gates defined — substrate contract test;
      agent runner contract test; cross-axis invariant integration
      test; smoke test per provider on a representative substrate;
      chaos test for cleanup failure modes (orphaned sandboxes
      after portal crash, validated by label-sweep reconciler).

## Sequencing (binding)

Promoted from prior draft's Open Questions; this is the implementation
order, not a question.

1. **Interface extraction as no-op refactor.** Extract current
   `local-docker` logic behind `BuildExecutionProvider`; extract
   Codex and Claude dispatchers behind `BuildAgentRunner`; introduce
   `build-orchestrator.ts` as the single entrypoint; introduce the
   `Sandbox` Prisma model. **No behavior change** for any current
   install. Lands as one PR (or a tightly-sequenced PR series with
   feature flags). As part of this step, the "Mandatory Architecture
   Capture" section is reviewed with the implementing agent(s) so that
   the orchestrator becomes the documented, non-bypassable gate for
   all future AI / Build Studio coding work.

2. **Contract tests.** Substrate, agent, and cross-axis invariant
   tests land alongside the extraction. Every existing combination
   (`local-docker × {codex, claude}`) passes.

3. **`dpf-native` agent runner — Tier 1.** Single-file edits only.
   Behind a feature flag; opt-in for Build Studio operators. Eval
   suite seeded; cutover gate measured but not enforced (Tier 1
   default stays Codex until gate clears).

4. **Highest-value second provider.** Either `kubernetes-job` (per
   cloud-deployment spec's enterprise priority) or `tappaas-vm`
   (per TAPPaaS rollout schedule). Decided by the substrate-priority
   open question.

5. **`dpf-native` Tier 2 + Tier 3.** Eval coverage extended;
   cutover gates enforce promotion. Once dpf-native ≥ default on
   each tier's gate, dpf-native becomes the default for that tier.
   Codex and Claude remain shippable for customers who prefer them.

6. **Remaining cloud-native providers.** `ecs-task` /
   `ecs-service`, `cloud-run-job` / `cloud-run-service`,
   `azure-containerapp-job` — sequenced by customer demand and the
   cloud spec's substrate priority. Each ships paired with
   `dpf-native` as the supported agent (Codex/Claude marked
   unsupported per the matrix).

7. **Image variant default flip.** When dpf-native is GA across
   tiers, `dpf-sandbox:dpf-native` becomes the production default
   image. `dpf-sandbox:cli-bundled` remains shippable for customers
   who explicitly opt in to bundled vendor CLIs.

## Research and Benchmarking (TBD per AGENTS.md §10 — CA note: still pending as of 2026-06-xx reconciliation)

**Chief Architect note:** This section remains unpopulated. No comparisons to GitHub Actions / GitLab Runner / Buildkite / Firecracker / gVisor / Kata / CodeBuild / Claude Code loop internals etc. have been recorded. The "executor vs orchestrator" split analogy that justifies the provider × runner axis is therefore still an unvalidated architectural hypothesis in the written record. Complete this before the spec can exit "research stub" per the maturity gates checklist below.

Before finalization, compare the sandbox / build-execution patterns
of:

**Open source build / CI runners:** GitHub Actions self-hosted
runner, GitLab Runner, Buildkite Agent, Drone CI agent. Each has
a runtime-abstraction layer that supports Docker, Kubernetes, and
shell modes. **Specifically compare their executor (substrate) vs
orchestrator (work definition) split** — that's the structural
analog of this spec's provider × runner split. Read their interface
design and capability advertisement patterns.

**Open source ephemeral container orchestration:** k3s, Firecracker
(used by Fly.io), gVisor, Kata Containers. Understand the
isolation primitives.

**Commercial cloud build products:** AWS CodeBuild, Google Cloud
Build, Azure Pipelines hosted agents. They solve the same
abstraction problem at scale.

**Coding-agent SDKs and harnesses:** OpenAI Codex CLI internals,
Anthropic Claude Code CLI internals, Aider, Continue, Cursor's
agent loop, SWE-Agent. The dpf-native runner draws on the loop
patterns these establish; document which patterns adopted, which
rejected.

Document patterns adopted, patterns rejected, anti-patterns
identified, gaps the design fills.

## Source documents

- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` —
  the doctrine; this spec is contract 6's canonical
  implementation. Contract 9 mode 4 (CLI agents) is the gap
  `dpf-native` closes.
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` —
  cloud substrate / packaging target taxonomy and per-target Build
  Studio compatibility notes.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node spec; Build Studio is Authority-Core-domain, not
  Edge-Node-domain (clarified here so future contributors don't
  conflate them). The `edge-node-local-docker` provider open
  question is the one place the two could touch.
- `apps/web/lib/integrate/sandbox/sandbox.ts` (444 LOC),
  `apps/web/lib/mcp-tools.ts:1025-1162` — current `local-docker`
  reference implementation.
- `apps/web/lib/integrate/codex-dispatch.ts` (316 LOC) — current
  Codex CLI dispatcher; becomes the `CodexAgentRunner`.
- `apps/web/lib/integrate/claude-dispatch.ts` (368 LOC) — current
  Claude Code CLI dispatcher; becomes the `ClaudeCodeAgentRunner`.
- `apps/web/lib/integrate/contribution-dispatch.ts` — existing
  portal-side agentic loop; the structural template for
  `dpf-native-agent-runner.ts`.
- `apps/web/lib/ai-inference.ts` — existing `LLM_BASE_URL` /
  Contract 9 mode 1 inference layer; the dpf-native runner consumes
  this directly.
- `Dockerfile.sandbox` — sandbox image artifact; refactor splits
  into `:base`, `:dpf-native`, `:cli-bundled` variants.
- `docker-compose.yml:81` — current Docker socket mount the
  refactor makes conditional on `DPF_BUILD_PROVIDER=local-docker`.
