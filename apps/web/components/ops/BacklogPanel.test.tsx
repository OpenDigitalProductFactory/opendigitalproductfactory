// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/backlog", () => ({
  createBacklogItem: vi.fn(),
  updateBacklogItem: vi.fn(),
}));
vi.mock("@/lib/agent-form-assist", () => ({ registerActiveFormAssist: vi.fn() }));

import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { BacklogPanel } from "./BacklogPanel";

describe("BacklogPanel governed deferral fields", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("shows why, trigger, and review controls when editing a deferred item", () => {
    render(
      <BacklogPanel
        isOpen
        onClose={() => undefined}
        item={{
          id: "row-1",
          itemId: "BI-1",
          title: "Deferred work",
          status: "deferred",
          type: "portfolio",
          workType: "feature",
          source: "user-request",
          body: null,
          priority: 1,
          epicId: null,
          triageOutcome: "defer",
          duplicateOfId: null,
          effortSize: null,
          activeBuildId: null,
          activeBuild: null,
          digitalProduct: null,
          taxonomyNode: null,
          submittedBy: null,
          completedAt: null,
          agentId: null,
          createdAt: new Date("2026-08-01T00:00:00Z"),
          updatedAt: new Date("2026-08-01T00:00:00Z"),
          upstreamIssueNumber: null,
          upstreamIssueUrl: null,
          deferReason: "Waiting for evidence",
          deferTrigger: "Predecessor ships",
          deferReviewAt: new Date("2026-11-15T12:00:00Z"),
        }}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[]}
      />,
    );

    expect(screen.getByText("Deferral")).toBeTruthy();
    expect(screen.getByLabelText(/Reason/)).toBeTruthy();
    expect(screen.getByLabelText(/Resume when/)).toBeTruthy();
    expect(screen.getByLabelText(/Review/)).toBeTruthy();
    expect(screen.getByDisplayValue("Waiting for evidence")).toBeTruthy();
    expect(screen.getByDisplayValue("Predecessor ships")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Retired" })).toBeTruthy();
  });

  it("does not offer generic retirement for active work", () => {
    render(
      <BacklogPanel
        isOpen
        onClose={() => undefined}
        digitalProducts={[]}
        taxonomyNodes={[]}
        epics={[]}
      />,
    );

    expect((screen.getByRole("option", { name: "Retired" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("asks for the outcome on a new item, optionally, and not when editing (BI-B1B44777)", () => {
    const panel = (item?: Parameters<typeof BacklogPanel>[0]["item"]) => (
      <MessagesProvider locale="en-US" messages={{ backlog: namespaceMessages("en-US", "backlog") }}>
        <BacklogPanel isOpen onClose={() => undefined} item={item} digitalProducts={[]} taxonomyNodes={[]} epics={[]} />
      </MessagesProvider>
    );
    const { rerender } = render(panel());
    const outcome = screen.getByLabelText(/Outcome/) as HTMLTextAreaElement;
    expect(outcome.required).toBe(false);
    expect(outcome.placeholder).toBe("What will be true, and for whom, when this is done?");

    rerender(panel({ id: "row-1", itemId: "BI-1", title: "Existing", status: "open", type: "portfolio",
      workType: "feature", source: "user-request", body: "## Outcome\nX", priority: null, epicId: null,
      triageOutcome: null, duplicateOfId: null, effortSize: null, activeBuildId: null, activeBuild: null,
      digitalProduct: null, taxonomyNode: null, submittedBy: null, completedAt: null, agentId: null,
      createdAt: new Date("2026-08-01T00:00:00Z"), updatedAt: new Date("2026-08-01T00:00:00Z"),
      upstreamIssueNumber: null, upstreamIssueUrl: null, deferReason: null, deferTrigger: null, deferReviewAt: null,
    } as never));
    expect(screen.queryByLabelText(/^Outcome/)).toBeNull();
  });
});
