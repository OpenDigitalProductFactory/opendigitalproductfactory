/**
 * Customer submit-result contract — server loader (BI-F20763F5).
 *
 * A successful inquiry/booking/order/donation must land the customer on a
 * result surface that is NAMED for the result (`/inquiry/received`,
 * `/booking/confirmed`, …) — not the generic `/checkout` plumbing — and must
 * explain: what they submitted, their reference, the response channel and
 * expected time, what happens next, and how to correct / cancel / contact.
 *
 * The pure copy + type contract lives in `submission-result-content.ts` (no DB
 * import, unit-tested there). This module adds `loadSubmissionResult`, which
 * validates the reference against the storefront and assembles the branded,
 * Restaurant-appropriate context.
 */

import { prisma } from "@dpf/db";
import {
  isSubmissionType,
  resultHeading,
  responseChannelCopy,
  responseTimeCopy,
  whatHappensNextSteps,
  type ContextLine,
  type SubmissionResultModel,
  type SubmissionType,
} from "./submission-result-content";

export {
  isSubmissionType,
  resultRouteFor,
  resultHeading,
  whatHappensNextSteps,
  responseChannelCopy,
  responseTimeCopy,
  SUBMISSION_TYPES,
} from "./submission-result-content";
export type { ContextLine, SubmissionResultModel, SubmissionType } from "./submission-result-content";

function formatWhen(scheduledAt: Date, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timezone || "UTC" }).format(scheduledAt);
  } catch {
    // Guard against an invalid stored timezone string.
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(scheduledAt);
  }
}

/**
 * Validate `ref` against the storefront and assemble the branded result model.
 * Returns `null` when the storefront or the referenced record does not exist —
 * the route renders `notFound()` in that case, so a guessed/stale ref never
 * shows a fabricated confirmation.
 */
export async function loadSubmissionResult(
  slug: string,
  type: SubmissionType,
  ref: string,
): Promise<SubmissionResultModel | null> {
  if (!isSubmissionType(type)) return null;

  const config = await prisma.storefrontConfig.findFirst({
    where: { organization: { slug } },
    select: {
      id: true,
      timezone: true,
      contactEmail: true,
      contactPhone: true,
      organization: { select: { name: true, slug: true } },
    },
  });
  if (!config) return null;

  const storefrontId = config.id;
  const orgName = config.organization.name;
  const orgSlug = config.organization.slug;
  const { heading, icon } = resultHeading(type);

  const context: ContextLine[] = [];
  let customerEmail: string | null = null;

  async function itemName(itemId: string | null | undefined): Promise<string | null> {
    if (!itemId) return null;
    const item = await prisma.storefrontItem.findFirst({
      where: { id: itemId, storefrontId },
      select: { name: true },
    });
    return item?.name ?? null;
  }

  if (type === "inquiry") {
    const row = await prisma.storefrontInquiry.findFirst({
      where: { inquiryRef: ref, storefrontId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        message: true,
        itemId: true,
      },
    });
    if (!row) return null;
    customerEmail = row.customerEmail;
    const name = await itemName(row.itemId);
    if (name) context.push({ label: "About", value: name });
    context.push({ label: "Name", value: row.customerName });
    context.push({ label: "Email", value: row.customerEmail });
    if (row.customerPhone) context.push({ label: "Phone", value: row.customerPhone });
    if (row.message) context.push({ label: "Your message", value: row.message });
  } else if (type === "booking") {
    const row = await prisma.storefrontBooking.findFirst({
      where: { bookingRef: ref, storefrontId },
      select: {
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        scheduledAt: true,
        durationMinutes: true,
        notes: true,
        itemId: true,
      },
    });
    if (!row) return null;
    customerEmail = row.customerEmail;
    const name = await itemName(row.itemId);
    if (name) context.push({ label: "Reservation", value: name });
    context.push({ label: "When", value: formatWhen(row.scheduledAt, config.timezone) });
    context.push({ label: "For", value: `${row.durationMinutes} minutes` });
    context.push({ label: "Name", value: row.customerName });
    context.push({ label: "Email", value: row.customerEmail });
    if (row.customerPhone) context.push({ label: "Phone", value: row.customerPhone });
    if (row.notes) context.push({ label: "Notes", value: row.notes });
  } else if (type === "order") {
    const row = await prisma.storefrontOrder.findFirst({
      where: { orderRef: ref, storefrontId },
      select: { customerName: true, customerEmail: true },
    });
    if (!row) return null;
    customerEmail = row.customerEmail;
    if (row.customerName) context.push({ label: "Name", value: row.customerName });
    context.push({ label: "Email", value: row.customerEmail });
  } else {
    const row = await prisma.storefrontDonation.findFirst({
      where: { donationRef: ref, storefrontId },
      select: { donorName: true, donorEmail: true, isAnonymous: true },
    });
    if (!row) return null;
    customerEmail = row.donorEmail;
    if (row.donorName && !row.isAnonymous) context.push({ label: "Name", value: row.donorName });
    context.push({ label: "Email", value: row.donorEmail });
  }

  return {
    type,
    ref,
    orgName,
    orgSlug,
    heading,
    icon,
    context,
    responseChannel: responseChannelCopy(customerEmail),
    responseTime: responseTimeCopy(type),
    nextSteps: whatHappensNextSteps(type, orgName),
    contact: { email: config.contactEmail, phone: config.contactPhone },
  };
}
