# Cockpit Terminology Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a render-time install terminology layer to the Cockpit and wire it into the overview plus Recent transmissions drill-down without changing GearInterface data contracts.

**Execution status:** Implemented and verified on `codex/cockpit-terminology-reframe`. Evidence is recorded in `docs/superpowers/decisions/2026-05-25-cockpit-terminology-reframe-signoff.md`.

**Architecture:** Keep GearInterface query APIs raw and canonical. Add a Cockpit-only terminology module that loads `StorefrontConfig`, `StorefrontArchetype`, `Organization`, and named coworker sources, then resolves display labels at render time. Refactor route-local formatting helpers out of `page.tsx` as the required 20% refactor allocation.

**Tech Stack:** Next.js 16 server component, Prisma through `@dpf/db`, Vitest, DPF CSS custom properties, existing `getVocabulary` and `resolveCoworkerIdentity` helpers.

---

### Task 1: Red Tests For Terminology Resolution

**Files:**
- Create: `apps/web/lib/cockpit/install-terminology.test.ts`
- Create later: `apps/web/lib/cockpit/install-terminology.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  buildCockpitTerminology,
  resolveCockpitRowLabels,
  type CockpitInstallContext,
} from "./install-terminology";

const configuredContext: CockpitInstallContext = {
  organization: { name: "Dale HVAC", industry: "trades-maintenance" },
  storefront: {
    archetype: {
      archetypeId: "facilities-maintenance",
      name: "Facilities Maintenance",
      category: "trades-maintenance",
      customVocabulary: {
        portalLabel: "Service Portal",
        teamLabel: "Crew",
        agentName: "Service Coordinator",
      },
    },
  },
  agents: [
    { agentId: "AGT-BUILD", slugId: "build-specialist", name: "Build Specialist" },
  ],
};

describe("buildCockpitTerminology", () => {
  it("uses configured install identity, portal vocabulary, and archetype labels", () => {
    const terminology = buildCockpitTerminology(configuredContext);

    expect(terminology.mode).toBe("install-aware");
    expect(terminology.installName).toBe("Dale HVAC");
    expect(terminology.portalLabel).toBe("Service Portal");
    expect(terminology.verticalLabel).toBe("Facilities Maintenance");
    expect(terminology.banner).toBeNull();
  });

  it("falls back honestly when StorefrontConfig is missing", () => {
    const terminology = buildCockpitTerminology({
      organization: { name: "Dale HVAC", industry: "trades-maintenance" },
      storefront: null,
      agents: [],
    });

    expect(terminology.mode).toBe("abstract");
    expect(terminology.banner?.message).toContain("Install identity not configured");
    expect(terminology.banner?.href).toBe("/storefront/setup");
    expect(terminology.missingContext).toContain("storefront-config");
  });
});

describe("resolveCockpitRowLabels", () => {
  it("resolves coworker, capability, archetype, and interface labels for a configured install", () => {
    const terminology = buildCockpitTerminology(configuredContext);
    const labels = resolveCockpitRowLabels(
      {
        innerRing: 1,
        outerRing: 2,
        transmissionDirection: "outward",
        agentIdForTriple: "AGT-BUILD",
        actorId: "AGT-BUILD",
        capabilityName: "code-review",
        archetypeContext: "facilities-maintenance",
        shaftSourceType: "phase-run",
        outcomeType: "transmission",
        slipDetected: false,
        slipReason: null,
      },
      terminology,
    );

    expect(labels.interfaceLabel).toBe("Ring 1->2 Crew -> Service Portal workflow");
    expect(labels.agentLabel).toBe("Build Specialist");
    expect(labels.actorLabel).toBe("Build Specialist");
    expect(labels.archetypeLabel).toBe("Facilities Maintenance");
    expect(labels.capabilityLabel).toBe("code-review work in Facilities Maintenance");
  });

  it("keeps unresolved coworker IDs visible without forcing abstract mode", () => {
    const terminology = buildCockpitTerminology(configuredContext);
    const labels = resolveCockpitRowLabels(
      {
        innerRing: 2,
        outerRing: 3,
        transmissionDirection: "outward",
        agentIdForTriple: "unknown-agent",
        actorId: "unknown-agent",
        capabilityName: "dispatch-routing",
        archetypeContext: "facilities-maintenance",
        shaftSourceType: "phase-run",
        outcomeType: "slip",
        slipDetected: true,
        slipReason: "archetype-unresolved",
      },
      terminology,
    );

    expect(labels.agentLabel).toBe("unknown-agent");
    expect(labels.agentResolution).toBe("unresolved");
    expect(labels.outcomeLabel).toBe("slip: archetype-unresolved");
  });
});
```

- [ ] **Step 2: Run the tests to verify RED**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
```

Expected: FAIL because `apps/web/lib/cockpit/install-terminology.ts` does not exist.

### Task 2: Implement Terminology Module

**Files:**
- Create: `apps/web/lib/cockpit/install-terminology.ts`
- Test: `apps/web/lib/cockpit/install-terminology.test.ts`

- [ ] **Step 1: Add minimal implementation**

Implement:

```ts
export type CockpitTerminologyMode = "install-aware" | "abstract";

export interface CockpitInstallContext {
  organization: { name: string | null; industry: string | null } | null;
  storefront: {
    archetype: {
      archetypeId: string;
      name: string;
      category: string;
      customVocabulary: Record<string, string> | null;
    } | null;
  } | null;
  agents: Array<{ agentId: string; slugId: string | null; name: string }>;
}
```

Use `getVocabulary(...)` for portal/team labels and `resolveCoworkerIdentity(...)` as registry fallback.

- [ ] **Step 2: Run GREEN**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
```

Expected: PASS.

### Task 3: Refactor Formatting Helpers

**Files:**
- Create: `apps/web/lib/cockpit/cockpit-formatting.ts`
- Modify: `apps/web/app/(shell)/admin/cockpit/page.tsx`

- [ ] **Step 1: Extract pure helpers**

Move `formatTorque`, `formatPercent`, `formatCost`, `torqueColor`, `findReadings`, and `summarizeInterface` to `apps/web/lib/cockpit/cockpit-formatting.ts`.

- [ ] **Step 2: Re-run terminology tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
```

Expected: PASS.

### Task 4: Wire Cockpit Overview

**Files:**
- Modify: `apps/web/app/(shell)/admin/cockpit/page.tsx`
- Modify: `apps/web/lib/cockpit/install-terminology.ts`

- [ ] **Step 1: Load terminology in page**

Add `getCockpitTerminology()` to the existing parallel fetch set and render the fallback banner when `terminology.banner` is present.

- [ ] **Step 2: Replace overview labels**

Replace hardcoded interface labels with `getInterfaceDisplayLabel(innerRing, outerRing, terminology)` or equivalent. Keep canonical `Ring N->M` visible.

- [ ] **Step 3: Run focused test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
```

Expected: PASS.

### Task 5: Wire Recent Transmissions Drill-Down

**Files:**
- Modify: `apps/web/app/(shell)/admin/cockpit/page.tsx`

- [ ] **Step 1: Resolve row labels**

For each `recentRows` row, call `resolveCockpitRowLabels(row, terminology)` and display the resolved interface, capability, actor, and outcome labels. Preserve raw source IDs in `title` attributes or secondary muted text.

- [ ] **Step 2: Run focused test**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
```

Expected: PASS.

### Task 6: Sign-Off ADR And Verification

**Files:**
- Create: `docs/superpowers/adrs/2026-05-25-cockpit-terminology-reframe-signoff.md`

- [ ] **Step 1: Run gates**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/cockpit/install-terminology.test.ts
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: all pass.

- [ ] **Step 2: UX verification**

Drive Docker-served `/admin/cockpit` on a configured install and a fallback install path. Capture desktop/mobile overview and recent-transmissions screenshots, and record evidence on BI-19D40BE7.

- [ ] **Step 3: Commit and push**

Run:

```powershell
git status --short
git add "docs/superpowers/specs/2026-05-25-cockpit-terminology-reframe-design.md" "docs/superpowers/plans/2026-05-25-cockpit-terminology-reframe.md" "docs/superpowers/adrs/2026-05-25-cockpit-terminology-reframe-signoff.md" "apps/web/lib/cockpit" "apps/web/app/(shell)/admin/cockpit/page.tsx"
git commit -s -m "feat: reframe cockpit terminology by install context"
git push
```

Expected: pushed branch `codex/cockpit-terminology-reframe`.
