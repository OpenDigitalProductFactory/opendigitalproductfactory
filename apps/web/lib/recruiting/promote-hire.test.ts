import { describe, expect, it, vi } from "vitest";
import { promoteGreenhouseHireToNative, type PromoteHireClient } from "./promote-hire";
import type { GreenhouseHire } from "@/lib/integrations/greenhouse/land-hire";

function hire(overrides: Partial<GreenhouseHire> = {}): GreenhouseHire {
  return {
    candidateId: "cand-1",
    applicationId: "app-1",
    firstName: "Ana",
    lastName: "López",
    displayName: "Ana López",
    workEmail: "ana@example.com",
    phoneWork: null,
    startDate: "2026-09-01",
    ...overrides,
  };
}

function fakeDb(opts: { crosswalks?: Record<string, string> } = {}) {
  const map = opts.crosswalks ?? {};
  const key = (a: { where: { domain_sourceSystem_sourceEntityId: { domain: string; sourceEntityId: string } } }) =>
    `${a.where.domain_sourceSystem_sourceEntityId.domain}:${a.where.domain_sourceSystem_sourceEntityId.sourceEntityId}`;
  const findUnique = vi.fn().mockImplementation(async (a) => {
    const id = map[key(a)];
    return id ? { canonicalId: id } : null;
  });
  const findMany = vi.fn().mockResolvedValue([]);
  const upsert = vi.fn().mockResolvedValue({});
  const candidateCreate = vi.fn().mockResolvedValue({ id: "native-candidate-1" });
  const applicationCreate = vi.fn().mockResolvedValue({ id: "native-application-1" });
  const db: PromoteHireClient = {
    masterDataSourceRef: { findUnique, findMany, upsert },
    candidate: { create: candidateCreate },
    application: { create: applicationCreate },
  };
  return { db, candidateCreate, applicationCreate, upsert };
}

describe("promoteGreenhouseHireToNative", () => {
  it("creates a native Candidate + hired Application + crosswalks on a new hire", async () => {
    const { db, candidateCreate, applicationCreate, upsert } = fakeDb();

    const result = await promoteGreenhouseHireToNative(db, hire());

    expect(result).toEqual({
      candidateId: "native-candidate-1",
      applicationId: "native-application-1",
      promoted: true,
    });
    expect(candidateCreate.mock.calls[0][0].data).toMatchObject({
      candidateId: "gh-cand-1",
      kind: "candidate",
      displayName: "Ana López",
      email: "ana@example.com",
    });
    expect(applicationCreate.mock.calls[0][0].data).toMatchObject({
      applicationId: "gh-app-1",
      candidateId: "native-candidate-1",
      status: "hired",
    });
    // Two crosswalks registered: candidate + application.
    expect(upsert).toHaveBeenCalledTimes(2);
  });

  it("is idempotent — an existing application crosswalk creates nothing", async () => {
    const { db, candidateCreate, applicationCreate } = fakeDb({
      crosswalks: {
        "recruiting-application:app-1": "existing-app",
        "recruiting-candidate:cand-1": "existing-candidate",
      },
    });

    const result = await promoteGreenhouseHireToNative(db, hire());

    expect(result).toEqual({
      candidateId: "existing-candidate",
      applicationId: "existing-app",
      promoted: false,
    });
    expect(candidateCreate).not.toHaveBeenCalled();
    expect(applicationCreate).not.toHaveBeenCalled();
  });

  it("reuses an existing candidate crosswalk but still creates the application", async () => {
    const { db, candidateCreate, applicationCreate } = fakeDb({
      crosswalks: { "recruiting-candidate:cand-1": "existing-candidate" },
    });

    const result = await promoteGreenhouseHireToNative(db, hire());

    expect(candidateCreate).not.toHaveBeenCalled();
    expect(applicationCreate.mock.calls[0][0].data.candidateId).toBe("existing-candidate");
    expect(result).toMatchObject({ candidateId: "existing-candidate", promoted: true });
  });

  it("falls back to the candidate id when the hire carries no application id", async () => {
    const { db, applicationCreate } = fakeDb();
    await promoteGreenhouseHireToNative(db, hire({ applicationId: null }));
    expect(applicationCreate.mock.calls[0][0].data.applicationId).toBe("gh-cand-1");
  });
});
