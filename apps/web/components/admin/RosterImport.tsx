"use client";

import { useRef, useState } from "react";
import type { ProposedEmployee } from "@/lib/onboarding/roster-import";

// Optional onboarding accelerator (EP-ONBOARDING-INTAKE P4): upload an employee
// roster CSV, review the proposed people, and create them in one confirm step —
// "employees entered quickly" instead of one-by-one. Independent of the rest of
// the form; failure here never blocks setup.

type Preview = { proposed: ProposedEmployee[]; summary: string; truncated: boolean };
type ImportResult = { created: number; skippedExisting: number; failed: number };

const PREVIEW_LIMIT = 25;

export function RosterImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    setPreview(null);
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/onboarding/roster", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<Preview> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not read that file");
      setPreview({ proposed: data.proposed ?? [], summary: data.summary ?? "", truncated: !!data.truncated });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function onImport() {
    if (!preview) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/roster/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: preview.proposed }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<ImportResult> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      setResult({ created: data.created ?? 0, skippedExisting: data.skippedExisting ?? 0, failed: data.failed ?? 0 });
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  const hint: React.CSSProperties = { fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 };
  const cell: React.CSSProperties = { padding: "4px 8px", fontSize: 12, color: "var(--dpf-text)", borderBottom: "1px solid var(--dpf-border)", textAlign: "left" };

  return (
    <div style={{ fontSize: 13 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Add your team from a spreadsheet{" "}
        <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}>(optional)</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.tsv"
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
        style={{ fontSize: 13, color: "var(--dpf-text)" }}
      />
      <div style={hint}>
        Upload a CSV with your people (name, email, title, department, start date). We&apos;ll show you
        what we found — nothing is created until you confirm.
      </div>

      {busy && <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>Working…</p>}
      {error && <p style={{ color: "var(--dpf-error)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}

      {preview && preview.proposed.length > 0 && (
        <div style={{ marginTop: 10, border: "1px solid var(--dpf-border)", borderRadius: 8, overflow: "hidden", background: "var(--dpf-surface-1)" }}>
          <div style={{ padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "var(--dpf-text)", borderBottom: "1px solid var(--dpf-border)" }}>
            {preview.summary}
            {preview.truncated ? " — showing the first 2000 rows" : ""}
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...cell, fontWeight: 600 }}>Name</th>
                  <th style={{ ...cell, fontWeight: 600 }}>Email</th>
                  <th style={{ ...cell, fontWeight: 600 }}>Role</th>
                  <th style={{ ...cell, fontWeight: 600 }}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {preview.proposed.slice(0, PREVIEW_LIMIT).map((e) => (
                  <tr key={e.sourceRow}>
                    <td style={cell}>{e.displayName}</td>
                    <td style={cell}>{e.workEmail ?? "—"}</td>
                    <td style={cell}>{[e.title, e.department].filter(Boolean).join(" · ") || "—"}</td>
                    <td style={{ ...cell, color: e.issues.length ? "var(--dpf-accent)" : "var(--dpf-muted)" }}>
                      {e.issues.length ? e.issues.join("; ") : "ok"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.proposed.length > PREVIEW_LIMIT && (
              <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--dpf-muted)" }}>
                …and {preview.proposed.length - PREVIEW_LIMIT} more
              </div>
            )}
          </div>
          <div style={{ padding: "8px 10px", borderTop: "1px solid var(--dpf-border)", display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              onClick={() => void onImport()}
              disabled={busy}
              style={{ padding: "6px 16px", borderRadius: 6, border: "none", background: "var(--dpf-accent)", color: "#fff", cursor: busy ? "wait" : "pointer", fontSize: 12, fontWeight: 600, opacity: busy ? 0.7 : 1 }}
            >
              Add {preview.proposed.length} {preview.proposed.length === 1 ? "person" : "people"}
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              disabled={busy}
              style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--dpf-border)", background: "var(--dpf-surface-1)", color: "var(--dpf-text)", cursor: "pointer", fontSize: 12 }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <p style={{ color: "var(--dpf-success)", fontSize: 12, margin: "8px 0 0" }}>
          Added {result.created} {result.created === 1 ? "person" : "people"}
          {result.skippedExisting > 0 ? `, skipped ${result.skippedExisting} already on file` : ""}
          {result.failed > 0 ? `, ${result.failed} could not be added` : ""}.
        </p>
      )}
    </div>
  );
}
