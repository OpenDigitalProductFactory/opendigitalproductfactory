// apps/web/app/(portal)/portal/page.tsx
// Customer dashboard — self-service home page.
import type { ReactNode } from "react";
import { BriefcaseBusiness, LifeBuoy, Package, Settings, Wrench } from "lucide-react";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { StatusBadge } from "@/components/ui/report-kit";
import {
  loadPortalWorkCaseList,
  type PortalCasePrismaClient,
} from "@/lib/work-management/portal-case-loader";

export default async function CustomerDashboardPage() {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/customer-login");

  const user = session.user;

  // Fetch customer account data
  const [account, caseView] = await Promise.all([
    user.accountId
      ? prisma.customerAccount.findUnique({
          where: { accountId: user.accountId },
          select: {
            name: true,
            status: true,
            accountId: true,
            contacts: {
              select: { email: true, isActive: true },
            },
          },
        })
      : null,
    user.accountId
      ? loadPortalWorkCaseList({
          prismaClient: prisma as unknown as PortalCasePrismaClient,
          customerAccountId: user.accountId,
          limit: 20,
        })
      : null,
  ]);
  const accountStatusIntent =
    account?.status === "active"
      ? "success"
      : account?.status === "suspended" || account?.status === "closed"
        ? "danger"
        : "warning";

  return (
    <div className="space-y-6 text-[var(--dpf-text)]">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">
          Welcome, {account?.name ?? "Customer"}
        </h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Account {user.accountId}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardCard
          title="Cases"
          description="Track requests and service updates"
          href="/portal/cases"
          accentVar="var(--dpf-accent)"
          icon={<BriefcaseBusiness className="size-4" aria-hidden="true" />}
          count={caseView?.stats.total ?? 0}
          countLabel="open"
          attentionCount={caseView?.stats.needsResponse ?? 0}
        />
        <DashboardCard
          title="Orders"
          description="View your order history and track deliveries"
          href="/portal/orders"
          accentVar="var(--dpf-info)"
          icon={<Package className="size-4" aria-hidden="true" />}
        />
        <DashboardCard
          title="Services"
          description="Manage your active services and subscriptions"
          href="/portal/services"
          accentVar="var(--dpf-success)"
          icon={<Wrench className="size-4" aria-hidden="true" />}
        />
        <DashboardCard
          title="Support"
          description="Get help or submit a support request"
          href="/portal/support"
          accentVar="var(--dpf-warning)"
          icon={<LifeBuoy className="size-4" aria-hidden="true" />}
        />
        <DashboardCard
          title="Account"
          description="Manage your account settings and contacts"
          href="/portal/account"
          accentVar="var(--dpf-muted)"
          icon={<Settings className="size-4" aria-hidden="true" />}
          count={account?.contacts.length ?? 0}
          countLabel="contacts"
        />
      </div>

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">
          Account Details
        </h2>
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Account ID</p>
            <p className="mt-1 font-mono text-sm text-[var(--dpf-text)]">{user.accountId}</p>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Company</p>
            <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">{account?.name ?? "Unlinked"}</p>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Status</p>
            <div className="mt-1">
              <StatusBadge intent={accountStatusIntent} label={account?.status ?? "unknown"} variant="soft" />
            </div>
          </div>
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
            <p className="text-xs text-[var(--dpf-muted)]">Contacts</p>
            <p className="mt-1 text-sm font-medium text-[var(--dpf-text)]">{account?.contacts.length ?? 0}</p>
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardCard({ title, description, href, accentVar, icon, count, countLabel, attentionCount = 0 }: {
  title: string;
  description: string;
  href: string;
  accentVar: string;
  icon: ReactNode;
  count?: number;
  countLabel?: string;
  attentionCount?: number;
}) {
  return (
    <a
      href={href}
      className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)] no-underline transition-colors hover:bg-[var(--dpf-surface-2)]"
      style={{
        borderLeft: `3px solid ${accentVar}`,
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="inline-flex size-8 items-center justify-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
          {icon}
        </div>
        {attentionCount > 0 ? <StatusBadge intent="warning" label={`${attentionCount} needs reply`} /> : null}
      </div>
      <div className="text-sm font-semibold text-[var(--dpf-text)]">{title}</div>
      <div className="mt-1 min-h-10 text-xs leading-5 text-[var(--dpf-muted)]">{description}</div>
      {count !== undefined && (
        <div className="mt-3 text-xl font-semibold text-[var(--dpf-text)]">
          {count}
          <span className="ml-1 text-xs font-normal text-[var(--dpf-muted)]">{countLabel}</span>
        </div>
      )}
    </a>
  );
}
