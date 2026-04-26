# GAID-Private + AIDoc Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Project every DPF principal (human, customer, agent) into the canonical `GAID-Private` namespace with a resolvable internal `AIDoc`, an operating-profile fingerprint with validation continuity, and a portable authorization-class declaration — without duplicating the federation-edge work in spec 2026-04-22 or the task-envelope work in spec 2026-04-23.

**Architecture:** Six small, independently shippable phases. Each phase is one PR against `main`, leaves the tree green (typecheck + production build), and delivers one self-contained capability. The phases are ordered so each later phase can rely on the earlier phases' outputs but each earlier phase is useful on its own.

**Tech Stack:** Next.js 16 (`apps/web`), Prisma 7.x (`packages/db`), Postgres 16, NextAuth (Auth.js), Vitest, TypeScript, pnpm workspaces, Docker Compose. DCO sign-off required on every commit.

**Spec source-of-truth:** [docs/superpowers/specs/2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md](../specs/2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) (commit 4fbeafc9). Section references in this plan map to that spec.

**Backlog item:** `BI-GAID-8D72B4` under epic `EP-TAK-3F9A21`. The plan does not start work on `BI-MEM-5A41C7`, `BI-OBS-4B63F2`, or `BI-MCP-7E53D1` — those have their own plans after this lands.

---

## Open Questions That Must Be Resolved Before Phase 5

These three answers shape Phase 5 and Phase 6. The first three phases can proceed without them.

1. **Should `principalId` ride in the JWT, or be resolved server-side per request?**
   - Option A (JWT): one extra claim, no per-request DB hit, sessions valid until JWT expiry (≤30 days). Drift risk if a principal is revoked or merged mid-session.
   - Option B (server-side): one DB lookup per request via `resolvePrincipalIdForUser(userId)` (already exists in `apps/web/lib/identity/principal-linking.ts`). Always fresh; tiny per-request cost; simpler revocation story.
   - **Plan default:** Option B (server-side resolved). Mark to confirm or override.

2. **Fingerprint scope: include `PromptTemplate` version, or only the prompt-class reference?**
   - Including the version means churn on every prompt edit (DB-backed admin edits per [PromptLoader](../../../apps/web/lib/tak/prompt-loader.ts)).
   - Class-only means fingerprint is stable across cosmetic prompt edits but does not catch prompt-content drift.
   - **Plan default:** class-only for v0; add a separate `promptContentDigest` field on `AgentOperatingStateRevision` so a future audit can detect content drift without forcing fingerprint churn. Mark to confirm.

3. **Where does the consequence taxonomy live for the future revalidation gate?**
   - Option A: derive `request.action_risk` from the portable authorization class (this plan's output).
   - Option B: explicit `consequenceTier` field on each tool definition.
   - This plan ships only the portable class today; Option A lets `BI-MEM-5A41C7` proceed without a tool-definition change. Option B is cleaner but bigger.
   - **Plan default:** Option A. Mark to confirm.

If Mark answers differently, only Phase 5/6 task lists need adjustment — Phases 1–4 are unaffected.

---

## Phase 0 (Pre-Flight, ≤15 min)

### Task 0.1: Branch + worktree

**Files:** none (operational)

- [ ] **Step 1:** From `d:/DPF`, create a fresh worktree on a new branch from main:

  ```sh
  git worktree add ../DPF-gaid-private-1 -b feat/gaid-private-customer-principal main
  ```

- [ ] **Step 2:** `cd ../DPF-gaid-private-1 && git branch --show-current` — confirm `feat/gaid-private-customer-principal`
- [ ] **Step 3:** Verify hooks: `git config core.hooksPath` returns `.githooks`. If empty, run `git config core.hooksPath .githooks`.

(One worktree per phase. Future phases each get their own: `../DPF-gaid-private-2`, `../DPF-gaid-private-3`, etc.)

---

## Phase 1: Customer Principal Sync + Idempotent Backfill

**What ships:** every existing `User`, `EmployeeProfile`, `Agent`, and `CustomerContact` row has a `Principal` row with the right aliases. New customer signups create their principal automatically.

**Why this lands first:** every later phase reads `Principal`. Without this, the AIDoc resolver and the audit `actingPrincipalId` would be missing rows for customer contacts.

**PR title:** `feat(identity): add customer principal sync + backfill missing principals`

**Spec section:** §5.1.

### Task 1.1: Failing test for `syncCustomerPrincipal`

**Files:**

- Create: `apps/web/lib/identity/__tests__/principal-linking.customer.test.ts`

- [ ] **Step 1:** Write failing test:

  ```ts
  import { describe, expect, it, beforeEach } from "vitest";
  import { prisma } from "@dpf/db";
  import { syncCustomerPrincipal } from "../principal-linking";

  describe("syncCustomerPrincipal", () => {
    beforeEach(async () => {
      // arrange a CustomerContact with no principal
    });

    it("creates a principal with kind=customer and aliases for customer_contact + email", async () => {
      const contact = await prisma.customerContact.create({
        data: { email: "test+gaid@example.com", passwordHash: "x", isActive: true, accountId: /* seeded */ },
      });
      const result = await syncCustomerPrincipal(contact.id);
      expect(result.principal.kind).toBe("customer");
      expect(result.aliases.map((a) => a.aliasType).sort()).toEqual(["customer_contact", "email"]);
      expect(result.aliases.find((a) => a.aliasType === "customer_contact")?.aliasValue).toBe(contact.id);
      expect(result.aliases.find((a) => a.aliasType === "email")?.aliasValue).toBe("test+gaid@example.com");
    });

    it("is idempotent — calling twice returns the same principalId", async () => {
      const contact = await prisma.customerContact.create({ /* … */ });
      const a = await syncCustomerPrincipal(contact.id);
      const b = await syncCustomerPrincipal(contact.id);
      expect(b.principal.principalId).toBe(a.principal.principalId);
    });

    it("attaches an existing principal when a matching alias already exists", async () => {
      // simulate a customer that previously was linked under a different aliasType
    });
  });
  ```

- [ ] **Step 2:** Run `pnpm --filter web exec vitest run apps/web/lib/identity/__tests__/principal-linking.customer.test.ts` — expect failure with `syncCustomerPrincipal is not a function`.
- [ ] **Step 3:** Commit the test file: `git add apps/web/lib/identity/__tests__/principal-linking.customer.test.ts && git commit -s -m "test(identity): add failing test for syncCustomerPrincipal"`.

### Task 1.2: Implement `syncCustomerPrincipal`

**Files:**

- Modify: `apps/web/lib/identity/principal-linking.ts` (add new export between existing `syncAgentPrincipal` and `resolvePrincipalIdForUser`)

- [ ] **Step 1:** Add the helper, mirroring the shape of `syncUserPrincipal` (lines 198-244 of the existing file):

  ```ts
  export async function syncCustomerPrincipal(
    customerContactId: string,
  ): Promise<SyncedPrincipal> {
    const contact = await prisma.customerContact.findUnique({
      where: { id: customerContactId },
      select: { id: true, email: true, isActive: true },
    });
    if (!contact) {
      throw new Error(`CustomerContact ${customerContactId} not found`);
    }

    const aliases: AliasRecord[] = [
      { aliasType: "customer_contact", aliasValue: contact.id, issuer: INTERNAL_ISSUER },
      { aliasType: "email", aliasValue: contact.email.toLowerCase(), issuer: INTERNAL_ISSUER },
    ];

    const existing = await findPrincipalByAliases(prisma, aliases);
    const principal =
      existing ??
      (await prisma.principal.create({
        data: {
          principalId: nextPrincipalId(),
          kind: "customer",
          status: contact.isActive ? "active" : "inactive",
          displayName: contact.email,
        },
      }));

    const persistedAliases = await persistPrincipalAliases(prisma, principal, aliases);
    return { ...principal, aliases: persistedAliases };
  }
  ```

- [ ] **Step 2:** Run the customer test file — expect three green.
- [ ] **Step 3:** Run the full identity test suite: `pnpm --filter web exec vitest run apps/web/lib/identity/__tests__/` — expect all green.
- [ ] **Step 4:** `pnpm --filter web typecheck` — expect zero errors.
- [ ] **Step 5:** Commit: `git commit -s -m "feat(identity): implement syncCustomerPrincipal"` (using `git commit --only apps/web/lib/identity/principal-linking.ts`).

### Task 1.3: Idempotent backfill migration

**Files:**

- Create: `packages/db/prisma/migrations/20260426120000_backfill_missing_principals/migration.sql`

- [ ] **Step 1:** Create the migration directory and SQL file:

  ```sql
  -- Backfill principals for any User / EmployeeProfile / Agent / CustomerContact
  -- that does not yet have a matching PrincipalAlias entry.
  -- Idempotent: re-running this migration on an already-backfilled DB is a no-op.

  -- 1. Users without a 'user' alias
  WITH missing_user AS (
    SELECT u.id, u.email
    FROM "User" u
    LEFT JOIN "PrincipalAlias" pa
      ON pa."aliasType" = 'user' AND pa."aliasValue" = u.id AND pa.issuer = ''
    WHERE pa.id IS NULL
  ),
  inserted_user_principal AS (
    INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
    SELECT
      gen_random_uuid()::text,
      'PRN-' || gen_random_uuid()::text,
      'human',
      'active',
      COALESCE(u.email, u.id),
      now(),
      now()
    FROM missing_user u
    RETURNING id, "displayName"
  )
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text, p.id, 'user', mu.id, '', now()
  FROM inserted_user_principal p
  JOIN missing_user mu ON p."displayName" = COALESCE(mu.email, mu.id);

  -- 2. EmployeeProfiles without an 'employee' alias — attach to the same principal
  --    that owns the user record where employee.userId is set, otherwise create a new
  --    human principal.
  WITH missing_employee AS (
    SELECT ep.id, ep."employeeId", ep."displayName", ep."userId"
    FROM "EmployeeProfile" ep
    LEFT JOIN "PrincipalAlias" pa
      ON pa."aliasType" = 'employee' AND pa."aliasValue" = ep."employeeId" AND pa.issuer = ''
    WHERE pa.id IS NULL
  )
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text,
         COALESCE(
           (SELECT pa2."principalId" FROM "PrincipalAlias" pa2
              WHERE pa2."aliasType" = 'user' AND pa2."aliasValue" = me."userId" AND pa2.issuer = ''
              LIMIT 1),
           (SELECT id FROM "Principal" p
              WHERE p."displayName" = COALESCE(me."displayName", me."employeeId")
              LIMIT 1)
         ),
         'employee', me."employeeId", '', now()
  FROM missing_employee me
  WHERE COALESCE(
    (SELECT pa2."principalId" FROM "PrincipalAlias" pa2
       WHERE pa2."aliasType" = 'user' AND pa2."aliasValue" = me."userId" AND pa2.issuer = ''
       LIMIT 1),
    (SELECT id FROM "Principal" p WHERE p."displayName" = COALESCE(me."displayName", me."employeeId") LIMIT 1)
  ) IS NOT NULL;

  -- 3. Agents without an 'agent' alias — mint a kind=agent Principal AND the
  --    canonical gaid:priv:dpf.internal:<normalized> alias in one go. The
  --    normalization rule mirrors buildPrivateAgentGaid() in
  --    apps/web/lib/identity/principal-linking.ts:51-53 — lower-case, replace
  --    non-[a-z0-9._-] runs with '-', strip leading/trailing dashes.
  WITH missing_agent AS (
    SELECT a.id, a."agentId", a.name
    FROM "Agent" a
    LEFT JOIN "PrincipalAlias" pa
      ON pa."aliasType" = 'agent' AND pa."aliasValue" = a."agentId" AND pa.issuer = ''
    WHERE pa.id IS NULL
  ),
  inserted_agent_principal AS (
    INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text,
           'PRN-' || gen_random_uuid()::text,
           'agent',
           'active',
           a.name,
           now(),
           now()
    FROM missing_agent a
    RETURNING id, "displayName"
  ),
  agent_alias AS (
    INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
    SELECT gen_random_uuid()::text, p.id, 'agent', ma."agentId", '', now()
    FROM inserted_agent_principal p
    JOIN missing_agent ma ON p."displayName" = ma.name
    RETURNING "principalId", "aliasValue"
  )
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text,
         aa."principalId",
         'gaid',
         'gaid:priv:dpf.internal:' ||
           regexp_replace(
             regexp_replace(lower(aa."aliasValue"), '[^a-z0-9._-]+', '-', 'g'),
             '(^-+|-+$)', '', 'g'
           ),
         'dpf.internal',
         now()
  FROM agent_alias aa;

  -- 4. CustomerContacts without a 'customer_contact' alias.
  WITH missing_contact AS (
    SELECT cc.id, cc.email
    FROM "CustomerContact" cc
    LEFT JOIN "PrincipalAlias" pa
      ON pa."aliasType" = 'customer_contact' AND pa."aliasValue" = cc.id AND pa.issuer = ''
    WHERE pa.id IS NULL
  ),
  inserted_contact_principal AS (
    INSERT INTO "Principal" (id, "principalId", kind, status, "displayName", "createdAt", "updatedAt")
    SELECT gen_random_uuid()::text,
           'PRN-' || gen_random_uuid()::text,
           'customer',
           'active',
           mc.email,
           now(),
           now()
    FROM missing_contact mc
    RETURNING id, "displayName"
  ),
  contact_alias AS (
    INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
    SELECT gen_random_uuid()::text, p.id, 'customer_contact', mc.id, '', now()
    FROM inserted_contact_principal p
    JOIN missing_contact mc ON p."displayName" = mc.email
    RETURNING "principalId", "aliasValue"
  )
  INSERT INTO "PrincipalAlias" (id, "principalId", "aliasType", "aliasValue", issuer, "createdAt")
  SELECT gen_random_uuid()::text, ca."principalId", 'email', lower(mc.email), '', now()
  FROM contact_alias ca
  JOIN "CustomerContact" mc ON mc.id = ca."aliasValue";
  ```

  Notes on the SQL:

  - `gen_random_uuid()` is provided by `pgcrypto` (already enabled in this DB).
  - The "displayName join" is a join key, not a unique identifier — for the actual migration, prefer joining on a column that IS unique (e.g. add a temporary unique tag in a CTE if collisions are possible). The snippets above use `displayName` for readability; the implementing engineer should refine to use the row's PK before applying.
  - The agent-alias CTE replicates `buildPrivateAgentGaid()` normalization in pure SQL. Verify against the TypeScript by spot-checking a couple of agents post-migration.
  - All four sections are idempotent — re-running the migration on an already-backfilled DB inserts zero rows.

- [ ] **Step 2:** Verify migration runs cleanly against a copy of the live DB. From `d:/DPF-gaid-private-1`:

  ```sh
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT COUNT(*) AS principals_before FROM \"Principal\";"
  pnpm --filter @dpf/db exec prisma migrate dev --name backfill_missing_principals
  docker exec dpf-postgres-1 psql -U dpf -d dpf -c "SELECT COUNT(*) AS principals_after FROM \"Principal\";"
  ```

  Expect `principals_after >= principals_before` (the live install already has 67 — the migration only adds rows for users/contacts/agents lacking a principal).
- [ ] **Step 3:** Commit the migration file along with any `schema.prisma` regeneration if Prisma added a checksum entry.

### Task 1.4: Wire `syncCustomerPrincipal` into customer signup

**Files:**

- Modify: `apps/web/lib/actions/customer-auth.ts` (the `customerSignup` function)

- [ ] **Step 1:** After `prisma.customerContact.create(...)` returns, call `await syncCustomerPrincipal(contact.id)` (best-effort; wrap in try/catch with structured log on failure — do not fail signup if principal sync fails).
- [ ] **Step 2:** Add an integration test in `apps/web/lib/actions/__tests__/customer-auth.signup.test.ts` that asserts a Principal row exists after signup.
- [ ] **Step 3:** Run the test — expect green.
- [ ] **Step 4:** Commit.

### Task 1.5: Phase 1 production build + PR

- [ ] **Step 1:** `pnpm --filter web exec next build` — expect zero errors. (Project rule per CLAUDE.md: never `npx <tool>` — use `pnpm --filter <pkg> exec <tool>` to honor workspace-pinned versions.)
- [ ] **Step 2:** Run the affected vitest scope: `pnpm --filter web exec vitest run apps/web/lib/identity apps/web/lib/actions`.
- [ ] **Step 3:** Live-DB sanity: `docker exec dpf-postgres-1 psql -U dpf -d dpf -tA -c "SELECT kind, COUNT(*) FROM \"Principal\" GROUP BY kind;"` — expect rows for `human`, `agent`, and `customer` (the last is new).
- [ ] **Step 4:** Push the branch and open the PR with `gh pr create --base main`. Title: `feat(identity): add customer principal sync + backfill missing principals`. Body links the spec § and the backlog item.

### Phase 1 Acceptance Criteria

- `syncCustomerPrincipal()` exists, exported from `principal-linking.ts`, with full Vitest coverage (create, idempotent, alias-merge cases).
- Customer signup automatically creates a `Principal` for the new contact.
- Backfill migration is committed and applied; `Principal` rows now exist for all `User`, `EmployeeProfile`, `Agent`, and `CustomerContact` rows in the live DB.
- Typecheck + production build pass.
- DCO sign-off on every commit.

---

## Phase 2: Portable Authorization Classes (Layer 4)

**What ships:** a single canonical map from local grant keys to the nine portable GAID authorization classes; every tool definition annotated; an invariant test guarding completeness.

**Why this is decoupled from Phase 1:** no DB change, no runtime behavior change. Pure declaration layer. AIDoc resolver (Phase 4) will read this.

**PR title:** `feat(identity): add portable GAID authorization-class mapping`

**Spec section:** §5.4.

### Task 2.1: Branch + worktree

- [ ] **Step 1:** `cd d:/DPF && git worktree add ../DPF-gaid-private-2 -b feat/gaid-authorization-classes main`.

### Task 2.2: Failing test for `mapLocalPolicyToPortableClasses`

**Files:**

- Create: `apps/web/lib/identity/__tests__/authorization-classes.test.ts`

- [ ] **Step 1:** Write the failing test:

  ```ts
  import { describe, expect, it } from "vitest";
  import { mapLocalPolicyToPortableClasses, GAID_AUTHORIZATION_CLASSES } from "../authorization-classes";

  describe("mapLocalPolicyToPortableClasses", () => {
    it("maps backlog_read to ['observe']", () => {
      expect(mapLocalPolicyToPortableClasses(["backlog_read"])).toEqual(["observe"]);
    });
    it("maps backlog_write to ['create','update']", () => {
      expect(mapLocalPolicyToPortableClasses(["backlog_write"])).toEqual(
        expect.arrayContaining(["create", "update"]),
      );
    });
    it("maps sandbox_execute to ['execute']", () => {
      expect(mapLocalPolicyToPortableClasses(["sandbox_execute"])).toEqual(["execute"]);
    });
    it("maps web_search to ['cross-boundary']", () => {
      expect(mapLocalPolicyToPortableClasses(["web_search"])).toEqual(["cross-boundary"]);
    });
    it("returns deduplicated, sorted classes for compound grants", () => {
      const result = mapLocalPolicyToPortableClasses(["backlog_read", "backlog_write", "sandbox_execute"]);
      expect(result).toEqual([...new Set(result)].sort());
    });
    it("returns [] for unknown grant keys (does not throw)", () => {
      expect(mapLocalPolicyToPortableClasses(["totally_made_up"])).toEqual([]);
    });
    it("exports the canonical 9-class vocabulary", () => {
      expect(GAID_AUTHORIZATION_CLASSES).toEqual([
        "observe", "analyze", "create", "update",
        "approve", "execute", "delegate", "administer", "cross-boundary",
      ]);
    });
  });
  ```

- [ ] **Step 2:** Run — expect import failure.
- [ ] **Step 3:** Commit the test.

### Task 2.3: Implement `authorization-classes.ts`

**Files:**

- Create: `apps/web/lib/identity/authorization-classes.ts`

- [ ] **Step 1:** Write the module:

  ```ts
  // apps/web/lib/identity/authorization-classes.ts
  // Maps local DPF grant keys to GAID portable authorization classes (§5.4 of the
  // 2026-04-25 TAK/GAID refresh spec). Declarative — runtime enforcement still
  // happens through the tak/agent-grants.ts intersection.

  export const GAID_AUTHORIZATION_CLASSES = [
    "observe",
    "analyze",
    "create",
    "update",
    "approve",
    "execute",
    "delegate",
    "administer",
    "cross-boundary",
  ] as const;
  export type GaidAuthorizationClass = (typeof GAID_AUTHORIZATION_CLASSES)[number];

  const GRANT_TO_CLASSES: Record<string, GaidAuthorizationClass[]> = {
    // observe
    backlog_read: ["observe"],
    registry_read: ["observe"],
    portfolio_read: ["observe"],
    telemetry_read: ["observe"],
    architecture_read: ["observe"],
    file_read: ["observe"],
    deployment_plan_create: ["observe"], // read-mostly planning surface
    release_plan_read: ["observe"],
    agent_control_read: ["observe"],

    // create + update (mutations to internal records)
    backlog_write: ["create", "update"],
    registry_write: ["create", "update"],
    build_plan_write: ["create", "update"],

    // execute (side-effecting)
    sandbox_execute: ["execute"],
    iac_execute: ["execute"],
    release_gate_create: ["execute"],
    release_plan_create: ["execute"],

    // approve (proposal decisions)
    proposal_decide: ["approve"],

    // delegate
    subagent_dispatch: ["delegate"],

    // administer
    admin_write: ["administer"],

    // cross-boundary
    web_search: ["cross-boundary"],
    external_registry_search: ["cross-boundary"],
    cross_org_connectors: ["cross-boundary"],
  };

  export function mapLocalPolicyToPortableClasses(
    grantKeys: readonly string[],
  ): GaidAuthorizationClass[] {
    const classes = new Set<GaidAuthorizationClass>();
    for (const key of grantKeys) {
      for (const c of GRANT_TO_CLASSES[key] ?? []) {
        classes.add(c);
      }
    }
    return Array.from(classes).sort();
  }

  export function knownGrantKeys(): string[] {
    return Object.keys(GRANT_TO_CLASSES);
  }
  ```

  Note: the table above mirrors §5.4. If any grant key in `tak/agent-grants.ts` is not yet listed here, the next task adds it.
- [ ] **Step 2:** Run the test file — expect green.
- [ ] **Step 3:** Commit.

### Task 2.4: Invariant test — every referenced grant key has a class

**Files:**

- Create: `apps/web/lib/identity/__tests__/authorization-classes.invariant.test.ts`

- [ ] **Step 1:** Write the invariant:

  ```ts
  import { describe, expect, it } from "vitest";
  import { knownGrantKeys } from "../authorization-classes";
  import { TOOL_TO_GRANTS } from "../../tak/agent-grants";

  describe("authorization-classes invariant", () => {
    it("every grant key referenced by mcp-tools is mapped to at least one portable class", () => {
      const referencedGrants = new Set<string>();
      for (const grants of Object.values(TOOL_TO_GRANTS)) {
        for (const g of grants) referencedGrants.add(g);
      }
      const known = new Set(knownGrantKeys());
      const missing = [...referencedGrants].filter((g) => !known.has(g));
      expect(missing, `unmapped grants: ${missing.join(", ")}`).toEqual([]);
    });
  });
  ```

- [ ] **Step 2:** Run — expect green if §5.4 was complete; expect failure listing any missing grant keys, then add them to the map in `authorization-classes.ts`.
- [ ] **Step 3:** Re-run — green.
- [ ] **Step 4:** Note: this requires exporting `TOOL_TO_GRANTS` from `tak/agent-grants.ts`. If not currently exported, add the export in this task.
- [ ] **Step 5:** Commit.

### Task 2.5: Annotate `mcp-tools.ts` tool definitions

**Files:**

- Modify: `apps/web/lib/mcp-tools.ts` (each `ToolDefinition` gets an `authorizationClass: GaidAuthorizationClass[]` field)

- [ ] **Step 1:** Extend `ToolDefinition` type to include `authorizationClass: GaidAuthorizationClass[]` (required).
- [ ] **Step 2:** For each tool, derive its classes from its grants via `mapLocalPolicyToPortableClasses()` at definition time, OR set explicitly. Recommendation: derive once at module load:

  ```ts
  // pseudo:
  const TOOLS_WITH_CLASSES = PLATFORM_TOOLS.map((t) => ({
    ...t,
    authorizationClass: mapLocalPolicyToPortableClasses(TOOL_TO_GRANTS[t.name] ?? []),
  }));
  ```

- [ ] **Step 3:** Add a vitest assertion that no tool has an empty `authorizationClass` (if a tool can be called but does nothing portable, flag it):

  ```ts
  it("every tool declares at least one portable authorization class", () => {
    const violations = TOOLS_WITH_CLASSES.filter((t) => t.authorizationClass.length === 0);
    expect(violations.map((t) => t.name)).toEqual([]);
  });
  ```

- [ ] **Step 4:** Run — expect green or fix outliers.
- [ ] **Step 5:** Commit.

### Task 2.6: Phase 2 production build + PR

- [ ] **Step 1:** `pnpm --filter web typecheck` — zero errors.
- [ ] **Step 2:** `pnpm --filter web exec next build` — zero errors.
- [ ] **Step 3:** `pnpm --filter web exec vitest run apps/web/lib/identity apps/web/lib/mcp-tools` — green.
- [ ] **Step 4:** Push + `gh pr create --base main`.

### Phase 2 Acceptance Criteria

- `apps/web/lib/identity/authorization-classes.ts` exists with the canonical 9-class vocabulary and the `mapLocalPolicyToPortableClasses` function.
- Invariant test passes — every grant key referenced by any tool has a portable class.
- `mcp-tools.ts` tool definitions carry `authorizationClass: GaidAuthorizationClass[]`.
- No runtime behavior change (this is declaration only — runtime still gates on the existing intersection).
- Typecheck + production build pass.

---

## Phase 3: Operating-Profile Fingerprint + Validation Continuity

**What ships:** every `Agent` row carries a `operatingProfileFingerprint` reflecting the canonicalized hash of its material state; every material change creates a new `AgentOperatingStateRevision` row; new columns `Agent.exposureState` and `Agent.publicGaid` exist (read-only in v0).

**Why third:** AIDoc (Phase 4) will project the fingerprint and exposure state into the document. This phase populates the fields.

**PR title:** `feat(identity): add operating-profile fingerprint and exposure-state columns`

**Spec sections:** §5.3, §5.6.

### Task 3.1: Branch + worktree

- [ ] **Step 1:** `cd d:/DPF && git worktree add ../DPF-gaid-private-3 -b feat/gaid-operating-profile-fingerprint main`.

### Task 3.2: Schema migration

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260426130000_agent_operating_profile/migration.sql`

- [ ] **Step 1:** Add to `Agent`:

  ```prisma
  // existing fields…
  operatingProfileFingerprint String?
  exposureState               String   @default("private")
  publicGaid                  String?  @unique
  ```

- [ ] **Step 2:** Add a new model:

  ```prisma
  model AgentOperatingStateRevision {
    id                   String   @id @default(cuid())
    agentId              String
    fingerprint          String
    capturedAt           DateTime @default(now())
    validationState      String   @default("validated")
    materialChangeReason String?
    promptContentDigest  String?

    agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

    @@index([agentId, capturedAt])
  }
  ```

- [ ] **Step 3:** Add the inverse relation on `Agent`: `operatingStateRevisions AgentOperatingStateRevision[]`.
- [ ] **Step 4:** `pnpm --filter @dpf/db exec prisma migrate dev --name agent_operating_profile`.
- [ ] **Step 5:** Edit the generated migration to add inline backfill SQL — see Task 3.5 for the backfill helper, but the SQL backfill in this migration just sets `exposureState='private'` for all rows (which is the default; effectively a no-op but makes the intent explicit).
- [ ] **Step 6:** Validation enums — add to `apps/web/lib/identity/operating-state.ts`:

  ```ts
  export const VALIDATION_STATES = ["validated", "pending-revalidation", "stale", "restricted"] as const;
  export type ValidationState = (typeof VALIDATION_STATES)[number];

  export const EXPOSURE_STATES = ["private", "federated", "public"] as const;
  export type ExposureState = (typeof EXPOSURE_STATES)[number];

  export const MATERIAL_CHANGE_REASONS = [
    "model_binding_changed",
    "tool_grants_changed",
    "skill_assignments_changed",
    "prompt_class_changed",
    "initial_capture",
  ] as const;
  export type MaterialChangeReason = (typeof MATERIAL_CHANGE_REASONS)[number];
  ```

  Per CLAUDE.md "Strongly-Typed String Enums — MANDATORY COMPLIANCE": the canonical `as const` array in this file is the authority. Any new value requires this file + any consuming MCP tool definitions in the same commit.
- [ ] **Step 7:** **Single-commit discipline** — schema migration, the `operating-state.ts` enum constants, and any consuming MCP tool definition (`enum:` arrays for `validationState`, `exposureState`, `materialChangeReason` if surfaced via a tool) MUST land in the same commit. This is the CLAUDE.md "Strongly-Typed String Enums — MANDATORY COMPLIANCE" rule. Verify before commit: `git diff --cached --stat` shows the schema, the `operating-state.ts`, and any tool-definition files together.

### Task 3.3: Failing test for fingerprint helper

**Files:**

- Create: `apps/web/lib/identity/__tests__/operating-profile.test.ts`

- [ ] **Step 1:** Write tests:

  ```ts
  import { describe, expect, it } from "vitest";
  import { computeOperatingProfileFingerprint } from "../operating-profile";

  describe("computeOperatingProfileFingerprint", () => {
    const baseInput = {
      modelBinding: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      toolGrants: ["backlog_read", "registry_read"],
      skillAssignments: ["coo_orchestrate"],
      promptClassRefs: ["platform-preamble", "route-persona/coo"],
      hitlTierDefault: 1,
      sensitivity: "internal",
    };

    it("is stable across re-computation with the same input", () => {
      const a = computeOperatingProfileFingerprint(baseInput);
      const b = computeOperatingProfileFingerprint(baseInput);
      expect(a).toBe(b);
    });

    it("is stable across re-ordered toolGrants and skillAssignments", () => {
      const a = computeOperatingProfileFingerprint(baseInput);
      const b = computeOperatingProfileFingerprint({
        ...baseInput,
        toolGrants: ["registry_read", "backlog_read"],
        skillAssignments: ["coo_orchestrate"],
      });
      expect(a).toBe(b);
    });

    it("changes when modelBinding changes", () => {
      const a = computeOperatingProfileFingerprint(baseInput);
      const b = computeOperatingProfileFingerprint({
        ...baseInput,
        modelBinding: { provider: "anthropic", modelId: "claude-opus-4-7" },
      });
      expect(a).not.toBe(b);
    });

    it("changes when toolGrants change", () => { /* ... */ });
    it("changes when skillAssignments change", () => { /* ... */ });
    it("changes when promptClassRefs change", () => { /* ... */ });
    it("does NOT change when display name or description changes (cosmetic-only)", () => {
      // computeOperatingProfileFingerprint must not accept these fields at all
    });

    it("returns a string of the form sha256:<64 hex chars>", () => {
      const fp = computeOperatingProfileFingerprint(baseInput);
      expect(fp).toMatch(/^sha256:[0-9a-f]{64}$/);
    });
  });
  ```

- [ ] **Step 2:** Run — expect import failure.
- [ ] **Step 3:** Commit.

### Task 3.4: Implement fingerprint helper

**Files:**

- Create: `apps/web/lib/identity/operating-profile.ts`

- [ ] **Step 1:** Write the helper:

  ```ts
  import crypto from "node:crypto";

  export type OperatingProfileMaterialState = {
    modelBinding: { provider: string; modelId: string };
    toolGrants: string[];
    skillAssignments: string[];
    promptClassRefs: string[];
    hitlTierDefault: number;
    sensitivity: string;
  };

  function canonicalize(input: OperatingProfileMaterialState): string {
    const canonical = {
      modelBinding: { provider: input.modelBinding.provider, modelId: input.modelBinding.modelId },
      toolGrants: [...input.toolGrants].sort(),
      skillAssignments: [...input.skillAssignments].sort(),
      promptClassRefs: [...input.promptClassRefs].sort(),
      hitlTierDefault: input.hitlTierDefault,
      sensitivity: input.sensitivity,
    };
    return JSON.stringify(canonical);
  }

  export function computeOperatingProfileFingerprint(
    input: OperatingProfileMaterialState,
  ): string {
    const canonical = canonicalize(input);
    const digest = crypto.createHash("sha256").update(canonical).digest("hex");
    return `sha256:${digest}`;
  }
  ```

- [ ] **Step 2:** Run the test file — expect green.
- [ ] **Step 3:** Commit.

### Task 3.5: Recompute helper + initial revision capture

**Files:**

- Create: `apps/web/lib/identity/operating-state-recorder.ts`

- [ ] **Step 1:** Write `recomputeOperatingState(agentId, reason)`:

  ```ts
  export async function recomputeOperatingState(
    agentId: string,
    reason: MaterialChangeReason,
  ): Promise<{ fingerprint: string; revisionId: string }> {
    const [agent, exec, grants, skills] = await Promise.all([
      prisma.agent.findUniqueOrThrow({ where: { id: agentId } }),
      prisma.agentExecutionConfig.findUnique({ where: { agentId } }),
      prisma.agentToolGrant.findMany({ where: { agentId }, select: { grantKey: true } }),
      prisma.agentSkillAssignment.findMany({ where: { agentId }, select: { label: true } }),
    ]);
    // promptClassRefs derived from agent's persona route
    const promptClassRefs = derivePromptClassRefs(agent);

    const fingerprint = computeOperatingProfileFingerprint({
      modelBinding: {
        provider: exec?.modelProvider ?? "unknown",
        modelId: exec?.defaultModelId ?? "unknown",
      },
      toolGrants: grants.map((g) => g.grantKey),
      skillAssignments: skills.map((s) => s.label),
      promptClassRefs,
      hitlTierDefault: agent.hitlTierDefault,
      sensitivity: agent.sensitivity,
    });
    // Note: hitlTierDefault and sensitivity have non-null Prisma defaults
    // (`Int @default(3)` and `String @default("internal")` respectively), so no
    // nullish-coalesce fallback is needed here.

    const validationState: ValidationState =
      reason === "model_binding_changed" || reason === "tool_grants_changed"
        ? "pending-revalidation"
        : "validated";

    const revision = await prisma.agentOperatingStateRevision.create({
      data: { agentId, fingerprint, validationState, materialChangeReason: reason },
    });
    await prisma.agent.update({
      where: { id: agentId },
      data: { operatingProfileFingerprint: fingerprint },
    });
    return { fingerprint, revisionId: revision.id };
  }
  ```

- [ ] **Step 2:** Add a vitest covering: identical input → same fingerprint → no new revision (skip-equal); different input → new revision; pending-revalidation reasons trigger correct state.
- [ ] **Step 3:** Commit.

### Task 3.6: Backfill initial revisions for existing agents

**Files:**

- Create: `packages/db/src/scripts/backfill-operating-state.ts`

- [ ] **Step 1:** Write a one-shot script:

  ```ts
  // packages/db/src/scripts/backfill-operating-state.ts
  // Usage: pnpm --filter @dpf/db exec tsx src/scripts/backfill-operating-state.ts
  import { prisma } from "../index";
  import { recomputeOperatingState } from "../../../apps/web/lib/identity/operating-state-recorder";

  async function main() {
    const agents = await prisma.agent.findMany({ select: { id: true, agentId: true } });
    for (const a of agents) {
      const result = await recomputeOperatingState(a.id, "initial_capture");
      console.log(`agent=${a.agentId} fingerprint=${result.fingerprint}`);
    }
  }
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
  ```

- [ ] **Step 2:** Run against the live DB once: `pnpm --filter @dpf/db exec tsx src/scripts/backfill-operating-state.ts`. Expect 68 lines (matches `Agent` row count).
- [ ] **Step 3:** Verify: `docker exec dpf-postgres-1 psql -U dpf -d dpf -tA -c "SELECT COUNT(*) FROM \"AgentOperatingStateRevision\";"` returns 68.
- [ ] **Step 4:** Commit the script (operational; one-time use, kept for fresh-install replay).

### Task 3.7: Hook recompute into write paths

**Files:** write paths for `Agent` / `AgentExecutionConfig` / `AgentToolGrant` / `AgentSkillAssignment`. The exact files depend on where these tables are written.

Use the **Grep tool** (project rule — Claude tools, not raw `grep`) with this pattern across `apps/web` and `packages/db`:

```regex
prisma\.agent\.update|prisma\.agentExecutionConfig\.update|prisma\.agentToolGrant\.(create|update|delete)|prisma\.agentSkillAssignment\.(create|update|delete)
```

For each result, add `await recomputeOperatingState(agentId, <appropriate reason>)` after the write.

- [ ] **Step 1:** List all write sites, document them in this task as a checklist.
- [ ] **Step 2:** Modify each site, one commit per file.
- [ ] **Step 3:** Add an integration test: simulate `prisma.agentToolGrant.create(...)` then assert a new `AgentOperatingStateRevision` row exists.
- [ ] **Step 4:** Run typecheck + tests.
- [ ] **Step 5:** Commit each write site.

### Task 3.8: Phase 3 production build + PR

- [ ] **Step 1:** `pnpm --filter web typecheck && pnpm --filter @dpf/db typecheck`.
- [ ] **Step 2:** `pnpm --filter web exec next build`.
- [ ] **Step 3:** Live-DB sanity: `docker exec dpf-postgres-1 psql -U dpf -d dpf -tA -c "SELECT \"agentId\", \"operatingProfileFingerprint\" FROM \"Agent\" LIMIT 5;"` — every row has a non-null fingerprint.
- [ ] **Step 4:** Push + open PR.

### Phase 3 Acceptance Criteria

- `Agent.operatingProfileFingerprint`, `Agent.exposureState`, `Agent.publicGaid` columns exist.
- `AgentOperatingStateRevision` table exists with one row per agent (initial backfill).
- `recomputeOperatingState()` is hooked into every write path that mutates material state.
- Cosmetic-only edits (display name, description) do NOT create new revisions.
- Material edits (model binding, tool grants, skills, prompt class) DO create new revisions with the right `materialChangeReason`.

---

## Phase 4: Internal AIDoc Resolver

**What ships:** `resolveAIDocForAgent(agentId)` and `resolveInternalAIDoc(gaid)` returning a complete AIDoc per `GAID §7.2`. Read-only; no new persistence beyond what Phase 3 added.

**PR title:** `feat(identity): add internal AIDoc resolver for private GAIDs`

**Spec section:** §5.2.

### Task 4.1: Branch + worktree

- [ ] **Step 1:** `cd d:/DPF && git worktree add ../DPF-gaid-private-4 -b feat/gaid-aidoc-resolver main`.

### Task 4.2: Failing test

**Files:**

- Create: `apps/web/lib/identity/__tests__/aidoc-resolver.test.ts`

- [ ] **Step 1:** Write tests:

  ```ts
  import { describe, expect, it } from "vitest";
  import { resolveAIDocForAgent, resolveInternalAIDoc } from "../aidoc-resolver";

  describe("resolveAIDocForAgent", () => {
    it("returns the GAID-required minimum fields for a seeded agent", async () => {
      const aidoc = await resolveAIDocForAgent("AGT-ORCH-000");
      expect(aidoc.gaid).toMatch(/^gaid:priv:dpf\.internal:/);
      expect(aidoc.subject_name).toBeTruthy();
      expect(aidoc.issuer.prefix).toBe("dpf.internal");
      expect(aidoc.status).toBe("active");
      expect(aidoc.subject_type).toMatch(/coordinator|specialist|assistant|service/);
      expect(aidoc.exposure_state).toBe("private");
      expect(aidoc.model_binding).toBeDefined();
      expect(aidoc.tool_surface).toBeInstanceOf(Array);
      expect(aidoc.authorization_classes).toBeInstanceOf(Array);
      expect(aidoc.operating_profile_fingerprint).toMatch(/^sha256:/);
      expect(aidoc.validation_state).toMatch(/validated|pending-revalidation|stale|restricted/);
    });

    it("marks unknown fields as 'undisclosed' rather than fabricating", async () => {
      const aidoc = await resolveAIDocForAgent("AGT-ORCH-000");
      // any field where DPF has no source data should be the literal string "undisclosed"
      expect(aidoc.evidence_refs).toBeUndefined(); // or === "undisclosed"
    });

    it("throws or returns not-found for unknown agent", async () => { /* ... */ });
  });

  describe("resolveInternalAIDoc by GAID", () => {
    it("resolves gaid:priv:dpf.internal:<id> back to the same AIDoc", async () => {
      const byAgent = await resolveAIDocForAgent("AGT-ORCH-000");
      const byGaid = await resolveInternalAIDoc(byAgent.gaid);
      expect(byGaid.gaid).toBe(byAgent.gaid);
    });
  });
  ```

- [ ] **Step 2:** Run — expect import failure.
- [ ] **Step 3:** Commit.

### Task 4.3: Implement resolver

**Files:**

- Create: `apps/web/lib/identity/aidoc-resolver.ts`

- [ ] **Step 1:** Implement against the GAID §7.2 minimum fields, projecting from `Agent`, `AgentExecutionConfig`, `AgentToolGrant`, `AgentSkillAssignment`, `Principal`, `PrincipalAlias`, plus `mapLocalPolicyToPortableClasses` from Phase 2.
- [ ] **Step 2:** Pseudocode:

  ```ts
  // The `agentId` parameter is the SLUG (e.g. "AGT-ORCH-000"), not the
  // cuid primary key. The schema has both: `Agent.id` (cuid) and
  // `Agent.agentId` (the @unique public slug). Tests and callers pass the slug.
  export async function resolveAIDocForAgent(agentId: string): Promise<AIDoc> {
    const agent = await prisma.agent.findUnique({
      where: { agentId }, // resolves on Agent.agentId (the @unique slug)
      include: {
        executionConfig: true,
        toolGrants: true,
        skillAssignments: true,
      },
    });
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const principal = await prisma.principalAlias.findFirst({
      where: { aliasType: "agent", aliasValue: agent.agentId },
      include: { principal: true },
    });
    const gaidAlias = await prisma.principalAlias.findFirst({
      where: { aliasType: "gaid", principalId: principal?.principalId },
    });

    const grantKeys = agent.toolGrants.map((g) => g.grantKey);
    const authorizationClasses = mapLocalPolicyToPortableClasses(grantKeys);

    return {
      gaid: gaidAlias?.aliasValue ?? buildPrivateAgentGaid(agent.agentId),
      subject_name: agent.name,
      issuer: { name: "DPF Private Issuer", prefix: "dpf.internal" },
      status: agent.status,
      subject_type: deriveSubjectType(agent),
      owner_organization: await getOrganizationName(),
      exposure_state: agent.exposureState,
      versioning: { /* ... */ },
      model_binding: {
        provider: agent.executionConfig?.modelProvider ?? "undisclosed",
        model_id: agent.executionConfig?.defaultModelId ?? "undisclosed",
      },
      operating_profile_fingerprint: agent.operatingProfileFingerprint ?? undefined,
      validation_state: await getCurrentValidationState(agent.id),
      tool_surface: grantKeys,
      skill_surface: agent.skillAssignments.map((s) => s.label),
      authorization_classes: authorizationClasses,
      hitl_profile: { tier: agent.hitlTierDefault },
      data_sensitivity_profile: agent.sensitivity,
      evidence_refs: undefined, // not yet collected; leave undefined per GAID §7.3
    };
  }

  export async function resolveInternalAIDoc(gaid: string): Promise<AIDoc> {
    const alias = await prisma.principalAlias.findFirst({
      where: { aliasType: "gaid", aliasValue: gaid },
      include: { principal: true },
    });
    if (!alias) throw new Error(`GAID ${gaid} not found`);
    // resolve to the agent through the principal's agent alias
    const agentAlias = await prisma.principalAlias.findFirst({
      where: { principalId: alias.principalId, aliasType: "agent" },
    });
    if (!agentAlias) throw new Error(`No agent for ${gaid}`);
    return resolveAIDocForAgent(agentAlias.aliasValue);
  }
  ```

- [ ] **Step 3:** Run tests — expect green or fix the projection until they pass.
- [ ] **Step 4:** Commit.

### Task 4.4: Internal admin route to expose AIDoc

**Files:**

- Create: `apps/web/app/api/internal/identity/aidoc/[agentId]/route.ts`

- [ ] **Step 1:** Add a GET route that returns the AIDoc as JSON. Auth: superuser-only via `auth()` + `can(user, "manage_agents")`. This is for inspection / debugging / observability — not the public AIDoc endpoint (which would require GAID-Public).
- [ ] **Step 2:** Add a Vitest covering: super returns 200; non-super returns 403; unknown agent returns 404.
- [ ] **Step 3:** Commit.

### Task 4.5: Phase 4 production build + PR

- [ ] **Step 1:** `pnpm --filter web typecheck && pnpm --filter web exec next build`.
- [ ] **Step 2:** Run the AIDoc test suite.
- [ ] **Step 3:** Manual smoke: hit `/api/internal/identity/aidoc/AGT-ORCH-000` while authenticated as superuser; eyeball the JSON.
- [ ] **Step 4:** Push + PR.

### Phase 4 Acceptance Criteria

- `resolveAIDocForAgent(agentId)` and `resolveInternalAIDoc(gaid)` return GAID-§7.2-conformant documents for every seeded agent.
- Missing fields are returned as `"undisclosed"` or omitted, not fabricated.
- Internal admin route exposes the AIDoc behind superuser auth.
- Typecheck + production build pass.

---

## Phase 5: `principalId` in Session + `actingPrincipalId` on `ToolExecution`

**What ships:** every authenticated request can read the caller's `principalId`; every new `ToolExecution` row records the acting principal alongside the existing `userId`.

**Why fifth:** depends on the principal substrate (Phase 1) being complete and the AIDoc resolver (Phase 4) being available so receipts can carry portable classes for the actor.

**PR title:** `feat(identity): surface principalId in session and audit`

**Spec section:** §5.1.

**Open question gate:** Mark must answer Open Question 1 before this phase starts. Default is server-side resolution.

### Task 5.1: Branch + worktree

- [ ] **Step 1:** `cd d:/DPF && git worktree add ../DPF-gaid-private-5 -b feat/gaid-principal-in-session main`.

### Task 5.2: Migration — `ToolExecution.actingPrincipalId`

**Files:**

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260427120000_tool_execution_acting_principal/migration.sql`

- [ ] **Step 1:** Add nullable column:

  ```prisma
  model ToolExecution {
    // ...
    actingPrincipalId String?
    // ...
    @@index([actingPrincipalId, createdAt(sort: Desc)])
  }
  ```

- [ ] **Step 2:** `pnpm --filter @dpf/db exec prisma migrate dev --name tool_execution_acting_principal`.
- [ ] **Step 3:** Backfill SQL inline — set `actingPrincipalId` from existing `userId` via the `PrincipalAlias` lookup:

  ```sql
  UPDATE "ToolExecution" te
  SET "actingPrincipalId" = p."principalId"
  FROM "PrincipalAlias" pa
  JOIN "Principal" p ON p.id = pa."principalId"
  WHERE pa."aliasType" = 'user' AND pa."aliasValue" = te."userId" AND pa.issuer = ''
    AND te."actingPrincipalId" IS NULL;
  ```

- [ ] **Step 4:** Apply + commit.

### Task 5.3: Update agentic-loop write path

**Files:**

- Modify: `apps/web/lib/tak/agentic-loop.ts` (the `prisma.toolExecution.create` call)

- [ ] **Step 1:** Resolve principalId from session at the entry point of the loop (not in the loop hot path). Pass it through to the tool-execution writer.
- [ ] **Step 2:** Add a Vitest that simulates a tool execution and asserts the resulting `ToolExecution` row has both `userId` and `actingPrincipalId` set.
- [ ] **Step 3:** Commit.

### Task 5.4: Update `DpfSession` and JWT callback

**Files:**

- Modify: `apps/web/lib/govern/auth.ts` (lines 60-73 for type, lines 262-273 for JWT callback)

**If Open Question 1 → Option A (JWT):**

- [ ] **Step 1:** Add `principalId: string | null` to `DpfSession.user`.
- [ ] **Step 2:** In `jwt()` callback, on first sign-in, call `resolvePrincipalIdForUser(user.id)` and put it on the token.
- [ ] **Step 3:** In `session()` callback, copy `token.principalId` to `session.user.principalId`.

**If Open Question 1 → Option B (server-side, default):**

- [ ] **Step 1:** Add a helper `getActingPrincipalId(session: DpfSession): Promise<string | null>` in `apps/web/lib/identity/principal-context.ts`.
- [ ] **Step 2:** Update auth-middleware to resolve the principalId at request time and attach to the request context.
- [ ] **Step 3:** Update server actions and API routes that need the principalId to call the helper.

- [ ] **Step 4:** Run typecheck + tests.
- [ ] **Step 5:** Commit.

### Task 5.5: Phase 5 production build + PR

- [ ] **Step 1:** Standard typecheck + build sequence.
- [ ] **Step 2:** Live-DB smoke: trigger one tool call through the coworker UI; verify the resulting `ToolExecution` row has both `userId` and `actingPrincipalId`.
- [ ] **Step 3:** Push + PR.

### Phase 5 Acceptance Criteria

- Every new `ToolExecution` row populates `actingPrincipalId`.
- Existing `ToolExecution` rows backfilled where the user has a principal.
- Session / request context exposes `principalId` for code that needs it.
- `userId` is retained — no breaking change to existing audit consumers.

---

## Phase 6: Operator Surface — Operating-State Visibility

**What ships:** the existing `EffectivePermissionsPanel` at [apps/web/components/platform/EffectivePermissionsPanel.tsx](../../../apps/web/components/platform/EffectivePermissionsPanel.tsx) gains two columns per agent: `operatingProfileFingerprint` (truncated) and `validationState`.

**Why last in this plan:** depends on Phase 3 (fingerprint exists) and Phase 4 (AIDoc surface for cross-linking). This phase is intentionally small — `BI-OBS-4B63F2` is the bigger observability item; this is a minimum operator-readable surface so the work is visible.

**PR title:** `feat(identity): show operating-state fingerprint and validation in authority panel`

**Spec section:** §5.11 (operator visibility — partial first slice).

### Task 6.1: Branch + worktree

- [ ] **Step 1:** `cd d:/DPF && git worktree add ../DPF-gaid-private-6 -b feat/gaid-authority-panel-state main`.

### Task 6.2: Extend the panel

**Files:**

- Modify: `apps/web/components/platform/EffectivePermissionsPanel.tsx`
- Modify: the server-side data fetcher feeding it (search for `getAgentGrantSummaries` or similar)

- [ ] **Step 1:** Extend the data fetcher to include `operatingProfileFingerprint` and the latest `validationState` (most-recent revision per agent).
- [ ] **Step 2:** Render two new columns. Truncate the fingerprint to `sha256:abc12345…` (first 14 chars). Validation state is a colored chip — green for `validated`, yellow for `pending-revalidation`, red for `stale`/`restricted`.
- [ ] **Step 3:** Use the existing theme tokens per CLAUDE.md "Theme-Aware Styling — mandatory" — `bg-[var(--dpf-surface-2)]` etc., never hardcoded colors.
- [ ] **Step 4:** Add a Vitest snapshot or RTL test that asserts the new columns render.
- [ ] **Step 5:** Manual UX verification: load `/platform/audit/authority` in the running portal; confirm new columns visible and don't break layout.
- [ ] **Step 6:** Commit.

### Task 6.3: Phase 6 production build + PR

- [ ] **Step 1:** Standard typecheck + build.
- [ ] **Step 2:** Manual UX check on `localhost:3000/platform/audit/authority`.
- [ ] **Step 3:** Push + PR.

### Phase 6 Acceptance Criteria

- Authority panel shows fingerprint + validation per agent.
- Theme-aware styling — works in light + dark mode + custom branding.
- Production build clean.
- Manual UX verification confirmed; no layout regression.

---

## Cross-Phase Acceptance Criteria

When all six phases land:

- Every authenticated user has a Principal row reachable through the standard alias lookups.
- Every Agent has an operating-profile fingerprint and at least one revision in `AgentOperatingStateRevision`.
- `resolveAIDocForAgent('AGT-ORCH-000')` returns a complete AIDoc honoring the GAID §7.2 minimum.
- Every grant key referenced by any tool maps to ≥1 portable authorization class via the canonical map.
- Every new `ToolExecution` row records both `userId` and `actingPrincipalId`.
- Operators can read fingerprint + validation state for every agent on `/platform/audit/authority`.
- All four PRs squash-merged with green CI; backlog item `BI-GAID-8D72B4` flipped to `done`.
- The downstream items (`BI-MEM-5A41C7`, `BI-OBS-4B63F2`, `BI-MCP-7E53D1`) can now begin against a stable substrate.

## Out-of-Scope (Don't Get Distracted)

- LDAP / SCIM / authentik publishing — owned by [2026-04-22 federation spec](../specs/2026-04-22-enterprise-auth-directory-federation-design.md).
- Public GAID issuance, transparency log, accredited issuer model — deferred per the spec.
- Cryptographic signing of AIDoc or receipts (RFC 9421 / JOSE / COSE) — phase-2 of `BI-OBS-4B63F2`.
- The five memory classes + revalidation gate — `BI-MEM-5A41C7`'s plan, written next.
- TaskRun envelope rewrites — owned by [2026-04-23 A2A runtime spec](../specs/2026-04-23-a2a-aligned-coworker-runtime-design.md).
- Cleaning up customer auth path beyond adding principal sync — different epic.

## Risks

- **Backfill drift.** A migration that runs partially and dies leaves the DB inconsistent. Mitigation: idempotent backfill SQL (Phase 1 Task 1.3) — re-runnable; verifiable counts before/after.
- **Fingerprint churn from cosmetic edits.** If an admin renames an agent and the rename touches a write path that calls `recomputeOperatingState`, fingerprint flips. Mitigation: the fingerprint helper accepts only material fields (Phase 3 Task 3.4 test enforces this), and write-path hooks (Task 3.7) use `materialChangeReason` to mark `validation_state` only when the change is actually material.
- **Concurrent sessions colliding on same agent.** If two admin sessions edit the same agent, two revision rows could be created with stale-overwriting fingerprints. Mitigation: phase 3 task 3.5 acceptance includes "skip-equal" — if recomputed fingerprint equals current `Agent.operatingProfileFingerprint`, no new revision is written.
- **AIDoc shape drift between this plan and the GAID standard.** If the standard's §7.2 evolves before all six phases land, the resolver will be slightly off. Mitigation: pin the resolver to the standard's commit hash referenced in the spec; if the standard changes, this plan rolls forward as a follow-up.
