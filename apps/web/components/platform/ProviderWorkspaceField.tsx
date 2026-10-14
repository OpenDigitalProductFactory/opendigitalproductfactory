"use client";
import { useState } from "react";
import { useT } from "@/lib/i18n/use-t";

export function ProviderWorkspaceField({ id, value, onChange, disabled }: {
  id: string; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  const t = useT("setup");
  const [open, setOpen] = useState(Boolean(value));
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} style={{ marginTop: 12 }}>
      <summary style={{ color: "var(--dpf-muted)", fontSize: 12, cursor: "pointer" }}>{t("anthropicWorkspace.disclosure")}</summary>
      <label htmlFor={id} style={{ display: "block", marginTop: 8, color: "var(--dpf-text)", fontSize: 12 }}>{t("anthropicWorkspace.label")}</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        placeholder="wrkspc_…" autoComplete="off" aria-describedby={`${id}-help`}
        style={{ width: "100%", background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", fontSize: 13, padding: "8px 10px", borderRadius: 4 }} />
      <p id={`${id}-help`} style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>
        {t("anthropicWorkspace.help")}
      </p>
    </details>
  );
}
