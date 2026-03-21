// apps/web/app/(portal)/portal/page.tsx
// Customer dashboard — self-service home page.
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";

export default async function CustomerDashboardPage() {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/customer-login");

  const user = session.user;

  // Fetch customer account data
  const account = user.accountId
    ? await prisma.customerAccount.findUnique({
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
    : null;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Welcome, {account?.name ?? "Customer"}
        </h1>
        <p style={{ fontSize: 13, color: "var(--dpf-muted)", marginTop: 4 }}>
          Account {user.accountId}
        </p>
      </div>

      {/* Quick actions grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 32 }}>
        <DashboardCard
          title="Orders"
          description="View your order history and track deliveries"
          href="/portal/orders"
          color="#38bdf8"
          count={0}
          countLabel="active"
        />
        <DashboardCard
          title="Services"
          description="Manage your active services and subscriptions"
          href="/portal/services"
          color="#4ade80"
          count={0}
          countLabel="active"
        />
        <DashboardCard
          title="Support"
          description="Get help or submit a support request"
          href="/portal/support"
          color="#a78bfa"
          count={0}
          countLabel="open tickets"
        />
        <DashboardCard
          title="Account"
          description="Manage your account settings and contacts"
          href="/portal/account"
          color="#fb923c"
          count={account?.contacts.length ?? 0}
          countLabel="contacts"
        />
      </div>

      {/* Account info */}
      <div style={{
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderRadius: 8,
        padding: 20,
      }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 12 }}>
          Account Details
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "8px 16px", fontSize: 13 }}>
          <span style={{ color: "var(--dpf-muted)" }}>Account ID</span>
          <span style={{ color: "var(--dpf-text)", fontFamily: "monospace" }}>{user.accountId}</span>
          <span style={{ color: "var(--dpf-muted)" }}>Company</span>
          <span style={{ color: "var(--dpf-text)" }}>{account?.name}</span>
          <span style={{ color: "var(--dpf-muted)" }}>Status</span>
          <span style={{
            color: account?.status === "active" ? "#4ade80" : "#fbbf24",
          }}>{account?.status}</span>
          <span style={{ color: "var(--dpf-muted)" }}>Contacts</span>
          <span style={{ color: "var(--dpf-text)" }}>{account?.contacts.length ?? 0}</span>
        </div>
      </div>
    </div>
  );
}

function DashboardCard({ title, description, href, color, count, countLabel }: {
  title: string;
  description: string;
  href: string;
  color: string;
  count: number;
  countLabel: string;
}) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: 16,
        background: "var(--dpf-surface-1)",
        border: "1px solid var(--dpf-border)",
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        textDecoration: "none",
        transition: "background 0.15s",
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--dpf-text)", marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 11, color: "var(--dpf-muted)", marginBottom: 8 }}>{description}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>
        {count}
        <span style={{ fontSize: 10, color: "var(--dpf-muted)", marginLeft: 4 }}>{countLabel}</span>
      </div>
    </a>
  );
}
