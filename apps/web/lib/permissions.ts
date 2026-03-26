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
  | "approve_tool_evaluations";

type Permission = {
  roles: PlatformRoleId[];
};

const PERMISSIONS: Record<CapabilityKey, Permission> = {
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

const ALL_TILES: WorkspaceTile[] = [
  { key: "ea_modeler",    label: "EA Modeler",    route: "/ea",           capabilityKey: "view_ea_modeler",  accentColor: "#7c8cf8" },
  { key: "ai_workforce", label: "AI Workforce",  route: "/platform/ai",  capabilityKey: "view_platform",    accentColor: "#38bdf8" },
  { key: "build",       label: "Build Studio", route: "/build",       capabilityKey: "view_platform",    accentColor: "#10b981" },
  { key: "portfolio",  label: "Portfolio",  route: "/portfolio", capabilityKey: "view_portfolio",   accentColor: "#4ade80" },
  { key: "inventory",  label: "Inventory",  route: "/inventory", capabilityKey: "view_inventory",   accentColor: "#fb923c" },
  { key: "employee",   label: "Employee",   route: "/employee",  capabilityKey: "view_employee",    accentColor: "#a78bfa" },
  { key: "customer",   label: "Customer",   route: "/customer",  capabilityKey: "view_customer",    accentColor: "#f472b6" },
  { key: "backlog",    label: "Backlog",    route: "/ops",       capabilityKey: "view_operations",  accentColor: "#38bdf8" },
  { key: "platform",   label: "Platform",   route: "/platform",  capabilityKey: "view_platform",    accentColor: "#fb923c" },
  { key: "admin",      label: "Admin",      route: "/admin",     capabilityKey: "view_admin",       accentColor: "#8888a0" },
  { key: "compliance", label: "Compliance", route: "/compliance", capabilityKey: "view_compliance",  accentColor: "#ef4444" },
  { key: "finance",    label: "Finance",    route: "/finance",    capabilityKey: "view_finance",     accentColor: "#22c55e" },
  { key: "storefront", label: "Storefront", route: "/storefront", capabilityKey: "view_storefront",  accentColor: "#f59e0b" },
];

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
