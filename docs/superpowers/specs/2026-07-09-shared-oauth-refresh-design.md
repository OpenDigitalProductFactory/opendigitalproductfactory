# Shared OAuth `refresh_token` exchange — design

- **Epic / BI:** EP-8DC217EB BET-3 opener · BI-ABC88965
- **Date:** 2026-07-09
- **Status:** implemented (opener increment)
- **Blessed home:** `@dpf/integration-shared` (`packages/integration-shared/src/oauth-refresh.ts`)

## Problem

Provider integrations each hand-rolled their own `token-client.ts`: a ~110–150 LOC
module implementing the identical RFC-6749 `refresh_token` grant over undici
`request` — build a form-encoded body, POST it, walk the same status ladder,
guard JSON + payload, and map to `{ accessToken, refreshToken, tokenType,
expiresAt }`. The exchange logic was copy-pasted; only a handful of axes actually
differed between providers. Copy N+1 was the default, and a fix to the exchange
had to be applied N times.

## What consolidated (2 refresh clones → 1 canonical home)

The refresh-token exchange now has a single home:

```ts
import { refreshOAuthToken } from "@dpf/integration-shared";
```

Migrated onto it as thin wrappers (exported names, param/result interfaces,
error classes, and `resolveXTokenEndpoint()` all unchanged — callers untouched):

- `apps/web/lib/integrate/quickbooks/token-client.ts`
- `apps/web/lib/integrate/google-marketing-intelligence/token-client.ts`

Each vendor file now declares only its own `XAuthError` class, its endpoint
resolver, and a wrapper that passes a `makeError` factory + the vendor's exact
message wording into `refreshOAuthToken`, then maps the generic result to its
own result shape. The raw undici request, status ladder, and payload mapping are
gone from the vendor files.

> **Scope note.** The prompt framed this as "5 near-clone refresh_token clients",
> but reading the files showed only **2** implement the `refresh_token` grant
> (QuickBooks, Google). The other three — `microsoft365-communications`,
> `apps/web` ADP, and the `services/adp` port — implement the **`client_credentials`**
> grant: a different flow with no refresh token, and (for ADP) mTLS dispatcher
> construction, harness-transport headers, and network-error `errorCode`
> extraction. Forcing them through a `refreshToken`-required, `grant_type=refresh_token`
> helper would break the contract or change behavior, so they are a **sibling
> increment**, not this one. `provider-oauth.ts` also refreshes tokens but over
> `fetch` (not undici) as a provider-agnostic DB flow — out of scope.

## The config-object variation axes

`OAuthRefreshConfig` captures every axis that legitimately differed:

| Axis | Field | QuickBooks | Google |
| --- | --- | --- | --- |
| Credential placement | `credentialPlacement` | `basic-header` (Base64 `id:secret`) | `body` (`client_id`/`client_secret` params) |
| Invalid-credential statuses | `authErrorStatuses` (default `[401,403]`) | default | `[400,401,403]` |
| Distinct ≥500 branch | `serverErrorMessage` | set (distinct message) | omitted (falls to generic non-200) |
| Rotated refresh token required | `requireRefreshToken` (default false) | `true` | `false` (result maps to `null`) |
| Scope returned | (result `scope: string \| null`) | ignored | mapped, `null → ""` preserved |
| Endpoint (+ env override) | `endpoint` (resolver stays in vendor file) | `QUICKBOOKS_TOKEN_ENDPOINT_URL` | `GOOGLE_TOKEN_ENDPOINT_URL` |
| Error class + wording | `makeError` + `*Message` fields | `QuickBooksAuthError` | `GoogleMarketingAuthError` |
| Extra body params | `extraBodyParams` | — | — |

Constant, non-varying behavior lives in the helper: the exact status-handling
order (network → auth → ≥500 → non-200 → JSON → payload), `safelyDrainBody` on
every status-based error path, tolerant `expires_in` parse (`number` |
numeric-string | default `3600`, then `Math.max(1, …)`), and default
`token_type` of `"Bearer"`.

## Behavior-preservation constraint

No caller-observable behavior changes. Each vendor keeps its own `Error`
subclass (via `makeError`) and its exact message strings; the wrappers map the
generic `OAuthRefreshResult` back to each vendor's historic result shape
(QuickBooks keeps `refreshToken`; Google keeps `scope` with its `""` default and
drops the refresh token). All four existing vendor `token-client.test.ts` suites
and the QuickBooks/Google-business-profile connect-action + preview suites stay
green untouched.

One extension over the prompt's interface sketch: an `unexpectedStatusMessage(statusCode)`
field was added, because both vendors emit a provider-prefixed
"`<Vendor>` token exchange failed with status N" message on the generic non-200
branch and the sketched interface had no field for it.

Two intentional leniency unifications (prescribed by the shared-result contract,
unreachable in tested/realistic inputs): under the shared helper QuickBooks now
defaults an absent `token_type`/`expires_in` instead of rejecting, and rejects a
literal empty-string `access_token`. No caller or test exercises these edges.

## The ratchet

`scripts/check-no-local-oauth-refresh.mjs` (+ `.test.mjs` self-test) freezes the
copy count. A file is a violation when it BOTH builds a `grant_type=refresh_token`
body AND calls undici `request`, anywhere in `apps/web/lib` / `services` /
`packages` outside the canonical `packages/integration-shared/src/oauth-refresh.ts`.
The `client_credentials` grant and `fetch`-based refresh are not matched. The
`ALLOWLIST` is **empty** — the migrated wrappers no longer hold a raw request.
The BI-3B0AD9CF guard loop auto-discovers `scripts/check-no-*.mjs`; no ci.yml or
package.json edit is needed.

## Landed in increment 2 (BI-ABC88965) — `client_credentials` consolidation

The two-legged `client_credentials` grant now has its own canonical home,
mirroring the opener:

```ts
import { exchangeClientCredentials } from "@dpf/integration-shared";
```

`packages/integration-shared/src/client-credentials.ts` (+ `.test.ts`) reproduces
the opener's structure and invariants exactly — same status ladder (network →
auth → ≥500 → non-200 → JSON → payload), `safelyDrainBody` on every status-based
error path, tolerant `expires_in` (`number` | numeric-string | default `3600`,
`Math.max(1, …)`), default `token_type` `"Bearer"` — differing only where the
grant differs: credentials are always in the body (no Basic-header variant), an
optional `scope` param replaces `refresh_token`, and the network-error path
forwards the caught error's `code` as `errorCode` (for ADP's mTLS-handshake
message). The auth-status default is `[400, 401, 403]`.

Migrated onto it as thin wrappers (exported names, param/result interfaces, error
classes, and `resolveXTokenEndpoint()` unchanged — callers untouched):

- `apps/web/lib/integrate/microsoft365-communications/token-client.ts` — keeps
  its `scope` default (`https://graph.microsoft.com/.default`), tenant-scoped
  endpoint resolver, `Microsoft365CommunicationsAuthError`, and `tokenType` in
  the result.
- `apps/web/lib/integrate/adp/token-client.ts` — **keeps its mTLS `undici.Agent`
  construction** (built from `certPem`+`privateKeyPem`) in the wrapper and passes
  it as `dispatcher`; keeps `AdpAuthError` with its `errorCode` (populated on the
  handshake path via the shared helper's forwarded network `code`); maps the
  generic result down to `{ accessToken, expiresAt }`.

Both wrappers pass `authErrorStatuses: [401, 403]` explicitly to preserve their
historic behavior (only 401/403 were invalid-creds; the shared default of
`[400,401,403]` would newly capture 400). Two intentional leniency unifications,
unreachable in tested/realistic inputs: under the shared helper an absent
`token_type` defaults to `"Bearer"` (ms365 previously required it), and a
non-positive `expires_in` clamps to 1s rather than ADP's 3600 default. No caller
or test exercises these edges. All existing ms365/ADP `token-client.test.ts` +
connect-action/preview suites stay green untouched.

The ratchet `scripts/check-no-local-client-credentials.mjs` (+ `.test.mjs`, +
guard-loop auto-discovery) freezes the copy count: a violation builds a
`grant_type=client_credentials` body AND calls undici `request` outside the
canonical home.

**Documented follow-on (allowlisted with rationale):**
`services/adp/src/lib/token-client.ts` — the standalone service port — is NOT
migrated in this increment. It injects a harness-transport header
(`X-DPF-Harness-Session` via `getHarnessRequestHeaders`) and selects its
dispatcher through `isHarnessTransport(url)`. The harness *header* has no
representation in `ClientCredentialsConfig` (which exposes only extra *body*
params), so migrating it would either expand the increment-2 contract or drop
the header — a behavior change to the integration harness. It is left as a
documented follow-on to be migrated when the shared helper grows an
extra-headers axis.

## Remaining BET-3 tail (later increments under BI-ABC88965)

- **`services/adp` port** — migrate once the shared helper grows an extra-header
  axis for the `X-DPF-Harness-Session` harness transport (see above).
- **~16 `*ApiError` classes** — the per-vendor error class is itself a clone
  family; a shared base (still per-vendor `name`) is a candidate.
- **~20 undici clients** — the accounting/probe/list clients repeat the same
  request + status-ladder + JSON-guard shape.
- **12 connect-actions** — the connect/validate/persist server-action shape
  repeats per provider.
- **credential-crypto implemented twice** — `@dpf/integration-shared`
  credential-crypto vs `apps/web/lib/govern/credential-crypto.ts`.
