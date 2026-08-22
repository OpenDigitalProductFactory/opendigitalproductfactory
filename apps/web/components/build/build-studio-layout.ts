// apps/web/components/build/build-studio-layout.ts
//
// Centralizes the Build Studio layout primitives so the BuildStudio shell,
// FleetRail, ActionBanner, NodeInspector, DetailsDrawer, OpenSandboxButton,
// and integration tests all reference one source of truth for zone class
// names, test IDs, and breakpoint rules.
//
// All class strings use DPF CSS variables (var(--dpf-...)) — no hex literals.
// This is non-negotiable per the chief-architect review in
// docs/superpowers/specs/2026-05-20-build-studio-layout-redesign-design.md.

/* ────────────────────────────────────────────────────────────────────────── */
/* Test IDs                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */

export const BUILD_STUDIO_TEST_IDS = {
  shell: "build-studio-shell",
  fleet: "build-studio-fleet",
  fleetHeader: "build-studio-fleet-header",
  active: "build-studio-active",
  actionBanner: "build-studio-action-banner",
  coworker: "build-studio-coworker",
  footer: "build-studio-footer",
  openSandbox: "build-studio-open-sandbox",
  workflowCanvas: "build-studio-workflow-canvas",
  graphPanel: "build-studio-graph-panel",
  nodeInspector: "build-studio-node-inspector",
  nodeInspectorExpand: "build-studio-node-inspector-expand",
  detailsDrawer: "build-studio-details-drawer",
  detailsDrawerPill: "build-studio-details-drawer-pill",
  buildListItem: "build-studio-build-list-item",
  phaseMiniRail: "build-studio-phase-mini-rail",
  queueStateBadge: "build-studio-queue-state-badge",
} as const;

export type BuildStudioTestId = keyof typeof BUILD_STUDIO_TEST_IDS;

/* ────────────────────────────────────────────────────────────────────────── */
/* Width + density tokens                                                     */
/* ────────────────────────────────────────────────────────────────────────── */

/** Fleet rail width: narrower than the legacy sidebar to reclaim space for the canvas. */
export const FLEET_WIDTH_CLASS = "w-[150px] xl:w-[180px]";

/** Compact build list item — fleet density limits row to ≤32px. */
export const FLEET_ROW_HEIGHT_CLASS = "max-h-8 min-h-8";

/** Single source of truth for the 40px pinned ActionBanner height. */
export const ACTION_BANNER_HEIGHT_CLASS = "h-10";

/** Workflow canvas minimum interaction height. */
export const WORKFLOW_CANVAS_MIN_HEIGHT_CLASS = "min-h-[420px]";

/** DetailsDrawer width: min(480px, 40vw) — see §5 of the design spec. */
export const DETAILS_DRAWER_WIDTH_CLASS = "w-[min(480px,40vw)]";

/* ────────────────────────────────────────────────────────────────────────── */
/* Zone class names — legacy + new                                            */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Existing shell class — preserved for backward compatibility with callers
 * still using the legacy sidebar layout. New three-zone code should use
 * {@link getBuildStudioZoneShellClassName} instead.
 */
export function getBuildStudioShellClassName(): string {
  return [
    "flex",
    "min-h-full",
    "flex-col",
    "overflow-hidden",
    "rounded-[24px]",
    "border",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-1)]",
    "shadow-dpf-md",
  ].join(" ");
}

/**
 * Existing sidebar class — preserved. The fleet rail uses
 * {@link getFleetRailClassName} instead.
 */
export function getBuildStudioSidebarClassName(sidebarOpen: boolean): string {
  const base =
    "border-r border-[var(--dpf-border)] flex flex-col bg-[var(--dpf-surface-1)] transition-all duration-200";

  return sidebarOpen
    ? `${base} w-[280px] xl:w-[320px]`
    : `${base} w-0 overflow-hidden border-r-0`;
}

export function shouldOpenBuildStudioSidebarByDefault(viewportWidth?: number): boolean {
  return viewportWidth == null || viewportWidth >= 1024;
}

/**
 * Existing graph panel class — preserved. New three-zone layout uses
 * {@link getWorkflowCanvasClassName} which fills the active zone instead.
 */
export function getBuildStudioGraphPanelClassName(): string {
  return "flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3";
}

/* ── New three-zone class helpers ────────────────────────────────────────── */

/**
 * Outer flex container holding the three zones (fleet | active | coworker)
 * plus the footer slot beneath.
 */
export function getBuildStudioZoneShellClassName(): string {
  return [
    "grid",
    "min-h-full",
    "w-full",
    "grid-rows-[1fr_auto]",
    "overflow-hidden",
    "rounded-[24px]",
    "border",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-1)]",
    "shadow-dpf-md",
  ].join(" ");
}

/**
 * Top row of the zone shell — holds the three side-by-side zones.
 */
export function getBuildStudioZoneRowClassName(): string {
  return "flex min-h-0 w-full flex-1 overflow-hidden";
}

/**
 * Compact fleet rail (left zone).
 */
export function getFleetRailClassName(): string {
  return [
    "flex",
    "min-h-0",
    "shrink-0",
    "flex-col",
    "border-r",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-1)]",
    FLEET_WIDTH_CLASS,
  ].join(" ");
}

/**
 * Active build zone (center) — hosts the ActionBanner and the WorkflowCanvas.
 */
export function getActiveZoneClassName(): string {
  return [
    "flex",
    "min-h-0",
    "min-w-0",
    "flex-1",
    "flex-col",
    "bg-[var(--dpf-surface-1)]",
  ].join(" ");
}

/**
 * AI Coworker zone (right) — width is owned by the existing coworker panel;
 * this helper exists only so the shell can hang a test ID on the container
 * for bounding-box assertions.
 */
export function getCoworkerZoneClassName(): string {
  return "flex min-h-0 shrink-0 flex-col border-l border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]";
}

/**
 * Footer slot — hosts the single OpenSandboxButton and any future global
 * status. Sits BELOW the three zones, outside the workflow region.
 */
export function getBuildStudioFooterClassName(): string {
  return [
    "flex",
    "h-12",
    "shrink-0",
    "items-center",
    "justify-between",
    "border-t",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-2)]",
    "px-4",
    "py-2",
  ].join(" ");
}

/**
 * Workflow canvas region — fills the active zone below the ActionBanner.
 */
export function getWorkflowCanvasClassName(): string {
  return [
    "relative",
    "flex",
    "min-h-0",
    "min-w-0",
    "flex-1",
    "flex-col",
    "overflow-hidden",
    WORKFLOW_CANVAS_MIN_HEIGHT_CLASS,
  ].join(" ");
}

/**
 * DetailsDrawer container — slides in from the right edge of the workflow
 * region. NEVER covers the coworker zone (the parent shell already separates them).
 */
/**
 * The centre content pane. When the DetailsDrawer is open it reserves the
 * drawer's width as right padding.
 *
 * The drawer is `absolute right-0 z-20`, so it OVERLAYS rather than displaces:
 * the canvas kept its full width and its text was occluded mid-sentence with no
 * reflow and no scroll affordance. Reserving the width here restores reflow
 * while keeping the drawer's translate-x slide (a flex sibling would have to
 * animate width instead, which is visibly janky).
 *
 * Padding is dropped below the `lg` breakpoint, where the drawer covers most of
 * the viewport and displacing the canvas would leave nothing readable.
 */
export function getBuildStudioContentPaneClassName(drawerOpen: boolean): string {
  const base = "flex min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-[var(--dpf-surface-1)] transition-[padding] duration-200 motion-reduce:transition-none";
  return drawerOpen ? `${base} lg:pr-[min(480px,40vw)]` : base;
}

export function getDetailsDrawerClassName(isOpen: boolean): string {
  const base = [
    "absolute",
    "right-0",
    "top-0",
    "bottom-0",
    "z-20",
    "flex",
    "min-h-0",
    "flex-col",
    "border-l",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-1)]",
    "shadow-dpf-md",
    "transition-transform",
    "duration-200",
    "motion-reduce:transition-none",
    DETAILS_DRAWER_WIDTH_CLASS,
  ].join(" ");
  return isOpen ? `${base} translate-x-0` : `${base} translate-x-full`;
}

/**
 * Thin 24px DetailsDrawer pill on the right edge of the workflow canvas.
 */
export function getDetailsDrawerPillClassName(): string {
  return [
    "absolute",
    "right-0",
    "top-1/2",
    "z-10",
    "flex",
    "h-24",
    "w-6",
    "-translate-y-1/2",
    "items-center",
    "justify-center",
    "rounded-l-md",
    "border",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-2)]",
    "text-xs",
    "font-medium",
    "text-[var(--dpf-muted)]",
    "hover:text-[var(--dpf-text)]",
    "focus-visible:outline-2",
    "focus-visible:outline-offset-2",
    "focus-visible:outline-[var(--dpf-accent)]",
  ].join(" ");
}

/**
 * Fleet rail header — shows the operator focus summary
 * (`Needs you: N · Working: N · Waiting: N · Parked: N`).
 * Uses `role="status"` + `aria-live="polite"` (set on the element itself, not here).
 */
export function getFleetRailHeaderClassName(): string {
  return [
    "flex",
    "shrink-0",
    "items-center",
    "justify-between",
    "border-b",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-2)]",
    "px-3",
    "py-2",
    "text-xs",
    "font-semibold",
    "text-[var(--dpf-text)]",
  ].join(" ");
}

/**
 * Fleet rail body — scrollable list of compact BuildListItems.
 */
export function getFleetRailBodyClassName(): string {
  return "flex min-h-0 flex-1 flex-col overflow-y-auto p-1";
}

/**
 * NodeInspector container class — positioned absolutely inside the workflow
 * canvas. The actual top/left come from getInspectorPlacement() at render time.
 */
export function getNodeInspectorClassName(): string {
  return [
    "absolute",
    "z-30",
    "flex",
    "max-h-[80%]",
    "flex-col",
    "rounded-lg",
    "border",
    "border-[var(--dpf-border)]",
    "bg-[var(--dpf-surface-1)]",
    "shadow-dpf-md",
    "outline-none",
  ].join(" ");
}
