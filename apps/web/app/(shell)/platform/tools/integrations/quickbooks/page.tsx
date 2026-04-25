import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { decryptJson } from "@/lib/govern/credential-crypto";
import {
  QuickBooksConnectPanel,
  type QuickBooksConnectionState,
} from "@/components/integrations/QuickBooksConnectPanel";

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

  const record = await prisma.integrationCredential.findUnique({
    where: { integrationId: "quickbooks-online-accounting" },
  });

  const initialState = toConnectionState(record);

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

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): QuickBooksConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      companyName: null,
      realmId: null,
      lastErrorMsg: null,
      lastTestedAt: null,
      environment: null,
    };
  }

  const decoded = decryptJson<{
    companyName?: string;
    realmId?: string;
    environment?: string;
  }>(record.fieldsEnc);

  return {
    status: record.status === "connected" || record.status === "error" ? record.status : "unconfigured",
    companyName: typeof decoded?.companyName === "string" ? decoded.companyName : null,
    realmId: typeof decoded?.realmId === "string" ? decoded.realmId : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
    environment:
      decoded?.environment === "sandbox" || decoded?.environment === "production"
        ? decoded.environment
        : null,
  };
}
