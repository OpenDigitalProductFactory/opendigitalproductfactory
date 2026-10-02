---
status: active
---

# Portal Content-Security-Policy, report-only phase: implementation plan (BI-6CD83FD0)

**Design:** [portal CSP, report-only phase](../specs/2026-10-02-portal-csp-report-only-design.md)
**Backlog:** `BI-6CD83FD0` · epic `EP-E76E81D1` · workroom `WC-E362CDC1`
**Shape:** declared `delivery-medium@1.0.0`; the readiness gate raised it to large because the change is access-control sensitive. The baseline is the acceptance list in the backlog item.

## Delivery

One PR. The header without the endpoint would send reports nowhere, and the endpoint without the header would receive nothing. Tasks 1-4 map to `BI-6CD83FD0`. Task 5 is `BI-E7F94498` and is not in this PR.

### Task 1: policy module (test first)

- New `apps/web/lib/security/content-security-policy.ts`:
  - `type CspSurface = "shell" | "storefront"`.
  - `cspSurfaceForRoute(routeClass: RouteClass): CspSurface`: `Storefront` gives `storefront`, everything else gives `shell`.
  - `buildReportOnlyPolicy(surface, { isDevelopment })` returns the header value from the directive table in design §3.1.
  - `CSP_REPORT_PATH = "/api/csp-report"`, and the `Reporting-Endpoints` value.
  - `attachReportOnlyCsp(response, surface)` sets `Content-Security-Policy-Report-Only` and `Reporting-Endpoints`, and never sets `Content-Security-Policy`.
- Tests in `content-security-policy.test.ts`: both surfaces; `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'self'`, `worker-src 'self' blob:`; `img-src` has no `https:`, `http:` or `*`; `'unsafe-eval'` and `ws:` only in development; report target tagged with the surface; enforcing header never set.

### Task 2: proxy wiring (test first)

- `apps/web/proxy.ts`: compute the surface from `classifyRoute(pathname)` once, and route every return (canonical-host redirect, quiescence block, sandbox rewrite, public pass-through, legacy redirect, portal redirect and pass-through, protected API, sign-in redirect, shell pass-through) through one local `finish(response)` that calls `attachReportOnlyCsp`.
- Tests: extend `apps/web/proxy.test.ts`, or add `proxy.csp.test.ts` with `@/lib/auth` mocked so the wrapped handler can be called. Assert the header on a storefront page, a shell redirect for an anonymous user, a public API and a quiescence 503; assert no enforcing `Content-Security-Policy`.

### Task 3: report endpoint (test first)

- `apps/web/lib/storefront/storefront-middleware.ts`: classify `/api/csp-report` as `RouteClass.PublicApi`. Add the case to `proxy.test.ts`.
- New `apps/web/lib/security/csp-report.ts`: bounded stream body reader (16 KiB), parsers for `application/csp-report` and `application/reports+json` (batch cut at 20), field cut at 256 characters, URL reduced to origin plus path.
- New `apps/web/app/api/csp-report/route.ts`: `POST` only; rate limit with `checkRateLimit("csp-report:" + clientAddressKey(headers), true)`; 415, 413 and 429 through `apiErrorResponse`; one `console.warn` with `%s` placeholders and `sanitizeForLog` per report; 204.
- Tests: both formats; query strings stripped; CR/LF sanitised; 413; 415; 429; batch cut.

### Task 4: docs, gates

- `docs/install/platform-support-watchlist.md` D20 and a new row for `report-to` needing a secure context and for `upgrade-insecure-requests` on LAN HTTP installs.
- Gates: `pnpm --filter web typecheck`; vitest for the new and touched tests; `node scripts/check-module-size.mjs`; `pnpm run pregate`.
- Commit trailers: `Convergence-Impact-Decision:` the next portal image through `/ops/self-upgrade`; no migration, seed or config.

### Task 5 (not this PR): enforcement, `BI-E7F94498`

Nonces, the derived or proxied image allowlist, `form-action` and `upgrade-insecure-requests`, then switch to the enforcing header once report-only shows no legitimate violations.

## Acceptance (quoted from the backlog item)

- AC-1: Every portal response that passes through proxy.ts (pages, redirects, API, quiescence 503s) carries a Content-Security-Policy-Report-Only header built by the single policy module; storefront and shell surfaces get their own directive sets; img-src on both excludes arbitrary hosts.
- AC-2: Violations reach the report endpoint and are logged through sanitizeForLog with printf %s, with a bounded body size, bounded field lengths, a bounded batch size and a per-client rate limit.
- AC-3: Org branding, integration logos and storefront media still render: the header is Report-Only, never enforcing.

## Acceptance traceability

| AC | Tasks | Evidence |
|----|-------|----------|
| AC-1 | 1, 2 | policy module tests; proxy header tests |
| AC-2 | 3 | report endpoint tests |
| AC-3 | 1, 2 | tests asserting no enforcing header |

## Backlog coverage

| Deliverable | Backlog item |
|-------------|--------------|
| Tasks 1-4 | `BI-6CD83FD0` |
| Task 5 | `BI-E7F94498` |
