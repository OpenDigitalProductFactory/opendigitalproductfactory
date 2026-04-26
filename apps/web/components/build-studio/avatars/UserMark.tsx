"use client";

export function UserMark({ size = 28, name = "Maya" }: { size?: number; name?: string }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="grid place-items-center rounded-full bg-[var(--dpf-surface-3)] text-[var(--dpf-text)] border border-[var(--dpf-border)] font-semibold shrink-0"
    >
      {name[0]}
    </div>
  );
}
