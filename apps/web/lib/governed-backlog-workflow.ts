export type LifecycleLabel =
  | "Captured"
  | "Triaging"
  | "Prepared Draft"
  | "Ready to Start"
  | "In Progress"
  | "Ready to Release"
  | "Done";

type StorefrontInquirySignal = {
  inquiryId: string;
  inquiryRef: string;
  customerName: string | null;
  customerEmail: string;
  message?: string | null;
  storefrontLabel?: string | null;
  itemLabel?: string | null;
};

export type StorefrontInquiryBacklogDraft = {
  itemId: string;
  title: string;
  type: "product";
  status: "triaging";
  source: "user-request";
  priority: number;
  body: string;
  recommendedTriageOutcome: "build";
  signalLabel: "customer-zero";
};

type LifecycleBacklogItem = {
  status: string;
  triageOutcome?: string | null;
  activeBuildId?: string | null;
};

type LifecycleFeatureBuild = {
  phase: string;
  draftApprovedAt?: Date | null;
};

export function deriveLifecycleLabel(input: {
  backlogItem: LifecycleBacklogItem | null;
  featureBuild: LifecycleFeatureBuild | null;
  governedBacklogEnabled: boolean;
}): LifecycleLabel | null {
  const { backlogItem, featureBuild, governedBacklogEnabled } = input;

  if (!backlogItem) {
    return null;
  }

  if (backlogItem.status === "done") {
    return "Done";
  }

  if (backlogItem.status === "triaging") {
    return backlogItem.triageOutcome == null ? "Captured" : "Triaging";
  }

  if (featureBuild?.phase === "ship") {
    return "Ready to Release";
  }

  if (backlogItem.status === "in-progress") {
    return "In Progress";
  }

  const hasActiveDraft =
    backlogItem.status === "open" &&
    backlogItem.activeBuildId != null &&
    featureBuild?.phase === "ideate";

  if (hasActiveDraft) {
    if (!governedBacklogEnabled) {
      return "In Progress";
    }

    return featureBuild?.draftApprovedAt != null
      ? "Ready to Start"
      : "Prepared Draft";
  }

  return null;
}

export function createStorefrontInquiryBacklogDraft(
  inquiry: StorefrontInquirySignal,
): StorefrontInquiryBacklogDraft {
  const normalizedRef = inquiry.inquiryRef.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const storefrontLine = inquiry.storefrontLabel
    ? `Storefront: ${inquiry.storefrontLabel}`
    : null;
  const itemLine = inquiry.itemLabel ? `Interested item: ${inquiry.itemLabel}` : null;
  const messageLine = inquiry.message?.trim()
    ? `Inquiry detail:\n${inquiry.message.trim()}`
    : "Inquiry detail:\nNo additional message provided.";

  return {
    itemId: `BI-SFI-${normalizedRef}`,
    title: `Customer-zero product inquiry ${inquiry.inquiryRef}`,
    type: "product",
    status: "triaging",
    source: "user-request",
    priority: 2,
    recommendedTriageOutcome: "build",
    signalLabel: "customer-zero",
    body: [
      "Customer-zero intake captured from the storefront inquiry flow.",
      `Inquiry ref: ${inquiry.inquiryRef}`,
      `Inquiry row: ${inquiry.inquiryId}`,
      `Prospect: ${inquiry.customerName?.trim() || "Unknown contact"} <${inquiry.customerEmail}>`,
      storefrontLine,
      itemLine,
      messageLine,
      "Recommended next step: triage as product work and decide whether it should become a governed Build Studio effort.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
