# Unified Identity, Access, and Agent Governance Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working slice of the shared identity, access, delegation, and agent-governance foundation, then wire it into current HR/admin actions and agent registry visibility without touching raw agent-config internals.

**Architecture:** Keep the existing `User`, `CustomerContact`, `PlatformRole`, `UserGroup`, and `Agent` models. Add governance-overlay tables in Prisma, a runtime `PrincipalContext` builder, and an authorization resolver in `apps/web/lib`. Prove the slice by auditing current user-management actions, adding bounded delegation-grant workflows, and surfacing governance state in `/platform` and `/ea/agents`.

**Tech Stack:** Prisma 5, PostgreSQL, Next.js App Router, NextAuth v5 beta, React 18, TypeScript, Vitest

---

## Scope Guard

This plan intentionally implements only the first working slice from the spec:

- shared governance schema
- runtime authority resolver
- delegation grant creation and audit logging
- HR/admin action integration
- governance visibility in `/platform` and `/ea/agents`

This plan does **not** implement:

- full `EmployeeProfile`
- CRM/customer portal flows
- raw agent config payloads/editor
- end-to-end agent execution integration with prompt/tool runtime

Those remain separate follow-on plans.

---

## File Structure

### Database and model layer

- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313090000_identity_governance_foundation/migration.sql`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/seed.ts`
- Create: `packages/db/src/governance-seed.ts`
- Create: `packages/db/src/governance-seed.test.ts`

### Runtime authz and governance library

- Create: `apps/web/lib/governance-types.ts`
- Create: `apps/web/lib/principal-context.ts`
- Create: `apps/web/lib/governance-resolver.ts`
- Create: `apps/web/lib/governance-data.ts`
- Create: `apps/web/lib/principal-context.test.ts`
- Create: `apps/web/lib/governance-resolver.test.ts`

### Server actions

- Create: `apps/web/lib/actions/governance.ts`
- Modify: `apps/web/lib/actions/users.ts`
- Create: `apps/web/lib/actions/governance.test.ts`

### Auth/session integration

- Modify: `apps/web/lib/auth.ts`
- Modify: `apps/web/lib/auth.test.ts`

### UI surfaces

- Create: `apps/web/components/platform/GovernanceOverviewPanel.tsx`
- Create: `apps/web/components/platform/DelegationGrantPanel.tsx`
- Create: `apps/web/components/ea/AgentGovernanceCard.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/ea/agents/page.tsx`
- Modify: `apps/web/app/(shell)/employee/page.tsx`
- Modify: `apps/web/components/employee/HrUserLifecyclePanel.tsx`
- Modify: `apps/web/components/admin/AdminUserAccessPanel.tsx`
- Create: `apps/web/app/(shell)/platform/page.test.tsx`

### Permission bridge

- Modify: `apps/web/lib/permissions.ts`
- Modify: `apps/web/lib/permissions.test.ts`

### Documentation

- Modify: `docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md`

---

## Chunk 1: Data Foundation

### Task 1: Add governance Prisma models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260313090000_identity_governance_foundation/migration.sql`

- [ ] **Step 1: Add a failing schema-level reference list to the spec margin**

Append a short implementation note to the spec listing the exact new models to add:

```md
Implementation slice 1 models:
- Team
- TeamMembership
- AgentOwnership
- AgentCapabilityClass
- DirectivePolicyClass
- AgentGovernanceProfile
- DelegationGrant
- AuthorizationDecisionLog
```

- [ ] **Step 2: Add the new Prisma models to `schema.prisma`**

Follow the same style as existing models. Add:

```prisma
model Team {
  id          String   @id @default(cuid())
  teamId      String   @unique
  name        String
  slug        String   @unique
  description String?
  status      String   @default("active")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  memberships TeamMembership[]
  ownerships  AgentOwnership[]
}
```

Also add:

```prisma
model TeamMembership { ... }
model AgentOwnership { ... }
model AgentCapabilityClass { ... }
model DirectivePolicyClass { ... }
model AgentGovernanceProfile { ... }
model DelegationGrant { ... }
model AuthorizationDecisionLog { ... }
```

Use nullable FKs where the slice needs room for ungoverned existing records, especially around optional object refs and delegation links.

- [ ] **Step 3: Add relation fields to existing models**

Update existing models with back-relations only where required:

```prisma
model User {
  ...
  teamMemberships      TeamMembership[]
  grantedDelegations   DelegationGrant[] @relation("DelegationGrantGrantor")
}

model Agent {
  ...
  ownerships           AgentOwnership[]
  governanceProfile    AgentGovernanceProfile?
  delegationGrants     DelegationGrant[]
}
```

Do not refactor `CustomerContact` in this slice beyond what is needed for future compatibility.

- [ ] **Step 4: Create the SQL migration file**

Create `packages/db/prisma/migrations/20260313090000_identity_governance_foundation/migration.sql` with explicit `CREATE TABLE`, `CREATE INDEX`, and FK statements matching the Prisma schema.

Use:

```sql
CREATE TABLE "Team" (...);
CREATE UNIQUE INDEX "Team_teamId_key" ON "Team"("teamId");
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");
```

Repeat for all new tables. Add:

- cascade delete for pure join/ownership relationships
- restrictive or no-action behavior for logs
- indexes for `grantorUserId`, `granteeAgentId`, `expiresAt`, `decision`, and `createdAt`

- [ ] **Step 5: Run Prisma validation**

Run: `pnpm --filter @dpf/db exec prisma validate --schema prisma/schema.prisma`

Expected: `The schema at prisma/schema.prisma is valid`

- [ ] **Step 6: Generate the client**

Run: `pnpm --filter @dpf/db generate`

Expected: Prisma client regenerated with the new governance models.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260313090000_identity_governance_foundation/migration.sql docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md
git commit -m "feat(db): add identity governance foundation schema"
```

### Task 2: Seed only bootstrap governance reference data

**Files:**
- Modify: `packages/db/src/seed.ts`
- Create: `packages/db/src/governance-seed.ts`
- Create: `packages/db/src/governance-seed.test.ts`

- [ ] **Step 1: Write failing tests for governance seed helpers**

Create `packages/db/src/governance-seed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getDefaultCapabilityClasses, getDefaultDirectivePolicyClasses } from "./governance-seed";

describe("governance seed defaults", () => {
  it("returns stable capability classes", () => {
    expect(getDefaultCapabilityClasses().map((c) => c.capabilityClassId)).toEqual([
      "cap-advisory",
      "cap-operator",
      "cap-specialist",
      "cap-elevated",
    ]);
  });

  it("returns stable directive policy classes", () => {
    expect(getDefaultDirectivePolicyClasses().map((p) => p.policyClassId)).toContain("dir-workflow-standard");
  });
});
```

- [ ] **Step 2: Run the DB test suite to verify the new test fails**

Run: `pnpm --filter @dpf/db test`

Expected: FAIL because `governance-seed.ts` does not exist yet.

- [ ] **Step 3: Implement minimal seed default helpers**

Create `packages/db/src/governance-seed.ts`:

```ts
export function getDefaultCapabilityClasses() {
  return [
    { capabilityClassId: "cap-advisory", name: "Advisory", riskBand: "low" },
    { capabilityClassId: "cap-operator", name: "Operator", riskBand: "medium" },
    { capabilityClassId: "cap-specialist", name: "Specialist", riskBand: "high" },
    { capabilityClassId: "cap-elevated", name: "Elevated", riskBand: "critical" },
  ];
}
```

Also export `getDefaultDirectivePolicyClasses()` with stable IDs and approval modes.

- [ ] **Step 4: Wire bootstrap-only seed data into `seed.ts`**

Import and call a new `seedGovernanceReferenceData()` function from `packages/db/src/seed.ts`.

Seed only:

- `AgentCapabilityClass`
- `DirectivePolicyClass`

Do **not** seed live runtime team assignments, grants, or ownership records. Respect the repo guardrail that seed data is bootstrap default data, not runtime truth.

- [ ] **Step 5: Re-run DB tests**

Run: `pnpm --filter @dpf/db test`

Expected: PASS for the new seed helper test and existing DB tests.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/seed.ts packages/db/src/governance-seed.ts packages/db/src/governance-seed.test.ts
git commit -m "feat(db): seed governance reference defaults"
```

---

## Chunk 2: Runtime Authorization Layer

### Task 3: Introduce runtime governance types and `PrincipalContext`

**Files:**
- Create: `apps/web/lib/governance-types.ts`
- Create: `apps/web/lib/principal-context.ts`
- Create: `apps/web/lib/principal-context.test.ts`
- Modify: `apps/web/lib/auth.ts`

- [ ] **Step 1: Write failing tests for `PrincipalContext` assembly**

Create `apps/web/lib/principal-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPrincipalContext } from "./principal-context";

describe("buildPrincipalContext", () => {
  it("builds human-only context from a session user", () => {
    const ctx = buildPrincipalContext({
      sessionUser: { id: "usr_1", email: "manager@example.com", platformRole: "HR-100", isSuperuser: false },
      teamIds: ["team_ops"],
      actingAgentId: null,
      delegationGrantIds: [],
    });
    expect(ctx.platformRoleIds).toEqual(["HR-100"]);
    expect(ctx.actingAgent).toBeUndefined();
  });

  it("adds acting agent and delegation grants when present", () => {
    const ctx = buildPrincipalContext({
      sessionUser: { id: "usr_1", email: "manager@example.com", platformRole: "HR-100", isSuperuser: false },
      teamIds: ["team_ops"],
      actingAgentId: "AGT-100",
      delegationGrantIds: ["DGR-001"],
    });
    expect(ctx.actingAgent?.agentId).toBe("AGT-100");
    expect(ctx.delegationGrantIds).toEqual(["DGR-001"]);
  });
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run: `pnpm --filter web test -- apps/web/lib/principal-context.test.ts`

Expected: FAIL because `principal-context.ts` does not exist yet.

- [ ] **Step 3: Implement shared governance types**

Create `apps/web/lib/governance-types.ts` with:

```ts
export type RiskBand = "low" | "medium" | "high" | "critical";
export type GovernanceDecision = "allow" | "deny" | "require_approval";
export type PrincipalContext = { ... };
export type AuthorityRequest = { actionKey: string; objectRef?: string; riskBand: RiskBand; actingAgentId?: string | null; };
```

- [ ] **Step 4: Implement `buildPrincipalContext`**

Create `apps/web/lib/principal-context.ts`:

```ts
import type { PrincipalContext } from "./governance-types";

export function buildPrincipalContext(input: { ... }): PrincipalContext {
  return {
    authenticatedSubject: { kind: "user", userId: input.sessionUser.id },
    actingHuman: { kind: "user", userId: input.sessionUser.id },
    ...(input.actingAgentId ? { actingAgent: { agentId: input.actingAgentId } } : {}),
    teamIds: input.teamIds,
    platformRoleIds: input.sessionUser.platformRole ? [input.sessionUser.platformRole] : [],
    effectiveCapabilities: [],
    delegationGrantIds: input.delegationGrantIds,
  };
}
```

- [ ] **Step 5: Extend auth session typing**

Modify `apps/web/lib/auth.ts` so the session user includes only what this slice needs:

```ts
export type DpfSession = {
  user: {
    id: string;
    email: string;
    platformRole: string | null;
    isSuperuser: boolean;
  };
};
```

If needed, update callback assignments so `session.user.id` is reliably populated.

- [ ] **Step 6: Re-run tests**

Run: `pnpm --filter web test -- apps/web/lib/principal-context.test.ts apps/web/lib/auth.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/governance-types.ts apps/web/lib/principal-context.ts apps/web/lib/principal-context.test.ts apps/web/lib/auth.ts
git commit -m "feat(web): add principal context foundation"
```

### Task 4: Build the authorization resolver and decision logging contract

**Files:**
- Create: `apps/web/lib/governance-resolver.ts`
- Create: `apps/web/lib/governance-data.ts`
- Create: `apps/web/lib/governance-resolver.test.ts`
- Modify: `apps/web/lib/permissions.ts`
- Modify: `apps/web/lib/permissions.test.ts`

- [ ] **Step 1: Write failing resolver tests**

Create `apps/web/lib/governance-resolver.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveGovernedAction } from "./governance-resolver";

describe("resolveGovernedAction", () => {
  it("allows when human role and agent baseline both permit the action", () => {
    const result = resolveGovernedAction({ ...baselineAllowedFixture });
    expect(result.decision).toBe("allow");
  });

  it("requires approval when request exceeds baseline but grant is possible", () => {
    const result = resolveGovernedAction({ ...grantableFixture });
    expect(result.decision).toBe("require_approval");
  });

  it("denies when risk band exceeds both baseline and grant cap", () => {
    const result = resolveGovernedAction({ ...criticalFixture });
    expect(result.decision).toBe("deny");
  });
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run: `pnpm --filter web test -- apps/web/lib/governance-resolver.test.ts`

Expected: FAIL because the resolver does not exist yet.

- [ ] **Step 3: Implement minimal pure resolver**

Create `apps/web/lib/governance-resolver.ts` with a pure function:

```ts
export function resolveGovernedAction(input: ResolveGovernedActionInput): ResolveGovernedActionResult {
  if (!input.humanAllowed) return deny("human_context_denied");
  if (!input.agentPolicyAllowed) return deny("agent_policy_denied");
  if (input.riskBand > input.agentMaxRiskBand && !input.activeGrant) return requireApproval("grant_required");
  if (input.activeGrant && input.activeGrant.allowsRequestedScope) return allow("delegation_grant");
  return allow("baseline_intersection");
}
```

Use real enums/string unions, not the pseudo comparison above. Implement helper functions for:

- risk-band ordering
- decision rationale building
- grant-expiry validation

- [ ] **Step 4: Add DB-backed read helpers**

Create `apps/web/lib/governance-data.ts` with focused read-model functions:

- `getUserTeamIds(userId: string): Promise<string[]>`
- `getAgentGovernance(agentId: string): Promise<... | null>`
- `getActiveDelegationGrants(params): Promise<...[]>`
- `createAuthorizationDecisionLog(input): Promise<void>`

Use Prisma select shapes only for fields required by the resolver.

- [ ] **Step 5: Bridge existing coarse capabilities**

Modify `apps/web/lib/permissions.ts` minimally:

- keep `can()` for route-level gating
- export a helper that maps current `CapabilityKey` to action-family hints if needed by governed actions later

Do not replace the existing permission matrix in this slice.

- [ ] **Step 6: Re-run targeted tests**

Run: `pnpm --filter web test -- apps/web/lib/governance-resolver.test.ts apps/web/lib/permissions.test.ts`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/governance-resolver.ts apps/web/lib/governance-data.ts apps/web/lib/governance-resolver.test.ts apps/web/lib/permissions.ts apps/web/lib/permissions.test.ts
git commit -m "feat(web): add governed action resolver"
```

---

## Chunk 3: Actions and UX Integration

### Task 5: Add governance server actions and delegation-grant creation

**Files:**
- Create: `apps/web/lib/actions/governance.ts`
- Create: `apps/web/lib/actions/governance.test.ts`

- [ ] **Step 1: Write failing tests for grant validation**

Create `apps/web/lib/actions/governance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDelegationGrantInput } from "./governance";

describe("validateDelegationGrantInput", () => {
  it("rejects expiry before validFrom", () => {
    expect(validateDelegationGrantInput({
      granteeAgentId: "agent_1",
      riskBand: "high",
      validFrom: new Date("2026-03-13T10:00:00Z"),
      expiresAt: new Date("2026-03-13T09:00:00Z"),
      scopeJson: {},
    })).toMatch(/expires/i);
  });
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run: `pnpm --filter web test -- apps/web/lib/actions/governance.test.ts`

Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Implement minimal validation helpers**

In `apps/web/lib/actions/governance.ts`, add:

```ts
export function validateDelegationGrantInput(input: DelegationGrantInput): string | null {
  if (input.expiresAt <= input.validFrom) return "Grant expiry must be after the start time.";
  if (!input.granteeAgentId) return "Select an agent.";
  return null;
}
```

- [ ] **Step 4: Add authenticated server actions**

In the same file, implement:

- `createDelegationGrant(input)`
- `revokeDelegationGrant(grantId)`
- `assignAgentGovernanceProfile(input)`
- `assignAgentOwnership(input)`

For this slice:

- require authenticated `User`
- gate with `manage_users`, `manage_user_lifecycle`, or `manage_agents` as appropriate
- call the resolver before persisting grants
- write `AuthorizationDecisionLog` for success and deny outcomes
- revalidate `/platform`, `/employee`, and `/ea/agents`

- [ ] **Step 5: Re-run tests**

Run: `pnpm --filter web test -- apps/web/lib/actions/governance.test.ts`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/governance.ts apps/web/lib/actions/governance.test.ts
git commit -m "feat(web): add governance server actions"
```

### Task 6: Audit and govern current HR/admin actions

**Files:**
- Modify: `apps/web/lib/actions/users.ts`
- Modify: `apps/web/components/employee/HrUserLifecyclePanel.tsx`
- Modify: `apps/web/components/admin/AdminUserAccessPanel.tsx`

- [ ] **Step 1: Add a failing test for auditable lifecycle updates**

If `apps/web/lib/actions/users.ts` has no test file yet, create a narrow test near the new governance test file or extend `governance.test.ts` with a pure helper test:

```ts
it("returns a governance denial when non-superuser tries to modify a protected account", async () => {
  const result = await summarizeGovernedLifecycleAttempt({ actorIsSuperuser: false, targetIsSuperuser: true });
  expect(result.decision).toBe("deny");
});
```

Keep the pure decision helper separate from DB I/O.

- [ ] **Step 2: Add a reusable governed-action wrapper**

In `apps/web/lib/actions/users.ts`, introduce a focused helper:

```ts
async function withGovernedUserAction(input: {
  capability: "manage_users" | "manage_user_lifecycle";
  actionKey: string;
  riskBand: "medium" | "high";
  run: (actor: SessionUserContext) => Promise<UserActionResult>;
}): Promise<UserActionResult> { ... }
```

This helper should:

- resolve session user
- load `PrincipalContext`
- evaluate baseline governance
- write `AuthorizationDecisionLog`
- either deny or call `run()`

- [ ] **Step 3: Wrap existing actions**

Refactor:

- `createUserAccount`
- `adminResetUserPassword`
- `updateUserLifecycle`

Each should use `withGovernedUserAction(...)`.

Suggested action keys:

- `user.create`
- `user.password_reset`
- `user.lifecycle_update`

- [ ] **Step 4: Surface governance messages in the panels**

Update:

- `apps/web/components/admin/AdminUserAccessPanel.tsx`
- `apps/web/components/employee/HrUserLifecyclePanel.tsx`

So returned messages can show:

- direct success/failure
- governance deny reasons
- grant/approval requirement messages when added later

Do not redesign the panels; keep the existing UI structure.

- [ ] **Step 5: Run tests**

Run:

```bash
pnpm --filter web test -- apps/web/lib/actions/governance.test.ts apps/web/lib/auth.test.ts apps/web/lib/permissions.test.ts
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/actions/users.ts apps/web/components/employee/HrUserLifecyclePanel.tsx apps/web/components/admin/AdminUserAccessPanel.tsx
git commit -m "feat(web): govern and audit user lifecycle actions"
```

### Task 7: Surface governance state in `/platform` and `/ea/agents`

**Files:**
- Create: `apps/web/components/platform/GovernanceOverviewPanel.tsx`
- Create: `apps/web/components/platform/DelegationGrantPanel.tsx`
- Create: `apps/web/components/ea/AgentGovernanceCard.tsx`
- Modify: `apps/web/app/(shell)/platform/page.tsx`
- Modify: `apps/web/app/(shell)/ea/agents/page.tsx`
- Create: `apps/web/app/(shell)/platform/page.test.tsx`

- [ ] **Step 1: Write a failing page/component test for governance visibility**

Create `apps/web/app/(shell)/platform/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { GovernanceOverviewPanel } from "@/components/platform/GovernanceOverviewPanel";

it("renders governance counts and recent delegation grants", () => {
  render(
    <GovernanceOverviewPanel
      summary={{ teams: 2, governedAgents: 5, activeGrants: 1, pendingApprovals: 0 }}
      recentGrants={[{ grantId: "DGR-001", agentName: "Ops Agent", grantorLabel: "manager@example.com", status: "active" }]}
    />
  );
  expect(screen.getByText(/governed agents/i)).toBeInTheDocument();
  expect(screen.getByText("DGR-001")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the targeted web test to confirm failure**

Run: `pnpm --filter web test -- "apps/web/app/(shell)/platform/page.test.tsx"`

Expected: FAIL because the panel does not exist yet.

- [ ] **Step 3: Implement focused presentation components**

Create:

- `GovernanceOverviewPanel.tsx`
- `DelegationGrantPanel.tsx`
- `AgentGovernanceCard.tsx`

Keep them small and data-driven. Example prop shapes:

```ts
type GovernanceSummary = {
  teams: number;
  governedAgents: number;
  activeGrants: number;
  pendingApprovals: number;
};
```

`AgentGovernanceCard` should display:

- `agentId`
- `name`
- owning team or `Ungoverned`
- capability class or `Unassigned`
- autonomy level or `Unset`
- active grant badge if present

- [ ] **Step 4: Extend the `/platform` page**

Modify `apps/web/app/(shell)/platform/page.tsx` to query:

- counts from governance tables
- recent active delegation grants
- existing platform capability cards

Render the new governance overview above the current capability cards.

- [ ] **Step 5: Extend the `/ea/agents` page**

Modify `apps/web/app/(shell)/ea/agents/page.tsx`:

- join in `governanceProfile`, `ownerships`, and active grant count
- replace the inline card markup with `AgentGovernanceCard`

Keep the tier-grouped structure intact.

- [ ] **Step 6: Re-run tests**

Run:

```bash
pnpm --filter web test -- "apps/web/app/(shell)/platform/page.test.tsx"
pnpm --filter web typecheck
```

Expected: PASS and 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/platform/GovernanceOverviewPanel.tsx apps/web/components/platform/DelegationGrantPanel.tsx apps/web/components/ea/AgentGovernanceCard.tsx apps/web/app/(shell)/platform/page.tsx apps/web/app/(shell)/ea/agents/page.tsx apps/web/app/(shell)/platform/page.test.tsx
git commit -m "feat(web): add governance visibility to platform and agent registry"
```

### Task 8: Final verification and doc sync

**Files:**
- Modify: `docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md`

- [ ] **Step 1: Update the spec status notes**

Add a brief implementation-status note at the top of the spec:

```md
Implementation status:
- slice 1 delivered: governance schema, resolver, grants, audit, platform/agent visibility
- deferred: employee profile, CRM/customer portal flows, deep agent runtime integration
```

- [ ] **Step 2: Run the full verification set**

Run:

```bash
pnpm --filter @dpf/db test
pnpm --filter @dpf/db generate
pnpm --filter web test
pnpm --filter web typecheck
```

Expected:

- DB tests PASS
- Prisma client generates cleanly
- web tests PASS
- web typecheck returns 0 errors

- [ ] **Step 3: Manually verify the main UI paths**

Run: `pnpm --filter web dev`

Check:

- `/platform` shows governance summary plus existing capability cards
- `/ea/agents` shows governance metadata for agents
- `/employee` lifecycle updates still work
- `/admin` create/reset flows still work
- denied governed actions show human-readable messages

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-03-13-unified-identity-access-agent-governance-design.md
git commit -m "docs: sync governance spec with slice 1 delivery"
```

---

## Notes For The Implementer

- Respect `AGENTS.md`: current state comes from the live DB, not seed defaults. Only seed lookup/reference data in `seed.ts`.
- Keep the route-level `can()` checks. This slice adds governed action enforcement; it does not replace coarse navigation gating.
- Do not invent a full policy engine. The first slice needs a clear, testable resolver with bounded scope.
- Keep UI changes additive. Reuse existing `/employee`, `/admin`, `/platform`, and `/ea/agents` surfaces rather than designing a brand-new governance console.
- Keep agent-config boundaries clean. Governance can classify and approve config categories, but it should not own the raw config payload or editor.

---

## Review Checklist

- [ ] New Prisma models match the spec and keep nullable room for existing live records
- [ ] Bootstrap seed changes are limited to reference/default tables
- [ ] `PrincipalContext` is runtime-only and not prematurely persisted
- [ ] Resolver is pure and covered by focused tests
- [ ] User-management actions write authorization decision logs
- [ ] `/platform` and `/ea/agents` expose governance state without major UX churn
- [ ] Full verification commands pass before any completion claim

