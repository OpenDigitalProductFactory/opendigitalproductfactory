// @vitest-environment jsdom
//
// UX-budget measurement for the backlog row's delivery-shape badge
// (BI-D03BE728). /ops has no per-row adjudication in route-budget-baseline.json,
// so this measures the row itself in the heaviest honest state the change
// introduces: an in-progress item whose live Workroom carries a delivery shape,
// so the badge renders. Its console line is where
// docs/ux-fit/2026-09-06-backlog-row-delivery-shape.ux-fit.json gets its numbers.

import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import axe from "axe-core";

import { measureUxBudget } from "@/lib/ux-budget";
import type { BacklogItemWithRelations } from "@/lib/backlog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/lib/actions/backlog", () => ({ deleteBacklogItem: vi.fn(), escalateBacklogItem: vi.fn() }));
vi.mock("@/lib/actions/backlog-build", () => ({ startBuildForBacklogItem: vi.fn() }));

import { BacklogItemRow } from "./BacklogItemRow";

const now = new Date("2026-09-06T12:00:00.000Z");

const ITEM = {
  id: "item-id",
  itemId: "BI-TEST",
  title: "Backlog item",
  status: "in-progress",
  type: "product",
  workType: "feature",
  source: "user-request",
  body: null,
  priority: 1,
  epicId: "epic-id",
  triageOutcome: null,
  effortSize: "medium",
  activeBuildId: null,
  activeBuild: null,
  digitalProduct: null,
  taxonomyNode: null,
  submittedBy: { email: "admin@dpf.local" },
  completedAt: null,
  agentId: null,
  createdAt: now,
  updatedAt: now,
  upstreamIssueNumber: null,
  upstreamIssueUrl: null,
  activeWorkrooms: [{
    capsuleId: "WC-923105A2",
    title: "Shaped work",
    status: "working",
    backlogItemId: "BI-TEST",
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    headBranch: "feat/shaped",
    worktreePath: "/private/internal/worktree",
    executorKind: "claude-desktop",
    executorRef: "private-session-ref",
    leaseHolderPrincipalId: "private-principal",
    leaseExpiresAt: "2026-09-06T18:00:00.000Z",
    liveness: "lease-live",
    isLive: true,
    workShape: "delivery-break-fix@1.0.0",
  }],
} as unknown as BacklogItemWithRelations;

afterEach(cleanup);

/** The same row with no bound shape — the "before" the badge is compared against. */
const UNSHAPED = { ...ITEM, activeWorkrooms: [{ ...ITEM.activeWorkrooms![0]!, workShape: null }] } as unknown as BacklogItemWithRelations;

describe("BacklogItemRow UX budget", () => {
  it("reports the unshaped row as the comparison baseline", () => {
    const { container } = render(<BacklogItemRow item={UNSHAPED} onEdit={vi.fn()} />);
    expect(container.textContent).not.toContain("BF");
    console.log(`[ux-budget:baseline] ${JSON.stringify(measureUxBudget(container.innerHTML))}`);
  });

  it("renders the shape badge with no axe violations and reports the measurement", async () => {
    const { container } = render(<BacklogItemRow item={ITEM} onEdit={vi.fn()} />);
    expect(container.textContent).toContain("BF");
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    const violations = results.violations.map((v) => `${v.id}: ${v.help}`);
    expect(violations, violations.join("; ")).toEqual([]);
    // Where the ux-fit manifest's numbers come from.
    console.log(`[ux-budget] ${JSON.stringify({ ...measureUxBudget(container.innerHTML), axeViolations: results.violations.length })}`);
  });
});
