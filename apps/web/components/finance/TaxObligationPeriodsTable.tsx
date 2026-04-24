type PeriodRecord = {
  id: string;
  periodId: string;
  status: string;
  dueDate: Date | string;
  periodStart: Date | string;
  periodEnd: Date | string;
  registration: {
    taxType: string;
    jurisdictionReference: {
      authorityName: string;
      countryCode: string;
      stateProvinceCode: string | null;
    };
  };
};

type Props = {
  periods: PeriodRecord[];
};

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-GB");
}

export function TaxObligationPeriodsTable({ periods }: Props) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Obligation Periods
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Filing periods will appear here as registrations mature into tracked remittance workflows.
          </p>
        </div>
        <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
          {periods.length} tracked
        </span>
      </div>

      {periods.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
          No obligation periods have been generated yet.
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-normal">Authority</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-normal">Tax</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-normal">Period</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-normal">Due</th>
                <th className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period.id} className="border-b border-[var(--dpf-border)] last:border-0">
                  <td className="px-3 py-3 text-[var(--dpf-text)]">
                    {period.registration.jurisdictionReference.authorityName}
                  </td>
                  <td className="px-3 py-3 text-[var(--dpf-muted)]">{period.registration.taxType}</td>
                  <td className="px-3 py-3 text-[var(--dpf-muted)]">
                    {formatDate(period.periodStart)} - {formatDate(period.periodEnd)}
                  </td>
                  <td className="px-3 py-3 text-[var(--dpf-text)]">{formatDate(period.dueDate)}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      {period.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
