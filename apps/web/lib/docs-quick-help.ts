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
  /** What is reversible / how safe changes are. */
  reversible: string;
  /** Where recovery or further help lives. */
  recovery: string;
};

type QuickHelpEntry = {
  routePrefix: string;
  help: QuickHelp;
};

const QUICK_HELP_MAP: QuickHelpEntry[] = [
  {
    routePrefix: "/storefront/inbox",
    help: {
      whatThisPageIs:
        "The response queue for inbound customer messages and enquiries from your storefront.",
      actionNow:
        "Triage each new message: decide whether it belongs in sales follow-up, fulfilment, or support, then respond or route it without losing the customer's context.",
      ifNothingDone:
        "Enquiries pile up unanswered and customers who reached out are never converted into owned follow-up work.",
      reversible:
        "Routing and re-assigning an enquiry can be redone at any time. A reply you send to a customer cannot be unsent — review it before sending.",
      recovery:
        "Lost the context a message came from? Open the originating storefront or offer from the enquiry. Full guidance is in Storefront → Inbox and Enquiries below.",
    },
  },
  {
    routePrefix: "/storefront/items",
    help: {
      whatThisPageIs:
        "The catalog and page-content editor for the offers and sections shown on your public storefront.",
      actionNow:
        "Decide whether you are editing an offer or the page structure around it, and keep item details, sections, and published messaging aligned.",
      ifNothingDone:
        "The public storefront keeps showing stale or inconsistent content, and sections may promise flows the underlying item cannot support.",
      reversible:
        "Content edits can be changed back, but they affect the live storefront — re-check the public page after a meaningful change.",
      recovery:
        "Preview the public storefront to confirm the customer-facing result. Full guidance is in Storefront → Catalog and Page Content below.",
    },
  },
  {
    routePrefix: "/storefront/settings/business",
    help: {
      whatThisPageIs:
        "The business-context settings behind your storefront — identity, promise, and customer-facing framing.",
      actionNow:
        "Correct the business identity or promise only where it no longer matches what customers actually experience.",
      ifNothingDone:
        "Your storefront keeps presenting a business context that has drifted from reality, confusing both customers and staff.",
      reversible:
        "Settings can be edited back at any time, but changes affect the public storefront immediately — verify the public page after saving.",
      recovery:
        "Preview the live storefront URL to confirm impact. Full guidance is in Storefront → Settings, Business and Operations below.",
    },
  },
  {
    routePrefix: "/storefront/settings",
    help: {
      whatThisPageIs:
        "The storefront settings for presentation, live URL, business context, and operating rules.",
      actionNow:
        "Start with core presentation and the live URL; move to business context or operations settings only when identity, hours, or availability are wrong.",
      ifNothingDone:
        "Operating rules and customer promises stay out of sync with how the business actually runs.",
      reversible:
        "Every setting can be changed back, but hours and availability rules affect real customer interactions the moment they are saved.",
      recovery:
        "Check the public storefront after changing operating rules. Full guidance is in Storefront → Settings, Business and Operations below.",
    },
  },
  {
    routePrefix: "/storefront/setup",
    help: {
      whatThisPageIs: "The guided setup flow that prepares a storefront for launch.",
      actionNow:
        "Complete the guided steps in order and verify business context, catalog, and operational settings before you launch.",
      ifNothingDone:
        "A partially configured storefront can be mistaken for launch-ready and go live with gaps.",
      reversible:
        "Setup choices can be revisited before and after launch; check the public route after any launch-related change.",
      recovery:
        "Re-open the guided setup to resume where you left off. Full guidance is in Storefront → Setup and Launch below.",
    },
  },
  {
    routePrefix: "/storefront/team",
    help: {
      whatThisPageIs: "Who delivers, supports, or owns the storefront work.",
      actionNow:
        "Review staffing and assignments with the customer journey in mind before changing owners.",
      ifNothingDone:
        "Visible storefront promises can be left with no matching fulfilment owner.",
      reversible:
        "Staffing and assignment changes can be reassigned again at any time.",
      recovery:
        "Re-check booking, enquiry, and fulfilment flows after team updates. Full guidance is in Storefront → Team and Fulfilment below.",
    },
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
];

function routeMatches(pathname: string, routePrefix: string): boolean {
  return pathname === routePrefix || pathname.startsWith(`${routePrefix}/`);
}

/**
 * Resolve the route-specific quick help for a source route by longest matching
 * prefix. Returns null when the route is unknown or not an internal path.
 */
export function resolveQuickHelp(sourceRoute: string | undefined | null): QuickHelp | null {
  if (!sourceRoute || !sourceRoute.startsWith("/")) return null;

  let best: QuickHelpEntry | null = null;
  for (const entry of QUICK_HELP_MAP) {
    if (routeMatches(sourceRoute, entry.routePrefix)) {
      if (!best || entry.routePrefix.length > best.routePrefix.length) {
        best = entry;
      }
    }
  }

  return best?.help ?? null;
}

export function getQuickHelpRoutes(): string[] {
  return QUICK_HELP_MAP.map((entry) => entry.routePrefix);
}
