"use client";

export function Persona({ size = 28 }: { size?: number }) {
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      className="grid place-items-center rounded-full font-bold text-[var(--dpf-bg)] shrink-0"
    >
      <span
        className="grid place-items-center rounded-full"
        style={{
          width: size,
          height: size,
          background:
            "linear-gradient(135deg, var(--dpf-accent) 0%, color-mix(in srgb, var(--dpf-accent) 60%, var(--dpf-text)) 100%)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.4) inset, 0 4px 10px color-mix(in srgb, var(--dpf-accent) 30%, transparent)",
        }}
      >
        D
      </span>
    </div>
  );
}
