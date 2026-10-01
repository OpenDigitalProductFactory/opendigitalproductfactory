import { describe, expect, it } from "vitest";
import { SOURCE_READ_DEFAULT_MAX_CHARS } from "../source-page-lines";
import {
  normalizeTerminalToolArguments,
  readerPageCharsForModelView,
  summarizeTerminalToolProgress,
  type TerminalToolPolicy,
  type TerminalToolRecord,
} from "./terminal-tool-policy";
import { DEFAULT_TOOL_RESULT_CHAR_CAP, clampToolResultForModel } from "./tool-result-budget";

// BI-E8237EAE (residual, observed 2026-09-23 08:18 on plan-review for
// BI-815D40C6): the reader's default page is 12,000 chars, but a reviewer's
// first dispatch sees tool results through the 4,000-char default cap. Every
// first read arrived truncated, was ruled invalid evidence, and the model was
// told to restart with smaller pages — six restarts spent the whole budget on
// an 8.8k plan that one visible page series would have covered.

const policy: TerminalToolPolicy = {
  writerToolName: "record_initiative_design_review",
  readerToolNames: ["read_source_at_version"],
  minimumSuccessfulReaderCalls: 1,
  maximumReaderCalls: 6,
  immutableReaderArguments: {
    repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
    path: "docs/superpowers/plans/2026-09-22-office-document-conversion-plan.md",
    version: "9dc564fda36a4a58c7efd1892cda60e260ffa16d",
    expectedBlobId: "d5fc24a89784004d4460aac3812b61c4c168d690",
  },
};

function sourcePage(content: string, startLine: number, totalLines: number, totalChars: number, cursor: string | null) {
  const endLine = startLine + content.split("\n").length - 1 - (content.endsWith("\n") ? 1 : 0);
  return {
    repositoryFullName: policy.immutableReaderArguments!.repositoryFullName,
    path: policy.immutableReaderArguments!.path,
    version: policy.immutableReaderArguments!.version,
    blobId: policy.immutableReaderArguments!.expectedBlobId,
    content,
    startLine,
    endLine,
    totalLines,
    totalChars,
    hasMore: cursor !== null,
    nextCursor: cursor,
  };
}

describe("governed reader pages fit what the model can see", () => {
  it("clamps an unsized or oversized read to the model-visible page", () => {
    const page = readerPageCharsForModelView(DEFAULT_TOOL_RESULT_CHAR_CAP);
    expect(page).toBeLessThan(DEFAULT_TOOL_RESULT_CHAR_CAP);
    for (const requested of [undefined, SOURCE_READ_DEFAULT_MAX_CHARS, 16_000]) {
      const normalized = normalizeTerminalToolArguments(
        policy,
        "read_source_at_version",
        requested === undefined ? {} : { maxChars: requested },
        DEFAULT_TOOL_RESULT_CHAR_CAP,
      );
      expect(normalized).toMatchObject({ kind: "allow", arguments: { maxChars: page } });
    }
    // A smaller page the reviewer asked for is kept.
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", { maxChars: 500 }, DEFAULT_TOOL_RESULT_CHAR_CAP))
      .toMatchObject({ kind: "allow", arguments: { maxChars: 500 } });
    // Without a model view the reader's own default stands.
    expect(normalizeTerminalToolArguments(policy, "read_source_at_version", {}))
      .toMatchObject({ kind: "allow", arguments: expect.not.objectContaining({ maxChars: expect.anything() }) });
  });

  it("delivers a clamped page of escape-heavy markdown to the model untruncated", () => {
    const pageChars = readerPageCharsForModelView(DEFAULT_TOOL_RESULT_CHAR_CAP);
    const line = '| `S1` | "quoted" \\ path\\to | back`tick` | ümlaut → arrow |\n';
    const content = line.repeat(Math.ceil(pageChars / line.length)).slice(0, pageChars);
    const result = {
      success: true,
      message: `Read ${policy.immutableReaderArguments!.path} lines 1-200 of 900 at ${policy.immutableReaderArguments!.version} (more available).`,
      data: sourcePage(content, 1, 900, 60_000, "eyJ2IjoxLCJvZmZzZXQiOjI0MDAsImJpbmRpbmciOiI4YmE2NTlhYjQzMzY0MzJlNDM4YWM5NzhlZWM5ODEwNzcwODVmN2ZkZTY3ZDZhNmYzYjMyNThhOTY4ZGEzMmQ4In0"),
    };
    expect(clampToolResultForModel(result, { maxChars: DEFAULT_TOOL_RESULT_CHAR_CAP }).truncated).toBe(false);
  });

  it("scales the reader budget to the artifact instead of a fixed six reads", () => {
    const pageChars = 2_400;
    const totalChars = 20_000; // 9 pages at this page size
    const records: TerminalToolRecord[] = [];
    let offset = 0;
    let line = 1;
    for (let index = 0; index < 7; index += 1) {
      const content = `${"x".repeat(pageChars - 1)}\n`;
      offset += content.length;
      const cursor = offset < totalChars ? `cursor-${index + 1}` : null;
      records.push({
        name: "read_source_at_version",
        args: index === 0 ? {} : { cursor: `cursor-${index}` },
        result: { success: true, data: sourcePage(content, line, 9, totalChars, cursor) },
      });
      line += 1;
    }
    const progress = summarizeTerminalToolProgress(policy, records);
    expect(progress.readerAttempts).toBe(7);
    expect(progress.readerBudgetExhausted).toBe(false);
    expect(progress.partialEvidence).toBe(true);
  });

  it("keeps the fixed budget floor when the artifact fits in one page", () => {
    const records: TerminalToolRecord[] = Array.from({ length: 6 }, () => ({
      name: "read_source_at_version",
      args: {},
      result: { success: true, data: sourcePage("small\n", 1, 1, 6, null) },
    }));
    expect(summarizeTerminalToolProgress(policy, records).readerBudgetExhausted).toBe(true);
  });
});
