// BI-A63A9476: lint for entity references (spec 2026-10-14 §2 R4, §3.4).
//
// The reference writer refuses an edge from a kernel (WWMD) or profession (WSID)
// page to a WWWD record. These detectors report what the writer cannot stop:
// such an edge already stored, and the historical entity ids kernel pages cite
// from the platform's own backlog, which always render as plain text.

import { extractEntityIds } from "@dpf/db/wiki-frontmatter";

import type { LintFinding, LintWikiPage } from "./lint-detectors";

/** A stored MENTIONS edge, as lint reads it from graph_edge. */
export type LintReferenceEdge = { srcKey: string; dstKey: string; sourceScope: string | null; targetScope: string | null };

const SHIPPED_CORPORA = new Set(["kernel", "profession"]);
const WWWD = new Set(["organization", "install"]);

/** Error: a kernel or profession page references a WWWD record (R4). */
export function detectScopeCrossingReferences(input: { references: readonly LintReferenceEdge[] }): LintFinding[] {
  return input.references
    .filter((edge) => SHIPPED_CORPORA.has(edge.sourceScope ?? "") && WWWD.has(edge.targetScope ?? ""))
    .map((edge) => ({
      organizationId: null,
      pageId: edge.srcKey,
      findingKind: "scope-crossing-reference",
      severity: "error",
      detail: { targetKey: edge.dstKey, sourceScope: edge.sourceScope, targetScope: edge.targetScope },
    }));
}

/** Info: entity ids cited in a kernel or profession body; they render as plain text and form no edge. */
export function detectKernelEntityCitations(input: { pages: readonly LintWikiPage[] }): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const page of input.pages) {
    if (page.organizationId !== null) continue;
    const ids = extractEntityIds(page.body);
    if (ids.length === 0) continue;
    findings.push({ organizationId: null, pageId: page.id, findingKind: "kernel-entity-citation", severity: "info", detail: { ids } });
  }
  return findings;
}
