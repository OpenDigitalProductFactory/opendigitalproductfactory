export const BUILD_STUDIO_TEST_IDS = {
  shell: "build-studio-shell",
  graphPanel: "build-studio-graph-panel",
  buildListItem: "build-studio-build-list-item",
} as const;

export function getBuildStudioShellClassName() {
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

export function getBuildStudioSidebarClassName(sidebarOpen: boolean) {
  const base = "border-r border-[var(--dpf-border)] flex flex-col bg-[var(--dpf-surface-1)] transition-all duration-200";

  return sidebarOpen
    ? `${base} w-[280px] xl:w-[320px]`
    : `${base} w-0 overflow-hidden border-r-0`;
}

export function shouldOpenBuildStudioSidebarByDefault(viewportWidth?: number) {
  return viewportWidth == null || viewportWidth >= 1024;
}

export function getBuildStudioGraphPanelClassName() {
  return "flex min-h-[420px] min-w-0 flex-1 flex-col overflow-hidden px-4 pb-4 pt-3";
}
