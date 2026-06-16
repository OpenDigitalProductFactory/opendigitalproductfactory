// Invariant: the coworker runtime prompt path ATTEMPTS profession-corpus
// retrieval and records usage/miss evidence. This is a source-level guard (the
// behavioral proof lives in profession-corpus.test.ts + prompt-assembler.test.ts):
// if a future refactor drops the wiring from the sendMessage prompt path, this
// fails loudly instead of silently reverting coworkers to corpus-blind prompts.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENT_COWORKER_SRC = readFileSync(
  join(__dirname, "../actions/agent-coworker.ts"),
  "utf8",
);

describe("profession-corpus runtime wiring (agent-coworker sendMessage)", () => {
  it("imports the profession-corpus retrieval service and evidence recorder", () => {
    expect(AGENT_COWORKER_SRC).toContain(
      'from "@/lib/decision-perspective/profession-corpus"',
    );
    expect(AGENT_COWORKER_SRC).toContain(
      'from "@/lib/decision-perspective/profession-corpus-evidence"',
    );
  });

  it("invokes the retrieval service in the prompt path", () => {
    expect(AGENT_COWORKER_SRC).toMatch(/resolveProfessionCorpusContext\(\{/);
  });

  it("feeds the resolved corpus into the unified assembler as professionContext", () => {
    expect(AGENT_COWORKER_SRC).toMatch(/professionContext:\s*selectedProfessionContext/);
  });

  it("injects the corpus into the legacy prompt path as well", () => {
    expect(AGENT_COWORKER_SRC).toMatch(/professionCorpus\?\.promptBlock/);
  });

  it("records corpus usage/miss evidence so misses are not silently swallowed", () => {
    expect(AGENT_COWORKER_SRC).toMatch(/recordProfessionCorpusEvidence\(/);
  });
});
