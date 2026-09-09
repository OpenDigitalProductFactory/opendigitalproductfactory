import { describe, expect, it } from "vitest";

import {
  boundLargeStrings,
  excerptText,
  offloadEvidenceOutput,
  sha256Hex,
  utf8ByteLength,
  EVIDENCE_EXCERPT_HEAD_BYTES,
  EVIDENCE_EXCERPT_TAIL_BYTES,
  type OffloadedTextReference,
} from "./bounded-output";

const big = (bytes: number, fill = "x") => fill.repeat(bytes);

describe("boundLargeStrings (pure, ledger side)", () => {
  it("returns the same reference when nothing exceeds the ceiling", () => {
    const input = { a: "small", nested: { b: ["also small"] }, n: 1 };
    expect(boundLargeStrings(input, 1024)).toBe(input);
  });

  it("replaces an oversized string leaf with a digest marker and keeps siblings", () => {
    const log = big(5000, "L");
    const input = { evidence: { output: log, sha: "abc" }, mode: "single-branch" };
    const bounded = boundLargeStrings(input, 1024) as typeof input & {
      evidence: { output: { __dpfBounded: true; sha256: string; byteLength: number; head: string } };
    };
    expect(bounded).not.toBe(input);
    expect(bounded.mode).toBe("single-branch");
    expect(bounded.evidence.sha).toBe("abc");
    expect(bounded.evidence.output).toMatchObject({
      __dpfBounded: true,
      sha256: sha256Hex(log),
      byteLength: 5000,
    });
    expect(bounded.evidence.output.head.length).toBeLessThanOrEqual(4096);
    // The original is never mutated.
    expect(typeof input.evidence.output).toBe("string");
  });

  it("bounds oversized strings inside arrays", () => {
    const bounded = boundLargeStrings(["ok", big(3000)], 1024) as unknown[];
    expect(bounded[0]).toBe("ok");
    expect(bounded[1]).toMatchObject({ __dpfBounded: true, byteLength: 3000 });
  });
});

describe("excerptText", () => {
  it("keeps head and tail and names the omitted byte count and digest", () => {
    const text = `${big(EVIDENCE_EXCERPT_HEAD_BYTES, "H")}${big(1000, "M")}${big(EVIDENCE_EXCERPT_TAIL_BYTES, "T")}`;
    const out = excerptText(text, "deadbeef", utf8ByteLength(text));
    expect(out.startsWith(big(EVIDENCE_EXCERPT_HEAD_BYTES, "H"))).toBe(true);
    expect(out.endsWith(big(EVIDENCE_EXCERPT_TAIL_BYTES, "T"))).toBe(true);
    expect(out).toContain("[1000 bytes omitted — full output sha256:deadbeef]");
    expect(out).not.toContain("M");
  });

  it("returns short text unchanged", () => {
    expect(excerptText("short", "d", 5)).toBe("short");
  });
});

describe("offloadEvidenceOutput (evidence writer side)", () => {
  const fakeWriter = (calls: string[]) => async (text: string): Promise<OffloadedTextReference> => {
    calls.push(text);
    return { sha256: sha256Hex(text), storageKey: `documents/sha256/xx/yy/${sha256Hex(text)}`, sizeBytes: utf8ByteLength(text), mimeType: "text/plain" };
  };

  it("leaves small evidence untouched (same reference) and never writes a blob", async () => {
    const calls: string[] = [];
    const evidence = { output: "all green", sha: "abc" };
    const result = await offloadEvidenceOutput(evidence, { ceilingBytes: 1024, writeBlob: fakeWriter(calls) });
    expect(result).toBe(evidence);
    expect(calls).toHaveLength(0);
  });

  it("writes oversized output once and rewrites the evidence with an excerpt plus reference", async () => {
    const calls: string[] = [];
    const log = `${big(40_000, "a")}\nFAIL tests/x.test.ts\n`;
    const evidence = { output: log, sha: "abc", commands: ["pnpm test"] };
    const result = (await offloadEvidenceOutput(evidence, { ceilingBytes: 1024, writeBlob: fakeWriter(calls) })) as {
      output: string;
      outputBlob: OffloadedTextReference;
      outputTruncated: boolean;
      sha: string;
      commands: string[];
    };
    expect(calls).toEqual([log]);
    expect(result.outputTruncated).toBe(true);
    expect(result.outputBlob.sha256).toBe(sha256Hex(log));
    expect(result.outputBlob.sizeBytes).toBe(utf8ByteLength(log));
    // Still a string, still ends with the failing line — readers that only need the tail keep working.
    expect(typeof result.output).toBe("string");
    expect(result.output.endsWith("FAIL tests/x.test.ts\n")).toBe(true);
    expect(utf8ByteLength(result.output)).toBeLessThan(utf8ByteLength(log));
    expect(result.sha).toBe("abc");
    expect(result.commands).toEqual(["pnpm test"]);
  });

  it("is idempotent: an already-offloaded evidence object is below the ceiling and passes through", async () => {
    const calls: string[] = [];
    const first = await offloadEvidenceOutput({ output: big(50_000) }, { ceilingBytes: 1024, writeBlob: fakeWriter(calls) });
    const second = await offloadEvidenceOutput(first, { ceilingBytes: 64 * 1024, writeBlob: fakeWriter(calls) });
    expect(second).toBe(first);
    expect(calls).toHaveLength(1);
  });

  it("ignores non-object evidence and evidence without a string output", async () => {
    const calls: string[] = [];
    expect(await offloadEvidenceOutput("raw", { writeBlob: fakeWriter(calls) })).toBe("raw");
    const noOutput = { sha: "abc", output: { nested: true } };
    expect(await offloadEvidenceOutput(noOutput, { writeBlob: fakeWriter(calls) })).toBe(noOutput);
    expect(calls).toHaveLength(0);
  });
});
