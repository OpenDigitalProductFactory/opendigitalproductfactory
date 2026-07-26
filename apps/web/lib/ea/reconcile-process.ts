// apps/web/lib/ea/reconcile-process.ts
//
// Reconcile the platform's process state machines into a live BPMN projection (Parity
// Engine, domain 6). The source is in-code transition tables (no external store), so
// this always runs; it applies via the shared applySysmlModel under the already-seeded
// bpmn20 notation. Re-derives every run, so the BPMN models cannot drift from the code.
//
// To add a process: register its state machine below (key, statuses, isTerminal,
// canTransition) — the rest is automatic. db injected for tests.

import { prisma } from "@dpf/db";
import { ENVELOPE_STATUSES, TERMINAL_STATUSES, canTransition as envelopeCanTransition } from "@/lib/coworker/envelope-state-machine";
import { BACKLOG_STATUSES, isLegalTransition, requiresAdminGrant } from "@/lib/backlog/transitions";
import { buildProcessModel, type ProcessStateMachine } from "./process-extract";
import { applySysmlModel, type SysmlSeedResult } from "./sysml-model-seed";

const envelopeTerminals = new Set<string>(TERMINAL_STATUSES);
const envelopeCan = envelopeCanTransition as (from: string, to: string) => boolean;
const backlogCan = isLegalTransition as (from: string, to: string) => boolean;
const backlogRequiresAdmin = requiresAdminGrant as (from: string, to: string) => boolean;

export const PLATFORM_PROCESS_MACHINES: ProcessStateMachine[] = [
  {
    key: "coworker-action-envelope",
    name: "Coworker Action Envelope (PUC) Lifecycle",
    statuses: ENVELOPE_STATUSES,
    isTerminal: (s) => envelopeTerminals.has(s),
    canTransition: (from, to) => from !== to && envelopeCan(from, to),
    description:
      "Propose → approve → execute HITL gate for effectful/destructive coworker actions (CoworkerActionEnvelope; apps/web/lib/coworker/envelope-state-machine.ts).",
  },
  {
    key: "backlog-item",
    name: "Backlog Item Lifecycle",
    statuses: BACKLOG_STATUSES,
    // A status is operationally terminal iff it has no standard (non-admin-grant) transition to a different status.
    isTerminal: (s) => !BACKLOG_STATUSES.some((t) => t !== s && backlogCan(s, t) && !backlogRequiresAdmin(s, t)),
    canTransition: (from, to) => from !== to && backlogCan(from, to),
    description:
      "Triage → build → done lifecycle governing every backlog item (apps/web/lib/backlog/transitions.ts).",
  },
];

export async function reconcileProcessModels(
  opts: { db?: typeof prisma; machines?: ProcessStateMachine[] } = {},
): Promise<SysmlSeedResult> {
  const machines = opts.machines ?? PLATFORM_PROCESS_MACHINES;
  const result = await applySysmlModel(buildProcessModel(machines), { db: opts.db, notationSlug: "bpmn20" });
  console.info(`[process-models] reconcile ${result.status}: created=${result.created} updated=${result.updated} removed=${result.removed}`);
  return result;
}
