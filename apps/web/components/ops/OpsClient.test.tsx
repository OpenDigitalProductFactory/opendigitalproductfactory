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
import { BacklogItemRow } from "./BacklogItemRow";

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
  it("shows an honest status mix while hiding terminal rows in Active only mode", () => {
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
    expect(html).toContain("Active only");
    expect(html).toContain("1 in progress");
    expect(html).toContain("1 done");
    expect(html).toContain("1 deferred");
    expect(html).toContain("2 non-active items hidden");
  });

  it("explains an all-terminal epic without calling deferred items completed", () => {
    const doneItem = item({ id: "done", itemId: "BI-DONE", status: "done", completedAt: now });
    const duplicateItem = item({
      id: "duplicate",
      itemId: "BI-DUPLICATE",
      status: "deferred",
      triageOutcome: "duplicate",
      completedAt: now,
    });

    const html = renderToStaticMarkup(
      <OpsClient
        items={[doneItem, duplicateItem]}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[epic({ items: [doneItem, duplicateItem] })]}
        portfolios={[]}
        focusedItemId="BI-DONE"
      />,
    );

    expect(html).toContain("No active items");
    expect(html).toContain("1 done");
    expect(html).toContain("1 deferred");
    expect(html).not.toContain("2 completed");
  });

  it("labels a retired duplicate distinctly from parked work", () => {
    const html = renderToStaticMarkup(
      <BacklogItemRow
        item={item({
          status: "retired",
          triageOutcome: "duplicate",
          completedAt: now,
        })}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain("retired duplicate");
    expect(html).toContain("Retired because another backlog item is the canonical record.");
    expect(html).not.toContain("done 5/25/2026");
  });

  it("shows the active Workroom owner without exposing coordination internals", () => {
    const html = renderToStaticMarkup(
      <BacklogItemRow
        item={item({
          status: "in-progress",
          activeWorkrooms: [{
            capsuleId: "WC-923105A2",
            title: "Workroom ownership safety",
            status: "working",
            backlogItemId: "BI-TEST",
            repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
            headBranch: "fix/bi-workroom-single-owner",
            worktreePath: "/private/internal/worktree",
            executorKind: "codex-desktop",
            executorRef: "private-session-ref",
            leaseHolderPrincipalId: "private-principal",
            leaseExpiresAt: "2026-09-01T06:00:00.000Z",
            liveness: "lease-live",
            isLive: true,
            livenessReason: "The Workroom lease is active.",
            trueLivenessAt: "2026-09-01T05:00:00.000Z",
          }],
        })}
        onEdit={vi.fn()}
      />,
    );

    expect(html).toContain("Workroom active");
    expect(html).toContain("Workroom ownership safety");
    expect(html).toContain('href="/workspace/cases/WC-923105A2"');
    expect(html).toContain("working");
    expect(html).toContain("Codex Desktop");
    expect(html).toContain("fix/bi-workroom-single-owner");
    expect(html).toContain("lease live");
    expect(html).not.toContain("/private/internal/worktree");
    expect(html).not.toContain("private-session-ref");
    expect(html).not.toContain("private-principal");
  });

  it("adds no ownership chrome when no Workroom is active", () => {
    const html = renderToStaticMarkup(
      <BacklogItemRow item={item({ activeWorkrooms: [] })} onEdit={vi.fn()} />,
    );

    expect(html).not.toContain("Workroom active");
  });

  it("keeps a zero-item epic explicit", () => {
    const html = renderToStaticMarkup(
      <OpsClient
        items={[]}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[epic({ items: [] })]}
        portfolios={[]}
      />,
    );

    expect(html).toContain("No items");
  });

  it("renders a Portfolio facet listing each portfolio when portfolios exist", () => {
    const html = renderToStaticMarkup(
      <OpsClient
        items={[]}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[]}
        portfolios={[
          { id: "p1", slug: "alpha", name: "Alpha Portfolio" },
          { id: "p2", slug: "beta", name: "Beta Portfolio" },
        ]}
      />,
    );

    // The portfolio lens (a <select>) offers each portfolio as an option.
    expect(html).toContain("Alpha Portfolio");
    expect(html).toContain("Beta Portfolio");
  });
});
