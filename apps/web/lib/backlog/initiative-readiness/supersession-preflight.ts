import { prisma } from "@dpf/db";
import { z } from "zod";
import { parseMarkdown } from "@/lib/shared/markdown";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";
import { currentBaseline, parseBaselinePayloads } from "./baseline-head";
import { diffInitiativeScopeManifests, type InitiativeScopeManifestResult } from "./baseline-manifest";
import { loadBaselineSource } from "./baseline-source";

const statementId = /^(?:OBJ|AC)-[A-Z0-9-]+$/u;
const objectiveId = z.string().regex(/^OBJ-[A-Z0-9-]+$/u);
const acceptanceId = z.string().regex(/^AC-[A-Z0-9-]+$/u);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const anchor = z.string().min(1);
const retainedManifest = z.object({
  artifactDigest: digest,
  objectiveStatements: z.array(z.object({ objectiveId, statementDigest: digest, artifactAnchor: anchor })),
  acceptanceStatements: z.array(z.object({ acceptanceId, objectiveIds: z.array(objectiveId),
    statementDigest: digest, artifactAnchor: anchor })),
}).refine(({ objectiveStatements, acceptanceStatements }) =>
  new Set(objectiveStatements.map(item => item.objectiveId)).size === objectiveStatements.length
  && new Set(acceptanceStatements.map(item => item.acceptanceId)).size === acceptanceStatements.length);

type Manifest = Extract<InitiativeScopeManifestResult, ActionSuccess>;
export type SupersessionInput = { expectedCurrentBaselineId: string; requiredStatementIds: string[] };

type SupersessionRefusal = {
  error: "approval-baseline-unavailable" | "supersession-dispositions-required" | "supersession-dispositions-invalid";
  message: string;
  gateStatus: "unrun";
  expectedCurrentBaselineId: string;
  requiredStatementIds?: string[];
  missingStatementIds?: string[];
};

/** Only top-level list entries under the named heading count. Fenced examples,
 * quoted content and prose cannot provide author inputs for a review. */
function readDraftIds(text: string): Set<string> | null {
  const tokens = parseMarkdown(text);
  const lines = text.split(/\r?\n/u);
  const sectionTitle = "Draft supersession dispositions";
  let sectionSeen = false;
  let inSection = false;
  const drafts = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open" && token.level === 0) {
      inSection = token.tag === "h2" && tokens[index + 1]?.content === sectionTitle;
      if (inSection && sectionSeen) return null;
      if (inSection) sectionSeen = true;
    } else if (inSection && token.type === "list_item_open" && token.level === 1 && token.map) {
      const line = lines[token.map[0]];
      const entry = line?.match(/^[-+*]\s+(\S+):\s+(\S.*)$/u);
      if (!entry || !statementId.test(entry[1]!) || drafts.has(entry[1]!)) return null;
      drafts.add(entry[1]!);
    }
  }
  return drafts;
}

/** Read only the actual baseline head. A retained ancestor or inherited
 * parent's scope cannot be replaced by an authored child review. */
export async function preflightApprovalSupersession(args: {
  itemId: string;
  expectedCurrentBaselineId: string;
  sourceText: string;
  currentManifest: Manifest;
}): Promise<SupersessionRefusal | SupersessionInput | null> {
  const expectedCurrentBaselineId = args.expectedCurrentBaselineId;
  const common = { gateStatus: "unrun" as const, expectedCurrentBaselineId };
  const unavailable = {
    ...common, error: "approval-baseline-unavailable" as const,
    message: "The requested approval no longer identifies a verifiable current baseline. Refresh the exact review request before dispatch.",
  };
  try {
    const source = await loadBaselineSource(prisma as never, args.itemId);
    if (!source || source.origin !== "own") return unavailable;
    const parsed = parseBaselinePayloads(source.baselineRows.map(row => row.payload));
    const head = parsed && currentBaseline(parsed);
    if (!head || head.baselineId !== expectedCurrentBaselineId) return unavailable;
    const retained = retainedManifest.safeParse(head);
    if (!retained.success) return unavailable;
    const change = diffInitiativeScopeManifests({
      ...ok(), artifactDigest: retained.data.artifactDigest,
      objectives: retained.data.objectiveStatements, acceptance: retained.data.acceptanceStatements,
    }, args.currentManifest);
    const requiredStatementIds = [...change.removedOrChangedObjectiveIds, ...change.removedOrChangedAcceptanceIds];
    if (!requiredStatementIds.length) return null;
    const drafts = readDraftIds(args.sourceText);
    const expected = new Set(requiredStatementIds);
    if (!drafts || [...drafts].some(id => !expected.has(id))) return {
      ...common, error: "supersession-dispositions-invalid", requiredStatementIds,
      message: "Draft supersession dispositions must contain exactly one bullet for each changed statement under the named heading.",
    };
    const missingStatementIds = requiredStatementIds.filter(id => !drafts.has(id));
    return missingStatementIds.length ? {
      ...common, error: "supersession-dispositions-required", requiredStatementIds, missingStatementIds,
      message: "Add a draft explanation for each listed statement under the Draft supersession dispositions heading. The independent reviewer still determines the outcome.",
    } : { expectedCurrentBaselineId, requiredStatementIds };
  } catch {
    return unavailable;
  }
}
