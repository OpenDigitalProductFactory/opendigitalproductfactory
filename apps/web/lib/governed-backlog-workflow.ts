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
  workType: "feature";
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
  const customerLabel = inquiry.customerName?.trim() || "a customer";
  const itemSubject = inquiry.itemLabel?.trim();
  const titleSubject = itemSubject ? `${itemSubject} inquiry` : "Inquiry";

  return {
    itemId: `BI-SFI-${normalizedRef}`,
    title: `${titleSubject} from ${customerLabel} (${inquiry.inquiryRef})`,
    type: "product",
    status: "triaging",
    source: "user-request",
    // Storefront inquiries become product feature work — the operator chose
    // to engage. The eventual build will design + ship a new capability.
    workType: "feature",
    priority: 2,
    recommendedTriageOutcome: "build",
    signalLabel: "customer-zero",
    body: [
      "Inquiry captured from your storefront.",
      `Inquiry ref: ${inquiry.inquiryRef}`,
      `Inquiry row: ${inquiry.inquiryId}`,
      `Customer: ${inquiry.customerName?.trim() || "Unknown contact"} <${inquiry.customerEmail}>`,
      storefrontLine,
      itemLine,
      messageLine,
      "Recommended next step: triage this inquiry and decide how to follow up.",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}
