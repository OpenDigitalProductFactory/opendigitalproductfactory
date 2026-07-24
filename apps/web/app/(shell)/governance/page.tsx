import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { getActiveOrgCapabilities } from "@/lib/storefront/org-capabilities.server";
import { CivicMeetingsPanel, type MeetingRow } from "@/components/civic/CivicMeetingsPanel";

// Governance workbench (BI-8D477188 Phase 3; member-owned flavor BI-AFC178F3).
// Capability-gated: public bodies (council/committee, open-meetings law) and
// member-owned organizations (board/annual meeting) share this surface — the
// GovernanceMeeting bodyType carries the distinction (civic spec §12).
export default async function GovernancePage() {
  const activeCapabilities = await getActiveOrgCapabilities();
  const isPublicBody = activeCapabilities.has("public-body-governance");
  const isMemberGoverned = activeCapabilities.has("member-governance");
  if (!isPublicBody && !isMemberGoverned) notFound();
  const showRecordsRequests = activeCapabilities.has("records-request");

  const meetings = await prisma.governanceMeeting.findMany({
    orderBy: { scheduledAt: "desc" },
    take: 50,
  });

  const rows: MeetingRow[] = meetings.map((m) => ({
    id: m.id,
    meetingId: m.meetingId,
    bodyType: m.bodyType,
    title: m.title,
    scheduledAt: m.scheduledAt.toISOString(),
    location: m.location,
    status: m.status,
    agendaPublishedAt: m.agendaPublishedAt?.toISOString() ?? null,
    minutesRecordedAt: m.minutesRecordedAt?.toISOString() ?? null,
  }));

  const openRequests = showRecordsRequests
    ? await prisma.recordsRequest.count({
        where: { status: { in: ["submitted", "in-progress"] } },
      })
    : 0;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Governance</h1>
          <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
            Meetings, agendas, and minutes · {rows.length} meetings
          </p>
        </div>
        {showRecordsRequests && (
          <Link
            href="/governance/records-requests"
            className="rounded border border-[var(--dpf-border)] px-3 py-1.5 text-xs text-[var(--dpf-text)] hover:border-[var(--dpf-accent)]"
          >
            Records Requests {openRequests > 0 ? `(${openRequests} open)` : ""}
          </Link>
        )}
      </div>
      <CivicMeetingsPanel meetings={rows} />
    </div>
  );
}
