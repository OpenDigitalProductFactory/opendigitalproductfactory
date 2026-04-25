import {
  PERMISSIONS as GOVERN_PERMISSIONS,
  can as governCan,
  canAccessEmployeeRecord,
  getDeniedCapabilities as governGetDeniedCapabilities,
  getGrantedCapabilities as governGetGrantedCapabilities,
  getShellNavSections,
  getWorkspaceSections,
  getWorkspaceTiles,
  type PlatformRoleId,
  type ShellNavItem,
  type ShellNavSection,
  type UserContext,
  type WorkspaceSection,
  type WorkspaceTile,
} from "./govern/permissions";

export type {
  PlatformRoleId,
  ShellNavItem,
  ShellNavSection,
  UserContext,
  WorkspaceSection,
  WorkspaceTile,
} from "./govern/permissions";

const MARKETING_PERMISSION_OVERRIDES = {
  view_marketing: { roles: ["HR-000", "HR-200", "HR-300"] as PlatformRoleId[] },
  operate_marketing: { roles: ["HR-000", "HR-200", "HR-300"] as PlatformRoleId[] },
  publish_marketing: { roles: ["HR-000", "HR-200"] as PlatformRoleId[] },
} as const;

type GovernCapabilityKey = keyof typeof GOVERN_PERMISSIONS;
export type CapabilityKey = GovernCapabilityKey | keyof typeof MARKETING_PERMISSION_OVERRIDES;

export const PERMISSIONS: Record<CapabilityKey, { roles: PlatformRoleId[] }> = {
  ...GOVERN_PERMISSIONS,
  ...MARKETING_PERMISSION_OVERRIDES,
};

export function can(user: UserContext, capability: CapabilityKey): boolean {
  if (capability in MARKETING_PERMISSION_OVERRIDES) {
    if (user.isSuperuser) return true;
    if (!user.platformRole) return false;
    return MARKETING_PERMISSION_OVERRIDES[
      capability as keyof typeof MARKETING_PERMISSION_OVERRIDES
    ].roles.includes(user.platformRole as PlatformRoleId);
  }

  return governCan(user, capability as GovernCapabilityKey);
}

export {
  canAccessEmployeeRecord,
  getShellNavSections,
  getWorkspaceSections,
  getWorkspaceTiles,
};

export function getGrantedCapabilities(user: UserContext): CapabilityKey[] {
  return [...new Set([...governGetGrantedCapabilities(user), ...getMarketingCompatCapabilities(user)])];
}

export function getDeniedCapabilities(user: UserContext): CapabilityKey[] {
  const denied = new Set(governGetDeniedCapabilities(user) as CapabilityKey[]);
  for (const capability of getMarketingCompatCapabilities(user)) {
    denied.delete(capability);
  }
  return [...denied].filter((capability) => capability in PERMISSIONS);
}

function getMarketingCompatCapabilities(user: UserContext): Array<keyof typeof MARKETING_PERMISSION_OVERRIDES> {
  if (user.isSuperuser) {
    return Object.keys(MARKETING_PERMISSION_OVERRIDES) as Array<
      keyof typeof MARKETING_PERMISSION_OVERRIDES
    >;
  }

  if (!user.platformRole) return [];

  return (Object.entries(MARKETING_PERMISSION_OVERRIDES) as Array<
    [keyof typeof MARKETING_PERMISSION_OVERRIDES, { roles: PlatformRoleId[] }]
  >)
    .filter(([, permission]) => permission.roles.includes(user.platformRole as PlatformRoleId))
    .map(([capability]) => capability);
}
