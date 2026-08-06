// apps/web/lib/tak/route-context/providers/finance.ts
// Finance/tax page-context provider (+ its footprint heuristics).
// Extracted verbatim from route-context.ts (page-owned context contract,
// design spec 2026-08-05 Phase 2 PR 2). Behavior unchanged.

import { prisma } from "@dpf/db";

function containsAnyToken(value: string | null | undefined, tokens: string[]): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return tokens.some((token) => normalized.includes(token.toLowerCase()));
}
function isTexasFinanceFootprint(input: {
  region?: string | null;
  footprint?: string | null;
  businessGeographicScope?: string | null;
  businessTargetMarket?: string | null;
}): boolean {
  const values = [
    input.region,
    input.footprint,
    input.businessGeographicScope,
    input.businessTargetMarket,
  ];

  return values.some((value) => {
    if (!value) return false;
    return value.trim().toUpperCase() === "TX"
      || containsAnyToken(value, ["Texas", " TX", "TX,", "TX."]);
  });
}
function isSoftwarePlatformBusiness(input: {
  industry?: string | null;
  description?: string | null;
  revenueModel?: string | null;
}): boolean {
  return [
    input.industry,
    input.description,
    input.revenueModel,
  ].some((value) => containsAnyToken(value, ["software", "saas", "platform", "subscription", "digital product"]));
}
export async function getFinanceContext(): Promise<string> {
  const sections: string[] = ["\nPAGE DATA — Finance:"];

  const [taxProfile, businessContext, registrationCount, openIssueCount, recurringCount, overdueInvoices, activeCredentialCount, blockedRunCount, readyPeriodCount] = await Promise.all([
    prisma.organizationTaxProfile.findFirst({
      orderBy: { createdAt: "asc" },
      select: {
        setupMode: true,
        setupStatus: true,
        homeCountryCode: true,
        primaryRegionCode: true,
        taxModel: true,
        filingOwner: true,
        handoffMode: true,
        externalSystem: true,
        footprintSummary: true,
      },
    }),
    prisma.businessContext.findFirst({
      select: {
        industry: true,
        description: true,
        targetMarket: true,
        revenueModel: true,
        geographicScope: true,
      },
    }),
    prisma.taxRegistration.count(),
    prisma.taxIssue.count({ where: { status: "open" } }),
    prisma.recurringSchedule.count({ where: { status: "active" } }),
    prisma.invoice.count({ where: { status: { in: ["sent", "overdue"] } } }),
    prisma.taxAuthorityCredential.count({ where: { status: "active" } }),
    prisma.taxRemittanceRun.count({ where: { status: { in: ["blocked", "failed"] } } }),
    prisma.taxObligationPeriod.count({ where: { status: "ready" } }),
  ]);

  if (!taxProfile) {
    sections.push(
      "No organization tax profile has been configured yet.",
      `Recurring schedules: ${recurringCount}`,
      `Outstanding customer invoices: ${overdueInvoices}`,
      `Ready tax periods: ${readyPeriodCount}`,
      "External tax research requirement: External Access is required before recommending registrations, filing schedules, or tax-processing setup from live law.",
      "Research tool instruction: when External Access is enabled, use search_public_web for official tax authority pages and fetch_public_website for the strongest official sources before making a DPF tax processing proposal. If External Access is off, ask the user to enable it and provide the official-source targets to verify.",
      "DPF tax processing proposal required: propose DPF configuration changes for tax capture, registrations, tax codes, liability tracking, obligation periods, remittance schedule, evidence, and accounting handoff. Mark assumptions and human approval boundaries.",
      "Provider/subscription spend instruction: use platform finance records first, then browser-use billing portals for plan, amount, cadence, renewal, invoice, and receipt evidence. Do not submit payments, change plans, or update external account settings. If the portal cannot resolve a required field, queue the human ask with the exact missing fields.",
    );
    return sections.join("\n");
  }

  sections.push(
    `Tax setup mode: ${taxProfile.setupMode}`,
    `Tax setup status: ${taxProfile.setupStatus}`,
    `Home jurisdiction: ${taxProfile.homeCountryCode ?? "unassigned"}${taxProfile.primaryRegionCode ? ` / ${taxProfile.primaryRegionCode}` : ""}`,
    `Tax model: ${taxProfile.taxModel}`,
    `Filing owner: ${taxProfile.filingOwner}`,
    `Handoff mode: ${taxProfile.handoffMode}`,
    `External system: ${taxProfile.externalSystem ?? "none recorded"}`,
    `Registrations recorded: ${registrationCount}`,
    `Open tax setup issues: ${openIssueCount}`,
    `Active authority credentials: ${activeCredentialCount}`,
    `Ready tax periods: ${readyPeriodCount}`,
    `Blocked or failed remittance runs: ${blockedRunCount}`,
    `Recurring schedules: ${recurringCount}`,
    `Outstanding customer invoices: ${overdueInvoices}`,
    "Provider/subscription spend instruction: use platform finance records first, then browser-use billing portals for plan, amount, cadence, renewal, invoice, and receipt evidence. Do not submit payments, change plans, or update external account settings. If the portal cannot resolve a required field, queue the human ask with the exact missing fields.",
  );

  const jurisdictionWhere = taxProfile.homeCountryCode
    ? {
        countryCode: taxProfile.homeCountryCode,
        ...(taxProfile.primaryRegionCode
          ? {
              OR: [
                { stateProvinceCode: taxProfile.primaryRegionCode },
                { stateProvinceCode: null },
              ],
            }
          : {}),
      }
    : undefined;

  const [topOpenIssues, unverifiedRegistrations, jurisdictionHints] = await Promise.all([
    prisma.taxIssue.findMany({
      where: { status: "open" },
      select: {
        title: true,
        severity: true,
        issueType: true,
      },
      orderBy: [{ openedAt: "asc" }],
      take: 3,
    }),
    prisma.taxRegistration.findMany({
      where: { lastVerifiedAt: null },
      select: {
        registrationNumber: true,
        jurisdictionReference: {
          select: {
            authorityName: true,
            jurisdictionRefId: true,
          },
        },
      },
      take: 5,
    }),
    prisma.taxJurisdictionReference.findMany({
      where: jurisdictionWhere,
      select: {
        authorityName: true,
        countryCode: true,
        stateProvinceCode: true,
        authorityType: true,
        taxTypes: true,
        filingUrl: true,
        officialWebsiteUrl: true,
      },
      orderBy: [{ countryCode: "asc" }, { stateProvinceCode: "asc" }, { authorityName: "asc" }],
      take: 6,
    }),
  ]);

  if (taxProfile.setupMode === "new_business") {
    sections.push(
      "Coworker investigation posture: first-time setup",
      "Coworker next question: Where is the business legally registered and where are taxable services delivered?",
      "Recommended next action: Research likely authorities from the seeded jurisdiction registry, then live-verify official sources before scheduling periods.",
    );
  } else if (taxProfile.setupMode === "existing") {
    sections.push(
      "Coworker investigation posture: existing filing normalization",
      "Coworker next question: Which authorities does the business already file with today, and who owns each filing?",
      "Recommended next action: Add or verify each known registration, then reconcile open setup gaps before scheduling remittance runs.",
    );
  } else {
    sections.push(
      "Coworker investigation posture: setup mode unknown",
      "Coworker next question: Is the business already filing sales tax, VAT, or GST anywhere today?",
      "Recommended next action: Classify setup mode, capture home jurisdiction and operating footprint, then add the first known or likely authority registration.",
    );
  }

  const setupNeedsOfficialResearch =
    taxProfile.setupMode !== "existing"
    || taxProfile.setupStatus !== "complete"
    || registrationCount === 0
    || openIssueCount > 0;

  if (setupNeedsOfficialResearch) {
    sections.push(
      "External tax research requirement: External Access is required before recommending registrations, filing schedules, or tax-processing setup from live law.",
      "Research tool instruction: when External Access is enabled, use search_public_web for official tax authority pages and fetch_public_website for the strongest official sources before making a DPF tax processing proposal. If External Access is off, ask the user to enable it and provide the official-source targets to verify.",
      "DPF tax processing proposal required: propose DPF configuration changes for tax capture, registrations, tax codes, liability tracking, obligation periods, remittance schedule, evidence, and accounting handoff. Mark assumptions and human approval boundaries.",
    );
  }

  const likelyTexas = isTexasFinanceFootprint({
    region: taxProfile.primaryRegionCode,
    footprint: taxProfile.footprintSummary,
    businessGeographicScope: businessContext?.geographicScope,
    businessTargetMarket: businessContext?.targetMarket,
  });
  const likelySoftware = isSoftwarePlatformBusiness({
    industry: businessContext?.industry,
    description: businessContext?.description,
    revenueModel: businessContext?.revenueModel,
  });

  if (likelyTexas && likelySoftware) {
    sections.push(
      "Likely DPF/Texas research focus: software-platform or SaaS-style sales into Texas; verify Texas Comptroller guidance before configuring tax capture.",
      "Official-source starting points: Texas Comptroller sales/use tax permit FAQ, Texas taxable services guidance, and Texas franchise tax taxable-entities FAQ.",
    );
  }

  if (taxProfile.footprintSummary) {
    sections.push(`Operating footprint summary: ${taxProfile.footprintSummary}`);
  }

  if (topOpenIssues.length > 0) {
    sections.push(
      "Open tax issues for coworker attention:",
      ...topOpenIssues.map(
        (issue) => `- ${issue.severity} ${issue.issueType} - ${issue.title}`,
      ),
      `Top open tax issue: ${topOpenIssues[0]?.severity} ${topOpenIssues[0]?.issueType} - ${topOpenIssues[0]?.title}`,
    );
  }

  if (unverifiedRegistrations.length > 0) {
    sections.push(
      "Registrations needing live verification:",
      ...unverifiedRegistrations.map(
        (registration) =>
          `- ${registration.jurisdictionReference.authorityName} (${registration.jurisdictionReference.jurisdictionRefId}) registration=${registration.registrationNumber ?? "pending"}`,
      ),
    );
  }

  if (jurisdictionHints.length > 0) {
    sections.push(
      "Jurisdiction seed hints:",
      ...jurisdictionHints.map((hint) => {
        const region = hint.stateProvinceCode ? `/${hint.stateProvinceCode}` : "";
        const source = hint.filingUrl ?? hint.officialWebsiteUrl ?? "source pending";
        return `- ${hint.authorityName} (${hint.countryCode}${region}, ${hint.authorityType}) taxes=${hint.taxTypes.join(", ")} source=${source}`;
      }),
    );
  }

  return sections.join("\n");
}
