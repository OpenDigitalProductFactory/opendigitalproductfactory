// apps/web/lib/permissions.ts

export type PlatformRoleId =
  | "HR-000" | "HR-100" | "HR-200"
  | "HR-300" | "HR-400" | "HR-500";

export type CapabilityKey =
  | "view_ea_modeler"
  | "view_portfolio"
  | "view_inventory"
  | "view_employee"
  | "view_customer"
  | "view_operations"
  | "view_platform"
  | "view_admin"
  | "view_storefront"
  | "manage_branding"
  | "manage_taxonomy"
  | "manage_agents"
  | "manage_capabilities"
  | "manage_users"
  | "manage_user_lifecycle"
  | "manage_provider_connections"
  | "manage_backlog"
  | "manage_ea_model"
  | "view_compliance"
  | "manage_compliance"
  | "view_finance"
  | "manage_finance"
  | "manage_tool_evaluations"
  | "approve_tool_evaluations"
  | "manage_business_models"
  | "manage_platform";

type Permission = {
  roles: PlatformRoleId[];
};

export const PERMISSIONS: Record<CapabilityKey, Permission> = {
  view_ea_modeler:             { roles: ["HR-000", "HR-300"] },
  view_portfolio:              { roles: ["HR-000", "HR-100", "HR-300", "HR-400"] },
  view_inventory:              { roles: ["HR-000", "HR-300"] },
  view_employee:               { roles: ["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500"] },
  view_customer:               { roles: ["HR-000", "HR-200"] },
  view_operations:             { roles: ["HR-000", "HR-500"] },
  view_platform:               { roles: ["HR-000", "HR-200", "HR-300"] },
  view_admin:                  { roles: ["HR-000"] },
  view_storefront:             { roles: ["HR-000", "HR-200", "HR-300"] },
  manage_branding:             { roles: ["HR-000"] },
  manage_taxonomy:             { roles: ["HR-000", "HR-300"] },
  manage_agents:               { roles: ["HR-000"] },
  manage_capabilities:         { roles: ["HR-000"] },
  manage_users:                { roles: ["HR-000"] },
  manage_user_lifecycle:       { roles: ["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500"] },
  manage_provider_connections: { roles: ["HR-000"] },
  manage_backlog:              { roles: ["HR-000", "HR-500"] },
  manage_ea_model:             { roles: ["HR-000", "HR-300"] },
  view_compliance:             { roles: ["HR-000", "HR-100", "HR-200", "HR-300"] },
  manage_compliance:           { roles: ["HR-000", "HR-200"] },
  view_finance:                { roles: ["HR-000", "HR-200"] },
  manage_finance:              { roles: ["HR-000", "HR-200"] },
  manage_tool_evaluations:     { roles: ["HR-000", "HR-300"] },
  approve_tool_evaluations:    { roles: ["HR-000", "HR-300"] },
  manage_business_models:      { roles: ["HR-000", "HR-200", "HR-300"] },
  manage_platform:             { roles: ["HR-000"] },
};

export type UserContext = {
  userId?: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

const VALID_ROLE_IDS = new Set<string>(["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500"]);

function isPlatformRoleId(role: string): role is PlatformRoleId {
  return VALID_ROLE_IDS.has(role);
}

export function can(user: UserContext, capability: CapabilityKey): boolean {
  if (user.isSuperuser) return true;
  if (!user.platformRole) return false;
  if (!isPlatformRoleId(user.platformRole)) return false;
  // PERMISSIONS is a complete Record<CapabilityKey, Permission> — every key is
  // present by construction. The non-null assertion is safe and required because
  // noUncheckedIndexedAccess widens the index return type to `Permission | undefined`
  // even for exhaustive Record types.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return PERMISSIONS[capability]!.roles.includes(user.platformRole);
}

export type WorkspaceTile = {
  key: string;
  label: string;
  route: string;
  capabilityKey: CapabilityKey;
  accentColor: string;
};

export type ShellNavItem = {
  key: string;
  label: string;
  href: string;
  description: string;
  sectionKey: "workspace" | "business" | "products" | "platform" | "knowledge";
  capabilityKey: CapabilityKey | null;
};

export type ShellNavSection = {
  key: "workspace" | "business" | "products" | "platform" | "knowledge";
  label: string;
  description: string;
  items: ShellNavItem[];
};

export type WorkspaceSection = {
  key: "ai-control" | "product-oversight" | "business-operations";
  label: string;
  description: string;
  tiles: WorkspaceTile[];
};

const ALL_TILES: WorkspaceTile[] = [
  { key: "ea_modeler",    label: "EA Modeler",    route: "/ea",           capabilityKey: "view_ea_modeler",  accentColor: "var(--dpf-accent)" },
  { key: "ai_workforce", label: "AI Workforce",  route: "/platform/ai",  capabilityKey: "view_platform",    accentColor: "var(--dpf-info)" },
  { key: "build",       label: "Build Studio", route: "/build",       capabilityKey: "view_platform",    accentColor: "var(--dpf-success)" },
  { key: "portfolio",  label: "Portfolio",  route: "/portfolio", capabilityKey: "view_portfolio",   accentColor: "var(--dpf-success)" },
  { key: "employee",   label: "Employee",   route: "/employee",  capabilityKey: "view_employee",    accentColor: "var(--dpf-info)" },
  { key: "customer",   label: "Customer",   route: "/customer",  capabilityKey: "view_customer",    accentColor: "var(--dpf-accent)" },
  { key: "backlog",    label: "Backlog",    route: "/ops",       capabilityKey: "view_operations",  accentColor: "var(--dpf-info)" },
  { key: "platform",   label: "Platform",   route: "/platform",  capabilityKey: "view_platform",    accentColor: "var(--dpf-warning)" },
  { key: "admin",      label: "Admin",      route: "/admin",     capabilityKey: "view_admin",       accentColor: "var(--dpf-muted)" },
  { key: "compliance", label: "Compliance", route: "/compliance", capabilityKey: "view_compliance",  accentColor: "var(--dpf-error)" },
  { key: "finance",    label: "Finance",    route: "/finance",    capabilityKey: "view_finance",     accentColor: "var(--dpf-success)" },
  { key: "storefront", label: "Storefront", route: "/storefront", capabilityKey: "view_storefront",  accentColor: "var(--dpf-warning)" },
];

const SHELL_SECTIONS: Array<Pick<ShellNavSection, "key" | "label" | "description">> = [
  {
    key: "workspace",
    label: "Workspace",
    description: "Your queue, recents, and AI-guided next steps.",
  },
  {
    key: "business",
    label: "Business",
    description: "Run customer, people, finance, compliance, and portal operations.",
  },
  {
    key: "products",
    label: "Products",
    description: "Guide product lifecycle work from portfolio through delivery.",
  },
  {
    key: "platform",
    label: "Platform",
    description: "Direct AI coworkers and operate the platform itself.",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    description: "Shared knowledge, reference, and documentation.",
  },
];

const SHELL_ITEMS: ShellNavItem[] = [
  {
    key: "workspace",
    label: "Workspace",
    href: "/workspace",
    description: "See what needs attention next.",
    sectionKey: "workspace",
    capabilityKey: null,
  },
  {
    key: "customer",
    label: "Customer",
    href: "/customer",
    description: "Accounts, pipeline, quotes, and orders.",
    sectionKey: "business",
    capabilityKey: "view_customer",
  },
  {
    key: "employee",
    label: "People",
    href: "/employee",
    description: "Human users, contractors, and workforce records.",
    sectionKey: "business",
    capabilityKey: "view_employee",
  },
  {
    key: "finance",
    label: "Finance",
    href: "/finance",
    description: "Cashflow, receivables, payables, and close.",
    sectionKey: "business",
    capabilityKey: "view_finance",
  },
  {
    key: "compliance",
    label: "Compliance",
    href: "/compliance",
    description: "Controls, risk, obligations, and posture.",
    sectionKey: "business",
    capabilityKey: "view_compliance",
  },
  {
    key: "storefront",
    label: "Portal",
    href: "/storefront",
    description: "Customer-facing portal experience and setup.",
    sectionKey: "business",
    capabilityKey: "view_storefront",
  },
  {
    key: "portfolio",
    label: "Portfolio",
    href: "/portfolio",
    description: "Digital products and their lifecycle homes.",
    sectionKey: "products",
    capabilityKey: "view_portfolio",
  },
  {
    key: "backlog",
    label: "Backlog",
    href: "/ops",
    description: "Cross-cutting work queues and improvements.",
    sectionKey: "products",
    capabilityKey: "view_operations",
  },
  {
    key: "ea_modeler",
    label: "Architecture",
    href: "/ea",
    description: "Reference models, capabilities, and structure.",
    sectionKey: "products",
    capabilityKey: "view_ea_modeler",
  },
  {
    key: "ai_workforce",
    label: "AI Workforce",
    href: "/platform/ai",
    description: "Oversee AI specialists and their authority.",
    sectionKey: "platform",
    capabilityKey: "view_platform",
  },
  {
    key: "build",
    label: "Build Studio",
    href: "/build",
    description: "Create and ship new capability with AI help.",
    sectionKey: "platform",
    capabilityKey: "view_platform",
  },
  {
    key: "platform",
    label: "Platform Hub",
    href: "/platform",
    description: "Providers, integrations, services, and governance.",
    sectionKey: "platform",
    capabilityKey: "view_platform",
  },
  {
    key: "admin",
    label: "Admin",
    href: "/admin",
    description: "Core platform configuration and access.",
    sectionKey: "platform",
    capabilityKey: "view_admin",
  },
  {
    key: "knowledge",
    label: "Knowledge",
    href: "/knowledge",
    description: "Shared operational and product knowledge.",
    sectionKey: "knowledge",
    capabilityKey: null,
  },
  {
    key: "docs",
    label: "Docs",
    href: "/docs",
    description: "Reference documentation and specs.",
    sectionKey: "knowledge",
    capabilityKey: null,
  },
];

const WORKSPACE_SECTION_BLUEPRINTS: Array<{
  key: WorkspaceSection["key"];
  label: string;
  description: string;
  tileKeys: string[];
}> = [
  {
    key: "ai-control",
    label: "Direct AI coworkers",
    description: "A small human team can supervise specialists here while AI fills in deep expertise.",
    tileKeys: ["ai_workforce", "build", "platform", "admin"],
  },
  {
    key: "product-oversight",
    label: "Shape products",
    description: "Move work from strategy to delivery while keeping estate context inside the product flow.",
    tileKeys: ["portfolio", "backlog", "ea_modeler"],
  },
  {
    key: "business-operations",
    label: "Run the business",
    description: "Cover customer, people, compliance, finance, and portal work in one place.",
    tileKeys: ["customer", "finance", "employee", "compliance", "storefront"],
  },
];

function isAllowed(user: UserContext, capabilityKey: CapabilityKey | null): boolean {
  return capabilityKey === null || can(user, capabilityKey);
}

/** Get all capabilities granted to a user's role. */
export function getGrantedCapabilities(user: UserContext): CapabilityKey[] {
  if (user.isSuperuser) return Object.keys(PERMISSIONS) as CapabilityKey[];
  const role = user.platformRole;
  if (!role || !isPlatformRoleId(role)) return [];
  return (Object.entries(PERMISSIONS) as [CapabilityKey, Permission][])
    .filter(([, perm]) => perm.roles.includes(role))
    .map(([cap]) => cap);
}

/** Get capabilities NOT granted to a user's role. */
export function getDeniedCapabilities(user: UserContext): CapabilityKey[] {
  const granted = new Set(getGrantedCapabilities(user));
  return (Object.keys(PERMISSIONS) as CapabilityKey[]).filter((cap) => !granted.has(cap));
}

export function getWorkspaceTiles(user: UserContext): WorkspaceTile[] {
  return ALL_TILES.filter((t) => can(user, t.capabilityKey));
}

export function getShellNavSections(user: UserContext): ShellNavSection[] {
  return SHELL_SECTIONS.map((section) => ({
    ...section,
    items: SHELL_ITEMS.filter((item) => item.sectionKey === section.key && isAllowed(user, item.capabilityKey)),
  })).filter((section) => section.items.length > 0);
}

export function getWorkspaceSections(user: UserContext): WorkspaceSection[] {
  const visibleTiles = new Map(
    getWorkspaceTiles(user).map((tile) => [tile.key, tile] as const),
  );

  return WORKSPACE_SECTION_BLUEPRINTS.map((section) => ({
    key: section.key,
    label: section.label,
    description: section.description,
    tiles: section.tileKeys
      .map((tileKey) => visibleTiles.get(tileKey))
      .filter((tile): tile is WorkspaceTile => tile !== undefined),
  })).filter((section) => section.tiles.length > 0);
}
