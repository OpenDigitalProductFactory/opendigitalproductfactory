/**
 * Pure copy + type contract for the customer submit-result surface
 * (BI-F20763F5). No database or framework imports — this is the part that
 * decides *what the customer reads* on a result page, so it stays unit-testable
 * in isolation. The DB loader lives in `submission-result.ts` and re-exports
 * everything here for callers.
 */

export type SubmissionType = "inquiry" | "booking" | "order" | "donation";

export const SUBMISSION_TYPES: readonly SubmissionType[] = [
  "inquiry",
  "booking",
  "order",
  "donation",
] as const;

export function isSubmissionType(value: string): value is SubmissionType {
  return (SUBMISSION_TYPES as readonly string[]).includes(value);
}

/** The named result route for a submission type (relative to `/s/[slug]`). */
export function resultRouteFor(type: SubmissionType): string {
  switch (type) {
    case "inquiry":
      return "inquiry/received";
    case "booking":
      return "booking/confirmed";
    case "order":
      return "order/received";
    case "donation":
      return "donation/received";
  }
}

export type ContextLine = { label: string; value: string };

export type SubmissionResultModel = {
  type: SubmissionType;
  ref: string;
  orgName: string;
  orgSlug: string;
  heading: string;
  icon: string;
  /** Human summary of exactly what the customer submitted. */
  context: ContextLine[];
  /** Where and how the business will reply. */
  responseChannel: string;
  /** Expected timeframe copy. */
  responseTime: string;
  /** Ordered "what happens next" steps. */
  nextSteps: string[];
  /** Correction / cancel / contact affordances. */
  contact: { email: string | null; phone: string | null };
};

export function resultHeading(type: SubmissionType): { heading: string; icon: string } {
  switch (type) {
    case "booking":
      return { heading: "Your table is reserved", icon: "📅" };
    case "inquiry":
      return { heading: "Thanks — we've received your enquiry", icon: "✉️" };
    case "order":
      return { heading: "Your order is in", icon: "🧾" };
    case "donation":
      return { heading: "Thank you for your support", icon: "❤️" };
  }
}

export function whatHappensNextSteps(type: SubmissionType, orgName: string): string[] {
  switch (type) {
    case "booking":
      return [
        `${orgName} holds your table for the date and time above.`,
        "You'll receive an email confirming your reservation.",
        "Just turn up — no payment is taken online.",
      ];
    case "inquiry":
      return [
        `A member of the ${orgName} team reads your enquiry.`,
        "We reply using the contact details you gave us.",
        "We'll confirm anything we need before going ahead.",
      ];
    case "order":
      return [
        `${orgName} reviews your order.`,
        "We'll be in touch to confirm details and timing.",
        "Keep your reference handy for any questions.",
      ];
    case "donation":
      return [
        `Your gift goes straight to ${orgName}.`,
        "We'll email you a confirmation and receipt.",
        "Thank you for making a difference.",
      ];
  }
}

/** Where we'll reply. Email is the primary channel for every submission type. */
export function responseChannelCopy(email: string | null): string {
  return email
    ? `We'll reply by email to ${email}.`
    : "We'll reply using the contact details you provided.";
}

/**
 * Expected timeframe. Intentionally a soft, honest default rather than a
 * fabricated per-business SLA — the owner has not configured a promised
 * response time, so we state an aim, not a guarantee.
 */
export function responseTimeCopy(type: SubmissionType): string {
  return type === "booking"
    ? "We aim to confirm your reservation within one business day."
    : "We aim to respond within one business day.";
}
