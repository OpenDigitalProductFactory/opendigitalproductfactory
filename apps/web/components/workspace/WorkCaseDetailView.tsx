import { ArrowLeft, DoorClosed } from "lucide-react";

import { EmptyState } from "@/components/ui/report-kit";
import { WorkRoomBody } from "@/components/workspace/work-room/WorkRoomBody";
import { WorkRoomHeader } from "@/components/workspace/work-room/WorkRoomHeader";
import type { WorkspaceWorkCaseDetailView } from "@/lib/work-management/workspace-case-loader";

type Props = {
  detail: WorkspaceWorkCaseDetailView;
};

export function WorkCaseDetailView({ detail }: Props) {
  if (!detail.room) {
    return (
      <main className="space-y-5 text-[var(--dpf-text)]">
        <a
          href="/workspace/my-queue"
          className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-[var(--dpf-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          My Work
        </a>
        <EmptyState
          title="Work Room unavailable"
          description="The room could not load. Return to My Work and try again."
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
      </main>
    );
  }

  return (
    <main className="space-y-5 text-[var(--dpf-text)]">
      <WorkRoomHeader room={detail.room} summary={detail.summary} />
      <WorkRoomBody detail={detail} room={detail.room} />
    </main>
  );
}
