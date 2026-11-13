import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { UpstreamFeedbackSettings } from "@/components/admin/UpstreamFeedbackSettings";
import { getUpstreamFeedbackConsent } from "@/lib/actions/feedback-escalation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

// BI-6ED89EC6: the standing place to let this installation's triaged problems
// reach the project team. Its own page because the issue-report and
// platform-development pages are frozen by the UX route ratchet (WWMD
// DI-F24F5CEB9CDB). The "Needs you" item a consent-halted sweep raises links here.
export default async function AdminUpstreamFeedbackPage() {
  const [consent, session] = await Promise.all([getUpstreamFeedbackConsent(), auth()]);
  const mayChange = session?.user
    ? can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")
    : false;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Upstream feedback</p>
      </div>
      <AdminTabNav />
      <UpstreamFeedbackSettings
        optIn={consent.optIn}
        forkOnly={consent.forkOnly}
        paused={consent.paused}
        mayChange={mayChange}
      />
    </div>
  );
}
