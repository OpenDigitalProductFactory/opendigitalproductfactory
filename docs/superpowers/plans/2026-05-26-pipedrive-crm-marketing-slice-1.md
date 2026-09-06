---
status: superseded
supersededBy: docs/superpowers/audits/2026-06-06-customer-crm-marketing-ux-reconciliation.md
---

# Pipedrive CRM Marketing Slice 1 Implementation Plan

> **For agentic workers:** This is a historical plan. Do not execute unchecked boxes directly. For remaining CRM/marketing work, use the DPF-native path: one backlog item, one branch, one PR; run `dpf-ux-fit-review` before UI changes, use `dpf-tdd` for implementation, run the local merge/pregate checks that the workroom impact contract requires, and use `dpf-pr-with-dco` for handoff.

> **2026-06-06 reconciliation status:** Do not execute this plan task-by-task from the unchecked boxes below. `origin/main` already contains the Slice 1 substrate and follow-on customer CRM/marketing surfaces: CRM presentation metadata, `RevenueCockpit`, `CustomerMetricTile`, `CustomerStatusBadge`, pipeline inspector, acquisition signal routing, real marketing Campaigns/Funnel/Automation subroutes, and guided coworker launch boundaries. The current reconciliation artifact is `docs/superpowers/audits/2026-06-06-customer-crm-marketing-ux-reconciliation.md`. Remaining product work is tracked as `BI-D8E00326` (CRM marketing Slice 5: agentic sales and marketing operations).

**Goal:** Build the first Pipedrive-inspired CRM and marketing operations slice: a scan-first revenue cockpit on `/customer`, theme-aware CRM presentation metadata, shared summary components, and a cleaned marketing tab nav with no phase-locked placeholders.

**Architecture:** Keep the first slice on existing CRM and marketing models. Extract pure CRM presentation and summary logic into small tested modules, render reusable customer summary components from server pages, and hide marketing subroutes until real read-only routes are implemented in a later slice. Do not add database tables or external integration writes in this slice.

**Tech Stack:** Next.js 16 App Router, React server components, TypeScript, Prisma, pnpm workspaces, Vitest, DPF CSS custom properties.

---

## Scope

This plan implements Slice 1 from `docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`.

It must also respect the binding UX-governance rules in `docs/superpowers/specs/2026-04-25-customer-marketing-coworker-led-ux-correction.md`: no card-as-send-button, no surprise prompts to the coworker. Slice 1 only adds navigation links and metric tiles to `/customer`; coworker-launching surfaces stay inside `AgentWorkLauncher` and are out of scope here.

It must also pass `dpf-ux-fit-review` before code edits. The feature belongs to Business > Customer and must not add global AppRail entries, Workspace cards, Platform nav entries, or vendor-branded user-facing language. "Pipedrive-inspired" is research language only; visible product copy should use DPF-native labels such as "Today in revenue", "Pipeline", "Engagements", "Quotes", "Orders", and "Marketing".

PR strategy: Slice 1 was theme-aware refactor + dead-code removal + shared-helper extraction. It qualified as a Claude-led maintenance PR per the `feedback_no_manual_prs` rule and did NOT need to flow through Build Studio. Follow-on feature slices are no longer represented by this historical checklist; use current backlog state and `BI-D8E00326` for Slice 5.

Included:

- central CRM stage/status presentation metadata
- shared customer metric tile and status badge components
- pure revenue cockpit summary helper
- `/customer` "Today in revenue" band using existing data
- cleanup of hardcoded CRM status/stage colors on touched pages
- removal of visible "Phase 2" / "Phase 3" marketing tabs
- focused unit/component tests

Historical exclusions at Slice 1 start:

- new Prisma models
- drag-and-drop opportunity movement
- signal-to-engagement creation
- external publish/send/schedule actions
- real `/customer/marketing/campaigns`, `/customer/marketing/funnel`, or `/customer/marketing/automation` routes, which have since landed
- PR creation before verification

Implementation must happen in a new git worktree branched from `origin/main` (see Task 0). The doc branch `doc/pipedrive-crm-marketing` remains the research and planning branch.

Files originally left as known refactor debt after Slice 1 (now reconciled on `origin/main`):

- `apps/web/app/(shell)/customer/(crm)/[id]/page.tsx` — STATUS_COLOURS
- `apps/web/app/(shell)/customer/(crm)/quotes/page.tsx` — STATUS_COLOURS
- `apps/web/app/(shell)/customer/(crm)/sales-orders/page.tsx` — STATUS_COLOURS

These three now consume shared Customer CRM status presentation via `CustomerStatusBadge` and `apps/web/lib/crm/presentation.ts`.

## File Structure

Create:

- `apps/web/lib/crm/presentation.ts`
  - owns CRM stage/status labels, semantic tone metadata, open opportunity stages, and small formatting helpers
- `apps/web/lib/crm/presentation.test.ts`
  - verifies labels, fallback behavior, open-stage detection, and absence of raw hex values
- `apps/web/lib/crm/revenue-cockpit.ts`
  - owns pure summary math for `/customer` cockpit metrics and attention items
- `apps/web/lib/crm/revenue-cockpit.test.ts`
  - verifies pipeline value, active quote/order counts, stale opportunity attention, and marketing work-product attention
- `apps/web/components/customer/CustomerMetricTile.tsx`
  - reusable theme-aware metric link/card
- `apps/web/components/customer/CustomerMetricTile.test.tsx`
  - static markup tests for link rendering and theme classes
- `apps/web/components/customer/CustomerStatusBadge.tsx`
  - reusable theme-aware status badge
- `apps/web/components/customer/CustomerStatusBadge.test.tsx`
  - static markup tests for badge labels and tone classes
- `apps/web/components/customer/RevenueCockpit.tsx`
  - render component for the scan-first "Today in revenue" band
- `apps/web/components/customer/RevenueCockpit.test.tsx`
  - static markup tests for attention items and empty state
- `apps/web/components/customer-marketing/MarketingTabNav.test.tsx`
  - tests that only real marketing tabs are visible

Modify:

- `apps/web/app/(shell)/customer/(crm)/page.tsx`
  - use revenue cockpit helper/components
  - remove hardcoded colors and inline status styles
- `apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx`
  - use shared stage metadata and status badge
  - replace hardcoded red/green/dormant classes with theme-aware tones
- `apps/web/app/(shell)/customer/(crm)/engagements/page.tsx`
  - use shared status badge and source labels
  - remove hardcoded status colors
- `apps/web/app/(shell)/customer/(crm)/funnel/page.tsx`
  - use shared stage metadata and DPF CSS variables for touched funnel/status cards
- `apps/web/components/customer-marketing/MarketingTabNav.tsx`
  - remove disabled placeholder tabs until their routes have meaningful content

## Task 0: Create Worktree from `origin/main` and Verify Base

**Files:** none modified — environment setup only.

- [ ] **Step 1: Fetch latest origin and create the worktree**

Run:

```powershell
git fetch origin
git worktree add -b feat/pipedrive-crm-marketing-slice-1 ../DPF-pipedrive-crm-marketing-slice-1 origin/main
```

Expected: a fresh worktree at `../DPF-pipedrive-crm-marketing-slice-1` on a new branch pointed at `origin/main`. Per the kernel principle `worktree-base-origin-main`, never branch from local `main` — it may carry unpushed commits that sweep into the PR and fail DCO.

- [ ] **Step 2: Seed worktree MCP and IDE config**

Run the project sync script from the root clone after the worktree is created:

```powershell
.\scripts\sync-mcp-worktrees.ps1
```

Expected: `.mcp.json` and `.vscode/mcp.json` are hardlinked or copied into the new worktree, and the worktree receives its own ignored Compose project configuration so stacks do not collide with sibling sessions.

- [ ] **Step 3: Run `dpf-ux-fit-review`**

Before writing code, run the DPF UX fit review skill and record the answers in the implementation notes or PR body:

```text
Owning area: Business > Customer
Primary route family: /customer and /customer/marketing
Primary persona: founder/operator managing customer acquisition and revenue attention
Navigation layer touched: Customer section nav plus local page links only
Routes that must not be created/promoted: global AppRail, Workspace, Platform, /portal, /storefront
Existing component/pattern search: KPI/stat/status/badge components under apps/web/components and apps/web/app
New component justification: only if Customer-specific components converge repeated CRM semantics
Source truth: existing CRM and marketing models plus pure read helpers
Empty/failure state: calm setup/next-action state, no wall of zeros
AI boundary: metric/card/tab clicks navigate or select only; no coworker prompt send
Evidence: route tests, theme scans, desktop/mobile route exercise
```

Run a component convergence search before creating `CustomerMetricTile` and `CustomerStatusBadge`:

```powershell
rg -n "MetricTile|StatusBadge|Kpi|KPI|Stat|Badge" apps/web/components apps/web/app
```

Expected: record whether existing components can be reused/wrapped or why the new Customer components become the canonical Customer CRM primitives. Do not create a parallel component family without documenting the convergence path.

- [ ] **Step 4: Sweep for concurrent work on the same surface**

Before any edits, check whether another session has open work on `apps/web/app/(shell)/customer` or `apps/web/components/customer`:

```powershell
gh pr list --state open --search "customer marketing OR crm OR pipeline" --limit 20
git log origin/main --oneline -n 30 -- 'apps/web/app/(shell)/customer' apps/web/components/customer apps/web/components/customer-marketing
```

Expected: no concurrent PR touches `apps/web/components/customer/CustomerMetricTile.tsx`, `apps/web/lib/crm/presentation.ts`, `apps/web/components/customer-marketing/MarketingTabNav.tsx`, or the four `(crm)` pages this plan modifies. If overlap is found, pause and reconcile per the `propose-acknowledge-reassign` kernel principle before proceeding.

- [ ] **Step 5: Verify Node, pnpm, Prisma client are aligned**

Run:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @dpf/db exec prisma generate
```

Expected: install succeeds; Prisma client regenerates so the new `apps/web/lib/crm/*` modules see `MarketingCampaignBrief`, `MarketingAssetTask`, and `MarketingAutomationCandidate` types.

## Task 1: Create CRM Presentation Metadata

**Files:**

- Create: `apps/web/lib/crm/presentation.ts`
- Create: `apps/web/lib/crm/presentation.test.ts`

- [ ] **Step 1: Write the failing presentation tests**

Create `apps/web/lib/crm/presentation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CRM_TONE_CLASSES,
  formatCrmStatusLabel,
  getAccountStatusMeta,
  getEngagementStatusMeta,
  getOpportunityStageMeta,
  isOpenOpportunityStage,
  OPEN_OPPORTUNITY_STAGES,
} from "./presentation";

describe("CRM presentation metadata", () => {
  it("defines open opportunity stages in buyer-progress order", () => {
    expect(OPEN_OPPORTUNITY_STAGES).toEqual([
      "qualification",
      "discovery",
      "proposal",
      "negotiation",
    ]);
  });

  it("identifies only active pipeline stages as open", () => {
    expect(isOpenOpportunityStage("qualification")).toBe(true);
    expect(isOpenOpportunityStage("closed_won")).toBe(false);
    expect(isOpenOpportunityStage("unknown")).toBe(false);
  });

  it("formats CRM status values for display", () => {
    expect(formatCrmStatusLabel("closed_won")).toBe("Closed won");
    expect(formatCrmStatusLabel("in_progress")).toBe("In progress");
    expect(formatCrmStatusLabel("new")).toBe("New");
  });

  it("returns specific metadata for known statuses and fallback metadata otherwise", () => {
    expect(getAccountStatusMeta("active")).toMatchObject({
      label: "Active",
      tone: "success",
    });
    expect(getEngagementStatusMeta("converted")).toMatchObject({
      label: "Converted",
      tone: "accent",
    });
    expect(getOpportunityStageMeta("proposal")).toMatchObject({
      label: "Proposal",
      tone: "info",
    });
    expect(getOpportunityStageMeta("custom_stage")).toMatchObject({
      label: "Custom stage",
      tone: "neutral",
    });
  });

  it("uses theme-aware classes instead of raw hex colors", () => {
    const serialized = JSON.stringify(CRM_TONE_CLASSES);
    expect(serialized).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(serialized).toContain("var(--dpf-");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/presentation.test.ts
```

Expected: FAIL because `apps/web/lib/crm/presentation.ts` does not exist.

- [ ] **Step 3: Implement the presentation module**

Create `apps/web/lib/crm/presentation.ts`:

```ts
export const OPEN_OPPORTUNITY_STAGES = [
  "qualification",
  "discovery",
  "proposal",
  "negotiation",
] as const;

export type OpenOpportunityStage = typeof OPEN_OPPORTUNITY_STAGES[number];

export type CrmTone =
  | "accent"
  | "attention"
  | "danger"
  | "info"
  | "neutral"
  | "success"
  | "warning";

export type CrmPresentationMeta = {
  label: string;
  tone: CrmTone;
};

export const CRM_TONE_CLASSES: Record<CrmTone, {
  border: string;
  badge: string;
  text: string;
  surface: string;
}> = {
  accent: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]",
    text: "text-[var(--dpf-accent)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  attention: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  danger: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  info: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  neutral: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
    text: "text-[var(--dpf-muted)]",
    surface: "bg-[var(--dpf-surface-1)]",
  },
  success: {
    border: "border-[var(--dpf-accent)]",
    badge: "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
  warning: {
    border: "border-[var(--dpf-border)]",
    badge: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]",
    text: "text-[var(--dpf-text)]",
    surface: "bg-[var(--dpf-surface-2)]",
  },
};

const ACCOUNT_STATUS_META: Record<string, CrmPresentationMeta> = {
  prospect: { label: "Prospect", tone: "warning" },
  qualified: { label: "Qualified", tone: "attention" },
  onboarding: { label: "Onboarding", tone: "info" },
  active: { label: "Active", tone: "success" },
  at_risk: { label: "At risk", tone: "danger" },
  suspended: { label: "Suspended", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
};

const ENGAGEMENT_STATUS_META: Record<string, CrmPresentationMeta> = {
  new: { label: "New", tone: "warning" },
  contacted: { label: "Contacted", tone: "info" },
  qualified: { label: "Qualified", tone: "success" },
  unqualified: { label: "Unqualified", tone: "neutral" },
  converted: { label: "Converted", tone: "accent" },
};

const OPPORTUNITY_STAGE_META: Record<string, CrmPresentationMeta> = {
  qualification: { label: "Qualification", tone: "warning" },
  discovery: { label: "Discovery", tone: "attention" },
  proposal: { label: "Proposal", tone: "info" },
  negotiation: { label: "Negotiation", tone: "accent" },
  closed_won: { label: "Won", tone: "success" },
  closed_lost: { label: "Lost", tone: "danger" },
};

export function formatCrmStatusLabel(value: string): string {
  const normalized = value.replace(/[_-]+/g, " ").trim();
  if (!normalized) {
    return "Unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function fallbackMeta(value: string): CrmPresentationMeta {
  return {
    label: formatCrmStatusLabel(value),
    tone: "neutral",
  };
}

export function getAccountStatusMeta(status: string): CrmPresentationMeta {
  return ACCOUNT_STATUS_META[status] ?? fallbackMeta(status);
}

export function getEngagementStatusMeta(status: string): CrmPresentationMeta {
  return ENGAGEMENT_STATUS_META[status] ?? fallbackMeta(status);
}

export function getOpportunityStageMeta(stage: string): CrmPresentationMeta {
  return OPPORTUNITY_STAGE_META[stage] ?? fallbackMeta(stage);
}

export function isOpenOpportunityStage(stage: string): stage is OpenOpportunityStage {
  return OPEN_OPPORTUNITY_STAGES.includes(stage as OpenOpportunityStage);
}
```

- [ ] **Step 4: Run the presentation test to verify it passes**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/presentation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add apps/web/lib/crm/presentation.ts apps/web/lib/crm/presentation.test.ts
git commit -s -m "feat(crm): add theme-aware presentation metadata"
```

## Task 2: Add Revenue Cockpit Summary Logic

**Files:**

- Create: `apps/web/lib/crm/revenue-cockpit.ts`
- Create: `apps/web/lib/crm/revenue-cockpit.test.ts`

- [ ] **Step 1: Write the failing summary tests**

Create `apps/web/lib/crm/revenue-cockpit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRevenueCockpitSummary, formatRevenueAmount } from "./revenue-cockpit";

describe("revenue cockpit summary", () => {
  it("formats revenue in GBP by default (matches Opportunity.currency default)", () => {
    expect(formatRevenueAmount(12500)).toBe("£12,500");
  });

  it("respects a passed currency code", () => {
    expect(formatRevenueAmount(12500, "USD")).toBe("$12,500");
    expect(formatRevenueAmount(12500, "EUR")).toBe("€12,500");
  });

  it("summarizes pipeline, engagements, quotes, and active orders", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [
        { status: "new", count: 3 },
        { status: "contacted", count: 2 },
      ],
      opportunityCounts: [
        { stage: "qualification", count: 2, expectedValue: 1000 },
        { stage: "proposal", count: 1, expectedValue: 5000 },
        { stage: "closed_won", count: 1, expectedValue: 7500 },
      ],
      quoteCounts: [
        { status: "draft", count: 2 },
        { status: "sent", count: 1 },
      ],
      orderCounts: [
        { status: "confirmed", count: 1 },
        { status: "in_progress", count: 2 },
        { status: "fulfilled", count: 5 },
      ],
      staleOpportunityCount: 0,
      marketingWork: {
        campaignBriefsOpen: 0,
        assetTasksOpen: 0,
        automationCandidatesOpen: 0,
      },
    });

    expect(summary.metrics).toEqual([
      {
        id: "engagements",
        label: "Engagements",
        value: "5",
        detail: "3 new",
        href: "/customer/engagements",
        tone: "attention",
      },
      {
        id: "pipeline",
        label: "Pipeline",
        value: "3",
        detail: "£6,000 open",
        href: "/customer/opportunities",
        tone: "accent",
      },
      {
        id: "quotes",
        label: "Quotes",
        value: "3",
        detail: "1 sent",
        href: "/customer/quotes",
        tone: "info",
      },
      {
        id: "orders",
        label: "Orders",
        value: "3",
        detail: "active",
        href: "/customer/sales-orders",
        tone: "success",
      },
    ]);
    expect(summary.attentionItems).toEqual([]);
  });

  it("surfaces stale opportunities and marketing work as attention items", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 2,
      marketingWork: {
        campaignBriefsOpen: 1,
        assetTasksOpen: 3,
        automationCandidatesOpen: 1,
      },
    });

    expect(summary.attentionItems).toEqual([
      {
        id: "stale-opportunities",
        label: "2 stale opportunities need a next action",
        href: "/customer/opportunities",
        tone: "warning",
      },
      {
        id: "marketing-work",
        label: "5 marketing work products are waiting",
        href: "/customer/marketing",
        tone: "accent",
      },
    ]);
  });

  it("uses singular phrasing for a single stale opportunity and a single waiting work product", () => {
    const summary = buildRevenueCockpitSummary({
      engagementCounts: [],
      opportunityCounts: [],
      quoteCounts: [],
      orderCounts: [],
      staleOpportunityCount: 1,
      marketingWork: {
        campaignBriefsOpen: 1,
        assetTasksOpen: 0,
        automationCandidatesOpen: 0,
      },
    });

    expect(summary.attentionItems).toEqual([
      {
        id: "stale-opportunities",
        label: "1 stale opportunity needs a next action",
        href: "/customer/opportunities",
        tone: "warning",
      },
      {
        id: "marketing-work",
        label: "1 marketing work product is waiting",
        href: "/customer/marketing",
        tone: "accent",
      },
    ]);
  });
});
```

- [ ] **Step 2: Run the summary test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/revenue-cockpit.test.ts
```

Expected: FAIL because `apps/web/lib/crm/revenue-cockpit.ts` does not exist.

- [ ] **Step 3: Implement the revenue cockpit helper**

Create `apps/web/lib/crm/revenue-cockpit.ts`:

```ts
import type { CrmTone } from "./presentation";
import { isOpenOpportunityStage } from "./presentation";

export type CountByStatus = {
  status: string;
  count: number;
};

export type CountByStage = {
  stage: string;
  count: number;
  expectedValue: number;
};

export type RevenueCockpitMetric = {
  id: string;
  label: string;
  value: string;
  detail: string;
  href: string;
  tone: CrmTone;
};

export type RevenueCockpitAttentionItem = {
  id: string;
  label: string;
  href: string;
  tone: CrmTone;
};

export type RevenueCockpitSummary = {
  metrics: RevenueCockpitMetric[];
  attentionItems: RevenueCockpitAttentionItem[];
};

export type RevenueCockpitInput = {
  engagementCounts: CountByStatus[];
  opportunityCounts: CountByStage[];
  quoteCounts: CountByStatus[];
  orderCounts: CountByStatus[];
  staleOpportunityCount: number;
  marketingWork: {
    campaignBriefsOpen: number;
    assetTasksOpen: number;
    automationCandidatesOpen: number;
  };
};

// Default currency mirrors Opportunity.currency / Quote.priceCurrency Prisma
// defaults ("GBP"). Multi-currency aggregation is out of scope for Slice 1;
// callers that touch a different currency must pass it explicitly.
export function formatRevenueAmount(value: number, currency: string = "GBP"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function countWhere(items: CountByStatus[], statuses: string[]): number {
  return items
    .filter((item) => statuses.includes(item.status))
    .reduce((sum, item) => sum + item.count, 0);
}

export function buildRevenueCockpitSummary(input: RevenueCockpitInput): RevenueCockpitSummary {
  const engagementTotal = input.engagementCounts.reduce((sum, item) => sum + item.count, 0);
  const newEngagements = countWhere(input.engagementCounts, ["new"]);
  const openOpportunities = input.opportunityCounts.filter((item) => isOpenOpportunityStage(item.stage));
  const pipelineCount = openOpportunities.reduce((sum, item) => sum + item.count, 0);
  const pipelineValue = openOpportunities.reduce((sum, item) => sum + item.expectedValue, 0);
  const quoteCount = countWhere(input.quoteCounts, ["draft", "sent"]);
  const sentQuotes = countWhere(input.quoteCounts, ["sent"]);
  const activeOrders = countWhere(input.orderCounts, ["confirmed", "in_progress"]);
  const marketingWorkCount =
    input.marketingWork.campaignBriefsOpen +
    input.marketingWork.assetTasksOpen +
    input.marketingWork.automationCandidatesOpen;

  const attentionItems: RevenueCockpitAttentionItem[] = [];

  if (input.staleOpportunityCount > 0) {
    attentionItems.push({
      id: "stale-opportunities",
      label: `${input.staleOpportunityCount} stale opportunit${input.staleOpportunityCount === 1 ? "y needs" : "ies need"} a next action`,
      href: "/customer/opportunities",
      tone: "warning",
    });
  }

  if (marketingWorkCount > 0) {
    attentionItems.push({
      id: "marketing-work",
      label: `${marketingWorkCount} marketing work product${marketingWorkCount === 1 ? " is" : "s are"} waiting`,
      href: "/customer/marketing",
      tone: "accent",
    });
  }

  return {
    metrics: [
      {
        id: "engagements",
        label: "Engagements",
        value: String(engagementTotal),
        detail: `${newEngagements} new`,
        href: "/customer/engagements",
        tone: "attention",
      },
      {
        id: "pipeline",
        label: "Pipeline",
        value: String(pipelineCount),
        detail: `${formatRevenueAmount(pipelineValue)} open`,
        href: "/customer/opportunities",
        tone: "accent",
      },
      {
        id: "quotes",
        label: "Quotes",
        value: String(quoteCount),
        detail: `${sentQuotes} sent`,
        href: "/customer/quotes",
        tone: "info",
      },
      {
        id: "orders",
        label: "Orders",
        value: String(activeOrders),
        detail: "active",
        href: "/customer/sales-orders",
        tone: "success",
      },
    ],
    attentionItems,
  };
}
```

- [ ] **Step 4: Run the revenue cockpit test to verify it passes**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/revenue-cockpit.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add apps/web/lib/crm/revenue-cockpit.ts apps/web/lib/crm/revenue-cockpit.test.ts
git commit -s -m "feat(crm): add revenue cockpit summary helper"
```

## Task 3: Create Shared Customer UI Components

**Files:**

- Create: `apps/web/components/customer/CustomerMetricTile.tsx`
- Create: `apps/web/components/customer/CustomerMetricTile.test.tsx`
- Create: `apps/web/components/customer/CustomerStatusBadge.tsx`
- Create: `apps/web/components/customer/CustomerStatusBadge.test.tsx`
- Create: `apps/web/components/customer/RevenueCockpit.tsx`
- Create: `apps/web/components/customer/RevenueCockpit.test.tsx`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/components/customer/CustomerMetricTile.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerMetricTile } from "./CustomerMetricTile";

describe("CustomerMetricTile", () => {
  it("renders a linked metric with DPF theme classes", () => {
    const html = renderToStaticMarkup(
      <CustomerMetricTile
        href="/customer/opportunities"
        label="Pipeline"
        value="3"
        detail="£6,000 open"
        tone="accent"
      />,
    );

    expect(html).toContain('href="/customer/opportunities"');
    expect(html).toContain(">Pipeline<");
    expect(html).toContain(">3<");
    expect(html).toContain("£6,000 open");
    expect(html).toContain("border-[var(--dpf-accent)]");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
```

Create `apps/web/components/customer/CustomerStatusBadge.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerStatusBadge } from "./CustomerStatusBadge";

describe("CustomerStatusBadge", () => {
  it("renders the label and theme-aware tone classes", () => {
    const html = renderToStaticMarkup(
      <CustomerStatusBadge label="Dormant" tone="warning" />,
    );

    expect(html).toContain(">Dormant<");
    expect(html).toContain("border-[var(--dpf-border)]");
    expect(html).toContain("text-[var(--dpf-text)]");
    expect(html).not.toMatch(/#[0-9a-f]{3,6}/i);
  });
});
```

Create `apps/web/components/customer/RevenueCockpit.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RevenueCockpit } from "./RevenueCockpit";

describe("RevenueCockpit", () => {
  it("renders metrics and attention items", () => {
    const html = renderToStaticMarkup(
      <RevenueCockpit
        summary={{
          metrics: [
            {
              id: "pipeline",
              label: "Pipeline",
              value: "3",
              detail: "£6,000 open",
              href: "/customer/opportunities",
              tone: "accent",
            },
          ],
          attentionItems: [
            {
              id: "stale-opportunities",
              label: "2 stale opportunities need a next action",
              href: "/customer/opportunities",
              tone: "warning",
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Today in revenue");
    expect(html).toContain("Pipeline");
    expect(html).toContain("2 stale opportunities need a next action");
    expect(html).toContain('href="/customer/opportunities"');
  });

  it("renders a calm empty attention state", () => {
    const html = renderToStaticMarkup(
      <RevenueCockpit
        summary={{
          metrics: [],
          attentionItems: [],
        }}
      />,
    );

    expect(html).toContain("No urgent revenue actions right now.");
  });
});
```

- [ ] **Step 2: Run the component tests to verify they fail**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement `CustomerMetricTile`**

Create `apps/web/components/customer/CustomerMetricTile.tsx`:

```tsx
import Link from "next/link";
import type { CrmTone } from "@/lib/crm/presentation";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";

type CustomerMetricTileProps = {
  href: string;
  label: string;
  value: string;
  detail: string;
  tone: CrmTone;
};

export function CustomerMetricTile({
  href,
  label,
  value,
  detail,
  tone,
}: CustomerMetricTileProps) {
  const toneClasses = CRM_TONE_CLASSES[tone];

  return (
    <Link
      href={href}
      className={[
        "block rounded-lg border-l-2 bg-[var(--dpf-surface-1)] p-3 transition-colors hover:bg-[var(--dpf-surface-2)]",
        toneClasses.border,
      ].join(" ")}
    >
      <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
        {label}
      </p>
      <p className="mt-1 text-lg font-bold text-[var(--dpf-text)]">{value}</p>
      <p className={["mt-1 text-[10px]", toneClasses.text].join(" ")}>
        {detail}
      </p>
    </Link>
  );
}
```

- [ ] **Step 4: Implement `CustomerStatusBadge`**

Create `apps/web/components/customer/CustomerStatusBadge.tsx`:

```tsx
import type { CrmTone } from "@/lib/crm/presentation";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";

type CustomerStatusBadgeProps = {
  label: string;
  tone: CrmTone;
  className?: string;
};

export function CustomerStatusBadge({
  label,
  tone,
  className = "",
}: CustomerStatusBadgeProps) {
  return (
    <span
      className={[
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[9px]",
        CRM_TONE_CLASSES[tone].badge,
        className,
      ].filter(Boolean).join(" ")}
    >
      {label}
    </span>
  );
}
```

- [ ] **Step 5: Implement `RevenueCockpit`**

Create `apps/web/components/customer/RevenueCockpit.tsx`:

```tsx
import Link from "next/link";
import type { RevenueCockpitSummary } from "@/lib/crm/revenue-cockpit";
import { CRM_TONE_CLASSES } from "@/lib/crm/presentation";
import { CustomerMetricTile } from "./CustomerMetricTile";

type RevenueCockpitProps = {
  summary: RevenueCockpitSummary;
};

export function RevenueCockpit({ summary }: RevenueCockpitProps) {
  return (
    <section className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
            Today in revenue
          </p>
          <h2 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">
            Pipeline, signals, and work that need attention
          </h2>
        </div>
        <Link
          href="/customer/marketing"
          className="text-xs font-medium text-[var(--dpf-accent)] hover:underline"
        >
          Open marketing workspace
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summary.metrics.map((metric) => (
          <CustomerMetricTile
            key={metric.id}
            href={metric.href}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            tone={metric.tone}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {summary.attentionItems.length > 0 ? (
          summary.attentionItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className={[
                "rounded-full border px-3 py-1.5 text-xs transition-colors hover:bg-[var(--dpf-surface-2)]",
                CRM_TONE_CLASSES[item.tone].badge,
              ].join(" ")}
            >
              {item.label}
            </Link>
          ))
        ) : (
          <p className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1.5 text-xs text-[var(--dpf-muted)]">
            No urgent revenue actions right now.
          </p>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Run component tests to verify they pass**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add apps/web/components/customer/CustomerMetricTile.tsx apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.tsx apps/web/components/customer/RevenueCockpit.test.tsx
git commit -s -m "feat(customer): add revenue cockpit components"
```

## Task 4: Wire the Cockpit into `/customer`

**Files:**

- Modify: `apps/web/app/(shell)/customer/(crm)/page.tsx`

- [ ] **Step 1: Replace local summary/color logic with shared helpers**

Modify imports:

```tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { NewCustomerButton } from "@/components/customer/NewCustomerButton";
import { RevenueCockpit } from "@/components/customer/RevenueCockpit";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { buildRevenueCockpitSummary } from "@/lib/crm/revenue-cockpit";
import { getAccountStatusMeta } from "@/lib/crm/presentation";
```

Remove the local `STATUS_COLOURS` object.

- [ ] **Step 2: Expand the page query for cockpit attention items**

Replace the `Promise.all` tuple with:

```tsx
  const [
    accounts,
    engagementCounts,
    opportunityCounts,
    quoteCounts,
    orderCounts,
    staleOpportunityCount,
    campaignBriefsOpen,
    assetTasksOpen,
    automationCandidatesOpen,
  ] = await Promise.all([
    prisma.customerAccount.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        accountId: true,
        name: true,
        status: true,
        industry: true,
        _count: { select: { contacts: true, opportunities: true } },
      },
    }),
    prisma.engagement.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.opportunity.groupBy({
      by: ["stage"],
      _count: true,
      _sum: { expectedValue: true },
    }),
    prisma.quote.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.salesOrder.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.opportunity.count({
      where: {
        isDormant: true,
        stage: { in: ["qualification", "discovery", "proposal", "negotiation"] },
      },
    }),
    // Marketing models currently only ever write the default status "draft"
    // (see createMarketingCampaignBrief / createMarketingAssetTask /
    // createMarketingAutomationCandidate in apps/web/lib/marketing.ts).
    // No lifecycle transitions exist yet, so "open" == "draft" for Slice 1.
    // Expand the status filter when a real lifecycle ships.
    prisma.marketingCampaignBrief.count({
      where: { status: "draft" },
    }),
    prisma.marketingAssetTask.count({
      where: { status: "draft" },
    }),
    prisma.marketingAutomationCandidate.count({
      where: { status: "draft" },
    }),
  ]);
```

- [ ] **Step 3: Build the cockpit summary**

Replace the local `summaryCards` construction with:

```tsx
  const revenueSummary = buildRevenueCockpitSummary({
    engagementCounts: engagementCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    opportunityCounts: opportunityCounts.map((item) => ({
      stage: item.stage,
      count: item._count,
      expectedValue: Number(item._sum.expectedValue ?? 0),
    })),
    quoteCounts: quoteCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    orderCounts: orderCounts.map((item) => ({
      status: item.status,
      count: item._count,
    })),
    staleOpportunityCount,
    marketingWork: {
      campaignBriefsOpen,
      assetTasksOpen,
      automationCandidatesOpen,
    },
  });
```

- [ ] **Step 4: Render `RevenueCockpit` above the account list**

Replace the old summary card grid with:

```tsx
      <RevenueCockpit summary={revenueSummary} />
```

- [ ] **Step 5: Replace account status inline styles**

Inside the account map, replace status color logic with:

```tsx
          const statusMeta = getAccountStatusMeta(a.status);
```

Replace the account link class and badge with:

```tsx
            <Link
              key={a.id}
              href={`/customer/${a.id}`}
              className="border-l-4 border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-4 transition-colors hover:bg-[var(--dpf-surface-2)]"
            >
```

```tsx
                <CustomerStatusBadge
                  label={statusMeta.label}
                  tone={statusMeta.tone}
                />
```

- [ ] **Step 6: Run focused tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/revenue-cockpit.test.ts apps/web/components/customer/RevenueCockpit.test.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Check touched page for hardcoded colors**

Run:

```powershell
rg -n "#[0-9a-fA-F]{3,6}|style=\\{\\{" 'apps/web/app/(shell)/customer/(crm)/page.tsx'
```

Expected: no matches.

- [ ] **Step 8: Commit Task 4**

Run:

```powershell
git add 'apps/web/app/(shell)/customer/(crm)/page.tsx'
git commit -s -m "feat(customer): add revenue cockpit to customer workspace"
```

## Task 5: Refactor Opportunity and Engagement Pages to Shared Metadata

**Files:**

- Modify: `apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx`
- Modify: `apps/web/app/(shell)/customer/(crm)/engagements/page.tsx`

- [ ] **Step 1: Update opportunity imports and remove local constants**

In `opportunities/page.tsx`, replace imports with:

```tsx
import Link from "next/link";
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";
```

Remove local `STAGE_META` and `OPEN_STAGES`.

- [ ] **Step 2: Update opportunity grouping and metrics**

Replace `OPEN_STAGES` references with `OPEN_OPPORTUNITY_STAGES`. Replace currency formatting in the top metrics:

```tsx
          <span className="text-[var(--dpf-accent)]">
            {formatRevenueAmount(totalPipelineValue)} total
          </span>
          <span className="text-[var(--dpf-text)]">
            {formatRevenueAmount(Math.round(weightedValue))} weighted
          </span>
          {dormantCount > 0 && (
            <span className="text-[var(--dpf-text)]">
              {dormantCount} dormant
            </span>
          )}
```

- [ ] **Step 3: Replace opportunity column color styles**

Inside the stage map, use:

```tsx
          const meta = getOpportunityStageMeta(stage);
          const toneClasses = CRM_TONE_CLASSES[meta.tone];
```

Replace the column header wrapper with:

```tsx
              <div
                className={[
                  "mb-2 flex items-center justify-between border-b-2 pb-1",
                  toneClasses.border,
                ].join(" ")}
              >
```

Replace dormant badge with:

```tsx
                        <CustomerStatusBadge label="Dormant" tone="warning" />
```

Replace expected value display with:

```tsx
                          {formatRevenueAmount(Number(opp.expectedValue))}
```

- [ ] **Step 4: Replace closed-stage badge styles**

In closed deals, replace `const meta = STAGE_META[opp.stage]!;` with:

```tsx
                const meta = getOpportunityStageMeta(opp.stage);
```

Replace the inline styled `<span>` with:

```tsx
                    <CustomerStatusBadge label={meta.label} tone={meta.tone} />
```

- [ ] **Step 5: Update engagement imports and remove local color map**

In `engagements/page.tsx`, replace imports with:

```tsx
import { prisma } from "@dpf/db";
import { CustomerStatusBadge } from "@/components/customer/CustomerStatusBadge";
import { getEngagementStatusMeta } from "@/lib/crm/presentation";
```

Remove `STATUS_COLOURS`.

- [ ] **Step 6: Replace engagement summary chips and row badges**

In the status summary chip map:

```tsx
          const meta = getEngagementStatusMeta(status);
          return (
            <CustomerStatusBadge
              key={status}
              label={`${meta.label} (${count})`}
              tone={meta.tone}
            />
          );
```

In the engagement row map:

```tsx
          const statusMeta = getEngagementStatusMeta(e.status);
```

Replace row wrapper:

```tsx
            <div
              key={e.id}
              className="flex items-start justify-between gap-3 rounded-lg border-l-4 border-[var(--dpf-accent)] bg-[var(--dpf-surface-1)] p-4"
            >
```

Replace the status badge:

```tsx
                  <CustomerStatusBadge
                    label={statusMeta.label}
                    tone={statusMeta.tone}
                  />
```

- [ ] **Step 7: Run focused tests and color scans**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/presentation.test.ts apps/web/components/customer/CustomerStatusBadge.test.tsx
rg -n "#[0-9a-fA-F]{3,6}|style=\\{\\{" 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx'
```

Expected: tests PASS and `rg` returns no matches.

- [ ] **Step 8: Commit Task 5**

Run:

```powershell
git add 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx'
git commit -s -m "refactor(crm): use shared presentation metadata"
```

## Task 6: Remove Visible Marketing Phase Tabs

**Files:**

- Modify: `apps/web/components/customer-marketing/MarketingTabNav.tsx`
- Create: `apps/web/components/customer-marketing/MarketingTabNav.test.tsx`

- [ ] **Step 1: Write the failing marketing nav test**

Create `apps/web/components/customer-marketing/MarketingTabNav.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

let pathname = "/customer/marketing";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { MarketingTabNav } from "./MarketingTabNav";

describe("MarketingTabNav", () => {
  it("renders only implemented marketing routes", () => {
    pathname = "/customer/marketing";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain('href="/customer/marketing"');
    expect(html).toContain('href="/customer/marketing/strategy"');
    expect(html).not.toContain("Campaigns");
    expect(html).not.toContain("Funnel");
    expect(html).not.toContain("Automation");
    expect(html).not.toContain("Phase 2");
    expect(html).not.toContain("Phase 3");
  });

  it("keeps Strategy active for nested strategy routes", () => {
    pathname = "/customer/marketing/strategy";
    const html = renderToStaticMarkup(<MarketingTabNav />);

    expect(html).toContain("border-[var(--dpf-accent)]");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/customer-marketing/MarketingTabNav.test.tsx
```

Expected: FAIL because the current nav renders disabled Campaigns, Funnel, Automation, and phase labels.

- [ ] **Step 3: Simplify `MarketingTabNav` to implemented routes**

Replace `TABS` with:

```tsx
const TABS = [
  { label: "Overview", href: "/customer/marketing" },
  { label: "Strategy", href: "/customer/marketing/strategy" },
] as const;
```

Replace the map body with a single `Link` branch:

```tsx
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={[
            "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            isActive(tab.href)
              ? "border-[var(--dpf-accent)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]",
          ].join(" ")}
        >
          {tab.label}
        </Link>
      ))}
```

- [ ] **Step 4: Run the marketing nav test to verify it passes**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/components/customer-marketing/MarketingTabNav.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 6**

Run:

```powershell
git add apps/web/components/customer-marketing/MarketingTabNav.tsx apps/web/components/customer-marketing/MarketingTabNav.test.tsx
git commit -s -m "fix(marketing): hide unimplemented marketing phase tabs"
```

## Task 7: Refactor Touched Funnel Color Semantics

**Files:**

- Modify: `apps/web/app/(shell)/customer/(crm)/funnel/page.tsx`

- [ ] **Step 1: Replace imports and remove local stage colors**

Add imports:

```tsx
import {
  CRM_TONE_CLASSES,
  getOpportunityStageMeta,
  OPEN_OPPORTUNITY_STAGES,
} from "@/lib/crm/presentation";
import { formatRevenueAmount } from "@/lib/crm/revenue-cockpit";
```

Remove local `STAGE_COLOURS`.

- [ ] **Step 2: Replace open-stage constant and funnel stage colors**

Replace:

```tsx
  const openStages = ["qualification", "discovery", "proposal", "negotiation"];
```

with:

```tsx
  const openStages = [...OPEN_OPPORTUNITY_STAGES];
```

Replace `funnelStages` color fields with tone fields:

```tsx
      tone: "accent" as const,
```

```tsx
      tone: "attention" as const,
```

```tsx
      tone: "info" as const,
```

```tsx
      tone: "success" as const,
```

- [ ] **Step 3: Replace funnel bar inline color styles**

Inside `funnelStages.map`, add:

```tsx
          const toneClasses = CRM_TONE_CLASSES[stage.tone];
```

Replace the bar `style` object with:

```tsx
                className={[
                  "flex h-10 items-center rounded-md border-l-4 px-3 transition-all",
                  toneClasses.border,
                  toneClasses.surface,
                ].join(" ")}
                style={{ width: `${stage.width}%`, minWidth: 120 }}
```

Only `width` and `minWidth` remain inline because they are dynamic layout measurements, not colors.

- [ ] **Step 4: Replace weakest-point callout color**

Replace the callout wrapper with:

```tsx
        <div className="mb-6 rounded-lg border-l-2 border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
```

- [ ] **Step 5: Replace stage breakdown colors**

Inside the `opportunities.map`, replace:

```tsx
            const colour = STAGE_COLOURS[o.stage] ?? "#8888a0";
```

with:

```tsx
            const meta = getOpportunityStageMeta(o.stage);
            const toneClasses = CRM_TONE_CLASSES[meta.tone];
```

Replace the stage card class with:

```tsx
                className={[
                  "rounded-lg border-l-2 bg-[var(--dpf-surface-1)] p-3",
                  toneClasses.border,
                ].join(" ")}
```

Replace label and value display:

```tsx
                  {meta.label}
```

```tsx
                    {formatRevenueAmount(value)}
```

- [ ] **Step 6: Replace storefront inbox hardcoded colors**

Replace the inbox item array with:

```tsx
          {[
            { label: "Bookings", count: bookings, tone: "accent" as const },
            { label: "Inquiries", count: inquiries, tone: "attention" as const },
            { label: "Orders", count: orders, tone: "success" as const },
            { label: "Donations", count: donations, tone: "info" as const },
          ].map((item) => {
            const toneClasses = CRM_TONE_CLASSES[item.tone];
            return (
              <div
                key={item.label}
                className={[
                  "rounded-lg border-l-2 bg-[var(--dpf-surface-1)] p-3",
                  toneClasses.border,
                ].join(" ")}
              >
                <p className="text-[10px] uppercase tracking-wider text-[var(--dpf-muted)]">
                  {item.label}
                </p>
                <p className="text-lg font-bold text-[var(--dpf-text)]">{item.count}</p>
              </div>
            );
          })}
```

- [ ] **Step 7: Run focused tests and funnel color scan**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/presentation.test.ts apps/web/lib/crm/revenue-cockpit.test.ts
rg -n "#[0-9a-fA-F]{3,6}|borderLeftColor|background:|color:" 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx'
```

Expected: tests PASS. The `rg` command may return `style={{ width... }}` only if the search is broadened; it must not return raw hex values or color style fields.

- [ ] **Step 8: Commit Task 7**

Run:

```powershell
git add 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx'
git commit -s -m "refactor(crm): make funnel visuals theme-aware"
```

## Task 8: Full Verification, Push, and PR

**Files:**

- Verify all files changed by Tasks 1-7

- [ ] **Step 1: Run the full web vitest suite (NOT just focused tests)**

Targeted runs are not enough — the pre-commit hook only runs typecheck, so vitest must be run locally before push or PR CI breaks for every other concurrent session.

Run:

```powershell
pnpm --filter web test
```

Expected: every web test passes, including the new modules from Tasks 1–7. If unrelated tests fail because of a shared change you introduced (e.g., a re-export), fix the root cause before continuing — do not skip or `xfail`.

If you touched anything under `packages/db`, also run:

```powershell
pnpm --filter @dpf/db test
```

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: PASS. Use the Vitest version already pinned by the repo lockfile and package manifests; do not attempt any dependency bump as part of this slice.

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm --filter web build
```

Expected: PASS. A 3-digit warning count in `next build` output is usually NFT cascade (a small number of root causes re-emitted per output asset). Investigate by source-code root cause, not by warning count.

- [ ] **Step 4: Scan touched files for hardcoded colors and phase labels**

Run:

```powershell
rg -n "#[0-9a-fA-F]{3,6}|bg-red-|text-red-|border-red-|borderLeftColor|background:|color:|Phase 2|Phase 3" 'apps/web/app/(shell)/customer/(crm)/page.tsx' 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx' 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx' apps/web/components/customer apps/web/components/customer-marketing/MarketingTabNav.tsx
```

Expected: no matches.

- [ ] **Step 5: Functional verification on the contributor preview (NOT a full docker rebuild)**

Slice 1 is code-only inside `apps/web/`; full `docker compose build --no-cache portal portal-init sandbox` is overkill and burns 10+ minutes for no benefit. Use the contributor preview on port 3001 instead (see the `dev-portal-start` skill):

```powershell
pnpm --filter web dev
```

Then drive each route in a browser and capture a short structured dynamic-analysis report (drove X, observed Y, signed off Z) — NOT a pile of screenshots:

- `/customer` — `Today in revenue` band renders above the account list; metric tiles link; currency reads "£" not "$"; empty-attention state shows the calm copy.
- `/customer` — user-facing copy does not say "Pipedrive" or "Revenue Cockpit"; "Today in revenue" is the visible label.
- `/customer/opportunities` — stage columns use shared tone classes; pipeline totals render in £; dormant badge is theme-aware.
- `/customer/engagements` — status chips and row badges use shared metadata; no hex colors visible.
- `/customer/funnel` — funnel bars and stage breakdown use theme tokens; storefront inbox tiles use accent/attention/success/info.
- `/customer/marketing` — tab nav shows only **Overview** and **Strategy**; no "Phase 2" / "Phase 3" pills.
- Resize to mobile width — status badges, metric details, and stage columns don't clip.

A full docker rebuild is only needed if you change anything outside `apps/web/` (Prisma schema, MCP server, seed data, infra). This slice does not.

- [ ] **Step 6: Continuous overlap sweep before push**

Per `feedback_continuous_overlap_check`: re-run the sweep from Task 0 Step 4 now (a concurrent session may have landed a PR mid-slice that touches the same files). If overlap exists, rebase on the latest `origin/main` and re-run Steps 1–5 before continuing.

```powershell
git fetch origin
git log origin/main --oneline -n 20 -- 'apps/web/app/(shell)/customer' apps/web/components/customer apps/web/components/customer-marketing
gh pr list --state open --search "customer marketing OR crm OR pipeline" --limit 20
```

Expected: no overlapping commits or open PRs on the modified files.

- [ ] **Step 7: Commit any verification fixes**

If verification forced changes, stage only the specific files (per `feedback_git_commit_only_for_concurrent_sessions`, never `git add -A`):

```powershell
git add apps/web/lib/crm/presentation.ts apps/web/lib/crm/presentation.test.ts apps/web/lib/crm/revenue-cockpit.ts apps/web/lib/crm/revenue-cockpit.test.ts apps/web/components/customer/CustomerMetricTile.tsx apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.tsx apps/web/components/customer/RevenueCockpit.test.tsx apps/web/components/customer-marketing/MarketingTabNav.tsx apps/web/components/customer-marketing/MarketingTabNav.test.tsx 'apps/web/app/(shell)/customer/(crm)/page.tsx' 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx' 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx'
git commit -s -m "fix(customer): address crm cockpit verification issues"
```

- [ ] **Step 8: Push the implementation branch**

Run:

```powershell
git status --short --branch
git push -u origin feat/pipedrive-crm-marketing-slice-1
```

Expected: branch pushed and tracking `origin/feat/pipedrive-crm-marketing-slice-1`. Every commit must already carry `Signed-off-by:` (used `git commit -s` throughout) — DCO is enforced on PR merge.

- [ ] **Step 9: Open the PR**

This slice is theme-aware refactor + dead-code removal + shared-helper extraction, which qualifies as a Claude-led maintenance PR (per `feedback_no_manual_prs`). Open it now — do not park the branch.

```powershell
$prBody = @'
## Summary

- Add `Today in revenue` cockpit band to `/customer` driven by a pure summary helper.
- Extract theme-aware CRM presentation metadata (`apps/web/lib/crm/presentation.ts`) and replace hardcoded hex / inline color styles in 4 `(crm)` pages.
- Add reusable `CustomerMetricTile`, `CustomerStatusBadge`, `RevenueCockpit` components.
- Remove visible `Phase 2` / `Phase 3` placeholder tabs from `MarketingTabNav`; keep only implemented routes (Overview, Strategy).

Implements Slice 1 of `docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`. Respects the UX-governance rules in `docs/superpowers/specs/2026-04-25-customer-marketing-coworker-led-ux-correction.md` (no surprise coworker prompts — metric tiles are nav links, not send-buttons).

Deferred to a tracked follow-up: hardcoded colors in `(crm)/[id]/page.tsx`, `(crm)/quotes/page.tsx`, `(crm)/sales-orders/page.tsx` — these will consume the same shared helper.

## Test plan

- [x] `pnpm --filter web test` passes
- [x] `pnpm --filter web typecheck` passes
- [x] `pnpm --filter web build` passes
- [x] Contributor preview on `:3001` — `/customer`, `/customer/opportunities`, `/customer/engagements`, `/customer/funnel`, `/customer/marketing` render with theme tokens, GBP currency, no phase pills
- [x] No hex / inline color regressions in touched files
- [x] Mobile widths do not clip status badges or metric details
'@
gh pr create --title "feat(customer): pipedrive-inspired revenue cockpit + crm theme cleanup (slice 1)" --body $prBody
```

Expected: PR opens against `main`. Watch CI; address any concurrent-merge rebases promptly.
