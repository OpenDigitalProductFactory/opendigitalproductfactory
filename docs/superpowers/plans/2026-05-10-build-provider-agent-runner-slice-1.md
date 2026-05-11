# Build Provider Agent Runner Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract today's Build Studio local-Docker sandbox and Codex/Claude dispatch paths behind provider and agent-runner contracts without changing runtime behavior.

**Architecture:** This slice introduces the stable substrate and agent interfaces, a local-Docker provider wrapper, CLI runner wrappers for the existing Codex and Claude dispatchers, additive sandbox persistence, and contract tests. It deliberately does not implement `dpf-native`, Kubernetes, TAPPaaS, ECS, Cloud Run, Azure, image-variant splitting, or UI changes beyond keeping current behavior wired through the new orchestrator boundary.

**Tech Stack:** Next.js 16 app in `apps/web`, TypeScript, Prisma 7, Vitest, Docker Compose local runtime, existing Build Studio sandbox modules.

---

## Spec Readiness Gate (binding before Task 1)

The owning spec — `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md` — is currently labeled **"research stub"** and the maturity-gate checklist (Research & Benchmarking per AGENTS.md §10, security review weighted heavy, schema impact review, release/rollback story, test/verification gates) is unchecked. Per AGENTS.md §10 and `feedback_research_standards_first`, implementation should not begin against a research-stub spec.

This slice is intentionally a **no-op extraction**. It introduces interfaces and a no-behavior-change Adapter shell over today's reality. Two paths to authorize start:

- [ ] **Path A (preferred):** complete the maturity-gate checklist on the spec, then begin Task 1.
- [ ] **Path B (waiver):** chief architect explicitly waives the gate for slice 1 on the basis that the slice is no-op extraction with rollback = revert one PR, with the binding commitment that subsequent slices (`dpf-native`, additional providers, image-variant split) cannot start until the gate completes.

Record the chosen path here with date and signer. If neither is recorded, halt.

## Reality Check (binding context for the wrappers)

This slice's wrappers do not match the spec's idealized lifecycle. Acknowledge this up front so the boundary is honest:

- **Sandbox is a pooled singleton, not per-build.** `apps/web/lib/integrate/sandbox/sandbox-pool.ts` allocates from a fixed pool of long-lived containers (`dpf-sandbox-1`, `dpf-sandbox-2`, ...). Both `codex-dispatch.ts` and `claude-dispatch.ts` target the env-derived `SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1"`. `sandbox.ts:createSandbox(buildId, hostPort)` exists for a per-build flow that the production CLI dispatch path does not currently use.
  - The slice-1 `local-docker` provider's `createSandbox(spec)` therefore returns a `SandboxHandle` pointing at a **pool-allocated, pre-existing container** — not a fresh one. `destroySandbox()` is a no-op in slice 1; the pool owns lifecycle. Per-build container lifecycle is a follow-up slice.

- **Agent runners do not yet route I/O through `provider.exec()`.** Slice-1 wrappers call the existing dispatcher functions verbatim (which `docker exec` directly). The `provider` argument is held but unused by the runner body. This is a deliberate shim, marked with a `TODO(slice-2-thread-provider-exec)` comment in each wrapper. Threading I/O through `provider.exec()` is the smallest behavior-impacting change and ships in slice 2.

- **`Sandbox` model coexists with `FeatureBuild.sandboxId` / `sandboxPort` for the entire transition.** Slice 1 writes to `Sandbox` rows but does not modify the existing `FeatureBuild.sandboxId` / `sandboxPort` write path; both exist. Removal of the legacy fields is gated on cleanup-reconciliation working end to end (a follow-up slice).

The contract tests in this slice verify type shape and capability invariants. They do **not** prove "no behavior change" — that burden is carried by existing tests + the manual Build Studio smoke check in Task 11.

## Scope Check

The approved spec covers several independent implementation tracks:

- Provider/runner extraction and contract tests.
- Additive `Sandbox` persistence and cleanup reconciliation.
- `dpf-native` agent runner.
- Cloud/TAPPaaS/Kubernetes providers.
- Sandbox image variant changes.
- UI and policy routing for provider/agent compatibility.

This plan covers only the first production-safe slice: **no-op extraction with local Docker and existing CLI runners**. Follow-up plans should cover `dpf-native`, provider expansion, and self-update/promotion workflows separately.

## Files And Responsibilities

- `apps/web/lib/integrate/sandbox/provider-types.ts`  
  Defines `BuildExecutionProvider`, `SandboxHandle`, `ExecResult`, capabilities, provider IDs, and invariant helpers.

- `apps/web/lib/integrate/sandbox/agent-runner-types.ts`  
  Defines `BuildAgentRunner`, runner IDs, runner capabilities, run specs/results, and runner/provider compatibility checks.

- `apps/web/lib/integrate/sandbox/providers/local-docker-provider.ts`  
  Wraps existing functions from `apps/web/lib/integrate/sandbox/sandbox.ts` as the `local-docker` provider. This is intentionally thin.

- `apps/web/lib/integrate/sandbox/providers/index.ts`  
  Provider registry and `getBuildExecutionProvider()`.

- `apps/web/lib/integrate/sandbox/agents/codex-agent-runner.ts`  
  Wraps `apps/web/lib/integrate/codex-dispatch.ts` behind `BuildAgentRunner`.

- `apps/web/lib/integrate/sandbox/agents/claude-agent-runner.ts`  
  Wraps `apps/web/lib/integrate/claude-dispatch.ts` behind `BuildAgentRunner`.

- `apps/web/lib/integrate/sandbox/agents/index.ts`  
  Agent registry and `getBuildAgentRunner()`.

- `apps/web/lib/integrate/build-orchestrator.ts`  
  Adds a narrow orchestration entrypoint that selects provider + runner, checks compatibility, records attribution, and delegates to existing code.

- `apps/web/lib/integrate/sandbox/sandbox-db.ts`  
  Adds additive `Sandbox` persistence helpers while preserving existing callers.

- `packages/db/prisma/schema.prisma`  
  Adds the `Sandbox` model and optional relation from `FeatureBuild`.

- `packages/db/prisma/migrations/<timestamp>_add_build_sandbox_model/migration.sql`  
  Additive migration for the `Sandbox` table and indexes.

- `apps/web/lib/integrate/sandbox/provider-contract.test.ts`  
  Tests provider capability invariants and local-Docker contract metadata.

- `apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts`  
  Tests runner capability invariants and Codex/Claude compatibility requirements.

- `apps/web/lib/integrate/sandbox/build-substrate-agent-matrix.test.ts`  
  Tests cross-axis compatibility rules so incompatible substrate/agent pairs fail before runtime.

## Chunk 1: Interfaces And Contract Tests

### Task 1: Add Provider Type Boundary

**Files:**
- Create: `apps/web/lib/integrate/sandbox/provider-types.ts`
- Test: `apps/web/lib/integrate/sandbox/provider-contract.test.ts`

- [ ] **Step 1: Write failing provider invariant tests**

Create `apps/web/lib/integrate/sandbox/provider-contract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assertProviderCapabilities } from "./provider-types";

describe("BuildExecutionProvider capabilities", () => {
  it("rejects untrusted-ok without vm or managed-job isolation", () => {
    expect(() => assertProviderCapabilities({
      isolation: "container",
      trustLevel: "untrusted-ok",
      workspacePersistence: "durable",
      logSink: "authority-core",
      networkPolicy: "namespaced",
      cleanupModel: "explicit",
      supportsPreviewUrl: true,
      supportsPortCallbacks: true,
      supportsFileCopy: true,
      supportsSnapshot: false,
      dockerInsideSandbox: false,
    })).toThrow(/untrusted-ok/i);
  });

  it("rejects ephemeral workspace with explicit cleanup", () => {
    // Substrate that can be evicted mid-run cannot rely on caller-driven destroy.
    expect(() => assertProviderCapabilities({
      isolation: "managed-job",
      trustLevel: "trusted-code-only",
      workspacePersistence: "ephemeral",
      logSink: "authority-core",
      networkPolicy: "namespaced",
      cleanupModel: "explicit",
      supportsPreviewUrl: false,
      supportsPortCallbacks: false,
      supportsFileCopy: true,
      supportsSnapshot: false,
      dockerInsideSandbox: false,
    })).toThrow(/ephemeral/i);
  });

  it("accepts local Docker's trusted-code-only capability shape", () => {
    expect(() => assertProviderCapabilities({
      isolation: "container",
      trustLevel: "trusted-code-only",
      workspacePersistence: "durable",
      logSink: "authority-core",
      networkPolicy: "namespaced",
      cleanupModel: "explicit",
      supportsPreviewUrl: true,
      supportsPortCallbacks: true,
      supportsFileCopy: true,
      supportsSnapshot: false,
      dockerInsideSandbox: false,
      maxConcurrentSandboxes: 1,
    })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts
```

Expected: FAIL because `provider-types.ts` does not exist.

- [ ] **Step 3: Add provider types and invariant helper**

Create `apps/web/lib/integrate/sandbox/provider-types.ts` with:

```typescript
export type BuildExecutionProviderId =
  | "local-docker"
  | "tappaas-vm"
  | "kubernetes-job"
  | "ecs-task"
  | "ecs-service"
  | "cloud-run-job"
  | "cloud-run-service"
  | "azure-containerapp-job"
  | "edge-node-local-docker"
  | "disabled";

export type SandboxSpec = {
  buildId: string;
  title?: string;
  env?: Record<string, string>;
};

export type SandboxHandle = {
  id: string;
  buildId: string;
  providerId: BuildExecutionProviderId;
  containerId?: string;
  previewUrl?: string | null;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type ExecOpts = {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
};

export type BuildExecutionProviderCapabilities = {
  isolation: "none" | "container" | "pod" | "vm" | "managed-job";
  trustLevel: "trusted-code-only" | "customer-trusted" | "untrusted-ok";
  workspacePersistence: "ephemeral" | "ttl" | "durable";
  logSink: "authority-core" | "external-required" | "provider-native";
  networkPolicy: "host" | "namespaced" | "isolated";
  cleanupModel: "explicit" | "ttl" | "label-sweep";
  supportsPreviewUrl: boolean;
  supportsPortCallbacks: boolean;
  supportsFileCopy: boolean;
  supportsSnapshot: boolean;
  dockerInsideSandbox: boolean;
  maxConcurrentSandboxes?: number;
};

export interface BuildExecutionProvider {
  readonly id: BuildExecutionProviderId;
  createSandbox(spec: SandboxSpec): Promise<SandboxHandle>;
  startSandbox(handle: SandboxHandle): Promise<void>;
  destroySandbox(handle: SandboxHandle): Promise<void>;
  exec(handle: SandboxHandle, command: string[], opts?: ExecOpts): Promise<ExecResult>;
  readFile(handle: SandboxHandle, path: string): Promise<string>;
  writeFile(handle: SandboxHandle, path: string, content: string): Promise<void>;
  copyAppsWebInto(handle: SandboxHandle, source: string): Promise<void>;
  getPreviewUrl(handle: SandboxHandle): Promise<string | null>;
  launchNextDev(handle: SandboxHandle): Promise<void>;
  capabilities(): BuildExecutionProviderCapabilities;
}

export function assertProviderCapabilities(capabilities: BuildExecutionProviderCapabilities): void {
  // Spec invariant 1: untrusted-ok requires strong isolation
  if (
    capabilities.trustLevel === "untrusted-ok"
    && capabilities.isolation !== "vm"
    && capabilities.isolation !== "managed-job"
  ) {
    throw new Error("untrusted-ok providers must use vm or managed-job isolation");
  }

  // Spec invariant 2: ephemeral substrates can't rely on caller-driven cleanup
  if (
    capabilities.workspacePersistence === "ephemeral"
    && capabilities.cleanupModel === "explicit"
  ) {
    throw new Error(
      "ephemeral providers must use ttl or label-sweep cleanup (explicit destroy is unreliable when the substrate may evict mid-run)",
    );
  }

  // Slice-1 guard: snapshot only meaningful with durable workspace
  if (capabilities.workspacePersistence === "ephemeral" && capabilities.supportsSnapshot) {
    throw new Error("ephemeral providers cannot advertise durable snapshot support in slice 1");
  }
}
```

- [ ] **Step 4: Run provider contract test**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/provider-types.ts apps/web/lib/integrate/sandbox/provider-contract.test.ts
git commit -s -m "feat(build): add provider contract boundary"
```

### Task 2: Add Agent Runner Type Boundary

**Files:**
- Create: `apps/web/lib/integrate/sandbox/agent-runner-types.ts`
- Modify: `apps/web/lib/integrate/sandbox/provider-contract.test.ts`
- Test: `apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts`

- [ ] **Step 1: Write failing runner compatibility tests**

Create `apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assertAgentProviderCompatibility } from "./agent-runner-types";
import type { BuildExecutionProviderCapabilities } from "./provider-types";

const localDocker: BuildExecutionProviderCapabilities = {
  isolation: "container",
  trustLevel: "trusted-code-only",
  workspacePersistence: "durable",
  logSink: "authority-core",
  networkPolicy: "namespaced",
  cleanupModel: "explicit",
  supportsPreviewUrl: true,
  supportsPortCallbacks: true,
  supportsFileCopy: true,
  supportsSnapshot: false,
  dockerInsideSandbox: false,
};

describe("BuildAgentRunner compatibility", () => {
  it("rejects a callback-port runner on providers without port callbacks", () => {
    expect(() => assertAgentProviderCompatibility(
      {
        tier: "full-spec-implement",
        requiresPersistentSession: true,
        requiresCallbackPort: 1455,
        requiresCredential: true,
        honorsLlmBaseUrl: false,
      },
      { ...localDocker, supportsPortCallbacks: false },
    )).toThrow(/callback port/i);
  });

  it("accepts Codex CLI on local Docker", () => {
    expect(() => assertAgentProviderCompatibility(
      {
        tier: "full-spec-implement",
        requiresPersistentSession: true,
        requiresCallbackPort: 1455,
        requiresCredential: true,
        honorsLlmBaseUrl: false,
      },
      localDocker,
    )).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/agent-runner-contract.test.ts
```

Expected: FAIL because `agent-runner-types.ts` does not exist.

- [ ] **Step 3: Add agent-runner types and compatibility helper**

Create `apps/web/lib/integrate/sandbox/agent-runner-types.ts`:

```typescript
import type {
  BuildExecutionProvider,
  BuildExecutionProviderCapabilities,
  BuildExecutionProviderId,
  SandboxHandle,
} from "./provider-types";

export type BuildAgentId = "codex" | "claude" | "dpf-native";

export type BuildAgentRunnerCapabilities = {
  tier: "single-file-edit" | "multi-file-refactor" | "full-spec-implement";
  requiresPersistentSession: boolean;
  requiresCallbackPort?: number;
  requiresCredential: boolean;
  honorsLlmBaseUrl: boolean;
};

export type AgentCredential = {
  agent: BuildAgentId;
  type: "oauth" | "api-key" | "none";
  payload: Record<string, string>;
};

export type AgentRunSpec = {
  prompt?: string;
  workspaceSubdir?: string;
  timeoutMs?: number;
  approvalPolicy?: "never" | "ask";
  toolGrants?: string[];
  envOverrides?: Record<string, string>;
};

export type AgentRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  toolExecutionId: string;
  agentId: BuildAgentId;
  providerId: BuildExecutionProviderId;
};

export interface BuildAgentRunner {
  readonly id: BuildAgentId;
  prepare(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    credential: AgentCredential | null,
  ): Promise<void>;
  run(
    provider: BuildExecutionProvider,
    handle: SandboxHandle,
    spec: AgentRunSpec,
  ): Promise<AgentRunResult>;
  capabilities(): BuildAgentRunnerCapabilities;
}

export function assertAgentProviderCompatibility(
  agent: BuildAgentRunnerCapabilities,
  provider: BuildExecutionProviderCapabilities,
): void {
  if (agent.requiresPersistentSession && provider.workspacePersistence === "ephemeral") {
    throw new Error("agent requires persistent session but provider is ephemeral");
  }
  if (agent.requiresCallbackPort && !provider.supportsPortCallbacks) {
    throw new Error(`agent requires callback port ${agent.requiresCallbackPort}, but provider does not support callback ports`);
  }
}
```

- [ ] **Step 4: Run runner contract test**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/agent-runner-contract.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/agent-runner-types.ts apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts
git commit -s -m "feat(build): add agent runner contract boundary"
```

## Chunk 2: Local Docker Provider And CLI Runner Wrappers

### Task 3: Wrap Local Docker Provider Without Behavior Change

**Files:**
- Create: `apps/web/lib/integrate/sandbox/providers/local-docker-provider.ts`
- Create: `apps/web/lib/integrate/sandbox/providers/index.ts`
- Modify: `apps/web/lib/integrate/sandbox/provider-contract.test.ts`

- [ ] **Step 1: Add failing registry test**

Append to `provider-contract.test.ts`:

```typescript
import { getBuildExecutionProvider } from "./providers";

it("resolves local-docker provider from the registry", () => {
  const provider = getBuildExecutionProvider("local-docker");
  expect(provider.id).toBe("local-docker");
  expect(provider.capabilities().workspacePersistence).toBe("durable");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts
```

Expected: FAIL because provider registry does not exist.

- [ ] **Step 3: Implement local Docker provider wrapper**

Create `apps/web/lib/integrate/sandbox/providers/local-docker-provider.ts`. Delegate to existing functions in `../sandbox` and `../sandbox-pool` wherever signatures already match. For methods that need a handle but current functions accept `buildId` or container ID, adapt without changing underlying behavior.

Implementation rules:

- Do not move code out of `sandbox.ts` or `sandbox-pool.ts` yet.
- Do not change Docker command strings in this task.
- **Pool reality, not per-build creation.** `createSandbox(spec)` resolves a pool slot via `sandbox-pool.ts` (or returns the env-derived `SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1"` handle when no pool API is available); it does **not** call `sandbox.ts:createSandbox`. `destroySandbox(handle)` is a no-op in slice 1 — the pool owns lifecycle. Add a `// TODO(slice-2-per-build-lifecycle)` at the top of the file pointing at the cleanup-reconciliation follow-up plan.
- Capability values must match today's behavior: container isolation, durable workspace, authority-core logs, namespaced network, **`label-sweep` cleanup** (the pool reaps; explicit-destroy by the orchestrator would corrupt pool state), preview URL support, port callback support.
- File IO methods (`readFile`, `writeFile`, `copyAppsWebInto`, `launchNextDev`) wrap the corresponding helpers in `sandbox.ts` (`execInSandbox`, `buildSandboxAppsWebCopyCommand`, `startSandboxDevServer`).

- [ ] **Step 4: Implement provider registry**

Create `apps/web/lib/integrate/sandbox/providers/index.ts`:

```typescript
import type { BuildExecutionProvider, BuildExecutionProviderId } from "../provider-types";
import { localDockerProvider } from "./local-docker-provider";

const providers: Record<BuildExecutionProviderId, BuildExecutionProvider | null> = {
  "local-docker": localDockerProvider,
  "tappaas-vm": null,
  "kubernetes-job": null,
  "ecs-task": null,
  "ecs-service": null,
  "cloud-run-job": null,
  "cloud-run-service": null,
  "azure-containerapp-job": null,
  "edge-node-local-docker": null,
  disabled: null,
};

export function getBuildExecutionProvider(id: BuildExecutionProviderId = "local-docker"): BuildExecutionProvider {
  const provider = providers[id];
  if (!provider) throw new Error(`Build execution provider ${id} is not implemented`);
  return provider;
}
```

- [ ] **Step 5: Run provider tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/providers apps/web/lib/integrate/sandbox/provider-contract.test.ts
git commit -s -m "refactor(build): wrap local docker sandbox provider"
```

### Task 4: Wrap Codex And Claude Dispatchers As Agent Runners

**Files:**
- Create: `apps/web/lib/integrate/sandbox/agents/codex-agent-runner.ts`
- Create: `apps/web/lib/integrate/sandbox/agents/claude-agent-runner.ts`
- Create: `apps/web/lib/integrate/sandbox/agents/index.ts`
- Modify: `apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts`

- [ ] **Step 1: Add failing runner registry tests**

Append to `agent-runner-contract.test.ts`:

```typescript
import { getBuildAgentRunner } from "./agents";

it("resolves Codex and Claude runners from the registry", () => {
  expect(getBuildAgentRunner("codex").id).toBe("codex");
  expect(getBuildAgentRunner("claude").id).toBe("claude");
});

it("does not expose dpf-native in slice 1", () => {
  expect(() => getBuildAgentRunner("dpf-native")).toThrow(/not implemented/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/agent-runner-contract.test.ts
```

Expected: FAIL because agent registry does not exist.

- [ ] **Step 3: Implement Codex runner wrapper**

Create `apps/web/lib/integrate/sandbox/agents/codex-agent-runner.ts`.

Implementation rules:

- Reuse existing `apps/web/lib/integrate/codex-dispatch.ts`.
- Preserve existing prompt construction and sandbox execution behavior.
- **Shim acknowledgment.** The wrapper holds the `provider` and `handle` arguments but **does not route I/O through `provider.exec()`** — `dispatchCodexTask` continues to `docker exec` directly against `SANDBOX_CONTAINER_ID`. Add a `// TODO(slice-2-thread-provider-exec)` at the top of the file describing the bypass and pointing to the follow-up plan that ships threading. Threading is the smallest behavior-impacting change; deferring it preserves the no-op slice promise.
- `capabilities()` returns `full-spec-implement`, `requiresPersistentSession: true`, `requiresCallbackPort: 1455`, `requiresCredential: true`, `honorsLlmBaseUrl: false`.
- The wrapper translates the existing `CodexResult` shape into `AgentRunResult`. If the existing dispatcher does not return a `toolExecutionId`, use a deterministic placeholder (`crypto.randomUUID()`) and add a TODO pointing to the follow-up attribution task — slice 1 does not write `routeContext.build.{providerId,agentId}` end to end.

- [ ] **Step 4: Implement Claude runner wrapper**

Create `apps/web/lib/integrate/sandbox/agents/claude-agent-runner.ts`.

Implementation rules:

- Reuse existing `apps/web/lib/integrate/claude-dispatch.ts`.
- Preserve existing behavior.
- Same shim acknowledgment as the Codex wrapper: holds `provider` + `handle`, does not yet thread I/O through `provider.exec()`. `// TODO(slice-2-thread-provider-exec)` at the top of the file.
- `capabilities()` returns `full-spec-implement`, `requiresPersistentSession: true`, **no `requiresCallbackPort`** (Claude Code CLI uses raw OAuth tokens injected via env, not a port-1455-style callback — confirmed by `claude-dispatch.ts:222-235`), `requiresCredential: true`, `honorsLlmBaseUrl: false`.

- [ ] **Step 5: Implement agent registry**

Create `apps/web/lib/integrate/sandbox/agents/index.ts` with `getBuildAgentRunner(id)`.

- [ ] **Step 6: Run runner tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/agent-runner-contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/agents apps/web/lib/integrate/sandbox/agent-runner-contract.test.ts
git commit -s -m "refactor(build): wrap cli dispatchers as agent runners"
```

### Task 5: Add Cross-Axis Matrix Guard

**Files:**
- Create: `apps/web/lib/integrate/sandbox/build-substrate-agent-matrix.test.ts`
- Modify: `apps/web/lib/integrate/sandbox/agent-runner-types.ts`

- [ ] **Step 1: Write failing matrix tests**

Create `apps/web/lib/integrate/sandbox/build-substrate-agent-matrix.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assertAgentProviderCompatibility } from "./agent-runner-types";
import { getBuildAgentRunner } from "./agents";
import { getBuildExecutionProvider } from "./providers";

describe("Build substrate x agent matrix", () => {
  it("allows local-docker x codex", () => {
    expect(() => assertAgentProviderCompatibility(
      getBuildAgentRunner("codex").capabilities(),
      getBuildExecutionProvider("local-docker").capabilities(),
    )).not.toThrow();
  });

  it("allows local-docker x claude", () => {
    expect(() => assertAgentProviderCompatibility(
      getBuildAgentRunner("claude").capabilities(),
      getBuildExecutionProvider("local-docker").capabilities(),
    )).not.toThrow();
  });
});
```

- [ ] **Step 2: Run matrix test**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/build-substrate-agent-matrix.test.ts
```

Expected: PASS after Tasks 3 and 4.

- [ ] **Step 3: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/build-substrate-agent-matrix.test.ts apps/web/lib/integrate/sandbox/agent-runner-types.ts
git commit -s -m "test(build): assert provider runner compatibility"
```

## Chunk 3: Additive Sandbox Persistence

### Task 6: Add Sandbox Prisma Model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_build_sandbox_model/migration.sql`

- [ ] **Step 1: Add schema model**

Pre-flight check: `FeatureBuild.buildId` must be `@unique` for the FK below to validate. Verify with `rg "buildId\s+String\s+@unique" packages/db/prisma/schema.prisma` before editing — it is, today, but confirm.

**Coexistence note — read before editing.** `FeatureBuild` already has `sandboxId String?` and `sandboxPort Int?`. The new `Sandbox` model coexists with them for the entire transition. Slice 1 writes `Sandbox` rows additively; slice 1 does **not** touch the existing `FeatureBuild.sandboxId` / `sandboxPort` write path in `build-orchestrator.ts:737-746`. Removal of those legacy fields is gated on cleanup-reconciliation working end to end and ships in a follow-up slice with its own migration.

Add near `FeatureBuild` or other Build Studio models:

```prisma
model Sandbox {
  id                   String       @id @default(cuid())
  buildId              String
  providerId           String
  agentId              String?
  // portalInstanceId is nullable in slice 1: the cleanup-reconciliation slice
  // makes it required + adds the label-sweep reconciler. Source for the value
  // when populated: process.env.HOSTNAME (Docker sets /etc/hostname per
  // container) with a randomUUID() fallback persisted on first portal boot.
  portalInstanceId     String?
  state                String
  startedAt            DateTime     @default(now())
  destroyedAt          DateTime?
  previewUrl           String?
  capabilitiesSnapshot Json
  featureBuild         FeatureBuild @relation(fields: [buildId], references: [buildId])

  @@index([buildId])
  @@index([state, startedAt])
}
```

Add to `FeatureBuild`:

```prisma
sandboxes Sandbox[]
```

- [ ] **Step 2: Generate migration**

Run:

```powershell
pnpm --filter @dpf/db exec prisma migrate dev --name add_build_sandbox_model
```

Expected: Migration is created and applies cleanly to the local database.

- [ ] **Step 3: Inspect migration for additive-only SQL**

Confirm the migration only creates `Sandbox`, indexes, and foreign key. It must not alter or drop existing Build Studio tables.

- [ ] **Step 4: Generate Prisma client**

Run:

```powershell
pnpm --filter @dpf/db exec prisma generate
```

Expected: Prisma client generation succeeds.

- [ ] **Step 5: Commit**

```powershell
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -s -m "feat(build): persist sandbox execution records"
```

### Task 7: Add Sandbox Persistence Helpers

**Files:**
- Modify: `apps/web/lib/integrate/sandbox/sandbox-db.ts`
- Test: `apps/web/lib/integrate/sandbox/sandbox-db.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests for:

- `recordSandboxStarted()` creates a `Sandbox` row with `providerId`, `buildId`, `state: "running"`, `capabilitiesSnapshot`.
- `recordSandboxDestroyed()` sets `state: "destroyed"` and `destroyedAt`.
- Existing sandbox DB helpers still return their previous shape.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/sandbox-db.test.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 3: Implement helpers**

Add focused helper functions to `sandbox-db.ts`:

```typescript
export async function recordSandboxStarted(input: {
  buildId: string;
  providerId: string;
  agentId?: string | null;
  portalInstanceId: string;
  previewUrl?: string | null;
  capabilitiesSnapshot: unknown;
}) { /* prisma.sandbox.create(...) */ }

export async function recordSandboxDestroyed(id: string) { /* prisma.sandbox.update(...) */ }
```

Keep existing exported functions untouched unless the tests require small compatibility adaptation.

- [ ] **Step 4: Run helper tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/sandbox-db.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrate/sandbox/sandbox-db.ts apps/web/lib/integrate/sandbox/sandbox-db.test.ts
git commit -s -m "feat(build): record sandbox lifecycle rows"
```

## Chunk 4: Orchestrator Entry Point

### Task 8: Add Build Orchestrator Selection Boundary

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts`
- Test: `apps/web/lib/integrate/build-orchestrator.test.ts`

**Spec-divergence note.** The owning spec defines `runAgentCommand(provider, agent, handle, spec)`. This plan adds the friendlier `runBuildAgentTask({...})` form on top of an internal `runAgentCommand(provider, agent, handle, spec)` so external callers don't have to resolve provider + agent themselves. The internal form matches the spec verbatim. Task 10 reconciles the spec.

- [ ] **Step 1: Write failing orchestrator tests**

Add tests proving:

- Default provider resolves to `local-docker`.
- Default agent resolves from `getBuildStudioConfig().provider` (Codex when `"codex"`, Claude when `"claude"`); legacy `"agentic"` config falls back to Codex.
- Incompatible provider/runner pairs throw before dispatch (unit-tested via the cross-axis matrix from Task 5).
- Successful dispatch returns `providerId` and `agentId` on `AgentRunResult`.
- The friendly `runBuildAgentTask({...})` and the internal `runAgentCommand(...)` produce identical results for the same inputs.

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts
```

Expected: FAIL because orchestrator selection boundary does not exist.

- [ ] **Step 3: Implement narrow orchestration entrypoint**

Add both shapes:

```typescript
// Spec-shape internal entrypoint
export async function runAgentCommand(
  provider: BuildExecutionProvider,
  agent: BuildAgentRunner,
  handle: SandboxHandle,
  spec: AgentRunSpec,
): Promise<AgentRunResult> {
  assertAgentProviderCompatibility(agent.capabilities(), provider.capabilities());
  // No prepare() in slice 1 — the wrappers carry their own auth injection.
  // Slice 2 introduces explicit prepare() ahead of run().
  return agent.run(provider, handle, spec);
}

// Friendly external entrypoint
export async function runBuildAgentTask(input: {
  buildId: string;
  agentId?: BuildAgentId;
  providerId?: BuildExecutionProviderId;
  prompt?: string;
  timeoutMs?: number;
}): Promise<AgentRunResult> {
  const provider = getBuildExecutionProvider(input.providerId ?? "local-docker");
  const runner = getBuildAgentRunner(input.agentId ?? "codex");
  const handle = await provider.createSandbox({ buildId: input.buildId });
  return runAgentCommand(provider, runner, handle, {
    prompt: input.prompt,
    timeoutMs: input.timeoutMs,
  });
}
```

This task creates the tested boundary. Task 9 wires the production call site through it.

- [ ] **Step 4: Run orchestrator tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrate/build-orchestrator.ts apps/web/lib/integrate/build-orchestrator.test.ts
git commit -s -m "feat(build): add provider runner orchestrator"
```

### Task 9: Route the CLI Dispatch Path Through the Orchestrator (slice gate)

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts` (`dispatchSpecialist`, lines 546-601)
- Test: extend `apps/web/lib/integrate/build-orchestrator.test.ts`

This task is the **gate for the slice**. Without it, `runBuildAgentTask` exists but nothing in production calls it, the boundary enforces nothing, and "no behavior change" is true only because the boundary is dead code. Specify the call site rather than searching for it.

- [ ] **Step 1: Identify the call site (already known)**

The decision point is `dispatchSpecialist()` in `apps/web/lib/integrate/build-orchestrator.ts:546-601`. The CLI branch is lines 569-601:

```typescript
if (config.provider === "codex" || config.provider === "claude") {
  const cliResult = config.provider === "claude"
    ? await dispatchClaudeTask({ ... })
    : await dispatchCodexTask({ ... });
  // ...
}
```

This is the production code path that needs to route through the new boundary.

- [ ] **Step 2: Write failing integration test**

In `build-orchestrator.test.ts`, add a test that asserts the CLI branch resolves a runner via `getBuildAgentRunner()` (mockable) and a provider via `getBuildExecutionProvider()` (mockable) before dispatching, and that incompatible (provider × agent) pairs surface as a typed error before the dispatcher runs. Existing behavior tests for `dispatchSpecialist` must continue to pass.

- [ ] **Step 3: Route the CLI branch through `runAgentCommand`**

Replace the `if (config.provider === "codex" || config.provider === "claude") { ... }` block (build-orchestrator.ts:569-601) with a call into `runAgentCommand(provider, runner, handle, spec)`. The runner wrappers (Tasks 3–4) already proxy to `dispatchCodexTask` / `dispatchClaudeTask` verbatim, so the actual sandbox execution behavior is byte-identical.

Implementation rules:

- Preserve existing provider selection behavior (read from `getBuildStudioConfig()`).
- Preserve existing prompt construction (the wrappers reuse the existing dispatchers verbatim).
- Preserve existing error messages and `classifyOutcome` mapping.
- The agentic-loop fallback branch (lines 603+) is **not** rewired in slice 1; it stays as-is. A separate slice handles agentic-loop ↔ runner unification.
- **`routeContext.build.{providerId,agentId}` attribution is not landed in slice 1.** `ToolExecution` rows are written by `mcp-tools.ts` / `agent-grants.ts` — not by the dispatchers — so threading attribution is a cross-cutting change that belongs in its own slice. Add a `// TODO(slice-N-routecontext-build-attribution)` next to the `runAgentCommand` call site documenting the gap. Do not invent a partial attribution path.

- [ ] **Step 4: Run affected tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts
```

Expected: PASS, including pre-existing tests in this file.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/lib/integrate/build-orchestrator.ts apps/web/lib/integrate/build-orchestrator.test.ts
git commit -s -m "refactor(build): dispatch cli branch through provider runner boundary"
```

If the pre-commit typecheck hook fails, fix the underlying type error and re-stage. Do not bypass with `DPF_SKIP_TYPECHECK=1` — the hook exists because TS errors only surface in `next build` and CI.

## Chunk 5: Verification And Documentation

### Task 10: Update Spec Cross-References If Needed

**Files:**
- Modify only if needed: `docs/superpowers/specs/2026-05-09-build-execution-provider-design.md`
- Modify only if needed: `docs/superpowers/specs/2026-05-09-deployment-contracts.md`

- [ ] **Step 1: Check whether implementation names differ from spec names**

Run:

```powershell
rg -n "BuildExecutionProvider|BuildAgentRunner|Sandbox model|routeContext.build|local-docker" docs/superpowers/specs/2026-05-09-build-execution-provider-design.md docs/superpowers/specs/2026-05-09-deployment-contracts.md
```

Known divergences this slice introduces (patch the spec to acknowledge each):

1. **Function names.** Spec defines `runAgentCommand(provider, agent, handle, spec)` only. Plan keeps that as the internal entrypoint and adds a friendlier `runBuildAgentTask({ buildId, agentId?, providerId?, ... })` wrapper. Document both.
2. **Test paths.** Spec lists tests under `apps/web/__tests__/`. Plan colocates tests with code under `lib/integrate/sandbox/` to match repo convention (every other module here colocates `.test.ts` files). Update spec to match repo convention.
3. **`Sandbox.portalInstanceId` nullability.** Spec marks the field non-null. Slice 1 marks it nullable because the cleanup-reconciliation slice owns the populator; remove the non-null commitment from the spec until that slice ships.
4. **`Sandbox` ↔ `FeatureBuild.sandboxId` coexistence.** Spec says "additive only" and "transition where both write paths run; the old path is removed once reconciliation is verified" — plan implements that literally; spec should explicitly enumerate the transition deliverables (which slice removes the legacy fields, what reconciliation evidence gates removal).
5. **Local-docker substrate semantics.** Spec implies per-build `createSandbox`. Slice 1 implementation reflects the actual pooled-singleton reality (`sandbox-pool.ts`); spec should annotate that the local-docker provider currently delegates to the pool rather than creating per-build containers, and point at the slice that introduces per-build lifecycle.
6. **Capabilities shape.** `cleanupModel: "label-sweep"` (not `"explicit"`) for local-docker, because the pool reaps; explicit destroy by the orchestrator would corrupt pool state. Update the per-deployment-target matrix narrative if it implies otherwise.
7. **`routeContext.build.{providerId,agentId}` attribution.** Spec lists this as part of the substrate × agent extraction. Plan defers it to its own slice (the dispatchers don't write `ToolExecution` rows; mcp-tools.ts does). Update the spec sequencing to call this out as its own slice.

- [ ] **Step 2: Patch docs only for drift**

For each divergence above, either adjust code to match the spec or update the spec with the final names / shape. Default = update the spec; the spec is still draft and the implementation reflects ground truth. Strong-reason exceptions:

- If chief architect rules that any divergence above is an architectural mistake (not just a slice scope choice), file a follow-up and revise the plan rather than the spec.

- [ ] **Step 3: Commit docs if changed**

```powershell
git add docs/superpowers/specs/2026-05-09-build-execution-provider-design.md docs/superpowers/specs/2026-05-09-deployment-contracts.md
git commit -s -m "docs(build): align provider runner implementation notes"
```

### Task 11: Final Verification

**Files:**
- No source edits expected.

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts lib/integrate/sandbox/agent-runner-contract.test.ts lib/integrate/sandbox/build-substrate-agent-matrix.test.ts lib/integrate/build-orchestrator.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run Prisma validation**

```powershell
pnpm --filter @dpf/db exec prisma validate
```

Expected: PASS.

- [ ] **Step 4: Run production build**

```powershell
pnpm --filter web exec next build
```

Expected: PASS.

- [ ] **Step 5: Manual Build Studio smoke check**

Against the Docker-served app (the install's configured `AUTH_URL`/`APP_URL`, **not** a stale `next dev` session — see AGENTS.md §13), log in with `admin@dpf.local` and the repo-root `ADMIN_PASSWORD`, then:

1. Open `/platform/ai/build-studio`.
2. Confirm the Build Studio config page renders and the Codex / Claude provider toggle still works.
3. Start or inspect a Build Studio effort that reaches task dispatch under both Codex and Claude (one each — switch the provider mid-test). Confirm both still dispatch into the same `dpf-sandbox-1` container.
4. Confirm no user-visible regression in sandbox startup, progress messages, or dispatch error messages.
5. Confirm `/platform/ai/authority` still shows `ToolExecution` records for the dispatch (attribution shape unchanged in slice 1; `routeContext.build.{providerId,agentId}` lands in a follow-up).
6. **Build Studio mirror gate (AGENTS.md §5).** Confirm the QA-engineer specialist still runs `tsc --noEmit` and reports the result through `parseQAVerification`. Build-Studio-produced PRs must continue to satisfy CI typecheck — slice 1 must not weaken this.
7. Confirm `Sandbox` rows are written for the new dispatch (query Postgres directly: `SELECT id, "buildId", "providerId", "agentId", state FROM "Sandbox" ORDER BY "startedAt" DESC LIMIT 5;`). Existing `FeatureBuild.sandboxId` / `sandboxPort` rows must continue to be written too — slice 1 is dual-write.

- [ ] **Step 6: Commit any final fixes**

```powershell
git status --short
git add <only-intended-files>
git commit -s -m "fix(build): stabilize provider runner extraction"
```

### Task 12: Push And PR

**Files:**
- No source edits expected.

- [ ] **Step 1: Confirm branch guard**

```powershell
git branch --show-current
```

Expected: not `main`.

- [ ] **Step 2: Show final diff summary**

```powershell
git status --short
git diff --stat origin/main...HEAD
```

- [ ] **Step 3: Push**

```powershell
git push -u origin <branch-name>
```

- [ ] **Step 4: Open draft PR**

Title:

```text
refactor(build): extract provider and agent runner boundaries
```

PR body:

```markdown
## Summary
- Adds BuildExecutionProvider and BuildAgentRunner contract boundaries.
- Wraps current local-Docker sandbox and Codex/Claude dispatch behavior without changing runtime behavior.
- Adds additive Sandbox persistence foundation and contract tests.

## Test plan
- pnpm --filter web exec vitest run lib/integrate/sandbox/provider-contract.test.ts lib/integrate/sandbox/agent-runner-contract.test.ts lib/integrate/sandbox/build-substrate-agent-matrix.test.ts lib/integrate/build-orchestrator.test.ts
- pnpm --filter web typecheck
- pnpm --filter @dpf/db exec prisma validate
- pnpm --filter web exec next build
- Manual Build Studio smoke check
```

## Follow-Up Plans

Create separate plans after this slice lands. The first three resolve the deliberate slice-1 deferrals; the rest are spec sequencing.

1. **Slice 2 — thread I/O through `provider.exec()`.** Refactor `dispatchCodexTask` and `dispatchClaudeTask` to call `provider.exec(handle, [...])` instead of `docker exec ${SANDBOX_CONTAINER}` directly. Removes the `TODO(slice-2-thread-provider-exec)` shim, makes the boundary load-bearing for substrate substitution. Behavior-impacting; needs its own no-regression smoke gate.
2. **Slice 3 — `routeContext.build.{providerId,agentId}` attribution.** Add `providerId` and `agentId` to every `ToolExecution.routeContext.build` write site in `mcp-tools.ts` and `agent-grants.ts`. Cross-cutting — needs its own slice.
3. **Slice 4 — per-build sandbox lifecycle + cleanup reconciliation.** Replace pooled-singleton with per-build `createSandbox` / `destroySandbox`. Populate `Sandbox.portalInstanceId` from `process.env.HOSTNAME`. Land the startup sweep + periodic reconciler. Remove `FeatureBuild.sandboxId` / `sandboxPort` once reconciliation is verified.
4. `dpf-native` Tier 1 runner using `LLM_BASE_URL` and the portal audit envelope (per spec §"dpf-native cutover gates").
5. Kubernetes or TAPPaaS provider, depending on substrate priority (per spec sequencing step 4).
6. Image variant split (`base` / `dpf-native` / `cli-bundled`) — `Dockerfile.sandbox` matrix + image-publish workflow.
7. Portal self-update pipeline: git update intake, sandbox verification, `ChangePromotion`, promoter execution, and Updates UI.
