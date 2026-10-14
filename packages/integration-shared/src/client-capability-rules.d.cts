export type CapabilityStatus = "verified" | "encoded" | "unproven";

export type CapabilityField<T> = {
  value: T | null;
  status: CapabilityStatus;
  verifiedAt: string | null;
  verifiedVersion: string | null;
  evidence: string;
};

export type HookHost = "cli" | "desktop" | "ide";
export type HookEventState = "fires" | "not-fired" | "unproven";

export type HookHostRecord = {
  status: CapabilityStatus;
  verifiedAt: string | null;
  verifiedVersion: string | null;
  evidence: string;
  delivery: string | null;
  denyEnvelope: "hookSpecificOutput" | "dual" | null;
  permissionModes: string[];
  events: Record<string, HookEventState>;
  probes: string[];
};

export type ClientCapabilityRow = {
  displayName: string;
  policyClient: string;
  loadsPack: boolean;
  verifiedVersion: string | null;
  verifiedRange: { min: string; max: string } | null;
  sources: string[];
  capabilities: {
    oauthHttps: CapabilityField<boolean>;
    oauthLoopbackHttp: CapabilityField<boolean>;
    staticHeaders: CapabilityField<boolean>;
    declarationCarrier: CapabilityField<"query" | "header">;
    pluginScopes: CapabilityField<string[]>;
    reloadRequired: CapabilityField<boolean>;
    skillsLoad: CapabilityField<boolean>;
    hookPlane: Record<HookHost, HookHostRecord>;
  };
};

export type ClientCapabilityProfile = {
  schemaVersion: number;
  clients: Record<string, ClientCapabilityRow>;
};

export declare function capabilityPresent(field: CapabilityField<unknown> | null | undefined): boolean;
export declare function rowForPolicyClient(profile: ClientCapabilityProfile, policyClient: string): ClientCapabilityRow | null;
export declare function bearerHeaderRequiredFor(
  profile: ClientCapabilityProfile,
  endpoint: string,
  policyClient: string,
  authMode: string,
): boolean;
export declare function extractClientVersion(text: unknown): string | null;
export declare function compareClientVersions(left: string, right: string): number | null;
export declare function clientVersionUnverified(row: ClientCapabilityRow | null | undefined, version: string | null | undefined): boolean;
