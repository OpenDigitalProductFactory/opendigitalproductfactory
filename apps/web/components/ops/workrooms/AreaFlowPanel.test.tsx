// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { cleanup, render as rtlRender, screen, within } from "@testing-library/react";

import type { PortfolioFlowWithCost, ShapeFlowView } from "@/lib/work-management/area-flow.server";
import { getWorkShape } from "@/lib/work-management/work-shapes";
import { buildShapeFlowMap } from "@/lib/work-management/workroom-flow-map";
import { computeShapeStepMeasures } from "@/lib/work-management/shape-step-measures";

import { translate } from "@dpf/i18n";

import { PortfolioFlowComparison, PortfolioFlowTiles, ShapeFlowDrillIn, type FlowT } from "./AreaFlowPanel";

const t: FlowT = (key, args) => translate("en-US", "workrooms", key, args);

const render = (ui: React.ReactElement) =>
  rtlRender(<MessagesProvider locale="en-US" messages={{ workrooms: namespaceMessages("en-US", "workrooms") }}>{ui}</MessagesProvider>);

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("view=work&shape=delivery-small"),
  usePathname: () => "/area/delivery",
  useRouter: () => ({ replace: vi.fn() }),
}));
afterEach(cleanup);

const H = 3_600_000;
const flow = (key: PortfolioFlowWithCost["key"], overrides: Partial<PortfolioFlowWithCost> = {}): PortfolioFlowWithCost => ({
  key,
  rooms: 12,
  flowLoad: 7,
  flowTime: { p50Ms: 30 * H, priorP50Ms: 40 * H, runs: 9 },
  flowEfficiency: { value: 0.12, prior: 0.08 },
  throughput: { perWeek: 2.25, priorPerWeek: 1.5 },
  weeklyFlowTimeP50Ms: [50 * H, 45 * H, null, 40 * H, 38 * H, 35 * H, 32 * H, 30 * H],
  weeklyFlowLoad: [9, 9, 8, 8, 8, 7, 7, 7],
  weeklyFlowEfficiency: [0.05, 0.06, null, 0.08, 0.09, 0.1, 0.11, 0.12],
  weeklyThroughput: [1, 1, 2, 2, 2, 3, 2, 3],
  weeklyVersionChanges: [[], [], [], [], ["delivery-small@1.1.0"], [], [], []],
  flowLoadPrior: 8,
  distribution: { feature: 4, defect: 2, risk: 1, debt: 0 },
  shapes: [{ shapeKey: "delivery-small", shapeRef: "delivery-small@1.0.0", roomsInFlow: 5, flowTimeP50Ms: 20 * H, runs: 6, bottleneck: { stageKey: "merge", roomsHeld: 3, cause: "awaiting-person" }, held: [{ stageKey: "merge", roomsHeld: 3, cause: "awaiting-person" }] }],
  points: { inFlight: 34, delivered: 21 },
  ai: { runs: 4, tokens: 12_000, recordedUsd: 1.5, subscriptionTokens: 0, durationMs: 0 },
  ...overrides,
});

describe("PortfolioFlowTiles", () => {
  it("shows the five measures with their change against the prior window", () => {
    render(<PortfolioFlowTiles flow={flow("manufactureAndDeliver")} areaHref="/area/delivery?view=work" t={t} />);
    expect(screen.getByText("In flow now")).toBeInTheDocument();
    expect(screen.getByText("1d 6h")).toBeInTheDocument();
    expect(screen.getByText(/−10h vs prior 28 days/)).toBeInTheDocument();
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("2.3")).toBeInTheDocument();
    expect(screen.getByText("34 pts")).toBeInTheDocument();
    expect(screen.getByText(/AI on these rooms, last 28 days: \$1\.50 recorded/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Median flow time per week/ })).toBeInTheDocument();
    // Flow time, efficiency and throughput each have a weekly trend.
    // Load has no trend or change until a room ending closes its run (BI-B0E285FB).
    expect(screen.queryByRole("img", { name: /Rooms in flow at the end of each week/ })).toBeNull();
    expect(screen.getByRole("img", { name: /Flow efficiency per week/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Runs finished per week/ })).toBeInTheDocument();
    expect(screen.queryByText(/−1 vs prior 28 days/)).toBeNull();
    // The week a shape version replaced an earlier one is marked on each trend, in its accessible name too.
    expect(screen.getByRole("img", { name: /Flow efficiency per week.*New shape version: delivery-small@1\.1\.0/ })).toBeInTheDocument();
  });

  it("names subscription AI use as tokens, never as $0", () => {
    const ai = { runs: 988, tokens: 832_337, recordedUsd: null, subscriptionTokens: 832_337, durationMs: 0 };
    render(<PortfolioFlowTiles flow={flow("manufactureAndDeliver", { ai })} areaHref="/area/delivery?view=work" t={t} />);
    expect(screen.getByText(/AI on these rooms, last 28 days: subscription: \$0 recorded, 832\.3k tokens/)).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it("links each shape to its drill-in and names where it waits", () => {
    render(<PortfolioFlowTiles flow={flow("manufactureAndDeliver")} areaHref="/area/delivery?view=work" t={t} />);
    const link = screen.getByRole("link", { name: getWorkShape("delivery-small")!.title });
    expect(link).toHaveAttribute("href", "/area/delivery?view=work&shape=delivery-small");
    expect(screen.getByText("3 at merge · waiting on a person")).toBeInTheDocument();
  });

  it("says so when nothing is in flow, and shows dashes instead of invented numbers", () => {
    render(<PortfolioFlowTiles flow={flow("forEmployees", { flowLoad: 0, shapes: [], flowTime: { p50Ms: null, priorP50Ms: null, runs: 0 }, flowEfficiency: { value: null, prior: null } })} areaHref="/area/team?view=work" t={t} />);
    expect(screen.getByText("No rooms in this area are in flow right now.")).toBeInTheDocument();
    expect(screen.getByText("No runs finished yet")).toBeInTheDocument();
  });
});

describe("ShapeFlowDrillIn", () => {
  const definition = getWorkShape("delivery-small")!;
  const model = buildShapeFlowMap({
    definition,
    snapshots: [],
    liveCounts: new Map([[`wr:${definition.key}@${definition.version}:merge`, { wip: 3, depth: 3 }]]),
    now: new Date(),
  });
  const shapeRef = `${definition.key}@${definition.version}`;
  const H = 3_600_000;
  const today = new Date().toISOString().slice(0, 10);
  const firstKey = definition.stages[0]!.key;
  const stepMeasures = computeShapeStepMeasures({
    shapeRef,
    stages: model.stages.map((stage) => ({ key: stage.key, title: stage.title })),
    // The first step has history; the rest do not.
    snapshots: [{ queueKey: `wr:${shapeRef}:${firstKey}`, period: today, throughput: 6, cycleP50Ms: 10 * H, processP50Ms: 2 * H, firstPassYield: 0.5 }],
    liveCounts: new Map([[`wr:${shapeRef}:merge`, { wip: 3, depth: 3 }]]),
    now: new Date(),
  });
  const view: ShapeFlowView = {
    model,
    versions: [definition.version, "0.9.0"],
    roomsAtStep: [{ capsuleId: "WC-1", title: "Fix login", href: "/workspace/cases/x", state: "blocked", cause: "conformance_pause" }],
    stepMeasures,
    reviews: {
      baselineFrom: "2026-07-01",
      baselineTo: "2026-07-29",
      baseline: { exits: 20, stepDwellMs: 10 * H, flowEfficiency: 0.1 },
      firstReviewOn: "2026-07-29",
      receipts: [
        { reviewedOn: "2026-08-26", current: { exits: 12, stepDwellMs: 4 * H, flowEfficiency: 0.25 }, bottleneck: { stageKey: "merge", title: "Merge", roomsHeld: 3, waitMs: 48 * H, cause: "awaiting-person" } },
        { reviewedOn: "2026-07-29", current: { exits: 2, stepDwellMs: null, flowEfficiency: null }, bottleneck: null },
      ],
    },
    reviewEveryDays: 28,
  };

  it("draws the shape across its rooms with queue counts, a version picker and the rooms at a step", () => {
    render(<ShapeFlowDrillIn view={view} backHref="/area/delivery?view=work" baseHref="/area/delivery?view=work" stageKey="merge" t={t} />);
    expect(screen.getByRole("button", { name: /^Merge.*3 rooms here, 3 waiting/ })).toBeInTheDocument();
    const versions = screen.getByRole("navigation", { name: "Shape version" });
    expect(within(versions).getByRole("link", { name: `v${definition.version}` })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Fix login" })).toBeInTheDocument();
    expect(screen.getByText("Blocked: conformance pause")).toBeInTheDocument(); // no deviation recorded on this room
  });

  it("shows a data box per step and the timeline ladder: process above, wait below, flow efficiency", () => {
    render(<ShapeFlowDrillIn view={view} backHref="/area/delivery?view=work" baseHref="/area/delivery?view=work" stageKey={null} t={t} />);
    const steps = screen.getByRole("region", { name: "Where the time goes, step by step" });
    // Measured step: dwell, process and first-pass yield.
    expect(within(steps).getByText("10h")).toBeInTheDocument();
    expect(within(steps).getAllByText("2h").length).toBeGreaterThan(0);
    expect(within(steps).getByText("50%")).toBeInTheDocument();
    // Merge: its queue, and too few exits to measure.
    expect(within(steps).getByText("3 waiting · 3 in step")).toBeInTheDocument();
    expect(within(steps).getAllByText(/Too few to measure \(0 of 5 exits\)/).length).toBeGreaterThan(0);
    // Ladder: 2h process, 8h wait, 20% efficiency; the unmeasured steps are named as left out.
    expect(within(steps).getByRole("list", { name: /Timeline: process time above/ })).toBeInTheDocument();
    expect(within(steps).getByText(/Process 2h · wait 8h · flow efficiency 20%\./)).toBeInTheDocument();
    expect(within(steps).getByText(/step\(s\) left out: too few exits to measure/)).toBeInTheDocument();
  });
});

describe("FlowReviews in the drill-in", () => {
  const H = 3_600_000;
  it("lists each review against the version's baseline and names where the most waiting accrued", () => {
    const definition = getWorkShape("delivery-small")!;
    const model = buildShapeFlowMap({ definition, snapshots: [], liveCounts: new Map(), now: new Date() });
    const view: ShapeFlowView = {
      model, versions: [definition.version], roomsAtStep: null,
      stepMeasures: { steps: [], ladder: null },
      reviews: {
        baselineFrom: "2026-07-01", baselineTo: "2026-07-29",
        baseline: { exits: 20, stepDwellMs: 10 * H, flowEfficiency: 0.1 },
        firstReviewOn: "2026-07-29",
        receipts: [
          { reviewedOn: "2026-08-26", current: { exits: 12, stepDwellMs: 4 * H, flowEfficiency: 0.25 }, bottleneck: { stageKey: "merge", title: "Merge", roomsHeld: 3, waitMs: 48 * H, cause: "awaiting-person" } },
          { reviewedOn: "2026-07-29", current: { exits: 2, stepDwellMs: null, flowEfficiency: null }, bottleneck: null },
        ],
      },
      reviewEveryDays: 28,
    };
    render(<ShapeFlowDrillIn view={view} backHref="/a" baseHref="/a" stageKey={null} t={t} />);
    const reviews = screen.getByRole("region", { name: "Flow reviews, every 28 days" });
    // Snapshots are per shape version, so the panel says its reviews span every area.
    expect(within(reviews).getByText(/Reviews cover every room on this shape version, in every area/)).toBeInTheDocument();
    expect(within(reviews).getByText(/Baseline, 2026-07-01 to 2026-07-29: a step typically takes 10h, flow efficiency 10%, 20 steps finished\./)).toBeInTheDocument();
    expect(within(reviews).getByText(/A step typically takes 4h \(baseline 10h\); flow efficiency 25% \(baseline 10%\)\./)).toBeInTheDocument();
    expect(within(reviews).getByText(/Most waiting: Merge, 3 held, typically waiting 2d\. Held because: waiting on a person\./)).toBeInTheDocument();
    expect(within(reviews).getByText(/Too few steps finished in the last 28 days to compare \(2 of 5\)\./)).toBeInTheDocument();
    expect(within(reviews).getByText("Nothing was held at this review.")).toBeInTheDocument();
  });

  it("says when the first review is due before the baseline is complete", () => {
    const definition = getWorkShape("delivery-small")!;
    const model = buildShapeFlowMap({ definition, snapshots: [], liveCounts: new Map(), now: new Date() });
    const base = { model, versions: [definition.version], roomsAtStep: null, stepMeasures: { steps: [], ladder: null }, reviewEveryDays: 7 };
    const { unmount } = render(<ShapeFlowDrillIn view={{ ...base, reviews: { baselineFrom: "2026-10-01", baselineTo: "2026-10-29", baseline: { exits: 1, stepDwellMs: null, flowEfficiency: null }, firstReviewOn: "2026-10-29", receipts: [] } }} backHref="/a" baseHref="/a" stageKey={null} t={t} />);
    expect(screen.getByText("The first review is on 2026-10-29, once the four-week baseline is complete.")).toBeInTheDocument();
    unmount();
    render(<ShapeFlowDrillIn view={{ ...base, reviews: null }} backHref="/a" baseHref="/a" stageKey={null} t={t} />);
    expect(screen.getByText("No review yet: this version has no step data.")).toBeInTheDocument();
  });
});

describe("PortfolioFlowComparison", () => {
  it("puts the four portfolios and the unplaced rooms side by side", () => {
    const flows = (["productsAndServicesSold", "manufactureAndDeliver", "forEmployees", "foundational", "unplaced"] as const).map((k) => flow(k, k === "unplaced" ? { points: null } : {}));
    render(<PortfolioFlowComparison flows={flows} areaHrefByRole={{ manufactureAndDeliver: "/area/delivery?view=work" }} t={t} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Manufacturing and delivery" })).toHaveAttribute("href", "/area/delivery?view=work");
    expect(screen.getByRole("columnheader", { name: "Unplaced" })).toBeInTheDocument();
  });
});
