// Contribution & hive tool pack — EP-8DC217EB BET-4.
//
// Drains the "contribute knowledge/feedback back to the platform" domain out of
// the mcp-tools.ts executeTool switch: the five tools a coworker uses to send
// work back upstream — assess whether a shipped feature should be contributed,
// package it as a FeaturePack and open the community PR, log employee feedback,
// and propose platform / skill improvements observed in a conversation. Each
// handler reproduces the former switch case verbatim, so behaviour is identical
// when a tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import {
  logBuildActivity,
  extractBuildIdHint,
  resolveActiveBuildId,
} from "@/lib/mcp/build-tool-helpers";
import { isLowSeverityReferenceDocProposal } from "@/lib/process-spine/reference-doc-promotion";
import {
  finalizeHiveContribution,
  reconcileHiveContributionDelivery,
} from "@/lib/mcp/contribution-hive-delivery";

const definitions: ToolDefinition[] = [
  {
    name: "assess_contribution",
    description: "Evaluate whether a shipped feature should be contributed to the Hive Mind community. Assesses vision alignment, community value, augmentation vs innovation, and proprietary sensitivity. Always presents the assessment to the user — contribution is their choice.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ship"],
  },
  {
    name: "contribute_to_hive",
    description: "Package a shipped feature as a FeaturePack for community contribution. Only call after the user has seen the assessment and explicitly approved. Includes DCO (Developer Certificate of Origin) attestation.",
    inputSchema: {
      type: "object",
      properties: {
        include_migrations: { type: "boolean", description: "Include database migrations in the pack. Default: true." },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "proposal",
    sideEffect: true,
    consequence: "outward",
    buildPhases: ["ship"],
    // 2-state model (EP-1A78BAE1): there is no mode-based pre-authorization.
    // Sharing is a per-change human-in-the-loop decision (the FeatureBuild
    // disposition, suggest-then-confirm). Until that disposition gate lands,
    // never auto-approve outbound contribution — fail closed to requiring the
    // human's final call.
    autoApproveWhen: async () => {
      return false;
    },
  },
  {
    name: "propose_improvement",
    description:
      "Propose a platform improvement based on friction or a missing capability observed in this conversation. " +
      "Available to ALL employees regardless of role — anyone can submit an idea. Auto-attributes to the current user.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title for the improvement (max 100 chars)" },
        description: { type: "string", description: "What should be improved and why" },
        category: {
          type: "string",
          enum: ["ux_friction", "missing_feature", "performance", "accessibility", "security", "process"],
          description: "Improvement category",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Impact severity (default: medium)",
        },
        observedFriction: { type: "string", description: "What you observed that prompted this suggestion" },
      },
      required: ["title", "description", "category"],
    },
    requiredCapability: null,
    executionMode: "proposal",
    sideEffect: true,
  },
  {
    name: "propose_skill_improvement",
    description:
      "Propose a content change to a specific coworker skill (e.g. tightening instructions, fixing a stale " +
      "reference). Use when you have observed the current skill prompt produce the wrong behavior and you can " +
      "draft a better version. Submits an ImprovementProposal(category='skill', targetSkillId=…) that a human " +
      "reviews on /platform/ai/skills.",
    inputSchema: {
      type: "object",
      properties: {
        skillId: {
          type: "string",
          description: "The SkillDefinition.skillId (business id) the proposal targets, e.g. 'build-page'.",
        },
        title: { type: "string", description: "Short title for the change (max 100 chars)" },
        description: { type: "string", description: "Why the change is needed; cite the friction or failure" },
        proposedContent: {
          type: "string",
          description: "Full proposed SKILL.md body (replaces the current content if approved)",
        },
        severity: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Impact severity (default: medium)",
        },
        observedFriction: {
          type: "string",
          description: "What you observed that prompted this change",
        },
      },
      required: ["skillId", "title", "description", "proposedContent"],
    },
    requiredCapability: null,
    executionMode: "proposal",
    sideEffect: true,
  },
  {
    name: "submit_feedback",
    description: "Log a feedback note for an employee (praise, constructive, or observation).",
    inputSchema: {
      type: "object",
      properties: {
        toEmployeeId: { type: "string", description: "Employee profile ID receiving feedback" },
        content: { type: "string", description: "Feedback content" },
        feedbackType: { type: "string", enum: ["praise", "constructive", "observation"], description: "Type of feedback" },
        visibility: { type: "string", enum: ["private", "shared", "public"], description: "Visibility (default: private)" },
      },
      required: ["toEmployeeId", "content", "feedbackType"],
    },
    requiredCapability: null,
    executionMode: "immediate",
  },
];

async function assessContributionHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      title: true, brief: true, buildPlan: true, diffPatch: true, diffSummary: true,
      phase: true, portfolioId: true, digitalProductId: true,
      verificationOut: true, sandboxId: true, designDoc: true,
    },
  });
  if (!build) return { success: false, error: "Build not found.", message: "Build not found." };

  const brief = build.brief as Record<string, unknown> | null;
  const diff = (build.diffPatch ?? build.diffSummary ?? "") as string;
  const designDoc = build.designDoc as Record<string, unknown> | null;
  const reusability = designDoc?.reusabilityAnalysis as { scope?: string; contributionReadiness?: string } | undefined;

  // Parse diff to understand scope
  const changedFiles = [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
  const newRoutes = changedFiles.filter((f) => f.includes("/app/") && f.endsWith("/page.tsx"));
  const schemaChanges = changedFiles.filter((f) => /prisma\/schema(\.prisma$|\/[^/]+\.prisma$)/.test(f));
  const migrationFiles = changedFiles.filter((f) => f.startsWith("prisma/migrations/"));
  const hasNewModels = diff.includes("model ") && diff.includes("@id");

  // ── Criterion 1: Vision Alignment ──
  const portfolioId = build.portfolioId ?? "unknown";
  const description = String(brief?.description ?? "");
  const isPortfolioAligned = !!build.portfolioId;
  const mentionsDPPM = /product|portfolio|lifecycle|taxonomy|backlog|compliance|operations/i.test(description);
  const visionScore = isPortfolioAligned && mentionsDPPM ? "high" : isPortfolioAligned ? "medium" : "low";
  const visionReasoning = visionScore === "high"
    ? `Aligned with portfolio ${portfolioId} and extends platform capabilities (${mentionsDPPM ? "touches DPPM concepts" : ""}).`
    : visionScore === "medium"
      ? `Assigned to portfolio ${portfolioId} but domain alignment is unclear from the description.`
      : "Not assigned to a portfolio — unclear how this connects to the platform vision.";

  // ── Criterion 2: Community Value ──
  const targetRoles = Array.isArray(brief?.targetRoles) ? brief.targetRoles : [];
  const broadRoles = targetRoles.length === 0 || targetRoles.includes("All") || targetRoles.length >= 3;
  const acceptanceCriteria = Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria : [];
  const isGeneral = !description.match(/\b(acme|our company|internal|proprietary|specific to)\b/i);
  let communityScore = broadRoles && isGeneral ? "high" : isGeneral ? "medium" : "low";

  // Enhance community value scoring with ideate-time reusability analysis
  if (reusability) {
    if (reusability.scope === "already_generic" || (reusability.scope === "parameterizable" && reusability.contributionReadiness === "high")) {
      communityScore = "high";
    } else if (reusability.scope === "parameterizable" && communityScore !== "high") {
      communityScore = "medium";
    }
    // one_off: leave existing heuristic scoring — user explicitly chose single-use
  }

  const communityReasoning = communityScore === "high"
    ? `Targets ${broadRoles ? "broad roles" : targetRoles.join(", ")} with ${acceptanceCriteria.length} general acceptance criteria.${reusability?.scope === "parameterizable" ? " Feature was designed with parameterization for reusability." : reusability?.scope === "already_generic" ? " Feature was designed as generic from the start." : ""}`
    : communityScore === "medium"
      ? `Targets specific roles (${targetRoles.join(", ")}) but the functionality appears generalizable.${reusability?.scope === "parameterizable" ? " Parameterization was planned but may need completion before contributing." : ""}`
      : "Contains organization-specific language or targets a narrow use case.";

  // ── Criterion 3: Augmentation vs Innovation ──
  const isAugmentation = newRoutes.length <= 1 && !hasNewModels;
  const augLevel = isAugmentation ? "augmentation" as const : "innovation" as const;
  const augReasoning = isAugmentation
    ? `Modifies ${changedFiles.length} existing files with ${newRoutes.length} new route(s). This augments existing capability — straightforward to merge.`
    : `Creates ${newRoutes.length} new route(s) and ${hasNewModels ? "new data models" : "significant structural changes"}. This is an innovation — benefits from community review before merging.`;

  // ── Criterion 4: Proprietary Sensitivity ──
  const concerns: string[] = [];
  // Only flag *assignments* of a secret-shaped identifier to a 20+ char opaque
  // string, or known secret token prefixes (GitHub / OpenAI / Slack / AWS / JWT).
  // The old bare-word match flagged benign identifiers like `scopeToken`,
  // `cancellationToken`, `accessTokenName`, `secretRef` — every round of
  // assess_contribution drowned in false positives.
  const secretAssignment = /[A-Za-z0-9_]*(api[_-]?key|apikey|secret|password|token)[A-Za-z0-9_]*\s*[:=]\s*["'`][A-Za-z0-9_\-+/.=]{20,}/i;
  const knownSecretPrefix = /(ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|ghu_[A-Za-z0-9]{20,}|ghs_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{15,}|AKIA[A-Z0-9]{16})/;
  if (secretAssignment.test(diff) || knownSecretPrefix.test(diff)) concerns.push("Contains references to API keys or secrets");
  if (/acme|our company|internal use only|confidential/i.test(diff)) concerns.push("Contains organization-specific references");
  if (/\$\d+[\d,.]*|pricing|rate.*card|margin/i.test(diff)) concerns.push("Contains pricing or financial constants");
  if (/customer.*name|client.*id|account.*number/i.test(diff)) concerns.push("Contains customer data references");
  const isSensitive = concerns.length > 0;

  const contributionSignals = await (await import("@/lib/mcp/contribution-assessment-signals")).deriveContributionAssessmentSignals({ brief, diff, reusability, projectViability: visionScore, orgSpecificHits: concerns.length, hasReusabilityAnalysis: !!designDoc?.reusabilityAnalysis });
  const dispositionRecommendation = contributionSignals.dispositionSuggestion.recommendation;
  const recommendation: "contribute" | "contribute_with_mods" | "keep_local" | "user_decides" = isSensitive
    ? concerns.length > 2 ? "keep_local" : "contribute_with_mods"
    : dispositionRecommendation === "share" ? "contribute"
      : dispositionRecommendation === "generalize_first" ? "contribute_with_mods"
        : visionScore === "low" && communityScore === "low" ? "keep_local" : "user_decides";

  const summaryMap = {
    contribute: `This feature looks great for the community. It extends ${build.title} within the ${portfolioId} portfolio and other organizations would benefit. Would you like to contribute it to the Hive Mind?`,
    contribute_with_mods: `This feature could benefit others, but I noticed some concerns: ${concerns.join("; ")}. If you'd like to contribute, I'd suggest removing organization-specific references first. Want me to prepare a cleaned version?`,
    keep_local: `This feature is well-built but it's ${isSensitive ? "contains sensitive content" : "specific to your organization"}. I'd recommend keeping it local. You can always contribute later if you generalize it.`,
    user_decides: `I see arguments both ways for contributing "${build.title}". Vision alignment: ${visionScore}. Community value: ${communityScore}. ${augLevel === "innovation" ? "This is an innovation that would benefit from review." : "This augments existing capability."} What would you prefer?`,
  };

  const assessment = {
    recommendation,
    criteria: {
      visionAlignment: { score: visionScore, reasoning: visionReasoning }, communityValue: { score: communityScore, reasoning: communityReasoning },
      archetypeMarketFit: { score: contributionSignals.archetypeMarketFit, reasoning: contributionSignals.archetypeMarketReasoning },
      augmentationLevel: { level: augLevel, reasoning: augReasoning },
      proprietarySensitivity: { sensitive: isSensitive, concerns },
    },
    dispositionSuggestion: contributionSignals.dispositionSuggestion,
    summary: summaryMap[recommendation],
    suggestedMods: isSensitive ? concerns.map((c) => `Remove: ${c}`) : [],
    filesChanged: changedFiles.length,
    newRoutes: newRoutes.length,
    hasSchemaChanges: schemaChanges.length > 0,
    hasMigrations: migrationFiles.length > 0,
  };

  // Persist assessment on build record
  await prisma.featureBuild.update({
    where: { buildId },
    data: { taskResults: { ...(build.verificationOut as Record<string, unknown> ?? {}), contributionAssessment: assessment } as unknown as import("@dpf/db").Prisma.InputJsonValue },
  });

  logBuildActivity(buildId, "assess_contribution", `Recommendation: ${recommendation}. Vision: ${visionScore}, Community: ${communityScore}, Type: ${augLevel}, Sensitive: ${isSensitive}`);

  return { success: true, message: assessment.summary, data: assessment };
}

async function contributeToHiveHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true, upstreamRemoteUrl: true, dcoAcceptedAt: true, gitRemoteUrl: true, hiveContributionsPaused: true },
  });
  const { getPlatformDevPolicyState } = await import("@/lib/platform-dev-policy");
  const policyState = getPlatformDevPolicyState(devConfig);
  if (policyState === "policy_pending") {
    return {
      success: false,
      error: "Platform development policy not configured.",
      message:
        "Contribution is blocked until Platform Development is configured in the portal. Finish that setup first, then decide whether this install stays private or contributes governed changes upstream.",
    };
  }
  if (devConfig?.contributionMode === "private" || devConfig?.contributionMode === "fork_only") {
    return {
      success: false,
      error: "Install is configured to keep everything on this system.",
      message:
        "This install keeps shipped work on your own system and does not contribute to the community. Switch to a contributing install in Admin > Platform Development if you want to share changes upstream.",
    };
  }

  // Master pause overrides every contribution type (see
  // packages/db/src/hive-contribution-settings.ts — "the master pause overrides
  // everything"). The source/improvement path must honor it the same way the
  // device-fingerprint (contribute-fingerprint.ts) and feedback-escalation paths
  // do; otherwise the Admin "Pause all contributions" toggle silently still ships
  // PRs upstream. Checked before any PR prerequisite work, like the per-type gate.
  if (devConfig?.hiveContributionsPaused) {
    return {
      success: false,
      error: "Hive contributions are paused.",
      message:
        "All contributions to the community are currently paused (Admin → Platform Development → Hive Contributions). Resume contributions there, then retry.",
    };
  }

  // Prerequisite checks for PR creation — fail loudly up front rather
  // than silently producing a FeaturePack with prUrl:null downstream.
  // Previously both conditions below gated the PR attempt inside a
  // try/catch at line ~4866 and a falsy result was swallowed: the tool
  // returned success:true with no prUrl, leaving the coworker claiming
  // "contributed" when no upstream PR ever landed.
  if (!devConfig?.dcoAcceptedAt) {
    return {
      success: false,
      error: "DCO not accepted.",
      message:
        "Upstream contributions require the Developer Certificate of Origin. Visit Admin > Platform Development and accept the DCO, then retry.",
    };
  }
  const { resolveHiveToken: resolveHiveTokenEarly } = await import("@/lib/build/identity-privacy");
  const hiveTokenEarly = await resolveHiveTokenEarly();
  if (!hiveTokenEarly) {
    return {
      success: false,
      error: "No GitHub token configured for hive contributions.",
      message:
        "Upstream contributions need a GitHub token. Set HIVE_CONTRIBUTION_TOKEN on the portal container, seed a 'hive-contribution' credential in admin, or fall back to GITHUB_TOKEN. Then retry.",
    };
  }

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true, title: true, brief: true, diffPatch: true, diffSummary: true,
      sandboxId: true, portfolioId: true, createdById: true,
      buildBranch: true, gitCommitHashes: true, updatedAt: true, buildPlan: true,
      description: true, designDoc: true, buildExecState: true,
      disposition: true, dispositionSuggestionReason: true,
      createdBy: { select: { email: true } },
    },
  });
  if (!build || build.createdById !== userId) {
    return { success: false, error: "Build not found.", message: `No active build ${buildId} was found for this user.` };
  }

  const { diagnoseSandboxReadiness } = await import("@/lib/build/sandbox/sandbox-admin");
  const { assertSandboxReadyForContribution } = await import("@/lib/build/sandbox/sandbox-readiness-gate");
  const readiness = await diagnoseSandboxReadiness({ buildId });
  const readinessGate = assertSandboxReadyForContribution(readiness);
  if (!readinessGate.ok) {
    logBuildActivity(buildId, "contribute_to_hive", readinessGate.message);
    return {
      success: false,
      error: "Sandbox readiness blocked contribution.",
      message: readinessGate.message,
      data: { ...readiness },
    };
  }

  const diff = (build.diffPatch ?? "") as string;
  if (!diff.trim()) return { success: false, error: "No diff available.", message: "Run deploy_feature first to extract the diff." };

  // Private-paths boundary (Phase 1 of Private/Public Change Segregation):
  // local records keep the full diff, but any OUTBOUND PR diff must never
  // carry a path the operator marked proprietary. The `.dpf/private-paths`
  // manifest ships empty → no-op until opted in. Spec:
  // docs/superpowers/specs/2026-06-18-private-public-change-segregation-design.md
  const { loadPrivatePathPatterns: _loadPriv, compilePrivatePathMatcher: _compilePriv, stripPrivatePathsFromDiff: _stripPriv } =
    await import("@/lib/build/private-paths");
  const shareableDiff = _stripPriv(diff, _compilePriv(await _loadPriv({ prisma }))).kept;
  if (!shareableDiff.trim()) {
    return {
      success: false,
      error: "Only private paths.",
      message:
        "This change only affects parts of your system you've marked private (see .dpf/private-paths or Admin > Platform Development), so there is nothing to share upstream.",
    };
  }

  // Fail-closed disposition gate (EP-1A78BAE1): contribute_to_hive is always
  // public-hive egress, so a change may leave only when explicitly
  // "shareable". Default "private" blocks — the human's confirmation (via
  // set_change_disposition / the ship UI) is required first.
  const { mayShareToPublicHive, privateDispositionBlockMessage } = await import("@/lib/build/disposition");
  if (!mayShareToPublicHive(build.disposition)) {
    logBuildActivity(buildId, "contribute_to_hive", "blocked: change disposition is private (not confirmed shareable)");
    return {
      success: false,
      error: "Change is kept private.",
      message: privateDispositionBlockMessage(build.dispositionSuggestionReason),
    };
  }

  const { buildSandboxStateFromRecord, assertSandboxReadyForPromotion, serializePlanDocument } = await import("@/lib/build/sandbox-state");
  const sandboxState = buildSandboxStateFromRecord({
    buildBranch: build.buildBranch,
    gitCommitHashes: build.gitCommitHashes,
    diffPatch: diff,
    updatedAt: build.updatedAt,
    planDocument: typeof build.buildPlan === "string" ? build.buildPlan : serializePlanDocument(build.buildPlan),
    description: build.description,
    buildExecState: build.buildExecState,
  });
  const promotionGate = assertSandboxReadyForPromotion(sandboxState);
  if (!promotionGate.ok) {
    logBuildActivity(buildId, "contribute_to_hive", promotionGate.message);
    return {
      success: false,
      error: "Sandbox promotion integrity blocked contribution.",
      message: `${promotionGate.message}\n\n${promotionGate.failures.join("\n")}`,
      data: {
        gate: {
          ok: false,
          failures: promotionGate.failures,
        },
        sandbox: promotionGate.state,
      },
    };
  }

  const includeMigrations = params.include_migrations !== false;
  const brief = build.brief as Record<string, unknown> | null;

  // Parse files from diff
  const { allFiles, seedFit, securityScan } = await (await import("@/lib/build/contribution-review")).analyzeContributionSeedFit(shareableDiff, brief, build.designDoc);
  const migrationFiles = allFiles.filter((f) => f.startsWith("prisma/migrations/"));
  const codeFiles = allFiles.filter((f) => !f.startsWith("prisma/migrations/"));
  const schemaFiles = allFiles.filter((f) => /prisma\/schema(\.prisma$|\/[^/]+\.prisma$)/.test(f));

  // Build manifest
  const manifest = {
    files: codeFiles,
    migrations: includeMigrations ? migrationFiles : [],
    schemaChanges: schemaFiles,
    totalFiles: includeMigrations ? allFiles.length : codeFiles.length,
    diffLength: diff.length,
    portfolioContext: build.portfolioId,
  };

  // DCO attestation — uses pseudonymous platform identity, not personal info.
  // Real user identity stays in the local DB only; public git metadata
  // shows "dpf-agent-<shortId> <agent-<shortId>@hive.dpf>" so the community
  // can recognize repeat contributors without exposing the real user.
  const { getPlatformIdentity } = await import("@/lib/build/identity-privacy");
  const platformId = await getPlatformIdentity();
  const dcoAttestation = platformId.dcoSignoff;

  // FeaturePack is upserted by buildId — NOT create-every-call.
  //
  // Two FeaturePack rows for the same build (with prUrl:null on both) was
  // the observed symptom of contribute_to_hive being invoked twice. The
  // old code created a fresh pack on each call; if the first call's PR
  // creation failed, the pack stayed with prUrl:null. A retry then made
  // a SECOND empty pack — and even when the retry's PR succeeded, its
  // back-write only touched the second pack's manifest. The first pack
  // was orphaned without its URL forever.
  //
  // Reusing the most recent pack for this build means:
  //   - first call: create, get prUrl, back-write the same row.
  //   - retry after failure: update the same row, try PR again; success
  //     back-writes prUrl onto the existing pack (idempotent).
  const existingPack = await prisma.featurePack.findFirst({
    where: { buildId: build.id },
    orderBy: { createdAt: "desc" },
    select: { packId: true },
  });
  const packId = existingPack?.packId ?? `FP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  if (existingPack) {
    await prisma.featurePack.update({
      where: { packId },
      data: {
        title: build.title,
        description: String(brief?.description ?? ""),
        portfolioContext: build.portfolioId,
        manifest: { ...manifest, dcoAttestation } as unknown as import("@dpf/db").Prisma.InputJsonValue,
        status: "contributed",
      },
    });
  } else {
    await prisma.featurePack.create({
      data: {
        packId,
        title: build.title,
        description: String(brief?.description ?? ""),
        portfolioContext: build.portfolioId,
        version: "1.0.0",
        manifest: { ...manifest, dcoAttestation } as unknown as import("@dpf/db").Prisma.InputJsonValue,
        buildId: build.id,
        status: "contributed",
      },
    });
  }

  // Create upstream PR via direct branch push (Option B).
  // Anonymous identity pushes dpf/<hash>/<slug> branch directly to the upstream repo.
  // No customer fork needed — the hive token provides write access.
  let prUrl: string | null = null;
  let prError: string | null = null;
  try {
    const upstreamUrl = devConfig?.upstreamRemoteUrl ?? "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";

    // DCO + token already validated up-front (see prerequisite checks
    // earlier in this case); reuse the resolved token so we don't hit
    // the credential store a second time.
    const { generatePrivateBranchName, generateAnonymousCommitMessage } = await import("@/lib/build/identity-privacy");
    const hiveToken = hiveTokenEarly;

    {
      const upstreamMatch = upstreamUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (!upstreamMatch) {
        prError = `upstreamRemoteUrl "${upstreamUrl}" is not a recognizable GitHub URL.`;
      } else {
        const { createBranchAndPR } = await import("@/lib/build/github-api-commit");

        const branchName = generatePrivateBranchName(platformId.clientId, build.title);
        const commitMessage = generateAnonymousCommitMessage({
          title: build.title,
          buildId,
          productId: null,
          platformIdentity: platformId,
          dcoAcceptedAt: devConfig!.dcoAcceptedAt!,
        });

        const prTitle = `feat: ${build.title}`;
        const prBody = [
          "## Summary",
          "",
          `Build: \`${buildId}\``,
          `Author: ${platformId.authorName} (AI Coworker)`,
          "",
          `**Security Scan:** ${securityScan.passed ? "PASSED" : "FAILED"} (${securityScan.criticalCount} critical, ${securityScan.warningCount} warnings)`,
          "",
          `Files: ${manifest.totalFiles} | Migrations: ${manifest.migrations.length} | Schema changes: ${manifest.schemaChanges.length}`,
          "",
          "---",
          `License: Apache-2.0 (inbound=outbound)`,
          `${platformId.dcoSignoff}${seedFit.decision ? `\n\nSeed-Fit-Decision: ${seedFit.decision}` : ""}`,
        ].join("\n");

        const labels = ["ai-contributed", "build-studio", ...(seedFit.decision ? [`seed-fit:${seedFit.decision}`] : [])];
        if (!securityScan.passed) labels.push("security-review-needed");

        const prResult = await createBranchAndPR({
          // Phase 3: caller still passes head === base. Phase 4 will switch
          // to head = contributor fork / base = upstream when
          // contributionModel === "fork-pr".
          headOwner: upstreamMatch[1],
          headRepo: upstreamMatch[2],
          baseOwner: upstreamMatch[1],
          baseRepo: upstreamMatch[2],
          branchName,
          commitMessage,
          diff: shareableDiff,
          prTitle,
          prBody,
          labels,
          token: hiveToken,
        });

        if (prResult.prUrl) {
          prUrl = prResult.prUrl;
          await prisma.featurePack.update({
            where: { packId },
            data: { manifest: { ...manifest, dcoAttestation, prUrl } as unknown as import("@dpf/db").Prisma.InputJsonValue },
          });

          // Run contribution review pipeline — sanitization, parameterization, vertical tagging
          if (prResult.prNumber) {
            try {
              const { runContributionReview } = await import("@/lib/build/contribution-review");
              const reviewResult = await runContributionReview({
                buildId,
                prUrl: prResult.prUrl!,
                prNumber: prResult.prNumber,
                repoOwner: upstreamMatch[1],
                repoName: upstreamMatch[2],
                token: hiveToken,
                diff: shareableDiff,
              });
              logBuildActivity(buildId, "contribution_review", `Merge readiness: ${reviewResult.mergeReadiness}. Seed fit: ${reviewResult.seedFit.decision ?? "not-applicable"}. Verticals: ${reviewResult.verticals.applicableVerticals.filter((v) => v.relevance !== "unlikely").map((v) => v.category).join(", ") || "none"}`);
            } catch (reviewErr) {
              console.warn("[contribute_to_hive] contribution review failed:", reviewErr);
              prError = `Contribution review failed: ${getErrorMessage(reviewErr)}`;
            }
          }
        } else {
          prError = `createBranchAndPR returned no prUrl (owner=${upstreamMatch[1]} repo=${upstreamMatch[2]} branch=${branchName}).`;
        }
      }
    }
  } catch (err) {
    prError = getErrorMessage(err);
    console.warn("[contribute_to_hive] upstream PR creation failed:", err);
  }

  await reconcileHiveContributionDelivery({
    buildId,
    prUrl,
    token: hiveTokenEarly,
    eligible: securityScan.passed && !prError,
  });
  await finalizeHiveContribution({
    buildId,
    packId,
    prUrl,
    prError,
    totalFiles: manifest.totalFiles,
    dcoAttestation,
  });

  if (!prUrl) {
    return {
      success: false,
      error: prError ?? "Upstream PR creation failed.",
      message: `Feature Pack ${packId} was created locally but the upstream pull request could not be opened: ${prError ?? "unknown error"}. Review the token, DCO, and upstream URL and retry.`,
      data: { packId, manifest, dcoAttestation, prUrl: null, prError },
    };
  }

  const prMessage = ` A pull request has been created: ${prUrl}`;
  return {
    success: true,
    message: `Feature Pack ${packId} created and contributed to the Hive Mind. ${manifest.totalFiles} file(s) packaged with DCO attestation.${prMessage} Thank you for contributing!`,
    data: { packId, manifest, dcoAttestation, prUrl },
  };
}

async function proposeImprovementHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  const proposalId = `IP-${crypto.randomUUID().slice(0, 5).toUpperCase()}`;

  // Capture conversation excerpt (last 5 messages) for evidence
  let conversationExcerpt: string | null = null;
  if (context?.threadId) {
    const recentMessages = await prisma.agentMessage.findMany({
      where: { threadId: context.threadId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { role: true, content: true },
    });
    if (recentMessages.length > 0) {
      conversationExcerpt = recentMessages
        .reverse()
        .map((m) => `[${m.role}] ${m.content?.slice(0, 200)}`)
        .join("\n");
    }
  }

  const category = String(params["category"] ?? "missing_feature");
  const proposal = await prisma.improvementProposal.create({
    data: {
      proposalId,
      title: String(params["title"] ?? "Untitled improvement"),
      description: String(params["description"] ?? ""),
      category,
      severity: String(params["severity"] ?? "medium"),
      observedFriction: typeof params["observedFriction"] === "string" ? params["observedFriction"] : null,
      conversationExcerpt,
      submittedById: userId,
      agentId: context?.agentId ?? "unknown",
      routeContext: context?.routeContext ?? "unknown",
      threadId: context?.threadId ?? null,
    },
  });

  // Consolidation (EP-INTAKE-UNIFY / BI-7541AB88): file the work into the
  // backlog the moment the proposal exists, so it is visible and triageable
  // without the old manual Review→Prioritize promotion that never happened.
  // The proposal stays the evidence record; the BacklogItem is the work.
  //
  // Gate (BI-18685188): low-severity [reference-doc] doc-polish proposals are
  // withheld from the backlog here, mirroring the reconcile-path exclusion, so
  // the scanner's recurring doc-suggestion batch never inflates the backlog at
  // creation. They remain as ImprovementProposal rows (backlogItemId null) for
  // founder review. medium/high reference-doc + all other proposals still file.
  let backlogItemId: string | null = null;
  const autoFileSuppressed = isLowSeverityReferenceDocProposal({
    title: proposal.title,
    severity: proposal.severity,
  });
  if (!autoFileSuppressed) {
    try {
      const { ingestBacklogItem, improvementCategoryToWorkType } = await import(
        "@/lib/operate/backlog-ingest"
      );
      const ingest = await ingestBacklogItem({
        title: proposal.title,
        body: [
          proposal.description,
          proposal.observedFriction ? `Observed friction: ${proposal.observedFriction}` : null,
          `Category: ${category} | Severity: ${proposal.severity}`,
          `From improvement proposal ${proposal.proposalId}`,
        ]
          .filter(Boolean)
          .join("\n"),
        workType: improvementCategoryToWorkType(category),
        source: "automated-detection",
        itemIdPrefix: "IMP",
        submittedById: userId,
        agentId: context?.agentId ?? null,
        origin: { kind: "improvement", id: proposal.proposalId },
      });
      backlogItemId = ingest.itemId;
      await prisma.improvementProposal.update({
        where: { proposalId: proposal.proposalId },
        data: { backlogItemId },
      });
    } catch (err) {
      // Non-fatal: the proposal is still recorded even if the backlog projection fails.
      console.error("[propose_improvement] backlog auto-file failed", err);
    }
  }

  // Index the proposal in platform knowledge (was previously unreachable
  // dead code after the return).
  import("@/lib/semantic-memory")
    .then(({ storePlatformKnowledge }) =>
      storePlatformKnowledge({
        entityId: proposal.proposalId,
        entityType: "improvement",
        title: proposal.title,
        content: String(params["description"] ?? ""),
      }),
    )
    .catch(() => {});

  return {
    success: true,
    entityId: proposal.proposalId,
    message: backlogItemId
      ? `Improvement proposal ${proposal.proposalId} created and filed to the backlog as ${backlogItemId} for triage.`
      : autoFileSuppressed
        ? `Improvement proposal ${proposal.proposalId} created: "${proposal.title}". Kept in the Improvements view for founder review; low-severity [reference-doc] suggestions are not auto-filed to the backlog (BI-18685188).`
        : `Improvement proposal ${proposal.proposalId} created: "${proposal.title}".`,
  };
}

async function proposeSkillImprovementHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string; threadId?: string; agentId?: string },
): Promise<ToolResult> {
  const skillId = String(params["skillId"] ?? "").trim();
  const proposedContent = String(params["proposedContent"] ?? "").trim();
  const title = String(params["title"] ?? "").trim();
  const description = String(params["description"] ?? "").trim();
  if (!skillId || !proposedContent || !title || !description) {
    return {
      success: false,
      error: "Missing required fields",
      message:
        "propose_skill_improvement requires skillId, title, description, and proposedContent.",
    };
  }
  const sev = String(params["severity"] ?? "medium");
  const severity = (["low", "medium", "high", "critical"].includes(sev) ? sev : "medium") as
    | "low"
    | "medium"
    | "high"
    | "critical";
  const observedFriction =
    typeof params["observedFriction"] === "string" ? params["observedFriction"] : null;
  try {
    const { submitSkillImprovementProposal } = await import("@/lib/skills/proposals");
    const result = await submitSkillImprovementProposal({
      skillId,
      proposedContent,
      title,
      description,
      severity,
      submittedById: userId,
      agentId: context?.agentId ?? "unknown",
      routeContext: context?.routeContext ?? "unknown",
      threadId: context?.threadId ?? null,
      observedFriction,
    });
    return {
      success: true,
      entityId: result.proposalId,
      message: `Skill proposal ${result.proposalId} created for ${skillId}. A reviewer must approve before it takes effect.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return {
      success: false,
      error: msg,
      message: `Could not create skill proposal: ${msg}`,
    };
  }
}

async function submitFeedbackHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
  const fromProfile = await prisma.employeeProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!fromProfile) return { success: false, error: "Your employee profile not found", message: "Cannot submit feedback without an employee profile" };

  const feedbackId = `FB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await prisma.feedbackNote.create({
    data: {
      feedbackId,
      fromEmployeeId: fromProfile.id,
      toEmployeeId: String(params["toEmployeeId"]),
      content: String(params["content"]),
      feedbackType: String(params["feedbackType"] ?? "observation"),
      visibility: String(params["visibility"] ?? "private"),
    },
  });
  return {
    success: true,
    entityId: feedbackId,
    message: "Feedback submitted.",
  };
}

const handlers: Record<string, ToolPackHandler> = {
  assess_contribution: (params, userId) => assessContributionHandler(params, userId),
  contribute_to_hive: (params, userId) => contributeToHiveHandler(params, userId),
  propose_improvement: (params, userId, context) => proposeImprovementHandler(params, userId, context),
  propose_skill_improvement: (params, userId, context) => proposeSkillImprovementHandler(params, userId, context),
  submit_feedback: (params, userId) => submitFeedbackHandler(params, userId),
};

export const contributionHivePack: ToolPack = {
  packId: "contribution-hive",
  definitions,
  handlers,
  grants: {
    assess_contribution: ["backlog_read"],
    contribute_to_hive: ["backlog_write"],
    submit_feedback: ["backlog_write"],
    propose_improvement: ["decision_record_create"],
    propose_skill_improvement: ["decision_record_create"],
  },
};
