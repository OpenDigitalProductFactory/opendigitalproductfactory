"use client";

import { useMetricQuery } from "./useMetricQuery";
import { SparkLine } from "./SparkLine";

type ContainerRow = {
  name: string;
  cpu: number | null;
  memory: number | null;
  restarts: number | null;
};

export function ContainerResourceTable() {
  const { data: cpuData, offline } = useMetricQuery(
    'rate(container_cpu_usage_seconds_total{name=~"dpf-.*"}[5m]) * 100',
  );
  const { data: memData } = useMetricQuery(
    'container_memory_usage_bytes{name=~"dpf-.*"}',
  );
  const { data: restartData } = useMetricQuery(
    'increase(container_restart_count{name=~"dpf-.*"}[1h])',
  );

  if (offline) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Container Resources
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">Monitoring offline</p>
      </section>
    );
  }

  // Merge data by container name
  const containers = new Map<string, ContainerRow>();

  for (const r of cpuData ?? []) {
    const name = r.metric.name ?? "unknown";
    const existing = containers.get(name) ?? { name, cpu: null, memory: null, restarts: null };
    existing.cpu = parseFloat(r.value[1]);
    containers.set(name, existing);
  }
  for (const r of memData ?? []) {
    const name = r.metric.name ?? "unknown";
    const existing = containers.get(name) ?? { name, cpu: null, memory: null, restarts: null };
    existing.memory = parseFloat(r.value[1]);
    containers.set(name, existing);
  }
  for (const r of restartData ?? []) {
    const name = r.metric.name ?? "unknown";
    const existing = containers.get(name) ?? { name, cpu: null, memory: null, restarts: null };
    existing.restarts = parseFloat(r.value[1]);
    containers.set(name, existing);
  }

  const rows = Array.from(containers.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  if (rows.length === 0) {
    return (
      <section>
        <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
          Container Resources
        </h3>
        <p className="text-xs text-[var(--dpf-muted)]">No container data</p>
      </section>
    );
  }

  return (
    <section>
      <h3 className="text-xs font-semibold text-[var(--dpf-muted)] uppercase tracking-wider mb-2">
        Container Resources
      </h3>
      <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
              <th className="text-left px-3 py-1.5 font-medium">Container</th>
              <th className="text-right px-3 py-1.5 font-medium">CPU</th>
              <th className="text-center px-2 py-1.5 font-medium w-20">Trend</th>
              <th className="text-right px-3 py-1.5 font-medium">Memory</th>
              <th className="text-right px-3 py-1.5 font-medium">Restarts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const hasRestarts = row.restarts !== null && row.restarts > 0;
              return (
                <tr
                  key={row.name}
                  className="border-t border-[var(--dpf-border)]"
                >
                  <td className="px-3 py-1.5 text-[var(--dpf-text)] font-mono">
                    {row.name.replace(/^dpf-/, "")}
                  </td>
                  <td className="px-3 py-1.5 text-right text-[var(--dpf-text)]">
                    {row.cpu !== null ? `${row.cpu.toFixed(1)}%` : "--"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <SparkLine
                      query={`rate(container_cpu_usage_seconds_total{name="${row.name}"}[5m]) * 100`}
                      width={80}
                      height={16}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right text-[var(--dpf-text)]">
                    {row.memory !== null ? formatBytes(row.memory) : "--"}
                  </td>
                  <td
                    className={`px-3 py-1.5 text-right ${
                      hasRestarts ? "text-yellow-500 font-semibold" : "text-[var(--dpf-text)]"
                    }`}
                  >
                    {row.restarts !== null ? Math.round(row.restarts) : "--"}
                    {hasRestarts ? " !" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)}MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)}KB`;
  return `${Math.round(bytes)}B`;
}
