// apps/web/lib/tak/coworker-job-description.test.ts
//
// BI-5CCBF85B. What this suite protects: a coworker about to execute work is
// handed its own job description, and when it cannot be, somebody finds out.
//
// The defect these tests would have caught was invisible for months precisely
// because the miss was silent — the coworker still ran, still used tools, still
// reported a summary, and nothing anywhere said it had no idea what its job
// was.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const findMany = vi.fn();
const findUnique = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    promptTemplate: {
      findMany: (...args: unknown[]) => findMany(...args),
      findUnique: (...args: unknown[]) => findUnique(...args),
    },
  },
}));

import {
  loadCoworkerJobDescription,
  unresolvedJobDescriptions,
  invalidateJobDescriptionIndex,
} from "./coworker-job-description";

const FALLBACK =
  "You are Inventory Specialist. Complete the assigned scheduled work with your granted tools.";

const JOB_DESCRIPTION = "# Role\nYou are the Digital Product Estate Specialist.";

beforeEach(() => {
  findMany.mockReset();
  findUnique.mockReset();
  invalidateJobDescriptionIndex();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadCoworkerJobDescription", () => {
  it("finds a job description filed under a name that is not the agent id", () => {
    // The whole defect in one case: the file is called
    // `policy-enforcement-agent`, the coworker is called `AGT-100`, and the
    // file sits under `specialist` rather than `route-persona`.
    findMany.mockResolvedValue([
      {
        category: "specialist",
        slug: "policy-enforcement-agent",
        metadata: { agentId: "AGT-100" },
      },
    ]);
    findUnique.mockResolvedValue({
      content: JOB_DESCRIPTION,
      composesFrom: [],
      enabled: true,
    });

    return loadCoworkerJobDescription("AGT-100", FALLBACK).then((result) => {
      expect(result.resolved).toBe(true);
      expect(result.content).toContain("Digital Product Estate Specialist");
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            category_slug: {
              category: "specialist",
              slug: "policy-enforcement-agent",
            },
          },
        }),
      );
    });
  });

  it("reports the coworker by name when it has no job description", async () => {
    findMany.mockResolvedValue([]);

    const result = await loadCoworkerJobDescription("AGT-NOBODY", FALLBACK);

    expect(result.resolved).toBe(false);
    expect(unresolvedJobDescriptions().map((u) => u.canonicalAgentId)).toContain(
      "AGT-NOBODY",
    );
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("coworker_job_profile_unresolved"),
    );
  });

  it("still lets a coworker finish the work in front of it when its job is missing", async () => {
    // Throwing here would strand a mid-run coworker. The run continues on the
    // generic instruction; the difference from before is that it is now loud.
    findMany.mockResolvedValue([]);

    const result = await loadCoworkerJobDescription("AGT-NOBODY", FALLBACK);

    expect(result.content).toBe(FALLBACK);
  });

  it("keeps working when the database is unreachable", async () => {
    findMany.mockRejectedValue(new Error("connection refused"));

    const result = await loadCoworkerJobDescription("AGT-100", FALLBACK);

    expect(result.content).toBe(FALLBACK);
    expect(result.resolved).toBe(false);
  });

  it("does not pass off an empty template as a job description", async () => {
    // An admin can disable or blank a prompt. A coworker handed an empty string
    // would look resolved and behave like one with no job at all.
    findMany.mockResolvedValue([
      { category: "route-persona", slug: "coo", metadata: { agentId: "AGT-ORCH-000" } },
    ]);
    findUnique.mockResolvedValue({ content: "   ", composesFrom: [], enabled: true });

    const result = await loadCoworkerJobDescription("AGT-ORCH-000", FALLBACK);

    expect(result.resolved).toBe(false);
    expect(result.content).toBe(FALLBACK);
  });

  it("reads the roster once and serves later coworkers from the cache", async () => {
    findMany.mockResolvedValue([
      { category: "route-persona", slug: "coo", metadata: { agentId: "AGT-ORCH-000" } },
      { category: "specialist", slug: "hr", metadata: { agentId: "AGT-WS-HR" } },
    ]);
    findUnique.mockResolvedValue({
      content: JOB_DESCRIPTION,
      composesFrom: [],
      enabled: true,
    });

    await loadCoworkerJobDescription("AGT-ORCH-000", FALLBACK);
    await loadCoworkerJobDescription("AGT-WS-HR", FALLBACK);

    // Every autonomous turn resolves a job description; a query per turn per
    // coworker would put the roster read on the hot path.
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("cannot be used to forge log entries through a crafted agent id", async () => {
    // request_coworker accepts an agent id over an external token, so this value
    // is caller-supplied. A crafted id carrying newlines could otherwise write
    // whole extra log lines and make a coworker look like it resolved a job it
    // never received. Reported by CodeQL on this file.
    findMany.mockResolvedValue([]);
    const forged = [
      "AGT-EVIL",
      "[coworker_job_profile_unresolved] AGT-REAL resolved fine",
    ].join("\n");

    await loadCoworkerJobDescription(forged, FALLBACK);

    expect(vi.mocked(console.warn).mock.calls).toHaveLength(1);
    const line = String(vi.mocked(console.warn).mock.calls[0][0]);
    // Two properties defeat the forgery, and the attacker's words surviving as
    // inline text defeats nothing on its own. First: the warning stays on one
    // line, so no second entry can form. Second: the bracketed prefix a reader
    // and a log parser key on appears exactly once — the genuine one.
    expect(line).not.toMatch(/[\r\n]/);
    expect(line.match(/\[coworker_job_profile_unresolved\]/g)).toHaveLength(1);
  });

  it("treats the unicode line separators as line breaks too", async () => {
    // U+2028 and U+2029 end a line in plenty of log viewers and in JavaScript
    // itself, so a sanitiser that only knows \r and \n still leaves the forgery
    // open in exactly the places a person would read the log.
    findMany.mockResolvedValue([]);
    const forged = `AGT-EVIL\u2028[coworker_job_profile_unresolved] AGT-REAL fine\u2029`;

    await loadCoworkerJobDescription(forged, FALLBACK);

    const line = String(vi.mocked(console.warn).mock.calls[0][0]);
    expect(line).not.toMatch(/[\u2028\u2029]/);
    expect(line.match(/\[coworker_job_profile_unresolved\]/g)).toHaveLength(1);
  });

  it("ignores a prompt that declares no coworker", async () => {
    findMany.mockResolvedValue([
      { category: "specialist", slug: "shared-identity", metadata: null },
    ]);

    const result = await loadCoworkerJobDescription("shared-identity", FALLBACK);

    expect(result.resolved).toBe(false);
  });
});
