import type { ParsedFileContent } from "@/lib/shared/file-parsers";
import type { PartialDesignSystem } from "./types";

export type Upload = {
  name: string;
  mimeType: string;
  data: Buffer;
};

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

async function extractImageSignals(upload: Upload): Promise<{
  assetRef: { url: string; source: "upload"; mimeType: string; width?: number; height?: number };
  dominantHex: string | null;
}> {
  const sharp = (await import("sharp")).default;
  try {
    const img = sharp(upload.data);
    const metadata = await img.metadata();
    let dominantHex: string | null = null;
    try {
      const stats = await img.stats();
      if (stats?.dominant) {
        const { r, g, b } = stats.dominant;
        dominantHex = rgbToHex(r, g, b);
      }
    } catch {
      // SVG or unsupported: fall through without dominant color
    }
    return {
      assetRef: {
        url: `data:${upload.mimeType};base64,${upload.data.toString("base64")}`,
        source: "upload",
        mimeType: upload.mimeType,
        width: metadata.width,
        height: metadata.height,
      },
      dominantHex,
    };
  } catch {
    return {
      assetRef: {
        url: `data:${upload.mimeType};base64,${upload.data.toString("base64")}`,
        source: "upload",
        mimeType: upload.mimeType,
      },
      dominantHex: null,
    };
  }
}

export type UploadAdapterDeps = {
  /** The shared file reader: PDF and Word text come from the document engine (BI-D1B40D43). */
  parse?: (buffer: Buffer, mimeType: string, fileName: string) => Promise<ParsedFileContent | null>;
};

const MAX_DOCUMENT_TEXT = 2000;

async function extractDocumentText(upload: Upload, deps: UploadAdapterDeps): Promise<string | null> {
  try {
    const parse = deps.parse ?? (await import("@/lib/shared/file-parsers")).parseFileContent;
    const parsed = await parse(upload.data, upload.mimeType, upload.name);
    const text = parsed?.type === "document" ? parsed.fullText?.trim() ?? "" : "";
    return text ? text.slice(0, MAX_DOCUMENT_TEXT) : null;
  } catch {
    return null;
  }
}

export async function uploadAdapter(
  uploads: Upload[] | undefined,
  deps: UploadAdapterDeps = {},
): Promise<PartialDesignSystem> {
  if (!uploads || uploads.length === 0) {
    return {
      sources: [],
      gaps: ["no-uploads"],
      confidence: { overall: 0, perField: {} },
    };
  }

  const perField: Record<string, number> = {};
  const gaps: string[] = [];
  const sources: PartialDesignSystem["sources"] = [];
  const partial: PartialDesignSystem = {};

  for (const upload of uploads) {
    sources!.push({
      kind: "upload",
      ref: upload.name,
      capturedAt: new Date().toISOString(),
    });

    const mime = upload.mimeType.toLowerCase();

    if (mime.startsWith("image/")) {
      const { assetRef, dominantHex } = await extractImageSignals(upload);
      partial.identity = partial.identity ?? {
        name: "",
        tagline: null,
        description: null,
        logo: { darkBg: null, lightBg: null, mark: null },
        voice: { tone: "neutral", sampleCopy: [] },
      };
      partial.identity.logo = partial.identity.logo ?? { darkBg: null, lightBg: null, mark: null };
      partial.identity.logo.mark = assetRef;
      perField["identity.logo.mark"] = 0.9;
      if (dominantHex) {
        partial.palette = {
          primary: dominantHex,
          secondary: null,
          accents: [],
          semantic: { success: "#10b981", warning: "#f59e0b", danger: "#ef4444", info: "#3b82f6" },
          neutrals: {
            50: "#ffffff", 100: "#f9f9f9", 200: "#eeeeee", 300: "#dddddd", 400: "#bbbbbb",
            500: "#888888", 600: "#666666", 700: "#444444", 800: "#222222", 900: "#111111", 950: "#000000",
          },
          surfaces: {
            background: "#ffffff",
            foreground: "#000000",
            muted: "#f5f5f5",
            card: "#ffffff",
            border: "#e5e5e5",
          },
        };
        perField["palette.primary"] = 0.5;
      }
      continue;
    }

    if (mime === "application/pdf") {
      const text = await extractDocumentText(upload, deps);
      if (text) {
        partial.identity = partial.identity ?? {
          name: "",
          tagline: null,
          description: null,
          logo: { darkBg: null, lightBg: null, mark: null },
          voice: { tone: "neutral", sampleCopy: [] },
        };
        partial.identity.description = text;
        perField["identity.description"] = 0.4;
      } else {
        gaps.push(`upload-pdf-no-text:${upload.name}`);
      }
      continue;
    }

    if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      || mime === "application/msword"
    ) {
      const text = await extractDocumentText(upload, deps);
      if (text) {
        partial.identity = partial.identity ?? {
          name: "",
          tagline: null,
          description: null,
          logo: { darkBg: null, lightBg: null, mark: null },
          voice: { tone: "neutral", sampleCopy: [] },
        };
        partial.identity.description = text;
        perField["identity.description"] = 0.4;
      } else {
        gaps.push(`upload-docx-no-text:${upload.name}`);
      }
      continue;
    }

    gaps.push(`upload-unsupported-mime:${upload.mimeType}`);
  }

  partial.sources = sources;

  const populatedFields = Object.keys(perField).length;
  const overall = populatedFields === 0 ? 0 : Math.min(0.8, populatedFields * 0.25);

  return {
    ...partial,
    gaps,
    confidence: { overall, perField },
  };
}
