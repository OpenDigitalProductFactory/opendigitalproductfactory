const BINDING_FIELDS = ["leaseId", "claimKey", "environmentKey", "ownerProvider", "ownerSessionId", "worktreePath", "branchName"];
const TERMINAL = new Set(["released", "cancelled", "expired"]);

async function observeReservation({ binding, call }, { environmentKey, status, extraFields = [], validTarget = () => true }) {
  const base = { status, mode: "natural-expiry", leaseId: binding?.leaseId ?? null,
    reservationState: "unknown", processCleanupVerified: false };
  const unknown = reason => ({ ...base, reason });
  if (binding?.environmentKey !== environmentKey || !validTarget(binding)
    || BINDING_FIELDS.some(key => typeof binding?.[key] !== "string" || !binding[key].trim())) return unknown("binding-unproven");
  let reply;
  try { reply = await call("list_nonprod_environment_leases", { leaseId: binding.leaseId }); }
  catch { return unknown("readback-unavailable"); }
  const row = reply?.data?.lease;
  if (reply?.success !== true || reply.entityId !== binding.leaseId || !row) return unknown("readback-unproven");
  if (BINDING_FIELDS.some(key => row[key] !== binding[key])
    || extraFields.some(key => JSON.stringify(row[key]) !== JSON.stringify(binding[key]))) return unknown("binding-mismatch");
  if (!TERMINAL.has(row.status) && row.status !== "active" && row.status !== "queued") return unknown("state-unproven");
  if (TERMINAL.has(row.status) && row.activeKey !== null) return unknown("terminal-state-inconsistent");
  return { ...base, reservationState: TERMINAL.has(row.status) ? "settled" : "pending", leaseStatus: row.status };
}

/** Observe only. Neither elapsed time nor disappearance proves settlement. */
export async function observeHostReservation(input) {
  return observeReservation(input, { environmentKey: "host-heavy-resource", status: "host-reservation" });
}

/** The existing full preview target; this read grants no cleanup authority. */
export async function observePreviewReservation(input) {
  return observeReservation(input, { environmentKey: "local-integration-ci", status: "preview-reservation",
    extraFields: ["url", "ports"],
    validTarget: binding => binding.url === "http://localhost:3001"
      && Array.isArray(binding.ports) && binding.ports.length === 1 && binding.ports[0] === 3001 });
}
