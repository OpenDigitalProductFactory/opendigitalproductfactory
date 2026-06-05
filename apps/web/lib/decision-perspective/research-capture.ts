import type { WikiPerspective } from "@/lib/wiki/perspective-intent";

// `targetPerspective: WikiPerspective | null` replaces the prior local
// `targetPerspectiveMode` field. `null` represents "neither WWMD nor WWWD"
// (formerly `"custom"`). Import from `lib/wiki/perspective-intent.ts`
// (PR #1343) — do not declare a sibling enum here (`single-source-of-truth`).
export type ResearchCaptureInput = {
  targetProfileId?: string | null;
  targetPerspective?: WikiPerspective | null;
  content: string;
  title?: string | null;
  url?: string | null;
  authors?: string[];
  retrievedAt?: Date | string | null;
  sourceType?: "paper" | "article" | "spec" | "doc" | "framework" | "external-url";
  proposedPageKind?: "principle" | "stance" | "heuristic" | "runbook" | "summary";
};

export type ResearchCaptureCandidate = {
  valid: boolean;
  errors: string[];
  flags: Array<"secret-looking-content">;
  rawSource: {
    sourceKey: string;
    sourceType: string;
    title: string;
    authors: string[];
    url: string | null;
    retrievedAt: string | null;
    abstract: string | null;
    excerpt: string;
    locator: Record<string, unknown>;
    status: "draft";
  } | null;
  wikiPageCandidate: {
    title: string;
    slug: string;
    pageKind: "principle" | "stance" | "heuristic" | "runbook" | "summary";
    status: "review-needed";
    bodyPreview: string;
    targetProfileId: string;
    targetPerspective: WikiPerspective | null;
  } | null;
  materialCandidate: {
    targetProfileId: string;
    targetPerspective: WikiPerspective | null;
    sourceType: string;
    sourceRef: {
      sourceKey: string;
      url: string | null;
    };
    summary: string;
    reviewStatus: "draft";
    promotionState: "candidate";
  } | null;
};

const FRONTMATTER_BOUNDARY = "---";
const SECRET_PATTERNS = [
  /\bdpfmcp_[a-z0-9_=-]+/i,
  /\bsk-[a-z0-9_-]{12,}/i,
  /\b(api[_-]?key|password|secret|token)\s*[:=]\s*\S+/i,
];

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "captured-source";
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseScalar(value: string): string | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return trimmed.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(content: string): {
  metadata: Record<string, string | string[]>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) {
    return { metadata: {}, body: normalized };
  }

  const end = normalized.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, FRONTMATTER_BOUNDARY.length + 1);
  if (end === -1) return { metadata: {}, body: normalized };

  const metadata: Record<string, string | string[]> = {};
  const block = normalized.slice(FRONTMATTER_BOUNDARY.length + 1, end);
  for (const line of block.split("\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    if (!key) continue;
    metadata[key] = parseScalar(line.slice(separator + 1));
  }

  return {
    metadata,
    body: normalized.slice(end + FRONTMATTER_BOUNDARY.length + 2),
  };
}

function metadataString(
  metadata: Record<string, string | string[]>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function metadataAuthors(
  metadata: Record<string, string | string[]>,
  explicit: string[] | undefined,
): string[] {
  if (explicit && explicit.length > 0) return explicit;
  const value = metadata.authors ?? metadata.author;
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    return value.split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

function detectSecret(content: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(content));
}

function sourceTypeFrom(input: ResearchCaptureInput, metadata: Record<string, string | string[]>): string {
  return input.sourceType ?? metadataString(metadata, "sourceType") ?? (input.url ? "external-url" : "doc");
}

export function captureResearchCandidate(input: ResearchCaptureInput): ResearchCaptureCandidate {
  const parsed = parseFrontmatter(input.content);
  const body = parsed.body.trim();
  const title = input.title ?? metadataString(parsed.metadata, "title") ?? "Captured research";
  const url = input.url ?? metadataString(parsed.metadata, "url");
  const retrievedAt = asIso(input.retrievedAt ?? metadataString(parsed.metadata, "retrievedAt"));
  const sourceType = sourceTypeFrom(input, parsed.metadata);
  const targetPerspective: WikiPerspective | null = input.targetPerspective ?? null;
  const excerpt = compact(body).slice(0, 800);
  const sourceKey = `${slugify(url ?? title)}-${slugify(sourceType)}`;
  const flags: ResearchCaptureCandidate["flags"] = detectSecret(input.content)
    ? ["secret-looking-content"]
    : [];
  const errors: string[] = [];
  if (!input.targetProfileId) errors.push("targetProfileId is required");
  if (!body) errors.push("content is required");
  if (flags.length > 0) errors.push("secret-looking content must be reviewed before capture");

  if (!input.targetProfileId || !body) {
    return {
      valid: false,
      errors,
      flags,
      rawSource: null,
      wikiPageCandidate: null,
      materialCandidate: null,
    };
  }

  const rawSource = {
    sourceKey,
    sourceType,
    title,
    authors: metadataAuthors(parsed.metadata, input.authors),
    url: url ?? null,
    retrievedAt,
    abstract: metadataString(parsed.metadata, "abstract"),
    excerpt,
    locator: {
      captureMode: url ? "web-clip" : "local-note",
      sourceKey,
    },
    status: "draft" as const,
  };

  return {
    valid: errors.length === 0,
    errors,
    flags,
    rawSource,
    wikiPageCandidate: {
      title,
      slug: slugify(title),
      pageKind: input.proposedPageKind ?? "summary",
      status: "review-needed",
      bodyPreview: body.slice(0, 2000),
      targetProfileId: input.targetProfileId,
      targetPerspective,
    },
    materialCandidate: {
      targetProfileId: input.targetProfileId,
      targetPerspective,
      sourceType,
      sourceRef: {
        sourceKey,
        url: url ?? null,
      },
      summary: excerpt.slice(0, 300),
      reviewStatus: "draft",
      promotionState: "candidate",
    },
  };
}
