# Contributor Client MCP Readiness Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Build Studio and Platform Development readiness surface that proves Claude Code and Codex can use the DPF MCP server with the right token access controls.

**Architecture:** Implement a pure, non-mutating read model in `apps/web/lib/mcp/contributor-readiness.ts`, then consume it from a compact Build Studio card and a Platform Development banner. Existing MCP token actions remain the only write path for issue, rotate, revoke, copy, and setup snippets.

**Tech Stack:** Next.js 16 server actions, React 19 client components, Vitest, DPF MCP token substrate, DPF theme CSS variables.

---

## Scope Notes

This plan implements the first slice from
`docs/superpowers/specs/2026-05-26-contributor-client-mcp-readiness-design.md`.
It does not add a new schema migration. GAID binding is represented honestly as
`identityBinding: "not_available"` until the TAK/GAID protocol-profile work
lands a first-class external contributor principal binding.

Do not create a parallel token issuance path. All write operations must continue
through `apps/web/lib/actions/mcp-tokens.ts` and
`apps/web/lib/auth/mcp-api-token.ts`.

## File Structure

- Modify: `apps/web/lib/mcp-token-scopes.ts`
  - Export `CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`.
- Modify: `apps/web/lib/mcp-token-scopes.test.ts`
  - Assert the development template is a superset of the readiness threshold.
- Create: `apps/web/lib/mcp/contributor-readiness.ts`
  - Pure read model, token selection, missing grant diff, optional live probe.
- Create: `apps/web/lib/mcp/contributor-readiness.test.ts`
  - TDD coverage for readiness states and probe caching.
- Modify: `apps/web/lib/actions/mcp-tokens.ts`
  - Add `getMyContributorMcpReadiness`.
- Modify: `apps/web/lib/actions/mcp-tokens.test.ts`
  - Assert auth, delegation, and no plaintext exposure.
- Create: `apps/web/components/platform/ContributorMcpReadinessCard.tsx`
  - Compact card used by Build Studio.
- Create: `apps/web/components/platform/ContributorMcpReadinessCard.test.tsx`
  - Component states and primary actions.
- Modify: `apps/web/components/platform/BuildStudioConfigForm.tsx`
  - Render the card above Build Dispatch Engine.
- Modify: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`
  - Resolve base URL and initial readiness server-side.
- Modify: `apps/web/components/admin/McpTokenManager.tsx`
  - Add a small status banner that consumes the same read model.
- Modify: `apps/web/components/admin/McpTokenManager.test.tsx`
  - Banner behavior and no duplicate token semantics.

## Chunk 1: Readiness Threshold Constant

### Task 1: Export Required Grants

**Files:**
- Modify: `apps/web/lib/mcp-token-scopes.ts`
- Modify: `apps/web/lib/mcp-token-scopes.test.ts`

- [ ] **Step 1: Write the failing invariant test**

Add to `apps/web/lib/mcp-token-scopes.test.ts`:

```ts
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  getMcpTokenTemplate,
} from "./mcp-token-scopes";

it("keeps the development template as a superset of contributor MCP readiness", () => {
  const development = getMcpTokenTemplate("development");
  expect(development).toBeDefined();
  for (const grant of CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS) {
    expect(development!.grants).toContain(grant);
  }
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/mcp-token-scopes.test.ts
```

Expected: fails because `CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS` is not exported.

- [ ] **Step 3: Add the constant**

Add to `apps/web/lib/mcp-token-scopes.ts`, near the template section:

```ts
export const CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS = [
  "architecture_read",
  "backlog_read",
  "backlog_write",
  "code_graph_read",
  "file_read",
  "spec_plan_read",
  "work_capsule_read",
  "work_capsule_write",
  "work_capsule_adopt",
  "sandbox_execute",
  "iac_execute",
] as const;
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
pnpm --filter web exec vitest run lib/mcp-token-scopes.test.ts
```

Expected: all tests in `mcp-token-scopes.test.ts` pass.

## Chunk 2: Pure Readiness Model

### Task 2: Implement Non-Mutating Readiness State

**Files:**
- Create: `apps/web/lib/mcp/contributor-readiness.ts`
- Create: `apps/web/lib/mcp/contributor-readiness.test.ts`

- [ ] **Step 1: Write failing tests for token selection and states**

Create `apps/web/lib/mcp/contributor-readiness.test.ts` with cases for:

- no owned tokens -> `needs_authorization`
- only expired/revoked operator tokens -> `needs_reissue`
- only `ephemeral_ship` tokens -> `needs_authorization`
- active read-tier token -> `needs_grants`
- active write token missing one required grant -> `needs_grants`
- active write/admin token with every required grant -> `ready`
- multiple ready tokens -> picks the most recently used token
- GAID binding unavailable -> `identityBinding: "not_available"` without fabricated GAID

Use dependency injection so tests do not touch Prisma:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  getContributorMcpReadiness,
  type ContributorMcpTokenRow,
} from "./contributor-readiness";
import { CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS } from "../mcp-token-scopes";

function token(overrides: Partial<ContributorMcpTokenRow> = {}): ContributorMcpTokenRow {
  return {
    id: "tok_1",
    name: "Development token",
    prefix: "dpfmcp_DEV",
    tokenSuffix: "DEV1",
    canCopy: true,
    capability: "write",
    scope: "write",
    scopes: [...CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS],
    kind: "operator",
    buildId: null,
    lastUsedAt: new Date("2026-05-26T12:00:00Z"),
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date("2026-05-20T12:00:00Z"),
    ...overrides,
  };
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run lib/mcp/contributor-readiness.test.ts
```

Expected: fails because the module does not exist.

- [ ] **Step 3: Implement the read model**

Create `apps/web/lib/mcp/contributor-readiness.ts`:

```ts
import { copyMcpApiTokenPlaintext, listMcpApiTokens } from "@/lib/auth/mcp-api-token";
import {
  CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS,
  type McpTokenScopeTier,
} from "@/lib/mcp-token-scopes";

export type ContributorMcpReadinessStatus =
  | "ready"
  | "needs_authorization"
  | "needs_reissue"
  | "needs_grants"
  | "needs_identity_binding";

export type ContributorMcpRecommendedAction =
  | "none"
  | "issue_development_token"
  | "rotate_development_token"
  | "test_connection";

export type ContributorMcpProbe =
  | { status: "not_run" }
  | { status: "success"; checkedAt: string; toolCount: number }
  | { status: "failed"; checkedAt: string; message: string }
  | { status: "unavailable"; message: string };

export type ContributorMcpTokenRow = Awaited<ReturnType<typeof listMcpApiTokens>>[number];

export type ContributorMcpReadiness = {
  status: ContributorMcpReadinessStatus;
  recommendedAction: ContributorMcpRecommendedAction;
  identityBinding: "bound" | "not_available";
  token: null | {
    id: string;
    name: string;
    prefix: string;
    tokenSuffix: string;
    scope: McpTokenScopeTier;
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
  };
  missingGrants: string[];
  requiredGrants: string[];
  recommendedScopes: string[];
  probe: ContributorMcpProbe;
};
```

Implementation rules:

- Filter out `kind !== "operator"`.
- Treat revoked or expired operator tokens as `needs_reissue`.
- Treat `scope === "read"` or missing grants as `needs_grants`.
- Prefer the most recently used structurally ready token.
- Set `requiredGrants` to `CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`.
- Set `recommendedScopes` to the resolved development-template grants when
  available, falling back to `CONTRIBUTOR_MCP_READINESS_REQUIRED_GRANTS`.
- Return `identityBinding: "not_available"` in this slice.
- Do not write to any token row.

- [ ] **Step 4: Add optional live probe with one-minute cache**

Add an internal cache keyed by token id:

```ts
const PROBE_TTL_MS = 60_000;
const probeCache = new Map<string, { checkedAtMs: number; probe: ContributorMcpProbe }>();
```

When `opts.probe === true`, use `copyMcpApiTokenPlaintext(token.id)` to recover
the plaintext server-side, then POST `tools/list` to `${baseUrl}/api/mcp/v1`:

```ts
const res = await fetch(`${baseUrl}/api/mcp/v1`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${plaintext}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
```

Return `success` only when HTTP is ok and the JSON-RPC result contains a
non-empty `tools` array. Do not expose plaintext in the result.

- [ ] **Step 5: Run readiness tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/mcp/contributor-readiness.test.ts
```

Expected: all readiness tests pass.

## Chunk 3: Server Action and UI Integration

### Task 3: Add Readiness Server Action

**Files:**
- Modify: `apps/web/lib/actions/mcp-tokens.ts`
- Modify: `apps/web/lib/actions/mcp-tokens.test.ts`

- [ ] **Step 1: Test unauthenticated and authenticated action behavior**

Add tests that:

- unauthenticated callers get `{ ok: false, error: "unauthorized" }`
- authenticated callers delegate to `getContributorMcpReadiness`
- the action response never includes `plaintext`

- [ ] **Step 2: Implement the action**

Add to `apps/web/lib/actions/mcp-tokens.ts`:

```ts
export async function getMyContributorMcpReadiness(input?: {
  probe?: boolean;
  baseUrl?: string;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false as const, error: "unauthorized" };
  }
  const readiness = await getContributorMcpReadiness(session.user.id, {
    probe: input?.probe ?? false,
    baseUrl: input?.baseUrl,
  });
  return { ok: true as const, readiness };
}
```

- [ ] **Step 3: Run action tests**

Run:

```powershell
pnpm --filter web exec vitest run lib/actions/mcp-tokens.test.ts
```

Expected: action tests pass.

### Task 4: Build Studio Readiness Card

**Files:**
- Create: `apps/web/components/platform/ContributorMcpReadinessCard.tsx`
- Create: `apps/web/components/platform/ContributorMcpReadinessCard.test.tsx`
- Modify: `apps/web/components/platform/BuildStudioConfigForm.tsx`
- Modify: `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`

- [ ] **Step 1: Write component tests first**

Cover:

- `ready` shows quiet success copy and `Test connection`
- `needs_authorization` shows exactly one primary `Issue development token`
- `needs_reissue` shows `Issue development token`
- `needs_grants` shows `Rotate development token`
- `Test connection` calls `getMyContributorMcpReadiness({ probe: true, baseUrl })`
- issue/rotate actions show the existing setup snippets returned by token actions

- [ ] **Step 2: Implement the card**

Use `lucide-react` icons already present in the app, theme variables only, and
no nested card layout. The card receives:

```ts
type Props = {
  initialReadiness: ContributorMcpReadiness;
  baseUrl: string;
  canWrite: boolean;
};
```

Primary actions:

- `needs_authorization` / `needs_reissue`: call `issueMyWriteMcpToken({ baseUrl })`.
- `needs_grants`: call `rotateMyMcpTokenWithEdit` with the selected token id,
  `scope: "write"`, and `readiness.recommendedScopes`.
- `ready`: call `getMyContributorMcpReadiness({ probe: true, baseUrl })`.

`needs_client_refresh` is local component state after a successful issue or
rotation action. The read model does not try to inspect Claude/Codex process
environment variables.

- [ ] **Step 3: Wire the card into Build Studio**

In `apps/web/app/(shell)/platform/ai/build-studio/page.tsx`:

- derive `baseUrl` using `headers()` the same way
  `admin/platform-development/page.tsx` does
- call `getContributorMcpReadiness(user.id, { probe: false, baseUrl })`
- pass `baseUrl` and `contributorMcpReadiness` into `BuildStudioConfigForm`

In `BuildStudioConfigForm.tsx`, render the card above the Build Dispatch Engine
section.

- [ ] **Step 4: Run UI tests**

Run:

```powershell
pnpm --filter web exec vitest run components/platform/ContributorMcpReadinessCard.test.tsx
```

Expected: card tests pass.

## Chunk 4: Platform Development Banner

### Task 5: Reuse Readiness in MCP Token Manager

**Files:**
- Modify: `apps/web/components/admin/McpTokenManager.tsx`
- Modify: `apps/web/components/admin/McpTokenManager.test.tsx`

- [ ] **Step 1: Add tests for the readiness banner**

Cover:

- ready banner appears when `getMyContributorMcpReadiness` returns `ready`
- missing grants banner points to rotate-with-edit rather than custom setup
- banner does not duplicate the full Build Studio card
- lifecycle-managed `ephemeral_ship` rows do not count as contributor readiness

- [ ] **Step 2: Implement a compact banner**

Keep the full token list as-is. Add a small banner above the list:

- Ready: "Claude/Codex MCP readiness is satisfied."
- Attention: "Development token needs attention: <reason>."
- Link to Build Studio only as a secondary text link.

Do not move or duplicate the existing issue/rotate/revoke controls.

- [ ] **Step 3: Run token manager tests**

Run:

```powershell
pnpm --filter web exec vitest run components/admin/McpTokenManager.test.tsx
```

Expected: token manager tests pass.

## Chunk 5: Verification and Handoff

### Task 6: Focused Verification

**Files:**
- All files touched above

- [ ] **Step 1: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run `
  lib/mcp-token-scopes.test.ts `
  lib/mcp/contributor-readiness.test.ts `
  lib/actions/mcp-tokens.test.ts `
  components/platform/ContributorMcpReadinessCard.test.tsx `
  components/admin/McpTokenManager.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: Next.js production build succeeds.

- [ ] **Step 4: UX verify locally**

Use the running local portal at the configured localhost URL. Verify:

- Build Studio configuration page shows the readiness card above Build Dispatch Engine.
- Ready state is quiet and compact.
- Issue development token shows setup snippets and refresh command.
- Rotate development token handles missing grants.
- Test connection runs the live probe and reports success or failure inline.
- Admin > Platform Development > MCP shows the matching compact readiness banner.

Record a short dynamic-analysis summary in the implementation handoff.

- [ ] **Step 5: Commit and push**

Run:

```powershell
git status --short
git add apps/web/lib/mcp-token-scopes.ts apps/web/lib/mcp-token-scopes.test.ts `
  apps/web/lib/mcp/contributor-readiness.ts apps/web/lib/mcp/contributor-readiness.test.ts `
  apps/web/lib/actions/mcp-tokens.ts apps/web/lib/actions/mcp-tokens.test.ts `
  apps/web/components/platform/ContributorMcpReadinessCard.tsx `
  apps/web/components/platform/ContributorMcpReadinessCard.test.tsx `
  apps/web/components/platform/BuildStudioConfigForm.tsx `
  'apps/web/app/(shell)/platform/ai/build-studio/page.tsx' `
  apps/web/components/admin/McpTokenManager.tsx apps/web/components/admin/McpTokenManager.test.tsx
git commit -s -m "feat: add contributor MCP readiness"
git push
```

Expected: branch is pushed. Do not open a PR until the build gate and UX
evidence are complete and the branch is believed ready to merge.
