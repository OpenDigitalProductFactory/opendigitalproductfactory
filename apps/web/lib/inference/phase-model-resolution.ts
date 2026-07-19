// apps/web/lib/inference/phase-model-resolution.ts
//
// Model Selection & Runtime Health — the single resolver that answers, per
// Build Studio phase, "which model/provider/engine WILL run right now, and does
// live config contradict platform guidance?" — BEFORE a build runs.
//
// WHY THIS EXISTS (the blind spot it closes): model selection is split across
// THREE config sources that nothing synthesizes, so a "local-model" campaign
// silently ran on cloud until the GPU sat idle:
//   1. Providers & Routing (/platform/ai/providers) governs routeAndCall →
//      routeEndpointV2. Its Stage-5b tier-sort (pipeline-v2.ts) puts
//      user_configured (cloud) endpoints AHEAD of bundled (local) ones, so on a
//      mixed install local never wins a routed phase.
//   2. Build Runtime (/platform/ai/build-studio) governs the build-phase
//      dispatch engine via getBuildStudioConfig() (PlatformConfig row
//      "build-studio-dispatch").
//   3. DMR serving config (served context window) — read only inside
//      preflightLocalEndpoint(), invisible to both admin pages.
//
// As-built per-phase truth this resolver encodes (verified against the code):
//   - ideate: engine = config.provider. opencode → routeAndCall(quality_first)
//     (so it ROUTES, despite the "local" engine); claude/codex/grok → vendor CLI.
//   - plan: always routeAndCall(quality_first).
//   - design-review / plan-review: always routeAndCall(analysis).
//   - build: opencode → dispatchOpencodeTask (truly local); everything else →
//     runAgenticLoop → routeAndCall(analysis, requireTools).
// Net: selecting "Local model (OpenCode)" makes ONLY the build phase local;
// ideate + plan + both reviews route to cloud on a mixed install.
//
// The resolver reuses the REAL routing logic via previewRoute() (a side-effect-
// free dry-run of routeEndpointV2) so its prediction matches what actually runs.

import { prisma } from "@dpf/db";
import { previewRoute, type RouteAndCallOptions } from "@/lib/inference/routed-inference";
import type { RequestContract } from "@/lib/routing/request-contract";
import {
  loadPhaseEnableCandidateProviders,
  selectEnableCandidatesForContract,
  type EnableCandidate,
} from "@/lib/inference/phase-enable-candidates";
import {
  compileBuildStudioPhaseActivity,
  routeContextFromActivity,
} from "@/lib/routing/activity-compiler";
import {
  getBuildStudioConfig,
  type BuildStudioDispatchConfig,
} from "@/lib/integrate/build-studio-config";
import {
  preflightLocalEndpoint,
  isLikelyNonChatModel,
  OPENCODE_MIN_CONTEXT_TOKENS,
} from "@/lib/integrate/opencode-dispatch";
import { getOllamaBaseUrl } from "@/lib/inference/ollama-url";

// ─── Public types ─────────────────────────────────────────────────────────────

export type BuildPhaseId =
  | "ideate"
  | "plan"
  | "design-review"
  | "plan-review"
  | "build";

export type DispatchMechanism =
  /** routeAndCall → V2 routing. Provider/model chosen by Providers & Routing. */
  | "routed"
  /** A vendor CLI (claude/codex/grok) dispatched in the sandbox. */
  | "vendor-cli"
  /** The opencode CLI run against the install's local OpenAI-compatible endpoint. */
  | "local-opencode"
  /** This engine has no dispatch path for this phase. */
  | "unsupported";

/** Which admin surface (or none) actually decides this phase's model. */
export type ConfigSource = "build-runtime" | "providers-routing" | "dmr-serving";

export type FlagSeverity = "error" | "warning" | "info";

export interface PhaseFlag {
  severity: FlagSeverity;
  /** Stable machine code, e.g. "local-intent-cloud-reasoning". */
  code: string;
  message: string;
  remediation: string;
}

export interface PhaseResolution {
  phase: BuildPhaseId;
  label: string;
  /** Plain-language statement of which admin surface governs this phase. */
  governedBy: ConfigSource;
  mechanism: DispatchMechanism;
  /** The Build Runtime dispatch engine label, for context (e.g. "Local model (OpenCode)"). */
  engine: string;
  providerId: string | null;
  modelId: string | null;
  /** true = local/bundled (on-box), false = cloud, null = unknown / none eligible. */
  isLocal: boolean | null;
  /** Routed winner's provider tier ("bundled" | "user_configured"), when routed. */
  providerTier: string | null;
  /** Served / max context window in tokens, when known. */
  contextTokens: number | null;
  /** One-line rationale (route reason or config explanation). */
  rationale: string;
  flags: PhaseFlag[];
  /**
   * F10/F11: when this phase is blocked with `no-eligible-endpoint`, the
   * currently-off provider(s) whose capabilities WOULD satisfy its routing
   * contract if enabled — ordered one-click-first. Absent/empty otherwise.
   */
  enableCandidates?: EnableCandidate[];
}

export type RuntimeVerdict =
  | "all-local"
  | "all-cloud"
  | "mixed"
  | "unconfigured";

export interface ModelSelectionOverview {
  verdict: RuntimeVerdict;
  /** One-line human summary. */
  summary: string;
  /** The Build Runtime dispatch engine (config.provider). */
  buildEngine: BuildStudioDispatchConfig["provider"];
  /** Display label for the build engine. */
  buildEngineLabel: string;
  phases: PhaseResolution[];
  /** All phase flags, tagged with their phase, sorted error→warning→info. */
  flags: Array<PhaseFlag & { phase: BuildPhaseId }>;
  /** How each phase was resolved — surfaced so the answer is auditable. */
  notes: string[];
  generatedAt: string;
}

// ─── Phase routing contracts (must mirror the real call sites exactly) ─────────
//
// These are the exact routeAndCall options for portal-routed reasoning phases.
// Ideate and Build consume the shared Build Studio selector result directly.
// Keep the remaining previews in sync with:
//   plan            → plan-on-approval.ts   routeAndCall(..., "internal", { budgetClass: "quality_first" })
//   design/plan-rev → build.ts              routeAndCall(..., "internal", { taskType: "analysis" })

const REASONING_SAMPLE =
  "Produce a structured implementation plan for a small feature change.";
export function buildEngineLabel(provider: BuildStudioDispatchConfig["provider"]): string {
  switch (provider) {
    case "claude":
      return "Claude Code CLI";
    case "codex":
      return "Codex CLI";
    case "grok":
      return "Grok CLI";
    case "opencode":
      return "Local model (OpenCode)";
    case "agentic":
      return "Agentic Loop";
    default:
      return provider;
  }
}

// ─── Routed-phase resolution (the shared dry-run) ──────────────────────────────

// The routing contract previewRoute inferred for each routed phase, keyed by the
// resolution it produced. Kept off the public PhaseResolution shape (it is a
// heavy internal type); the top-level resolver reads it to compute
// enable-candidates for any phase blocked with `no-eligible-endpoint`.
const phaseContracts = new WeakMap<PhaseResolution, RequestContract>();

async function resolveRoutedPhase(args: {
  phase: BuildPhaseId;
  label: string;
  engine: string;
  governedBy: ConfigSource;
  sample: string;
  opts: RouteAndCallOptions;
}): Promise<PhaseResolution> {
  const activity = compileBuildStudioPhaseActivity({
    phase: args.phase,
    parentRef: {},
  });
  const routeOptions = {
    ...routeContextFromActivity(activity),
    activityContract: activity,
    ...args.opts,
  } as RouteAndCallOptions;
  const base = {
    phase: args.phase,
    label: args.label,
    governedBy: args.governedBy,
    mechanism: "routed" as const,
    engine: args.engine,
  };
  try {
    const { decision, selectedManifest, contract } = await previewRoute(
      [{ role: "user", content: args.sample }],
      "internal",
      routeOptions,
    );
    if (!decision.selectedEndpoint || !selectedManifest) {
      const blocked: PhaseResolution = {
        ...base,
        providerId: null,
        modelId: decision.selectedModelId,
        isLocal: null,
        providerTier: null,
        contextTokens: null,
        rationale: decision.reason,
        flags: [
          {
            severity: "error",
            code: "no-eligible-endpoint",
            message: `No eligible AI endpoint for the ${args.label} phase under its routing contract.`,
            remediation:
              "Activate a provider that satisfies this phase's requirements (tools, context, sensitivity) in Providers & Routing.",
          },
        ],
      };
      // Keep the contract so the top-level resolver can name the disabled
      // provider(s) that would satisfy it if enabled (F10/F11).
      phaseContracts.set(blocked, contract);
      return blocked;
    }
    return {
      ...base,
      providerId: selectedManifest.providerId,
      modelId: selectedManifest.modelId,
      isLocal: selectedManifest.providerTier === "bundled",
      providerTier: selectedManifest.providerTier,
      contextTokens: selectedManifest.maxContextTokens,
      rationale: decision.reason,
      flags: [],
    };
  } catch (err) {
    // prepareRoute throws NoEligibleEndpointsError when zero providers exist.
    return {
      ...base,
      providerId: null,
      modelId: null,
      isLocal: null,
      providerTier: null,
      contextTokens: null,
      rationale: (err as Error).message,
      flags: [
        {
          severity: "error",
          code: "no-providers",
          message: `No AI providers are configured — the ${args.label} phase cannot run.`,
          remediation:
            "Connect a provider in Providers & Routing, or configure a local model endpoint.",
        },
      ],
    };
  }
}

// ─── Engine-governed phase resolution (ideate, build) ──────────────────────────

async function resolveIdeatePhase(
  config: BuildStudioDispatchConfig,
): Promise<PhaseResolution> {
  const engine = buildEngineLabel(config.provider);
  const selection = config.selection;
  if (selection?.status === "selected" && selection.selected) {
    return {
      phase: "ideate",
      label: "Ideate",
      governedBy: "build-runtime",
      mechanism: selection.selected.engine === "agentic" ? "routed" : "vendor-cli",
      engine,
      providerId: selection.selected.providerId,
      modelId: selection.selected.modelId || "(provider default)",
      isLocal: selection.selected.local,
      providerTier: selection.selected.local ? "bundled" : "user_configured",
      contextTokens: null,
      rationale: selection.reason,
      flags: [],
    };
  }

  return {
    phase: "ideate",
    label: "Ideate",
    governedBy: "build-runtime",
    mechanism: "unsupported",
    engine,
    providerId: null,
    modelId: null,
    isLocal: null,
    providerTier: null,
    contextTokens: null,
    rationale: selection?.reason ?? "No Build Studio engine selection is available.",
    flags: [
      {
        severity: "error",
        code: "ideate-no-eligible-engine",
        message: "No allowed healthy engine can run Ideate.",
        remediation: selection?.action ?? "Restore one allowed engine in AI Readiness and retry.",
      },
    ],
  };
}

async function resolveBuildPhase(
  config: BuildStudioDispatchConfig,
): Promise<PhaseResolution> {
  const engine = buildEngineLabel(config.provider);
  const selection = config.selection;
  if (!selection || selection.status === "blocked" || !selection.selected) {
    return {
      phase: "build",
      label: "Build (code generation)",
      governedBy: "build-runtime",
      mechanism: "unsupported",
      engine,
      providerId: null,
      modelId: null,
      isLocal: null,
      providerTier: null,
      contextTokens: null,
      rationale: selection?.reason ?? "No Build Studio engine selection is available.",
      flags: [{
        severity: "error",
        code: "build-no-eligible-engine",
        message: "No allowed healthy engine can run the build phase.",
        remediation: selection?.action ?? "Restore one allowed engine in AI Readiness and retry.",
      }],
    };
  }

  if (config.provider === "opencode") {
    const flags: PhaseFlag[] = [];
    const providerId = config.opencodeProviderId || null;
    let modelId: string | null = config.opencodeModel || null;
    let contextTokens: number | null = null;
    try {
      const provider = providerId
        ? await prisma.modelProvider.findUnique({
            where: { providerId },
            select: { providerId: true, endpoint: true, baseUrl: true },
          })
        : null;
      const baseUrl = getOllamaBaseUrl(
        provider
          ? { providerId: provider.providerId, endpoint: provider.endpoint, baseUrl: provider.baseUrl }
          : null,
      );
      const pre = await preflightLocalEndpoint(baseUrl, config.opencodeModel || "");
      modelId = pre.resolvedModel ?? modelId ?? "(auto-detect at dispatch)";
      contextTokens = pre.reportedContextTokens;
      if (!pre.ok && pre.contextOk) {
        // ok=false for a reason OTHER than context (unreachable / no models / unknown model)
        flags.push({
          severity: "error",
          code: "local-endpoint-unhealthy",
          message: pre.reason ?? "Local model endpoint preflight failed.",
          remediation:
            "Check the local AI provider is running and serving a coding model, then retry.",
        });
      }
      if (!pre.contextOk && pre.reportedContextTokens !== null) {
        flags.push({
          severity: "error",
          code: "context-too-small",
          message: `The local model serves only ${pre.reportedContextTokens} context tokens — below the OpenCode floor of ${OPENCODE_MIN_CONTEXT_TOKENS}. Builds will truncate or fail.`,
          remediation:
            "Serve a longer-context coding model (e.g. qwen3-coder at ≥ 22k context) via the local provider / DMR.",
        });
      }
      if (pre.models.length > 0 && isLikelyNonChatModel(pre.models[0]!)) {
        // Informational, not a failure: when no model is pinned the build resolves
        // via pickDefaultCodingModel (opencode-dispatch.ts), which filters OUT
        // non-chat models and prefers a coder — so a leading embedding model is
        // auto-skipped, never selected for code generation. The served order is a
        // config nit worth surfacing, not a routing risk (BI-9AAE9C15).
        flags.push({
          severity: "info",
          code: "embedding-model-first",
          message: `The local endpoint lists a non-chat model ("${pre.models[0]}") first. The build auto-selects a coding model and skips non-chat models, so this is not a failure — pin the OpenCode model in Build Runtime to make the choice explicit.`,
          remediation:
            "Optional: pin the OpenCode model in Build Runtime, or reorder the served models so a coder model is first.",
        });
      }
    } catch (err) {
      flags.push({
        severity: "warning",
        code: "local-preflight-error",
        message: `Could not preflight the local endpoint: ${(err as Error).message}`,
        remediation: "Verify the local provider endpoint URL is reachable from the portal.",
      });
    }
    return {
      phase: "build",
      label: "Build (code generation)",
      governedBy: "dmr-serving",
      mechanism: "local-opencode",
      engine,
      providerId,
      modelId,
      isLocal: true,
      providerTier: "bundled",
      contextTokens,
      rationale: selection.reason,
      flags,
    };
  }

  return {
    phase: "build",
    label: "Build (code generation)",
    governedBy: "build-runtime",
    mechanism: selection.selected.engine === "agentic" ? "routed" : "vendor-cli",
    engine,
    providerId: selection.selected.providerId,
    modelId: selection.selected.modelId || "(provider default)",
    isLocal: selection.selected.local,
    providerTier: selection.selected.local ? "bundled" : "user_configured",
    contextTokens: null,
    rationale: selection.reason,
    flags: [],
  };
}

// ─── Top-level resolver ────────────────────────────────────────────────────────

const REASONING_PHASES: ReadonlySet<BuildPhaseId> = new Set([
  "ideate",
  "plan",
  "design-review",
  "plan-review",
]);

const SEVERITY_ORDER: Record<FlagSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/**
 * Resolve, per build phase, the provider+engine+model that WILL run given the
 * current Build Runtime + Providers & Routing + DMR configuration, and flag
 * where live config contradicts platform guidance.
 *
 * Read-only and side-effect-free: previewRoute does not dispatch, persist a
 * route decision, roll the challenger arm, or call any model.
 */
export async function resolveModelSelectionByPhase(): Promise<ModelSelectionOverview> {
  const config = await getBuildStudioConfig();
  const buildEngine = config.provider;

  const phases: PhaseResolution[] = [
    await resolveIdeatePhase(config),
    await resolveRoutedPhase({
      phase: "plan",
      label: "Plan",
      engine: "Portal routing",
      governedBy: "providers-routing",
      sample: REASONING_SAMPLE,
      opts: { budgetClass: "quality_first" },
    }),
    await resolveRoutedPhase({
      phase: "design-review",
      label: "Design review",
      engine: "Portal routing",
      governedBy: "providers-routing",
      sample: "Review a design document and return a structured verdict.",
      opts: { taskType: "analysis" },
    }),
    await resolveRoutedPhase({
      phase: "plan-review",
      label: "Plan review",
      engine: "Portal routing",
      governedBy: "providers-routing",
      sample: "Review an implementation plan and return a structured verdict.",
      opts: { taskType: "analysis" },
    }),
    await resolveBuildPhase(config),
  ];

  // Cross-phase mismatch: the headline blind spot. When the operator selected
  // the local build engine but a reasoning phase routes to cloud, the GPU sits
  // idle for that phase — exactly the failure this view exists to surface.
  if (buildEngine === "opencode") {
    for (const p of phases) {
      if (REASONING_PHASES.has(p.phase) && p.isLocal === false) {
        p.flags.push({
          severity: "error",
          code: "local-intent-cloud-reasoning",
          message: `Build Runtime is set to Local (OpenCode), but the ${p.label} phase routes to a cloud provider (${p.providerId ?? "unknown"}). Your local GPU sits idle for this phase.`,
          remediation:
            "Make the local model win routing for this phase in Providers & Routing — note a user-configured cloud provider always outranks the bundled local model — or accept that only the build phase runs locally.",
        });
      }
    }
  }

  // F10/F11: for any phase blocked with `no-eligible-endpoint`, name the
  // currently-off provider(s) whose capabilities would satisfy its routing
  // contract if enabled — so the operator gets a one-click action, not a dead
  // pointer. Candidate providers are loaded ONCE and scored per blocked phase.
  const blockedPhases = phases.filter(
    (p) => phaseContracts.has(p) && p.flags.some((f) => f.code === "no-eligible-endpoint"),
  );
  if (blockedPhases.length > 0) {
    try {
      const candidateProviders = await loadPhaseEnableCandidateProviders();
      if (candidateProviders.length > 0) {
        for (const p of blockedPhases) {
          const contract = phaseContracts.get(p)!;
          const cands = selectEnableCandidatesForContract(contract, candidateProviders);
          if (cands.length > 0) p.enableCandidates = cands;
        }
      }
    } catch {
      // Candidate discovery is best-effort; the text remediation still renders.
    }
  }

  const decided = phases.filter((p) => p.isLocal !== null);
  const localCount = decided.filter((p) => p.isLocal === true).length;
  const cloudCount = decided.filter((p) => p.isLocal === false).length;

  let verdict: RuntimeVerdict;
  if (decided.length === 0) verdict = "unconfigured";
  else if (cloudCount === 0) verdict = "all-local";
  else if (localCount === 0) verdict = "all-cloud";
  else verdict = "mixed";

  let summary: string;
  if (verdict === "unconfigured") {
    summary =
      "No AI providers resolved for any build phase — configure a provider to run builds.";
  } else if (verdict === "all-local") {
    summary = `All ${decided.length} resolved build phase(s) run on the local model.`;
  } else if (verdict === "all-cloud") {
    summary = `All ${decided.length} resolved build phase(s) route to cloud providers.`;
  } else {
    summary = `Mixed: ${localCount} phase(s) local, ${cloudCount} route to cloud.`;
    if (buildEngine === "opencode" && cloudCount > 0) {
      summary +=
        " Build runs local, but ideate / plan / reviews route to cloud — the GPU sits idle for reasoning.";
    }
  }

  const flags = phases
    .flatMap((p) => p.flags.map((f) => ({ ...f, phase: p.phase })))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const notes = [
    "Routed phases are predicted with previewRoute() — a side-effect-free dry-run of the same routeEndpointV2 the live build uses — so the predicted provider/model matches what will actually run.",
    "Stage-5b tier-sort (pipeline-v2.ts) ranks user-configured (cloud) endpoints ahead of bundled (local) ones, so on a mixed install a routed phase will pick cloud even when a local model is available.",
    "Build Runtime governs the build engine and the ideate engine; plan and both reviews always route via Providers & Routing. For claude/codex/grok the build phase still routes through the agentic loop — only Local (OpenCode) makes the build phase local.",
    "The served context window comes from the local endpoint's /v1/models (DMR serving config) and is invisible to both admin pages.",
  ];

  return {
    verdict,
    summary,
    buildEngine,
    buildEngineLabel: buildEngineLabel(buildEngine),
    phases,
    flags,
    notes,
    generatedAt: new Date().toISOString(),
  };
}
