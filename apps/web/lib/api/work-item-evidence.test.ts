/**
 * Tests for the job-completion evidence projection + append helpers. The
 * route is a thin Prisma I/O layer over these; covering them with unit
 * tests means the route only needs a contract test for the auth + 404 paths.
 */
import { describe, it, expect } from "vitest";
import {
  appendPhoto,
  normalizeEvidence,
  normalizePhoto,
} from "./work-item-evidence";
import type { JobEvidencePhoto } from "@dpf/types";

const VALID: JobEvidencePhoto = {
  fileId: "media_abc123",
  url: "/api/v1/media/media_abc123",
  capturedAt: "2026-06-18T14:00:00.000Z",
  caption: "Compressor after replacement",
};

describe("normalizePhoto", () => {
  it("accepts a complete entry verbatim", () => {
    expect(normalizePhoto(VALID)).toEqual(VALID);
  });

  it("drops a blank caption rather than echoing it", () => {
    const { caption: _omit, ...rest } = VALID;
    expect(normalizePhoto({ ...rest, caption: "   " })).toEqual(rest);
  });

  it("rejects non-object input", () => {
    expect(normalizePhoto(null)).toBeNull();
    expect(normalizePhoto("not a photo")).toBeNull();
    expect(normalizePhoto(42)).toBeNull();
    expect(normalizePhoto([VALID])).toBeNull();
  });

  it("requires fileId, url, and a parseable capturedAt", () => {
    expect(normalizePhoto({ ...VALID, fileId: "" })).toBeNull();
    expect(normalizePhoto({ ...VALID, url: "  " })).toBeNull();
    expect(normalizePhoto({ ...VALID, capturedAt: "yesterday" })).toBeNull();
    expect(normalizePhoto({ ...VALID, capturedAt: null })).toBeNull();
  });
});

describe("normalizeEvidence", () => {
  it("returns an empty evidence record for null / non-object input", () => {
    expect(normalizeEvidence(null)).toEqual({ photos: [] });
    expect(normalizeEvidence("legacy-string")).toEqual({ photos: [] });
    expect(normalizeEvidence([])).toEqual({ photos: [] });
  });

  it("projects a populated record + drops invalid photo entries silently", () => {
    const stored = {
      photos: [
        VALID,
        { fileId: "", url: "/x", capturedAt: VALID.capturedAt }, // invalid
        { ...VALID, fileId: "media_2" },
      ],
      // Unknown sibling keys are tolerated (future-additive).
      futureField: { something: true },
    };
    const result = normalizeEvidence(stored);
    expect(result.photos).toHaveLength(2);
    expect(result.photos[0].fileId).toBe(VALID.fileId);
    expect(result.photos[1].fileId).toBe("media_2");
  });

  it("treats `photos` not being an array as empty rather than throwing", () => {
    expect(normalizeEvidence({ photos: "weird" })).toEqual({ photos: [] });
  });
});

describe("appendPhoto", () => {
  it("appends to the end without mutating the input", () => {
    const base = { photos: [VALID] };
    const second: JobEvidencePhoto = {
      fileId: "media_2",
      url: "/api/v1/media/media_2",
      capturedAt: "2026-06-18T14:05:00.000Z",
    };
    const result = appendPhoto(base, second);
    expect(result.photos).toHaveLength(2);
    expect(result.photos[1]).toEqual(second);
    expect(base.photos).toHaveLength(1); // untouched
  });
});
