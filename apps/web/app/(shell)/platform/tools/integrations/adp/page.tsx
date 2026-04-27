import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { AdpConnectPanel, type AdpConnectionState } from "@/components/integrations/AdpConnectPanel";
import { decryptJson } from "@/lib/govern/credential-crypto";

// Enterprise integration: customer-configured ADP API Central connection.
// DPF is a conduit — customer brings their own API Central account and mTLS cert;
// DPF stores the credentials encrypted in this install and never phones home.

export default async function AdpIntegrationPage() {
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
    where: { integrationId: "adp-workforce-now" },
  });

  const initialState = toConnectionState(record);

  return (
    <div className="p-6 space-y-6">
      <div>
        <div className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <a href="/platform/tools" className="hover:underline">
            Tools
          </a>
          <span>/</span>
          <a href="/platform/tools/integrations" className="hover:underline">
            Enterprise Integrations
          </a>
          <span>/</span>
          <span>ADP</span>
        </div>
        <h1 className="mt-1 text-2xl font-bold">ADP Workforce Now</h1>
        <p className="text-sm text-[var(--dpf-muted)]">
          Customer-configured integration. Your ADP API Central credentials stay in this install —
          DPF does not enroll in ADP&rsquo;s partner program.
        </p>
      </div>

      <AdpConnectPanel initialState={initialState} />

      <aside className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface)] p-4 text-sm">
        <h2 className="font-semibold">What this integration enables</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--dpf-muted)]">
          <li>Payroll Specialist coworker can answer worker, pay statement, time card, and deduction questions.</li>
          <li>All ADP calls run through the dedicated <code>adp</code> MCP service container over mTLS.</li>
          <li>PII (SSN, bank routing, DOB) is redacted before any data reaches LLM context.</li>
          <li>Every call is recorded in the admin audit log at <a className="underline" href="/admin/integrations/audit">Integrations Audit</a>.</li>
        </ul>
      </aside>
    </div>
  );
}

type IntegrationCredentialRow = Awaited<
  ReturnType<typeof prisma.integrationCredential.findUnique>
>;

function toConnectionState(record: IntegrationCredentialRow): AdpConnectionState {
  if (!record) {
    return {
      status: "unconfigured",
      certExpiresAt: null,
      lastErrorMsg: null,
      lastTestedAt: null,
      environment: null,
    };
  }

  const status = normalizeStatus(record.status, record.certExpiresAt);
  const environment = extractEnvironment(record.fieldsEnc);

  return {
    status,
    certExpiresAt: record.certExpiresAt ? record.certExpiresAt.toISOString() : null,
    lastErrorMsg: record.lastErrorMsg,
    lastTestedAt: record.lastTestedAt ? record.lastTestedAt.toISOString() : null,
    environment,
  };
}

function normalizeStatus(
  raw: string,
  certExpiresAt: Date | null,
): AdpConnectionState["status"] {
  if (raw === "connected" && certExpiresAt && certExpiresAt.getTime() < Date.now()) {
    return "expired";
  }
  if (raw === "connected" || raw === "error" || raw === "expired") return raw;
  return "unconfigured";
}

function extractEnvironment(fieldsEnc: string): "sandbox" | "production" | null {
  const decoded = decryptJson<{ environment?: string }>(fieldsEnc);
  if (decoded?.environment === "sandbox" || decoded?.environment === "production") {
    return decoded.environment;
  }
  return null;
}
