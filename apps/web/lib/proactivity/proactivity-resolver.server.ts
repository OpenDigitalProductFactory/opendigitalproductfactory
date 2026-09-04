import "server-only";

import { prisma } from "@dpf/db";
import {
  PROACTIVITY_COOLDOWN_FACT_PREFIX,
  PROACTIVITY_FACT_CATEGORY,
  PROACTIVITY_OVERRIDE_FACT_PREFIX,
} from "./proactivity-override-preferences";
import { resolveProactivityPlan, resolveProactivityPlanForLevel } from "./proactivity-resolver";
import type { ProactivityLevel, ProactivityPlan, ProactivityResolverInput } from "./proactivity-types";
import { isProactivityLevel } from "./proactivity-types";

export async function resolveUserAwareProactivityPlan(input: {
  userId: string;
  input: ProactivityResolverInput;
  now?: Date;
}): Promise<ProactivityPlan> {
  const scopeKeys = scopeKeysForInput(input.input);
  const factKeys = scopeKeys.flatMap((scopeKey) => [
    `${PROACTIVITY_OVERRIDE_FACT_PREFIX}:${scopeKey}`,
    `${PROACTIVITY_COOLDOWN_FACT_PREFIX}:${scopeKey}`,
  ]);

  const facts = await prisma.userFact.findMany({
    where: {
      userId: input.userId,
      category: PROACTIVITY_FACT_CATEGORY,
      supersededAt: null,
      key: { in: factKeys },
    },
    select: {
      id: true,
      key: true,
      value: true,
      createdAt: true,
    },
  });

  const override = pickScopedFact(facts, scopeKeys, PROACTIVITY_OVERRIDE_FACT_PREFIX, parseOverrideFact);
  const cooldown = pickScopedFact(facts, scopeKeys, PROACTIVITY_COOLDOWN_FACT_PREFIX, (value) =>
    parseCooldownFact(value, input.now ?? new Date()),
  );
  const rulePlan = resolveProactivityPlanForLevel(input.input, inferRuleLevel(input.input));
  const plan = override
    ? resolveProactivityPlanForLevel(input.input, override.value.level, "user-override")
    : rulePlan;

  if (override) {
    plan.userOverrideScopeKey = override.value.scopeKey;
    plan.evidenceRefs = [...plan.evidenceRefs, { kind: "user-fact", id: override.id }];
    plan.explanation = `${plan.explanation} A user-acknowledged proactivity preference applies for ${override.value.scopeKey}.`;
  }

  if (cooldown) {
    plan.suggestionSuppressed = true;
    plan.suggestionCooldownUntil = cooldown.value.cooldownUntil;
    plan.suggestionCooldownScopeKey = cooldown.value.scopeKey;
    plan.evidenceRefs = [...plan.evidenceRefs, { kind: "user-fact", id: cooldown.id }];
  }

  return plan;
}

function inferRuleLevel(input: ProactivityResolverInput): ProactivityLevel {
  return resolveProactivityPlan(input).resolvedLevel;
}

/**
 * BI-87C9C91C — proactivity is owned by the outcome-specific Workroom, never by
 * a coworker identity.
 *
 * The `agent:<agentId>` scope used to sit FIRST here, so a saved per-coworker
 * preference outranked both the route context and the activity family. That made
 * "how persistently is this outcome pursued" a property of WHO was staffed to it:
 * swapping the coworker in a room role changed the room's drive, which is the
 * ownership boundary this item exists to restore.
 *
 * The scope is not merely deprioritized — it is GONE. A legacy
 * `proactivity-override:agent:<id>` UserFact no longer matches any key this
 * builds, so it is inert without a migration. That is deliberate: an identity
 * preference cannot be reinterpreted as an outcome preference, so inferring a
 * room's posture from one would be fabricating a choice nobody made.
 *
 * What remains is the unroomed default ladder — route context, then activity
 * family — byte-identical to what an agent-less caller resolved before. A room's
 * own declaration is layered by `resolveWorkPosture`, not here.
 */
function scopeKeysForInput(input: ProactivityResolverInput): string[] {
  const keys: string[] = [];
  if (input.routeContext) keys.push(`route-context:${input.routeContext}`);
  keys.push(`activity-family:${input.activityFamily}`);
  return keys;
}

type ProactivityFactRow = {
  id: string;
  key: string;
  value: string;
  createdAt: Date;
};

function pickScopedFact<T>(
  facts: ProactivityFactRow[],
  scopeKeys: string[],
  prefix: string,
  parse: (value: string) => T | null,
): { id: string; value: T } | null {
  for (const scopeKey of scopeKeys) {
    const key = `${prefix}:${scopeKey}`;
    const candidates = facts
      .filter((fact) => fact.key === key)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const fact of candidates) {
      const value = parse(fact.value);
      if (value) return { id: fact.id, value };
    }
  }
  return null;
}

function parseOverrideFact(value: string): { scopeKey: string; level: ProactivityLevel } | null {
  const parsed = parseRecord(value);
  const scopeKey = typeof parsed?.scopeKey === "string" ? parsed.scopeKey : null;
  const level = parsed?.level;
  if (!scopeKey || !isProactivityLevel(level)) return null;
  return { scopeKey, level };
}

function parseCooldownFact(value: string, now: Date): { scopeKey: string; cooldownUntil: string } | null {
  const parsed = parseRecord(value);
  const scopeKey = typeof parsed?.scopeKey === "string" ? parsed.scopeKey : null;
  const cooldownUntil = typeof parsed?.cooldownUntil === "string" ? parsed.cooldownUntil : null;
  if (!scopeKey || !cooldownUntil) return null;

  const cooldownDate = new Date(cooldownUntil);
  if (Number.isNaN(cooldownDate.getTime()) || cooldownDate <= now) return null;
  return { scopeKey, cooldownUntil };
}

function parseRecord(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
