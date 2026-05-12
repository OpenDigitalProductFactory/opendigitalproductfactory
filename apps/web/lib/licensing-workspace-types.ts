// Shared licensing workspace types for server components and client panels.
// Separated from the "use server" action module so client code can import the
// shape without depending on server-action export behavior.

export type LicensingRequirementOption = {
  id: string;
  requirementRefId: string;
  jurisdictionLabel: string;
  authorityName: string;
  requirementType: string;
  scopeLevel: string;
};

export type LicensingHolderOption = {
  id: string;
  aliasType: string;
  aliasValue: string;
  displayName: string;
};

export type LicensingRequirementReference = {
  authorityName: string | null;
  jurisdictionLabel: string | null;
  requirementType: string | null;
};

export type LicensingDisplayObligation = {
  id: string;
  displayType: string;
  displayLocation: string | null;
  isSatisfied: boolean;
};

export type LicensingFeeSchedule = {
  id: string;
  feeType: string;
  amount: unknown;
  currency: string;
  paymentStatus: string;
};

export type LicensingFeeScheduleSummary = LicensingFeeSchedule & {
  dueDate: string | Date | null;
  financeHandoffMode: string;
  holderLabel: string;
  sourceLabel: string;
};

export type LicensingDisplayObligationSummary = {
  id: string;
  displayType: string;
  displayLocation: string | null;
  holderLabel: string;
  isSatisfied: boolean;
  sourceLabel: string;
};

export type LicensingOpenIssue = {
  id: string;
  details: string | null;
  issueType: string;
  severity: string;
  title: string;
};

export type LicensingOrganizationLicenseRecord = {
  id: string;
  licenseKind: string;
  status: string;
  licenseNumber: string | null;
  expiresAt: string | Date | null;
  displayRequirementStatus: string;
  requirementReference: LicensingRequirementReference | null;
  displayObligations: LicensingDisplayObligation[];
  feeSchedules: LicensingFeeSchedule[];
};

export type LicensingPersonCredentialRecord = {
  id: string;
  credentialType: string;
  status: string;
  credentialNumber: string | null;
  expiresAt: string | Date | null;
  supervisoryOrDisplayRole: string | null;
  principalAlias: {
    principal: {
      displayName: string;
    };
  };
};

export type LicensingWorkspace = {
  organization: {
    name: string;
    slug: string;
  };
  profile: {
    setupStatus: string;
    investigationMode: string;
    homeCountryCode: string | null;
    primaryRegionCode: string | null;
    operatingFootprintSummary: string | null;
    legalActivityConfidence: string;
    researchCoverageStatus: string;
    notes: string | null;
  };
  requirementOptions: LicensingRequirementOption[];
  holderOptions: LicensingHolderOption[];
  organizationLicenses: LicensingOrganizationLicenseRecord[];
  personCredentials: LicensingPersonCredentialRecord[];
  displayObligations: LicensingDisplayObligationSummary[];
  feeSchedules: LicensingFeeScheduleSummary[];
  openIssues: LicensingOpenIssue[];
  summary: {
    organizationLicenseCount: number;
    personCredentialCount: number;
    unsatisfiedDisplayCount: number;
    pendingFeeCount: number;
    openIssueCount: number;
  };
};
