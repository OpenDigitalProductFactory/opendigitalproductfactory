"use client";

import { useRef, useState } from "react";
import { uploadAgentAttachment, UPLOAD_ACCEPT_ATTR } from "./uploadAgentAttachment";

type Props = {
  threadId: string | null;
  disabled: boolean;
  onUploaded: (result: { attachmentId: string; fileName: string; parsedContent: unknown }) => void;
  /** "icon" = standalone clip button; "menu" = a row inside the composer's + Add menu. */
  variant?: "icon" | "menu";
};

export function AgentFileUpload({ threadId, disabled, onUploaded, variant = "icon" }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!threadId) return;
    setUploading(true);
    setError(null);
    const outcome = await uploadAgentAttachment(file, threadId);
    if (outcome.ok) onUploaded(outcome.result);
    else setError(outcome.error);
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={UPLOAD_ACCEPT_ATTR}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
      {variant === "menu" ? (
        <button
          type="button"
          role="menuitem"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading || !threadId}
          title={uploading ? "Uploading..." : "Attach a file or image — or paste / drop one into the message box"}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            textAlign: "left",
            background: "none",
            border: "none",
            color: "var(--dpf-text)",
            cursor: disabled || uploading || !threadId ? "not-allowed" : "pointer",
            opacity: disabled || !threadId ? 0.5 : 1,
            padding: "8px",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <span aria-hidden="true" style={{ fontSize: 14 }}>{"\u{1F4CE}"}</span>
          {uploading ? "Uploading\u2026" : "Attach file"}
        </button>
      ) : (
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
      )}
      {error && (
        <div style={{
          padding: "4px 8px",
          borderRadius: 4,
          background: "color-mix(in srgb, var(--dpf-error) 15%, transparent)",
          border: "1px solid color-mix(in srgb, var(--dpf-error) 30%, transparent)",
          color: "var(--dpf-error)",
          fontSize: 11,
          flexShrink: 0,
        }}>
          {error}
        </div>
      )}
    </>
  );
}
