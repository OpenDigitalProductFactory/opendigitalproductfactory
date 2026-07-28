import Link from "next/link";
import { EmptyState } from "@/components/ui/report-kit";

export function DirectionPhaseUnavailable({
  title,
  description,
  briefHref,
}: {
  title: string;
  description: string;
  briefHref: string;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <Link
          href={briefHref}
          className="text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:underline"
        >
          Return to Direction brief
        </Link>
      }
    />
  );
}
