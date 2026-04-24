# GitHub Auth 2FA Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Upgrade per-install GitHub authentication to OAuth Device Flow (default) with fine-grained PAT and classic PAT as fallback tiers; harden credential storage at rest; deprecate the legacy env-var token path — ahead of GitHub's mandatory 2FA deadline on 2026-06-07.

**Architecture:** Three-tier contributor setup (Device Flow / fine-grained PAT / classic PAT), all tiers writing to the same `CredentialEntry[providerId="hive-contribution"]` slot. Token prefix (`gho_` / `github_pat_` / `ghp_`) discriminates auth method — no new schema column. Existing OAuth columns on `CredentialEntry` (`cachedToken`, `tokenExpiresAt`, `refreshToken`, `scope`) are activated for git providers. Fail-loud on missing `CREDENTIAL_ENCRYPTION_KEY` in production; opportunistic re-encryption of legacy plaintext credentials on read. Inngest daily job monitors expiry for fine-grained PATs only.

**Tech Stack:** Next.js 16 App Router, Prisma 7, Postgres 16, Inngest, Vitest, GitHub REST API (OAuth Device Flow per RFC 8628), AES-256-GCM at-rest encryption.

**Source spec:** [docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md](../specs/2026-04-24-github-auth-2fa-readiness-design.md)

**Phase 1 status:** Spec merged via PR #232 (commit `88cf3708` on `main`). This plan covers Phases 2–8.

---

## Prerequisites (maintainer action, not code tasks)

These gate deploy/run but don't block implementation of any phase other than the one noted. Phase 2, 3, 7 can all land before any prerequisite is complete.

| Prerequisite | Blocks | Owner | Done when |
|---|---|---|---|
| Register OAuth App under `OpenDigitalProductFactory` org at github.com. Name: *Digital Product Factory*. Homepage URL: `https://opendigitalproductfactory.github.io`. Callback URL: `http://localhost` (required non-empty but unused — Device Flow does not redirect). **Enable Device Flow in app settings.** | Phase 4 code | Mark | Client ID recorded and provided to the Phase 4 implementer |
| Confirm every production install has `CREDENTIAL_ENCRYPTION_KEY` set to a 64-hex-char value before Phase 2 deploys | Phase 2 deploy (not merge) | Mark | Documented in Phase 2 CHANGELOG entry; pre-deploy checklist followed |
| Confirm every account holding a hive-contribution PAT has 2FA enabled by 2026-06-07 | Nothing in this plan, but existence of those tokens | Mark | Audit complete; recorded outside this plan |

---

## Dependency graph

```
Phase 2 (chore)  ─┐
Phase 3 (feat)  ─┼──> Phase 4 (feat) ──> Phase 5 (feat) ──> Phase 8 (doc)
Phase 7 (feat) ─┘                     │
                                       └──> Phase 6 (feat)
```

- Phases 2, 3, 7 have no external dependencies — can be worked in parallel.
- Phase 4 depends on Phase 3 (extended `validateGitHubToken`) and OAuth App registration.
- Phase 5 depends on Phase 4 (backend server actions ready).
- Phase 6 depends on Phase 3 (the expiry-detection helper it exercises lives there).
- Phase 8 is docs with screenshots — needs Phase 5 UI shipped first.

---

## Worktree + branch discipline

Every phase runs in its own worktree branched off `origin/main`. This matches the DPF "worktree per concurrent session" convention and keeps PR CI state independent.

```bash
git -C d:/DPF fetch origin main
git worktree add d:/DPF-<phase-slug> -b <branch-name> origin/main
```

All commits use `git commit -s` for DCO sign-off (trailer required by the `DCO` GitHub App check). All PRs use the AGENTS.md template — title under 70 chars, body with Summary + Test plan.

---

## Phase 2 — Fail-Loud on Missing `CREDENTIAL_ENCRYPTION_KEY` in Production

**Branch:** `chore/gh-auth-cred-key-fail-loud`
**Worktree:** `D:/DPF-gh-cred-key`
**Dependencies:** None.
**Blast radius:** Deploy-time breaking for any production install that has never set `CREDENTIAL_ENCRYPTION_KEY`. CHANGELOG entry required.

**Files:**
- Modify: `apps/web/lib/govern/credential-crypto.ts` (add `assertCredentialEncryptionKeyIsSet()`)
- Modify: `apps/web/instrumentation.ts` (call the assertion on startup)
- Create: `apps/web/lib/govern/credential-crypto.assert.test.ts` (unit tests for the assertion)
- Modify: `.env.docker.example` (document the variable as required for production)
- Reference only: `packages/db/prisma/schema.prisma` `CredentialEntry` model lines 1015–1028 (no schema change). Note: actual `model CredentialEntry` line is 1027 — confirm with `rg "^model CredentialEntry" packages/db/prisma/schema.prisma` before editing.

The project does not ship a `CHANGELOG.md` at repo root; release notes live in PR bodies and Git tags. The breaking-change notice goes in the Phase 2 PR body (Summary section), not a file.

### Task 2.1: Write failing test for the assertion

- [ ] **Step 1: Create** `apps/web/lib/govern/credential-crypto.assert.test.ts` with four cases. Use `vi.stubEnv` for env, mock `prisma.credentialEntry.count`:
  ```typescript
  import { describe, it, expect, beforeEach, vi } from "vitest";
  import { assertCredentialEncryptionKeyIsSet } from "./credential-crypto";

  vi.mock("@dpf/db", () => ({
    prisma: { credentialEntry: { count: vi.fn() } },
  }));

  describe("assertCredentialEncryptionKeyIsSet", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
      vi.resetAllMocks();
    });

    it("throws in production when key missing AND credentials exist", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
      const { prisma } = await import("@dpf/db");
      vi.mocked(prisma.credentialEntry.count).mockResolvedValue(3);
      await expect(assertCredentialEncryptionKeyIsSet()).rejects.toThrow(/FATAL: CREDENTIAL_ENCRYPTION_KEY/);
    });

    it("passes in production when key is set, without querying the DB", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64));
      const { prisma } = await import("@dpf/db");
      await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
      expect(prisma.credentialEntry.count).not.toHaveBeenCalled();
    });

    it("passes in production when key missing AND no credentials exist", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
      const { prisma } = await import("@dpf/db");
      vi.mocked(prisma.credentialEntry.count).mockResolvedValue(0);
      await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
    });

    it("passes in development regardless", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "");
      await expect(assertCredentialEncryptionKeyIsSet()).resolves.toBeUndefined();
    });
  });
  ```
- [ ] **Step 2: Run test, expect all four to fail** (function does not exist): `pnpm --filter @dpf/web test credential-crypto.assert`

### Task 2.2: Implement `assertCredentialEncryptionKeyIsSet`

- [ ] **Step 1: Add the function** to `apps/web/lib/govern/credential-crypto.ts` after the existing `decryptSecret`:
  ```typescript
  /**
   * Startup guard. Refuses to run in production if the credential store contains
   * secrets but CREDENTIAL_ENCRYPTION_KEY is not set — that combination means
   * existing credentials are stored plaintext or new writes would degrade silently.
   * Development mode falls back to plaintext per dev-mode convenience; see
   * docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md §Production requirement.
   */
  export async function assertCredentialEncryptionKeyIsSet(): Promise<void> {
    if (process.env.NODE_ENV !== "production") return;
    if (getEncryptionKey()) return;
    const { prisma } = await import("@dpf/db");
    const count = await prisma.credentialEntry.count({ where: { secretRef: { not: null } } });
    if (count === 0) return;
    throw new Error(
      "FATAL: CREDENTIAL_ENCRYPTION_KEY is not set, but the credential store\n" +
      "contains secrets that would be read/written in plaintext. Set this variable\n" +
      "(64 hex chars = 32 bytes) before restarting. For dev, set NODE_ENV=development."
    );
  }
  ```
- [ ] **Step 2: Run tests, expect all pass**: `pnpm --filter @dpf/web test credential-crypto.assert`

### Task 2.3: Wire into `instrumentation.ts`

- [ ] **Step 1: Read** current `apps/web/instrumentation.ts` to confirm the `register()` export pattern.
- [ ] **Step 2: Add the call** inside the existing `register()` function (or create one if absent):
  ```typescript
  import { assertCredentialEncryptionKeyIsSet } from "@/lib/govern/credential-crypto";
  export async function register() {
    // ...existing boot-time work...
    await assertCredentialEncryptionKeyIsSet();
  }
  ```
- [ ] **Step 3: Typecheck**: `pnpm --filter @dpf/web exec tsc --noEmit`

### Task 2.4: Documentation + CHANGELOG

- [ ] **Step 1: Update `.env.docker.example`** — change the `CREDENTIAL_ENCRYPTION_KEY` comment to indicate it is REQUIRED in production, not optional. Include remediation (64 hex chars = 32 bytes; generate with `openssl rand -hex 32`).
- [ ] **Step 2: Draft the breaking-change notice** for the PR body Summary section (repo has no CHANGELOG.md — PR body is the release-note surface):
  ```markdown
  ## Breaking
  Production deploys now refuse to start when `CREDENTIAL_ENCRYPTION_KEY` is missing AND the credential store contains secrets. Set `CREDENTIAL_ENCRYPTION_KEY` to a 64-hex-char value in production env before upgrading. Development mode is unchanged. See `docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md` §Production requirement.
  ```

### Task 2.5: Verify + PR

- [ ] Full test run: `pnpm --filter @dpf/web test` (scoped).
- [ ] Typecheck: `pnpm --filter @dpf/web exec tsc --noEmit`.
- [ ] Production build: `pnpm --filter @dpf/web build`.
- [ ] `git add -p` → stage only the intended files (no `-A`).
- [ ] `git commit -s -m "chore(credential-crypto): fail-loud on missing encryption key in production"`.
- [ ] Push + `gh pr create` with title `chore(credential-crypto): fail-loud on missing encryption key in production`, body per AGENTS.md template.

---

## Phase 3 — Extend `validateGitHubToken` with scope, expiry, and prefix detection

**Branch:** `feat/gh-auth-validate-extended`
**Worktree:** `D:/DPF-gh-validate`
**Dependencies:** None directly, but composes with the already-queued plan [`2026-04-23-public-contribution-mode.md` Task 5.2](2026-04-23-public-contribution-mode.md).
**Blast radius:** Back-compat preserved via function overload — existing single-arg callers unchanged.

**Composition with 2026-04-23 Task 5.2**

The 2026-04-23 plan's Task 5.2 extends `validateGitHubToken(token: string)` → `validateGitHubToken({ token, model, expectedOwner?, machineUser? })`. This plan's Phase 3 adds `requiredScope`, `requireNonExpired`, and `authMethod` to the same object.

**Implementation order matters:**
- Phase 3 implementer **must first run** `git log --all -- apps/web/lib/actions/platform-dev-config.ts | head -20` to see whether 2026-04-23 Phase 5 has landed.
- **If 2026-04-23 Phase 5 has merged:** verify its signature is an **object form** matching `{ token, model, expectedOwner?, machineUser? }`. If it merged a different shape (e.g. multiple positional args), raise as a **blocker** — do not try to retrofit; surface to the human reviewer to reconcile the two signatures before continuing. If it's object-form as expected, extend that object with `requiredScope`, `requireNonExpired`, `authMethod`.
- **If 2026-04-23 Phase 5 has not merged:** land the full combined signature `{ token, requiredScope?, expectedOwner?, requireNonExpired?, authMethod?, model?, machineUser? }`. The 2026-04-23 Phase 5 implementer will later find `model`/`machineUser` already present and update their task accordingly.
- Either way, the single-arg call form `validateGitHubToken(token)` continues to work via overload.

**Files:**
- Modify: `apps/web/lib/actions/platform-dev-config.ts` lines 205–229 (`validateGitHubToken`)
- Create: `apps/web/lib/actions/platform-dev-config.validate.test.ts` (new, scoped to this function)
- Reference only: `docs/superpowers/plans/2026-04-23-public-contribution-mode.md` Task 5.2

### Task 3.1: Back-compat overload

- [ ] **Step 1: Write failing test** that asserts the single-arg form still works and returns the shape today's callers expect:
  ```typescript
  it("single-arg call still works (back-compat)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: "octocat" }),
      headers: new Headers({ "X-OAuth-Scopes": "public_repo" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await validateGitHubToken("ghp_abc");
    expect(result).toEqual({ valid: true, username: "octocat" });
  });
  ```
- [ ] **Step 2: Implement overload signatures** in `platform-dev-config.ts`:
  ```typescript
  export async function validateGitHubToken(token: string): Promise<{ valid: boolean; username?: string; error?: string }>;
  export async function validateGitHubToken(input: ValidateTokenInput): Promise<ValidateTokenResult>;
  export async function validateGitHubToken(arg: string | ValidateTokenInput): Promise<ValidateTokenResult> {
    const input = typeof arg === "string" ? { token: arg } : arg;
    // ... new logic below ...
  }
  ```
- [ ] **Step 3: Run test, expect pass.**

### Task 3.2: Prefix-based auth method detection

- [ ] **Step 1: Failing tests** for prefix discrimination:
  ```typescript
  it.each([
    ["gho_xxx", "oauth-device"],
    ["github_pat_xxx", "fine-grained-pat"],
    ["ghp_xxx", "classic-pat"],
  ])("detects auth method from %s prefix", async (token, expected) => {
    const result = await validateGitHubToken({ token, authMethod: "auto" });
    expect(result.authMethod).toBe(expected);
  });

  it("rejects unknown prefix", async () => {
    const result = await validateGitHubToken({ token: "ghs_appinstall", authMethod: "auto" });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Token format not recognized/);
  });
  ```
- [ ] **Step 2: Implement** `detectAuthMethod(token: string)` helper with the prefix table from the spec (§Auth-method discrimination).
- [ ] **Step 3: Wire into validator.** When `input.authMethod === "auto"` or unset, call `detectAuthMethod` first; unknown prefix → `{ valid: false, error: "Token format not recognized..." }`.
- [ ] **Step 4: Tests green.**

### Task 3.3: Scope validation via `X-OAuth-Scopes` (classic PAT + OAuth tokens)

- [ ] **Step 1: Failing tests** covering:
  - Classic PAT with `public_repo` scope + `requiredScope: "public_repo"` → valid
  - Classic PAT with `repo` scope + `requiredScope: "public_repo"` → valid (repo supersets public_repo)
  - Classic PAT with only `read:user` + `requiredScope: "public_repo"` → invalid, error mentions missing scope
  - OAuth token with correct scope → valid
- [ ] **Step 2: Implement** scope parsing from `X-OAuth-Scopes` header (comma-separated list). Treat `repo` as implying `public_repo` and `contents:write`.
- [ ] **Step 3: Tests green.**

### Task 3.4: Expiry header for fine-grained PATs

- [ ] **Step 1: Failing tests** covering:
  - Fine-grained PAT with `github-authentication-token-expiration` header 60 days out → `expiresAt` set, valid
  - Same, 10 days out, `requireNonExpired: true` → invalid with "expires in X days" error
  - Same, 10 days out, `requireNonExpired: false` (default) → valid, `expiresAt` still surfaced
- [ ] **Step 2: Implement** header parsing. GitHub returns the expiration timestamp in ISO-8601 format on fine-grained PATs.
- [ ] **Step 3: Tests green.**

### Task 3.4b: Per-repo probe for fine-grained PAT scope

Per spec §Tier 2 and §Open Questions #3: fine-grained PATs return empty `X-OAuth-Scopes` — scope must be verified by probing the target repo.

- [ ] **Step 1: Failing tests** covering:
  - Fine-grained PAT + `expectedOwner: "jane-dev"` (fork-pr case): probe `GET /repos/jane-dev/opendigitalproductfactory`. 200 → valid; 404 → invalid with "Token can't access the fork repo" error including explicit copy about Repository Access + Contents scope.
  - Fine-grained PAT + no `expectedOwner` (maintainer-direct case): probe `GET /repos/OpenDigitalProductFactory/opendigitalproductfactory`. Same success/failure semantics.
  - Classic PAT or OAuth token: skip the repo probe; rely on `X-OAuth-Scopes` from Task 3.3.
- [ ] **Step 2: Implement** `probeRepoAccess(token, owner, repo)` helper. Upstream repo name is a constant from the existing `DEFAULT_UPSTREAM_URL` parsing.
- [ ] **Step 3: Tests green.**

### Task 3.5: `expectedOwner` mismatch

- [ ] **Step 1: Failing test:** token authenticates as `jane`, `expectedOwner: "jane-dev"`, no `machineUser` → invalid with owner-mismatch error.
- [ ] **Step 2: Implement** the comparison.
- [ ] **Step 3: Tests green.**

### Task 3.6: Verify + PR

- [ ] Run the full file's tests: `pnpm --filter @dpf/web test platform-dev-config`.
- [ ] Typecheck + build.
- [ ] Audit callers repo-wide: `rg "validateGitHubToken\(" --type ts --type tsx` from repo root (the function may be imported outside `apps/`, e.g. from `packages/` or `services/`). Confirm every existing call still works under the overload.
- [ ] Commit, push, PR titled `feat(validate-github-token): scope + expiry + prefix auth-method detection`.

---

## Phase 4 — OAuth Device Flow Backend

**Branch:** `feat/gh-auth-device-flow-backend`
**Worktree:** `D:/DPF-gh-device-backend`
**Dependencies:** Phase 3 merged; OAuth App registered (prerequisite).

**Files:**
- Create: `apps/web/lib/integrate/github-oauth.ts` (Device Flow client + `GITHUB_OAUTH_CLIENT_ID` constant)
- Create: `apps/web/lib/integrate/github-oauth.test.ts`
- Create: `apps/web/lib/actions/github-device-flow.ts` (server actions `initiateDeviceFlow`, `pollDeviceFlow`)
- Create: `apps/web/lib/actions/github-device-flow.test.ts`
- Modify: `packages/db/prisma/schema.prisma` (add `DeviceCodeSession` model)
- Create: `packages/db/prisma/migrations/<ts>_add_device_code_session/migration.sql`
- Reference only: RFC 8628, [GitHub Device Flow docs](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow)

### Task 4.1: Prisma `DeviceCodeSession` model

- [ ] **Step 1: Add model** to `packages/db/prisma/schema.prisma`:
  ```prisma
  model DeviceCodeSession {
    id         String   @id @default(cuid())
    deviceCode String   @unique
    userCode   String
    interval   Int
    expiresAt  DateTime
    createdAt  DateTime @default(now())
    createdBy  String
    consumed   Boolean  @default(false)

    @@index([expiresAt])
  }
  ```
- [ ] **Step 2: Create migration** via `pnpm --filter @dpf/db exec prisma migrate dev --name add_device_code_session`. Do NOT use `npx prisma` (CLAUDE.md rule — ignores pinned version). This step also runs `prisma generate` implicitly, updating the client types.
- [ ] **Step 3: Verify** the generated SQL touches only the new table (no unrelated drift).
- [ ] **Step 4: Commit** `chore(db): add DeviceCodeSession model for OAuth Device Flow transients`.

### Task 4.2: `GITHUB_OAUTH_CLIENT_ID` constant + Device Flow client

- [ ] **Step 1: Failing tests** for `github-oauth.ts`:
  - `requestDeviceCode()` POSTs to `https://github.com/login/device/code` with correct form fields; returns parsed `{ device_code, user_code, verification_uri, expires_in, interval }`
  - `pollAccessToken({ deviceCode })` POSTs to `https://github.com/login/oauth/access_token`; on `authorization_pending` returns `{ status: "pending" }`; on `slow_down` returns `{ status: "slow_down", interval }`; on `access_token` returns `{ status: "success", token, scope }`; on `expired_token` returns `{ status: "expired" }`; on `access_denied` returns `{ status: "denied" }`
- [ ] **Step 2: Implement** against GitHub's documented response shape. Use `fetch` with `Accept: application/json` (default is form-encoded).
- [ ] **Step 3: Client ID constant (compile-time, per spec §Open Question #1).** Add:
  ```typescript
  // Public OAuth App Client ID — safe to embed; it appears in every redirect URL.
  // Registered at github.com/organizations/OpenDigitalProductFactory/settings/applications
  export const GITHUB_OAUTH_CLIENT_ID = "<REAL_CLIENT_ID_FROM_OAUTH_APP>";
  ```
  The Phase 4 implementer obtains the Client ID from the maintainer (see Prerequisites) and commits the literal. **Do not fall back to a placeholder string or env var** — a misconfigured deploy should fail fast at the Device Flow call, not 404 opaquely mid-flow. If Client ID is not yet available when Phase 4 work begins, pause the phase rather than ship a placeholder.
- [ ] **Step 4: Tests green.**

### Task 4.3: `initiateDeviceFlow` server action

- [ ] **Step 1: Failing tests:**
  - Happy path: calls `requestDeviceCode`, persists a `DeviceCodeSession` row, returns `{ userCode, verificationUri, expiresIn, interval, sessionId }` (no device_code leaks to client)
  - Unauthorized (no session / user not admin): refuses
- [ ] **Step 2: Implement** in `apps/web/lib/actions/github-device-flow.ts`. Use `auth()` for the admin check; session `createdBy` records the admin user ID.
- [ ] **Step 3: Tests green.**

### Task 4.4: `pollDeviceFlow` server action

- [ ] **Step 1: Failing tests:**
  - Unauthenticated caller (no session) → `{ status: "error", error: "Not authenticated" }`
  - Authenticated caller's userId does NOT match `DeviceCodeSession.createdBy` → `{ status: "error", error: "Session does not belong to caller" }` (prevents one admin polling another admin's session)
  - Unknown `sessionId` → `{ status: "error", error: "Session not found or expired" }`
  - Expired session (past `expiresAt`) → `{ status: "error", error: "Code expired, start over" }` and row is deleted
  - Consumed session (`consumed: true`) → `{ status: "error" }`
  - Pending → `{ status: "pending" }` (DB unchanged)
  - Slow_down → `{ status: "slow_down", interval }` (DB unchanged; caller should back off)
  - Success: calls `validateGitHubToken({ token, requiredScope: "public_repo", authMethod: "oauth-device" })`, encrypts + stores to `CredentialEntry[hive-contribution]`, marks session consumed, returns `{ status: "success", username }`
  - Success but token scope inadequate (would be rare from Device Flow but defensive) → `{ status: "error", error: <validator message> }`, session NOT consumed so user can retry
- [ ] **Step 2: Implement.** Use `encryptSecret` from `@/lib/govern/credential-crypto`. Session-binding check: `if (session.user.id !== devCodeSession.createdBy) return { status: "error", error: "Session does not belong to caller" };`
- [ ] **Step 3: Tests green.**

### Task 4.5: Transient session cleanup

- [ ] **Step 1: Failing test:** utility `cleanupExpiredDeviceCodeSessions()` deletes rows where `expiresAt < now()` and returns the count.
- [ ] **Step 2: Implement** the utility. Hook it into `apps/web/lib/queue/functions/infra-prune.ts` (the existing maintenance/prune Inngest fn — verified to exist). If a new fn is needed instead, create `apps/web/lib/queue/functions/cleanup-device-codes.ts` with `cron: "0 */6 * * *"` (6-hourly is sufficient given 15-min TTL; daily would let rows accumulate up to 24h).
- [ ] **Step 3: Tests green.**

### Task 4.6: Verify + PR

- [ ] Tests: `pnpm --filter @dpf/web test github-device-flow github-oauth`.
- [ ] Typecheck + build.
- [ ] Commit, push, PR titled `feat(github-oauth): Device Flow backend + DeviceCodeSession model`.
- [ ] PR body MUST document the `GITHUB_OAUTH_CLIENT_ID` env var requirement for deploy and flag that Phase 5 (UI) is needed before end-to-end usable.

---

## Phase 5 — OAuth Device Flow Admin UI

**Branch:** `feat/gh-auth-device-flow-ui`
**Worktree:** `D:/DPF-gh-device-ui`
**Dependencies:** Phase 4 merged.

**Files:**
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx` (significant refactor)
- Create: `apps/web/components/admin/ConnectGitHubCard.tsx` (new subcomponent)
- Create: `apps/web/components/admin/ConnectGitHubCard.test.tsx`
- Create: `apps/web/components/admin/AdvancedTokenPaste.tsx` (refactored existing paste UI, now collapsed)
- Reference only: 2026-04-23 Phase 5 admin UI changes (merge conflicts likely — see below)

**Merge-conflict discipline**

2026-04-23 Phase 5 also modifies `PlatformDevelopmentForm.tsx`. When Phase 5-of-this-plan starts, run `git log --all --oneline -- apps/web/components/admin/PlatformDevelopmentForm.tsx | head -5` and verify whether 2026-04-23 Phase 5 has landed. If it has, rebase on `main` before starting; treat its copy-from-shared-module pattern as the baseline (do NOT regress the `CONTRIBUTION_COPY` import).

### Task 5.1: `ConnectGitHubCard` component

- [ ] **Step 1: Failing tests** covering:
  - Unconnected state: renders "Connect GitHub" button, no polling state
  - Click button → calls `initiateDeviceFlow` → renders user code + verification URI + Copy button + spinner
  - Polling: every `interval` seconds calls `pollDeviceFlow`; on `pending` keeps spinner; on `success` shows "Connected as @username"; on `error` shows error + retry
  - Connected state (prop passed in): shows "Connected as @username, since <date>" + Disconnect button
- [ ] **Step 2: Implement** as client component (polling requires hooks). Use `useEffect` + `setInterval` for poll loop with explicit `clearInterval` on unmount/success/error (recursive `setTimeout` is brittle under React 19 strict-mode double-mount).
- [ ] **Step 3: Tests green.**

### Task 5.2: `AdvancedTokenPaste` component

- [ ] **Step 1: Failing tests:**
  - Collapsed by default; clicking disclosure expands
  - Contains two input sections: "Fine-grained PAT" + "Classic PAT" with distinct warnings (classic-PAT warning matches spec copy)
  - Submit calls the existing `saveContributionSetup` action (unchanged) with the pasted token
- [ ] **Step 2: Implement.** Extract existing paste form from `PlatformDevelopmentForm` into this component; add the two-tier split.
- [ ] **Step 3: Tests green.**

### Task 5.3: `PlatformDevelopmentForm` refactor

- [ ] **Step 1: Update snapshot/shape tests** of the form to expect:
  - `ConnectGitHubCard` at top (always visible)
  - `AdvancedTokenPaste` below (collapsed disclosure)
  - Existing contribution-mode selector unchanged
- [ ] **Step 2: Refactor.** Replace inline token form with the two new components.
- [ ] **Step 3: Tests green.**

### Task 5.4: Manual browser verification

- [ ] **Step 1:** Start the dev stack: `docker compose up -d portal postgres`.
- [ ] **Step 2:** Visit `/admin/platform-development`. Walk the Device Flow end-to-end against the real OAuth app. Confirm:
  - Button shows user code
  - Copy button works
  - Visiting `github.com/login/device` + entering the code authorizes
  - Spinner flips to "Connected" on success
  - Disconnect button clears state
- [ ] **Step 3:** Screenshot each state for the Phase 8 docs.

### Task 5.5: Verify + PR

- [ ] Tests: `pnpm --filter @dpf/web test ConnectGitHubCard AdvancedTokenPaste PlatformDevelopmentForm`.
- [ ] Typecheck + build.
- [ ] Commit, push, PR titled `feat(admin-ui): OAuth Device Flow Connect GitHub card`.

---

## Phase 6a — `PlatformNotification` model (prerequisite PR)

**Branch:** `chore/platform-notification-model`
**Worktree:** `D:/DPF-gh-notif-model`
**Dependencies:** None.
**Blast radius:** Pure additive schema change. No callers in this PR; Phase 6 consumes it.

Confirmed absent in main via `rg "model PlatformNotification" packages/db` — returns no matches. One concern per PR (AGENTS.md) means a new shared schema model merges alone.

**Files:**
- Modify: `packages/db/prisma/schema.prisma` (add model)
- Create: `packages/db/prisma/migrations/<ts>_add_platform_notification/migration.sql`

### Task 6a.1: Add model + migration

- [ ] **Step 1: Add to schema.prisma** near other notification-like models (search for existing notification models first; co-locate if any):
  ```prisma
  model PlatformNotification {
    id         String    @id @default(cuid())
    severity   String    // "info" | "warning" | "critical" | "expired"
    category   String    // e.g. "token-expiry"
    subjectId  String?   // e.g. CredentialEntry.providerId
    message    String    @db.Text
    createdAt  DateTime  @default(now())
    resolvedAt DateTime?

    @@index([category, resolvedAt])
  }
  ```
- [ ] **Step 2: Generate migration** via `pnpm --filter @dpf/db exec prisma migrate dev --name add_platform_notification` (runs `prisma generate` implicitly).
- [ ] **Step 3: Verify** migration SQL touches only the new table.
- [ ] **Step 4: Typecheck** (`pnpm --filter @dpf/web exec tsc --noEmit`) — no new consumers yet, but confirm Prisma client regeneration didn't break unrelated imports.
- [ ] **Step 5: Commit + PR** `chore(db): add PlatformNotification model`.

---

## Phase 6 — Token Expiry Monitoring

**Branch:** `feat/gh-auth-token-expiry-monitor`
**Worktree:** `D:/DPF-gh-expiry`
**Dependencies:** Phase 3 merged (validator sets `tokenExpiresAt`) AND Phase 6a merged (`PlatformNotification` model exists).

**Files:**
- Create: `apps/web/lib/queue/functions/token-expiry-monitor.ts` (Inngest scheduled fn)
- Create: `apps/web/lib/queue/functions/token-expiry-monitor.test.ts`
- Modify: `apps/web/lib/queue/index.ts` (register the function)
- Create: `apps/web/components/admin/TokenExpiryBanner.tsx`
- Create: `apps/web/components/admin/TokenExpiryBanner.test.tsx`
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx` (render banner when relevant)

### Task 6.1: (empty — model already added in Phase 6a)

### Task 6.2: Inngest scheduled function

- [ ] **Step 1: Failing tests:**
  - Credential 40 days to expiry → no notification written
  - 30 days → `info` notification
  - 14 days → `warning` (upserts, does not duplicate on re-run)
  - 7 days → `critical`
  - 0 days → `expired`
  - Re-running on the same day doesn't create a second notification at the same severity
  - Severity escalates (e.g. `warning` at 14 → `critical` at 7 replaces the old one; `resolvedAt` on the old)
- [ ] **Step 2: Implement.** `cron: "0 9 * * *"` (daily 09:00 UTC). Query `CredentialEntry` where `tokenExpiresAt IS NOT NULL AND status = "active"`. For each, compute days-to-expiry, map to severity, upsert notification keyed on `(category, subjectId)`.
- [ ] **Step 3: Tests green.**

### Task 6.3: Admin banner

- [ ] **Step 1: Failing tests.** `TokenExpiryBanner`:
  - No active token-expiry notification → renders nothing
  - Active `warning` notification → renders yellow banner with days remaining + [Reconnect] + [Update token] links
  - Active `critical` → red banner
  - Active `expired` → "Your token expired. Reconnect now to resume contributing."
- [ ] **Step 2: Implement** as Server Component; query the notification once per render.
- [ ] **Step 3: Wire into `PlatformDevelopmentForm`.**
- [ ] **Step 4: Tests green.**

### Task 6.4: Verify + PR

- [ ] Tests, typecheck, build.
- [ ] Commit, push, PR titled `feat(token-expiry): daily monitoring + admin banner`.

---

## Phase 7 — Opportunistic Re-Encryption + `HIVE_CONTRIBUTION_TOKEN` Deprecation

**Branch:** `feat/gh-auth-legacy-deprecation`
**Worktree:** `D:/DPF-gh-legacy`
**Dependencies:** None (Phase 2 nice-to-have first but not strictly required).

**Files:**
- Modify: `apps/web/lib/integrate/identity-privacy.ts` (`resolveHiveToken` — re-encrypt on read)
- Modify: `apps/web/lib/actions/platform-dev-config.ts` (`getStoredGitHubToken` — same)
- Modify: `apps/web/instrumentation.ts` (deprecation warning)
- Modify: `apps/web/components/admin/PlatformDevelopmentForm.tsx` (legacy-override banner)
- Modify: `.env.docker.example` (deprecation comment on `HIVE_CONTRIBUTION_TOKEN`)
- Create: `apps/web/lib/integrate/identity-privacy.reencrypt.test.ts`

### Task 7.1: Opportunistic re-encryption in `resolveHiveToken`

- [ ] **Step 1: Failing tests:**
  - Stored value NOT prefixed `enc:` + `CREDENTIAL_ENCRYPTION_KEY` set → returns plaintext value AND DB row is updated to encrypted form
  - Stored value already `enc:` → returns decrypted, DB unchanged
  - Stored value plaintext + no encryption key → returns plaintext, DB unchanged (no-op migration in dev)
  - Concurrent-call safety: two simultaneous reads of a plaintext row → both return the same decrypted value, only one `update` actually changes the row (tolerant of the other)
- [ ] **Step 2: Implement.** After decryption falls through to plaintext, check for the key and re-encrypt. Use a guarded update to avoid redundant writes under concurrency — `prisma.credentialEntry.updateMany({ where: { providerId, NOT: { secretRef: { startsWith: "enc:" } } }, data: { secretRef: encrypted } })` and ignore the rowcount. Two concurrent calls each attempt the update; the second is a no-op rather than a double-encrypt.
- [ ] **Step 3: Apply same pattern to `getStoredGitHubToken`.**
- [ ] **Step 4: Tests green.**

### Task 7.2: `HIVE_CONTRIBUTION_TOKEN` deprecation warning

- [ ] **Step 1: Failing test** (use `vi.stubEnv` + `console.warn` spy) that `register()` logs the deprecation when env var is set.
- [ ] **Step 2: Implement** inside `instrumentation.ts`:
  ```typescript
  if (process.env.HIVE_CONTRIBUTION_TOKEN) {
    console.warn(
      "[deprecation] HIVE_CONTRIBUTION_TOKEN is deprecated. Configure GitHub auth via\n" +
      "Admin > Platform Development (OAuth Device Flow recommended). Support will be\n" +
      "removed 60 days after the next release."
    );
  }
  ```
- [ ] **Step 3: Test passes.**

### Task 7.3: Legacy-override admin banner

- [ ] **Step 1: Failing test.** `LegacyTokenOverrideBanner` renders only when a server-side check reports `HIVE_CONTRIBUTION_TOKEN` is set AND a DB credential exists.
- [ ] **Step 2: Implement** server action `checkLegacyTokenOverride()` that returns `{ hasEnvToken, hasDbToken }`; banner renders when both are true.
- [ ] **Step 3: Wire into `PlatformDevelopmentForm`.**
- [ ] **Step 4: Tests green.**

### Task 7.4: `.env.docker.example` comment

- [ ] **Step 1: Update** the `HIVE_CONTRIBUTION_TOKEN` block to say:
  ```
  # DEPRECATED — configure via Admin > Platform Development (OAuth Device Flow recommended).
  # Support for this env var will be removed 60 days after the next release.
  # See docs/superpowers/specs/2026-04-24-github-auth-2fa-readiness-design.md
  HIVE_CONTRIBUTION_TOKEN=
  ```

### Task 7.5: Verify + PR

- [ ] Tests, typecheck, build.
- [ ] Commit, push, PR titled `feat(github-auth): opportunistic re-encryption + HIVE_CONTRIBUTION_TOKEN deprecation`.

---

## Phase 8 — CONTRIBUTING.md Deep Pass

**Branch:** `doc/gh-auth-contributing-three-tier`
**Worktree:** `D:/DPF-gh-contrib-docs`
**Dependencies:** Phase 5 merged (UI exists so screenshots can be taken).

**Files:**
- Modify: `CONTRIBUTING.md` (add "Contributing from a running install — three-tier setup" section)
- Add: `docs/images/contribute-device-flow-*.png` (screenshots captured in Phase 5 Task 5.4)

### Task 8.1: Section draft

- [ ] **Step 1: Draft the section** covering:
  - When to use install-based contribution vs. manual fork+PR
  - Tier 1 (recommended): click Connect GitHub, authorize via Device Flow. Screenshot.
  - Tier 2 (advanced): create a fine-grained PAT on github.com with `public_repo` scope + 90-day+ expiry. Screenshot of GitHub's PAT form + the admin paste form.
  - Tier 3 (emergency): classic PAT — brief, with warning.
  - Pseudonymity tradeoff: restate from spec §Pseudonymity. Link to spec.
  - Machine-user pattern: "If you want full pseudonymity, create a dedicated GitHub account, enable 2FA, and authorize Tier 1 or mint a PAT under that account."
  - Troubleshooting: "Token revoked" → reconnect; "Expired" → banner will appear; "Wrong scope" → save-time error will tell you.
- [ ] **Step 2: Add screenshots** captured during Phase 5 manual test.
- [ ] **Step 3: Link** from the existing contribution-flow section at top.

### Task 8.2: Verify + PR

- [ ] Render the markdown locally (VS Code preview is fine) and confirm screenshots display.
- [ ] Commit, push, PR titled `doc(contributing): three-tier install-based contribution guide`.

---

## Test strategy across phases

- **Unit tests** live next to the code they cover (`*.test.ts` / `*.test.tsx`). Use Vitest.
- **No live GitHub calls in unit tests** — mock `fetch` via `vi.stubGlobal("fetch", ...)`. Integration tests (Phase 4 Task 4.6, Phase 5 Task 5.4) are the only places that talk to real GitHub, and they run manually.
- **Stub cleanup is mandatory** — every test file that uses `vi.stubGlobal` or `vi.stubEnv` adds `afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); })` to prevent leakage into other test files under parallel Vitest runs.
- **Typecheck + production build** are merge-blocking CI; every phase ends with `pnpm --filter @dpf/web exec tsc --noEmit && pnpm --filter @dpf/web build` before pushing.
- **After any `schema.prisma` change** (Phases 4, 6a) confirm `node_modules/.prisma/client` updated — `prisma migrate dev` runs `prisma generate` implicitly, but verify the updated types are picked up by `tsc --noEmit` before committing.

## Rollback plan

Each phase is a standalone PR. If a phase is found broken after merge:

- **Phase 2 fail-loud:** set `NODE_ENV=development` in the environment temporarily to boot; then `git revert` the PR and fix. No DB change.
- **Phase 3 validator:** single-arg callers unchanged — `git revert` is safe. No DB change.
- **Phase 4 Device Flow backend:** rollback requires both code revert AND migration revert. Procedure:
  1. `git revert <phase-4-pr-merge-sha>` and push the revert PR
  2. After merge, mark the migration rolled back: `pnpm --filter @dpf/db exec prisma migrate resolve --rolled-back 20260XXXXXX_add_device_code_session`
  3. Create a new migration to drop the `DeviceCodeSession` table
  4. Deploy
  No UI yet consumes it, so users are unaffected; only the idle schema drops out.
- **Phase 5 UI:** `git revert` restores the paste form. Users in the middle of a Device Flow lose their session; transient rows expire naturally within 15 min. No DB change.
- **Phase 6a model-only PR:** same migration-revert procedure as Phase 4, but for `PlatformNotification`.
- **Phase 6 expiry monitor:** `git revert` removes the monitor + banner; notifications already written remain in the `PlatformNotification` table. Clean up with a manual SQL delete only if storage cost matters (it won't — small row count).
- **Phase 7 re-encryption:** revert halts re-encryption on reads; already-encrypted rows remain encrypted (forward-compatible). Deprecation warnings stop emitting. No DB change.
- **Phase 8 docs:** `git revert` docs only. No code or DB change.

## Open questions resolved in this plan

| Spec Open Question | Resolution |
|---|---|
| #1 Client ID distribution | Read from env var `GITHUB_OAUTH_CLIENT_ID` in Phase 4 Task 4.2. Deployer sets it; deployment doc is updated. Compile-time constant reserved for a later release when a stable build-time secret pipeline exists. |
| #2 Rate budget under load | No pre-emptive guard per spec default. Phase 4 server actions surface 429s with `X-RateLimit-Reset` in the error message; UI message in Phase 5 says "please try again in a minute". |
| #3 Scope validation probe for fine-grained PATs | Phase 3 Task 3.4 implements: probe `GET /repos/{expectedOwner}/{repo}` when `expectedOwner` is supplied; fall back to `GET /user` when not. The fork-pr chicken-and-egg is handled in admin UI by requiring fork setup first (existing 2026-04-23 flow). |
| #4 Revocation detection | No polling. `contribute_to_hive` catches 401 and surfaces actionable error; admin can reconnect. |
| #5 Machine-user pattern | Documented in Phase 8. No code change; existing `machineUserOptIn` checkbox from 2026-04-23 Phase 5 covers the platform-side need. |

## Execution handoff

- **Recommended:** `superpowers:subagent-driven-development` — dispatch one implementer subagent per phase, review between phases, each subagent opens its own PR.
- **Alternate:** `superpowers:executing-plans` — batch execution with checkpoints after each PR merges.
- **Parallelism opportunity:** Phases 2, 3, and 7 can run in parallel in separate worktrees since they touch disjoint files. Phase 4/5/6/8 serialize after their predecessors.

## Branch/worktree summary

| Phase | Worktree | Branch | PR title |
|---|---|---|---|
| 2 | `D:/DPF-gh-cred-key` | `chore/gh-auth-cred-key-fail-loud` | `chore(credential-crypto): fail-loud on missing encryption key in production` |
| 3 | `D:/DPF-gh-validate` | `feat/gh-auth-validate-extended` | `feat(validate-github-token): scope + expiry + prefix auth-method detection` |
| 4 | `D:/DPF-gh-device-backend` | `feat/gh-auth-device-flow-backend` | `feat(github-oauth): Device Flow backend + DeviceCodeSession model` |
| 5 | `D:/DPF-gh-device-ui` | `feat/gh-auth-device-flow-ui` | `feat(admin-ui): OAuth Device Flow Connect GitHub card` |
| 6a | `D:/DPF-gh-notif-model` | `chore/platform-notification-model` | `chore(db): add PlatformNotification model` |
| 6 | `D:/DPF-gh-expiry` | `feat/gh-auth-token-expiry-monitor` | `feat(token-expiry): daily monitoring + admin banner` |
| 7 | `D:/DPF-gh-legacy` | `feat/gh-auth-legacy-deprecation` | `feat(github-auth): opportunistic re-encryption + HIVE_CONTRIBUTION_TOKEN deprecation` |
| 8 | `D:/DPF-gh-contrib-docs` | `doc/gh-auth-contributing-three-tier` | `doc(contributing): three-tier install-based contribution guide` |
