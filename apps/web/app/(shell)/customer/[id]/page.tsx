// apps/web/app/(shell)/customer/[id]/page.tsx — Account detail with timeline
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@dpf/db";
import { EditCustomerConfigurationItemButton } from "@/components/customer/EditCustomerConfigurationItemButton";
import { NewCustomerConfigurationItemButton } from "@/components/customer/NewCustomerConfigurationItemButton";
import { CustomerLifecycleReviewQueues } from "@/components/customer/CustomerLifecycleReviewQueues";
import { CustomerSiteTree } from "@/components/customer/CustomerSiteTree";
import { NewCustomerSiteButton } from "@/components/customer/NewCustomerSiteButton";
import { loadCustomerEstateSummary } from "@/lib/customer-estate/account-estate-summary";
import type { TechnologySourceType } from "@/lib/customer-estate/lifecycle-evaluation";
import {
  deriveCustomerConfigurationItemDefaults,
  readActivationProfile,
} from "@/lib/storefront/archetype-activation";

const STATUS_COLOURS: Record<string, string> = {
  prospect: "#fbbf24",
  qualified: "#fb923c",
  onboarding: "#38bdf8",
  active: "#4ade80",
  at_risk: "#ef4444",
  suspended: "#8888a0",
  closed: "#555566",
};

const ACTIVITY_ICONS: Record<string, string> = {
  note: "📝",
  call: "📞",
  email: "📧",
  meeting: "📅",
  task: "☑️",
  status_change: "🔄",
  quote_event: "📋",
  system: "⚙️",
};

function normalizeTechnologySourceType(
  value: string | null | undefined,
): TechnologySourceType {
  if (
    value === "commercial" ||
    value === "open_source" ||
    value === "hybrid"
  ) {
    return value;
  }

  return "commercial";
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [account, activities, opportunities, engagements, estateSummary, storefrontConfig] = await Promise.all([
    prisma.customerAccount.findUnique({
      where: { id },
      include: {
        contacts: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            jobTitle: true,
            isActive: true,
            doNotContact: true,
          },
          orderBy: { createdAt: "asc" },
        },
        contactRoles: {
          include: { contact: { select: { id: true, email: true, firstName: true, lastName: true } } },
          orderBy: [{ isPrimary: "desc" }, { startedAt: "desc" }],
        },
        customerSites: {
          include: {
            primaryAddress: {
              include: {
                city: {
                  include: {
                    region: {
                      include: {
                        country: true,
                      },
                    },
                  },
                },
              },
            },
            nodes: {
              orderBy: [{ createdAt: "asc" }],
            },
          },
          orderBy: { name: "asc" },
        },
        configurationItems: {
          orderBy: [{ updatedAt: "desc" }],
          take: 8,
          select: {
            id: true,
            customerCiId: true,
            name: true,
            siteId: true,
            ciType: true,
            technologySourceType: true,
            supportModel: true,
            observedVersion: true,
            normalizedVersion: true,
            lifecycleStatus: true,
            lifecycleConfidence: true,
            recommendedAction: true,
            renewalDate: true,
            endOfSupportAt: true,
            endOfLifeAt: true,
            warrantyEndAt: true,
            licenseQuantity: true,
            billingCadence: true,
            customerChargeModel: true,
            lifecycleEvidence: true,
            site: { select: { id: true, name: true } },
          },
        },
        parentAccount: { select: { id: true, accountId: true, name: true } },
        childAccounts: { select: { id: true, accountId: true, name: true, status: true } },
      },
    }),
    prisma.activity.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        createdBy: { select: { id: true, email: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        opportunity: { select: { id: true, title: true } },
      },
    }),
    prisma.opportunity.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        opportunityId: true,
        title: true,
        stage: true,
        probability: true,
        expectedValue: true,
        isDormant: true,
      },
    }),
    prisma.engagement.findMany({
      where: { accountId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, engagementId: true, title: true, status: true },
    }),
    loadCustomerEstateSummary(id),
    prisma.storefrontConfig.findFirst({
      include: {
        archetype: {
          select: {
            activationProfile: true,
          },
        },
      },
    }),
  ]);

  if (!account) notFound();

  const statusColour = STATUS_COLOURS[account.status] ?? "#8888a0";
  const managedItemDefaults = deriveCustomerConfigurationItemDefaults(
    readActivationProfile(storefrontConfig?.archetype?.activationProfile),
  );
  const itemTypeOptions =
    managedItemDefaults.itemTypes.length > 0
      ? managedItemDefaults.itemTypes
      : [
          {
            key: "custom",
            label: "Custom Managed Item",
            technologySourceType: "commercial" as const,
          },
        ];
  const chargeModelOptions =
    managedItemDefaults.chargeModels.length > 0
      ? managedItemDefaults.chargeModels
      : [{ key: "included", label: "Included" }];

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/customer" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Accounts
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{account.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{account.name}</h1>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full"
            style={{ background: `${statusColour}20`, color: statusColour }}
          >
            {account.status}
          </span>
        </div>
        <p className="text-[10px] font-mono text-[var(--dpf-muted)]">
          {account.accountId}
        </p>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {account.industry && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Industry</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{account.industry}</p>
          </div>
        )}
        {account.website && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Website</p>
            <p className="text-sm text-[var(--dpf-accent)] truncate">{account.website}</p>
          </div>
        )}
        {account.employeeCount && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Employees</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">{account.employeeCount.toLocaleString()}</p>
          </div>
        )}
        {account.annualRevenue && (
          <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
            <p className="text-[10px] text-[var(--dpf-muted)]">Annual Revenue</p>
            <p className="text-sm font-semibold text-[var(--dpf-text)]">
              {account.currency} {Number(account.annualRevenue).toLocaleString()}
            </p>
          </div>
        )}
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Customer Sites</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{estateSummary.siteCount}</p>
          <p className="text-[10px] text-[var(--dpf-muted)]">
            {estateSummary.activeSiteCount} active
          </p>
        </div>
        <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]">
          <p className="text-[10px] text-[var(--dpf-muted)]">Managed CIs</p>
          <p className="text-sm font-semibold text-[var(--dpf-text)]">{estateSummary.managedItemCount}</p>
          <p className="text-[10px] text-[var(--dpf-muted)]">
            {estateSummary.lifecycleAttentionCount} need review
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Timeline (2/3 width) */}
        <div className="lg:col-span-2">
          <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
            Activity Timeline
            <span className="ml-2 normal-case font-normal">{activities.length}</span>
          </h2>

          {activities.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No activity recorded yet.</p>
          ) : (
            <div className="space-y-1">
              {activities.map((act) => (
                <div
                  key={act.id}
                  className="p-3 rounded-lg bg-[var(--dpf-surface-1)] flex gap-3"
                >
                  <span className="text-sm shrink-0">
                    {ACTIVITY_ICONS[act.type] ?? "•"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[var(--dpf-text)]">{act.subject}</p>
                    {act.body && (
                      <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 line-clamp-2">
                        {act.body}
                      </p>
                    )}
                    <div className="flex gap-2 mt-1 text-[9px] text-[var(--dpf-muted)]">
                      <span>{new Date(act.createdAt).toLocaleString()}</span>
                      {act.createdBy && <span>by {act.createdBy.email}</span>}
                      {act.opportunity && (
                        <Link
                          href={`/customer/opportunities/${act.opportunity.id}`}
                          className="text-[var(--dpf-accent)] hover:underline"
                        >
                          {act.opportunity.title}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column — Sidebar */}
        <div className="space-y-6">
          {/* Contacts */}
          <div>
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              Contacts
              <span className="ml-2 normal-case font-normal">{account.contacts.length}</span>
            </h2>
            <div className="space-y-2">
              {account.contacts.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                >
                  <p className="text-xs font-semibold text-[var(--dpf-text)]">
                    {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email}
                  </p>
                  {c.jobTitle && (
                    <p className="text-[9px] text-[var(--dpf-muted)]">{c.jobTitle}</p>
                  )}
                  <p className="text-[9px] text-[var(--dpf-muted)]">{c.email}</p>
                  {c.phone && (
                    <p className="text-[9px] text-[var(--dpf-muted)]">{c.phone}</p>
                  )}
                  <div className="flex gap-1 mt-1">
                    {!c.isActive && (
                      <span className="text-[8px] px-1 py-0.5 rounded-full bg-red-900/30 text-red-400">
                        inactive
                      </span>
                    )}
                    {c.doNotContact && (
                      <span className="text-[8px] px-1 py-0.5 rounded-full bg-yellow-900/30 text-yellow-400">
                        do not contact
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
              Customer Estate
            </h2>
            <div className="p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] space-y-3">
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <p className="text-[var(--dpf-muted)]">Commercial</p>
                  <p className="text-[var(--dpf-text)] font-semibold">{estateSummary.commercialCount}</p>
                </div>
                <div>
                  <p className="text-[var(--dpf-muted)]">Open Source</p>
                  <p className="text-[var(--dpf-text)] font-semibold">{estateSummary.openSourceCount}</p>
                </div>
                <div>
                  <p className="text-[var(--dpf-muted)]">Hybrid</p>
                  <p className="text-[var(--dpf-text)] font-semibold">{estateSummary.hybridCount}</p>
                </div>
                <div>
                  <p className="text-[var(--dpf-muted)]">Recurring licensed</p>
                  <p className="text-[var(--dpf-text)] font-semibold">{estateSummary.recurringLicensedItemCount}</p>
                </div>
              </div>

              {account.customerSites.length > 0 ? (
                <div>
                  <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider mb-2">Sites</p>
                  <div className="space-y-1">
                    {account.customerSites.slice(0, 4).map((site) => (
                      <div
                        key={site.id}
                        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5"
                      >
                        <p className="text-xs text-[var(--dpf-text)]">{site.name}</p>
                        <p className="text-[9px] text-[var(--dpf-muted)]">
                          {site.siteType} · {site.status} · {site.siteId}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  No customer sites have been loaded yet.
                </p>
              )}

              {estateSummary.topAttentionItems.length > 0 ? (
                <div>
                  <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
                    Lifecycle Attention
                  </p>
                  <div className="space-y-1">
                    {estateSummary.topAttentionItems.map((item) => (
                      <div
                        key={item.id}
                        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1.5"
                      >
                        <p className="text-xs text-[var(--dpf-text)]">{item.name}</p>
                        <p className="text-[9px] text-[var(--dpf-muted)]">
                          {item.ciType} · {item.lifecycleStatus} · {item.recommendedAction}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  No lifecycle attention items are currently flagged.
                </p>
              )}
            </div>
          </div>

          {/* Opportunities */}
          {opportunities.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-3">
                Opportunities
                <span className="ml-2 normal-case font-normal">{opportunities.length}</span>
              </h2>
              <div className="space-y-2">
                {opportunities.map((o) => (
                  <Link
                    key={o.id}
                    href={`/customer/opportunities/${o.id}`}
                    className="block p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]"
                  >
                    <p className="text-xs text-[var(--dpf-text)]">{o.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-[var(--dpf-muted)]">{o.stage}</span>
                      <span className="text-[9px] text-[var(--dpf-muted)]">{o.probability}%</span>
                      {o.expectedValue && (
                        <span className="text-[9px] font-mono text-[var(--dpf-text)]">
                          £{Number(o.expectedValue).toLocaleString()}
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Parent / child accounts */}
          {account.parentAccount && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Parent Account
              </h2>
              <Link
                href={`/customer/${account.parentAccount.id}`}
                className="block p-3 rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)]"
              >
                <p className="text-xs text-[var(--dpf-text)]">{account.parentAccount.name}</p>
              </Link>
            </div>
          )}

          {account.childAccounts.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Subsidiaries
              </h2>
              <div className="space-y-1">
                {account.childAccounts.map((child) => (
                  <Link
                    key={child.id}
                    href={`/customer/${child.id}`}
                    className="block p-2 rounded bg-[var(--dpf-surface-1)] text-xs text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
                  >
                    {child.name}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {account.notes && (
            <div>
              <h2 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-widest mb-2">
                Notes
              </h2>
              <p className="text-xs text-[var(--dpf-muted)] whitespace-pre-wrap">
                {account.notes}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-6">
          <CustomerLifecycleReviewQueues
            counts={estateSummary.reviewQueueCounts}
            queues={estateSummary.reviewQueues}
          />
        </div>

        <div className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                Managed Items
                <span className="ml-2 normal-case font-normal">{account.configurationItems.length}</span>
              </h2>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                Archetype-seeded managed item categories, lifecycle review cadence, and billing-readiness options.
              </p>
            </div>
            <NewCustomerConfigurationItemButton
              accountId={account.id}
              siteOptions={account.customerSites.map((site) => ({ id: site.id, name: site.name }))}
              itemTypeOptions={itemTypeOptions}
              chargeModelOptions={chargeModelOptions}
            />
          </div>

          {account.configurationItems.length > 0 ? (
            <div className="grid grid-cols-1 gap-2">
              {account.configurationItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-[var(--dpf-text)]">{item.name}</p>
                        <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                          {item.ciType}
                        </span>
                        <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                          {item.technologySourceType.replace("_", " ")}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-[var(--dpf-muted)]">
                        <span>{item.customerCiId}</span>
                        {item.site ? <span>Site: {item.site.name}</span> : <span>Site: unassigned</span>}
                        <span>Lifecycle: {item.lifecycleStatus}</span>
                        {item.recommendedAction ? <span>Action: {item.recommendedAction}</span> : null}
                        {item.billingCadence ? <span>Billing: {item.billingCadence}</span> : null}
                        {item.customerChargeModel ? <span>Charge: {item.customerChargeModel}</span> : null}
                        {typeof item.lifecycleConfidence === "number" ? (
                          <span>Confidence: {Math.round(item.lifecycleConfidence * 100)}%</span>
                        ) : null}
                      </div>
                      {item.lifecycleEvidence && typeof item.lifecycleEvidence === "object" ? (
                        <div className="mt-2 text-[10px] text-[var(--dpf-muted)]">
                          {"source" in item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence.source === "string" &&
                          item.lifecycleEvidence.source.length > 0 ? (
                            <p>Evidence: {item.lifecycleEvidence.source}</p>
                          ) : null}
                          {"notes" in item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence.notes === "string" &&
                          item.lifecycleEvidence.notes.length > 0 ? (
                            <p>{item.lifecycleEvidence.notes}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <EditCustomerConfigurationItemButton
                      accountId={account.id}
                      siteOptions={account.customerSites.map((site) => ({ id: site.id, name: site.name }))}
                      itemTypeOptions={itemTypeOptions}
                      chargeModelOptions={chargeModelOptions}
                      item={{
                        id: item.id,
                        customerCiId: item.customerCiId,
                        name: item.name,
                        siteId: item.siteId,
                        ciType: item.ciType,
                        technologySourceType: normalizeTechnologySourceType(
                          item.technologySourceType,
                        ),
                        supportModel: item.supportModel,
                        observedVersion: item.observedVersion,
                        normalizedVersion: item.normalizedVersion,
                        renewalDate: item.renewalDate?.toISOString() ?? null,
                        endOfSupportAt: item.endOfSupportAt?.toISOString() ?? null,
                        endOfLifeAt: item.endOfLifeAt?.toISOString() ?? null,
                        warrantyEndAt: item.warrantyEndAt?.toISOString() ?? null,
                        licenseQuantity:
                          item.licenseQuantity !== null && item.licenseQuantity !== undefined
                            ? Number(item.licenseQuantity)
                            : null,
                        billingCadence: item.billingCadence,
                        customerChargeModel: item.customerChargeModel,
                        evidenceSource:
                          item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence === "object" &&
                          "source" in item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence.source === "string"
                            ? item.lifecycleEvidence.source
                            : null,
                        evidenceNotes:
                          item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence === "object" &&
                          "notes" in item.lifecycleEvidence &&
                          typeof item.lifecycleEvidence.notes === "string"
                            ? item.lifecycleEvidence.notes
                            : null,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
              <p className="text-sm text-[var(--dpf-muted)]">
                No managed items registered yet. The MSP archetype can seed defaults like security licensing, Linux servers, and M365 tenants here.
              </p>
            </div>
          )}
        </div>

        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              Site Records
              <span className="ml-2 normal-case font-normal">{account.customerSites.length}</span>
            </h2>
            <p className="mt-1 text-xs text-[var(--dpf-muted)]">
              Operational customer sites and nested sublocations.
            </p>
          </div>
          <NewCustomerSiteButton accountId={account.id} />
        </div>

        <CustomerSiteTree accountId={account.id} sites={account.customerSites} />
      </div>
    </div>
  );
}
