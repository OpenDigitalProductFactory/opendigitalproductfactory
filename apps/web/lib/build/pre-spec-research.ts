// Research-before-spec — a governed deep-research step for Build Studio ideate.
//
// BI-F8C5E01C (EP-F7E35344). Ideate today researches the CODEBASE (internal)
// but never the world: standards, prior art, common pitfalls, market context.
// The 2026 evidence (Anthropic multi-agent research; brownfield studies) says a
// short, cited pre-spec research pass is the cheapest lever on spec quality —
// but only when it is (a) right-size TRIGGERED (not run on every one-line fix),
// (b) source-CITED, and (c) adversarially VERIFIED so an unsupported claim is
// flagged rather than laundered into the design.
//
// This composes the existing web substrate (searchPublicWeb / fetchPublicWeb-
// siteEvidence) and routed inference into: plan queries -> fan-out search ->
// fetch top sources -> synthesize a cited draft -> verify each finding against
// its cited source -> return a report. Every external call is dependency-
// injected so the pipeline is unit-testable with zero network/inference, and
// the caller gates it behind a flag + fail-OPEN (research never blocks ideate).

/** A closed, small trigger input — the fields ideate already has in scope. */
export type ResearchTriggerInput = {
  /** BacklogItem work type; only "feature" work warrants external research. */
  workType?: string | null;
  /** Effort size from the BI. */
  effortSize?: string | null;
  /** Deliverable sensitivity, when computed (auth/billing/PII/security ⇒ high). */
  sensitivity?: "low" | "elevated" | "high" | null;
};

const RESEARCH_SIZES: ReadonlySet<string> = new Set(["medium", "large", "xlarge"]);

/**
 * PURE right-size trigger. Run pre-spec research only when the spec quality is
 * worth the search spend: a *feature* that is medium+ in size OR carries
 * elevated/high deliverable sensitivity. A small feature, or any fix/chore/doc,
 * is skipped — its design is either trivial or codebase-local. Deterministic and
 * side-effect-free.
 */
export function shouldRunPreSpecResearch(input: ResearchTriggerInput): boolean {
  if ((input.workType ?? "feature") !== "feature") return false;
  if (input.sensitivity === "elevated" || input.sensitivity === "high") return true;
  return RESEARCH_SIZES.has(input.effortSize ?? "");
}

export type ResearchSource = {
  index: number;
  title: string;
  url: string;
  excerpt: string;
};

export type ResearchFinding = {
  /** The claim, in one sentence. */
  claim: string;
  /** 1-based indexes into the sources array supporting the claim. */
  citations: number[];
  /** Set by the verification pass: could the claim be grounded in a cited source? */
  verified: boolean;
};

export type ResearchReport = {
  topic: string;
  queries: string[];
  sources: ResearchSource[];
  findings: ResearchFinding[];
  /** Findings the verifier could not ground — surfaced, never silently dropped. */
  caveats: string[];
  summary: string;
};

export type PreSpecResearchDeps = {
  /** Fan out N focused research queries for a topic (injected inference). */
  planQueries: (topic: string) => Promise<string[]>;
  /** Web search (injected searchPublicWeb). */
  search: (query: string) => Promise<Array<{ title: string; url: string; description?: string }>>;
  /** Fetch a source's text (injected fetchPublicWebsiteEvidence). */
  fetchSource: (url: string) => Promise<{ title: string | null; textExcerpt: string | null }>;
  /** Synthesize cited findings from the sources (injected inference). Must
   *  return findings whose citations index into the provided sources. */
  synthesize: (topic: string, sources: ResearchSource[]) => Promise<Array<{ claim: string; citations: number[] }>>;
  /** Adversarially verify one finding against its cited source text (injected
   *  inference). Returns true only if the claim is grounded in the citation. */
  verifyFinding?: (finding: { claim: string; citations: number[] }, sources: ResearchSource[]) => Promise<boolean>;
  /** Caps. */
  maxQueries?: number;
  maxSourcesPerQuery?: number;
  maxSources?: number;
};

const DEFAULTS = { maxQueries: 4, maxSourcesPerQuery: 3, maxSources: 8 } as const;

/**
 * Conduct the pre-spec research pass. Fan-out searches, fetch the top distinct
 * sources, synthesize cited findings, then verify each finding against its
 * cited source; unverifiable findings are moved to `caveats` (never presented as
 * fact). Returns a structured, cited report. The caller renders + attaches it.
 *
 * Robust by construction: a failing search/fetch for one query is skipped, not
 * fatal; with no reachable sources it returns an honest empty report.
 */
export async function conductPreSpecResearch(
  topic: string,
  deps: PreSpecResearchDeps,
): Promise<ResearchReport> {
  const caps = { ...DEFAULTS, ...deps };
  const queries = (await safe(() => deps.planQueries(topic), [])).slice(0, caps.maxQueries);

  // Fan-out search, dedup by URL, cap total sources.
  const seenUrls = new Set<string>();
  const sources: ResearchSource[] = [];
  for (const query of queries) {
    if (sources.length >= caps.maxSources) break;
    const hits = (await safe(() => deps.search(query), [])).slice(0, caps.maxSourcesPerQuery);
    for (const hit of hits) {
      if (sources.length >= caps.maxSources) break;
      if (!hit.url || seenUrls.has(hit.url)) continue;
      seenUrls.add(hit.url);
      const fetched = await safe(() => deps.fetchSource(hit.url), { title: hit.title, textExcerpt: hit.description ?? "" });
      sources.push({
        index: sources.length + 1,
        title: fetched.title || hit.title || hit.url,
        url: hit.url,
        excerpt: (fetched.textExcerpt || hit.description || "").slice(0, 1200),
      });
    }
  }

  if (sources.length === 0) {
    return { topic, queries, sources: [], findings: [], caveats: ["No reachable external sources — proceed on codebase evidence alone."], summary: "Pre-spec research found no reachable sources." };
  }

  const rawFindings = (await safe(() => deps.synthesize(topic, sources), [])).filter(
    (f) => f.claim && f.citations.every((c) => c >= 1 && c <= sources.length),
  );

  const findings: ResearchFinding[] = [];
  const caveats: string[] = [];
  await Promise.all(
    rawFindings.map(async (f) => {
      const verified = deps.verifyFinding ? await safe(() => deps.verifyFinding!(f, sources), false) : f.citations.length > 0;
      const finding: ResearchFinding = { claim: f.claim, citations: f.citations, verified };
      if (verified) findings.push(finding);
      else caveats.push(`Unverified: ${f.claim}`);
    }),
  );

  const summary = findings.length > 0
    ? `${findings.length} cited finding(s) across ${sources.length} source(s)${caveats.length ? `; ${caveats.length} claim(s) could not be grounded and were held back` : ""}.`
    : `No findings could be grounded in a cited source across ${sources.length} source(s).`;

  return { topic, queries, sources, findings, caveats, summary };
}

/** Render a report as a compact cited markdown block for the ideate evidence trail. */
export function formatResearchReportMarkdown(report: ResearchReport): string {
  const lines: string[] = [`### Pre-spec research — ${report.topic}`, "", report.summary, ""];
  if (report.findings.length > 0) {
    lines.push("**Findings (cited, verified):**");
    for (const f of report.findings) lines.push(`- ${f.claim} ${f.citations.map((c) => `[${c}]`).join("")}`);
    lines.push("");
  }
  if (report.caveats.length > 0) {
    lines.push("**Caveats (held back — not grounded):**");
    for (const c of report.caveats) lines.push(`- ${c}`);
    lines.push("");
  }
  if (report.sources.length > 0) {
    lines.push("**Sources:**");
    for (const s of report.sources) lines.push(`${s.index}. [${s.title}](${s.url})`);
  }
  return lines.join("\n");
}

/** Run a thunk, returning a fallback on any throw (per-step robustness). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

// ─── Inference-backed deps factory ───────────────────────────────────────────
// Builds the PreSpecResearchDeps from three injected primitives (an LLM
// dispatch, a web search, a source fetch), owning the prompt construction and
// JSON parsing so ideate-on-approval stays a thin caller and the parsing is
// unit-testable with a fake llm.

const firstJson = (raw: string): unknown => {
  const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
};

export function makeInferenceResearchDeps(primitives: {
  llm: (prompt: string) => Promise<string>;
  search: PreSpecResearchDeps["search"];
  fetchSource: PreSpecResearchDeps["fetchSource"];
  caps?: { maxQueries?: number; maxSourcesPerQuery?: number; maxSources?: number };
}): PreSpecResearchDeps {
  const { llm, search, fetchSource } = primitives;
  return {
    ...primitives.caps,
    search,
    fetchSource,
    planQueries: async (topic) => {
      const raw = await llm(
        `Plan focused web-search queries to research a software feature before its spec is written. Cover standards/best-practice, prior art, and common pitfalls. Feature: "${topic}". Respond with ONLY a JSON array of 3-5 short query strings.`,
      );
      const parsed = firstJson(raw);
      return Array.isArray(parsed) ? parsed.map((q) => String(q)).filter(Boolean) : [];
    },
    synthesize: async (topic, sources) => {
      const src = sources.map((s) => `[${s.index}] ${s.title}\n${s.excerpt}`).join("\n\n");
      const raw = await llm(
        `From the sources below, extract the factual findings relevant to building "${topic}". Cite every finding by source number. Do NOT state anything not supported by a source.\n\nSOURCES:\n${src}\n\nRespond with ONLY JSON: {"findings":[{"claim":"<one sentence>","citations":[<source numbers>]}]}`,
      );
      const parsed = firstJson(raw) as { findings?: Array<{ claim?: unknown; citations?: unknown }> } | null;
      if (!parsed?.findings || !Array.isArray(parsed.findings)) return [];
      return parsed.findings
        .map((f) => ({
          claim: String(f.claim ?? "").trim(),
          citations: Array.isArray(f.citations) ? f.citations.map((c) => Number(c)).filter((c) => Number.isInteger(c)) : [],
        }))
        .filter((f) => f.claim.length > 0);
    },
    verifyFinding: async (finding, sources) => {
      const cited = sources.filter((s) => finding.citations.includes(s.index));
      if (cited.length === 0) return false;
      const src = cited.map((s) => `[${s.index}] ${s.title}\n${s.excerpt}`).join("\n\n");
      const raw = await llm(
        `Is this claim DIRECTLY supported by the cited source text below? Claim: "${finding.claim}"\n\nCITED SOURCE(S):\n${src}\n\nAnswer with ONLY JSON: {"grounded": true|false}. Default to false if the source does not clearly support the claim.`,
      );
      const parsed = firstJson(raw) as { grounded?: unknown } | null;
      return parsed?.grounded === true;
    },
  };
}
