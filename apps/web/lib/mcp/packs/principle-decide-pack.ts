// Principle-decide (kernel decision-routing gate) tool pack — EP-8DC217EB BET-4.
//
// Drains the final named tool out of the mcp-tools.ts executeTool switch: the
// advisory decision gate that scores a set of options against the governance
// principles in scope for the calling population and returns a recommendation
// plus a per-principle contribution ledger. The handler lazy-imports the
// Postgres commandment lookup and the vector core/contextual principle search,
// then runs the pure decide() math — reproducing the former switch case
// verbatim, so behaviour is identical when the tool is invoked over MCP.
//
// The definition moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { wikiEmbeddingDigest } from "@dpf/db/wiki-embedding-digest";
import { parseDecisionStakes } from "@dpf/validators/judgment/option-scoring";
import type { RegisteredToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  createRetrievalBudget,
  readDecisionEvidence,
  type DecisionRetrievalEvidence,
  resolveRetrievalBudgetMs,
  retrievePrincipleTiers,
} from "@/lib/decision/retrieval-budget";
import {
  DIMENSION_KEYS,
  buildFeaturesDescription,
} from "@/lib/decision/dimension-catalog";
import { validateOptionInputs } from "@/lib/decision/option-input-contract";
import {
  groundOptionsFromParams,
  buildScoredDecisionOptions,
  PRINCIPLE_DECIDE_EVIDENCE_SCHEMA,
} from "@/lib/decision/evidence-grounding";

const definitions: RegisteredToolDefinition[] = [
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
              // Both are enforced at call time, not merely declared (BI-9889566B):
              // an option with no id, or an id shared with another option,
              // cannot be told apart in the scores, the recommendation or the
              // evidence map, so the call is refused rather than scored.
              id: {
                type: "string",
                description:
                  "Stable identifier for the option. Required, non-empty, and DISTINCT across the option set — the scores, the recommendation and the `evidence` map are all keyed on it. A set with a missing or duplicated id is refused.",
              },
              description: {
                type: "string",
                description:
                  "Short prose description. Required and non-empty — it is what the semantic path scores when an option carries no features.",
              },
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
        decisionDomain: { type: "string", enum: ["org-business", "platform-development"], description: "Owning scope (BI-HDLEMP-01, BI-9C384562): org-business is answered by the organization WWWD profile, platform-development by the founder WWMD profile. Omitted, routing falls back to callingPopulation, which sends an in-platform coworker to the organization profile." },
        callingPopulation: {
          type: "string",
          enum: ["in_platform_coworker", "external_coding_agent", "human"],
          description: "Population whose principles should apply.",
        },
        maxPrinciples: {
          type: "number",
          description: "Cap on relevant core/contextual principles retrieved from the vector store. Default 20.",
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
    workroomAccess: "outside-workroom",
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
  const validPopulations = new Set(["in_platform_coworker", "external_coding_agent", "human"]);
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

  // Option-set input contract (BI-9889566B / BI-E0151DB2): identity then
  // features, both fail-fast. See option-input-contract.ts for why a silently
  // accepted id-less option produced an option-invariant ranking.
  const optionInputRejection = validateOptionInputs(optionsParam);
  if (optionInputRejection) return { success: false, ...optionInputRejection };

  const { listPrinciplesByTier, prisma, PRINCIPLE_DECIDE_DEFAULTS } =
    await import("@dpf/db");
  const { PRINCIPLE_RING_SCOPES } = await import(
    "@dpf/db/wiki-taxonomy"
  );
  const { searchWikiPages } = await import("@/lib/wiki/embeddings");
  const { decide } = await import("@dpf/validators/judgment/option-scoring");
  const { principleMatchesRingScope } = await import(
    "@/lib/wiki/calling-ring-map"
  );
  // BI-5BB1A364: consumer-context retrieval filter + contextless-caller attenuation.
  const { consumerContextWeightMultiplier } = await import(
    "@/lib/decision/consumer-context-attenuation"
  );
  // BI-3C1A6451: server-side embedding for the semantic-fallback path.
  // Used both for principle direction text (vector-sourced principles
  // have empty dimensionVector) and for option descriptions when the
  // caller passes empty features. Pre-fix, both produced alignment=0.
  const { generateEmbedding } = await import(
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

  const retrievalBudget = createRetrievalBudget(resolveRetrievalBudgetMs());
  const scopeRead = await readDecisionEvidence(retrievalBudget, () =>
    prisma.organization.findFirst({ select: { id: true } }), "organization scope");
  const organizationId = scopeRead.status === "complete" ? scopeRead.value?.id ?? null : null;

  // Fetch one sentinel past the bound before any in-memory filter. A full
  // result at the supported bound is valid. The sentinel proves overflow.
  const commandmentLimit = 50;
  const mandatory = scopeRead.status === "complete"
    ? await readDecisionEvidence(retrievalBudget, () => listPrinciplesByTier(prisma, {
        tier: "commandment",
        organizationId,
        appliesTo: callingPopulation,
        ringScope,
        consumerContexts,
        limit: commandmentLimit + 1,
      }), "commandments")
    : null;
  const evidence: DecisionRetrievalEvidence = {
    scope: scopeRead.status,
    commandments: mandatory?.status ?? "not-run",
    core: "not-run",
    contextual: "not-run",
    hydration: "complete",
    inference: "complete",
  };
  let commandments = (mandatory?.status === "complete" ? mandatory.value : []) as Array<Record<string, unknown>>;
  if (commandments.length > commandmentLimit) {
    evidence.commandments = "overflow";
    commandments = [];
  }

  const contextQuery = String(params["context"] ?? "");
  const tiers = evidence.commandments === "complete" ? await retrievePrincipleTiers({
    search: searchWikiPages as never,
    budget: retrievalBudget,
    query: contextQuery,
    organizationId,
    callingPopulation,
    ringScope: ringScopeActive ? ringScope : undefined,
    contextualThreshold,
  }) : null;
  if (tiers) {
    evidence.core = tiers.status.core;
    evidence.contextual = tiers.status.contextual;
  }
  let core = tiers?.core ?? [];
  let contextual = tiers?.contextual ?? [];

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
  // the vector store is the relevance index, not the authoring store: its payload
  // (embeddings.ts storeWikiPage) carries principleTier/AppliesTo/RingScope/
  // Dimensions/Public and deliberately NOT principleDimensionVector or
  // principleWeight. So a vector hit alone can never score structurally, and
  // the principleWeight override read below was reading a key that is never
  // written. Rather than duplicating the vector into the payload (which then
  // goes stale on any principle edit that skips a re-embed), we let the vector store
  // rank relevance and then fetch the real rows from Postgres by pageId —
  // pageId is the WikiPage id (payload entityId), so this is one keyed
  // findMany with no backfill and no drift surface.
  let relevanceHits = [...core, ...contextual];
  const hydratedById = new Map<string, Record<string, unknown>>();
  let phantomHits = 0;
  if (relevanceHits.length > 0) {
    const hitIds = [...new Set(relevanceHits.map((hit) => String(hit["pageId"] ?? "")).filter(Boolean))];
    const read = await readDecisionEvidence(retrievalBudget, () => prisma.wikiPage.findMany({
      where: {
        id: { in: hitIds },
        status: "published",
        pageKind: "principle",
        OR: [
          { isKernel: true, organizationId: null },
          ...(organizationId ? [{ organizationId }] : []),
        ],
      },
    }), "core/contextual hydration");
    evidence.hydration = read.status;
    if (read.status === "complete") {
      for (const row of read.value) hydratedById.set(row.id, row);
      const kept = relevanceHits.filter((hit) => {
        const row = hydratedById.get(String(hit["pageId"] ?? ""));
        if (!row) {
          phantomHits++;
          evidence.hydration = "stale";
          return false;
        }
        const digest = hit["embeddingSourceDigest"];
        if (digest === null) {
          if (evidence.hydration === "complete") evidence.hydration = "missing";
          return false;
        }
        if (typeof digest === "string" && (typeof row["body"] !== "string" ||
          digest !== wikiEmbeddingDigest({
            body: row["body"],
            abstract: typeof row["abstract"] === "string" ? row["abstract"] : null,
          }))) {
          evidence.hydration = "stale";
          return false;
        }
        return true;
      });
      relevanceHits = kept;
    } else {
      relevanceHits = [];
    }
  }
  const rehydrationQueryOk = evidence.hydration !== "failed" && evidence.hydration !== "late";

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
        unhydratedCount: core.length + contextual.length - relevanceHits.length,
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
  // the full dimensionVector for structured alignment; vector hits only
  // carry dimension keys (no signed vector), so they fall back to
  // semantic alignment. For the semantic path to produce non-zero
  // signal, we must embed each candidate's direction text and let
  // decide()'s cosine math do the rest (BI-3C1A6451 — the dead-code
  // defect tracked at apps/web/lib/wiki/principle-decide.ts:117).
  // PG rows carry direction at row.principleDirection; vector hits
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
      // weight override, direction text). Unverified hits were removed above.
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
        // It was previously read off the vector hit, but storeWikiPage never
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
  const embedForDecision = async (value: string) => {
    const read = await readDecisionEvidence(retrievalBudget, () => generateEmbedding(value), "scoring embedding");
    if (read.status === "complete" && read.value) return read.value;
    if (read.status === "late") evidence.inference = "late";
    else if (evidence.inference !== "late") evidence.inference = "failed";
    return undefined;
  };
  const principleEmbeddings = await Promise.all(candidateRows.map(async (row) =>
    Object.keys(row.dimensionVector).length > 0 || !row.directionText
      ? undefined
      : embedForDecision(row.directionText),
  ));

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
  // principles retrieved from the vector index, but was applied as slice() over the
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
  const { groundedFeaturesByIndex, ledgerArgs } = groundOptionsFromParams(params);
  const decisionOptions = await buildScoredDecisionOptions({
    optionsParam,
    groundedFeaturesByIndex,
    generateEmbedding: evidence.commandments === "complete"
      ? embedForDecision
      : async () => undefined,
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
  const { resolveDecisionCallerContext, resolveDecisionDomainParam } = await import("@/lib/decision/caller-context");
  const governingProfile = await resolveDecisionCallerContext({
    callingPopulation:
      callingPopulation as "in_platform_coworker" | "external_coding_agent" | "human",
    agentId: context?.agentId ?? null,
    // BI-9C384562: a policy-projection consult is platform-development by construction.
    decisionDomain: resolveDecisionDomainParam(params, Boolean(policyProjection)),
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

  const retrievalDegraded = Object.values(evidence).some((status) => status !== "complete");
  const verdictResult = retrievalDegraded
    ? { ...result, recommendation: null, flags: { ...result.flags, autonomyEligible: false } }
    : result;

  // BI-1D23EC26: signalQuality + summary extracted to keep this pack under LOC ceiling.
  const {
    buildPrincipleDecideSignalQuality,
    buildPrincipleDecideSummary,
  } = await import("@/lib/decision/principle-decide-signal-quality");
  const signalQuality = buildPrincipleDecideSignalQuality({
    result: verdictResult,
    retrievalEvidence: evidence,
    optionsWithFeatures,
    optionCount: decisionOptions.length,
  });
  const usable = signalQuality.usable;
  const summary = buildPrincipleDecideSummary({
    usable,
    retrievalDegraded,
    result: verdictResult,
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
    result: retrievalDegraded ? { ...verdictResult, reasoning: summary } : verdictResult,
    callerContext: governingProfile,
    question: contextQuery,
    optionIds: decisionOptions.map((o) => o.id),
    optionDescriptions: Object.fromEntries(
      decisionOptions.map((o) => [o.id, o.description]),
    ),
    // BI-F302B80E: record the MENU, not only the pick. Without it the row can
    // be counted but never learned from — the weight-inference adapter needs
    // the scored features beside the recommendation and the later outcome.
    scoredOptions: decisionOptions.map((o) => ({
      id: o.id,
      description: o.description,
      features: o.features,
    })),
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
      retrievalEvidence: evidence,
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
    // BI-8AB6B4F7: an organization-scoped consult records the direction it read.
    ...(governingProfile.governingProfileKind === "organization" && organizationId
      ? await import("@/lib/organization-direction/direction").then(async (m) =>
          m.directionLedgerFields(await m.loadOrganizationDirection(prisma as never, organizationId).catch(() => null)))
      : {}),
  });

  return {
    success: true,
    message: summary,
    data: {
      recommendation: verdictResult.recommendation,
      // BI-E0151DB2: read this BEFORE acting on `recommendation`.
      signalQuality,
      scores: result.scores,
      flags: verdictResult.flags,
      reasoning: retrievalDegraded ? summary : result.reasoning,
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
  // BI-825D3487: principle_decide scores from the kernel corpus.
  principle_decide: async (params, _userId, context) =>
    (await (await import("@/lib/tak/corpus-read-scope")).refuseWithoutCorpus(context?.agentId, "kernel", "principle_decide"))
    ?? runPrincipleDecision(params, context),
};

export const principleDecidePack: ToolPack = {
  packId: "principle-decide",
  definitions,
  handlers,
  grants: {
    principle_decide: ["registry_read"],
  },
};
