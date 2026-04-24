import { prisma } from "@dpf/db";
import { EntraConnectPanel } from "@/components/integrations/EntraConnectPanel";
import { FederationAuthorityCard } from "@/components/platform/identity/FederationAuthorityCard";

export default async function PlatformIdentityFederationPage() {
  const [credentials, linkedAliasCount] = await Promise.all([
    prisma.integrationCredential.findMany({
      where: {
        provider: {
          in: ["entra", "ldap", "active_directory"],
        },
      },
      orderBy: [{ provider: "asc" }, { updatedAt: "desc" }],
    }),
    prisma.principalAlias.count(),
  ]);

  const entra = credentials.find((credential) => credential.provider === "entra");
  const ldap = credentials.find((credential) =>
    credential.provider === "ldap" || credential.provider === "active_directory",
  );

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Federation</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          Connect upstream authorities for sign-in and directory bootstrap while DPF remains the authorization source of truth.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <EntraConnectPanel
          state={{
            status: normalizeStatus(entra?.status),
            lastTestedAt: entra?.lastTestedAt?.toISOString() ?? null,
            lastErrorMsg: entra?.lastErrorMsg ?? null,
          }}
        />

        <div className="space-y-4">
          <FederationAuthorityCard
            title="LDAP / Active Directory"
            badge="Upstream authority"
            description="Support existing LDAP and Active Directory estates without making them the source of route and coworker authorization inside DPF."
            status={normalizeStatus(ldap?.status)}
            ownershipLabel="Directory facts, legacy app compatibility, and bind/search authority where needed."
            dpfAuthorityLabel="Platform roles, route bundles, coworker associations, and AI workforce identity semantics."
            href="/platform/identity/federation#ldap"
            lastTestedAt={ldap?.lastTestedAt?.toISOString() ?? null}
            lastErrorMsg={ldap?.lastErrorMsg ?? null}
          />

          <div
            id="ldap"
            className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
          >
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Authority model
            </p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              Use LDAP and Active Directory as read-first upstream sources. DPF normalizes identities,
              groups, and manager context into local principal, route, and coworker policy rather than
              letting external directories co-own platform authorization.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Current coverage
            </p>
            <p className="mt-2 text-sm text-[var(--dpf-text)]">
              {linkedAliasCount} linked aliases are already available for identity bridging across workforce, AI coworker, and future app federation.
            </p>
          </div>
          <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-text)]">
            DPF remains the authorization source of truth
          </span>
        </div>
      </div>
    </section>
  );
}

function normalizeStatus(status: string | null | undefined): "connected" | "unconfigured" | "error" | "expired" {
  if (status === "connected" || status === "error" || status === "expired") {
    return status;
  }
  return "unconfigured";
}
