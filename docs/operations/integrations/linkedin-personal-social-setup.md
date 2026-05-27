# LinkedIn personal-publishing setup

Phase 2 of the marketing execution loop publishes approved marketing drafts to your own LinkedIn feed. DPF is a conduit — you bring your own LinkedIn developer app and OAuth credentials; DPF stores the refresh token encrypted in this install with `CREDENTIAL_ENCRYPTION_KEY` and never proxies through a DPF-owned account.

## One-time setup

1. Create a LinkedIn developer app at https://www.linkedin.com/developers/apps.

2. Under **Products**, add both:
   - **Sign In with LinkedIn using OpenID Connect** (provides the `openid profile email` scopes used by `/v2/userinfo` to discover your member URN)
   - **Share on LinkedIn** (provides the `w_member_social` scope used by `/v2/ugcPosts` to publish to your feed)

3. Under **Auth → OAuth 2.0 settings**, set the **Authorized redirect URL** to the value DPF shows on `/platform/tools/integrations/linkedin-personal-social`. By default that is:
   ```
   ${AUTH_URL}/api/integrations/linkedin-personal-social/callback
   ```
   For a local dev install on the default port: `http://localhost:3000/api/integrations/linkedin-personal-social/callback`.

4. Copy the **Client ID** and **Client Secret** from the LinkedIn app's **Auth** tab.

5. In DPF, go to **Platform → Tools → Enterprise Integrations → LinkedIn (personal publishing)** and paste the credentials into the connect form. Confirm the redirect URI matches what you configured in LinkedIn exactly (scheme, host, port, path — LinkedIn enforces strict equality).

6. Click **Connect**. You will be redirected to LinkedIn to authorize. After authorization, LinkedIn redirects back to DPF's callback route, which exchanges the code for tokens and stores them encrypted. Member display name + URN are captured from `/v2/userinfo`.

## What gets requested

- **Scopes:** `openid profile email w_member_social`. Nothing else. No company-page write, no ads access, no analytics. If you accidentally added other products to your LinkedIn app, they are inert from DPF's side — we only ever request these four scopes in the authorize URL.
- **Tokens at rest:** Access token + refresh token live in `IntegrationCredential.tokenCacheEnc` as a JSON blob, encrypted with AES-256-GCM under `CREDENTIAL_ENCRYPTION_KEY`. Rotating that env var invalidates stored tokens; reconnect to refresh them.

## What can be published

- A LinkedIn `OutboundDraft` (channelId `linkedin` or `linkedin-personal-social`, assetType `LinkedIn post`) that has been explicitly approved through the marketing approval queue on `/customer/marketing`.
- Maximum body length: 3000 chars (LinkedIn UGC commentary limit).
- One publish call writes one post. There is no batch publish in Phase 2.

## Failure modes

- **`linkedin_auth_failed` (401):** token expired or revoked. Disconnect + reconnect from the integration page.
- **`linkedin_insufficient_scope` (403):** the app is missing the `w_member_social` product or it hasn't been approved yet. Recheck LinkedIn app **Products**.
- **`linkedin_rate_limited` (429):** retry after the indicated cooldown. Personal posting limits apply (~25 posts/day, less depending on account standing).
- **`credential_not_connected`:** no `IntegrationCredential` row with `status=connected`. Complete the connect flow first.
- **`draft_not_approved`:** the draft is not in `approved` state. Approve it on the marketing page.

## Verifying without publishing live

Set `LINKEDIN_MOCK_MODE=1` in your install env to make the adapter return a synthetic `urn:li:share:mock_*` external id without calling LinkedIn. Useful for end-to-end test runs in dev / staging.

## Rotating the LinkedIn app

If you regenerate the LinkedIn client secret, click **Disconnect** in DPF, paste the new client id / secret, and reconnect. There is no in-place rotation — the OAuth flow restarts. This is intentional: a rotated secret means the prior refresh token is no longer valid anyway.
