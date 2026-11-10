// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ record: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("@/lib/actions/workroom-stage-decision", () => ({ recordWorkroomStageDecision: m.record }));

import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import type { WorkroomStageDecisionView } from "@/lib/work-management/workroom-stage-decision";
import { WorkroomStageDecision } from "./WorkroomStageDecision";

const VIEW: WorkroomStageDecisionView = {
  caseKey: "case-1",
  roomRowId: "room-row-1",
  stageKey: "decide",
  stageTitle: "Decide the response to each finding",
  choices: ["accept", "patch", "defer"],
  deciderName: "Alex Owner",
  canDecide: true,
  refusal: null,
  findings: [{ stageKey: "sweep", title: "Sweep advisories", summary: "14 advisories read" }],
};

function renderDecision(view: WorkroomStageDecisionView) {
  return render(
    <MessagesProvider locale="en-US" messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}>
      <WorkroomStageDecision view={view} />
    </MessagesProvider>,
  );
}

beforeEach(() => { vi.resetAllMocks(); m.record.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("WorkroomStageDecision", () => {
  it("renders collapsed by default: one line and a Decide button", () => {
    renderDecision(VIEW);
    expect(screen.getByText("Your decision: Decide the response to each finding.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decide" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByText("14 advisories read")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Defer until/)).not.toBeInTheDocument();
  });

  it("reveals compact choices and the findings; the date appears only for Defer", () => {
    renderDecision(VIEW);
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["accept", "patch", "defer"]);
    expect(screen.getByText("14 advisories read")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Defer until/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Defer" }));
    expect(screen.getByLabelText(/Defer until/)).toBeInTheDocument();
  });

  it("records the choice through the action", async () => {
    renderDecision(VIEW);
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    fireEvent.click(screen.getByRole("radio", { name: "Accept" }));
    fireEvent.change(screen.getByLabelText(/Rationale/), { target: { value: "Not reachable" } });
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(m.record).toHaveBeenCalledWith("case-1", "room-row-1", {
      stageKey: "decide", choice: "accept", rationale: "Not reachable",
    }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  // GPP Phase 3c PR-3c-3: "Send back" appears only when the stage offers it (its gate declares a refuse route).
  it("offers Send back only when the view carries it, and records it without a date", async () => {
    renderDecision({ ...VIEW, choices: ["accept", "defer", "refuse"] });
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    expect(screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"))).toEqual(["accept", "defer", "refuse"]);
    fireEvent.click(screen.getByRole("radio", { name: "Send back" }));
    expect(screen.queryByLabelText(/Defer until/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record decision" }));
    await waitFor(() => expect(m.record).toHaveBeenCalledWith("case-1", "room-row-1", { stageKey: "decide", choice: "refuse" }));
    cleanup();
    renderDecision(VIEW);
    fireEvent.click(screen.getByRole("button", { name: "Decide" }));
    expect(screen.queryByRole("radio", { name: "Send back" })).not.toBeInTheDocument();
  });

  it("shows everyone else who decides, with no control", () => {
    renderDecision({ ...VIEW, canDecide: false, refusal: "Only Alex Owner (the room's accountable owner) can record this decision." });
    expect(screen.getByText("Waiting on Alex Owner to decide: Decide the response to each finding.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
