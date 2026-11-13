// Test fixture (BI-F5D58F29): the held-request store contract in memory. One
// instance outlives a supervisor, as the database does across a restart.

import type { HeldRequestRecord, HeldRequestStore } from "../held-request-store";
import type { RuntimeDecision } from "../types";

const STATUS_FOR: Record<RuntimeDecision, string> = { accept: "approved", decline: "declined", cancel: "cancelled" };

export function createMemoryHeldRequestStore(): HeldRequestStore & { rows: Array<HeldRequestRecord & { capsuleId: string; userId: string }> } {
  const rows: Array<HeldRequestRecord & { capsuleId: string; userId: string }> = [];
  const find = (capsuleId: string, requestId: string) => {
    const matches = rows.filter((r) => r.capsuleId === capsuleId && r.request.requestId === requestId);
    return matches.find((r) => r.status === "proposed") ?? matches.at(-1);
  };
  return {
    rows,
    async hold({ capsuleId, request, actor }) { rows.push({ capsuleId, status: "proposed", request, userId: actor.userId }); },
    async find(capsuleId, requestId) { const r = find(capsuleId, requestId); return r ? { status: r.status, request: r.request } : null; },
    async listOpen(capsuleId) {
      return rows.filter((r) => r.capsuleId === capsuleId && r.status === "proposed")
        .map(({ request: { requestId, kind, summary } }) => ({ requestId, kind, summary }));
    },
    async settle({ capsuleId, requestId, decision }) {
      const r = find(capsuleId, requestId);
      if (!r) return "not-found";
      if (r.status !== "proposed") return "already-decided";
      r.status = STATUS_FOR[decision];
      return "settled";
    },
    async isApproved(capsuleId, callKey, delegatingUserId) {
      return rows.some((r) => r.capsuleId === capsuleId && r.userId === delegatingUserId && r.status === "approved" && r.request.callKey === callKey);
    },
  };
}
