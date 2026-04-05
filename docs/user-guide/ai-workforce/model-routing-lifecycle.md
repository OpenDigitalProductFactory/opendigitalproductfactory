---
title: "Model Routing & Lifecycle"
area: ai-workforce
order: 3
lastUpdated: 2026-03-30
updatedBy: Claude (Platform Engineer)
---

## How Models Enter the System

Models reach the routing pool through two paths: static seed data at install time, and dynamic discovery at runtime.

### Path 1: Static Seed (Install Time)

During container startup, `docker-entrypoint.sh` runs the following sequence:

```
[1/5] prisma migrate deploy           Schema and tables
[2/5] sync-provider-registry.ts       Providers from providers-registry.json
[3/5] seed.ts                         Agents, roles, model profiles, agent routing config
[4/5] detect-hardware.ts              Hardware profile for local AI
[5/5] source volume bootstrap          Sandbox workspace git init
```

**Step 2** syncs the provider registry from `packages/db/data/providers-registry.json`. This creates or updates `ModelProvider` rows with connection details, auth methods, pricing, and `modelRestrictions` (an allowlist of model ID patterns the provider credential can access). Provider status and credentials are preserved on re-sync.

**Step 3** seeds model profiles from `packages/db/data/model-profiles.json`. These are pre-evaluated profiles with hand-tuned dimension scores (codegen, reasoning, toolFidelity, etc.) and `profileSource: "evaluated"`. Only models known to work with the default credential tier are included. The seed also:
- Ensures Haiku 4.5 is set to `active` (Haiku 3.0 to `degraded`)
- Creates `AgentModelConfig` rows with default tier and budget settings for each agent
- Pins the `build-specialist` agent to `anthropic-sub/claude-haiku-4-5-20251001`

Pre-evaluated profiles are protected from being overwritten by dynamic discovery.

### Path 2: Dynamic Discovery (Runtime)

**Local models (automatic):** The local LLM provider (Docker Model Runner / Ollama) is checked on every page load of the AI Workforce providers page and during first-run bootstrap. If the provider is reachable, the platform calls its `/v1/models` endpoint, creates `DiscoveredModel` rows, and profiles them automatically using quality tier baselines from `FAMILY_TIERS`.

**Cloud providers (manual):** Cloud provider models are discovered when an admin clicks "Discover Models" on the provider detail form. This calls the provider's model list API (e.g., Anthropic `/v1/models`), creates discovery records, then profiles each model. Models that don't match the provider's `modelRestrictions` allowlist are automatically retired with the reason "Model not accessible with provider credential type."

There is currently no scheduled automatic discovery for cloud providers that support normal model listing APIs. If a provider releases a new model family, it will not appear until an admin manually triggers discovery.

Non-discoverable providers are handled differently. For providers such as Codex that cannot use `/v1/models`, the platform uses a curated known-model catalog plus a scheduled catalog reconciliation pass. The reconciler checks official provider documentation for candidate model IDs and deprecation signals, reseeds the runtime model catalog from the curated entries, and reports any new official candidates that are not yet approved for routing. Documentation makes a model a candidate; runtime probe and seeded metadata make it routable.

## Quality Tiers

Every model is assigned a quality tier based on its model ID prefix. The tier system replaces opaque 0-100 scores as the primary configuration surface for admins.

| Tier | Examples | Use Case |
|------|----------|----------|
| **Frontier** | Claude Opus 4.x, Claude Sonnet 4.x, GPT-5, o1/o3/o4 | Build Studio, complex code generation, multi-step tool orchestration |
| **Strong** | Claude Haiku 4.x, Gemini 2.5 Pro, GPT-4o | Admin tasks, compliance, finance, most agent work |
| **Adequate** | Claude 3 Haiku, Gemini 2.5 Flash, GPT-4o-mini | Basic conversation, simple queries |
| **Basic** | Llama, Phi, Qwen, Mistral, DeepSeek (local models) | Local-only, no cloud cost, limited capabilities |

Tier assignment uses longest-prefix matching against the model ID. For example, `claude-haiku-4-5-20251001` matches the prefix `claude-haiku-4` and is assigned the `strong` tier.

Each tier maps to baseline dimension scores and minimum thresholds:

| Tier | Baseline Scores | Minimum Thresholds (for agent config) |
|------|----------------|--------------------------------------|
| Frontier | codegen: 90, toolFidelity: 90, reasoning: 90 | codegen >= 85, toolFidelity >= 85, reasoning >= 85 |
| Strong | codegen: 75, toolFidelity: 75, reasoning: 75 | codegen >= 70, toolFidelity >= 70, reasoning >= 70 |
| Adequate | codegen: 55, toolFidelity: 55, reasoning: 55 | codegen >= 50, toolFidelity >= 50, reasoning >= 50 |
| Basic | codegen: 35, toolFidelity: 35, reasoning: 35 | No minimums |

Pre-evaluated profiles (from `model-profiles.json`) may have scores that differ from the tier baselines. These manually tuned scores are more accurate and are preserved across discovery cycles.

## Agent Model Configuration

Each agent has an `AgentModelConfig` row that controls which models it can use:

| Field | Purpose |
|-------|---------|
| `minimumTier` | The lowest quality tier the agent will accept (e.g., "frontier" for build-specialist) |
| `budgetClass` | Cost strategy: `minimize_cost`, `balanced`, or `quality_first` |
| `pinnedProviderId` | Force routing to a specific provider (optional) |
| `pinnedModelId` | Force routing to a specific model within that provider (optional) |

Default configurations are seeded during installation. Admins can override them via the platform UI or direct database updates. The seed respects existing rows -- if an admin has already configured an agent, the seed will not overwrite it.

### Default Agent Tiers

| Agent | Minimum Tier | Budget | Pinned To |
|-------|-------------|--------|-----------|
| build-specialist | frontier | quality_first | anthropic-sub / claude-haiku-4-5-20251001 |
| coo | strong | balanced | (auto) |
| platform-engineer | strong | balanced | (auto) |
| admin-assistant | strong | balanced | (auto) |
| ea-architect | adequate | balanced | (auto) |
| onboarding-coo | basic | minimize_cost | (auto) |

## How Routing Selects a Model

When an agent needs to call an LLM, the routing pipeline runs in this order:

1. **Load AgentModelConfig** for the agent. If a DB row exists, use its tier and budget. Otherwise, fall back to code defaults.
2. **Convert tier to minimum dimensions.** For example, `frontier` becomes `{ codegen: 85, toolFidelity: 85, reasoning: 85 }`.
3. **Load all endpoint manifests.** Query `ModelProfile` where `modelStatus` is `active` or `degraded`, joined with `ModelProvider` where `status` is `active` or `degraded`.
4. **Hard filter (V2 pipeline).** Exclude models that fail any of:
   - Status not active/degraded
   - Model class not `chat` or `reasoning`
   - Sensitivity clearance doesn't cover the request
   - Missing required capability (e.g., tool use)
   - Any dimension score below the minimum threshold
5. **Rank by cost-per-success.** Estimate success probability for each remaining model. With `quality_first` budget, rank by success probability alone. With `minimize_cost`, rank by cost efficiency.
6. **Apply provider pin override.** If the agent has a `pinnedProviderId`, swap the pinned provider to the front of the list (V2-selected model becomes first fallback).
7. **Dispatch with fallback chain.** Try the selected model. If it fails with an inference error, try the next model in the chain.

## How Routing Adapts Over Time

| Event | What Happens |
|-------|-------------|
| Admin connects a new provider | Provider goes `active`. Admin must click "Discover Models" to populate model profiles. |
| Admin clicks "Discover Models" | Calls provider's model list API, creates discovery records, profiles using quality tiers. |
| Model restricted by `modelRestrictions` | Profiling auto-retires it with reason "Model not accessible with provider credential type." |
| New model pulled into Docker Model Runner | Discovered automatically on next providers page load. |
| Model returns inference errors | Fallback chain tries the next model. After repeated failures, model status degrades to `retired`. |
| Model disappears from provider API | After 2+ discovery cycles without seeing it, model is retired. |
| Pre-evaluated profile re-profiled | Metadata is updated but dimension scores are NOT overwritten (`profileSource: "evaluated"` is protected). |
| Admin overrides AgentModelConfig | Takes effect immediately. Seed will not overwrite admin-configured rows on next restart. |

## Provider-Specific Notes

### Anthropic (OAuth Subscription)

The `anthropic-sub` provider uses OAuth authorization code flow. The subscription tier determines which models are accessible via the API:

- **Haiku models**: Generally available on all subscription tiers
- **Sonnet / Opus models**: Require Team or Enterprise subscription tiers for API access

The `modelRestrictions` field in `providers-registry.json` is set to `["claude-haiku-*", "claude-3-haiku-*"]` to reflect this. Models discovered outside this allowlist are automatically retired during profiling.

If you have a Team or Enterprise subscription with Sonnet/Opus API access, update the restrictions via the admin UI or directly in the database.

### ChatGPT (OpenAI Subscription)

The ChatGPT provider uses Server-Sent Events (SSE) for the Responses API. Known issue: some models (e.g., `gpt-5.4`) may return empty responses through the SSE adapter. The quality gate catches these and returns a fallback response. If you see "I wasn't able to help with that" messages consistently, check the portal logs for `[quality-gate] Response too short` entries.

### Docker Model Runner (Local)

Local models are automatically discovered and profiled. They are assigned the `basic` quality tier by default, which means they will only be selected for agents configured with `minimumTier: "basic"` (e.g., the onboarding assistant). To use local models more broadly, adjust agent tiers downward or improve local model dimension scores via profiling.

## Troubleshooting

**All coworker responses say "I wasn't able to help":**
- Check portal logs: `docker logs dpf-portal-1 | grep quality-gate`
- If you see `Response too short (0 chars)`, the selected model is returning empty responses
- Check which provider is being selected: `docker logs dpf-portal-1 | grep agentic-loop`
- Verify the provider has valid credentials and the model is accessible

**Agent uses wrong model:**
- Check `AgentModelConfig` in the database
- The `pinnedProviderId` / `pinnedModelId` override all other routing decisions
- If no pin is set, routing selects based on dimension scores and budget class

**Models missing after connecting a provider:**
- Discovery is manual for cloud providers. Go to AI Workforce > Providers > select the provider > click "Discover Models"
- After discovery, click "Profile Models" to assign quality tiers and dimension scores
- Models outside the provider's `modelRestrictions` allowlist will be automatically retired

**Local model not appearing:**
- Visit the AI Workforce providers page to trigger automatic discovery
- Verify Docker Model Runner is running: `docker ps | grep model-runner` or check the Ollama endpoint
- Check that the `ollama` provider status is `active` (not `unconfigured`)
