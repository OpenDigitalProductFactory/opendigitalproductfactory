import { create } from "zustand";
import type { JobEvidence, JobEvidencePhoto } from "@dpf/types";
import { api } from "@/src/lib/apiClient";
import { getServerUrl } from "@/src/lib/serverConfig";
import { SecureStorage } from "@/src/repositories/SecureStorage";
import { getImageCapture } from "./imageSource";

/**
 * Field-tech completion-evidence store. Captures a photo via the
 * pluggable image source, uploads it to /api/v1/upload to mint a
 * MediaAsset, then appends the fileId to the assigned WorkItem's
 * evidence JSON via /api/v1/work-items/:itemId/evidence.
 *
 * The store keeps a local copy of the current evidence so the UI can
 * render a running list of captured photos without re-fetching the
 * WorkItem after every append. Server is the source of truth: the
 * append endpoint returns the merged record and we replace local state
 * with what came back.
 */

interface JobEvidenceState {
  workItemId: string | null;
  evidence: JobEvidence;
  isCapturing: boolean;
  error: string | null;
  begin: (workItemId: string, seed?: JobEvidence) => void;
  capturePhoto: (caption?: string) => Promise<JobEvidencePhoto | null>;
  reset: () => void;
}

const EMPTY_EVIDENCE: JobEvidence = { photos: [] };

interface UploadResponse {
  fileId: string;
  url: string;
}

async function uploadCapturedImage(image: {
  uri: string;
  mimeType: string;
  fileName?: string;
}): Promise<UploadResponse | null> {
  // Build a multipart body the same way the dynamic CameraField does, but
  // through a direct fetch — the shared @dpf/api-client client doesn't
  // expose multipart upload as a typed endpoint today.
  const token = await SecureStorage.getAccessToken();
  const form = new FormData();
  // React-Native's FormData accepts the {uri, name, type} triple for
  // multipart; this is the canonical RN pattern.
  form.append("file", {
    uri: image.uri,
    name: image.fileName ?? `evidence-${Date.now()}.png`,
    type: image.mimeType,
  } as unknown as Blob);
  const res = await fetch(`${getServerUrl()}/api/v1/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  if (!res.ok) {
    throw new Error(`Upload failed (HTTP ${res.status})`);
  }
  const data = (await res.json()) as Partial<UploadResponse>;
  if (typeof data.fileId !== "string" || typeof data.url !== "string") {
    throw new Error("Upload returned an unexpected response shape");
  }
  return { fileId: data.fileId, url: data.url };
}

export const useJobEvidenceStore = create<JobEvidenceState>((set, get) => ({
  workItemId: null,
  evidence: { ...EMPTY_EVIDENCE },
  isCapturing: false,
  error: null,

  begin: (workItemId, seed) =>
    set({
      workItemId,
      evidence: seed ?? { ...EMPTY_EVIDENCE },
      isCapturing: false,
      error: null,
    }),

  capturePhoto: async (caption) => {
    const { workItemId } = get();
    if (!workItemId) {
      set({ error: "No work item is being captured" });
      return null;
    }
    set({ isCapturing: true, error: null });
    try {
      const image = await getImageCapture()();
      if (!image) {
        set({ isCapturing: false });
        return null; // user cancelled
      }
      const uploaded = await uploadCapturedImage(image);
      if (!uploaded) {
        set({ isCapturing: false, error: "Upload returned no payload" });
        return null;
      }
      const photo: JobEvidencePhoto = {
        fileId: uploaded.fileId,
        url: uploaded.url,
        // Client clock is fine here; server doesn't override it.
        capturedAt: new Date().toISOString(),
      };
      if (caption && caption.trim().length > 0) photo.caption = caption.trim();

      const { evidence } = await api.workItems.appendEvidence(workItemId, {
        photo,
      });
      set({ evidence, isCapturing: false });
      return photo;
    } catch (err) {
      set({
        isCapturing: false,
        error: err instanceof Error ? err.message : "Failed to capture photo",
      });
      return null;
    }
  },

  reset: () =>
    set({
      workItemId: null,
      evidence: { ...EMPTY_EVIDENCE },
      isCapturing: false,
      error: null,
    }),
}));
