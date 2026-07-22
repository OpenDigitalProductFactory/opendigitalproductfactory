import { notFound } from "next/navigation";
import { loadSubmissionResult } from "@/lib/storefront/submission-result";
import { SubmissionResultView } from "@/components/storefront/SubmissionResultView";

// Named result route for a confirmed reservation (BI-F20763F5). Carries the
// selected slot, guest, and item context into a branded confirmation.
export default async function BookingConfirmedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  if (!ref) notFound();

  const result = await loadSubmissionResult(slug, "booking", ref);
  if (!result) notFound();

  return <SubmissionResultView result={result} />;
}
