/**
 * Whether to offer confirming a site's location after check-in (BI-C318C227
 * §2.2), and the words for each answer. Pure, so the rules are testable
 * without the device.
 */
import type { SiteLocationConfirmationRefusal, WorkItemSite } from "@dpf/types";

export const NOT_NOW_DAYS = 30;

export type DismissedSites = Record<string, string>;

export type SiteLocationOffer =
  | { kind: "none" }
  | { kind: "one"; site: WorkItemSite }
  | { kind: "choose"; sites: WorkItemSite[] };

export function needsConfirmation(site: WorkItemSite): boolean {
  return site.hasAddress && !site.locationConfirmed;
}

export function isDismissed(dismissed: DismissedSites, siteId: string, now: Date): boolean {
  const at = Date.parse(dismissed[siteId] ?? "");
  return Number.isFinite(at) && now.getTime() - at < NOT_NOW_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * One site that needs it: offer it. Several sites on the account: let the
 * person say which one they are at, as long as at least one needs it.
 */
export function chooseOffer(sites: readonly WorkItemSite[], dismissed: DismissedSites, now: Date): SiteLocationOffer {
  const open = sites.filter((s) => needsConfirmation(s) && !isDismissed(dismissed, s.id, now));
  if (open.length === 0) return { kind: "none" };
  if (sites.length === 1) return { kind: "one", site: open[0]! };
  return { kind: "choose", sites: open };
}

export function offerQuestion(site: WorkItemSite): string {
  return `Set the location of ${site.name} from where you are now? Your phone's location is used once, for this site only.`;
}

export function farQuestion(distanceMeters: number): string {
  const km = distanceMeters / 1000;
  const shown = km >= 10 ? Math.round(km).toString() : km.toFixed(1);
  return `The address on file is ${shown} km from you. Are you at the site?`;
}

export function refusalMessage(reason: SiteLocationConfirmationRefusal): string {
  switch (reason) {
    case "inaccurate":
      return "Your phone couldn't get a precise enough location. Try again outside or near a window.";
    case "already-confirmed":
      return "This site's location has already been confirmed.";
    case "not-checked-in":
      return "Check in to the job first, then set the site's location.";
    case "no-address":
      return "This site has no address yet, so its location can't be set here.";
    case "not-assigned":
    case "site-not-on-job":
      return "This site isn't part of a job assigned to you.";
    default:
      return "The site's location wasn't saved. Try again.";
  }
}
