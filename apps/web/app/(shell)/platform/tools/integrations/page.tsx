import { prisma } from "@dpf/db";

export default async function EnterpriseIntegrationsPage() {
  const adpCredential = await prisma.integrationCredential.findUnique({
    where: { integrationId: "adp-workforce-now" },
    select: { status: true, certExpiresAt: true, lastTestedAt: true },
  });

  const statusLabel =
    adpCredential?.status === "connected"
      ? "Connected"
      : adpCredential?.status === "error"
      ? "Needs attention"
      : "Not connected";

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Enterprise Integrations</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Native customer-configured integrations use dedicated setup, credential custody, and audit flows instead of the generic MCP activation form.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--dpf-muted)]">HR / Payroll</p>
              <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">ADP Workforce Now</h2>
            </div>
            <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)]">
              {statusLabel}
            </span>
          </div>

          <p className="mt-3 text-sm text-[var(--dpf-muted)]">
            Customer-owned ADP API Central credentials, mTLS exchange, payroll-specialist routing, and redaction-aware payroll tooling.
          </p>

          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--dpf-muted)]">Auth</dt>
              <dd className="text-[var(--dpf-text)]">OAuth client credentials + mTLS</dd>
            </div>
            <div>
              <dt className="text-[var(--dpf-muted)]">Execution</dt>
              <dd className="text-[var(--dpf-text)]">Native setup flow</dd>
            </div>
            <div>
              <dt className="text-[var(--dpf-muted)]">Last tested</dt>
              <dd className="text-[var(--dpf-text)]">
                {adpCredential?.lastTestedAt ? adpCredential.lastTestedAt.toLocaleString() : "Not yet tested"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dpf-muted)]">Cert expiry</dt>
              <dd className="text-[var(--dpf-text)]">
                {adpCredential?.certExpiresAt ? adpCredential.certExpiresAt.toLocaleDateString() : "Not configured"}
              </dd>
            </div>
          </dl>

          <div className="mt-5">
            <a
              href="/platform/tools/integrations/adp"
              className="text-sm font-medium text-[var(--dpf-accent)] hover:underline"
            >
              Open ADP setup →
            </a>
          </div>
        </article>
      </div>
    </div>
  );
}
