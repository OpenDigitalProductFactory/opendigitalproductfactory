import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  organizationFindFirst: vi.fn(),
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    organization: {
      findFirst: (...args: unknown[]) => prismaMock.organizationFindFirst(...args),
    },
  },
}));

const enrichMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wiki/enrich-org-corpus", () => ({
  enrichOrgCorpus: (...args: unknown[]) => enrichMock(...args),
}));

const inferMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/wiki/inference-adapter", () => ({
  createProductionInference: (...args: unknown[]) => {
    inferMock(...args);
    return async () => ({ text: "" });
  },
}));

import { orgDecisionPack } from "./org-decision-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.organizationFindFirst.mockResolvedValue({ id: "org-1" });
  enrichMock.mockResolvedValue({
    rawSourceId: "rs-1",
    committed: [{ pageId: "p1", slug: "org-key-customers" }],
    materialIds: [],
    superseded: [],
    warnings: [],
  });
});

describe("org-decision pack — record_org_business_answer", () => {
  it("registers the tool as a side-effecting coworker door", () => {
    const def = orgDecisionPack.definitions.find((d) => d.name === "record_org_business_answer");
    expect(def).toBeDefined();
    expect(def!.sideEffect).toBe(true);
    expect(orgDecisionPack.handlers.record_org_business_answer).toBeTypeOf("function");
  });

  it("gates the tool behind registry_write (mirrors TOOL_TO_GRANTS)", () => {
    expect(orgDecisionPack.grants.record_org_business_answer).toEqual(["registry_write"]);
    expect(isToolAllowedByGrants("record_org_business_answer", ["registry_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_org_business_answer", ["registry_read"])).toBe(false);
    expect(isToolAllowedByGrants("record_org_business_answer", ["work_capsule_read"])).toBe(false);
  });

  it("routes a confirmed answer through the enrichment façade with qa/first-party provenance", async () => {
    const res = await orgDecisionPack.handlers.record_org_business_answer!(
      { question: "Who are your key customers?", answer: "Local schools and clinics.", topic: "key customers" },
      "user-1",
      { agentId: "onboarding-coo" },
    );

    expect(res.success).toBe(true);
    expect(enrichMock).toHaveBeenCalledTimes(1);
    const call = enrichMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.organizationId).toBe("org-1");
    expect(call.trust).toBe("first-party");
    expect(call.provenance).toEqual({
      sourceType: "qa",
      sourceRef: { question: "Who are your key customers?", askedBy: "user-1" },
    });
    expect(call.title).toBe("key customers");
    expect(String(call.text)).toContain("Local schools and clinics.");
    expect(call.agentId).toBe("onboarding-coo");
    // Draft-by-default contract surfaces in the coworker-facing message.
    expect(String(res.message)).toContain("review");
  });

  it("rejects a missing question or answer without touching the façade", async () => {
    const res = await orgDecisionPack.handlers.record_org_business_answer!(
      { question: "  ", answer: "" },
      "user-1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("invalid_params");
    expect(enrichMock).not.toHaveBeenCalled();
  });

  it("fails cleanly when no organization exists", async () => {
    prismaMock.organizationFindFirst.mockResolvedValue(null);
    const res = await orgDecisionPack.handlers.record_org_business_answer!(
      { question: "Q", answer: "A" },
      "user-1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("no_org");
  });

  it("reports an enrichment failure instead of throwing", async () => {
    enrichMock.mockRejectedValue(new Error("proposer unavailable"));
    const res = await orgDecisionPack.handlers.record_org_business_answer!(
      { question: "Q", answer: "A" },
      "user-1",
    );
    expect(res.success).toBe(false);
    expect(res.error).toBe("enrichment_failed");
    expect(String(res.message)).toContain("proposer unavailable");
  });

  it("keeps the tool description provenance-free (no BI/phase/source-path leakage)", () => {
    const def = orgDecisionPack.definitions.find((d) => d.name === "record_org_business_answer")!;
    expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
  });
});
