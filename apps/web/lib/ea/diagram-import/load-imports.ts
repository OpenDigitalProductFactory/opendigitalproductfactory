// Read model for the diagram import review on /ea/views (BI-4C17BF51).
// The newest imports with their candidates and SVG picture, from the EA
// proposal rows import-diagram.ts staged.

import { prisma } from "@dpf/db";
import { isRecord } from "@/lib/shared/coerce";
import { DIAGRAM_IMPORT_KIND } from "./import-diagram";

/** A picture bigger than this is not inlined into the page; the candidates still show. */
export const MAX_INLINE_PREVIEW_BYTES = 2 * 1024 * 1024;

export type CandidateStatus = string;
export type DiagramImportView = {
  id: string;
  fileName: string;
  importedAt: Date;
  previewDataUri: string | null;
  unattachedConnectors: number;
  truncated: boolean;
  elements: Array<{ id: string; status: CandidateStatus; label: string; page: string; suggestedLayer: string | null }>;
  relationships: Array<{ id: string; status: CandidateStatus; fromLabel: string; toLabel: string; label: string | null; page: string }>;
};

type ProposalRow = { id: string; proposalType: string; status: string; payload: unknown; createdAt: Date };

export type LoadDiagramImportsDeps = {
  findImports?: (limit: number) => Promise<ProposalRow[]>;
  findCandidates?: (importIds: string[]) => Promise<ProposalRow[]>;
  readBlob?: (blob: { storageKey: string; sha256: string }) => Promise<Buffer>;
};

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

async function readBlob(blob: { storageKey: string; sha256: string }): Promise<Buffer> {
  const { readDocumentBlob } = await import("@/lib/documents/blob-storage");
  return readDocumentBlob({ storageKey: blob.storageKey, expectedSha256: blob.sha256 });
}

const PROPOSAL_SELECT = { id: true, proposalType: true, status: true, payload: true, createdAt: true } as const;

export async function loadDiagramImports(limit = 5, deps: LoadDiagramImportsDeps = {}): Promise<DiagramImportView[]> {
  const imports = await (deps.findImports ??
    ((take) =>
      prisma.eaReferenceProposal.findMany({
        where: { proposalType: DIAGRAM_IMPORT_KIND.import },
        orderBy: { createdAt: "desc" },
        take,
        select: PROPOSAL_SELECT,
      })))(limit);
  if (imports.length === 0) return [];
  const ids = imports.map((row) => row.id);
  const candidates = await (deps.findCandidates ??
    ((importIds) =>
      prisma.eaReferenceProposal.findMany({
        where: {
          proposalType: { in: [DIAGRAM_IMPORT_KIND.element, DIAGRAM_IMPORT_KIND.relationship] },
          OR: importIds.map((importId) => ({ payload: { path: ["importId"], equals: importId } })),
        },
        orderBy: { createdAt: "asc" },
        select: PROPOSAL_SELECT,
      })))(ids);

  const views: DiagramImportView[] = [];
  for (const row of imports) {
    const payload = isRecord(row.payload) ? row.payload : {};
    const svg = isRecord(payload.svgBlob) ? payload.svgBlob : null;
    let previewDataUri: string | null = null;
    if (svg && typeof svg.storageKey === "string" && typeof svg.sha256 === "string") {
      try {
        const bytes = await (deps.readBlob ?? readBlob)({ storageKey: svg.storageKey, sha256: svg.sha256 });
        if (bytes.length <= MAX_INLINE_PREVIEW_BYTES) previewDataUri = `data:image/svg+xml;base64,${bytes.toString("base64")}`;
      } catch {
        previewDataUri = null; // a missing picture never hides the candidates
      }
    }
    const mine = candidates.filter((candidate) => isRecord(candidate.payload) && candidate.payload.importId === row.id);
    const pages = Array.isArray(payload.pages) ? payload.pages.filter(isRecord) : [];
    views.push({
      id: row.id,
      fileName: text(payload.fileName, "diagram"),
      importedAt: row.createdAt,
      previewDataUri,
      unattachedConnectors: pages.reduce((sum, page) => sum + (typeof page.unattachedConnectors === "number" ? page.unattachedConnectors : 0), 0),
      truncated: payload.truncated === true,
      elements: mine
        .filter((candidate) => candidate.proposalType === DIAGRAM_IMPORT_KIND.element)
        .map((candidate) => {
          const data = candidate.payload as Record<string, unknown>;
          return {
            id: candidate.id,
            status: candidate.status,
            label: text(data.label),
            page: text(data.page),
            suggestedLayer: typeof data.suggestedLayer === "string" ? data.suggestedLayer : null,
          };
        }),
      relationships: mine
        .filter((candidate) => candidate.proposalType === DIAGRAM_IMPORT_KIND.relationship)
        .map((candidate) => {
          const data = candidate.payload as Record<string, unknown>;
          return {
            id: candidate.id,
            status: candidate.status,
            fromLabel: text(data.fromLabel),
            toLabel: text(data.toLabel),
            label: typeof data.label === "string" ? data.label : null,
            page: text(data.page),
          };
        }),
    });
  }
  return views;
}
