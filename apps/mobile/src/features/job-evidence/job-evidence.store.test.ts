import {
  useJobEvidenceStore,
} from "./job-evidence.store";
import { __resetImageCaptureForTests, setImageCapture } from "./imageSource";

const mockAppendEvidence = jest.fn();

jest.mock("@/src/lib/apiClient", () => ({
  api: {
    workItems: {
      appendEvidence: (...a: unknown[]) => mockAppendEvidence(...a),
    },
  },
}));

jest.mock("@/src/lib/serverConfig", () => ({
  getServerUrl: () => "https://install.example",
}));

jest.mock("@/src/repositories/SecureStorage", () => ({
  SecureStorage: { getAccessToken: async () => "tok_abc" },
}));

const mockFetch = jest.fn();
beforeAll(() => {
  (global as unknown as { fetch: typeof mockFetch }).fetch = mockFetch;
});

const PHOTO = {
  fileId: "media_abc",
  url: "/api/v1/media/media_abc",
};

function resetStore() {
  useJobEvidenceStore.getState().reset();
  __resetImageCaptureForTests();
  mockAppendEvidence.mockReset();
  mockFetch.mockReset();
}

beforeEach(resetStore);

describe("useJobEvidenceStore.capturePhoto", () => {
  it("refuses when no work item has been started", async () => {
    const result = await useJobEvidenceStore.getState().capturePhoto();
    expect(result).toBeNull();
    expect(useJobEvidenceStore.getState().error).toMatch(/no work item/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when the picker is cancelled, without uploading", async () => {
    setImageCapture(async () => null);
    useJobEvidenceStore.getState().begin("WI-1");
    const result = await useJobEvidenceStore.getState().capturePhoto();
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(useJobEvidenceStore.getState().error).toBeNull();
  });

  it("uploads, appends, and stores the server's merged evidence", async () => {
    setImageCapture(async () => ({
      uri: "file:///tmp/a.png",
      mimeType: "image/png",
      fileName: "a.png",
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => PHOTO,
    });
    const serverPhoto = {
      fileId: PHOTO.fileId,
      url: PHOTO.url,
      capturedAt: "2026-06-18T14:00:00.000Z",
    };
    mockAppendEvidence.mockResolvedValueOnce({
      evidence: { photos: [serverPhoto] },
    });

    useJobEvidenceStore.getState().begin("WI-1");
    const photo = await useJobEvidenceStore.getState().capturePhoto("before");
    expect(photo).not.toBeNull();
    expect(photo?.fileId).toBe(PHOTO.fileId);
    expect(photo?.caption).toBe("before");

    // Upload went to /api/v1/upload with the install's base URL and the bearer token.
    const [uploadUrl, uploadInit] = mockFetch.mock.calls[0];
    expect(uploadUrl).toBe("https://install.example/api/v1/upload");
    expect((uploadInit as RequestInit).method).toBe("POST");
    expect(
      (uploadInit as RequestInit).headers as Record<string, string>,
    ).toEqual({ Authorization: "Bearer tok_abc" });

    // appendEvidence was called with the freshly-uploaded fileId.
    const appendCall = mockAppendEvidence.mock.calls[0];
    expect(appendCall[0]).toBe("WI-1");
    expect(appendCall[1].photo.fileId).toBe(PHOTO.fileId);
    expect(appendCall[1].photo.caption).toBe("before");

    // Local state now mirrors the server's merged record.
    expect(useJobEvidenceStore.getState().evidence.photos).toHaveLength(1);
    expect(useJobEvidenceStore.getState().isCapturing).toBe(false);
  });

  it("surfaces an upload failure as state.error and never calls appendEvidence", async () => {
    setImageCapture(async () => ({
      uri: "file:///tmp/a.png",
      mimeType: "image/png",
    }));
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    useJobEvidenceStore.getState().begin("WI-1");
    const result = await useJobEvidenceStore.getState().capturePhoto();
    expect(result).toBeNull();
    expect(useJobEvidenceStore.getState().error).toContain("500");
    expect(mockAppendEvidence).not.toHaveBeenCalled();
  });

  it("surfaces an appendEvidence failure as state.error and preserves prior evidence", async () => {
    setImageCapture(async () => ({
      uri: "file:///tmp/a.png",
      mimeType: "image/png",
    }));
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => PHOTO,
    });
    mockAppendEvidence.mockRejectedValueOnce(new Error("HTTP 403 forbidden"));

    useJobEvidenceStore.getState().begin("WI-1", {
      photos: [
        {
          fileId: "media_prior",
          url: "/api/v1/media/media_prior",
          capturedAt: "2026-06-18T13:00:00.000Z",
        },
      ],
    });
    const result = await useJobEvidenceStore.getState().capturePhoto();
    expect(result).toBeNull();
    expect(useJobEvidenceStore.getState().error).toContain("403");
    // Prior evidence is preserved — the failed append did not overwrite it.
    expect(useJobEvidenceStore.getState().evidence.photos).toHaveLength(1);
    expect(useJobEvidenceStore.getState().evidence.photos[0].fileId).toBe(
      "media_prior",
    );
  });
});
