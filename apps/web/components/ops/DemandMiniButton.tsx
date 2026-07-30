type DemandMiniButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  children: React.ReactNode;
  tone?: "accent" | "muted" | "success";
};

export function DemandMiniButton({
  onClick,
  disabled,
  title,
  ariaLabel,
  children,
  tone = "accent",
}: DemandMiniButtonProps) {
  const color =
    tone === "success"
      ? "var(--dpf-success)"
      : tone === "muted"
        ? "var(--dpf-muted)"
        : "var(--dpf-accent)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className="rounded border px-1.5 py-0.5 text-dpf-caption font-medium disabled:opacity-40"
      style={{ color, borderColor: color }}
    >
      {children}
    </button>
  );
}

export function DemandEvidenceCount({ count }: { count: number }) {
  const label = `${count} linked evidence source${count === 1 ? "" : "s"}`;
  return (
    <span
      className="text-dpf-caption text-[var(--dpf-muted)]"
      title={label}
      aria-label={`Evidence: ${count}`}
    >
      ({count})
    </span>
  );
}
