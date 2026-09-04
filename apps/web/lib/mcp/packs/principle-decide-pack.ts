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

import { parseDecisionStakes } from "@/lib/decision/option-scoring";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  DIMENSION_KEYS,
  buildFeaturesDescription,
  validateOptionFeatures,
  featureErrorRemedy,
  type FeatureValidationError,
} from "@/lib/decision/dimension-catalog";
import {
  groundOptionsFromParams,
  buildScoredDecisionOptions,
  PRINCIPLE_DECIDE_EVIDENCE_SCHEMA,
} from "@/lib/decision/evidence-grounding";

const definitions: ToolDefinition[] = [
  {
    name: "principle_decide",
    description:
      "Advisory only. Score a set of options against the governance principles in scope for the calling population, and return a recommendation plus a per-principle contribution ledger. " +
      "Uses commandments from Postgres (always included) and relevant core/contextual principles from semantic search. Does not execute the recommended option; the caller retains authority. " +
      "Use when you have two or more options and want to surface which governance principles pull which way. " +
      "Call once per distinct option set — do not re-score identical options hoping for a different winner.",
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
        // Trust-envelope evidence grounding params (spec §2 Axis 1) — defined in
        // evidence-grounding.ts so this pack stays under the module-size ceiling.
        ...PRINCIPLE_DECIDE_EVIDENCE_SCHEMA,
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
        stakes: {
          type: "string",
          enum: ["routine", "elevated", "high"],
          description: "How consequential this decision is (BI-1BBB2136). Stakes widen or narrow the UNCERTAIN band from both sides: a high-stakes call demands more separation before it calls anything an assurance, and less opposition before it declines. Defaults to 'elevated'. Pass your real risk tier — leaving it unset weighs every decision, however consequential, at the same bar.",
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
        consumerContexts: {
          type: "array",
          items: { type: "string" },
          description:
            "Route/domain context slugs this decision belongs to (e.g. ['ui'], ['build-studio']) — the same slugs a route-domain-specific principle declares via principleConsumerContexts. When set, retrieval excludes a route-domain-specific commandment whose contexts don't intersect (empty principleConsumerContexts still passes — backward compat for universal/generalist/specialist archetypes). Omit when the decision has no specific route/domain (e.g. a general architecture call): retrieval still consults every commandment, but a route-domain-specific one is scored at attenuated weight rather than full commandment weight, so a UI-only rule like no-hardcoded-colors can no longer co-rank as a top contributor on an unrelated decision (BI-5BB1A364).",
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

export async function runPrincipleDecision(
  params: Record<string, unknown>,
  context?: Parameters<ToolPackHandler>[2],
  policyProjection?: import("@/lib/decision/kernel-consult-ledger").KernelConsultPolicyProjection,
): Promise<ToolResult> {
  // Pull in-scope commandments plus relevant core/contextual principles, run
  // the pure scoring math, and return its contribution ledger.
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
  // BI-5BB1A364: consumer-context retrieval filter + contextless-caller attenuation.
  const { consumerContextWeightMultiplier } = await import(
    "@/lib/decision/consumer-context-attenuation"
  );
  // BI-3C1A6451: server-side embedding for the semantic-fallback path.
  // Used both for principle direction text (Qdrant-sourced principles
  // have empty dimensionVector) and for option descriptions when the
  // caller passes empty features. Pre-fix, both produced alignment=0.
  const { generateEmbedding, isEmbeddingAvailable } = await import(
    "@/lib/inference/embedding"
  );

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

  // BI-5BB1A364: validate consumerContexts like ringScope — fail fast, no silent "no filter" degrade.
  let consumerContexts: string[] | undefined;
  if (params["consumerContexts"] !== undefined) {
    if (
      !Array.isArray(params["consumerContexts"]) ||
      !(params["consumerContexts"] as unknown[]).every(
        (v) => typeof v === "string" && v.length > 0,
      )
    ) {
      return {
        success: false,
        message: "consumerContexts must be an array of non-empty strings.",
        error: "Invalid consumerContexts shape",
      };
    }
    consumerContexts = params["consumerContexts"] as string[];
  }

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
  const stakes = parseDecisionStakes(params["stakes"]);
  const contextualThreshold =
    PRINCIPLE_DECIDE_DEFAULTS.contextualSimilarityThreshold;
  const semanticWarnRatio =
    PRINCIPLE_DECIDE_DEFAULTS.semanticFallbackWarnRatio;
  const minFeatureKeys =
    typeof params["minFeatureKeys"] === "number"
      ? params["minFeatureKeys"]
      : PRINCIPLE_DECIDE_DEFAULTS.minFeatureKeys;
  const sensitivityEpsilon =
    typeof params["sensitivityEpsilon"] === "number"
      ? params["sensitivityEpsilon"]
      : PRINCIPLE_DECIDE_DEFAULTS.sensitivityEpsilon;

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
      consumerContexts,
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

  // RC2/RC3 (BI-E1267C6D) — rehydrate the authoritative principle rows.
  //
  // Qdrant is the relevance index, not the authoring store: its payload
  // (embeddings.ts storeWikiPage) carries principleTier/AppliesTo/RingScope/
  // Dimensions/Public and deliberately NOT principleDimensionVector or
  // principleWeight. So a Qdrant hit alone can never score structurally, and
  // the principleWeight override read below was reading a key that is never
  // written. Rather than duplicating the vector into the payload (which then
  // goes stale on any principle edit that skips a re-embed), we let Qdrant
  // rank relevance and then fetch the real rows from Postgres by pageId —
  // pageId is the WikiPage id (payload entityId), so this is one keyed
  // findMany with no backfill and no drift surface.
  let relevanceHits = [...core, ...contextual];
  const hydratedById = new Map<string, Record<string, unknown>>();
  // Did the rehydration QUERY succeed? Distinct from "did a given id resolve".
  // The two failures mean opposite things and must not be conflated (see the
  // phantom-drop below).
  let rehydrationQueryOk = true;
  if (relevanceHits.length > 0) {
    const hitIds = Array.from(
      new Set(
        relevanceHits
          .map((hit) => String(hit["pageId"] ?? ""))
          .filter((id) => id.length > 0),
      ),
    );
    if (hitIds.length > 0) {
      try {
        const rows = (await prisma.wikiPage.findMany({
          where: { id: { in: hitIds } },
        })) as Array<Record<string, unknown>>;
        for (const row of rows) {
          hydratedById.set(String(row["id"] ?? ""), row);
        }
      } catch (err) {
        rehydrationQueryOk = false;
        // Degrades to the pre-fix behaviour (semantic alignment), which the
        // semanticFallbackRatio flag already surfaces to the caller. Counted
        // in the recall trace below so the degradation is never silent.
        console.warn(
          "[principle_decide] core/contextual Postgres rehydration failed:",
          err,
        );
      }
    }
  }

  // BI-6ADB019D — drop phantom hits: Qdrant points whose WikiPage no longer
  // exists. Postgres is the authoring store, so an id the index returned that
  // a SUCCESSFUL lookup could not find is a deleted page, not a slow one.
  //
  // Observed live: five hits titled "Live State Over Seed Data" when the DB
  // holds exactly one — four Qdrant points referencing rows that are gone.
  // Left in place they cost nothing in score (they contribute 0.000) but they
  // consume `maxPrinciples` slots, so real doctrine gets squeezed out of the
  // relevance set by principles that do not exist. That is the same starvation
  // RC6 just fixed, arriving by a different route.
  //
  // THE DISTINCTION THAT MATTERS: only drop when the query SUCCEEDED. If the
  // lookup itself failed, every id is unresolved for a transient reason, and
  // dropping them would silently delete the entire core/contextual tier from
  // the decision — a far worse failure than carrying a few phantoms.
  let phantomHits = 0;
  if (rehydrationQueryOk && relevanceHits.length > 0) {
    const kept = relevanceHits.filter((hit) =>
      hydratedById.has(String(hit["pageId"] ?? "")),
    );
    phantomHits = relevanceHits.length - kept.length;
    if (phantomHits > 0) {
      console.warn(
        `[principle_decide] dropped ${phantomHits} retrieval hit(s) whose WikiPage no longer exists — the vector index disagrees with the authoring store (BI-6ADB019D). Reconcile the wiki store.`,
      );
      relevanceHits = kept;
    }
  }

  // RC4 recurrence guard. Commandments are uncapped doctrine, but retrieval
  // still passes limit: 50. Returning exactly the limit means the corpus may
  // have outgrown it and doctrine is being silently truncated again — the
  // original RC4 defect. 41 of 50 slots were in use as of 2026-07-23.
  const commandmentLimit = 50;
  if (commandments.length >= commandmentLimit) {
    console.warn(
      `[principle_decide] commandment retrieval returned ${commandments.length} rows at limit ${commandmentLimit} — the commandment corpus may be truncated (RC4). Raise the limit.`,
    );
  }

  console.info(
    `[principle-recall-trace] ` +
      JSON.stringify({
        callingSurface,
        callingPopulation,
        ringScope: ringScope ?? null,
        ringScopeActive,
        // BI-5BB1A364: null/empty means "consult everything" (attenuated, not excluded).
        consumerContexts: consumerContexts ?? null,
        tool: "principle_decide",
        commandmentCount: commandments.length,
        coreCount: core.length,
        contextualCount: contextual.length,
        hydratedCount: hydratedById.size,
        unhydratedCount: relevanceHits.length - hydratedById.size,
        // BI-6ADB019D: hits dropped because their WikiPage is gone. A non-zero
        // value means the vector index disagrees with the authoring store.
        phantomHitsDropped: phantomHits,
        rehydrationQueryOk,
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
    ...commandments.map((row): CandidateRow => {
      const dimensionVector =
        (row["principleDimensionVector"] as Record<string, number> | null) ?? {};
      const baseWeight = resolveWeight(
        String(row["principleTier"] ?? "commandment"),
        row["principleWeight"],
      );
      // BI-5BB1A364: attenuate-not-exclude (contextless caller + profession-local axes).
      const contextMultiplier = consumerContextWeightMultiplier({
        consumerArchetype: row["principleConsumerArchetype"] as string | null | undefined,
        principleConsumerContexts: row["principleConsumerContexts"] as string[] | null | undefined,
        callerConsumerContexts: consumerContexts,
        dimensionVector,
      });
      return {
        id: String(row["id"] ?? ""),
        name: String(row["title"] ?? row["slug"] ?? "principle"),
        tier: String(row["principleTier"] ?? "commandment"),
        weight: baseWeight * contextMultiplier,
        dimensionVector,
        directionText: String(row["principleDirection"] ?? ""),
      };
    }),
    ...relevanceHits.map((hit): CandidateRow => {
      // Prefer the rehydrated Postgres row (authoritative: signed vector,
      // weight override, direction text). Fall back to the Qdrant payload
      // field-by-field so a rehydration miss degrades to the pre-fix
      // behaviour for that one principle rather than dropping it.
      const row = hydratedById.get(String(hit["pageId"] ?? ""));
      const tier = String(
        row?.["principleTier"] ?? hit["principleTier"] ?? "core",
      );
      return {
        id: String(hit["pageId"] ?? ""),
        name: String(
          row?.["title"] ?? hit["title"] ?? hit["slug"] ?? "principle",
        ),
        tier,
        // BI-A9E9ADCB (RC3): the override is read from the rehydrated row.
        // It was previously read off the Qdrant hit, but storeWikiPage never
        // writes principleWeight to the payload, so the override was still
        // always undefined and every core/contextual principle silently used
        // the tier default (0.4/0.1). resolveWeight still falls back to the
        // tier default when the override is absent/non-numeric.
        weight: resolveWeight(tier, row?.["principleWeight"]),
        // RC2: the authored signed vector, finally reaching structured
        // scoring. Empty only when rehydration missed, in which case this
        // principle falls back to semantic alignment as it did before.
        dimensionVector:
          (row?.["principleDimensionVector"] as Record<string, number> | null) ??
          {},
        directionText: String(
          row?.["principleDirection"] ?? hit["contentPreview"] ?? "",
        ),
      };
    }),
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

  // RC6 (BI-E1267C6D) — cap the relevance-retrieved set, not the merged list.
  //
  // maxPrinciples is documented (and named) as a cap on the core/contextual
  // principles retrieved from Qdrant, but was applied as slice() over the
  // merged list, which is built commandments-first. Once the commandment
  // corpus outgrew the cap that arithmetic silently starved the tail: with 41
  // commandments against a default cap of 20, a live call retrieved 41
  // commandments + 5 core and scored 20 commandments in alphabetical order,
  // truncated at "Never Assume — Verify" — dropping 21 commandments AND every
  // core principle. This is RC4's failure shape (a cap whose semantics drifted
  // from its comment) one layer up, and it made RC2's fix unobservable.
  //
  // Commandments are uncapped doctrine (2026-05-22 model, RC4); their only
  // bound is the retrieval limit, which is warned on above. filter() preserves
  // relative order, so core/contextual keep their relevance ranking.
  const cappedPrinciples = [
    ...principleList.filter((p) => p.tier === "commandment"),
    ...principleList
      .filter((p) => p.tier !== "commandment")
      .slice(0, maxPrinciples),
  ];

  // Trust-envelope evidence grounding (BI-EA97E5CD, spec §2 Axis 1): bind each
  // score to a cited source; when `requireEvidence` is set, drop features lacking
  // admissible evidence before scoring. Options are then embedded for the semantic
  // path (BI-3C1A6451). Both helpers live in evidence-grounding.ts (module-size).
  const { groundedFeaturesById, ledgerArgs } = groundOptionsFromParams(params);
  const decisionOptions = await buildScoredDecisionOptions({
    optionsParam,
    groundedFeaturesById,
    generateEmbedding,
  });

  const result = decide(decisionOptions, cappedPrinciples, {
    tieMargin,
    ...(stakes ? { stakes } : {}),
    semanticFallbackWarnRatio: semanticWarnRatio,
    minFeatureKeys,
    sensitivityEpsilon,
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

  // BI-512FBD20. When BOTH semantic-retrieval passes come back empty, the
  // consult ran on commandments alone — and that is indistinguishable, from
  // the scores, between "no core/contextual principle was relevant" and "the
  // embedding provider is down, so retrieval could not run at all". The second
  // case is the silent kernel degradation this BI exists to kill: on
  // 2026-07-22 the provider was 404ing and every consult applied ~18
  // commandments out of 162 principles while flagging structuredCoverage
  // "strong". So when both passes are empty we PROBE the provider once and, if
  // it is unavailable, say so loudly — a consult must never again imply full
  // coverage while core/contextual retrieval was structurally impossible.
  // `make-silent-failures-observable`, applied to the kernel's own recall.
  let retrievalDegraded = false;
  if (core.length === 0 && contextual.length === 0) {
    retrievalDegraded = !(await isEmbeddingAvailable());
    if (retrievalDegraded) {
      console.error(
        "[principle_decide] retrieval degraded — embedding provider unavailable; " +
          "consulted commandments only. Fix: docker model pull ai/nomic-embed-text-v1.5",
      );
    }
  }

  // BI-1D23EC26: signalQuality + summary extracted to keep this pack under LOC ceiling.
  const {
    buildPrincipleDecideSignalQuality,
    buildPrincipleDecideSummary,
  } = await import("@/lib/decision/principle-decide-signal-quality");
  const signalQuality = buildPrincipleDecideSignalQuality({
    result,
    retrievalDegraded,
    optionsWithFeatures,
    optionCount: decisionOptions.length,
  });
  const usable = signalQuality.usable;
  const summary = buildPrincipleDecideSummary({
    usable,
    retrievalDegraded,
    result,
    signalQuality,
    governingProfileKind: governingProfile.governingProfileKind,
  });
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
      // BI-1D23EC26 — autonomy + MCDA quality (persisted for audit)
      autonomyEligible: signalQuality.autonomyEligible,
      featureCoverageWeak: signalQuality.featureCoverageWeak,
      sensitivityUnstable: signalQuality.sensitivityUnstable,
    },
    // Trust-envelope: persist evidence citations onto the ledger row and seal
    // the decision into the append-only hash chain (BI-EA97E5CD / BI-81CC5D8E).
    ...ledgerArgs,
    policyProjection: policyProjection ?? null,
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
  principle_decide: (params, _userId, context) => runPrincipleDecision(params, context),
};

export const principleDecidePack: ToolPack = {
  packId: "principle-decide",
  definitions,
  handlers,
  grants: {
    principle_decide: ["registry_read"],
  },
};
