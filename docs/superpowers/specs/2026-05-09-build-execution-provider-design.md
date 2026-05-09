# Build Execution Provider Architecture (DRAFT / RESEARCH)

> Status: **research stub** — not yet a finalized spec. Per AGENTS.md §10
> this needs full "Research & Benchmarking" before finalization.
>
> **Doctrine reference:** this spec is the canonical implementation
> of contract 6 (build execution) from
> `docs/superpowers/specs/2026-05-09-deployment-contracts.md`.
>
> Purpose: stop scattering Build Studio caveats across every
> deployment spec by isolating the hardest shared concern — sandbox
> lifecycle — behind a provider abstraction.

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

The fix: make Build Studio consume a `BuildExecutionProvider`
interface. Each substrate / packaging target wires in the
appropriate provider implementation. The sandbox image stays the
same; the lifecycle layer becomes substrate-aware behind an
interface.

## Current implementation as the `local-docker` provider

The existing code in
`apps/web/lib/integrate/sandbox/sandbox.ts` and
`apps/web/lib/mcp-tools.ts:1025-1162` is the reference behavior. In
this taxonomy it becomes the `local-docker` provider implementation.
The refactor extracts the existing logic behind a stable interface
without behavior change for current Windows / macOS / Linux installs.

## The provider interface (proposed)

The provider abstraction owns **two responsibilities**, not one:

1. **Sandbox lifecycle** — create, start, copy files in/out,
   launch the dev server, exec arbitrary commands, destroy. This
   is what `apps/web/lib/integrate/sandbox/sandbox.ts` does today.
2. **Agent command execution** — dispatch CLI agents (Codex,
   Claude Code) into the sandbox with credentials injected. This
   is what `apps/web/lib/integrate/codex-dispatch.ts` and
   `apps/web/lib/integrate/claude-dispatch.ts` do today; both
   shell out to `docker exec ${SANDBOX_CONTAINER}`. Without this
   in the provider interface, every non-`local-docker` provider
   would have to reimplement the dispatch logic — exactly the
   per-substrate scatter the abstraction exists to prevent.

```typescript
type BuildExecutionProvider =
  | "local-docker"
  | "tappaas-vm"
  | "kubernetes-job"
  | "ecs-task"
  | "cloud-run-job"
  | "azure-containerapp-job"
  | "disabled";

type SandboxAgent = "codex" | "claude";

interface AgentCommandSpec {
  prompt?: string;
  workspaceSubdir?: string;
  timeoutMs?: number;
  approvalPolicy?: "never" | "ask";   // default "never" for autonomous
  sandboxMode?: "danger-full-access" | "restricted";
  envOverrides?: Record<string, string>;
}

interface AgentRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  toolExecutionId: string;            // linkage to ToolExecution audit row
}

interface AgentCredential {
  agent: SandboxAgent;
  type: "oauth" | "api-key";
  payload: Record<string, string>;    // never logged; written via injectAgentCredential
}

interface BuildExecutionProviderImpl {
  // Sandbox lifecycle — what the existing docker-cli layer abstracts today
  createSandbox(spec: SandboxSpec): Promise<SandboxHandle>;
  startSandbox(handle: SandboxHandle): Promise<void>;
  copyAppsWebInto(handle: SandboxHandle, source: string): Promise<void>;
  launchNextDev(handle: SandboxHandle): Promise<void>;
  exec(handle: SandboxHandle, command: string[]): Promise<ExecResult>;
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  writeFile(handle: SandboxHandle, path: string, content: string): Promise<void>;
  destroySandbox(handle: SandboxHandle): Promise<void>;

  // Agent command execution — owns Codex / Claude dispatch so
  // non-local-docker providers don't reimplement docker exec.
  injectAgentCredential(handle: SandboxHandle, credential: AgentCredential): Promise<void>;
  runAgentCommand(handle: SandboxHandle, agent: SandboxAgent, spec: AgentCommandSpec): Promise<AgentRunResult>;
  getPreviewUrl(handle: SandboxHandle): Promise<string>;

  // Capability advertisement — Authority Core uses this to decide
  // which Build Studio features to enable for this deployment.
  capabilities(): {
    persistentSandbox: boolean;          // long-lived between exec calls
    dockerInsideSandbox: boolean;        // can run docker from within (most don't)
    networkPolicy: "host" | "namespaced" | "isolated";
    maxConcurrent: number | "unbounded";
    cleanupModel: "explicit" | "ttl";
    cliAgents: {                         // which CLI agents this provider supports
      codex: boolean;
      claudeCode: boolean;
      codexCallbackPort1455: boolean;    // can the substrate expose port 1455?
    };
  };
}
```

`SandboxSpec`, `SandboxHandle`, `ExecResult` shapes inherit from the
current implementation. `AgentCommandSpec` / `AgentRunResult` /
`AgentCredential` are new shapes the agent-execution refactor
introduces. Selection is configured at install time (contract 2 of
the deployment doctrine: runtime configuration) via an env var like
`DPF_BUILD_PROVIDER=<provider>` plus provider-specific config
(cluster name, namespace, IAM role, etc.).

`getPreviewUrl(handle)` returns the URL where the sandbox's Next.js
dev server is reachable. `local-docker` returns `http://localhost:3035`;
`kubernetes-job` returns the Service / Ingress URL the cluster
allocated; `ecs-task` returns the ALB target group URL; etc. This
lets the portal's Build Studio UI link to a preview without knowing
which provider is in use.

## Sandbox image variants and CLI agent runtime flags

The current `Dockerfile.sandbox` bundles both Codex CLI and Claude
Code CLI unconditionally (`Dockerfile.sandbox:6,9`). For regulated
or local-only deployments the bundle either needs runtime
disablement or compile-time exclusion:

### Runtime flags (read by the dispatchers and by every provider)

```
DPF_SANDBOX_ENABLE_CODEX=true|false              # default true
DPF_SANDBOX_ENABLE_CLAUDE=true|false             # default true
DPF_SANDBOX_OPENAI_BASE_URL                      # optional; redirects Codex to local OpenAI-compat endpoint
DPF_SANDBOX_ANTHROPIC_BASE_URL                   # optional; redirects Claude Code similarly
```

Provider implementations that don't support a CLI agent (e.g. an
`ecs-task` provider that can't expose port 1455 for Codex's OAuth
callback) advertise this via `capabilities().cliAgents` and refuse
`runAgentCommand` calls for the unsupported agent with a clear
error rather than silently failing.

### Image variants (compile-time exclusion)

For deployments that require the CLI binaries to be physically
absent — air-gapped customers, supply-chain-restricted environments,
or compliance regimes that forbid bundled vendor tooling — ship
multiple sandbox image tags:

| Tag | Codex CLI | Claude Code CLI | Use case |
|---|---|---|---|
| `dpf-sandbox:full` (default) | yes | yes | unrestricted installs |
| `dpf-sandbox:local-only` | yes (with `OPENAI_BASE_URL` override required) | yes (with override) | air-gapped with local-routed CLIs |
| `dpf-sandbox:no-cli-agents` | no | no | maximum compliance posture |

The Dockerfile.sandbox refactor that supports this lands as part of
this provider epic; the image-publish workflow
(`.github/workflows/publish-image.yml`, currently the focus of
installer-parity Phase 1) adds matrix tags accordingly.

## Per-deployment-target defaults

| Deployment | Default provider | Build Studio parity at v1 |
|---|---|---|
| Windows local install | `local-docker` | **full** |
| macOS local install | `local-docker` | **full** if Docker Desktop is running |
| Linux local install | `local-docker` | **full** |
| Single VM substrate (cloud) | `local-docker` | **full** |
| Cloud marketplace image | `local-docker` (inherits Single VM) | **full** |
| TAPPaaS module — VM mode | `local-docker` (inside the provisioned VM) | **full** |
| TAPPaaS module — native NixOS/Podman | `tappaas-vm` (provider stub; future) | preview until provider ships |
| Managed Kubernetes substrate | `kubernetes-job` | preview until provider ships |
| Managed container service — AWS | `ecs-task` | preview until provider ships |
| Managed container service — GCP | `cloud-run-job` | preview until provider ships |
| Managed container service — Azure | `azure-containerapp-job` | preview until provider ships |
| Air-gapped / regulated | `disabled` | Build Studio off by operator policy |

`disabled` is a first-class option: customers in regulated
environments can opt out of Build Studio entirely without DPF
shipping a degraded version.

## Provider responsibilities

Each provider is responsible for:

- **Sandbox image acquisition.** Pull `dpf-sandbox` from GHCR
  (multi-arch, per Phase 1 of the installer-parity roadmap).
- **Resource isolation.** Memory / CPU caps consistent with the
  current `--cpus=2 --memory=4096m` defaults.
- **Network model.** Outbound HTTPS for CLI agents (mode 4 in the
  cloud spec's LLM routing); ingress for the Next.js dev server's
  port mapping; respect the substrate's network policy.
- **Lifecycle attribution.** Sandbox creation / destruction must
  emit audit events into `ToolExecution` so Authority Core can
  reconstruct what was built and when.
- **Cleanup.** Either explicit `destroySandbox()` or substrate-
  native TTL (k8s pod TTL, ECS task auto-stop) — provider declares
  which model it implements via `capabilities().cleanupModel`.

## Deployment guidance per substrate

- **Single VM substrate / TAPPaaS module v1 / Marketplace image:**
  ship `local-docker` provider. Same code path as Windows / macOS /
  Linux installs. No new work beyond extracting the interface.
- **Managed Kubernetes substrate:** ship `kubernetes-job` provider.
  Sandbox runs as an ephemeral pod with TTL; Helm chart values
  expose namespace, service account, image pull secrets, optional
  taint/toleration for a privileged sandbox node pool.
- **Managed container service substrate:** ship one provider per
  cloud (`ecs-task`, `cloud-run-job`, `azure-containerapp-job`).
  Sandbox runs as an ephemeral cloud-native job. Each provider
  module wraps the cloud's run-task / job-execute API.
- **TAPPaaS native mode:** ship `tappaas-vm` provider only after
  TAPPaaS NixOS/Podman precedent is validated and the Edge Node
  spec's deployment-target neutrality is preserved. Until then,
  TAPPaaS module ships with `local-docker` inside the provisioned
  VM.
- **`disabled`:** any deployment where Build Studio is policy-
  forbidden (air-gapped customer with no CLI-agent local routing,
  regulated industries with no BAA coverage on the bundled CLI
  agents per cloud spec's compliance section).

## Refactoring scope (when this lands)

The refactor touches:

- `apps/web/lib/integrate/sandbox/sandbox.ts` — extract current
  Docker-cli logic into the `LocalDockerProvider`.
- `apps/web/lib/mcp-tools.ts:1025-1162, 9420-9499` — sandbox MCP
  tools call through the provider interface, not directly through
  Docker CLI.
- A new `apps/web/lib/integrate/sandbox/providers/` directory with
  one file per provider implementation.
- `Dockerfile` (portal) — drop the Docker socket mount in
  deployments that don't need `local-docker`.
- `docker-compose.yml` — make the `/var/run/docker.sock` mount
  conditional on `DPF_BUILD_PROVIDER=local-docker`.
- `apps/web/__tests__/sandbox-provider-contract.test.ts` (new) — a
  contract test every provider must pass, so the interface stays
  semantically consistent.

## Open questions

These need answers before this stub becomes a finalized spec:

### Interface design
- **Long-lived vs ephemeral sandbox:** the current `local-docker`
  model creates a sandbox that lives across many `exec` calls.
  Cloud-native job providers (Cloud Run Jobs, ECS Run Task) run a
  command and exit. Does the interface impose long-lived semantics
  on every provider (forcing cloud providers to keep an idle
  container alive) or accept short-lived semantics (forcing the
  caller to be aware of provider lifetime)? Hybrid: each provider
  declares via `capabilities().persistentSandbox`.
- **File system access:** `local-docker` uses `docker exec tar |
  docker exec tar` for file copy. Cloud-native providers may need
  a sidecar volume / shared FS / S3 staging step. Define the
  abstraction at the right level so substrate choice doesn't leak
  into caller code.
- **Networking:** sandbox preview port (current default 3035 →
  3000 inside container) needs an equivalent on every provider.
  k8s: `Service` + Ingress; ECS: Application Load Balancer;
  Cloud Run: built-in HTTPS endpoint. Decide whether the
  abstraction returns a URL or a tunnel handle.

### Operational
- **Cost model for cloud-native providers:** k8s Jobs and ECS
  tasks bill by execution time; long-running interactive sessions
  could surprise customers. Configurable max-lifetime per provider?
- **Concurrency limits:** `local-docker` has effectively no limit
  (subject to host resources); cloud providers usually have
  account-level quotas. `capabilities().maxConcurrent` advertises
  it; Authority Core enforces per-policy.
- **Audit trail consistency:** `ToolExecution` records sandbox
  events today. Confirm every provider can emit the same shape.

### Sequencing
- **Which provider second?** After `local-docker` is extracted as
  v1, which is the highest-value second provider? Likely
  `kubernetes-job` (largest enterprise audience) or `tappaas-vm`
  (highest strategic alignment with the doctrinal refactor).
- **Refactor without behavior change first.** The interface
  extraction should land as a no-op refactor, with the existing
  Docker-cli logic moved verbatim into `LocalDockerProvider`.
  Other providers come in subsequent epics.

## Schema impact

Likely additions to existing schemas:

- `Sandbox` model (if it exists, otherwise a new field on the
  current sandbox tracking) gains a `provider` field of type
  `BuildExecutionProvider`.
- `ToolExecution.routeContext` records the provider for audit.
- `EdgeNode.capabilities` (per the Edge Node spec) is unchanged —
  Build Studio runs in the Authority Core's domain, not the Edge
  Node's.

## Research and Benchmarking (TBD per AGENTS.md §10)

Before finalization, compare the sandbox / build-execution patterns
of:

**Open source build / CI runners:** GitHub Actions self-hosted
runner, GitLab Runner, Buildkite Agent, Drone CI agent. Each has
a runtime-abstraction layer that supports Docker, Kubernetes, and
shell modes. Read their interface design.

**Open source ephemeral container orchestration:** k3s, Firecracker
(used by Fly.io), gVisor, Kata Containers. Understand the
isolation primitives.

**Commercial cloud build products:** AWS CodeBuild, Google Cloud
Build, Azure Pipelines hosted agents. They solve the same
abstraction problem at scale.

Document patterns adopted, patterns rejected, anti-patterns
identified, gaps the design fills.

## Sequencing

This spec sits **after** the deployment contracts doctrine spec is
established and the cloud-deployment spec captures the substrate
taxonomy. Implementation order:

1. **Interface extraction** — refactor existing logic into
   `LocalDockerProvider` with no behavior change.
2. **Contract test** — `sandbox-provider-contract.test.ts` ensures
   semantic consistency for any future provider.
3. **Highest-value second provider** — `kubernetes-job` or
   `tappaas-vm` per the open question above.
4. **Remaining cloud-native providers** — sequenced by customer
   demand and substrate priority.

## Maturity gates before implementation

This spec moves from research to binding when all of these are
complete. **Security review is weighted heavier than other specs
because the Build Execution Provider owns sandbox execution and
inherits all of Build Studio's privileged-runtime concerns —
arbitrary code execution, credentials, network egress, file system
access.**

- [ ] Research & Benchmarking section complete (per AGENTS.md §10)
      — patterns from GitHub Actions self-hosted runners, GitLab
      Runner, Buildkite Agent, Drone CI agent, plus the Firecracker
      / gVisor / Kata Containers isolation primitives.
- [ ] Open questions resolved or explicitly deferred (interface
      design for long-lived vs ephemeral, file-system abstraction,
      networking abstraction; cost / capacity / concurrency limits;
      audit-trail consistency; refactor sequencing).
- [ ] Schema impact reviewed — `Sandbox.provider` field,
      `ToolExecution.routeContext` provider attribution.
- [ ] Canonical contracts updated if this spec changes shared
      behavior (Contract 6 of the doctrine references this spec).
- [ ] **Security review complete (heavy):**
      - Sandbox image acquisition path per provider (registry auth,
        signed image verification)
      - Resource isolation enforcement (memory / CPU caps; preventing
        sandbox-to-host escape)
      - Network policy per provider (sandbox can reach what; LLM CLI
        agents in mode 4 still bypass `LLM_BASE_URL` audit envelope —
        documented and accepted, not silently allowed)
      - Credentials propagation into sandbox (no host secrets leak;
        per-task credentials)
      - Cleanup guarantees (`destroySandbox` actually runs; TTL
        enforcement on provider that uses it)
      - Audit envelope (`ToolExecution` records emitted by every
        provider; provider attribution is accurate)
- [ ] Release / rollback story defined — interface extraction is a
      no-op refactor first; subsequent provider implementations ship
      behind feature flags so a bad provider can be disabled per
      deployment without touching the others.
- [ ] Test / verification gates defined — `sandbox-provider-contract.test.ts`
      that every provider must pass; smoke test per provider on a
      representative substrate; chaos test for cleanup failure
      modes (orphaned sandboxes after portal crash).

## Source documents

- `docs/superpowers/specs/2026-05-09-deployment-contracts.md` —
  the doctrine; this spec is contract 6's canonical
  implementation.
- `docs/superpowers/specs/2026-05-09-cloud-deployment-design.md` —
  cloud substrate / packaging target taxonomy and per-target Build
  Studio compatibility notes.
- `docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md` —
  Edge Node spec; Build Studio is Authority-Core-domain, not
  Edge-Node-domain (clarified here so future contributors don't
  conflate them).
- `apps/web/lib/integrate/sandbox/sandbox.ts`,
  `apps/web/lib/mcp-tools.ts:1025-1162` — current `local-docker`
  reference implementation.
- `Dockerfile.sandbox` — sandbox image artifact every provider
  consumes.
- `docker-compose.yml:81` — current Docker socket mount the
  refactor makes conditional.
