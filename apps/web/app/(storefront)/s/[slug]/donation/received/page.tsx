import { notFound } from "next/navigation";
import { loadSubmissionResult } from "@/lib/storefront/submission-result";
import { SubmissionResultView } from "@/components/storefront/SubmissionResultView";

// Named result route for a completed donation (BI-F20763F5).
export default async function DonationReceivedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  if (!ref) notFound();

  const result = await loadSubmissionResult(slug, "donation", ref);
  if (!result) notFound();

  return <SubmissionResultView result={result} />;
}
