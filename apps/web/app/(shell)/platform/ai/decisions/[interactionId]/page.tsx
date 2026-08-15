import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ interactionId: string }>;
};

/**
 * Compatibility route for older decision links. The coworker decision record
 * is the single detail home: it carries evidence, contributors, audit context,
 * and deterministic next-action guidance in one place.
 */
export default async function DecisionInteractionPage({ params }: PageProps) {
  const { interactionId } = await params;
  redirect(`/coworker-decisions/decisions/${encodeURIComponent(interactionId)}`);
}
