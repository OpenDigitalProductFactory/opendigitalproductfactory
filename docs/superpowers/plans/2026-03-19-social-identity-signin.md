# Social Identity Sign-In Implementation Plan

> **Status:** Implemented (2026-03-19)

**Goal:** Add Google and Apple sign-in to the customer portal alongside existing email/password, with account linking and new customer onboarding.

**Architecture:** Extend existing NextAuth v5 config with Google/Apple providers. New `SocialIdentity` and `AccountInvite` Prisma models. Three auth flows (direct sign-in, prompt-to-link, new customer onboard) routed via the `signIn` callback. Bcrypt upgrade for password hashing. Admin settings panel for provider credential management.

**Tech Stack:** NextAuth v5 (beta.30), Prisma, PostgreSQL, React, bcryptjs, jose (JWT signing for temp tokens)

**Spec:** `docs/superpowers/specs/2026-03-19-social-identity-signin-design.md`

**Activation:** Admin → Settings → Social Sign-In for Customers. Enter provider credentials, social buttons appear automatically on customer login/signup pages. No env file editing or server restart needed.

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `apps/web/lib/social-auth.ts` | Social sign-in routing logic (3 flows), temp token creation/verification, rate limiting state |
| `apps/web/lib/password.ts` | Bcrypt hashing + SHA-256 legacy check, shared by auth.ts and customer-auth.ts |
| `apps/web/lib/actions/social-auth-actions.ts` | Server actions: link account, complete profile (create account + contact + identity) |
| `apps/web/lib/actions/invite-actions.ts` | Server actions: generate invite code, validate invite code |
| `apps/web/app/(customer-auth)/customer-link-account/page.tsx` | Prompt-to-link UI page |
| `apps/web/app/(customer-auth)/customer-complete-profile/page.tsx` | New customer onboarding UI page |
| `apps/web/components/social-buttons.tsx` | Reusable Google/Apple sign-in button component |
| `apps/web/lib/social-auth.test.ts` | Tests for social auth routing logic |
| `apps/web/lib/password.test.ts` | Tests for password hashing (bcrypt + SHA-256 compat) |
| `apps/web/lib/actions/social-auth-actions.test.ts` | Tests for link and onboard server actions |
| `apps/web/lib/actions/invite-actions.test.ts` | Tests for invite code generation and validation |

### Modified Files
| File | Changes |
|------|---------|
| `packages/db/prisma/schema.prisma` | Add `SocialIdentity`, `AccountInvite` models; add `name` + relation to `CustomerContact`; add relation to `CustomerAccount` |
| `apps/web/lib/auth.ts` | Add Google/Apple providers, update `signIn` callback to route social sign-ins, update `jwt` callback for social sessions |
| `apps/web/lib/actions/customer-auth.ts` | Replace SHA-256 `hashPassword` with import from `password.ts` |
| `apps/web/lib/public-paths.ts` | Add `/customer-link-account` and `/customer-complete-profile` |
| `apps/web/app/(customer-auth)/customer-login/page.tsx` | Add social buttons + divider above form |
| `apps/web/app/(customer-auth)/customer-signup/page.tsx` | Add social buttons + divider above form |
| `apps/web/.env.local` | Add Google/Apple env vars (placeholder values) |
| `.env.example` | Add Google/Apple env var documentation |

---

## Task 1: Schema Migration — SocialIdentity, AccountInvite, CustomerContact.name

**Files:**
- Modify: `packages/db/prisma/schema.prisma:54-62` (CustomerContact model)
- Modify: `packages/db/prisma/schema.prisma:1045-1053` (CustomerAccount model)

- [ ] **Step 1: Add SocialIdentity model to schema**

In `packages/db/prisma/schema.prisma`, add after the `CustomerContact` model (after line 62):

```prisma
model SocialIdentity {
  id                String          @id @default(cuid())
  provider          String
  providerAccountId String
  email             String?
  contactId         String
  contact           CustomerContact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  linkedAt          DateTime        @default(now())

  @@unique([provider, providerAccountId])
  @@index([contactId])
}
```

- [ ] **Step 2: Add AccountInvite model to schema**

In `packages/db/prisma/schema.prisma`, add after the `SocialIdentity` model:

```prisma
model AccountInvite {
  id        String          @id @default(cuid())
  code      String          @unique
  accountId String
  account   CustomerAccount @relation(fields: [accountId], references: [id], onDelete: Cascade)
  createdBy String?
  expiresAt DateTime?
  usedAt    DateTime?
  usedBy    String?
  createdAt DateTime        @default(now())
}
```

- [ ] **Step 3: Add name and relation to CustomerContact**

Update the `CustomerContact` model to add `name` field and `socialIdentities` relation:

```prisma
model CustomerContact {
  id               String           @id @default(cuid())
  email            String           @unique
  name             String?
  passwordHash     String?
  accountId        String
  account          CustomerAccount  @relation(fields: [accountId], references: [id])
  isActive         Boolean          @default(true)
  createdAt        DateTime         @default(now())
  socialIdentities SocialIdentity[]
}
```

- [ ] **Step 4: Add invites relation to CustomerAccount**

Update `CustomerAccount` to add the `invites` relation:

```prisma
model CustomerAccount {
  id        String            @id @default(cuid())
  accountId String            @unique
  name      String
  status    String            @default("prospect")
  createdAt DateTime          @default(now())
  updatedAt DateTime          @updatedAt
  contacts  CustomerContact[]
  invites   AccountInvite[]
}
```

- [ ] **Step 5: Generate and apply migration**

Run:
```bash
cd packages/db && npx prisma migrate dev --name add_social_identity_and_invite
```

Expected: Migration created and applied. New tables `SocialIdentity` and `AccountInvite` created, `name` column added to `CustomerContact`.

- [ ] **Step 6: Regenerate Prisma client**

Run:
```bash
cd packages/db && npx prisma generate
```

Expected: Prisma Client regenerated with new types.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add SocialIdentity, AccountInvite models and CustomerContact.name"
```

---

## Task 2: Password Hashing Upgrade — bcrypt with SHA-256 Compatibility

**Files:**
- Create: `apps/web/lib/password.ts`
- Create: `apps/web/lib/password.test.ts`
- Modify: `apps/web/lib/auth.ts:7-13` (remove inline hashPassword)
- Modify: `apps/web/lib/actions/customer-auth.ts:7-13` (remove inline hashPassword)

- [ ] **Step 1: Write failing tests for password module**

Create `apps/web/lib/password.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("hashPassword", () => {
  it("returns a bcrypt hash starting with $2", async () => {
    const hash = await hashPassword("testpassword");
    expect(hash.startsWith("$2")).toBe(true);
  });

  it("produces different hashes for same input (salted)", async () => {
    const hash1 = await hashPassword("same");
    const hash2 = await hashPassword("same");
    expect(hash1).not.toBe(hash2);
  });
});

describe("verifyPassword", () => {
  it("verifies a bcrypt hash", async () => {
    const hash = await hashPassword("mypassword");
    const result = await verifyPassword("mypassword", hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(false);
  });

  it("rejects wrong password against bcrypt hash", async () => {
    const hash = await hashPassword("correct");
    const result = await verifyPassword("wrong", hash);
    expect(result.valid).toBe(false);
  });

  it("verifies a legacy SHA-256 hash and flags for rehash", async () => {
    // SHA-256 of "legacypass"
    const encoder = new TextEncoder();
    const data = encoder.encode("legacypass");
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const sha256Hash = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await verifyPassword("legacypass", sha256Hash);
    expect(result.valid).toBe(true);
    expect(result.needsRehash).toBe(true);
  });

  it("rejects wrong password against SHA-256 hash", async () => {
    const sha256Hash = "a".repeat(64); // fake but valid-length hex
    const result = await verifyPassword("anything", sha256Hash);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/password.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement password module**

Create `apps/web/lib/password.ts`:

```ts
import bcrypt from "bcryptjs";

const BCRYPT_ROUNDS = 12;

/** Hash a password with bcrypt. Use for all new passwords. */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

/**
 * Verify a password against a stored hash.
 * Supports both bcrypt and legacy SHA-256 hashes.
 * Returns { valid, needsRehash } — caller should re-hash and update if needsRehash is true.
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ valid: boolean; needsRehash: boolean }> {
  // Bcrypt hashes start with "$2a$", "$2b$", or "$2y$"
  if (storedHash.startsWith("$2")) {
    const valid = await bcrypt.compare(password, storedHash);
    return { valid, needsRehash: false };
  }

  // Legacy SHA-256 check: 64-char hex string
  if (storedHash.length === 64 && /^[0-9a-f]+$/.test(storedHash)) {
    const data = new TextEncoder().encode(password);
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    const sha256 = Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const valid = sha256 === storedHash;
    return { valid, needsRehash: valid }; // Only rehash if valid
  }

  return { valid: false, needsRehash: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/password.test.ts`
Expected: All 5 tests PASS

- [ ] **Step 5: Update auth.ts to use new password module**

In `apps/web/lib/auth.ts`:
- Remove the inline `hashPassword` function (lines 7-13)
- Add import: `import { verifyPassword, hashPassword } from "./password.js";`
- In the workforce `authorize` function, replace:
  ```ts
  const hash = await hashPassword(credentials.password as string);
  if (hash !== user.passwordHash) return null;
  ```
  with:
  ```ts
  const { valid, needsRehash } = await verifyPassword(credentials.password as string, user.passwordHash);
  if (!valid) return null;
  if (needsRehash) {
    const newHash = await hashPassword(credentials.password as string);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
  }
  ```
- Do the same in the customer `authorize` function, updating:
  ```ts
  const hash = await hashPassword(credentials.password as string);
  if (hash !== contact.passwordHash) return null;
  ```
  to:
  ```ts
  const { valid, needsRehash } = await verifyPassword(credentials.password as string, contact.passwordHash);
  if (!valid) return null;
  if (needsRehash) {
    const newHash = await hashPassword(credentials.password as string);
    await prisma.customerContact.update({ where: { id: contact.id }, data: { passwordHash: newHash } });
  }
  ```

- [ ] **Step 6: Update customer-auth.ts to use new password module**

In `apps/web/lib/actions/customer-auth.ts`:
- Remove the inline `hashPassword` function (lines 7-13)
- Add import: `import { hashPassword } from "@/lib/password";`
- The `customerSignup` function already calls `hashPassword(input.password)` — no other changes needed.

- [ ] **Step 7: Run existing auth tests**

Run: `cd apps/web && npx vitest run lib/auth.test.ts`
Expected: All existing tests PASS (auth-utils tests are unaffected)

- [ ] **Step 8: Commit**

```bash
git add apps/web/lib/password.ts apps/web/lib/password.test.ts apps/web/lib/auth.ts apps/web/lib/actions/customer-auth.ts
git commit -m "feat(auth): upgrade password hashing to bcrypt with SHA-256 lazy migration"
```

---

## Task 3: Social Auth Routing Logic

**Files:**
- Create: `apps/web/lib/social-auth.ts`
- Create: `apps/web/lib/social-auth.test.ts`

- [ ] **Step 0: Install jose dependency**

Run: `cd apps/web && pnpm add jose`
(jose is used for temp token JWT signing — lightweight, zero-dependency)

- [ ] **Step 1: Write failing tests for social auth routing**

Create `apps/web/lib/social-auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { determineSocialAuthFlow, createTempToken, verifyTempToken } from "./social-auth.js";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    socialIdentity: {
      findUnique: vi.fn(),
    },
    customerContact: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("determineSocialAuthFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 'sign-in' when SocialIdentity exists", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "si-1",
      contactId: "c-1",
      contact: {
        id: "c-1",
        email: "user@test.com",
        isActive: true,
        account: { id: "a-1", accountId: "CUST-1234", name: "TestCo", status: "active" },
      },
    });

    const result = await determineSocialAuthFlow({
      provider: "google",
      providerAccountId: "google-123",
      email: "user@test.com",
      name: "Test User",
    });

    expect(result.flow).toBe("sign-in");
    expect(result.contact).toBeDefined();
  });

  it("returns 'link' when email matches existing contact with password", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-2",
      email: "existing@test.com",
      passwordHash: "$2a$12$somebcrypthash",
      isActive: true,
      account: { id: "a-2", accountId: "CUST-5678", name: "ExistCo", status: "active" },
    });

    const result = await determineSocialAuthFlow({
      provider: "google",
      providerAccountId: "google-456",
      email: "existing@test.com",
      name: "Existing User",
    });

    expect(result.flow).toBe("link");
    expect(result.contact).toBeDefined();
  });

  it("returns 'auto-link' when email matches contact with null password", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-3",
      email: "nopw@test.com",
      passwordHash: null,
      isActive: true,
      account: { id: "a-3", accountId: "CUST-9999", name: "NoPwCo", status: "active" },
    });

    const result = await determineSocialAuthFlow({
      provider: "apple",
      providerAccountId: "apple-789",
      email: "nopw@test.com",
      name: "NoPw User",
    });

    expect(result.flow).toBe("auto-link");
  });

  it("returns 'onboard' when no identity or contact match", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await determineSocialAuthFlow({
      provider: "google",
      providerAccountId: "google-new",
      email: "brand-new@test.com",
      name: "New User",
    });

    expect(result.flow).toBe("onboard");
    expect(result.contact).toBeUndefined();
  });

  it("returns 'blocked' when matched contact is inactive", async () => {
    (prisma.socialIdentity.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-4",
      email: "inactive@test.com",
      passwordHash: "somehash",
      isActive: false,
      account: { id: "a-4", accountId: "CUST-0000", name: "InactiveCo", status: "active" },
    });

    const result = await determineSocialAuthFlow({
      provider: "google",
      providerAccountId: "google-inactive",
      email: "inactive@test.com",
      name: "Inactive User",
    });

    expect(result.flow).toBe("blocked");
  });
});

describe("temp tokens", () => {
  it("creates and verifies a temp token", async () => {
    const payload = { provider: "google", providerAccountId: "g-1", email: "a@b.com", name: "A" };
    const token = await createTempToken(payload);
    expect(typeof token).toBe("string");

    const verified = await verifyTempToken(token);
    expect(verified.provider).toBe("google");
    expect(verified.providerAccountId).toBe("g-1");
    expect(verified.email).toBe("a@b.com");
  });

  it("rejects an invalid token", async () => {
    await expect(verifyTempToken("garbage")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/social-auth.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement social auth routing logic**

Create `apps/web/lib/social-auth.ts`:

```ts
import { prisma } from "@dpf/db";
import { SignJWT, jwtVerify } from "jose";

const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  throw new Error("AUTH_SECRET environment variable is required for social auth token signing");
}
const TEMP_TOKEN_SECRET = new TextEncoder().encode(authSecret);
const TEMP_TOKEN_EXPIRY = "5m";

export type SocialProfile = {
  provider: string;
  providerAccountId: string;
  email: string;
  name: string | null;
};

export type SocialAuthFlow =
  | { flow: "sign-in"; contact: ContactWithAccount }
  | { flow: "link"; contact: ContactWithAccount }
  | { flow: "auto-link"; contact: ContactWithAccount }
  | { flow: "onboard" }
  | { flow: "blocked" };

type ContactWithAccount = {
  id: string;
  email: string;
  name: string | null;
  isActive: boolean;
  account: { id: string; accountId: string; name: string; status: string };
};

/**
 * Determine which auth flow to use for a social sign-in.
 * Called from the NextAuth signIn callback.
 */
export async function determineSocialAuthFlow(
  profile: SocialProfile
): Promise<SocialAuthFlow> {
  // Flow 1: Check for existing linked identity
  const identity = await prisma.socialIdentity.findUnique({
    where: {
      provider_providerAccountId: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
      },
    },
    include: {
      contact: {
        include: {
          account: { select: { id: true, accountId: true, name: true, status: true } },
        },
      },
    },
  });

  if (identity) {
    if (!identity.contact.isActive || identity.contact.account.status === "inactive") {
      return { flow: "blocked" };
    }
    return { flow: "sign-in", contact: identity.contact };
  }

  // Flow 2: Check for email match
  if (profile.email) {
    const contact = await prisma.customerContact.findUnique({
      where: { email: profile.email.toLowerCase() },
      include: {
        account: { select: { id: true, accountId: true, name: true, status: true } },
      },
    });

    if (contact) {
      if (!contact.isActive || contact.account.status === "inactive") {
        return { flow: "blocked" };
      }
      // Edge case: null passwordHash → auto-link
      if (!contact.passwordHash) {
        return { flow: "auto-link", contact };
      }
      return { flow: "link", contact };
    }
  }

  // Flow 3: No match — new customer
  return { flow: "onboard" };
}

/** Create a short-lived JWT carrying social provider info through link/onboard flows. */
export async function createTempToken(profile: SocialProfile): Promise<string> {
  return new SignJWT({
    provider: profile.provider,
    providerAccountId: profile.providerAccountId,
    email: profile.email,
    name: profile.name,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(TEMP_TOKEN_EXPIRY)
    .setIssuedAt()
    .sign(TEMP_TOKEN_SECRET);
}

/** Verify and decode a temp token. Throws on invalid/expired tokens. */
export async function verifyTempToken(token: string): Promise<SocialProfile> {
  const { payload } = await jwtVerify(token, TEMP_TOKEN_SECRET);
  return {
    provider: payload.provider as string,
    providerAccountId: payload.providerAccountId as string,
    email: payload.email as string,
    name: (payload.name as string) ?? null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/social-auth.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/social-auth.ts apps/web/lib/social-auth.test.ts apps/web/package.json
git commit -m "feat(auth): add social auth flow routing and temp token utilities"
```

---

## Task 4: Invite Code Server Actions

**Files:**
- Create: `apps/web/lib/actions/invite-actions.ts`
- Create: `apps/web/lib/actions/invite-actions.test.ts`

- [ ] **Step 1: Write failing tests for invite actions**

Create `apps/web/lib/actions/invite-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateInviteCode, validateInviteCode } from "./invite-actions.js";

vi.mock("@dpf/db", () => ({
  prisma: {
    accountInvite: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    customerAccount: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";

describe("generateInviteCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an invite with the account prefix format", async () => {
    (prisma.customerAccount.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "a-1",
      name: "Acme Corp",
    });
    (prisma.accountInvite.create as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1",
      code: "ACME-AB12",
    });

    const result = await generateInviteCode("a-1", "c-1");
    expect(result.success).toBe(true);
    expect(prisma.accountInvite.create).toHaveBeenCalled();
  });
});

describe("validateInviteCode", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns account info for valid unused code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1",
      code: "ACME-AB12",
      accountId: "a-1",
      usedAt: null,
      expiresAt: null,
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });

    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(true);
    expect(result.account?.name).toBe("Acme Corp");
  });

  it("rejects already-used code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1",
      code: "ACME-AB12",
      usedAt: new Date(),
      expiresAt: null,
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });

    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("already been used");
  });

  it("rejects expired code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "inv-1",
      code: "ACME-AB12",
      usedAt: null,
      expiresAt: new Date("2020-01-01"),
      account: { id: "a-1", accountId: "CUST-1234", name: "Acme Corp", status: "active" },
    });

    const result = await validateInviteCode("ACME-AB12");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("rejects unknown code", async () => {
    (prisma.accountInvite.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const result = await validateInviteCode("NOPE-0000");
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/actions/invite-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement invite actions**

Create `apps/web/lib/actions/invite-actions.ts`:

```ts
"use server";

import { prisma } from "@dpf/db";
import * as crypto from "crypto";

/**
 * Generate an invite code for an account.
 * Code format: {PREFIX}-{4 random alphanumeric} (e.g., "ACME-7K3X")
 */
export async function generateInviteCode(
  accountId: string,
  createdBy: string
): Promise<{ success: boolean; code?: string; error?: string }> {
  const account = await prisma.customerAccount.findUnique({
    where: { id: accountId },
    select: { id: true, name: true },
  });
  if (!account) return { success: false, error: "Account not found" };

  // Build prefix from first 4 chars of account name, uppercased, alpha only
  const prefix = account.name
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 4)
    .toUpperCase()
    .padEnd(4, "X");

  // Retry on collision (unique constraint on code)
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffix = crypto.randomUUID().slice(0, 4).toUpperCase();
    const code = `${prefix}-${suffix}`;
    try {
      const invite = await prisma.accountInvite.create({
        data: {
          code,
          accountId: account.id,
          createdBy,
        },
      });
      return { success: true, code: invite.code };
    } catch (e: unknown) {
      // P2002 = unique constraint violation — retry with new code
      if (e && typeof e === "object" && "code" in e && e.code === "P2002") continue;
      throw e;
    }
  }
  return { success: false, error: "Failed to generate unique invite code" };
}

/**
 * Validate an invite code. Returns account info if valid.
 * Does NOT consume the code — that happens during onboarding.
 */
export async function validateInviteCode(
  code: string
): Promise<{
  valid: boolean;
  error?: string;
  account?: { id: string; accountId: string; name: string };
  inviteId?: string;
}> {
  const invite = await prisma.accountInvite.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: {
      account: { select: { id: true, accountId: true, name: true, status: true } },
    },
  });

  if (!invite) return { valid: false, error: "Invalid invite code" };
  if (invite.usedAt) return { valid: false, error: "This invite has already been used" };
  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return { valid: false, error: "This invite has expired" };
  }
  if (invite.account.status === "inactive") {
    return { valid: false, error: "This account is no longer active" };
  }

  return {
    valid: true,
    account: {
      id: invite.account.id,
      accountId: invite.account.accountId,
      name: invite.account.name,
    },
    inviteId: invite.id,
  };
}

/** Mark an invite code as consumed. Called during onboarding. */
export async function consumeInviteCode(
  inviteId: string,
  usedBy: string
): Promise<void> {
  await prisma.accountInvite.update({
    where: { id: inviteId },
    data: { usedAt: new Date(), usedBy },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/invite-actions.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/invite-actions.ts apps/web/lib/actions/invite-actions.test.ts
git commit -m "feat(auth): add invite code generation and validation actions"
```

---

## Task 5: Social Auth Server Actions (Link + Onboard)

**Files:**
- Create: `apps/web/lib/actions/social-auth-actions.ts`
- Create: `apps/web/lib/actions/social-auth-actions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/actions/social-auth-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { linkSocialIdentity, completeProfileWithSocial } from "./social-auth-actions.js";

vi.mock("@dpf/db", () => ({
  prisma: {
    socialIdentity: { create: vi.fn() },
    customerContact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    customerAccount: { create: vi.fn() },
    accountInvite: { update: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      customerAccount: { create: vi.fn().mockResolvedValue({ id: "a-new", accountId: "CUST-NEW" }) },
      customerContact: { create: vi.fn().mockResolvedValue({ id: "c-new" }) },
      socialIdentity: { create: vi.fn().mockResolvedValue({ id: "si-new" }) },
      accountInvite: { update: vi.fn() },
    })),
  },
}));

vi.mock("@/lib/password", () => ({
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/social-auth", () => ({
  verifyTempToken: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { verifyPassword } from "@/lib/password";
import { verifyTempToken } from "@/lib/social-auth";

describe("linkSocialIdentity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links identity when password is correct", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google",
      providerAccountId: "g-1",
      email: "user@test.com",
      name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1",
      email: "user@test.com",
      passwordHash: "$2a$12$hash",
      isActive: true,
      account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: true, needsRehash: false });
    (prisma.socialIdentity.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "si-1" });

    const result = await linkSocialIdentity("valid-token", "correctpassword");
    expect(result.success).toBe(true);
    expect(prisma.socialIdentity.create).toHaveBeenCalled();
  });

  it("rejects when password is wrong", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google",
      providerAccountId: "g-1",
      email: "user@test.com",
      name: "User",
    });
    (prisma.customerContact.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c-1",
      email: "user@test.com",
      passwordHash: "$2a$12$hash",
      isActive: true,
      account: { id: "a-1", accountId: "CUST-1", name: "Co", status: "active" },
    });
    (verifyPassword as ReturnType<typeof vi.fn>).mockResolvedValue({ valid: false, needsRehash: false });

    const result = await linkSocialIdentity("valid-token", "wrongpassword");
    expect(result.success).toBe(false);
    expect(result.error).toContain("password");
  });
});

describe("completeProfileWithSocial", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates account + contact + identity for new company", async () => {
    (verifyTempToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      provider: "google",
      providerAccountId: "g-new",
      email: "new@test.com",
      name: "New User",
    });

    const result = await completeProfileWithSocial("valid-token", {
      mode: "create",
      companyName: "New Corp",
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run lib/actions/social-auth-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement social auth actions**

Create `apps/web/lib/actions/social-auth-actions.ts`:

```ts
"use server";

import { prisma } from "@dpf/db";
import * as crypto from "crypto";
import { verifyPassword, hashPassword } from "@/lib/password";
import { verifyTempToken, type SocialProfile } from "@/lib/social-auth";
import { consumeInviteCode } from "./invite-actions";

type LinkResult = {
  success: boolean;
  error?: string;
  contactId?: string;
  accountId?: string;
  accountName?: string;
};

/**
 * Link a social identity to an existing contact after password verification.
 * Called from the /customer-link-account page.
 */
export async function linkSocialIdentity(
  tempToken: string,
  password: string
): Promise<LinkResult> {
  let profile: SocialProfile;
  try {
    profile = await verifyTempToken(tempToken);
  } catch {
    return { success: false, error: "Session expired. Please try signing in again." };
  }

  const contact = await prisma.customerContact.findUnique({
    where: { email: profile.email.toLowerCase() },
    include: {
      account: { select: { id: true, accountId: true, name: true, status: true } },
    },
  });

  if (!contact || !contact.isActive) {
    return { success: false, error: "Account not found or inactive." };
  }

  if (!contact.passwordHash) {
    return { success: false, error: "This account has no password set." };
  }

  const { valid, needsRehash } = await verifyPassword(password, contact.passwordHash);
  if (!valid) {
    return { success: false, error: "Incorrect password. Please try again." };
  }

  // Rehash if needed (lazy bcrypt migration)
  if (needsRehash) {
    const newHash = await hashPassword(password);
    await prisma.customerContact.update({
      where: { id: contact.id },
      data: { passwordHash: newHash },
    });
  }

  // Create the social identity link
  await prisma.socialIdentity.create({
    data: {
      provider: profile.provider,
      providerAccountId: profile.providerAccountId,
      email: profile.email,
      contactId: contact.id,
    },
  });

  // Update name if contact doesn't have one
  if (!contact.name && profile.name) {
    await prisma.customerContact.update({
      where: { id: contact.id },
      data: { name: profile.name },
    });
  }

  return {
    success: true,
    contactId: contact.id,
    accountId: contact.account.accountId,
    accountName: contact.account.name,
  };
}

type OnboardInput =
  | { mode: "create"; companyName: string }
  | { mode: "join"; inviteCode: string };

/**
 * Complete profile for a new social sign-in customer.
 * Creates CustomerAccount (if new) + CustomerContact + SocialIdentity in one transaction.
 */
export async function completeProfileWithSocial(
  tempToken: string,
  input: OnboardInput
): Promise<LinkResult> {
  let profile: SocialProfile;
  try {
    profile = await verifyTempToken(tempToken);
  } catch {
    return { success: false, error: "Session expired. Please try signing in again." };
  }

  // Check email isn't already taken
  const existing = await prisma.customerContact.findUnique({
    where: { email: profile.email.toLowerCase() },
  });
  if (existing) {
    return { success: false, error: "An account with this email already exists." };
  }

  if (input.mode === "create") {
    if (!input.companyName?.trim()) {
      return { success: false, error: "Company name is required." };
    }

    const result = await prisma.$transaction(async (tx) => {
      const businessId = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const account = await tx.customerAccount.create({
        data: {
          accountId: businessId,
          name: input.companyName.trim(),
          status: "active",
        },
      });

      const contact = await tx.customerContact.create({
        data: {
          email: profile.email.toLowerCase(),
          name: profile.name,
          accountId: account.id,
        },
      });

      await tx.socialIdentity.create({
        data: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
          email: profile.email,
          contactId: contact.id,
        },
      });

      return { contactId: contact.id, accountId: account.accountId, accountName: account.name };
    });

    return { success: true, ...result };
  }

  // mode === "join"
  if (!input.inviteCode?.trim()) {
    return { success: false, error: "Invite code is required." };
  }

  // Import inline to avoid circular deps
  const { validateInviteCode } = await import("./invite-actions");
  const validation = await validateInviteCode(input.inviteCode);
  if (!validation.valid || !validation.account || !validation.inviteId) {
    return { success: false, error: validation.error ?? "Invalid invite code." };
  }

  const result = await prisma.$transaction(async (tx) => {
    const contact = await tx.customerContact.create({
      data: {
        email: profile.email.toLowerCase(),
        name: profile.name,
        accountId: validation.account!.id,
      },
    });

    await tx.socialIdentity.create({
      data: {
        provider: profile.provider,
        providerAccountId: profile.providerAccountId,
        email: profile.email,
        contactId: contact.id,
      },
    });

    await tx.accountInvite.update({
      where: { id: validation.inviteId },
      data: { usedAt: new Date(), usedBy: contact.id },
    });

    return {
      contactId: contact.id,
      accountId: validation.account!.accountId,
      accountName: validation.account!.name,
    };
  });

  return { success: true, ...result };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run lib/actions/social-auth-actions.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/social-auth-actions.ts apps/web/lib/actions/social-auth-actions.test.ts
git commit -m "feat(auth): add social identity link and onboard server actions"
```

---

## Task 6: NextAuth Configuration — Add Providers and Callbacks

**Files:**
- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/public-paths.ts`
- Modify: `apps/web/.env.local`

- [ ] **Step 1: Add Google and Apple providers to auth.ts**

In `apps/web/lib/auth.ts`, add imports at top:

```ts
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { determineSocialAuthFlow, createTempToken } from "./social-auth.js";
```

Add Google and Apple providers to the `providers` array (after the two Credentials entries):

```ts
// Social providers (customer-only, gated by env var)
...(process.env.ENABLE_SOCIAL_AUTH === "true"
  ? [
      Google({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
      Apple({
        clientId: process.env.APPLE_CLIENT_ID!,
        clientSecret: process.env.APPLE_CLIENT_SECRET!,
      }),
    ]
  : []),
```

- [ ] **Step 2: Update signIn callback to route social sign-ins**

Replace the existing `callbacks` section with:

```ts
callbacks: {
  async signIn({ user, account }) {
    // Credential providers: pass through (existing behavior)
    if (!account || account.type !== "oauth") return true;

    // Social sign-in: determine flow
    const flow = await determineSocialAuthFlow({
      provider: account.provider,
      providerAccountId: account.providerAccountId ?? "",
      email: user.email ?? "",
      name: user.name ?? null,
    });

    if (flow.flow === "blocked") return false;

    if (flow.flow === "sign-in") {
      // Existing linked identity — populate user for JWT callback
      user.id = flow.contact.id;
      user.type = "customer";
      user.platformRole = null;
      user.isSuperuser = false;
      user.accountId = flow.contact.account.accountId;
      user.accountName = flow.contact.account.name;
      user.contactId = flow.contact.id;
      return true;
    }

    if (flow.flow === "auto-link") {
      // No password — auto-link and sign in
      const { prisma } = await import("@dpf/db");
      await prisma.socialIdentity.create({
        data: {
          provider: account.provider,
          providerAccountId: account.providerAccountId ?? "",
          email: user.email ?? undefined,
          contactId: flow.contact.id,
        },
      });
      if (user.name && !flow.contact.name) {
        await prisma.customerContact.update({
          where: { id: flow.contact.id },
          data: { name: user.name },
        });
      }
      user.id = flow.contact.id;
      user.type = "customer";
      user.platformRole = null;
      user.isSuperuser = false;
      user.accountId = flow.contact.account.accountId;
      user.accountName = flow.contact.account.name;
      user.contactId = flow.contact.id;
      return true;
    }

    // For "link" and "onboard" flows, redirect to the appropriate page with a temp token
    const tempToken = await createTempToken({
      provider: account.provider,
      providerAccountId: account.providerAccountId ?? "",
      email: user.email ?? "",
      name: user.name ?? null,
    });

    if (flow.flow === "link") {
      return `/customer-link-account?token=${encodeURIComponent(tempToken)}`;
    }

    return `/customer-complete-profile?token=${encodeURIComponent(tempToken)}`;
  },

  jwt({ token, user }) {
    if (user) {
      token.id = user.id;
      token.type = user.type ?? "admin";
      token.platformRole = user.platformRole ?? null;
      token.isSuperuser = user.isSuperuser ?? false;
      token.accountId = user.accountId ?? null;
      token.accountName = user.accountName ?? null;
      token.contactId = user.contactId ?? null;
    }
    return token;
  },

  session({ session, token }) {
    if (session.user) {
      session.user.id = typeof token.id === "string" ? token.id : token.sub ?? "";
      session.user.type = (token.type as UserType) ?? "admin";
      session.user.platformRole = token.platformRole ?? null;
      session.user.isSuperuser = token.isSuperuser ?? false;
      session.user.accountId = (token.accountId as string) ?? null;
      session.user.accountName = (token.accountName as string) ?? null;
      session.user.contactId = (token.contactId as string) ?? null;
    }
    return session;
  },
},
```

- [ ] **Step 3: Add new public paths**

In `apps/web/lib/public-paths.ts`, add to the `PUBLIC_PATHS` array:

```ts
"/customer-link-account",
"/customer-complete-profile",
```

- [ ] **Step 4: Add environment variable placeholders**

Add to `apps/web/.env.local`:

```env
# Social Auth (set to "true" to enable Google/Apple sign-in)
ENABLE_SOCIAL_AUTH=false
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_CLIENT_ID=
APPLE_CLIENT_SECRET=
APPLE_TEAM_ID=
APPLE_KEY_ID=
```

Add same variables (with descriptions) to `.env.example`.

- [ ] **Step 5: Run existing tests to confirm no regressions**

Run: `cd apps/web && npx vitest run`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/auth.ts apps/web/lib/public-paths.ts apps/web/.env.local .env.example
git commit -m "feat(auth): add Google/Apple providers and social sign-in callback routing"
```

---

## Task 7: Social Buttons Component

**Files:**
- Create: `apps/web/components/social-buttons.tsx`

- [ ] **Step 1: Create the reusable social buttons component**

Create `apps/web/components/social-buttons.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
      <path d="M13.784 9.168c-.023-2.344 1.913-3.468 2-3.524-1.088-1.592-2.784-1.81-3.388-1.835-1.442-.146-2.816.849-3.548.849-.732 0-1.864-.828-3.064-.806-1.578.023-3.032.917-3.844 2.332-1.64 2.844-.42 7.058 1.178 9.368.78 1.128 1.712 2.396 2.936 2.352 1.178-.047 1.622-.762 3.046-.762 1.424 0 1.822.762 3.064.738 1.268-.023 2.07-1.15 2.844-2.284.896-1.31 1.266-2.578 1.288-2.644-.028-.013-2.472-.949-2.496-3.766zM11.438 2.52c.648-.786 1.086-1.878.966-2.966-.934.038-2.064.622-2.734 1.407-.6.695-1.126 1.806-.986 2.872 1.042.081 2.106-.53 2.754-1.314z"/>
    </svg>
  );
}

const buttonStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 16px",
  fontSize: 14,
  borderRadius: 6,
  border: "1px solid #2a2a40",
  background: "#0d0d18",
  color: "#fff",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

export function SocialButtons() {
  return (
    <>
      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl: "/portal" })}
        style={{ ...buttonStyle, marginBottom: 8 }}
      >
        <GoogleIcon />
        Continue with Google
      </button>
      <button
        type="button"
        onClick={() => signIn("apple", { callbackUrl: "/portal" })}
        style={buttonStyle}
      >
        <AppleIcon />
        Continue with Apple
      </button>
    </>
  );
}

export function SocialDivider() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#2a2a40" }} />
      <span style={{ color: "#8888a0", fontSize: 12 }}>or sign in with email</span>
      <div style={{ flex: 1, height: 1, background: "#2a2a40" }} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/social-buttons.tsx
git commit -m "feat(ui): add reusable social sign-in buttons component"
```

---

## Task 8: Update Login and Signup Pages

**Files:**
- Modify: `apps/web/app/(customer-auth)/customer-login/page.tsx`
- Modify: `apps/web/app/(customer-auth)/customer-signup/page.tsx`

- [ ] **Step 1: Add social buttons to customer login page**

In `apps/web/app/(customer-auth)/customer-login/page.tsx`, add import:

```tsx
import { SocialButtons, SocialDivider } from "@/components/social-buttons";
```

Inside the form container `<div>` (after the subtitle `<p>` tag, before the `<form>`), add:

```tsx
{process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH === "true" && (
  <>
    <SocialButtons />
    <SocialDivider />
  </>
)}
```

Note: Also add `NEXT_PUBLIC_ENABLE_SOCIAL_AUTH` to `.env.local` (client-side visibility requires `NEXT_PUBLIC_` prefix).

- [ ] **Step 2: Add social buttons to customer signup page**

In `apps/web/app/(customer-auth)/customer-signup/page.tsx`, add same import and add social buttons after the subtitle, before the `<form>`:

```tsx
{process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH === "true" && (
  <>
    <SocialButtons />
    <SocialDivider />
  </>
)}
```

- [ ] **Step 3: Add NEXT_PUBLIC env var**

Add to `apps/web/.env.local`:

```env
NEXT_PUBLIC_ENABLE_SOCIAL_AUTH=false
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/(customer-auth)/customer-login/page.tsx apps/web/app/(customer-auth)/customer-signup/page.tsx apps/web/.env.local
git commit -m "feat(ui): add social sign-in buttons to customer login and signup pages"
```

---

## Task 9: Link Account Page

**Files:**
- Create: `apps/web/app/(customer-auth)/customer-link-account/page.tsx`

- [ ] **Step 1: Create the link account page**

Create `apps/web/app/(customer-auth)/customer-link-account/page.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { linkSocialIdentity } from "@/lib/actions/social-auth-actions";

export default function CustomerLinkAccountPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [isPending, startTransition] = useTransition();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
        <div style={{ color: "#ef4444", textAlign: "center" }}>
          <p>Invalid or expired link. Please try signing in again.</p>
          <Link href="/customer-login" style={{ color: "#7c8cf8" }}>Back to login</Link>
        </div>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (attempts >= 5) {
      setError("Too many attempts. Please try signing in again.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await linkSocialIdentity(token!, password);
      if (result.success) {
        // Re-sign in with the now-linked social identity
        // Redirect to portal — the social identity is now linked,
        // so next social sign-in will go through Flow 1
        router.push("/customer-login?linked=true");
      } else {
        setAttempts((a) => a + 1);
        setError(result.error ?? "Failed to link account");
      }
    });
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 12, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: "#1e3a5f", margin: "0 auto 12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
            🔗
          </div>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Link Your Account
          </h1>
          <p style={{ color: "#8888a0", fontSize: 13, lineHeight: 1.5 }}>
            We found an existing account with your email. Enter your password to link your social sign-in.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
              style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none" }}
            />
          </div>

          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending || attempts >= 5}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6, border: "none", background: "#7c8cf8", color: "#fff", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1 }}
          >
            {isPending ? "Linking..." : "Link Account & Sign In"}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
          <Link href="/customer-login" style={{ color: "#8888a0", textDecoration: "none" }}>
            Not your account? Sign in differently
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(customer-auth)/customer-link-account/page.tsx
git commit -m "feat(ui): add customer link account page for social identity linking"
```

---

## Task 10: Complete Profile Page

**Files:**
- Create: `apps/web/app/(customer-auth)/customer-complete-profile/page.tsx`

- [ ] **Step 1: Create the complete profile page**

Create `apps/web/app/(customer-auth)/customer-complete-profile/page.tsx`:

```tsx
"use client";

import { useState, useTransition, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { completeProfileWithSocial } from "@/lib/actions/social-auth-actions";
import { validateInviteCode } from "@/lib/actions/invite-actions";

type Tab = "create" | "join";

export default function CustomerCompleteProfilePage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const [isPending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>("create");
  const [companyName, setCompanyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [invitePreview, setInvitePreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Validate invite code on change (debounced)
  useEffect(() => {
    if (tab !== "join" || inviteCode.trim().length < 6) {
      setInvitePreview(null);
      return;
    }
    const timeout = setTimeout(async () => {
      const result = await validateInviteCode(inviteCode.trim());
      if (result.valid && result.account) {
        setInvitePreview(result.account.name);
      } else {
        setInvitePreview(null);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [inviteCode, tab]);

  if (!token) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
        <div style={{ color: "#ef4444", textAlign: "center" }}>
          <p>Invalid or expired link. Please try signing in again.</p>
          <Link href="/customer-login" style={{ color: "#7c8cf8" }}>Back to login</Link>
        </div>
      </div>
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const input = tab === "create"
        ? { mode: "create" as const, companyName: companyName.trim() }
        : { mode: "join" as const, inviteCode: inviteCode.trim() };

      const result = await completeProfileWithSocial(token!, input);
      if (result.success) {
        router.push("/customer-login?registered=true");
      } else {
        setError(result.error ?? "Failed to complete setup");
      }
    });
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "8px 0",
    textAlign: "center",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    background: active ? "#7c8cf8" : "#0d0d18",
    color: active ? "#fff" : "#8888a0",
    border: "none",
  });

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0d18", padding: 20 }}>
      <div style={{ width: 380, maxWidth: "100%", background: "#1a1a2e", border: "1px solid #2a2a40", borderRadius: 12, padding: 32 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h1 style={{ color: "#fff", fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
            Welcome!
          </h1>
          <p style={{ color: "#8888a0", fontSize: 13 }}>
            Complete your profile to get started
          </p>
        </div>

        {/* Tab bar */}
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #2a2a40", marginBottom: 16 }}>
          <button type="button" onClick={() => setTab("create")} style={tabStyle(tab === "create")}>
            Create Company
          </button>
          <button type="button" onClick={() => setTab("join")} style={tabStyle(tab === "join")}>
            Join with Invite Code
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {tab === "create" && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Company Name</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                autoFocus
                placeholder="Acme Corp"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none" }}
              />
            </div>
          )}

          {tab === "join" && (
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", color: "#b0b0c8", fontSize: 12, marginBottom: 4 }}>Invite Code</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                required
                autoFocus
                placeholder="ACME-7K3X"
                style={{ width: "100%", padding: "10px 12px", fontSize: 14, borderRadius: 6, border: "1px solid #2a2a40", background: "#0d0d18", color: "#fff", outline: "none", fontFamily: "monospace" }}
              />
              {invitePreview && (
                <p style={{ color: "#34d399", fontSize: 12, marginTop: 4 }}>
                  Joining: {invitePreview}
                </p>
              )}
            </div>
          )}

          {error && (
            <p style={{ color: "#ef4444", fontSize: 12, marginBottom: 12 }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={isPending}
            style={{ width: "100%", padding: "10px 0", fontSize: 14, fontWeight: 600, borderRadius: 6, border: "none", background: "#7c8cf8", color: "#fff", cursor: isPending ? "wait" : "pointer", opacity: isPending ? 0.7 : 1 }}
          >
            {isPending ? "Setting up..." : "Complete Setup"}
          </button>
        </form>

        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12 }}>
          <Link href="/customer-login" style={{ color: "#8888a0", textDecoration: "none" }}>
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/app/(customer-auth)/customer-complete-profile/page.tsx
git commit -m "feat(ui): add customer profile completion page for social onboarding"
```

---

## Task 11: Linked Identities Settings Component

**Files:**
- Create: `apps/web/components/linked-identities.tsx`

This component is added to the customer account settings page. It shows linked providers and allows linking new ones.

- [ ] **Step 1: Create the linked identities component**

Create `apps/web/components/linked-identities.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";

type LinkedIdentity = {
  id: string;
  provider: string;
  email: string | null;
  linkedAt: string;
};

type Props = {
  identities: LinkedIdentity[];
  hasPassword: boolean;
};

const providers = [
  { id: "google", name: "Google", icon: "G" },
  { id: "apple", name: "Apple", icon: "" },
];

export function LinkedIdentities({ identities, hasPassword }: Props) {
  const linkedProviders = new Set(identities.map((i) => i.provider));

  return (
    <div>
      <h3 style={{ color: "#fff", fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Linked Sign-In Methods
      </h3>
      <p style={{ color: "#8888a0", fontSize: 12, marginBottom: 16 }}>
        Manage how you sign in to your account
      </p>

      {/* Email/password row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, border: "1px solid #2a2a40", borderRadius: 6, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📧</span>
          <div>
            <div style={{ fontSize: 13, color: "#e0e0e0" }}>Email & Password</div>
          </div>
        </div>
        <span style={{ color: hasPassword ? "#34d399" : "#8888a0", fontSize: 11, background: hasPassword ? "#0d3320" : "#1a1a2e", padding: "2px 8px", borderRadius: 10 }}>
          {hasPassword ? "Active" : "Not set"}
        </span>
      </div>

      {/* Provider rows */}
      {providers.map((p) => {
        const linked = identities.find((i) => i.provider === p.id);
        return (
          <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 12, border: "1px solid #2a2a40", borderRadius: 6, marginBottom: 8, opacity: linked ? 1 : 0.7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 16 }}>{p.icon}</span>
              <div>
                <div style={{ fontSize: 13, color: "#e0e0e0" }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#8888a0" }}>
                  {linked ? linked.email ?? "Linked" : "Not linked"}
                </div>
              </div>
            </div>
            {linked ? (
              <span style={{ color: "#34d399", fontSize: 11, background: "#0d3320", padding: "2px 8px", borderRadius: 10 }}>
                Linked
              </span>
            ) : (
              <button
                onClick={() => signIn(p.id, { callbackUrl: "/portal/settings" })}
                style={{ fontSize: 11, color: "#60a5fa", background: "#1e293b", border: "1px solid #334155", padding: "4px 12px", borderRadius: 10, cursor: "pointer" }}
              >
                Link
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/components/linked-identities.tsx
git commit -m "feat(ui): add linked identities settings component"
```

---

## Task 12: Integration Verification

- [ ] **Step 1: Run all tests**

Run: `cd apps/web && npx vitest run`
Expected: All tests PASS (existing + new)

- [ ] **Step 2: Run Prisma validation**

Run: `cd packages/db && npx prisma validate`
Expected: Schema is valid

- [ ] **Step 3: Build check**

Run: `cd apps/web && npx next build`
Expected: Build succeeds (social auth disabled by default, so no provider credentials needed)

- [ ] **Step 4: Commit any fixes**

If any issues found in steps 1-3, fix and commit.

- [ ] **Step 5: Final commit — update spec status**

Update `docs/superpowers/specs/2026-03-19-social-identity-signin-design.md` — change `**Status:** Draft` to `**Status:** Implemented`.

```bash
git add docs/superpowers/specs/2026-03-19-social-identity-signin-design.md
git commit -m "docs: mark EP-AUTH-001 spec as implemented"
```
