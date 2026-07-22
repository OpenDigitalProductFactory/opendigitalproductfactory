import { notFound } from "next/navigation";
import { loadSubmissionResult } from "@/lib/storefront/submission-result";
import { SubmissionResultView } from "@/components/storefront/SubmissionResultView";

// Named result route for a submitted inquiry (BI-F20763F5). Replaces the
// generic `/checkout?type=inquiry` plumbing so the URL matches the action.
export default async function InquiryReceivedPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string }>;
}) {
  const { slug } = await params;
  const { ref } = await searchParams;
  if (!ref) notFound();

  const result = await loadSubmissionResult(slug, "inquiry", ref);
  if (!result) notFound();

  return <SubmissionResultView result={result} />;
}
