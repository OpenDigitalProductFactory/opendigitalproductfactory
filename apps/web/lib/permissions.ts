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
  | "manage_branding"
  | "manage_taxonomy"
  | "manage_agents"
  | "manage_capabilities"
  | "manage_users"
  | "manage_provider_connections"
  | "manage_backlog"
  | "manage_ea_model";

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
  manage_branding:             { roles: ["HR-000"] },
  manage_taxonomy:             { roles: ["HR-000", "HR-300"] },
  manage_agents:               { roles: ["HR-000"] },
  manage_capabilities:         { roles: ["HR-000"] },
  manage_users:                { roles: ["HR-000"] },
  manage_provider_connections: { roles: ["HR-000"] },
  manage_backlog:              { roles: ["HR-000", "HR-500"] },
  manage_ea_model:             { roles: ["HR-000", "HR-300"] },
};

type UserContext = {
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
  { key: "agents",     label: "Agents",     route: "/ea",        capabilityKey: "view_ea_modeler",  accentColor: "#7c8cf8" },
  { key: "portfolio",  label: "Portfolio",  route: "/portfolio", capabilityKey: "view_portfolio",   accentColor: "#4ade80" },
  { key: "inventory",  label: "Inventory",  route: "/inventory", capabilityKey: "view_inventory",   accentColor: "#fb923c" },
  { key: "employee",   label: "Employee",   route: "/employee",  capabilityKey: "view_employee",    accentColor: "#a78bfa" },
  { key: "customer",   label: "Customer",   route: "/customer",  capabilityKey: "view_customer",    accentColor: "#f472b6" },
  { key: "backlog",    label: "Backlog",    route: "/ops",       capabilityKey: "view_operations",  accentColor: "#38bdf8" },
  { key: "platform",   label: "Platform",   route: "/platform",  capabilityKey: "view_platform",    accentColor: "#fb923c" },
  { key: "admin",      label: "Admin",      route: "/admin",     capabilityKey: "view_admin",       accentColor: "#555566" },
];

export function getWorkspaceTiles(user: UserContext): WorkspaceTile[] {
  return ALL_TILES.filter((t) => can(user, t.capabilityKey));
}
