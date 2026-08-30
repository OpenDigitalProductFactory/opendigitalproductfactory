import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { QuickBooksConnectPanel } from "@/components/integrations/QuickBooksConnectPanel";
import { IntegrationReadinessPanel } from "@/components/integrations/IntegrationReadinessPanel";
import { buildQuickBooksReadinessDescriptor } from "@/lib/integrations/quickbooks/readiness";
import { loadQuickBooksReadinessConnection } from "@/lib/integrations/quickbooks/connection-state";
import { resolveNextSteps } from "@/lib/backlog/next-step-pointer";

export default async function QuickBooksIntegrationPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  if (
    !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "manage_provider_connections",
    )
  ) {
    redirect("/platform/tools");
  }

  const initialState = await loadQuickBooksReadinessConnection();
  const readiness = buildQuickBooksReadinessDescriptor({ connection: initialState });
  const [importReviewNextStep] = readiness.importReview
    ? await resolveNextSteps([readiness.importReview.nextStep])
    : [];

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <a href="/platform/tools" className="hover:underline">
            Tools
          </a>
          <span>/</span>
          <span>Enterprise Integrations</span>
          <span>/</span>
          <span>QuickBooks</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">QuickBooks Online</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured finance integration. DPF stores your Intuit credentials encrypted in
          this install and uses read-first accounting probes before any write workflows are added.
        </p>
      </div>

      <QuickBooksConnectPanel initialState={initialState} />

      <IntegrationReadinessPanel descriptor={readiness} importReviewNextStep={importReviewNextStep} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-sm">
        <h2 className="font-semibold text-[var(--dpf-text)]">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Verifies tenant-scoped QuickBooks connectivity with your own Intuit app credentials.</li>
          <li>Reads company profile plus a sample customer and invoice through the Accounting API.</li>
          <li>Keeps the connection on the native enterprise-integration substrate instead of a one-off secret store.</li>
          <li>Sets the platform up for later invoice, payment, and billing automation without skipping governance.</li>
        </ul>
      </aside>
    </div>
  );
}
