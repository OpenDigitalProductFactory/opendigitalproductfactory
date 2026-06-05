# Portal Navigation Archetype IA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make internal portal navigation easier for humans by separating worker-mode archetype navigation from platform-operator navigation, consolidating duplicated setup/control surfaces, and centralizing route ownership.

**Tracking item:** `BI-CD6EE9D8` under `EP-REDUCTION-GEAR-ARCH` owns Slice 1: canonical navigation inventory.

**Architecture:** Add a typed route/navigation model first, then migrate shell and section nav to consume that model. Keep route paths stable in early slices; change labels, layout ownership, and contextual actions before any route retirement. Extend workspace-home resolution later so archetype contributions can shape the AppRail.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7, pnpm workspaces, Vitest, DPF CSS variables, report-kit for data-display surfaces.

---

## Source Spec

Implement against:

- `docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md`
- `docs/superpowers/specs/2026-05-24-vertical-workspace-home-design.md`
- `docs/superpowers/specs/2026-05-31-archetype-aware-workspace-design.md`
- `docs/superpowers/plans/2026-05-31-archetype-aware-workspace.md`

## Worktree And Verification Rules

- Work in a topic worktree, not the root checkout.
- Do not change route paths in Tasks 1-5 unless a task explicitly says to update redirects.
- UI styling must use `var(--dpf-*)` tokens. No raw hex or `text-gray-*`.
- Use `pnpm --filter web exec vitest run <target tests>` for source-local tests.
- Run `pnpm --filter web typecheck` before handoff.
- Runtime UX verification must use the Live portal (`http://localhost:3000`) or a governed local-CI lease. Do not verify final UX on a worktree-local dev server.

## File Structure

New files:

- `apps/web/lib/navigation/portal-navigation-model.ts` - canonical route family, audience mode, destination kind, and label metadata.
- `apps/web/lib/navigation/portal-navigation-model.test.ts` - structural tests for route ownership, duplicates, and cross-domain tab rules.
- `apps/web/lib/navigation/legacy-redirects.ts` - documented legacy redirect table used by tests and route docs.
- `apps/web/lib/navigation/legacy-redirects.test.ts` - redirect inventory tests.
- `apps/web/components/shell/use-resolved-shell-nav.ts` - client helper or server adapter for mode-aware AppRail sections after Task 6.

Modified files:

- `apps/web/lib/govern/permissions.ts` - derive shell nav items from the new navigation model while preserving role gates.
- `apps/web/components/shell/Header.tsx` - remove "Internal cockpit" copy and accept mode-aware header copy.
- `apps/web/components/shell/AppRail.tsx` - render mode-aware labels and optional compact group descriptions.
- `apps/web/components/platform/platform-nav.ts` - remove `/admin` as a Platform family tab in Phase 1.
- `apps/web/components/platform/PlatformTabNav.tsx` - consume the Platform family model without cross-domain Admin.
- `apps/web/components/admin/AdminTabNav.tsx` and `apps/web/app/(shell)/admin/layout.tsx` - move Admin nav to layout-level.
- `apps/web/components/finance/FinanceTabNav.tsx` and `apps/web/app/(shell)/finance/layout.tsx` - move Finance nav to layout-level.
- `apps/web/components/compliance/ComplianceTabNav.tsx` - move family definitions into shared nav model or local typed model.
- `apps/web/components/storefront-admin/StorefrontAdminTabNav.tsx` - visible label cleanup only.
- `apps/web/components/storefront-admin/StorefrontSettingsNav.tsx` - "Portal" label cleanup.
- `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.tsx` - point setup CTA at the most specific setup path.
- `apps/web/lib/workspace-home/types.ts` and `apps/web/lib/workspace-home/registry.ts` - later Task 6 shell context extension.

---

### Task 1: Add Canonical Navigation Inventory

**Files:**

- Create: `apps/web/lib/navigation/portal-navigation-model.ts`
- Create: `apps/web/lib/navigation/portal-navigation-model.test.ts`

- [x] **Step 1: Create the failing structural tests**

Create `apps/web/lib/navigation/portal-navigation-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  PORTAL_NAV_ROUTES,
  getPrimaryNavEntries,
  getSectionNavEntries,
  getRouteNavRecord,
} from "./portal-navigation-model";

describe("portal navigation model", () => {
  it("has one unique route record per path", () => {
    const paths = PORTAL_NAV_ROUTES.map((route) => route.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("keeps section navigation inside its parent domain", () => {
    for (const route of PORTAL_NAV_ROUTES) {
      for (const item of route.sectionSiblings ?? []) {
        expect(item.startsWith(route.parentPath)).toBe(true);
      }
    }
  });

  it("does not expose Admin as a Platform family sibling", () => {
    const platformTabs = getSectionNavEntries("/platform").map((entry) => entry.path);
    expect(platformTabs).not.toContain("/admin");
  });

  it("keeps worker and operator primary entries separately addressable", () => {
    expect(getPrimaryNavEntries("worker").map((entry) => entry.key)).toContain("workspace");
    expect(getPrimaryNavEntries("operator").map((entry) => entry.key)).toContain("platform");
    expect(getPrimaryNavEntries("worker").map((entry) => entry.key)).not.toContain("admin");
  });

  it("classifies legacy redirect destinations as redirects, not primary nav", () => {
    expect(getRouteNavRecord("/admin/storefront")?.destinationKind).toBe("legacy-redirect");
    expect(getPrimaryNavEntries("operator").map((entry) => entry.path)).not.toContain("/admin/storefront");
  });
});
```

- [x] **Step 2: Run the test and confirm it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/navigation/portal-navigation-model.test.ts
```

Expected: fail because `portal-navigation-model.ts` does not exist.

- [x] **Step 3: Implement the minimal navigation model**

Create `apps/web/lib/navigation/portal-navigation-model.ts`:

```ts
export type PortalAudienceMode = "worker" | "operator" | "customer" | "diagnostic";

export type PortalDestinationKind =
  | "domain-home"
  | "section-page"
  | "detail"
  | "workflow-step"
  | "settings"
  | "contextual-action"
  | "legacy-redirect";

export type PortalNavRecord = {
  key: string;
  label: string;
  path: string;
  parentPath: string;
  domain: "workspace" | "business" | "delivery" | "platform" | "admin" | "knowledge" | "customer";
  audienceModes: PortalAudienceMode[];
  destinationKind: PortalDestinationKind;
  sectionSiblings?: string[];
};

export const PORTAL_NAV_ROUTES: PortalNavRecord[] = [
  {
    key: "workspace",
    label: "Workspace",
    path: "/workspace",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    sectionSiblings: ["/workspace", "/workspace/documents"],
  },
  {
    key: "documents",
    label: "Documents",
    path: "/workspace/documents",
    parentPath: "/workspace",
    domain: "workspace",
    audienceModes: ["operator"],
    destinationKind: "section-page",
  },
  {
    key: "customer",
    label: "Customer",
    path: "/customer",
    parentPath: "/customer",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
    sectionSiblings: [
      "/customer",
      "/customer/engagements",
      "/customer/opportunities",
      "/customer/quotes",
      "/customer/sales-orders",
      "/customer/funnel",
      "/customer/marketing",
    ],
  },
  {
    key: "finance",
    label: "Money",
    path: "/finance",
    parentPath: "/finance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
  },
  {
    key: "compliance",
    label: "Compliance",
    path: "/compliance",
    parentPath: "/compliance",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
  },
  {
    key: "customer-portal",
    label: "Customer Portal",
    path: "/storefront",
    parentPath: "/storefront",
    domain: "business",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
  },
  {
    key: "delivery",
    label: "Delivery",
    path: "/ops",
    parentPath: "/ops",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
  },
  {
    key: "build",
    label: "Build Studio",
    path: "/build",
    parentPath: "/build",
    domain: "delivery",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
  },
  {
    key: "platform",
    label: "Platform",
    path: "/platform",
    parentPath: "/platform",
    domain: "platform",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
    sectionSiblings: [
      "/platform",
      "/platform/identity",
      "/platform/ai",
      "/platform/tools",
      "/platform/audit",
    ],
  },
  {
    key: "admin",
    label: "Admin",
    path: "/admin",
    parentPath: "/admin",
    domain: "admin",
    audienceModes: ["operator"],
    destinationKind: "domain-home",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    path: "/knowledge",
    parentPath: "/knowledge",
    domain: "knowledge",
    audienceModes: ["worker", "operator"],
    destinationKind: "domain-home",
  },
  {
    key: "admin-storefront-redirect",
    label: "Legacy storefront admin redirect",
    path: "/admin/storefront",
    parentPath: "/storefront",
    domain: "business",
    audienceModes: ["diagnostic"],
    destinationKind: "legacy-redirect",
  },
];

export function getRouteNavRecord(path: string): PortalNavRecord | undefined {
  return PORTAL_NAV_ROUTES.find((route) => route.path === path);
}

export function getPrimaryNavEntries(mode: PortalAudienceMode): PortalNavRecord[] {
  return PORTAL_NAV_ROUTES.filter(
    (route) =>
      route.destinationKind === "domain-home" &&
      route.audienceModes.includes(mode),
  );
}

export function getSectionNavEntries(parentPath: string): PortalNavRecord[] {
  const parent = getRouteNavRecord(parentPath);
  if (!parent?.sectionSiblings) return [];
  return parent.sectionSiblings
    .map((path) => getRouteNavRecord(path) ?? {
      key: path,
      label: path.replace(`${parentPath}/`, ""),
      path,
      parentPath,
      domain: parent.domain,
      audienceModes: parent.audienceModes,
      destinationKind: "section-page" as const,
    })
    .filter((route) => route.parentPath === parentPath);
}
```

- [ ] **Step 4: Run the navigation model test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/navigation/portal-navigation-model.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/lib/navigation/portal-navigation-model.ts apps/web/lib/navigation/portal-navigation-model.test.ts
git commit -s -m "feat: add portal navigation inventory model"
```

---

### Task 2: Remove Cross-Domain Admin From Platform Tabs

**Files:**

- Modify: `apps/web/components/platform/platform-nav.ts`
- Modify: `apps/web/components/platform/PlatformTabNav.test.tsx`

- [ ] **Step 1: Add/adjust the failing Platform nav test**

In `apps/web/components/platform/PlatformTabNav.test.tsx`, ensure this test exists:

```ts
it("does not render Core Admin as a platform family tab", () => {
  pathname = "/platform";
  const html = renderToStaticMarkup(<PlatformTabNav />);
  expect(html).toContain("Identity &amp; Access");
  expect(html).toContain("AI Operations");
  expect(html).not.toContain("Core Admin");
  expect(html).not.toContain('href="/admin"');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/platform/PlatformTabNav.test.tsx
```

Expected: fail while `Core Admin` is still a Platform family.

- [ ] **Step 3: Remove the Admin family from Platform nav**

In `apps/web/components/platform/platform-nav.ts`:

- Remove `"admin"` from `PlatformFamilyKey`.
- Remove the family object with `key: "admin"`.
- Keep `/admin` reachable from the global operator rail and contextual cards.

The resulting union starts:

```ts
export type PlatformFamilyKey =
  | "overview"
  | "identity"
  | "ai"
  | "tools"
  | "audit";
```

- [ ] **Step 4: Run the Platform nav test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/platform/PlatformTabNav.test.tsx
```

Expected: pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/components/platform/platform-nav.ts apps/web/components/platform/PlatformTabNav.test.tsx
git commit -s -m "fix: keep admin out of platform family tabs"
```

---

### Task 3: Fix First-Touch Labels And Setup CTA

**Files:**

- Modify: `apps/web/components/shell/Header.tsx`
- Modify: `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.tsx`
- Modify: `apps/web/lib/govern/permissions.ts`
- Test: existing shell/header/nav tests plus new focused tests if absent

- [ ] **Step 1: Add assertions for copy**

If no tests exist for these components, create focused tests:

- `apps/web/components/shell/Header.test.tsx`
- `apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx`

Header test:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Header } from "./Header";

describe("Header", () => {
  it("does not use cockpit copy in the worker-facing shell header", () => {
    const html = renderToStaticMarkup(
      <Header
        platformRole="HR-000"
        brandName="Digital Product Factory"
        brandLogoUrl={null}
        userId="user-1"
      />,
    );

    expect(html).not.toContain("Internal cockpit");
    expect(html).toContain("Workspace");
  });
});
```

Unconfigured notice test:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { UnconfiguredWorkspaceHomeNotice } from "./UnconfiguredWorkspaceHomeNotice";

describe("UnconfiguredWorkspaceHomeNotice", () => {
  it("points users to the setup route instead of the storefront dashboard", () => {
    const html = renderToStaticMarkup(<UnconfiguredWorkspaceHomeNotice />);
    expect(html).toContain('href="/storefront/setup"');
    expect(html).not.toContain('href="/storefront"');
  });
});
```

- [ ] **Step 2: Run tests and confirm failures**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/shell/Header.test.tsx apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx
```

Expected: header test fails until copy is changed; notice test fails if CTA still points to `/storefront`.

- [ ] **Step 3: Update copy and route**

Update `Header.tsx`:

```tsx
<span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
  Workspace
</span>
```

Update the subtitle to:

```tsx
<p className="mt-0.5 truncate text-xs text-[var(--dpf-muted)]">
  Work, handoffs, and governed AI coworkers in one place
</p>
```

Update `UnconfiguredWorkspaceHomeNotice.tsx` CTA href to `/storefront/setup`.

Update `apps/web/lib/govern/permissions.ts` visible label for `/storefront`:

```ts
{
  key: "storefront",
  label: "Customer Portal",
  href: "/storefront",
  description: "Customer-facing portal experience and setup.",
  sectionKey: "business",
  capabilityKey: "view_storefront",
}
```

- [ ] **Step 4: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/shell/Header.test.tsx apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx apps/web/components/shell/AppRail.test.tsx
```

Expected: pass. If `AppRail.test.tsx` does not exist, run the existing permissions/nav tests instead.

- [ ] **Step 5: Commit**

Run:

```powershell
git add apps/web/components/shell/Header.tsx apps/web/components/shell/Header.test.tsx apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.tsx apps/web/components/workspace-home/UnconfiguredWorkspaceHomeNotice.test.tsx apps/web/lib/govern/permissions.ts
git commit -s -m "fix: clarify workspace and customer portal navigation labels"
```

---

### Task 4: Layout-Level Admin And Finance Section Nav

**Files:**

- Modify: `apps/web/app/(shell)/admin/layout.tsx`
- Modify: `apps/web/app/(shell)/finance/layout.tsx` or create it if absent
- Modify: admin pages that manually render `<AdminTabNav />`
- Modify: finance pages that manually render `<FinanceTabNav />`
- Tests: existing AdminTabNav and FinanceTabNav tests

- [ ] **Step 1: Move Admin nav to the Admin layout**

Update `apps/web/app/(shell)/admin/layout.tsx` to render `AdminTabNav` once:

```tsx
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (
    !session?.user ||
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_admin",
    )
  ) {
    notFound();
  }

  return (
    <div>
      <AdminTabNav />
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Remove manual AdminTabNav imports from child pages**

Remove `<AdminTabNav />` and the import from pages under `apps/web/app/(shell)/admin/**/page.tsx` that are wrapped by the layout.

- [ ] **Step 3: Add or update Finance layout**

Create or update `apps/web/app/(shell)/finance/layout.tsx`:

```tsx
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";

export default function FinanceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <FinanceTabNav />
      {children}
    </div>
  );
}
```

- [ ] **Step 4: Remove manual FinanceTabNav imports from child pages**

Remove `<FinanceTabNav />` and import statements from finance pages wrapped by the new layout.

- [ ] **Step 5: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/admin/AdminTabNav.test.tsx apps/web/components/finance/FinanceTabNav.test.tsx
pnpm --filter web typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/app/(shell)/admin apps/web/app/(shell)/finance apps/web/components/admin apps/web/components/finance
git commit -s -m "refactor: move admin and finance nav to layouts"
```

---

### Task 5: Add Legacy Redirect Inventory Tests

**Files:**

- Create: `apps/web/lib/navigation/legacy-redirects.ts`
- Create: `apps/web/lib/navigation/legacy-redirects.test.ts`

- [ ] **Step 1: Create redirect inventory**

Create `legacy-redirects.ts`:

```ts
export type LegacyRedirectRecord = {
  from: string;
  to: string;
  owner: "storefront" | "ops" | "platform-ai" | "platform-tools" | "platform-audit";
  status: "permanent-compat" | "temporary-compat";
};

export const LEGACY_REDIRECTS: LegacyRedirectRecord[] = [
  { from: "/admin/storefront", to: "/storefront", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/storefront/inbox", to: "/storefront/inbox", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/storefront/items", to: "/storefront/items", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/storefront/settings", to: "/storefront/settings", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/business-context", to: "/storefront/settings/business", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/operating-hours", to: "/storefront/settings/operations", owner: "storefront", status: "permanent-compat" },
  { from: "/admin/backlog", to: "/ops", owner: "ops", status: "permanent-compat" },
  { from: "/admin/prompts", to: "/platform/ai/prompts", owner: "platform-ai", status: "permanent-compat" },
  { from: "/admin/skills", to: "/platform/ai/skills", owner: "platform-ai", status: "permanent-compat" },
  { from: "/platform/integrations", to: "/platform/tools/catalog", owner: "platform-tools", status: "permanent-compat" },
  { from: "/platform/services", to: "/platform/tools/services", owner: "platform-tools", status: "permanent-compat" },
  { from: "/platform/ai/routing", to: "/platform/ai/providers", owner: "platform-ai", status: "permanent-compat" },
  { from: "/platform/ai/history", to: "/platform/audit/ledger", owner: "platform-audit", status: "permanent-compat" },
];
```

- [ ] **Step 2: Add structural tests**

Create `legacy-redirects.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { LEGACY_REDIRECTS } from "./legacy-redirects";

describe("legacy redirects", () => {
  it("has unique source paths", () => {
    const sources = LEGACY_REDIRECTS.map((redirect) => redirect.from);
    expect(new Set(sources).size).toBe(sources.length);
  });

  it("does not redirect a path to itself", () => {
    for (const redirect of LEGACY_REDIRECTS) {
      expect(redirect.from).not.toBe(redirect.to);
    }
  });

  it("keeps admin storefront redirects owned by storefront", () => {
    expect(
      LEGACY_REDIRECTS.filter((redirect) => redirect.from.startsWith("/admin/storefront"))
        .every((redirect) => redirect.owner === "storefront"),
    ).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/navigation/legacy-redirects.test.ts
```

Expected: pass.

- [ ] **Step 4: Commit**

Run:

```powershell
git add apps/web/lib/navigation/legacy-redirects.ts apps/web/lib/navigation/legacy-redirects.test.ts
git commit -s -m "test: document legacy navigation redirects"
```

---

### Task 6: Add Workspace Shell Context To Workspace-Home Resolution

**Files:**

- Modify: `apps/web/lib/workspace-home/types.ts`
- Modify: `apps/web/lib/workspace-home/registry.ts`
- Modify: `apps/web/app/(shell)/workspace/page.tsx`
- Modify: `apps/web/components/shell/AppRail.tsx`
- Test: `apps/web/lib/workspace-home/registry.test.ts`

- [ ] **Step 1: Add shell context tests**

In `apps/web/lib/workspace-home/registry.test.ts`, add:

```ts
it("returns platform operator shell context for platform fallback", () => {
  const resolution = resolveWorkspaceHomeContribution({
    archetypeId: null,
    archetypeCategory: null,
  });

  expect(resolution.shell.mode).toBe("platform-operator");
  expect(resolution.shell.primaryLabel).toBe("Workspace");
  expect(resolution.shell.showOperatorSwitch).toBe(false);
});

it("returns worker shell context for a resolved archetype contribution", () => {
  const resolution = resolveWorkspaceHomeContribution({
    archetypeId: "it-managed-services",
    archetypeCategory: "professional-services",
  });

  if (resolution.kind === "platform-fallback") {
    throw new Error("expected an archetype contribution fixture for it-managed-services");
  }

  expect(resolution.shell.mode).toBe("worker");
  expect(resolution.shell.primaryLabel.length).toBeGreaterThan(0);
  expect(resolution.shell.navGroups.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
```

Expected: fail because `shell` does not exist on resolution.

- [ ] **Step 3: Extend workspace-home types**

Add to `apps/web/lib/workspace-home/types.ts`:

```ts
export type WorkspaceShellMode = "worker" | "platform-operator";

export type WorkspaceNavItem = {
  key: string;
  label: string;
  href: string;
  description?: string;
};

export type WorkspaceNavGroup = {
  key: string;
  label: string;
  items: WorkspaceNavItem[];
};

export type WorkspaceShellContext = {
  mode: WorkspaceShellMode;
  primaryLabel: string;
  subtitle?: string;
  navGroups: WorkspaceNavGroup[];
  showOperatorSwitch: boolean;
};
```

Attach `shell: WorkspaceShellContext` to the existing resolution type rather than creating a parallel resolver union.

- [ ] **Step 4: Populate shell context in registry**

In `registry.ts`, add a platform fallback shell and a contribution shell. Use archetype labels from the contribution where available:

```ts
const PLATFORM_OPERATOR_SHELL: WorkspaceShellContext = {
  mode: "platform-operator",
  primaryLabel: "Workspace",
  subtitle: "Work, handoffs, and governed AI coworkers in one place",
  showOperatorSwitch: false,
  navGroups: [],
};
```

For resolved contributions, return:

```ts
shell: {
  mode: "worker",
  primaryLabel: contribution.displayName,
  subtitle: contribution.primaryOperatingQuestion,
  showOperatorSwitch: true,
  navGroups: contribution.navGroups ?? [],
}
```

If `displayName`, `primaryOperatingQuestion`, or `navGroups` are not yet in the contribution type, add them as optional fields and provide defaults.

- [ ] **Step 5: Run tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/workspace-home/registry.test.ts
pnpm --filter web typecheck
```

Expected: pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/web/lib/workspace-home apps/web/app/(shell)/workspace/page.tsx apps/web/components/shell/AppRail.tsx
git commit -s -m "feat: add workspace shell context for archetype navigation"
```

---

### Task 7: Live UX Verification

**Files:**

- Modify if needed: `tests/e2e/platform-qa-plan.md`
- Evidence only: record results through governed evidence path if available

- [ ] **Step 1: Run source-local checks**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/navigation/portal-navigation-model.test.ts apps/web/lib/navigation/legacy-redirects.test.ts apps/web/components/platform/PlatformTabNav.test.tsx apps/web/components/admin/AdminTabNav.test.tsx apps/web/components/finance/FinanceTabNav.test.tsx apps/web/lib/workspace-home/registry.test.ts
pnpm --filter web typecheck
```

Expected: all pass in the topic worktree.

- [ ] **Step 2: Rebuild and verify on Live portal**

Use the canonical runtime path from AGENTS. Rebuild and run the Docker-served Live portal from the integration substrate, not a random dev server:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Expected: `dpf-portal-1` healthy and `http://localhost:3000/api/health` returns 200.

- [ ] **Step 3: Drive desktop verification**

In the browser, log in at `http://localhost:3000/login` as `admin@dpf.local`, then verify:

- `/workspace` no longer says "Internal cockpit".
- `/workspace` setup CTA opens `/storefront/setup` when no worker home is configured.
- AppRail visible label for `/storefront` is "Customer Portal" or the chosen approved label.
- `/platform` family tabs do not include "Core Admin".
- `/admin` still appears in operator primary navigation for a superuser.
- `/storefront/settings` retains Dashboard, Sections, Items, Team, Inbox, Settings plus settings subnav.
- `/finance` still shows Finance family navigation once, not repeated by every page body.

- [ ] **Step 4: Drive mobile verification**

Use a mobile viewport and verify:

- AppRail/primary navigation remains usable without text overlap.
- Section tabs wrap or scroll without occluding page content.
- `/workspace`, `/storefront/settings`, `/platform`, and `/finance` remain navigable.

- [ ] **Step 5: Record verification summary**

Add a short verification note to the PR body or evidence system:

```md
Verification substrate: Live portal at http://localhost:3000.
Source-local tests: <command> -> pass.
Typecheck: <command> -> pass.
UX: drove /workspace, /storefront/settings, /platform, /admin, /finance on desktop and mobile. Observed no cockpit copy, no Core Admin Platform tab, setup CTA points to /storefront/setup, and section nav remains usable.
```

- [ ] **Step 6: Commit final docs/test updates**

Run:

```powershell
git add tests/e2e/platform-qa-plan.md docs/superpowers/specs/2026-06-05-portal-navigation-archetype-ia-design.md docs/superpowers/plans/2026-06-05-portal-navigation-archetype-ia.md
git commit -s -m "docs: plan portal navigation archetype IA rollout"
```

## Acceptance Checklist

- [ ] Navigation model tests pass.
- [ ] Legacy redirect inventory tests pass.
- [ ] Platform tabs no longer include Admin as a sibling.
- [ ] First-touch labels separate Workspace, Customer Portal, Customer Account, and Live portal concepts.
- [ ] Admin and Finance nav are layout-owned instead of repeated per page.
- [ ] Workspace-home resolution can return shell context for worker/operator modes.
- [ ] Source-local tests pass in the topic worktree.
- [ ] Typecheck passes in the topic worktree.
- [ ] Live portal UX verification is complete on desktop and mobile.
- [ ] Any unresolved route-retirement decisions are left as documented follow-up BIs, not hidden code changes.
