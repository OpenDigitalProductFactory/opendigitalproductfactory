export type AdminFamilyKey =
  | "access"
  | "organization"
  | "contributing"
  | "health";

export type AdminFamily = {
  key: AdminFamilyKey;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

// EP-2FB6C0CC (spec §9, BI-3ED24FA2): the "Advanced" holding tab is retired. Each
// page has a family named for its job, and the family count stays at four. The
// same pages also appear in the Setup view of the area whose work reads them.
export const ADMIN_FAMILIES: AdminFamily[] = [
  {
    key: "access",
    label: "Access",
    href: "/admin",
    description: "Manage user access, roles, and controlled entry to the platform.",
    matchPrefixes: ["/admin"],
    subItems: [{ label: "Users & Roles", href: "/admin" }],
  },
  {
    key: "organization",
    label: "Organization & settings",
    href: "/admin/settings",
    description: "Shape organization identity, global settings and reference data.",
    matchPrefixes: [
      "/admin/settings",
      "/admin/branding",
      "/admin/business-context",
      "/admin/reference-data",
      "/admin/data-stewardship",
      "/admin/business-models",
      "/admin/archetypes",
      "/admin/operating-hours",
    ],
    subItems: [
      { label: "Settings", href: "/admin/settings" },
      { label: "Branding", href: "/admin/branding" },
      { label: "Reference Data", href: "/admin/reference-data" },
      { label: "Data Stewardship", href: "/admin/data-stewardship" },
      { label: "Business Models", href: "/admin/business-models" },
      { label: "Archetypes", href: "/admin/archetypes" },
    ],
  },
  {
    key: "contributing",
    label: "Contributing & GitHub",
    href: "/admin/platform-development",
    description: "Decide whether to share what you build, connect GitHub, and review contributions.",
    matchPrefixes: [
      "/admin/platform-development",
      "/admin/hive",
      "/admin/build-studio",
      "/admin/prompts",
      "/admin/skills",
    ],
    subItems: [
      { label: "Contributing & GitHub", href: "/admin/platform-development" },
      { label: "Hive Contributions", href: "/admin/hive" },
      { label: "Build stall thresholds", href: "/admin/build-studio/stall-thresholds" },
    ],
  },
  {
    key: "health",
    label: "Health & recovery",
    href: "/admin/backups",
    description: "Backups, scheduled jobs, diagnostics and issue reports.",
    matchPrefixes: [
      "/admin/backups",
      "/admin/scheduled-jobs",
      "/admin/diagnostics",
      "/admin/issue-reports",
      "/admin/cockpit",
      "/admin/graph-explorer",
    ],
    subItems: [
      { label: "Backups", href: "/admin/backups" },
      { label: "Scheduled Jobs", href: "/admin/scheduled-jobs" },
      { label: "Diagnostics", href: "/admin/diagnostics" },
      { label: "Issue Reports", href: "/admin/issue-reports" },
      { label: "Cockpit", href: "/admin/cockpit" },
      { label: "Graph Explorer", href: "/admin/graph-explorer" },
    ],
  },
];

export function getAdminFamily(pathname: string): AdminFamily {
  if (pathname === "/admin") {
    return ADMIN_FAMILIES[0];
  }

  return (
    ADMIN_FAMILIES.slice(1).find((family) =>
      family.matchPrefixes.some((prefix) => pathname.startsWith(prefix))
    ) ?? ADMIN_FAMILIES[0]
  );
}
