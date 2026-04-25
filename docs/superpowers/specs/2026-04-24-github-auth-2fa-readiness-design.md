# GitHub Auth — 2FA Readiness via OAuth Device Flow

| Field | Value |
|-------|-------|
| **Epic** | EP-BUILD-HANDOFF-002 (Phase 2f, public-contribution security follow-on) |
| **IT4IT Alignment** | §5.4 Deploy — contribution pipeline authentication layer |
| **Depends On** | [Contribution Mode & Git Integration (2026-04-01)](2026-04-01-contribution-mode-git-integration-design.md), [Public Contribution Mode (2026-04-23)](2026-04-23-public-contribution-mode-design.md) |
| **Status** | Proposed |
| **Created** | 2026-04-24 |
| **Author** | Claude (Software Engineer) + Mark Bodman (CEO) |

## Problem Statement

GitHub has announced mandatory two-factor authentication for all active accounts by **2026-06-07**. Accounts that don't enable 2FA are restricted from account actions including token creation, OAuth authorization, and (eventually) API use.

This mandate doesn't break any already-minted personal access token — tokens are not sessions — but it raises three concerns for DPF:

1. **Per-install contributor onboarding gets worse.** Today a contributor sets up the fork-PR flow by navigating GitHub's PAT settings, selecting the right scope (`public_repo`), copying the token, and pasting it into `PlatformDevelopmentForm`. After 2026-06-07 every new contributor also walks through a 2FA enrollment prompt on first PAT creation. The paste-a-token pattern is an awkward onboarding even today; it gets measurably worse under 2FA.
2. **Silent security fallbacks shouldn't ship.** `credential-crypto.ts` falls back to plaintext storage when `CREDENTIAL_ENCRYPTION_KEY` is missing — only a `console.warn` signals it. In production this is a data-at-rest vulnerability that should fail loud.
3. **Token hygiene is read-time only.** `validateGitHubToken` runs on save but only checks "does this authenticate". Scope and expiry aren't verified. A contributor can save a token that lacks `public_repo` or expires in 3 days and the platform discovers the problem on their first PR — after the build has run, the commit is generated, and the API returns `403 Missing scope` or `401 Expired`.

The 2FA deadline creates urgency but also opportunity — it's the right moment to upgrade the per-install auth story from "paste a token" to "authorize via GitHub's OAuth Device Flow", and to tighten the surrounding token-storage and validation gaps.

This spec also explicitly declines a third option — a DPF-owned GitHub App — and documents why. That rejection is a design decision in its own right because it constrains the platform's architectural direction for years.

## Goals and Non-Goals

**Goals**

- Make per-install GitHub auth 2FA-friendly without requiring every new contributor to mint a PAT by hand.
- Activate the OAuth columns on `CredentialEntry` that already exist on the schema but are unused for git providers today.
- Fail loud at process start in production when credential storage would silently degrade to plaintext.
- Validate token scope and expiry at save time, not at first use.
- Keep PAT-based setup supported as an advanced path — air-gapped installs, policy-restricted environments, and machine users still need it.
- Ship every change behind the existing `CONTRIBUTION_MODEL_ENABLED` flag so no existing install breaks on deploy.

**Non-Goals**

- Replacing PAT support entirely.
- Changing the `fork_only` mode — it never calls GitHub and is unaffected.
- Changing the fork-PR vs maintainer-direct dispatch from [2026-04-23](2026-04-23-public-contribution-mode-design.md) — this spec upgrades the token acquisition path for both.
- Building a DPF-owned GitHub App for per-install contribution PRs. This is a deliberate architectural rejection documented under §Non-Goal: DPF-owned GitHub App.
- Migrating every existing plaintext credential in one release — re-encryption happens opportunistically on next token rotation, not as a migration.

## Design

### Three-tier contributor setup

The admin UI presents three auth methods in descending order of recommendation:

| Tier | Method | Default | Token lifetime | Setup friction | When to choose |
|------|--------|---------|----------------|----------------|----------------|
| **1** | OAuth Device Flow | **Yes** | No expiry (user-to-server token) | One click, GitHub handles 2FA inline | Normal contributor setup on any browser-capable install |
| **2** | Fine-grained PAT | Advanced disclosure | User-selected expiry (recommend 1 year) | PAT creation on github.com, copy-paste into admin form | Policy-restricted environments; installs that require per-repo scope limits |
| **3** | Classic PAT | Emergency disclosure | No expiry | Same as Tier 2 | Air-gapped installs; machine users with legacy tokenization; last-resort |

All three tiers write to the same `CredentialEntry[providerId="hive-contribution"]` slot, store via `encryptSecret`, and are resolved by the existing `resolveHiveToken()`. The difference is how the token is *acquired* and *validated*.

### Tier 1: OAuth Device Flow

Device Flow ([RFC 8628](https://datatracker.ietf.org/doc/html/rfc8628), [GitHub docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)) lets a software client obtain a GitHub OAuth token without handling a redirect URI or client secret. It's the standard flow for CLI tools (`gh auth login` uses it) and is ideal for server-side admin forms that can display a short code and URL to the user.

**Prerequisite: OAuth App registration (one-time, maintainer action).** An OAuth App is registered under `OpenDigitalProductFactory` at github.com. Its Client ID is embedded as the compile-time constant `GITHUB_OAUTH_CLIENT_ID` in `apps/web/lib/integrate/github-oauth.ts`. This is public — Client IDs are not secrets (they appear in every browser redirect URL of the OAuth web flow). **No client secret is stored or used** — Device Flow is a public-client flow.

**Runtime flow:**

1. Admin opens `PlatformDevelopmentForm`, clicks **Connect GitHub**.
2. Server action `initiateDeviceFlow()`:
   - POSTs to `https://github.com/login/device/code` with `client_id=GITHUB_OAUTH_CLIENT_ID` and `scope=public_repo`.
   - Receives `{ device_code, user_code, verification_uri, expires_in, interval }`.
   - Returns `{ user_code, verification_uri, expires_in, interval, device_code_id }` to the UI. `device_code` itself is stored server-side in a transient table keyed by `device_code_id` (15-minute TTL).
3. UI displays: *"Visit **github.com/login/device** and enter code **WDJB-MJHT**"* plus a Copy button and a spinner.
4. UI calls `pollDeviceFlow({ device_code_id })` every `interval` seconds:
   - Server POSTs to `https://github.com/login/oauth/access_token` with the stored `device_code`, `client_id`, and `grant_type=urn:ietf:params:oauth:grant-type:device_code`.
   - GitHub returns `authorization_pending` / `slow_down` until the user completes authorization, then returns `{ access_token, token_type, scope }`.
5. On success:
   - Server calls `validateGitHubToken({ token, requiredScope: "public_repo", authMethod: "oauth-device" })` to verify scope and fetch the authenticated username.
   - Server encrypts and stores `access_token` in `CredentialEntry[hive-contribution].secretRef`; records `scope` and `cachedToken` fields for audit; leaves `tokenExpiresAt` null (OAuth App user-to-server tokens issued to OAuth Apps don't expire by default).
   - Server writes `PlatformDevConfig.contributorForkOwner = <authenticated username>` if the caller is in fork-pr mode and the field is unset.
   - Transient device-code record is deleted.
6. UI shows success with the authenticated GitHub username.

**Token lifetime.** Device Flow tokens issued by a GitHub OAuth App (not a GitHub App) have no expiry. They behave like PATs from the platform's perspective — long-lived, revocable only by the user at github.com/settings/applications. This is a feature: no refresh-token infrastructure needed, and the platform's token-expiry monitoring doesn't apply to Tier 1.

**Revocation detection.** When the user revokes the authorization at github.com/settings/applications, all future API calls with that token return `401`. `contribute_to_hive` catches 401 and surfaces an actionable error: *"Your GitHub authorization has been revoked. Reconnect your GitHub account in Admin > Platform Development."*

**Why this is better than PAT-paste under 2FA.** The user never leaves their normal GitHub browser session. If they haven't enabled 2FA yet, GitHub's authorization screen itself prompts for it. The platform never sees the user's 2FA challenge — that lives entirely between the user and GitHub.

### Tier 2: Fine-grained PAT (advanced)

Same storage and resolver as today, but:

- `validateGitHubToken` checks `X-OAuth-Scopes` response header on the probe call; fine-grained PATs return empty in this header, so the validator additionally probes `GET /repos/{contributorForkOwner}/{contributorForkRepo}` (or `GET /user` if fork is unconfigured) and surfaces a scope error with explicit copy: *"This token can't access the fork repo. Create a fine-grained PAT with Repository Access = `{fork}` and `Contents: read and write`."*
- `expires_at` is read from the token response (GitHub returns it on the probe call for fine-grained PATs via the `github-authentication-token-expiration` header) and stored in `CredentialEntry.tokenExpiresAt`.
- Refused at save time if `expires_at` is less than 30 days away.

### Tier 3: Classic PAT (emergency)

Same as today. UI shows a warning: *"Classic PATs have no expiry and broad scope. Fine-grained PATs or OAuth are preferred. Continue only if your environment requires this."* Scope is validated on save (`X-OAuth-Scopes` must include `public_repo` or `repo`) but expiry cannot be enforced (classic PATs can be created with or without expiry; most have none).

### Auth-method discrimination without a schema column

Token prefixes tell us the type — no new column needed:

| Prefix | Tier | Meaning |
|--------|------|---------|
| `gho_` | 1 | OAuth user-to-server token (Device Flow or web flow) |
| `github_pat_` | 2 | Fine-grained PAT |
| `ghp_` | 3 | Classic PAT |
| `ghs_`, `ghr_` | (not stored) | App installation / refresh — not valid for this slot |

`resolveHiveToken` and `validateGitHubToken` both inspect the prefix to choose validation behavior. Unknown prefixes fail validation with *"Token format not recognized. Expected a GitHub OAuth token (`gho_`), fine-grained PAT (`github_pat_`), or classic PAT (`ghp_`)."*

### `validateGitHubToken` — extended signature

Today's signature:

```typescript
validateGitHubToken(token: string): Promise<{ valid, username?, error? }>
```

New signature (non-breaking — existing callers pass just `token` and get default behavior):

```typescript
validateGitHubToken(input: {
  token: string;
  requiredScope?: "public_repo" | "repo" | "contents:write";
  expectedOwner?: string;           // for fork-pr: token owner must match contributorForkOwner
  requireNonExpired?: boolean;      // for Tier 2: refuse if expires_at < 30 days
  authMethod?: "oauth-device" | "fine-grained-pat" | "classic-pat" | "auto";
}): Promise<{
  valid: boolean;
  username?: string;
  scope?: string;
  expiresAt?: Date | null;
  authMethod?: "oauth-device" | "fine-grained-pat" | "classic-pat";
  error?: string;
}>
```

When `authMethod` is `"auto"` (default), the prefix is used to select validation logic. Callers in the 2026-04-23 plan's Task 5.2 (which extended the signature differently) re-target to this shape; the two changes compose cleanly because both are additive to today's single-arg form.

### Production requirement: `CREDENTIAL_ENCRYPTION_KEY` must be set

Today `credential-crypto.ts` silently returns plaintext when the key is missing, with a single `console.warn` on first call. In production this is a data-at-rest vulnerability.

The change:

- At portal boot, `apps/web/lib/govern/credential-crypto.ts` exports `assertCredentialEncryptionKeyIsSet()`.
- On startup (from `instrumentation.ts`), if `process.env.NODE_ENV === "production"` AND the key is missing AND any `CredentialEntry.secretRef` is non-null, the process refuses to start with:

  ```
  FATAL: CREDENTIAL_ENCRYPTION_KEY is not set, but the credential store
  contains secrets that would be read/written in plaintext. Set this variable
  (64 hex chars = 32 bytes) before restarting. For dev, set NODE_ENV=development.
  ```

- In development this still falls back to plaintext with a single warn, as today.

This is a deploy-time breaking change for any production install that hasn't set the key. The CHANGELOG entry and the admin-UI banner for the contribution-mode migration both call it out.

### Opportunistic re-encryption

Existing plaintext credentials migrate silently:

- On every call to `resolveHiveToken` or `getStoredGitHubToken`, if the stored value is *not* prefixed `enc:` and `CREDENTIAL_ENCRYPTION_KEY` is set, the caller re-writes the same value encrypted before returning it. No user action required.
- Post-migration, all credentials are encrypted. The legacy plaintext code path remains (we can't remove it until every install has rotated), but it becomes unreachable for installs with the key set.

### Token expiry monitoring

Inngest scheduled function (daily at 09:00 UTC install-local):

- Queries `CredentialEntry` where `tokenExpiresAt IS NOT NULL`.
- For each, computes days-until-expiry.
- Writes a `PlatformNotification` row with severity tiered: `info` at 30 days, `warning` at 14 days, `critical` at 7 days, `expired` at 0 days.
- Admin UI (`PlatformDevelopmentForm`) renders a banner for `warning`+ severities: *"Your GitHub token expires in 7 days. [Reconnect via OAuth] or [Update token]."*

Tier 1 (Device Flow) has no expiry and is not monitored. Tier 3 (classic PAT) usually has no expiry. Only Tier 2 is actively monitored.

### `HIVE_CONTRIBUTION_TOKEN` env-var deprecation

The env-var path predates the admin UI and exists for legacy installs that configured contribution via `.env.docker` before `PlatformDevelopmentForm` shipped. It's priority #1 in `resolveHiveToken`.

Changes:

- Add a startup warning in `instrumentation.ts` when `process.env.HIVE_CONTRIBUTION_TOKEN` is set: *"HIVE_CONTRIBUTION_TOKEN is deprecated. Configure GitHub auth via Admin > Platform Development (OAuth Device Flow recommended). Support for this env var will be removed in 2026-07."*
- Admin UI banner when the env var is set but a DB credential is also present: *"An env-var token is taking priority over your configured credential. Unset HIVE_CONTRIBUTION_TOKEN to use your UI-configured token."*
- `.env.docker.example` gets the same deprecation comment and a pointer to the Device Flow setup doc.

The env var is not removed in this spec — removal is a separate PR in a later release after a 60-day deprecation window.

### Build Studio flow — unchanged

Build Studio's feature PRs go through the same `submitBuildAsPR()` → `createBranchAndPR()` pipeline as hive contributions, and pick up whichever token `resolveHiveToken()` returns. No code changes in the Build Studio layer. The admin who configures GitHub auth once does so for both surfaces.

### Admin UI changes

`apps/web/components/admin/PlatformDevelopmentForm.tsx`:

- **Primary block**: a "Connect GitHub" card with the Device Flow button, currently-connected state (username + date of connection), and a "Disconnect" secondary action.
- **Advanced disclosure** (collapsed by default): "Paste a fine-grained PAT" form field + "Paste a classic PAT" form field. Both run through `validateGitHubToken` with their respective `authMethod`.
- **Token-expiry banner**: appears when a stored Tier 2 PAT is within 30 days of expiry.
- **Legacy-override banner**: appears when `HIVE_CONTRIBUTION_TOKEN` env var is set.

### Pseudonymity — no change

Device Flow doesn't affect the install's pseudonymous commit identity. Commits still carry `dpf-agent-<shortId>` as author and the matching DCO `Signed-off-by`. The authenticated GitHub username (the user that authorized the OAuth app) surfaces as the PR author on github.com — the same visibility tradeoff that the 2026-04-23 spec already documents for fork-PR mode. The admin-UI Device Flow button is labeled with the same visibility disclosure: *"Your GitHub username will be visible on every PR. Use a pseudonymous GitHub account if that's not acceptable."*

## Non-Goal: DPF-owned GitHub App for per-install contributions

A GitHub App owned by OpenDigitalProductFactory would let any install contribute without holding a user token — App installations mint short-lived tokens (1-hour expiry), rotate automatically, and scope permissions at install-time.

This spec explicitly rejects that architecture for per-install contributions. Reasons:

1. **Collides with "obfuscated, not anonymous".** Every install must be distinguishable in commit history so the community can recognize repeat contributors. A GitHub App collapses PR authorship to `dpf-platform[bot]` on every PR — every install looks identical on GitHub. The install-scoped commit pseudonym (`dpf-agent-<shortId>`) remains in commit metadata, but the primary public identity on the PR page is the bot. This directly contradicts a core platform principle.
2. **Collides with "conduit, not broker".** DPF's stance on enterprise integrations is that customers bring their own account and credentials; DPF never enrolls as the trust-holding party. A DPF-owned GitHub App inverts this — DPF becomes the authentication authority for every contribution flow across every install. Every install's contribution capability depends on DPF's App secret not leaking and DPF's webhook endpoint staying up.
3. **Hosting burden.** GitHub Apps require a public webhook endpoint for repository events (installations, permission updates, repository transfers). DPF has no platform-side webhook receiver today; building one is a non-trivial addition to the hosting surface.
4. **Rate-budget coupling.** PAT holders each get 5000 req/hr. A GitHub App's authenticated requests share a single rate budget that scales with installation count (`15,000/hr/installation` for authenticated Apps on public repos). At 10k+ installations this is fine; at 1k installations with a handful of very active installs, the shared budget is the coupling point — one noisy install can starve quiet ones.
5. **Customer-branch model.** The platform's direction (`customer/<id>` branches, thousands of individual contributors) wants *more* per-contributor identity, not less. The GitHub App direction pushes the opposite way.

The narrow case where a GitHub App *would* earn its keep is **platform-owned automation PRs into the public DPF repo** — dependency bumps, scheduled cleanups, release automation that today would run under a maintainer's personal account. That's a separate concern from per-install contribution, has different tradeoffs, and is out of scope for this spec. If it's ever built, it should be a small App with a single well-scoped permission set, installed only on the upstream repo, used only by maintainer-operated cron jobs.

## Implementation Phases

Phase boundaries map to PR boundaries per [AGENTS.md](../../../AGENTS.md). Each phase is one concern, one PR.

1. **[doc] This spec + CONTRIBUTING.md section on three-tier setup.** No code. Merged first to anchor the rest.
2. **[chore] Fail-loud on missing `CREDENTIAL_ENCRYPTION_KEY` in production.** `instrumentation.ts` boot-check; error message with remediation; unit tests for boot-refuse behavior. Breaking for any prod install that hasn't set the key; called out in CHANGELOG.
3. **[feat] Extend `validateGitHubToken` with scope, expiry, and prefix-based auth-method detection.** New input/output shape, back-compat for single-arg callers, prefix discrimination logic, `X-OAuth-Scopes` + expiry header parsing, probe-request path for fine-grained PATs. Unit tests for each token prefix path.
4. **[feat] OAuth Device Flow — backend.** `initiateDeviceFlow()` + `pollDeviceFlow()` server actions, transient device-code table (new Prisma model `DeviceCodeSession` with 15-min TTL), `GITHUB_OAUTH_CLIENT_ID` constant, integration test against GitHub Device Flow in a non-prod OAuth App.
5. **[feat] OAuth Device Flow — admin UI.** `PlatformDevelopmentForm` refactor: Connect GitHub card, polling spinner, success/failure states, Disconnect action. Removes "paste a token" from the primary form path; moves it to an Advanced disclosure.
6. **[feat] Token expiry monitoring.** Inngest daily job + `PlatformNotification` rows + admin banner. Only fires for Tier 2 PATs.
7. **[feat] Opportunistic re-encryption + `HIVE_CONTRIBUTION_TOKEN` deprecation warning.** `resolveHiveToken` re-writes plaintext values encrypted on read; startup warning and admin banner when env var is set.
8. **[doc] CONTRIBUTING.md deep pass.** Three-tier setup guide with screenshots; pseudonymity tradeoff; machine-user pattern.

## Prerequisites (maintainer action, not code)

These block Phase 4 from being deployable but don't block any earlier phase:

- Register a GitHub OAuth App under `OpenDigitalProductFactory`:
  - Name: *Digital Product Factory*
  - Homepage URL: `https://opendigitalproductfactory.github.io`
  - Authorization callback URL: `http://localhost` (unused — Device Flow does not redirect, but GitHub requires the field to be non-empty)
  - Enable **Device Flow** in the OAuth App settings
  - Record the Client ID (public; embed as compile-time constant in the platform)
- Verify every account that currently holds a PAT used by any deployed install has 2FA enabled before 2026-06-07. The maintainer-direct mode token is the critical one — if this account loses access on the deadline, every install in maintainer-direct mode stops contributing until it's rotated.

## Open Questions

1. **Client ID distribution.** Compile-time constant vs. runtime env var. Proposed default: **compile-time**. Client IDs are public; embedding avoids one more env var every install needs to set.
2. **Rate budget under load.** GitHub OAuth Apps share a 5000 req/hr app-wide budget for unauthenticated calls (Device Flow initiation) but each user-to-server token gets its own 5000/hr budget. Device Flow initiation rate is the only shared surface — the `device/code` endpoint is not documented as rate-limited per app, but we should monitor it. Proposed default: **no pre-emptive guard**, surface 429s in UI with "please try again in a minute."
3. **Scope validation probe for fine-grained PATs.** `GET /user` works if the token has any scope, but doesn't confirm `public_repo` on the target fork. Probing `GET /repos/{fork}` needs `contributorForkOwner` to be configured first — chicken/egg if the user is connecting before fork setup. Proposed default: in fork-pr mode, require fork setup to complete before token save (it's already the 2026-04-23 flow); in maintainer-direct mode, probe `GET /repos/OpenDigitalProductFactory/opendigitalproductfactory`.
4. **Revocation-detection UX.** When a user revokes at github.com, the next contribute_to_hive fails with 401. Should the admin UI periodically (weekly?) re-probe `GET /user` to surface revocation earlier? Proposed default: **no polling**. 401s on first contribute are infrequent, cost a build cycle once, and polling adds nothing the user can't do by looking at the admin UI's "Connected: <username>" indicator.
5. **Machine-user pattern.** An install that wants full pseudonymity on public PRs can register a separate GitHub machine user, authorize it via Device Flow under that account, and enable 2FA on it (required by the 2026-06-07 deadline just like any other account). This works today with no platform change, but CONTRIBUTING.md should document it. Proposed default: **document in Phase 8**, no code support needed.

## References

- [Contribution Mode & Git Integration (2026-04-01)](2026-04-01-contribution-mode-git-integration-design.md)
- [Public Contribution Mode (2026-04-23)](2026-04-23-public-contribution-mode-design.md)
- [Pseudonymous Identity & Issue Bridge (2026-04-18)](2026-04-18-pseudonymous-identity-and-backlog-issue-bridge-design.md)
- [RFC 8628: OAuth 2.0 Device Authorization Grant](https://datatracker.ietf.org/doc/html/rfc8628)
- [GitHub: Authorizing OAuth apps — Device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)
- [GitHub: Mandatory 2FA enforcement](https://github.blog/security/platform-security/raising-the-bar-for-software-security-github-2fa-begins-march-13/)
- [AGENTS.md](../../../AGENTS.md) — branching and PR workflow
- [CONTRIBUTING.md](../../../CONTRIBUTING.md) — contributor fork/PR flow
