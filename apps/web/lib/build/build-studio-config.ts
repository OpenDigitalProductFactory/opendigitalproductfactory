// apps/web/lib/build/build-studio-config.ts
// Reads Build Studio dispatch configuration from PlatformConfig DB table.
// Auto-resolves from configured providers when no explicit config exists.

import { prisma } from "@dpf/db";

import type { BuildModelTier } from "@/lib/explore/build-process-matrix";
import { DEFAULT_BUILD_POSTURE, coerceBuildPosture } from "@/lib/explore/build-rightsizing-dial";
import type { GoldenTrianglePreference } from "@/lib/golden-triangle/types";
import type { SensitivityLevel } from "@/lib/routing/types";
import { resolveCredentialProviderId } from "@/lib/inference/ai-provider-internals";
import type {
  BuildEngineId,
  BuildEnginePolicy,
  BuildEngineSelection,
} from "./build-engine-selection";
import { resolveBuildEngineSelection } from "./build-engine-selection-runtime";

export type BuildStudioDispatchConfig = {
  provider: BuildEngineId;
  /** Auto is the default. Pinned is an advanced, explicit no-fallback policy. */
  enginePolicy?: BuildEnginePolicy["mode"];
  pinnedEngine?: BuildEngineId | null;
  /** Live derived evidence; never treated as stored operator configuration. */
  selection?: BuildEngineSelection | null;
  claudeProviderId: string;
  codexProviderId: string;
  grokProviderId: string;
  opencodeProviderId: string;
  claudeModel: string;
  codexModel: string;
  grokModel: string;
  opencodeModel: string;
  /** BI-3E0EE3BA follow-up: the capability tier resolved for this build. "local"
   *  (trivial doc/chore) caps the per-task code-gen frontier floor at strong so
   *  the on-box coder is eligible during orchestration. */
  modelTier?: BuildModelTier;
};

const DEFAULTS: BuildStudioDispatchConfig = {
  provider: "agentic",   // placeholder until the Auto selector resolves live state
  enginePolicy: "auto",
  pinnedEngine: null,
  selection: null,
  claudeProviderId: "",
  codexProviderId: "",
  grokProviderId: "",
  opencodeProviderId: "",
  claudeModel: "sonnet",
  codexModel: "",
  grokModel: "",
  opencodeModel: "",     // resolved from the local provider's /v1/models at dispatch when empty
};

/**
 * Find the first configured provider for a given CLI engine.
 * Returns the providerId or empty string if none configured.
 */
async function findConfiguredProvider(cliEngine: string): Promise<string> {
  // Find providers tagged with this CLI engine
  const providers = await prisma.modelProvider.findMany({
    where: { cliEngine },
    select: { providerId: true, status: true, authMethod: true },
    orderBy: { providerId: "asc" },
  });

  if (providers.length === 0) return "";

  // Check which ones have working credentials
  for (const p of providers) {
    if (p.status !== "active") continue;
    // No-auth providers (local model endpoints: Docker Model Runner, Ollama) are
    // "configured" once active — they have no credential to gate on. This is the
    // path that lets a credential-free install auto-select the opencode runner.
    if (p.authMethod === "none") return p.providerId;
    const cred = await prisma.credentialEntry.findUnique({
      where: { providerId: resolveCredentialProviderId(p.providerId) },
      select: { status: true },
    });
    if (cred && (cred.status === "active" || cred.status === "pending" || cred.status === "configured")) {
      return p.providerId;
    }
  }
  return "";
}

/**
 * Discover configured engine/provider identifiers. The canonical router—not
 * discovery order—chooses the Auto winner.
 */
async function autoDetectConfig(): Promise<BuildStudioDispatchConfig> {
  const claudeId = await findConfiguredProvider("claude");
  const codexId = await findConfiguredProvider("codex");
  const grokId = await findConfiguredProvider("grok");
  const opencodeId = await findConfiguredProvider("opencode");

  // Auto is the policy. The provider field is only a resolved-runtime
  // projection, never an ordered static preference.
  let provider: BuildStudioDispatchConfig["provider"] = "agentic";
  let enginePolicy: BuildEnginePolicy["mode"] = "auto";
  let pinnedEngine: BuildEngineId | null = null;

  // Env var override
  const envProvider = process.env.CLI_DISPATCH_PROVIDER ?? process.env.CODEX_DISPATCH;
  if (envProvider === "claude" || envProvider === "codex" || envProvider === "grok" || envProvider === "opencode" || envProvider === "agentic" || envProvider === "false") {
    provider = envProvider === "false" ? "agentic" : envProvider;
    enginePolicy = "pinned";
    pinnedEngine = provider;
  }

  return {
    provider,
    enginePolicy,
    pinnedEngine,
    selection: null,
    claudeProviderId: process.env.CLAUDE_CODE_PROVIDER_ID ?? claudeId,
    codexProviderId: process.env.CODEX_PROVIDER_ID ?? codexId,
    grokProviderId: process.env.GROK_PROVIDER_ID ?? grokId,
    opencodeProviderId: process.env.OPENCODE_PROVIDER_ID ?? opencodeId,
    claudeModel: process.env.CLAUDE_CODE_MODEL ?? DEFAULTS.claudeModel,
    codexModel: process.env.CODEX_MODEL ?? DEFAULTS.codexModel,
    grokModel: process.env.GROK_MODEL ?? DEFAULTS.grokModel,
    opencodeModel: process.env.OPENCODE_MODEL ?? DEFAULTS.opencodeModel,
  };
}

async function resolveBaseBuildStudioConfig(): Promise<BuildStudioDispatchConfig> {
  // If explicit config exists, use it
  const row = await prisma.platformConfig.findUnique({
    where: { key: "build-studio-dispatch" },
  });
  if (row?.value && typeof row.value === "object") {
    const saved = row.value as Partial<BuildStudioDispatchConfig>;
    // Still auto-fill provider IDs if they were left empty
    const claudeId = saved.claudeProviderId || await findConfiguredProvider("claude");
    const codexId = saved.codexProviderId || await findConfiguredProvider("codex");
    const grokId = saved.grokProviderId || await findConfiguredProvider("grok");
    const opencodeId = saved.opencodeProviderId || await findConfiguredProvider("opencode");
    return {
      ...DEFAULTS,
      ...saved,
      // Legacy rows had only `provider`; they were ordinary setup choices, not
      // an explicit no-fallback contract. They converge to Auto. Only the new
      // enginePolicy="pinned" shape is a hard boundary.
      enginePolicy: saved.enginePolicy === "pinned" ? "pinned" : "auto",
      pinnedEngine: saved.enginePolicy === "pinned"
        ? (saved.pinnedEngine ?? saved.provider ?? null)
        : null,
      selection: null,
      claudeProviderId: claudeId,
      codexProviderId: codexId,
      grokProviderId: grokId,
      opencodeProviderId: opencodeId,
    };
  }

  // No explicit config — auto-detect from configured providers
  return autoDetectConfig();
}

// EP-27FD96BC · BI-9E0595E7 — activate the dormant Build Studio cost flags.
// The quality-first routing machinery (posture compiler + sensitivity floor +
// robust-engine fallback) is fully built; it was gated behind default-off env
// vars so it could merge inert. Activation makes it operator-governed and ON by
// default, driven by the evidence the machinery already reads (the golden-
// triangle posture, pinned to Quality) — not a hidden env var.
//
// Precedence, per flag: an explicit env var is the operator's emergency
// kill-switch/override (0/false → off, 1/true → on); otherwise the PlatformConfig
// row decides (explicit false → off), defaulting ON when absent. Fail-open to the
// default (on) mirrors getBuildGoldenTrianglePosture — a config read blip must not
// silently regress substantive builds back to the local tier.
export const BUILD_MODEL_TIER_ROUTING_KEY = "BUILD_MODEL_TIER_ROUTING";
export const BUILD_QUALITY_FIRST_RIGHTSIZING_KEY = "BUILD_QUALITY_FIRST_RIGHTSIZING";

/** Env override → PlatformConfig row → default. Pure except the injected config read. */
export function resolveActivationFlag(
  envValue: string | undefined,
  configValue: unknown,
  defaultOn = true,
): boolean {
  if (envValue === "0" || envValue === "false") return false;
  if (envValue === "1" || envValue === "true") return true;
  if (configValue === false || configValue === "false" || configValue === "0") return false;
  if (configValue === true || configValue === "true" || configValue === "1") return true;
  return defaultOn;
}

async function readPlatformFlag(key: string): Promise<unknown> {
  try {
    const cfg = await prisma.platformConfig.findUnique({ where: { key } });
    return cfg?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * EP-MODEL-TIER-ROUTING (activated by BI-9E0595E7): route large/xlarge builds to
 * the configured robust (frontier) provider. ON by default; an operator disables
 * it via the `BUILD_MODEL_TIER_ROUTING` PlatformConfig row or
 * `DPF_BUILD_MODEL_TIER_ROUTING=0`. Falls back to local when no robust engine is
 * configured, so a local-only install is unaffected.
 */
export async function isModelTierRoutingEnabled(): Promise<boolean> {
  return resolveActivationFlag(
    process.env.DPF_BUILD_MODEL_TIER_ROUTING,
    await readPlatformFlag(BUILD_MODEL_TIER_ROUTING_KEY),
  );
}

/**
 * EP-QUALITY-RIGHTSIZING (activated by BI-9E0595E7): route substantive work to the
 * robust tier by default (local only for the trivial doc/chore tail) and let a
 * HIGH-sensitivity deliverable escalate its build process regardless of size. ON
 * by default; disable via the `BUILD_QUALITY_FIRST_RIGHTSIZING` PlatformConfig row
 * or `DPF_BUILD_QUALITY_FIRST_RIGHTSIZING=0`. The tier decision is still only acted
 * on when a robust engine is configured (see isModelTierRoutingEnabled).
 */
export async function isQualityFirstRightsizingEnabled(): Promise<boolean> {
  return resolveActivationFlag(
    process.env.DPF_BUILD_QUALITY_FIRST_RIGHTSIZING,
    await readPlatformFlag(BUILD_QUALITY_FIRST_RIGHTSIZING_KEY),
  );
}

export const BUILD_EVIDENCE_AUTO_ACCEPT_KEY = "BUILD_EVIDENCE_AUTO_ACCEPT";

/**
 * Kernel decision DI-53037C92BC0A (evidence-auto-accept): the governed autopilot may
 * record build acceptance to clear the review→ship `acceptance-evaluated` gate, but
 * ONLY on fully-green evidence (typecheck clean, zero failing tests — stricter than
 * the human Record-Acceptance action, which ignores tests — and UX verification
 * complete/skipped). DEFAULT OFF: enabling autonomous acceptance is an operator
 * ratification, so this merges inert. Enable live (no restart) via the
 * `BUILD_EVIDENCE_AUTO_ACCEPT` PlatformConfig row, or `DPF_BUILD_EVIDENCE_AUTO_ACCEPT=1`
 * (env override / kill-switch). Note the inverted default vs the routing flags above:
 * fail-closed to OFF so a config-read blip never silently starts auto-accepting.
 */
export async function isEvidenceAutoAcceptEnabled(): Promise<boolean> {
  return resolveActivationFlag(
    process.env.DPF_BUILD_EVIDENCE_AUTO_ACCEPT,
    await readPlatformFlag(BUILD_EVIDENCE_AUTO_ACCEPT_KEY),
    false,
  );
}

/**
 * BI-269922A4 (EP-27FD96BC): verified-finding review — a reviewer's *critical*
 * finding may only BLOCK a gate (fail / trigger a rework round) after an
 * independent fresh-context verifier reproduces it; unreproduced criticals are
 * downgraded to advisory. Opt-in (default off) so it merges inert and adds no
 * verifier spend until an operator enables it. Set
 * DPF_BUILD_VERIFIED_FINDING_REVIEW=1 to turn it on.
 */
export function isVerifiedFindingReviewEnabled(): boolean {
  const v = process.env.DPF_BUILD_VERIFIED_FINDING_REVIEW;
  return v === "1" || v === "true";
}

/**
 * BI-F8C5E01C (EP-F7E35344): research-before-spec — a right-size-triggered
 * external deep-research pass (standards / prior art / pitfalls) attached to the
 * ideate evidence trail before the design is written. Opt-in (default off) so it
 * merges inert and incurs no web-search spend until an operator enables it and a
 * web-search provider (Brave) is configured. Set DPF_BUILD_PRE_SPEC_RESEARCH=1.
 */
export function isPreSpecResearchEnabled(): boolean {
  const v = process.env.DPF_BUILD_PRE_SPEC_RESEARCH;
  return v === "1" || v === "true";
}

/**
 * BI-D996C238 (EP-0AF96937): graduated gate autonomy — the WWMD build gate's
 * risk tier is derived from the deliverable's sensitivity (x transition) instead
 * of a fixed "medium", so a low-sensitivity advancement can clear on the ladder
 * while a high-sensitivity one always escalates. Opt-in (default off) so the
 * gate stays byte-identical (fixed medium) until an operator enables graduation.
 * Set DPF_BUILD_GRADUATED_GATE_AUTONOMY=1.
 */
export function isGraduatedGateAutonomyEnabled(): boolean {
  const v = process.env.DPF_BUILD_GRADUATED_GATE_AUTONOMY;
  return v === "1" || v === "true";
}

/**
 * BI-417AE8E9 (EP-27FD96BC): one-shot feature lane — a small/medium, low-
 * sensitivity feature/fix whose graduated gate auto-proceeds and whose oracles
 * are green takes a single-pass lane (skips multi-round deliberation) and
 * auto-ships. Opt-in (default off) so every build stays on the standard
 * multi-round lane until an operator enables it (and it composes the graduated
 * gate, DPF_BUILD_GRADUATED_GATE_AUTONOMY). Set DPF_BUILD_ONE_SHOT_LANE=1.
 */
export function isOneShotLaneEnabled(): boolean {
  const v = process.env.DPF_BUILD_ONE_SHOT_LANE;
  return v === "1" || v === "true";
}

export type AutonomousPlaybookMode = "off" | "shadow" | "enforce";

/**
 * Delivery 3 rollout control. The eligibility projection always remains
 * read-only; `shadow` records its decision while preserving the legacy human
 * seam, and `enforce` may actuate only an evidence-cleared projection. Existing
 * graduated/one-shot/auto-complete switches remain narrower emergency kills.
 */
export function getAutonomousPlaybookMode(
  env: Record<string, string | undefined> = process.env,
): AutonomousPlaybookMode {
  const value = env.DPF_BUILD_AUTONOMOUS_PLAYBOOK_MODE
    ?.trim()
    .toLowerCase();
  return value === "shadow" || value === "enforce" ? value : "off";
}

/** PlatformConfig key for the global build Cost/Quality/Time posture (P2). */
export const BUILD_GOLDEN_TRIANGLE_POSTURE_KEY = "BUILD_GOLDEN_TRIANGLE_POSTURE";

/**
 * EP-QUALITY-RIGHTSIZING P2 (BI-9AF9595A): the global default build posture — the
 * operator's Cost/Quality/Time dial for Build Studio. Stored migration-free in
 * PlatformConfig; absent/malformed → DEFAULT_BUILD_POSTURE (pinned to Quality).
 * Fail-open: any read error returns the Quality default rather than throwing.
 */
export async function getBuildGoldenTrianglePosture(): Promise<GoldenTrianglePreference> {
  try {
    const cfg = await prisma.platformConfig.findUnique({
      where: { key: BUILD_GOLDEN_TRIANGLE_POSTURE_KEY },
    });
    return coerceBuildPosture(cfg?.value) ?? DEFAULT_BUILD_POSTURE;
  } catch {
    return DEFAULT_BUILD_POSTURE;
  }
}

/**
 * Resolve Build Studio policy plus the live engine selected by the canonical
 * router. Every preview and dispatch caller consumes this same result.
 */
export async function getBuildStudioConfig(
  opts?: { modelTier?: BuildModelTier; sensitivity?: SensitivityLevel },
): Promise<BuildStudioDispatchConfig> {
  const base = await resolveBaseBuildStudioConfig();
  const policy: BuildEnginePolicy = base.enginePolicy === "pinned"
    ? { mode: "pinned", pinnedEngine: base.pinnedEngine ?? base.provider }
    : { mode: "auto", pinnedEngine: null };
  const selection = await resolveBuildEngineSelection(base, {
    policy,
    ...(opts?.modelTier ? { modelTier: opts.modelTier } : {}),
    ...(opts?.sensitivity ? { sensitivity: opts.sensitivity } : {}),
  });
  return {
    ...base,
    provider: selection.selected?.engine ?? policy.pinnedEngine ?? "agentic",
    enginePolicy: policy.mode,
    pinnedEngine: policy.pinnedEngine,
    selection,
    ...(opts?.modelTier ? { modelTier: opts.modelTier } : {}),
  };
}
