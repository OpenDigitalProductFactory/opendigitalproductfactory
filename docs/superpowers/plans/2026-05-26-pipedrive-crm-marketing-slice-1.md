# Pipedrive CRM Marketing Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Pipedrive-inspired CRM and marketing operations slice: a scan-first revenue cockpit on `/customer`, theme-aware CRM presentation metadata, shared summary components, and a cleaned marketing tab nav with no phase-locked placeholders.

**Architecture:** Keep the first slice on existing CRM and marketing models. Extract pure CRM presentation and summary logic into small tested modules, render reusable customer summary components from server pages, and hide marketing subroutes until real read-only routes are implemented in a later slice. Do not add database tables or external integration writes in this slice.

**Tech Stack:** Next.js 16 App Router, React server components, TypeScript, Prisma, pnpm workspaces, Vitest, DPF CSS custom properties.

---

## Scope

This plan implements Slice 1 from `docs/superpowers/specs/2026-05-26-pipedrive-inspired-crm-marketing-operations-design.md`.

Included:

- central CRM stage/status presentation metadata
- shared customer metric tile and status badge components
- pure revenue cockpit summary helper
- `/customer` "Today in revenue" band using existing data
- cleanup of hardcoded CRM status/stage colors on touched pages
- removal of visible "Phase 2" / "Phase 3" marketing tabs
- focused unit/component tests

Excluded:

- new Prisma models
- drag-and-drop opportunity movement
- signal-to-engagement creation
- external publish/send/schedule actions
- real `/customer/marketing/campaigns`, `/customer/marketing/funnel`, or `/customer/marketing/automation` routes
- PR creation before verification

Implementation should happen on a new feature branch/worktree from latest `origin/main`, for example `feat/pipedrive-crm-marketing-slice-1`. The doc branch `doc/pipedrive-crm-marketing` remains the research and planning branch.

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
  it("formats revenue in USD by default", () => {
    expect(formatRevenueAmount(12500)).toBe("$12,500");
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
        detail: "$6,000 open",
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

export function formatRevenueAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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
        detail="$6,000 open"
        tone="accent"
      />,
    );

    expect(html).toContain('href="/customer/opportunities"');
    expect(html).toContain(">Pipeline<");
    expect(html).toContain(">3<");
    expect(html).toContain("$6,000 open");
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
              detail: "$6,000 open",
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
    prisma.marketingCampaignBrief.count({
      where: { status: { in: ["draft", "pending-review"] } },
    }),
    prisma.marketingAssetTask.count({
      where: { status: { in: ["draft", "pending-review", "queued"] } },
    }),
    prisma.marketingAutomationCandidate.count({
      where: { status: { in: ["draft", "proposed", "pending-review"] } },
    }),
  ]);
```

If any listed marketing status is not present in seed data, the query still safely returns zero.

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

## Task 8: Full Verification and Push

**Files:**

- Verify all files changed by Tasks 1-7

- [ ] **Step 1: Run the focused unit and component tests**

Run:

```powershell
pnpm --filter web exec vitest run apps/web/lib/crm/presentation.test.ts apps/web/lib/crm/revenue-cockpit.test.ts apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.test.tsx apps/web/components/customer-marketing/MarketingTabNav.test.tsx apps/web/components/customer/CustomerTabNav.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: PASS.

- [ ] **Step 3: Run production build**

Run:

```powershell
pnpm --filter web exec next build
```

Expected: PASS.

- [ ] **Step 4: Scan touched files for hardcoded colors and phase labels**

Run:

```powershell
rg -n "#[0-9a-fA-F]{3,6}|bg-red-|text-red-|border-red-|borderLeftColor|background:|color:|Phase 2|Phase 3" 'apps/web/app/(shell)/customer/(crm)/page.tsx' 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx' 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx' apps/web/components/customer apps/web/components/customer-marketing/MarketingTabNav.tsx
```

Expected: no matches.

- [ ] **Step 5: Verify the route in the Docker-served app**

Run the project-standard Docker rebuild only if the local install is not already serving the updated app:

```powershell
docker compose build --no-cache portal portal-init sandbox
docker compose up -d
```

Then authenticate with the install admin credentials and exercise:

- `/customer`
- `/customer/opportunities`
- `/customer/engagements`
- `/customer/funnel`
- `/customer/marketing`

Expected:

- `/customer` shows the "Today in revenue" band above account cards.
- metric tiles link to their target routes.
- account, engagement, and opportunity status badges are theme-aware.
- marketing nav shows only Overview and Strategy.
- no disabled Campaigns, Funnel, Automation phase tabs are visible.
- mobile widths do not clip status badges or metric details.

- [ ] **Step 6: Commit any verification fixes**

If verification forced changes, commit them:

```powershell
git add apps/web/lib/crm/presentation.ts apps/web/lib/crm/presentation.test.ts apps/web/lib/crm/revenue-cockpit.ts apps/web/lib/crm/revenue-cockpit.test.ts apps/web/components/customer/CustomerMetricTile.tsx apps/web/components/customer/CustomerMetricTile.test.tsx apps/web/components/customer/CustomerStatusBadge.tsx apps/web/components/customer/CustomerStatusBadge.test.tsx apps/web/components/customer/RevenueCockpit.tsx apps/web/components/customer/RevenueCockpit.test.tsx apps/web/components/customer-marketing/MarketingTabNav.tsx apps/web/components/customer-marketing/MarketingTabNav.test.tsx 'apps/web/app/(shell)/customer/(crm)/page.tsx' 'apps/web/app/(shell)/customer/(crm)/opportunities/page.tsx' 'apps/web/app/(shell)/customer/(crm)/engagements/page.tsx' 'apps/web/app/(shell)/customer/(crm)/funnel/page.tsx'
git commit -s -m "fix(customer): address crm cockpit verification issues"
```

- [ ] **Step 7: Push the implementation branch**

Run:

```powershell
git status --short --branch
git push -u origin feat/pipedrive-crm-marketing-slice-1
```

Expected: branch pushed and tracking `origin/feat/pipedrive-crm-marketing-slice-1`.

Do not open a PR until all verification above passes and the branch is ready to merge.
