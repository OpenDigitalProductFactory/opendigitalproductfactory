# EP-OAUTH-002: Wire `anthropic-sub` to OAuth Authorization Code Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `anthropic-sub` provider to the existing OAuth 2.0 authorization code + PKCE flow so admins can sign in via browser instead of pasting tokens manually.

**Architecture:** The generic OAuth flow already exists (`provider-oauth.ts`). This wires `anthropic-sub` to it by adding Anthropic's OAuth endpoints to the registry, creating a unified `/callback` route for localhost-restricted providers, adding the required `anthropic-beta` header for OAuth inference, and removing legacy workaround code.

**Tech Stack:** Next.js 16 (App Router), Prisma, TypeScript, OAuth 2.0 + PKCE

**Spec:** `docs/superpowers/specs/2026-03-22-anthropic-sub-oauth-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/db/data/providers-registry.json` | Modify | Add OAuth endpoints to `anthropic-sub`; clean Codex `oauthRedirectUri` |
| `apps/web/app/callback/route.ts` | **Create** | Short OAuth callback route for localhost-restricted providers |
| `apps/web/lib/provider-oauth.ts` | Modify | Update `getOAuthRedirectUri()` with localhost-provider detection |
| `apps/web/lib/ai-provider-internals.ts` | Modify | Remove `isAnthropicOAuthToken()` and `getClaudeCodeOAuthToken()`; add `anthropic-beta` header in `discoverModelsInternal()` |
| `apps/web/lib/ai-inference.ts` | Modify | Add `anthropic-beta` header for OAuth; remove `sk-ant-oat` workaround and dead imports |
| `apps/web/lib/actions/ai-providers.ts` | Modify | Update `testProviderAuth()`: add beta header for OAuth, remove `sk-ant-oat` workaround, route Anthropic OAuth to `/messages` test |
| `packages/db/src/seed.ts` | Modify | Seed `CredentialEntry` for `anthropic-sub` with correct OAuth scopes |

---

### Task 1: Validate RFC 8252 Port Flexibility

The spec requires validation that Anthropic's OAuth server accepts `http://localhost:3000/callback` when its registered redirect URI is `http://localhost/callback`.

**Files:**
- None — validation only

- [ ] **Step 1: Test redirect URI acceptance**

From a terminal, test that Anthropic's authorize endpoint accepts a redirect_uri with port 3000:

```bash
# This should return a redirect to Anthropic's login page, NOT an error about invalid redirect_uri
curl -sI "https://claude.ai/oauth/authorize?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fclaude-code-client-metadata&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcallback&code_challenge=test&code_challenge_method=S256&state=test&scope=user%3Ainference" 2>&1 | head -5
```

Expected: HTTP 302 redirect to a login page (NOT a 400 error about `redirect_uri`). If you get a 400 error mentioning redirect_uri, the port flexibility is not supported and you must set `oauthRedirectUri` explicitly in the registry for `anthropic-sub`.

- [ ] **Step 2: Record result**

If validation passes, proceed to Task 2. If it fails, add `"oauthRedirectUri": "http://localhost/callback"` to the `anthropic-sub` registry entry in Task 2 and skip creating the `/callback` route in Task 3 (use a reverse proxy approach instead — escalate to Mark).

---

### Task 2: Update Provider Registry

**Files:**
- Modify: `packages/db/data/providers-registry.json:31-60` (anthropic-sub entry)
- Modify: `packages/db/data/providers-registry.json:410-416` (codex entry — clear oauthRedirectUri)

- [ ] **Step 1: Add OAuth fields to `anthropic-sub`**

In `packages/db/data/providers-registry.json`, find the `anthropic-sub` entry (around line 32). Replace:

```json
    "authMethod": "api_key",
    "supportedAuthMethods": ["api_key"],
```

with:

```json
    "authMethod": "api_key",
    "supportedAuthMethods": ["api_key", "oauth2_authorization_code"],
    "authorizeUrl": "https://claude.ai/oauth/authorize",
    "tokenUrl": "https://platform.claude.com/v1/oauth/token",
    "oauthClientId": "https://claude.ai/oauth/claude-code-client-metadata",
    "oauthRedirectUri": null,
```

Also update `costPerformanceNotes` (line 46) to reflect the new OAuth flow:

```json
    "costPerformanceNotes": "Uses your Claude Max subscription. Sign in via OAuth or paste a token from 'claude setup-token'. No prompt caching, no 1M context.",
```

And update `userFacing.authExplained`:

```json
    "authExplained": "Sign in with your Claude account via OAuth, or paste a subscription token. No separate API key needed.",
```

And update `userFacing.setupDifficulty`:

```json
    "setupDifficulty": "easy",
```

- [ ] **Step 2: Clear Codex `oauthRedirectUri`**

Find the `codex` entry (around line 414-415). If `oauthRedirectUri` has a value, set it to `null`:

```json
    "oauthRedirectUri": null
```

(It's already null in the current registry, so this is a no-op — but verify.)

- [ ] **Step 3: Run registry sync to verify JSON is valid**

```bash
cd apps/web && npx vitest run --reporter=verbose 2>&1 | head -20
```

Or just validate the JSON:

```bash
node -e "JSON.parse(require('fs').readFileSync('packages/db/data/providers-registry.json','utf-8')); console.log('Valid JSON')"
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(registry): add OAuth endpoints to anthropic-sub provider"
```

---

### Task 3: Create Unified `/callback` Route

**Files:**
- Create: `apps/web/app/callback/route.ts`

- [ ] **Step 1: Create the callback route**

Create `apps/web/app/callback/route.ts` — this is identical to the existing callback at `apps/web/app/api/v1/auth/provider-oauth/callback/route.ts`:

```typescript
// apps/web/app/callback/route.ts
// Short OAuth callback route for localhost-restricted providers (Anthropic, Codex).
// Maps to {APP_URL}/callback — matches localhost/callback redirect URI patterns.
// See also: /api/v1/auth/provider-oauth/callback (for providers that accept arbitrary redirect URIs).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exchangeOAuthCode } from "@/lib/provider-oauth";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.redirect(new URL("/login?error=unauthorized", request.url));
  }

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

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

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/callback/route.ts
git commit -m "feat(oauth): add unified /callback route for localhost-restricted providers"
```

---

### Task 4: Update `getOAuthRedirectUri()` with Localhost Provider Detection

**Files:**
- Modify: `apps/web/lib/provider-oauth.ts:26-33`

- [ ] **Step 1: Update the redirect URI logic**

In `apps/web/lib/provider-oauth.ts`, replace the `getOAuthRedirectUri` function (lines 26-33):

```typescript
/** Determine the OAuth redirect URI for a provider.
 *  1. Explicit override (escape hatch for unusual providers)
 *  2. Localhost-restricted providers → short /callback path
 *  3. Default → our full API callback route */
const LOCALHOST_RESTRICTED_HOSTS = ["claude.ai", "auth.openai.com"];

function getOAuthRedirectUri(provider: { oauthRedirectUri?: string | null; authorizeUrl?: string | null }): string {
  if (provider.oauthRedirectUri) return provider.oauthRedirectUri;
  const appUrl = process.env.NEXTAUTH_URL ?? process.env.APP_URL ?? "http://localhost:3000";
  // Providers whose OAuth clients restrict redirect URIs to short localhost/callback paths
  if (provider.authorizeUrl && LOCALHOST_RESTRICTED_HOSTS.some(h => provider.authorizeUrl!.includes(h))) {
    return `${appUrl}/callback`;
  }
  return `${appUrl}/api/v1/auth/provider-oauth/callback`;
}
```

- [ ] **Step 2: Update call sites to pass `authorizeUrl`**

The function is called in two places within the same file. Both call it with `provider as { oauthRedirectUri?: string | null }`. Update the type cast to include `authorizeUrl`:

At line 54 (`createOAuthFlow`):
```typescript
  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });
```

At line 98 (`exchangeOAuthCode`):
```typescript
  const redirectUri = getOAuthRedirectUri(provider as { oauthRedirectUri?: string | null; authorizeUrl?: string | null });
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/provider-oauth.ts
git commit -m "feat(oauth): detect localhost-restricted providers for redirect URI"
```

---

### Task 5: Update `buildAuthHeaders()` in `ai-inference.ts`

> **Note:** Tasks 5, 6, and 7 remove call sites of `isAnthropicOAuthToken` and `getClaudeCodeOAuthToken`. Task 8 then removes the definitions. This ordering avoids broken builds between commits.

**Files:**
- Modify: `apps/web/lib/ai-inference.ts:7-15` (imports)
- Modify: `apps/web/lib/ai-inference.ts:110-131` (auth header logic)

- [ ] **Step 1: Clean up imports**

Replace the import block at lines 7-15:

```typescript
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  isAnthropicOAuthToken,
  getClaudeCodeOAuthToken,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
```

with:

```typescript
import {
  getDecryptedCredential,
  getProviderExtraHeaders,
  getProviderBearerToken,
  isAnthropicProvider,
  ANTHROPIC_OAUTH_BETA_HEADERS,
} from "@/lib/ai-provider-internals";
```

- [ ] **Step 2: Replace the `api_key` path — remove `sk-ant-oat` workaround**

Replace lines 110-122:

```typescript
  if (authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (!cred?.secretRef || !authHeader) throw new InferenceError("No credential configured", "auth", providerId);

    // Anthropic subscription tokens (from `claude setup-token`) use Bearer auth, not x-api-key.
    // These tokens are short-lived; prefer the live token from Claude Code's credentials file.
    if (isAnthropicProvider(providerId) && isAnthropicOAuthToken(cred.secretRef)) {
      const liveToken = getClaudeCodeOAuthToken() ?? cred.secretRef;
      headers["Authorization"] = `Bearer ${liveToken}`;
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    } else {
      headers[authHeader] = authHeader === "Authorization" ? `Bearer ${cred.secretRef}` : cred.secretRef;
    }
```

with:

```typescript
  if (authMethod === "api_key") {
    const cred = await getDecryptedCredential(providerId);
    if (!cred?.secretRef || !authHeader) throw new InferenceError("No credential configured", "auth", providerId);
    headers[authHeader] = authHeader === "Authorization" ? `Bearer ${cred.secretRef}` : cred.secretRef;
```

- [ ] **Step 3: Add `anthropic-beta` header to `oauth2_authorization_code` path**

Replace lines 127-131:

```typescript
  } else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
```

with:

```typescript
  } else if (authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) throw new InferenceError(tokenResult.error, "auth", providerId);
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-inference.ts
git commit -m "feat(inference): add anthropic-beta header for OAuth; remove sk-ant-oat workaround"
```

---

### Task 6: Update `testProviderAuth()` in `ai-providers.ts`

**Files:**
- Modify: `apps/web/lib/actions/ai-providers.ts:14-24` (imports)
- Modify: `apps/web/lib/actions/ai-providers.ts:279-339` (test auth logic)

- [ ] **Step 1: Clean up imports**

In `apps/web/lib/actions/ai-providers.ts`, find the imports from `ai-provider-internals` (around lines 14-24). Remove `isAnthropicOAuthToken` from the import list.

- [ ] **Step 2: Remove `sk-ant-oat` workaround from `api_key` branch**

Replace lines 279-291:

```typescript
  if (provider.authMethod === "api_key") {
    const credential = await getDecryptedCredential(providerId);
    if (!credential?.secretRef) return { ok: false, message: "No API key configured" };

    // Anthropic subscription tokens use Bearer auth, not x-api-key
    if (isAnthropicProvider(providerId) && isAnthropicOAuthToken(credential.secretRef)) {
      headers["Authorization"] = `Bearer ${credential.secretRef}`;
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    } else if (provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${credential.secretRef}`
        : credential.secretRef;
    }
```

with:

```typescript
  if (provider.authMethod === "api_key") {
    const credential = await getDecryptedCredential(providerId);
    if (!credential?.secretRef) return { ok: false, message: "No API key configured" };

    if (provider.authHeader) {
      headers[provider.authHeader] = provider.authHeader === "Authorization"
        ? `Bearer ${credential.secretRef}`
        : credential.secretRef;
    }
```

- [ ] **Step 3: Add `anthropic-beta` header to `oauth2_authorization_code` branch**

Replace lines 296-300:

```typescript
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
```

with:

```typescript
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { ok: false, message: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
```

- [ ] **Step 4: Update the Anthropic `/messages` test routing condition**

Replace the condition at line 318:

```typescript
    if (isAnthropicProvider(providerId) && headers["anthropic-beta"]?.includes("oauth")) {
```

with:

```typescript
    if (isAnthropicProvider(providerId) && provider.authMethod === "oauth2_authorization_code") {
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/ai-providers.ts
git commit -m "feat(test-auth): add anthropic-beta for OAuth; remove sk-ant-oat workaround"
```

---

### Task 7: Add `anthropic-beta` header to `discoverModelsInternal()` in `ai-provider-internals.ts`

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts:222-226`

This is a third copy of the OAuth auth header construction logic that also needs the `anthropic-beta` header.

- [ ] **Step 1: Add `anthropic-beta` header to `oauth2_authorization_code` branch**

Replace lines 222-226:

```typescript
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
  }
```

with:

```typescript
  } else if (provider.authMethod === "oauth2_authorization_code") {
    const tokenResult = await getProviderBearerToken(providerId);
    if ("error" in tokenResult) return { discovered: 0, newCount: 0, error: tokenResult.error };
    headers["Authorization"] = `Bearer ${tokenResult.token}`;
    if (isAnthropicProvider(providerId)) {
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA_HEADERS;
    }
  }
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "feat(discovery): add anthropic-beta header for OAuth in discoverModelsInternal"
```

---

### Task 8: Remove Dead Workaround Code from `ai-provider-internals.ts`

> All call sites were cleaned up in Tasks 5-7. Now safe to remove the definitions.

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts:42-108`

- [ ] **Step 1: Remove `isAnthropicOAuthToken()`**

Delete lines 42-45:

```typescript
/** Detect if an Anthropic key is a subscription OAuth token (from `claude setup-token`) */
export function isAnthropicOAuthToken(apiKey: string): boolean {
  return apiKey.includes("sk-ant-oat");
}
```

- [ ] **Step 2: Remove `getClaudeCodeOAuthToken()`**

Delete lines 84-108 (the function and its doc comment):

```typescript
/**
 * Read the current access token from Claude Code's local credentials file.
 * OAuth access tokens are short-lived; Claude Code auto-refreshes them.
 * This keeps the platform in sync without manual re-entry.
 */
export function getClaudeCodeOAuthToken(): string | null {
  ...
}
```

- [ ] **Step 3: Verify `ANTHROPIC_OAUTH_BETA_HEADERS` and `isAnthropicProvider` remain**

Confirm these are still present (they are needed by the new OAuth code paths):

```typescript
export const ANTHROPIC_OAUTH_BETA_HEADERS = "oauth-2025-04-20";
export function isAnthropicProvider(providerId: string): boolean { ... }
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "refactor: remove isAnthropicOAuthToken and getClaudeCodeOAuthToken workarounds"
```

---

### Task 9: Seed `CredentialEntry` with OAuth Scope

**Files:**
- Modify: `packages/db/src/seed.ts` (after `seedMcpServers`, around line 1231)

- [ ] **Step 1: Add credential seed for `anthropic-sub`**

In `packages/db/src/seed.ts`, find `main()` (line 1205). After the `seedMcpServers()` call (line 1231), add a call to seed the credential entry. Add this function before `main()`:

```typescript
async function seedAnthropicSubScope(): Promise<void> {
  await prisma.credentialEntry.upsert({
    where: { providerId: "anthropic-sub" },
    create: {
      providerId: "anthropic-sub",
      scope: "user:inference user:profile",
      status: "unconfigured",
    },
    update: {},  // preserve existing credentials on re-seed
  });
  console.log("Seeded anthropic-sub credential scope");
}
```

Then add the call in `main()` after `seedScheduledJobs()`:

```typescript
  await seedAnthropicSubScope();
```

- [ ] **Step 2: Commit**

```bash
git add packages/db/src/seed.ts
git commit -m "feat(seed): add anthropic-sub credential entry with OAuth scopes"
```

---

### Task 10: Build and Verify

**Files:**
- None — verification only

- [ ] **Step 1: Run TypeScript check**

```bash
cd apps/web && pnpm exec tsc --noEmit 2>&1 | tail -20
```

Expected: No errors. If there are errors about missing `isAnthropicOAuthToken` or `getClaudeCodeOAuthToken`, there are remaining import sites that need cleanup. Grep and fix:

```bash
grep -rn "isAnthropicOAuthToken\|getClaudeCodeOAuthToken" apps/web/lib/ apps/web/components/
```

- [ ] **Step 2: Run existing tests**

```bash
cd apps/web && pnpm exec vitest run lib/ollama-health.test.ts lib/ai-provider-internals.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: All pass. (`ollama-health.test.ts` does not mock the removed functions — only `discoverModelsInternal` and `profileModelsInternal`.)

- [ ] **Step 3: Rebuild Docker container**

```bash
docker compose up -d portal --build 2>&1 | tail -10
```

Wait for the build to complete and portal to start.

- [ ] **Step 4: Verify registry sync populated OAuth fields**

```bash
docker compose exec -T postgres psql -U dpf -d dpf -c "SELECT \"providerId\", \"authorizeUrl\", \"tokenUrl\", \"oauthClientId\", \"supportedAuthMethods\" FROM \"ModelProvider\" WHERE \"providerId\" = 'anthropic-sub';"
```

Expected: `authorizeUrl`, `tokenUrl`, and `oauthClientId` should be populated. `supportedAuthMethods` should be `["api_key", "oauth2_authorization_code"]`.

- [ ] **Step 5: Verify credential scope was seeded**

```bash
docker compose exec -T postgres psql -U dpf -d dpf -c "SELECT \"providerId\", scope, status FROM \"CredentialEntry\" WHERE \"providerId\" = 'anthropic-sub';"
```

Expected: `scope` = `user:inference user:profile`, `status` = `unconfigured`.

- [ ] **Step 6: Commit (if any fixups were needed)**

```bash
git add -A && git commit -m "fix: address build/test issues from OAuth wiring"
```

---

### Task 11: Manual End-to-End Test

**Files:**
- None — manual testing

- [ ] **Step 1: Navigate to Anthropic subscription provider detail page**

Open `http://localhost:3000/platform/ai/providers/anthropic-sub` in browser. Verify:
- Auth method selector is visible with "API Key" and "OAuth (Sign in)" options
- Selecting "OAuth (Sign in)" shows the Sign In button
- Selecting "API Key" shows the existing manual paste UI

- [ ] **Step 2: Test OAuth sign-in flow**

Click "Sign in" with OAuth selected. Verify:
- Browser redirects to `https://claude.ai/oauth/authorize` with correct params
- After authenticating, redirects back to the provider detail page with `?oauth=success`
- "Connected" status shows with token expiry
- Provider status changes to "active"

- [ ] **Step 3: Test inference with OAuth token**

Navigate to a page that uses the coworker chat. Send a message. Verify:
- The request uses `anthropic-sub` provider with `oauth2_authorization_code` auth
- No "No eligible AI endpoints" error
- Response arrives successfully

- [ ] **Step 4: Commit any E2E fixups (if needed)**

Only if manual testing revealed issues that required code changes:

```bash
git add -A && git commit -m "fix(oauth): address issues found during E2E testing"
```
