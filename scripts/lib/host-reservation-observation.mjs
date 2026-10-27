const BINDING_FIELDS = ["leaseId", "claimKey", "environmentKey", "ownerProvider", "ownerSessionId", "worktreePath", "branchName"];
const TERMINAL = new Set(["released", "cancelled", "expired"]);

/** Observe only. Neither elapsed time nor disappearance proves settlement. */
export async function observeHostReservation({ binding, call }) {
  const base = { status: "host-reservation", mode: "natural-expiry", leaseId: binding?.leaseId ?? null,
    reservationState: "unknown", processCleanupVerified: false };
  const unknown = reason => ({ ...base, reason });
  if (binding?.environmentKey !== "host-heavy-resource"
    || BINDING_FIELDS.some(key => typeof binding?.[key] !== "string" || !binding[key].trim())) return unknown("binding-unproven");
  let reply;
  try { reply = await call("list_nonprod_environment_leases", { leaseId: binding.leaseId }); }
  catch { return unknown("readback-unavailable"); }
  const row = reply?.data?.lease;
  if (reply?.success !== true || reply.entityId !== binding.leaseId || !row) return unknown("readback-unproven");
  if (BINDING_FIELDS.some(key => row[key] !== binding[key])) return unknown("binding-mismatch");
  if (!TERMINAL.has(row.status) && row.status !== "active" && row.status !== "queued") return unknown("state-unproven");
  if (TERMINAL.has(row.status) && row.activeKey !== null) return unknown("terminal-state-inconsistent");
  return { ...base, reservationState: TERMINAL.has(row.status) ? "settled" : "pending", leaseStatus: row.status };
}
