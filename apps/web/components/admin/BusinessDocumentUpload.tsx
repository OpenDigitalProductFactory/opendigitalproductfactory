"use client";

import { useRef, useState } from "react";

// Optional onboarding affordance: upload a business plan / key document. It is
// stored in the Document DMS and (once the enrichment pipeline lands) indexed
// into the org WWWD corpus. Independent of the rest of the business-context
// form — failure here never blocks setup.

type Captured = { title: string; summary: string | null; textLength: number };

export function BusinessDocumentUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/onboarding/business-document", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Partial<Captured> & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setCaptured({
        title: data.title ?? file.name,
        summary: data.summary ?? null,
        textLength: data.textLength ?? 0,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const hintStyle: React.CSSProperties = { fontSize: 11, color: "var(--dpf-muted)", marginTop: 4 };

  return (
    <div style={{ fontSize: 13 }}>
      <label htmlFor="business-document-file" style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
        Have a business plan or key document?{" "}
        <span style={{ fontWeight: 400, color: "var(--dpf-muted)" }}>(optional)</span>
      </label>
      <input
        id="business-document-file"
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.md,.rtf"
        aria-label="Upload a business plan or key document"
        disabled={uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
        style={{ fontSize: 13, color: "var(--dpf-text)" }}
      />
      <div style={hintStyle}>
        We&apos;ll store it and use it to understand your business — it helps seed what your
        organization &quot;would do&quot; when a decision comes up.
      </div>
      {uploading && <p style={{ color: "var(--dpf-muted)", fontSize: 12, margin: "6px 0 0" }}>Uploading…</p>}
      {error && <p style={{ color: "var(--dpf-error)", fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
      {captured && (
        <p style={{ color: "var(--dpf-success)", fontSize: 12, margin: "6px 0 0" }}>
          Saved “{captured.title}” ({captured.textLength.toLocaleString()} characters captured).
        </p>
      )}
    </div>
  );
}
