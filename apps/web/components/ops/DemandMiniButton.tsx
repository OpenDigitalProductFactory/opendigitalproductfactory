type DemandMiniButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  tone?: "accent" | "muted" | "success";
};

export function DemandMiniButton({
  onClick,
  disabled,
  title,
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
      className="rounded border px-1.5 py-0.5 text-dpf-caption font-medium disabled:opacity-40"
      style={{ color, borderColor: color }}
    >
      {children}
    </button>
  );
}
