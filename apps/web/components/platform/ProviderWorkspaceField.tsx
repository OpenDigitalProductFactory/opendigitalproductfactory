"use client";

export function ProviderWorkspaceField({ id, value, onChange, disabled }: {
  id: string; value: string; onChange: (value: string) => void; disabled: boolean;
}) {
  return (
    <details open={value ? true : undefined} style={{ marginTop: 12 }}>
      <summary style={{ color: "var(--dpf-muted)", fontSize: 12, cursor: "pointer" }}>Organization-scoped key</summary>
      <label htmlFor={id} style={{ display: "block", marginTop: 8, color: "var(--dpf-text)", fontSize: 12 }}>Anthropic workspace ID</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        placeholder="wrkspc_…" autoComplete="off" aria-describedby={`${id}-help`}
        style={{ width: "100%", background: "var(--dpf-surface-1)", border: "1px solid var(--dpf-border)", color: "var(--dpf-text)", fontSize: 13, padding: "8px 10px", borderRadius: 4 }} />
      <p id={`${id}-help`} style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>
        Organization keys need a workspace ID. Find it in Claude Console → Settings → Workspaces. Leave blank for a key scoped to one workspace.
      </p>
    </details>
  );
}
