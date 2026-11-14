/** Security finding lifecycle after an intake scan (BI-C67E5CCB, design §Lifecycle).
 *
 * The job closes nothing itself. A group GitHub no longer reports open gets a
 * resolution evidence row and moves to awaiting-acceptance; the existing
 * acceptance sweep closes it under the operator's recorded pre-authorisation.
 * Only surfaces whose open read was complete in THIS run are touched: an
 * unreadable surface must never look like a clean one. */
import { qualifiedIssueOriginId } from "@/lib/operate/backlog-origin-reconciliation";
import type { InboundEcosystemItem } from "./inbound-issue-triage";
import { isSecurityGroupKind, securityOriginKind, type SecurityGroupKind } from "./security-finding-groups";

/** Stamped on every status row this module writes, so it reopens only what it moved. */
export const SECURITY_LIFECYCLE_ACTUATOR = "security-intake-resolution" as const;

const ACTIVE_STATUSES = new Set(["triaging", "open", "in-progress"]);

export interface LifecycleItem {
  id: string;
  itemId: string;
  status: string;
  priority: number | null;
  body: string | null;
  activeBuildId: string | null;
  /** `actuator` of the latest status_change activity, when one recorded it. */
  lastStatusActuator: string | null;
}

export interface ResolutionEvidence {
  summary: string;
  originKind: string;
  originId: string;
  observedAt: string;
}

export interface SecurityLifecycleStore {
  /** Non-retired items owned by this install whose body carries one of these origin-marker prefixes. */
  findItems(markerPrefixes: string[]): Promise<LifecycleItem[]>;
  recordEvidence(item: LifecycleItem, evidence: ResolutionEvidence): Promise<void>;
  /** Conditional on `from`; false when the item moved under us. */
  transition(item: LifecycleItem, from: string, to: string, reason: string): Promise<boolean>;
  raisePriority(item: LifecycleItem, from: number | null, to: number, reason: string): Promise<void>;
}

export interface SecurityLifecycleResult {
  resolved: string[];
  heldByBuild: string[];
  reopened: string[];
  regressions: string[];
  reprioritized: string[];
}

const ORIGIN = /\[origin:(ecosystem-[a-z-]+):([^\]\r\n]+)\]/g;

/** Every security-group origin a body carries, as `kind|id`. */
function originsIn(body: string | null): Array<{ kind: SecurityGroupKind; id: string }> {
  const out: Array<{ kind: SecurityGroupKind; id: string }> = [];
  for (const match of (body ?? "").matchAll(ORIGIN)) {
    const kind = match[1].replace(/^ecosystem-/, "");
    if (isSecurityGroupKind(kind)) out.push({ kind, id: match[2] });
  }
  return out;
}

export async function reconcileSecurityLifecycle(input: {
  completeKinds: SecurityGroupKind[];
  groups: InboundEcosystemItem[];
  store: SecurityLifecycleStore;
  now: Date;
}): Promise<SecurityLifecycleResult> {
  const result: SecurityLifecycleResult = { resolved: [], heldByBuild: [], reopened: [], regressions: [], reprioritized: [] };
  const complete = new Set(input.completeKinds);
  if (complete.size === 0) return result;

  const present = new Map<string, InboundEcosystemItem>();
  for (const group of input.groups) {
    if (!isSecurityGroupKind(group.sourceKind) || !complete.has(group.sourceKind) || !group.repository) continue;
    present.set(`${group.sourceKind}|${qualifiedIssueOriginId(group.repository, group.sourceId)}`, group);
  }

  const prefixes = [...complete].map((kind) => `[origin:${securityOriginKind(kind)}:`);
  const items = await input.store.findItems(prefixes);
  const observedAt = input.now.toISOString();

  for (const item of items) {
    const origin = originsIn(item.body).find((o) => complete.has(o.kind));
    if (!origin) continue;
    const group = present.get(`${origin.kind}|${origin.id}`);

    if (!group) {
      if (!ACTIVE_STATUSES.has(item.status)) continue;
      await input.store.recordEvidence(item, {
        summary: `GitHub no longer reports ${origin.kind} ${origin.id} open (complete read at ${observedAt})`,
        originKind: securityOriginKind(origin.kind), originId: origin.id, observedAt,
      });
      if (item.activeBuildId) { result.heldByBuild.push(item.itemId); continue; }
      const moved = await input.store.transition(item, item.status, "awaiting-acceptance",
        "GitHub reports the finding resolved; the acceptance sweep closes it when the completion gate allows");
      if (moved) result.resolved.push(item.itemId);
      continue;
    }

    if (item.status === "awaiting-acceptance" && item.lastStatusActuator === SECURITY_LIFECYCLE_ACTUATOR) {
      const moved = await input.store.transition(item, "awaiting-acceptance", "open",
        "regression: GitHub reports the finding open again");
      if (moved) result.reopened.push(item.itemId);
    } else if (item.status === "done") {
      result.regressions.push(item.itemId);
      continue;
    }

    const target = typeof group.priority === "number" ? group.priority : null;
    if (target !== null && ACTIVE_STATUSES.has(item.status) && (item.priority === null || item.priority > target)) {
      await input.store.raisePriority(item, item.priority, target,
        `severity tier ${group.securityGroup?.highestSeverity ?? "unknown"} on GitHub`);
      result.reprioritized.push(item.itemId);
    }
  }
  return result;
}

type LifecycleDb = {
  backlogItem: {
    findMany(args: unknown): Promise<Array<{ id: string; itemId: string; status: string; priority: number | null; body: string | null;
      activeBuildId: string | null; activities: Array<{ payload: unknown }> }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
  $transaction<T>(fn: (tx: LifecycleDb) => Promise<T>): Promise<T>;
};

/** Prisma-backed store. Federated mirrors are excluded: only the origin installation moves its own item. */
export function prismaSecurityLifecycleStore(db: LifecycleDb, isPeerOwned: (itemId: string, body: string | null) => boolean): SecurityLifecycleStore {
  return {
    async findItems(markerPrefixes) {
      if (markerPrefixes.length === 0) return [];
      const rows = await db.backlogItem.findMany({
        where: { status: { not: "retired" }, OR: markerPrefixes.map((prefix) => ({ body: { contains: prefix } })) },
        select: { id: true, itemId: true, status: true, priority: true, body: true, activeBuildId: true,
          activities: { where: { kind: "status_change" }, orderBy: { recordedAt: "desc" }, take: 1, select: { payload: true } } },
      });
      return rows.filter((r) => !isPeerOwned(r.itemId, r.body)).map((r) => {
        const payload = r.activities[0]?.payload;
        const actuator = payload && typeof payload === "object" && typeof (payload as { actuator?: unknown }).actuator === "string"
          ? (payload as { actuator: string }).actuator : null;
        // A read projection, not a write: the row's own status is reported as found.
        const { id, itemId, status, priority, body, activeBuildId } = r;
        return { id, itemId, status, priority, body, activeBuildId, lastStatusActuator: actuator };
      });
    },
    async recordEvidence(item, evidence) {
      await db.backlogItemActivity.create({ data: { backlogItemId: item.id, kind: "evidence", summary: evidence.summary.slice(0, 500),
        payload: { actuator: SECURITY_LIFECYCLE_ACTUATOR, source: "github-security-alerts", body: evidence.summary,
          origin: { kind: evidence.originKind, id: evidence.originId }, observedAt: evidence.observedAt } } });
    },
    async transition(item, from, to, reason) {
      return db.$transaction(async (tx) => {
        const updated = await tx.backlogItem.updateMany({ where: { id: item.id, status: from },
          data: { status: to, ...(to === "awaiting-acceptance"
            ? { claimStatus: "released", claimedById: null, claimedByAgentId: null, claimedAt: null } : {}) } });
        if (updated.count !== 1) return false;
        await tx.backlogItemActivity.create({ data: { backlogItemId: item.id, kind: "status_change",
          summary: `${from} → ${to} — ${reason}`.slice(0, 500),
          payload: { from, to, reason, actuator: SECURITY_LIFECYCLE_ACTUATOR,
            ...(to === "awaiting-acceptance" ? { claimAction: "released" } : {}) } } });
        return true;
      });
    },
    async raisePriority(item, from, to, reason) {
      await db.$transaction(async (tx) => {
        await tx.backlogItem.updateMany({ where: { id: item.id }, data: { priority: to } });
        await tx.backlogItemActivity.create({ data: { backlogItemId: item.id, kind: "priority_change",
          summary: `priority ${from ?? "unset"} → ${to} — ${reason}`.slice(0, 500),
          payload: { from, to, reason, actuator: SECURITY_LIFECYCLE_ACTUATOR } } });
      });
    },
  };
}
