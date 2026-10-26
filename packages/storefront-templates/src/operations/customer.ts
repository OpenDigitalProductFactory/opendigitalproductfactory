import type { TwinActor, TwinSnapshot } from "./contracts.ts";

export interface CustomerAccountFact { id: string; name: string; status: string; }
export interface CustomerCommitmentFact { id: string; accountId: string; status: string; renewalAt: string; autoRenew: boolean; }
export interface CustomerServiceWorkFact {
  id: string; reference: string; accountId: string | null; title: string; status: string;
  priority: string; dueAt: string | null; owner: TwinActor | null; ownerRef: string | null;
}
export interface CustomerOperatingFacts {
  /** Host-authorized, bounded facts. Null means unavailable, not an empty book. */
  accounts: CustomerAccountFact[] | null;
  commitments: CustomerCommitmentFact[] | null;
  serviceWork: CustomerServiceWorkFact[] | null;
}
/** Record navigation is consumer-owned. An absent port supplies no action. */
export interface CustomerRecordLinks {
  account?(accountId: string): { label: string; href: string } | undefined;
  serviceWork?(workId: string): { label: string; href: string } | undefined;
}

/** Pure read projection. It cannot grant access, change account state or execute a command. */
export function projectCustomerOperations(facts: CustomerOperatingFacts, now: Date, links?: CustomerRecordLinks): TwinSnapshot {
  const accounts = (facts.accounts ?? []).filter((a) => !["superseded", "archived"].includes(a.status));
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const atRisk = accounts.filter((a) => ["at_risk", "suspended"].includes(a.status));
  const commitments = (facts.commitments ?? []).filter((c) => c.status === "active" && byId.has(c.accountId));
  const renewals = commitments.filter((c) => !Number.isFinite(Date.parse(c.renewalAt)) || Date.parse(c.renewalAt) - now.getTime() <= 90 * 86_400_000)
    .sort((a, b) => (Date.parse(a.renewalAt) || 0) - (Date.parse(b.renewalAt) || 0) || a.id.localeCompare(b.id));
  const serviceWork = (facts.serviceWork ?? []).filter((w) => w.accountId && byId.has(w.accountId) && !["resolved", "closed"].includes(w.status))
    .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity) || a.id.localeCompare(b.id));
  const accountAction = (id: string) => links?.account?.(id);
  return {
    capacityChips: [
      { key: "accounts", label: "Accounts recorded", value: facts.accounts == null ? "Unavailable" : accounts.length },
      { key: "at-risk", label: "Flagged at risk", value: facts.accounts == null ? "Unavailable" : atRisk.length, intent: atRisk.length ? "warning" : "neutral" },
      { key: "renewals", label: "Renewal attention", value: facts.commitments == null || facts.accounts == null ? "Unavailable" : renewals.length },
    ],
    zones: [{ key: "board", units: accounts.slice(0, 12).map((a) => ({ key: a.id, label: a.name, state: a.status === "at_risk" ? "At risk" : a.status.charAt(0).toUpperCase() + a.status.slice(1), intent: ["at_risk", "suspended"].includes(a.status) ? "warning" as const : "neutral" as const, action: accountAction(a.id) })) }],
    workItems: serviceWork.slice(0, 12).map((w) => {
      const overdue = w.dueAt != null && Date.parse(w.dueAt) < now.getTime();
      return { key: w.id, label: w.title, owner: w.owner ?? undefined, ownerRef: w.ownerRef ?? undefined, priority: w.priority,
        blockedOnExternal: w.status === "waiting-customer", blockedLabel: w.status === "waiting-customer" ? "Waiting for customer" : undefined,
        sublabel: [w.reference, overdue ? "Overdue SLA" : w.dueAt ? `Due ${w.dueAt.slice(0, 10)}` : "SLA not recorded", w.ownerRef ? `Owner: ${w.ownerRef}` : "Unassigned", `Priority: ${w.priority}`].join(" · "),
        action: links?.serviceWork?.(w.id),
      };
    }),
    queues: [
      { key: "renewals", emptyLabel: facts.commitments == null || facts.accounts == null ? "Renewal source unavailable" : "No renewals within 90 days", items: renewals.slice(0, 12).map((c) => ({ key: c.id, label: byId.get(c.accountId)!.name, meta: `${c.autoRenew ? "Automatic" : "Manual"} renewal · ${Number.isFinite(Date.parse(c.renewalAt)) ? c.renewalAt.slice(0, 10) : "date unavailable"}`, action: accountAction(c.accountId) })) },
      { key: "atrisk", emptyLabel: facts.accounts == null ? "Customer source unavailable" : "No accounts flagged at risk", items: atRisk.slice(0, 12).map((a) => ({ key: a.id, label: a.name, meta: "Stored account status", action: accountAction(a.id) })) },
      { key: "ctas", emptyLabel: facts.serviceWork == null || facts.accounts == null ? "Service work unavailable" : "No open service work", items: serviceWork.slice(0, 12).map((w) => ({ key: w.id, label: w.title, meta: w.reference, action: links?.serviceWork?.(w.id) })) },
    ],
    presence: [], feed: [], quests: [], utility: [],
  };
}
