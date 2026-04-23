# Enterprise Auth, Directory, And Federation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a coherent enterprise identity stack for DPF that hardens current auth, adds manager-aware authorization, syncs ADP workforce hierarchy, introduces an identity edge for LDAP/OIDC/SAML/SCIM, and aligns HR/Finance coworkers with the same access model.

**Architecture:** DPF remains the source of truth for principal identity, employee-manager hierarchy, route capabilities, and coworker grants. An incorporated identity edge runtime publishes standards surfaces. Delivery is phased so the platform first fixes its current auth seams, then adds workforce hierarchy and principal modeling, then layers federation and directory protocols on top.

**Tech Stack:** Next.js 16, Auth.js, Prisma 7, PostgreSQL, Docker Compose, TypeScript, ADP MCP service, authentik (new service), LDAP/OIDC/SAML/SCIM.

**Authoritative spec:** [docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md](../specs/2026-04-22-enterprise-auth-directory-federation-design.md)

---

## File Structure

Expected files and responsibilities before task execution:

- `packages/db/prisma/schema.prisma`
  - add principal spine and app-federation models
- `packages/db/prisma/migrations/<timestamp>_*`
  - additive migrations with inline backfill SQL where needed
- `apps/web/lib/govern/auth.ts`
  - Auth.js provider config and session enrichment
- `apps/web/lib/govern/password.ts`
  - canonical password verification logic
- `apps/web/app/api/v1/auth/login/route.ts`
  - API login path using canonical verification
- `apps/web/lib/api/auth-middleware.ts`
  - richer effective auth context
- `apps/web/lib/govern/permissions.ts`
  - capability + scope evaluation
- `apps/web/lib/identity/*`
  - new principal, alias, provisioning, and access-evaluator helpers
- `apps/web/lib/integrate/adp/*`
  - ADP workforce sync and hierarchy reconciliation
- `apps/web/app/api/integrations/adp/*`
  - ADP sync/test endpoints
- `apps/web/app/(shell)/admin/settings/*` or adjacent settings routes
  - admin UI for directory/federation settings
- `apps/web/components/integrations/*`
  - UI panels for identity edge, federation, and app provisioning
- `docker-compose.yml`
  - add identity edge service
- `tests` / `*.test.ts` / `*.test.tsx`
  - unit coverage for new auth and access rules

---

## Chunk 1: Harden Current Auth

### Task 1.1: Unify workforce password verification

**Files:**
- Modify: `apps/web/lib/govern/password.ts`
- Modify: `apps/web/app/api/v1/auth/login/route.ts`
- Create: `apps/web/app/api/v1/auth/login/route.test.ts`

- [ ] **Step 1: Write the failing API auth tests**

```ts
it("accepts a bcrypt password through the API login route", async () => {
  // Arrange mocked user with bcrypt hash
  // Assert 200 and tokens returned
});

it("accepts a legacy sha256 password and rehashes on success", async () => {
  // Arrange mocked user with 64-char hex hash
  // Assert login succeeds and passwordHash is updated
});
```

- [ ] **Step 2: Run the targeted test**

Run: `pnpm --filter web test apps/web/app/api/v1/auth/login/route.test.ts`

Expected: FAIL because the route still uses `bcrypt.compare()` directly.

- [ ] **Step 3: Refactor the route to use `verifyPassword()`**

Minimal implementation shape:

```ts
const { valid, needsRehash } = await verifyPassword(password, user.passwordHash);
if (!valid) throw apiError("INVALID_CREDENTIALS", "Invalid email or password", 401);
if (needsRehash) {
  const nextHash = await hashPassword(password);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: nextHash } });
}
```

- [ ] **Step 4: Run the test again**

Run: `pnpm --filter web test apps/web/app/api/v1/auth/login/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/govern/password.ts apps/web/app/api/v1/auth/login/route.ts apps/web/app/api/v1/auth/login/route.test.ts
git commit -m "feat(auth): unify API login with canonical password verification"
```

### Task 1.2: Introduce a richer auth context helper

**Files:**
- Create: `apps/web/lib/identity/effective-auth-context.ts`
- Create: `apps/web/lib/identity/effective-auth-context.test.ts`
- Modify: `apps/web/lib/api/auth-middleware.ts`

- [ ] **Step 1: Write the failing helper tests**

```ts
it("builds effective auth context for a workforce user", () => {
  expect(context.principalId).toMatch(/^PRN-/);
  expect(context.platformRole).toBe("HR-300");
});

it("returns empty manager scope for a non-manager", () => {
  expect(context.managerScope?.directReportIds ?? []).toEqual([]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter web test apps/web/lib/identity/effective-auth-context.test.ts`

- [ ] **Step 3: Implement the helper**

Start with a narrow shape:

```ts
export type EffectiveAuthContext = {
  principalId: string | null;
  platformRole: string | null;
  isSuperuser: boolean;
  employeeId: string | null;
  grantedCapabilities: string[];
};
```

Use current data first; do not wait on the principal spine migration.

- [ ] **Step 4: Wire `auth-middleware.ts` to return the richer context**

- [ ] **Step 5: Re-run tests**

Run: `pnpm --filter web test apps/web/lib/identity/effective-auth-context.test.ts`

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/identity/effective-auth-context.ts apps/web/lib/identity/effective-auth-context.test.ts apps/web/lib/api/auth-middleware.ts
git commit -m "feat(auth): add effective auth context helper for route and tool access"
```

---

## Chunk 2: Principal Spine

### Task 2.1: Add `Principal` and `PrincipalAlias`

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_add_principal_spine/migration.sql`
- Create: `packages/db/src/principal-spine.test.ts`

- [ ] **Step 1: Write the failing DB test**

```ts
it("creates a principal and alias pair", async () => {
  const principal = await prisma.principal.create({ data: { principalId: "PRN-000001", kind: "human", displayName: "Alice Example" } });
  await prisma.principalAlias.create({ data: { principalId: principal.id, aliasType: "user", aliasValue: "usr_123" } });
  const aliases = await prisma.principalAlias.findMany({ where: { principalId: principal.id } });
  expect(aliases).toHaveLength(1);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @dpf/db test principal-spine`

- [ ] **Step 3: Add the schema models**

Additive model block:

```prisma
model Principal {
  id          String          @id @default(cuid())
  principalId String          @unique
  kind        String
  status      String          @default("active")
  displayName String
  aliases     PrincipalAlias[]
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt
}

model PrincipalAlias {
  id          String   @id @default(cuid())
  principalId String
  aliasType   String
  aliasValue  String
  issuer      String?
  createdAt   DateTime @default(now())
  principal   Principal @relation(fields: [principalId], references: [id], onDelete: Cascade)

  @@unique([aliasType, aliasValue, issuer])
  @@index([principalId])
}
```

- [ ] **Step 4: Generate the migration**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate dev --name add_principal_spine --create-only
```

- [ ] **Step 5: Add inline backfill SQL to the migration**

Backfill from existing users and agents where possible; at minimum create principals for all existing `User` rows and `Agent` rows.

- [ ] **Step 6: Apply migration and run tests**

Run:

```bash
pnpm --filter @dpf/db exec prisma migrate deploy
pnpm --filter @dpf/db test principal-spine
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/principal-spine.test.ts
git commit -m "feat(identity): add principal spine and alias model"
```

### Task 2.2: Link current auth records into the principal spine

**Files:**
- Create: `apps/web/lib/identity/principal-linking.ts`
- Create: `apps/web/lib/identity/principal-linking.test.ts`
- Modify: `apps/web/lib/govern/auth.ts`

- [ ] **Step 1: Write the failing linking tests**

```ts
it("resolves a workforce user to a principal", async () => {
  const result = await syncUserPrincipal(userId);
  expect(result.kind).toBe("human");
});

it("creates a GAID-ready alias slot for an agent principal", async () => {
  const result = await syncAgentPrincipal(agentId);
  expect(result.aliases.some((a) => a.aliasType === "agent")).toBe(true);
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter web test apps/web/lib/identity/principal-linking.test.ts`

- [ ] **Step 3: Implement `principal-linking.ts`**

Responsibilities:
- link `User` -> `Principal`
- add `user` and `employee` aliases
- link `Agent` -> `Principal`
- add `agent` alias

- [ ] **Step 4: Enrich login/session code to include `principalId`**

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/identity/principal-linking.ts apps/web/lib/identity/principal-linking.test.ts apps/web/lib/govern/auth.ts
git commit -m "feat(identity): link workforce and agent records into principal spine"
```

---

## Chunk 3: ADP Workforce Hierarchy And Manager Scope

### Task 3.1: Add ADP alias and workforce sync contract

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `apps/web/lib/integrate/adp/workforce-sync.ts`
- Create: `apps/web/lib/integrate/adp/workforce-sync.test.ts`

- [ ] **Step 1: Write the failing sync test**

```ts
it("maps an ADP worker to employee profile and principal alias", async () => {
  const result = await reconcileAdpWorker(sampleWorker);
  expect(result.employeeProfile.employeeId).toBe("EMP-100");
  expect(result.aliases.some((a) => a.aliasType === "adp")).toBe(true);
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter web test apps/web/lib/integrate/adp/workforce-sync.test.ts`

- [ ] **Step 3: Implement sync contract**

Responsibilities:
- resolve worker by employee number or work email
- upsert ADP alias on the principal
- update `EmployeeProfile.managerEmployeeId`
- update employment status from ADP

- [ ] **Step 4: Re-run the test**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/integrate/adp/workforce-sync.ts apps/web/lib/integrate/adp/workforce-sync.test.ts packages/db/prisma/schema.prisma
git commit -m "feat(adp): reconcile workforce hierarchy into employee profiles and principal aliases"
```

### Task 3.2: Implement manager-aware access evaluation

**Files:**
- Create: `apps/web/lib/govern/manager-scope.ts`
- Create: `apps/web/lib/govern/manager-scope.test.ts`
- Modify: `apps/web/lib/govern/permissions.ts`
- Modify: `apps/web/lib/api/auth-middleware.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("allows a manager to access a direct report", () => {
  expect(canAccessEmployeeScope(managerContext, reportId)).toBe(true);
});

it("denies a manager access to unrelated employees without HR capability", () => {
  expect(canAccessEmployeeScope(managerContext, unrelatedId)).toBe(false);
});
```

- [ ] **Step 2: Run the tests**

Run: `pnpm --filter web test apps/web/lib/govern/manager-scope.test.ts`

- [ ] **Step 3: Implement manager scope resolution**

Start with:

```ts
export function canAccessEmployeeScope(
  context: EffectiveAuthContext,
  targetEmployeeId: string,
): boolean {
  if (context.isSuperuser) return true;
  if (context.employeeId === targetEmployeeId) return true;
  return context.managerScope?.directReportIds.includes(targetEmployeeId) ?? false;
}
```

- [ ] **Step 4: Thread the scope evaluator into permissions and route checks**

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/govern/manager-scope.ts apps/web/lib/govern/manager-scope.test.ts apps/web/lib/govern/permissions.ts apps/web/lib/api/auth-middleware.ts
git commit -m "feat(authz): add manager-aware workforce scope evaluation"
```

---

## Chunk 4: Identity Edge Integration

### Task 4.1: Add the identity edge runtime to Docker

**Files:**
- Modify: `docker-compose.yml`
- Create: `docs/operations/authentik-runtime-notes.md`

- [ ] **Step 1: Add the service definition**

Add a new `authentik` service with:
- image/runtime configuration
- database/env wiring
- healthcheck
- dependency ordering compatible with the current stack

- [ ] **Step 2: Document local bootstrap expectations**

Include:
- admin bootstrap secret handling
- local URL
- backup/restore note
- how DPF will provision into it

- [ ] **Step 3: Build and start the service**

Run:

```bash
docker compose build authentik
docker compose up -d authentik
```

Expected: service healthy.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml docs/operations/authentik-runtime-notes.md
git commit -m "feat(identity-edge): add authentik runtime to local platform stack"
```

### Task 4.2: Add provisioning client from DPF to the identity edge

**Files:**
- Create: `apps/web/lib/integrate/authentik/provisioning-client.ts`
- Create: `apps/web/lib/integrate/authentik/provisioning-client.test.ts`
- Create: `apps/web/app/api/integrations/authentik/test/route.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("provisions a user payload to the edge", async () => {
  const result = await pushPrincipalToIdentityEdge(samplePrincipal);
  expect(result.ok).toBe(true);
});
```

- [ ] **Step 2: Run the tests**

- [ ] **Step 3: Implement the client**

Phase-1 implementation can use the edge admin API if SCIM bootstrap is not ready yet, but the method boundary must be SCIM-shaped so it can switch later without rewriting callers.

- [ ] **Step 4: Add a smoke-test route for admin validation**

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/integrate/authentik/provisioning-client.ts apps/web/lib/integrate/authentik/provisioning-client.test.ts apps/web/app/api/integrations/authentik/test/route.ts
git commit -m "feat(identity-edge): add DPF provisioning client for identity edge sync"
```

---

## Chunk 5: Workforce Federation Into DPF

### Task 5.1: Add OIDC-based workforce login

**Files:**
- Modify: `apps/web/lib/govern/auth.ts`
- Create: `apps/web/lib/govern/auth-oidc.test.ts`
- Modify: workforce login UI files under `apps/web/app/(auth)/`

- [ ] **Step 1: Write the failing auth tests**

```ts
it("maps an oidc login to a principal-linked workforce user", async () => {
  // Assert session contains principalId and platformRole
});
```

- [ ] **Step 2: Run the tests**

- [ ] **Step 3: Add the OIDC provider config**

Use Auth.js generic OIDC configuration pointed at the identity edge. Keep current credentials provider during migration.

- [ ] **Step 4: Add account linking logic**

Map `(issuer, sub)` into a principal-linked alias record before finalizing session state.

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/govern/auth.ts apps/web/lib/govern/auth-oidc.test.ts apps/web/app/(auth)
git commit -m "feat(auth): add OIDC workforce federation through identity edge"
```

---

## Chunk 6: LDAP And SCIM Publication

### Task 6.1: Add directory projection settings and claims mapping

**Files:**
- Create: `apps/web/lib/identity/directory-projection.ts`
- Create: `apps/web/lib/identity/directory-projection.test.ts`
- Create: `apps/web/components/integrations/DirectorySettingsPanel.tsx`
- Create: `apps/web/app/(shell)/admin/settings/security/page.tsx`

- [ ] **Step 1: Write the failing projection tests**

```ts
it("projects a workforce role as an LDAP-compatible group", () => {
  const result = projectRoleGroups(principal, memberships);
  expect(result).toContainEqual(expect.objectContaining({ cn: "role-HR-300" }));
});
```

- [ ] **Step 2: Run the tests**

- [ ] **Step 3: Implement projection helper**

Responsibilities:
- map DPF principals to directory objects
- map roles to LDAP groups
- tag principal kind

- [ ] **Step 4: Add admin settings UI**

Allow admin to see:
- directory base DN
- publication status
- LDAP/SCIM edge connection health

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/identity/directory-projection.ts apps/web/lib/identity/directory-projection.test.ts apps/web/components/integrations/DirectorySettingsPanel.tsx apps/web/app/(shell)/admin/settings/security/page.tsx
git commit -m "feat(directory): add LDAP and SCIM projection settings"
```

---

## Chunk 7: External Product Federation

### Task 7.1: Add downstream application registry

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `apps/web/lib/identity/application-registry.ts`
- Create: `apps/web/lib/identity/application-registry.test.ts`
- Create: `apps/web/components/integrations/ApplicationFederationPanel.tsx`

- [ ] **Step 1: Write the failing tests**

```ts
it("stores an OIDC app registration with claim mappings", async () => {
  const app = await createFederatedApplication({ protocol: "oidc", appKey: "grafana" });
  expect(app.protocol).toBe("oidc");
});
```

- [ ] **Step 2: Run the tests**

- [ ] **Step 3: Add schema and registry helper**

Include:
- app key
- display name
- protocol
- claim mappings
- assigned groups
- provisioning mode

- [ ] **Step 4: Add admin UI panel**

- [ ] **Step 5: Re-run tests**

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma apps/web/lib/identity/application-registry.ts apps/web/lib/identity/application-registry.test.ts apps/web/components/integrations/ApplicationFederationPanel.tsx
git commit -m "feat(federation): add downstream application registry and claim mapping"
```

---

## Chunk 8: Coworker Access Alignment

### Task 8.1: Thread manager-aware auth context into coworker/tool resolution

**Files:**
- Modify: `apps/web/lib/tak/agent-grants.ts`
- Modify: coworker resolution/auth files under `apps/web/lib/actions/agent-coworker.ts` and adjacent modules
- Create: `apps/web/lib/actions/agent-coworker-authz.test.ts`

- [ ] **Step 1: Write the failing coworker authz tests**

```ts
it("denies an HR coworker action outside the manager's team scope", async () => {
  expect(result.allowed).toBe(false);
});

it("allows a finance coworker payroll summary within allowed scope when ADP is connected", async () => {
  expect(result.allowed).toBe(true);
});
```

- [ ] **Step 2: Run the tests**

- [ ] **Step 3: Implement scope-aware coworker gating**

Effective rule:

```ts
effective = userAllowed && agentAllowed && routeAllowed && scopeAllowed && integrationReady;
```

- [ ] **Step 4: Re-run tests**

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/tak/agent-grants.ts apps/web/lib/actions/agent-coworker.ts apps/web/lib/actions/agent-coworker-authz.test.ts
git commit -m "feat(coworkers): align HR and finance coworker access with manager-aware auth"
```

---

## Verification

After each chunk, run the smallest relevant tests first. After each merged chunk, run the production build gate.

- [ ] **Targeted unit tests**

Run examples:

```bash
pnpm --filter web test apps/web/app/api/v1/auth/login/route.test.ts
pnpm --filter web test apps/web/lib/govern/manager-scope.test.ts
pnpm --filter @dpf/db test principal-spine
```

- [ ] **Production build**

Run:

```bash
cd apps/web && npx next build
```

Expected: zero errors.

- [ ] **Docker runtime smoke check**

Run after edge service lands:

```bash
docker compose up -d portal authentik adp
```

Verify:
- DPF login page loads
- ADP connect page loads
- identity edge health endpoint is healthy

- [ ] **Manual QA**

Minimum scenarios:
- workforce login via current credentials path
- workforce login via OIDC path
- API login path with bcrypt and legacy hash cases
- employee sees only self records
- manager sees direct reports only
- HR operator sees broader workforce views by role
- ADP-connected manager can use scoped HR/Finance coworker queries
- downstream app receives expected federated groups/claims

---

## Notes For Execution

- Treat the current worktree as dirty; stage only files for the active chunk.
- Do not modify unrelated local changes.
- Keep ADP authority limited to workforce hierarchy and status, not route permissions.
- Keep LDAP consumers read-only until the rest of the identity plane is stable.
- Do not block principal-spine adoption on agent-global identity work; use aliases so `GAID` can plug in later.

---

## Review

When this plan is executed, review each chunk before moving on. The highest-risk boundaries are:

- auth path migration without breaking current local login
- principal backfill correctness
- manager-scope enforcement leaks
- identity edge sync drift
- coworker/tool permissions accidentally widening during refactor

