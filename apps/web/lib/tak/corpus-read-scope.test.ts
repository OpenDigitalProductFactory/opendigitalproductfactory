import { describe, expect, it, vi } from "vitest";

import {
  corpusGrantMode,
  corpusScopeAllowsPage,
  corpusScopeForAgent,
  extraFamilyGrantKey,
  isExtraFamilyGrantKey,
  listUnmappedProfessionReaders,
  ownFamilyRefusal,
  PERSON_CORPUS_SCOPE,
  recordCorpusGrantReport,
  resolveCorpusReadScope,
  WIKI_CORPUS_GRANTS,
  WIKI_KERNEL_READ,
  WIKI_ORG_READ,
  WIKI_PROFESSION_READ,
  wikiReaderForCorpusScope,
  type CorpusAgentRecord,
  type CorpusScopeDb,
} from "./corpus-read-scope";
import { COWORKER_READ_BASELINE_GRANTS } from "./agent-grants";
import { isGrantRevoked } from "./coworker-tool-grant-core";
import { canReadWikiPage } from "@/lib/wiki/backlinks";
import { PROFESSION_REGISTRY } from "@/lib/decision-perspective/resolve-profession-profile";
import agentRegistry from "../../../../packages/db/data/agent_registry.json";

// BI-825D3487 (spec 2026-10-28-corpus-scoped-read-grants-design.md).

const [familyA, familyB] = PROFESSION_REGISTRY.families;
const roleA = familyA!.roles[0]!;

function agent(over: Partial<CorpusAgentRecord> = {}): CorpusAgentRecord {
  return { agentId: "AGT-X", slugId: null, name: roleA, toolGrants: [], toolGrantRevocations: [], ...over };
}

const kernelPage = { slug: "principles/no-assumptions", organizationId: null };
const orgPage = { slug: "stances/ours", organizationId: "org-a" };
const pageIn = (key: string) => ({ slug: `professions/${key}/craft`, organizationId: null });

function dbReturning(row: CorpusAgentRecord | null): CorpusScopeDb & { findFirst: ReturnType<typeof vi.fn> } {
  const findFirst = vi.fn().mockResolvedValue(row);
  return {
    findFirst,
    agent: { findFirst },
    toolExecution: { create: vi.fn(), findMany: vi.fn() },
  } as unknown as CorpusScopeDb & { findFirst: ReturnType<typeof vi.fn> };
}

describe("corpusScopeForAgent", () => {
  it("AC-CRG-1: by default a mapped coworker reads the kernel, its organization and only its own family", () => {
    const scope = corpusScopeForAgent(agent(), "report-only");
    expect(scope).toMatchObject({ kernel: true, organization: true, familyKey: familyA!.professionKey, mapped: true });
    expect([...scope.professionFamilies!]).toEqual([familyA!.professionKey]);
    expect(corpusScopeAllowsPage(scope, pageIn(familyA!.professionKey))).toBe(true);
    expect(corpusScopeAllowsPage(scope, pageIn(familyB!.professionKey))).toBe(false);
  });

  it("AC-CRG-2: an extra-family grant adds that family; a revoked one does not", () => {
    const key = extraFamilyGrantKey(familyB!.professionKey);
    const granted = corpusScopeForAgent(agent({ toolGrants: [{ grantKey: key }] }), "enforce");
    expect(granted.professionFamilies!.has(familyB!.professionKey)).toBe(true);
    const revoked = corpusScopeForAgent(
      agent({ toolGrants: [{ grantKey: key }], toolGrantRevocations: [{ grantKey: key }] }),
      "enforce",
    );
    expect(revoked.professionFamilies!.has(familyB!.professionKey)).toBe(false);
  });

  it("AC-CRG-4: revoking a corpus grant removes that corpus", () => {
    const scope = corpusScopeForAgent(
      agent({ toolGrantRevocations: [{ grantKey: WIKI_KERNEL_READ }, { grantKey: WIKI_ORG_READ }, { grantKey: WIKI_PROFESSION_READ }] }),
      "enforce",
    );
    expect(scope.kernel).toBe(false);
    expect(scope.organization).toBe(false);
    expect(scope.professionFamilies!.size).toBe(0);
    expect(corpusScopeAllowsPage(scope, kernelPage)).toBe(false);
    expect(corpusScopeAllowsPage(scope, orgPage)).toBe(false);
  });

  it("AC-CRG-3: an unmapped coworker keeps profession reads in report-only and loses them in enforce", () => {
    const unmapped = agent({ agentId: "AGT-NOBODY", name: "no-such-role" });
    const report = corpusScopeForAgent(unmapped, "report-only");
    expect(report).toMatchObject({ mapped: false, reportOnlyUnmapped: true, professionFamilies: null });
    expect(corpusScopeAllowsPage(report, pageIn(familyB!.professionKey))).toBe(true);
    const enforce = corpusScopeForAgent(unmapped, "enforce");
    expect(enforce.reportOnlyUnmapped).toBe(false);
    expect(corpusScopeAllowsPage(enforce, pageIn(familyB!.professionKey))).toBe(false);
  });

  it("people are not limited by family", () => {
    expect(corpusScopeAllowsPage(PERSON_CORPUS_SCOPE, pageIn(familyB!.professionKey))).toBe(true);
  });
});

describe("resolveCorpusReadScope", () => {
  it("returns the person scope when no coworker identity reached the caller", async () => {
    const db = dbReturning(null);
    expect(await resolveCorpusReadScope(null, { db })).toBe(PERSON_CORPUS_SCOPE);
    expect(db.findFirst).not.toHaveBeenCalled();
  });

  it("AC-CRG-2: reads the coworker's live grant and revocation rows", async () => {
    const key = extraFamilyGrantKey(familyB!.professionKey);
    const db = dbReturning(agent({ toolGrants: [{ grantKey: key }], toolGrantRevocations: [{ grantKey: WIKI_ORG_READ }] }));
    const scope = await resolveCorpusReadScope("AGT-X", { db, mode: "enforce" });
    expect(scope.organization).toBe(false);
    expect([...scope.professionFamilies!].sort()).toEqual([familyA!.professionKey, familyB!.professionKey].sort());
  });

  it("resolves the family from the reference alone when no row exists", async () => {
    const scope = await resolveCorpusReadScope(roleA, { db: dbReturning(null), mode: "enforce" });
    expect(scope.familyKey).toBe(familyA!.professionKey);
  });

  it("fails closed when the authority rows cannot be read", async () => {
    const db = dbReturning(null);
    db.findFirst.mockRejectedValue(new Error("db down"));
    const scope = await resolveCorpusReadScope("AGT-X", { db, mode: "report-only" });
    expect(scope).toMatchObject({ kernel: false, organization: false, reportOnlyUnmapped: false });
    expect(scope.professionFamilies!.size).toBe(0);
  });
});

describe("wikiReaderForCorpusScope", () => {
  it("AC-CRG-7: an agent's backlinks reader omits a page from a family outside its set", () => {
    const reader = wikiReaderForCorpusScope(corpusScopeForAgent(agent(), "enforce"), "org-a");
    expect(reader.familyKey).toBe(familyA!.professionKey);
    expect(canReadWikiPage(reader, pageIn(familyA!.professionKey))).toBe(true);
    expect(canReadWikiPage(reader, pageIn(familyB!.professionKey))).toBe(false);
    expect(canReadWikiPage(reader, orgPage)).toBe(true);
  });

  it("AC-CRG-4: a revoked kernel or organization corpus is unreadable through the reader", () => {
    const scope = corpusScopeForAgent(
      agent({ toolGrantRevocations: [{ grantKey: WIKI_KERNEL_READ }, { grantKey: WIKI_ORG_READ }] }),
      "enforce",
    );
    const reader = wikiReaderForCorpusScope(scope, "org-a");
    expect(canReadWikiPage(reader, kernelPage)).toBe(false);
    expect(canReadWikiPage(reader, orgPage)).toBe(false);
  });

  it("people keep the unfiltered reader", () => {
    const reader = wikiReaderForCorpusScope(PERSON_CORPUS_SCOPE, "org-a");
    expect(reader.professionFamilies).toBeNull();
    expect(canReadWikiPage(reader, pageIn(familyB!.professionKey))).toBe(true);
  });
});

describe("refusals", () => {
  it("AC-CRG-4: names the family when the coworker's own family is outside its set", () => {
    const scope = corpusScopeForAgent(agent({ toolGrantRevocations: [{ grantKey: WIKI_PROFESSION_READ }] }), "enforce");
    const refusal = ownFamilyRefusal(scope, "evaluate_profession_decision");
    expect(refusal).toMatchObject({ success: false, error: "corpus_family_not_granted" });
    expect(refusal!.message).toContain(familyA!.professionKey);
    expect(ownFamilyRefusal(corpusScopeForAgent(agent(), "enforce"), "evaluate_profession_decision")).toBeNull();
  });
});

describe("report-only record", () => {
  it("AC-CRG-3: records an unmapped coworker's profession read and lists it back", async () => {
    const db = dbReturning(null);
    await recordCorpusGrantReport(
      { agentId: "AGT-NOBODY", userId: "u1", toolName: "wiki_query", slugs: ["professions/x/a", "professions/y/b"] },
      db,
    );
    expect(db.toolExecution.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        threadId: "corpus-grant-report:AGT-NOBODY",
        agentId: "AGT-NOBODY",
        toolName: "wiki_query",
        auditClass: "journal",
        success: true,
      }),
    });
    const createdAt = new Date("2026-11-01T00:00:00Z");
    (db.toolExecution.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { agentId: "AGT-NOBODY", createdAt, result: { slugs: ["professions/x/a"] } },
      { agentId: "AGT-NOBODY", createdAt: new Date("2026-10-30T00:00:00Z"), result: { slugs: ["professions/y/b"] } },
      { agentId: "AGT-OTHER", createdAt, result: { slugs: [] } },
    ]);
    const readers = await listUnmappedProfessionReaders({ db });
    expect(readers).toEqual([
      { agentId: "AGT-NOBODY", reads: 2, lastReadAt: createdAt, families: ["x", "y"] },
      { agentId: "AGT-OTHER", reads: 1, lastReadAt: createdAt, families: [] },
    ]);
  });
});

describe("grant vocabulary", () => {
  it("accepts extra-family keys only for registered professions", () => {
    expect(isExtraFamilyGrantKey(extraFamilyGrantKey(familyA!.professionKey))).toBe(true);
    expect(isExtraFamilyGrantKey("wiki_profession_read:not-a-profession")).toBe(false);
    expect(isExtraFamilyGrantKey(WIKI_PROFESSION_READ)).toBe(false);
  });

  it("puts the three corpus grants in the coworker read baseline", () => {
    for (const key of WIKI_CORPUS_GRANTS) expect(COWORKER_READ_BASELINE_GRANTS).toContain(key);
  });

  it("reads report-only unless the mode is exactly enforce", () => {
    expect(corpusGrantMode({})).toBe("report-only");
    expect(corpusGrantMode({ DPF_WIKI_CORPUS_GRANT_MODE: "enforce" })).toBe("enforce");
    expect(corpusGrantMode({ DPF_WIKI_CORPUS_GRANT_MODE: "enforced" })).toBe("report-only");
  });
});

describe("reboot seed", () => {
  it("AC-CRG-2: the boot seed never writes a corpus grant, so a revocation survives it", () => {
    const seeded = (agentRegistry as { agents: Array<{ config_profile?: { tool_grants?: string[] } }> }).agents
      .flatMap((a) => a.config_profile?.tool_grants ?? []);
    for (const key of seeded) {
      expect(WIKI_CORPUS_GRANTS as readonly string[]).not.toContain(key);
      expect(key.startsWith(`${WIKI_PROFESSION_READ}:`)).toBe(false);
    }
    // A revoked extra-family row is skipped by the seed's own predicate, and the
    // resolver ignores it whether or not a grant row is still present.
    const key = extraFamilyGrantKey(familyB!.professionKey);
    expect(isGrantRevoked(new Set([`cuid-x:${key}`]), "cuid-x", key)).toBe(true);
    const afterSeed = corpusScopeForAgent(
      agent({ toolGrants: [{ grantKey: key }], toolGrantRevocations: [{ grantKey: key }, { grantKey: WIKI_KERNEL_READ }] }),
      "enforce",
    );
    expect(afterSeed.kernel).toBe(false);
    expect(afterSeed.professionFamilies!.has(familyB!.professionKey)).toBe(false);
  });
});
