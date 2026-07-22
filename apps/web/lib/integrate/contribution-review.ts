/**
 * Contribution Review Pipeline — PR-triggered quality gate
 *
 * When contribute_to_hive creates a PR, this pipeline runs automatically:
 *   1. Sanitization scan (org-specific content detection)
 *   2. Parameterization verification (did ideate promises get fulfilled?)
 *   3. Business vertical tagging (which archetype categories benefit?)
 *   4. Review report generation (structured markdown)
 *   5. Post report as PR comment (GitHub API)
 *   6. Set PR labels + commit status check (GitHub API)
 *   7. Update FeaturePack with review results
 *
 * The report is what the repo owner reviews — not the raw diff.
 */

import { prisma } from "@dpf/db";
import { scanDiffForSecurityIssues } from "./security-scan";
import {
  buildContributionSeedDeltaManifest,
  evaluateSeedContributionFit,
  formatSeedContributionFitMarkdown,
  type SeedContributionFitReport,
} from "./seed-contribution-fit";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SanitizationFinding = {
  file: string;
  line: number;
  type: "org-reference" | "hardcoded-pricing" | "customer-data" | "instance-url" | "domain-specific";
  original: string;
  suggestedReplacement: string | null;
  severity: "must-fix" | "review" | "info";
};

export type SanitizationReport = {
  passed: boolean;
  findings: SanitizationFinding[];
  orgName: string;
  mustFixCount: number;
  reviewCount: number;
};

export type ParameterizationCheck = {
  entity: string;
  parameterName: string;
  hardcodedInDiff: boolean;
  parameterized: boolean;
  verdict: "pass" | "fail" | "not-applicable";
};

export type ParameterizationReport = {
  scope: "one_off" | "parameterizable" | "already_generic";
  checks: ParameterizationCheck[];
  overallVerdict: "pass" | "partial" | "fail";
};

export type VerticalApplicability = {
  category: string;
  label: string;
  relevance: "primary" | "applicable" | "unlikely";
  reasoning: string;
};

export type VerticalReport = {
  sourceVertical: string;
  applicableVerticals: VerticalApplicability[];
};

type ReusabilityAnalysis = {
  scope?: string;
  domainEntities?: Array<{ hardcodedValue: string; parameterName: string }>;
  contributionReadiness?: string;
};

export type MergeReadiness = "ready" | "needs-work" | "blocked";

export type ContributionReviewResult = {
  mergeReadiness: MergeReadiness;
  sanitization: SanitizationReport;
  parameterization: ParameterizationReport;
  verticals: VerticalReport;
  seedFit: SeedContributionFitReport;
  securityPassed: boolean;
  evidenceChain: Record<string, string>;
  reviewedAt: string;
};

export function determineContributionMergeReadiness(input: {
  securityPassed: boolean;
  sanitization: SanitizationReport;
  parameterization: ParameterizationReport;
  seedFit: SeedContributionFitReport;
}): MergeReadiness {
  if (!input.securityPassed) return "blocked";
  if (!input.sanitization.passed || input.parameterization.overallVerdict === "fail") {
    return "needs-work";
  }
  if (input.seedFit.touchesSeededContent && !input.seedFit.mergeEligible) {
    return input.seedFit.decision === "reject-as-seed" ? "blocked" : "needs-work";
  }
  return "ready";
}

type ReviewInput = {
  buildId: string;
  prUrl: string;
  prNumber: number;
  repoOwner: string;
  repoName: string;
  token: string;
  diff: string;
};

// ─── Vertical Category Catalog ──────────────────────────────────────────────

const VERTICAL_CATEGORIES = [
  { value: "healthcare-wellness", label: "Healthcare & Wellness", keywords: ["health", "medical", "patient", "clinic", "doctor", "wellness", "therapy", "dental", "physiotherapy", "counseling", "veterinary", "vet"] },
  { value: "beauty-personal-care", label: "Beauty & Personal Care", keywords: ["beauty", "salon", "hair", "spa", "barber", "nails", "skincare", "cosmetic"] },
  { value: "trades-maintenance", label: "Trades & Maintenance", keywords: ["plumber", "electrician", "hvac", "cleaning", "landscaping", "repair", "maintenance", "contractor", "trade"] },
  { value: "professional-services", label: "Professional Services", keywords: ["consulting", "legal", "accounting", "marketing", "it", "managed", "advisory", "agency"] },
  { value: "education-training", label: "Education & Training", keywords: ["course", "training", "tutoring", "school", "education", "learning", "workshop", "certification"] },
  { value: "pet-services", label: "Pet Services", keywords: ["pet", "dog", "cat", "grooming", "boarding", "kennel", "animal", "veterinary"] },
  { value: "food-hospitality", label: "Food & Hospitality", keywords: ["restaurant", "cafe", "catering", "bakery", "food", "menu", "dining", "hospitality", "bar"] },
  { value: "retail-goods", label: "Retail & Goods", keywords: ["retail", "shop", "store", "product", "merchandise", "ecommerce", "inventory", "goods"] },
  { value: "fitness-recreation", label: "Fitness & Recreation", keywords: ["fitness", "gym", "yoga", "pilates", "sports", "recreation", "membership", "class"] },
  { value: "nonprofit-community", label: "Nonprofit & Community", keywords: ["nonprofit", "charity", "donation", "volunteer", "community", "cause", "fundraising"] },
  { value: "hoa-property-management", label: "HOA & Property Management", keywords: ["hoa", "property", "tenant", "landlord", "rental", "lease", "building", "apartment"] },
  { value: "banking-financial-services", label: "Banking & Financial Services", keywords: ["bank", "banking", "credit union", "deposit", "loan", "mortgage", "lending", "bian", "member", "branch", "underwriting"] },
  { value: "media-production", label: "Media & Production", keywords: ["film", "video", "production", "commercial", "post-production", "vfx", "editing", "studio", "crew", "staging", "av", "documentary"] },
  { value: "live-events-venues", label: "Live Events & Venues", keywords: ["venue", "ticket", "box office", "concert", "tour", "promoter", "booking", "talent", "festival", "theatre", "gig", "event"] },
  { value: "warehousing-fulfilment", label: "Warehousing & Fulfilment", keywords: ["warehouse", "warehousing", "3pl", "fulfilment", "fulfillment", "pick and pack", "pallet", "inventory", "stock", "putaway", "cross-dock", "cold storage", "sscc", "asn", "wms", "despatch"] },
  { value: "fabric-care-services", label: "Fabric Care Services", keywords: ["dry cleaning", "dry cleaner", "laundry", "wash and fold", "alterations", "tailoring", "claim ticket", "garment", "pressing", "pickup and delivery"] },
];

// CTA type to vertical affinity — features using booking, purchase, etc.
// tend to be relevant to verticals with the same CTA pattern
const CTA_VERTICAL_MAP: Record<string, string[]> = {
  booking: ["healthcare-wellness", "beauty-personal-care", "pet-services", "fitness-recreation", "professional-services"],
  purchase: ["retail-goods", "food-hospitality", "live-events-venues"],
  inquiry: ["trades-maintenance", "professional-services", "media-production", "fabric-care-services"],
  donation: ["nonprofit-community"],
};

// ─── Step 1: Sanitization Scan ──────────────────────────────────────────────

export async function runSanitizationScan(diff: string): Promise<SanitizationReport> {
  // Load org-specific identifiers to scan for
  const org = await prisma.organization.findFirst({
    select: { name: true, slug: true, email: true, phone: true, website: true },
  });
  const bc = await prisma.businessContext.findFirst({
    select: { description: true, targetMarket: true },
  }).catch(() => null);
  const sf = await prisma.storefrontConfig.findFirst({
    select: { tagline: true },
  }).catch(() => null);

  const orgName = org?.name ?? "";
  const scanTerms: Array<{ term: string; type: SanitizationFinding["type"]; replacement: string | null }> = [];

  // Org identity
  if (orgName && orgName.length > 2) {
    scanTerms.push({ term: orgName, type: "org-reference", replacement: "{{org.name}}" });
  }
  if (org?.slug && org.slug.length > 2) {
    scanTerms.push({ term: org.slug, type: "org-reference", replacement: "{{org.slug}}" });
  }
  if (org?.email) {
    const domain = org.email.split("@")[1];
    if (domain) scanTerms.push({ term: domain, type: "org-reference", replacement: "{{org.emailDomain}}" });
  }
  if (org?.phone) {
    scanTerms.push({ term: org.phone, type: "org-reference", replacement: null });
  }
  if (org?.website) {
    scanTerms.push({ term: org.website, type: "instance-url", replacement: "{{org.website}}" });
  }
  if (sf?.tagline && typeof sf.tagline === "string" && sf.tagline.length > 5) {
    scanTerms.push({ term: sf.tagline, type: "org-reference", replacement: null });
  }

  const findings: SanitizationFinding[] = [];

  // Parse diff into file sections
  const fileSections = diff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/^a\/(.+) b\//);
    const file = fileMatch?.[1] ?? "unknown";

    // Skip migration files and test files — they may legitimately contain specific data
    if (file.includes("migrations/") || file.includes(".test.")) continue;

    const lines = section.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only scan added lines (lines starting with +, excluding diff headers)
      if (!line.startsWith("+") || line.startsWith("+++")) continue;
      const content = line.slice(1); // Remove the leading +

      // Check each scan term
      for (const { term, type, replacement } of scanTerms) {
        if (content.toLowerCase().includes(term.toLowerCase())) {
          // Don't flag if it's in an import/require statement or variable name
          if (/^import |^require\(|^const |^let |^var /.test(content.trim())) continue;

          findings.push({
            file,
            line: i,
            type,
            original: term,
            suggestedReplacement: replacement,
            severity: type === "org-reference" ? "must-fix" : "review",
          });
        }
      }

      // Generic pattern scans
      // Hardcoded pricing in non-seed/non-test files
      if (/(?:price|cost|fee|rate)\s*[:=]\s*["']?\$?\d+/i.test(content) && !file.includes("seed")) {
        findings.push({
          file, line: i, type: "hardcoded-pricing",
          original: content.trim().slice(0, 60),
          suggestedReplacement: null,
          severity: "review",
        });
      }

      // Hardcoded URLs pointing to specific instances (not localhost/example).
      // CodeQL alerts #68/#69 (js/incomplete-url-substring-sanitization):
      // the previous content.includes("github.com") check was substring-only,
      // which would accept "github.com.evil.example". Parse the matched URL
      // and check the actual hostname against the allowlist.
      const urlMatch = content.match(/https?:\/\/(?!localhost|127\.0\.0\.1|example\.com)[a-zA-Z0-9.-]+\.[a-z]{2,}/);
      if (urlMatch) {
        let matchedHost = "";
        try {
          matchedHost = new URL(urlMatch[0]).hostname.toLowerCase();
        } catch {
          // urlMatch is by construction a valid URL prefix — fall through
        }
        const isAllowedHost =
          matchedHost === "github.com" || matchedHost.endsWith(".github.com") ||
          matchedHost === "googleapis.com" || matchedHost.endsWith(".googleapis.com");
        if (!isAllowedHost) {
          findings.push({
            file, line: i, type: "instance-url",
            original: urlMatch[0],
            suggestedReplacement: null,
            severity: "review",
          });
        }
      }
    }
  }

  // Deduplicate by file + type + original
  const seen = new Set<string>();
  const dedupedFindings = findings.filter((f) => {
    const key = `${f.file}:${f.type}:${f.original}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const mustFixCount = dedupedFindings.filter((f) => f.severity === "must-fix").length;
  const reviewCount = dedupedFindings.filter((f) => f.severity === "review").length;

  return {
    passed: mustFixCount === 0,
    findings: dedupedFindings,
    orgName,
    mustFixCount,
    reviewCount,
  };
}

// ─── Step 2: Parameterization Verification ──────────────────────────────────

export function verifyParameterization(
  diff: string,
  reusabilityAnalysis: {
    scope?: string;
    domainEntities?: Array<{ hardcodedValue: string; parameterName: string }>;
    contributionReadiness?: string;
  } | null,
): ParameterizationReport {
  const scope = (reusabilityAnalysis?.scope ?? "one_off") as ParameterizationReport["scope"];

  if (scope === "one_off" || !reusabilityAnalysis?.domainEntities?.length) {
    return {
      scope,
      checks: [],
      overallVerdict: scope === "already_generic" ? "pass" : "pass",
    };
  }

  const checks: ParameterizationCheck[] = [];
  const addedLines = diff.split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");

  for (const entity of reusabilityAnalysis.domainEntities) {
    const hardcodedInDiff = new RegExp(escapeRegex(entity.hardcodedValue), "i").test(addedLines);
    // Check if the parameter name appears as a variable, field, or config key
    const parameterized = new RegExp(
      `(?:${escapeRegex(entity.parameterName)}|${camelToSnake(entity.parameterName)})`,
      "i"
    ).test(addedLines);

    let verdict: ParameterizationCheck["verdict"];
    if (!hardcodedInDiff) {
      verdict = "not-applicable"; // The hardcoded value doesn't appear — no issue
    } else if (parameterized) {
      verdict = "pass"; // Both exist — value is being used alongside config
    } else {
      verdict = "fail"; // Hardcoded without parameterization
    }

    checks.push({
      entity: entity.hardcodedValue,
      parameterName: entity.parameterName,
      hardcodedInDiff,
      parameterized,
      verdict,
    });
  }

  const failCount = checks.filter((c) => c.verdict === "fail").length;
  const passCount = checks.filter((c) => c.verdict === "pass").length;
  const overallVerdict: ParameterizationReport["overallVerdict"] =
    failCount === 0 ? "pass" : passCount > 0 ? "partial" : "fail";

  return { scope, checks, overallVerdict };
}

// ─── Step 3: Business Vertical Tagging ──────────────────────────────────────

export async function tagBusinessVerticals(
  brief: Record<string, unknown> | null,
  diff: string,
): Promise<VerticalReport> {
  const bc = await prisma.businessContext.findFirst({
    select: { industry: true, ctaType: true },
  }).catch(() => null);

  const sourceVertical = bc?.industry ?? "unknown";
  const ctaType = bc?.ctaType ?? "inquiry";

  // Build a feature text blob for keyword matching
  const description = String(brief?.description ?? "");
  const targetRoles = Array.isArray(brief?.targetRoles) ? brief.targetRoles.join(" ") : "";
  const acceptanceCriteria = Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria.join(" ") : "";
  const featureText = `${description} ${targetRoles} ${acceptanceCriteria}`.toLowerCase();

  // Also scan the diff for route patterns and model names that hint at domain
  const changedFiles = [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
  const fileText = changedFiles.join(" ").toLowerCase();
  const searchText = `${featureText} ${fileText}`;

  // Verticals with same CTA type get a relevance boost
  const ctaRelated = new Set(CTA_VERTICAL_MAP[ctaType] ?? []);

  const applicableVerticals: VerticalApplicability[] = VERTICAL_CATEGORIES.map((v) => {
    const keywordHits = v.keywords.filter((kw) => searchText.includes(kw)).length;
    const isPrimary = v.value === sourceVertical;
    const isCTARelated = ctaRelated.has(v.value);

    let relevance: VerticalApplicability["relevance"];
    let reasoning: string;

    if (isPrimary) {
      relevance = "primary";
      reasoning = "Built by an organization in this vertical";
    } else if (keywordHits >= 2) {
      relevance = "applicable";
      reasoning = `${keywordHits} keyword matches in feature description and files`;
    } else if (keywordHits === 1 && isCTARelated) {
      relevance = "applicable";
      reasoning = `Keyword match + same CTA type (${ctaType})`;
    } else if (isCTARelated && !isPrimary) {
      relevance = "applicable";
      reasoning = `Shares CTA type (${ctaType}) — likely transferable`;
    } else {
      relevance = "unlikely";
      reasoning = "No strong keyword or CTA overlap";
    }

    return { category: v.value, label: v.label, relevance, reasoning };
  });

  return { sourceVertical, applicableVerticals };
}

// ─── Step 4: Generate Review Report ─────────────────────────────────────────

export function generateReviewReport(
  sanitization: SanitizationReport,
  parameterization: ParameterizationReport,
  verticals: VerticalReport,
  seedFit: SeedContributionFitReport,
  securityPassed: boolean,
  evidenceChain: Record<string, string>,
  mergeReadiness: MergeReadiness,
): string {
  const sections: string[] = [];

  // Header
  const readinessEmoji = mergeReadiness === "ready" ? "+" : mergeReadiness === "needs-work" ? "~" : "!";
  sections.push("## Contribution Review Report");
  sections.push("");
  sections.push(`### Merge Readiness: ${mergeReadiness.toUpperCase()}`);
  sections.push("");

  // Sanitization
  sections.push("### Sanitization");
  sections.push("");
  if (sanitization.passed) {
    sections.push("- [x] No org-specific content requiring fixes");
  } else {
    sections.push(`- [ ] ${sanitization.mustFixCount} must-fix finding(s)`);
  }
  if (sanitization.reviewCount > 0) {
    sections.push(`- [ ] ${sanitization.reviewCount} item(s) to review`);
  }
  if (sanitization.findings.length > 0) {
    sections.push("");
    sections.push("| File | Type | Content | Severity |");
    sections.push("|------|------|---------|----------|");
    for (const f of sanitization.findings.slice(0, 15)) {
      const content = f.original.length > 40 ? f.original.slice(0, 40) + "..." : f.original;
      const replacement = f.suggestedReplacement ? ` -> \`${f.suggestedReplacement}\`` : "";
      sections.push(`| ${f.file} | ${f.type} | \`${content}\`${replacement} | ${f.severity} |`);
    }
    if (sanitization.findings.length > 15) {
      sections.push(`| ... | ... | ${sanitization.findings.length - 15} more findings | ... |`);
    }
  }
  sections.push("");

  sections.push(...formatSeedContributionFitMarkdown(seedFit));

  // Parameterization
  sections.push("### Parameterization");
  sections.push("");
  sections.push(`- Ideate scope: **${parameterization.scope}**`);
  sections.push(`- Verification: **${parameterization.overallVerdict}**`);
  if (parameterization.checks.length > 0) {
    sections.push("");
    sections.push("| Entity | Parameter | Hardcoded? | Parameterized? | Verdict |");
    sections.push("|--------|-----------|------------|----------------|---------|");
    for (const c of parameterization.checks) {
      const icon = c.verdict === "pass" ? "[x]" : c.verdict === "fail" ? "[ ]" : "[-]";
      sections.push(`| ${c.entity} | ${c.parameterName} | ${c.hardcodedInDiff ? "Yes" : "No"} | ${c.parameterized ? "Yes" : "No"} | ${icon} ${c.verdict} |`);
    }
  }
  sections.push("");

  // Business Verticals
  const primary = verticals.applicableVerticals.filter((v) => v.relevance === "primary");
  const applicable = verticals.applicableVerticals.filter((v) => v.relevance === "applicable");

  sections.push("### Business Verticals");
  sections.push("");
  sections.push(`Source: **${verticals.sourceVertical.replace(/-/g, " ")}**`);
  if (primary.length > 0) {
    sections.push(`Primary: ${primary.map((v) => `**${v.label}**`).join(", ")}`);
  }
  if (applicable.length > 0) {
    sections.push(`Applicable: ${applicable.map((v) => v.label).join(", ")}`);
  }
  if (primary.length === 0 && applicable.length === 0) {
    sections.push("No strong vertical matches found — may be a cross-cutting platform feature.");
  }
  sections.push("");

  // Security
  sections.push("### Security Scan");
  sections.push("");
  sections.push(securityPassed ? "- [x] Passed — no critical findings" : "- [ ] Failed — review security findings in the PR body");
  sections.push("");

  // Evidence Chain
  if (Object.keys(evidenceChain).length > 0) {
    sections.push("### Evidence Chain");
    sections.push("");
    for (const [field, value] of Object.entries(evidenceChain)) {
      sections.push(`- **${field}**: ${value}`);
    }
    sections.push("");
  }

  // Labels
  const labels: string[] = [];
  if (primary.length > 0) labels.push(...primary.map((v) => `vertical:${v.category}`));
  if (applicable.length > 0) labels.push(...applicable.map((v) => `vertical:${v.category}`));
  labels.push(mergeReadiness === "ready" ? "merge-ready" : mergeReadiness === "needs-work" ? "needs-work" : "blocked");
  if (parameterization.scope !== "one_off") labels.push(`reuse:${parameterization.scope}`);
  if (seedFit.decision) labels.push(`seed-fit:${seedFit.decision}`);

  sections.push("### Suggested Labels");
  sections.push("");
  sections.push(labels.map((l) => `\`${l}\``).join(" "));
  sections.push("");

  return sections.join("\n");
}

// ─── Step 5-7: GitHub API Operations ────────────────────────────────────────

async function postPRComment(
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
  token: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    console.warn(`[contribution-review] Failed to post PR comment: ${response.status} ${text.slice(0, 200)}`);
  }
}

async function setPRLabels(
  owner: string,
  repo: string,
  prNumber: number,
  labels: string[],
  token: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/labels`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ labels }),
  });
  if (!response.ok) {
    // Labels may not exist yet — not fatal
    console.warn(`[contribution-review] Failed to set PR labels: ${response.status}`);
  }
}

async function setCommitStatus(
  owner: string,
  repo: string,
  commitSha: string,
  state: "success" | "failure" | "pending",
  description: string,
  token: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/statuses/${commitSha}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      state,
      description: description.slice(0, 140),
      context: "contribution-review",
    }),
  });
  if (!response.ok) {
    console.warn(`[contribution-review] Failed to set commit status: ${response.status}`);
  }
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export async function analyzeContributionSeedFit(
  diff: string,
  brief: Record<string, unknown> | null,
  designDocValue: unknown,
) {
  const designDoc = designDocValue as Record<string, unknown> | null;
  const reusability = designDoc?.reusabilityAnalysis as ReusabilityAnalysis | null;
  const sanitization = await runSanitizationScan(diff);
  const parameterization = verifyParameterization(diff, reusability);
  const verticals = await tagBusinessVerticals(brief, diff);
  const securityScan = scanDiffForSecurityIssues(diff);
  const allFiles = [...diff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((match) => match[1]);
  const seedFit = evaluateSeedContributionFit({
    changedFiles: allFiles,
    sanitization,
    parameterization,
    verticals,
    securityPassed: securityScan.passed,
  });
  return { allFiles, sanitization, parameterization, verticals, securityScan, seedFit };
}

export async function runContributionReview(input: ReviewInput): Promise<ContributionReviewResult> {
  const { buildId, prUrl, prNumber, repoOwner, repoName, token, diff } = input;

  // Load build data
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      title: true,
      brief: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      verificationOut: true,
      acceptanceMet: true,
      diffPatch: true,
    },
  });

  const brief = build?.brief as Record<string, unknown> | null;
  const { sanitization, parameterization, verticals, securityScan, seedFit } =
    await analyzeContributionSeedFit(diff, brief, build?.designDoc);

  // Build evidence chain
  const evidenceChain: Record<string, string> = {};
  if (build?.designReview) {
    const dr = build.designReview as Record<string, unknown>;
    evidenceChain["Design review"] = String(dr.decision ?? "completed");
  }
  if (build?.verificationOut) {
    const vo = build.verificationOut as Record<string, unknown>;
    const testCount = vo.testCount ?? vo.passCount ?? "unknown";
    const typecheckStatus = vo.typecheckPassed ? "clean" : vo.typecheckStatus ?? "unknown";
    evidenceChain["Tests"] = `${testCount} passed`;
    evidenceChain["Typecheck"] = String(typecheckStatus);
  }
  if (build?.acceptanceMet) {
    try {
      const criteria = Array.isArray(build.acceptanceMet) ? build.acceptanceMet : [];
      evidenceChain["Acceptance criteria"] = `${criteria.length} defined`;
    } catch { /* not parseable */ }
  }

  // Determine merge readiness
  const mergeReadiness = determineContributionMergeReadiness({
    securityPassed: securityScan.passed,
    sanitization,
    parameterization,
    seedFit,
  });

  // Step 4: Generate report
  const reportMarkdown = generateReviewReport(
    sanitization, parameterization, verticals,
    seedFit,
    securityScan.passed, evidenceChain, mergeReadiness,
  );

  // Step 5: Post PR comment
  try {
    await postPRComment(repoOwner, repoName, prNumber, reportMarkdown, token);
  } catch (err) {
    console.warn("[contribution-review] Failed to post PR comment:", err);
  }

  // Step 6: Set labels and commit status
  try {
    const labels: string[] = [];
    const primary = verticals.applicableVerticals.filter((v) => v.relevance === "primary");
    const applicable = verticals.applicableVerticals.filter((v) => v.relevance === "applicable");
    labels.push(...primary.map((v) => `vertical:${v.category}`));
    labels.push(...applicable.map((v) => `vertical:${v.category}`));
    labels.push(mergeReadiness === "ready" ? "merge-ready" : mergeReadiness === "needs-work" ? "needs-work" : "blocked");
    if (!securityScan.passed) labels.push("security-review-needed");
    if (seedFit.decision) labels.push(`seed-fit:${seedFit.decision}`);
    await setPRLabels(repoOwner, repoName, prNumber, labels, token);
  } catch (err) {
    console.warn("[contribution-review] Failed to set PR labels:", err);
  }

  // Set commit status check (if we can resolve the commit SHA from the PR)
  try {
    const prResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/pulls/${prNumber}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (prResponse.ok) {
      const prData = await prResponse.json() as { head?: { sha?: string } };
      const commitSha = prData.head?.sha;
      if (commitSha) {
        const statusState = mergeReadiness === "ready" ? "success" as const
          : mergeReadiness === "needs-work" ? "failure" as const
          : "failure" as const;
        const statusDesc = mergeReadiness === "ready"
          ? seedFit.decision
            ? `Contribution review passed; seed fit: ${seedFit.decision}`
            : "Contribution review passed"
          : `Contribution review: ${mergeReadiness}`;
        await setCommitStatus(repoOwner, repoName, commitSha, statusState, statusDesc, token);
      }
    }
  } catch (err) {
    console.warn("[contribution-review] Failed to set commit status:", err);
  }

  // Step 7: Update FeaturePack
  const reviewedAt = new Date().toISOString();
  const reviewResult: ContributionReviewResult = {
    mergeReadiness,
    sanitization,
    parameterization,
    verticals,
    seedFit,
    securityPassed: securityScan.passed,
    evidenceChain,
    reviewedAt,
  };

  try {
    const primary = verticals.applicableVerticals.filter((v) => v.relevance === "primary");
    const applicable = verticals.applicableVerticals.filter((v) => v.relevance === "applicable");
    const allVerticals = [...primary, ...applicable].map((v) => v.category);

    const pack = build ? await prisma.featurePack.findFirst({
      where: { buildId: build.id },
      orderBy: { createdAt: "desc" },
      select: { packId: true, manifest: true },
    }) : null;
    if (!pack) return reviewResult;

    const manifest = pack.manifest && typeof pack.manifest === "object" && !Array.isArray(pack.manifest)
      ? pack.manifest as Record<string, unknown>
      : {};
    const seedDeltaManifest = seedFit.touchesSeededContent
      ? buildContributionSeedDeltaManifest(seedFit, {
        packId: pack.packId,
        buildId,
        prNumber,
        prUrl,
        reviewedAt,
      })
      : null;

    await prisma.featurePack.update({
      where: { packId: pack.packId },
      data: {
        mergeReadiness,
        applicableVerticals: allVerticals,
        sourceVertical: verticals.sourceVertical,
        reusabilityScope: parameterization.scope,
        prUrl,
        prNumber,
        manifest: {
          ...manifest,
          seedDeltaManifest,
        } as unknown as import("@dpf/db").Prisma.InputJsonValue,
        reviewReport: reviewResult as unknown as import("@dpf/db").Prisma.InputJsonValue,
        reviewedAt: new Date(reviewedAt),
      },
    });
  } catch (err) {
    console.warn("[contribution-review] Failed to update FeaturePack:", err);
  }

  return reviewResult;
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
