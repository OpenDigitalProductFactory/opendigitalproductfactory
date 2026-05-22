# Build Studio Sandbox Administration and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Build Studio a governed sandbox administration and recovery control plane so detached/stale/mis-owned sandboxes block unsafe PRs and can be diagnosed or recovered without asking the user to run infrastructure commands.

**Architecture:** Add a read-only sandbox readiness service first, then expose it through MCP tools and UI. Recovery actions are narrow, auditable, and blocked when destructive. Contribution and PR creation gates consume the same readiness result so Build Studio cannot create another PR like #961 from stale sandbox state.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma 7, PostgreSQL, Docker Compose, Vitest, React server actions/components, GitHub REST API.

---

## Context

Work from a clean worktree on a documentation or fix branch, not the root merge checkout. The investigation that produced this plan found unrelated dirty files in `D:\DPF`, so implementation must not edit the root worktree.

Primary spec: `docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md`

Related implementation files:

| File | Responsibility |
| --- | --- |
| `apps/web/lib/integrate/sandbox/sandbox-admin-types.ts` | Shared readiness and recovery types |
| `apps/web/lib/integrate/sandbox/docker-compose-inspector.ts` | Docker inspect label parsing and container state normalization |
| `apps/web/lib/integrate/sandbox/sandbox-admin.ts` | `diagnoseSandboxState` and recovery policy decisions |
| `apps/web/lib/integrate/sandbox/sandbox-recovery.ts` | Side-effecting recovery actions |
| `apps/web/lib/integrate/sandbox/sandbox-readiness-gate.ts` | Gate helpers consumed by deploy/contribution |
| `apps/web/lib/runtime-coordination/build-studio-runtime.ts` | RuntimeTarget metadata population |
| `apps/web/lib/mcp-tools.ts` | Tool definitions/handlers for diagnosis and recovery; deploy/contribution gates |
| `apps/web/lib/integrate/build-pipeline.ts` | Zero-change/no-test/limit hard failures |
| `apps/web/lib/integrate/github-api-commit.ts` | DCO author/committer consistency |
| `apps/web/lib/integrate/contribution-review.ts` | Required-check-aware contribution status |
| `apps/web/lib/actions/build-sandbox-admin.ts` | Admin UI server actions |
| `apps/web/app/(shell)/admin/build-studio/sandbox/page.tsx` | Admin Sandbox Control route |
| `apps/web/app/(shell)/admin/build-studio/sandbox/SandboxControlClient.tsx` | Client-side control panel |
| `apps/web/components/build/SandboxReadinessStrip.tsx` | Build Studio readiness strip |

Refactoring allocation: spend roughly 20 percent of the implementation on extracting focused helpers from `mcp-tools.ts` and `build-pipeline.ts`. Do not pile new sandbox and PR gate logic into those large files directly.

---

## Task 1: Add Sandbox Readiness Types

**Files:**
- Create: `apps/web/lib/integrate/sandbox/sandbox-admin-types.ts`
- Create: `apps/web/lib/integrate/sandbox/sandbox-admin-types.test.ts`

- [ ] **Step 1: Write type-level tests for state values**

Create `sandbox-admin-types.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { SANDBOX_READINESS_STATES, isSandboxReadinessState } from "./sandbox-admin-types";

describe("sandbox admin types", () => {
  it("accepts every supported readiness state", () => {
    expect(SANDBOX_READINESS_STATES).toEqual([
      "healthy",
      "stopped",
      "not_found",
      "detached",
      "mixed_compose_project",
      "branch_mismatch",
      "stale_source",
      "dirty_or_leaking",
      "verification_red",
      "stuck_mid_phase",
      "unrecoverable",
    ]);

    for (const state of SANDBOX_READINESS_STATES) {
      expect(isSandboxReadinessState(state)).toBe(true);
    }
  });

  it("rejects unknown readiness state strings", () => {
    expect(isSandboxReadinessState("running")).toBe(false);
    expect(isSandboxReadinessState("ready")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-admin-types.test.ts
```

Expected: FAIL because `sandbox-admin-types.ts` does not exist.

- [ ] **Step 3: Implement the shared types**

Create `sandbox-admin-types.ts`:

```typescript
export const SANDBOX_READINESS_STATES = [
  "healthy",
  "stopped",
  "not_found",
  "detached",
  "mixed_compose_project",
  "branch_mismatch",
  "stale_source",
  "dirty_or_leaking",
  "verification_red",
  "stuck_mid_phase",
  "unrecoverable",
] as const;

export type SandboxReadinessState = (typeof SANDBOX_READINESS_STATES)[number];

const READINESS_STATE_SET = new Set<string>(SANDBOX_READINESS_STATES);

export function isSandboxReadinessState(value: unknown): value is SandboxReadinessState {
  return typeof value === "string" && READINESS_STATE_SET.has(value);
}

export type SandboxCheckStatus = "pass" | "warn" | "fail" | "unknown";

export type SandboxCheckResult = {
  id: string;
  label: string;
  status: SandboxCheckStatus;
  expected?: string | number | boolean | null;
  actual?: string | number | boolean | null;
  detail?: string;
};

export type SandboxRecoveryAction =
  | "start"
  | "restart"
  | "rebind_runtime_target"
  | "release_stale_slot"
  | "checkout_registered_branch"
  | "reset_from_main"
  | "quarantine_runtime_target"
  | "reset_build_phase";

export type RecommendedSandboxAction = {
  action: SandboxRecoveryAction;
  label: string;
  requiresApproval: boolean;
  disabledReason?: string | null;
};

export type SandboxReadinessSnapshot = {
  buildId: string;
  state: SandboxReadinessState;
  canDeploy: boolean;
  canContribute: boolean;
  summary: string;
  checks: SandboxCheckResult[];
  recommendedActions: RecommendedSandboxAction[];
  inspectedAt: string;
  runtimeTargetId?: string | null;
  containerId?: string | null;
  branchName?: string | null;
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-admin-types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/integrate/sandbox/sandbox-admin-types.ts apps/web/lib/integrate/sandbox/sandbox-admin-types.test.ts
git commit -s -m "feat(build-studio): add sandbox readiness types"
```

---

## Task 2: Add Docker Compose Inspection Helper

**Files:**
- Create: `apps/web/lib/integrate/sandbox/docker-compose-inspector.ts`
- Create: `apps/web/lib/integrate/sandbox/docker-compose-inspector.test.ts`

- [ ] **Step 1: Write parser tests**

Create `docker-compose-inspector.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseDockerInspectJson } from "./docker-compose-inspector";

describe("parseDockerInspectJson", () => {
  it("extracts compose ownership labels", () => {
    const parsed = parseDockerInspectJson(JSON.stringify([{
      Id: "abc123",
      Name: "/dpf-sandbox-1",
      State: { Status: "running", Running: true },
      Config: {
        Labels: {
          "com.docker.compose.project": "dpf",
          "com.docker.compose.service": "sandbox",
          "com.docker.compose.project.working_dir": "D:\\\\DPF-clean-main-linux",
          "com.docker.compose.project.config_files": "D:\\\\DPF-clean-main-linux\\\\docker-compose.yml",
        },
      },
      NetworkSettings: { Ports: { "3035/tcp": [{ HostPort: "3035" }] } },
    }]));

    expect(parsed?.containerName).toBe("dpf-sandbox-1");
    expect(parsed?.status).toBe("running");
    expect(parsed?.composeProjectName).toBe("dpf");
    expect(parsed?.composeServiceName).toBe("sandbox");
    expect(parsed?.composeWorkingDir).toBe("D:\\DPF-clean-main-linux");
    expect(parsed?.composeConfigFiles).toEqual(["D:\\DPF-clean-main-linux\\docker-compose.yml"]);
  });

  it("returns null for empty inspect output", () => {
    expect(parseDockerInspectJson("[]")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/docker-compose-inspector.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the parser**

Create `docker-compose-inspector.ts`:

```typescript
export type DockerComposeContainerInfo = {
  containerId: string;
  containerName: string;
  status: string;
  running: boolean;
  composeProjectName: string | null;
  composeServiceName: string | null;
  composeWorkingDir: string | null;
  composeConfigFiles: string[];
  hostPorts: number[];
};

type RawInspect = {
  Id?: string;
  Name?: string;
  State?: { Status?: string; Running?: boolean };
  Config?: { Labels?: Record<string, string> };
  NetworkSettings?: { Ports?: Record<string, Array<{ HostPort?: string }> | null> };
};

function splitConfigFiles(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function extractHostPorts(ports: RawInspect["NetworkSettings"]["Ports"]): number[] {
  if (!ports) return [];
  return Object.values(ports)
    .flatMap((bindings) => bindings ?? [])
    .map((binding) => Number(binding.HostPort))
    .filter((port) => Number.isInteger(port) && port > 0);
}

export function parseDockerInspectJson(stdout: string): DockerComposeContainerInfo | null {
  const parsed = JSON.parse(stdout) as RawInspect[];
  const first = parsed[0];
  if (!first) return null;
  const labels = first.Config?.Labels ?? {};

  return {
    containerId: first.Id ?? "",
    containerName: (first.Name ?? "").replace(/^\//, ""),
    status: first.State?.Status ?? "unknown",
    running: first.State?.Running === true,
    composeProjectName: labels["com.docker.compose.project"] ?? null,
    composeServiceName: labels["com.docker.compose.service"] ?? null,
    composeWorkingDir: labels["com.docker.compose.project.working_dir"] ?? null,
    composeConfigFiles: splitConfigFiles(labels["com.docker.compose.project.config_files"]),
    hostPorts: extractHostPorts(first.NetworkSettings?.Ports),
  };
}
```

- [ ] **Step 4: Run parser tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/docker-compose-inspector.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/integrate/sandbox/docker-compose-inspector.ts apps/web/lib/integrate/sandbox/docker-compose-inspector.test.ts
git commit -s -m "feat(build-studio): parse sandbox compose ownership"
```

---

## Task 3: Implement Read-Only Sandbox Diagnosis

**Files:**
- Create: `apps/web/lib/integrate/sandbox/sandbox-admin.ts`
- Create: `apps/web/lib/integrate/sandbox/sandbox-admin.test.ts`

- [ ] **Step 1: Write diagnosis tests**

Create `sandbox-admin.test.ts` with mocked dependencies:

```typescript
import { describe, expect, it, vi } from "vitest";
import { diagnoseSandboxState } from "./sandbox-admin";

const db = {
  featureBuild: { findUnique: vi.fn() },
  runtimeTarget: { findFirst: vi.fn() },
  sandboxSlot: { findUnique: vi.fn() },
};

describe("diagnoseSandboxState", () => {
  it("returns not_found when the build has no sandbox id", async () => {
    db.featureBuild.findUnique.mockResolvedValue({
      id: "fb-row",
      buildId: "FB-TEST",
      sandboxId: null,
      sandboxPort: null,
      buildBranch: null,
      taskResults: null,
      verificationOut: null,
      buildExecState: {},
    });

    const result = await diagnoseSandboxState({
      buildId: "FB-TEST",
      db,
      inspectContainer: vi.fn(),
      inspectGit: vi.fn(),
    });

    expect(result.state).toBe("not_found");
    expect(result.canDeploy).toBe(false);
    expect(result.recommendedActions.map((a) => a.action)).toContain("quarantine_runtime_target");
  });

  it("returns mixed_compose_project when container working dir differs", async () => {
    db.featureBuild.findUnique.mockResolvedValue({
      id: "fb-row",
      buildId: "FB-TEST",
      sandboxId: "dpf-sandbox-1",
      sandboxPort: 3035,
      buildBranch: "build/FB-TEST",
      taskResults: { filesChanged: 1, ranTests: true },
      verificationOut: { testsFailed: 0, typecheckPassed: true },
      buildExecState: {},
    });
    db.runtimeTarget.findFirst.mockResolvedValue({
      id: "rt-row",
      targetId: "RT-BUILD-SANDBOX-FB-TEST",
      composeProjectName: "dpf",
      containerName: "dpf-sandbox-1",
      slotId: null,
      metadata: { composeWorkingDir: "D:\\DPF" },
    });

    const result = await diagnoseSandboxState({
      buildId: "FB-TEST",
      expectedWorkspaceRoot: "D:\\DPF",
      db,
      inspectContainer: vi.fn().mockResolvedValue({
        containerName: "dpf-sandbox-1",
        status: "running",
        running: true,
        composeProjectName: "dpf",
        composeServiceName: "sandbox",
        composeWorkingDir: "D:\\DPF-clean-main-linux",
        composeConfigFiles: ["D:\\DPF-clean-main-linux\\docker-compose.yml"],
        hostPorts: [3035],
      }),
      inspectGit: vi.fn().mockResolvedValue({ branchName: "build/FB-TEST", dirty: false, sourceCurrency: "verified" }),
    });

    expect(result.state).toBe("mixed_compose_project");
    expect(result.canDeploy).toBe(false);
    expect(result.checks.some((check) => check.id === "compose_working_dir" && check.status === "fail")).toBe(true);
  });

  it("returns healthy when ownership, branch, source, and verification match", async () => {
    db.featureBuild.findUnique.mockResolvedValue({
      id: "fb-row",
      buildId: "FB-TEST",
      sandboxId: "dpf-sandbox-1",
      sandboxPort: 3035,
      buildBranch: "build/FB-TEST",
      taskResults: { filesChanged: 2, ranTests: true },
      verificationOut: { testsFailed: 0, typecheckPassed: true },
      buildExecState: { sourceCurrency: { status: "current" } },
    });
    db.runtimeTarget.findFirst.mockResolvedValue({
      id: "rt-row",
      targetId: "RT-BUILD-SANDBOX-FB-TEST",
      composeProjectName: "dpf-build-studio",
      containerName: "dpf-sandbox-1",
      slotId: null,
      metadata: { composeWorkingDir: "D:\\DPF" },
    });

    const result = await diagnoseSandboxState({
      buildId: "FB-TEST",
      expectedWorkspaceRoot: "D:\\DPF",
      db,
      inspectContainer: vi.fn().mockResolvedValue({
        containerName: "dpf-sandbox-1",
        status: "running",
        running: true,
        composeProjectName: "dpf-build-studio",
        composeServiceName: "sandbox",
        composeWorkingDir: "D:\\DPF",
        composeConfigFiles: ["D:\\DPF\\docker-compose.yml"],
        hostPorts: [3035],
      }),
      inspectGit: vi.fn().mockResolvedValue({ branchName: "build/FB-TEST", dirty: false, sourceCurrency: "verified" }),
    });

    expect(result.state).toBe("healthy");
    expect(result.canDeploy).toBe(true);
    expect(result.canContribute).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-admin.test.ts
```

Expected: FAIL because `diagnoseSandboxState` does not exist.

- [ ] **Step 3: Implement `diagnoseSandboxState`**

Create `sandbox-admin.ts`. Keep the public function small and extract local helpers for each check. The initial implementation must classify these states in order: missing build, missing sandbox id, stopped/not-found container, mixed Compose project, branch mismatch, stale source, dirty/leaking workspace, verification red, healthy.

Use this exported signature:

```typescript
import type { SandboxReadinessSnapshot } from "./sandbox-admin-types";

export type SandboxAdminDb = {
  featureBuild: { findUnique(args: unknown): Promise<any> };
  runtimeTarget: { findFirst(args: unknown): Promise<any> };
  sandboxSlot: { findUnique(args: unknown): Promise<any> };
};

export type GitInspection = {
  branchName: string | null;
  dirty: boolean;
  sourceCurrency: "verified" | "unverified" | "stale";
};

export async function diagnoseSandboxState(args: {
  buildId: string;
  expectedWorkspaceRoot?: string;
  db?: SandboxAdminDb;
  inspectContainer?: (containerId: string) => Promise<unknown | null>;
  inspectGit?: (containerId: string, expectedBranch: string) => Promise<GitInspection>;
}): Promise<SandboxReadinessSnapshot> {
  // implement by composing small check helpers
}
```

When using real dependencies, import `prisma`, `parseDockerInspectJson`, and `execInSandbox` inside the function path so unit tests can inject fakes.

- [ ] **Step 4: Run diagnosis tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-admin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/integrate/sandbox/sandbox-admin.ts apps/web/lib/integrate/sandbox/sandbox-admin.test.ts
git commit -s -m "feat(build-studio): diagnose sandbox readiness"
```

---

## Task 4: Populate RuntimeTarget Ownership Metadata

**Files:**
- Modify: `apps/web/lib/runtime-coordination/build-studio-runtime.ts`
- Modify: `apps/web/lib/runtime-coordination/build-studio-runtime.test.ts`
- Modify: `apps/web/lib/integrate/sandbox/build-branch.ts`

- [ ] **Step 1: Extend the runtime input builder test**

In `build-studio-runtime.test.ts`, add assertions for:

```typescript
expect(input.composeProjectName).toBe("dpf-build-studio");
expect(input.serviceName).toBe("sandbox");
expect(input.slotId).toBe("slot-row-1");
expect(input.metadata).toMatchObject({
  buildId: "FB-TEST",
  buildBranch: "build/FB-TEST",
  composeWorkingDir: "D:\\DPF",
  composeConfigFiles: ["D:\\DPF\\docker-compose.yml"],
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/runtime-coordination/build-studio-runtime.test.ts
```

Expected: FAIL because the builder does not accept or populate those fields.

- [ ] **Step 3: Extend `buildBuildStudioSandboxTargetInput`**

Add optional args:

```typescript
slotId?: string | null;
composeProjectName?: string | null;
composeWorkingDir?: string | null;
composeConfigFiles?: string[];
sourceCurrency?: unknown;
gitHead?: string | null;
```

Set:

```typescript
serviceName: "sandbox",
slotId: args.slotId ?? null,
composeProjectName: args.composeProjectName ?? null,
metadata: {
  buildId: args.buildId,
  buildBranch: args.branchName,
  composeWorkingDir: args.composeWorkingDir ?? null,
  composeConfigFiles: args.composeConfigFiles ?? [],
  sourceCurrency: args.sourceCurrency ?? null,
  gitHead: args.gitHead ?? null,
},
```

- [ ] **Step 4: Feed metadata from `startBuildBranch`**

In `build-branch.ts`, after the final source-currency probe and before `registerRuntimeTarget`, inspect the sandbox container labels through the Docker helper. Pass `composeProjectName`, `composeWorkingDir`, and `composeConfigFiles` into `buildBuildStudioSandboxTargetInput`.

If inspection fails, pass nulls and let `diagnose_sandbox` classify the target as `unverified`.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/runtime-coordination/build-studio-runtime.test.ts apps/web/lib/integrate/sandbox/sandbox-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/runtime-coordination/build-studio-runtime.ts apps/web/lib/runtime-coordination/build-studio-runtime.test.ts apps/web/lib/integrate/sandbox/build-branch.ts
git commit -s -m "feat(build-studio): record sandbox runtime ownership"
```

---

## Task 5: Add MCP Diagnosis Tool and Retire User-Run Messaging

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts`
- Modify: `apps/web/lib/mcp-tools-runtime-coordination.test.ts` or create `apps/web/lib/mcp-tools-sandbox-admin.test.ts`
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts`

- [ ] **Step 1: Add tool-definition tests**

Create or extend a test to assert:

```typescript
const diagnoseTool = tools.find((tool) => tool.name === "diagnose_sandbox");
expect(diagnoseTool?.sideEffect).toBe(false);
expect(diagnoseTool?.buildPhases).toEqual(["build", "review", "ship"]);

const recoverTool = tools.find((tool) => tool.name === "recover_sandbox");
expect(recoverTool?.sideEffect).toBe(true);
expect(recoverTool?.inputSchema.properties.action.enum).toContain("quarantine_runtime_target");
```

- [ ] **Step 2: Add prompt text tests**

Add prompt assertions:

```typescript
expect(shipPrompt).toContain("call diagnose_sandbox");
expect(shipPrompt).toContain("Do not ask the user to run Docker");
expect(shipPrompt).not.toContain("docker compose up -d sandbox");
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-sandbox-admin.test.ts apps/web/lib/integrate/build-agent-prompts.test.ts
```

Expected: FAIL because tools/prompt text are not updated.

- [ ] **Step 4: Add `diagnose_sandbox` tool**

Add the tool definition near existing sandbox tools:

```typescript
{
  name: "diagnose_sandbox",
  description: "Diagnose Build Studio sandbox readiness for the active build. Returns ownership, branch, source-currency, verification, and recovery actions. Never ask the user to run Docker; use this tool and governed recovery actions.",
  inputSchema: {
    type: "object",
    properties: {
      buildId: { type: "string", description: "Optional FB-* build id. Defaults to active build." },
    },
  },
  requiredCapability: "view_platform",
  executionMode: "immediate",
  sideEffect: false,
  buildPhases: ["build", "review", "ship"],
}
```

Add handler:

```typescript
case "diagnose_sandbox": {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const { diagnoseSandboxState } = await import("@/lib/integrate/sandbox/sandbox-admin");
  const snapshot = await diagnoseSandboxState({ buildId });
  return {
    success: true,
    message: snapshot.summary,
    entityId: buildId,
    data: snapshot,
  };
}
```

- [ ] **Step 5: Replace unsafe legacy tool messages across ALL surfaces**

The legacy "tell the user to run docker compose" pattern is duplicated. Fix every occurrence in one pass:

| File | Site | Replacement requirement |
| --- | --- | --- |
| `apps/web/lib/mcp-tools.ts` | `check_sandbox` `not_found` message (~L6984) | Direct to `diagnose_sandbox` + Sandbox Control panel. |
| `apps/web/lib/mcp-tools.ts` | `start_sandbox` description string (~L1744) and `not_found` return (~L7006) | Remove the `docker compose up -d sandbox` instruction; describe the governed recovery path. |
| `apps/web/lib/mcp-tools.ts` | `start_build` fallback message (~L7312) `"tell the user to run: docker compose up -d sandbox"` | Replace with: call `diagnose_sandbox`; if blocked, surface platform incident — never instruct the user. |
| `apps/web/lib/mcp-tools.ts` | `run_ux_test` browser-use unreachable message (~L9171, L9260) `"Run 'docker compose up -d browser-use'"` | Replace with: record platform-issue, fall back to code-only analysis; never instruct the user to run docker. |
| `apps/web/lib/integrate/build-agent-prompts.ts` | STEP 0 `not_found` branch (~L242) `"Please run: docker compose up -d sandbox"` | Replace with the diagnose/recover flow specified in spec §11.1 (`not_found` template). |

Add a string-level regression test in `mcp-tools-sandbox-admin.test.ts` that scans the source of `mcp-tools.ts` and `build-agent-prompts.ts` and asserts NONE of these substrings appear in user-facing strings:

```typescript
const FORBIDDEN_DIALOG = [
  "docker compose up -d sandbox",
  "docker compose up -d browser-use",
  "tell the user to run",
  "Please run: docker",
];
```

Allowed only in code comments referencing this audit by its issue ID. This test guards against regressions where a future PR re-introduces the pattern.

- [ ] **Step 6: Update Build Studio prompts**

In `build-agent-prompts.ts`, ship/build blocker language must say:

```markdown
If deploy_feature fails because the sandbox is missing, detached, stale, or unavailable:
1. Call diagnose_sandbox.
2. If a governed recovery action is available, use recover_sandbox or point to the Sandbox Control panel.
3. If recovery is blocked, record the platform issue and stop.
Do not ask the user to run Docker, restart containers, or skip sandbox diff extraction.
```

- [ ] **Step 7: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/mcp-tools-sandbox-admin.test.ts apps/web/lib/integrate/build-agent-prompts.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add apps/web/lib/mcp-tools.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts apps/web/lib/integrate/build-agent-prompts.ts apps/web/lib/integrate/build-agent-prompts.test.ts
git commit -s -m "feat(build-studio): add sandbox diagnosis tool"
```

---

## Task 6: Add Governed Recovery Service

**Files:**
- Create: `apps/web/lib/integrate/sandbox/sandbox-recovery.ts`
- Create: `apps/web/lib/integrate/sandbox/sandbox-recovery.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Write recovery-policy tests**

Create `sandbox-recovery.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { recoverSandbox } from "./sandbox-recovery";

describe("recoverSandbox", () => {
  it("blocks reset_from_main without confirmation", async () => {
    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "reset_from_main",
      confirmation: null,
      diagnose: vi.fn().mockResolvedValue({ state: "stale_source", checks: [], recommendedActions: [] }),
      runCommand: vi.fn(),
      recordActivity: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("confirmation");
  });

  it("starts a stopped owned sandbox", async () => {
    const runCommand = vi.fn().mockResolvedValue("");
    const result = await recoverSandbox({
      buildId: "FB-TEST",
      action: "start",
      confirmation: null,
      diagnose: vi.fn()
        .mockResolvedValueOnce({ state: "stopped", containerId: "dpf-sandbox-1", checks: [], recommendedActions: [] })
        .mockResolvedValueOnce({ state: "healthy", canDeploy: true, canContribute: true, summary: "healthy", checks: [], recommendedActions: [], inspectedAt: new Date().toISOString(), buildId: "FB-TEST" }),
      runCommand,
      recordActivity: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(runCommand).toHaveBeenCalledWith("docker", ["start", "dpf-sandbox-1"]);
  });
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-recovery.test.ts
```

Expected: FAIL because the recovery service does not exist.

- [ ] **Step 3: Implement `recoverSandbox`**

Use this signature:

```typescript
import type { SandboxRecoveryAction, SandboxReadinessSnapshot } from "./sandbox-admin-types";

export async function recoverSandbox(args: {
  buildId: string;
  action: SandboxRecoveryAction;
  confirmation?: { discardSandboxChanges?: boolean; reason?: string } | null;
  diagnose?: (buildId: string) => Promise<SandboxReadinessSnapshot>;
  runCommand?: (command: string, args: string[]) => Promise<string>;
  recordActivity?: (buildId: string, summary: string) => Promise<void>;
}): Promise<{ success: boolean; message: string; error?: string; snapshot?: SandboxReadinessSnapshot }> {
  // implement one action per branch; rerun diagnosis before returning
}
```

V1 must implement `start`, `restart`, `quarantine_runtime_target`, `release_stale_slot`, and `reset_build_phase`. `reset_from_main` may return blocked until confirmation handling is fully implemented, but it must do so deliberately and with a recorded incident.

`release_stale_slot` MUST enforce the spec §13.5 idle floor: if the build's most recent `BuildActivity` is younger than 7 days, return `{ success: false, error: "slot is held by paused-but-not-abandoned build" }` even when the operator confirms. Add a test that proves it.

`reset_build_phase` MUST require structured confirmation (`{ acknowledgeReset: true, reason: string }`), mark the active `BuildPhaseRun` failed with `operator_reset_after_stall`, write a `BuildActivity` row, and release a slot held only by this build. It MUST NOT auto-redispatch the next phase — that is a separate operator action. Add a test that exercises the 4-stuck-builds class (`deps_installed` past heartbeat budget; `complete` with `filesChanged:0`).

- [ ] **Step 4: Add `recover_sandbox` MCP handler**

Add handler:

```typescript
case "recover_sandbox": {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const { recoverSandbox } = await import("@/lib/integrate/sandbox/sandbox-recovery");
  const result = await recoverSandbox({
    buildId,
    action: String(params.action) as never,
    confirmation: params.confirmation as never,
  });
  return { ...result, entityId: buildId, data: result.snapshot };
}
```

Validate `params.action` against `SandboxRecoveryAction` before calling the service.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-recovery.test.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/integrate/sandbox/sandbox-recovery.ts apps/web/lib/integrate/sandbox/sandbox-recovery.test.ts apps/web/lib/mcp-tools.ts
git commit -s -m "feat(build-studio): add governed sandbox recovery"
```

---

## Task 7: Gate Deploy and Contribution on Readiness

**Files:**
- Create: `apps/web/lib/integrate/sandbox/sandbox-readiness-gate.ts`
- Create: `apps/web/lib/integrate/sandbox/sandbox-readiness-gate.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Write gate tests**

Create `sandbox-readiness-gate.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assertSandboxReadyForContribution, assertSandboxReadyForDeploy } from "./sandbox-readiness-gate";

const healthy = {
  buildId: "FB-TEST",
  state: "healthy" as const,
  canDeploy: true,
  canContribute: true,
  summary: "healthy",
  checks: [],
  recommendedActions: [],
  inspectedAt: "2026-05-22T00:00:00.000Z",
};

describe("sandbox readiness gates", () => {
  it("allows deploy for healthy sandbox", () => {
    expect(assertSandboxReadyForDeploy(healthy)).toEqual({ ok: true });
  });

  it("blocks deploy for detached sandbox", () => {
    expect(assertSandboxReadyForDeploy({ ...healthy, state: "detached", canDeploy: false }).ok).toBe(false);
  });

  it("blocks contribution when source is stale", () => {
    expect(assertSandboxReadyForContribution({ ...healthy, state: "stale_source", canContribute: false }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Implement gate helpers**

Create `sandbox-readiness-gate.ts`:

```typescript
import type { SandboxReadinessSnapshot } from "./sandbox-admin-types";

export type SandboxGateResult = { ok: true } | { ok: false; message: string; state: string };

export function assertSandboxReadyForDeploy(snapshot: SandboxReadinessSnapshot): SandboxGateResult {
  if (snapshot.canDeploy && snapshot.state === "healthy") return { ok: true };
  return {
    ok: false,
    state: snapshot.state,
    message: `Sandbox is not ready for deploy_feature: ${snapshot.summary}`,
  };
}

export function assertSandboxReadyForContribution(snapshot: SandboxReadinessSnapshot): SandboxGateResult {
  if (snapshot.canContribute && snapshot.state === "healthy") return { ok: true };
  return {
    ok: false,
    state: snapshot.state,
    message: `Sandbox is not ready for upstream contribution: ${snapshot.summary}`,
  };
}
```

- [ ] **Step 3: Wire `deploy_feature`**

In `mcp-tools.ts` `deploy_feature`, call:

```typescript
const { diagnoseSandboxState } = await import("@/lib/integrate/sandbox/sandbox-admin");
const { assertSandboxReadyForDeploy } = await import("@/lib/integrate/sandbox/sandbox-readiness-gate");
const readiness = await diagnoseSandboxState({ buildId });
const readinessGate = assertSandboxReadyForDeploy(readiness);
if (!readinessGate.ok) {
  logBuildActivity(buildId, "deploy_feature", readinessGate.message);
  return {
    success: false,
    error: "Sandbox readiness blocked deploy_feature.",
    message: readinessGate.message,
    data: readiness,
  };
}
```

Place this before diff extraction.

- [ ] **Step 4: Wire `contribute_to_hive`**

Before FeaturePack upsert or PR creation, call `diagnoseSandboxState` and `assertSandboxReadyForContribution`. Return `success:false` before creating or updating a FeaturePack if the gate fails.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/sandbox-readiness-gate.test.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/integrate/sandbox/sandbox-readiness-gate.ts apps/web/lib/integrate/sandbox/sandbox-readiness-gate.test.ts apps/web/lib/mcp-tools.ts
git commit -s -m "fix(build-studio): gate deploy and contribution on sandbox readiness"
```

---

## Task 8: Harden Codegen Evidence and Verification Semantics

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts`
- Modify: `apps/web/lib/integrate/build-pipeline.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add build-pipeline regression tests**

In `build-pipeline.test.ts`, add tests asserting:

```typescript
it("marks code generation failed when no sandbox write tool ran", async () => {
  // arrange runAgenticLoop result with toolsExecuted: ["check_sandbox"], content containing limit text
  // expect runBuildPipeline result.step to be "failed"
});

it("counts write_sandbox_file as a source-changing tool", async () => {
  // arrange executedTools: [{ name: "write_sandbox_file" }, { name: "run_sandbox_tests" }]
  // expect taskResults.filesChanged to be 1 and ranTests to be true
});
```

Use the existing test harness patterns in the file. Do not reference a top-level mock variable inside `vi.mock` unless it is created with `vi.hoisted`.

- [ ] **Step 2: Implement hard-fail logic**

In `stepGenerateCode`, update file-change counting:

```typescript
const sourceWriteTools = new Set(["generate_code", "edit_sandbox_file", "write_sandbox_file"]);
const filesChanged = executedToolNames.filter((name) => sourceWriteTools.has(name)).length;
const ranTests = executedToolNames.includes("run_sandbox_tests");
const hitRuntimeLimit = /ran into a limit|try breaking your request into smaller steps/i.test(result.content);

if (filesChanged === 0 || !ranTests || hitRuntimeLimit) {
  throw new Error(
    `Build code generation did not produce verified source changes (filesChanged=${filesChanged}, ranTests=${ranTests}, hitRuntimeLimit=${hitRuntimeLimit}).`,
  );
}
```

- [ ] **Step 3: Stop defaulting omitted typecheck to true**

In `saveBuildEvidence`, replace the auto-default:

```typescript
if (field === "verificationOut" && normalized.typecheckPassed == null) {
  normalized.typecheckPassed = true;
}
```

with:

```typescript
if (field === "verificationOut" && normalized.typecheckPassed == null) {
  normalized.typecheckPassed = false;
  normalized.typecheckStatus = normalized.typecheckStatus ?? "unknown";
}
```

Add raw-output detection:

```typescript
const rawOutput = `${normalized.testOutput ?? ""}\n${normalized.typeCheckOutput ?? ""}`;
if (/\bFAIL\b|failed test suite|Type error:|does not exist on type|has no exported member/i.test(rawOutput)) {
  normalized.testsFailed = Math.max(Number(normalized.testsFailed ?? 0), 1);
  normalized.typecheckPassed = false;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/build-pipeline.test.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/lib/integrate/build-pipeline.ts apps/web/lib/integrate/build-pipeline.test.ts apps/web/lib/mcp-tools.ts
git commit -s -m "fix(build-studio): hard-fail unverified code generation"
```

---

## Task 9: Harden PR Creation, DCO, and Contribution Review

**Files:**
- Modify: `apps/web/lib/integrate/github-api-commit.ts`
- Modify: `apps/web/lib/integrate/github-api-commit.test.ts`
- Modify: `apps/web/lib/integrate/contribution-review.ts`
- Modify: `apps/web/lib/integrate/contribution-review.test.ts`
- Modify: `apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Add DCO identity tests**

In `github-api-commit.test.ts`, assert `createBranchAndPR` sends author and committer:

```typescript
expect(githubPost).toHaveBeenCalledWith(
  expect.stringContaining("/git/commits"),
  expect.objectContaining({
    author: { name: "dpf-agent-test", email: "agent-test@hive.dpf" },
    committer: { name: "dpf-agent-test", email: "agent-test@hive.dpf" },
  }),
  "token",
);
```

- [ ] **Step 2: Extend `createBranchAndPR` input**

Add:

```typescript
author?: { name: string; email: string };
committer?: { name: string; email: string };
```

When creating the commit, include:

```typescript
author: input.author,
committer: input.committer ?? input.author,
```

Add validation that the `Signed-off-by` trailer matches `input.author` when `author` is supplied.

- [ ] **Step 3: Pass platform identity from `contribute_to_hive`**

When calling `createBranchAndPR`, pass:

```typescript
author: { name: platformId.authorName, email: platformId.authorEmail },
committer: { name: platformId.authorName, email: platformId.authorEmail },
```

- [ ] **Step 4: Make contribution review CI-aware**

Add a required-check status resolver that returns:

```typescript
type RequiredChecksStatus = "green" | "red" | "pending" | "unknown";
```

For v1, if GitHub check lookup is unavailable, contribution review must not mark merge-ready; use `unknown` and status `pending`.

Set commit status:

```typescript
const statusState = requiredChecks === "green" && mergeReadiness === "ready" ? "success" : "failure";
```

or `pending` when checks are still running.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/github-api-commit.test.ts apps/web/lib/integrate/contribution-review.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/integrate/github-api-commit.ts apps/web/lib/integrate/github-api-commit.test.ts apps/web/lib/integrate/contribution-review.ts apps/web/lib/integrate/contribution-review.test.ts apps/web/lib/mcp-tools.ts
git commit -s -m "fix(build-studio): enforce DCO and CI-aware contribution review"
```

---

## Task 10: Add Admin Sandbox Control UI

**Files:**
- Create: `apps/web/lib/actions/build-sandbox-admin.ts`
- Create: `apps/web/lib/actions/build-sandbox-admin.test.ts`
- Create: `apps/web/app/(shell)/admin/build-studio/sandbox/page.tsx`
- Create: `apps/web/app/(shell)/admin/build-studio/sandbox/SandboxControlClient.tsx`
- Modify: admin navigation if needed by existing admin tab pattern

- [ ] **Step 1: Add server action tests**

Create `build-sandbox-admin.test.ts` asserting:

```typescript
it("returns sandbox control rows with readiness snapshots", async () => {
  const rows = await listSandboxControlState({ diagnose: fakeDiagnose, db: fakeDb });
  expect(rows[0]).toMatchObject({
    buildId: "FB-TEST",
    state: "healthy",
    containerId: "dpf-sandbox-1",
  });
});
```

- [ ] **Step 2: Implement server actions**

Create:

```typescript
export async function listSandboxControlState() {
  // read recent RuntimeTarget rows kind=build-sandbox and active FeatureBuild rows
  // call diagnoseSandboxState for each build id
}

export async function runSandboxRecoveryAction(input: {
  buildId: string;
  action: SandboxRecoveryAction;
  confirmation?: { discardSandboxChanges?: boolean; reason?: string };
}) {
  // authorize admin, call recoverSandbox, revalidate path
}
```

- [ ] **Step 3: Build the route**

`page.tsx`:

```tsx
import { listSandboxControlState } from "@/lib/actions/build-sandbox-admin";
import { SandboxControlClient } from "./SandboxControlClient";

export const dynamic = "force-dynamic";

export default async function SandboxControlPage() {
  const rows = await listSandboxControlState();
  return <SandboxControlClient initialRows={rows} />;
}
```

- [ ] **Step 4: Implement theme-aware UI**

`SandboxControlClient.tsx` must use:

- `text-[var(--dpf-text)]`
- `text-[var(--dpf-muted)]`
- `bg-[var(--dpf-bg)]`
- `bg-[var(--dpf-surface-1)]`
- `bg-[var(--dpf-surface-2)]`
- `border-[var(--dpf-border)]`
- `text-[var(--dpf-accent)]`

Do not use `text-gray-*`, `bg-white`, or hardcoded hex colors.

Layout:

- top band: summary counts by state;
- left table: runtime targets;
- center checklist: selected target checks;
- right action rail: recovery buttons with disabled reasons;
- bottom timeline: latest activity and issue rows.

- [ ] **Step 5: Run tests and typecheck**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/actions/build-sandbox-admin.test.ts
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/web/lib/actions/build-sandbox-admin.ts apps/web/lib/actions/build-sandbox-admin.test.ts apps/web/app/(shell)/admin/build-studio/sandbox/page.tsx apps/web/app/(shell)/admin/build-studio/sandbox/SandboxControlClient.tsx
git commit -s -m "feat(admin): add Build Studio sandbox control panel"
```

---

## Task 10b: Add Coworker Dialog Templates and Forbidden-Pattern Guard

**Files:**
- Create: `apps/web/lib/integrate/sandbox/coworker-dialog-templates.ts`
- Create: `apps/web/lib/integrate/sandbox/coworker-dialog-templates.test.ts`
- Modify: handler sites that surface sandbox/deploy/contribution failure messages back to the AI Coworker panel.

This task implements spec §11.1. The coworker dialog is the user-visible failure path; it must be tested independently of the underlying tool.

- [ ] **Step 1: Write template tests**

Create `coworker-dialog-templates.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderCoworkerDialog, FORBIDDEN_DIALOG_PATTERNS } from "./coworker-dialog-templates";

describe("coworker dialog templates", () => {
  it("renders detached state with quarantine incident and three options", () => {
    const text = renderCoworkerDialog({
      state: "mixed_compose_project",
      summary: "Owned by D:\\DPF-clean-main-linux",
      incidentId: "PIR-123",
    });
    expect(text).toContain("D:\\DPF-clean-main-linux");
    expect(text).toContain("PIR-123");
    expect(text).toMatch(/Options:.*Rebuild.*Switch.*Open Sandbox Control/s);
  });

  it("never returns text matching forbidden dialog patterns", () => {
    for (const state of ["stopped", "not_found", "detached", "mixed_compose_project", "stale_source", "dirty_or_leaking", "verification_red", "stuck_mid_phase", "unrecoverable"] as const) {
      const text = renderCoworkerDialog({ state, summary: "x", incidentId: null });
      for (const forbidden of FORBIDDEN_DIALOG_PATTERNS) {
        expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      expect(text).toMatch(/\*\*Options:\*\*/);
    }
  });

  it("ends every template with concrete options, not internal status", () => {
    for (const state of ["healthy", "stopped", "unrecoverable"] as const) {
      const text = renderCoworkerDialog({ state, summary: "x", incidentId: null });
      expect(text).not.toMatch(/\b(Done|Continuing|Investigating)\.\s*$/);
    }
  });
});
```

- [ ] **Step 2: Implement template module**

Create `coworker-dialog-templates.ts` exporting `FORBIDDEN_DIALOG_PATTERNS` (matching spec §11.1) and `renderCoworkerDialog({ state, summary, incidentId, branchName?, ago? })`. Each state returns one of the verbatim templates from spec §11.1 with the supplied substitutions. Helper rule: every returned string must contain the literal `**Options:**` marker.

- [ ] **Step 3: Wire into failure paths**

In every `deploy_feature` / `contribute_to_hive` / `recover_sandbox` failure return, populate the user-facing `message` field by calling `renderCoworkerDialog(...)` with the diagnostic snapshot's `state`, `summary`, and any incident id. Do NOT hand-write per-call strings — go through the template module so the forbidden-pattern test catches drift.

- [ ] **Step 4: Run tests**

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox/coworker-dialog-templates.test.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts
```

Expected: PASS, including the forbidden-pattern source scan from Task 5.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/integrate/sandbox/coworker-dialog-templates.ts apps/web/lib/integrate/sandbox/coworker-dialog-templates.test.ts apps/web/lib/mcp-tools.ts
git commit -s -m "feat(build-studio): coworker dialog templates for sandbox readiness states"
```

---

## Task 11: Add Build Studio Readiness Strip

**Files:**
- Create: `apps/web/components/build/SandboxReadinessStrip.tsx`
- Create: `apps/web/components/build/SandboxReadinessStrip.test.tsx`
- Modify: active Build Studio detail component that renders the workflow graph or build detail panel

- [ ] **Step 1: Write component tests**

Create `SandboxReadinessStrip.test.tsx`:

```typescript
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SandboxReadinessStrip } from "./SandboxReadinessStrip";

describe("SandboxReadinessStrip", () => {
  it("renders blocked state with recovery action", () => {
    const html = renderToStaticMarkup(
      <SandboxReadinessStrip
        snapshot={{
          buildId: "FB-TEST",
          state: "mixed_compose_project",
          canDeploy: false,
          canContribute: false,
          summary: "Sandbox belongs to another worktree.",
          checks: [],
          recommendedActions: [{ action: "quarantine_runtime_target", label: "Quarantine", requiresApproval: false }],
          inspectedAt: "2026-05-22T00:00:00.000Z",
        }}
      />,
    );

    expect(html).toContain("Sandbox belongs to another worktree.");
    expect(html).toContain("Quarantine");
    expect(html).toContain("border-[var(--dpf-border)]");
  });
});
```

- [ ] **Step 2: Implement component**

Use a compact full-width strip. Do not put cards inside cards.

- [ ] **Step 3: Mount in Build Studio detail**

Find the active build detail component and pass the server-provided snapshot. If the current data loader cannot provide it cleanly, add a server action that returns the snapshot for the selected build.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/components/build/SandboxReadinessStrip.test.tsx
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web/components/build/SandboxReadinessStrip.tsx apps/web/components/build/SandboxReadinessStrip.test.tsx
git commit -s -m "feat(build-studio): show sandbox readiness in build detail"
```

---

## Task 12: End-to-End Verification

**Files:**
- Modify: `tests/e2e/platform-qa-plan.md` if the Build Studio sandbox-admin phase needs a named QA step
- Update: PR description with evidence

- [ ] **Step 1: Run focused unit tests**

Run:

```bash
pnpm --filter web exec vitest run apps/web/lib/integrate/sandbox apps/web/lib/runtime-coordination/build-studio-runtime.test.ts apps/web/lib/integrate/build-pipeline.test.ts apps/web/lib/integrate/github-api-commit.test.ts apps/web/lib/integrate/contribution-review.test.ts apps/web/lib/actions/build-sandbox-admin.test.ts apps/web/components/build/SandboxReadinessStrip.test.tsx apps/web/lib/integrate/sandbox/coworker-dialog-templates.test.ts apps/web/lib/mcp-tools-sandbox-admin.test.ts
```

Expected: all listed tests pass.

- [ ] **Step 1b: Run FULL vitest suite (mandatory before push)**

Run:

```bash
pnpm --filter web exec vitest run
pnpm --filter @dpf/db exec vitest run
```

Expected: all suites pass. Per standing rule, pre-commit only runs typecheck — vitest must be run locally or CI will break for everyone.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter web typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm --filter web exec next build
```

Expected: production build completes with zero errors.

- [ ] **Step 4: Run local sandbox diagnostic smoke**

Against the Docker-served app, authenticate as `admin@dpf.local` using `ADMIN_PASSWORD` from repo-root `.env`. Open:

```text
/admin/build-studio/sandbox
```

Verify:

- at least one sandbox target row appears or an empty state explains there are no active targets;
- readiness state is visible;
- failed checks are listed with expected/actual values;
- recovery buttons are disabled with reasons when unsafe.

- [ ] **Step 5: Run Build Studio blocked-state smoke**

Use a test build or fixture that points to a deliberately mismatched sandbox target. Verify:

- Build Studio shows `Blocked` or `Needs recovery`;
- `deploy_feature` returns `success:false`;
- `contribute_to_hive` returns `success:false`;
- a `BuildActivity` row records the blocked reason;
- no PR is opened.

- [ ] **Step 6: Run DCO metadata smoke with mocked GitHub**

Use the `createBranchAndPR` test harness or a mocked GitHub token environment. Verify the create-commit payload includes matching `author`, `committer`, and `Signed-off-by` identities.

- [ ] **Step 6b: PR overlap sweep before push**

Before opening or pushing to the PR, run an overlap sweep — concurrent sessions may be touching the same surfaces:

```bash
gh pr list --state open --limit 30 --json number,title,headRefName,updatedAt
git log origin/main --since="7 days ago" --oneline -- apps/web/lib/mcp-tools.ts apps/web/lib/integrate/sandbox apps/web/lib/integrate/build-agent-prompts.ts apps/web/lib/integrate/build-pipeline.ts apps/web/lib/integrate/github-api-commit.ts apps/web/lib/integrate/contribution-review.ts apps/web/lib/runtime-coordination/build-studio-runtime.ts
```

If another open PR or recent main commit overlaps the same files, reconcile before pushing. Re-run this sweep before *every* push in long autonomous runs, not just the first one.

- [ ] **Step 7: Final commit**

Run:

```bash
git status --short
git add docs/superpowers/specs/2026-05-22-build-studio-sandbox-admin-recovery-design.md docs/superpowers/plans/2026-05-22-build-studio-sandbox-admin-recovery.md tests/e2e/platform-qa-plan.md
git commit -s -m "docs(build-studio): specify sandbox admin recovery control plane"
```

If the implementation tasks were committed along the way, this final commit should include only docs and QA-plan updates.

---

## Spec Coverage Self-Review

- Diagnostic service: Tasks 1-3.
- Runtime target ownership: Task 4.
- MCP diagnosis/recovery tools (incl. `reset_build_phase` for stuck-build class): Tasks 5-6.
- Legacy "user-run docker" audit + forbidden-pattern source scan: Task 5.
- Deploy and contribution gate integration: Tasks 7-9.
- Codegen/verification hard failures: Task 8.
- Admin UI and Build Studio UI: Tasks 10-11.
- Coworker dialog templates + forbidden-pattern guard (spec §11.1): Task 10b.
- Stuck mid-phase recovery + 7-day idle floor (spec §13.5): Tasks 6, 12.
- Full vitest + PR overlap sweep before push: Task 12.
- Verification and QA evidence: Task 12.

No placeholder tasks remain. Every task has exact file paths, commands, and expected outcomes.
