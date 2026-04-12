/**
 * PR-Based Contribution Pipeline — EP-BUILD-HANDOFF-002 Phase 2e
 *
 * Every code change goes through a pull request, never directly to main.
 * This applies to AI-generated code and human contributions equally.
 *
 * Two modes:
 *   - Development mode: PRs pushed to configured git remote (GitHub/GitLab)
 *   - Consumer mode: local-only review presented in AI Coworker chat
 */

import { prisma } from "@dpf/db";
import { scanDiffForSecurityIssues, formatScanForDisplay } from "@/lib/security-scan";
import type { ChangeImpactReport } from "@/lib/change-impact";
import type { SecurityScanResult } from "@/lib/security-scan";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PRContribution {
  mode: "remote" | "local";
  branchName: string;
  commitHash: string | null;
  prUrl: string | null;           // GitHub/GitLab PR URL (remote mode only)
  prNumber: number | null;
  securityScan: SecurityScanResult;
  impactReport: ChangeImpactReport | null;
  title: string;
  body: string;
  status: "open" | "review-pending" | "approved" | "merged" | "rejected";
}

interface SubmitBuildAsPRInput {
  buildId: string;
  title: string;
  diffPatch: string;
  productId: string | null;
  impactReport: ChangeImpactReport | null;
  authorUserId: string;
  authorName: string;
  forkRemoteUrl?: string;      // Push to this fork repo (user's gitRemoteUrl)
  upstreamRemoteUrl?: string;  // Create PR targeting this upstream repo
  dcoSignoff?: string;         // Signed-off-by line for DCO
}

// ─── Branch Name Generation ─────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function generateBranchName(buildId: string, title: string): string {
  return `build/${buildId}/${slugify(title)}`;
}

// ─── PR Body Generation ────────────────────────────────────────────────────

function generatePRBody(input: {
  buildId: string;
  productId: string | null;
  impactReport: ChangeImpactReport | null;
  securityScan: SecurityScanResult;
  authorName: string;
  acceptanceCriteria: string[];
  evidenceDigest: Record<string, string>;
  sourceVertical?: string;
  reusabilityScope?: string;
}): string {
  const sections: string[] = [];

  // Header
  sections.push("## Summary");
  sections.push("");
  sections.push(`Build: \`${input.buildId}\``);
  if (input.productId) sections.push(`Product: \`${input.productId}\``);
  sections.push(`Author: ${input.authorName} (AI Coworker)`);
  if (input.sourceVertical) sections.push(`Source vertical: \`${input.sourceVertical}\``);
  if (input.reusabilityScope) sections.push(`Reusability: \`${input.reusabilityScope}\``);
  sections.push("");

  // Impact Analysis
  if (input.impactReport) {
    sections.push("## Impact Analysis");
    sections.push("");
    sections.push(input.impactReport.summary);
    sections.push("");
  }

  // Security Scan
  sections.push("## Security Scan");
  sections.push("");
  sections.push(formatScanForDisplay(input.securityScan));
  sections.push("");

  // Acceptance Criteria
  if (input.acceptanceCriteria.length > 0) {
    sections.push("## Acceptance Criteria");
    sections.push("");
    for (const criterion of input.acceptanceCriteria) {
      sections.push(`- [ ] ${criterion}`);
    }
    sections.push("");
  }

  // Evidence Chain
  if (Object.keys(input.evidenceDigest).length > 0) {
    sections.push("## Evidence Chain");
    sections.push("");
    for (const [field, digest] of Object.entries(input.evidenceDigest)) {
      sections.push(`- **${field}**: ${digest}`);
    }
    sections.push("");
  }

  // Labels
  const labels: string[] = ["ai-contributed"];
  if (input.impactReport) {
    labels.push(`risk:${input.impactReport.riskLevel}`);
  }
  if (!input.securityScan.passed) {
    labels.push("security-review-needed");
  }
  sections.push("## Labels");
  sections.push("");
  sections.push(labels.map((l) => `\`${l}\``).join(" "));
  sections.push("");

  return sections.join("\n");
}

// ─── Commit Message Generation ──────────────────────────────────────────────

function generateCommitMessage(input: {
  title: string;
  buildId: string;
  productId: string | null;
  authorName: string;
  dcoSignoff?: string;
}): string {
  const lines = [
    `feat: ${input.title}`,
    "",
    `Build: ${input.buildId}`,
  ];
  if (input.productId) lines.push(`Product: ${input.productId}`);
  lines.push(`Author: ${input.authorName} (AI Coworker)`);
  lines.push("Change-Type: ai-proposed");
  if (input.dcoSignoff) lines.push("", input.dcoSignoff);
  return lines.join("\n");
}

// ─── GitHub API ─────────────────────────────────────────────────────────────

/**
 * Parse owner/repo from a git remote URL.
 * Supports both HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
function parseGitHubRepo(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

// PR creation is now handled by github-api-commit.ts (createBranchAndPR)

// ─── Main Entry Point ───────────────────────────────────────────────────────

/**
 * Submit a build as a PR contribution. Handles both remote (GitHub) and
 * local (consumer mode) flows.
 *
 * Flow:
 *   1. Run security scan on the diff
 *   2. Check if git remote is configured
 *   3a. Remote: create branch, apply diff, commit, push, create PR
 *   3b. Local: generate PR body for AI Coworker chat review
 *   4. Store contribution record on the build
 */
export async function submitBuildAsPR(
  input: SubmitBuildAsPRInput,
): Promise<PRContribution> {
  // 1. Run security scan
  const securityScan = scanDiffForSecurityIssues(input.diffPatch);

  // 2. Gather build evidence for PR body
  const build = await prisma.featureBuild.findUnique({
    where: { buildId: input.buildId },
    select: {
      acceptanceMet: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      verificationOut: true,
    },
  });

  const acceptanceCriteria: string[] = [];
  if (build?.acceptanceMet) {
    try {
      const parsed = typeof build.acceptanceMet === "string"
        ? JSON.parse(build.acceptanceMet)
        : build.acceptanceMet;
      if (Array.isArray(parsed)) {
        acceptanceCriteria.push(...parsed.map(String));
      }
    } catch { /* not parseable */ }
  }

  const evidenceDigest: Record<string, string> = {};
  if (build?.designDoc) evidenceDigest.designDoc = String(build.designDoc).slice(0, 200);
  if (build?.designReview) evidenceDigest.designReview = String(build.designReview).slice(0, 200);
  if (build?.buildPlan) evidenceDigest.buildPlan = String(build.buildPlan).slice(0, 200);
  if (build?.verificationOut) evidenceDigest.verificationOut = String(build.verificationOut).slice(0, 200);

  // Load business vertical context for PR body
  let sourceVertical: string | undefined;
  let reusabilityScope: string | undefined;
  try {
    const bc = await prisma.businessContext.findFirst({ select: { industry: true } });
    if (bc?.industry) sourceVertical = bc.industry;
    const designDoc = build?.designDoc as Record<string, unknown> | null;
    const reusability = designDoc?.reusabilityAnalysis as { scope?: string } | undefined;
    if (reusability?.scope) reusabilityScope = reusability.scope;
  } catch { /* non-fatal */ }

  const branchName = generateBranchName(input.buildId, input.title);
  const prTitle = `feat: ${input.title} (Build ${input.buildId})`;

  const prBody = generatePRBody({
    buildId: input.buildId,
    productId: input.productId,
    impactReport: input.impactReport,
    securityScan,
    authorName: input.authorName,
    acceptanceCriteria,
    evidenceDigest,
    sourceVertical,
    reusabilityScope,
  });

  // 3. Determine the best method to create the PR
  //
  // Priority:
  //   A. GitHub API (no local .git needed — works in Docker containers)
  //   B. Local git operations (legacy — requires .git directory)
  //   C. Local mode fallback (no PR, chat-only review)

  const token = process.env.GITHUB_TOKEN;

  // Resolve repository coordinates
  const forkUrl = input.forkRemoteUrl;
  const upstreamUrl = input.upstreamRemoteUrl;
  const forkRepo = forkUrl ? parseGitHubRepo(forkUrl) : null;
  const upstreamRepo = upstreamUrl ? parseGitHubRepo(upstreamUrl) : null;

  // If no explicit fork/upstream URLs, try the git remote
  let targetRepo = upstreamRepo ?? forkRepo;
  if (!targetRepo && token) {
    try {
      const { hasGitRemote, getRemoteUrl } = await import("@/lib/git-utils");
      if (await hasGitRemote()) {
        const remoteUrl = await getRemoteUrl();
        if (remoteUrl) targetRepo = parseGitHubRepo(remoteUrl);
      }
    } catch { /* git may not be available */ }
  }

  if (targetRepo && token) {
    // ─── GitHub API Mode: Create PR via REST API (no local git needed) ──
    const { createBranchAndPR, createCrossForkPR } = await import("@/lib/integrate/github-api-commit");

    const commitMessage = generateCommitMessage({
      title: input.title,
      buildId: input.buildId,
      productId: input.productId,
      authorName: input.authorName,
      dcoSignoff: input.dcoSignoff,
    });

    const labels = ["ai-contributed"];
    if (input.impactReport) labels.push(`risk:${input.impactReport.riskLevel}`);
    if (!securityScan.passed) labels.push("security-review-needed");

    try {
      let result;

      if (forkRepo && upstreamRepo) {
        // Cross-fork: commit to fork, PR targets upstream
        result = await createCrossForkPR({
          forkOwner: forkRepo.owner,
          forkRepo: forkRepo.repo,
          upstreamOwner: upstreamRepo.owner,
          upstreamRepo: upstreamRepo.repo,
          branchName,
          commitMessage,
          diff: input.diffPatch,
          prTitle,
          prBody,
          labels,
          token,
        });
      } else {
        // Same-repo: commit and PR on the same repo
        result = await createBranchAndPR({
          owner: targetRepo.owner,
          repo: targetRepo.repo,
          branchName,
          commitMessage,
          diff: input.diffPatch,
          prTitle,
          prBody,
          labels,
          token,
        });
      }

      return {
        mode: "remote" as const,
        branchName: result.branchName,
        commitHash: result.commitSha,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        securityScan,
        impactReport: input.impactReport,
        title: prTitle,
        body: prBody,
        status: "open" as const,
      };
    } catch (err) {
      console.warn("[contribution-pipeline] GitHub API PR creation failed:", err);
      return buildLocalContribution(branchName, prTitle, prBody, securityScan, input.impactReport,
        `GitHub API failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── Local Mode: Consumer mode fallback (no GitHub token or repo) ─────
  return buildLocalContribution(branchName, prTitle, prBody, securityScan, input.impactReport);
}

// ─── Local Contribution (Consumer Mode) ─────────────────────────────────────

function buildLocalContribution(
  branchName: string,
  title: string,
  body: string,
  securityScan: SecurityScanResult,
  impactReport: ChangeImpactReport | null,
  fallbackReason?: string,
): PRContribution {
  return {
    mode: "local",
    branchName,
    commitHash: null,
    prUrl: null,
    prNumber: null,
    securityScan,
    impactReport,
    title,
    body,
    status: "review-pending",
  };
}

// ─── Chat Display Formatting ────────────────────────────────────────────────

/**
 * Format a PR contribution for display in the AI Coworker chat.
 * Used in both remote mode (link to PR) and local mode (inline review).
 */
export function formatContributionForChat(pr: PRContribution): string {
  const lines: string[] = [];

  if (pr.mode === "remote" && pr.prUrl) {
    lines.push(`**Pull Request Created:** [${pr.title}](${pr.prUrl})`);
    lines.push("");
    lines.push(`Branch: \`${pr.branchName}\``);
    if (pr.prNumber) lines.push(`PR #${pr.prNumber}`);
    lines.push("");
    lines.push(formatScanForDisplay(pr.securityScan));
    lines.push("");
    lines.push("The PR is ready for review. Once approved and merged, the deployment will proceed automatically.");
  } else {
    // Local mode — present the full review inline
    lines.push("**Code Review Required** (no git remote configured)");
    lines.push("");
    lines.push(`Branch: \`${pr.branchName}\``);
    lines.push("");
    lines.push(formatScanForDisplay(pr.securityScan));
    lines.push("");
    if (pr.securityScan.passed) {
      lines.push("The security scan passed. Please review the changes below and approve to proceed with deployment.");
    } else {
      lines.push("**The security scan found critical issues.** Please review the findings before approving.");
    }
    lines.push("");
    lines.push("[Approve Changes] [Request Changes] [Reject]");
  }

  return lines.join("\n");
}
