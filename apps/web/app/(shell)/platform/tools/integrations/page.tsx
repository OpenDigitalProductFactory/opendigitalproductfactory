import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

export default async function EnterpriseIntegrationsPage() {
  const [configuredIntegrations, errorStates] = await Promise.all([
    prisma.integrationCredential.count({
      where: { provider: { in: ["adp", "quickbooks", "stripe"] }, status: "connected" },
    }),
    prisma.integrationCredential.count({
      where: { provider: { in: ["adp", "quickbooks", "stripe"] }, status: "error" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Integrations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Native, first-class business integrations with customer-supplied credentials and
          platform-managed governance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <PlatformSummaryCard
          title="ADP Workforce Now"
          description="Payroll and workforce anchor using the dedicated ADP runtime and mTLS posture."
          href="/platform/tools/integrations/adp"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Category", value: "HR / Payroll" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="QuickBooks Online"
          description="Finance anchor for company, customer, and invoice context on the enterprise integration substrate."
          href="/platform/tools/integrations/quickbooks"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Category", value: "Finance" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Stripe Billing & Payments"
          description="Payments anchor for balance, customer, invoice, and payment-intent context on the enterprise substrate."
          href="/platform/tools/integrations/stripe"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Category", value: "Payments" },
            { label: "Model", value: "Native" },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          Current Posture
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          {configuredIntegrations} configured native integrations, {errorStates} needing operator
          attention. Native connectors stay separate from MCP services so enterprise auth,
          credential custody, and approval boundaries remain explicit.
        </p>
      </div>
    </div>
  );
}
