import { notFound, redirect } from "next/navigation";
import { isSubmissionType, resultRouteFor } from "@/lib/storefront/submission-result";

/**
 * Back-compat shim (BI-F20763F5). `/checkout` was previously the generic
 * success page for every submission type, which is misleading for a Restaurant
 * customer who never checks out — an inquiry or reservation is not a purchase.
 *
 * Success now lives at result-named routes (`/inquiry/received`,
 * `/booking/confirmed`, …). This route stays only to forward any submit path
 * that still targets `/checkout?ref=&type=` (e.g. the booking/order/donation
 * flows owned by sibling work) to the matching named result route, preserving
 * the reference. The named route validates the reference and 404s if invalid.
 */
export default async function CheckoutRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; type?: string }>;
}) {
  const { slug } = await params;
  const { ref, type } = await searchParams;

  if (!ref || !type || !isSubmissionType(type)) notFound();

  redirect(`/s/${slug}/${resultRouteFor(type)}?ref=${encodeURIComponent(ref)}`);
}
