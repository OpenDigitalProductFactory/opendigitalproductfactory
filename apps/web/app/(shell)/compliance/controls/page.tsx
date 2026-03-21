import { listControls } from "@/lib/actions/compliance";
import { CreateControlForm } from "@/components/compliance/CreateControlForm";
import Link from "next/link";

const STATUS_COLORS: Record<string, string> = {
  implemented: "bg-green-900/30 text-green-400",
  "in-progress": "bg-yellow-900/30 text-yellow-400",
  planned: "bg-blue-900/30 text-blue-400",
  "not-applicable": "bg-gray-900/30 text-gray-400",
};

type Props = { searchParams: Promise<{ controlType?: string; implementationStatus?: string; effectiveness?: string }> };

export default async function ControlsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const filters = {
    ...(sp.controlType && { controlType: sp.controlType }),
    ...(sp.implementationStatus && { implementationStatus: sp.implementationStatus }),
    ...(sp.effectiveness && { effectiveness: sp.effectiveness }),
  };
  const hasFilters = Object.keys(filters).length > 0;
  const controls = await listControls(hasFilters ? filters : undefined);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">Controls</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">{controls.length} active</p>
        </div>
        <CreateControlForm />
      </div>

      {/* Filter bar */}
      <form className="flex flex-wrap gap-3 mb-6">
        <select name="controlType" defaultValue={sp.controlType ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All types</option>
          <option value="preventive">Preventive</option>
          <option value="detective">Detective</option>
          <option value="corrective">Corrective</option>
        </select>

        <select name="implementationStatus" defaultValue={sp.implementationStatus ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All statuses</option>
          <option value="planned">Planned</option>
          <option value="in-progress">In Progress</option>
          <option value="implemented">Implemented</option>
          <option value="not-applicable">Not Applicable</option>
        </select>

        <select name="effectiveness" defaultValue={sp.effectiveness ?? ""}
          className="text-xs px-2 py-1.5 rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]">
          <option value="">All effectiveness</option>
          <option value="effective">Effective</option>
          <option value="partially-effective">Partially Effective</option>
          <option value="ineffective">Ineffective</option>
          <option value="not-assessed">Not Assessed</option>
        </select>

        <button type="submit"
          className="text-xs px-3 py-1.5 rounded-md bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity">
          Filter
        </button>

        {hasFilters && (
          <Link href="/compliance/controls"
            className="text-xs px-3 py-1.5 rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors">
            Clear
          </Link>
        )}
      </form>

      {controls.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">No controls match the current filters.</p>
      ) : (
        <div className="space-y-2">
          {controls.map((c) => (
            <Link key={c.id} href={`/compliance/controls/${c.id}`}
              className="block p-3 rounded-lg border border-[var(--dpf-border)] hover:border-[var(--dpf-accent)] transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-sm text-[var(--dpf-text)]">{c.title}</span>
                  <div className="flex gap-2 mt-1">
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{c.controlType}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${STATUS_COLORS[c.implementationStatus] ?? "bg-gray-900/30 text-gray-400"}`}>
                      {c.implementationStatus}
                    </span>
                    {c.effectiveness && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">{c.effectiveness}</span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-[var(--dpf-muted)]">
                  <p>{c._count.obligations} obligation{c._count.obligations !== 1 ? "s" : ""}</p>
                  {c.ownerEmployee && <p>{c.ownerEmployee.displayName}</p>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
