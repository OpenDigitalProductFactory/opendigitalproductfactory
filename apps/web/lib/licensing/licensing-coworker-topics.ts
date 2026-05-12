import type { LicensingWorkspace } from "@/lib/licensing-workspace-types";

type AgentWorkLauncherTopic = {
  id: string;
  label: string;
  description: string;
  prompt: string;
  contextSummary: string;
  expectedNextStep: string;
};

function formatInvestigationMode(value: string): string {
  switch (value) {
    case "existing":
      return "already operating";
    case "new_business":
      return "new business";
    case "expanding":
      return "expanding footprint";
    default:
      return "unknown";
  }
}

function buildContextSummary(workspace: LicensingWorkspace): string {
  const footprint = workspace.profile.operatingFootprintSummary?.trim() || "Operating footprint not yet captured.";
  const home = workspace.profile.homeCountryCode || "Unknown country";
  const region = workspace.profile.primaryRegionCode || "No primary region recorded";
  const mode = formatInvestigationMode(workspace.profile.investigationMode);
  return `${workspace.organization.name} (${workspace.organization.slug}) is in ${mode} mode. Home: ${home}. Primary region: ${region}. Footprint: ${footprint}`;
}

function buildIssueSummary(workspace: LicensingWorkspace): string {
  if (workspace.openIssues.length === 0) return "No open readiness issues are currently recorded.";
  const titles = workspace.openIssues.slice(0, 3).map((issue) => issue.title).join("; ");
  return `Open issues (${workspace.summary.openIssueCount}): ${titles}`;
}

export function buildLicensingCoworkerTopics(
  workspace: LicensingWorkspace,
): AgentWorkLauncherTopic[] {
  const baseContext = buildContextSummary(workspace);
  const issueSummary = buildIssueSummary(workspace);
  const companyCount = workspace.summary.organizationLicenseCount;
  const personCount = workspace.summary.personCredentialCount;
  const displayCount = workspace.summary.unsatisfiedDisplayCount;
  const feeCount = workspace.summary.pendingFeeCount;

  return [
    {
      id: "jurisdiction-readiness",
      label: "Map jurisdictions and legality",
      description:
        "Investigate where the business operates, whether the activity is lawful there, and which authorities likely matter first.",
      prompt:
        `Investigate licensing and legality readiness for ${workspace.organization.name}. ` +
        `${baseContext} Start by classifying the business as existing, new, or expanding, then map the likely jurisdiction and authority layers involved. ` +
        `Do not guess legal facts. Save investigation findings into the licensing profile and create factual readiness issues for any missing live verification.`,
      contextSummary: `${baseContext} ${issueSummary}`,
      expectedNextStep:
        "The licensing specialist should ask the next high-value jurisdiction question, then persist the findings instead of leaving them only in chat.",
    },
    {
      id: "license-gap-review",
      label: "Review company license gaps",
      description:
        "Compare the current company-held licenses against what the operating footprint and business type appear to require.",
      prompt:
        `Review company-held licensing readiness for ${workspace.organization.name}. ${baseContext} ` +
        `There are ${companyCount} company licenses recorded and ${workspace.summary.openIssueCount} open readiness issues. ` +
        `Investigate likely missing organization-level licenses, permits, or registrations, then record only factual gaps as readiness issues and save any verified posture updates.`,
      contextSummary:
        `${companyCount} company licenses recorded. ${issueSummary}`,
      expectedNextStep:
        "The licensing specialist should identify likely organization-held gaps and turn unresolved ones into actionable readiness issues.",
    },
    {
      id: "staff-display-fee-readiness",
      label: "Check staff credentials, display rules, and fees",
      description:
        "Investigate person-held qualifications, public display obligations, and fee/renewal readiness tied to licensing.",
      prompt:
        `Investigate staff credential, display, and fee readiness for ${workspace.organization.name}. ${baseContext} ` +
        `There are ${personCount} person credentials recorded, ${displayCount} unsatisfied display obligations, and ${feeCount} pending fees. ` +
        `Review where person-held licensing or certifications likely matter, what must be displayed or evidenced, and what fees or renewals need finance follow-up. Save factual findings and create readiness issues where verification is still missing.`,
      contextSummary:
        `${personCount} person credentials, ${displayCount} unsatisfied display rules, ${feeCount} pending fees.`,
      expectedNextStep:
        "The licensing specialist should separate company-held versus person-held obligations, then persist any missing display, credential, or fee follow-up.",
    },
  ];
}
