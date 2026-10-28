// BI-DB506554: where an Admin page sits in the navigation, for messages that
// tell an operator where to go. Read from the nav model, never typed again,
// so a menu change cannot leave a message pointing at a path that is gone.

import { ADMIN_FAMILIES } from "./admin-nav";
import { getRouteNavRecord } from "./portal-navigation-model";
import { AREA_VIEW_LABELS, PORTAL_SHELL_SECTIONS } from "./portal-shell-sections";

/** Rail area › its Setup view › Admin › the Admin tab that holds `href`. */
export function adminPageLocation(href: string): readonly string[] {
  const family = ADMIN_FAMILIES.find((candidate) =>
    candidate.href === href || candidate.subItems.some((item) => item.href === href),
  );
  if (!family) throw new Error(`${href} is not an Admin page`);
  const admin = getRouteNavRecord("/admin");
  const area = PORTAL_SHELL_SECTIONS.find((section) => section.key === admin?.setupFor);
  if (!admin || !area) throw new Error("Admin is not listed in any area's Setup view");
  return [area.label, AREA_VIEW_LABELS.setup, admin.label, family.label];
}

export function adminPageLocationLabel(href: string): string {
  return adminPageLocation(href).join(" › ");
}

/** The panel that lists and ends one account's agent credentials (BI-DB506554). */
export const AGENT_ACCESS_PANEL = {
  pageHref: "/admin/platform-development",
  anchor: "agent-access",
  title: "Agent access for one account",
} as const;

/** The menu path to that panel, for messages that send an operator there. */
export function agentAccessLocationLabel(): string {
  return `${adminPageLocationLabel(AGENT_ACCESS_PANEL.pageHref)} › ${AGENT_ACCESS_PANEL.title}`;
}

/** A link that opens the panel on one account (email or user id). */
export function agentAccessHref(account?: string): string {
  const query = account ? `?account=${encodeURIComponent(account)}` : "";
  return `${AGENT_ACCESS_PANEL.pageHref}${query}#${AGENT_ACCESS_PANEL.anchor}`;
}
