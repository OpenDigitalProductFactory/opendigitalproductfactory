# TAK / GAID Protocol Profiles Supervisor Control Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an internal Agent Card projection with TAK and GAID extensions, including a supervisor-ready authority snapshot.

**Architecture:** This slice adds a read-model service under `apps/web/lib/tak`. It reuses the existing AIDoc resolver and grant mapping instead of introducing new identity or authorization sources. The service is internal only; public A2A publication and UI rendering are follow-on slices.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Prisma 7.x, pnpm workspaces.

**Spec source:** `docs/superpowers/specs/2026-05-21-tak-gaid-protocol-profiles-supervisor-control-design.md`

**Backlog anchors:** `EP-TAK-3F9A21`, `BI-GAID-8D72B4`, `BI-OBS-4B63F2`, `EP-A2A`.

---

## File Structure

- Create `apps/web/lib/tak/agent-card-types.ts`.
  Owns internal Agent Card types and the supervisor authority snapshot shape.
- Create `apps/web/lib/tak/agent-card-service.ts`.
  Owns projection helpers and DB-backed card resolution.
- Create `apps/web/lib/tak/agent-card-service.test.ts`.
  Proves the card is complete, explicit about missing identity, and stable enough for future protocol projection.
- Modify `apps/web/lib/tak/index.ts`.
  Exports the new card service and types.
- Modify `docs/architecture/agent-standards-dpf-conformance.md`.
  Updates the implementation evidence once the projection service exists.

## Task 1: Internal Agent Card Types

**Files:**
- Create: `apps/web/lib/tak/agent-card-types.ts`

- [ ] **Step 1: Define the type file**

```ts
import type { GaidAuthorizationClass } from "@/lib/identity/authorization-classes";
import type { InternalAIDoc } from "@/lib/identity/aidoc-resolver";

export type InternalAgentCardInterface = "mcp" | "a2a-internal" | "task-run" | "supervisor-control";

export type InternalAgentCardSecurityScheme = {
  id: string;
  type: "dpf-capability" | "agent-grant" | "hitl" | "mcp-token";
  description: string;
};

export type InternalAgentCardSkill = {
  label: string;
  taskType: string | null;
  capability: string | null;
};

export type RuntimeAuthoritySnapshot = {
  agentId: string;
  routeContext: string | null;
  actingPrincipalRef: string | null;
  actingPrincipalGaid: string | null;
  agentGaid: string | null;
  aidocValidationState: InternalAIDoc["validation_state"] | "unlinked";
  operatingProfileFingerprint: string | null;
  hitlTier: number;
  hitlPolicy: string | null;
  sensitivity: string;
  toolGrantCount: number;
  exposedToolCount: number;
  authorizationClasses: GaidAuthorizationClass[];
  requiresApprovalForSideEffects: boolean;
  limitations: string[];
};

export type InternalAgentCard = {
  schemaVersion: "dpf.agent-card.v1";
  agentId: string;
  name: string;
  description: string | null;
  status: string;
  lifecycleStage: string;
  interfaces: InternalAgentCardInterface[];
  skills: InternalAgentCardSkill[];
  capabilities: string[];
  toolGrants: string[];
  exposedTools: string[];
  securitySchemes: InternalAgentCardSecurityScheme[];
  securityRequirements: string[];
  extensions: {
    tak: {
      sensitivity: string;
      hitlTier: number;
      hitlPolicy: string | null;
      autonomyLevel: string | null;
      allowDelegation: boolean;
      maxDelegationRiskBand: string | null;
      operatingProfileFingerprint: string | null;
      authority: RuntimeAuthoritySnapshot;
    };
    gaid: {
      gaid: string | null;
      aidocRef: string | null;
      authorizationClasses: GaidAuthorizationClass[];
      validationState: InternalAIDoc["validation_state"] | "unlinked";
    };
  };
};
```

- [ ] **Step 2: Do not run tests yet**

This type file is exercised by Task 2 tests.

## Task 2: Failing Agent Card Projection Tests

**Files:**
- Create: `apps/web/lib/tak/agent-card-service.test.ts`

- [ ] **Step 1: Write the failing test file**

Use `vi.mock("@dpf/db", ...)` and mock the existing AIDoc resolver. The first test must expect a full card for a linked agent. The second test must expect explicit unlinked GAID state when no AIDoc is available.

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
pnpm --filter web exec vitest run lib/tak/agent-card-service.test.ts
```

Expected: fail with an import error because `./agent-card-service` does not exist.

## Task 3: Agent Card Projection Service

**Files:**
- Create: `apps/web/lib/tak/agent-card-service.ts`
- Modify: `apps/web/lib/tak/index.ts`

- [ ] **Step 1: Implement pure projection helpers**

Implement:

```ts
export function projectInternalAgentCard(source: InternalAgentCardProjectionSource): InternalAgentCard
export async function resolveInternalAgentCard(agentId: string, options?: ResolveInternalAgentCardOptions): Promise<InternalAgentCard | null>
```

- [ ] **Step 2: Use existing identity and grant sources**

The service must use:

- `resolveAIDocForAgent()` for GAID, AIDoc validation, operating profile fingerprint, exposed tools, and authorization classes.
- `getToolGrantMapping()` to derive exposed tools when no AIDoc exists.
- `Agent.skills`, `Agent.toolGrants`, `Agent.executionConfig`, and `Agent.governanceProfile` from the DB.

- [ ] **Step 3: Export from the TAK barrel**

Add:

```ts
export * from "./agent-card-types";
export * from "./agent-card-service";
```

- [ ] **Step 4: Run the focused card tests to verify GREEN**

Run:

```powershell
pnpm --filter web exec vitest run lib/tak/agent-card-service.test.ts
```

Expected: all Agent Card tests pass.

## Task 4: Conformance Doc Update

**Files:**
- Modify: `docs/architecture/agent-standards-dpf-conformance.md`

- [ ] **Step 1: Update TAK runtime transparency and GAID interoperability evidence**

Mention `apps/web/lib/tak/agent-card-service.ts` and `apps/web/lib/tak/agent-card-types.ts` as the first internal Agent Card projection.

- [ ] **Step 2: Keep statuses conservative**

Use `Partially Implemented` for protocol interoperability because public A2A/MCP GAID publication and public verifier endpoints are still future work.

## Task 5: Verification

**Files:** none

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web exec vitest run lib/tak/agent-card-service.test.ts lib/identity/aidoc-resolver.test.ts lib/identity/agent-identity-snapshot.test.ts lib/tak/agent-grants.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Inspect diff**

```powershell
git diff --stat
git diff -- apps/web/lib/tak/agent-card-types.ts apps/web/lib/tak/agent-card-service.ts apps/web/lib/tak/agent-card-service.test.ts apps/web/lib/tak/index.ts docs/architecture/agent-standards-dpf-conformance.md
```

Expected: changes are limited to the slice.

## Task 6: Commit

**Files:** all files changed by this slice

- [ ] **Step 1: Stage**

```powershell
git add apps/web/lib/tak/agent-card-types.ts apps/web/lib/tak/agent-card-service.ts apps/web/lib/tak/agent-card-service.test.ts apps/web/lib/tak/index.ts docs/architecture/agent-standards-dpf-conformance.md docs/superpowers/specs/2026-05-21-tak-gaid-protocol-profiles-supervisor-control-design.md docs/superpowers/plans/2026-05-21-tak-gaid-protocol-profiles-supervisor-control-slice-1.md
```

- [ ] **Step 2: Commit with DCO sign-off**

```powershell
git commit -s -m "feat(tak): add internal agent card projection"
```

- [ ] **Step 3: Push**

```powershell
git push -u origin feat/tak-gaid-protocol-profiles
```
