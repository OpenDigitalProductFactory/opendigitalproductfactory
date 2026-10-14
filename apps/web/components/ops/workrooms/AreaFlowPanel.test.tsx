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
  flowLoadPrior: 8,
  distribution: { feature: 4, defect: 2, risk: 1, debt: 0 },
  shapes: [{ shapeKey: "delivery-small", shapeRef: "delivery-small@1.0.0", roomsInFlow: 5, flowTimeP50Ms: 20 * H, runs: 6, bottleneck: { stageKey: "merge", roomsHeld: 3, cause: "awaiting-person" } }],
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
    // Every measure has its weekly trend; load also shows its change against four weeks ago.
    expect(screen.getByRole("img", { name: /Rooms in flow at the end of each week/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Flow efficiency per week/ })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Runs finished per week/ })).toBeInTheDocument();
    expect(screen.getByText(/−1 vs prior 28 days/)).toBeInTheDocument();
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

describe("PortfolioFlowComparison", () => {
  it("puts the four portfolios and the unplaced rooms side by side", () => {
    const flows = (["productsAndServicesSold", "manufactureAndDeliver", "forEmployees", "foundational", "unplaced"] as const).map((k) => flow(k, k === "unplaced" ? { points: null } : {}));
    render(<PortfolioFlowComparison flows={flows} areaHrefByRole={{ manufactureAndDeliver: "/area/delivery?view=work" }} t={t} />);
    expect(screen.getAllByRole("columnheader")).toHaveLength(6);
    expect(screen.getByRole("link", { name: "Manufacturing and delivery" })).toHaveAttribute("href", "/area/delivery?view=work");
    expect(screen.getByRole("columnheader", { name: "Unplaced" })).toBeInTheDocument();
  });
});
