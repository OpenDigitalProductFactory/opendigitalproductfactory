import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("AiOperationsMap", () => {
  it("renders source and severity controls for managing projected activity", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("View controls");
    expect(source).toContain("Showing {filteredProjections.length} of {projections.length} activities");
    expect(source).toContain("SOURCE_OPTIONS");
    expect(source).toContain("SEVERITY_OPTIONS");
    expect(source).toContain("Quick views");
    expect(source).toContain("OPERATIONS_MAP_QUICK_VIEWS");
    expect(source).toContain("applyQuickView");
    expect(source).toContain("Reset view");
    expect(source).toContain("resetView");
    expect(source).toContain("clearOperationsMapViewPreference");
    expect(source).toContain("loadOperationsMapViewPreference");
    expect(source).toContain("saveOperationsMapViewPreference");
    expect(source).toContain("toggleSourceFilter");
    expect(source).toContain("toggleSeverityFilter");
  });

  it("renders the provider routing topology with route symbols and timeline labels", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("routingTopology");
    expect(source).toContain("Provider routing topology");
    expect(source).toContain("aria-label=\"Provider routing topology\"");
    expect(source).toContain("Route decision");
    expect(source).toContain("Limit / quota");
    expect(source).toContain("Error / outage");
    expect(source).toContain("Failover path");
    expect(source).toContain("Scheduled future");
    expect(source).toContain("scheduled coworker invocation windows");
    expect(source).not.toContain("scheduled routing windows");
    expect(source).toContain("Current routing");
    expect(source).toContain("Future schedule");
    expect(source).toContain("<svg");
    expect(source).toContain("markerEnd");
    expect(source).toContain("Zoom out");
    expect(source).toContain("Zoom in");
    expect(source).toContain("Reset zoom");
    expect(source).toContain("Route filter");
    expect(source).toContain("Provider filter");
    expect(source).toContain("Provider type");
    expect(source).toContain("LLM providers");
    expect(source).toContain("MCP servers");
    expect(source).toContain("providerTypeFilter");
    expect(source).toContain("providerMatchesTypeFilter");
    expect(source).toContain("controlFilteredRoutes");
    expect(source).toContain("replayFilteredRoutes");
    expect(source).toContain("displayRoutes");
    expect(source).toContain("routingLineStroke");
    expect(source).toContain("routingLineDasharray");
    expect(source).toContain("animateMotion");
    expect(source).toContain("routeDecisionPoint");
    expect(source).toContain("data-route-symbol");
    expect(source).toContain("RoutingSymbolGlyph");
    expect(source).toContain("providerMarkersByProviderId");
    expect(source).toContain("coworkerMarkersByCoworkerId");
    expect(source).toContain("coworkerMarkerCaption");
    expect(source).toContain("routingMarkerStroke");
    expect(source).toContain("isUnattributedRouteDecisionMarker");
    expect(source).toContain("data-unattributed-router-source");
    expect(source).toContain("Router audit");
    expect(source).toContain("Coworker missing");
    expect(source).not.toContain("symbolGlyph");
  });

  it("keeps the first viewport focused on a graphical routing map instead of dashboard cards", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-label=\"Routing map workspace\"");
    expect(source).toContain("min-h-[calc(100vh-9rem)]");
    expect(source).toContain("MapSymbolRail");
    expect(source).toContain("RouteStyleRail");
    expect(source).toContain("aria-label=\"Routing replay timeline\"");
    expect(source).toContain("aria-label=\"Activity projection details\"");
    expect(source).not.toContain("xl:grid-cols-[minmax(0,1fr)_320px]");
    expect(source).not.toContain(">Decision symbols<");
  });

  it("supports replay, symbol inspection, thinner traffic, vertical spacing, and spend rollups", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("setReplayTimestamp");
    expect(source).toContain("timelineCenterTimestamp");
    expect(source).toContain("zoomTimelineAroundPlayhead");
    expect(source).toContain("resetTimelineZoom");
    expect(source).toContain("selectedReplayTime");
    expect(source).toContain("type=\"range\"");
    expect(source).toContain("aria-label=\"Routing replay cursor\"");
    expect(source).toContain("timelineMarkerPosition");
    expect(source).toContain("RoutingSymbolDetail");
    expect(source).toContain("data-symbol-detail-popover");
    expect(source).toContain("Coworker");
    expect(source).toContain("Not recorded on this routing event");
    expect(source).toContain("routeSymbolCaption");
    expect(source).toContain("caption={routeSymbolCaption");
    expect(source).toContain("onInspect");
    expect(source).toContain("symbolDetailAnchor");
    expect(source).toContain("anchorSymbolDetail");
    expect(source).toContain("data-symbol-detail-anchor");
    expect(source).toContain("pinnedMarkerId");
    expect(source).toContain("onSelectInspect");
    expect(source).toContain("onKeyDown");
    expect(source).toContain("aggregateRoutesForDisplay");
    expect(source).toContain("sourceRouteIds");
    expect(source).toContain("routingSummary");
    expect(source).toContain("Spend");
    expect(source).toContain("Tokens");
    expect(source).toContain("formatCurrency");
    expect(source).toContain("formatTokenCount");
    expect(source).toContain("Math.min(5, 1.25 + trafficWeight * 0.45)");
    expect(source).toContain("ROUTING_LAYOUT");
    expect(source).toContain("width: 1080");
    expect(source).toContain("providerNodeX: 852");
    expect(source).toContain("visibleCoworkerIds");
    expect(source).toContain("visibleProviderIds");
    expect(source).toContain("routedProviderIds");
    expect(source).toContain("prioritizeRoutingNodeIds");
    expect(source).toContain("priorityIds?: ReadonlySet<string>");
  });

  it("uses the rich symbol detail popover instead of native SVG title tooltips", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("aria-label={`${label}: ${summary}`}");
    expect(source).toContain("data-symbol-detail-popover");
    expect(source).not.toContain("<title>{`${label}: ${summary}`}</title>");
  });

  it("shows configured inactive providers as topology nodes even without active routes", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("configured / inactive");
    expect(source).toContain("providerNodeStateLabel");
    expect(source).toContain("providerNodeStroke");
    expect(source).toContain("data-provider-state");
    expect(source).toContain("configured-inactive");
    expect(source).toContain("providerTypeFilteredProviders.forEach");
    expect(source).toContain("visibleProviders.length > 0 || visibleCoworkers.length > 0");
  });

  it("renders provider nodes with known provider logo marks instead of generic symbols", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("ProviderLogoMark");
    expect(source).toContain("ProviderBrandGlyph");
    expect(source).toContain("providerLogoFor");
    expect(source).toContain("PROVIDER_LOGO_MATCHERS");
    expect(source).toContain("data-provider-logo");
    expect(source).toContain("Claude");
    expect(source).toContain("OpenAI");
    expect(source).toContain("Gemini");
    expect(source).toContain("Ollama");
    expect(source).toContain("GitHub");
    expect(source).toContain("Postgres");
    expect(source).toContain("Browser");
    expect(source).toContain("aria-label={`${provider.label} logo`}");
  });

  it("renders routing replay as a video-style timeline with visible playhead and time ticks", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("buildTimelineTicks");
    expect(source).toContain("RoutingTimelineTick");
    expect(source).toContain("formatTickLabel");
    expect(source).toContain("timelineSpanLabel");
    expect(source).toContain("formatTimelineSpan");
    expect(source).toContain("data-routing-playhead");
    expect(source).toContain("aria-label=\"Selected replay time\"");
    expect(source).toContain("bg-[var(--dpf-error)]");
    expect(source).toContain("data-routing-event-marker");
    expect(source).toContain("Time scale");
    expect(source).toContain("ROUTING_TIMELINE_ZOOM_LEVELS");
    expect(source).toContain("buildTimelineWindow");
    expect(source).toContain("clampTimelineTimestamp");
    expect(source).toContain("timelineMarkerInRange");
    expect(source).toContain("Zoom time scale in");
    expect(source).toContain("Reset time scale");
    expect(source).toContain("zoomLabel");
  });

  it("offers a Provider/A2A/Both dimension toggle that focuses the map and persists", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    // Toggle control + options.
    expect(source).toContain("DimensionToggle");
    expect(source).toContain("DIMENSION_OPTIONS");
    expect(source).toContain("aria-label=\"Operations map dimension\"");
    expect(source).toContain("Provider routes");
    expect(source).toContain("A2A interactions");
    // Conditional rendering of the provider band vs the A2A panels.
    expect(source).toContain("showProvider");
    expect(source).toContain("showA2a");
    expect(source).toContain("showProvider ? (");
    expect(source).toContain("<RoutingTopologyPanel");
    expect(source).toContain("showA2a ? (");
    expect(source).toContain("<A2aInteractionsPanel");
    expect(source).toContain("<DeliberationLensPanel");
    // Persistence wiring.
    expect(source).toContain("loadOperationsMapDimension");
    expect(source).toContain("saveOperationsMapDimension");
    expect(source).toContain("dimensionHydrated");
  });

  it("shares the replay playhead between the provider timeline and the A2A band", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    // Provider panel publishes the playhead up via a stable callback.
    expect(source).toContain("onReplayChange");
    expect(source).toContain("onReplayChange?.(selectedReplayTime, timelineRange)");
    expect(source).toContain("handleReplayChange");
    expect(source).toContain("useCallback");
    expect(source).toContain("setSharedReplay");
    // A2A band receives the shared replay window.
    expect(source).toContain("replayTime={showProvider ? sharedReplay?.time ?? null : null}");
    expect(source).toContain("replayRange={showProvider ? sharedReplay?.range ?? null : null}");
  });

  it("cuts over to one authoritative unified canvas wired to shared dimension + replay (Stage E)", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("canvasPreview");
    expect(source).not.toContain("data-canvas-preview-toggle");
    expect(source).toContain("data-authoritative-operations-canvas");
    expect(source).toContain('aria-label="Unified operations topology"');
    expect(source).toContain("<OperationsTopologyCanvas");
    expect(source).toContain("topology={canvasTopology}");
    expect(source).toContain("dimension={dimension}");
    expect(source).toContain("replayTime={sharedReplay?.time ?? null}");
    expect(source).toContain("replayRange={sharedReplay?.range ?? null}");
    expect(source).toContain('aria-label="Technical routing diagnostics"');
    expect(source).toContain("onReplayChange={handleReplayChange}");
  });

  it("feeds the authoritative canvas a control-filtered topology the diagnostics publish up", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    // Shared pure filter helpers (single source of truth for canvas + panels).
    expect(source).toContain('from "./operations-control-filters"');
    expect(source).toContain("applyRoutingControlFilters(routingTopology, routingControl)");
    expect(source).toContain("applyA2aControlFilters(routingTopology.a2aEdges, a2aControl)");

    // Panels publish their resolved criteria up (mirrors onReplayChange).
    expect(source).toContain("onControlFilterChange={handleRoutingControlChange}");
    expect(source).toContain("onFilterChange={handleA2aControlChange}");

    // The canvas consumes the filtered topology, not the raw one.
    expect(source).toContain("topology={canvasTopology}");
  });

  it("renders an activity-level routing workbench from the topology DTO", () => {
    const source = readFileSync(new URL("./AiOperationsMap.tsx", import.meta.url), "utf8");

    expect(source).toContain("ActivityRoutingWorkbench");
    expect(source).toContain('from "./ActivityRoutingWorkbench"');
    expect(source).not.toContain('from "@/lib/actions/activity-harness-routing"');
    expect(source).toContain("routingTopology.activityRouting");
  });
});
