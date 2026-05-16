import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Stub the underlying engine modules. The pipeline's job is to glue them
// together; we don't re-cover Phase 2.1 / 2.2 / 2.3a logic here.
//
// Use vi.hoisted because vi.mock is hoisted to the top of the file —
// module-scope const declarations aren't visible to mock factories
// otherwise.

const stubs = vi.hoisted(() => ({
  ingestStub: vi.fn(),
  proposeStub: vi.fn(),
  commitStub: vi.fn(),
  snapshotStub: vi.fn(),
  rawSourceFindFirst: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    rawSource: { findFirst: stubs.rawSourceFindFirst },
    wikiPage: {},
    wikiPageRevision: {},
    wikiPageLink: {},
    wikiPageSource: {},
    wikiIngestEvent: {},
  },
}));

vi.mock("./ingest", () => ({
  ingestRawSourceFromFile: (...args: unknown[]) => stubs.ingestStub(...args),
}));

vi.mock("./proposal", () => ({
  proposeWikiDiff: (...args: unknown[]) => stubs.proposeStub(...args),
}));

vi.mock("./schema-context", () => ({
  loadExistingSlugSnapshot: (...args: unknown[]) => stubs.snapshotStub(...args),
}));

vi.mock("./proposal-commit", () => ({
  commitIngestProposal: (...args: unknown[]) => stubs.commitStub(...args),
}));

const { ingestStub, proposeStub, commitStub, snapshotStub, rawSourceFindFirst } = stubs;

import {
  runIngestPipeline,
  summarizePipelineResult,
  type RunIngestPipelineInput,
} from "./ingest-pipeline";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeBaseInput(
  overrides: Partial<RunIngestPipelineInput> = {},
): RunIngestPipelineInput {
  const scratch = mkdtempSync(join(tmpdir(), "wiki-pipeline-test-"));
  const path = join(scratch, "article.md");
  writeFileSync(path, "---\ntitle: T\n---\n\nbody");
  return {
    source: { filePath: path, sourceType: "article", sourceKey: "articles/t" },
    organizationId: "org_test",
    mode: "commit",
    infer: async () => "{}",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ingestStub.mockResolvedValue({
    rawSourceId: "rs_1",
    sourceKey: "articles/example",
    sourceType: "article",
    isNew: true,
    eventId: "evt_ingest_1",
  });
  rawSourceFindFirst.mockResolvedValue({
    sourceKey: "articles/example",
    title: "Example Article",
    abstract: "Existing abstract.",
    excerpt: "Body of the article.",
  });
  snapshotStub.mockResolvedValue({
    all: ["entities/digital-product"],
    byKind: {
      entity: ["entities/digital-product"],
      stance: [],
      heuristic: [],
      principle: [],
      summary: [],
      decision: [],
      runbook: [],
    },
  });
  proposeStub.mockResolvedValue({
    abstract: "Existing abstract.",
    claims: [
      {
        claim: "Digital Product is the unit.",
        targetSlug: "entities/digital-product",
        pageKind: "entity",
        proposeNew: false,
        confidence: 0.9,
        supportingExcerpt: "Pick one canonical model.",
      },
    ],
    stances: [],
    heuristics: [],
    parseErrors: [],
  });
  commitStub.mockResolvedValue({
    touchedPageIds: ["wp_dp"],
    createdPageSlugs: [],
    updatedPageSlugs: ["entities/digital-product"],
    skippedLowConfidence: [],
    errors: [],
    eventId: "evt_commit_1",
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Mode gating ────────────────────────────────────────────────────────────

describe("runIngestPipeline — mode gating", () => {
  it("rejects commit mode without an organizationId (kernel writes are PR-only)", async () => {
    const input = makeBaseInput({ organizationId: null, mode: "commit" });
    await expect(runIngestPipeline(input)).rejects.toThrow(
      /commit mode requires an organizationId.*PR-only/,
    );
  });

  it("allows propose mode without an organizationId (no writes)", async () => {
    const input = makeBaseInput({ organizationId: null, mode: "propose" });
    const result = await runIngestPipeline(input);
    expect(result.commit).toBeNull();
    expect(commitStub).not.toHaveBeenCalled();
  });
});

// ─── Source layer wiring ────────────────────────────────────────────────────

describe("runIngestPipeline — Phase 2.1 wiring", () => {
  it("forwards the source input to ingestRawSourceFromFile and surfaces the audit row", async () => {
    const input = makeBaseInput();
    const result = await runIngestPipeline(input);
    expect(ingestStub).toHaveBeenCalledTimes(1);
    expect(ingestStub.mock.calls[0][1]).toEqual(input.source);
    expect(result.source.rawSourceId).toBe("rs_1");
    expect(result.source.isNew).toBe(true);
  });

  it("throws when the just-ingested RawSource row cannot be read back", async () => {
    rawSourceFindFirst.mockResolvedValueOnce(null);
    const input = makeBaseInput();
    await expect(runIngestPipeline(input)).rejects.toThrow(
      /just-ingested RawSource rs_1 missing/,
    );
  });
});

// ─── Snapshot scoping ───────────────────────────────────────────────────────

describe("runIngestPipeline — snapshot scoping", () => {
  it("scopes the slug snapshot to the target org in commit mode", async () => {
    const input = makeBaseInput({ organizationId: "org_x", mode: "commit" });
    await runIngestPipeline(input);
    expect(snapshotStub).toHaveBeenCalledWith(expect.anything(), {
      organizationId: "org_x",
    });
  });

  it("uses a maintainer-wide snapshot (no scope filter) in propose mode", async () => {
    const input = makeBaseInput({ organizationId: null, mode: "propose" });
    await runIngestPipeline(input);
    expect(snapshotStub).toHaveBeenCalledWith(expect.anything(), {
      organizationId: undefined,
    });
  });
});

// ─── Proposal wiring ────────────────────────────────────────────────────────

describe("runIngestPipeline — Phase 2.2 wiring", () => {
  it("hands proposeWikiDiff the source body + abstract + snapshot + injected infer", async () => {
    const input = makeBaseInput();
    await runIngestPipeline(input);
    const arg = proposeStub.mock.calls[0][0];
    expect(arg.source).toEqual({
      sourceKey: "articles/example",
      title: "Example Article",
      body: "Body of the article.",
      abstract: "Existing abstract.",
    });
    expect(arg.snapshot).toEqual({
      all: ["entities/digital-product"],
      byKind: expect.objectContaining({ entity: ["entities/digital-product"] }),
    });
    expect(arg.infer).toBe(input.infer);
  });

  it("passes through parse errors on the proposal without blocking commit", async () => {
    proposeStub.mockResolvedValueOnce({
      abstract: "abs",
      claims: [],
      stances: [],
      heuristics: [],
      parseErrors: ["pass-2: model returned prose"],
    });
    const input = makeBaseInput();
    const result = await runIngestPipeline(input);
    expect(result.proposal.parseErrors).toEqual([
      "pass-2: model returned prose",
    ]);
    expect(commitStub).toHaveBeenCalledTimes(1);
  });
});

// ─── Commit wiring ──────────────────────────────────────────────────────────

describe("runIngestPipeline — Phase 2.3a wiring", () => {
  it("forwards the proposal + thresholds + attribution to commitIngestProposal", async () => {
    const input = makeBaseInput({
      source: {
        filePath: "/tmp/x.md",
        sourceType: "article",
        sourceKey: "articles/t",
        agentId: "agent_42",
        userId: "user_42",
        kernelVersion: "0.2.1",
      },
      acceptThreshold: 0.7,
      maxBodyDeltaRatio: 0.5,
    });
    await runIngestPipeline(input);
    const arg = commitStub.mock.calls[0][1];
    expect(arg).toMatchObject({
      rawSourceId: "rs_1",
      sourceKey: "articles/example",
      organizationId: "org_test",
      agentId: "agent_42",
      userId: "user_42",
      kernelVersion: "0.2.1",
      acceptThreshold: 0.7,
      maxBodyDeltaRatio: 0.5,
    });
    // The pipeline forwards the resolved WikiDiffProposal from
    // proposeWikiDiff straight through to commitIngestProposal.
    const proposalFromStub = await proposeStub.mock.results[0].value;
    expect(arg.proposal).toBe(proposalFromStub);
  });

  it("returns commit=null in propose mode and does not call commitIngestProposal", async () => {
    const input = makeBaseInput({ mode: "propose" });
    const result = await runIngestPipeline(input);
    expect(result.commit).toBeNull();
    expect(commitStub).not.toHaveBeenCalled();
  });
});

// ─── summarizePipelineResult ────────────────────────────────────────────────

describe("summarizePipelineResult", () => {
  it("renders a compact propose-mode summary", () => {
    const out = summarizePipelineResult({
      source: {
        rawSourceId: "rs_1",
        sourceKey: "articles/x",
        sourceType: "article",
        isNew: true,
        eventId: "evt_1",
      },
      proposal: {
        abstract: "a",
        claims: [{} as never, {} as never],
        stances: [{} as never],
        heuristics: [],
        parseErrors: [],
      },
      commit: null,
    });
    expect(out).toMatch(/Ingested articles\/x/);
    expect(out).toMatch(/2 claim\(s\), 1 stance\(s\), 0 heuristic\(s\)/);
    expect(out).toMatch(/Mode: propose/);
  });

  it("renders a compact commit-mode summary with new + updated counts", () => {
    const out = summarizePipelineResult({
      source: {
        rawSourceId: "rs_1",
        sourceKey: "articles/x",
        sourceType: "article",
        isNew: false,
        eventId: "evt_1",
      },
      proposal: {
        abstract: "a",
        claims: [{} as never],
        stances: [{} as never],
        heuristics: [{} as never],
        parseErrors: [],
      },
      commit: {
        touchedPageIds: ["a", "b", "c"],
        createdPageSlugs: ["entities/new"],
        updatedPageSlugs: ["entities/portfolio", "stances/foo"],
        skippedLowConfidence: [],
        errors: [],
        eventId: "evt_commit_1",
      },
    });
    expect(out).toMatch(/Re-ingested articles\/x/);
    expect(out).toMatch(/Committed: 1 new \+ 2 updated/);
    expect(out).toMatch(/Audit event evt_commit_1/);
    expect(out).toMatch(/New: entities\/new/);
  });

  it("flags parse errors and commit errors", () => {
    const out = summarizePipelineResult({
      source: {
        rawSourceId: "rs_1",
        sourceKey: "articles/x",
        sourceType: "article",
        isNew: true,
        eventId: "evt_1",
      },
      proposal: {
        abstract: "a",
        claims: [],
        stances: [],
        heuristics: [],
        parseErrors: ["pass-2: bad json", "pass-3: missing array"],
      },
      commit: {
        touchedPageIds: [],
        createdPageSlugs: [],
        updatedPageSlugs: [],
        skippedLowConfidence: [],
        errors: ["claim entities/x: refusing to commit — append exceeds maxBodyDeltaRatio"],
        eventId: "evt_commit_1",
      },
    });
    expect(out).toMatch(/2 parse error\(s\)/);
    expect(out).toMatch(/1 commit error\(s\)/);
  });
});
