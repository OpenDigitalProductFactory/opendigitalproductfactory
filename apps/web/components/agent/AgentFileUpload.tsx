"use client";

import { useRef, useState } from "react";

type Props = {
  threadId: string | null;
  disabled: boolean;
  onUploaded: (result: { attachmentId: string; fileName: string; parsedContent: unknown }) => void;
};

export function AgentFileUpload({ threadId, disabled, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!threadId) return;
    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    formData.append("threadId", threadId);
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Upload failed");
      else onUploaded(data);
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,.pdf,.doc,.docx,.txt,.json,.md,.xml,.yaml,.yml,.tsv,.log,.ppt,.pptx,.rtf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || uploading || !threadId}
        title={uploading ? "Uploading..." : "Upload a file"}
        style={{
          background: "transparent",
          border: "none",
          color: uploading ? "var(--dpf-accent)" : "var(--dpf-muted)",
          fontSize: 16,
          cursor: disabled || uploading ? "not-allowed" : "pointer",
          padding: "6px",
          opacity: disabled ? 0.5 : 1,
          flexShrink: 0,
        }}
      >
        {uploading ? "\u23F3" : "\u{1F4CE}"}
      </button>
      {error && (
        <div style={{
          padding: "4px 8px",
          borderRadius: 4,
          background: "rgba(239,68,68,0.15)",
          border: "1px solid rgba(239,68,68,0.3)",
          color: "#f87171",
          fontSize: 11,
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}
    </>
  );
}
