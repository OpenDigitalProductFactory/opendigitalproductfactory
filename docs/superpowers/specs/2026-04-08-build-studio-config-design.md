# Build Studio Configuration Tab

**Date:** 2026-04-08
**Status:** Implemented
**Author:** Mark Bodman + Claude
**Depends on:** Claude Code CLI Dispatch (2026-04-08-claude-code-cli-dispatch-design.md)

## Problem

Build Studio dispatches tasks to CLI agents (Codex, Claude Code) inside the sandbox container. The dispatch provider and auth credential are controlled by env vars, which get wiped every time the sandbox is rebuilt. There is no UI to configure which CLI runs builds or which credential (subscription vs API key) it uses.

Meanwhile, the External Services tab already manages provider credentials — including both subscription (OAuth) and API key entries for the same vendor. Build Studio needs to **consume** those configured credentials, not duplicate them.

## Key Insight: Subscription vs API Key Economics

Both Anthropic and OpenAI offer two billing models. The cost difference is dramatic for sustained build workloads:

| Vendor | Subscription (flat-rate) | API Key (per-token) | Ratio |
|--------|--------------------------|---------------------|-------|
| Anthropic | Max Plan: ~$100 / 5+ days | API: ~$100 / few hours | ~20x |
| OpenAI | ChatGPT Plus/Pro: flat-rate | API: per-token | ~5-10x |

The Build Studio config must make this cost difference visible and default to the economical option.

## Design

### Navigation

New tab in `AiTabNav`: **"Build Studio"** at `/platform/ai/build-studio`.

Position: after "External Services", before "Route Log" — it's a consumer of External Services and logically follows it.

### Page Layout

Three sections stacked vertically:

1. **Active CLI Provider** — which CLI runs builds
2. **Provider Assignments** — which credential each CLI uses
3. **Model Preferences** — model override per CLI

### Section 1: Active CLI Provider

Radio group. Only providers with at least one configured credential are selectable.

```
Build Dispatch Engine
Choose which CLI agent executes build tasks in the sandbox.

(*) Claude Code CLI
    Anthropic models · claude --bare -p --dangerously-skip-permissions
    
( ) Codex CLI
    OpenAI models · codex exec --dangerously-bypass-approvals-and-sandbox

( ) Agentic Loop (Legacy)
    Built-in tool-calling loop · No CLI required
```

Unconfigured providers show grayed out:

```
( ) Claude Code CLI                              [Not configured]
    No Anthropic credentials found. Set up in External Services >
```

### Section 2: Provider Assignments

For each CLI vendor, a card showing available credentials from External Services. Only credentials with status `"ok"` or `"configured"` appear as options.

**Claude Code card:**

```
Claude Code — Credential Source
Which Anthropic credential should builds use?

(*) Claude / Anthropic (OAuth Subscription)         [Recommended]
    anthropic-sub · Status: Connected
    Flat-rate Max Plan — ~$100 lasts 5+ days of builds
    
( ) Anthropic
    anthropic · Status: Configured  
    Per-token API billing — ~$100 lasts a few hours of builds

Manage credentials in External Services >
```

**Codex card:**

```
Codex — Credential Source
Which OpenAI credential should builds use?

(*) ChatGPT (OpenAI Subscription)                   [Recommended]
    chatgpt · Status: Connected
    Flat-rate ChatGPT plan
    
( ) OpenAI Codex
    codex · Status: Configured
    Per-token API billing

Manage credentials in External Services >
```

**Design rules:**
- Subscription options get the `[Recommended]` badge
- Cost callout text comes from the provider registry's `costPerformanceNotes` field
- Cards are always visible (both vendors shown) but only the active CLI's card is emphasized; the other is dimmed
- "Manage credentials" links to `/platform/ai/providers`
- If no credentials are configured for a vendor, the card shows an empty state with setup link

### Section 3: Model Preferences

Per-CLI model selection. Only shown for the active provider.

**Important:** The `anthropic-sub` provider in the registry has `modelRestrictions` limiting to Haiku-class for **LLM API routing**. These restrictions do NOT apply to Claude Code CLI dispatch — the CLI with a Max subscription can use Sonnet, Opus, and Haiku. Build Studio model selection is independent of the provider registry's `modelRestrictions` field.

**Claude Code:**
```
Model
( ) Haiku — fastest, cheapest
(*) Sonnet — best balance (recommended)
( ) Opus — most capable, slower
```

**Codex:**
```
Model
(*) Server default — assigned by ChatGPT backend
( ) Custom: [________] (e.g. o4-mini, gpt-5.4)
```

### Data Model

Stored in existing `PlatformConfig` table (no migration needed):

```json
{
  "key": "build-studio-dispatch",
  "value": {
    "provider": "claude",
    "claudeProviderId": "anthropic-sub",
    "codexProviderId": "chatgpt",
    "claudeModel": "sonnet",
    "codexModel": ""
  }
}
```

**Field definitions:**

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `provider` | `"claude" \| "codex" \| "agentic"` | `"codex"` | Which CLI runs builds |
| `claudeProviderId` | `string` | `"anthropic-sub"` | Which credential Claude Code uses |
| `codexProviderId` | `string` | `"chatgpt"` | Which credential Codex uses |
| `claudeModel` | `string` | `"sonnet"` | Claude Code model selection |
| `codexModel` | `string` | `""` | Codex model (empty = server default) |

### Credential Transition

The current `claude-dispatch.ts` uses a standalone credential entry with `providerId: "claude-code"` that is not backed by a provider registry entry. This design replaces it:

- `"claude-code"` credential → use `"anthropic-sub"` (OAuth) or `"anthropic"` (API key) from the registry
- `"codex"` credential → use `"chatgpt"` (subscription OAuth) or `"codex"` (API key) from the registry

Both `"chatgpt"` and `"codex"` store OAuth tokens in the same `CredentialEntry` fields (`cachedToken`, `refreshToken`, `tokenExpiresAt`). The `injectCodexAuth()` function works with either credential — it reads the same fields regardless of providerId.

No data migration is needed — the old `"claude-code"` credential row is simply no longer referenced once the Build Studio config points to the registry-backed provider IDs. It can be left in place or manually deleted.

### Dispatch Integration

The dispatchers read config from the database **at task time** (per-request, not module load), falling back to env vars for backward compatibility.

**Structural change:** The current `build-orchestrator.ts` resolves the provider as a module-level constant (`const CLI_DISPATCH_PROVIDER = resolveProvider()`). This must become an async call inside `dispatchSpecialist()` so that config changes take effect without restarting the server.

**New helper** in `apps/web/lib/integrate/build-studio-config.ts`:

```typescript
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

/** Resolve CLI dispatch provider from legacy env vars. */
function resolveProviderFromEnv(): "claude" | "codex" | "agentic" {
  const raw = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (raw === "claude") return "claude";
  if (raw === "false" || raw === "agentic") return "agentic";
  return "codex";
}

export async function getBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  // DB config takes precedence
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value) {
    return { ...DEFAULTS, ...(row.value as Partial<BuildStudioDispatchConfig>) };
  }
  // Fall back to env vars (backward compat)
  return {
    provider: resolveProviderFromEnv(),
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? DEFAULTS.claudeProviderId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? DEFAULTS.codexProviderId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
  };
}
```

**Changes to existing dispatch files:**

- `build-orchestrator.ts`:
  - Remove module-level `const CLI_DISPATCH_PROVIDER = resolveProvider()` and the `resolveProvider()` function
  - Import `getBuildStudioConfig` from `build-studio-config.ts`
  - In `dispatchSpecialist()`, call `const config = await getBuildStudioConfig()` and use `config.provider` to select the dispatch path
  - Pass `config.claudeModel` / `config.codexModel` to the dispatchers
- `claude-dispatch.ts`:
  - Accept `providerId` and `model` as parameters (passed from orchestrator) instead of reading env vars or hardcoding `"claude-code"`
  - Remove `CLAUDE_AUTH_MODE` env var — auth mode is implicit: `"anthropic-sub"` = OAuth, `"anthropic"` = API key
  - The `resolveClaudeAuth()` function determines OAuth vs API key based on which credential fields are populated on the resolved provider
- `codex-dispatch.ts`:
  - Accept `providerId` as a parameter instead of hardcoding `"codex"`

### Server Action

`apps/web/lib/actions/build-studio.ts`:

```typescript
"use server";
export async function saveBuildStudioConfig(config: BuildStudioDispatchConfig) {
  // Permission check: manage_provider_connections
  await prisma.platformConfig.upsert({
    where: { key: "build-studio-dispatch" },
    update: { value: config },
    create: { key: "build-studio-dispatch", value: config },
  });
}
```

### Credential Status Resolution

The page needs to know which providers have working credentials. Reuse existing data:

```typescript
// From @/lib/inference/ai-provider-data — already available (re-exported via @/lib/ai-provider-data)
import { getProviders } from "@/lib/inference/ai-provider-data";

const providers = await getProviders();  // returns ProviderWithCredential[]

// Filter to Anthropic and OpenAI credential entries
const claudeProviders = providers.filter(p =>
  ["anthropic", "anthropic-sub"].includes(p.provider.providerId)
);
const codexProviders = providers.filter(p =>
  ["codex", "chatgpt"].includes(p.provider.providerId)
);
```

Each provider entry has `p.credential?.status` (`"ok"`, `"configured"`, `"unconfigured"`, `"auth_failed"`). The Build Studio page renders status dots using the same `STATUS_COLORS` pattern as `ServiceRow`.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `apps/web/app/(shell)/platform/ai/build-studio/page.tsx` | **Create** | Build Studio config page (server component) |
| `apps/web/components/platform/BuildStudioConfig.tsx` | **Create** | Client form component (radio groups, save button) |
| `apps/web/lib/integrate/build-studio-config.ts` | **Create** | Config reader (`getBuildStudioConfig()`) |
| `apps/web/lib/actions/build-studio.ts` | **Create** | Server action to save config |
| `apps/web/components/platform/AiTabNav.tsx` | **Modify** | Add "Build Studio" tab |
| `apps/web/lib/integrate/build-orchestrator.ts` | **Modify** | Read config from DB instead of env var |
| `apps/web/lib/integrate/claude-dispatch.ts` | **Modify** | Read providerId + model from config |
| `apps/web/lib/integrate/codex-dispatch.ts` | **Modify** | Read providerId from config |

## Testing

1. **No config row** — verify dispatch falls back to env vars (backward compat)
2. **Save config** — verify `PlatformConfig` row is created/updated
3. **Switch provider** — save `"claude"`, trigger build, verify Claude Code CLI runs
4. **Switch credential** — save `claudeProviderId: "anthropic"`, verify API key is injected (not OAuth token)
5. **Credential status** — unconfigure a provider, verify Build Studio page shows it grayed out
6. **Sandbox rebuild** — destroy and recreate sandbox, verify config persists (it's in portal DB, not sandbox)

## Follow-up Work

### External Services Auth UX Cleanup

The External Services provider detail page has auth method confusion: some providers support multiple auth methods (API key + OAuth) but the UI doesn't clearly communicate which are configured, which to choose, or the cost implications. This is a separate task that would improve the upstream setup experience.

**Ready-to-paste prompt for a separate thread:**

```
Task: Clean up External Services auth method UX

Context:
The AI Workforce > External Services > Provider Detail page has a confusing auth
setup experience. Several providers support multiple auth methods (e.g. Codex
supports both API key and OAuth, Anthropic has separate entries for API vs
subscription), but the UI doesn't clearly guide users through:

1. Which auth methods are available for this provider
2. Which are currently configured (with status)
3. The cost implications of each method
4. That you can have BOTH configured simultaneously (for different use cases)

The provider registry already has `supportedAuthMethods` arrays and
`billingLabel`/`costPerformanceNotes` fields, but the ProviderDetailForm
shows a single auth method selector that doesn't surface this information well.

What to fix:
- Show all supported auth methods with their configuration status
- Add cost callouts (subscription vs per-token) where applicable
- Make it clear that multiple methods can be configured simultaneously
- The Build Studio config tab (just built) depends on this being clear,
  since it lets users pick which configured credential to use for builds

Reference files:
- apps/web/components/platform/ProviderDetailForm.tsx — main form to improve
- apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx — detail page
- packages/db/data/providers-registry.json — supportedAuthMethods, billingLabel
- apps/web/lib/ai-provider-types.ts — ProviderWithCredential type
- docs/superpowers/specs/2026-04-08-build-studio-config-design.md — downstream consumer

Rules:
- Read the existing components thoroughly first
- Don't change the data model — work with existing fields
- Match existing UI patterns (ServiceRow, ProviderDetailForm)
- Typecheck: pnpm --filter web exec tsc --noEmit
```

## Reference Files

- `apps/web/app/(shell)/platform/ai/providers/page.tsx` — External Services page (pattern reference)
- `apps/web/components/platform/ServiceRow.tsx` — Provider row component (UI patterns)
- `apps/web/components/platform/ProviderDetailForm.tsx` — Provider detail form
- `apps/web/components/platform/AiTabNav.tsx` — Tab navigation to modify
- `apps/web/lib/ai-provider-data.ts` — `getProviders()` data fetching
- `apps/web/lib/ai-provider-types.ts` — `ProviderWithCredential` type
- `packages/db/data/providers-registry.json` — Provider registry with auth methods and cost info
- `apps/web/lib/integrate/build-orchestrator.ts` — Orchestrator to update
- `apps/web/lib/integrate/claude-dispatch.ts` — Claude dispatcher to update
- `apps/web/lib/integrate/codex-dispatch.ts` — Codex dispatcher to update
