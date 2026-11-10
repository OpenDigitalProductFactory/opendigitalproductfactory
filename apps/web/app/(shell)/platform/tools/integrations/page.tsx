import { prisma } from "@dpf/db";
import { resolveNextSteps } from "@/lib/backlog/next-step-pointer";
import { IntegrationCoverageDisclosure } from "@/components/integrations/IntegrationCoverageDisclosure";
import { PlatformSummaryCard } from "@/components/platform/PlatformSummaryCard";
import { getMatrixByOrg } from "@/lib/actions/integration-coverage";
import {
  CSDM_STRUCTURAL_DOMAIN_LABELS,
  EMPLOYEE_WORK_ROLE_LABELS,
  INTEGRATION_COVERAGE_KIND_LABELS,
  INTEGRATION_COVERAGE_MATRIX,
  INTEGRATION_COVERAGE_MATURITY_LABELS,
  INTEGRATION_COVERAGE_POSTURE_LABELS,
  IT4IT_VALUE_STREAM_LABELS,
} from "@/lib/tools/integration-coverage-matrix";

export default async function EnterpriseIntegrationsPage() {
  const org = await prisma.organization.findFirst({ select: { id: true } });
  const dbCoverageMatrix = org ? await getMatrixByOrg(org.id) : [];
  const coverageNextSteps = await resolveNextSteps(
    INTEGRATION_COVERAGE_MATRIX.map((row) => row.nextStep),
  );

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
            "wordpress",
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
            "wordpress",
          ],
        },
        status: "error",
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Native Integrations</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Business integrations with customer-supplied credentials and platform-managed governance.
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
          title="Employee Communications Fabric"
          description="Governed employee reachability, delivery evidence, and channel-adapter readiness across DPF-owned and external messaging surfaces."
          href="/platform/tools/integrations/communications"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Category", value: "Employee Communications" },
            { label: "Model", value: "Fabric" },
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
          title="Facebook Pages"
          description="Localized social presence anchor for page details, recent posts, and comment activity on the enterprise substrate."
          href="/platform/tools/integrations/facebook-pages"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Category", value: "Local Social Presence" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="WhatsApp Business"
          description="Localized messaging readiness anchor for phone quality, approved templates, and language coverage on the enterprise substrate."
          href="/platform/tools/integrations/whatsapp-business"
          accent="var(--dpf-success)"
          metrics={[
            { label: "Category", value: "Localized Messaging" },
            { label: "Model", value: "Native" },
          ]}
        />
        <PlatformSummaryCard
          title="Instagram Business"
          description="Local visual presence anchor for profile, recent media, and comment context on the enterprise substrate."
          href="/platform/tools/integrations/instagram-business"
          accent="var(--dpf-info)"
          metrics={[
            { label: "Category", value: "Local Visual Presence" },
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
        <PlatformSummaryCard
          title="WordPress (self-hosted)"
          description="Projects approved DPF content into a customer-owned WordPress site. WordPress retains hosting, themes, URLs, and public delivery; DPF does not provide a public site or CDN."
          href="/platform/tools/integrations/wordpress"
          accent="var(--dpf-accent)"
          metrics={[
            { label: "Category", value: "Customer-owned website" },
            { label: "Model", value: "External channel" },
          ]}
        />
      </div>

      <IntegrationCoverageDisclosure>
        <div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Employee Work Coverage
            </p>
            <h2 className="mt-2 text-lg font-semibold text-[var(--dpf-text)]">
              Role, taxonomy, coworker, and product posture
            </h2>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
              {INTEGRATION_COVERAGE_MATRIX.filter((row) => row.kind === "native").length} native rows
            </span>
            <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
              {INTEGRATION_COVERAGE_MATRIX.filter((row) => row.kind === "benchmark").length} benchmark rows
            </span>
            <span className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-[var(--dpf-text)]">
              CSDM and IT4IT projection only
            </span>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-[1100px] text-left text-sm">
            <thead className="border-b border-[var(--dpf-border)] text-[11px] uppercase tracking-[0.16em] text-[var(--dpf-muted)]">
              <tr>
                <th className="py-3 pr-4 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Employee work</th>
                <th className="px-4 py-3 font-medium">Taxonomy</th>
                <th className="px-4 py-3 font-medium">Surface / coworker</th>
                <th className="px-4 py-3 font-medium">Posture</th>
                <th className="px-4 py-3 font-medium">Structure</th>
                <th className="py-3 pl-4 font-medium">Next slice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--dpf-border)]">
              {INTEGRATION_COVERAGE_MATRIX.map((row, rowIndex) => (
                <tr key={row.id} className="align-top">
                  <td className="py-4 pr-4">
                    <p className="font-medium text-[var(--dpf-text)]">{row.productName}</p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">{row.provider}</p>
                    <p className="mt-2 inline-flex rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-text)]">
                      {INTEGRATION_COVERAGE_KIND_LABELS[row.kind]}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex max-w-[220px] flex-wrap gap-1.5">
                      {row.employeeRoles.map((role) => (
                        <span
                          key={role}
                          className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-text)]"
                        >
                          {EMPLOYEE_WORK_ROLE_LABELS[role]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-[250px] space-y-1">
                      {row.taxonomyNodeIds.slice(0, 3).map((nodeId) => (
                        <p key={nodeId} className="break-words font-mono text-xs text-[var(--dpf-muted)]">
                          {nodeId}
                        </p>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-[240px] space-y-2">
                      <p className="break-words text-xs text-[var(--dpf-text)]">{row.dpfSurfaces.join(", ")}</p>
                      <p className="break-words text-xs text-[var(--dpf-muted)]">{row.coworkerIds.join(", ")}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-[var(--dpf-text)]">
                        {INTEGRATION_COVERAGE_POSTURE_LABELS[row.posture]}
                      </p>
                      <p className="text-xs text-[var(--dpf-muted)]">
                        {INTEGRATION_COVERAGE_MATURITY_LABELS[row.maturity]}
                      </p>
                    </div>
                  </td>
                  <td className="px-4 py-4">
                    <div className="max-w-[220px] space-y-1">
                      <p className="text-xs font-medium text-[var(--dpf-text)]">
                        {CSDM_STRUCTURAL_DOMAIN_LABELS[row.csdmDomain]}
                      </p>
                      <p className="text-xs text-[var(--dpf-muted)]">
                        {row.it4itValueStreams.map((stream) => IT4IT_VALUE_STREAM_LABELS[stream]).join(", ")}
                      </p>
                    </div>
                  </td>
                  <td className="py-4 pl-4">
                    <div className="max-w-[220px] space-y-1">
                      <p className="font-mono text-xs font-medium text-[var(--dpf-text)]">
                        {coverageNextSteps[rowIndex].label}
                      </p>
                      <p className="text-xs text-[var(--dpf-muted)]">{row.notes}</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </IntegrationCoverageDisclosure>

      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">Integration Coverage Matrix</h2>
        </div>
        <div className="overflow-x-auto border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--dpf-border)] text-[11px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              <tr>
                <th className="px-3 py-2 font-medium">Provider</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Surface</th>
                <th className="px-3 py-2 font-medium">Read Posture</th>
              </tr>
            </thead>
            <tbody>
              {dbCoverageMatrix.map((row) => (
                <tr
                  key={`${row.providerKey}-${row.role}-${row.surface}`}
                  className="border-b border-[var(--dpf-border)] last:border-0"
                >
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{row.providerKey}</td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{row.role}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)]">{row.surface}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)]">{row.readPosture}</td>
                </tr>
              ))}
              {dbCoverageMatrix.length === 0 ? (
                <tr>
                  <td className="px-3 py-3 text-[var(--dpf-muted)]" colSpan={4}>
                    No integration coverage rows configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
