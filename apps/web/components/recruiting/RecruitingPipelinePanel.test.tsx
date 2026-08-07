// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

import { RecruitingPipelinePanel } from "./RecruitingPipelinePanel";
import type { RecruitingPipeline } from "@/lib/recruiting/pipeline-read-model";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const REQUISITIONS = [
  { id: "req-1", reqId: "REQ-1", title: "Welder", status: "open" },
  { id: "req-2", reqId: "REQ-2", title: "Machinist", status: "closed" },
];

function pipeline(items: RecruitingPipeline["items"]): RecruitingPipeline {
  const native = items.filter((i) => i.source === "native").length;
  const greenhouse = items.filter((i) => i.source === "greenhouse").length;
  return { items, counts: { native, greenhouse, total: items.length } };
}

describe("RecruitingPipelinePanel", () => {
  it("shows the empty state when the funnel has no items", () => {
    render(
      <RecruitingPipelinePanel
        pipeline={pipeline([])}
        requisitions={REQUISITIONS}
        selectedRequisitionId={null}
      />,
    );
    expect(screen.getByText(/no applications in this funnel/i)).toBeInTheDocument();
  });

  it("renders counts, source badges, and stage for a populated funnel", () => {
    render(
      <RecruitingPipelinePanel
        pipeline={pipeline([
          { id: "a1", source: "native", displayName: "María Reyes", status: "active", stage: "Interview", externalId: null },
          { id: "greenhouse:g1", source: "greenhouse", displayName: "Jorge Gutiérrez", status: "active", stage: "Screen", externalId: "g1" },
        ])}
        requisitions={REQUISITIONS}
        selectedRequisitionId={null}
      />,
    );
    expect(screen.getByText("María Reyes")).toBeInTheDocument();
    expect(screen.getByText("Jorge Gutiérrez")).toBeInTheDocument();
    // "Native" appears as both a metric label and a source badge; the badge is what matters.
    expect(screen.getAllByText("Native").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Greenhouse")).toBeInTheDocument();
    // by-stage chips reflect the two stages
    expect(screen.getByText(/Interview · 1/)).toBeInTheDocument();
    expect(screen.getByText(/Screen · 1/)).toBeInTheDocument();
  });

  it("distinguishes a filtered-empty state from a truly empty funnel", () => {
    render(
      <RecruitingPipelinePanel
        pipeline={pipeline([])}
        requisitions={REQUISITIONS}
        selectedRequisitionId="req-1"
      />,
    );
    expect(screen.getByText(/clearing the requisition filter/i)).toBeInTheDocument();
  });

  it("lists requisitions in the filter with the current selection", () => {
    render(
      <RecruitingPipelinePanel
        pipeline={pipeline([])}
        requisitions={REQUISITIONS}
        selectedRequisitionId="req-1"
      />,
    );
    expect(screen.getByLabelText("Requisition")).toBeInTheDocument();
    const options = screen.getAllByRole("option") as HTMLOptionElement[];
    // "All requisitions" + the two requisitions.
    expect(options.map((o) => o.textContent)).toEqual([
      "All requisitions",
      "REQ-1 · Welder",
      "REQ-2 · Machinist (closed)",
    ]);
    expect(options.find((o) => o.selected)?.value).toBe("req-1");
  });
});
