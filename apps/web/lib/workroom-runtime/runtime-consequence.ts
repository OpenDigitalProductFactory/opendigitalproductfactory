import type { ToolCallConsequenceRefiner } from "@/lib/tool-consequence";

// drive_workroom_runtime is declared `authority` because `start` issues a
// room-scoped credential and lets a CLI act in the sandbox, `stop` revokes it
// and `decide` answers a held request. The other actions add no authority:
// `status` reads, and `turn` / `steer` / `interrupt` only talk to a session
// whose start was already approved, and whose own outward actions are held by
// the runtime request policy. Gating them sent a read-only status check to the
// owner's inbox (BI-05715F4C follow-up). Narrow only; unknown actions keep it.
const ORDINARY_ACTIONS = new Set(["status", "turn", "steer", "interrupt"]);

export const workroomRuntimeConsequence: ToolCallConsequenceRefiner = async ({ params }) =>
  typeof params.action === "string" && ORDINARY_ACTIONS.has(params.action)
    ? { consequence: null, reason: `runtime-${params.action}-within-an-approved-session` }
    : { consequence: "authority", reason: "runtime-start-stop-or-decide" };
