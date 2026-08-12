"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { SectionNav } from "@/components/shell/SectionNav";

// "Grid" is deliberately NOT a tab (BI-00CB9CCC). The grid is a *view mode* of the
// Directory — the in-place-view-toggle pattern this platform standardised on
// (2026-06-06-workbooks-per-surface-integration-design §4) — reached via the
// List/Grid/Board switcher inside Directory, not a sibling destination.
const TABS = [
  { label: "Directory", value: "directory" },
  { label: "Workforce", value: "workforce" },
  { label: "Organization", value: "orgchart" },
  { label: "Timesheets", value: "timesheets" },
  { label: "Time off", value: "timeoff" },
  { label: "Policies", value: "mypolicies" },
  // Recruiting is its own route (/employee/recruiting), not a ?view= mode — a
  // jump-off to the unified recruiting funnel (BI-9CC44DC7).
  { label: "Recruiting", value: "recruiting" },
] as const;

const ROUTE_TABS: Partial<Record<string, string>> = {
  recruiting: "/employee/recruiting",
};

export type EmployeeTab = (typeof TABS)[number]["value"];

// Rendering is delegated to the shared SectionNav (BI-ARCH-SECTIONNAV); this wrapper
// owns active state and the in-place `?view=` switch. Employee uses the flat tab style
// in button mode (the tabs switch a query-param view rather than navigating to a route).

export function EmployeeTabNav() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawView = searchParams.get("view");
  // grid/board are Directory view modes, not tabs — keep Directory lit for them
  // so the switcher never leaves the tab strip with nothing active.
  const currentTab =
    rawView === null || rawView === "grid" || rawView === "board" ? "directory" : rawView;

  function handleClick(value: string) {
    const routeTarget = ROUTE_TABS[value];
    if (routeTarget) {
      router.push(routeTarget);
      return;
    }
    const params = new URLSearchParams(searchParams.toString());
    if (value === "directory") {
      params.delete("view");
    } else {
      params.set("view", value);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "/employee", { scroll: false });
  }

  return (
    <SectionNav
      config={{
        variant: "flat",
        dataComponent: "employee-tab-nav",
        tabs: TABS.map((t) => ({
          key: t.value,
          label: t.label,
          active: currentTab === t.value,
          onSelect: () => handleClick(t.value),
        })),
      }}
    />
  );
}
