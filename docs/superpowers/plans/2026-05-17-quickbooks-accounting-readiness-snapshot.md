# QuickBooks Accounting Readiness Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Slice 1 from `BI-AA303B6F`: a read-only QuickBooks readiness snapshot with a reusable `IntegrationReadinessDescriptor` primitive.

**Architecture:** Add a provider-agnostic descriptor in `apps/web/lib/integrate/readiness.ts`, derive a QuickBooks-specific descriptor in `apps/web/lib/integrate/quickbooks/readiness.ts`, and render it through a shared `IntegrationReadinessPanel` on `/platform/tools/integrations/quickbooks`. The slice is read-only, schema-free, and secret-free; it surfaces operating mode, readiness state, health signals, and next safe actions without adding writes or migrations.

**Tech Stack:** Next.js 16 App Router, React 19 server/client components, TypeScript, Vitest, DPF theme CSS variables, Prisma `IntegrationCredential`.

---

## Files

- Create: `apps/web/lib/integrate/readiness.ts`
  - Owns shared descriptor types, state machine constants, contribution tag constants, and a small helper for capability validation.
- Create: `apps/web/lib/integrate/readiness.test.ts`
  - Tests provider-agnostic descriptor semantics and capability-state validation.
- Create: `apps/web/lib/integrate/quickbooks/readiness.ts`
  - Owns QuickBooks capability rows and `buildQuickBooksReadinessDescriptor()`.
- Create: `apps/web/lib/integrate/quickbooks/readiness.test.ts`
  - Tests unconfigured, connected, and error states for QuickBooks descriptor derivation.
- Create: `apps/web/components/integrations/IntegrationReadinessPanel.tsx`
  - Shared theme-aware readiness UI for any native integration descriptor.
- Create: `apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`
  - Tests visible provider name, state labels, health signals, and no secret values.
- Modify: `apps/web/lib/tools/native-integration-catalog.ts`
  - Add optional readiness metadata to native integration descriptors and populate the QuickBooks entity families.
- Modify: `apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.tsx`
  - Build and render the QuickBooks readiness descriptor from the existing credential record.
- Modify: `apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx`
  - Assert the page renders the readiness panel state from the stored credential.
- Modify: `apps/web/components/integrations/QuickBooksConnectPanel.tsx`
  - Replace touched hardcoded red/emerald Tailwind color classes with DPF theme-aware styles.
- Modify: `docs/superpowers/specs/2026-05-16-small-business-os-parity-quickbooks-anchor-design.md`
  - Already updated to reference created backlog item `BI-AA303B6F`.

## Task 1: Shared Readiness Descriptor

**Files:**
- Create: `apps/web/lib/integrate/readiness.test.ts`
- Create: `apps/web/lib/integrate/readiness.ts`

- [ ] **Step 1: Write the failing shared descriptor tests**

```typescript
import { describe, expect, it } from "vitest";
import {
  INTEGRATION_READINESS_STATES,
  isIntegrationReadinessState,
  normalizeReadinessCapability,
} from "./readiness";

describe("integration readiness descriptor primitives", () => {
  it("recognizes every supported readiness state", () => {
    expect(INTEGRATION_READINESS_STATES).toContain("not-connected");
    expect(INTEGRATION_READINESS_STATES).toContain("dpf-primary-ready");
    expect(isIntegrationReadinessState("read")).toBe(true);
    expect(isIntegrationReadinessState("invented")).toBe(false);
  });

  it("marks unsupported capability states as not mapped", () => {
    const capability = normalizeReadinessCapability({
      key: "vendors",
      label: "Vendors",
      description: "Vendor directory",
      state: "read",
      operatingMode: "integration-led",
      supportedNow: false,
      hiveTag: "hive:aggregate-only",
    });

    expect(capability.state).toBe("not-mapped");
    expect(capability.supportedNow).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter web test -- apps/web/lib/integrate/readiness.test.ts`

Expected: FAIL because `apps/web/lib/integrate/readiness.ts` does not exist.

- [ ] **Step 3: Implement the shared descriptor**

```typescript
export const INTEGRATION_READINESS_STATES = [
  "not-connected",
  "credential-expired",
  "not-mapped",
  "read",
  "import-ready",
  "dual-run-ready",
  "dpf-primary-ready",
  "dpf-primary",
  "partner-led",
] as const;

export type IntegrationReadinessState = (typeof INTEGRATION_READINESS_STATES)[number];

export const INTEGRATION_OPERATING_MODES = [
  "integration-led",
  "dual-run",
  "dpf-primary",
  "partner-led",
] as const;

export type IntegrationOperatingMode = (typeof INTEGRATION_OPERATING_MODES)[number];

export type HiveContributionTag = "hive:public" | "hive:aggregate-only" | "hive:private";

export type IntegrationCredentialStatus =
  | "not-connected"
  | "connected"
  | "error"
  | "credential-expired";

export interface IntegrationReadinessCapability {
  key: string;
  label: string;
  description: string;
  state: IntegrationReadinessState;
  operatingMode: IntegrationOperatingMode;
  supportedNow: boolean;
  hiveTag: HiveContributionTag;
  nextAction: string;
  unreachableStates?: IntegrationReadinessState[];
}

export interface IntegrationReadinessHealth {
  credentialStatus: IntegrationCredentialStatus;
  lastSuccessfulProbeAt: string | null;
  lastProbeErrorCategory: string | null;
  timeUntilExpiry: string | null;
}

export interface IntegrationReadinessDescriptor {
  schemaVersion: "1.0";
  provider: string;
  integrationId: string;
  displayName: string;
  summary: string;
  environment: string | null;
  entityContext: Record<string, string | null>;
  health: IntegrationReadinessHealth;
  capabilities: IntegrationReadinessCapability[];
  nextSafeActions: string[];
  updatedAt: string | null;
}

export function isIntegrationReadinessState(value: string): value is IntegrationReadinessState {
  return INTEGRATION_READINESS_STATES.includes(value as IntegrationReadinessState);
}

export function normalizeReadinessCapability(
  capability: IntegrationReadinessCapability,
): IntegrationReadinessCapability {
  if (!capability.supportedNow && capability.state !== "partner-led") {
    return { ...capability, state: "not-mapped" };
  }
  return capability;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `pnpm --filter web test -- apps/web/lib/integrate/readiness.test.ts`

Expected: PASS.

## Task 2: QuickBooks Descriptor Derivation

**Files:**
- Create: `apps/web/lib/integrate/quickbooks/readiness.test.ts`
- Create: `apps/web/lib/integrate/quickbooks/readiness.ts`

- [ ] **Step 1: Write failing QuickBooks descriptor tests**

```typescript
import { describe, expect, it } from "vitest";
import { buildQuickBooksReadinessDescriptor } from "./readiness";

describe("buildQuickBooksReadinessDescriptor", () => {
  it("marks all capabilities not connected when no credential exists", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({ connection: null });

    expect(descriptor.schemaVersion).toBe("1.0");
    expect(descriptor.health.credentialStatus).toBe("not-connected");
    expect(descriptor.capabilities.every((capability) => capability.state === "not-connected")).toBe(true);
    expect(descriptor.nextSafeActions).toContain("Connect QuickBooks credentials");
  });

  it("marks company customers and invoices as read when connected", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({
      connection: {
        status: "connected",
        companyName: "Acme Services LLC",
        realmId: "9130355377388383",
        lastErrorMsg: null,
        lastTestedAt: "2026-04-24T05:00:00.000Z",
        environment: "sandbox",
      },
    });

    expect(descriptor.health.credentialStatus).toBe("connected");
    expect(descriptor.entityContext.companyName).toBe("Acme Services LLC");
    expect(descriptor.capabilities.filter((capability) => capability.state === "read").map((capability) => capability.key)).toEqual([
      "company",
      "customers",
      "invoices",
    ]);
    expect(descriptor.capabilities.find((capability) => capability.key === "vendors")?.state).toBe("not-mapped");
  });

  it("surfaces credential errors without exposing secrets", () => {
    const descriptor = buildQuickBooksReadinessDescriptor({
      connection: {
        status: "error",
        companyName: null,
        realmId: "9130355377388383",
        lastErrorMsg: "invalid QuickBooks credentials",
        lastTestedAt: "2026-04-24T05:00:00.000Z",
        environment: "production",
      },
    });

    expect(descriptor.health.credentialStatus).toBe("error");
    expect(descriptor.health.lastProbeErrorCategory).toBe("invalid QuickBooks credentials");
    expect(JSON.stringify(descriptor)).not.toContain("clientSecret");
    expect(JSON.stringify(descriptor)).not.toContain("refreshToken");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `pnpm --filter web test -- apps/web/lib/integrate/quickbooks/readiness.test.ts`

Expected: FAIL because `buildQuickBooksReadinessDescriptor` does not exist.

- [ ] **Step 3: Implement QuickBooks descriptor derivation**

Implementation notes:

- Define capability keys: `company`, `customers`, `invoices`, `vendors`, `bills`, `payments`, `accounts`, `bank_transactions`, `reports`, `tax`, `accountant_workflow`.
- When connection is `connected`, `company`, `customers`, and `invoices` are `read`; all other QuickBooks rows are `not-mapped`.
- When connection is `unconfigured` or null, every row is `not-connected`.
- When connection is `error`, every row is `credential-expired` only if the error text is auth-related; otherwise use `not-mapped` for unsupported rows and `credential-expired` for supported read rows.

- [ ] **Step 4: Run the QuickBooks descriptor tests**

Run: `pnpm --filter web test -- apps/web/lib/integrate/quickbooks/readiness.test.ts`

Expected: PASS.

## Task 3: Native Catalog Readiness Metadata

**Files:**
- Modify: `apps/web/lib/tools/native-integration-catalog.ts`
- Test: `apps/web/lib/tools/native-integration-catalog.test.ts`

- [ ] **Step 1: Write or extend catalog test**

If no catalog test exists, create `apps/web/lib/tools/native-integration-catalog.test.ts` and assert QuickBooks exposes the readiness entity families.

- [ ] **Step 2: Run the catalog test and verify it fails**

Run: `pnpm --filter web test -- apps/web/lib/tools/native-integration-catalog.test.ts`

Expected: FAIL because readiness metadata does not exist.

- [ ] **Step 3: Add optional readiness metadata**

Add `readiness?: { entityFamilies: string[] }` to `NativeIntegrationDescriptor` and populate QuickBooks with the capability keys from Task 2.

- [ ] **Step 4: Run the catalog test**

Run: `pnpm --filter web test -- apps/web/lib/tools/native-integration-catalog.test.ts`

Expected: PASS.

## Task 4: Readiness UI Panel

**Files:**
- Create: `apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`
- Create: `apps/web/components/integrations/IntegrationReadinessPanel.tsx`

- [ ] **Step 1: Write failing UI test**

Render a descriptor from `buildQuickBooksReadinessDescriptor()` and assert:

- Provider name is visible.
- Company, customers, and invoices show "Read only".
- Vendors show "Not mapped".
- Credential status is visible.
- No token or secret strings render.

- [ ] **Step 2: Run the UI test and verify it fails**

Run: `pnpm --filter web test -- apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement theme-aware panel**

Use no hardcoded Tailwind color tokens. Use `text-[var(--dpf-text)]`, `text-[var(--dpf-muted)]`, `border-[var(--dpf-border)]`, `bg-[var(--dpf-surface-1)]`, `bg-[var(--dpf-surface-2)]`, and `bg-[color-mix(in_srgb,var(--dpf-accent)_14%,transparent)]` for emphasized chips.

- [ ] **Step 4: Run the UI test**

Run: `pnpm --filter web test -- apps/web/components/integrations/IntegrationReadinessPanel.test.tsx`

Expected: PASS.

## Task 5: QuickBooks Page Integration

**Files:**
- Modify: `apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.tsx`
- Modify: `apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx`

- [ ] **Step 1: Update failing page test**

Assert the server page renders a readiness panel and includes the connected company plus "Read only" and "Not mapped" content.

- [ ] **Step 2: Run the page test and verify it fails**

Run: `pnpm --filter web test -- "apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx"`

Expected: FAIL because the page does not render the readiness panel.

- [ ] **Step 3: Wire descriptor into the page**

Import `buildQuickBooksReadinessDescriptor` and `IntegrationReadinessPanel`, build the descriptor from `initialState`, and render it between `QuickBooksConnectPanel` and the existing aside.

- [ ] **Step 4: Run the page test**

Run: `pnpm --filter web test -- "apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx"`

Expected: PASS.

## Task 6: QuickBooks Panel Theme Cleanup

**Files:**
- Modify: `apps/web/components/integrations/QuickBooksConnectPanel.tsx`

- [ ] **Step 1: Replace hardcoded alert/status colors**

Replace `border-red-*`, `bg-red-*`, `text-red-*`, `border-emerald-*`, `bg-emerald-*`, and `text-emerald-*` with DPF theme-token classes.

- [ ] **Step 2: Run targeted component/page tests**

Run:

```powershell
pnpm --filter web test -- apps/web/components/integrations/IntegrationReadinessPanel.test.tsx "apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx"
```

Expected: PASS.

## Task 7: Final Verification

**Files:** all touched files.

- [ ] **Step 1: Run focused tests**

```powershell
pnpm --filter web test -- apps/web/lib/integrate/readiness.test.ts apps/web/lib/integrate/quickbooks/readiness.test.ts apps/web/lib/tools/native-integration-catalog.test.ts apps/web/components/integrations/IntegrationReadinessPanel.test.tsx "apps/web/app/(shell)/platform/tools/integrations/quickbooks/page.test.tsx" apps/web/app/api/integrations/quickbooks/connect/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

```powershell
Push-Location apps/web
pnpm exec next build
Pop-Location
```

Expected: PASS.

- [ ] **Step 4: UX verification**

Rebuild and run the Docker-served portal if code changes require production-path verification, then verify `/platform/tools/integrations/quickbooks` as `admin@dpf.local` using `ADMIN_PASSWORD` from repo-root `.env`.

- [ ] **Step 5: Git hygiene**

Run `git status --short --branch` and `git diff --check`. Do not commit or push until the verification gate passes.

## Self-Review

- Spec coverage: This plan covers Slice 1 only: descriptor primitive, QuickBooks rows, readiness UI, theme cleanup, and focused tests. It deliberately excludes writes, schema migrations, import projection, mode promotion, coworker tools, and DPF-primary promotion.
- Placeholder scan: No task uses TBD/TODO/fill-in placeholders.
- Type consistency: `IntegrationReadinessDescriptor`, `IntegrationReadinessCapability`, `IntegrationReadinessState`, and `IntegrationOperatingMode` are introduced once and reused by QuickBooks derivation and UI rendering.
