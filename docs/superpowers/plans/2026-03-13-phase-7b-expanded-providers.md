# Phase 7B: Expanded Provider Registry, OAuth & AI Model Profiles — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the AI provider registry from 6 to 17 providers (with category grouping), add OAuth2 client credentials auth, dynamic model discovery from provider APIs, and AI-generated plain-English model profiles.

**Architecture:** Prisma schema migration adds new fields to ModelProvider/CredentialEntry and two new tables (DiscoveredModel, ModelProfile). Server actions handle OAuth token exchange, model discovery, and AI profiling with cost-conscious provider fallback. Client components adapt to auth method and display model cards with friendly profiles.

**Tech Stack:** Next.js 14 App Router, Prisma 5, PostgreSQL, React cache(), server actions ("use server"), Vitest

**Spec:** `docs/superpowers/specs/2026-03-13-phase-7b-expanded-providers-design.md`

---

## File Structure

### Modified files
| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | Add new fields, drop `authEndpoint`, add DiscoveredModel + ModelProfile tables |
| `packages/db/data/providers-registry.json` | Expand from 6 to 17 providers with `category`, `baseUrl`, `authMethod`, `supportedAuthMethods` |
| `apps/web/lib/ai-provider-types.ts` | Updated types: `RegistryProviderEntry`, `ProviderRow`, `CredentialRow`; new types: `DiscoveredModelRow`, `ModelProfileRow` |
| `apps/web/lib/ai-provider-data.ts` | New fetchers: `getDiscoveredModels`, `getModelProfiles`; update `getProviders`/`getProviderById` for new fields |
| `apps/web/lib/actions/ai-providers.ts` | Refactor sync/configure/test for new fields; add `discoverModels`, `getProviderBearerToken`, `configureProvider` OAuth fields |
| `apps/web/lib/ai-providers.test.ts` | Add tests for parseModelsResponse, getTestUrl, OAuth helpers |
| `apps/web/components/platform/ProviderDetailForm.tsx` | Adaptive auth fields, auth method selector, models section |
| `apps/web/app/(shell)/platform/ai/page.tsx` | Category grouping (Direct Providers / Routers & Gateways) |
| `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx` | Pass discovered models + profiles to form |

### New files
| File | Responsibility |
|---|---|
| `apps/web/lib/ai-profiling.ts` | Profiling prompt, batch logic, provider selection/fallback, JSON parse with retry |
| `apps/web/lib/ai-profiling.test.ts` | Tests for profiling helpers (prompt building, response parsing, provider ranking) |
| `apps/web/components/platform/ModelCard.tsx` | Reusable card: profiled / unprofiled / failed / stale states |
| `apps/web/components/platform/ModelSection.tsx` | Client component: paginated model list with search, profile/refresh actions |

---

## Chunk 1: Schema, Registry & Types

### Task 1: Prisma Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

This migration does 4 things: (a) adds `category`, `baseUrl`, `authMethod`, `supportedAuthMethods` to ModelProvider and drops `authEndpoint`; (b) adds OAuth fields to CredentialEntry; (c) creates DiscoveredModel table; (d) creates ModelProfile table.

- [ ] **Step 1: Update ModelProvider model**

In `packages/db/prisma/schema.prisma`, update the `ModelProvider` model. Drop the `authEndpoint` field and add:

```prisma
model ModelProvider {
  id                   String   @id @default(cuid())
  providerId           String   @unique
  name                 String
  families             Json
  enabledFamilies      Json     @default("[]")
  status               String   @default("unconfigured")
  authHeader           String?
  endpoint             String?
  costModel            String   @default("token")
  inputPricePerMToken  Float?
  outputPricePerMToken Float?
  computeWatts         Float?
  electricityRateKwh   Float?
  category             String   @default("direct")
  baseUrl              String?
  authMethod           String   @default("api_key")
  supportedAuthMethods Json     @default("[\"api_key\"]")
  updatedAt            DateTime @updatedAt
}
```

Note: `authEndpoint` is removed. The migration SQL must `ALTER TABLE ... DROP COLUMN "authEndpoint"` and add the new columns.

- [ ] **Step 2: Update CredentialEntry model**

```prisma
model CredentialEntry {
  id             String    @id @default(cuid())
  providerId     String    @unique
  secretRef      String?
  clientId       String?
  clientSecret   String?
  tokenEndpoint  String?
  scope          String?
  cachedToken    String?
  tokenExpiresAt DateTime?
  status         String    @default("unconfigured")
  updatedAt      DateTime  @updatedAt
}
```

- [ ] **Step 3: Add DiscoveredModel model**

```prisma
model DiscoveredModel {
  id           String   @id @default(cuid())
  providerId   String
  modelId      String
  rawMetadata  Json
  discoveredAt DateTime @default(now())
  lastSeenAt   DateTime @updatedAt

  @@unique([providerId, modelId])
}
```

- [ ] **Step 4: Add ModelProfile model**

```prisma
model ModelProfile {
  id             String   @id @default(cuid())
  providerId     String
  modelId        String
  friendlyName   String
  summary        String
  capabilityTier String
  costTier       String
  bestFor        Json
  avoidFor       Json
  contextWindow  String?
  speedRating    String?
  generatedBy    String
  generatedAt    DateTime @default(now())

  @@unique([providerId, modelId])
}
```

- [ ] **Step 5: Run migration**

```bash
cd packages/db
npx prisma migrate dev --name expand_providers_oauth_models
npx prisma generate
```

Expected: Migration creates successfully, Prisma client regenerates with new types.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/
git commit -m "feat(db): expand ModelProvider/CredentialEntry, add DiscoveredModel + ModelProfile"
```

---

### Task 2: Expand providers-registry.json

**Files:**
- Modify: `packages/db/data/providers-registry.json`

Replace the existing 6-entry file with the full 17-entry registry. Each entry now includes `category`, `baseUrl`, `authMethod`, `supportedAuthMethods`. The `authEndpoint` field is removed.

- [ ] **Step 1: Write the new registry**

Replace `packages/db/data/providers-registry.json` with all 17 providers from the spec tables. For each entry:
- Copy `providerId`, `name`, `families`, `authHeader`, `costModel` (and optional pricing/compute fields)
- Add `category: "direct"` or `"router"`
- Add `baseUrl` (null for Azure, Bedrock, LiteLLM — they use custom endpoints)
- Add `authMethod` (default auth method)
- Add `supportedAuthMethods` array (e.g. `["api_key"]` for most, `["api_key", "oauth2_client_credentials"]` for Azure)
- Remove the old `authEndpoint` field

Provider list (see spec Section 1 tables for exact values):
1. anthropic, 2. openai, 3. azure-openai, 4. gemini, 5. bedrock, 6. ollama, 7. xai, 8. mistral, 9. cohere, 10. deepseek, 11. groq, 12. together, 13. fireworks, 14. openrouter, 15. litellm, 16. portkey, 17. martian

- [ ] **Step 2: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(db): expand provider registry to 17 providers with category/baseUrl/authMethod"
```

---

### Task 3: Update Types

**Files:**
- Modify: `apps/web/lib/ai-provider-types.ts`

Update existing types and add new ones per the spec Section 2 (Updated TypeScript types) and Section 3/4 (new model types).

- [ ] **Step 1: Write failing test for new type helper: `getTestUrl`**

In `apps/web/lib/ai-providers.test.ts`, add tests for a new `getTestUrl(provider)` pure function that constructs the correct auth test URL from provider config:

```typescript
// Test cases:
// 1. Standard provider with baseUrl → baseUrl + "/models"
// 2. Ollama → baseUrl + "/api/tags"
// 3. Provider with null baseUrl but endpoint → endpoint + "/models"
// 4. Provider with null baseUrl and null endpoint → null (cannot test)
```

- [ ] **Step 2: Run test, verify it fails** (function not defined yet)

- [ ] **Step 3: Update `ai-provider-types.ts`**

Update `RegistryProviderEntry`:
```typescript
export type RegistryProviderEntry = {
  providerId: string;
  name: string;
  families: string[];
  category: "direct" | "router";
  baseUrl: string | null;
  authMethod: "api_key" | "oauth2_client_credentials" | "none";
  supportedAuthMethods: string[];
  authHeader: string | null;
  costModel: string;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  computeWatts?: number;
  electricityRateKwh?: number;
};
```

Update `ProviderRow` — add `category`, `baseUrl`, `authMethod`, `supportedAuthMethods`.

Update `CredentialRow` — add `clientId`, `clientSecret`, `tokenEndpoint`, `scope`.

Add new types:
```typescript
export type DiscoveredModelRow = {
  id: string;
  providerId: string;
  modelId: string;
  rawMetadata: Record<string, unknown>;
  discoveredAt: Date;
  lastSeenAt: Date;
};

export type ModelProfileRow = {
  id: string;
  providerId: string;
  modelId: string;
  friendlyName: string;
  summary: string;
  capabilityTier: string;
  costTier: string;
  bestFor: string[];
  avoidFor: string[];
  contextWindow: string | null;
  speedRating: string | null;
  generatedBy: string;
  generatedAt: Date;
};
```

Add `getTestUrl` pure function:
```typescript
export function getTestUrl(provider: Pick<ProviderRow, "providerId" | "baseUrl" | "endpoint">): string | null {
  const base = provider.baseUrl ?? provider.endpoint;
  if (!base) return null;
  if (provider.providerId === "ollama") return `${base}/api/tags`;
  return `${base}/models`;
}
```

- [ ] **Step 4: Run tests, verify `getTestUrl` tests pass**

```bash
cd apps/web && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts apps/web/lib/ai-providers.test.ts
git commit -m "feat(web): update types for Phase 7B, add getTestUrl helper"
```

---

### Task 4: Update Sync Logic

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/ai-provider-data.ts`

Update `syncProviderRegistry` to handle new fields. Update data fetchers for new ProviderRow shape.

- [ ] **Step 1: Update `syncProviderRegistry` in `ai-providers.ts`**

In the **create** branch, include new fields:
```typescript
category:             entry.category,
baseUrl:              entry.baseUrl ?? null,
authMethod:           entry.authMethod,
supportedAuthMethods: entry.supportedAuthMethods,
```

In the **update** branch, overwrite `category`, `baseUrl`, `supportedAuthMethods` but NOT `authMethod`:
```typescript
data: {
  name:                 entry.name,
  families:             entry.families,
  authHeader:           entry.authHeader ?? null,
  costModel:            entry.costModel,
  category:             entry.category,
  baseUrl:              entry.baseUrl ?? null,
  supportedAuthMethods: entry.supportedAuthMethods,
  // authMethod, status, enabledFamilies, endpoint NOT overwritten
  ...(entry.inputPricePerMToken !== undefined  && { inputPricePerMToken:  entry.inputPricePerMToken }),
  ...(entry.outputPricePerMToken !== undefined && { outputPricePerMToken: entry.outputPricePerMToken }),
  ...(entry.computeWatts !== undefined         && { computeWatts:         entry.computeWatts }),
  ...(entry.electricityRateKwh !== undefined   && { electricityRateKwh:   entry.electricityRateKwh }),
},
```

Remove all references to `authEndpoint` (the old field that was dropped).

- [ ] **Step 2: Update `getProviders` and `getProviderById` in `ai-provider-data.ts`**

The `satisfies ProviderRow` assertions need updating since `ProviderRow` now has `category`, `baseUrl`, `authMethod`, `supportedAuthMethods`. The Prisma `findMany`/`findUnique` results already include these columns after the migration, so the spread `...p` includes them. The JSON fields (`supportedAuthMethods`) need casting like `families`:

```typescript
provider: {
  ...p,
  families:             p.families as string[],
  enabledFamilies:      p.enabledFamilies as string[],
  supportedAuthMethods: p.supportedAuthMethods as string[],
} satisfies ProviderRow,
```

The `credential` mapping also needs updating for new `CredentialRow` shape (the extra nullable fields come through from Prisma automatically).

- [ ] **Step 3: Verify app compiles**

```bash
cd apps/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts apps/web/lib/ai-provider-data.ts
git commit -m "feat(web): update sync logic and data fetchers for expanded registry"
```

---

### Task 5: Update UI for Category Grouping

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/page.tsx`

- [ ] **Step 1: Group providers by category**

In the page component, split providers into two groups after the `Promise.all` fetch:

```typescript
const directProviders = providers.filter((pw) => pw.provider.category === "direct");
const routerProviders = providers.filter((pw) => pw.provider.category === "router");
```

- [ ] **Step 2: Render two sections**

Replace the single grid with two sections:
- "Direct Providers" heading + grid of `directProviders`
- "Routers & Gateways" heading + grid of `routerProviders`

Each section keeps the existing card layout. If a section is empty, show nothing (don't render the heading).

Update the provider count subtitle: `{providers.length} provider{providers.length !== 1 ? "s" : ""} registered ({directProviders.length} direct, ${routerProviders.length} routers)`

- [ ] **Step 3: Verify page renders in browser**

Navigate to `http://localhost:3000/platform/ai`. Should see two sections with providers grouped.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\(shell\)/platform/ai/page.tsx
git commit -m "feat(web): group providers by category on /platform/ai page"
```

---

## Chunk 2: OAuth & Auth Refactor

### Task 6: OAuth Token Exchange

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Write `getProviderBearerToken` function**

Add to `ai-providers.ts` (NOT exported — internal helper for `testProviderAuth`):

```typescript
async function getProviderBearerToken(providerId: string): Promise<{ token: string } | { error: string }> {
  const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!credential) return { error: "No credential configured" };
  if (!credential.clientId || !credential.clientSecret || !credential.tokenEndpoint) {
    return { error: "OAuth credentials incomplete — need client ID, secret, and token endpoint" };
  }

  // Return cached token if still valid (5-minute buffer)
  if (credential.cachedToken && credential.tokenExpiresAt) {
    const buffer = 5 * 60 * 1000;
    if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
      return { token: credential.cachedToken };
    }
  }

  // Exchange for new token
  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: credential.clientId,
    client_secret: credential.clientSecret,
    ...(credential.scope ? { scope: credential.scope } : {}),
  });

  try {
    const res = await fetch(credential.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { error: `Token exchange failed: HTTP ${res.status}` };

    const body = await res.json() as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    await prisma.credentialEntry.update({
      where: { providerId },
      data: { cachedToken: body.access_token, tokenExpiresAt: expiresAt, status: "ok" },
    });

    return { token: body.access_token };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Token exchange error" };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(web): add OAuth2 client credentials token exchange"
```

---

### Task 7: Refactor `testProviderAuth`

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

Replace the existing `testProviderAuth` to use `authMethod` discriminator and `getTestUrl`.

- [ ] **Step 1: Rewrite `testProviderAuth`**

Import `getTestUrl` from `ai-provider-types`. Rewrite the function:

```typescript
export async function testProviderAuth(providerId: string): Promise<{ ok: boolean; message: string }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { ok: false, message: "Provider not found" };

  const providerRow = {
    ...provider,
    families: provider.families as string[],
    enabledFamilies: provider.enabledFamilies as string[],
    supportedAuthMethods: provider.supportedAuthMethods as string[],
  };

  const testUrl = getTestUrl(providerRow);
  if (!testUrl) return { ok: false, message: "No base URL or custom endpoint configured" };

  const headers: Record<string, string> = {};

  if (provider.authMethod === "api_key") {
    const credential = await prisma.credentialEntry.findUnique({ where: { providerId } });
    if (!credential?.secretRef) return { ok: false, message: "No API key configured" };
    if (provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${credential.secretRef}`
        : credential.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
  // authMethod === "none" → no headers needed

  try {
    const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(8_000) });
    if (res.ok) {
      await prisma.modelProvider.update({ where: { providerId }, data: { status: "active" } });
      return { ok: true, message: `Connected — HTTP ${res.status}` };
    }
    return { ok: false, message: `HTTP ${res.status} — ${res.statusText}` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Network error" };
  }
}
```

- [ ] **Step 2: Verify existing OpenAI connection still works**

Navigate to provider detail, click Test Connection on a previously configured provider.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "refactor(web): testProviderAuth uses authMethod + getTestUrl"
```

---

### Task 8: Update `configureProvider` for OAuth

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Expand `configureProvider` input and logic**

Update the function signature per the spec (Section 2, Updated `configureProvider` input). The credential upsert needs to handle both API key and OAuth fields. If `authMethod` is provided, update it on the ModelProvider.

```typescript
export async function configureProvider(input: {
  providerId: string;
  enabledFamilies: string[];
  authMethod?: string;
  secretRef?: string;
  clientId?: string;
  clientSecret?: string;
  tokenEndpoint?: string;
  scope?: string;
  endpoint?: string;
  computeWatts?: number;
  electricityRateKwh?: number;
}): Promise<{ error?: string }> {
  await requireManageProviders();

  // Validate OAuth fields: if any OAuth field is provided, require the essential ones
  const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
  if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
    return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
  }

  // Upsert credential with whatever fields are provided
  const hasCredentialFields = input.secretRef !== undefined
    || input.clientId !== undefined
    || input.clientSecret !== undefined
    || input.tokenEndpoint !== undefined
    || input.scope !== undefined;

  if (hasCredentialFields) {
    await prisma.credentialEntry.upsert({
      where: { providerId: input.providerId },
      create: {
        providerId: input.providerId,
        ...(input.secretRef !== undefined      && { secretRef: input.secretRef }),
        ...(input.clientId !== undefined       && { clientId: input.clientId }),
        ...(input.clientSecret !== undefined   && { clientSecret: input.clientSecret }),
        ...(input.tokenEndpoint !== undefined  && { tokenEndpoint: input.tokenEndpoint }),
        ...(input.scope !== undefined          && { scope: input.scope }),
        status: "pending",
      },
      update: {
        ...(input.secretRef !== undefined      && { secretRef: input.secretRef }),
        ...(input.clientId !== undefined       && { clientId: input.clientId }),
        ...(input.clientSecret !== undefined   && { clientSecret: input.clientSecret }),
        ...(input.tokenEndpoint !== undefined  && { tokenEndpoint: input.tokenEndpoint }),
        ...(input.scope !== undefined          && { scope: input.scope }),
        status: "pending",
      },
    });
  }

  await prisma.modelProvider.update({
    where: { providerId: input.providerId },
    data: {
      enabledFamilies: input.enabledFamilies,
      ...(input.authMethod !== undefined       && { authMethod: input.authMethod }),
      ...(input.endpoint !== undefined         && { endpoint: input.endpoint }),
      ...(input.computeWatts !== undefined     && { computeWatts: input.computeWatts }),
      ...(input.electricityRateKwh !== undefined && { electricityRateKwh: input.electricityRateKwh }),
    },
  });

  return {};
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(web): configureProvider supports OAuth fields and authMethod switching"
```

---

### Task 9: Update ProviderDetailForm

**Files:**
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`

The form must switch from `authHeader !== null` discriminator to `provider.authMethod` and render different fields per auth method.

- [ ] **Step 1: Refactor discriminators**

Replace:
```typescript
const isKeyed      = provider.authHeader !== null;
const needsEndpoint = provider.authEndpoint === null;
```
With:
```typescript
const needsCredential = provider.authMethod !== "none";
const isOAuth         = provider.authMethod === "oauth2_client_credentials";
const isApiKey        = provider.authMethod === "api_key";
const needsEndpoint   = provider.baseUrl === null;
const hasDualAuth     = provider.supportedAuthMethods.length > 1;
```

- [ ] **Step 2: Add OAuth state fields**

```typescript
const [clientId, setClientId]           = useState(credential?.clientId ?? "");
const [clientSecret, setClientSecret]   = useState(credential?.clientSecret ?? "");
const [tokenEndpoint, setTokenEndpoint] = useState(credential?.tokenEndpoint ?? "");
const [scope, setScope]                 = useState(credential?.scope ?? "");
const [selectedAuthMethod, setSelectedAuthMethod] = useState(provider.authMethod);
```

- [ ] **Step 3: Add auth method selector (for dual-auth providers)**

When `hasDualAuth`, render a dropdown above the credential fields:

```tsx
{hasDualAuth && (
  <div style={{ marginBottom: 16 }}>
    <label style={{ display: "block", color: "#555566", fontSize: 10, marginBottom: 4 }}>
      Authentication method
    </label>
    <select
      value={selectedAuthMethod}
      onChange={(e) => setSelectedAuthMethod(e.target.value)}
      disabled={!canWrite || isPending}
      style={{ background: "#1a1a2e", border: "1px solid #2a2a40", color: "#e0e0ff", fontSize: 11, padding: "6px 8px", borderRadius: 4 }}
    >
      {provider.supportedAuthMethods.map((m) => (
        <option key={m} value={m}>{m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : "None"}</option>
      ))}
    </select>
  </div>
)}
```

- [ ] **Step 4: Conditional credential fields**

Replace the existing API key input section. Use `selectedAuthMethod` (not `provider.authMethod`) so switching takes effect before save:

- If `selectedAuthMethod === "api_key"`: show API Key input (update label from "Environment variable name" to "API Key", remove the "env var" help text)
- If `selectedAuthMethod === "oauth2_client_credentials"`: show Client ID, Client Secret, Token Endpoint, Scope inputs
- If `selectedAuthMethod === "none"`: show nothing

- [ ] **Step 5: Update `handleSave` to pass new fields**

```typescript
const saveInput = {
  providerId: provider.providerId,
  enabledFamilies,
  ...(hasDualAuth && { authMethod: selectedAuthMethod }),
  ...(selectedAuthMethod === "api_key" && secretRef ? { secretRef } : {}),
  ...(selectedAuthMethod === "oauth2_client_credentials" ? {
    clientId: clientId || undefined,
    clientSecret: clientSecret || undefined,
    tokenEndpoint: tokenEndpoint || undefined,
    scope: scope || undefined,
  } : {}),
  ...(needsEndpoint && endpoint ? { endpoint } : {}),
  ...(isCompute ? { computeWatts: Number(computeWatts), electricityRateKwh: Number(electricityRate) } : {}),
};
```

- [ ] **Step 6: Verify in browser**

Test with an api_key provider (OpenAI) and visually check the form renders correctly.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/platform/ProviderDetailForm.tsx
git commit -m "feat(web): ProviderDetailForm adapts to authMethod (API key, OAuth, none)"
```

---

## Chunk 3: Model Discovery

### Task 10: Model Discovery Action

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`
- Modify: `apps/web/lib/ai-providers.test.ts`

- [ ] **Step 1: Write failing tests for `parseModelsResponse`**

In `ai-providers.test.ts`, test the pure parsing function:

```typescript
// Test: OpenAI-compatible format → { data: [{ id: "gpt-4o" }] } → [{ modelId: "gpt-4o", rawMetadata: { id: "gpt-4o" } }]
// Test: Ollama format → { models: [{ name: "llama3" }] } → [{ modelId: "llama3", rawMetadata: { name: "llama3" } }]
// Test: Cohere format → { models: [{ name: "command-r-plus" }] } → [{ modelId: "command-r-plus", rawMetadata: { name: "command-r-plus" } }]
// Test: empty response → []
// Test: missing data key → []
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Write `parseModelsResponse` in `ai-provider-types.ts`**

Export from `ai-provider-types.ts` (it's a pure function, no server action):

```typescript
export function parseModelsResponse(
  providerId: string,
  json: unknown,
): { modelId: string; rawMetadata: Record<string, unknown> }[] {
  if (typeof json !== "object" || json === null) return [];

  // Ollama + Cohere: { models: [...] }
  if (providerId === "ollama" || providerId === "cohere") {
    const obj = json as { models?: { name?: string }[] };
    return (obj.models ?? [])
      .filter((m) => typeof m.name === "string")
      .map((m) => ({ modelId: m.name as string, rawMetadata: m as Record<string, unknown> }));
  }

  // OpenAI-compatible: { data: [...] }
  const obj = json as { data?: { id?: string }[] };
  return (obj.data ?? [])
    .filter((m) => typeof m.id === "string")
    .map((m) => ({ modelId: m.id as string, rawMetadata: m as Record<string, unknown> }));
}
```

- [ ] **Step 4: Run tests, verify they pass**

- [ ] **Step 5: Write `discoverModels` server action**

In `ai-providers.ts`:

```typescript
export async function discoverModels(providerId: string): Promise<{ discovered: number; newCount: number; error?: string }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { discovered: 0, newCount: 0, error: "Provider not found" };

  const providerRow = {
    ...provider,
    families: provider.families as string[],
    enabledFamilies: provider.enabledFamilies as string[],
    supportedAuthMethods: provider.supportedAuthMethods as string[],
  };

  const testUrl = getTestUrl(providerRow);
  if (!testUrl) return { discovered: 0, newCount: 0, error: "No base URL configured" };

  // Build auth headers (same logic as testProviderAuth)
  const headers: Record<string, string> = {};
  if (provider.authMethod === "api_key") {
    const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
    if (cred?.secretRef && provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${cred.secretRef}` : cred.secretRef;
    }
  } else if (provider.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }

  let json: unknown;
  try {
    const res = await fetch(testUrl, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return { discovered: 0, newCount: 0, error: `HTTP ${res.status}` };
    json = await res.json();
  } catch (err) {
    return { discovered: 0, newCount: 0, error: err instanceof Error ? err.message : "Fetch error" };
  }

  const models = parseModelsResponse(providerId, json);
  let newCount = 0;

  for (const m of models) {
    const existing = await prisma.discoveredModel.findUnique({
      where: { providerId_modelId: { providerId, modelId: m.modelId } },
    });
    if (existing) {
      await prisma.discoveredModel.update({
        where: { id: existing.id },
        data: { rawMetadata: m.rawMetadata },
      });
    } else {
      await prisma.discoveredModel.create({
        data: { providerId, modelId: m.modelId, rawMetadata: m.rawMetadata },
      });
      newCount++;
    }
  }

  return { discovered: models.length, newCount };
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts apps/web/lib/ai-providers.test.ts apps/web/lib/actions/ai-providers.ts
git commit -m "feat(web): add model discovery action with provider-specific parsing"
```

---

### Task 11: Model Data Fetchers

**Files:**
- Modify: `apps/web/lib/ai-provider-data.ts`

- [ ] **Step 1: Add `getDiscoveredModels` and `getModelProfiles` fetchers**

```typescript
export const getDiscoveredModels = cache(async (providerId: string): Promise<DiscoveredModelRow[]> => {
  const models = await prisma.discoveredModel.findMany({
    where: { providerId },
    orderBy: { modelId: "asc" },
  });
  return models.map((m) => ({
    ...m,
    rawMetadata: m.rawMetadata as Record<string, unknown>,
  }));
});

export const getModelProfiles = cache(async (providerId: string): Promise<ModelProfileRow[]> => {
  const profiles = await prisma.modelProfile.findMany({
    where: { providerId },
    orderBy: { modelId: "asc" },
  });
  return profiles.map((p) => ({
    ...p,
    bestFor: p.bestFor as string[],
    avoidFor: p.avoidFor as string[],
  }));
});
```

Import the new types at the top of the file.

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/ai-provider-data.ts
git commit -m "feat(web): add getDiscoveredModels and getModelProfiles data fetchers"
```

---

### Task 12: Integrate Discovery into Provider Detail Page

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`

- [ ] **Step 1: Fetch models and profiles in the provider detail page**

Update the page to call `getDiscoveredModels` and `getModelProfiles`, pass them to the form:

```typescript
const [pw, models, profiles] = await Promise.all([
  getProviderById(providerId),
  getDiscoveredModels(providerId),
  getModelProfiles(providerId),
]);
```

Pass `models` and `profiles` as props to `ProviderDetailForm`.

- [ ] **Step 2: Add "Refresh Models" button and model count to ProviderDetailForm**

Below the Save/Test buttons, add a "Refresh Models" button (only shown when provider status is "active"):

```tsx
{provider.status === "active" && canWrite && (
  <button onClick={handleRefreshModels} disabled={isPending} style={...}>
    Refresh Models
  </button>
)}
```

The `handleRefreshModels` calls `discoverModels(provider.providerId)` and shows the result count.

- [ ] **Step 3: Auto-discover after successful test**

In the `handleTest` function, if `result.ok`, also call `discoverModels`:

```typescript
if (result.ok) {
  const discovery = await discoverModels(provider.providerId);
  setDiscoveryResult(discovery);
}
```

- [ ] **Step 4: Show model count below connection buttons**

```tsx
{models.length > 0 && (
  <p style={{ color: "#555566", fontSize: 10, marginTop: 8 }}>
    {models.length} model{models.length !== 1 ? "s" : ""} discovered
  </p>
)}
```

- [ ] **Step 5: Verify in browser**

Test Connection on OpenAI → should discover models and show count.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/\(shell\)/platform/ai/providers/\[providerId\]/page.tsx apps/web/components/platform/ProviderDetailForm.tsx
git commit -m "feat(web): integrate model discovery into provider detail page"
```

---

## Chunk 4: AI Profiling & Model Cards

### Task 13: AI Profiling Logic

**Files:**
- Create: `apps/web/lib/ai-profiling.ts`
- Create: `apps/web/lib/ai-profiling.test.ts`

- [ ] **Step 1: Write failing tests for profiling helpers**

In `ai-profiling.test.ts`:

```typescript
// Test: rankProvidersByCost — ranks active providers by outputPricePerMToken ascending, nulls last
// Test: buildProfilingPrompt — given model entries, returns expected prompt string
// Test: parseProfilingResponse — given valid JSON array, returns ModelProfile-shaped objects
// Test: parseProfilingResponse — given malformed JSON, returns empty array
// Test: parseProfilingResponse — given partial response (some valid, some not), returns only valid entries
```

- [ ] **Step 2: Run tests, verify they fail**

- [ ] **Step 3: Write `ai-profiling.ts`**

```typescript
// apps/web/lib/ai-profiling.ts
import type { ProviderRow, ModelProfileRow } from "./ai-provider-types";

export function rankProvidersByCost(
  providers: Pick<ProviderRow, "providerId" | "status" | "outputPricePerMToken">[],
): string[] {
  return providers
    .filter((p) => p.status === "active")
    .sort((a, b) => (a.outputPricePerMToken ?? Infinity) - (b.outputPricePerMToken ?? Infinity))
    .map((p) => p.providerId);
}

export function buildProfilingPrompt(
  models: { modelId: string; providerName: string; rawMetadata: Record<string, unknown> }[],
): string {
  return `You are helping non-technical business users understand AI models.

For each model below, produce a JSON array of profiles. Each profile has:
- friendlyName: a memorable 2-3 word name (e.g. "Deep Thinker", "Fast Worker", "Budget Helper")
- summary: one plain-English sentence describing what it's best at
- capabilityTier: one of "deep-thinker", "fast-worker", "specialist", "budget", "embedding"
- costTier: one of "$", "$$", "$$$", "$$$$"
- bestFor: array of 3-5 use cases in plain English
- avoidFor: array of 2-3 anti-patterns in plain English
- contextWindow: human-friendly string like "Large (200K tokens)" or "Standard (8K tokens)" or null if unknown
- speedRating: "Fast", "Moderate", or "Slow" (or null if unknown)
- modelId: the exact model ID string

Use language a non-technical manager would understand. No jargon. No marketing language.

Respond ONLY with a valid JSON array. No markdown, no explanation.

Models to profile:
${JSON.stringify(models.map((m) => ({ modelId: m.modelId, provider: m.providerName, metadata: m.rawMetadata })), null, 2)}`;
}

type ProfileResult = {
  modelId: string;
  friendlyName: string;
  summary: string;
  capabilityTier: string;
  costTier: string;
  bestFor: string[];
  avoidFor: string[];
  contextWindow: string | null;
  speedRating: string | null;
};

export function parseProfilingResponse(text: string): ProfileResult[] {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  return parsed.filter((item): item is ProfileResult =>
    typeof item === "object" && item !== null
    && typeof item.modelId === "string"
    && typeof item.friendlyName === "string"
    && typeof item.summary === "string"
  );
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd apps/web && pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/ai-profiling.ts apps/web/lib/ai-profiling.test.ts
git commit -m "feat(web): add AI profiling helpers (prompt, parse, provider ranking)"
```

---

### Task 14: Profile Models Server Action

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Add `profileModels` server action**

```typescript
export async function profileModels(
  providerId: string,
  modelIds?: string[],
): Promise<{ profiled: number; failed: number; error?: string }> {
  await requireManageProviders();

  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { profiled: 0, failed: 0, error: "Provider not found" };

  // Get models to profile
  const whereClause = modelIds
    ? { providerId, modelId: { in: modelIds } }
    : { providerId };
  const models = await prisma.discoveredModel.findMany({ where: whereClause });
  if (models.length === 0) return { profiled: 0, failed: 0, error: "No models to profile" };

  // Find cheapest active provider to do the profiling
  const allProviders = await prisma.modelProvider.findMany({
    select: { providerId: true, status: true, outputPricePerMToken: true, authMethod: true, authHeader: true, baseUrl: true, endpoint: true },
  });
  const ranked = rankProvidersByCost(allProviders as ProviderRow[]);
  if (ranked.length === 0) return { profiled: 0, failed: 0, error: "No active AI provider available for profiling" };

  // Build prompt
  const modelEntries = models.map((m) => ({
    modelId: m.modelId,
    providerName: provider.name,
    rawMetadata: m.rawMetadata as Record<string, unknown>,
  }));

  // Batch in groups of 20
  let totalProfiled = 0;
  let totalFailed = 0;

  for (let i = 0; i < modelEntries.length; i += 20) {
    const batch = modelEntries.slice(i, i + 20);
    const prompt = buildProfilingPrompt(batch);

    let profiles: ProfileResult[] = [];
    let usedProviderId: string | null = null;

    // Try each provider in cost order
    for (const candidateId of ranked) {
      try {
        const result = await callProviderForProfiling(candidateId, prompt);
        profiles = parseProfilingResponse(result.text);
        usedProviderId = candidateId;

        // Log token usage (success)
        await logTokenUsage({
          agentId: "system:model-profiler",
          providerId: candidateId,
          contextKey: `profile-${providerId}-batch-${i}`,
          inputTokens: result.inputTokens ?? 0,
          outputTokens: result.outputTokens ?? 0,
        });

        if (profiles.length > 0) break; // Success
      } catch (err) {
        // Log failed attempt for cost tracking
        await logTokenUsage({
          agentId: "system:model-profiler",
          providerId: candidateId,
          contextKey: `profile-${providerId}-batch-${i}-failed`,
          inputTokens: 0,
          outputTokens: 0,
        }).catch(() => {}); // Don't let logging failure block fallback
        continue; // Try next provider
      }
    }

    // Save successful profiles
    for (const profile of profiles) {
      await prisma.modelProfile.upsert({
        where: { providerId_modelId: { providerId, modelId: profile.modelId } },
        create: {
          providerId,
          modelId: profile.modelId,
          friendlyName: profile.friendlyName,
          summary: profile.summary,
          capabilityTier: profile.capabilityTier,
          costTier: profile.costTier,
          bestFor: profile.bestFor,
          avoidFor: profile.avoidFor,
          contextWindow: profile.contextWindow ?? null,
          speedRating: profile.speedRating ?? null,
          generatedBy: usedProviderId ?? "unknown",
        },
        update: {
          friendlyName: profile.friendlyName,
          summary: profile.summary,
          capabilityTier: profile.capabilityTier,
          costTier: profile.costTier,
          bestFor: profile.bestFor,
          avoidFor: profile.avoidFor,
          contextWindow: profile.contextWindow ?? null,
          speedRating: profile.speedRating ?? null,
          generatedBy: usedProviderId ?? "unknown",
          generatedAt: new Date(),
        },
      });
      totalProfiled++;
    }

    const profiledIds = new Set(profiles.map((p) => p.modelId));
    totalFailed += batch.filter((b) => !profiledIds.has(b.modelId)).length;
  }

  return { profiled: totalProfiled, failed: totalFailed };
}
```

- [ ] **Step 2: Add `callProviderForProfiling` internal helper**

This function calls a provider's chat completions endpoint with the profiling prompt and returns the response text + token counts. It uses the provider's credentials from the database:

```typescript
async function callProviderForProfiling(
  profilingProviderId: string,
  prompt: string,
): Promise<{ text: string; inputTokens?: number; outputTokens?: number }> {
  const prov = await prisma.modelProvider.findUnique({ where: { providerId: profilingProviderId } });
  if (!prov) throw new Error("Provider not found");

  const baseUrl = prov.baseUrl ?? prov.endpoint;
  if (!baseUrl) throw new Error("No base URL");

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (prov.authMethod === "api_key") {
    const cred = await prisma.credentialEntry.findUnique({ where: { providerId: profilingProviderId } });
    if (!cred?.secretRef || !prov.authHeader) throw new Error("No credential");
    headers[prov.authHeader] = prov.authHeader === "Authorization"
      ? `Bearer ${cred.secretRef}` : cred.secretRef;
  } else if (prov.authMethod === "oauth2_client_credentials") {
    const tokenResult = await getProviderBearerToken(profilingProviderId);
    if ("error" in tokenResult) throw new Error(tokenResult.error);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }

  // Use the provider's chat completions endpoint
  // Anthropic uses /messages; Cohere uses /chat; all others use OpenAI-compatible /chat/completions
  const chatUrl = profilingProviderId === "anthropic"
    ? `${baseUrl}/messages`
    : profilingProviderId === "cohere"
    ? `${baseUrl}/chat`
    : `${baseUrl}/chat/completions`;

  // Each provider has a slightly different request shape
  const body = profilingProviderId === "anthropic"
    ? { model: "claude-haiku-4-5-20251001", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }
    : profilingProviderId === "cohere"
    ? { model: "command-r", message: prompt, max_tokens: 4096 }
    : { model: "auto", messages: [{ role: "user", content: prompt }], max_tokens: 4096 };

  const res = await fetch(chatUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Normalize response across providers
  const text = profilingProviderId === "anthropic"
    ? data.content?.[0]?.text ?? ""
    : profilingProviderId === "cohere"
    ? data.text ?? ""
    : data.choices?.[0]?.message?.content ?? "";

  return {
    text,
    inputTokens: data.usage?.input_tokens ?? data.usage?.prompt_tokens,
    outputTokens: data.usage?.output_tokens ?? data.usage?.completion_tokens,
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(web): add profileModels server action with provider fallback"
```

---

### Task 15: ModelCard Component

**Files:**
- Create: `apps/web/components/platform/ModelCard.tsx`

- [ ] **Step 1: Create the component**

Client component that renders one of four states: profiled, unprofiled, failed, or stale.

Props: `{ model: DiscoveredModelRow; profile: ModelProfileRow | null; isStale: boolean; profilingFailed: boolean; canWrite: boolean; hasActiveProvider: boolean; onProfile: (modelId: string) => void }`

State semantics (determined by parent `ModelSection`):
- **Profiled:** `profile !== null` → show friendly profile
- **Unprofiled:** `profile === null && !profilingFailed` → never attempted
- **Failed:** `profile === null && profilingFailed` → profiling was attempted but returned no result for this model. The parent tracks this by comparing discovered modelIds against profiled modelIds after a profiling run; models in the batch that got no `ModelProfile` row are considered failed.
- **Stale:** `isStale` flag (set by parent when `model.lastSeenAt < latestDiscovery`)

The card displays:
- **Profiled:** friendlyName, summary, bestFor/avoidFor chips, cost/speed/context badges, [Re-profile] button
- **Unprofiled:** raw modelId, "Not yet profiled" label, [Profile Now] button (disabled if `!hasActiveProvider`, with tooltip)
- **Failed:** raw modelId, "Profiling failed" label, [Re-profile] button
- **Stale:** dimmed card, "Last seen: [date]" label, [Remove] button
- All use the existing DPF styling: `--dpf-surface-1` background, `--dpf-border` border, etc.

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/platform/ModelCard.tsx
git commit -m "feat(web): add ModelCard component (profiled/unprofiled/stale states)"
```

---

### Task 16: ModelSection Component

**Files:**
- Create: `apps/web/components/platform/ModelSection.tsx`

- [ ] **Step 1: Create client component for paginated model list**

Props: `{ providerId: string; models: DiscoveredModelRow[]; profiles: ModelProfileRow[]; canWrite: boolean; hasActiveProvider: boolean; latestDiscovery: Date | null }`

Features:
- Client-side pagination: 20 models per page with prev/next buttons
- Search box filtering on `modelId` and `profile.friendlyName`
- "Profile All Unprofiled" button (only when unprofiled models exist + `canWrite` + `hasActiveProvider`)
- For >50 unprofiled models, show confirmation before profiling
- Maps each model to a `ModelCard`, joining with profiles by `modelId`
- Stale detection: models where `lastSeenAt < latestDiscovery` are marked stale

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/platform/ModelSection.tsx
git commit -m "feat(web): add ModelSection with pagination, search, and bulk profiling"
```

---

### Task 17: Wire Models into Provider Detail Page

**Files:**
- Modify: `apps/web/app/(shell)/platform/ai/providers/[providerId]/page.tsx`
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`

- [ ] **Step 1: Pass model data from page to form**

The page component already fetches `models` and `profiles` (from Task 12). Now pass them along with `hasActiveProvider` (check if any provider has `status === "active"`):

```typescript
const allProviders = await getProviders();
const hasActiveProvider = allProviders.some((p) => p.provider.status === "active");
```

- [ ] **Step 2: Render ModelSection below the form**

In `ProviderDetailForm`, below the existing Save/Test buttons section, add:

```tsx
{/* Models section */}
<div style={{ marginTop: 32 }}>
  <div style={{ color: "#7c8cf8", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 12 }}>
    Discovered Models
  </div>
  <ModelSection
    providerId={provider.providerId}
    models={models}
    profiles={profiles}
    canWrite={canWrite}
    hasActiveProvider={hasActiveProvider}
    latestDiscovery={models.length > 0 ? new Date(Math.max(...models.map(m => m.lastSeenAt.getTime()))) : null}
  />
</div>
```

- [ ] **Step 3: Auto-profile after discovery (with batch confirmation)**

In `handleTest` and `handleRefreshModels`, after successful discovery, trigger profiling for unprofiled models. For >50 models, show a confirmation dialog (per spec Section 4):

```typescript
if (discovery.newCount > 0 && hasActiveProvider) {
  // Count unprofiled models
  const unprofiledCount = discovery.discovered - (profiles?.length ?? 0);
  if (unprofiledCount > 50) {
    const ok = window.confirm(
      `Profile ${unprofiledCount} models? This may take a moment and incur AI costs.`
    );
    if (!ok) return;
  }
  const profilingResult = await profileModels(provider.providerId);
  setProfilingResult(profilingResult);
}
```

- [ ] **Step 4: Verify end-to-end flow in browser**

1. Navigate to a configured provider (e.g., OpenAI)
2. Click Test Connection → should discover models AND auto-profile them
3. Model cards should appear with friendly names and descriptions

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/\(shell\)/platform/ai/providers/\[providerId\]/page.tsx apps/web/components/platform/ProviderDetailForm.tsx
git commit -m "feat(web): wire model discovery and profiling into provider detail page"
```

---

### Task 18: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

```bash
cd /d/OpenDigitalProductFactory && pnpm test
```

All tests should pass (existing + new).

- [ ] **Step 2: TypeScript check**

```bash
cd apps/web && npx tsc --noEmit
```

Zero errors.

- [ ] **Step 3: End-to-end browser verification**

1. `/platform/ai` — providers grouped by Direct / Routers
2. Click "Sync from registry" — all 17 providers appear
3. Configure OpenAI → Save → Test → models discovered + profiled
4. Model cards show friendly names, descriptions, cost/speed/context
5. Search box filters models
6. Pagination works for providers with many models

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "chore(web): Phase 7B final cleanup and fixes"
```
