// Route audience + destination-kind classification (BI-8C0F219A, EP-UX-COGLOAD).
//
// The portal has ~330 page routes but the hand-authored navigation model lists a
// fraction of them, so the *purpose* of most routes is implicit and hard to police
// as the portal grows. This module makes it explicit: every page route is classified
// by its primary AUDIENCE (who the surface is for) and DESTINATION KIND (what shape of
// destination it is). A generated, committed registry
// (`route-audience.generated.json`, built by `scripts/build-route-audience.ts`) is the
// queryable output; a CI check keeps it fresh and warns when a new page route can only
// be classified with low confidence and has no explicit override.
//
// This layers on top of the route-inventory single source of truth
// (`apps/web/lib/ea/route-manifest.json`) — it does NOT re-walk the filesystem or fork
// the inventory. Pure + dependency-free so the build script (plain Node) and unit tests
// can import it.

/** Who a page route is primarily for. */
export type RouteAudience =
  | "owner" // the non-technical business owner / operator making business decisions
  | "worker" // day-to-day task execution (queues, my-work)
  | "customer" // authenticated external customer (the /portal experience)
  | "builder" // platform delivery / Build Studio surfaces
  | "admin" // platform administration, operations, architecture, governance
  | "public" // unauthenticated marketing / short-link / reference surfaces
  | "auth-setup"; // login, setup, welcome, credential recovery

/** What shape of destination a page route is. */
export type RouteDestinationKind =
  | "section-home" // a durable domain landing (top-level section root)
  | "detail" // a record/entity detail page (usually dynamic)
  | "workflow-step" // a step in a create/edit/wizard flow
  | "settings-config" // settings / configuration surface
  | "advanced-diagnostic" // deep technical / diagnostic surface (progressive-disclosure boundary)
  | "legacy-internal"; // redirect shim / internal-only / deprecated

export const ROUTE_AUDIENCES: readonly RouteAudience[] = [
  "owner",
  "worker",
  "customer",
  "builder",
  "admin",
  "public",
  "auth-setup",
] as const;

export const ROUTE_DESTINATION_KINDS: readonly RouteDestinationKind[] = [
  "section-home",
  "detail",
  "workflow-step",
  "settings-config",
  "advanced-diagnostic",
  "legacy-internal",
] as const;

/** The minimal route shape the classifier needs (a subset of RouteManifestRow). */
export interface ClassifiableRoute {
  routePath: string;
  segments: string[];
  dynamicParams: string[];
  redirectTo?: string;
}

export interface RouteClassification {
  audience: RouteAudience;
  destinationKind: RouteDestinationKind;
  /** "high" when the first segment is known AND a specific kind rule matched;
   *  "low" when the audience/kind is a fallback guess — these want an override. */
  confidence: "high" | "low";
  /** "override" when a pin in ROUTE_AUDIENCE_OVERRIDES decided it, else "heuristic". */
  source: "heuristic" | "override";
}

// ─── First-segment → audience (the durable-domain map) ───────────────────────
//
// Best-guess DEFAULT per top-level segment. Ambiguous or refine-worthy routes are
// pinned in ROUTE_AUDIENCE_OVERRIDES below; anything that falls through to the
// UNKNOWN default is classified low-confidence and surfaced by the CI warning.

const AUTH_SETUP_SEGMENTS = new Set([
  "login",
  "welcome",
  "setup",
  "forgot-password",
  "reset-password",
  "customer-login",
  "customer-signup",
  "customer-complete-profile",
  "customer-link-account",
  "sandbox-restricted",
]);

const FIRST_SEGMENT_AUDIENCE: Record<string, RouteAudience> = {
  // Platform delivery / build
  build: "builder",
  // Platform administration / operations / architecture / governance / knowledge ops
  platform: "admin",
  admin: "admin",
  ops: "admin",
  ea: "admin",
  governance: "admin",
  wiki: "admin",
  knowledge: "admin",
  // External customer + public
  portal: "customer",
  s: "public",
  docs: "public",
  // Owner / operator business domains
  finance: "owner",
  workspace: "owner",
  performance: "owner",
  compliance: "owner",
  customer: "owner", // owner-facing CRM (managing customers)
  storefront: "owner", // internal storefront management (AGENTS §2: /storefront is internal)
  portfolio: "owner",
  "coworker-decisions": "owner",
  workbooks: "owner",
  inventory: "owner",
  delivery: "owner",
  complaints: "owner",
  employee: "owner",
  rental: "owner",
  "member-equity": "owner",
  "service-requests": "owner",
};

/** Segments that mark a settings/configuration surface anywhere in the path. */
const SETTINGS_SEGMENTS = new Set(["settings", "configuration", "config", "preferences"]);
/** Trailing segments that mark a create/edit/wizard workflow step. */
const WORKFLOW_SEGMENTS = new Set(["new", "create", "edit", "add", "wizard", "onboarding"]);
/** First segments whose deep pages are technical/diagnostic by default. */
const ADVANCED_FIRST_SEGMENTS = new Set(["platform", "admin", "ops", "ea", "governance", "wiki"]);

/**
 * Explicit overrides — the pin registry. Add an entry here when the heuristic gets a
 * route wrong or classifies it low-confidence. Keyed by exact routePath.
 */
export const ROUTE_AUDIENCE_OVERRIDES: Record<
  string,
  { audience: RouteAudience; destinationKind: RouteDestinationKind }
> = {
  "/": { audience: "auth-setup", destinationKind: "legacy-internal" }, // redirect → /welcome
  "/workspace": { audience: "owner", destinationKind: "section-home" },
  "/performance": { audience: "owner", destinationKind: "section-home" },
  "/workspace/my-queue": { audience: "worker", destinationKind: "detail" },
  "/workspace/inbox": { audience: "worker", destinationKind: "detail" },
  "/knowledge": { audience: "public", destinationKind: "section-home" },
  "/docs": { audience: "public", destinationKind: "section-home" },
  // EP-COWORKER-IDENTITY-360: the Coworker Identity 360 — an owner-facing per-
  // coworker detail surface, peer to People (/employee) and Customers (/customer).
  "/workforce/[agentId]": { audience: "owner", destinationKind: "detail" },
};

// ─── Classifier ──────────────────────────────────────────────────────────────

function lastSegment(segments: string[]): string {
  return segments.length ? segments[segments.length - 1]! : "/";
}

/** Derive the audience from the first segment (auth-setup segments win). */
function audienceOf(route: ClassifiableRoute): { audience: RouteAudience; known: boolean } {
  const first = route.segments[0];
  if (first && AUTH_SETUP_SEGMENTS.has(first)) return { audience: "auth-setup", known: true };
  if (first && first in FIRST_SEGMENT_AUDIENCE) {
    return { audience: FIRST_SEGMENT_AUDIENCE[first]!, known: true };
  }
  // Unknown top-level segment (or the root) — default to admin/internal, low confidence.
  return { audience: "admin", known: false };
}

/** Derive the destination kind. Order matters — most specific first. */
function destinationKindOf(route: ClassifiableRoute): RouteDestinationKind {
  if (route.redirectTo) return "legacy-internal";

  const last = lastSegment(route.segments);
  const hasSettings = route.segments.some((s) => SETTINGS_SEGMENTS.has(s));
  if (hasSettings) return "settings-config";

  if (WORKFLOW_SEGMENTS.has(last)) return "workflow-step";

  if (route.dynamicParams.length > 0) return "detail";

  // A top-level section root (one static segment) is a durable section home.
  if (route.segments.length === 1) return "section-home";

  // Deep pages under a technical first segment are diagnostic/advanced.
  const first = route.segments[0];
  if (first && ADVANCED_FIRST_SEGMENTS.has(first) && route.segments.length >= 2) {
    return "advanced-diagnostic";
  }

  // A deep static page under a business domain — best-effort detail.
  return "detail";
}

/** Classify one page route into (audience, destinationKind) with a confidence + source. */
export function classifyRoute(route: ClassifiableRoute): RouteClassification {
  const override = ROUTE_AUDIENCE_OVERRIDES[route.routePath];
  if (override) {
    return {
      audience: override.audience,
      destinationKind: override.destinationKind,
      confidence: "high",
      source: "override",
    };
  }

  const { audience, known } = audienceOf(route);
  const kind = destinationKindOf(route);
  // Confidence keys on AUDIENCE, the classification that matters for policing nav +
  // progressive disclosure. Destination kind is always assigned best-effort; a
  // known-audience route with an ambiguous kind is still "classified". Only an
  // UNRECOGNISED first segment is genuinely unclassified and worth a human override —
  // keeping the CI warning a meaningful signal, not noise across ~330 routes.
  return {
    audience,
    destinationKind: kind,
    confidence: known ? "high" : "low",
    source: "heuristic",
  };
}

// ─── Registry query helpers (for nav + progressive-disclosure consumers) ─────

/** True when a route is a technical/diagnostic or admin/builder surface that should
 *  sit behind a progressive-disclosure boundary for owner/worker audiences (BI-1D718FCA). */
export function isAdvancedRoute(c: Pick<RouteClassification, "audience" | "destinationKind">): boolean {
  return (
    c.destinationKind === "advanced-diagnostic" ||
    c.audience === "admin" ||
    c.audience === "builder"
  );
}

/** True when a route is a durable section home eligible for global/section navigation. */
export function isSectionHome(c: Pick<RouteClassification, "destinationKind">): boolean {
  return c.destinationKind === "section-home";
}
