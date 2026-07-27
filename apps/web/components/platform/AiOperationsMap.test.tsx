import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AiOperationsMap cutover", () => {
  const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

  it("keeps the owner-readable Designed/Observed/Compare view first", () => {
    const overview = source.indexOf("<RoutingArchitectureOverview");
    const topology = source.indexOf("<OperationsTopologyControls");
    expect(overview).toBeGreaterThan(-1);
    expect(topology).toBeGreaterThan(overview);
    expect(source).toContain('aria-label="Routing map workspace"');
  });

  it("uses one authoritative topology, control rail, replay window, and evidence table", () => {
    expect(source).toContain("<OperationsTopologyControls");
    expect(source).toContain("<OperationsTopologyCanvas");
    expect(source).toContain("topology={canvasTopology}");
    expect(source).toContain("onReplayChange={handleReplayChange}");
    expect(source).toContain("onRoutingChange={handleRoutingControlChange}");
    expect(source).toContain("onA2aChange={handleA2aControlChange}");
    expect(source).toContain("replayTime={sharedReplay?.time ?? null}");
    expect(source).toContain("replayRange={sharedReplay?.range ?? null}");
    expect(source).toContain("data-authoritative-operations-canvas");
  });

  it("removes the superseded provider and A2A diagram panels", () => {
    expect(source).not.toContain("RoutingTopologyPanel");
    expect(source).not.toContain("A2aInteractionsPanel");
    expect(source).not.toContain('aria-label="Provider routing topology"');
    expect(source).not.toContain('aria-label="Coworker interaction map"');
    expect(source).not.toContain("canvasPreview");
  });

  it("keeps diagnostics progressively disclosed without duplicating topology", () => {
    expect(source).toContain('aria-label="Technical routing diagnostics"');
    expect(source).toContain("<ActivityRoutingWorkbench");
    expect(source).toContain("<DeliberationLensPanel");
  });

  it("preserves dimension and activity-filter preferences", () => {
    expect(source).toContain("loadOperationsMapDimension");
    expect(source).toContain("saveOperationsMapDimension");
    expect(source).toContain("loadOperationsMapViewPreference");
    expect(source).toContain("saveOperationsMapViewPreference");
    expect(source).toContain("OPERATIONS_MAP_QUICK_VIEWS");
    expect(source).toContain("SOURCE_OPTIONS");
    expect(source).toContain("SEVERITY_OPTIONS");
  });

  it("preserves station, coworker, projection, and stalled-run inspection", () => {
    expect(source).toContain("StationInspector");
    expect(source).toContain("AgentInspector");
    expect(source).toContain("ProjectionInspector");
    expect(source).toContain("StalledTaskRecoveryActions");
    expect(source).toContain("buildStationProjectionTiles");
  });
});
