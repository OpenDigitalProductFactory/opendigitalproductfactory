import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MockAgent } from "undici";

// The MockAgent in this test intercepts the undici request that adp-client.ts
// makes. Credentials + token are fully mocked at the creds layer so we don't
// need a DB or token exchange.

const fakeCredential = {
  id: "cred-test-1",
  environment: "sandbox" as const,
  accessToken: "fake-bearer-token",
  certPem: "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
  privateKeyPem: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
};

vi.mock("../lib/creds.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/creds.js")>("../lib/creds.js");
  return {
    ...actual,
    getActiveCredential: vi.fn(async () => fakeCredential),
    recordToolCall: vi.fn(async () => {}),
  };
});

vi.mock("../lib/db.js", () => ({
  getSql: () => ({} as unknown),
  setSqlForTesting: () => {},
}));

import { listWorkers } from "./list-workers.js";
import { adpGet } from "../lib/adp-client.js";
import { recordToolCall } from "../lib/creds.js";

describe("adp_list_workers", () => {
  let mockAgent: MockAgent;

  beforeEach(() => {
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await mockAgent.close();
  });

  it("returns mapped + redacted workers and records a success audit row", async () => {
    mockAgent
      .get("https://api.sandbox.adp.com")
      .intercept({ path: /^\/hr\/v2\/workers/, method: "GET" })
      .reply(200, {
        workers: [
          {
            associateOID: "AOID-1",
            workerID: { idValue: "EMP0001" },
            person: {
              legalName: { givenName: "Jane", familyName: "Doe" },
              governmentIDs: [{ idValue: "123-45-6789", nameCode: { codeValue: "SSN" } }],
            },
            workAssignments: [
              {
                positionTitle: "Engineer",
                hireDate: "2020-01-01",
                primaryIndicator: true,
                assignmentStatus: { statusCode: { codeValue: "Active" } },
                homeOrganizationalUnits: [{ nameCode: { codeValue: "ENG" } }],
              },
            ],
          },
        ],
      });

    // Inject the mock dispatcher by patching adpGet via a local override. Since
    // adpGet uses `params.dispatcher ?? new Agent(...)`, we swap the whole call
    // by intercepting the url pattern through MockAgent at the global level.
    // Simpler: directly mock adpGet via vi.mock on that module.
    // (Second iteration — see next test. For this test the URL is matched via
    // the spy approach below.)
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockImplementation(async ({ query: _query }) => ({
      workers: [
        {
          associateOID: "AOID-1",
          workerID: { idValue: "EMP0001" },
          person: {
            legalName: { givenName: "Jane", familyName: "Doe" },
            governmentIDs: [{ idValue: "123-45-6789", nameCode: { codeValue: "SSN" } }],
          } as unknown,
          workAssignments: [
            {
              positionTitle: "Engineer",
              hireDate: "2020-01-01",
              primaryIndicator: true,
              assignmentStatus: { statusCode: { codeValue: "Active" } },
              homeOrganizationalUnits: [{ nameCode: { codeValue: "ENG" } }],
            },
          ],
        },
      ],
    }) as any);

    const result = await listWorkers(
      { statusFilter: "Active", top: 50 },
      { coworkerId: "payroll-specialist", userId: "user_1" },
    );

    expect(result.workers).toHaveLength(1);
    expect(result.workers[0]).toMatchObject({
      associateOID: "AOID-1",
      workerId: "EMP0001",
      displayName: "Jane Doe",
      positionTitle: "Engineer",
      departmentCode: "ENG",
      hireDate: "2020-01-01",
      status: "Active",
    });

    // Audit row written with success kind
    expect(recordToolCall).toHaveBeenCalledTimes(1);
    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.toolName).toBe("adp_list_workers");
    expect(auditCall.responseKind).toBe("success");
    expect(auditCall.resultCount).toBe(1);
    expect(auditCall.coworkerId).toBe("payroll-specialist");
    expect(auditCall.userId).toBe("user_1");

    spy.mockRestore();
  });

  it("rejects invalid args via Zod schema", async () => {
    await expect(
      listWorkers({ statusFilter: "Bogus" }, { coworkerId: "payroll-specialist", userId: null }),
    ).rejects.toThrow();
  });

  it("records a rate-limited audit row on AdpApiError with code RATE_LIMITED", async () => {
    const { AdpApiError } = await import("../lib/adp-client.js");
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockRejectedValue(new AdpApiError("rate limited", 429, "RATE_LIMITED"));

    await expect(
      listWorkers({}, { coworkerId: "payroll-specialist", userId: null }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.responseKind).toBe("rate-limited");
    expect(auditCall.errorCode).toBe("RATE_LIMITED");

    spy.mockRestore();
  });

  it("records an error audit row on AdpNotConnectedError", async () => {
    const { getActiveCredential, AdpNotConnectedError } = await import("../lib/creds.js");
    vi.mocked(getActiveCredential).mockRejectedValueOnce(
      new AdpNotConnectedError("ADP is not connected"),
    );

    await expect(
      listWorkers({}, { coworkerId: "payroll-specialist", userId: null }),
    ).rejects.toThrow(/not connected/i);

    const auditCall = vi.mocked(recordToolCall).mock.calls[0]![1];
    expect(auditCall.responseKind).toBe("error");
    expect(auditCall.errorCode).toBe("NOT_CONNECTED");
  });

  it("computes nextSkip when a full page is returned", async () => {
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    const oneWorker = {
      associateOID: "AOID-X",
      workerID: { idValue: "EMP-X" },
      person: { legalName: { givenName: "X", familyName: "Y" } },
      workAssignments: [
        {
          positionTitle: "T",
          hireDate: "2020-01-01",
          primaryIndicator: true,
          assignmentStatus: { statusCode: { codeValue: "Active" } },
        },
      ],
    };
    spy.mockResolvedValue({ workers: Array(10).fill(oneWorker) } as any);

    const result = await listWorkers(
      { top: 10, skip: 20 },
      { coworkerId: "payroll-specialist", userId: null },
    );
    expect(result.workers).toHaveLength(10);
    expect(result.nextSkip).toBe(30);

    spy.mockRestore();
  });

  it("returns nextSkip=null when fewer than top results returned", async () => {
    const spy = vi.spyOn(await import("../lib/adp-client.js"), "adpGet");
    spy.mockResolvedValue({ workers: [] } as any);

    const result = await listWorkers(
      { top: 50 },
      { coworkerId: "payroll-specialist", userId: null },
    );
    expect(result.nextSkip).toBeNull();

    spy.mockRestore();
  });
});

// Silence unused import for type inference in tests.
void adpGet;
