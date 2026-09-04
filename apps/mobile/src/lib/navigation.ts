import type { AppPersona, AppPersonaKind } from "@dpf/types";

/** A mobile tab and the personas / capability that make it visible. */
export interface TabSpec {
  key: string;
  /** Personas that see this tab when the manifest gives no explicit nav order. */
  personas: AppPersonaKind[];
  /** Optional capability gate; when capabilities are known, the tab shows only if present. */
  capability?: string;
}

/**
 * Registry of the app's bottom tabs. The current set is the platform-operator
 * surface; persona-specific tabs (field / customer) are added as those modes
 * land. Persona membership already makes navigation install-driven — a customer
 * install shows fewer tabs than an operator one — without breaking the operator
 * default. See docs/superpowers/specs/2026-06-14-native-mobile-archetype-apps-design.html.
 */
export const TAB_REGISTRY: TabSpec[] = [
  { key: "index", personas: ["operator", "employee", "customer", "admin"] },
  // Anonymous walk-up consumer surface (first cut, BI-9FEB61B8): the default
  // home for a visitor with no account, also available to signed-in customers.
  { key: "nearby", personas: ["visitor", "customer"] },
  { key: "ops", personas: ["operator", "employee", "admin"] },
  { key: "jobs", personas: ["operator", "employee", "admin"], capability: "work-items" },
  { key: "portfolio", personas: ["operator", "admin"] },
  // Mileage is capability-gated: a field-mobile install (field service, trades,
  // automotive, mobile beauty) exposes "mileage" and its drivers get the tab; a
  // fixed-premises install never sees it. This is the archetype fit — the tab
  // follows what the install actually does, not a global default.
  { key: "mileage", personas: ["operator", "employee", "admin"], capability: "mileage" },
  { key: "customers", personas: ["operator", "employee", "customer", "admin"] },
  { key: "more", personas: ["operator", "employee", "customer", "admin"] },
];

const DEFAULT_PERSONA: AppPersonaKind = "operator";

export interface ResolveTabsInput {
  persona?: AppPersona | null;
  capabilities?: string[];
  /** manifest.navigation.tabs — an explicit, server-driven tab order. */
  manifestTabs?: string[];
  registry?: TabSpec[];
}

/**
 * Resolve which tabs are visible (and in what order) from the install manifest.
 * Precedence: explicit manifest tab order → persona defaults. An ungated tab
 * follows persona defaults; a capability-gated tab shows only when the connected
 * install's capabilities include its key — so the default/operator app (which
 * loads no capabilities) shows only the ungated tabs, while a field install that
 * grants "work-items" surfaces the Jobs tab.
 */
export function resolveVisibleTabs(input: ResolveTabsInput): string[] {
  const registry = input.registry ?? TAB_REGISTRY;
  const personaKind = input.persona?.kind ?? DEFAULT_PERSONA;
  const caps = input.capabilities;
  const capsKnown = Array.isArray(caps) && caps.length > 0;
  const byKey = new Map(registry.map((t) => [t.key, t]));

  const capAllowed = (spec: TabSpec): boolean => {
    if (!spec.capability) return true; // ungated → persona default
    return capsKnown && caps!.includes(spec.capability); // gated → require the key
  };

  if (input.manifestTabs && input.manifestTabs.length > 0) {
    return input.manifestTabs
      .filter((k) => byKey.has(k))
      .filter((k) => capAllowed(byKey.get(k)!));
  }

  return registry
    .filter((t) => t.personas.includes(personaKind))
    .filter(capAllowed)
    .map((t) => t.key);
}

const FALLBACK_DEFAULT_TAB = "index";

export interface ResolveDefaultTabInput {
  /** Server-emitted landing tab (manifest.navigation.defaultTab). */
  manifestDefault?: string;
  /** The visible tab set this persona/install can actually mount. */
  visibleTabs: string[];
}

/**
 * Pick the tab the app opens on after login. Honors the install's preference
 * (`manifest.navigation.defaultTab`) as long as it's actually mountable for
 * this persona; otherwise falls back to the first visible tab so the app
 * never opens onto a hidden route.
 */
export function resolveDefaultTab(input: ResolveDefaultTabInput): string {
  const { manifestDefault, visibleTabs } = input;
  if (manifestDefault && visibleTabs.includes(manifestDefault)) {
    return manifestDefault;
  }
  return visibleTabs[0] ?? FALLBACK_DEFAULT_TAB;
}
