import { describe, expect, it, vi } from "vitest";

import { resolveSourceCommitShas, sourceCommitRefusal } from "./source-commit-resolution";

const FULL = "7fb295cf3a01e502439c29b858fdcdbe28f4758e";
const OTHER = "7fb295cf3a0ffffffffffffffffffffffffffff0";

function deps(overrides: Partial<Parameters<typeof resolveSourceCommitShas>[1]> = {}) {
  return {
    lookupProviderCommit: vi.fn(async () => ({ kind: "not-found" as const })),
    recordedCandidates: vi.fn(async () => [] as string[]),
    ...overrides,
  };
}

describe("resolveSourceCommitShas (BI-DF34D948)", () => {
  it("passes omitted and full SHAs through without any lookup", async () => {
    const d = deps();
    expect(await resolveSourceCommitShas({ baseSha: FULL }, d)).toEqual({ ok: true, data: { baseSha: FULL, headSha: null, expanded: [] } });
    expect(d.lookupProviderCommit).not.toHaveBeenCalled();
    expect(d.recordedCandidates).not.toHaveBeenCalled();
  });

  it("expands an unambiguous short SHA through the repository provider", async () => {
    const d = deps({ lookupProviderCommit: vi.fn(async () => ({ kind: "found" as const, sha: FULL })) });
    const result = await resolveSourceCommitShas({ baseSha: FULL, headSha: " 7FB295C " }, d);
    expect(result).toEqual({ ok: true, data: { baseSha: FULL, headSha: FULL,
      expanded: [{ field: "headSha", supplied: "7FB295C", resolved: FULL }] } });
    expect(d.lookupProviderCommit).toHaveBeenCalledWith("7fb295c");
  });

  it("refuses a provider answer that does not extend the prefix", async () => {
    const d = deps({ lookupProviderCommit: vi.fn(async () => ({ kind: "found" as const, sha: "a".repeat(40) })) });
    const result = await resolveSourceCommitShas({ headSha: "7fb295c" }, d);
    expect(result).toMatchObject({ ok: false, field: "headSha", reason: "unknown" });
  });

  it("names every recorded candidate when the provider cannot single one out", async () => {
    const d = deps({ recordedCandidates: vi.fn(async () => [FULL, OTHER, FULL]) });
    const result = await resolveSourceCommitShas({ headSha: "7fb295cf3a0" }, d);
    expect(result).toEqual({ ok: false, field: "headSha", supplied: "7fb295cf3a0", reason: "ambiguous", candidates: [FULL, OTHER] });
  });

  it("offers the single recorded commit for an unpushed or unknown prefix instead of guessing", async () => {
    const d = deps({ recordedCandidates: vi.fn(async () => [FULL]) });
    expect(await resolveSourceCommitShas({ headSha: "7fb295c" }, d))
      .toEqual({ ok: false, field: "headSha", supplied: "7fb295c", reason: "unknown", candidates: [FULL] });
  });

  it("refuses malformed or too-short values before any lookup", async () => {
    for (const value of ["", "  ", "abc123", "z".repeat(40), "a".repeat(41), 123]) {
      const d = deps();
      expect(await resolveSourceCommitShas({ baseSha: value }, d)).toMatchObject({ ok: false, field: "baseSha", reason: "malformed" });
      expect(d.lookupProviderCommit).not.toHaveBeenCalled();
    }
  });

  it("reports an unreachable provider with any recorded candidates", async () => {
    const d = deps({ lookupProviderCommit: vi.fn(async () => ({ kind: "unavailable" as const })), recordedCandidates: vi.fn(async () => [FULL]) });
    expect(await resolveSourceCommitShas({ baseSha: "7fb295c" }, d))
      .toMatchObject({ ok: false, reason: "unavailable", candidates: [FULL] });
  });
});

describe("sourceCommitRefusal", () => {
  const call = { tool: "claim_backlog_item_for_work", args: { itemId: "BI-ONE", branchName: "fix/one", headSha: "7fb295cf3a0" } };

  it("puts the exact corrected call, with the candidate filled in, in an ambiguous refusal", () => {
    const refusal = sourceCommitRefusal({ ok: false, field: "headSha", supplied: "7fb295cf3a0", reason: "ambiguous", candidates: [FULL, OTHER] }, call);
    expect(refusal).toMatchObject({ success: false, error: "invalid_input" });
    expect(refusal.message).toContain(FULL);
    expect(refusal.message).toContain(OTHER);
    expect(refusal.message).toContain(`claim_backlog_item_for_work({"itemId":"BI-ONE","branchName":"fix/one","headSha":"${FULL}"})`);
    expect(refusal.data).toMatchObject({ field: "headSha", reason: "ambiguous", candidates: [FULL, OTHER] });
  });

  it("tells the caller how to get the full SHA when nothing is known", () => {
    const refusal = sourceCommitRefusal({ ok: false, field: "headSha", supplied: "7fb295cf3a0", reason: "unknown", candidates: [] }, call);
    expect(refusal.message).toContain("git rev-parse 7fb295cf3a0");
    expect(refusal.message).toContain(`"headSha":"<40-hex output of git rev-parse 7fb295cf3a0>"`);
  });
});
