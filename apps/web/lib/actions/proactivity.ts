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

export async function getCoworkerProactivityPreference(agentId: string): Promise<ProactivityLevel | null> {
  const user = await currentUser();
  if (!user || !agentId) return null;

  const fact = await prisma.userFact.findFirst({
    where: {
      userId: user.id,
      category: PROACTIVITY_FACT_CATEGORY,
      key: proactivityAgentFactKey(agentId),
      supersededAt: null,
    },
    select: { value: true },
    orderBy: { updatedAt: "desc" },
  });

  return readProactivityLevel(fact?.value);
}

export async function saveCoworkerProactivityPreference(
  agentId: string,
  level: ProactivityLevel,
): Promise<{ ok: boolean }> {
  const user = await currentUser();
  if (!user || !agentId || !isProactivityLevel(level)) return { ok: false };

  const now = new Date();
  const value: ManualProactivityPreferenceValue = {
    scope: "agent",
    scopeKey: proactivityAgentScopeKey(agentId),
    level,
    source: "manual-setting",
    acknowledgedByUserId: user.id,
    acknowledgedAt: now.toISOString(),
  };

  await persistProactivityFact(user.id, {
    category: PROACTIVITY_FACT_CATEGORY,
    key: proactivityAgentFactKey(agentId),
    value: JSON.stringify(value),
    sourceRoute: "/platform/ai",
    sourceAgentId: agentId,
    lastValidatedAt: now,
  });

  // Bridge the setting to autonomous work: a coworker with a registered
  // self-task self-drives on a cadence (assertive=daily, balanced=weekly,
  // quiet=stand down) via the ScheduledAgentTask engine. Best-effort — a
  // scheduling hiccup must not fail saving the preference itself.
  try {
    await reconcileCoworkerSelfTask(user.id, agentId, level);
  } catch (err) {
    console.error("[proactivity] reconcileCoworkerSelfTask failed", err);
  }

  revalidatePath("/platform/ai");
  revalidatePath(`/platform/ai/agent/${agentId}`);
  return { ok: true };
}

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
