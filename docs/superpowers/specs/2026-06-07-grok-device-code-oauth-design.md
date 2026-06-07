# Grok (xAI) Device-Code OAuth for Build Studio Dispatch

| Field | Value |
| ----- | ----- |
| Status | Draft — slice 1 implemented (backend) |
| Date | 2026-06-07 |
| Epic | EP-GROK-001 (first-class Grok support) |
| Motivation | Operators (incl. non-technical founders) cannot easily find/obtain an xAI API key. Grok's CLI ships a clean OAuth path; prefer it. |
| Related | `codex-dispatch.ts` (injectCodexAuth — the mirror), `github-oauth.ts`/`github-device-flow.ts` (existing RFC 8628 device-code precedent), #1606 (EP-GROK-001), #1613 (sandbox install fix) |

## Problem

Build Studio's `grok` dispatch engine authenticates with `XAI_API_KEY`. Getting that
key means hunting through `console.x.ai` — a poor experience, especially for the
non-technical operator. xAI's Grok Build CLI instead supports a standard **OAuth 2.0
device-code** flow (`grok login --device-auth` → `accounts.x.ai/oauth2/device`) that lets
you sign in with the account method you already use (Google / X / Apple) and is explicitly
built "for headless/remote environments." This is cleaner and is the preferred path.

## Approach (B): drive Grok's own device-code flow, store + inject the token

Rather than reimplement xAI's OAuth in-portal (which would need Grok's private OAuth
`client_id`), we **drive the Grok CLI's own `grok login --device-auth`** and capture the
resulting credential — reusing Grok's OAuth client and self-refresh. The token lands in
`~/.grok/auth.json`, structurally analogous to Codex's `~/.codex/auth.json`, so the
sandbox-injection side mirrors `injectCodexAuth` exactly.

Verified empirically (grok 0.2.32 in a node:24-alpine + gcompat container):
- `grok login --device-auth` emits `https://accounts.x.ai/oauth2/device?user_code=XXXX-XXXX`, then blocks "Waiting for authorization…".
- On success it writes `~/.grok/auth.json`.
- Headless dispatch with that credential reaches `https://api.x.ai/v1/responses`.

### Flow
1. **startGrokDeviceLogin()** — runs `grok login --device-auth` detached in the sandbox
   (the only place the `grok` binary lives), as the `node` user, and returns the
   verification URL + user code.
2. Operator opens the URL, signs in (Google/X/Apple), confirms the code.
3. **completeGrokDeviceLogin()** — reads `~/.grok/auth.json` out of the sandbox, stores it
   encrypted as the `xai` credential (`CredentialEntry.cachedToken`), and calls
   `activateProvider("xai", { authMethod: "oauth2_device" })`.
4. **Dispatch (ensureGrokAuth)** — when the stored credential is an `auth.json` blob,
   inject it into each build sandbox's `~/.grok/auth.json` (node user) and let the CLI
   self-refresh; otherwise fall back to `XAI_API_KEY`.

### Substrate reused vs. added
| Reused | Added |
| --- | --- |
| `CredentialEntry` (cachedToken/status), `encryptSecret`, `getDecryptedCredential` | `oauth2_device` in xai `supportedAuthMethods` |
| `activateProvider(...)` activation path | `lib/actions/grok-device-login.ts` (start/complete) |
| `injectCodexAuth` injection pattern | `ensureGrokAuth` OAuth/api-key branch (grok-dispatch.ts) |
| RFC 8628 precedent (github device flow) | — |

## Slice 1 (this PR) — backend
- `providers-registry.json`: xai `supportedAuthMethods += oauth2_device`.
- `grok-dispatch.ts`: `ensureGrokAuth` returns a mode; injects `~/.grok/auth.json` for OAuth, `XAI_API_KEY` otherwise; runner script branches.
- `lib/actions/grok-device-login.ts`: `startGrokDeviceLogin` + `completeGrokDeviceLogin`.

## Slices (status)
- **Slice 2 — operator UX** ✅ (#1622): "Sign in to Grok" card on the xAI provider page —
  start → shows URL+code → polls complete.
- **Slice 3 — AI-Coworker control** ✅ (#1624): `grok_signin_start` / `grok_signin_status`
  MCP tools over the shared auth-free core, so the Coworker can drive setup.
- **Slice 4 — refresh durability** ✅ (this PR): after an OAuth-mode dispatch run,
  `grok-dispatch` reads the (possibly CLI-refreshed) `~/.grok/auth.json` back out of the
  ephemeral build sandbox and persists it to the stored xAI credential, so the next build
  injects the latest token instead of the original (which would eventually go stale).
  Last-write-wins under concurrent builds; rotating-refresh-token concurrency is the one
  remaining edge (acceptable today — non-rotating tokens just refresh again next run).

## Open items / constraints
- Requires the grok-equipped sandbox image (#1613).
- Device-code OAuth uses a **SuperGrok / X Premium+ subscription** (subscription billing),
  vs. the API key's usage billing. Both remain supported; OAuth is opt-in.
- **Functional verification is gated on a real Grok sign-in** (operator completes the
  browser step). Slice 1 is verified structurally (typecheck) and the flow was confirmed
  in-container up to the authorization wait + the dispatch API call.

## Principles
`zero-click-provider-setup`, `bundled-services-active-by-default`,
`verify-substrate-before-proposing-new`, "AI Coworker as the conduit".
