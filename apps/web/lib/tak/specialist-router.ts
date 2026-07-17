// apps/web/lib/tak/specialist-router.ts
//
// EP-E431FC8A Phase 4 (BI-17ACD329). The mixture-of-experts routing core: map a
// classified task intent to the specialist coworker whose bounded, stable tool
// set owns that work. DPF already models specialists (Scrum Master owns the
// backlog, AI Ops Engineer owns providers, Software Engineer owns builds), so
// routing a backlog question that reached the wrong coworker to the backlog
// specialist is the human-org pattern applied to the AI workforce.
//
// GOVERNANCE (kernel decision DI-D1C241BCCBF0 → "recommend-only"): this router is
// a RECOMMENDATION mechanism. It never escalates authority or auto-delegates —
// coworkers today mostly hold no delegation grant (delegates_to:[]), and granting
// one is a least-privilege decision reserved for founder governance. The router
// identifies the right specialist and surfaces a suggestion; the moment
// governance grants delegation, the same recommendation drives it. Pure +
// dependency-light so it unit-tests in isolation.

/** Which specialist coworker owns each task class (by stable agentId/slug). */
export const SPECIALIST_BY_TASK_CLASS: Readonly<Record<string, { agentId: string; displayName: string }>> = {
  "backlog-status": { agentId: "ops-coordinator", displayName: "Scrum Master" },
  "provider-health": { agentId: "platform-engineer", displayName: "AI Ops Engineer" },
  "capsule-status": { agentId: "build-specialist", displayName: "Software Engineer" },
};

export interface SpecialistRecommendation {
  /** The specialist coworker who owns this task class. */
  specialistAgentId: string;
  specialistDisplayName: string;
  taskClass: string;
  /** Human-readable rationale for the suggestion (advisory copy). */
  reason: string;
}

/**
 * Recommend a specialist for a classified task, or null when no delegation is
 * warranted: the current coworker already IS the owning specialist, no specialist
 * is registered for the class, or the class is unknown. Recommendation only — the
 * caller decides whether/how to act, and acting requires a governed delegation
 * grant the current coworker may not hold.
 */
export function routeToSpecialist(params: {
  taskClass: string | null | undefined;
  currentAgentId?: string | null;
}): SpecialistRecommendation | null {
  if (!params.taskClass) return null;
  const specialist = SPECIALIST_BY_TASK_CLASS[params.taskClass];
  if (!specialist) return null;
  // Already the right coworker → no delegation.
  if (params.currentAgentId && params.currentAgentId === specialist.agentId) return null;
  return {
    specialistAgentId: specialist.agentId,
    specialistDisplayName: specialist.displayName,
    taskClass: params.taskClass,
    reason:
      `This looks like ${params.taskClass.replace(/-/g, " ")} work, which ${specialist.displayName} ` +
      `owns. Consider handing it to them for an authoritative answer.`,
  };
}

/** The set of task classes that have a registered specialist owner. */
export function taskClassesWithSpecialist(): Set<string> {
  return new Set(Object.keys(SPECIALIST_BY_TASK_CLASS));
}
