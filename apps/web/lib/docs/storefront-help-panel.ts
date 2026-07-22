// apps/web/lib/docs/storefront-help-panel.ts
//
// Source-route-specific help panels for Storefront Docs links (BI-2DD18122).
//
// When an owner opens the contextual "Docs" link from a storefront admin route
// (e.g. /storefront/settings/operations), the docs shell should lead with a
// task-focused help panel — NOT the ~82-link docs catalog. Each panel answers
// the four questions a non-technical owner actually has:
//
//   1. What is this?
//   2. What should I do next?
//   3. What changes if I save/confirm?
//   4. How do I recover / undo?
//
// The copy is archetype-aware: it interpolates the storefront's own vocabulary
// (Menu / Guests / Reservations / Staff for a Restaurant), so a food-hospitality
// install preserves Restaurant vocabulary — tables, reservations, menu, hours,
// guests, availability — instead of generic "items / customers / inbox" wording.
//
// Pure and client-safe (no fs / prisma). The docs page resolves the archetype
// vocabulary server-side and passes it in.

import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

// ── Public shape ─────────────────────────────────────────────────────────────

export type StorefrontHelpPanel = {
  /** The storefront route the reader came from (normalized, no /admin prefix). */
  routeKey: string;
  /** Docs page this route maps to — kept so the panel can deep-link the catalog. */
  docsPath: string;
  /** Short, plain-language heading. */
  title: string;
  /** "What is this" — one or two sentences. */
  whatIsThis: string;
  /** "What should I do next" — ordered, concrete steps. */
  whatToDoNext: string[];
  /** "What changes if I save/confirm" — the visible/public effect of mutations. */
  whatChangesIfYouSave: string[];
  /** "How do I recover / undo" — the safe way back. */
  howToRecover: string[];
};

// ── Archetype-aware lexicon ──────────────────────────────────────────────────

/**
 * The bookable resource a booking is assigned to, per archetype category.
 * For a Restaurant this is a *table* — which is exactly the "table-as-provider"
 * confusion the owner audit surfaced on the team route.
 */
const RESOURCE_NOUN: Record<string, { resource: string; resourcePlural: string }> = {
  "food-hospitality": { resource: "table", resourcePlural: "tables" },
  "healthcare-wellness": { resource: "appointment slot", resourcePlural: "appointment slots" },
  "beauty-personal-care": { resource: "appointment slot", resourcePlural: "appointment slots" },
  "pet-services": { resource: "appointment slot", resourcePlural: "appointment slots" },
  "professional-services": { resource: "appointment slot", resourcePlural: "appointment slots" },
  "fitness-recreation": { resource: "class", resourcePlural: "classes" },
  "education-training": { resource: "class", resourcePlural: "classes" },
  "asset-rental": { resource: "unit", resourcePlural: "units" },
  "live-events-venues": { resource: "seat", resourcePlural: "seats" },
  "real-estate-construction": { resource: "appointment slot", resourcePlural: "appointment slots" },
  "warehousing-fulfilment": { resource: "handling slot", resourcePlural: "handling slots" },
};

const DEFAULT_RESOURCE = { resource: "bookable slot", resourcePlural: "bookable slots" };

type HelpLexicon = {
  portal: string; // "Venue Portal"
  menu: string; // "Menu"
  item: string; // "Item"
  guests: string; // "Guests"
  reservations: string; // "Reservations"
  staff: string; // "Staff"
  category: string; // "Course"
  price: string; // "Price"
  resource: string; // "table"
  resourcePlural: string; // "tables"
};

function buildLexicon(vocab: ArchetypeVocabulary, archetypeCategory?: string | null): HelpLexicon {
  const res = RESOURCE_NOUN[archetypeCategory ?? ""] ?? DEFAULT_RESOURCE;
  return {
    portal: vocab.portalLabel,
    menu: vocab.itemsLabel,
    item: vocab.singleItemLabel,
    guests: vocab.stakeholderLabel,
    reservations: vocab.inboxLabel,
    staff: vocab.teamLabel,
    category: vocab.categoryLabel,
    price: vocab.priceLabel,
    resource: res.resource,
    resourcePlural: res.resourcePlural,
  };
}

// Lowercase helpers keep interpolated labels reading naturally mid-sentence.
const lc = (s: string) => s.toLowerCase();

// ── Panel builders (one per storefront route family) ─────────────────────────

type PanelBuilder = (lex: HelpLexicon) => Omit<StorefrontHelpPanel, "routeKey" | "docsPath">;

const DASHBOARD: PanelBuilder = (lex) => ({
  title: `Your ${lex.portal} at a glance`,
  whatIsThis: `This is the control centre for your public ${lex.portal}. It shows whether you are published, how much of your ${lc(lex.menu)} and how many page sections are live, and it links into every setup step — brand, ${lc(lex.menu)}, ${lex.resourcePlural}, hours, and ${lc(lex.reservations)}.`,
  whatToDoNext: [
    `Work through setup in order: brand & public profile → ${lc(lex.menu)} → ${lex.resourcePlural} & ${lc(lex.staff)} → hours & availability → ${lc(lex.reservations)}.`,
    `Set one thing up at a time instead of editing every surface at once.`,
    `Leave advanced service lines and cross-industry options closed until your core ${lex.portal} is live.`,
  ],
  whatChangesIfYouSave: [
    `Publishing makes your ${lex.portal} visible to ${lc(lex.guests)} at your public link.`,
    `Adding a service line can generate extra sections and ${lc(lex.menu)} items you will then need to review or remove.`,
  ],
  howToRecover: [
    `Nothing on this page changes anything just by loading it — you can leave without saving.`,
    `If a wrong service line added content, remove the generated sections and ${lc(lex.menu)} items, or unpublish while you clean up, then publish again.`,
  ],
});

const OPERATIONS: PanelBuilder = (lex) => ({
  title: `Opening hours & availability`,
  whatIsThis: `This is where you set your ${lex.portal}'s opening hours, time zone, and the availability windows that decide when ${lc(lex.guests)} can request ${lc(lex.reservations)} against your ${lex.resourcePlural}.`,
  whatToDoNext: [
    `Set your time zone first — every hour and availability window is read in it.`,
    `Enter opening hours for each day; leave a day closed to block ${lc(lex.reservations)} then.`,
    `Adjust availability windows only after your ${lex.resourcePlural} and ${lc(lex.staff)} are in place.`,
  ],
  whatChangesIfYouSave: [
    `Saving hours immediately changes when ${lc(lex.guests)} can book ${lc(lex.reservations)} on your live ${lex.portal}.`,
    `Changing the time zone shifts every existing hour and availability window — a 7pm slot can move to a different clock time for ${lc(lex.guests)}.`,
  ],
  howToRecover: [
    `Hours and time zone stay editable — reopen this page and set them back at any time.`,
    `If ${lc(lex.reservations)} start landing at the wrong time after a change, re-check the time zone first, then the per-day hours, then save again.`,
  ],
});

const BUSINESS: PanelBuilder = (lex) => ({
  title: `Business profile & public identity`,
  whatIsThis: `This holds your business identity — description, mission, contact, address, and payment or compliance details — that shapes how your ${lex.portal} presents itself to ${lc(lex.guests)}.`,
  whatToDoNext: [
    `Fill the core identity first: name, description, and contact details.`,
    `Leave advanced fields (source-system / migration, market scope, AI autonomy) until the basics are correct.`,
    `Review the public-facing wording before you consider the profile done.`,
  ],
  whatChangesIfYouSave: [
    `Saving updates the identity and framing ${lc(lex.guests)} see on your ${lex.portal}.`,
    `Payment, compliance, and region fields can change what checkout or ${lc(lex.reservations)} flows are offered.`,
  ],
  howToRecover: [
    `Every field here is editable — reopen this page and correct it; nothing is public until you publish.`,
    `If you are unsure a value is right, change the one field back rather than resetting the whole form.`,
  ],
});

const TEAM: PanelBuilder = (lex) => ({
  title: `${lex.staff} & who fulfils ${lc(lex.reservations)}`,
  whatIsThis: `This lists the ${lc(lex.staff)} and providers who deliver your work. A "provider" is whoever — or whatever ${lex.resource} — a ${lex.resource ? lex.resource : "booking"} is assigned to: for a restaurant that is often your ${lex.resourcePlural} and the ${lc(lex.staff)} who serve them, not a single named person.`,
  whatToDoNext: [
    `Add your ${lc(lex.staff)}, and if you take ${lc(lex.reservations)} against specific ${lex.resourcePlural}, add those ${lex.resourcePlural} as providers too.`,
    `Give each provider availability so bookings only land when that ${lex.resource} or person is free.`,
    `Keep ${lex.resourcePlural} and ${lc(lex.staff)} distinct so the roster stays readable.`,
  ],
  whatChangesIfYouSave: [
    `Adding or removing a provider changes which ${lex.resourcePlural} or ${lc(lex.staff)} can receive ${lc(lex.reservations)}.`,
    `Editing availability changes the slots ${lc(lex.guests)} see on your live ${lex.portal}.`,
  ],
  howToRecover: [
    `Removing a provider does not delete past ${lc(lex.reservations)}; re-add the provider to restore future availability.`,
    `If ${lex.resourcePlural} and ${lc(lex.staff)} got mixed up, rename or remove the wrong providers here — nothing is published until you save.`,
  ],
});

const ITEMS: PanelBuilder = (lex) => ({
  title: `Your ${lex.menu}`,
  whatIsThis: `This is your ${lex.menu} — the ${lc(lex.menu)} entries ${lc(lex.guests)} can view, order, or book. Each ${lc(lex.item)} has a name, ${lc(lex.price)}, ${lc(lex.category)}, and availability.`,
  whatToDoNext: [
    `Edit the pre-loaded ${lc(lex.menu)} items to match what you actually offer, then add your own by ${lc(lex.category)}.`,
    `Remove any generated or cross-industry items that do not belong on your ${lex.menu}.`,
    `Check the public ${lex.portal} after a meaningful ${lc(lex.menu)} change.`,
  ],
  whatChangesIfYouSave: [
    `Saving an ${lc(lex.item)} updates your public ${lex.menu} as soon as the ${lex.portal} is published.`,
    `Turning an ${lc(lex.item)} Off hides it from ${lc(lex.guests)} without deleting it.`,
  ],
  howToRecover: [
    `Toggle a hidden ${lc(lex.item)} back On to restore it — Off is fully reversible.`,
    `To clear generated ${lc(lex.menu)} residue, delete the unwanted items here; deleting an ${lc(lex.item)} does not remove past orders or ${lc(lex.reservations)}.`,
  ],
});

const SECTIONS: PanelBuilder = (lex) => ({
  title: `Page sections`,
  whatIsThis: `Sections are the building blocks of your public ${lex.portal} page — hero, featured ${lc(lex.menu)}, ${lc(lex.reservations)} calendar, and so on. Reordering or hiding a section changes what ${lc(lex.guests)} see, not your underlying ${lc(lex.menu)}.`,
  whatToDoNext: [
    `Arrange sections in the order ${lc(lex.guests)} should read them; hide any you do not need yet.`,
    `Remove generated or cross-industry sections left over from setup or a wrong service line.`,
    `Preview the public page after reordering.`,
  ],
  whatChangesIfYouSave: [
    `Show / Hide and the ↑ / ↓ order controls change your public page layout as soon as it is published.`,
    `Hiding a section keeps its content — it just stops showing to ${lc(lex.guests)}.`,
  ],
  howToRecover: [
    `Hiding is reversible: Show the section again to bring it back exactly as it was.`,
    `If setup generated unwanted sections, Hide or delete them here; your ${lc(lex.menu)} items are stored separately and stay intact.`,
  ],
});

const INBOX: PanelBuilder = (lex) => ({
  title: `${lex.reservations} & enquiries`,
  whatIsThis: `This is your ${lex.reservations} inbox — the ${lc(lex.reservations)}, orders, and enquiries ${lc(lex.guests)} send through your ${lex.portal}. Treat it as a response queue, not a long-term customer record.`,
  whatToDoNext: [
    `Work newest first: confirm, respond to, or route each ${lc(lex.guests)} message.`,
    `Move anything that needs ongoing follow-up into your customer records.`,
    `Keep the queue clear so no ${lc(lex.guests)} request is missed.`,
  ],
  whatChangesIfYouSave: [
    `Confirming or replying notifies the ${lc(lex.guests)} and updates the request's status.`,
    `Nothing you do here changes your public ${lex.portal} or your ${lc(lex.menu)}.`,
  ],
  howToRecover: [
    `Responding does not delete the original message — the thread stays for context.`,
    `If you route a message to the wrong place, it remains in the inbox history to pick back up.`,
  ],
});

const SETUP: PanelBuilder = (lex) => ({
  title: `Guided ${lex.portal} setup`,
  whatIsThis: `This is the guided setup that stands up your ${lex.portal}: choose an archetype, set your public URL and branding, then load starter ${lc(lex.menu)} and sections that match your business.`,
  whatToDoNext: [
    `Complete the steps in order and stop to check each one rather than rushing to publish.`,
    `Pick the archetype that matches your real business so the starter ${lc(lex.menu)} and vocabulary fit.`,
    `Verify business context, ${lc(lex.menu)}, and hours before you launch.`,
  ],
  whatChangesIfYouSave: [
    `Finishing setup can generate starter sections and ${lc(lex.menu)} items for your archetype.`,
    `Launching makes the ${lex.portal} reachable at your public link for ${lc(lex.guests)}.`,
  ],
  howToRecover: [
    `Partial setup is not live until you publish — you can leave and resume later.`,
    `If the starter content does not fit, edit or remove the generated ${lc(lex.menu)} items and sections afterwards; re-running setup does not wipe your edits automatically.`,
  ],
});

// ── Route registry (longest prefix wins) ─────────────────────────────────────

type RouteEntry = { routeKey: string; docsPath: string; build: PanelBuilder };

// Ordered most-specific first so the longest matching prefix is chosen. The
// docsPath mirrors DOCS_ROUTE_MAP in lib/docs-route-map.ts.
const STOREFRONT_HELP_ROUTES: RouteEntry[] = [
  { routeKey: "/storefront/settings/operations", docsPath: "/docs/storefront/settings-business-and-operations", build: OPERATIONS },
  { routeKey: "/storefront/settings/business", docsPath: "/docs/storefront/settings-business-and-operations", build: BUSINESS },
  { routeKey: "/storefront/settings", docsPath: "/docs/storefront/settings-business-and-operations", build: BUSINESS },
  { routeKey: "/storefront/setup", docsPath: "/docs/storefront/setup-and-launch", build: SETUP },
  { routeKey: "/storefront/team", docsPath: "/docs/storefront/team-and-fulfilment", build: TEAM },
  { routeKey: "/storefront/items", docsPath: "/docs/storefront/catalog-and-page-content", build: ITEMS },
  { routeKey: "/storefront/sections", docsPath: "/docs/storefront/catalog-and-page-content", build: SECTIONS },
  { routeKey: "/storefront/inbox", docsPath: "/docs/storefront/inbox-and-enquiries", build: INBOX },
  { routeKey: "/storefront", docsPath: "/docs/storefront/index", build: DASHBOARD },
];

/** Route keys that have a dedicated help panel — exported for tests/tooling. */
export const STOREFRONT_HELP_ROUTE_KEYS = STOREFRONT_HELP_ROUTES.map((r) => r.routeKey);

// ── Resolution ───────────────────────────────────────────────────────────────

/**
 * Normalize a source route so admin and public storefront variants share panels
 * and trailing slashes / leaf ids don't defeat prefix matching.
 * `/admin/storefront/team` and `/storefront/team/prov-1` both → `/storefront/team`.
 */
function normalizeSourceRoute(sourceRoute: string): string {
  let route = sourceRoute.split("?")[0]!.split("#")[0]!;
  if (route.length > 1 && route.endsWith("/")) route = route.replace(/\/+$/, "");
  if (route === "/admin/storefront" || route.startsWith("/admin/storefront/")) {
    route = route.slice("/admin".length);
  }
  return route;
}

function routeMatches(pathname: string, routeKey: string): boolean {
  return pathname === routeKey || pathname.startsWith(`${routeKey}/`);
}

/**
 * Resolve the task-focused help panel for a storefront source route, rendered
 * with the install's own archetype vocabulary. Returns null for any route that
 * is not a storefront admin surface.
 */
export function resolveStorefrontHelpPanel(
  sourceRoute: string | null | undefined,
  opts: { vocab: ArchetypeVocabulary; archetypeCategory?: string | null },
): StorefrontHelpPanel | null {
  if (!sourceRoute || !sourceRoute.startsWith("/")) return null;

  const route = normalizeSourceRoute(sourceRoute);

  let best: RouteEntry | null = null;
  for (const entry of STOREFRONT_HELP_ROUTES) {
    if (routeMatches(route, entry.routeKey)) {
      if (!best || entry.routeKey.length > best.routeKey.length) best = entry;
    }
  }
  if (!best) return null;

  const lex = buildLexicon(opts.vocab, opts.archetypeCategory);
  return {
    routeKey: best.routeKey,
    docsPath: best.docsPath,
    ...best.build(lex),
  };
}
