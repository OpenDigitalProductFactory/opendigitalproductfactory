// Coworker lifecycle gate (EP-COWORKER-LIFECYCLE Phase 3, BI-2C4056BF).
//
// Makes Agent.lifecycleStage load-bearing for the first time: until now every
// agent was seeded "production" and the field was pure display — a draft or
// proven-broken coworker was exactly as summonable as a working one. The gate
// evaluates at every resolution chokepoint (interactive chat, scheduled/
// autonomous dispatch, summon/handoff targeting):
//
// - stage "draft"      → blocked. A coworker created through the factory door
//                        (establish_coworker) starts here and stays here until
//                        its definition lands (Phase 1 conformance) and it is
//                        promoted.
// - stage "retirement" → blocked. Retired means retired.
// - certification "failed" → blocked ONLY when the COWORKER_LIFECYCLE_STRICT
//                        PlatformConfig flag is on. Grandfathered agents keep
//                        working while never/stale-certified (day-one safety);
//                        strict mode adds "we proved it is broken last night,
//                        stop offering it" once sweeps are established.
// - purpose "certification" → always allowed. The certification runner is how
//                        a draft/failed coworker earns its way back in; gating
//                        it would deadlock the lifecycle.
// - unknown agentId    → allowed. Route-synthetic personas (the ROUTE_AGENT_MAP
//                        fallback "coworker") have no Agent row and must not
//                        break.
//
// Fail-open on infrastructure errors: a DB hiccup must not take down every
// coworker. The gate is an authorization refinement, not an availability
// dependency.

import { prisma } from "@dpf/db";
import {
  loadCertificationStates,
  type CoworkerCertificationStatus,
} from "./certification-status";

export type LifecycleGatePurpose = "chat" | "autonomous" | "summon" | "certification";

export type LifecycleGateVerdict =
  | { allowed: true }
  | {
      allowed: false;
      agentId: string;
      stage: string;
      certification: CoworkerCertificationStatus | null;
      reason: string;
    };

/** Stages that are never summonable regardless of flags. */
const BLOCKED_STAGES = new Set(["draft", "retirement"]);

type LifecycleGateDb = {
  agent: { findFirst: (args: unknown) => Promise<unknown> };
  platformConfig: { findUnique: (args: unknown) => Promise<unknown> };
  assuranceRun?: { findMany: (args: unknown) => Promise<unknown> };
};

export type LifecycleGateOptions = {
  purpose?: LifecycleGatePurpose;
  db?: LifecycleGateDb;
  now?: Date;
};

async function isStrictEnabled(db: LifecycleGateDb): Promise<boolean> {
  const config = (await db.platformConfig.findUnique({
    where: { key: "COWORKER_LIFECYCLE_STRICT" },
  })) as { value?: { enabled?: boolean } } | null;
  return config?.value?.enabled === true;
}

export async function evaluateLifecycleGate(
  agentRef: string,
  options?: LifecycleGateOptions,
): Promise<LifecycleGateVerdict> {
  if (options?.purpose === "certification") return { allowed: true };
  if (!agentRef) return { allowed: true };
  const db = options?.db ?? (prisma as unknown as LifecycleGateDb);

  try {
    const agent = (await db.agent.findFirst({
      where: { OR: [{ agentId: agentRef }, { slugId: agentRef }] },
      select: { agentId: true, lifecycleStage: true },
    })) as { agentId: string; lifecycleStage: string } | null;
    if (!agent) return { allowed: true };

    if (BLOCKED_STAGES.has(agent.lifecycleStage)) {
      return {
        allowed: false,
        agentId: agent.agentId,
        stage: agent.lifecycleStage,
        certification: null,
        reason:
          agent.lifecycleStage === "draft"
            ? `${agent.agentId} is a draft coworker — its definition is not complete and it has not been certified. Finish establishing it (see the establish_coworker checklist) before summoning it.`
            : `${agent.agentId} is retired and cannot be summoned.`,
      };
    }

    if (await isStrictEnabled(db)) {
      const states = await loadCertificationStates(
        [agent.agentId],
        db as Parameters<typeof loadCertificationStates>[1],
        options?.now ?? new Date(),
      );
      const cert = states.get(agent.agentId);
      if (cert?.status === "failed") {
        return {
          allowed: false,
          agentId: agent.agentId,
          stage: agent.lifecycleStage,
          certification: "failed",
          reason: `${agent.agentId} failed its last behavioral certification and COWORKER_LIFECYCLE_STRICT is on. Fix the coworker (see its coworker-cert assurance findings) or re-run certification before summoning it.`,
        };
      }
    }

    return { allowed: true };
  } catch (error) {
    console.error("[lifecycle-gate] fail-open on error", error);
    return { allowed: true };
  }
}
