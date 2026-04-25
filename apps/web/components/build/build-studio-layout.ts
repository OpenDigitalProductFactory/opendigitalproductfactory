export const BUILD_STUDIO_TEST_IDS = {
  shell: "build-studio-shell",
  graphPanel: "build-studio-graph-panel",
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
    ? `${base} w-[244px] xl:w-[272px]`
    : `${base} w-0 overflow-hidden border-r-0`;
}

export function getBuildStudioGraphPanelClassName() {
  return "flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3 pt-3 lg:px-4 lg:pb-4";
}
