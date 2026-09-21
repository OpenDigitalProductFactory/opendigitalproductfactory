import { ArrowLeft, DoorClosed } from "lucide-react";

import { EmptyState } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { canonicalWorkCaseHref } from "@/lib/work-management/canonical-case-key";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import { WorkroomBody } from "@/components/workspace/workroom/WorkroomBody";
import { WorkroomHeader } from "@/components/workspace/workroom/WorkroomHeader";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";
import type { RoomWorkforce } from "@/lib/work-management/room-workforce.server";

type Props = {
  detail: WorkspaceWorkCaseDetailView;
  navigationContext?: Record<string, string | string[] | undefined>;
  workforce?: Pick<RoomWorkforce, "accountability" | "accountableDisplayName"> | null;
};

export function WorkCaseDetailView({ detail, workforce, navigationContext = {} }: Props) {
  if (detail.roomChoices?.length) {
    return (
      <Surface as="section" className="space-y-4 text-[var(--dpf-text)]" aria-labelledby="room-choice-title">
        <h1 id="room-choice-title" className="text-xl font-semibold">{detail.workItemTitle}</h1>
        <h2 className="text-base font-medium">Choose a Workroom</h2>
        <ul className="space-y-2">
          {detail.roomChoices.map((choice) => (
            <li key={choice.capsuleId}>
              <a href={canonicalWorkCaseHref(encodeURIComponent(detail.summary.caseId), navigationContext,
                encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: choice.capsuleId }))}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]">
                <span>{choice.title} <span className="text-[var(--dpf-muted)]">{choice.capsuleId}</span></span>
                <span className="text-[var(--dpf-muted)]">{choice.status}</span>
              </a>
            </li>
          ))}
        </ul>
        {detail.roomChoicesPartial ? <p className="text-sm text-[var(--dpf-muted)]">Partial: 200 recently updated rooms.</p> : null}
      </Surface>
    );
  }
  if (!detail.room) {
    return (
      <div className="space-y-5 text-[var(--dpf-text)]">
        <a
          href="/workspace/my-queue"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          My Work
        </a>
        <EmptyState
          title="Work Room unavailable"
          description="Please try again."
          icon={<DoorClosed className="size-7" />}
          action={(
            <a
              href="/workspace/my-queue"
              className="inline-flex min-h-11 items-center rounded-md border border-[var(--dpf-border)] px-3 text-sm font-medium text-[var(--dpf-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            >
              Return to My Work
            </a>
          )}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 text-[var(--dpf-text)]">
      <WorkroomHeader room={detail.room} summary={detail.summary} workforce={workforce} />
      <WorkroomBody detail={detail} room={detail.room} />
    </div>
  );
}
