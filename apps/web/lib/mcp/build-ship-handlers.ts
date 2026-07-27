// Build-ship tool handlers — BI-ARCH-TOOLPACKS.
//
// The two large ship-phase handlers (deploy_feature, create_portal_pr) for
// build-lifecycle-pack.ts, split into a sibling module so no single file
// exceeds the module-size cap. Each function reproduces its former
// mcp-tools.ts executeTool case verbatim — same lazy imports, same branches,
// same return shapes — so behaviour is identical over MCP.

import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import {
  resolveActiveBuildId,
  extractBuildIdHint,
  logBuildActivity,
} from "@/lib/mcp/build-tool-helpers";

export async function deployFeature(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      title: true,
      sandboxId: true,
      buildBranch: true,
      phase: true,
      createdById: true,
      portfolioId: true,
      brief: true,
      designDoc: true,
    },
  });
  if (!build || build.createdById !== userId) {
    return { success: false, error: "Build not found.", message: `No active build ${buildId} was found for this user.` };
  }
  if (!build?.sandboxId) return { success: false, error: "Sandbox not running.", message: "No sandbox." };
  // Invariant: buildBranch must be set once we're in build phase or later.
  // Its absence means startBuildBranch never ran — so the sandbox tree
  // is on whatever HEAD happened to be (client branch or baseline), and
  // any diff we extract will pick up leaked work from earlier builds.
  // Refuse to deploy until start_build runs and registers a buildBranch.
  if (!build.buildBranch) {
    return {
      success: false,
      error: "Build branch not initialized.",
      message: "This build has no buildBranch on record — start_build never completed. Run start_build to create and register build/<buildId>, then retry deploy_feature. Deploying without a build branch would include leaked changes from prior builds.",
    };
  }

  const { diagnoseSandboxReadiness } = await import("@/lib/integrate/sandbox/sandbox-admin");
  const { assertSandboxReadyForDeploy } = await import("@/lib/integrate/sandbox/sandbox-readiness-gate");
  const readiness = await diagnoseSandboxReadiness({ buildId });
  const readinessGate = assertSandboxReadyForDeploy(readiness);
  if (!readinessGate.ok) {
    logBuildActivity(buildId, "deploy_feature", readinessGate.message);
    return {
      success: false,
      error: "Sandbox readiness blocked deploy_feature.",
      message: readinessGate.message,
      data: { ...readiness },
    };
  }

  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true, gitRemoteUrl: true },
  });
  const { getPlatformDevPolicyState } = await import("@/lib/platform-dev-policy");
  const policyState = getPlatformDevPolicyState(devConfig);
  if (policyState === "policy_pending") {
    return {
      success: false,
      error: "Platform development policy not configured.",
      message:
        "Build Studio can keep editing and validating in the shared workspace, but production promotion stays blocked until Platform Development is configured in the portal. Go to Admin > Platform Development and choose whether this install stays private or can contribute upstream.",
    };
  }

  // Extract diff from sandbox. Pass clientBranch as the diff base so
  // committed work on the build branch (`git commit` from generate_code)
  // is captured — without the base ref, `git diff --cached` only sees
  // staged-but-uncommitted changes and returns empty for any build whose
  // agent committed before deploy_feature ran.
  const { extractAndCategorizeDiff, scanForDestructiveOps, isNowInWindow } = await import("@/lib/integrate/sandbox/sandbox-promotion");
  const { getClientIdentity } = await import("@/lib/integrate/sandbox/build-branch");
  const { clientBranch } = await getClientIdentity();
  const extracted = await extractAndCategorizeDiff(build.sandboxId, { baseRef: clientBranch });
  if (!extracted.fullDiff.trim()) {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { diffPatch: "", diffSummary: "" },
    });
    const noDiffMessage = "No releasable source changes were found in the sandbox. This build currently has only generated/cache churn or no real code changes, so release preparation cannot continue until implementation produces a real source diff.";
    logBuildActivity(buildId, "deploy_feature", noDiffMessage);
    return {
      success: false,
      error: "No releasable source changes found.",
      message: noDiffMessage,
      data: {
        diffLength: 0,
        codeFiles: 0,
        migrationFiles: 0,
      },
    };
  }

  // Guard: schema regression check.
  // If the diff removes existing fields/models from schema.prisma, the sandbox
  // was initialized from a stale portal image and this diff would silently
  // regress main's schema. Block deploy and surface the removed lines so the
  // operator knows what drifted.
  if (extracted.schemaRegressions.length > 0) {
    const regressionSample = extracted.schemaRegressions.slice(0, 10).join("\n");
    const regressionMessage =
      `Schema regression detected in sandbox diff — ${extracted.schemaRegressions.length} existing field(s) or model declaration(s) would be removed from packages/db/prisma/schema.prisma. ` +
      `This almost always means the sandbox was initialized from a portal image that predates recent schema changes on main. ` +
      `Rebuild the sandbox from a fresh image (Admin → Build Studio → Rebuild Sandbox) and re-run the build before deploying.\n\n` +
      `Removed lines (first 10):\n${regressionSample}`;
    logBuildActivity(buildId, "deploy_feature", regressionMessage);
    return {
      success: false,
      error: "Schema regression detected.",
      message: regressionMessage,
      data: {
        schemaRegressions: extracted.schemaRegressions,
        regressionCount: extracted.schemaRegressions.length,
      },
    };
  }

  // Capture commit hashes alongside the diff so the contribution flow
  // (which pushes build/<buildId> upstream) has the exact list of
  // commits being submitted. Without this, FB.gitCommitHashes stays
  // empty for committed-work builds and contribute_to_hive cannot
  // attribute the PR's commits back to specific FBs.
  const { listSandboxCommitsAheadOfBase } = await import("@/lib/integrate/sandbox/sandbox");
  const commitHashes = await listSandboxCommitsAheadOfBase(build.sandboxId, clientBranch);

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffPatch: extracted.fullDiff,
      diffSummary: extracted.fullDiff.slice(0, 500),
      gitCommitHashes: commitHashes,
    },
  });

  // Compute + cache the per-change disposition suggestion (EP-1A78BAE1) so
  // the ship UI / coworker can prefill Keep vs Share. The human still makes
  // the final call via set_change_disposition; this only pre-fills.
  // Non-fatal — a failed suggestion leaves the fail-closed default.
  try {
    const { suggestDisposition } = await import("@/lib/integrate/disposition");
    const { loadPrivatePathPatterns, compilePrivatePathMatcher, stripPrivatePathsFromDiff } =
      await import("@/lib/integrate/private-paths");
    const outboundEmpty = !stripPrivatePathsFromDiff(
      extracted.fullDiff,
      compilePrivatePathMatcher(await loadPrivatePathPatterns({ prisma })),
    ).kept.trim();
    let reusabilityScope: "one_off" | "parameterizable" | "already_generic" | null = null;
    const dd = build.designDoc as Record<string, unknown> | null;
    const reusability = dd?.reusabilityAnalysis as { scope?: string; contributionReadiness?: string } | undefined;
    const scope = reusability?.scope;
    if (scope === "one_off" || scope === "parameterizable" || scope === "already_generic") {
      reusabilityScope = scope;
    }
    let contributionReadiness: "high" | "medium" | "low" | null = null;
    if (
      reusability?.contributionReadiness === "high"
      || reusability?.contributionReadiness === "medium"
      || reusability?.contributionReadiness === "low"
    ) {
      contributionReadiness = reusability.contributionReadiness;
    }
    let orgSpecificHits = 0;
    try {
      const { runSanitizationScan } = await import("@/lib/integrate/contribution-review");
      const san = await runSanitizationScan(extracted.fullDiff);
      orgSpecificHits = san.mustFixCount;
    } catch { /* sanitization optional */ }
    let archetypeMarketFit: "high" | "medium" | "low" | "unknown" = "unknown";
    try {
      const { tagBusinessVerticals } = await import("@/lib/integrate/contribution-review");
      const verticals = await tagBusinessVerticals(build.brief as Record<string, unknown> | null, extracted.fullDiff);
      const primary = verticals.applicableVerticals.filter((vertical) => vertical.relevance === "primary").length;
      const applicable = verticals.applicableVerticals.filter((vertical) => vertical.relevance === "applicable").length;
      archetypeMarketFit = primary > 0 ? "high" : applicable > 0 ? "medium" : "low";
    } catch { /* vertical tagging optional */ }
    const titleAndBrief = `${build.title ?? ""} ${JSON.stringify(build.brief ?? {})}`;
    const projectViability = build.portfolioId
      ? /product|portfolio|lifecycle|taxonomy|backlog|compliance|operations|build studio|coworker|archetype|market/i.test(titleAndBrief)
        ? "high"
        : "medium"
      : "low";
    const confidence = dd?.reusabilityAnalysis && archetypeMarketFit !== "unknown" ? "high" : "medium";
    const suggestion = suggestDisposition({
      reusabilityScope,
      contributionReadiness,
      projectViability,
      archetypeMarketFit,
      confidence,
      orgSpecificHits,
      outboundEmpty,
    });
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        dispositionSuggested: suggestion.suggested,
        dispositionSuggestionReason: suggestion.reason,
        dispositionSource: "suggested",
      },
    });
    logBuildActivity(buildId, "deploy_feature", `disposition suggestion: ${suggestion.suggested} — ${suggestion.reason}`);
  } catch (err) {
    console.warn("[deploy_feature] disposition suggestion failed:", err);
  }

  // Scan migrations for destructive operations
  let destructiveWarnings: string[] = [];
  if (extracted.hasMigrations) {
    destructiveWarnings = scanForDestructiveOps(extracted.fullDiff);
  }

  // Check deployment window availability
  let windowStatus = "No business profile configured — deployment unrestricted.";
  try {
    const profile = await prisma.businessProfile.findFirst({
      where: { isActive: true },
      include: { deploymentWindows: true, blackoutPeriods: true },
    });
    if (profile) {
      const now = new Date();
      const activeBlackout = profile.blackoutPeriods.find(
        (bp) => bp.startAt <= now && bp.endAt >= now,
      );
      if (activeBlackout) {
        windowStatus = `Blackout active until ${activeBlackout.endAt.toISOString()}.`;
      } else {
        const matchingWindows = profile.deploymentWindows.filter(
          (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
        );
        if (matchingWindows.length > 0) {
          windowStatus = isNowInWindow(matchingWindows)
            ? "Deployment window is open now."
            : `Not in a deployment window. Available: ${matchingWindows.map((w) => `${w.name}: ${w.startTime}-${w.endTime}`).join("; ")}`;
        } else {
          windowStatus = "No deployment windows configured — deployment unrestricted.";
        }
      }
    }
  } catch {
    // Non-fatal — window check is advisory at this stage
  }

  // Run change impact analysis (EP-BUILD-HANDOFF-002 Phase 2b)
  let impactReport: Awaited<ReturnType<typeof import("@/lib/change-impact").analyzeChangeImpact>> | null = null;
  let impactSummary = "";
  try {
    const { analyzeChangeImpact, formatImpactForChat } = await import("@/lib/change-impact");
    impactReport = await analyzeChangeImpact(extracted.fullDiff);
    impactSummary = formatImpactForChat(impactReport);
  } catch (err) {
    console.warn("[deploy_feature] impact analysis failed:", err);
  }

  // Resolve approval authority (EP-BUILD-HANDOFF-002 Phase 2b)
  let authorityInfo = "";
  try {
    const { resolveApprovalAuthority, isCurrentUserTheAuthority, formatAuthorityForChat } = await import("@/lib/approval-authority");
    const riskLevel = impactReport?.riskLevel ?? "low";
    const authority = await resolveApprovalAuthority("deployment", "normal", riskLevel, userId);
    const isSelf = isCurrentUserTheAuthority(authority, userId);
    authorityInfo = formatAuthorityForChat(authority, isSelf);
  } catch (err) {
    console.warn("[deploy_feature] authority resolution failed:", err);
  }

  // Contribution mode awareness (EP-BUILD-HANDOFF-002 Phase 2e extension)
  let contributionModeInfo = "";
  try {
    const mode = devConfig?.contributionMode ?? "private";

    if ((mode === "private" || mode === "fork_only") && !devConfig?.gitRemoteUrl) {
      // Count untracked shipped features for escalating warning
      const untrackedCount = await prisma.featureBuild.count({
        where: { phase: "complete", gitCommitHashes: { isEmpty: true } },
      });

      if (untrackedCount >= 5) {
        contributionModeInfo = `**Warning:** You have ${untrackedCount} custom features with no backup. This represents significant business value that could be lost in a container rebuild, Docker update, or system recovery. Setting up a git repository takes about 10 minutes and protects all your customizations. See Admin > Platform Development.`;
      } else if (untrackedCount >= 2) {
        contributionModeInfo = `**Note:** You now have ${untrackedCount} custom features deployed without version control. If your Docker containers are rebuilt, these changes could be lost. I'd recommend setting up a git repository -- see Admin > Platform Development.`;
      } else if (untrackedCount >= 1) {
        contributionModeInfo = "Note: since no git repository is configured, customizations exist only in your production container. You can set up a repository in Admin > Platform Development to protect your work.";
      }
    }
  } catch (err) {
    console.warn("[deploy_feature] contribution mode check failed:", err);
  }

  const messageParts = [
    `Diff extracted: ${extracted.codeFiles.length} code file(s), ${extracted.migrationFiles.length} migration(s).`,
    windowStatus,
  ];
  if (destructiveWarnings.length > 0) {
    messageParts.push(`WARNING: ${destructiveWarnings.length} destructive operation(s) detected: ${destructiveWarnings.join("; ")}`);
  }
  if (impactSummary) {
    messageParts.push("", impactSummary);
  }
  if (authorityInfo) {
    messageParts.push("", authorityInfo);
  }
  if (contributionModeInfo) {
    messageParts.push("", contributionModeInfo);
  }

  logBuildActivity(buildId, "deploy_feature", messageParts.join(" "));

  return {
    success: true,
    message: messageParts.join("\n"),
    data: {
      diffLength: extracted.fullDiff.length,
      summary: extracted.fullDiff.slice(0, 500),
      codeFiles: extracted.codeFiles.length,
      migrationFiles: extracted.migrationFiles.length,
      destructiveWarnings,
      windowStatus,
      impactReport,
    },
  };
}

export async function createPortalPr(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true, title: true, diffPatch: true, buildBranch: true,
      description: true, gitCommitHashes: true, updatedAt: true, buildExecState: true,
      verificationOut: true, acceptanceMet: true, phase: true,
      designDoc: true, buildPlan: true,
      disposition: true, dispositionSuggestionReason: true,
      productVersions: {
        take: 1,
        orderBy: { shippedAt: "desc" },
        select: {
          id: true,
          promotions: { take: 1, orderBy: { createdAt: "desc" }, select: { promotionId: true, status: true } },
        },
      },
    },
  });
  if (!build) return { success: false, error: "Build not found.", message: "Build not found." };

  const diff = (build.diffPatch ?? "") as string;
  if (!diff.trim()) return { success: false, error: "No diff available.", message: "Run deploy_feature first to extract the diff." };

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
    logBuildActivity(buildId, "create_portal_pr", promotionGate.message);
    return {
      success: false,
      error: "Sandbox promotion integrity blocked PR creation.",
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

  // Resolve the portal's own repo from git remote
  let repoOwner: string | null = null;
  let repoName: string | null = null;
  try {
    const { getRemoteUrl } = await import("@/lib/git-utils");
    const remoteUrl = await getRemoteUrl();
    if (remoteUrl) {
      const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (match) { repoOwner = match[1]; repoName = match[2]; }
    }
  } catch { /* git may not be available */ }

  // Fallback to upstream URL if no local git
  if (!repoOwner) {
    const devConfig = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { upstreamRemoteUrl: true },
    });
    const url = devConfig?.upstreamRemoteUrl ?? "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git";
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
    if (match) { repoOwner = match[1]; repoName = match[2]; }
  }

  if (!repoOwner || !repoName) {
    return { success: false, error: "Cannot determine repository.", message: "No git remote or upstream URL configured." };
  }

  // Public-egress boundary (Private/Public Change Segregation): the
  // private/public filter applies ONLY when shipping to the PUBLIC hive. A
  // PR to the install's OWN repo is its private home and keeps the full
  // diff (proprietary paths included). This also closes the silent
  // fall-back-to-public leak — a customer's proprietary build never goes to
  // the canonical upstream unless that IS the configured target. Spec:
  // docs/superpowers/specs/2026-06-19-hive-contribution-architecture-and-egress-model.md
  let shareableDiff = diff;
  {
    const _egCfg = await prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { upstreamRemoteUrl: true },
    });
    const { classifyEgress } = await import("@/lib/integrate/contribution-egress");
    const egress = classifyEgress({ owner: repoOwner, repo: repoName }, _egCfg?.upstreamRemoteUrl);
    if (egress === "public-hive") {
      // Fail-closed disposition gate (EP-1A78BAE1): a public-hive PR may only
      // carry a change confirmed "shareable". Own-repo PRs skip this — that
      // is the install's private home.
      const { mayShareToPublicHive, privateDispositionBlockMessage } = await import("@/lib/integrate/disposition");
      if (!mayShareToPublicHive(build.disposition)) {
        logBuildActivity(buildId, "create_portal_pr", "blocked: change disposition is private (public-hive target)");
        return {
          success: false,
          error: "Change is kept private.",
          message: privateDispositionBlockMessage(build.dispositionSuggestionReason),
        };
      }
      const { loadPrivatePathPatterns, compilePrivatePathMatcher, stripPrivatePathsFromDiff } =
        await import("@/lib/integrate/private-paths");
      shareableDiff = stripPrivatePathsFromDiff(
        diff,
        compilePrivatePathMatcher(await loadPrivatePathPatterns({ prisma })),
      ).kept;
      if (!shareableDiff.trim()) {
        return {
          success: false,
          error: "Only private paths.",
          message:
            "This change only affects parts of your system you've marked private (see .dpf/private-paths or Admin > Platform Development), so there is nothing to share upstream.",
        };
      }
    }
  }

  // Resolve token
  const { resolveHiveToken, getPlatformIdentity, generatePrivateBranchName, generateAnonymousCommitMessage } = await import("@/lib/integrate/identity-privacy");
  const token = await resolveHiveToken();
  if (!token) {
    return { success: false, error: "No GitHub token available.", message: "Configure HIVE_CONTRIBUTION_TOKEN or a git credential to create PRs." };
  }

  // Run pre-PR gates
  const { runPrePRGates, formatGateReport } = await import("@/lib/integrate/pre-pr-gates");
  const gateResult = runPrePRGates(shareableDiff);

  // If gates block, return the report without creating a PR
  if (!gateResult.canProceed) {
    logBuildActivity(buildId, "create_portal_pr", `BLOCKED: ${gateResult.summary}`);
    return {
      success: false,
      error: "Pre-PR gates failed.",
      message: `The pre-PR security gates found blocking issues. Fix these before creating a PR.\n\n${formatGateReport(gateResult)}`,
      data: { gates: gateResult },
    };
  }

  // Build the PR
  const platformId = await getPlatformIdentity();
  const branchName = generatePrivateBranchName(platformId.clientId, build.title);

  const devConfigForDco = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { dcoAcceptedAt: true },
  });

  const commitMessage = generateAnonymousCommitMessage({
    title: build.title,
    buildId,
    productId: null,
    platformIdentity: platformId,
    dcoAcceptedAt: devConfigForDco?.dcoAcceptedAt ?? undefined,
  });

  // Build PR body with gate report and build evidence
  const verification = build.verificationOut as Record<string, unknown> | null;
  const typecheckPassed = verification?.typecheckPassed === true;
  const testsPassed = typeof verification?.testsPassed === "number" ? verification.testsPassed : 0;
  const testsFailed = typeof verification?.testsFailed === "number" ? verification.testsFailed : 0;

  // acceptanceMet (Json?) stores either a bare array or {acceptanceCriteria: [...]} — `.filter` must not assume array shape.
  const rawAcceptance = build.acceptanceMet as unknown;
  const acceptance: Array<{ met?: boolean }> = Array.isArray(rawAcceptance)
    ? (rawAcceptance as Array<{ met?: boolean }>)
    : rawAcceptance && typeof rawAcceptance === "object" && Array.isArray((rawAcceptance as { acceptanceCriteria?: unknown }).acceptanceCriteria)
      ? ((rawAcceptance as { acceptanceCriteria: Array<{ met?: boolean }> }).acceptanceCriteria)
      : [];
  const acMet = acceptance.filter((a) => a?.met === true).length;
  const acTotal = acceptance.length;

  const prBody = [
    `## ${build.title}`,
    "",
    `Build: \`${buildId}\` | Phase: \`${build.phase}\``,
    "",
    "### Verification",
    `- TypeCheck: ${typecheckPassed ? "PASSED" : "FAILED"}`,
    `- Tests: ${testsPassed} passed, ${testsFailed} failed`,
    `- Acceptance: ${acMet}/${acTotal} criteria met`,
    "",
    formatGateReport(gateResult),
    "",
    "---",
    `License: Apache-2.0 | ${platformId.dcoSignoff}`,
  ].join("\n");

  const prTitle = `feat(${buildId}): ${build.title}`;
  const labels = ["build-studio", "automated"];
  if (gateResult.requiresHumanReview) labels.push("needs-review");
  if (!typecheckPassed || testsFailed > 0) labels.push("verification-issues");

  const { createBranchAndPR, commentOnPR } = await import("@/lib/integrate/github-api-commit");

  const prResult = await createBranchAndPR({
    headOwner: repoOwner,
    headRepo: repoName,
    baseOwner: repoOwner,
    baseRepo: repoName,
    branchName,
    commitMessage,
    diff: shareableDiff,
    prTitle,
    prBody,
    labels,
    token,
  });

  if (!prResult.prUrl || !prResult.prNumber) {
    logBuildActivity(buildId, "create_portal_pr", `Branch created (${branchName}) but PR creation failed.`);
    return {
      success: false,
      error: "PR creation failed.",
      message: `Branch \`${branchName}\` was created with the commit, but the pull request could not be opened. Check GitHub permissions.`,
      data: { branchName, commitSha: prResult.commitSha },
    };
  }

  // Integration decision: all local gates pass + build fully verified. GitHub
  // remains authoritative for current-head checks, review threads, branch
  // freshness, and merge-queue policy. A PR merge is NOT deployment.
  const fullyVerified = typecheckPassed && testsFailed === 0 && acMet === acTotal && acTotal > 0;
  let deliveryState = "awaiting-review";
  try {
    const {
      initializeAndReconcileBuildPrDelivery,
    } = await import("@/lib/build/build-pr-delivery-reconciler");
    const outcome = await initializeAndReconcileBuildPrDelivery({
      db: prisma,
      featureBuildId: build.id,
      owner: repoOwner,
      repo: repoName,
      prNumber: prResult.prNumber,
      prUrl: prResult.prUrl,
      token,
      eligible: !gateResult.requiresHumanReview && fullyVerified,
    });
    deliveryState = outcome.state.status;
    logBuildActivity(
      buildId,
      "build-pr-delivery",
      `PR #${prResult.prNumber}: ${outcome.action?.kind ?? "withheld"}; delivery state ${outcome.state.status}; actuated=${outcome.actuated}; capsules=${outcome.captured}.`,
    );
  } catch (err) {
    deliveryState = "checking";
    logBuildActivity(
      buildId,
      "build-pr-delivery",
      `PR #${prResult.prNumber} recovery will retry after initial observation failed: ${String(err).slice(0, 180)}`,
    );
  }

  if (gateResult.requiresHumanReview || !fullyVerified) {
    // Needs human review — post gate report as comment
    const reasons: string[] = [];
    if (gateResult.requiresHumanReview) reasons.push("security gate warnings");
    if (!typecheckPassed) reasons.push("TypeCheck failed");
    if (testsFailed > 0) reasons.push(`${testsFailed} test(s) failed`);
    if (acMet < acTotal) reasons.push(`${acTotal - acMet} acceptance criteria not met`);

    await commentOnPR({
      owner: repoOwner, repo: repoName, prNumber: prResult.prNumber,
      body: `This PR requires human review: ${reasons.join(", ")}.\n\n${formatGateReport(gateResult)}`,
      token,
    }).catch(() => {});

    logBuildActivity(buildId, "create_portal_pr", `PR #${prResult.prNumber} created — needs review: ${reasons.join(", ")}`);
  }

  const statusMsg =
    !gateResult.requiresHumanReview && fullyVerified
      ? `PR #${prResult.prNumber} created. Delivery state: ${deliveryState}.`
      : `PR #${prResult.prNumber} created and awaiting review. ${gateResult.summary}`;

  return {
    success: true,
    message: `${statusMsg}\n\n${prResult.prUrl}`,
    data: {
      prUrl: prResult.prUrl,
      prNumber: prResult.prNumber,
      branchName,
      commitSha: prResult.commitSha,
      merged: false,
      deliveryState,
      gates: gateResult,
    },
  };
}
