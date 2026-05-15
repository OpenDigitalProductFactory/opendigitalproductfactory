import type {
  CommandSeverity,
  ReadinessState,
  WorkspaceCommandCenterView,
} from "@/lib/workspace/command-center";

type Props = {
  view: WorkspaceCommandCenterView;
};

const severityClass: Record<CommandSeverity, string> = {
  critical: "border-[var(--dpf-error)] text-[var(--dpf-error)]",
  warning: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  info: "border-[var(--dpf-info)] text-[var(--dpf-info)]",
};

const stateClass: Record<ReadinessState, string> = {
  good: "border-[var(--dpf-success)] text-[var(--dpf-success)]",
  attention: "border-[var(--dpf-warning)] text-[var(--dpf-warning)]",
  blocked: "border-[var(--dpf-error)] text-[var(--dpf-error)]",
  unknown: "border-[var(--dpf-border)] text-[var(--dpf-muted)]",
};

const stateLabel: Record<ReadinessState, string> = {
  good: "Good",
  attention: "Attention",
  blocked: "Blocked",
  unknown: "Unknown",
};

export function BusinessCommandCenter({ view }: Props) {
  return (
    <section aria-labelledby="business-command-center-title" className="mb-6 space-y-4">
      <div className="flex flex-col gap-3 border-b border-[var(--dpf-border)] pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Workspace home</p>
          <h2 id="business-command-center-title" className="mt-1 text-2xl font-semibold text-[var(--dpf-text)]">
            Command Center
          </h2>
        </div>
        <a
          href="/platform/ai/operations-map"
          className="inline-flex w-fit items-center rounded-md border border-[var(--dpf-border)] px-3 py-2 text-sm font-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)]"
        >
          AI Operations Map
        </a>
      </div>

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="border-b border-[var(--dpf-border)] px-4 py-3">
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Needs attention</p>
        </div>
        <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
          {view.commandStrip.length > 0 ? (
            view.commandStrip.map((item) => (
              <a
                key={item.id}
                href={item.href}
                className="min-h-24 border-b border-[var(--dpf-border)] px-4 py-3 hover:bg-[var(--dpf-surface-2)] md:border-r xl:last:border-r-0"
              >
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${severityClass[item.severity]}`}
                >
                  {item.severity}
                </span>
                <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">{item.description}</p>
              </a>
            ))
          ) : (
            <div className="px-4 py-6 text-sm text-[var(--dpf-muted)]">
              No urgent command-center items right now.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {view.snapshot.map((item) => (
          <a
            key={item.id}
            href={item.href}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3 hover:bg-[var(--dpf-surface-2)]"
          >
            <p className="text-[11px] font-semibold uppercase text-[var(--dpf-muted)]">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--dpf-text)]">{item.value}</p>
          </a>
        ))}
      </div>

      <div className="grid gap-3 md:hidden">
        {view.readiness.map((row) => (
          <section key={row.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <a href={row.href} className="text-sm font-semibold text-[var(--dpf-text)] hover:text-[var(--dpf-accent)]">
              {row.label}
            </a>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {row.cells.map((cell) => (
                <a
                  key={`${row.id}-${cell.key}`}
                  href={cell.href ?? row.href}
                  className={`flex min-h-16 flex-col justify-between rounded-md border px-3 py-2 text-xs ${stateClass[cell.state]}`}
                  title={`${cell.label}: ${stateLabel[cell.state]}`}
                >
                  <span className="font-semibold text-[var(--dpf-muted)]">{cell.label}</span>
                  <span className="font-semibold">{stateLabel[cell.state]}</span>
                </a>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] md:block">
        <table className="w-full min-w-[760px] table-fixed text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--dpf-border)]">
              <th className="w-44 px-4 py-3 text-xs font-semibold uppercase text-[var(--dpf-muted)]">Domain</th>
              {view.readiness[0]?.cells.map((cell) => (
                <th key={cell.key} className="px-3 py-3 text-xs font-semibold uppercase text-[var(--dpf-muted)]">
                  {cell.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.readiness.map((row) => (
              <tr key={row.id} className="border-b border-[var(--dpf-border)] last:border-b-0">
                <th className="px-4 py-3 align-middle font-medium text-[var(--dpf-text)]">
                  <a href={row.href} className="hover:text-[var(--dpf-accent)]">
                    {row.label}
                  </a>
                </th>
                {row.cells.map((cell) => (
                  <td key={`${row.id}-${cell.key}`} className="px-3 py-3 align-middle">
                    <a
                      href={cell.href ?? row.href}
                      className={`inline-flex min-w-20 justify-center rounded-full border px-2 py-1 text-[11px] font-semibold ${stateClass[cell.state]}`}
                      title={`${cell.label}: ${stateLabel[cell.state]}`}
                    >
                      {stateLabel[cell.state]}
                    </a>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
        <div className="border-b border-[var(--dpf-border)] px-4 py-3">
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">Human and AI work in motion</p>
        </div>
        <div className="grid gap-0 md:grid-cols-2 xl:grid-cols-3">
          {view.workInMotion.map((item) => (
            <a
              key={item.id}
              href={item.href}
              className="min-h-20 border-b border-[var(--dpf-border)] px-4 py-3 hover:bg-[var(--dpf-surface-2)] md:border-r xl:last:border-r-0"
            >
              <p className="text-sm font-semibold text-[var(--dpf-text)]">{item.label}</p>
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">{item.actor}</p>
              <span className="mt-2 inline-flex rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--dpf-muted)]">
                {item.status}
              </span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
