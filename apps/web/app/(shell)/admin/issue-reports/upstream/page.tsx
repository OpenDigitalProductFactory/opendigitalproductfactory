import { namespaceMessages } from "@dpf/i18n";

import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { UpstreamFeedbackSettings } from "@/components/admin/UpstreamFeedbackSettings";
import { getUpstreamFeedbackConsent } from "@/lib/actions/feedback-escalation";
import { auth } from "@/lib/auth";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { getT } from "@/lib/i18n/t.server";
import { can } from "@/lib/permissions";

// BI-6ED89EC6: the standing place to let this installation's triaged problems
// reach the project team. Its own page because the issue-report and
// platform-development pages are frozen by the UX route ratchet (WWMD
// DI-F24F5CEB9CDB). The "Needs you" item a consent-halted sweep raises links here.
export default async function AdminUpstreamFeedbackPage() {
  const [consent, session, t, { language }] = await Promise.all([
    getUpstreamFeedbackConsent(),
    auth(),
    getT("admin"),
    getLocaleContext(),
  ]);
  const mayChange = session?.user
    ? can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")
    : false;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{t("upstreamFeedback.pageTitle")}</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{t("upstreamFeedback.pageSubtitle")}</p>
      </div>
      <AdminTabNav />
      <MessagesProvider locale={language} messages={{ admin: namespaceMessages(language, "admin") }}>
        <UpstreamFeedbackSettings
          optIn={consent.optIn}
          forkOnly={consent.forkOnly}
          paused={consent.paused}
          mayChange={mayChange}
        />
      </MessagesProvider>
    </div>
  );
}
