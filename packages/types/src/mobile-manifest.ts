import type { DynamicFormSchema, DynamicViewSchema } from "./dynamic";

/**
 * Install-manifest wire contract — the single source of truth shared by the
 * portal producer (apps/web/lib/mobile/manifest.ts) and the mobile consumer
 * (apps/mobile/src/lib/appConfig.ts, theme.ts, serverConfig.ts).
 *
 * The install drives the app: after connect + login the app fetches this
 * manifest (GET /api/v1/app/config) and re-themes + re-functions from it.
 * Three layers — design tokens, capabilities, server-driven screens.
 * Spec: docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html (§3).
 */

/** Branding palette — mirrors the portal's BrandingConfig.tokens palette keys. */
export interface BrandingPalette {
  bg?: string;
  surface1?: string;
  surface2?: string;
  text?: string;
  accent?: string;
  muted?: string;
  border?: string;
}

export interface BrandingTypography {
  fontFamily?: string;
  headingFontFamily?: string;
}

/** A single-scheme token set (the shape of one of light/dark). */
export interface BrandingThemeTokens {
  palette?: BrandingPalette;
  typography?: BrandingTypography;
}

/** Dual-scheme token set, as stored in BrandingConfig.tokens. */
export interface DualBrandingThemeTokens {
  light?: BrandingThemeTokens;
  dark?: BrandingThemeTokens;
}

export type AppPersonaKind =
  | "visitor"
  | "customer"
  | "employee"
  | "operator"
  | "admin";

export interface AppPersona {
  kind: AppPersonaKind;
  /** Shared-shell mode, e.g. "field" | "customer" | "operator". */
  mode?: string;
}

export interface AppNavigation {
  tabs: string[];
  defaultTab?: string;
}

export interface AppScreen {
  screenId: string;
  type: "form" | "view" | "list";
  title?: string;
  schema?: DynamicFormSchema | DynamicViewSchema;
  /** Capability key gating this screen; hidden when the org lacks it. */
  capability?: string;
}

export interface AppConfigManifest {
  schemaVersion: string;
  org: { name: string; archetype?: string };
  persona: AppPersona;
  /** (1) design layer — install branding as data. */
  designTokens?: BrandingThemeTokens | DualBrandingThemeTokens;
  /** (2) capability layer — archetype + org-activation derived. */
  capabilities: string[];
  vocabulary?: Record<string, string>;
  /** (3) screen layer — server-driven navigation + screens. */
  navigation?: AppNavigation;
  screens?: AppScreen[];
}

/**
 * Public discovery descriptor served at /.well-known/dpf-instance.json. Lets the
 * app prove a URL is a real install and learn its identity, archetype, auth
 * modes, and branding seed before sign-in.
 */
export interface InstanceDescriptor {
  instanceId: string;
  orgName: string;
  archetype?: string;
  apiVersion: string;
  authModes: string[];
  capabilities?: string[];
  branding?: { accent?: string; logoUrl?: string };
}

/* ------------------------------------------------------------------ */
/*  Multi-business "spaces" model                                      */
/*                                                                     */
/*  One generic app holds connections to MANY self-hosted businesses,  */
/*  each its own single-org-per-install backend ("space"). This is a   */
/*  client-side generalization — there is NO server multi-tenancy.     */
/*  Spec: docs/superpowers/specs/2026-06-14-multi-business-town-       */
/*  super-app-design.html (§2–§3). EP-MOBILE-ARCHETYPE / BI-MOBAPP-    */
/*  SPACES (M1).                                                       */
/* ------------------------------------------------------------------ */

/**
 * Runtime session metadata for one space. The actual JWT/refresh tokens live
 * in secure storage (per-space), keyed by spaceId; this is only the
 * non-secret descriptive state the switcher/home render.
 */
export interface SpaceSession {
  /** True once this space has a live session this launch. */
  authenticated: boolean;
  /** Persona authenticated to this space (customer at the salon, employee at the shop). */
  personaKind?: AppPersonaKind;
  /** Display name of the signed-in principal, for the switcher. */
  displayName?: string;
}

/**
 * One connected business in the multi-space client. The durable identity is
 * the install's URL + descriptor; `session` and `manifest` are runtime state
 * (the manifest is refreshed on activation, so it is not part of the persisted
 * form). `spaceId` is the install's stable `instanceId`.
 */
export interface Space {
  spaceId: string;
  /** Normalized install base URL (no trailing slash). */
  url: string;
  /** Display label for the switcher/home (defaults to the org name). */
  label: string;
  /** Public discovery descriptor captured at connect time. */
  descriptor: InstanceDescriptor;
  /** Runtime session metadata (tokens stored separately, per-space). */
  session?: SpaceSession;
  /** Last absorbed install manifest (persona/theme/capabilities) — runtime only. */
  manifest?: AppConfigManifest;
  /** Epoch ms of last activation, for "recently used" ordering. */
  lastUsedAt?: number;
}

/**
 * The serializable registry of joined spaces plus which one is active. The
 * persisted form strips each space's runtime `session`/`manifest`, keeping only
 * the durable connection identity.
 */
export interface SpacesRegistry {
  spaces: Space[];
  activeSpaceId: string | null;
}
