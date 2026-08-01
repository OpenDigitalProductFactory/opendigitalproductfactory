// apps/web/lib/docs-quick-help.ts
// Route-specific "quick help" answers for the contextual docs panel.
//
// The goal is to reduce overload: instead of dropping the operator into a
// generic docs manual, the contextual docs surface leads with a short panel
// that answers the five questions a person actually has when they open help
// from a page they are stuck on.
//
// Quick help is keyed by the ROUTE they came from (`sourceRoute`), not by the
// docs page. Several routes legitimately share one long-form doc, so the doc
// alone cannot say "what to do now" for the specific screen. Resolution is by
// longest matching route prefix, so a leaf route (e.g. /storefront/settings/business)
// can override the family default (/storefront/settings).
//
// Data-only module — no Node imports — so it is safe to import from client and
// server components and trivial to unit test.

export type QuickHelp = {
  /** What this page is — one plain-language line. */
  whatThisPageIs: string;
  /** The single most useful action to take right now. */
  actionNow: string;
  /** What happens if nothing is done. */
  ifNothingDone: string;
  /**
   * What actually changes when this screen's save/confirm is pressed.
   * Optional: only screens with a mutating save need to answer it, but setup
   * screens must (BI-2DD18122 — owners could not tell what a save affected).
   */
  whatChangesIfYouSave?: string;
  /** What is reversible / how safe changes are. */
  reversible: string;
  /** Where recovery or further help lives. */
  recovery: string;
};

// ── Archetype-aware vocabulary for storefront entries ────────────────────────
//
// Storefront quick help must speak the install's own language: a Restaurant
// owner reads "menu", "tables", "reservations", "guests" — not "items",
// "providers", "inbox", "customers". Vocabulary comes from the canonical
// archetype source (lib/storefront/archetype-vocabulary), so nothing here
// hardcodes a single archetype. Entries that need it are authored as builder
// functions taking this lexicon.

import { getVocabulary, type ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

/**
 * The bookable resource a booking is assigned to, per archetype category. For a
 * Restaurant this is a *table* — exactly the "is a table a provider or staff?"
 * confusion the owner setup audit surfaced on the team route.
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
  "fabric-care-services": { resource: "counter or station", resourcePlural: "counters and stations" },
  "agriculture-ranching": { resource: "field, pasture, or pen", resourcePlural: "fields, pastures, and pens" },
};

const DEFAULT_RESOURCE = { resource: "bookable slot", resourcePlural: "bookable slots" };

export type QuickHelpLexicon = {
  portal: string;
  menu: string;
  item: string;
  guests: string;
  reservations: string;
  staff: string;
  resource: string;
  resourcePlural: string;
};

/** Options carrying the install's archetype so storefront help speaks its language. */
export type QuickHelpContext = {
  vocab?: ArchetypeVocabulary;
  archetypeCategory?: string | null;
};

function buildLexicon(ctx?: QuickHelpContext): QuickHelpLexicon {
  const vocab = ctx?.vocab ?? getVocabulary(ctx?.archetypeCategory ?? null);
  const res = RESOURCE_NOUN[ctx?.archetypeCategory ?? ""] ?? DEFAULT_RESOURCE;
  return {
    portal: vocab.portalLabel,
    menu: vocab.itemsLabel,
    item: vocab.singleItemLabel,
    guests: vocab.stakeholderLabel,
    reservations: vocab.inboxLabel,
    staff: vocab.teamLabel,
    resource: res.resource,
    resourcePlural: res.resourcePlural,
  };
}

/** Lowercase an interpolated label so it reads naturally mid-sentence. */
const lc = (s: string) => s.toLowerCase();

type QuickHelpEntry = {
  routePrefix: string;
  help: QuickHelp | ((lex: QuickHelpLexicon) => QuickHelp);
};

const QUICK_HELP_MAP: QuickHelpEntry[] = [
  {
    routePrefix: "/storefront/inbox",
    help: (lex) => ({
      whatThisPageIs: `The response queue for ${lc(lex.reservations)}, orders, and enquiries ${lc(lex.guests)} send through your ${lex.portal}.`,
      actionNow: `Work newest first: confirm, respond to, or route each ${lc(lex.guests)} message, then move anything needing ongoing follow-up into your customer records.`,
      ifNothingDone: `${lex.reservations} and enquiries pile up unanswered, and ${lc(lex.guests)} who reached out are never converted into owned follow-up work.`,
      whatChangesIfYouSave: `Confirming or replying notifies the ${lc(lex.guests)} and updates the request's status. Nothing here changes your public ${lex.portal} or your ${lc(lex.menu)}.`,
      reversible: `Routing and re-assigning can be redone at any time, and responding never deletes the original message. A reply you send cannot be unsent — review it before sending.`,
      recovery: `Routed a message to the wrong place? It stays in the inbox history to pick back up. Full guidance is in Storefront → Inbox and Enquiries below.`,
    }),
  },
  {
    routePrefix: "/storefront/items",
    help: (lex) => ({
      whatThisPageIs: `Your ${lex.menu} — the entries ${lc(lex.guests)} can view, order, or book, each with a name, price, and availability.`,
      actionNow: `Edit the pre-loaded ${lc(lex.menu)} entries to match what you actually offer, then remove any generated or cross-industry items that do not belong.`,
      ifNothingDone: `Your public ${lex.portal} keeps showing stale or generated ${lc(lex.menu)} content that does not match what you really serve.`,
      whatChangesIfYouSave: `Saving an ${lc(lex.item)} updates your public ${lex.menu} as soon as the ${lex.portal} is published. Turning one Off hides it from ${lc(lex.guests)} without deleting it.`,
      reversible: `Off is fully reversible — toggle a hidden ${lc(lex.item)} back On to restore it. Deleting removes the entry but not past orders or ${lc(lex.reservations)}.`,
      recovery: `To clear generated ${lc(lex.menu)} residue, delete the unwanted entries here, then preview the public ${lex.portal}. Full guidance is in Storefront → Catalog and Page Content below.`,
    }),
  },
  {
    routePrefix: "/storefront/sections",
    help: (lex) => ({
      whatThisPageIs: `The page sections that build your public ${lex.portal} — hero, featured ${lc(lex.menu)}, ${lc(lex.reservations)} calendar, and so on.`,
      actionNow: `Arrange sections in the order ${lc(lex.guests)} should read them, hide any you do not need yet, and remove sections left over from setup or a wrong service line.`,
      ifNothingDone: `Your public page keeps its generated layout, and cross-industry sections stay visible to ${lc(lex.guests)}.`,
      whatChangesIfYouSave: `Show / Hide and the ↑ / ↓ order controls change your public page layout as soon as it is published. Hiding keeps the content — it just stops showing.`,
      reversible: `Hiding is reversible: Show the section again to bring it back exactly as it was. Your ${lc(lex.menu)} entries are stored separately and are never affected.`,
      recovery: `If setup generated unwanted sections, hide or delete them here, then preview the public page. Full guidance is in Storefront → Catalog and Page Content below.`,
    }),
  },
  {
    routePrefix: "/storefront/settings/business",
    help: (lex) => ({
      whatThisPageIs: `The business-context settings behind your ${lex.portal} — identity, promise, and the framing ${lc(lex.guests)} see.`,
      actionNow: `Fill the core identity first — name, description, contact — and leave advanced fields (migration, market scope, AI autonomy) until the basics are right.`,
      ifNothingDone: `Your ${lex.portal} keeps presenting a business context that has drifted from reality, confusing both ${lc(lex.guests)} and ${lc(lex.staff)}.`,
      whatChangesIfYouSave: `Saving updates the identity and framing on your public ${lex.portal}. Payment, compliance, and region fields can change which checkout or ${lc(lex.reservations)} flows are offered.`,
      reversible: `Every field can be edited back at any time, and nothing is public until you publish — correct the single wrong field rather than resetting the form.`,
      recovery: `Preview the live ${lex.portal} URL to confirm impact. Full guidance is in Storefront → Settings, Business and Operations below.`,
    }),
  },
  {
    routePrefix: "/storefront/settings/operations",
    help: (lex) => ({
      whatThisPageIs: `Your opening hours, time zone, and the availability windows that decide when ${lc(lex.guests)} can book ${lc(lex.reservations)} against your ${lex.resourcePlural}.`,
      actionNow: `Set your time zone first — every hour and availability window is read in it — then enter opening hours per day, leaving a day closed to block ${lc(lex.reservations)}.`,
      ifNothingDone: `${lex.reservations} keep following default hours, so ${lc(lex.guests)} can book when you are closed or miss slots when you are open.`,
      whatChangesIfYouSave: `Saving hours immediately changes when ${lc(lex.guests)} can book on your live ${lex.portal}. Changing the time zone shifts every existing hour and availability window — a 7pm slot can move to a different clock time.`,
      reversible: `Hours and time zone stay editable — reopen this page and set them back at any time. Existing ${lc(lex.reservations)} are not cancelled by an hours change.`,
      recovery: `If ${lc(lex.reservations)} land at the wrong time, re-check the time zone first, then the per-day hours, then save again. Full guidance is in Storefront → Settings, Business and Operations below.`,
    }),
  },
  {
    routePrefix: "/storefront/settings",
    help: (lex) => ({
      whatThisPageIs: `The ${lex.portal} settings for presentation, live URL, business context, and operating rules.`,
      actionNow: `Start with core presentation and the live URL; move to business context or operations settings only when identity, hours, or availability are wrong.`,
      ifNothingDone: `Operating rules and the promises you make ${lc(lex.guests)} stay out of sync with how the business actually runs.`,
      whatChangesIfYouSave: `Presentation and URL changes affect what ${lc(lex.guests)} see; hours and availability rules change when ${lc(lex.reservations)} can be booked the moment they are saved.`,
      reversible: `Every setting can be changed back, but hours and availability affect real ${lc(lex.guests)} interactions immediately.`,
      recovery: `Check the public ${lex.portal} after changing operating rules. Full guidance is in Storefront → Settings, Business and Operations below.`,
    }),
  },
  {
    routePrefix: "/storefront/setup",
    help: (lex) => ({
      whatThisPageIs: `The guided setup that stands up your ${lex.portal}: archetype, public URL, branding, then starter ${lc(lex.menu)} and sections.`,
      actionNow: `Complete the steps in order and pick the archetype that matches your real business, so the starter ${lc(lex.menu)} and vocabulary fit.`,
      ifNothingDone: `A partially configured ${lex.portal} can be mistaken for launch-ready and go live with gaps.`,
      whatChangesIfYouSave: `Finishing setup can generate starter sections and ${lc(lex.menu)} entries for your archetype. Launching makes the ${lex.portal} reachable by ${lc(lex.guests)} at your public link.`,
      reversible: `Partial setup is not live until you publish — you can leave and resume later without affecting ${lc(lex.guests)}.`,
      recovery: `If the starter content does not fit, edit or remove the generated ${lc(lex.menu)} entries and sections afterwards. Full guidance is in Storefront → Setup and Launch below.`,
    }),
  },
  {
    routePrefix: "/storefront/team",
    help: (lex) => ({
      whatThisPageIs: `The ${lc(lex.staff)} and providers who fulfil your work. A provider is whoever — or whatever ${lex.resource} — a booking is assigned to.`,
      actionNow: `Add your ${lc(lex.staff)}, and if you take ${lc(lex.reservations)} against specific ${lex.resourcePlural}, add those ${lex.resourcePlural} as providers too, each with availability.`,
      ifNothingDone: `Visible ${lex.portal} promises are left with no matching fulfilment owner, and bookings land when nobody is free.`,
      whatChangesIfYouSave: `Adding or removing a provider changes which ${lex.resourcePlural} or ${lc(lex.staff)} can receive ${lc(lex.reservations)}. Editing availability changes the slots ${lc(lex.guests)} see.`,
      reversible: `Removing a provider does not delete past ${lc(lex.reservations)}; re-add it to restore future availability. Nothing is published until you save.`,
      recovery: `If ${lex.resourcePlural} and ${lc(lex.staff)} got mixed up, rename or remove the wrong providers here. Full guidance is in Storefront → Team and Fulfilment below.`,
    }),
  },
  {
    routePrefix: "/storefront",
    help: (lex) => ({
      whatThisPageIs: `The control centre for your public ${lex.portal} — whether you are published, and how much ${lc(lex.menu)} and page content is live.`,
      actionNow: `Work setup in order: brand and public profile, ${lc(lex.menu)}, ${lex.resourcePlural} and ${lc(lex.staff)}, hours and availability, then ${lc(lex.reservations)}.`,
      ifNothingDone: `The ${lex.portal} stays unpublished or keeps generated cross-industry content, so ${lc(lex.guests)} cannot find or trust it.`,
      whatChangesIfYouSave: `Publishing makes the ${lex.portal} visible to ${lc(lex.guests)} at your public link. Adding a service line can generate extra sections and ${lc(lex.menu)} entries to review.`,
      reversible: `Nothing changes just by loading this page. Publishing can be undone by unpublishing while you clean up.`,
      recovery: `If a wrong service line added content, remove the generated sections and ${lc(lex.menu)} entries. Full guidance is in Storefront below.`,
    }),
  },
  {
    routePrefix: "/ops/self-upgrade",
    help: {
      whatThisPageIs:
        "The controls for upgrading the platform itself — building a fresh application image and swapping the running install.",
      actionNow:
        "Review the pending upgrade and trigger it only inside an approved deployment window; a normal upgrade completes in a few minutes.",
      ifNothingDone:
        "The install stays on its current version — queued fixes and improvements are not applied until an operator approves the upgrade.",
      reversible:
        "A failed upgrade is automatically rolled back and its container force-removed. A bounded timeout (default 25 minutes) stops a stalled build from hanging or swapping later.",
      recovery:
        "If an upgrade fails, read the deployment log for the retryable diagnosis and re-run. Full guidance is in Operations → Self-Upgrade below.",
    },
  },
  {
    routePrefix: "/ops",
    help: {
      whatThisPageIs:
        "The delivery backlog — the work items, epics, priorities, promotions, and deployments behind your team's commitments.",
      actionNow:
        "Find and clear blockers before they stall delivery, and review promotions that are ready to deploy.",
      ifNothingDone:
        "Blocked or unprioritised work stays invisible in the flow and delivery quietly stalls.",
      reversible:
        "Backlog edits, status moves, and priorities can all be changed back. A deployment is governed and, if it fails, is rolled back automatically.",
      recovery:
        "Check deployment logs and backup references for any failed promotion. Full guidance is in Operations below.",
    },
  },
  {
    routePrefix: "/customer/marketing",
    help: {
      whatThisPageIs:
        "The marketing view for customer acquisition — positioning, audience, funnel health, and proof assets.",
      actionNow:
        "Compare campaign ideas against funnel bottlenecks before acting, and turn repeatable gaps into backlog work.",
      ifNothingDone:
        "Acquisition analysis stays as analysis — gaps never become owned work and campaigns get generated without fixing the real bottleneck.",
      reversible:
        "Reviewing and drafting here changes nothing customer-facing on its own; only promoted backlog items or published campaigns take effect.",
      recovery:
        "Route offer, proof, or follow-up gaps to the right operations area. Full guidance is in Customers → Marketing below.",
    },
  },
  // ── BI-2DD18122 coverage: every contextual Docs entry from the main owner
  // areas lands with a route-specific panel, not the generic catalog. ─────────
  {
    routePrefix: "/workspace",
    help: {
      whatThisPageIs:
        "Your daily home — what needs you now across bookings, customers, money, and your digital team, before any subsystem detail.",
      actionNow:
        "Work the \"needs you\" queue top-down: each card names one decision and the safest next action; anything below it can wait.",
      ifNothingDone:
        "Waiting customers, approvals, and exceptions sit unanswered — the queue is ordered so ignoring it delays the most time-sensitive item first.",
      reversible:
        "Opening and reviewing changes nothing. Each card states its own consequence before you act; most decisions can be revisited, and irreversible ones say so.",
      recovery:
        "A dismissed or completed card's underlying record stays in its own area (inbox, finance, approvals). Full guidance is in Workspace below.",
    },
  },
  {
    routePrefix: "/employee",
    help: {
      whatThisPageIs:
        "The People area — your staff and digital coworkers, their roles, and who is covering the work.",
      actionNow:
        "Check today's staffing and coverage first; role governance and HR configuration can wait until the day is covered.",
      ifNothingDone:
        "Nothing changes by itself, but staffing gaps and unassigned responsibilities stay invisible until they bite during service or delivery.",
      reversible:
        "Viewing is free; assignments and role changes can be changed back. Removing a person's access takes effect immediately — re-adding restores it.",
      recovery:
        "A wrong assignment or role change is corrected by editing it again — the history stays. Full guidance is in People below.",
    },
  },
  {
    routePrefix: "/finance",
    help: {
      whatThisPageIs:
        "The money area — what needs attention today (owed to you, owed by you, approvals), ahead of the accountant's lanes.",
      actionNow:
        "Answer the money jobs first: what must be collected, paid, or approved today. The Revenue/Spend/Close lanes underneath are for deeper accounting work.",
      ifNothingDone:
        "Unpaid invoices age, supplier bills slip past due dates, and approvals block the people waiting on them.",
      reversible:
        "Drafting invoices and reviewing is safe. Recording a payment or approving a bill changes your books — each action says whether it moves real money (most only record it).",
      recovery:
        "A wrongly recorded payment or invoice can be corrected or voided from its own record. Full guidance is in Finance below.",
    },
  },
  {
    routePrefix: "/compliance",
    help: {
      whatThisPageIs:
        "The compliance area — the permits, filings, policies, and evidence your business must keep current.",
      actionNow:
        "Deal with anything due or expiring first; the rest of the register is reference until a deadline approaches.",
      ifNothingDone:
        "Deadlines pass silently — an expired permit or missed filing becomes a real-world business problem, not just a red row here.",
      reversible:
        "Tracking and editing the register is safe and reversible. Submitting a filing to an outside body is external — check it before sending.",
      recovery:
        "A mis-entered requirement can be edited or removed; submitted filings are corrected with the receiving body. Full guidance is in Compliance below.",
    },
  },
  // ── BI-404E9BEA: the decision-governance surface answers the stuck-reader
  // questions too — an "awaiting review" ledger reads as homework without this.
  {
    routePrefix: "/coworker-decisions",
    help: {
      whatThisPageIs:
        "How your AI decides — the questions it consulted your governance on, what it recommended, and the calls it put in front of you (escalated or deferred).",
      actionNow:
        "Use Review & adjust: it rolls the waiting decisions into a few themes. Answer a theme once, or add a stance covering it, and your AI stops needing to ask.",
      ifNothingDone:
        "Work does not silently stall — only a build paused at a decision gate waits, and says so. But unanswered themes keep escalating, so the waiting count keeps growing.",
      reversible:
        "Reading changes nothing. Answers and stances you record can be edited or retired later; they steer future decisions rather than rewriting past ones.",
      recovery:
        "If an answer taught your AI the wrong thing, edit or retire that stance and the next decisions follow the correction. Full guidance is below.",
    },
  },
  {
    routePrefix: "/compliance/licensing",
    help: {
      whatThisPageIs:
        "Licensing readiness — the permits and licences your business needs, with their status and renewal dates.",
      actionNow:
        "Confirm every licence the business actually operates under is listed, and act on anything expiring soon — renewals take lead time.",
      ifNothingDone:
        "A licence lapses and the business may be operating outside its permissions before anyone notices.",
      reversible:
        "Editing the register is reversible and changes nothing externally — renewals themselves happen with the issuing authority.",
      recovery:
        "If a licence has already lapsed, contact the issuing authority about reinstatement and record the outcome here. Full guidance is in Compliance below.",
    },
  },
];

function routeMatches(pathname: string, routePrefix: string): boolean {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

/**
 * Normalize a source route for matching: drop query/hash and trailing slashes,
 * and fold the `/admin/storefront/*` mirror onto `/storefront/*` so both surfaces
 * share one curated answer.
 */
function normalizeSourceRoute(sourceRoute: string): string {
  let route = sourceRoute.split("?")[0]!.split("#")[0]!;
  if (route.length > 1 && route.endsWith("/")) route = route.replace(/\/+$/, "");
  if (route === "/admin/storefront" || route.startsWith("/admin/storefront/")) {
    route = route.slice("/admin".length);
  }
  return route;
}

/**
 * Resolve the route-specific quick help for a source route by longest matching
 * prefix. Returns null when the route is unknown or not an internal path.
 *
 * Pass `ctx` to render archetype-aware entries (storefront) in the install's own
 * vocabulary. Without it, entries fall back to the generic default vocabulary,
 * so client callers and existing call sites keep working unchanged.
 */
export function resolveQuickHelp(
  sourceRoute: string | undefined | null,
  ctx?: QuickHelpContext,
): QuickHelp | null {
  if (!sourceRoute || !sourceRoute.startsWith("/")) return null;

  const route = normalizeSourceRoute(sourceRoute);

  let best: QuickHelpEntry | null = null;
  for (const entry of QUICK_HELP_MAP) {
    if (routeMatches(route, entry.routePrefix)) {
      if (!best || entry.routePrefix.length > best.routePrefix.length) {
        best = entry;
      }
    }
  }

  if (!best) return null;
  return typeof best.help === "function" ? best.help(buildLexicon(ctx)) : best.help;
}

export function getQuickHelpRoutes(): string[] {
  return QUICK_HELP_MAP.map((entry) => entry.routePrefix);
}
