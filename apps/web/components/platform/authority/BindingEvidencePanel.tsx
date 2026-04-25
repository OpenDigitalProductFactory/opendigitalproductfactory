type BindingEvidencePanelProps = {
  evidence: Array<{
    id: string;
    decisionId: string;
    decision: string;
    actionKey: string;
    routeContext: string | null;
    createdAt: Date;
  }>;
};

export function BindingEvidencePanel({ evidence }: BindingEvidencePanelProps) {
  return (
    <ul className="space-y-2 text-sm text-[var(--dpf-text)]">
      {evidence.length === 0 ? (
        <li className="text-[var(--dpf-muted)]">No authorization evidence linked yet.</li>
      ) : (
        evidence.map((item) => (
          <li key={item.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
            <div className="font-medium">{item.decisionId}</div>
            <div className="text-[var(--dpf-muted)]">
              {item.actionKey} · {item.decision}
              {item.routeContext ? ` · ${item.routeContext}` : ""}
            </div>
          </li>
        ))
      )}
    </ul>
  );
}
