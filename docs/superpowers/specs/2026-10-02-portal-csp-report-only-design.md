---
status: draft
---

# Portal Content-Security-Policy, report-only phase: design (BI-6CD83FD0)

| Field | Value |
|-------|-------|
| **Created** | 2026-10-02 |
| **Author** | Claude Opus 5.5 for Mark Bodman |
| **Backlog** | `BI-6CD83FD0` (P3) · epic `EP-E76E81D1` |
| **Builds on** | `BI-94E08D68` (PR #5863): the shared markdown renderer (`apps/web/lib/shared/markdown.ts`) renders no off-origin image by default |
| **Follow-up** | `BI-E7F94498`: enforce the policy (nonces, derived or proxied image allowlist, flip to enforcing) |
| **Out of scope** | Enforcement of any directive. Nonces. An allowlist of operator-configured image hosts. |

## 1. Problem

The portal sends no Content-Security-Policy. `apps/web/next.config.mjs` declares no `headers()`, and `apps/web/proxy.ts` sets none. Only `app/api/docs-asset` and `lib/auth/oauth-consent-page.ts` set a policy, and only on their own responses.

`BI-94E08D68` closed the markdown-image exfiltration channel inside the renderer. Nothing in the browser backs that up. A future renderer, or a raw `<img>` that takes model or user text, could load an attacker-chosen URL and leak data in its query string. A CSP `img-src` and `connect-src` is the browser-enforced backstop.

A strict policy cannot be switched on today. The portal shows images from hosts that operators configure, and those hosts cannot be known at build time:

| Image | Source of the URL | Code |
|-------|-------------------|------|
| Org logo | Organization branding | `components/shell/Header.tsx`, `components/admin/BrandingPreview.tsx`, `components/storefront/StorefrontNav.tsx` |
| Integration / MCP logo | Integration catalogue `logoUrl` | `components/platform/IntegrationCard.tsx`, `components/platform/ServiceCard.tsx` |
| Storefront media | Storefront configuration | `components/storefront/**` |
| Google Business Profile thumbnail | GBP API `thumbnailUrl` | `app/(shell)/platform/tools/integrations/google-business-profile/page.tsx` |
| Build Studio screenshot | Runtime target `screenshotUrl` | `components/build/ReviewPanel.tsx` |

An enforcing `img-src 'self'` would break all five.

## 2. What this item delivers

The report-only phase:

1. One policy module, `apps/web/lib/security/content-security-policy.ts`. It is the only place the directives are written.
2. A `Content-Security-Policy-Report-Only` header on every response that passes through `proxy.ts`: pages, redirects, API responses and quiescence 503s. The storefront (`/s/**`) and the authenticated shell get separate directive sets, chosen with the existing `classifyRoute`.
3. A same-origin violation report endpoint that accepts both report formats, bounds what it reads, rate-limits per client, and logs safely.

Nothing is enforced. Report-only cannot block a load, so every image in the table above keeps rendering.

## Objectives and acceptance

Quoted from the backlog item:

- **AC-1:** Every portal response that passes through `proxy.ts` (pages, redirects, API, quiescence 503s) carries a `Content-Security-Policy-Report-Only` header built by the single policy module; storefront and shell surfaces get their own directive sets; `img-src` on both excludes arbitrary hosts.
- **AC-2:** Violations reach the report endpoint (`report-uri` `application/csp-report` and `report-to` `application/reports+json`) and are logged through `sanitizeForLog` with printf `%s`, with a bounded body size, bounded field lengths, a bounded batch size and a per-client rate limit.
- **AC-3:** Org branding, integration logos and storefront media still render: the header is Report-Only, never enforcing, and tests assert that no enforcing `Content-Security-Policy` header is emitted.

Zero legitimate violations before enforcement is the entry condition of `BI-E7F94498`, not of this item.

## 3. Design choices and their reasons

### 3.1 The policy

| Directive | Shell | Storefront | Why |
|-----------|-------|------------|-----|
| `default-src` | `'self'` | `'self'` | Baseline. |
| `script-src` | `'self' 'unsafe-inline'` (+ `'unsafe-eval'` in development) | same | Next.js emits inline bootstrap scripts, and `app/layout.tsx` has an inline boot script. Next reads a nonce only from the enforcing `Content-Security-Policy` request header, so a nonce in a report-only policy would report every framework script. Nonces move to `BI-E7F94498`. |
| `style-src` | `'self' 'unsafe-inline'` | same | Tailwind, React `style` props and the branding `<style>` blocks in the shell, portal and storefront layouts. |
| `img-src` | `'self' data: blob:` | `'self' data: blob:` | No arbitrary hosts. Reports from the five sources above become the inventory the enforcement item needs. |
| `connect-src` | `'self'` (+ `ws:` in development for HMR) | same | Server-sent events and fetches are same-origin. |
| `font-src` | `'self' data:` | same | No font CDN. |
| `worker-src` | `'self' blob:` | same | MapLibre builds its worker from `/api/map-assets/runtime/` (watchlist D20). |
| `media-src` | `'self' blob:` | same | Voice recording and playback. |
| `frame-src` | `'self'` | same | The portal embeds no iframes today. |
| `object-src` | `'none'` | `'none'` | No plugins. |
| `base-uri` | `'self'` | `'self'` | Stops `<base>` hijacking of relative URLs. |
| `frame-ancestors` | `'self'` | `'self'` | Nothing embeds the portal in another origin; there is no `X-Frame-Options` today. Report-only honours this directive. |
| `report-uri` / `report-to` | tagged `shell` | tagged `storefront` | Reports say which surface produced them. |

`form-action` and `upgrade-insecure-requests` are left out. When enforced, `form-action 'self'` blocks the OAuth redirect chain, and `upgrade-insecure-requests` breaks installs served over plain HTTP on a LAN. Report-only ignores `upgrade-insecure-requests` anyway. Both are decisions for `BI-E7F94498`.

The two surfaces start with the same directives. They are separate so the enforcement item can tighten the shell without touching storefront media, and so a report says which surface it came from.

### 3.2 Where the header is set

`proxy.ts` already decides every route through `classifyRoute` and wraps every response in `attachVersionHeaders`. The header is attached at the same points through one helper, so redirects and quiescence 503s carry it too. `next.config.mjs` `headers()` was rejected: it cannot import the TypeScript module, and it cannot tell storefront from shell without a second copy of the route rules.

The matcher already skips `_next/static`, `_next/image` and `favicon.ico`. A CSP on a script or image file has no effect, so skipping them loses nothing.

### 3.3 The report endpoint

`POST /api/csp-report`. It is added to `RouteClass.PublicApi` in `lib/storefront/storefront-middleware.ts`, because browsers send reports without a session and the storefront is public. Today `/api/**` would fall through as `ProtectedApi`, which also passes through; naming it public makes the intent explicit.

- **Formats:** `application/csp-report` (legacy `report-uri`, used by Firefox and on plain-HTTP installs where the Reporting API is unavailable) and `application/reports+json` (Reporting API batches). Other content types get 415.
- **Bounds:** the body is read as a stream and cut off at 16 KiB (413). A batch is cut at 20 reports. Each logged field is cut at 256 characters. URLs are reduced to origin plus path, so query strings, which may carry tokens, are never logged.
- **Rate limit:** `checkRateLimit` from `lib/api/rate-limit.ts` (30 per minute), keyed on `csp-report:` plus `clientAddressKey` from `lib/security/client-address.ts`. Over the limit: 429 through `apiErrorResponse`.
- **Logging:** one `console.warn("[csp-report] surface=%s directive=%s blocked=%s document=%s", ...)` line per report, each value through `sanitizeForLog`. It lands in the existing container log stream. No new table and no new dependency.
- **Response:** 204.

## 4. Research & Benchmarking

| Source | What it does | DPF adopts | DPF rejects |
|--------|--------------|------------|-------------|
| Next.js 16 CSP guide (installed `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) | Nonces from the proxy with `'strict-dynamic'`; a no-nonce variant with `'unsafe-inline'`; `'unsafe-eval'` only in development | Setting the header in the proxy; the no-nonce directive set; the development-only `'unsafe-eval'` | Nonces in this phase, because Next reads them only from the enforcing header |
| OWASP Content Security Policy Cheat Sheet | Roll out with Report-Only first, then enforce; `object-src 'none'`; restrict `base-uri`; prefer nonces | Report-only first; the baseline directives | None |
| W3C CSP Level 3 and Reporting API (MDN) | `report-to` with `Reporting-Endpoints` in secure contexts; legacy `report-uri` with `application/csp-report` | Both, so HTTP installs and Firefox still report | None |
| GitLab | CSP configurable, with a report URI, before it is enforced | Report-only phase with a same-origin collector | A third-party report collector (absorb, don't adopt) |
| Mastodon | Builds its policy in one initializer from configured asset and media hosts | One policy module; deriving image hosts from configuration (in `BI-E7F94498`) | A blanket `https:` image source |

## 5. Security and privacy

- The endpoint is unauthenticated by design. A caller can only write bounded, sanitised, rate-limited log lines.
- Query strings are stripped before logging, because a blocked URL may be the exfiltration attempt and may carry data.
- The endpoint stores nothing and returns nothing.
- The in-memory rate limiter resets on restart and is per process, as it already is for the API (`lib/api/rate-limit.ts`).

## 6. Verification

- Unit tests for the policy module: both surfaces; required directives present; no arbitrary host in `img-src`; development additions only in development; the report endpoint is the target.
- Proxy tests: the Report-Only header is on page, redirect and API responses for storefront and shell routes, and no enforcing `Content-Security-Policy` header is emitted.
- Endpoint tests: both formats parsed and logged; query strings stripped; control characters sanitised; 413 over the size limit; 415 for other types; 429 over the rate limit; batch cut at 20.
- Typecheck, module-size check, local CI gate.

## 7. Documentation impact

- `docs/install/platform-support-watchlist.md` D20: record that the report-only policy carries `worker-src 'self' blob:`, and add the host-coupled notes on `report-to` needing a secure context and on `upgrade-insecure-requests` and LAN HTTP installs.
- The operations-facing description of the `[csp-report]` log line goes with the watchlist entry. No user-facing docs change: nothing a user sees changes.

## 8. Convergence

Installs pick this up with the next portal image through `/ops/self-upgrade`. No migration, no seed and no configuration change.
