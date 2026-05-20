# Portal Canonical-URL Middleware Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Eliminate per-origin browser-storage divergence in the DPF portal by 301-redirecting non-canonical hosts to a configured `PUBLIC_URL`, with optional LAN alias bypass, sending `Clear-Site-Data: "storage"` on the first redirect.

**Architecture:** A new `apps/web/middleware.ts` (Next.js Edge middleware) inspects the incoming `Host` (or `X-Forwarded-Host`) header on every request, compares it to a canonical host derived from `PUBLIC_URL` plus an optional `PUBLIC_URL_ALIASES` comma-separated allow-list, and issues a 301 redirect to the canonical origin when it does not match. When `PUBLIC_URL` is unset, the middleware passes through unchanged (Gitea `PUBLIC_URL_DETECTION=auto` pattern — required for local dev and bootstrap-before-DNS). Pure host-matching logic lives in a separate testable helper (`apps/web/lib/canonical-host.ts`) so it can be unit-tested without spinning up Next.

**Tech Stack:** Next.js 16 Edge Middleware, TypeScript, vitest, monorepo (`apps/web` package). No new runtime dependencies. DCO sign-off (`git commit -s`) required on every commit.

---

## Industry-Best-Practice Anchors

This plan implements the convergent pattern from mature self-hosted apps. Cite these in PR description:

- **Discourse** — `DISCOURSE_HOSTNAME` is required; NGINX 301s every other host to it.
- **Mattermost** — `SiteURL` is canonical for emails, OAuth callbacks, push.
- **Gitea** — `ROOT_URL` + `PUBLIC_URL_DETECTION=auto` (trust `Host`+`X-Forwarded-Proto` when `ROOT_URL` is unset) — the bootstrap-before-DNS pattern we adopt.
- **Home Assistant** — `internal_url` / `external_url` (one each); alias-bypass concept comes from here.
- **Auth.js v5** — `trustHost: true` infers origin from request headers. Portal already uses this (`apps/web/lib/govern/auth.ts:110`).
- **OWASP / RFC 6265** — Cookies must not set `Domain=` on IP literals. Current portal cookie config is clean (host-only). `Clear-Site-Data: "storage"` per OWASP cheat sheet for origin migration.

---

## Existing Substrate (DO NOT DUPLICATE)

- **`apps/web/lib/portal-url.ts`** — Already exports `getStablePortalUrl()` (env-driven, used for OAuth + emails) and `getPortalUrl()` (per-request, header-driven). The middleware **reuses** these — do not reinvent.
- **`apps/web/lib/govern/auth.ts:106-107`** — Already reads `PUBLIC_URL` for HTTPS detection. Same env var, same semantic.
- **`.env.example`** — Currently has no `PUBLIC_URL` entry. Plan adds it (+ `PUBLIC_URL_ALIASES`).
- **`.env.docker.example`** — Plan updates if `PUBLIC_URL` is referenced there.
- **`apps/web/vitest.config.ts`** — Standard vitest config; loads `.env` then `.env.local`. New tests follow existing `*.test.ts` co-location pattern.
- **No existing `middleware.ts`** in `apps/web` — confirmed via Glob. Creating it is greenfield (no integration risk with existing middleware logic).

---

## Out of Scope (Deferred Slices)

These were identified in the audit but are NOT addressed here:

- Slice 2: Promote coworker `executionMode` + external-access flag from `sessionStorage` to DB (`AgentThread` / `User` columns).
- Slice 3: Optimistic-message durability (write pending messages as `status=pending`).
- Slice 4: Full cookie `Domain=` audit sweep (audit already shows current config is clean).

---

## Task 1: Pure host-matching helper

**Files:**
- Create: `apps/web/lib/canonical-host.ts`
- Test:   `apps/web/lib/canonical-host.test.ts`

This is a pure function with no Next dependencies — fast to unit test, easy to reason about.

**Exports:**

```typescript
export type CanonicalHostConfig = {
  canonicalUrl: string | undefined;     // process.env.PUBLIC_URL
  aliases: string;                       // process.env.PUBLIC_URL_ALIASES (comma-separated raw)
};

export type HostMatch =
  | { kind: "passthrough"; reason: "no-canonical-configured" | "host-matches-canonical" | "host-matches-alias" | "no-host-header" }
  | { kind: "redirect"; targetUrl: string };

/** Decide whether a request should be redirected to canonical or passed through.
 *
 *  Rules (Gitea PUBLIC_URL_DETECTION=auto + Home Assistant alias bypass):
 *  - If canonicalUrl is unset/empty → passthrough (bootstrap-before-DNS).
 *  - Compare `host` (host:port) to the host:port from canonicalUrl, case-insensitive.
 *    Match → passthrough.
 *  - Compare `host` to each entry in `aliases` (comma-separated, trimmed,
 *    case-insensitive). Match → passthrough.
 *  - Otherwise → redirect to `${canonicalUrl}${path}${search}` preserving path+query.
 *  - If `host` is missing → passthrough (defensive; rare). */
export function decideHostMatch(args: {
  host: string | null | undefined;
  path: string;
  search: string;
  config: CanonicalHostConfig;
}): HostMatch;
```

**Implementation notes:**
- Use `new URL(canonicalUrl).host` to extract host:port. Catches malformed `PUBLIC_URL` early — wrap in try/catch and return passthrough on parse failure (do not crash the app for a typo in env).
- Aliases are raw host:port strings (e.g. `192.168.1.10:3000,portal.local`). Split on comma, trim, drop empties. Case-insensitive compare.
- Do NOT normalize trailing slashes here — middleware handles path concat.

- [ ] **Step 1: Write failing tests for `decideHostMatch`** covering:
  - `canonicalUrl` unset → `passthrough` / `no-canonical-configured`
  - `canonicalUrl=""` (empty string) → `passthrough` / `no-canonical-configured`
  - `host` null → `passthrough` / `no-host-header`
  - `host=portal.example.com`, `canonicalUrl=https://portal.example.com` → `passthrough` / `host-matches-canonical`
  - `host=PORTAL.EXAMPLE.COM`, `canonicalUrl=https://portal.example.com` → `passthrough` (case-insensitive)
  - `host=portal.example.com:3000`, `canonicalUrl=https://portal.example.com:3000` → `passthrough` (port match)
  - `host=portal.example.com`, `canonicalUrl=https://portal.example.com:3000` → `redirect` (port mismatch is a different origin)
  - `host=192.168.1.10:3000`, `canonicalUrl=https://portal.example.com`, `aliases=192.168.1.10:3000` → `passthrough` / `host-matches-alias`
  - `host=192.168.1.10:3000`, aliases includes whitespace `" 192.168.1.10:3000 , portal.local "` → `passthrough` (trimming)
  - `host=localhost:3000`, `canonicalUrl=https://portal.example.com`, no alias → `redirect` targetUrl = `https://portal.example.com/foo?bar=1` (path+search preserved)
  - `host=localhost:3000`, root path `/`, no search → targetUrl = `https://portal.example.com/`
  - Malformed `canonicalUrl=":://broken"` → `passthrough` (graceful)
  - IPv6 literal: `host=[::1]:3000`, `canonicalUrl=http://[::1]:3000` → `passthrough` (URL host bracket-stripping handled correctly)
- [ ] **Step 2: Run tests to verify they fail** — `cd apps/web && pnpm exec vitest run lib/canonical-host.test.ts`
- [ ] **Step 3: Implement `apps/web/lib/canonical-host.ts`** matching the contract above. Add a brief top-of-file comment explaining the Gitea/Home Assistant inspiration (one paragraph, follow style of `portal-url.ts`).
- [ ] **Step 4: Run tests to verify all pass**
- [ ] **Step 5: `git add` the two files and commit** with message `feat(portal): add canonical-host matcher for multi-origin redirect (slice 1/4 of multi-origin remediation)` — include `Signed-off-by:` via `git commit -s`.

---

## Task 2: Next.js middleware wiring

**Files:**
- Create: `apps/web/middleware.ts`
- Test:   `apps/web/middleware.test.ts`

**Behavior:**
1. Read `host` from `req.headers.get('x-forwarded-host') ?? req.headers.get('host')` (same precedence as `portal-url.ts:52`).
2. Call `decideHostMatch({ host, path: req.nextUrl.pathname, search: req.nextUrl.search, config: { canonicalUrl: process.env.PUBLIC_URL, aliases: process.env.PUBLIC_URL_ALIASES ?? "" } })`.
3. On `passthrough` → `NextResponse.next()`.
4. On `redirect` → build response with `NextResponse.redirect(targetUrl, 301)`, then **mutate the returned response** to attach the header: `response.headers.set("Clear-Site-Data", '"storage"')`. The value MUST be the quoted string `"storage"` per the W3C Clear-Site-Data spec — directives are quoted-string values, not bare tokens. Setting headers after the redirect is constructed (not via init options) avoids Next stripping them during redirect normalization.

**Exclusions (Next `config.matcher`):**

```typescript
export const config = {
  matcher: [
    // Run on every request EXCEPT Next internal paths, static files, and health probes.
    // Health-probe exclusion is critical: load balancers hit /api/health on the LAN IP;
    // redirecting them would fail the probe and take the deploy down.
    "/((?!_next/static|_next/image|favicon.ico|api/health|api/healthz|api/ready).*)",
  ],
};
```

- [ ] **Step 1: Write failing middleware tests** in `apps/web/middleware.test.ts`. Use Next 16's `NextRequest` from `next/server`. Cover:
  - `PUBLIC_URL` unset → `next()` returned (i.e. no redirect response)
  - `PUBLIC_URL=https://portal.example.com`, request to `https://portal.example.com/foo` → passthrough
  - `PUBLIC_URL=https://portal.example.com`, request from `http://192.168.1.10:3000/foo` → 301 to `https://portal.example.com/foo`, response has `Clear-Site-Data` header with value exactly `"storage"` (quoted)
  - `PUBLIC_URL=https://portal.example.com`, `PUBLIC_URL_ALIASES=192.168.1.10:3000`, request from `192.168.1.10:3000` → passthrough
  - `X-Forwarded-Host` is preferred over `Host` (reverse-proxy scenario)
  - Query string preserved: `/foo?bar=1&baz=2` → target ends with `/foo?bar=1&baz=2`
  - Env var management in tests: save/restore `process.env.PUBLIC_URL` and `process.env.PUBLIC_URL_ALIASES` per test (use `beforeEach`/`afterEach`).
- [ ] **Step 2: Run tests to verify they fail** — `cd apps/web && pnpm exec vitest run middleware.test.ts`
- [ ] **Step 3: Implement `apps/web/middleware.ts`** with the wiring above. Top-of-file comment paragraph: why this exists (point at audit + Gitea/Discourse pattern), why exclusions matter (health probe LB), why `PUBLIC_URL` unset means passthrough (bootstrap-before-DNS).
- [ ] **Step 4: Run tests to verify all pass**
- [ ] **Step 5: Commit** — `feat(portal): canonical-URL middleware with Clear-Site-Data on redirect` with DCO sign-off.

---

## Task 3: Documentation — env vars

**Files:**
- Modify: `.env.example` (add `PUBLIC_URL` and `PUBLIC_URL_ALIASES` documented entries)
- Modify: `.env.docker.example` (same)
- Modify: `docs/install/cloud-single-vm.md` if it documents `PUBLIC_URL` (verify first; only modify if relevant section exists)

**Content for `.env.example`** (insert near the Auth.js block since it's the same env semantic):

```bash
# ── Canonical Portal URL ─────────────────────────────────
# The externally-reachable base URL for this portal install.
# Used for:
#   - OAuth callbacks (must match what's registered with the provider)
#   - Outbound email/webhook URLs
#   - Canonical-host redirect middleware (apps/web/middleware.ts):
#     non-matching origins (e.g. http://192.168.x.x:3000) are 301'd here
#     with Clear-Site-Data so per-origin browser caches flush.
# Leave unset for local dev — middleware passes through and any Host works.
# PUBLIC_URL="https://portal.example.com"

# Optional comma-separated allow-list of additional host:port values the
# middleware should accept WITHOUT redirecting (LAN bypass / mDNS access).
# Useful when admins want to keep LAN access alive even after setting a
# canonical domain (Home Assistant internal_url pattern).
# PUBLIC_URL_ALIASES="192.168.1.10:3000,portal.local"
```

- [ ] **Step 1: Update `.env.docker.example`** — grep for existing `PUBLIC_URL` references first; mirror the doc block where they exist. If `PUBLIC_URL` is absent today, add it explicitly — Docker installs are the primary multi-origin scenario (this is where the middleware earns its keep).
- [ ] **Step 2: Verify `docs/install/cloud-single-vm.md`** — read; if `PUBLIC_URL` is mentioned, append a paragraph on alias bypass + redirect behavior. If not mentioned, skip (do not bloat).
- [ ] **Step 3: Apply the doc edits**
- [ ] **Step 4: Commit** — `docs(portal): document PUBLIC_URL + PUBLIC_URL_ALIASES for canonical-host middleware` with DCO sign-off.

---

## Task 4: Build gate verification

Per AGENTS.md §5, work is not complete until all four gates pass.

- [ ] **Step 1: Run unit tests for affected files** — `cd apps/web && pnpm exec vitest run lib/canonical-host.test.ts middleware.test.ts`. Expect: all pass.
- [ ] **Step 2: Run full vitest suite** — `cd apps/web && pnpm exec vitest run`. Expect: no new failures (some pre-existing failures may be present; note them in PR if observed but do not fix in this slice).
- [ ] **Step 3: Run typecheck** — `pnpm --filter web typecheck`. Expect: zero new errors.
- [ ] **Step 4: Run production build** — `cd apps/web && pnpm exec next build`. Expect: zero errors. The middleware file is special in Next 16 — surface any build complaints immediately.
- [ ] **Step 5: UX verification** — start the dev stack (`docker compose up -d portal portal-init`), set `PUBLIC_URL=http://localhost:3000` in `.env`, then hit `http://127.0.0.1:3000/` in a browser. Expect: 301 to `http://localhost:3000/` with `Clear-Site-Data: "storage"` header (verify in DevTools Network tab).
- [ ] **Step 5b: UX verification of alias bypass** — keep `PUBLIC_URL=http://localhost:3000`, also set `PUBLIC_URL_ALIASES=127.0.0.1:3000`. Hit `http://127.0.0.1:3000/` again. Expect: NO redirect, page serves normally. Then unset both vars, restart portal, confirm `http://127.0.0.1:3000/` serves normally (no redirect, passthrough mode).

If gate 4 (UX verification) finds the middleware broken, do NOT proceed to PR — fix and re-run all four gates.

---

## Task 5: Branch hygiene + PR

Per AGENTS.md §4: short-lived topic branch off `main`, DCO sign-off, push, PR.

Current worktree is on `claude/stupefied-aryabhata-2d97cc`. The plan author should:

- [ ] **Step 1: Confirm branch is rooted at `origin/main`** — `git log --oneline origin/main..HEAD` to see only this slice's commits, no drift.
- [ ] **Step 2: Verify no overlap with concurrent sessions** — `git log origin/main --since="3 days ago" --oneline | grep -iE 'middleware|canonical|PUBLIC_URL'`. If any overlap found, stop and consult.
- [ ] **Step 3: Push the branch** — `git push -u origin claude/stupefied-aryabhata-2d97cc`
- [ ] **Step 4: Open PR against `main`** with title `feat(portal): canonical-URL middleware (slice 1/4 multi-origin remediation)` and a body summarizing: the audit finding, the industry-pattern citations, slice scope, what's deferred, build-gate evidence. Include the audit summary table from the prior research as context.
- [ ] **Step 5: Confirm DCO check passes** on the open PR before declaring done.

---

## Acceptance Criteria

This slice is complete when:

1. `apps/web/lib/canonical-host.ts` exports `decideHostMatch` with full test coverage of the 11 cases enumerated in Task 1.
2. `apps/web/middleware.ts` correctly 301-redirects non-canonical hosts to `PUBLIC_URL` with `Clear-Site-Data: "storage"`, and passes through when `PUBLIC_URL` is unset.
3. Local dev (no `PUBLIC_URL` set) is unbroken — any host works, no redirect.
4. `PUBLIC_URL_ALIASES` allows LAN bypass without redirect.
5. Health-probe paths (`/api/health`, `/api/healthz`, `/api/ready`), Next internals (`/_next/*`), and `favicon.ico` are excluded from middleware.
6. `.env.example` documents both env vars with self-explanatory comments.
7. All four build gates pass.
8. PR is open with DCO sign-off and references this plan.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Middleware breaks OAuth callback (provider hits non-canonical host) | OAuth callbacks already use `getStablePortalUrl()` (env-driven). Provider will only ever call the canonical URL → no redirect happens. Verified during UX gate. |
| Middleware breaks load-balancer health probes | Explicit matcher exclusions for `/api/health`, `/api/healthz`, `/api/ready`. |
| Misconfigured `PUBLIC_URL` locks admin out | Malformed `PUBLIC_URL` triggers passthrough (try/catch in `decideHostMatch`). Recovery: unset `PUBLIC_URL` and restart. Documented in `.env.example` comment. |
| `Clear-Site-Data` flushes user UI prefs unexpectedly | This is intentional and one-time — exactly the design goal. Documented in PR body so reviewers understand it's not a bug. |
| Slice 2-4 work (server-side state, optimistic messages) gets forgotten | Explicit "deferred" section above. Open follow-up BI after this PR merges. |

---

## Notes for Reviewers

- The pattern matches Gitea, Discourse, Mattermost, Home Assistant — cite their docs in PR description if challenged on the approach.
- Cookie config is already RFC-6265-correct (host-only, no `Domain=` attribute) per audit; this slice does not touch cookies.
- Slice 2 (server-side coworker mode promotion) is the next-most-impactful follow-up because it eliminates the remaining real-data divergence; UI ephemera that survives `Clear-Site-Data` is acceptable.
