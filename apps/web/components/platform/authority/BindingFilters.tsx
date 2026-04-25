import type { ReactNode } from "react";

type BindingFiltersProps = {
  actionHref: string;
  currentFilters: {
    status?: string;
    resource?: string;
    coworker?: string;
    subject?: string;
  };
  options: {
    statuses: string[];
    resourceRefs: string[];
    appliedAgents: Array<{
      agentId: string;
      agentName: string;
    }>;
    subjectRefs: string[];
  };
  resultCount: number;
  actions?: ReactNode;
};

function selectClassName() {
  return "w-full rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-text)]";
}

export function BindingFilters({
  actionHref,
  currentFilters,
  options,
  resultCount,
  actions,
}: BindingFiltersProps) {
  return (
    <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Filter bindings</h3>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            Narrow the shared authority view by route, coworker, subject, or lifecycle status.
          </p>
        </div>
        <div className="text-xs text-[var(--dpf-muted)]">{resultCount} binding row(s)</div>
      </div>

      <form action={actionHref} className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="block text-sm text-[var(--dpf-text)]">
          <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Status</span>
          <select name="status" defaultValue={currentFilters.status ?? ""} className={selectClassName()}>
            <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="">
              All statuses
            </option>
            {options.statuses.map((status) => (
              <option key={status} value={status} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {status}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-[var(--dpf-text)]">
          <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Resource</span>
          <select name="resource" defaultValue={currentFilters.resource ?? ""} className={selectClassName()}>
            <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="">
              All resources
            </option>
            {options.resourceRefs.map((resourceRef) => (
              <option key={resourceRef} value={resourceRef} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {resourceRef}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-[var(--dpf-text)]">
          <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Coworker</span>
          <select name="coworker" defaultValue={currentFilters.coworker ?? ""} className={selectClassName()}>
            <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="">
              All coworkers
            </option>
            {options.appliedAgents.map((agent) => (
              <option key={agent.agentId} value={agent.agentId} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {agent.agentName}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm text-[var(--dpf-text)]">
          <span className="mb-1 block text-xs uppercase tracking-[0.08em] text-[var(--dpf-muted)]">Subject</span>
          <select name="subject" defaultValue={currentFilters.subject ?? ""} className={selectClassName()}>
            <option className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]" value="">
              All subjects
            </option>
            {options.subjectRefs.map((subjectRef) => (
              <option key={subjectRef} value={subjectRef} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                {subjectRef}
              </option>
            ))}
          </select>
        </label>

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-lg bg-[var(--dpf-accent)] px-4 py-2 text-sm font-medium text-white"
          >
            Apply filters
          </button>
          <a
            href={actionHref}
            className="rounded-lg border border-[var(--dpf-border)] px-4 py-2 text-sm text-[var(--dpf-text)]"
          >
            Reset filters
          </a>
          {actions}
        </div>
      </form>
    </section>
  );
}
