import type { PortalContextEnvelope } from "@/lib/portal-context";

export function PortalContextSummaryRows({ envelope }: { envelope: PortalContextEnvelope }) {
  const rows = [
    ["Route", envelope.route.routeContext],
    ["Domain", envelope.route.domain],
    ["Build", envelope.work.featureBuild?.buildId ?? "None"],
    ["Workroom", envelope.work.capsule?.capsuleId ?? "None"],
    ["Backlog", envelope.work.backlogItem?.backlogItemId ?? "None"],
    ["Branch", envelope.work.branch?.branchName ?? "None"],
  ];

  return (
    <dl className="grid gap-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[7rem_1fr] gap-3 border-b border-[var(--dpf-border)] pb-2 last:border-b-0 last:pb-0">
          <dt className="text-xs font-medium uppercase tracking-normal text-[var(--dpf-muted)]">{label}</dt>
          <dd className="min-w-0 truncate text-[var(--dpf-text)]">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
