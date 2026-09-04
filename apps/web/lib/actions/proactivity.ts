"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@dpf/db";

import { auth } from "@/lib/auth";
import {
  persistProactivityFact,
  PROACTIVITY_FACT_CATEGORY,
  PROACTIVITY_OVERRIDE_FACT_PREFIX,
} from "@/lib/proactivity/proactivity-override-preferences";
import type { ProactivityLevel } from "@/lib/proactivity/proactivity-types";
import { isProactivityLevel } from "@/lib/proactivity/proactivity-types";
import {
  coworkerSelfTaskCadenceInfo,
  reconcileCoworkerSelfTask,
} from "@/lib/operate/scheduled-jobs/coworker-self-tasks";
import type { CoworkerSelfTaskCadenceInfo } from "@/lib/proactivity/proactivity-effects";

type ManualProactivityPreferenceValue = {
  scope: "agent";
  scopeKey: string;
  level: ProactivityLevel;
  source: "manual-setting";
  acknowledgedByUserId: string;
  acknowledgedAt: string;
};

/** Whether this coworker has a registered autonomous self-task and its
 *  per-level cadence — feeds the truthful effects list (BI-AB7CD55B). */
export async function getCoworkerSelfTaskCadenceInfo(
  agentId: string,
): Promise<CoworkerSelfTaskCadenceInfo> {
  const user = await currentUser();
  if (!user || !agentId) return { registered: false, cadence: null };
  return coworkerSelfTaskCadenceInfo(agentId);
}

// BI-87C9C91C — getCoworkerProactivityPreference, getCoworkerProactivityPreferences
// and saveCoworkerProactivityPreference are GONE.
//
// They read and wrote a proactivity level scoped to `agent:<agentId>`: a
// property of a coworker identity. Proactivity belongs to the outcome-specific
// workroom that owns the work, so those facts no longer influence resolution
// anywhere (see scopeKeysForInput in proactivity-resolver.server.ts).
//
// The writer is removed rather than left in place, because a save path whose
// value nothing reads is worse than no save path: it reports success and
// changes nothing. Existing `aiCoworkerProactivity:agent:*` UserFacts are left
// untouched and inert — they are not migrated into rooms, because an identity
// preference cannot be reinterpreted as an outcome preference without inventing
// a choice the owner never made.

function proactivityAgentScopeKey(agentId: string): string {
  return `agent:${agentId}`;
}

function proactivityAgentFactKey(agentId: string): string {
  return `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:${proactivityAgentScopeKey(agentId)}`;
}

async function currentUser(): Promise<{ id: string } | null> {
  const session = await auth();
  return session?.user?.id ? { id: session.user.id } : null;
}

function readProactivityLevel(value: string | null | undefined): ProactivityLevel | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as { level?: unknown };
    return isProactivityLevel(parsed.level) ? parsed.level : null;
  } catch {
    return null;
  }
}
