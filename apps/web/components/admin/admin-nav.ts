export type AdminFamilyKey =
  | "access"
  | "organization"
  | "configuration"
  | "advanced";

export type AdminFamily = {
  key: AdminFamilyKey;
  label: string;
  href: string;
  description: string;
  matchPrefixes: string[];
  subItems: Array<{ label: string; href: string }>;
};

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
    label: "Organization",
    href: "/admin/branding",
    description: "Shape organization identity and brand presentation.",
    matchPrefixes: [
      "/admin/branding",
      "/admin/business-context",
    ],
    subItems: [{ label: "Branding", href: "/admin/branding" }],
  },
  {
    key: "configuration",
    label: "Configuration",
    href: "/admin/settings",
    description: "Manage global settings, reference data, operating rules, and model configuration.",
    matchPrefixes: [
      "/admin/settings",
      "/admin/reference-data",
      "/admin/business-models",
      "/admin/operating-hours",
    ],
    subItems: [
      { label: "Settings", href: "/admin/settings" },
      { label: "Reference Data", href: "/admin/reference-data" },
      { label: "Business Models", href: "/admin/business-models" },
    ],
  },
  {
    key: "advanced",
    label: "Advanced",
    href: "/admin/platform-development",
    description: "Reach specialist controls that still live under Admin while Platform consolidation continues.",
    matchPrefixes: [
      "/admin/platform-development",
      "/admin/prompts",
      "/admin/skills",
      "/admin/issue-reports",
      "/admin/diagnostics",
    ],
    subItems: [
      { label: "Platform Development", href: "/admin/platform-development" },
      { label: "Prompts", href: "/admin/prompts" },
      { label: "Skills", href: "/admin/skills" },
      { label: "Issue Reports", href: "/admin/issue-reports" },
      { label: "Diagnostics", href: "/admin/diagnostics" },
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
