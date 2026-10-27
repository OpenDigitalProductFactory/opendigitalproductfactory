"use client";

// Drop a file (or choose one) to store it as a managed document (BI-957915CB).
// The file goes to POST /api/documents; on success the page opens the new
// document, where its PDF, searchable text and previews appear as the
// background conversion finishes.

import { useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { InlineBusy } from "@/components/ui/InlineBusy";
import { Surface } from "@/components/ui/Surface";

type Props = {
  accept: string;
  limitMb: number;
  /** The collection being viewed; the upload is filed in it. */
  collectionId: string | null;
  collectionTitle: string | null;
};

type UploadState = { kind: "idle" } | { kind: "uploading"; fileName: string } | { kind: "error"; message: string };

export function DocumentUploadZone({ accept, limitMb, collectionId, collectionTitle }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);
  const [restricted, setRestricted] = useState(false);

  async function upload(file: File) {
    setState({ kind: "uploading", fileName: file.name });
    const body = new FormData();
    body.set("file", file);
    body.set("accessScope", restricted ? "restricted" : "organization");
    if (collectionId) body.set("collectionId", collectionId);
    try {
      const response = await fetch("/api/documents", { method: "POST", body });
      const payload = (await response.json().catch(() => null)) as { route?: string; message?: string } | null;
      if (!response.ok || !payload?.route) {
        setState({ kind: "error", message: payload?.message ?? "The file could not be uploaded. Try again." });
        return;
      }
      router.push(payload.route);
    } catch {
      setState({ kind: "error", message: "The file could not be uploaded. Check your connection and try again." });
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file && state.kind !== "uploading") void upload(file);
  }

  const busy = state.kind === "uploading";
  return (
    <Surface
      level={dragging ? 2 : 1}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      aria-busy={busy}
      className={[
        "flex flex-col gap-3 border-dashed sm:flex-row sm:items-center sm:justify-between",
        dragging ? "outline outline-2 outline-[var(--dpf-accent)]" : "",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Upload className="h-5 w-5 shrink-0 text-[var(--dpf-muted)]" aria-hidden="true" />
        <div className="min-w-0 text-sm">
          {busy ? (
            <InlineBusy label={`Uploading ${state.fileName}…`} />
          ) : (
            <p className="text-[var(--dpf-text)]">
              Drop a file here to add it{collectionTitle ? ` to ${collectionTitle}` : ""}.
            </p>
          )}
          <p className="text-xs text-[var(--dpf-muted)]">Word, Excel, PowerPoint, OpenDocument, RTF, PDF, text or markdown, up to {limitMb} MB.</p>
          {state.kind === "error" && (
            <p role="alert" className="mt-1 text-xs text-[var(--dpf-error)]">
              {state.message}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <input type="checkbox" checked={restricted} onChange={(event) => setRestricted(event.target.checked)} disabled={busy} />
          Only me
        </label>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="sr-only"
          aria-label="Choose a file to upload"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
      </div>
    </Surface>
  );
}
