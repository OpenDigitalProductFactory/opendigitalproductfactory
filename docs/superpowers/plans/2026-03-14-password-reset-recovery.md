# Password Reset Recovery Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure token-based password recovery flow with user self-service pages, admin-issued manual recovery, and an email-delivery seam for future outbound mail support.

**Architecture:** Extend the auth model with a `PasswordResetToken` table and a small password-recovery service layer. Keep login on the existing NextAuth credentials flow, add recovery routes and server actions in the web app, and route both email-enabled and manual fallback recovery through the same token lifecycle so there is only one reset mechanism to secure and test.

**Tech Stack:** Next.js 16 App Router, server actions, NextAuth credentials, Prisma/PostgreSQL, Vitest, TypeScript

---

## File Structure

**Database and shared recovery primitives**
- Modify: `packages/db/prisma/schema.prisma`
  - Add `PasswordResetToken` model.
- Create: `packages/db/prisma/migrations/<timestamp>_add_password_reset_tokens/migration.sql`
  - Persist the new table and indexes.
- Create: `apps/web/lib/password-reset.ts`
  - Token generation, hashing, expiry checks, lookup helpers, and delivery capability resolution.
- Create: `apps/web/lib/password-reset.test.ts`
  - Pure token lifecycle and delivery-mode tests.

**User-facing recovery flow**
- Modify: `apps/web/app/(auth)/login/page.tsx`
  - Add `Forgot password?` link and success-state query messaging.
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
  - Neutral reset-request page and form.
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
  - Token redemption page and new-password form.
- Create: `apps/web/components/auth/ForgotPasswordForm.tsx`
  - Client form shell for request submission.
- Create: `apps/web/components/auth/ResetPasswordForm.tsx`
  - Client form shell for reset completion.
- Create: `apps/web/app/(auth)/login/page.test.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.test.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.test.tsx`

**Server actions and admin fallback**
- Modify: `apps/web/lib/actions/users.ts`
  - Add request-reset, admin-issue-reset, and complete-reset actions.
  - Shift admin password reset away from direct password overwrite.
- Modify: `apps/web/lib/actions/users.test.ts`
  - Cover request neutrality, admin fallback issuance, token redemption, and consumed/expired token behavior.
- Modify: `apps/web/components/admin/AdminUserAccessPanel.tsx`
  - Replace direct reset-password behavior with issued recovery flow and one-time manual link display when email is unavailable.

**Auth-adjacent routing/config**
- Modify: `apps/web/proxy.ts`
  - Ensure forgot/reset pages remain publicly reachable.
- Optional modify if needed: `apps/web/lib/auth.ts`
  - Keep login behavior stable, but only if route or callback wiring needs a small adjustment.

---

## Chunk 1: Password Reset Data Model and Recovery Helpers

### Task 1: Add the password reset token schema with tests around helper behavior

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_password_reset_tokens/migration.sql`
- Create: `apps/web/lib/password-reset.ts`
- Create: `apps/web/lib/password-reset.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests in `apps/web/lib/password-reset.test.ts` for:
- hashing raw reset tokens deterministically
- recognizing expired vs valid tokens
- resolving `email` vs `manual` delivery mode from a simple config seam

Minimal sketch:

```ts
it("hashes reset tokens before persistence", async () => {
  await expect(hashPasswordResetToken("raw-token")).resolves.not.toBe("raw-token");
});

it("rejects expired reset tokens", () => {
  expect(isPasswordResetExpired(new Date("2026-03-14T00:00:00Z"), new Date("2026-03-14T00:01:00Z"))).toBe(true);
});

it("falls back to manual delivery when mail is not configured", () => {
  expect(resolvePasswordResetDeliveryMode({ emailEnabled: false })).toBe("manual");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test -- lib/password-reset.test.ts`  
Expected: FAIL because `password-reset.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal helper module**

In `apps/web/lib/password-reset.ts` add:
- `hashPasswordResetToken(rawToken: string): Promise<string>`
- `createPasswordResetToken(): string`
- `isPasswordResetExpired(expiresAt: Date, now = new Date()): boolean`
- `resolvePasswordResetDeliveryMode(input: { emailEnabled: boolean }): "email" | "manual"`
- small constants such as reset lifetime in minutes

Keep this file pure and narrow.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter web test -- lib/password-reset.test.ts`  
Expected: PASS

- [ ] **Step 5: Add the schema model and migration**

Add `PasswordResetToken` in `packages/db/prisma/schema.prisma` with:
- `id`
- `userId`
- relation to `User`
- `tokenHash`
- `deliveryChannel`
- `requestedByUserId`
- `expiresAt`
- `consumedAt`
- `createdAt`

Create the matching migration SQL with:
- table creation
- index on `userId`
- index on `expiresAt`
- index on `consumedAt`
- uniqueness on `tokenHash`

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations apps/web/lib/password-reset.ts apps/web/lib/password-reset.test.ts
git commit -m "feat: add password reset token foundation"
```

## Chunk 2: Server Actions for Request, Issue, and Redeem

### Task 2: Add request and redemption action tests first

**Files:**
- Modify: `apps/web/lib/actions/users.ts`
- Modify: `apps/web/lib/actions/users.test.ts`
- Modify: `apps/web/lib/password-reset.ts`

- [ ] **Step 1: Write the failing action tests**

Add tests for:
- reset request returns a neutral success message for both existing and non-existing emails
- valid token can complete a password reset
- expired token is rejected
- consumed token is rejected
- admin-issued manual recovery returns a one-time recovery link payload when email is unavailable

Minimal sketch:

```ts
it("returns a neutral message for unknown emails", async () => {
  const result = await requestPasswordReset({ email: "unknown@example.com" });
  expect(result.ok).toBe(true);
  expect(result.message).toContain("If an account exists");
});

it("consumes a valid token and updates the password hash", async () => {
  const result = await completePasswordReset({
    token: "raw-token",
    newPassword: "ValidPassword1!",
  });
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter web test -- lib/actions/users.test.ts`  
Expected: FAIL because the new actions do not exist.

- [ ] **Step 3: Implement the minimal actions**

In `apps/web/lib/actions/users.ts` add:
- `requestPasswordReset(input: { email: string }): Promise<UserActionResult>`
- `completePasswordReset(input: { token: string; newPassword: string; confirmPassword: string }): Promise<UserActionResult>`
- `adminIssuePasswordReset(input: { userId: string }): Promise<UserActionResult & { recoveryLink?: string }>`

Implementation details:
- request action:
  - normalize email
  - look up active user if present
  - create token only for real active users
  - always return the same user-safe message
- completion action:
  - hash submitted token
  - load token record with user
  - reject missing, expired, or consumed token
  - enforce current password policy
  - update `user.passwordHash`
  - mark token consumed
- admin issue action:
  - require `manage_users`
  - create manual token when email is not configured
  - return one-time recovery link in response

Use the shared helper module for hashing and delivery-mode selection.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- lib/actions/users.test.ts lib/password-reset.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/users.ts apps/web/lib/actions/users.test.ts apps/web/lib/password-reset.ts apps/web/lib/password-reset.test.ts
git commit -m "feat: add password recovery server actions"
```

## Chunk 3: Login, Forgot Password, and Reset Password Pages

### Task 3: Add the user-facing recovery pages with test-first coverage

**Files:**
- Modify: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Create: `apps/web/components/auth/ForgotPasswordForm.tsx`
- Create: `apps/web/components/auth/ResetPasswordForm.tsx`
- Create: `apps/web/app/(auth)/login/page.test.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.test.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.test.tsx`

- [ ] **Step 1: Write the failing page tests**

Add coverage for:
- login page contains `Forgot password?`
- forgot-password page renders an email field and neutral help text
- reset-password page renders token-bound password fields

Example:

```tsx
it("shows a forgot password link on the login page", () => {
  const html = renderToStaticMarkup(<LoginPage />);
  expect(html).toContain("Forgot password?");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- app/'(auth)'/login/page.test.tsx app/'(auth)'/forgot-password/page.test.tsx app/'(auth)'/reset-password/page.test.tsx`  
Expected: FAIL because the pages and forms are incomplete or absent.

- [ ] **Step 3: Implement the minimal pages and form components**

In `apps/web/app/(auth)/login/page.tsx`:
- add `Forgot password?` link to `/forgot-password`
- optionally read a query param such as `reset=success` for a success banner

In `apps/web/app/(auth)/forgot-password/page.tsx` and `apps/web/components/auth/ForgotPasswordForm.tsx`:
- render one email field
- submit to `requestPasswordReset`
- show neutral success message

In `apps/web/app/(auth)/reset-password/page.tsx` and `apps/web/components/auth/ResetPasswordForm.tsx`:
- accept token from search params
- render new password + confirm password
- submit to `completePasswordReset`
- redirect to `/login?reset=success` after success

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- app/'(auth)'/login/page.test.tsx app/'(auth)'/forgot-password/page.test.tsx app/'(auth)'/reset-password/page.test.tsx`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/(auth)/login/page.tsx apps/web/app/(auth)/forgot-password/page.tsx apps/web/app/(auth)/reset-password/page.tsx apps/web/components/auth/ForgotPasswordForm.tsx apps/web/components/auth/ResetPasswordForm.tsx apps/web/app/(auth)/login/page.test.tsx apps/web/app/(auth)/forgot-password/page.test.tsx apps/web/app/(auth)/reset-password/page.test.tsx
git commit -m "feat: add user-facing password recovery pages"
```

## Chunk 4: Admin Fallback Recovery and Public Route Access

### Task 4: Replace direct admin password reset behavior with issued recovery

**Files:**
- Modify: `apps/web/components/admin/AdminUserAccessPanel.tsx`
- Modify: `apps/web/lib/actions/users.ts`
- Modify: `apps/web/lib/actions/users.test.ts`
- Modify: `apps/web/proxy.ts`

- [ ] **Step 1: Write the failing admin and route tests**

Add tests for:
- admin panel uses issued recovery rather than direct password overwrite messaging
- public auth middleware allows `/forgot-password` and `/reset-password`

If `proxy.ts` test coverage does not exist, add a focused pure helper or small unit seam first rather than broad integration scaffolding.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- lib/actions/users.test.ts`  
Expected: FAIL until admin fallback behavior is updated.

- [ ] **Step 3: Implement the admin/manual fallback path**

In `apps/web/components/admin/AdminUserAccessPanel.tsx`:
- replace "New password" reset input with an issued recovery action
- show whether reset delivery was by email or manual link
- when manual:
  - reveal one-time recovery link inline after issuance

In `apps/web/proxy.ts`:
- ensure `/forgot-password` and `/reset-password` remain in the public path allowlist

Keep the admin flow aligned with the same token lifecycle used by user self-service.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test -- lib/actions/users.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/AdminUserAccessPanel.tsx apps/web/lib/actions/users.ts apps/web/lib/actions/users.test.ts apps/web/proxy.ts
git commit -m "feat: add admin-assisted password recovery fallback"
```

## Chunk 5: Full Verification

### Task 5: Run the full verification pass

**Files:**
- Verify all files touched above

- [ ] **Step 1: Run targeted automated tests**

Run:

```bash
pnpm --filter web test -- lib/password-reset.test.ts lib/actions/users.test.ts app/'(auth)'/login/page.test.tsx app/'(auth)'/forgot-password/page.test.tsx app/'(auth)'/reset-password/page.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --filter web typecheck
```

Expected: PASS

- [ ] **Step 3: Run production build**

Run:

```bash
$env:DATABASE_URL='postgresql://dpf:dpf_dev@localhost:5432/dpf'; pnpm --filter web build
```

Expected: PASS

- [ ] **Step 4: Manual verification checklist**

Verify in browser:
- login page shows `Forgot password?`
- forgot-password page accepts an email and always returns neutral messaging
- reset-password page rejects invalid token
- valid manual recovery link allows password reset
- new password can be used to sign in afterward
- admin panel issues recovery instead of directly setting a password

- [ ] **Step 5: Commit final polish if needed**

```bash
git status --short
git add apps/web/app/(auth) apps/web/components/auth apps/web/components/admin/AdminUserAccessPanel.tsx apps/web/lib/actions/users.ts apps/web/lib/actions/users.test.ts apps/web/lib/password-reset.ts apps/web/lib/password-reset.test.ts apps/web/proxy.ts packages/db/prisma/schema.prisma packages/db/prisma/migrations docs/superpowers/plans/2026-03-14-password-reset-recovery.md
git commit -m "fix: add secure password recovery flow"
```

If no files changed during verification, skip this commit.
