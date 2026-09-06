// apps/web/lib/permissions.ts
import type { EffectiveAuthContext } from "@/lib/identity/effective-auth-context";

import { canAccessEmployeeScope } from "./manager-scope";
import {
  getShellNavEntries,
  getSectionNavEntries,
  PORTAL_SHELL_SECTIONS,
  type PortalAudienceMode,
  type PortalShellSectionKey,
} from "../navigation/portal-navigation-model";

export type { PortalAudienceMode } from "../navigation/portal-navigation-model";

export type PlatformRoleId =
  | "HR-000" | "HR-100" | "HR-200"
  | "HR-300" | "HR-400" | "HR-500"
  // HR-600 "Workforce Member": the base access floor for a customer's in-trench
  // employees (occupation dimension, EP-EMPLOYEE-OCCUPATION P0.1). Kernel-ratified
  // (DI-4F72F64B6C5B) as a dedicated role decoupled from the HR-000..HR-500
  // platform-management ladder. Deliberately minimal — see PERMISSIONS below.
  | "HR-600";

export type CapabilityKey =
  | "view_ea_modeler"
  | "view_portfolio"
  | "view_inventory"
  | "view_employee"
  | "view_customer"
  | "operate_customer"
  | "view_operations"
  | "view_business_performance"
  | "view_platform"
  | "view_admin"
  | "view_storefront"
  | "view_marketing"
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
  | "view_animal_welfare"
  | "operate_animal_welfare"
  | "operate_marketing"
  | "publish_marketing"
  | "manage_tool_evaluations"
  | "approve_tool_evaluations"
  | "manage_business_models"
  | "view_workbooks"
  | "manage_workbooks"
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
  // CRM write (draft opportunities/quotes/accounts) — same role tier as
  // view_customer; the Customer Success Manager coworker drafts internal,
  // reversible records (status=draft), never external sends.
  operate_customer:            { roles: ["HR-000", "HR-200"] },
  view_operations:             { roles: ["HR-000", "HR-500"] },
  view_business_performance:   { roles: ["HR-000", "HR-500"] },
  view_platform:               { roles: ["HR-000", "HR-200", "HR-300"] },
  view_admin:                  { roles: ["HR-000"] },
  view_storefront:             { roles: ["HR-000", "HR-200", "HR-300"] },
  view_marketing:              { roles: ["HR-000", "HR-200", "HR-300"] },
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
  view_animal_welfare:         { roles: ["HR-000", "HR-500"] },
  operate_animal_welfare:      { roles: ["HR-000", "HR-500"] },
  operate_marketing:           { roles: ["HR-000", "HR-200", "HR-300"] },
  publish_marketing:           { roles: ["HR-000", "HR-200"] },
  manage_tool_evaluations:     { roles: ["HR-000", "HR-300"] },
  approve_tool_evaluations:    { roles: ["HR-000", "HR-300"] },
  manage_business_models:      { roles: ["HR-000", "HR-200", "HR-300"] },
  // Workbooks are a cross-domain knowledge-worker tool; the coarse role gate is
  // "can you use the feature", while fine-grained access is enforced per-workbook
  // by WorkbookShare (owner/editor/viewer). Granted to all roles including HR-600 —
  // this pair is the in-trench worker's own work surface, safe because access to any
  // individual workbook is still ACL-gated.
  view_workbooks:              { roles: ["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500", "HR-600"] },
  manage_workbooks:            { roles: ["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500", "HR-600"] },
  manage_platform:             { roles: ["HR-000"] },
};

// HR-600 "Workforce Member" floor (EP-EMPLOYEE-OCCUPATION P0.1, least-privilege /
// deny-by-default). HR-600 is intentionally ABSENT from every capability above
// except view_workbooks + manage_workbooks. It carries none of the platform-management
// capabilities (admin, finance, customer, employee registry, manage_user_lifecycle,
// backlog, operations, platform) that the HR-000..HR-500 ladder confers. An in-trench
// employee reaches their home because /workspace is capabilityKey:null; the occupation
// dimension then FOCUSES that surface and adds a governed coworker roster on top. The
// non-widening invariant (spec §5.4) depends on this floor: occupation may narrow what
// HR-600 already has, never grant a capability this table withholds.

export type UserContext = {
  userId?: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

const VALID_ROLE_IDS = new Set<string>(["HR-000", "HR-100", "HR-200", "HR-300", "HR-400", "HR-500", "HR-600"]);

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

export function canAccessEmployeeRecord(
  context: EffectiveAuthContext,
  targetEmployeeId: string,
): boolean {
  if (!context.grantedCapabilities.includes("view_employee")) return false;
  return canAccessEmployeeScope(context, targetEmployeeId);
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
  sectionKey: PortalShellSectionKey;
  capabilityKey: CapabilityKey | null;
  /** Archetype-capability gate (any-of when array) — see PortalNavRecord.orgCapabilityKey. */
  orgCapabilityKey: string | readonly string[] | null;
  /** Audience modes this item belongs to (worker | operator | …). The rail filters on
   *  this when a mode is active, so "worker" mode shows only the day-to-day business
   *  surfaces and hides operator/platform chrome (EP-NAV-COHERENCE P4). */
  audienceModes: readonly PortalAudienceMode[];
};

export type SectionNavItem = {
  key: string;
  label: string;
  href: string;
  capabilityKey: CapabilityKey | null;
};

export type ShellNavSection = {
  key: PortalShellSectionKey;
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
  { key: "documents",   label: "Documents",    route: "/workspace/documents", capabilityKey: "view_platform", accentColor: "var(--dpf-accent)" },
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

const SHELL_ITEMS: ShellNavItem[] = getShellNavEntries().map((entry) => ({
  key: entry.key,
  label: entry.label,
  href: entry.path,
  description: entry.description,
  sectionKey: entry.sectionKey,
  capabilityKey: entry.capabilityKey,
  orgCapabilityKey: entry.orgCapabilityKey,
  audienceModes: entry.audienceModes,
}));

const WORKSPACE_SECTION_BLUEPRINTS: Array<{
  key: WorkspaceSection["key"];
  label: string;
  description: string;
  tileKeys: string[];
}> = [
  {
    key: "ai-control",
    label: "Direct AI coworkers",
    description: "A small employee team can supervise specialists here while AI fills in deep expertise.",
    tileKeys: ["ai_workforce", "build", "documents", "platform", "admin"],
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

export function getShellNavSections(
  user: UserContext,
  options?: {
    /**
     * Effectively-active archetype capability keys for the org (from
     * getActiveOrgCapabilities). Nav items carrying an orgCapabilityKey render
     * only when that key is in the set; when the set is not provided they stay
     * hidden — the safe default for callers without org context.
     */
    activeOrgCapabilities?: ReadonlySet<string>;
    /** When set, only items whose audienceModes include this mode render — "worker"
     *  yields the condensed day-to-day rail; "operator" (or undefined) the full rail. */
    mode?: PortalAudienceMode;
  },
): ShellNavSection[] {
  const activeOrgCapabilities = options?.activeOrgCapabilities;
  const mode = options?.mode;
  const orgGateOpen = (gate: string | readonly string[] | null): boolean => {
    if (gate === null) return true;
    if (!activeOrgCapabilities) return false;
    const keys = typeof gate === "string" ? [gate] : gate;
    return keys.some((key) => activeOrgCapabilities.has(key));
  };
  return PORTAL_SHELL_SECTIONS.map((section) => ({
    ...section,
    items: SHELL_ITEMS.filter(
      (item) =>
        item.sectionKey === section.key &&
        isAllowed(user, item.capabilityKey) &&
        orgGateOpen(item.orgCapabilityKey) &&
        (mode === undefined || item.audienceModes.includes(mode)),
    ),
  })).filter((section) => section.items.length > 0);
}

export function getAccessibleSectionNavEntries(
  user: UserContext,
  path: string,
): SectionNavItem[] {
  return getSectionNavEntries(path)
    .filter((entry) => isAllowed(user, entry.capabilityKey))
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      href: entry.path,
      capabilityKey: entry.capabilityKey,
    }));
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
