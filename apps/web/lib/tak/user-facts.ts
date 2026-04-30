// apps/web/lib/tak/user-facts.ts
//
// Structured user fact store for persistent cross-session memory.
// Facts are extracted from conversations via utility inference and
// injected as L1 context so the coworker remembers user preferences,
// decisions, and constraints without relying on vector similarity.

import { prisma } from "@dpf/db";
import { countTokens } from "@/lib/tak/context-arbitrator";

// ─── Types ──────────────────────────────────────────────────────────────────

export type FactCategory = "preference" | "decision" | "constraint" | "domain_context";

export type UserFactRecord = {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number;
  sourceRoute: string;
  sourceMessageId: string | null;
  sourceAgentId: string | null;
  sourceOperatingProfileFingerprint: string | null;
  lastValidatedAt: Date | null;
  validatedAgainstFingerprint: string | null;
  createdAt: Date;
};

export type MemoryActionRisk = "advisory" | "consequential";
export type FactFreshnessState = "current" | "pending-revalidation" | "legacy-untracked";

export type GovernedUserFactRecord = UserFactRecord & {
  freshnessState: FactFreshnessState;
};

export type GovernedUserFactsResult = {
  facts: GovernedUserFactRecord[];
  includedFacts: GovernedUserFactRecord[];
  excludedFacts: GovernedUserFactRecord[];
  counts: {
    total: number;
    current: number;
    pendingRevalidation: number;
    legacyUntracked: number;
  };
};

// ─── Load Active Facts ─────────────────────────────────────────────────────

/**
 * Load active (non-superseded) facts for a user, optionally scoped to a route domain.
 * Returns facts sorted by confidence descending, capped at `limit`.
 */
export async function loadUserFacts(
  userId: string,
  routeDomain?: string,
  limit = 15,
): Promise<UserFactRecord[]> {
  const where: Record<string, unknown> = {
    userId,
    supersededAt: null,
  };
  // If route domain provided, prefer facts from that domain but include global facts too
  // Global facts have sourceRoute that doesn't match any specific domain
  const facts = await prisma.userFact.findMany({
    where,
    orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
    take: limit * 2, // fetch extra so we can prioritize domain-scoped
    select: {
      id: true,
      category: true,
      key: true,
      value: true,
      confidence: true,
      sourceRoute: true,
      sourceMessageId: true,
      sourceAgentId: true,
      sourceOperatingProfileFingerprint: true,
      lastValidatedAt: true,
      validatedAgainstFingerprint: true,
      createdAt: true,
    },
  });

  if (!routeDomain) return facts.slice(0, limit) as UserFactRecord[];

  // Prioritize facts from the current route domain
  type FactRow = typeof facts[number];
  const domainFacts = facts.filter((f: FactRow) => f.sourceRoute.startsWith(`/${routeDomain}`));
  const otherFacts = facts.filter((f: FactRow) => !f.sourceRoute.startsWith(`/${routeDomain}`));
  return [...domainFacts, ...otherFacts].slice(0, limit) as UserFactRecord[];
}

// ─── Format Facts as Context Block ─────────────────────────────────────────

/**
 * Format user facts as a context block for injection into the system prompt.
 * Returns null if no facts exist.
 */
export function formatFactsAsContext(facts: UserFactRecord[]): string | null {
  if (facts.length === 0) return null;

  const lines = facts.map((f) => `- [${f.category}] ${f.key}: ${f.value}`);
  return [
    "",
    "WHAT YOU KNOW ABOUT THIS USER:",
    "These are established facts from prior conversations. Use them naturally.",
    ...lines,
  ].join("\n");
}

/**
 * Compressed version: top facts only, for budget-constrained tiers.
 */
export function formatFactsCompressed(facts: UserFactRecord[], maxFacts = 5): string | null {
  if (facts.length === 0) return null;
  const top = facts.slice(0, maxFacts);
  const lines = top.map((f) => `- ${f.key}: ${f.value}`);
  return ["", "USER CONTEXT:", ...lines].join("\n");
}

const FACT_REVALIDATION_PROMPT = `You are validating previously extracted user facts against the original user message.
Given a source message and a JSON array of candidate facts, return a JSON array of:
{"category","key","value","status"}

status must be one of:
- "confirmed" if the message clearly supports the same fact
- "contradicted" if the message supports a different value for that fact
- "unsupported" if the message does not clearly support the fact

Return JSON only.`;

function classifyFactFreshness(
  fact: UserFactRecord,
  currentOperatingProfileFingerprint: string | null,
): FactFreshnessState {
  if (!currentOperatingProfileFingerprint) return "legacy-untracked";
  if (fact.validatedAgainstFingerprint === currentOperatingProfileFingerprint) return "current";
  if (!fact.sourceOperatingProfileFingerprint) return "legacy-untracked";
  return "pending-revalidation";
}

async function revalidateFactsAgainstSourceMessage(
  facts: UserFactRecord[],
  currentOperatingProfileFingerprint: string,
): Promise<Map<string, "confirmed" | "contradicted" | "unsupported">> {
  const { utilityInfer } = await import("@/lib/inference/utility-inference");
  const grouped = new Map<string, UserFactRecord[]>();

  for (const fact of facts) {
    if (!fact.sourceMessageId) continue;
    const existing = grouped.get(fact.sourceMessageId) ?? [];
    existing.push(fact);
    grouped.set(fact.sourceMessageId, existing);
  }

  const statuses = new Map<string, "confirmed" | "contradicted" | "unsupported">();

  for (const [messageId, groupedFacts] of grouped.entries()) {
    const sourceMessage = await prisma.agentMessage.findUnique({
      where: { id: messageId },
      select: { id: true, content: true },
    });
    if (!sourceMessage?.content) {
      for (const fact of groupedFacts) statuses.set(fact.id, "unsupported");
      continue;
    }

    const result = await utilityInfer({
      task: "extract_metadata",
      input: [
        FACT_REVALIDATION_PROMPT,
        "",
        "Source message:",
        sourceMessage.content,
        "",
        "Candidate facts:",
        JSON.stringify(
          groupedFacts.map((fact) => ({
            category: fact.category,
            key: fact.key,
            value: fact.value,
          })),
        ),
      ].join("\n"),
    });

    let parsed: Array<{ category?: string; key?: string; value?: string; status?: string }> = [];
    try {
      parsed = JSON.parse(result.output ?? "[]");
    } catch {
      parsed = [];
    }

    const resultByIdentity = new Map<string, "confirmed" | "contradicted" | "unsupported">(
      parsed.map((entry) => {
        const normalizedStatus: "confirmed" | "contradicted" | "unsupported" =
          entry.status === "confirmed" || entry.status === "contradicted"
            ? entry.status
            : "unsupported";
        return [
          `${entry.category ?? ""}::${entry.key ?? ""}::${entry.value ?? ""}`,
          normalizedStatus,
        ] as const;
      }),
    );

    for (const fact of groupedFacts) {
      const identity = `${fact.category}::${fact.key}::${fact.value}`;
      const status = resultByIdentity.get(identity) ?? "unsupported";
      statuses.set(fact.id, status);

      if (status === "confirmed") {
        await prisma.userFact.update({
          where: { id: fact.id },
          data: {
            lastValidatedAt: new Date(),
            validatedAgainstFingerprint: currentOperatingProfileFingerprint,
          },
        });
      }
    }
  }

  return statuses;
}

export async function loadGovernedUserFacts(params: {
  userId: string;
  routeDomain?: string;
  limit?: number;
  currentOperatingProfileFingerprint?: string | null;
  actionRisk?: MemoryActionRisk;
}): Promise<GovernedUserFactsResult> {
  const facts = await loadUserFacts(params.userId, params.routeDomain, params.limit);
  const currentOperatingProfileFingerprint = params.currentOperatingProfileFingerprint ?? null;
  const actionRisk = params.actionRisk ?? "advisory";

  let governedFacts = facts.map((fact) => ({
    ...fact,
    freshnessState: classifyFactFreshness(fact, currentOperatingProfileFingerprint),
  }));

  if (actionRisk === "consequential" && currentOperatingProfileFingerprint) {
    const needsRevalidation = governedFacts
      .filter((fact) => fact.freshnessState === "pending-revalidation" && fact.sourceMessageId)
      .map((fact) => ({
        id: fact.id,
        category: fact.category,
        key: fact.key,
        value: fact.value,
        confidence: fact.confidence,
        sourceRoute: fact.sourceRoute,
        sourceMessageId: fact.sourceMessageId,
        sourceAgentId: fact.sourceAgentId,
        sourceOperatingProfileFingerprint: fact.sourceOperatingProfileFingerprint,
        lastValidatedAt: fact.lastValidatedAt,
        validatedAgainstFingerprint: fact.validatedAgainstFingerprint,
        createdAt: fact.createdAt,
      }));

    const statuses = await revalidateFactsAgainstSourceMessage(
      needsRevalidation,
      currentOperatingProfileFingerprint,
    );

    governedFacts = governedFacts.map((fact) => {
      const status = statuses.get(fact.id);
      if (status === "confirmed") {
        return {
          ...fact,
          freshnessState: "current" as const,
          validatedAgainstFingerprint: currentOperatingProfileFingerprint,
        };
      }
      return fact;
    });
  }

  const includedFacts =
    actionRisk === "consequential"
      ? governedFacts.filter((fact) => fact.freshnessState === "current")
      : governedFacts;
  const excludedFacts =
    actionRisk === "consequential"
      ? governedFacts.filter((fact) => fact.freshnessState !== "current")
      : [];

  return {
    facts: governedFacts,
    includedFacts,
    excludedFacts,
    counts: {
      total: governedFacts.length,
      current: governedFacts.filter((fact) => fact.freshnessState === "current").length,
      pendingRevalidation: governedFacts.filter(
        (fact) => fact.freshnessState === "pending-revalidation",
      ).length,
      legacyUntracked: governedFacts.filter((fact) => fact.freshnessState === "legacy-untracked").length,
    },
  };
}

// ─── Store / Upsert a Fact ─────────────────────────────────────────────────

/**
 * Store a user fact. If a fact with the same userId+category+key exists,
 * supersede it (mark old as superseded, create new).
 */
export async function upsertUserFact(params: {
  userId: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence?: number;
  sourceRoute: string;
  sourceMessageId?: string;
  sourceAgentId?: string;
  sourceOperatingProfileFingerprint?: string | null;
}): Promise<void> {
  // Check for existing active fact with same key
  const existing = await prisma.userFact.findFirst({
    where: {
      userId: params.userId,
      category: params.category,
      key: params.key,
      supersededAt: null,
    },
  });

  if (existing) {
    // Same value? Just update confidence if higher
    if (existing.value === params.value) {
      if ((params.confidence ?? 1.0) > existing.confidence) {
        await prisma.userFact.update({
          where: { id: existing.id },
          data: {
            confidence: params.confidence ?? 1.0,
            sourceAgentId: params.sourceAgentId ?? existing.sourceAgentId,
            sourceOperatingProfileFingerprint:
              params.sourceOperatingProfileFingerprint ?? existing.sourceOperatingProfileFingerprint,
            validatedAgainstFingerprint:
              params.sourceOperatingProfileFingerprint ?? existing.validatedAgainstFingerprint,
            lastValidatedAt: params.sourceOperatingProfileFingerprint ? new Date() : existing.lastValidatedAt,
          },
        });
      }
      return;
    }

    // Different value — supersede the old fact
    const newFact = await prisma.userFact.create({
      data: {
        userId: params.userId,
        category: params.category,
        key: params.key,
        value: params.value,
        confidence: params.confidence ?? 1.0,
        sourceRoute: params.sourceRoute,
        sourceMessageId: params.sourceMessageId ?? null,
        sourceAgentId: params.sourceAgentId ?? null,
        sourceOperatingProfileFingerprint: params.sourceOperatingProfileFingerprint ?? null,
        validatedAgainstFingerprint: params.sourceOperatingProfileFingerprint ?? null,
        lastValidatedAt: params.sourceOperatingProfileFingerprint ? new Date() : null,
      },
    });

    await prisma.userFact.update({
      where: { id: existing.id },
      data: {
        supersededAt: new Date(),
        supersededById: newFact.id,
      },
    });
  } else {
    // New fact
    await prisma.userFact.create({
      data: {
        userId: params.userId,
        category: params.category,
        key: params.key,
        value: params.value,
        confidence: params.confidence ?? 1.0,
        sourceRoute: params.sourceRoute,
        sourceMessageId: params.sourceMessageId ?? null,
        sourceAgentId: params.sourceAgentId ?? null,
        sourceOperatingProfileFingerprint: params.sourceOperatingProfileFingerprint ?? null,
        validatedAgainstFingerprint: params.sourceOperatingProfileFingerprint ?? null,
        lastValidatedAt: params.sourceOperatingProfileFingerprint ? new Date() : null,
      },
    });
  }
}

// ─── Extract Facts from Conversation Turn ──────────────────────────────────

const EXTRACT_FACTS_PROMPT = `Extract user facts from the following conversation message. Look for:
- Preferences (tools, frameworks, styles, approaches they prefer)
- Decisions (choices they've made about architecture, vendors, processes)
- Constraints (deadlines, compliance requirements, budget limits, team size)
- Domain context (their industry, role details, team structure, tech stack)

Output a JSON array of objects with: {"category", "key", "value", "confidence"}
- category: one of "preference", "decision", "constraint", "domain_context"
- key: short identifier (e.g. "cloud_provider", "testing_approach", "compliance_framework")
- value: the fact value (e.g. "AWS", "TDD", "ISO 27001")
- confidence: 0.0-1.0 based on how explicit the statement was

Only extract facts the user stated explicitly or strongly implied. Do not infer from generic statements.
If no facts are extractable, output an empty array: []
Output only the JSON array, nothing else.`;

/**
 * Extract facts from a user message using the utility inference tier.
 * Non-blocking — errors are swallowed silently.
 */
export async function extractAndStoreFacts(params: {
  userId: string;
  messageContent: string;
  routeContext: string;
  messageId?: string;
  sourceAgentId?: string;
  operatingProfileFingerprint?: string | null;
}): Promise<void> {
  try {
    const { utilityInfer } = await import("@/lib/inference/utility-inference");

    const result = await utilityInfer({
      task: "extract_metadata",
      input: `${EXTRACT_FACTS_PROMPT}\n\nMessage:\n${params.messageContent}`,
    });

    if (!result?.output) return;

    let facts: Array<{ category: string; key: string; value: string; confidence: number }>;
    try {
      facts = JSON.parse(result.output);
    } catch {
      return; // LLM didn't return valid JSON
    }

    if (!Array.isArray(facts)) return;

    const validCategories = new Set(["preference", "decision", "constraint", "domain_context"]);
    for (const fact of facts) {
      if (!fact.key || !fact.value || !validCategories.has(fact.category)) continue;
      await upsertUserFact({
        userId: params.userId,
        category: fact.category as FactCategory,
        key: fact.key,
        value: fact.value,
        confidence: Math.min(1.0, Math.max(0.0, fact.confidence ?? 0.8)),
        sourceRoute: params.routeContext,
        sourceMessageId: params.messageId,
        sourceAgentId: params.sourceAgentId,
        sourceOperatingProfileFingerprint: params.operatingProfileFingerprint ?? null,
      });
    }
  } catch {
    // Non-fatal — fact extraction is best-effort
  }
}
