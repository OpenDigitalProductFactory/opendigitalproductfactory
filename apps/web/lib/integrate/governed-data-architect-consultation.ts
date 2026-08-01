// Governed Data Architect consultation at build gates (BI-D506598C / A3).
//
// THE ANTI-PATTERN THIS AVOIDS. The design/plan gate already runs an advisory
// "architecture alignment" review as a THIRD routeAndCall with an anonymous
// Enterprise-Architect persona STRING (mcp-tools.ts reviewDesignDoc), the
// ea-architect Agent row completely uninvolved: the artifact trail exists (it
// joins the deliberation branch) but the ACTOR trail does not. The BI is
// explicit: do NOT add a FOURTH routeAndCall in that shape.
//
// THE GOVERNED WAY (build ON A1, BI-C654F960). This consultation resolves the
// REAL data-architect Agent (AGT-BUILD-DA), injects ITS profession corpus
// (BI-B31072B8 — MDM / index-collation practice) so the review is informed by
// construction, and attributes the findings to that agentId — so the actor
// trail exists. The model call is an INJECTED `runReviewer` so this module is
// unit-testable without an LLM and the caller controls how the governed turn is
// executed (a governed agentic turn, not an anonymous persona completion).
//
// SAFETY. Flag-gated by BUILD_GOVERNED_DA_CONSULTATION, default off: when off
// (the default) the gate is UNTOUCHED — the consultation is skipped and returns
// no findings. Advisory only, exactly like the architecture review: it never
// gates pass/fail; it surfaces data-architecture concerns for the coworker to
// fold into the spec. Fail-open: a corpus miss or reviewer error yields no
// findings, never a thrown error into the gate.

import {
  resolveProfessionCorpusContext,
  type ProfessionCorpusClient,
} from "@/lib/decision-perspective/profession-corpus";

/** The real build data-architect Agent — the ACTOR the consultation runs as. */
export const DATA_ARCHITECT_CONSULTATION_AGENT_ID = "AGT-BUILD-DA";

/** The profession-registry role slug for that Agent. Registry-driven agents use
 *  AGT-* as Agent.agentId and their role slug as Agent.name, and the corpus
 *  family resolver (findProfessionFamilyForAgentIdentity) matches on the role
 *  slug — so the identity must carry it to resolve the data-architect corpus. */
export const DATA_ARCHITECT_CONSULTATION_ROLE_SLUG = "build-data-architect";

/** Env flag; default off (only the exact string "true" enables it). */
export const BUILD_GOVERNED_DA_CONSULTATION_FLAG = "BUILD_GOVERNED_DA_CONSULTATION";

export function governedDaConsultationEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[BUILD_GOVERNED_DA_CONSULTATION_FLAG] === "true";
}

export type DataArchitectFindingSeverity = "critical" | "important" | "minor";

export interface DataArchitectFinding {
  severity: DataArchitectFindingSeverity;
  description: string;
}

export interface GovernedDaConsultationResult {
  /** True when the consultation did not run (flag off, corpus miss, or error). */
  skipped: boolean;
  /** The Agent the consultation ran as — the actor-trail attribution. */
  agentId: string;
  /** Advisory data-architecture findings (never gate pass/fail). */
  findings: DataArchitectFinding[];
  /** Corpus pages that informed the review. */
  corpusPages: number;
  /** Why it was skipped, when it was. */
  reason?: "disabled" | "corpus-miss" | "reviewer-error" | "no-findings";
}

/** The governed review turn. Injected so the module is testable and the caller
 *  owns HOW the governed turn runs (attributed to `agentId`, corpus in the
 *  system prompt). Returns the raw model text; findings are parsed from it. */
export type DataArchitectReviewer = (input: {
  agentId: string;
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

const SEVERITIES = new Set<DataArchitectFindingSeverity>(["critical", "important", "minor"]);

/**
 * Parse findings from the reviewer's response. Accepts a JSON object with a
 * `findings` array of `{ severity, description }`; tolerant of extra prose
 * around the JSON. Returns [] on anything unparseable (fail-open — advisory).
 */
export function parseDataArchitectFindings(raw: string): DataArchitectFinding[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  const findings = (parsed as { findings?: unknown })?.findings;
  if (!Array.isArray(findings)) return [];
  return findings
    .filter(
      (f): f is DataArchitectFinding =>
        typeof f === "object" &&
        f !== null &&
        SEVERITIES.has((f as DataArchitectFinding).severity) &&
        typeof (f as DataArchitectFinding).description === "string" &&
        (f as DataArchitectFinding).description.trim().length > 0,
    )
    .map((f) => ({ severity: f.severity, description: f.description.trim() }));
}

const DA_LENS = [
  "You are the Data Architect reviewing a build's design for DATA-ARCHITECTURE",
  "alignment only — data model, schema stewardship, master-data / duplicate",
  "handling, index/collation integrity, migration safety. Advisory: surface",
  "concerns and concrete edits; never block the gate. Return ONLY a JSON object",
  '{ "findings": [ { "severity": "critical|important|minor", "description": "..." } ] }',
  "with an empty findings array when the design is data-architecturally sound.",
].join(" ");

/**
 * Run the governed Data Architect consultation over a build design/plan doc.
 * Returns advisory findings attributed to the real DA Agent, informed by its
 * profession corpus. A strict no-op when the flag is off.
 */
export async function runGovernedDataArchitectConsultation(input: {
  /** The design doc / plan under review, as text. */
  doc: string;
  runReviewer: DataArchitectReviewer;
  db: ProfessionCorpusClient;
  env?: Record<string, string | undefined>;
  /** Retrieval query for corpus ranking; defaults to the doc. */
  query?: string;
}): Promise<GovernedDaConsultationResult> {
  const agentId = DATA_ARCHITECT_CONSULTATION_AGENT_ID;
  const base: GovernedDaConsultationResult = { skipped: true, agentId, findings: [], corpusPages: 0 };

  if (!governedDaConsultationEnabled(input.env)) {
    return { ...base, reason: "disabled" };
  }

  const corpus = await resolveProfessionCorpusContext({
    db: input.db,
    // Actor is AGT-BUILD-DA; the role slug in `name` resolves the DA corpus family.
    identity: { agentId, name: DATA_ARCHITECT_CONSULTATION_ROLE_SLUG },
    query: input.query ?? input.doc.slice(0, 400),
  }).catch(() => null);

  const corpusBlock = corpus?.promptBlock ?? "";
  const systemPrompt = corpusBlock ? `${DA_LENS}\n\n${corpusBlock}` : DA_LENS;

  let raw: string;
  try {
    raw = await input.runReviewer({
      agentId,
      systemPrompt,
      userPrompt: `Review this build design for data-architecture alignment:\n\n${input.doc}`,
    });
  } catch (e) {
    console.warn("[da-consultation] reviewer failed (fail-open):", e);
    return { ...base, corpusPages: corpus?.pages.length ?? 0, reason: "reviewer-error" };
  }

  const findings = parseDataArchitectFindings(raw);
  return {
    skipped: false,
    agentId,
    findings,
    corpusPages: corpus?.pages.length ?? 0,
    reason: findings.length === 0 ? "no-findings" : undefined,
  };
}

/** Minimal review-transport the wire-site adapter supplies. Kept to two params
 *  so it composes with the gate's routeAndCall without coupling to its exact
 *  ChatMessage/RouteSensitivity types. */
type ReviewTransport = (
  messages: Array<{ role: "user"; content: string }>,
  systemPrompt: string,
) => Promise<{ content: string }>;

/**
 * Wire-site convenience: run the governed consultation using the build gate's
 * existing routed-inference (routeAndCall) as the review transport. The turn is
 * still GOVERNED — the corpus-informed system prompt is built from the real
 * AGT-BUILD-DA identity and the result is attributed to that agentId — so the
 * actor trail exists (the gap the BI names), unlike the anonymous architect
 * routeAndCall. Flag-gated default-off via runGovernedDataArchitectConsultation.
 */
export async function runGovernedDaConsultationViaRouteAndCall(opts: {
  doc: string;
  db: ProfessionCorpusClient;
  transport: ReviewTransport;
  env?: Record<string, string | undefined>;
  query?: string;
}): Promise<GovernedDaConsultationResult> {
  return runGovernedDataArchitectConsultation({
    doc: opts.doc,
    db: opts.db,
    env: opts.env,
    query: opts.query,
    runReviewer: async ({ systemPrompt, userPrompt }) => {
      const r = await opts.transport([{ role: "user", content: userPrompt }], systemPrompt);
      return r.content;
    },
  });
}
