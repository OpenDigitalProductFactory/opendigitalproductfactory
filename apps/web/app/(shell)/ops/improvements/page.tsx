import { redirect } from "next/navigation";

// EP-INTAKE-UNIFY surface convergence (operator directive 2026-06-20): there is
// ONE place to see and work every source — Operations (/ops). Improvements are
// backlog items there, visible via the "Improvement" origin lens, and /ops owns
// the idempotent backfill that drains any unfiled proposal. This standalone page
// is retired to a redirect so the operator has fewer surfaces, not more.
export default function ImprovementsRedirect() {
  redirect("/ops?origin=improvement");
}
