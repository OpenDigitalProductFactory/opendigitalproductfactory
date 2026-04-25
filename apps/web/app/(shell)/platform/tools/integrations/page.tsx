import { prisma } from "@dpf/db";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";

export default async function EnterpriseIntegrationsPage() {
  const [configuredIntegrations, errorStates] = await Promise.all([
    prisma.integrationCredential.count({
      where: {
        provider: {
          in: [
            "adp",
            "quickbooks",
            "stripe",
            "microsoft365",
            "hubspot",
            "google",
            "facebook",
            "mailchimp",
          ],
        },
        status: "connected",
      },
    }),
    prisma.integrationCredential.count({
      where: {
        provider: {
          in: [
            "adp",
            "quickbooks",
            "stripe",
            "microsoft365",
            "hubspot",
            "google",
            "facebook",
            "mailchimp",
          ],
        },
        status: "error",
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Integrations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Native, first-class business integrations with customer-supplied credentials and platform-managed governance.
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
        <PlatformSummaryCard
          title="Microsoft 365 Communications"
          description="Communications anchor for inbox, calendar, Teams, channels, and recent message context on the enterprise substrate."
          href="/platform/tools/integrations/microsoft365-communications"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Category", value: "Communications" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="HubSpot CRM & Marketing"
          description="Marketing and CRM anchor for account details, contacts, and lead-capture forms on the enterprise substrate."
          href="/platform/tools/integrations/hubspot"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Category", value: "Marketing / CRM" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Google Marketing Intelligence"
          description="Read-first GA4 and Search Console anchor for traffic, conversions, and search visibility on the enterprise substrate."
          href="/platform/tools/integrations/google-marketing-intelligence"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Category", value: "Marketing Intelligence" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Google Business Profile"
          description="Localized presence anchor for business listings, location details, and recent review context on the enterprise substrate."
          href="/platform/tools/integrations/google-business-profile"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Category", value: "Local Presence" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Facebook Lead Ads"
          description="Localized lead-capture anchor for page forms, recent submissions, and downstream CRM follow-up on the enterprise substrate."
          href="/platform/tools/integrations/facebook-lead-ads"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Category", value: "Localized Lead Capture" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Mailchimp Marketing"
          description="Email marketing anchor for audiences, recent campaigns, and approved customer outreach context on the enterprise substrate."
          href="/platform/tools/integrations/mailchimp"
          accent="var(--dpf-warning)"
          metrics={[
            { label: "Category", value: "Email Marketing" },
            { label: "Model", value: "Native" },
          ]}
        />
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          Current Posture
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          {configuredIntegrations} configured native integrations, {errorStates} needing operator attention.
          Native connectors stay separate from MCP services so enterprise auth, credential custody, and
          approval boundaries remain explicit.
        </p>
      </div>
    </div>
  );
}
