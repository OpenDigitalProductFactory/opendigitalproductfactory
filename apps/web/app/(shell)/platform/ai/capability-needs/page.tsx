import { redirect } from "next/navigation";

// EP-INTAKE-UNIFY surface convergence (operator directive 2026-06-20): one place
// to see and work every source — Operations (/ops). Coworker capability needs are
// backlog items there, visible via the "Capability need" origin lens, and /ops
// owns the idempotent backfill that drains any unfiled need. This standalone page
// is retired to a redirect to reduce surfaces.
export default function CapabilityNeedsRedirect() {
  redirect("/ops?origin=capability-need");
}
