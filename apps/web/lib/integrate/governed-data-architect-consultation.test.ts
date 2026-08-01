import { describe, it, expect, vi } from "vitest";

import {
  runGovernedDataArchitectConsultation,
  governedDaConsultationEnabled,
  parseDataArchitectFindings,
  DATA_ARCHITECT_CONSULTATION_AGENT_ID,
  BUILD_GOVERNED_DA_CONSULTATION_FLAG,
  type DataArchitectReviewer,
} from "./governed-data-architect-consultation";
import type { ProfessionCorpusClient } from "@/lib/decision-perspective/profession-corpus";

const ON = { [BUILD_GOVERNED_DA_CONSULTATION_FLAG]: "true" };

function fakeDb(rows: Array<{ slug: string; title: string; abstract: string; body: string }>): ProfessionCorpusClient {
  return { wikiPage: { findMany: vi.fn(async () => rows.map((r) => ({ ...r, metadata: null })) as never) } };
}
const DA_CORPUS = fakeDb([
  {
    slug: "professions/data-architect/mdm-what-it-does-and-does-not-do",
    title: "MDM",
    abstract: "MDM resolves duplicates after the fact.",
    body: "MDM resolves duplicates after the fact — it does not prevent their creation.",
  },
]);

describe("flag — default off", () => {
  it("is off unless exactly 'true'", () => {
    expect(governedDaConsultationEnabled({})).toBe(false);
    expect(governedDaConsultationEnabled({ [BUILD_GOVERNED_DA_CONSULTATION_FLAG]: "1" })).toBe(false);
    expect(governedDaConsultationEnabled(ON)).toBe(true);
  });
});

describe("parseDataArchitectFindings", () => {
  it("parses a findings JSON object, tolerating surrounding prose", () => {
    const raw = `Here is my review:\n{"findings":[{"severity":"critical","description":"No dedup gate on CustomerSite"}]}\nThanks`;
    expect(parseDataArchitectFindings(raw)).toEqual([
      { severity: "critical", description: "No dedup gate on CustomerSite" },
    ]);
  });
  it("drops malformed entries and returns [] on unparseable input", () => {
    expect(parseDataArchitectFindings("no json here")).toEqual([]);
    expect(parseDataArchitectFindings('{"findings":[{"severity":"bogus","description":"x"},{"severity":"minor","description":""}]}')).toEqual([]);
  });
});

describe("runGovernedDataArchitectConsultation (A3, BI-D506598C)", () => {
  it("is a STRICT no-op when the flag is off — reviewer and corpus never touched", async () => {
    const reviewer = vi.fn<DataArchitectReviewer>();
    const res = await runGovernedDataArchitectConsultation({
      doc: "some design", runReviewer: reviewer, db: DA_CORPUS, env: {},
    });
    expect(res).toMatchObject({ skipped: true, reason: "disabled", findings: [] });
    expect(reviewer).not.toHaveBeenCalled();
    expect(DA_CORPUS.wikiPage.findMany).not.toHaveBeenCalled();
  });

  it("runs GOVERNED — attributed to the real AGT-BUILD-DA agent, corpus-informed", async () => {
    let capturedSystemPrompt = "";
    let capturedAgentId = "";
    const reviewer: DataArchitectReviewer = async ({ agentId, systemPrompt }) => {
      capturedAgentId = agentId;
      capturedSystemPrompt = systemPrompt;
      return '{"findings":[{"severity":"important","description":"Model has no unique constraint on natural key"}]}';
    };
    const res = await runGovernedDataArchitectConsultation({
      doc: "A build that stores CustomerSite rows.", runReviewer: reviewer, db: DA_CORPUS, env: ON,
    });
    expect(res.skipped).toBe(false);
    // ACTOR trail: attributed to the real DA agent, not an anonymous persona.
    expect(res.agentId).toBe(DATA_ARCHITECT_CONSULTATION_AGENT_ID);
    expect(res.agentId).toBe("AGT-BUILD-DA");
    expect(capturedAgentId).toBe("AGT-BUILD-DA");
    // Informed by the DA profession corpus (BI-B31072B8).
    expect(res.corpusPages).toBeGreaterThan(0);
    expect(capturedSystemPrompt).toContain("MDM");
    // Advisory findings surfaced.
    expect(res.findings).toEqual([
      { severity: "important", description: "Model has no unique constraint on natural key" },
    ]);
  });

  it("fail-open: a reviewer error yields no findings, never throws into the gate", async () => {
    const reviewer: DataArchitectReviewer = async () => { throw new Error("model down"); };
    const res = await runGovernedDataArchitectConsultation({
      doc: "d", runReviewer: reviewer, db: DA_CORPUS, env: ON,
    });
    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("reviewer-error");
    expect(res.findings).toEqual([]);
  });

  it("returns cleanly with no findings when the design is sound", async () => {
    const reviewer: DataArchitectReviewer = async () => '{"findings":[]}';
    const res = await runGovernedDataArchitectConsultation({
      doc: "d", runReviewer: reviewer, db: DA_CORPUS, env: ON,
    });
    expect(res.skipped).toBe(false);
    expect(res.findings).toEqual([]);
    expect(res.reason).toBe("no-findings");
  });
});
