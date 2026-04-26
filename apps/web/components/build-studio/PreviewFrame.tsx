"use client";
import { UserMark } from "./avatars/UserMark";

interface Props {
  sandboxUrl: string | null;
}

interface KeyRow {
  label: string;
  last: string;
  state: "active" | "expiring";
}

const MOCK_KEY_ROWS: KeyRow[] = [
  { label: "Production", last: "Last used 4 minutes ago", state: "active" },
  { label: "CI / build", last: "Last used today, 8:14am", state: "active" },
  { label: "Old read-only key", last: "Rotated out · expires in 47s", state: "expiring" },
];

export function PreviewFrame({ sandboxUrl }: Props) {
  if (!sandboxUrl) {
    return (
      <div className="h-full grid place-items-center p-6 text-[var(--dpf-text-secondary)] text-sm text-center">
        No sandbox running yet — preview lights up once Building reaches the Checking phase.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-[22px] gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex-1 font-mono text-xs text-[var(--dpf-text-secondary)] py-1.5 px-3 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-[10px]">
          {sandboxUrl}
        </div>
        <span
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)]"
          style={{ color: "var(--dpf-success)" }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "var(--dpf-success)" }}
          />
          live
        </span>
      </div>

      <div className="flex-1 bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] rounded-[14px] overflow-hidden flex flex-col">
        {/* Mock app header */}
        <div className="px-[22px] py-3.5 border-b border-[var(--dpf-border)] flex items-center gap-3">
          <div
            className="w-[22px] h-[22px] rounded-md"
            style={{ background: "var(--dpf-accent)" }}
            aria-hidden="true"
          />
          <span className="text-sm font-bold text-[var(--dpf-text)]">Acme · Settings</span>
          <span className="flex-1" />
          <UserMark size={26} />
        </div>

        <div className="px-7 py-5 flex-1 flex flex-col gap-4">
          <div>
            <div className="text-[11px] font-bold text-[var(--dpf-muted)] uppercase tracking-[0.6px]">
              Settings
            </div>
            <h2 className="mt-1 mb-1 text-[20px] font-bold tracking-tight text-[var(--dpf-text)]">
              API Keys
            </h2>
            <p className="m-0 text-[13px] text-[var(--dpf-text-secondary)]">
              Rotate or revoke keys for Acme. Old keys stay valid for 60 seconds after rotation.
            </p>
          </div>

          <div className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded-xl overflow-hidden">
            {MOCK_KEY_ROWS.map((k, i) => (
              <div
                key={k.label}
                data-testid="preview-key-row"
                className="grid items-center px-4 py-3.5 gap-3"
                style={{
                  gridTemplateColumns: "1fr auto auto",
                  borderBottom:
                    i < MOCK_KEY_ROWS.length - 1 ? "1px solid var(--dpf-border)" : "none",
                }}
              >
                <div>
                  <div className="text-[13.5px] font-semibold text-[var(--dpf-text)]">
                    {k.label}
                  </div>
                  <div className="text-[12px] text-[var(--dpf-muted)]">{k.last}</div>
                </div>
                {k.state === "expiring" ? (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                    style={{ color: "var(--dpf-warning)" }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full animate-pulse"
                      style={{ background: "var(--dpf-warning)" }}
                    />
                    grace window
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
                    style={{ color: "var(--dpf-success)" }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: "var(--dpf-success)" }}
                    />
                    active
                  </span>
                )}
                <button
                  type="button"
                  className="px-3 py-1 text-xs font-medium rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-3)] transition-colors"
                >
                  Rotate
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
