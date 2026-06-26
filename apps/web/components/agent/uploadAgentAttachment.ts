// Shared client helper for uploading a coworker chat attachment. Used by the
// "+ Add → Attach file" picker AND the composer's paste / drag-and-drop paths
// so all three go through one identical POST to /api/upload.

export type AgentUploadResult = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

export type AgentUploadOutcome =
  | { ok: true; result: AgentUploadResult }
  | { ok: false; error: string };

/** File extensions the coworker upload endpoint accepts (mirrors ALLOWED_EXTENSIONS server-side). */
export const ACCEPTED_UPLOAD_EXTENSIONS = [
  "csv", "xlsx", "pdf", "doc", "docx", "txt", "json", "md", "xml", "yaml", "yml",
  "tsv", "log", "ppt", "pptx", "rtf", "png", "jpg", "jpeg", "gif", "webp",
] as const;

/** The `accept` attribute string for a file <input>, derived from the allow-list. */
export const UPLOAD_ACCEPT_ATTR = ACCEPTED_UPLOAD_EXTENSIONS.map((e) => `.${e}`).join(",");

/** True when a file's extension is one the upload endpoint will accept. Used to
 *  ignore irrelevant clipboard/drag payloads (e.g. pasted plain text) before
 *  bothering the server. */
export function isAcceptedUploadFile(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && (ACCEPTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext);
}

export async function uploadAgentAttachment(file: File, threadId: string): Promise<AgentUploadOutcome> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("threadId", threadId);
  try {
    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as { error?: string }).error ?? "Upload failed" };
    return { ok: true, result: data as AgentUploadResult };
  } catch {
    return { ok: false, error: "Upload failed" };
  }
}
