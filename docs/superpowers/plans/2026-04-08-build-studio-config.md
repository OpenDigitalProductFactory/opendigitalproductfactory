# Build Studio Configuration Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Build Studio" tab to AI Workforce that lets admins choose which CLI runs builds and which configured credential (subscription vs API key) it uses, persisted to the database.

**Architecture:** New page at `/platform/ai/build-studio` with a client form component. Config stored in existing `PlatformConfig` table as a JSON value under key `"build-studio-dispatch"`. Dispatchers (`claude-dispatch.ts`, `codex-dispatch.ts`, `build-orchestrator.ts`) read config at task time via a shared `getBuildStudioConfig()` helper, falling back to env vars.

**Tech Stack:** Next.js 16 (server components + client form), Prisma (`PlatformConfig`), React (radio groups), Tailwind (DPF design tokens).

**Spec:** `docs/superpowers/specs/2026-04-08-build-studio-config-design.md`

---

## Task 1: Config Reader — `build-studio-config.ts`

**Files:**
- Create: `apps/web/lib/integrate/build-studio-config.ts`
- Test: `apps/web/lib/integrate/build-studio-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/integrate/build-studio-config.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getBuildStudioConfig, type BuildStudioDispatchConfig } from "./build-studio-config";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    platformConfig: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
const mockFindUnique = vi.mocked(prisma.platformConfig.findUnique);

describe("getBuildStudioConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear env vars
    delete process.env.CLI_DISPATCH_PROVIDER;
    delete process.env.CODEX_DISPATCH;
    delete process.env.CLAUDE_CODE_PROVIDER_ID;
    delete process.env.CODEX_PROVIDER_ID;
    delete process.env.CLAUDE_CODE_MODEL;
    delete process.env.CODEX_MODEL;
  });

  it("returns defaults when no DB config and no env vars", async () => {
    mockFindUnique.mockResolvedValue(null);
    const config = await getBuildStudioConfig();
    expect(config).toEqual({
      provider: "codex",
      claudeProviderId: "anthropic-sub",
      codexProviderId: "chatgpt",
      claudeModel: "sonnet",
      codexModel: "",
    });
  });

  it("reads config from PlatformConfig DB row", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: {
        provider: "claude",
        claudeProviderId: "anthropic",
        codexProviderId: "codex",
        claudeModel: "opus",
        codexModel: "o4-mini",
      },
      updatedAt: new Date(),
    });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic");
    expect(config.claudeModel).toBe("opus");
  });

  it("merges partial DB config with defaults", async () => {
    mockFindUnique.mockResolvedValue({
      id: "1",
      key: "build-studio-dispatch",
      value: { provider: "claude" },
      updatedAt: new Date(),
    });
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeProviderId).toBe("anthropic-sub"); // default
    expect(config.claudeModel).toBe("sonnet"); // default
  });

  it("falls back to env vars when no DB config", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CLI_DISPATCH_PROVIDER = "claude";
    process.env.CLAUDE_CODE_MODEL = "opus";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("claude");
    expect(config.claudeModel).toBe("opus");
  });

  it("falls back to legacy CODEX_DISPATCH=false as agentic", async () => {
    mockFindUnique.mockResolvedValue(null);
    process.env.CODEX_DISPATCH = "false";
    const config = await getBuildStudioConfig();
    expect(config.provider).toBe("agentic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run lib/integrate/build-studio-config.test.ts
```

Expected: fails because `build-studio-config.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/integrate/build-studio-config.ts`:

```typescript
// apps/web/lib/integrate/build-studio-config.ts
// Reads Build Studio dispatch configuration from PlatformConfig DB table.
// Falls back to env vars for backward compatibility with existing deployments.

import { prisma } from "@dpf/db";

export type BuildStudioDispatchConfig = {
  provider: "claude" | "codex" | "agentic";
  claudeProviderId: string;
  codexProviderId: string;
  claudeModel: string;
  codexModel: string;
};

const DEFAULTS: BuildStudioDispatchConfig = {
  provider: "codex",
  claudeProviderId: "anthropic-sub",
  codexProviderId: "chatgpt",
  claudeModel: "sonnet",
  codexModel: "",
};

function resolveProviderFromEnv(): "claude" | "codex" | "agentic" {
  const raw = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (raw === "claude") return "claude";
  if (raw === "false" || raw === "agentic") return "agentic";
  return "codex";
}

export async function getBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value && typeof row.value === "object") {
    return { ...DEFAULTS, ...(row.value as Partial<BuildStudioDispatchConfig>) };
  }
  return {
    provider: resolveProviderFromEnv(),
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? DEFAULTS.claudeProviderId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? DEFAULTS.codexProviderId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter web exec vitest run lib/integrate/build-studio-config.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```
feat(build-studio): add config reader with DB + env var fallback
```

---

## Task 2: Server Action — `saveBuildStudioConfig`

**Files:**
- Create: `apps/web/lib/actions/build-studio.ts`

- [ ] **Step 1: Create the server action**

Create `apps/web/lib/actions/build-studio.ts`:

```typescript
"use server";

import { prisma, type Prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

const VALID_PROVIDERS = new Set(["claude", "codex", "agentic"]);
const VALID_CLAUDE_PROVIDERS = new Set(["anthropic", "anthropic-sub"]);
const VALID_CODEX_PROVIDERS = new Set(["codex", "chatgpt"]);
const VALID_CLAUDE_MODELS = new Set(["haiku", "sonnet", "opus"]);

export async function saveBuildStudioConfig(
  config: BuildStudioDispatchConfig,
): Promise<{ ok: true }> {
  await requireManageProviders();

  // Validate
  if (!VALID_PROVIDERS.has(config.provider)) {
    throw new Error(`Invalid provider: ${config.provider}`);
  }
  if (!VALID_CLAUDE_PROVIDERS.has(config.claudeProviderId)) {
    throw new Error(`Invalid Claude provider ID: ${config.claudeProviderId}`);
  }
  if (!VALID_CODEX_PROVIDERS.has(config.codexProviderId)) {
    throw new Error(`Invalid Codex provider ID: ${config.codexProviderId}`);
  }
  if (!VALID_CLAUDE_MODELS.has(config.claudeModel)) {
    throw new Error(`Invalid Claude model: ${config.claudeModel}`);
  }

  await prisma.platformConfig.upsert({
    where: { key: "build-studio-dispatch" },
    update: { value: config as unknown as Prisma.InputJsonValue },
    create: { key: "build-studio-dispatch", value: config as unknown as Prisma.InputJsonValue },
  });

  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(build-studio): add server action for saving dispatch config
```

---

## Task 3: Wire Dispatchers to Config Reader

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts` (lines 23-41, 287-291)
- Modify: `apps/web/lib/integrate/claude-dispatch.ts` (lines 18-30, 51-75, 146-151)
- Modify: `apps/web/lib/integrate/codex-dispatch.ts` (lines 43-44, 159-163)
- Test: `apps/web/lib/integrate/build-orchestrator.test.ts`

This task has three sub-parts. Work through them sequentially.

### 3a: Update build-orchestrator.ts

- [ ] **Step 1: Remove module-level provider resolution, import config reader**

In `apps/web/lib/integrate/build-orchestrator.ts`:

Replace lines 23-41 (the import, type, resolveProvider, and constant):

```typescript
// REMOVE these lines:
import { dispatchClaudeTask, type ClaudeResult } from "./claude-dispatch";

type CliDispatchProvider = "codex" | "claude" | "agentic";

function resolveProvider(): CliDispatchProvider {
  const raw = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (raw === "claude") return "claude";
  if (raw === "false" || raw === "agentic") return "agentic";
  return "codex";
}

const CLI_DISPATCH_PROVIDER = resolveProvider();
```

Replace with:

```typescript
import { dispatchClaudeTask, type ClaudeResult } from "./claude-dispatch";
import { getBuildStudioConfig } from "./build-studio-config";
```

- [ ] **Step 2: Update dispatchSpecialist to read config async**

In `dispatchSpecialist()` (around line 287), replace the CLI dispatch block:

```typescript
  // CURRENT:
  if (CLI_DISPATCH_PROVIDER === "codex" || CLI_DISPATCH_PROVIDER === "claude") {
    const cliResult = CLI_DISPATCH_PROVIDER === "claude"
      ? await dispatchClaudeTask({ task, buildId, buildContext, priorResults })
      : await dispatchCodexTask({ task, buildId, buildContext, priorResults });
```

With:

```typescript
  const config = await getBuildStudioConfig();

  if (config.provider === "codex" || config.provider === "claude") {
    const cliResult = config.provider === "claude"
      ? await dispatchClaudeTask({ task, buildId, buildContext, priorResults, providerId: config.claudeProviderId, model: config.claudeModel })
      : await dispatchCodexTask({ task, buildId, buildContext, priorResults, providerId: config.codexProviderId, model: config.codexModel });
```

Also update the agentic loop fallback check further down — replace any remaining `CLI_DISPATCH_PROVIDER` reference with `config.provider`. The agentic loop block (after the CLI block's closing `}`) is the implicit `else` — no changes needed since it already runs when the CLI block doesn't match.

- [ ] **Step 2b: Rewrite the pre-flight auth check in `runBuildOrchestrator()`**

The pre-flight block (lines 412-443) uses `CLI_DISPATCH_PROVIDER` and hardcoded provider IDs. Rewrite it to use the config:

```typescript
  // ─── Pre-flight check: verify CLI dispatch auth is available ─────────────
  const config = await getBuildStudioConfig();

  if (config.provider === "codex" || config.provider === "claude") {
    try {
      const { getDecryptedCredential } = await import("@/lib/inference/ai-provider-internals");
      const providerId = config.provider === "claude" ? config.claudeProviderId : config.codexProviderId;
      const cred = await getDecryptedCredential(providerId);
      const hasAuth = config.provider === "claude"
        ? !!(cred?.cachedToken || cred?.secretRef)  // OAuth token or API key
        : !!cred?.cachedToken;                        // Codex always needs OAuth token
      if (!hasAuth) {
        const label = config.provider === "claude" ? "Claude / Anthropic" : "OpenAI / Codex";
        return {
          content: `Build cannot start — the ${label} provider "${providerId}" is not connected.\n\nGo to Admin > AI Workforce > External Services and configure credentials, or switch providers in Build Studio.`,
          totalTasks: 0, completedTasks: 0, failedTasks: 0,
          specialistResults: [], totalInputTokens: 0, totalOutputTokens: 0,
        };
      }
    } catch {
      return {
        content: "Build cannot start — could not verify AI provider credentials.\n\nGo to Admin > AI Workforce and ensure at least one code generation provider is connected.",
        totalTasks: 0, completedTasks: 0, failedTasks: 0,
        specialistResults: [], totalInputTokens: 0, totalOutputTokens: 0,
      };
    }
  }
```

Then reuse the same `config` variable in `dispatchSpecialist` — either hoist `config` to the `runBuildOrchestrator` scope and pass it down, or call `getBuildStudioConfig()` again in `dispatchSpecialist` (it's a lightweight DB read, acceptable to call twice).

### 3b: Update claude-dispatch.ts

- [ ] **Step 3: Accept providerId and model as parameters**

In `apps/web/lib/integrate/claude-dispatch.ts`:

Remove the module-level constants and `CLAUDE_AUTH_MODE` (lines 18-30):

```typescript
// REMOVE:
const CLAUDE_CODE_MODEL = process.env.CLAUDE_CODE_MODEL ?? "sonnet";
type ClaudeAuthMode = "oauth" | "apikey";
const CLAUDE_AUTH_MODE: ClaudeAuthMode =
  process.env.CLAUDE_CODE_AUTH_MODE === "apikey" ? "apikey" : "oauth";
```

Keep `SANDBOX_CONTAINER` and `CLAUDE_TASK_TIMEOUT_MS`.

Update `resolveClaudeAuth()` signature to accept `providerId`:

```typescript
async function resolveClaudeAuth(providerId: string): Promise<ClaudeAuth> {
  const credential = await getDecryptedCredential(providerId);

  // Determine auth mode from provider ID:
  // "anthropic-sub" → OAuth (Max Plan subscription)
  // "anthropic" → API key (per-token billing)
  const isOAuth = providerId === "anthropic-sub";

  if (!isOAuth) {
    const apiKey = credential?.secretRef ?? credential?.cachedToken;
    if (!apiKey) {
      throw new Error(`No Anthropic API key for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
    }
    return { mode: "apikey", apiKey };
  }

  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }

  const tokenJson = JSON.stringify({
    accessToken: credential.cachedToken,
    refreshToken: credential.refreshToken ?? "",
    expiresAt: credential.tokenExpiresAt?.toISOString() ?? "",
  });

  return { mode: "oauth", tokenJson };
}
```

Update `dispatchClaudeTask` to accept `providerId` and `model`:

```typescript
export async function dispatchClaudeTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;   // default: "anthropic-sub"
  model?: string;        // default: "sonnet"
}): Promise<ClaudeResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "anthropic-sub";
  const model = params.model ?? "sonnet";
  const role = task.specialist;

  let auth: ClaudeAuth;
  try {
    auth = await resolveClaudeAuth(providerId);
  } catch (err) {
  // ... rest unchanged
```

Then replace all references to `CLAUDE_CODE_MODEL` with `model` inside the function body.

### 3c: Update codex-dispatch.ts

- [ ] **Step 4: Accept providerId and model as parameters**

In `apps/web/lib/integrate/codex-dispatch.ts`:

Update `injectCodexAuth()` to accept `providerId`:

```typescript
async function injectCodexAuth(providerId: string): Promise<void> {
  const credential = await getDecryptedCredential(providerId);
  if (!credential?.cachedToken) {
    throw new Error(`No OAuth token for provider "${providerId}". Configure via Admin > AI Workforce > External Services.`);
  }
  // ... rest unchanged
```

Update `dispatchCodexTask` to accept `providerId` and `model`:

```typescript
export async function dispatchCodexTask(params: {
  task: AssignedTask;
  buildId: string;
  buildContext: string;
  priorResults?: string;
  providerId?: string;   // default: "chatgpt"
  model?: string;        // default: "" (server assigns)
}): Promise<CodexResult> {
  const { task, buildContext, priorResults } = params;
  const providerId = params.providerId ?? "chatgpt";
  const model = params.model ?? "";
  const role = task.specialist;

  try {
    await injectCodexAuth(providerId);
  } catch (err) {
  // ... rest unchanged
```

Then replace `CODEX_MODEL` references with `model` inside the function body. Keep the module-level `CODEX_MODEL` constant as the default fallback only if `model` param is not provided.

- [ ] **Step 5: Update orchestrator test**

Add to `apps/web/lib/integrate/build-orchestrator.test.ts` — add a test for `classifyOutcome` still working (the existing tests already cover this; just verify they still pass):

```bash
pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts
```

- [ ] **Step 6: Run full typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 7: Run config reader tests**

```bash
pnpm --filter web exec vitest run lib/integrate/build-studio-config.test.ts
```

- [ ] **Step 8: Commit**

```
refactor(build-studio): wire dispatchers to DB config reader

build-orchestrator reads provider + credential from PlatformConfig at
task time instead of module-level env vars. claude-dispatch and
codex-dispatch accept providerId/model as params.
```

---

## Task 4: Add "Build Studio" Tab to Navigation

**Files:**
- Modify: `apps/web/components/platform/AiTabNav.tsx`

- [ ] **Step 1: Add the tab**

In `apps/web/components/platform/AiTabNav.tsx`, add after the "External Services" entry (line 8):

```typescript
const TABS = [
  { label: "Workforce", href: "/platform/ai" },
  { label: "External Services", href: "/platform/ai/providers" },
  { label: "Build Studio", href: "/platform/ai/build-studio" },  // ← ADD
  { label: "Route Log", href: "/platform/ai/routing" },
  // ... rest unchanged
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```
feat(build-studio): add Build Studio tab to AI Workforce navigation
```

---

## Task 5: Build Studio Page (Server Component)

**Files:**
- Create: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`:

```typescript
// apps/web/app/(shell)/platform/ai/build-studio/page.tsx
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getProviders } from "@/lib/inference/ai-provider-data";
import { getBuildStudioConfig } from "@/lib/integrate/build-studio-config";
import { AiTabNav } from "@/components/platform/AiTabNav";
import { BuildStudioConfigForm } from "@/components/platform/BuildStudioConfigForm";

const CLAUDE_PROVIDER_IDS = ["anthropic", "anthropic-sub"];
const CODEX_PROVIDER_IDS = ["codex", "chatgpt"];

export default async function BuildStudioPage() {
  const session = await auth();
  const user = session?.user;
  const canWrite = !!user && can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_provider_connections",
  );

  const [allProviders, config] = await Promise.all([
    getProviders(),
    getBuildStudioConfig(),
  ]);

  const claudeProviders = allProviders.filter(p =>
    CLAUDE_PROVIDER_IDS.includes(p.provider.providerId),
  );
  const codexProviders = allProviders.filter(p =>
    CODEX_PROVIDER_IDS.includes(p.provider.providerId),
  );

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Build Studio
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          Configure which CLI agent and credentials run build tasks in the sandbox.
        </p>
      </div>

      <AiTabNav />

      <BuildStudioConfigForm
        config={config}
        claudeProviders={claudeProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        codexProviders={codexProviders.map(p => ({
          providerId: p.provider.providerId,
          name: p.provider.name,
          status: p.credential?.status ?? "unconfigured",
          billingLabel: p.provider.billingLabel,
          costNotes: p.provider.costPerformanceNotes,
        }))}
        canWrite={canWrite}
      />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** (will fail until form component exists — that's Task 6)

Note: defer typecheck to after Task 6.

- [ ] **Step 3: Commit** (commit together with Task 6)

---

## Task 6: Build Studio Config Form (Client Component)

**Files:**
- Create: `apps/web/components/platform/BuildStudioConfigForm.tsx`

- [ ] **Step 1: Create the form component**

Create `apps/web/components/platform/BuildStudioConfigForm.tsx`:

```typescript
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveBuildStudioConfig } from "@/lib/actions/build-studio";
import type { BuildStudioDispatchConfig } from "@/lib/integrate/build-studio-config";

type ProviderOption = {
  providerId: string;
  name: string;
  status: string;
  billingLabel: string | null;
  costNotes: string | null;
};

type Props = {
  config: BuildStudioDispatchConfig;
  claudeProviders: ProviderOption[];
  codexProviders: ProviderOption[];
  canWrite: boolean;
};

// Credential status lifecycle: unconfigured → pending (on save) → ok (after OAuth/exchange) → expired (on failure)
const STATUS_COLORS: Record<string, string> = {
  ok:           "var(--dpf-success)",
  configured:   "var(--dpf-success)",
  pending:      "var(--dpf-warning)",
  unconfigured: "var(--dpf-muted)",
  auth_failed:  "var(--dpf-error)",
  expired:      "var(--dpf-error)",
};

const STATUS_LABELS: Record<string, string> = {
  ok:           "Connected",
  configured:   "Configured",
  pending:      "Credentials saved, not yet verified",
  unconfigured: "Not configured",
  auth_failed:  "Auth failed",
  expired:      "Token expired",
};

const CLAUDE_MODELS = [
  { value: "haiku", label: "Haiku", desc: "fastest, cheapest" },
  { value: "sonnet", label: "Sonnet", desc: "best balance", recommended: true },
  { value: "opus", label: "Opus", desc: "most capable, slower" },
];

const SUBSCRIPTION_PROVIDERS = new Set(["anthropic-sub", "chatgpt"]);

export function BuildStudioConfigForm({ config, claudeProviders, codexProviders, canWrite }: Props) {
  const [provider, setProvider] = useState(config.provider);
  const [claudeProviderId, setClaudeProviderId] = useState(config.claudeProviderId);
  const [codexProviderId, setCodexProviderId] = useState(config.codexProviderId);
  const [claudeModel, setClaudeModel] = useState(config.claudeModel);
  const [codexModel, setCodexModel] = useState(config.codexModel);
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasClaudeCreds = claudeProviders.some(p => p.status === "ok" || p.status === "configured" || p.status === "pending");
  const hasCodexCreds = codexProviders.some(p => p.status === "ok" || p.status === "configured" || p.status === "pending");

  function handleSave() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await saveBuildStudioConfig({
          provider,
          claudeProviderId,
          codexProviderId,
          claudeModel,
          codexModel,
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Section 1: Active CLI Provider */}
      <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Build Dispatch Engine
        </div>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Choose which CLI agent executes build tasks in the sandbox.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ProviderRadio
            name="provider"
            value="claude"
            checked={provider === "claude"}
            onChange={() => setProvider("claude")}
            disabled={!canWrite || !hasClaudeCreds}
            label="Claude Code CLI"
            desc="Anthropic models"
            unconfiguredMsg={!hasClaudeCreds ? "No Anthropic credentials found." : undefined}
          />
          <ProviderRadio
            name="provider"
            value="codex"
            checked={provider === "codex"}
            onChange={() => setProvider("codex")}
            disabled={!canWrite || !hasCodexCreds}
            label="Codex CLI"
            desc="OpenAI models"
            unconfiguredMsg={!hasCodexCreds ? "No OpenAI credentials found." : undefined}
          />
          <ProviderRadio
            name="provider"
            value="agentic"
            checked={provider === "agentic"}
            onChange={() => setProvider("agentic")}
            disabled={!canWrite}
            label="Agentic Loop (Legacy)"
            desc="Built-in tool-calling loop"
          />
        </div>
      </section>

      {/* Section 2: Provider Assignments */}
      <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
        <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
          Credential Source
        </div>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 12 }}>
          Which configured credential should each CLI use for builds?
        </p>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {/* Claude Code credential card */}
          <CredentialCard
            title="Claude Code"
            providers={claudeProviders}
            selectedId={claudeProviderId}
            onSelect={setClaudeProviderId}
            active={provider === "claude"}
            canWrite={canWrite}
          />

          {/* Codex credential card */}
          <CredentialCard
            title="Codex"
            providers={codexProviders}
            selectedId={codexProviderId}
            onSelect={setCodexProviderId}
            active={provider === "codex"}
            canWrite={canWrite}
          />
        </div>
      </section>

      {/* Section 3: Model Preferences */}
      {provider !== "agentic" && (
        <section style={{ background: "var(--dpf-card)", border: "1px solid var(--dpf-border)", borderRadius: 8, padding: 16 }}>
          <div style={{ color: "var(--dpf-accent)", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Model Preferences
          </div>

          {provider === "claude" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 4 }}>Claude Code model</p>
              {CLAUDE_MODELS.map(m => (
                <label key={m.value} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", cursor: canWrite ? "pointer" : "default" }}>
                  <input
                    type="radio"
                    name="claudeModel"
                    value={m.value}
                    checked={claudeModel === m.value}
                    onChange={() => setClaudeModel(m.value)}
                    disabled={!canWrite}
                  />
                  <span>{m.label}</span>
                  <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                    {m.desc}{m.recommended ? " (recommended)" : ""}
                  </span>
                </label>
              ))}
            </div>
          )}

          {provider === "codex" && (
            <div>
              <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 4 }}>Codex model</p>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)", marginBottom: 6 }}>
                <input
                  type="radio"
                  name="codexModel"
                  value=""
                  checked={codexModel === ""}
                  onChange={() => setCodexModel("")}
                  disabled={!canWrite}
                />
                Server default (assigned by ChatGPT backend)
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--dpf-text)" }}>
                <input
                  type="radio"
                  name="codexModel"
                  value="custom"
                  checked={codexModel !== ""}
                  onChange={() => setCodexModel("o4-mini")}
                  disabled={!canWrite}
                />
                Custom:
                <input
                  type="text"
                  value={codexModel}
                  onChange={e => setCodexModel(e.target.value)}
                  disabled={!canWrite || codexModel === ""}
                  placeholder="o4-mini"
                  style={{
                    width: 120,
                    fontSize: 11,
                    padding: "2px 6px",
                    border: "1px solid var(--dpf-border)",
                    borderRadius: 4,
                    background: "var(--dpf-bg)",
                    color: "var(--dpf-text)",
                  }}
                />
              </label>
            </div>
          )}
        </section>
      )}

      {/* Save button */}
      {canWrite && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleSave}
            disabled={isPending}
            style={{
              padding: "6px 16px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--dpf-accent)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: isPending ? "wait" : "pointer",
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? "Saving..." : "Save Configuration"}
          </button>
          {saved && <span style={{ fontSize: 11, color: "var(--dpf-success)" }}>Saved</span>}
          {error && <span style={{ fontSize: 11, color: "var(--dpf-error)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ProviderRadio({ name, value, checked, onChange, disabled, label, desc, unconfiguredMsg }: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  disabled: boolean;
  label: string;
  desc: string;
  unconfiguredMsg?: string;
}) {
  return (
    <label style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 8,
      padding: "8px 10px",
      borderRadius: 6,
      border: checked ? "1px solid var(--dpf-accent)" : "1px solid var(--dpf-border)",
      background: checked ? "color-mix(in srgb, var(--dpf-accent) 5%, transparent)" : "transparent",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
    }}>
      <input type="radio" name={name} value={value} checked={checked} onChange={onChange} disabled={disabled} style={{ marginTop: 2 }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>{label}</div>
        <div style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{desc}</div>
        {unconfiguredMsg && (
          <div style={{ fontSize: 10, color: "var(--dpf-warning)", marginTop: 2 }}>
            {unconfiguredMsg}{" "}
            <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
              Set up in External Services
            </Link>
          </div>
        )}
      </div>
    </label>
  );
}

function CredentialCard({ title, providers, selectedId, onSelect, active, canWrite }: {
  title: string;
  providers: ProviderOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  active: boolean;
  canWrite: boolean;
}) {
  return (
    <div style={{
      flex: "1 1 280px",
      minWidth: 280,
      padding: 12,
      borderRadius: 6,
      border: "1px solid var(--dpf-border)",
      opacity: active ? 1 : 0.5,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 8 }}>{title}</div>

      {providers.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
          No credentials configured.{" "}
          <Link href="/platform/ai/providers" style={{ color: "var(--dpf-accent)", textDecoration: "underline" }}>
            Set up in External Services
          </Link>
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {providers.map(p => {
            const isSubscription = SUBSCRIPTION_PROVIDERS.has(p.providerId);
            const isConfigured = p.status === "ok" || p.status === "configured" || p.status === "pending";
            return (
              <label
                key={p.providerId}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "6px 8px",
                  borderRadius: 4,
                  border: selectedId === p.providerId ? "1px solid var(--dpf-accent)" : "1px solid transparent",
                  cursor: canWrite && isConfigured ? "pointer" : "not-allowed",
                  opacity: isConfigured ? 1 : 0.5,
                }}
              >
                <input
                  type="radio"
                  name={`${title}-cred`}
                  value={p.providerId}
                  checked={selectedId === p.providerId}
                  onChange={() => onSelect(p.providerId)}
                  disabled={!canWrite || !isConfigured}
                  style={{ marginTop: 2 }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 500, color: "var(--dpf-text)" }}>{p.name}</span>
                    {isSubscription && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 5px",
                        borderRadius: 3,
                        background: "color-mix(in srgb, var(--dpf-success) 15%, transparent)",
                        color: "var(--dpf-success)",
                      }}>
                        Recommended
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <span style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: STATUS_COLORS[p.status] ?? "var(--dpf-muted)",
                      flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>
                      {p.providerId} · {STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.billingLabel && (
                    <div style={{ fontSize: 10, color: "var(--dpf-muted)", marginTop: 2 }}>{p.billingLabel}</div>
                  )}
                  {isSubscription && p.costNotes && (
                    <div style={{ fontSize: 10, color: "var(--dpf-success)", marginTop: 2 }}>{p.costNotes}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <Link href="/platform/ai/providers" style={{ fontSize: 10, color: "var(--dpf-accent)", textDecoration: "underline" }}>
          Manage credentials in External Services
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck** (page + form together)

```bash
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Commit** (page + form together)

```
feat(build-studio): add config page with provider/credential/model selection

New page at /platform/ai/build-studio shows:
- Active CLI provider radio (Claude Code / Codex / Agentic)
- Credential source per vendor (subscription vs API key)
- Model preferences per CLI
Config persists to PlatformConfig DB table.
```

---

## Task 7: Update Spec Doc Status

**Files:**
- Modify: `docs/superpowers/specs/2026-04-08-build-studio-config-design.md`

- [ ] **Step 1: Change spec status from Draft to Implemented**

Change line 4:
```
**Status:** Draft
```
To:
```
**Status:** Implemented
```

- [ ] **Step 2: Run all tests**

```bash
pnpm --filter web exec vitest run lib/integrate/build-studio-config.test.ts
pnpm --filter web exec vitest run lib/integrate/build-orchestrator.test.ts
pnpm --filter web exec tsc --noEmit
```

- [ ] **Step 3: Final commit and push**

```
feat(build-studio): complete Build Studio configuration tab

Adds /platform/ai/build-studio page for configuring CLI dispatch
provider, credential source (subscription vs API key), and model
preferences. Persisted to PlatformConfig DB — survives sandbox rebuilds.
Dispatchers read config at task time with env var fallback.
```

```bash
git push
```

---

## Task Dependency Graph

```
Task 1 (config reader) ──┬── Task 2 (server action) ──┐
                          └── Task 3 (wire dispatchers)─┤
Task 4 (tab nav) ──────────────────────────────────────┤
                                                        ├── Task 5+6 (page + form) ── Task 7 (finalize)
```

Task 1 must be done first (exports the type used by Tasks 2, 3, 5, 6). Tasks 2, 3, and 4 can run in parallel after Task 1. Tasks 5+6 depend on all of 1-4. Task 7 is last.
