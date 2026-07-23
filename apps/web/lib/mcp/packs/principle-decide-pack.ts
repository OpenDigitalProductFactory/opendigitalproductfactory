// Principle-decide (kernel decision-routing gate) tool pack — EP-8DC217EB BET-4.
//
// Drains the final named tool out of the mcp-tools.ts executeTool switch: the
// advisory decision gate that scores a set of options against the governance
// principles in scope for the calling population and returns a recommendation
// plus a per-principle contribution ledger. The handler lazy-imports the
// Postgres commandment lookup and the Qdrant core/contextual principle search,
// then runs the pure decide() math — reproducing the former switch case
// verbatim, so behaviour is identical when the tool is invoked over MCP.
//
// The definition moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  DIMENSION_KEYS,
  buildFeaturesDescription,
  validateOptionFeatures,
  featureErrorRemedy,
  type FeatureValidationError,
} from "@/lib/decision/dimension-catalog";

const definitions: ToolDefinition[] = [
  {
    name: "principle_decide",
    description:
      "Advisory only. Score a set of options against the governance principles in scope for the calling population, and return a recommendation plus a per-principle contribution ledger. Uses commandments from Postgres (always included) and relevant core/contextual principles from semantic search. Does not execute the recommended option; the caller retains authority. Use when you have two or more options and want to surface which governance principles pull which way.",
    inputSchema: {
      type: "object",
      properties: {
        context: {
          type: "string",
          description:
            "A short description of the decision being made. Used for semantic retrieval of relevant core and contextual principles.",
        },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable identifier for the option." },
              description: { type: "string", description: "Short prose description." },
              features: {
                type: "object",
                description: buildFeaturesDescription(),
                // Keys are constrained machine-readably as well as described in
                // prose: a caller that cannot read repo source (every
                // in-platform coworker) still gets the closed set from the
                // schema itself. BI-E0151DB2.
                propertyNames: { enum: [...DIMENSION_KEYS] },
                additionalProperties: { type: "number", minimum: 0, maximum: 1 },
              },
            },
            required: ["id", "description"],
          },
          description: "The candidate options to score. Must be a non-empty array.",
        },
        callingPopulation: {
          type: "string",
          enum: ["in_platform_coworker", "external_coding_agent", "human"],
          description: "Population whose principles should apply.",
        },
        maxPrinciples: {
          type: "number",
          description: "Cap on relevant core/contextual principles retrieved from Qdrant. Default 20.",
        },
        tieMargin: {
          type: "number",
          description:
            "Margin threshold below which confidence flips to 'low' and the reasoning recommends human review. Default 0.2.",
        },
        ringScope: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "ring-1-coworker",
              "ring-2-workflow",
              "ring-3-archetype",
              "ring-4-sandbox-prod",
              "ring-5-hive",
              "external-coordination",
              "universal-ring",
            ],
          },
          description:
            "Reduction Gear ring scope(s) the calling action binds. When set, retrieval filters to principles whose principleRingScope intersects the caller scope OR contains universal-ring OR is empty (backward compat). Omit (or pass ['universal-ring']) to consult the full kernel — appropriate for design-time / kernel-architecture decisions that genuinely bind every ring. See spec docs/superpowers/specs/2026-05-24-founder-kernel-evolution-discipline-design.md §5.",
        },
        callingSurface: {
          type: "string",
          description:
            "Optional free-form label naming the calling surface (e.g. 'build-studio-phase', 'promotion-gate'). Propagated to the [principle-recall-trace] log line so operators can correlate recall traffic with the surface that drove it.",
        },
      },
      required: ["context", "options", "callingPopulation"],
    },
    requiredCapability: null,
    executionMode: "immediate",
    sideEffect: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
];

async function principleDecide(
  params: Record<string, unknown>,
  context?: Parameters<ToolPackHandler>[2],
): Promise<ToolResult> {
  // Phase 2 Task 2.7. Pulls in-scope commandments from Postgres (always
  // applied) and relevant core/contextual principles from Qdrant, then
  // runs the pure decide() math. Returns a contribution ledger so
  // callers can render the why, not just the what.
  const validPopulations = new Set([
    "in_platform_coworker",
    "external_coding_agent",
    "human",
  ]);
  const callingPopulation = params["callingPopulation"];
  if (
    typeof callingPopulation !== "string" ||
    !validPopulations.has(callingPopulation)
  ) {
    return {
      success: false,
      message:
        "callingPopulation must be one of: in_platform_coworker, external_coding_agent, human.",
      error: "Invalid callingPopulation",
    };
  }
  const optionsParam = params["options"];
  if (!Array.isArray(optionsParam) || optionsParam.length === 0) {
    return {
      success: false,
      message: "options must be a non-empty array.",
      error: "Empty options",
    };
  }

  // BI-E0151DB2. Validate option features against the closed dimension
  // registry, the same way ringScope is validated below. An unknown key is NOT
  // harmless: computeStructuredAlignment iterates the PRINCIPLE's dimensions
  // and reads option.features[dim], so a key that is not a real dimension is
  // never read and the axis the caller thought they scored silently counts as
  // zero. Silent skip on bad input is the failure mode
  // `make-silent-failures-observable` forbids.
  const featureErrors: FeatureValidationError[] = [];
  for (const raw of optionsParam) {
    if (typeof raw !== "object" || raw === null) continue;
    const o = raw as Record<string, unknown>;
    const f = o["features"];
    if (typeof f !== "object" || f === null || Array.isArray(f)) continue;
    featureErrors.push(
      ...validateOptionFeatures(
        String(o["id"] ?? "(unnamed option)"),
        f as Record<string, unknown>,
      ),
    );
  }
  if (featureErrors.length > 0) {
    return {
      success: false,
      message:
        `principle_decide rejected ${featureErrors.length} option feature(s): ` +
        featureErrors.map((e) => `[${e.optionId}] ${e.detail}`).join(" ") +
        ` ${featureErrorRemedy()}`,
      error: "Invalid option features",
    };
  }

  const { listPrinciplesByTier, prisma, PRINCIPLE_DECIDE_DEFAULTS } =
    await import("@dpf/db");
  const { PRINCIPLE_RING_SCOPES } = await import(
    "@dpf/db/wiki-taxonomy"
  );
  const { searchWikiPages } = await import("@/lib/wiki/embeddings");
  const { decide } = await import("@/lib/wiki/principle-decide");
  const { principleMatchesRingScope } = await import(
    "@/lib/wiki/calling-ring-map"
  );
  // BI-3C1A6451: server-side embedding for the semantic-fallback path.
  // Used both for principle direction text (Qdrant-sourced principles
  // have empty dimensionVector) and for option descriptions when the
  // caller passes empty features. Pre-fix, both produced alignment=0.
  const { generateEmbedding } = await import("@/lib/inference/embedding");

  // Validate ringScope per the closed taxonomy registry. Unknown values
  // fail fast instead of silently degrading to universal — silent skip
  // on bad input is the failure mode `make-silent-failures-observable`
  // (the kernel commandment promoted in PR #1081) forbids.
  let ringScope: string[] | undefined;
  if (params["ringScope"] !== undefined) {
    if (!Array.isArray(params["ringScope"])) {
      return {
        success: false,
        message:
          "ringScope must be an array of values from PRINCIPLE_RING_SCOPES.",
        error: "Invalid ringScope shape",
      };
    }
    const unknown = (params["ringScope"] as unknown[]).filter(
      (v): v is string =>
        typeof v === "string" &&
        !(PRINCIPLE_RING_SCOPES as readonly string[]).includes(v),
    );
    if (unknown.length > 0) {
      return {
        success: false,
        message: `ringScope contains unknown values: ${unknown.join(", ")}. Allowed: ${PRINCIPLE_RING_SCOPES.join(", ")}.`,
        error: "Invalid ringScope value",
      };
    }
    ringScope = params["ringScope"] as string[];
  }
  const ringScopeActive =
    ringScope !== undefined &&
    ringScope.length > 0 &&
    !ringScope.includes("universal-ring");
  const callingSurface =
    typeof params["callingSurface"] === "string"
      ? params["callingSurface"]
      : null;

  const maxPrinciples =
    typeof params["maxPrinciples"] === "number"
      ? params["maxPrinciples"]
      : PRINCIPLE_DECIDE_DEFAULTS.maxPrinciples;
  const tieMargin =
    typeof params["tieMargin"] === "number"
      ? params["tieMargin"]
      : PRINCIPLE_DECIDE_DEFAULTS.tieMargin;
  const contextualThreshold =
    PRINCIPLE_DECIDE_DEFAULTS.contextualSimilarityThreshold;
  const semanticWarnRatio =
    PRINCIPLE_DECIDE_DEFAULTS.semanticFallbackWarnRatio;

  const org = await prisma.organization
    .findFirst({ select: { id: true } })
    .catch(() => null);
  const organizationId: string | null = org?.id ?? null;

  // 1. Commandments from Postgres (full dimension vector). Always applied.
  // limit 50 (not 10): commandments are uncapped doctrine as of 2026-05-22
  // and the comment above claims they are "Always applied" — but there are
  // now 19+ commandment principles, so a limit of 10 silently truncated ~9
  // of them from every decision (ordered by lastReviewedAt/title), letting
  // process commandments crowd out doctrine like architecture-over-shortcuts.
  // 50 matches listPrinciplesByTier's own default and leaves headroom.
  // See docs/superpowers/specs/2026-06-05-situational-aware-decision-weighting-design.md §1 RC4.
  let commandments: Array<Record<string, unknown>> = [];
  try {
    commandments = (await listPrinciplesByTier(prisma, {
      tier: "commandment",
      organizationId,
      appliesTo: callingPopulation,
      ringScope,
      limit: 50,
    })) as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn("[principle_decide] commandment Postgres lookup failed:", err);
  }

  const contextQuery = String(params["context"] ?? "");

  // 2. Core from Qdrant — relevance-ranked.
  let core: Array<Record<string, unknown>> = [];
  try {
    core = (await searchWikiPages({
      query: contextQuery,
      organizationId,
      pageKind: "principle",
      principleTier: "core",
      principleAppliesTo: callingPopulation,
      principleRingScope: ringScopeActive ? ringScope : undefined,
      limit: 5,
    })) as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn("[principle_decide] core Qdrant lookup failed:", err);
  }

  // 3. Contextual from Qdrant — relevance-gated.
  let contextual: Array<Record<string, unknown>> = [];
  try {
    contextual = (await searchWikiPages({
      query: contextQuery,
      organizationId,
      pageKind: "principle",
      principleTier: "contextual",
      principleAppliesTo: callingPopulation,
      principleRingScope: ringScopeActive ? ringScope : undefined,
      limit: 5,
      scoreThreshold: contextualThreshold,
    })) as Array<Record<string, unknown>>;
  } catch (err) {
    console.warn("[principle_decide] contextual Qdrant lookup failed:", err);
  }

  // Post-filter (cheap belt-and-suspenders). Mirrors the contract used
  // by recallPrincipleContext: empty principleRingScope passes
  // (backward-compat); universal-ring always passes; otherwise
  // intersection check. Catches any retrieval path that didn't get
  // the ringScope arg threaded through (e.g. narrow test mocks).
  let commandmentsExcluded = 0;
  let coreExcluded = 0;
  let contextualExcluded = 0;
  if (ringScopeActive && ringScope) {
    const before = { c: commandments.length, k: core.length, x: contextual.length };
    commandments = commandments.filter((row) =>
      principleMatchesRingScope(
        (row["principleRingScope"] as string[] | undefined) ?? [],
        ringScope as never,
      ),
    );
    core = core.filter((row) =>
      principleMatchesRingScope(
        (row["principleRingScope"] as string[] | undefined) ?? [],
        ringScope as never,
      ),
    );
    contextual = contextual.filter((row) =>
      principleMatchesRingScope(
        (row["principleRingScope"] as string[] | undefined) ?? [],
        ringScope as never,
      ),
    );
    commandmentsExcluded = before.c - commandments.length;
    coreExcluded = before.k - core.length;
    contextualExcluded = before.x - contextual.length;
  }

  console.info(
    `[principle-recall-trace] ` +
      JSON.stringify({
        callingSurface,
        callingPopulation,
        ringScope: ringScope ?? null,
        ringScopeActive,
        tool: "principle_decide",
        commandmentCount: commandments.length,
        coreCount: core.length,
        contextualCount: contextual.length,
        ringScopeExcluded: {
          commandments: commandmentsExcluded,
          core: coreExcluded,
          contextual: contextualExcluded,
        },
      }),
  );

  const TIER_DEFAULT_WEIGHT: Record<string, number> = {
    commandment: 1.0,
    core: 0.4,
    contextual: 0.1,
  };
  function resolveWeight(tier: string, override: unknown): number {
    if (typeof override === "number") return override;
    return TIER_DEFAULT_WEIGHT[tier] ?? 0;
  }

  // Build DecisionPrinciple[] from the merged set. Postgres rows carry
  // the full dimensionVector for structured alignment; Qdrant hits only
  // carry dimension keys (no signed vector), so they fall back to
  // semantic alignment. For the semantic path to produce non-zero
  // signal, we must embed each candidate's direction text and let
  // decide()'s cosine math do the rest (BI-3C1A6451 — the dead-code
  // defect tracked at apps/web/lib/wiki/principle-decide.ts:117).
  // PG rows carry direction at row.principleDirection; Qdrant hits
  // carry it at hit.contentPreview.
  type CandidateRow = {
    id: string;
    name: string;
    tier: string;
    weight: number;
    dimensionVector: Record<string, number>;
    directionText: string;
  };
  const candidateRows: CandidateRow[] = [
    ...commandments.map((row): CandidateRow => ({
      id: String(row["id"] ?? ""),
      name: String(row["title"] ?? row["slug"] ?? "principle"),
      tier: String(row["principleTier"] ?? "commandment"),
      weight: resolveWeight(
        String(row["principleTier"] ?? "commandment"),
        row["principleWeight"],
      ),
      dimensionVector:
        (row["principleDimensionVector"] as Record<string, number> | null) ??
        {},
      directionText: String(row["principleDirection"] ?? ""),
    })),
    ...[...core, ...contextual].map((hit): CandidateRow => ({
      id: String(hit["pageId"] ?? ""),
      name: String(hit["title"] ?? hit["slug"] ?? "principle"),
      tier: String(hit["principleTier"] ?? "core"),
      // BI-A9E9ADCB (RC3): pass the per-principle override, mirroring the
      // commandment branch above (which passes row["principleWeight"]). Passing
      // undefined here silently ignored any principleWeight override on a
      // core/contextual principle's Qdrant payload, always using the tier
      // default (0.4/0.1) — so a deliberately re-weighted principle carried no
      // extra pull in the decision. resolveWeight still falls back to the tier
      // default when the override is absent/non-numeric.
      weight: resolveWeight(
        String(hit["principleTier"] ?? "core"),
        hit["principleWeight"],
      ),
      dimensionVector: {}, // Qdrant payload omits the signed vector
      directionText: String(hit["contentPreview"] ?? ""),
    })),
  ];

  // For any candidate that will fall back to semantic alignment
  // (empty dimensionVector), embed its direction text server-side.
  // Parallelized to amortize inference round-trips. Skipped for
  // structured-alignment rows since their embedding wouldn't be used.
  const principleEmbeddings = await Promise.all(
    candidateRows.map(async (row): Promise<number[] | undefined> => {
      if (Object.keys(row.dimensionVector).length > 0) return undefined;
      if (!row.directionText) return undefined;
      const e = await generateEmbedding(row.directionText);
      return e ?? undefined;
    }),
  );

  type DecisionPrinciple = Parameters<typeof decide>[1][number];
  const principleList: DecisionPrinciple[] = candidateRows.map(
    (row, i): DecisionPrinciple => ({
      id: row.id,
      name: row.name,
      tier: row.tier,
      weight: row.weight,
      dimensionVector: row.dimensionVector,
      directionEmbedding: principleEmbeddings[i],
    }),
  );

  const cappedPrinciples = principleList.slice(0, maxPrinciples);

  // Mirror treatment for options: when the caller passes empty features
  // and no explicit embedding, embed the description so the semantic
  // path can actually fire. Caller-supplied embeddings (the rare
  // sophisticated path) win. Per BI-3C1A6451 acceptance criterion.
  type DecisionOption = Parameters<typeof decide>[0][number];
  const decisionOptions: DecisionOption[] = await Promise.all(
    optionsParam
      .filter(
        (o): o is Record<string, unknown> =>
          typeof o === "object" && o !== null,
      )
      .map(async (o): Promise<DecisionOption> => {
        const features =
          typeof o["features"] === "object" && o["features"] !== null
            ? (o["features"] as Record<string, number>)
            : {};
        const description = String(o["description"] ?? "");
        let embedding: number[] | undefined;
        if (Array.isArray(o["embedding"])) {
          embedding = (o["embedding"] as unknown[]).map((n) => Number(n));
        } else if (Object.keys(features).length === 0 && description) {
          const e = await generateEmbedding(description);
          if (e) embedding = e;
        }
        return {
          id: String(o["id"] ?? ""),
          description,
          features,
          embedding,
        };
      }),
  );

  const result = decide(decisionOptions, cappedPrinciples, {
    tieMargin,
    semanticFallbackWarnRatio: semanticWarnRatio,
  });

  // BI-E1FB2307: resolve which decision-perspective profile governs this
  // caller (WWMD platform vs WWWD organization) and name it in the response
  // so agents/operators know which kernel weighed in. Additive — does not
  // change scoring yet; Gate-routed scoring + boundary enforcement is the
  // follow-on (C2b). callingPopulation was validated above.
  const { resolveDecisionCallerContext } = await import(
    "@/lib/decision/caller-context"
  );
  const governingProfile = await resolveDecisionCallerContext({
    callingPopulation:
      callingPopulation as "in_platform_coworker" | "external_coding_agent" | "human",
    agentId: context?.agentId ?? null,
  });

  // BI-E0151DB2. The abstention must be impossible to mistake for a verdict.
  // Previously an insufficient-signal consult returned success:true with
  // recommendation:null and a prose `reasoning` string — a caller that read
  // only `message` or only `recommendation` proceeded as if governed. 16.7% of
  // the first 156 recorded consults landed here. `signalQuality.usable` is the
  // machine-checkable field; the message says so in the first clause.
  const optionsWithFeatures = decisionOptions.filter(
    (o) => Object.keys(o.features ?? {}).length > 0,
  ).length;
  const usable = !result.flags.insufficientSignal && result.recommendation !== null;
  const signalQuality = {
    usable,
    insufficientSignal: result.flags.insufficientSignal,
    structuredCoverage: result.flags.structuredCoverage,
    semanticFallbackRatio: result.flags.semanticFallbackRatio,
    optionsWithFeatures,
    optionCount: decisionOptions.length,
    advisory: usable
      ? null
      : optionsWithFeatures === 0
        ? "NO OPTION SUPPLIED `features`, so every principle scored exactly 0. Governance commandments carry full dimension vectors, so scoring takes the structured path and the semantic fallback never fires for them. Re-call with a features map per option — this is not a neutral or tie result."
        : "Signal was too weak to recommend. Widen per-option `features` coverage across the dimensions the applied principles actually weigh (see each contribution's missingDimensions), or decide by human judgement.",
  };

  const summary = usable
    ? `Recommends ${result.recommendation!.optionId} (confidence: ${result.recommendation!.confidence}, composite ${result.recommendation!.composite.toFixed(3)}; governing profile: ${governingProfile.governingProfileKind})`
    : `NO RECOMMENDATION — signalQuality.usable=false. ${result.reasoning} ${signalQuality.advisory}`;

  // Persist the consult to the DecisionInteraction ledger so the decision
  // governance hub can audit that the gate is in use (per-tier log at
  // /coworker-decisions/decisions). Fail-open: a ledger outage never blocks the
  // decision, but the outcome is named in the response either way.
  // This is audit observability, not a business mutation — the tool's
  // read-only annotation stays as-is (ToolExecution already logs calls;
  // this adds the decision-shaped record the governance surfaces read).
  const { recordKernelConsultInteraction } = await import(
    "@/lib/decision/kernel-consult-ledger"
  );
  const ledger = await recordKernelConsultInteraction({
    db: prisma,
    result,
    callerContext: governingProfile,
    question: contextQuery,
    optionIds: decisionOptions.map((o) => o.id),
    optionDescriptions: Object.fromEntries(
      decisionOptions.map((o) => [o.id, o.description]),
    ),
    appliedPrincipleCount: cappedPrinciples.length,
    callingSurface,
    routeContext: context?.routeContext ?? null,
    taskRunId: context?.taskRunId ?? null,
    caller: {
      client: context?.callerClient ?? null,
      apiTokenId: context?.apiTokenId ?? null,
      authSource: context?.authSource ?? null,
      agentId: context?.agentId ?? null,
      threadId: context?.threadId ?? null,
    },
    signalQuality: {
      usable: signalQuality.usable,
      optionsWithFeatures: signalQuality.optionsWithFeatures,
      optionCount: signalQuality.optionCount,
    },
  });

  return {
    success: true,
    message: summary,
    data: {
      recommendation: result.recommendation,
      // BI-E0151DB2: read this BEFORE acting on `recommendation`.
      signalQuality,
      scores: result.scores,
      flags: result.flags,
      reasoning: result.reasoning,
      appliedPrincipleCount: cappedPrinciples.length,
      governingProfile: {
        profileId: governingProfile.governingProfileId,
        kind: governingProfile.governingProfileKind,
        resolvedVia: governingProfile.resolvedVia,
      },
      ledger,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  principle_decide: (params, _userId, context) => principleDecide(params, context),
};

export const principleDecidePack: ToolPack = {
  packId: "principle-decide",
  definitions,
  handlers,
  grants: {
    principle_decide: ["registry_read"],
  },
};
