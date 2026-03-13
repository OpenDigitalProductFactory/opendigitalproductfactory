type DelegationGrantRow = {
  grantId: string;
  agentName: string;
  grantorLabel: string;
  status: string;
  expiresAt?: string | null;
  scopeSummary?: string | null;
};

type Props = {
  grants: DelegationGrantRow[];
};

function statusClasses(status: string): string {
  if (status === "active") return "bg-green-500/15 text-green-300";
  if (status === "revoked") return "bg-red-500/15 text-red-300";
  return "bg-white/10 text-[var(--dpf-muted)]";
}

export function DelegationGrantPanel({ grants }: Props) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Recent delegation grants</h2>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Human-issued temporary authority for governed agent workflows.
          </p>
        </div>
        <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] font-medium uppercase tracking-widest text-[var(--dpf-muted)]">
          Last {grants.length}
        </span>
      </div>

      {grants.length > 0 ? (
        <div className="mt-4 space-y-3">
          {grants.map((grant) => (
            <div
              key={grant.grantId}
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-mono text-[var(--dpf-muted)]">{grant.grantId}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{grant.agentName}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-widest ${statusClasses(grant.status)}`}>
                  {grant.status}
                </span>
              </div>
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">
                Granted by <span className="text-white">{grant.grantorLabel}</span>
                {grant.expiresAt ? ` until ${grant.expiresAt}` : ""}
              </p>
              {grant.scopeSummary ? (
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">{grant.scopeSummary}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-[var(--dpf-muted)]">
          No active delegation grants recorded yet.
        </p>
      )}
    </div>
  );
}
