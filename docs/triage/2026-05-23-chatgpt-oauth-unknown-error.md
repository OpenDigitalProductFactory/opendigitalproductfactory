# ChatGPT OAuth `unknown_error` on auth.openai.com — root cause + minimal fix

**Date:** 2026-05-23
**Reporter:** Mark (operator)
**Triaged by:** Claude (worktree `xenodochial-williams-48d734`)
**Status:** Diagnosed. **No code changes applied — awaiting approval.**

---

## TL;DR

Clicking "Configure" on the **ChatGPT (OpenAI Subscription)** provider row sends a `redirect_uri` to OpenAI that the shared OAuth client `app_EMoamEEZ73f0CkXaXp7hrann` is **not registered for**. OpenAI rejects the authorize request on its own page (`auth.openai.com`) with `error_code: unknown_error` **before** the callback is ever invoked.

- Sent: `http://localhost:3000/api/v1/auth/provider-oauth/callback`
- Registered with OpenAI client: `http://localhost:1455/auth/callback`

Root cause is in the **seed**: [packages/db/data/providers-registry.json](packages/db/data/providers-registry.json) sets `chatgpt.oauthRedirectUri = null`, which causes the redirect URI helper to fall through to the long path. The `codex` provider has the correct explicit override, which is why Codex sign-in usually works but ChatGPT does not.

Minimal fix: one-line change to the registry plus a paired DB update for already-installed orgs.

---

## Evidence

### 1. Live DB confirms the mismatch

```
docker exec dpf-postgres-1 psql -U dpf -d dpf -c \
  'SELECT "providerId", "oauthClientId", "oauthRedirectUri" FROM "ModelProvider"
   WHERE "providerId" IN (''codex'',''chatgpt'');'

 providerId |        oauthClientId         |          oauthRedirectUri
------------+------------------------------+-------------------------------------
 codex      | app_EMoamEEZ73f0CkXaXp7hrann | http://localhost:1455/auth/callback
 chatgpt    | app_EMoamEEZ73f0CkXaXp7hrann |                                    ← NULL
```

Both providers share the same OAuth client. The client is registered with OpenAI for the `:1455/auth/callback` URI only. Codex has the explicit override. ChatGPT has `NULL`.

### 2. `PUBLIC_URL` is empty in the container

```
docker exec dpf-portal-1 env | grep PUBLIC_URL
PUBLIC_URL=
```

And `/d/DPF/.env` contains no `PUBLIC_URL` line. So [`getStablePortalUrl()`](apps/web/lib/portal-url.ts:35-38) returns the fallback `http://localhost:3000`.

### 3. Redirect-URI resolution falls through to the long path

In [`getOAuthRedirectUri()`](apps/web/lib/govern/provider-oauth.ts:53-64):

```ts
function getOAuthRedirectUri(provider: { oauthRedirectUri?: string | null; authorizeUrl?: string | null }): string {
  if (provider.oauthRedirectUri) return provider.oauthRedirectUri;   // chatgpt: null → skip
  const appUrl = getStablePortalUrl();                                // "http://localhost:3000"
  if (provider.authorizeUrl && LOCALHOST_RESTRICTED_HOSTS.some(h => provider.authorizeUrl!.includes(h))) {
    return `${appUrl}/callback`;                                      // LOCALHOST_RESTRICTED_HOSTS = ["claude.ai"]
  }                                                                   // auth.openai.com is NOT in that list
  return `${appUrl}/api/v1/auth/provider-oauth/callback`;             // ← chatgpt lands here
}
```

For `chatgpt`:
- `oauthRedirectUri` is `null` → first branch skipped
- `authorizeUrl` is `https://auth.openai.com/oauth/authorize` → does not match `claude.ai` → second branch skipped
- Returns `http://localhost:3000/api/v1/auth/provider-oauth/callback`

For `codex`:
- `oauthRedirectUri` is `http://localhost:1455/auth/callback` → returned directly. **Correct.**

That URI is then placed verbatim into the authorize request at [provider-oauth.ts:90](apps/web/lib/govern/provider-oauth.ts:90).

### 4. Architectural intent (from a comment in the callback handler)

[`apps/web/app/auth/callback/route.ts:9-11`](apps/web/app/auth/callback/route.ts:9):

```
// This callback runs on a different port (e.g. 1455 for Codex) so the
// session cookie from port 3000 isn't available. The OAuthPendingFlow
// state parameter provides CSRF protection instead of session auth.
```

And `docker-compose.yml` confirms the same container is bound to both ports:

```yaml
ports:
  - "3000:3000"
  - "1455:3000"  # OpenAI Codex OAuth callback (shared client requires this port)
```

The intent: any OpenAI provider should land on `:1455/auth/callback`. `chatgpt` shares the OpenAI client with `codex`, so it must use the same redirect URI. The seed forgot to set this.

### 5. The regression's origin commit

```
$ git log --oneline packages/db/data/providers-registry.json | grep -i chatgpt
41c1e0a7 fix: add OAuth config to chatgpt provider + bidirectional credential sync
```

Diff at `41c1e0a7` (Mar 22, 2026) added these lines for chatgpt:

```diff
+    "authorizeUrl": "https://auth.openai.com/oauth/authorize",
+    "tokenUrl": "https://auth.openai.com/oauth/token",
+    "oauthClientId": "app_EMoamEEZ73f0CkXaXp7hrann",
+    "oauthRedirectUri": null,                                ← root cause planted here
```

The author copied the OpenAI OAuth fields from codex but did not copy `oauthRedirectUri`. They likely assumed `null` was correct because the comment in the redirect URI helper made it sound like the "default" path was the normal case. It isn't — for OpenAI providers, the registered URI is the short `/auth/callback` on port 1455.

### 6. Why this is **before** the callback (matches the symptom)

OpenAI's authorization server validates `redirect_uri` against the registered client whitelist as part of the initial `/authorize` request handling. Unregistered URIs are rejected before the user-visible login/consent steps complete — the user sees the generic OpenAI error page (`auth.openai.com/.../error?error_code=unknown_error`) with a `request_id`, and the callback is never hit.

Cross-check: `docker logs dpf-portal-1` for the last 200 lines shows zero `/auth/callback?…` or `/api/v1/auth/provider-oauth/callback?…` requests — consistent with the failure occurring on OpenAI's side, before any redirect back.

### 7. Test file codifies the broken state

[`apps/web/lib/govern/provider-oauth.test.ts:66`](apps/web/lib/govern/provider-oauth.test.ts:66) and `:74` mock both providers with `oauthRedirectUri: null`. The tests pass because they only assert that an `authorizeUrl` is produced — they never assert it contains a redirect URI matching OpenAI's registered list. So the regression is invisible to CI.

---

## Why prior "fixes" regressed

This issue has been "fixed" 10+ times. The pattern visible in `git log` (and noted in memory file `project_codex_fresh_install_trace.md`):

| Fix attempted | Why it didn't survive |
|---|---|
| Adding `api.responses.write` scope (`7f59b194`) | Wrong layer — scope doesn't change redirect URI validation |
| Removing the scope again (`8287ccf4`) | Same — wrong layer |
| Switching to Chat Completions API (`f37ffceb`) | Wrong layer — that's the *post-auth* inference path |
| Restoring ChatGPT backend routing (`4e0e3099`) | Same |
| Codex CLI adapter (`codex-cli-adapter.ts`, Apr 15) | Solved the post-auth inference 401 (different bug, and that fix DID stick) |

None of those touched the seed value `oauthRedirectUri: null` for chatgpt. Every reinstall rehydrates the broken seed into the DB, so any manual DB patch in a previous install is wiped. **This is why the fix doesn't "stick" across reinstalls — the seed is the source of truth and the seed is wrong.**

Mark's memory `feedback_fix_seed_not_runtime` calls out this exact failure mode: "Recurring config regressions mean the seed wasn't patched; patch seed + add invariant guard."

---

## Note on the user's report: "ChatGPT or OpenAI Codex"

The user reported the error happens when clicking Configure on **either** the ChatGPT row **or** the OpenAI Codex row. My DB inspection shows the **Codex** row has the correct `oauthRedirectUri`, so Codex *should* work today. Possibilities:

1. The user has only actively re-tested the ChatGPT row recently and is generalising from past Codex failures (which are well-documented in memory)
2. Both rows trigger the same `createOAuthFlow(providerId)` server action with the row's `providerId` — so clicking on the ChatGPT row genuinely starts a `chatgpt` flow, not a `codex` flow. The ChatGPT row failure is fully explained by this report.
3. If Codex is ALSO currently failing, that needs separate reproduction — likely a different cause (e.g. corrupted pending flow from a partial run, OpenAI client config change on their side, etc.). **Recommend operator try the Codex row separately after the chatgpt fix lands** to disambiguate.

---

## Proposed fix (minimal, two-part)

### Part A — seed (the durable fix)

[`packages/db/data/providers-registry.json`](packages/db/data/providers-registry.json), for the `chatgpt` provider entry:

```diff
-    "oauthRedirectUri": null,
+    "oauthRedirectUri": "http://localhost:1455/auth/callback",
```

That is the only behavioral change required for new installs. Every future fresh install will now have a chatgpt row that matches the OpenAI-registered URI. **One line, one file.**

### Part B — DB patch for already-installed orgs (Mark's current install)

The seed only seeds; it does not re-write existing rows on reinstall. To unbreak Mark's current install (and other already-deployed orgs) without waiting for a wipe, run as a one-shot via the portal's normal seed-reconciliation path, or — if no such path exists today — a small startup invariant guard:

**Option B1 (preferred — invariant guard in code):** add to the activation/startup-reconcile pass a check that any provider sharing an `oauthClientId` with another provider also has the same `oauthRedirectUri`. This is the invariant Mark's `feedback_fix_seed_not_runtime` memory asks for, and it converts this whole class of bug into a startup error rather than a silent OAuth failure.

**Option B2 (one-shot SQL):** for Mark's install only:

```sql
UPDATE "ModelProvider"
   SET "oauthRedirectUri" = 'http://localhost:1455/auth/callback'
 WHERE "providerId" = 'chatgpt' AND "oauthRedirectUri" IS NULL;
```

I am **not** running this without approval. Per `feedback_dont_bypass_ux_with_sql` the preferred path is to fix the seed and let activation/upgrade flow handle it, but the seed doesn't push existing rows. Mark's call on which to use for this install.

### Optional Part C — test that would have caught this

Add to `provider-oauth.test.ts`: assert that `createOAuthFlow("chatgpt")` produces an `authorizeUrl` whose `redirect_uri` parameter equals `http://localhost:1455/auth/callback`. (Currently the test fixture sets `oauthRedirectUri: null` and never asserts the value.)

---

## Test plan

1. Apply Part A. `git diff` shows only the one-line change to the registry.
2. Apply Part B (B1 or B2). Verify the DB row now has the correct URI.
3. Restart portal (only if Part B1 invariant guard was added; B2 SQL doesn't require restart).
4. **Functional verification** (per `structural-verification-is-not-functional`): log in as admin, navigate to `/platform/ai/providers`, click Configure on the ChatGPT row, complete the OpenAI sign-in. Expect: land on `/platform/ai/providers/chatgpt?oauth=success`. Capture the network trace and verify the authorize URL contains `redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback`.
5. Repeat for the Codex row to confirm no regression there.
6. **Survives-reinstall check:** rebuild & reseed the portal, then verify the chatgpt row in DB still has the correct `oauthRedirectUri` (not null).

---

## Hard constraints honoured

- No code changes applied.
- No DB writes.
- No Docker/infra changes.
- No OAuth flow retries against OpenAI (I read only — no live authorize requests were issued from this session).

## Open question for operator

Three decisions for you:

1. **Apply Part A + B1 (invariant guard)?** This is the architecturally sound option and the only one that prevents the next regression.
2. **Apply Part A + B2 (one-shot SQL)?** Faster, but doesn't add the guard rail.
3. **Also retest Codex row** after the fix to confirm whether it shares this failure or is actually working today.

My recommendation: **option 1 (A + B1) + the test from Part C**. It fixes the seed, prevents the regression class entirely, and codifies the invariant. Estimated change footprint: 1-line registry change, ~10-line invariant guard, ~5-line test.

Report path: [docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md](docs/triage/2026-05-23-chatgpt-oauth-unknown-error.md)
