import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BacklogItemWithRelations, EpicWithRelations } from "@/lib/backlog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
    title,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
    title?: string;
  }) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/actions/backlog", () => ({
  deleteBacklogItem: vi.fn(),
  deleteEpic: vi.fn(),
  escalateBacklogItemUpstream: vi.fn(),
}));

vi.mock("@/lib/actions/backlog-build", () => ({
  startBacklogBuild: vi.fn(),
}));

import { OpsClient } from "./OpsClient";

const now = new Date("2026-05-25T12:00:00Z");

function item(overrides: Partial<BacklogItemWithRelations>): BacklogItemWithRelations {
  return {
    id: "item-id",
    itemId: "BI-TEST",
    title: "Backlog item",
    status: "open",
    type: "product",
    workType: "feature",
    source: "user-request",
    body: null,
    priority: 1,
    epicId: "epic-id",
    triageOutcome: null,
    effortSize: null,
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
    ...overrides,
  };
}

function epic(overrides: Partial<EpicWithRelations>): EpicWithRelations {
  return {
    id: "epic-id",
    epicId: "EP-TEST",
    title: "Test epic",
    description: "A test epic",
    status: "in-progress",
    createdAt: now,
    updatedAt: now,
    submittedBy: { email: "admin@dpf.local" },
    agentId: null,
    completedAt: null,
    portfolios: [],
    items: [],
    ...overrides,
  };
}

describe("OpsClient", () => {
  it("hides terminal backlog items inside expanded epics when Hide done is active", () => {
    const openItem = item({
      id: "open-item-id",
      itemId: "BI-OPEN",
      title: "Visible active child",
      status: "in-progress",
    });
    const doneItem = item({
      id: "done-item-id",
      itemId: "BI-DONE",
      title: "Hidden completed child",
      status: "done",
      completedAt: now,
    });
    const deferredItem = item({
      id: "deferred-item-id",
      itemId: "BI-DEFERRED",
      title: "Hidden deferred child",
      status: "deferred",
    });

    const html = renderToStaticMarkup(
      <OpsClient
        items={[openItem, doneItem, deferredItem]}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[epic({ items: [openItem, doneItem, deferredItem] })]}
        portfolios={[]}
        focusedItemId="BI-OPEN"
      />,
    );

    expect(html).toContain("Visible active child");
    expect(html).not.toContain("Hidden completed child");
    expect(html).not.toContain("Hidden deferred child");
    expect(html).toContain("2 completed items hidden");
  });
});
