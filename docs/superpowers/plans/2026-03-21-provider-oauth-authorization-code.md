# EP-OAUTH-001: Provider OAuth Authorization Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generic OAuth 2.0 authorization code + PKCE as a third auth method for AI providers, with OpenAI Codex as the first consumer.

**Architecture:** Standalone browser-redirect OAuth flow triggered by admin on provider detail page. PKCE challenge stored server-side in `OAuthPendingFlow` table (10-min TTL). Callback route exchanges code for tokens, stores encrypted in `CredentialEntry`. Token refresh handled on-demand by `getProviderBearerToken()`. Flow is fully data-driven via `authorizeUrl`, `tokenUrl`, `oauthClientId` fields on `ModelProvider`.

**Tech Stack:** Prisma (schema + migration), Next.js API route (callback), server actions, Web Crypto API (PKCE), AES-256-GCM (token encryption), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-03-21-provider-oauth-authorization-code-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `packages/db/prisma/schema.prisma` | Add `refreshToken` to `CredentialEntry`, `authorizeUrl`/`tokenUrl`/`oauthClientId` to `ModelProvider`, new `OAuthPendingFlow` model |
| `packages/db/data/providers-registry.json` | Update CODEX entry with OAuth fields |
| `apps/web/lib/ai-provider-types.ts` | Extend `authMethod` union, `RegistryProviderEntry`, `ProviderRow`, `CredentialRow` |
| `apps/web/lib/provider-oauth.ts` | **NEW** — PKCE generation, flow start, token exchange, token refresh |
| `apps/web/lib/actions/provider-oauth.ts` | **NEW** — server actions: `startProviderOAuth()`, `disconnectProviderOAuth()` |
| `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts` | **NEW** — GET handler for OAuth callback |
| `apps/web/lib/ai-provider-internals.ts` | Refactor `getProviderBearerToken()` + `getDecryptedCredential()` |
| `apps/web/lib/ai-inference.ts` | Remove duplicate functions, add `oauth2_authorization_code` branch to `buildAuthHeaders()` |
| `apps/web/lib/actions/ai-providers.ts` | Extend `syncProviderRegistry()`, scope `configureProvider()` validation, add auth-method-switch cleanup |
| `apps/web/components/platform/ProviderDetailForm.tsx` | OAuth sign-in button, connection status, disconnect, dropdown label |
| `apps/web/lib/ai-providers.test.ts` | Tests for PKCE, token refresh, state validation |

---

### Task 1: Schema Migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: Prisma migration (auto-generated)

- [ ] **Step 1: Add `refreshToken` to `CredentialEntry`**

In `packages/db/prisma/schema.prisma`, find the `CredentialEntry` model (line ~742). Add after `tokenExpiresAt`:

```prisma
  refreshToken   String?
```

- [ ] **Step 2: Add OAuth fields to `ModelProvider`**

In the `ModelProvider` model (line ~756), add after `catalogEntry`:

```prisma
  authorizeUrl         String?
  tokenUrl             String?
  oauthClientId        String?
```

- [ ] **Step 3: Add `OAuthPendingFlow` model**

Add after the `CredentialEntry` model:

```prisma
model OAuthPendingFlow {
  id            String   @id @default(cuid())
  state         String   @unique
  codeVerifier  String
  providerId    String
  createdAt     DateTime @default(now())
}
```

- [ ] **Step 4: Generate and apply migration**

Run:
```bash
pnpm --filter @dpf/db exec npx prisma migrate dev --name add_oauth_authorization_code
```

Expected: Migration created, schema synced. Prisma client regenerated.

- [ ] **Step 5: Verify Prisma client types**

Run:
```bash
pnpm --filter @dpf/db exec npx prisma generate
```

Expected: No errors. `OAuthPendingFlow`, `refreshToken`, `authorizeUrl`, `tokenUrl`, `oauthClientId` available in Prisma client types.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add OAuth authorization code schema — refreshToken, OAuthPendingFlow, provider OAuth fields"
```

---

### Task 2: Type Definitions

**Files:**
- Modify: `apps/web/lib/ai-provider-types.ts`

- [ ] **Step 1: Extend `authMethod` union on `RegistryProviderEntry`**

At line 169, change:
```typescript
authMethod: "api_key" | "oauth2_client_credentials" | "none";
```
to:
```typescript
authMethod: "api_key" | "oauth2_client_credentials" | "oauth2_authorization_code" | "none";
```

- [ ] **Step 2: Add OAuth fields to `RegistryProviderEntry`**

After `catalogEntry` field (~line 190), add:
```typescript
  authorizeUrl?: string | null;
  tokenUrl?: string | null;
  oauthClientId?: string | null;
```

- [ ] **Step 3: Add OAuth fields to `ProviderRow`**

After `contextRetention` field (~line 80), add:
```typescript
  authorizeUrl: string | null;
  tokenUrl: string | null;
  oauthClientId: string | null;
```

- [ ] **Step 4: Extend `CredentialRow` with client-safe OAuth status fields**

In the `CredentialRow` type (~line 84), add after `status`:
```typescript
  tokenExpiresAt: string | null;
  hasRefreshToken: boolean;
```

- [ ] **Step 5: Verify build**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | head -30
```

Expected: Type errors in files that now need the new fields (e.g., where `ProviderRow` or `CredentialRow` are constructed). These will be fixed in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/ai-provider-types.ts
git commit -m "feat(types): add oauth2_authorization_code auth method and OAuth fields to provider/credential types"
```

---

### Task 3: Registry & Sync

**Files:**
- Modify: `packages/db/data/providers-registry.json`
- Modify: `apps/web/lib/actions/ai-providers.ts`

- [ ] **Step 1: Update CODEX registry entry**

In `packages/db/data/providers-registry.json`, find the `"codex"` entry (line ~242). Change `supportedAuthMethods` and add OAuth fields:

```json
{
  "providerId": "codex",
  "name": "OpenAI Codex",
  "category": "agent",
  "baseUrl": "https://api.openai.com/v1",
  "authMethod": "api_key",
  "supportedAuthMethods": ["api_key", "oauth2_authorization_code"],
  "authHeader": "Authorization",
  "authorizeUrl": "https://auth.openai.com/oauth/authorize",
  "tokenUrl": "https://auth.openai.com/oauth/token",
  "oauthClientId": "app_EMoaXYZ",
  ...rest unchanged...
}
```

**Important:** The actual Codex client ID (`app_EMoa…`) must be confirmed from the OpenAI Codex CLI source. Use placeholder `"app_EMoaXYZ"` until confirmed.

- [ ] **Step 2: Add OAuth fields to `syncProviderRegistry()` UPDATE path**

In `apps/web/lib/actions/ai-providers.ts`, inside the `syncProviderRegistry()` function, find the `prisma.modelProvider.update()` call (~line 77). Add after the `catalogEntry` line (~line 99):

```typescript
          ...(entry.authorizeUrl !== undefined   && { authorizeUrl:   entry.authorizeUrl ?? null }),
          ...(entry.tokenUrl !== undefined       && { tokenUrl:       entry.tokenUrl ?? null }),
          ...(entry.oauthClientId !== undefined   && { oauthClientId:  entry.oauthClientId ?? null }),
```

- [ ] **Step 3: Add OAuth fields to `syncProviderRegistry()` CREATE path**

In the `prisma.modelProvider.create()` call (~line 104), add after `catalogEntry`:

```typescript
          authorizeUrl:     entry.authorizeUrl ?? null,
          tokenUrl:         entry.tokenUrl ?? null,
          oauthClientId:    entry.oauthClientId ?? null,
```

- [ ] **Step 4: Scope `configureProvider()` OAuth validation**

In `configureProvider()` (~line 174), change the validation:

From:
```typescript
  const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
  if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
    return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
  }
```

To:
```typescript
  // OAuth client_credentials validation — only applies when that auth method is being configured
  if (input.authMethod === "oauth2_client_credentials" || (!input.authMethod && selectedAuthMethod === "oauth2_client_credentials")) {
    const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
    if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
      return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
    }
  }
```

Note: You'll need to look up the current `authMethod` from the DB if `input.authMethod` is not provided. Simplest approach: move the validation after the provider lookup, or just check `input.authMethod`:

```typescript
  if (input.authMethod !== "oauth2_authorization_code") {
    const hasOAuthField = input.clientId !== undefined || input.clientSecret !== undefined || input.tokenEndpoint !== undefined;
    if (hasOAuthField && (!input.clientId || !input.clientSecret || !input.tokenEndpoint)) {
      return { error: "OAuth requires Client ID, Client Secret, and Token Endpoint" };
    }
  }
```

- [ ] **Step 5: Add auth-method-switch field cleanup**

In `configureProvider()`, **before** the credential upsert block (~line 187, not after it), add cleanup logic. This must run first so the subsequent upsert writes the new auth method's fields cleanly:

```typescript
  // Clear credential fields from previous auth method when switching
  if (input.authMethod) {
    const clearFields: Record<string, null> = {};
    if (input.authMethod === "api_key") {
      // Switching TO api_key: clear OAuth tokens
      Object.assign(clearFields, { cachedToken: null, refreshToken: null, tokenExpiresAt: null, clientId: null, clientSecret: null, tokenEndpoint: null });
    } else if (input.authMethod === "oauth2_authorization_code") {
      // Switching TO auth code: clear API key and client_credentials fields
      Object.assign(clearFields, { secretRef: null, clientId: null, clientSecret: null, tokenEndpoint: null });
    } else if (input.authMethod === "oauth2_client_credentials") {
      // Switching TO client_credentials: clear API key and auth code tokens
      Object.assign(clearFields, { secretRef: null, cachedToken: null, refreshToken: null, tokenExpiresAt: null });
    }
    if (Object.keys(clearFields).length > 0) {
      await prisma.credentialEntry.upsert({
        where: { providerId: input.providerId },
        create: { providerId: input.providerId, ...clearFields },
        update: clearFields,
      });
    }
  }
```

- [ ] **Step 6: Fix `CredentialRow` construction in `maskCredential()`**

In `apps/web/lib/ai-provider-data.ts`, find the `maskCredential()` function (~line 26). This is the only place `CredentialRow` is constructed. Add the two new fields to the returned object:

```typescript
tokenExpiresAt: cred.tokenExpiresAt?.toISOString() ?? null,
hasRefreshToken: cred.refreshToken != null && cred.refreshToken !== "",
```

- [ ] **Step 7: Fix `ProviderRow` construction (two locations)**

In `apps/web/lib/ai-provider-data.ts`, `ProviderRow` is constructed in two places:
- `getProviders()` at ~line 55 (uses `satisfies ProviderRow`)
- `getProviderById()` at ~line 87 (uses `satisfies ProviderRow`)

Both use `...p` spread from Prisma which will automatically include the new DB columns. Verify the spread captures the new fields. If the `select` clause filters them out, add them explicitly. Add the three new fields to both locations:

```typescript
authorizeUrl: provider.authorizeUrl,
tokenUrl: provider.tokenUrl,
oauthClientId: provider.oauthClientId,
```

- [ ] **Step 8: Verify build**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | head -30
```

Expected: Fewer type errors than before. The remaining errors will be in the inference layer (Task 4) and UI (Task 6).

- [ ] **Step 9: Commit**

```bash
git add packages/db/data/providers-registry.json apps/web/lib/actions/ai-providers.ts apps/web/lib/ai-provider-data.ts
git commit -m "feat(registry): add OAuth authorization code fields, scope validation, auth-method-switch cleanup"
```

---

### Task 4: PKCE + OAuth Logic (Core Module)

**Files:**
- Create: `apps/web/lib/provider-oauth.ts`
- Test: `apps/web/lib/ai-providers.test.ts`

- [ ] **Step 1: Write failing tests for PKCE generation**

In `apps/web/lib/ai-providers.test.ts`, add:

```typescript
import { generatePKCE } from "./provider-oauth";

describe("generatePKCE", () => {
  it("generates a code_verifier of correct length", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    // 32 random bytes → 43 base64url chars
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates a code_challenge that differs from verifier", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    expect(codeChallenge).not.toBe(codeVerifier);
    // SHA-256 hash → 43 base64url chars
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("generates unique values each call", () => {
    const a = generatePKCE();
    const b = generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/ai-providers.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `generatePKCE` not found.

- [ ] **Step 3: Implement `provider-oauth.ts`**

Create `apps/web/lib/provider-oauth.ts`:

```typescript
// apps/web/lib/provider-oauth.ts
// OAuth 2.0 authorization code + PKCE helpers for provider credential flows.
// Server-only — no "use server" directive (called by server actions and route handlers).

import { randomBytes, createHash } from "crypto";
import { prisma } from "@dpf/db";
import { encryptSecret, decryptSecret } from "@/lib/credential-crypto";

// ─── PKCE ─────────────────────────────────────────────────────────────────────

function base64url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const verifierBytes = randomBytes(32);
  const codeVerifier = base64url(verifierBytes);
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

// ─── Flow start ───────────────────────────────────────────────────────────────

const FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function createOAuthFlow(providerId: string): Promise<{ authorizeUrl: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };
  if (!provider.authorizeUrl || !provider.oauthClientId) {
    return { error: "Provider does not support OAuth sign-in (missing authorizeUrl or oauthClientId)" };
  }

  // Clean up expired flows
  await prisma.oAuthPendingFlow.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - FLOW_TTL_MS) } },
  });

  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = crypto.randomUUID();

  await prisma.oAuthPendingFlow.create({
    data: { state, codeVerifier, providerId },
  });

  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/v1/auth/provider-oauth/callback`;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  // Add scope from credential entry if configured
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (cred?.scope) params.set("scope", cred.scope);

  return { authorizeUrl: `${provider.authorizeUrl}?${params.toString()}` };
}

// ─── Token exchange (callback) ────────────────────────────────────────────────

export async function exchangeOAuthCode(
  state: string,
  code: string,
): Promise<{ providerId: string } | { error: string }> {
  // Validate state
  const flow = await prisma.oAuthPendingFlow.findUnique({ where: { state } });
  if (!flow) return { error: "invalid_state" };

  // Check TTL
  if (Date.now() - flow.createdAt.getTime() > FLOW_TTL_MS) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "flow_expired" };
  }

  const provider = await prisma.modelProvider.findUnique({ where: { providerId: flow.providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "provider_misconfigured" };
  }

  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  const redirectUri = `${appUrl}/api/v1/auth/provider-oauth/callback`;

  // Exchange code for tokens
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    code_verifier: flow.codeVerifier,
    client_id: provider.oauthClientId,
    redirect_uri: redirectUri,
  });

  let tokenResponse: { access_token: string; refresh_token?: string; expires_in: number };
  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
      return { error: "token_exchange_failed" };
    }
    tokenResponse = await res.json() as typeof tokenResponse;
  } catch {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "token_exchange_failed" };
  }

  if (!tokenResponse.access_token) {
    await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });
    return { error: "no_token" };
  }

  // Store encrypted tokens
  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);
  await prisma.credentialEntry.upsert({
    where: { providerId: flow.providerId },
    create: {
      providerId: flow.providerId,
      cachedToken: encryptSecret(tokenResponse.access_token),
      refreshToken: tokenResponse.refresh_token ? encryptSecret(tokenResponse.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      status: "ok",
    },
    update: {
      cachedToken: encryptSecret(tokenResponse.access_token),
      refreshToken: tokenResponse.refresh_token ? encryptSecret(tokenResponse.refresh_token) : null,
      tokenExpiresAt: expiresAt,
      status: "ok",
    },
  });

  // Delete the pending flow
  await prisma.oAuthPendingFlow.delete({ where: { id: flow.id } });

  return { providerId: flow.providerId };
}

// ─── Token refresh ────────────────────────────────────────────────────────────

export async function refreshOAuthToken(
  providerId: string,
): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider?.tokenUrl || !provider.oauthClientId) {
    return { error: "Provider missing tokenUrl or oauthClientId" };
  }

  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred?.refreshToken) return { error: "Re-authentication required" };

  const decryptedRefresh = decryptSecret(cred.refreshToken);

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decryptedRefresh,
    client_id: provider.oauthClientId,
  });

  try {
    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      // Token rejected — mark as expired
      await prisma.credentialEntry.update({
        where: { providerId },
        data: { status: "expired" },
      });
      return { error: "OAuth token expired — admin must re-authenticate" };
    }

    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
    const expiresAt = new Date(Date.now() + body.expires_in * 1000);

    // Optimistic concurrency: only write if refreshToken hasn't changed
    const currentCred = await prisma.credentialEntry.findUnique({ where: { providerId } });
    if (currentCred?.refreshToken === cred.refreshToken) {
      await prisma.credentialEntry.update({
        where: { providerId },
        data: {
          cachedToken: encryptSecret(body.access_token),
          refreshToken: body.refresh_token ? encryptSecret(body.refresh_token) : cred.refreshToken,
          tokenExpiresAt: expiresAt,
          status: "ok",
        },
      });
    }
    // If refreshToken changed (another request already refreshed), we still have a valid access_token

    return { token: body.access_token };
  } catch {
    return { error: "Token refresh network error" };
  }
}
```

- [ ] **Step 4: Run tests to verify PKCE tests pass**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/ai-providers.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PKCE tests PASS.

- [ ] **Step 5: Write additional tests for token refresh and state validation**

In `apps/web/lib/ai-providers.test.ts`, add (these test the pure/deterministic functions — the DB-dependent functions are tested via integration):

```typescript
import { generatePKCE } from "./provider-oauth";

describe("PKCE S256 compliance", () => {
  it("code_challenge is SHA-256 of code_verifier in base64url", () => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    // Manually verify: hash the verifier and compare
    const { createHash } = require("crypto");
    const expectedChallenge = createHash("sha256")
      .update(codeVerifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(codeChallenge).toBe(expectedChallenge);
  });

  it("code_verifier uses only base64url characters (no +, /, =)", () => {
    for (let i = 0; i < 10; i++) {
      const { codeVerifier } = generatePKCE();
      expect(codeVerifier).not.toMatch(/[+/=]/);
    }
  });
});
```

- [ ] **Step 6: Run all tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/ai-providers.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All PKCE tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/provider-oauth.ts apps/web/lib/ai-providers.test.ts
git commit -m "feat(oauth): add provider-oauth module — PKCE, flow start, token exchange, refresh"
```

---

### Task 5: Refactor Token Resolution & Inference Integration

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts`
- Modify: `apps/web/lib/ai-inference.ts`

- [ ] **Step 1: Extend `getDecryptedCredential()` to decrypt all token fields**

In `apps/web/lib/ai-provider-internals.ts`, update `getDecryptedCredential()` (~line 20):

```typescript
export async function getDecryptedCredential(providerId: string) {
  const cred = await prisma.credentialEntry.findUnique({ where: { providerId } });
  if (!cred) return null;
  return {
    ...cred,
    secretRef:    cred.secretRef    ? decryptSecret(cred.secretRef)    : null,
    clientSecret: cred.clientSecret ? decryptSecret(cred.clientSecret) : null,
    cachedToken:  cred.cachedToken  ? decryptSecret(cred.cachedToken)  : null,
    refreshToken: cred.refreshToken ? decryptSecret(cred.refreshToken) : null,
  };
}
```

Note: `decryptSecret()` already handles plaintext gracefully (returns as-is if not prefixed with `enc:`), so existing `client_credentials` cached tokens will continue to work.

- [ ] **Step 2: Refactor `getProviderBearerToken()` to dispatch by auth method**

Replace the existing `getProviderBearerToken()` function in `ai-provider-internals.ts` (~line 78):

```typescript
export async function getProviderBearerToken(providerId: string): Promise<{ token: string } | { error: string }> {
  const provider = await prisma.modelProvider.findUnique({ where: { providerId } });
  if (!provider) return { error: "Provider not found" };

  if (provider.authMethod === "oauth2_authorization_code") {
    // Authorization code flow — use refresh logic from provider-oauth module
    const { refreshOAuthToken } = await import("@/lib/provider-oauth");

    const credential = await getDecryptedCredential(providerId);
    if (!credential) return { error: "No credential configured" };

    // Return cached token if still valid (5-minute buffer)
    if (credential.cachedToken && credential.tokenExpiresAt) {
      const buffer = 5 * 60 * 1000;
      if (credential.tokenExpiresAt.getTime() > Date.now() + buffer) {
        return { token: credential.cachedToken };
      }
    }

    // Attempt refresh
    return refreshOAuthToken(providerId);
  }

  // Existing client_credentials flow
  const credential = await getDecryptedCredential(providerId);
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
      data: {
        cachedToken: encryptSecret(body.access_token),
        tokenExpiresAt: expiresAt,
        status: "ok",
      },
    });

    return { token: body.access_token };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Token exchange error" };
  }
}
```

Note: The `client_credentials` path now also encrypts `cachedToken` via `encryptSecret()`. The `decryptSecret()` call in `getDecryptedCredential()` handles both old plaintext and new encrypted values.

- [ ] **Step 3: Add `oauth2_authorization_code` branch to `buildAuthHeaders()` in `ai-inference.ts`**

In `apps/web/lib/ai-inference.ts`, find `buildAuthHeaders()` (~line 192). After the `oauth2_client_credentials` branch (~line 218), add:

```typescript
  } else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
```

- [ ] **Step 4: Remove duplicate functions from `ai-inference.ts`**

In `ai-inference.ts`, remove the duplicate `getProviderBearerToken()` function (lines ~145-188) and the duplicate `getDecryptedCredential()` and `getProviderExtraHeaders()` functions (if present — check imports at top of file).

Update the imports at the top of `ai-inference.ts` to import from `ai-provider-internals.ts`:

```typescript
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  isAnthropicOAuthToken,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
```

Remove the local definitions and the local `getClaudeCodeOAuthToken()` (move to `ai-provider-internals.ts` if not already there).

**Caution — three things to handle during consolidation:**

1. **`getClaudeCodeOAuthToken()`** exists only in `ai-inference.ts` (lines 124-143). Move it to `ai-provider-internals.ts` and export it. The function uses `require("os")`, `require("fs")`, `require("path")` deliberately for lazy loading — preserve this pattern.

2. **`ANTHROPIC_OAUTH_BETA_HEADERS`** has DIFFERENT values in the two files:
   - `ai-provider-internals.ts` line 46: `"claude-code-20250219,oauth-2025-04-20"`
   - `ai-inference.ts` line 117: `"oauth-2025-04-20"` (with comment explaining `claude-code-20250219` causes HTTP 400 on non-agentic calls)

   **Resolution:** The `ai-inference.ts` value is correct for inference calls. After consolidation, keep `"oauth-2025-04-20"` as the exported constant value. If `ai-provider-internals.ts` has callers that need the other header, they should use a separate constant.

3. **`discoverModelsInternal()`** in `ai-provider-internals.ts` (lines 149-159) has auth branching that only handles `api_key` and `oauth2_client_credentials`. **Add an `oauth2_authorization_code` branch** — identical to `client_credentials` (calls `getProviderBearerToken()` which now dispatches internally):

```typescript
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
```

4. **`testProviderAuth()`** in `apps/web/lib/actions/ai-providers.ts` (~line 229) also has auth branching that needs the same new branch for `oauth2_authorization_code`. Add it after the `oauth2_client_credentials` branch.

- [ ] **Step 5: Verify build compiles**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | head -30
```

Expected: Clean or only UI-related errors remaining.

- [ ] **Step 6: Run existing tests**

Run:
```bash
pnpm --filter web exec vitest run apps/web/lib/ai-providers.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: All existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts apps/web/lib/ai-inference.ts
git commit -m "feat(inference): refactor getProviderBearerToken for auth method dispatch, consolidate duplicates"
```

---

### Task 6: Server Actions & Callback Route

**Files:**
- Create: `apps/web/lib/actions/provider-oauth.ts`
- Create: `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts`

- [ ] **Step 1: Create server actions**

Create `apps/web/lib/actions/provider-oauth.ts`:

```typescript
"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createOAuthFlow } from "@/lib/provider-oauth";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

export async function startProviderOAuth(providerId: string): Promise<{ authorizeUrl: string } | { error: string }> {
  await requireManageProviders();
  return createOAuthFlow(providerId);
}

export async function disconnectProviderOAuth(providerId: string): Promise<{ error?: string }> {
  await requireManageProviders();
  await prisma.credentialEntry.upsert({
    where: { providerId },
    create: { providerId, status: "unconfigured" },
    update: {
      cachedToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      status: "unconfigured",
    },
  });
  return {};
}
```

- [ ] **Step 2: Create callback route**

Create directory and file `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/provider-oauth";

export async function GET(request: NextRequest) {
  // Verify admin is authenticated
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  // Provider returned an error (e.g., user denied consent)
  if (error) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(error)}`, request.url));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/platform/ai?oauth=error&reason=missing_params", request.url));
  }

  const result = await exchangeOAuthCode(state, code);

  if ("error" in result) {
    return NextResponse.redirect(new URL(`/platform/ai?oauth=error&reason=${encodeURIComponent(result.error)}`, request.url));
  }

  return NextResponse.redirect(
    new URL(`/platform/ai/providers/${result.providerId}?oauth=success`, request.url),
  );
}
```

- [ ] **Step 3: Verify the route directory exists**

Run:
```bash
ls -la apps/web/app/api/v1/auth/
```

Expected: The `provider-oauth/callback/` directory was created by the Write tool.

- [ ] **Step 4: Verify build**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | head -30
```

Expected: Clean or only UI-related errors remaining.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/provider-oauth.ts apps/web/app/api/v1/auth/provider-oauth/
git commit -m "feat(oauth): add server actions and callback route for provider OAuth flow"
```

---

### Task 7: UI — ProviderDetailForm

**Files:**
- Modify: `apps/web/components/platform/ProviderDetailForm.tsx`

- [ ] **Step 1: Add imports**

At the top of `ProviderDetailForm.tsx`, add:

```typescript
import { startProviderOAuth, disconnectProviderOAuth } from "@/lib/actions/provider-oauth";
```

- [ ] **Step 2: Update dropdown label mapping**

Find the dropdown label mapping (~line 275). Change:

```typescript
{m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : "None"}
```

To:

```typescript
{m === "api_key" ? "API Key" : m === "oauth2_client_credentials" ? "OAuth2 Client Credentials" : m === "oauth2_authorization_code" ? "OAuth (Sign in)" : "None"}
```

Do the same for the static label display (~line 281).

- [ ] **Step 3: Add OAuth sign-in button and connection status**

After the `oauth2_client_credentials` fields block (~line 371+), add a new block for `oauth2_authorization_code`:

```tsx
      {selectedAuthMethod === "oauth2_authorization_code" && (
        <div style={{ marginBottom: 16 }}>
          {credential?.status === "ok" && credential?.tokenExpiresAt ? (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                <span style={{ color: "var(--dpf-text)", fontSize: 13 }}>
                  Connected · token expires {new Date(credential.tokenExpiresAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  await disconnectProviderOAuth(provider.providerId);
                  router.refresh();
                })}
                style={{ background: "transparent", border: "1px solid #ef4444", color: "#ef4444", padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 12 }}
              >
                Disconnect
              </button>
            </div>
          ) : credential?.status === "expired" ? (
            <div>
              <div style={{ color: "#f59e0b", fontSize: 13, marginBottom: 8 }}>
                Token expired — sign in again
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  const result = await startProviderOAuth(provider.providerId);
                  if ("authorizeUrl" in result) {
                    window.open(result.authorizeUrl, "_self");
                  } else {
                    setTestResult({ ok: false, message: result.error });
                  }
                })}
                style={{ background: "#7c8cf8", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Sign in with {provider.name}
              </button>
            </div>
          ) : (
            <div>
              <div style={{ color: "#8888a0", fontSize: 13, marginBottom: 8 }}>
                No account linked
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  const result = await startProviderOAuth(provider.providerId);
                  if ("authorizeUrl" in result) {
                    window.open(result.authorizeUrl, "_self");
                  } else {
                    setTestResult({ ok: false, message: result.error });
                  }
                })}
                style={{ background: "#7c8cf8", color: "#fff", border: "none", padding: "8px 18px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
              >
                Sign in with {provider.name}
              </button>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Update `handleSave()` for authorization code auth method**

In `handleSave()` (~line 74), the function conditionally includes fields based on `selectedAuthMethod`. For `oauth2_authorization_code`, no credential fields need to be sent — credentials are stored via the callback route, not the save button. The save only needs to persist `authMethod` and `enabledFamilies`. No code change needed if the conditional spread already handles this (the existing code only sends fields for `api_key` and `oauth2_client_credentials`). Verify this is the case.

- [ ] **Step 5: Update step calculation for guided setup**

Find the step calculation logic (~line 152) that checks whether credentials are configured:

```typescript
: (secretRef || credential?.secretHint || selectedAuthMethod === "none") ? 2
```

Add `oauth2_authorization_code` with a connected check:

```typescript
: (secretRef || credential?.secretHint || selectedAuthMethod === "none" || (selectedAuthMethod === "oauth2_authorization_code" && credential?.status === "ok")) ? 2
```

- [ ] **Step 6: Add OAuth callback feedback**

In the component body, add a `useEffect` (or `useSearchParams`) to read the `oauth` query param and show feedback. Add near the top of the component:

```typescript
import { useSearchParams } from "next/navigation";

// Inside the component:
const searchParams = useSearchParams();
const oauthResult = searchParams.get("oauth");
const oauthReason = searchParams.get("reason");

// Add useEffect to show toast on mount:
import { useEffect } from "react";
useEffect(() => {
  if (oauthResult === "success") {
    setSaveMessage("Successfully connected via OAuth");
  } else if (oauthResult === "error") {
    setTestResult({ ok: false, message: `OAuth failed: ${oauthReason ?? "unknown error"}` });
  }
}, [oauthResult, oauthReason]);
```

- [ ] **Step 7: Verify build**

Run:
```bash
pnpm --filter web exec tsc --noEmit 2>&1 | head -10
```

Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/platform/ProviderDetailForm.tsx
git commit -m "feat(ui): add OAuth sign-in button, connection status, and disconnect to ProviderDetailForm"
```

---

### Task 8: Final Verification & Test Run

- [ ] **Step 1: Run all tests**

```bash
pnpm --filter web exec vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: All tests pass, including new PKCE tests.

- [ ] **Step 2: Build check**

```bash
pnpm --filter web exec tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 3: Verify registry sync picks up new fields**

Start the dev server and navigate to `/platform/ai`. The provider sync should pick up the new `authorizeUrl`, `tokenUrl`, `oauthClientId` fields for the CODEX provider. Verify the CODEX provider card shows the dual-auth dropdown with "OAuth (Sign in)" option.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "fix: address any remaining type or build issues from OAuth implementation"
```

Only if there are actual changes to commit. Skip if clean.
