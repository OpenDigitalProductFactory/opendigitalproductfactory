import { FederationAuthorityCard } from "@/components/platform/identity/FederationAuthorityCard";

export type EntraConnectionState = {
  status: "connected" | "unconfigured" | "error" | "expired";
  lastTestedAt: string | null;
  lastErrorMsg: string | null;
};

export function EntraConnectPanel({ state }: { state: EntraConnectionState }) {
  return (
    <div id="entra" className="space-y-4">
      <FederationAuthorityCard
        title="Microsoft Entra"
        badge="Upstream authority"
        description="Use Entra for workforce sign-in and directory bootstrap when a company already runs on the Microsoft identity stack."
        status={state.status}
        ownershipLabel="Tenant sign-in posture, upstream group bootstrap, and workforce directory facts."
        dpfAuthorityLabel="Route access, coworker authority, local group meaning, and principal linking for humans and agents."
        href="/platform/identity/federation#entra-guide"
        lastTestedAt={state.lastTestedAt}
        lastErrorMsg={state.lastErrorMsg}
      />

      <div
        id="entra-guide"
        className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
          Setup guidance
        </p>
        <p className="mt-2 text-sm text-[var(--dpf-text)]">
          Start by connecting Entra as an upstream authority for human sign-in and group bootstrap.
          DPF then maps imported workforce context into local groups, route bundles, and coworker
          approvals instead of delegating authorization decisions upstream.
        </p>
      </div>
    </div>
  );
}
