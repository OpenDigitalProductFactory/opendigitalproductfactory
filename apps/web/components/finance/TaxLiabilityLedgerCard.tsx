"use client";

type LiabilityEntryRecord = {
  id: string;
  entryId: string;
  sourceType: string;
  direction: string;
  taxableAmount: unknown;
  taxAmount: unknown;
  currency: string;
  occurredAt: Date | string;
  notes: string | null;
};

type PeriodRecord = {
  id: string;
  periodId: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  registration: {
    taxType: string;
    jurisdictionReference: {
      authorityName: string;
    };
  };
  liabilityEntries?: LiabilityEntryRecord[];
};

type Props = {
  periods: PeriodRecord[];
};

function decimalValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return Number(value.toString()) || 0;
  }
  return 0;
}

function formatMoney(value: unknown, currency = "USD") {
  return decimalValue(value).toLocaleString("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-GB");
}

export function TaxLiabilityLedgerCard({ periods }: Props) {
  const periodsWithEntries = periods.filter((period) => (period.liabilityEntries?.length ?? 0) > 0);

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Liability Lineage
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Period totals are backed by line-level liability entries so filing workpapers can be reviewed without reconstructing every transaction by hand.
          </p>
        </div>
        <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
          {periodsWithEntries.length} period{periodsWithEntries.length === 1 ? "" : "s"} with lineage
        </span>
      </div>

      {periodsWithEntries.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
          Generate or refresh obligation periods to populate liability lineage entries.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {periodsWithEntries.map((period) => {
            const entries = period.liabilityEntries ?? [];
            const currency = entries[0]?.currency ?? "USD";
            const outputTax = entries
              .filter((entry) => entry.direction === "output")
              .reduce((sum, entry) => sum + decimalValue(entry.taxAmount), 0);
            const inputTax = entries
              .filter((entry) => entry.direction === "input")
              .reduce((sum, entry) => sum + decimalValue(entry.taxAmount), 0);
            const adjustments = entries
              .filter((entry) => entry.direction === "adjustment")
              .reduce((sum, entry) => sum + decimalValue(entry.taxAmount), 0);

            return (
              <div
                key={period.id}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {period.registration.jurisdictionReference.authorityName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {period.registration.taxType} · {formatDate(period.periodStart)} - {formatDate(period.periodEnd)}
                    </p>
                  </div>
                  <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                    {entries.length} entr{entries.length === 1 ? "y" : "ies"}
                  </span>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Output</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{formatMoney(outputTax, currency)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Input</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{formatMoney(inputTax, currency)}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Adjustments</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">{formatMoney(adjustments, currency)}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  {entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="grid gap-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
                    >
                      <div>
                        <p className="text-xs font-semibold text-[var(--dpf-text)]">{entry.sourceType.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">
                          {entry.direction} · {formatDate(entry.occurredAt)}
                        </p>
                        {entry.notes ? (
                          <p className="mt-1 text-[11px] text-[var(--dpf-muted)]">{entry.notes}</p>
                        ) : null}
                      </div>
                      <div className="text-[11px] text-[var(--dpf-muted)]">
                        <p>Taxable base {formatMoney(entry.taxableAmount, currency)}</p>
                        <p className="mt-1">Tax amount {formatMoney(entry.taxAmount, currency)}</p>
                      </div>
                      <div className="flex items-start justify-end">
                        <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                          {entry.entryId}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
