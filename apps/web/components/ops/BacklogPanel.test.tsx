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
});
