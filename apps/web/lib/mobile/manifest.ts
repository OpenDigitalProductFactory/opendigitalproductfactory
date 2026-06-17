/**
 * Mobile install-manifest projection (producer side).
 *
 * Pure builders that project existing platform state — BrandingConfig.tokens,
 * the archetype activation profile, the org identity — into the install manifest
 * the generic mobile app consumes (GET /api/v1/app/config) and the discovery
 * descriptor (GET /.well-known/dpf-instance.json).
 *
 * The wire types are the single source of truth in `@dpf/types`
 * (mobile-manifest.ts); this module owns only the projection logic.
 * Spec: docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html (§3).
 */
import type {
  AppConfigManifest,
  AppNavigation,
  AppPersona,
  BrandingPalette,
  BrandingThemeTokens,
  DualBrandingThemeTokens,
  InstanceDescriptor,
} from "@dpf/types";

const PALETTE_KEYS: (keyof BrandingPalette)[] = [
  "bg",
  "surface1",
  "surface2",
  "text",
  "accent",
  "muted",
  "border",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

function extractSingle(raw: unknown): BrandingThemeTokens | undefined {
  if (!isRecord(raw)) return undefined;
  const paletteRaw = isRecord(raw.palette) ? raw.palette : {};
  const typoRaw = isRecord(raw.typography) ? raw.typography : {};
  const palette: BrandingPalette = {};
  for (const k of PALETTE_KEYS) {
    const v = str(paletteRaw[k]);
    if (v) palette[k] = v;
  }
  const typography: { fontFamily?: string; headingFontFamily?: string } = {};
  const ff = str(typoRaw.fontFamily);
  if (ff) typography.fontFamily = ff;
  const hf = str(typoRaw.headingFontFamily);
  if (hf) typography.headingFontFamily = hf;
  const hasPalette = Object.keys(palette).length > 0;
  const hasTypo = Object.keys(typography).length > 0;
  if (!hasPalette && !hasTypo) return undefined;
  const out: BrandingThemeTokens = {};
  if (hasPalette) out.palette = palette;
  if (hasTypo) out.typography = typography;
  return out;
}

/** Safely normalize BrandingConfig.tokens JSON into the manifest design-token shape. */
export function normalizeBrandingTokens(
  raw: unknown,
): BrandingThemeTokens | DualBrandingThemeTokens | undefined {
  if (!isRecord(raw)) return undefined;
  if (isRecord(raw.light) || isRecord(raw.dark)) {
    const light = extractSingle(raw.light);
    const dark = extractSingle(raw.dark);
    if (!light && !dark) return undefined;
    const dual: DualBrandingThemeTokens = {};
    if (light) dual.light = light;
    if (dark) dual.dark = dark;
    return dual;
  }
  return extractSingle(raw);
}

/** Loose subset of the activation profile the capability projection reads. */
export interface CapabilityProjectionInput {
  modules?: string[] | null;
  axes?: {
    form?: string;
    delivery?: string;
    consumptionChannel?: string;
  } | null;
}

/**
 * Derive the mobile capability list from an archetype activation profile. v1:
 * the profile's modules + an always-on baseline, plus field-dispatch
 * capabilities when the axis triple (services + physical + onsite-plus-portal)
 * is present — the same `needsFieldDispatch` signal the portal uses.
 */
export function activationToCapabilities(
  profile: CapabilityProjectionInput | null | undefined,
): string[] {
  const caps = new Set<string>(["notifications"]);
  for (const m of profile?.modules ?? []) {
    if (typeof m === "string" && m.length > 0) caps.add(m);
  }
  const ax = profile?.axes;
  if (
    ax &&
    ax.form === "services" &&
    ax.delivery === "physical" &&
    ax.consumptionChannel === "onsite-plus-portal"
  ) {
    caps.add("field-dispatch");
    caps.add("work-items");
    caps.add("offline-sync");
  }
  return Array.from(caps);
}

export function buildInstanceDescriptor(input: {
  instanceId: string;
  orgName: string;
  archetype?: string | null;
  authModes?: string[];
  capabilities?: string[];
  accent?: string | null;
  logoUrl?: string | null;
}): InstanceDescriptor {
  const descriptor: InstanceDescriptor = {
    instanceId: input.instanceId,
    orgName: input.orgName || "DPF",
    apiVersion: "v1",
    authModes:
      input.authModes && input.authModes.length > 0
        ? input.authModes
        : ["password"],
  };
  if (input.archetype) descriptor.archetype = input.archetype;
  if (input.capabilities && input.capabilities.length > 0) {
    descriptor.capabilities = input.capabilities;
  }
  const accent = str(input.accent);
  const logoUrl = str(input.logoUrl);
  if (accent || logoUrl) {
    descriptor.branding = {
      ...(accent ? { accent } : {}),
      ...(logoUrl ? { logoUrl } : {}),
    };
  }
  return descriptor;
}

export function buildAppConfigManifest(input: {
  orgName: string;
  archetype?: string | null;
  persona: AppPersona;
  brandingTokensRaw?: unknown;
  capabilities: string[];
  vocabulary?: Record<string, string>;
  navigation?: AppNavigation;
}): AppConfigManifest {
  const manifest: AppConfigManifest = {
    schemaVersion: "1",
    org: {
      name: input.orgName || "DPF",
      ...(input.archetype ? { archetype: input.archetype } : {}),
    },
    persona: input.persona,
    capabilities: input.capabilities,
  };
  const tokens = normalizeBrandingTokens(input.brandingTokensRaw);
  if (tokens) manifest.designTokens = tokens;
  if (input.vocabulary && Object.keys(input.vocabulary).length > 0) {
    manifest.vocabulary = input.vocabulary;
  }
  if (input.navigation) manifest.navigation = input.navigation;
  return manifest;
}

/**
 * Persona resolver — the install side of "who am I, mobile?". Today the auth
 * layer distinguishes only `customer` from workforce (`admin`); within the
 * workforce we tell a real employee apart from a platform operator by whether
 * an `EmployeeProfile` is linked, and within employees we promote the persona
 * to field-tech `mode: "field"` when the install carries the `field-dispatch`
 * capability (the same axis-derived signal the manifest already projects).
 *
 * Lives next to the manifest builders so the wire shape and the resolution
 * rules stay co-located.
 */
export interface ResolvePersonaInput {
  userType: "admin" | "customer";
  employeeId: string | null;
  capabilities: string[];
}

export function resolveAppPersona(input: ResolvePersonaInput): AppPersona {
  if (input.userType === "customer") return { kind: "customer" };
  if (input.employeeId) {
    if (input.capabilities.includes("field-dispatch")) {
      return { kind: "employee", mode: "field" };
    }
    return { kind: "employee" };
  }
  return { kind: "operator" };
}

/**
 * Navigation resolver — which tab the app opens on after login. The mobile
 * shell already resolves the visible tab *set* from persona × capabilities
 * (apps/mobile/src/lib/navigation.ts); this picks the *landing* tab so a field
 * tech opens on Jobs instead of the operator Home. We leave `tabs` empty so
 * the client keeps owning the order until per-archetype overrides land.
 */
export interface ResolveNavigationInput {
  persona: AppPersona;
  capabilities: string[];
}

export function resolveAppNavigation(input: ResolveNavigationInput): AppNavigation {
  if (
    input.persona.kind === "employee" &&
    input.persona.mode === "field" &&
    input.capabilities.includes("work-items")
  ) {
    return { tabs: [], defaultTab: "jobs" };
  }
  return { tabs: [], defaultTab: "index" };
}
